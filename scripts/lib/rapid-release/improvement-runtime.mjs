import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { constants, lstat, mkdir, open, readFile, readdir, realpath, rename } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MODULE_READERS } from './normal-role-readers.mjs';
import { FCOS_CONNECTION_POLICY, fcosConnectionIdentifier } from '../../../config/fcosConnections.js';

const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const digest = value => createHash('sha256').update(Buffer.isBuffer(value) || typeof value === 'string' ? value : canonical(value)).digest('hex');
const need = (value, code) => { if (!value) throw Object.assign(new Error(code), { code }); };
const ownedCodes = Object.freeze({
  QUALITY_DEPENDENCIES_FAILED: 'build_failure', QUALITY_CONTROLS_FAILED: 'test_failure', QUALITY_LINT_FAILED: 'test_failure',
  QUALITY_TYPECHECK_FAILED: 'test_failure', QUALITY_TESTS_FAILED: 'test_failure', QUALITY_BUILD_FAILED: 'build_failure',
  QUALITY_PERFORMANCE_FAILED: 'test_failure', QUALITY_MIGRATION_INTEGRITY_FAILED: 'test_failure',
  QUALITY_COMPATIBILITY_FAILED: 'test_failure', QUALITY_GRAPH_ONLY_FAILED: 'test_failure', QUALITY_FCUNO_CONTRACT_FAILED: 'test_failure',
  SOURCE_BYTES_CHANGED: 'source_mismatch', SOURCE_NOT_CLEAN: 'source_mismatch', MANIFEST_CHANGED: 'source_mismatch',
  SOURCE_SHA_INVALID: 'source_mismatch', BUILD_RECEIPT_MISMATCH: 'stale_evidence', STAGED_BUILD_NOT_READY: 'stale_evidence',
  SMOKE_BROWSER_BASELINE_DASHBOARD_FAILED: 'test_failure', SMOKE_BROWSER_BASELINE_MARKETS_FAILED: 'test_failure',
  SMOKE_BROWSER_ISSUER_NAVIGATION_FAILED: 'test_failure', SMOKE_BROWSER_SIGN_IN_FAILED: 'test_failure',
  SMOKE_BROWSER_NORMAL_MODULE_READS_FAILED: 'test_failure', SMOKE_BROWSER_RESTRICTED_ACCESS_FAILED: 'test_failure',
  SMOKE_BROWSER_NETWORK_OR_RUNTIME_FAILURE: 'test_failure', SMOKE_CANDIDATE_NAVIGATION_CHANGED: 'test_failure',
  SMOKE_MODULE_DESKTOP_CONTENT_MISSING: 'test_failure', SMOKE_MODULE_DESKTOP_HEADING_MISSING: 'test_failure',
  SMOKE_MODULE_DESKTOP_INCOMPLETE: 'test_failure', SMOKE_MODULE_PAYLOAD_INCOMPLETE: 'test_failure',
  SMOKE_MODULE_READ_FAILED: 'test_failure', SMOKE_AUTHENTICATED_READ_FAILED: 'test_failure', SMOKE_MODULE_SURFACE_FAILED: 'test_failure',
  SMOKE_LOGIN_NOT_PROVEN: 'test_failure', SMOKE_RESTRICTED_ACCESS_NOT_PROVEN: 'test_failure',
  SMOKE_NORMAL_MUTATION_NOT_DENIED: 'test_failure', SMOKE_NORMAL_READS_NOT_BOUND: 'test_failure',
  SMOKE_BOUND_READ_FAILED: 'test_failure', SMOKE_PROTECTION_BOOTSTRAP_FAILED: 'test_failure',
  SMOKE_AUTHORIZATION_IDENTITY_MISMATCH: 'test_failure', SMOKE_CI_SCOPE_MISMATCH: 'test_failure',
  SMOKE_DEPLOYMENT_BINDING_MISMATCH: 'stale_evidence', SMOKE_STATIC_RUNTIME_IDENTITY_MISMATCH: 'stale_evidence',
  SMOKE_RUNTIME_IDENTITY_MISMATCH: 'stale_evidence', STAGED_SMOKE_INCOMPLETE: 'test_failure', QUALITY_CHECK_FAILED: 'test_failure',
  QUALITY_FAILED: 'test_failure', PRODUCT_TESTS_FAILED: 'test_failure', BUILD_FAILED: 'build_failure',
  VERCEL_REQUEST_REFUSED: 'provider_unavailable', GITHUB_REQUEST_REFUSED: 'provider_unavailable',
  ORIGINAL_OPERATION_READBACK_REQUIRED: 'write_uncertain', PROVIDER_OUTCOME_UNCERTAIN: 'write_uncertain',
  PROVIDER_ACKNOWLEDGEMENT_MISSING: 'write_uncertain', DEPLOYMENT_ACK_UNCERTAIN: 'write_uncertain', JOURNAL_WRITE_UNCERTAIN: 'write_uncertain',
  PRIOR_OPERATION_FAILED: 'known_job_failed', EXACT_PRODUCTION_AUTHORIZATION_REQUIRED: 'authorization_required',
  NATIVE_PRODUCTION_REVIEW_REQUIRED: 'authorization_required', GOVERNED_CI_CREDENTIALS_MISSING: 'credential_entry_required',
  NORMAL_ROLE_COVERAGE_MISSING: 'credential_entry_required', PHASE_PERFORMANCE_BUDGET_EXCEEDED: 'slow_phase',
});
const steps = new Set(['controls', 'lint', 'typecheck', 'product_tests', 'affected_tests', 'build', 'performance',
  'authenticated_smoke', 'restricted_access', 'quality', 'stage', 'smoke', 'prerequisites', 'promote', 'live', 'rollback']);
