import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { dirname, join, sep } from 'node:path';

export const RELEASE_CHECK_MANIFEST = 'config/release-checks-v2.json';
export const RELEASE_CHECK_REPORT_KIND = 'fcos_hosted_release_checks';
const hash = value => createHash('sha256').update(value).digest('hex');
const jsonHash = value => hash(JSON.stringify(value));
const sha = value => /^[a-f0-9]{40}$/.test(value || '');
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const inside = value => value && !value.startsWith('/') && !value.split('/').includes('..');
const equal = isDeepStrictEqual;

export function loadReleaseCheckManifest(controllerDirectory) {
  const bytes = readFileSync(join(controllerDirectory, RELEASE_CHECK_MANIFEST));
  const manifest = JSON.parse(bytes);
  if (manifest.schemaVersion !== 2 || manifest.nodeMajor !== 24 || !Array.isArray(manifest.checks)
    || !manifest.sourceProfiles || !Number.isSafeInteger(manifest.volatileMaximumAgeMs)) throw new Error('Invalid release check manifest.');
  const ids = new Set();
  for (const check of manifest.checks) {
    if (!/^[a-z][a-z0-9_]+$/.test(check.id) || ids.has(check.id) || check.required !== true
      || !['deterministic', 'volatile'].includes(check.kind) || !['candidate', 'controller', 'aggregate'].includes(check.executor)
      || !Array.isArray(check.requires) || !Array.isArray(check.inputs) || !Array.isArray(check.commands)
      || !Array.isArray(check.profiles) || check.inputs.some(p => p !== '@source' && !inside(p))) throw new Error('Invalid release check definition.');
    ids.add(check.id);
    for (const command of check.commands) assertCommand(command);
    for (const commands of Object.values(check.profileCommands || {})) for (const command of commands) assertCommand(command);
  }
  const visit = (id, path = []) => {
    if (path.includes(id)) throw new Error('Cyclic release check prerequisite graph.');
    const check = manifest.checks.find(c => c.id === id);
    if (!check) throw new Error('Unknown release check prerequisite.');
    for (const dependency of check.requires) visit(dependency, [...path, id]);
  };
  for (const id of ids) visit(id);
  return { manifest, manifestSha256: hash(bytes) };
}

function assertCommand(command) {
  if (!['node', 'python3'].includes(command.program) || !Array.isArray(command.args)
    || command.args.some(a => typeof a !== 'string' || a.includes('\0')) || !command.env || typeof command.env !== 'object'
    || Object.entries(command.env).some(([key, value]) => typeof value !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(key)
      || /TOKEN|SECRET|PASSWORD|CREDENTIAL|NODE_OPTIONS|PYTHONPATH|HOME|PATH/.test(key))) throw new Error('Unadmitted check command.');
}

export function requiredReleaseChecks(manifest, sourceProfile) {
  if (!Object.hasOwn(manifest.sourceProfiles, sourceProfile)) throw new Error('An admitted source profile is required.');
  return manifest.checks.filter(check => check.profiles.includes(sourceProfile));
}

export function collectReleaseCheckSource(candidateDirectory) {
  const generated = new Set(['public/app-version.json', 'api/_runtime-build-receipt.json']);
  const dirty = git(candidateDirectory, ['status', '--porcelain', '--untracked-files=no', '--', '.', ':!public/app-version.json', ':!api/_runtime-build-receipt.json']);
  if (dirty) throw new Error('Candidate source differs from immutable admission.');
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: candidateDirectory, encoding: 'utf8' }).split('\0').filter(p => p && !generated.has(p)).sort();
  const values = files.map(file => {
    if (file.split('/').some(p => /^\.env(?:\.|$)/i.test(p) || /^(?:\.npmrc|\.netrc|credentials(?:\.json)?|id_(?:rsa|ed25519)|.*\.(?:pem|key|p12|pfx))$/i.test(p) || ['.fcos-cli', '.sf', '.sfdx', '.aws', '.ssh'].includes(p))) throw new Error('Credential paths cannot be release source inputs.');
    const target = join(candidateDirectory, file);
    if (!existsSync(target) || !lstatSync(target).isFile()) throw new Error('Candidate tracked source must contain regular files.');
    return [file, hash(readFileSync(target))];
  });
  return { values, sourceInputsSha256: jsonHash(values), candidateDirectory };
}

