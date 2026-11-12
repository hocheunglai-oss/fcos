import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_MODULE_INVENTORY, normalizeModuleInventory } from './modules.mjs';
import { FCOS_CONNECTION_POLICY, fcosConnectionIdentifier } from '../../../config/fcosConnections.js';

export const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
export const digest = value => createHash('sha256').update(Buffer.isBuffer(value) || typeof value === 'string' ? value : canonical(value)).digest('hex');
export const isSha = value => /^[a-f0-9]{40}$/.test(value || '');
export const isDigest = value => /^[a-f0-9]{64}$/.test(value || '');
export function requireCondition(value, code) { if (!value) throw Object.assign(new Error(code), { code }); }
export function targets() {
  return { repository: fcosConnectionIdentifier('github', 'Repository'),
    account: fcosConnectionIdentifier('github', 'Required account'),
    projectId: fcosConnectionIdentifier('vercel', 'Project ID'), teamId: fcosConnectionIdentifier('vercel', 'Team ID'),
    vercelAccount: fcosConnectionIdentifier('vercel', 'Account'), team: fcosConnectionIdentifier('vercel', 'Team'),
    origin: new URL(FCOS_CONNECTION_POLICY.attestation.endpoint).origin,
    supabaseProject: fcosConnectionIdentifier('supabase', 'Project ref') };
}
const generated = new Set(['public/app-version.json', 'api/_runtime-build-receipt.json']);
const privatePath = path => path.split('/').some(part => /^\.env(?:\.|$)/i.test(part)
  || /^(?:\.npmrc|\.netrc|credentials(?:\.json)?|id_(?:rsa|ed25519)|.*\.(?:pem|key|p12|pfx))$/i.test(part)
  || ['.fcos-cli', '.sf', '.sfdx', '.aws', '.ssh', '.vercel'].includes(part));