const safePhase = value => /^[a-z][a-z0-9_.-]{0,80}$/.test(value || '') ? value : 'unknown';
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const elapsed = value => Number.isFinite(value) && value >= 0 ? value : 0;

export async function releaseObstacleInputs({ manifest, controllerDirectory }) {
  const root = await realpath(controllerDirectory);
  const directory = join(root, 'scripts/lib/rapid-release');
  const files = (await readdir(directory)).filter(name => /\.(?:mjs|js)$/.test(name)).sort();
  const code = [];
  for (const name of files) {
    const path = join(directory, name), stat = await lstat(path);
    need(stat.isFile() && !stat.isSymbolicLink(), 'IMPROVEMENT_EXECUTOR_SOURCE_INVALID');
    code.push({ path: `scripts/lib/rapid-release/${name}`, digest: digest(await readFile(path)) });
  }
  for (const name of ['scripts/rapid-release.mjs', 'scripts/rapid-release-artifact.mjs']) {
    try { code.push({ path: name, digest: digest(await readFile(join(root, name))) }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  need(code.length > 0 && manifest?.targets?.repository === fcosConnectionIdentifier('github', 'Repository')
    && manifest.targets.projectId === fcosConnectionIdentifier('vercel', 'Project ID')
    && manifest.targets.teamId === fcosConnectionIdentifier('vercel', 'Team ID')
    && manifest.targets.origin === new URL(FCOS_CONNECTION_POLICY.attestation.endpoint).origin, 'IMPROVEMENT_TARGET_MISMATCH');
  // Release IDs/timestamps are execution identity, not source preconditions. Native
  // readback below still binds each original operation to its complete manifest.
  return { source: digest({ candidate: manifest.candidate, paths: manifest.paths, selection: manifest.selection,
    prerequisites: manifest.prerequisites || null }), controller: digest(code), environment: digest({ targets: manifest.targets, publicConfiguration: manifest.build?.publicEnvironment || {} }),
    tools: digest({ node: process.version,
      cliPins: FCOS_CONNECTION_POLICY.providers.map(provider => ({ provider: provider.id, version: provider.cliVersion })) }) };
}

async function privateStore(path) {
  need(isAbsolute(path), 'IMPROVEMENT_PRIVATE_OUTPUT_REQUIRED');
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const parent = await lstat(dirname(path));
  need(parent.isDirectory() && !parent.isSymbolicLink() && (typeof parent.uid !== 'number' || parent.uid === process.getuid()), 'IMPROVEMENT_PRIVATE_DIRECTORY_INVALID');
  let state = { schemaVersion: 1, records: [] };
  try {
    const stat = await lstat(path);
    need(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0, 'IMPROVEMENT_PRIVATE_FILE_INVALID');
    state = JSON.parse(await readFile(path, 'utf8'));
    need(state.schemaVersion === 1 && Array.isArray(state.records), 'IMPROVEMENT_PRIVATE_FILE_INVALID');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const save = async () => {
    const temporary = `${path}.${randomUUID()}.tmp`;
    const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(`${canonical(state)}\n`); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path);
  };
  return { state, save };
}
function nativeResult(result, { manifest, manifestHash, phase, pending }) {
  const request = pending.data.request;
  need(result && /^dpl_[A-Za-z0-9]+$/.test(result.id || '') && result.target === 'production'
    && ['READY', 'BUILDING', 'INITIALIZING', 'QUEUED', 'ERROR', 'CANCELED'].includes(result.state)
    && result.buildId === manifest.build.buildId && result.sha === manifest.candidate.sha && result.manifestHash === manifestHash, 'ORIGINAL_READBACK_BINDING_UNVERIFIED');
  if (phase === 'stage') need(result.operationId === pending.data.operationId && result.artifactDigest === request.artifactDigest
    && /^[a-f0-9]{64}$/.test(request.artifactDigest || '') && request.buildId === manifest.build.buildId && request.candidateSha === manifest.candidate.sha, 'ORIGINAL_READBACK_BINDING_UNVERIFIED');
  else if (phase === 'promote') need(result.id === request.deploymentId && request.buildId === manifest.build.buildId
    && result.operationId === `${manifest.releaseId}-stage`, 'ORIGINAL_READBACK_BINDING_UNVERIFIED');
  else need(false, 'ORIGINAL_READBACK_BINDING_UNVERIFIED');
  const url = new URL(result.url);
  need(url.protocol === 'https:' && !url.username && !url.password && !url.port && url.pathname === '/' && !url.search && !url.hash
    && new RegExp(`^fcos-[a-z0-9]{9}-${fcosConnectionIdentifier('vercel', 'Team').replaceAll('.', '\\.')}\\.vercel\\.app$`).test(url.hostname), 'ORIGINAL_READBACK_BINDING_UNVERIFIED');
  return Object.fromEntries(['id', 'url', 'target', 'state', 'buildId', 'sha', 'artifactDigest', 'operationId', 'manifestHash']
    .filter(key => result[key] !== undefined).map(key => [key, result[key]]));
}

export async function handleReleaseObstacle({ error, phase, manifest, journal, provider, controllerDirectory, registry,
  outputFile, completedSteps = [], elapsedMs = 0, providerCalls = 0 }) {
  const module = await import(pathToFileURL(join(controllerDirectory, 'scripts/lib/rapid-release/learning.mjs')).href);
  const code = Object.hasOwn(ownedCodes, error?.code) ? error.code : 'UNCLASSIFIED_RELEASE_OBSTACLE';
  const inputs = await releaseObstacleInputs({ manifest, controllerDirectory });
  if (code.startsWith('SMOKE_') && Object.hasOwn(MODULE_READERS, error?.smokeModule)
    && ['read', 'desktop'].includes(error.smokeSurface)) {
    Object.assign(inputs, { smokeModule: error.smokeModule, smokeSurface: error.smokeSurface });
  }
  const incident = module.obstacle({ kind: ownedCodes[code] || 'unknown', phase: safePhase(phase), code,
    inputs, completedSteps: completedSteps.filter(step => steps.has(step)),
    elapsedMs: elapsed(elapsedMs), providerCalls: count(providerCalls) });
  const local = await privateStore(outputFile || join(controllerDirectory, 'outputs/rapid-release-obstacles/obstacles.json'));
  const capture = async (event, data) => {
    // Only locally constructed, sanitized event data crosses either boundary.
    local.state.records.push({ payload: { event, data } }); await local.save();
  };
  if (!local.state.records.some(record => record.payload.event === 'obstacle.detected' && record.payload.data.signature === incident.signature))
    await capture('obstacle.detected', incident);
  const adapter = journal || { read: async () => local.state.records, append: capture };
  const manifestHash = digest(manifest), metrics = { providerCalls: 0, providerCallUnit: 'provider_method_invocations', checks: [], elapsedMs: 0 };
  const trusted = registry?.trustedHandlers || {};
  const actions = { ...Object.fromEntries(Object.entries(trusted).filter(([, action]) => typeof action === 'function').map(([name, action]) => [name, async context => {
    const proof = await action(context);
    return Object.fromEntries(['regressionPassed', 'reproduced', 'sourceDigest', 'checkDigest', 'originalOperationsPreserved', 'authorityExpanded'].map(key => [key, proof?.[key]]));
  }])),
    reconcile_original_operation: async () => {
      need(journal && provider && typeof provider.discover === 'function', 'ORIGINAL_READBACK_PROVIDER_REQUIRED');
      const started = Date.now();
      const records = (await journal.read()).map(record => record.payload);
      const pending = records.filter(record => record.event === `${phase}.intent`
        && !records.some(result => result.event === `${phase}.result` && result.data.operationId === record.data.operationId)).at(-1);
      need(pending && pending.data.operationId === `${manifest.releaseId}-${phase}` && pending.data.requestHash === digest(pending.data.request), 'ORIGINAL_OPERATION_INTENT_REQUIRED');
      metrics.providerCalls++;
      await provider.assertOwnership({ phase, manifest, manifestHash });
      metrics.checks.push('original_intent_preserved', 'provider_ownership_verified');
      metrics.providerCalls++;
      const observed = await provider.discover({ phase, operationId: pending.data.operationId, manifestHash, request: pending.data.request });
      metrics.elapsedMs = Date.now() - started;
      if (observed?.outcome !== 'applied') return { unresolved: true, measurement: { repairElapsedMs: metrics.elapsedMs, providerMethodCalls: metrics.providerCalls } };
      const result = nativeResult(observed.result, { manifest, manifestHash, phase, pending });
      metrics.checks.push('native_manifest_build_operation_match');
      // Fresh chain read prevents replacing another operation's verified result.
      const latest = (await journal.read()).map(record => record.payload);
      need(!latest.some(record => record.event === `${phase}.result`), 'ORIGINAL_OPERATION_ALREADY_RECORDED');
      await journal.append(`${phase}.result`, { operationId: pending.data.operationId, outcome: 'applied', result });
      metrics.checks.push('original_result_recorded');
      return { regressionPassed: true, reproduced: true, sourceDigest: incident.inputs.source,
        checkDigest: digest({ manifestHash, operationId: pending.data.operationId, result, checks: metrics.checks }),
        originalOperationsPreserved: true, authorityExpanded: false, checks: metrics.checks, originalOperationId: pending.data.operationId,
        measurement: { repairElapsedMs: metrics.elapsedMs, providerMethodCalls: metrics.providerCalls }, recoveredDeploymentId: result.id };
    } };
  const effectiveRegistry = { schemaVersion: 1, recipes: (registry?.recipes || []).filter(recipe => recipe.action === 'reconcile_original_operation'
    || recipe.deterministic === true && typeof trusted[recipe.action] === 'function' && typeof registry?.authority === 'function') };
  const loop = new module.ImprovementLoop({ journal: adapter, registry: effectiveRegistry, actions });
  let result; const recoveryStarted = Date.now();
  try { result = await loop.handle(incident, { approach: 'event-driven-recovery', authority: async context => {
    const action = context.recipe.action;
    if (action === 'reconcile_original_operation') {
      need(journal && typeof provider?.assertOwnership === 'function', 'ORIGINAL_READBACK_PROVIDER_REQUIRED');
      return;
    }
    need(typeof registry?.authority === 'function', 'TRUSTED_REPAIR_AUTHORITY_REQUIRED');
    if (provider) await provider.assertOwnership({ phase, manifest, manifestHash });
    await registry.authority(context);
  } }); } catch { result = { state: 'supervisor_diagnosis', checkpointPreserved: true, reason: 'trusted_recovery_not_verified' }; }
  metrics.elapsedMs = Date.now() - recoveryStarted;
  if (['resume_checkpoint', 'already_verified'].includes(result.state)
    && (result.state === 'already_verified' ? result.proof?.proof : result.proof)?.originalOperationId === undefined) {
    result = { state: 'supervisor_diagnosis', checkpointPreserved: true, verifiedRepair: result, newCandidateRequired: true };
  }
  // Reconciliation measurements describe observed work, never speculative savings.
  const verified = result.state === 'resume_checkpoint' || result.state === 'already_verified';
  return { ...result, incident, metrics, checkpoint: { releaseId: manifest.releaseId, manifestHash,
    completedSteps: incident.completedSteps, originalEvidencePreserved: true },
    ...(verified ? {} : { workRequest: { type: 'supervisor_work_request', kind: incident.kind, phase: incident.phase,
      code: incident.code, inputs: incident.inputs, nextAction: incident.kind === 'write_uncertain' ? 'reconcile_original_operation' : 'focused_diagnosis',
      sourceChangesRequireNewCandidate: true, noAutomaticResubmission: true } }),
    measuredSavings: null };
}

/** Persist reviewed deterministic knowledge in another isolated checkout only. */
export async function recordVerifiedLearning({ registryFile, controllerDirectory, recipe, incident, proof, authority }) {
  const path = join(await realpath(dirname(resolve(registryFile))), basename(registryFile)), root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dirname(path), encoding: 'utf8' }).trim();
  need(await realpath(root) !== await realpath(controllerDirectory) && !relative(root, path).startsWith('..')
    && (await lstat(join(root, '.git'))).isFile(), 'LEARNING_REQUIRES_SEPARATE_ISOLATED_WORKTREE');
  execFileSync('git', ['ls-files', '--error-unmatch', '--', relative(root, path)], { cwd: root, stdio: 'pipe' });
  need(typeof authority === 'function', 'TRUSTED_LEARNING_AUTHORITY_REQUIRED');
  const module = await import(pathToFileURL(join(controllerDirectory, 'scripts/lib/rapid-release/learning.mjs')).href);
  module.validateRecipe(recipe);
  need(recipe.status === 'verified' && recipe.kind === incident.kind && proof?.reproduced === true && proof.regressionPassed === true && proof.originalOperationsPreserved === true
    && proof.authorityExpanded === false && proof.sourceDigest === incident.inputs.source && /^[a-f0-9]{64}$/.test(proof.checkDigest || '')
    && canonical(recipe.preconditions) === canonical(incident.inputs) && recipe.proof.sourceDigest === proof.sourceDigest
    && recipe.proof.checkDigest === proof.checkDigest, 'LEARNING_VERIFIED_REPRODUCTION_REQUIRED');
  need(recipe.action === 'reconcile_original_operation' || recipe.deterministic === true, 'LEARNING_DETERMINISTIC_ACTION_REQUIRED');
  await authority({ action: 'record_verified_learning', incident, recipe });
  const stored = JSON.parse(await readFile(path, 'utf8'));
  need(stored.schemaVersion === 1 && Array.isArray(stored.recipes) && !stored.recipes.some(item => item.id === recipe.id), 'LEARNING_REGISTRY_CONFLICT');
  // No functions, logs, provider payloads, arbitrary patches or raw proof fields.
  const saved = { schemaVersion: 1, id: recipe.id, kind: recipe.kind, action: recipe.action, status: 'verified', deterministic: true,
    preconditions: incident.inputs, proof: { reproduced: true, regressionPassed: true, sourceDigest: proof.sourceDigest, checkDigest: proof.checkDigest } };
  stored.recipes.push(saved);
  need((await lstat(path)).isFile() && !(await lstat(path)).isSymbolicLink(), 'LEARNING_REGISTRY_PATH_INVALID');
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(`${JSON.stringify(stored, null, 2)}\n`); await file.sync(); } finally { await file.close(); }
  await rename(temporary, path);
  return { recorded: true, recipeId: saved.id, registryDigest: digest(stored), inputs: incident.inputs };
}