export function collectCheckBinding({ candidateDirectory, controllerDirectory, controllerSha, expectedCandidateSha,
  sourceProfile, manifest, manifestSha256, runtime = { node: process.version, platform: process.platform, arch: process.arch, python: execFileSync('/usr/bin/python3', ['--version'], { encoding: 'utf8' }).trim() }, source }) {
  if (!sha(controllerSha) || git(controllerDirectory, ['rev-parse', 'HEAD']) !== controllerSha) throw new Error('Controller checkout differs from immutable admission.');
  if (git(controllerDirectory, ['status', '--porcelain', '--', RELEASE_CHECK_MANIFEST, 'scripts/hosted-release-checks.mjs', 'scripts/lib/hosted-release/checks.mjs', '.codex/control-validation.mjs'])) throw new Error('Admitted controller check implementation is dirty.');
  const candidateSha = git(candidateDirectory, ['rev-parse', 'HEAD']);
  if (!sha(expectedCandidateSha) || candidateSha !== expectedCandidateSha) throw new Error('Candidate checkout differs from immutable admission.');
  const profile = manifest.sourceProfiles[sourceProfile];
  if (!profile || profile.candidateSha && profile.candidateSha !== candidateSha) throw new Error('Candidate source profile mismatch.');
  for (const directory of new Set([candidateDirectory, controllerDirectory])) {
    if (!['https://github.com/hocheunglai-oss/fcos', 'https://github.com/hocheunglai-oss/fcos.git', 'git@github.com:hocheunglai-oss/fcos.git'].includes(git(directory, ['remote', 'get-url', 'origin']))) throw new Error('FCOS repository identity mismatch.');
  }
  if (Number(runtime.node.replace(/^v/, '').split('.')[0]) !== manifest.nodeMajor) throw new Error('Release checks require pinned Node.js major.');
  const actual = source || collectReleaseCheckSource(candidateDirectory);
  const configurationSha256 = jsonHash(actual.values.filter(([p]) => p.startsWith('config/') || p.startsWith('.codex/') || /^(?:package.json|.*config\.[a-z]+)$/.test(p)));
  return { candidateSha, sourceInputsSha256: actual.sourceInputsSha256, sourceProfile, lockSha256: hash(readFileSync(join(candidateDirectory, 'package-lock.json'))),
    configurationSha256, controllerSha, manifestSha256, runtime,
    installedLockSha256: existsSync(join(candidateDirectory, 'node_modules/.package-lock.json')) ? hash(readFileSync(join(candidateDirectory, 'node_modules/.package-lock.json'))) : null };
}

function artifactHash(target) {
  if (!existsSync(target)) return null;
  const stat = lstatSync(target);
  if (stat.isSymbolicLink()) throw new Error('Release artifacts must not contain symbolic links.');
  if (stat.isFile()) return hash(readFileSync(target));
  if (!stat.isDirectory()) throw new Error('Release artifact is not a regular file or directory.');
  return jsonHash(readdirSync(target).sort().map(n => [n, artifactHash(join(target, n))]));
}

export function checkBinding(check, common, source) {
  const commands = check.profileCommands?.[common.sourceProfile] || check.commands;
  const inputs = check.inputs.includes('@source') ? source.values : source.values.filter(([p]) => check.inputs.some(i => p === i || p.startsWith(`${i}/`)));
  const artifacts = (check.artifactInputs || []).map(p => [p, artifactHash(join(source.candidateDirectory, p))]);
  return { ...common, inputsSha256: jsonHash(inputs), artifactsSha256: jsonHash(artifacts), commandSha256: jsonHash(commands) };
}

