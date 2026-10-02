import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FCOS_RELEASE_APPROVAL_POLICY, fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { PREVIEW_PARITY_POLICY } from '../scripts/lib/preview-parity.mjs';
import { FIRST_RUNTIME_ROLLOUT, COMPATIBILITY_ENVIRONMENT, COMPATIBILITY_WORKFLOW, COMPATIBILITY_ENABLE_VARIABLE,
  COMPATIBILITY_EXCEPTION, assertRuntimeCompatibilityProtection, assertRuntimeCompatibilityWorkflowIdentity,
  createRuntimeCompatibilityPreflight, compatibilityNormalCoverageVerified, compatibilityRuntimePreviewVerified,
  runtimeCompatibilityControlRevision, runtimeCompatibilityRequirements, executeRuntimeCompatibilityRelease,
  immutableCompatibilityBaseline, compatibilityUpstreamQuality, assertCompatibilityNormalArtifact,
  collectCompatibilityQualityEvidence, assertCompatibilityEvidenceReadback, compatibilityReadOnlyGuardsVerified,
  COMPATIBILITY_READ_ONLY_GUARDS } from '../scripts/lib/runtime-compatibility-release.mjs';
import { verifyRuntimeCompatibility } from '../scripts/verify-runtime-compatibility.mjs';
import { createReleaseReadiness, releaseHash } from '../scripts/lib/release-readiness.mjs';
import { runtimeCompatibilityReleaseArguments, runRuntimeCompatibilityRelease, collectCompatibilityBaselineRuntime } from '../scripts/runtime-compatibility-release.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const now = Date.now(), capturedAt = new Date(now).toISOString();
const repositoryName = fcosConnectionIdentifier('github', 'Repository');
const harnessSha = 'a'.repeat(40), digest = 'b'.repeat(64), url = 'https://fcos-abcdefghi-hocheunglai-6535s-projects.vercel.app';
const binding = { sha: FIRST_RUNTIME_ROLLOUT.candidateSha, harnessSha, sourceDigest: digest, lockHash: 'c'.repeat(64),
  configurationRevision: 'd'.repeat(64), candidateTreeHash: 'e'.repeat(64), candidateUrl: url };

function authorityInputs() {
  const repository = { id: 78, full_name: repositoryName, default_branch: 'main' };
  const operator = { id: 1, login: fcosConnectionIdentifier('github', 'Required account') };
  const pins = { [COMPATIBILITY_ENABLE_VARIABLE]: 'true', FCOS_COMPATIBILITY_REVIEWED_SHA: binding.sha,
    FCOS_COMPATIBILITY_REVIEWED_HARNESS_SHA: binding.harnessSha,
    FCOS_COMPATIBILITY_REVIEWED_SOURCE_SHA256: binding.sourceDigest, FCOS_COMPATIBILITY_REVIEWED_LOCK_SHA256: binding.lockHash,
    FCOS_COMPATIBILITY_REVIEWED_CONTROL_SHA256: binding.configurationRevision, FCOS_COMPATIBILITY_REVIEWED_TREE_SHA256: binding.candidateTreeHash,
    FCOS_COMPATIBILITY_PREVIOUS_DEPLOYMENT: FIRST_RUNTIME_ROLLOUT.previousDeploymentId,
    FCOS_COMPATIBILITY_PREVIOUS_SHA: FIRST_RUNTIME_ROLLOUT.previousSha, FCOS_COMPATIBILITY_PREVIOUS_URL: FIRST_RUNTIME_ROLLOUT.previousUrl,
    FCOS_COMPATIBILITY_REVIEWED_EXCEPTION: COMPATIBILITY_EXCEPTION, FCOS_RELEASE_VERCEL_TOKEN_ID: 'reviewed-team-token' };
  return { repository, branch: { name: 'main', protected: true, commit: { sha: harnessSha } },
    protection: { enforce_admins: { enabled: true }, required_status_checks: { strict: true,
      checks: FCOS_RELEASE_APPROVAL_POLICY.requiredChecks.map(context => ({ context, app_id: FCOS_RELEASE_APPROVAL_POLICY.statusCheckAppId })) } },
    environment: { id: 90, name: COMPATIBILITY_ENVIRONMENT, can_admins_bypass: false,
      protection_rules: [{ type: 'required_reviewers', prevent_self_review: false, reviewers: [{ type: 'User', reviewer: structuredClone(operator) }] }],
      deployment_branch_policy: { protected_branches: true, custom_branch_policies: false } },
    variables: { variables: Object.entries(pins).map(([name, value]) => ({ name, value })) },
    secrets: { secrets: ['FCOS_RELEASE_GH_TOKEN', 'FCOS_RELEASE_VERCEL_TOKEN', 'FCOS_RELEASE_RUNTIME_TOKEN', 'FCOS_RELEASE_PREVIEW_RUNTIME_TOKEN'].map(name => ({ name })) },
    run: { id: 99, repository, head_repository: repository, event: 'workflow_dispatch', head_branch: 'main', head_sha: harnessSha,
      path: COMPATIBILITY_WORKFLOW, status: 'in_progress', run_attempt: 1, run_started_at: capturedAt, actor: structuredClone(operator), triggering_actor: structuredClone(operator) },
    approvals: [{ state: 'approved', user: structuredClone(operator), environments: [{ id: 90, name: COMPATIBILITY_ENVIRONMENT }] }],
    oidcClaims: { iss: 'https://token.actions.githubusercontent.com', aud: 'fcos-production-release', repository: repositoryName, repository_id: '78',
      sub: `repo:${repositoryName}:environment:${COMPATIBILITY_ENVIRONMENT}`, workflow_ref: `${repositoryName}/${COMPATIBILITY_WORKFLOW}@refs/heads/main`,
      workflow_sha: harnessSha, sha: harnessSha, ref: 'refs/heads/main', run_id: '99', run_attempt: '1', event_name: 'workflow_dispatch', exp: now / 1000 + 300 }, binding: structuredClone(binding), now };
}