export const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
export function sourceSnapshot(directory) {
  requireCondition([`https://github.com/${targets().repository}`, `https://github.com/${targets().repository}.git`, `git@github.com:${targets().repository}.git`].includes(git(directory, ['remote', 'get-url', 'origin'])), 'SOURCE_REPOSITORY_MISMATCH');
  const sha = git(directory, ['rev-parse', 'HEAD']);
  requireCondition(isSha(sha), 'SOURCE_SHA_INVALID');
  const files = [];
  for (const entry of git(directory, ['ls-tree', '-r', '-z', 'HEAD']).split('\0').filter(Boolean)) {
    const [metadata, path] = entry.split('\t'); const [mode, type, oid] = metadata.split(' ');
    requireCondition(type === 'blob' && ['100644', '100755'].includes(mode) && !privatePath(path), 'SOURCE_PRIVATE_OR_NONREGULAR');
    if (generated.has(path)) continue;
    const absolute = join(directory, path), stat = lstatSync(absolute), bytes = readFileSync(absolute);
    requireCondition(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o111 ? '100755' : '100644') === mode
      && createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') === oid, 'SOURCE_BYTES_CHANGED');
    files.push({ path, mode, sha256: digest(bytes) });
  }
  requireCondition(!git(directory, ['status', '--porcelain', '--untracked-files=normal', '--', '.', ':!public/app-version.json', ':!api/_runtime-build-receipt.json']), 'SOURCE_NOT_CLEAN');
  return { sha, sourceDigest: digest(files), lockDigest: digest(readFileSync(join(directory, 'package-lock.json'))), files };
}
export function changedPaths(directory, baselineSha) {
  requireCondition(isSha(baselineSha), 'BASELINE_SHA_INVALID');
  return git(directory, ['diff', '--name-only', '-z', baselineSha, 'HEAD']).split('\0').filter(path => path && !generated.has(path));
}
const modulePaths = {
  dashboard: ['src/components/dashboard/', 'src/lib/dashboard', 'src/pages/Dashboard'], markets: ['src/components/markets/', 'src/hedge/views/Market', 'src/pages/Markets'],
  buyer_invoices: ['src/components/invoices/', 'src/pages/PaymentCollections'], xero_portal: ['src/components/xero/', 'src/pages/XeroPortal'],
  email_router: ['src/components/email/', 'src/pages/EmailRouter'], settings: ['src/pages/Settings'],
  admin: ['src/pages/AdminControl', 'src/pages/SettingsWorkspace'], review: ['src/pages/ReviewQueue', 'src/components/review/'],
  disputes: ['src/pages/DisputeWorkflow', 'src/components/disputes/'], unofficial_compensation: ['src/pages/UnofficialCompensation'],
  incoming_payments: ['src/pages/PaymentCollections'], cashflow_forecast: ['src/pages/CashflowForecast'], pnl: ['src/pages/StemPnlReport'],
  brokers: ['src/pages/BrokerWorkspace'], buyers_administrator: ['src/pages/AccountManagers'], master_contracts: ['src/pages/MasterContracts'],
  special_terms: ['src/pages/SpecialTerms', 'src/pages/SpecialTermEditor'], hedge_desk: ['src/pages/HedgeDesk', 'src/hedge/'],
};
export function selectChecks(paths, moduleInventory = DEFAULT_MODULE_INVENTORY) {
  const modules = new Set(), reasons = new Set(); let broad = false;
  for (const path of paths) {
    if (/^(?:force-app\/|manifest\/)/.test(path)) { reasons.add('salesforce'); broad = true; continue; }
    if (/^supabase\/migrations\//.test(path)) { reasons.add('database'); broad = true; continue; }
    if (/^(?:docs\/|README\.md$|AGENTS\.md$)/.test(path)) continue;
    if (/^(?:api\/|shared\/|config\/|\.github\/|\.codex\/|scripts\/|package(?:-lock)?\.json$|.*config\.[^/]+$|src\/lib\/|src\/api\/|src\/App\.|src\/pages\/(?:AdminControl|SettingsWorkspace))/.test(path)) { broad = true; reasons.add('shared_or_security'); }
    else {
      const matching = Object.entries(modulePaths).filter(([, prefixes]) => prefixes.some(prefix => path.startsWith(prefix)));
      if (!matching.length && !path.startsWith('tests/') && !path.startsWith('e2e/')) { broad = true; reasons.add('unclassified'); }
      matching.forEach(([module]) => modules.add(module));
    }
  }
  // All test/harness edits are broad: an edited test is not evidence for skipping a product regression.
  if (paths.some(path => /^(?:tests|e2e)\//.test(path))) { broad = true; reasons.add('test_contract'); }
  if (broad) normalizeModuleInventory(moduleInventory).forEach(module => modules.add(module.id));
  return { broad, modules: [...modules].sort(), reasons: [...reasons].sort(),
    salesforce: reasons.has('salesforce'), database: reasons.has('database'),
    checks: ['controls', 'lint', 'typecheck', broad ? 'product_tests' : 'affected_tests', 'migration_integrity', 'compatibility', 'graph_only',
      ...(broad ? ['fcuno_contract'] : []), 'build', 'performance', 'authenticated_smoke', 'restricted_access'],
    normalRole: broad || [...modules].some(module => !['dashboard','markets'].includes(module)) };
}
export const PUBLIC_BUILD_KEYS = Object.freeze(['VITE_FCOS_ENABLE_FCUNO_OIDC', 'FCOS_ENABLE_FCUNO_FEDERATION', 'FCUNO_IDENTITY_ISSUER',
  'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY']);
export function publicBuildEnvironment(values) {
  requireCondition(values && Object.getPrototypeOf(values) === Object.prototype, 'PUBLIC_BUILD_ENVIRONMENT_REQUIRED');
  for (const [key, value] of Object.entries(values)) requireCondition(PUBLIC_BUILD_KEYS.includes(key) && typeof value === 'string'
    && value.length <= 8192 && !/[\r\n\0]/.test(value), 'PRIVATE_BUILD_ENVIRONMENT_FORBIDDEN');
  requireCondition(values.VITE_SUPABASE_URL === `https://${targets().supabaseProject}.supabase.co`
    && Boolean(values.VITE_SUPABASE_PUBLISHABLE_KEY || values.VITE_SUPABASE_ANON_KEY), 'PUBLIC_BUILD_TARGET_MISMATCH');
  if (values.VITE_SUPABASE_PUBLISHABLE_KEY !== undefined) requireCondition(/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(values.VITE_SUPABASE_PUBLISHABLE_KEY), 'PUBLIC_SUPABASE_KEY_REQUIRED');
  if (values.VITE_SUPABASE_ANON_KEY !== undefined && !/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(values.VITE_SUPABASE_ANON_KEY)) {
    let payload;
    try {
      requireCondition(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(values.VITE_SUPABASE_ANON_KEY), 'PUBLIC_SUPABASE_KEY_REQUIRED');
      payload = JSON.parse(Buffer.from(values.VITE_SUPABASE_ANON_KEY.split('.')[1], 'base64url').toString('utf8'));
    } catch { throw Object.assign(new Error('PUBLIC_SUPABASE_KEY_REQUIRED'), { code: 'PUBLIC_SUPABASE_KEY_REQUIRED' }); }
    requireCondition(payload?.role === 'anon' && payload.ref === targets().supabaseProject && payload.iss === 'supabase'
      && Number.isSafeInteger(payload.exp) && payload.exp * 1000 > Date.now(), 'PUBLIC_SUPABASE_KEY_REQUIRED');
  }
  return Object.freeze({ ...values, VITE_SUPABASE_ANON_KEY: values.VITE_SUPABASE_ANON_KEY || values.VITE_SUPABASE_PUBLISHABLE_KEY });
}
export function requiresCompanyFxHistorySmoke(manifest) {
  return manifest.prerequisites?.adapter === 'company-fx-history' && manifest.prerequisites.plan?.historySmoke === true;
}

export function requiresSupplierBucketSmoke(manifest) {
  return manifest.prerequisites?.adapter === 'supplier-bucket-migrations';
}

export function requiresGroupedPetroleumSmoke(manifest) {
  return manifest.prerequisites?.adapter === 'grouped-petroleum-migration';
}

export function requiresTradingFxSmoke(manifest) {
  return manifest.prerequisites?.adapter === 'trading-fx-prerequisites';
}

export function createManifest({ candidate, controllerSha, previous, paths, publicEnvironment, releaseId, prerequisites = null, moduleInventory = DEFAULT_MODULE_INVENTORY, now = new Date().toISOString() }) {
  requireCondition(isSha(controllerSha) && isSha(candidate?.sha) && isDigest(candidate.sourceDigest) && isDigest(candidate.lockDigest), 'MANIFEST_SOURCE_INVALID');
  requireCondition(/^dpl_[A-Za-z0-9]+$/.test(previous?.deploymentId || '') && isSha(previous.sha)
    && isDigest(previous.configurationDigest) && isDigest(previous.schemaDigest), 'BASELINE_EVIDENCE_REQUIRED');
  requireCondition(/^[a-z0-9][a-z0-9-]{7,95}$/.test(releaseId || ''), 'RELEASE_ID_INVALID');
  const buildEnvironment = publicBuildEnvironment(publicEnvironment), modules = normalizeModuleInventory(moduleInventory), selection = selectChecks(paths, modules);
  if (prerequisites !== null) requireCondition((selection.salesforce || selection.database)
    && /^[a-z][a-z0-9-]{3,64}$/.test(prerequisites.adapter || '') && isDigest(prerequisites.adapterDigest)
    && prerequisites.plan && Object.getPrototypeOf(prerequisites.plan) === Object.prototype, 'PREREQUISITE_DESCRIPTOR_INVALID');
  if (requiresTradingFxSmoke({ prerequisites })) {
    const { xeroQualificationDeploymentId, xeroQualificationDigest } = prerequisites.plan;
    requireCondition(selection.salesforce && selection.database && Number.isSafeInteger(xeroQualificationDeploymentId)
      && xeroQualificationDeploymentId > 0 && isDigest(xeroQualificationDigest), 'TRADING_FX_XERO_QUALIFICATION_LOCATOR_REQUIRED');
  }
  const buildId = digest({ sha: candidate.sha, sourceDigest: candidate.sourceDigest, lockDigest: candidate.lockDigest,
    node: process.version, publicEnvironment: buildEnvironment });
  return { schemaVersion: 1, contract: 'fcos-rapid-release/v1', releaseId, createdAt: now, targets: targets(),
    candidate: { sha: candidate.sha, sourceDigest: candidate.sourceDigest, lockDigest: candidate.lockDigest }, controllerSha,
    previous, paths, moduleInventory: modules, selection, prerequisites, build: { buildId, node: process.version, publicEnvironment: buildEnvironment },
    authorization: { actions: ['prerequisites', 'promote', 'verify', 'compatible_rollback'], lifetimeSeconds: 86400, financialAuthority: false } };
}
export function validateManifest(manifest) {
  requireCondition(manifest?.contract === 'fcos-rapid-release/v1' && manifest.schemaVersion === 1 && canonical(manifest.targets) === canonical(targets()), 'MANIFEST_TARGET_INVALID');
  const recreated = createManifest({ candidate: manifest.candidate, controllerSha: manifest.controllerSha, previous: manifest.previous,
    paths: manifest.paths, publicEnvironment: manifest.build?.publicEnvironment, releaseId: manifest.releaseId, prerequisites: manifest.prerequisites, moduleInventory: manifest.moduleInventory, now: manifest.createdAt });
  requireCondition(canonical(recreated) === canonical(manifest), 'MANIFEST_CHANGED');
  return digest(manifest);
}
export function assertAuthorization(receipt, manifest, staged, now = Date.now()) {
  const manifestHash = validateManifest(manifest);
  requireCondition(receipt?.manifestHash === manifestHash && receipt.candidateSha === manifest.candidate.sha
    && receipt.buildId === manifest.build.buildId && receipt.deploymentId === staged.id
    && receipt.previousDeploymentId === manifest.previous.deploymentId && receipt.environment === 'fcos-production-release'
    && receipt.reviewer === targets().account && receipt.nativeReviewVerified === true
    && Number.isSafeInteger(receipt.runId) && receipt.runId > 0 && Number.isFinite(Date.parse(receipt.approvedAt))
    && Date.parse(receipt.approvedAt) <= now && now - Date.parse(receipt.approvedAt) <= 86400000, 'EXACT_PRODUCTION_AUTHORIZATION_REQUIRED');
  return receipt;
}