// A raw local report is never provider authority. The trusted publisher must independently
// verify runner/job identity and archive digest before passing its external validator here.
export function evaluateCheckEvidence({ check, binding, evidence, now = Date.now(), maximumAgeMs = 1800000, validateExternal }) {
  if (!evidence || evidence.schemaVersion !== 2 || evidence.checkId !== check.id || evidence.status !== 'passed'
    || !equal(evidence.binding, binding) || !Number.isFinite(Date.parse(evidence.startedAt)) || !Number.isFinite(Date.parse(evidence.completedAt))
    || Date.parse(evidence.completedAt) < Date.parse(evidence.startedAt) || Date.parse(evidence.completedAt) > now + 30000) return false;
  if (check.kind === 'volatile') {
    if (now - Date.parse(evidence.completedAt) > maximumAgeMs || typeof validateExternal !== 'function' || validateExternal(check, evidence) !== true) return false;
    if (check.coverage) {
      const coverage = evidence.coverage;
      if (!Array.isArray(coverage) || coverage.length !== check.coverage.length || new Set(coverage.map(r => r.module)).size !== coverage.length
        || check.coverage.some(id => !coverage.some(row => row.module === id && row.result === 'passed' && row.actualData === true))) return false;
    }
  } else {
    const commands = check.profileCommands?.[binding.sourceProfile] || check.commands;
    if (!Array.isArray(evidence.commands) || evidence.commands.length !== commands.length || !commands.length
      || evidence.commands.some((c, i) => c.exitCode !== 0 || c.program !== commands[i].program || !equal(c.args, commands[i].args))) return false;
  }
  return true;
}