test('dedicated first-rollout authority accepts exact reviewed single-operator approval only', () => {
  assert.equal(assertRuntimeCompatibilityProtection(authorityInputs()).runId, 99);
  for (const alter of [
    x => { x.environment.can_admins_bypass = true; }, x => { delete x.environment.can_admins_bypass; },
    x => { x.environment.name = 'fcos-production-release'; }, x => { x.environment.protection_rules[0].prevent_self_review = true; },
    x => { x.environment.protection_rules[0].reviewers.push({ type: 'Team', reviewer: { id: 2 } }); },
    x => { x.environment.protection_rules.push(structuredClone(x.environment.protection_rules[0])); },
    x => { x.environment.protection_rules[0].reviewers[0].reviewer.login = 'wrong-account'; },
    x => { x.environment.deployment_branch_policy.protected_branches = false; },
    x => { x.protection.required_status_checks.strict = false; }, x => { x.protection.enforce_admins.enabled = false; },
    x => { x.protection.required_status_checks.checks[0].app_id = 1; }, x => { x.protection.required_status_checks.checks.pop(); },
    x => { x.branch.protected = false; }, x => { x.branch.commit.sha = 'f'.repeat(40); },
    x => { x.approvals = []; }, x => { x.approvals.push(structuredClone(x.approvals[0])); },
    x => { x.approvals[0].state = 'rejected'; }, x => { x.approvals[0].user.id = 2; },
    x => { x.approvals[0].environments[0].id = 91; }, x => { x.run.triggering_actor.login = 'wrong-account'; },
    x => { x.run.run_attempt = 2; }, x => { x.run.path = '.github/workflows/production-release.yml'; },
    x => { x.run.run_started_at = new Date(now - 1800001).toISOString(); }, x => { x.oidcClaims.run_id = '100'; },
    x => { x.oidcClaims.exp = now / 1000; }, x => { x.secrets.secrets.pop(); },
  ]) { const copy = structuredClone(authorityInputs()); alter(copy); assert.throws(() => assertRuntimeCompatibilityProtection(copy)); }
});

test('every exact environment pin including the sole proposed exception is mandatory and cannot be duplicated', () => {
  for (const { name } of authorityInputs().variables.variables) {
    const changed = authorityInputs(); changed.variables.variables.find(row => row.name === name).value = name === 'FCOS_RELEASE_VERCEL_TOKEN_ID' ? 'invalid token id' : 'unreviewed';
    assert.throws(() => assertRuntimeCompatibilityProtection(changed), name);
    const missing = authorityInputs(); missing.variables.variables = missing.variables.variables.filter(row => row.name !== name);
    assert.throws(() => assertRuntimeCompatibilityProtection(missing), name);
    const repeated = authorityInputs(); repeated.variables.variables.push(structuredClone(repeated.variables.variables.find(row => row.name === name)));
    assert.throws(() => assertRuntimeCompatibilityProtection(repeated), name);
  }
  const other = authorityInputs(); other.binding.sha = 'f'.repeat(40);
  assert.throws(() => assertRuntimeCompatibilityProtection(other));
});

test('standard Production OIDC, wrong repository and mutable branch identities cannot authorize this workflow', () => {
  const { oidcClaims, repository, branch } = authorityInputs();
  assert.equal(assertRuntimeCompatibilityWorkflowIdentity(oidcClaims, repository, branch), true);
  for (const changed of [
    { sub: `repo:${repositoryName}:environment:fcos-production-release` },
    { workflow_ref: `${repositoryName}/.github/workflows/production-release.yml@refs/heads/main` },
    { repository_id: '79' }, { repository: 'wrong/fcos' }, { workflow_sha: binding.sha },
    { ref: 'refs/heads/unprotected' }, { aud: 'wrong' }, { iss: 'https://wrong.example' },
  ]) assert.throws(() => assertRuntimeCompatibilityWorkflowIdentity({ ...oidcClaims, ...changed }, repository, branch));
});

