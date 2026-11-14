import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { canonical, changedPaths, digest, git, publicBuildEnvironment, PUBLIC_BUILD_KEYS, requireCondition, sourceSnapshot, targets, validateManifest } from './contract.mjs';

import { readCandidateModuleInventory } from './modules.mjs';

const MODULE_TESTS = Object.freeze({ dashboard: /^(?:dashboard|missingNomB)/i, markets: /^(?:market|hedgeMarket)/i,
  buyer_invoices: /^buyerInvoice/i, xero_portal: /^xero/i, email_router: /^email/i, settings: /^(?:settings|auth|capability|user|permission)/i });
export function selectedProductTests(files, selection) {
  const all = files.filter(file => file.endsWith('.test.js')).sort();
  if (selection.broad || !selection.modules.length) return all;
  const groups = selection.modules.map(module => MODULE_TESTS[module] ? all.filter(file => MODULE_TESTS[module].test(file)) : []);
  return groups.some(group => !group.length) ? all : [...new Set(groups.flat())].sort();
}

export function artifactInventory(root, relative = '') {
  const entries = [];
  const absolute = join(root, relative), stat = lstatSync(absolute);
  requireCondition(stat.isDirectory() && !stat.isSymbolicLink(), 'ARTIFACT_DIRECTORY_INVALID');
  for (const name of readdirSync(absolute).sort()) {
    requireCondition(name !== '.' && name !== '..' && !/[\0\\]/.test(name), 'ARTIFACT_PATH_INVALID');
    const path = relative ? `${relative}/${name}` : name, file = join(root, path), info = lstatSync(file);
    requireCondition(!info.isSymbolicLink() && (info.isFile() || info.isDirectory()), 'ARTIFACT_LINK_OR_SPECIAL_FILE');
    if (info.isDirectory()) entries.push(...artifactInventory(root, path));
    else {
      requireCondition(info.size <= 100 * 1024 * 1024 && !/(?:^|\/)(?:\.env(?:\.|$)|credentials(?:\.json)?$|.*\.(?:pem|key|p12|pfx)$)/i.test(path), 'ARTIFACT_PRIVATE_OR_TOO_LARGE');
      entries.push({ path, bytes: info.size, mode: info.mode & 0o111 ? 'executable' : 'regular', digest: digest(readFileSync(file)) });
    }
  }
  requireCondition(entries.length <= 30000 && entries.reduce((sum, entry) => sum + entry.bytes, 0) <= 500 * 1024 * 1024, 'ARTIFACT_BUDGET_EXCEEDED');
  return entries;
}
export function artifactDigest(root) { return digest(artifactInventory(root)); }
export function assertBuildArtifact(directory, receipt, manifest) {
  const root = join(directory, '.vercel/output');
  const inventory = artifactInventory(root), files = new Set(inventory.map(entry => entry.path));
  requireCondition(digest(inventory) === receipt.artifactDigest, 'ARTIFACT_DIGEST_CHANGED');
  for (const entry of inventory.filter(item => item.path === '.vc-config.json' || item.path.endsWith('/.vc-config.json'))) {
    const configuration = JSON.parse(readFileSync(join(root, entry.path), 'utf8'));
    for (const reference of Object.values(configuration.filePathMap || {})) {
      requireCondition(typeof reference === 'string' && !isAbsolute(reference) && !reference.includes('\\')
        && !reference.split('/').includes('..') && files.has(relative(root, resolve(directory, reference))), 'ARTIFACT_EXTERNAL_REFERENCE_FORBIDDEN');
    }
  }
  const config = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'));
  requireCondition(config.version === 3, 'BUILD_OUTPUT_API_VERSION');
  const version = JSON.parse(readFileSync(join(root, 'static/app-version.json'), 'utf8'));
  requireCondition(version.buildId === manifest.build.buildId && version.commit === manifest.candidate.sha
    && version.sourceDigest === manifest.candidate.sourceDigest, 'BUILT_IDENTITY_MISMATCH');
  return { inventory, version };
}
export function credentialFreeBuildEnvironment(manifest, env = process.env) {
  return { PATH: env.PATH, HOME: env.FCOS_RAPID_BUILD_HOME, TMPDIR: env.TMPDIR || '/tmp', CI: '1', NO_COLOR: '1',
    ...publicBuildEnvironment(manifest.build.publicEnvironment), FCOS_REQUIRE_CLEAN_BUILD: '1',
    FCOS_BUILD_COMMIT_SHA: manifest.candidate.sha, FCOS_RAPID_BUILD_ID: manifest.build.buildId,
    FCOS_RAPID_SOURCE_DIGEST: manifest.candidate.sourceDigest };
}
export function qualityAndBuild({ manifest, candidateDirectory, controllerDirectory, env = process.env, run = execFileSync }) {
  validateManifest(manifest);
  const before = sourceSnapshot(candidateDirectory);
  requireCondition(before.sha === manifest.candidate.sha && before.sourceDigest === manifest.candidate.sourceDigest
    && before.lockDigest === manifest.candidate.lockDigest, 'CANDIDATE_BINDING_CHANGED');
  requireCondition(canonical(readCandidateModuleInventory(candidateDirectory)) === canonical(manifest.moduleInventory), 'CANDIDATE_MODULE_INVENTORY_CHANGED');
  requireCondition(canonical(changedPaths(candidateDirectory, manifest.previous.sha)) === canonical(manifest.paths), 'CHANGED_PATH_SELECTION_MISMATCH');
  requireCondition(git(controllerDirectory, ['rev-parse', 'HEAD']) === manifest.controllerSha
    && !git(controllerDirectory, ['status', '--porcelain', '--untracked-files=no']), 'CONTROLLER_SOURCE_CHANGED');
  const buildEnv = credentialFreeBuildEnvironment(manifest, env);
  requireCondition(typeof buildEnv.HOME === 'string' && resolve(buildEnv.HOME) !== resolve(env.HOME || '/')
    && buildEnv.HOME.startsWith(env.RUNNER_TEMP || '/tmp/'), 'ISOLATED_BUILD_HOME_REQUIRED');
  mkdirSync(buildEnv.HOME, { recursive: true, mode: 0o700 });
  const checks = [], started = Date.now();
  const testEnv = Object.fromEntries(Object.entries(buildEnv).filter(([key]) => !PUBLIC_BUILD_KEYS.includes(key)));
  const command = (label, executable, args, directory = candidateDirectory) => {
    const begin = Date.now();
    try { run(executable, args, { cwd: directory, env: ['build', 'fcuno_contract'].includes(label) ? buildEnv : testEnv,
      stdio: 'pipe', timeout: 900000, maxBuffer: 8 * 1024 * 1024 }); }
    catch { throw Object.assign(new Error(`QUALITY_${label.toUpperCase()}_FAILED`), { code: `QUALITY_${label.toUpperCase()}_FAILED` }); }
    checks.push({ label, elapsedMs: Date.now() - begin, passed: true });
  };
  command('dependencies', 'npm', ['ci', '--include=dev', '--no-audit', '--no-fund']);
  command('controls', 'npm', ['run', 'verify:controls']);
  command('lint', 'npm', ['run', 'lint']); command('typecheck', 'npm', ['run', 'typecheck']);
  // Reviewed per-module test selection; absent mapping broadens rather than dropping coverage.
  const chosen = selectedProductTests(readdirSync(join(candidateDirectory, 'tests')), manifest.selection);
  requireCondition(chosen.length > 0, 'PRODUCT_TEST_COVERAGE_MISSING');
  command('tests', 'node', ['--test', ...chosen.map(file => `tests/${file}`).sort()]);
  command('migration_integrity', 'npm', ['run', 'verify:migrations']);
  command('compatibility', 'npm', ['run', 'verify:compatibility']);
  command('graph_only', 'npm', ['run', 'verify:graph-only']);
  if (manifest.selection.broad) command('fcuno_contract', 'npm', ['run', 'verify:fcuno-contract']);
  const vercel = join(candidateDirectory, '.vercel'); mkdirSync(vercel, { recursive: true });
  writeFileSync(join(vercel, 'project.json'), JSON.stringify({ projectId: targets().projectId, orgId: targets().teamId,
    projectName: 'fcos', settings: { framework: 'vite', installCommand: 'npm ci', buildCommand: 'npm run build', nodeVersion: '24.x', rootDirectory: null } }));
  writeFileSync(join(vercel, '.env.production.local'), Object.entries(manifest.build.publicEnvironment).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n'));
  command('build', 'vercel', ['build', '--prod', '--yes', '--standalone']);
  command('performance', 'npm', ['run', 'verify:performance']);
  requireCondition(sourceSnapshot(candidateDirectory).sourceDigest === before.sourceDigest
    && git(controllerDirectory, ['rev-parse', 'HEAD']) === manifest.controllerSha
    && !git(controllerDirectory, ['status', '--porcelain', '--untracked-files=no']), 'BUILD_INPUTS_CHANGED');
  const receipt = { schemaVersion: 1, buildId: manifest.build.buildId, candidateSha: manifest.candidate.sha,
    controllerSha: manifest.controllerSha, sourceDigest: manifest.candidate.sourceDigest, lockDigest: manifest.candidate.lockDigest,
    artifactDigest: artifactDigest(join(vercel, 'output')), qualityPassed: true, performancePassed: true,
    node: process.version, checks, elapsedMs: Date.now() - started,
    providerCalls: null, providerWrites: 0, knownPublicGitHubReads: manifest.selection.broad ? 4 : 0,
    dependencyToolNetworkCalls: 'not_metered' };
  assertBuildArtifact(candidateDirectory, receipt, manifest); return receipt;
}