export function sanitisedCheckEnvironment({ environment = process.env, home, command, candidateDirectory, checkId,
  controllerDirectory, controllerSha, candidateSha }) {
  const env = { PATH: `${join(candidateDirectory, 'node_modules/.bin')}${sep === '/' ? ':' : ';'}${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: home, TMPDIR: home, LANG: 'C.UTF-8', TZ: 'UTC', CI: 'true', ...command.env };
  // Non-secret local browser cache only; never copy arbitrary FCOS/provider/controller variables.
  if (environment.PLAYWRIGHT_BROWSERS_PATH && !/^(?:https?:|\$)/.test(environment.PLAYWRIGHT_BROWSERS_PATH)) env.PLAYWRIGHT_BROWSERS_PATH = environment.PLAYWRIGHT_BROWSERS_PATH;
  if (environment.FCOS_HOSTED_PUBLIC_BUILD_INPUTS) {
    const values = JSON.parse(environment.FCOS_HOSTED_PUBLIC_BUILD_INPUTS);
    const allowed = ['VITE_FCOS_ENABLE_FCUNO_OIDC','FCOS_ENABLE_FCUNO_FEDERATION','FCUNO_IDENTITY_ISSUER','VITE_SUPABASE_URL','VITE_SUPABASE_ANON_KEY','VITE_SUPABASE_PUBLISHABLE_KEY'];
    if (Object.entries(values).some(([key,value]) => !allowed.includes(key) || typeof value !== 'string' || /[\r\n]/.test(value))) throw new Error('Unadmitted public build inputs.');
    // Unit fixtures must own their auth configuration. Deployment settings can
    // start a persistent browser auth client inside a Node/Vite SSR test.
    if (checkId !== 'unit') Object.assign(env, values);
  }
  if (command.env.FCOS_MIGRATION_PARENT_PROOF_FILE !== undefined) {
    const proofPath = '/controller/output/disposable-migration-server.json';
    if (checkId !== 'migrations' || command.env.FCOS_MIGRATION_PARENT_PROOF_FILE !== proofPath
      || command.env.FCOS_MIGRATION_PROJECT_ID !== 'fcos' || environment.GITHUB_ACTIONS !== 'true'
      || command.env.FCOS_MIGRATION_DOCKER_CONTAINER !== 'supabase_db_fcos'
      || command.env.FCOS_MIGRATION_DATABASE_URL !== 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
      || command.env.FCOS_MIGRATION_DISPOSABLE_CLUSTER !== '1'
      || environment.FCOS_HOSTED_CHECK_EXECUTION !== '1' || !sha(controllerSha) || !sha(candidateSha)
      || !controllerDirectory || !/^[a-f0-9]{64}$/.test(environment.FCOS_HOSTED_MIGRATION_PARENT_PROOF_SHA256 || '')) {
      throw new Error('Trusted migration fixture context is required.');
    }
    const file = join(controllerDirectory, 'output/disposable-migration-server.json');
    if (realpathSync(file) !== file || !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()
      || lstatSync(file).size > 32768 || (lstatSync(file).mode & 0o222) !== 0) {
      throw new Error('Migration fixture proof must be a physical controller file.');
    }
    const bytes = readFileSync(file), proof = JSON.parse(bytes);
    if (hash(bytes) !== environment.FCOS_HOSTED_MIGRATION_PARENT_PROOF_SHA256
      || proof.kind !== 'fcos_disposable_migration_parent_proof_v1' || proof.schemaVersion !== 1
      || proof.projectId !== 'fcos' || proof.source?.controllerSha !== controllerSha
      || proof.source?.candidateSha !== candidateSha) throw new Error('Migration fixture source binding changed.');
    Object.assign(env, { FCOS_MIGRATION_PARENT_PROOF_SHA256: hash(bytes),
      FCOS_CONTROLLER_SHA: controllerSha, FCOS_CANDIDATE_SHA: candidateSha });
  }
  return env;
}

function expandArguments(args, candidateDirectory, controllerDirectory) {
  return args.flatMap(arg => {
    if (arg === 'tests/*.test.js' || arg === '@deterministic-tests') {
      const tests = readdirSync(join(candidateDirectory, 'tests')).filter(n => n.endsWith('.test.js') && (arg !== '@deterministic-tests' || !['hosted-release-coordinator-postgres.test.js','hosted-release-qualification.test.js','hosted-release-schema-observation.test.js'].includes(n))).sort().map(n => `tests/${n}`);
      if (!tests.length) throw new Error('The complete deterministic test suite is missing.');
      return tests;
    }
    if (arg === '@candidate') return candidateDirectory;
    if (arg.startsWith('@controller/')) return join(controllerDirectory, arg.slice(12));
    return arg;
  });
}

export async function runReleaseChecks({ candidateDirectory, controllerDirectory, controllerSha, expectedCandidateSha, sourceProfile,
  group, phase, checkIds, dependencyReports = [], cache = [], environment = process.env, run = spawnSync,
  now = () => new Date(), validateExternal, onRecord = () => {} } = {}) {
  const { manifest, manifestSha256 } = loadReleaseCheckManifest(controllerDirectory);
  const source = collectReleaseCheckSource(candidateDirectory);
  let runtime;
  if (environment.FCOS_HOSTED_CHECK_EXECUTION === '1') {
    const { inspectCandidateRuntime, isolatedCandidateRunner } = await import('./isolation.mjs');
    runtime = inspectCandidateRuntime({ image: environment.FCOS_HOSTED_CHECK_IMAGE });
    run = isolatedCandidateRunner({ image: environment.FCOS_HOSTED_CHECK_IMAGE, candidateDirectory, controllerDirectory });
  }
  const common = collectCheckBinding({ candidateDirectory, controllerDirectory, controllerSha, expectedCandidateSha, sourceProfile, manifest, manifestSha256, source, ...(runtime ? { runtime } : {}) });
  if (environment.FCOS_HOSTED_CHECK_EXECUTION === '1') {
    if (!/^[a-f0-9]{64}$/.test(environment.FCOS_HOSTED_BUILD_INPUTS_SHA256 || '')) throw new Error('Hosted build input binding is missing.');
    common.buildConfigurationSha256 = environment.FCOS_HOSTED_BUILD_INPUTS_SHA256;
  }
  const applicable = requiredReleaseChecks(manifest, sourceProfile);
  const selected = applicable.filter(c => (!group || c.group === group) && (!phase || c.phase === phase) && (!checkIds || checkIds.includes(c.id)));
  if (!selected.length || checkIds?.some(id => !selected.some(c => c.id === id))) throw new Error('No admitted checks match the requested selection.');
  const records = dependencyReports.flatMap(r => r.checks || []);
  const report = { schemaVersion: 2, kind: RELEASE_CHECK_REPORT_KIND, ...common, checks: [] };
  const home = mkdtempSync(join(tmpdir(), 'fcos-check-home-'));
  try {
    for (const check of selected) {
      let binding = checkBinding(check, common, source);
      const startedAt = now().toISOString();
      const required = check.requires.filter(id => applicable.some(c => c.id === id));
      const missing = required.filter(id => {
        const definition = applicable.find(c => c.id === id);
        return !records.some(e => evaluateCheckEvidence({ check: definition, binding: checkBinding(definition, common, source), evidence: e,
          now: now().getTime(), maximumAgeMs: manifest.volatileMaximumAgeMs, validateExternal }));
      });
      let record;
      if (missing.length) record = { schemaVersion: 2, checkId: check.id, binding, status: 'waiting_dependency', missing, startedAt, completedAt: now().toISOString(), commands: [] };
      else if (check.executor === 'controller') {
        record = records.find(e => evaluateCheckEvidence({ check, binding, evidence: e, now: now().getTime(), maximumAgeMs: manifest.volatileMaximumAgeMs, validateExternal }))
          || { schemaVersion: 2, checkId: check.id, binding, status: 'waiting_dependency', missing: [`trusted:${check.id}`], startedAt, completedAt: now().toISOString(), commands: [] };
      } else if (check.executor === 'aggregate') record = { schemaVersion: 2, checkId: check.id, binding, status: 'passed', startedAt, completedAt: now().toISOString(), commands: [] };
      else {
        const cached = check.kind === 'deterministic' && check.cacheable !== false && cache.find(e => evaluateCheckEvidence({ check, binding, evidence: e, now: now().getTime() }));
        if (cached) record = structuredClone(cached); // Preserve original source binding and timestamps verbatim.
        else {
          const commands = [];
          for (const command of check.profileCommands?.[sourceProfile] || check.commands) {
            const args = expandArguments(command.args, candidateDirectory, controllerDirectory);
            const result = await run(command.program === 'node' ? process.execPath : '/usr/bin/python3', args, {
              cwd: candidateDirectory, env: sanitisedCheckEnvironment({ environment, home, command, candidateDirectory, checkId: check.id,
                controllerDirectory, controllerSha, candidateSha: expectedCandidateSha }),
              shell: false, stdio: 'inherit', timeout: 60 * 60 * 1000,
            });
            commands.push({ program: command.program, args: command.args, exitCode: result?.status ?? 1 });
            if (collectReleaseCheckSource(candidateDirectory).sourceInputsSha256 !== source.sourceInputsSha256) throw new Error('Candidate execution modified admitted tracked inputs.');
            if (result?.status !== 0) break;
          }
          binding = checkBinding(check, common, source); // Bind produced artifacts after the command, never a missing pre-build directory.
          record = { schemaVersion: 2, checkId: check.id, binding, status: commands.length && commands.every(c => c.exitCode === 0) ? 'passed' : 'failed', startedAt, completedAt: now().toISOString(), commands };
        }
      }
      report.checks.push(record);
      records.push(record);
      await onRecord(record, report);
    }
  } finally { rmSync(home, { recursive: true, force: true }); }
  report.status = report.checks.some(c => c.status === 'failed') ? 'failed' : report.checks.some(c => c.status === 'waiting_dependency') ? 'waiting_dependency' : 'passed';
  return report;
}

export { hash as releaseCheckHash };