function preflightInputs() {
  const candidate = { id: 'dpl_candidate', sha: binding.sha, url, target: 'preview', state: 'READY', sourceDigest: digest };
  const evidence = kind => ({ ...binding, deploymentId: candidate.id, kind, runId: 3, artifactId: 4,
    archiveDigest: digest, capturedAt, ...(kind === 'normal_role' ? { checks: PREVIEW_PARITY_POLICY.requiredModules.map(module => ({ module, role: 'finance',
      result: 'pass', kind: PREVIEW_PARITY_POLICY.workflowModules.includes(module) ? 'workflow_read' : 'read', evidenceId: `${module}-actual-data-read` })) } : {}) });
  const input = { binding: structuredClone(binding), scope: { schemaVersion: 1, receiptKind: 'fcos_runtime_compatibility_scope', scopeVerified: true, productionAuthorized: false, baseCommit: FIRST_RUNTIME_ROLLOUT.previousSha,
    candidateCommit: binding.sha, candidateTreeHash: binding.candidateTreeHash, readOnlyGuards: [...COMPATIBILITY_READ_ONLY_GUARDS],
    changes: [...COMPATIBILITY_READ_ONLY_GUARDS, 'api/_hedgeDeskReadOnly.js'].map(path => ({ path, before: path === 'api/_hedgeDeskReadOnly.js' ? null : '1'.repeat(40), after: '2'.repeat(40) })) },
    protection: { runId: 99, environmentId: 90, reviewerId: 1, approvalMode: 'single_operator', harnessSha },
    provider: { identityVerified: true, targetPin: 'verified', deploymentCreate: 'verified', projectId: fcosConnectionIdentifier('vercel', 'Project ID'), teamId: fcosConnectionIdentifier('vercel', 'Team ID') },
    previous: { id: FIRST_RUNTIME_ROLLOUT.previousDeploymentId, sha: FIRST_RUNTIME_ROLLOUT.previousSha, url: FIRST_RUNTIME_ROLLOUT.previousUrl, target: 'production', state: 'READY' }, candidate,
    quality: { ...evidence('quality'), result: 'success' }, trustedEvidence: [evidence('restricted_browser'), evidence('normal_role')],
    runtime: { deploymentId: candidate.id, sha: binding.sha, capturedAt,
      flags: Object.fromEntries(PREVIEW_PARITY_POLICY.runtimeFlags.map(key => [key, { state: 'known', value: false }])),
      safety: { readOnly: true, externalActions: Object.fromEntries(PREVIEW_PARITY_POLICY.externalActions.map(key => [key, false])) } },
    endpointAbsence: { deploymentId: FIRST_RUNTIME_ROLLOUT.previousDeploymentId, sha: FIRST_RUNTIME_ROLLOUT.previousSha, url: FIRST_RUNTIME_ROLLOUT.previousUrl,
      sourceAbsent: true, httpStatus: 404, capturedAt }, now };
  const source = { candidateHead: binding.sha, hashes: { application: digest, policy: digest, connections: digest, ciIdentity: digest }, switchInventory: { keys: [], sourceFiles: [], sourceHash: digest } };
  const cleanRecord = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['candidateTreeHash', 'checks'].includes(key)));
  const approvedCandidate = { ...candidate, lockHash: binding.lockHash, configurationRevision: binding.configurationRevision };
  input.parity = { schemaVersion: 1, policyVersion: 1, pass: true, blockers: [], classifiedKeys: [], unknowns: [], limitations: [], capturedAt,
    binding: { sha: binding.sha, sourceDigest: digest, lockHash: binding.lockHash, configurationRevision: binding.configurationRevision,
      deploymentId: candidate.id, candidateUrl: url, url }, source, candidate: approvedCandidate, production: input.previous,
    expectedRuntimeAuth: {}, expectedRuntimeFlags: input.runtime.flags, expectedRuntimeSafety: { ...input.runtime.safety, readOnly: false } };
  input.readiness = createReleaseReadiness({ source, candidate: approvedCandidate, production: input.previous, parity: input.parity,
    evidence: input.trustedEvidence.map(cleanRecord), quality: input.quality, lockHash: binding.lockHash, configurationRevision: binding.configurationRevision, now });
  return input;
}

test('complete independently bound evidence can be ready but never grants Production authority', () => {
  const result = createRuntimeCompatibilityPreflight({ ...preflightInputs(), ready: true, productionAuthorized: true, execute: true });
  assert.ok(Object.values(result.checks).every(value => value === true));
  assert.equal(result.ready, true); assert.equal(result.productionAuthorized, false); assert.equal(result.executorImplemented, true); assert.equal(result.mutations, 0);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.receiptKind, 'fcos_runtime_compatibility_preflight');
  assert.equal(result.proposedException.appliesOnlyTo, 'previous_runtime_endpoint');
  assert.equal(result.proposedException.runtimeValuesFabricated, false);
  const missingGuard = preflightInputs(); missingGuard.scope.readOnlyGuards.pop();
  const actualSource = createRuntimeCompatibilityPreflight(missingGuard);
  assert.equal(actualSource.ready, false); assert.equal(actualSource.productionAuthorized, false);
  assert.ok(actualSource.blockers.some(row => row.code === 'EXACT_READ_ONLY_GUARD_SCOPE_REQUIRED'));
});

test('coverage requires all real-data read modules and workflow reads; heading-only or partial evidence blocks', () => {
  const record = preflightInputs().trustedEvidence[1];
  assert.equal(compatibilityNormalCoverageVerified(record), true);
  for (const module of PREVIEW_PARITY_POLICY.requiredModules) {
    const copy = structuredClone(record); copy.checks = copy.checks.filter(row => row.module !== module);
    assert.equal(compatibilityNormalCoverageVerified(copy), false, module);
  }
  for (const alter of [x => { x.checks[0].kind = 'heading'; }, x => { x.checks[0].role = 'local_admin'; },
    x => { x.checks[0].evidenceId = ''; }, x => { x.checks.find(row => row.module === 'review').kind = 'read'; }]) {
    const copy = structuredClone(record); alter(copy); assert.equal(compatibilityNormalCoverageVerified(copy), false);
  }
  const partial = preflightInputs(); partial.trustedEvidence[1].checks = [{ module: 'dashboard', role: 'finance', kind: 'heading', result: 'pass', evidenceId: 'title-visible' }];
  assert.ok(createRuntimeCompatibilityPreflight(partial).blockers.some(row => row.code === 'REAL_NORMAL_UI_COVERAGE_REQUIRED'));
});

test('unknown or incomplete runtime safety never infers false, and complete Preview safety does not prove provider/baseline parity', () => {
  const { runtime, candidate } = preflightInputs();
  assert.equal(compatibilityRuntimePreviewVerified(runtime, candidate, now), true);
  for (const alter of [x => { x.safety.readOnly = null; }, x => { x.safety.externalActions = {}; },
    x => { delete x.safety.externalActions[PREVIEW_PARITY_POLICY.externalActions[0]]; },
    x => { x.safety.externalActions[PREVIEW_PARITY_POLICY.externalActions[0]] = true; },
    x => { x.flags[PREVIEW_PARITY_POLICY.runtimeFlags[0]] = { state: 'unknown' }; }, x => { x.sha = 'f'.repeat(40); },
    x => { x.capturedAt = new Date(now - 1800001).toISOString(); }]) {
    const copy = structuredClone(runtime); alter(copy); assert.equal(compatibilityRuntimePreviewVerified(copy, candidate, now), false);
  }
  const absentParity = preflightInputs(); delete absentParity.parity;
  assert.equal(createRuntimeCompatibilityPreflight(absentParity).ready, false);
});

test('mixed, expired and duplicated trusted evidence, wrong previous deployment and foreign candidate origins block', () => {
  for (const alter of [
    x => { x.previous.id = 'dpl_changed'; }, x => { x.previous.sha = 'f'.repeat(40); },
    x => { x.candidate.sourceDigest = 'f'.repeat(64); }, x => { x.binding.candidateUrl = 'https://foreign.example'; x.candidate.url = x.binding.candidateUrl; },
    x => { x.quality.lockHash = 'f'.repeat(64); }, x => { x.quality.capturedAt = new Date(now - 1800001).toISOString(); },
    x => { x.trustedEvidence[0].harnessSha = binding.sha; }, x => { x.trustedEvidence[1].sourceDigest = 'f'.repeat(64); },
    x => { x.trustedEvidence.push(structuredClone(x.trustedEvidence[0])); },
    x => { x.endpointAbsence.sourceAbsent = false; }, x => { x.endpointAbsence.httpStatus = 401; },
    x => { x.endpointAbsence.deploymentId = 'dpl_different'; },
  ]) { const copy = structuredClone(preflightInputs()); alter(copy); assert.ok(createRuntimeCompatibilityPreflight(copy).blockers.length > 0); }
});

test('contract makes only the exact previous endpoint absence a proposed exception and retains every staged requirement', () => {
  const requirements = runtimeCompatibilityRequirements();
  assert.deepEqual(requirements.filter(row => row.exceptionAllowed).map(row => row.id), ['previous_runtime_endpoint']);
  for (const id of ['environment', 'compiled_flags', 'runtime', 'normal_ui', 'restricted_ui', 'staged_production', 'domain_readback']) {
    assert.ok(requirements.find(row => row.id === id)?.mustProve.length);
  }
  assert.ok(requirements.find(row => row.id === 'staged_production').mustProve.some(value => value.includes('--prod --skip-domain')));
  assert.ok(requirements.find(row => row.id === 'domain_readback').mustProve.some(value => value.includes('without retry')));
  assert.ok(requirements.find(row => row.id === 'normal_ui').mustProve.some(value => value.includes('five-file guard') && value.includes('Email Router list/detail suppress metadata persistence')));
  assert.match(runtimeCompatibilityControlRevision(root, root), /^[0-9a-f]{64}$/);
});

test('CLI is inert by default, rejects broad bypasses and cannot execute with local flags or forged receipt files', async () => {
  const env = { FCOS_RUNTIME_COMPATIBILITY_RELEASE_ENABLED: 'true', FCOS_PRODUCTION_RELEASE_ENABLED: 'true', FCOS_RELEASE_FORCE: 'true',
    FCOS_RELEASE_READINESS_FILE: '/tmp/forged-ready.json', GH_TOKEN: 'private-secret-marker', VERCEL_TOKEN: 'private-secret-marker' };
  const result = await runRuntimeCompatibilityRelease({ env });
  assert.equal(result.ready, false); assert.equal(result.mutations, 0); assert.doesNotMatch(JSON.stringify(result), /private-secret-marker/);
  await assert.rejects(() => runRuntimeCompatibilityRelease({ mode: 'execute', env }));
  for (const args of [['--force'], ['--execute', '--preflight'], ['--token', 'private-secret-marker'], ['--evidence', '/tmp/forged-ready.json']]) {
    assert.throws(() => runtimeCompatibilityReleaseArguments(args, env));
  }
  const failedSource = await runRuntimeCompatibilityRelease({ mode: 'preflight', candidateCwd: '/missing-compatibility-source', expectedCommit: binding.sha, candidateUrl: url, env });
  assert.ok(failedSource.blockers.some(row => row.code === 'CLEAN_EXACT_SOURCE_COLLECTION_FAILED'));
  assert.doesNotMatch(JSON.stringify(failedSource), /private-secret-marker/);
  const cli = execFileSync(process.execPath, ['scripts/runtime-compatibility-release.mjs', '--dry-run'], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(JSON.parse(cli).ready, false);
});

test('dedicated workflow is disabled by default, defaults to preflight and uses static trusted commands', () => {
  const workflow = readFileSync(new URL('../.github/workflows/runtime-compatibility-release.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch:/); assert.match(workflow, /vars\.FCOS_RUNTIME_COMPATIBILITY_RELEASE_ENABLED == 'true'/);
  assert.match(workflow, /environment: fcos-runtime-compatibility-release/); assert.match(workflow, /group: fcos-production-release/);
  assert.match(workflow, /node trusted\/scripts\/runtime-compatibility-release\.mjs --preflight/);
  assert.match(workflow, /default: preflight/); assert.match(workflow, /inputs.operation == 'execute'/);
  assert.doesNotMatch(workflow, /vercel (?:deploy|promote|rollback|env)|working-directory: candidate|run:.*candidate\//);
  assert.doesNotMatch(workflow, /(?:contents|deployments|actions): write/);
  const script = readFileSync(new URL('../scripts/runtime-compatibility-release.mjs', import.meta.url), 'utf8');
  assert.match(script, /executeRuntimeCompatibilityRelease/);
  assert.doesNotMatch(script, /--force|cli\(\[['"](?:rollback|login)['"]/);
});

test('immutable baseline digest and pure-helper provenance match the exact retained source efficiently', () => {
  const proof = immutableCompatibilityBaseline({ cwd: root, trustedCwd: root });
  assert.equal(proof.sourceDigest, '9ce0445de15bff7992867e689328c1189b9c586a850149f5ad26384482f1b7f6');
  assert.equal(proof.sha, FIRST_RUNTIME_ROLLOUT.previousSha);
  assert.equal(proof.observationKind, 'independent_provider_probe_and_verified_deployment_configuration');
  const scope = verifyRuntimeCompatibility({ cwd: root, baseCommit: FIRST_RUNTIME_ROLLOUT.previousSha, candidateCommit: FIRST_RUNTIME_ROLLOUT.candidateSha });
  assert.equal(compatibilityReadOnlyGuardsVerified(scope), true);
  assert.equal(COMPATIBILITY_READ_ONLY_GUARDS.length, 5);
  assert.ok(COMPATIBILITY_READ_ONLY_GUARDS.includes('api/_emailRouterCore.js'));
  for (const alter of [x => { x.readOnlyGuards.pop(); }, x => { x.readOnlyGuards.push(x.readOnlyGuards[0]); },
    x => { x.changes = x.changes.filter(row => row.path !== 'api/_hedgeDeskReadOnly.js'); },
    x => { x.readOnlyGuards = x.readOnlyGuards.filter(path => path !== 'api/_emailRouterCore.js'); },
    x => { x.changes = x.changes.filter(row => row.path !== 'api/_emailRouterCore.js'); },
    x => { x.candidateCommit = 'f3d4cadfbaad7c25c83205350bb9be572493f47c'; },
    x => { x.candidateCommit = '33d97ea74439e27128fd148df78a1e6be6a2f844'; },
  ]) { const copy = structuredClone(scope); alter(copy); assert.equal(compatibilityReadOnlyGuardsVerified(copy), false); }
});

test('independent baseline uses only existing pinned provider GET sessions, leaves JWT-only Salesforce unknown and never patches legacy receipts', async () => {
  const deployment = preflightInputs().previous, tenant = '12345678-1234-1234-1234-123456789abc';
  const privateEnvironment = { VERCEL_ENV: 'production', SUPABASE_URL: `https://${fcosConnectionIdentifier('supabase', 'Project ref')}.supabase.co`, SUPABASE_SECRET_KEY: 'sb_secret_private_marker',
    SALESFORCE_INSTANCE_URL: 'https://fcbhk.my.salesforce.com', SALESFORCE_ACCESS_TOKEN: 'private-sf-marker', XERO_TENANT_ID: tenant,
    VARIABLE_CHARGE_PAIRED_WORKFLOW_ENABLED: 'true', FCOS_ENABLE_FCUNO_FEDERATION: 'true' };
  const sf = (await import('../config/fcosConnections.js')).fcosSalesforceEnvironment('production'); privateEnvironment.SALESFORCE_INSTANCE_URL = sf.instanceUrl;
  const baseline = { sha: FIRST_RUNTIME_ROLLOUT.previousSha, helperSourceVerified: true }, calls = [];
  const fetchImpl = async (endpoint, options) => {
    calls.push(endpoint); assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    return { ok: true, json: async () => endpoint.endsWith('/connections') ? [{ tenantId: tenant, tenantType: 'ORGANISATION' }]
      : endpoint.includes('/services/data/') ? { records: [{ Id: sf.orgId, IsSandbox: false }] } : [] };
  };
  const clientFactory = (url, key, options) => { assert.equal(url, privateEnvironment.SUPABASE_URL); assert.equal(options.auth.autoRefreshToken, false);
    return { from: name => { assert.equal(name, 'xero_contact_sync_connections'); return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { tenant_id: tenant, access_token: 'private-xero-marker', expires_at: new Date(now + 300000).toISOString() } }) }) }) }; } }; };
  const result = await collectCompatibilityBaselineRuntime({ deployment, privateEnvironment, baseline, fetchImpl, clientFactory, now });
  assert.equal(calls.length, 3); assert.equal(result.auth.salesforce.state, 'authenticated'); assert.equal(result.auth.xero.state, 'authenticated');
  assert.equal(result.flags.VARIABLE_CHARGE_PAIRED_WORKFLOW_ENABLED.value, true); assert.equal(result.safety.readOnly, false);
  assert.doesNotMatch(JSON.stringify(result), /private-.*marker/);
  const jwtOnly = { ...privateEnvironment, SALESFORCE_ACCESS_TOKEN: '', SALESFORCE_JWT_PRIVATE_KEY: 'private-jwt-marker' };
  const unavailable = await collectCompatibilityBaselineRuntime({ deployment, privateEnvironment: jwtOnly, baseline, fetchImpl, clientFactory, now });
  assert.equal(unavailable.auth.salesforce.state, 'unknown');
  await assert.rejects(() => collectCompatibilityBaselineRuntime({ deployment: { ...deployment, id: 'dpl_wrong' }, privateEnvironment, baseline, fetchImpl: () => assert.fail('no credential may be sent') }));
});

function stagedFixture(overrides = {}) {
  const input = preflightInputs(), preflight = createRuntimeCompatibilityPreflight(input), events = [];
  const previous = input.previous, staged = { id: 'dpl_staged', sha: binding.sha, target: 'production', state: 'READY', operationId: 'fcos-release-99' };
  let live = previous, approvals = 0;
  const options = { preflight, readiness: input.readiness, authority: async () => { approvals++; return { runId: 99, reviewerId: 1, environmentId: 90, approvalMode: 'single_operator' }; },
    journal: async row => events.push(row.phase), currentProduction: async () => live,
    deploy: async args => { events.push('deploy'); assert.ok(args.includes('--prod')); assert.ok(args.includes('--skip-domain')); return staged; },
    discover: async () => null, waitReady: async value => value, probe: async () => events.push('probe'),
    promote: async () => { events.push('promote'); live = staged; }, ...overrides };
  return { options, events, staged, approvals: () => approvals };
}

test('compatibility staging journals durable intent and probes before refreshed approval and domain assignment', async () => {
  const fixture = stagedFixture(), result = await executeRuntimeCompatibilityRelease(fixture.options);
  assert.equal(result.phase, 'complete'); assert.equal(fixture.approvals(), 2);
  assert.deepEqual(fixture.events, ['deploy_requested', 'deploy', 'staged_build', 'staged_ready', 'probe', 'promotion_requested', 'promote', 'probe', 'complete']);
  assert.equal(result.rollback.requiresHumanAuthorization, true);
});

test('missing credentials/evidence, wrong authority and changed previous Production prevent mutation; uncertain outcomes never retry', async () => {
  for (const alter of [x => { x.preflight.ready = false; }, x => { x.preflight.checks.vercel = false; }, x => { x.preflight.proposedException.endpointAbsenceObserved = false; },
    x => { x.preflight.capturedAt = new Date(now - 1800001).toISOString(); }, x => { x.readiness.candidate.sourceDigest = 'f'.repeat(64); }]) {
    const fixture = stagedFixture();
    alter(fixture.options); await assert.rejects(() => executeRuntimeCompatibilityRelease(fixture.options));
    assert.deepEqual(fixture.events, []);
  }
  const wrong = stagedFixture({ authority: async () => { throw Error('token or identity rejected'); } });
  await assert.rejects(() => executeRuntimeCompatibilityRelease(wrong.options)); assert.deepEqual(wrong.events, []);
  const changed = stagedFixture({ currentProduction: async () => ({ ...preflightInputs().previous, id: 'dpl_changed' }) });
  await assert.rejects(() => executeRuntimeCompatibilityRelease(changed.options), /Production changed/); assert.deepEqual(changed.events, []);
  let journalFailureCalls = 0;
  const journalFailure = stagedFixture({ journal: async () => { throw Error('disk flush failed'); }, deploy: async () => { journalFailureCalls++; } });
  await assert.rejects(() => executeRuntimeCompatibilityRelease(journalFailure.options)); assert.equal(journalFailureCalls, 0);
  let calls = 0;
  const uncertain = stagedFixture({ deploy: async () => { calls++; throw Error('timeout'); } });
  await assert.rejects(() => executeRuntimeCompatibilityRelease(uncertain.options), /uncertain/); assert.equal(calls, 1);
  assert.deepEqual(uncertain.events, ['deploy_requested', 'deploy_outcome_uncertain']);
  const failedProbe = stagedFixture({ probe: async () => { throw Error('provider auth unknown'); } });
  await assert.rejects(() => executeRuntimeCompatibilityRelease(failedProbe.options), /No domain assignment/); assert.ok(!failedProbe.events.includes('promote'));
});

test('stale approval-boundary readiness and changed evidence stop domains after a safely staged build', async () => {
  const expired = stagedFixture();
  expired.options.probe = async () => { expired.events.push('probe'); expired.options.preflight.capturedAt = new Date(now - 1800001).toISOString(); };
  await assert.rejects(() => executeRuntimeCompatibilityRelease(expired.options), /expired/);
  assert.ok(expired.events.includes('staged_ready')); assert.ok(!expired.events.includes('promote'));
  let approvals = 0;
  const rejected = stagedFixture({ authority: async () => { if (++approvals > 1) throw Error('Fresh auth or archive rejected'); return { runId: 99 }; } });
  await assert.rejects(() => executeRuntimeCompatibilityRelease(rejected.options), /archive rejected/);
  assert.ok(!rejected.events.includes('promote'));
});

test('uncertain promotion is read back once without retry and preserves the previous deployment for human rollback', async () => {
  let calls = 0;
  const fixture = stagedFixture({ promote: async () => { calls++; throw Error('transport timeout'); } });
  await assert.rejects(() => executeRuntimeCompatibilityRelease(fixture.options), /domain assignment was not confirmed/);
  assert.equal(calls, 1); assert.equal(fixture.events.at(-1), 'promotion_outcome_uncertain');
  const recovered = stagedFixture({ deploy: async () => { throw Error('transport timeout'); }, discover: async () => recovered.staged });
  assert.equal((await executeRuntimeCompatibilityRelease(recovered.options)).phase, 'complete');
});

function upstreamFixture() {
  const inputs = authorityInputs(), treeSha = execFileSync('git', ['rev-parse', `${binding.sha}^{tree}`], { cwd: root, encoding: 'utf8' }).trim();
  const run = { id: 7, repository: inputs.repository, head_repository: inputs.repository, event: 'pull_request', head_sha: binding.sha, head_branch: 'runtime-compatibility',
    path: '.github/workflows/quality.yml', status: 'completed', conclusion: 'success', updated_at: capturedAt, run_attempt: 1 };
  const jobs = FCOS_RELEASE_APPROVAL_POLICY.requiredChecks.map((name, index) => ({ id: index + 10, name, status: 'completed', conclusion: 'success', completed_at: capturedAt }));
  const state = { run, listing: { total_count: jobs.length, jobs }, tested: { sha: binding.sha, tree: { sha: treeSha } },
    log: `Run actions/checkout@v4\n[command]/usr/bin/git log -1 --format=%H\n2026-10-01T00:00:00Z ${binding.sha}\nRun actions/setup-node@v4\n` };
  const reads = { json: path => { if (path.endsWith('/actions/runs/7')) return state.run; if (path.includes('/attempts/1/jobs')) return state.listing;
    if (path.includes('/git/commits/')) return state.tested; throw Error('unexpected fixed read'); }, archive: () => Buffer.from(state.log) };
  return { state, reads };
}

test('protected compatibility quality requires all actual fresh jobs and the actual exact checkout tree', () => {
  const fixture = upstreamFixture();
  assert.equal(compatibilityUpstreamQuality({ reads: fixture.reads, cwd: root, runId: 7, binding, now }).testedSha, binding.sha);
  for (const alter of [x => { x.run.head_sha = 'f'.repeat(40); }, x => { x.run.head_repository = { full_name: 'fork/fcos' }; },
    x => { x.run.event = 'push'; }, x => { x.run.path = '.github/workflows/evil.yml'; }, x => { x.listing.jobs.pop(); x.listing.total_count--; },
    x => { x.listing.jobs[0].conclusion = 'failure'; }, x => { x.listing.jobs[0].completed_at = new Date(now - 1800001).toISOString(); },
    x => { x.listing.jobs.push({ ...x.listing.jobs[0] }); x.listing.total_count++; }, x => { x.tested.tree.sha = 'f'.repeat(40); },
    x => { x.log = 'tests printed a candidate SHA, but no checkout proof'; },
  ]) { const copy = upstreamFixture(); alter(copy.state); assert.throws(() => compatibilityUpstreamQuality({ reads: copy.reads, cwd: root, runId: 7, binding, now })); }
});

test('compatibility normal archive has its own origin and rejects standard-path, digest, source, baseline, harness and coverage forgery', () => {
  const inputs = authorityInputs(), archive = Buffer.from('dedicated-real-coverage-fixture'), candidate = preflightInputs().candidate;
  const run = { id: 8, repository: inputs.repository, head_repository: inputs.repository, head_branch: 'main', head_sha: harnessSha,
    path: '.github/workflows/runtime-compatibility-normal-role.yml', event: 'workflow_dispatch', conclusion: 'success', status: 'completed', updated_at: capturedAt };
  const artifact = { id: 9, name: `fcos-compatibility-normal-role-evidence-${binding.sha}`, expired: false,
    workflow_run: { id: 8, head_sha: harnessSha }, digest: `sha256:${releaseHash(archive)}` };
  const payload = { schemaVersion: 1, baseSha: FIRST_RUNTIME_ROLLOUT.previousSha, candidateSha: binding.sha, candidateUrl: url, deploymentId: candidate.id,
    sourceDigest: digest, harnessSha, capturedAt, checks: preflightInputs().trustedEvidence[1].checks };
  const data = { repository: inputs.repository, branch: inputs.branch, protection: inputs.protection, run, artifact, archive, payload,
    binding: { ...binding, deploymentId: candidate.id }, now };
  assert.equal(assertCompatibilityNormalArtifact(data).kind, 'normal_role');
  for (const altered of [{ run: { ...run, path: '.github/workflows/normal-role-release.yml' } }, { artifact: { ...artifact, digest: `sha256:${'f'.repeat(64)}` } },
    { payload: { ...payload, baseSha: 'f'.repeat(40) } }, { payload: { ...payload, sourceDigest: 'f'.repeat(64) } },
    { payload: { ...payload, harnessSha: binding.sha } }, { payload: { ...payload, checks: [] } }, { archive: Buffer.from('tampered') }]) assert.throws(() => assertCompatibilityNormalArtifact({ ...data, ...altered }));
});

function qualityArchiveFixture() {
  const upstream = upstreamFixture(), inputs = authorityInputs(), archive = Buffer.from('independent-protected-quality-archive-fixture');
  const run = { id: 8, repository: inputs.repository, head_repository: inputs.repository, head_branch: 'main', head_sha: harnessSha,
    path: COMPATIBILITY_WORKFLOW, event: 'workflow_dispatch', status: 'completed', conclusion: 'success', updated_at: capturedAt };
  const artifact = { id: 9, name: `fcos-compatibility-quality-source-${binding.sha}`, expired: false,
    workflow_run: { id: 8, head_sha: harnessSha }, digest: `sha256:${releaseHash(archive)}` };
  const payload = { schemaVersion: 1, baseSha: FIRST_RUNTIME_ROLLOUT.previousSha, candidateSha: binding.sha, sourceDigest: digest,
    lockSha256: binding.lockHash, harnessSha, capturedAt, ...compatibilityUpstreamQuality({ reads: upstream.reads, cwd: root, runId: 7, binding, now }) };
  const state = { run, artifact, payload, archive };
  const reads = { json: path => {
    if (path === `repos/${repositoryName}`) return inputs.repository;
    if (path.endsWith('/branches/main')) return inputs.branch;
    if (path.endsWith('/branches/main/protection')) return inputs.protection;
    if (path.includes('/workflows/runtime-compatibility-release.yml/runs?')) return { workflow_runs: [state.run] };
    if (path.endsWith('/actions/runs/8/artifacts?per_page=100')) return { artifacts: [state.artifact] };
    return upstream.reads.json(path);
  }, archive: path => path.endsWith('/artifacts/9/zip') ? state.archive : upstream.reads.archive(path) };
  return { state, upstream, options: { reads, cwd: root, binding, now, unpack: (bytes, filename) => { assert.equal(filename, 'fcos-quality-source.json'); return state.payload; } } };
}

test('quality archive rejects forged archive, source, lock, harness, upstream results and foreign origin independently', async () => {
  const valid = qualityArchiveFixture();
  assert.equal((await collectCompatibilityQualityEvidence(valid.options)).capturedAt, capturedAt);
  for (const alter of [x => { x.state.archive = Buffer.from('tampered archive'); }, x => { x.state.payload.sourceDigest = 'f'.repeat(64); },
    x => { x.state.payload.lockSha256 = 'f'.repeat(64); }, x => { x.state.payload.harnessSha = binding.sha; },
    x => { x.state.payload.baseSha = 'f'.repeat(40); }, x => { x.state.payload.jobsDigest = 'f'.repeat(64); },
    x => { x.state.run.event = 'push'; }, x => { x.state.run.head_repository = { full_name: 'fork/fcos' }; },
    x => { x.state.artifact.workflow_run.head_sha = binding.sha; }, x => { x.state.run.path = '.github/workflows/quality.yml'; },
    x => { x.state.payload.capturedAt = new Date(now - 1800001).toISOString(); },
    x => { x.upstream.state.listing.jobs[0].completed_at = new Date(now - 1800001).toISOString(); },
  ]) { const fixture = qualityArchiveFixture(); alter(fixture); await assert.rejects(() => collectCompatibilityQualityEvidence(fixture.options)); }
});

test('all evidence archives retain actual completion timestamps and exact binding at every boundary', () => {
  const input = preflightInputs(), original = { evidence: input.trustedEvidence, quality: input.quality };
  assert.equal(assertCompatibilityEvidenceReadback(original, structuredClone(original), now), true);
  for (const alter of [x => { x.evidence.pop(); }, x => { x.evidence.push(structuredClone(x.evidence[0])); },
    x => { x.evidence[0].archiveDigest = 'f'.repeat(64); }, x => { x.evidence[1].harnessSha = binding.sha; },
    x => { x.evidence[1].capturedAt = new Date(now + 1000).toISOString(); }, x => { x.evidence[1].checks = []; },
    x => { x.quality.archiveDigest = 'f'.repeat(64); }, x => { x.quality.capturedAt = new Date(now - 1800001).toISOString(); },
  ]) { const current = structuredClone(original); alter(current); assert.throws(() => assertCompatibilityEvidenceReadback(original, current, now)); }
  assert.throws(() => assertCompatibilityEvidenceReadback(original, original, now + 1800001));
  const source = readFileSync(new URL('../scripts/runtime-compatibility-release.mjs', import.meta.url), 'utf8');
  assert.match(source, /refreshPrerequisites = async/); assert.match(source, /refreshedSnapshots = await collectSnapshots/);
  assert.match(source, /compiledFlags\(origin/); assert.match(source, /assertCompatibilityEvidenceReadback/);
});
