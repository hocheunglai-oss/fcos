import { assertParityConnectionReadAccess } from '../scripts/collect-preview-parity.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createReleaseReadiness, assertReleaseReceiptBinding, releaseHash } from '../scripts/lib/release-readiness.mjs';
import { assertTrustedArtifact, assertProductionProtection, assertReleaseGitHubAccount, assertReleaseWorkflowIdentity, RELEASE_REPOSITORY, PRODUCTION_ENVIRONMENT, PRODUCTION_WORKFLOW } from '../scripts/lib/release-evidence.mjs';
import { githubReleaseOidc, productionDeployArguments, assertVercelProductionAuthority, assertProductionRuntimeReadback, executeProductionRelease, readVercelTokenMetadata } from '../scripts/lib/release-production.mjs';
import { FCOS_RELEASE_APPROVAL_POLICY } from '../config/fcosConnections.js';
import { PREVIEW_PARITY_POLICY } from '../scripts/lib/preview-parity.mjs';
import { collectRuntimeObservation } from '../scripts/collect-preview-parity.mjs';
import { runProductionRelease, productionReleaseArguments } from '../scripts/production-release.mjs';
import { assertNormalRoleIdentity, normalRoleRequestAllowed, normalModuleDataLoaded, NORMAL_ROLE_MODULES } from '../scripts/normal-role-release.mjs';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';

const now = Date.parse('2026-10-01T00:00:00Z'), capturedAt = new Date(now).toISOString();
const sha = 'a'.repeat(40), digest = 'b'.repeat(64), lockHash = 'c'.repeat(64), configurationRevision = 'd'.repeat(64), harness = 'e'.repeat(40);
const url = 'https://fcos-a1b2c3d4e-hocheunglai-6535s-projects.vercel.app';
const productionUrl = 'https://fcos-a9b8c7d6e-hocheunglai-6535s-projects.vercel.app';
const binding = { sha, sourceDigest: digest, lockHash, configurationRevision, deploymentId: 'dpl_candidate', candidateUrl: url };
function readyInputs() {
  const source = { candidateHead: sha, hashes: { application: digest, policy: digest, connections: digest, ciIdentity: digest }, switchInventory: {} };
  const candidate = { id: binding.deploymentId, url, ...binding, candidateUrl: undefined, state: 'READY', target: 'preview' };
  delete candidate.candidateUrl; delete candidate.deploymentId;
  const production = { id: 'dpl_previous', url: productionUrl, sha: 'f'.repeat(40), state: 'READY', target: 'production' };
  const parity = { pass: true, blockers: [], capturedAt, binding: { ...binding, url } };
  const evidence = ['restricted_browser', 'normal_role'].map((kind, index) => ({ ...binding, kind, runId: index + 1, artifactId: index + 1, archiveDigest: digest, harnessSha: harness, capturedAt }));
  const quality = { ...binding, runId: 10, artifactId: 11, archiveDigest: digest, result: 'success', capturedAt };
  return { source, candidate, production, parity, evidence, quality, lockHash, configurationRevision, now };
}

test('readiness binds one exact candidate, source, lock, configuration, deployment and trusted archive identities', () => {
  const inputs = readyInputs(), result = createReleaseReadiness(inputs);
  assert.equal(result.ready, true);
  assert.equal(result.productionAuthorized, false);
  assert.equal(result.candidate.sourceDigest, digest);
  assert.equal(result.quality.archiveDigest, digest);
  assert.equal(assertReleaseReceiptBinding(result, result.candidate, { now }), true);
  for (const key of ['sha', 'sourceDigest', 'lockHash', 'configurationRevision']) {
    const altered = readyInputs(); altered.candidate[key] = '0'.repeat(key === 'sha' ? 40 : 64);
    assert.equal(createReleaseReadiness(altered).ready, false);
  }
  for (const changed of [
    { parity: { ...inputs.parity, capturedAt: '2026-09-30T00:00:00Z' } },
    { parity: { ...inputs.parity, raw: { pass: true, candidateSha: '0'.repeat(40), token: 'sensitive-raw-marker' } } },
    { parity: { ...inputs.parity, source: { candidateHead: '0'.repeat(40) } } },
    { parity: { ...inputs.parity, candidate: { ...inputs.candidate, sha: '0'.repeat(40) } } },
    { evidence: inputs.evidence.map(row => ({ ...row, pass: true, raw: { candidateSha: '0'.repeat(40) } })) },
    { evidence: [] }, { quality: null },
  ]) {
    const report = createReleaseReadiness({ ...inputs, ...changed });
    assert.equal(report.ready, false);
    assert.doesNotMatch(JSON.stringify(report), /sensitive-raw-marker/);
  }
  for (const changes of [{ productionAuthorized: true }, { raw: { pass: true } }, { candidate: { ...result.candidate, obsoleteSha: sha } }]) {
    assert.throws(() => assertReleaseReceiptBinding({ ...result, ...changes }, result.candidate, { now }));
  }
});

function protectedInputs() {
  const repository = { id: 77, full_name: RELEASE_REPOSITORY, default_branch: 'main' };
  const branch = { name: 'main', protected: true, commit: { sha: harness } };
  const protection = { required_status_checks: { strict:true, checks:FCOS_RELEASE_APPROVAL_POLICY.requiredChecks.map(context=>({context,app_id:FCOS_RELEASE_APPROVAL_POLICY.statusCheckAppId})) }, enforce_admins: { enabled: true }, required_pull_request_reviews: { required_approving_review_count: 1, dismiss_stale_reviews: true } };
  const environment = { id: 90, name: PRODUCTION_ENVIRONMENT, can_admins_bypass: false,
    deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
    protection_rules: [{ type: 'required_reviewers', prevent_self_review: true, reviewers: [{ type: 'User', reviewer: { id: 2 } }] }] };
  const variables = { variables: [{ name: 'FCOS_PRODUCTION_RELEASE_ENABLED', value: 'true' }, { name: 'FCOS_REVIEWED_RELEASE_SHA', value: sha },
    { name: 'FCOS_REVIEWED_SOURCE_SHA256', value: digest }, { name: 'FCOS_REVIEWED_CONFIGURATION_SHA256', value: configurationRevision }] };
  const secrets = { secrets: ['FCOS_RELEASE_VERCEL_TOKEN', 'FCOS_RELEASE_GH_TOKEN', 'FCOS_RELEASE_RUNTIME_TOKEN', 'FCOS_RELEASE_PREVIEW_RUNTIME_TOKEN'].map(name => ({ name })) };
  const run = { id: 99, repository, head_repository: repository, event: 'workflow_dispatch', head_branch: 'main', head_sha: harness,
    path: PRODUCTION_WORKFLOW, status: 'in_progress', run_attempt: 1, run_started_at: capturedAt, actor: { id: 1 }, triggering_actor: { id: 1 } };
  const approvals = [{ state: 'approved', environments: [{ id: environment.id, name: environment.name }], user: { id: 2 } }];
  const oidcClaims = { iss: 'https://token.actions.githubusercontent.com', aud: 'fcos-production-release', repository: RELEASE_REPOSITORY,
    repository_id: '77', sub: `repo:${RELEASE_REPOSITORY}:environment:${PRODUCTION_ENVIRONMENT}`,
    workflow_ref: `${RELEASE_REPOSITORY}/${PRODUCTION_WORKFLOW}@refs/heads/main`, workflow_sha: harness,
    sha: harness, ref: 'refs/heads/main', run_id: '99', run_attempt: '1', event_name: 'workflow_dispatch', exp: now / 1000 + 300 };
  return { approvalPolicy:{...FCOS_RELEASE_APPROVAL_POLICY,mode:'two_person'}, repository, branch, protection, environment, variables, secrets, run, approvals, oidcClaims,
    expectedCommit: sha, sourceDigest: digest, configurationRevision, now };
}

test('Production authority requires real protections, independent exact human approval and bound Actions identity', () => {
  const inputs = protectedInputs();
  assert.equal(assertProductionProtection(inputs).runId, 99);
  for (const alter of [
    copy => { copy.environment.can_admins_bypass = true; },
    copy => { delete copy.environment.can_admins_bypass; },
    copy => { copy.environment.protection_rules[0].prevent_self_review = false; },
    copy => { copy.approvals[0].user.id = 1; },
    copy => { copy.approvals[0].environments[0].id = 91; },
    copy => { copy.approvals.push({ ...structuredClone(copy.approvals[0]), state: 'rejected' }); },
    copy => { copy.approvals.unshift({ ...structuredClone(copy.approvals[0]), state: 'rejected' }); },
    copy => { copy.approvals.push(structuredClone(copy.approvals[0])); },
    copy => { copy.run.run_attempt = 2; },
    copy => { copy.variables.variables[1].value = '0'.repeat(40); },
    copy => { copy.secrets.secrets = []; },
    copy => { copy.branch.protected = false; },
    copy => { copy.oidcClaims.workflow_ref = `${RELEASE_REPOSITORY}/.github/workflows/evil.yml@refs/heads/main`; },
    copy => { copy.oidcClaims.run_id = '100'; },
    copy => { copy.oidcClaims.exp = now / 1000 - 1; },
  ]) { const copy = structuredClone(inputs); alter(copy); assert.throws(() => assertProductionProtection(copy)); }
});

test('Production readback requires every reviewed flag and safety action, rejects known wrong values and empty subsets', () => {
  const runtime = { flags: Object.fromEntries(PREVIEW_PARITY_POLICY.runtimeFlags.map(key => [key, { state: 'known', value: true }])),
    safety: { readOnly: false, externalActions: Object.fromEntries(PREVIEW_PARITY_POLICY.externalActions.map(key => [key, false])) },
    auth: Object.fromEntries(PREVIEW_PARITY_POLICY.requiredAuth.map(provider => [provider, { state: 'authenticated', target: 'pinned', mode: 'oauth' }])) };
  const expected = { expectedRuntimeFlags: structuredClone(runtime.flags), expectedRuntimeSafety: structuredClone(runtime.safety), expectedRuntimeAuth: structuredClone(runtime.auth) };
  assert.equal(assertProductionRuntimeReadback(runtime, expected), true);
  for (const alter of [
    copy => { copy.flags[PREVIEW_PARITY_POLICY.runtimeFlags[0]].value = false; },
    copy => { copy.flags = {}; },
    copy => { copy.safety.externalActions = {}; },
    copy => { delete copy.safety.externalActions[PREVIEW_PARITY_POLICY.externalActions[0]]; },
    copy => { copy.safety.externalActions[PREVIEW_PARITY_POLICY.externalActions[0]] = true; },
    copy => { copy.auth[PREVIEW_PARITY_POLICY.requiredAuth[0]].state = 'unknown'; },
  ]) { const copy = structuredClone(runtime); alter(copy); assert.throws(() => assertProductionRuntimeReadback(copy, expected)); }
  assert.throws(() => assertProductionRuntimeReadback(runtime, { ...expected, expectedRuntimeSafety: { readOnly: false, externalActions: {} } }));
});

test('artifact evidence rejects different candidate, mutable harness, wrong workflow, expired ZIP and content tampering', () => {
  const { repository, branch, protection } = protectedInputs(), archive = Buffer.from('fixture-archive');
  const run = { id: 1, repository, head_repository: repository, head_branch: 'main', head_sha: harness, path: '.github/workflows/normal-role-release.yml',
    event: 'workflow_dispatch', conclusion: 'success', status: 'completed', updated_at: capturedAt };
  const artifact = { id: 1, name: `fcos-normal-role-evidence-${sha}`, expired: false, workflow_run: { id: 1, head_sha: harness }, digest: `sha256:${releaseHash(archive)}` };
  const payload = { schemaVersion: 1, candidateSha: sha, candidateUrl: url, deploymentId: binding.deploymentId, sourceDigest: digest,
    harnessSha: harness, capturedAt, checks: [{ module: 'review', role: 'finance', result: 'pass', kind: 'workflow_read', evidenceId: 'example' }] };
  const inputs = { repository, branch, protection, run, artifact, archive, payload, binding, kind: 'normal_role', now };
  assert.equal(assertTrustedArtifact(inputs).archiveDigest, releaseHash(archive));
  for (const altered of [
    { payload: { ...payload, candidateSha: '0'.repeat(40) } }, { payload: { ...payload, sourceDigest: '0'.repeat(64) } },
    { artifact: { ...artifact, expired: true } }, { archive: Buffer.from('modified') },
    { run: { ...run, head_sha: sha } }, { run: { ...run, path: '.github/workflows/untrusted.yml' } },
  ]) assert.throws(() => assertTrustedArtifact({ ...inputs, ...altered }));
});

test('Actions authorization verifies issuer signatures rather than trusting environment claims', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'fixture', alg: 'RS256', use: 'sig' };
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'fixture' })).toString('base64url');
  const claims = { iss: 'https://token.actions.githubusercontent.com', aud: 'fcos-production-release', iat: now / 1000, exp: now / 1000 + 300 };
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const token = `${header}.${body}.${sign('RSA-SHA256', Buffer.from(`${header}.${body}`), privateKey).toString('base64url')}`;
  const env = { ACTIONS_ID_TOKEN_REQUEST_URL: 'https://fixture.actions.githubusercontent.com/_services/token?api-version=2', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'private-marker' };
  const fetchImpl = async url => ({ ok: true, json: async () => url.includes('/.well-known/jwks') ? { keys: [jwk] } : { value: token } });
  assert.equal((await githubReleaseOidc({ env, fetchImpl, now })).aud, 'fcos-production-release');
  await assert.rejects(() => githubReleaseOidc({ env: { ...env, ACTIONS_ID_TOKEN_REQUEST_URL: 'https://foreign.example/token' }, fetchImpl, now }));
  await assert.rejects(() => githubReleaseOidc({ env, now, fetchImpl: async () => { throw new Error('private-marker'); } }), error => !error.message.includes('private-marker'));
  await assert.rejects(() => githubReleaseOidc({ env, now, fetchImpl: async url => ({ ok: true, json: async () => url.includes('/.well-known/jwks') ? { keys: [jwk] } : { value: `${header}.${body}.${'a'.repeat(340)}` } }) }));
});

test('runtime evidence never infers unknown safety false and sends existing auth only to exact verified deployment', async () => {
  const deployment = { id: binding.deploymentId, url, sha, createdAt: now - 1000 };
  const opts = { url, deployment, sourceDigest: digest, token: 'private-runtime-marker', now };
  const response = { schemaVersion: 1, deploymentId: deployment.id, sha, sourceDigest: digest, capturedAt, flags: {}, auth: {}, safety: {} };
  const proof = await collectRuntimeObservation({ ...opts, fetchImpl: async (endpoint, request) => {
    assert.equal(endpoint, `${url}/api/connection-runtime`); assert.equal(request.method, 'POST'); assert.equal(request.redirect, 'error');
    assert.deepEqual(JSON.parse(request.body), { action: 'probe' });
    return { ok: true, url: endpoint, json: async () => response };
  } });
  assert.equal(proof.safety.readOnly, null);
  assert.doesNotMatch(JSON.stringify(proof), /private-runtime-marker/);
  assert.equal(await collectRuntimeObservation({ ...opts, url: productionUrl, fetchImpl: () => assert.fail('no credential may be sent') }), null);
  assert.equal(await collectRuntimeObservation({ ...opts, fetchImpl: async () => ({ ok: true, json: async () => ({ ...response, sha: '0'.repeat(40) }) }) }), null);
});

test('production dry-run is inert and staged commands never promote Preview or contain tokens', async () => {
  const plan = await runProductionRelease();
  assert.equal(plan.mutations, 0); assert.equal(plan.productionAuthorized, false);
  const args = productionDeployArguments({ sha, sourceDigest: digest, operationId: 'fcos-release-99' });
  assert.ok(args.includes(`FCOS_BUILD_COMMIT_SHA=${sha}`)); assert.ok(args.includes(`FCOS_EXPECTED_SOURCE_SHA256=${digest}`));
  assert.equal(args[args.indexOf('--env')+1], `FCOS_BUILD_COMMIT_SHA=${sha}`);
  assert.ok(args.includes('--prod')); assert.ok(args.includes('--skip-domain')); assert.ok(!args.includes('--prebuilt'));
  assert.throws(() => productionReleaseArguments(['--execute', '--dry-run']));
  assert.throws(() => productionReleaseArguments(['--token', 'private-marker']));
  assert.throws(() => productionDeployArguments({ sha, sourceDigest: digest, operationId: '../invalid' }));
});

function vercelInputs() {
  const teamId = fcosConnectionIdentifier('vercel', 'Team ID'), projectId = fcosConnectionIdentifier('vercel', 'Project ID');
  const [org, repo] = RELEASE_REPOSITORY.split('/');
  return { user: { username: fcosConnectionIdentifier('vercel', 'Account') }, team: { id: teamId, slug: fcosConnectionIdentifier('vercel', 'Team'), membership: { role: 'OWNER' } },
    project: { id: projectId, accountId: teamId, autoAssignCustomDomains: false, link: { org, repo, productionBranch: 'main' } },
    token: { id: 'reviewed-token-id', scopes: [{ type: 'team', teamId }] }, reviewedTokenId: 'reviewed-token-id',
    deploymentConfiguration: { git: { deploymentEnabled: { main: false } } }, hooks: [], now };
}
test('Vercel read access alone does not establish write scope and automatic release bypasses block', () => {
  const inputs = vercelInputs(); assert.equal(assertVercelProductionAuthority(inputs).deploymentCreate, 'verified');
  for (const changed of [
    { token: { ...inputs.token, scopes: [{ type: 'user' }] } }, { reviewedTokenId: 'another' },
    { team: { ...inputs.team, membership: { role: 'VIEWER' } } },
    { project: { ...inputs.project, autoAssignCustomDomains: true } },
    { deploymentConfiguration: { git: { deploymentEnabled: { main: true } } } }, { hooks: [{ id: 'hook' }] },
  ]) assert.throws(() => assertVercelProductionAuthority({ ...inputs, ...changed }));
});

function stateMachine(overrides = {}) {
  const readiness = createReleaseReadiness(readyInputs()), events = [];
  const previous = { id: 'dpl_previous', sha: 'f'.repeat(40), target: 'production' }, staged = { id: 'dpl_new', sha, target: 'production', state: 'READY', operationId: 'fcos-release-99' };
  let live = previous, approvals = 0;
  const options = { readiness, authority: async () => { approvals += 1; return { runId: 99, reviewerId: 2, environmentId: 90 }; },
    journal: async entry => events.push(entry.phase), currentProduction: async () => live,
    deploy: async args => { events.push('deploy'); assert.ok(args.includes('--skip-domain')); return staged; }, discover: async () => null,
    waitReady: async value => value, probe: async () => { events.push('probe'); }, promote: async () => { events.push('promote'); live = staged; }, now: () => now, ...overrides };
  return { options, events, staged, previous, approvals: () => approvals };
}
test('durable deployment intent and staged readback precede approval recheck and domain assignment', async () => {
  const fixture = stateMachine(); const result = await executeProductionRelease(fixture.options);
  assert.equal(result.phase, 'complete'); assert.equal(fixture.approvals(), 2);
  assert.deepEqual(fixture.events, ['deploy_requested', 'deploy', 'staged_build', 'staged_ready', 'probe', 'promotion_requested', 'promote', 'probe', 'complete']);
  assert.equal(result.rollback.requiresHumanAuthorization, true);
  assert.deepEqual(result.rollback.command, ['vercel', 'rollback', 'dpl_previous']);
});
test('uncertain deploy is read back without retry and failed staging never assigns domains', async () => {
  let deployments = 0;
  const uncertain = stateMachine({ deploy: async () => { deployments += 1; throw new Error('timeout'); } });
  await assert.rejects(() => executeProductionRelease(uncertain.options), /outcome is uncertain/);
  assert.equal(deployments, 1); assert.deepEqual(uncertain.events, ['deploy_requested', 'deploy_outcome_uncertain']);
  const failed = stateMachine({ probe: async () => { throw new Error('readback'); } });
  await assert.rejects(() => executeProductionRelease(failed.options), /No domain assignment/);
  assert.ok(!failed.events.includes('promote')); assert.ok(failed.events.includes('staged_readback_failed'));
  const preview = stateMachine(); preview.options.waitReady = async () => ({ ...preview.staged, target: 'preview' });
  await assert.rejects(() => executeProductionRelease(preview.options), /identity or READY/);
});

test('normal-role transport denies refresh, financial mutation, arbitrary foreign hosts and unknown handlers', () => {
  assert.equal(normalRoleRequestAllowed({ url: `${url}/api/functions/authContext`, method: 'POST', body: {} }, url), true);
  assert.equal(normalRoleRequestAllowed({ url: `${url}/api/functions/hedgeDeskEntity`, method: 'POST', body: { action: 'snapshot' } }, url), true);
  for (const request of [
    { url: `${url}/api/functions/hedgeDeskEntity`, method: 'POST', body: { action: 'create' } },
    { url: `${url}/api/functions/disputeWorkflowApprove`, method: 'POST', body: {} },
    { url: `${url}/api/functions/unknownHandler`, method: 'POST', body: {} },
    { url: 'https://foreign.example/collect', method: 'POST', body: {} },
    { url: 'https://foreign.example/collect', method: 'GET' },
    { url: `${url}/api/functions/marketReportDriveSyncCron`, method: 'GET' },
    { url: `${url}/api/unknown`, method: 'GET' },
    { url: 'https://pjforfvchygdyqfcgpmw.supabase.co/rest/v1/rpc/unknown', method: 'GET' },
    { url: `https://${fcosConnectionIdentifier('supabase', 'Project ref')}.supabase.co/auth/v1/token?grant_type=refresh_token`, method: 'POST', body: {} },
  ]) assert.equal(normalRoleRequestAllowed(request, url), false);
});
test('normal-role coverage cannot reuse CI, inactive/local assumed roles or shell-only data', () => {
  const auth = { user: { id: '12345678-1234-1234-1234-123456789abc', email: 'approved@example.test', user_type: 'finance', read_only_ci: false, active: true }, moduleAccess: { review: true } };
  assert.equal(assertNormalRoleIdentity(auth, { approvedEmail: auth.user.email }).role, 'finance');
  for (const user of [{ ...auth.user, read_only_ci: true }, { ...auth.user, active: false }, { ...auth.user, user_type: 'local_admin' }]) assert.throws(() => assertNormalRoleIdentity({ ...auth, user }, { approvedEmail: auth.user.email }));
  const review = NORMAL_ROLE_MODULES.find(row => row.module === 'review');
  assert.equal(normalModuleDataLoaded(review, { title: 'Exception Review', rows: [] }).loaded, false);
  assert.equal(normalModuleDataLoaded(review, { error: 'unavailable', recentStems: [] }).loaded, false);
  assert.deepEqual(normalModuleDataLoaded(review, { recentStems: [] }), { loaded: true, rows: 0 });
});

test('parity consumes the live release adapter contract and rejects cached or stale evidence', () => {
  const time = Date.now();
  const report = { identityVerified: true, identityStatus: 'verified', targetPin: 'verified',
    cliVersion: '54.20.1', cliVersionStatus: 'approved', observationMode: 'live', freshness: 'current',
    observedAt: new Date(time).toISOString(), permissions: ['project.read','deployment.read'] };
  assert.equal(assertParityConnectionReadAccess(report, time), true);
  for (const changed of [{ observationMode: 'cached' }, { freshness: 'stale' }, { observedAt: new Date(time - 900001).toISOString() },
    { cliVersionStatus: undefined, versionStatus: 'verified' }, { permissions: ['project.read'] }])
    assert.throws(() => assertParityConnectionReadAccess({ ...report, ...changed }, time));
});

test('Vercel metadata uses CLI first and independently verifies the same API credential on fallback', async () => {
  const metadata={id:'reviewed-token',scopes:[{type:'team',teamId:fcosConnectionIdentifier('vercel','Team ID')}]};
  let called=0;
  assert.equal(await readVercelTokenMetadata({cliRead:()=>({token:metadata}),fetchImpl:()=>{called++;throw Error('unexpected');}}),metadata);
  assert.equal(called,0);
  const urls=[];const fetchImpl=async (url,opts)=>{urls.push(url);assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');return {ok:true,json:async()=>url.endsWith('/v2/user')?{user:{username:fcosConnectionIdentifier('vercel','Account')}}:{token:metadata}};};
  assert.deepEqual(await readVercelTokenMetadata({cliRead:()=>{throw Error('unsupported');},token:'private-test-value',fetchImpl}),metadata);
  assert.deepEqual(urls,['https://api.vercel.com/v2/user','https://api.vercel.com/v5/user/tokens/current']);
  let reads=0;await assert.rejects(()=>readVercelTokenMetadata({cliRead:()=>{throw Error('unsupported');},token:'private-test-value',fetchImpl:async()=>{reads++;return {ok:true,json:async()=>({user:{username:'wrong'}})};}}),/account mismatch/);assert.equal(reads,1);
});

function soloInputs() {
  const inputs=protectedInputs();inputs.approvalPolicy={...FCOS_RELEASE_APPROVAL_POLICY,mode:'single_operator'};
  delete inputs.protection.required_pull_request_reviews;
  inputs.environment.protection_rules[0].prevent_self_review=false;
  const operator={id:1,login:'hocheunglai-oss'};
  inputs.environment.protection_rules[0].reviewers=[{type:'User',reviewer:operator}];
  inputs.run.actor=operator;inputs.run.triggering_actor=operator;inputs.approvals[0].user=operator;
  return inputs;
}
test('single operator may explicitly approve own exact run; all other safeguards remain mandatory',()=>{
  assert.equal(assertProductionProtection(soloInputs()).approvalMode,'single_operator');
  for (const alter of [
    x=>{x.approvals=[];}, x=>{x.approvals[0].user.login='wrong-account';},
    x=>{x.run.triggering_actor={id:2,login:'wrong-account'};},x=>{x.run.actor={...x.run.actor,id:2};},
    x=>{x.environment.protection_rules[0].prevent_self_review=true;},
    x=>{x.environment.protection_rules[0].reviewers[0].reviewer.login='wrong-account';},
    x=>{x.environment.protection_rules[0].reviewers.push({type:'Team',reviewer:{id:7}});},
    x=>{x.environment.can_admins_bypass=true;},x=>{x.protection.enforce_admins.enabled=false;},
    x=>{x.protection.required_status_checks.strict=false;},x=>{x.protection.required_status_checks.checks.pop();},
    x=>{x.protection.required_status_checks.checks[0].app_id=1;},
    x=>{x.approvalPolicy.mode='unknown';}, x=>{x.approvalPolicy.mode='two_person';},
    x=>{x.variables.variables[1].value='f'.repeat(40);},
    x=>{x.approvals.push(structuredClone(x.approvals[0]));},
    x=>{x.approvals[0].state='rejected';},x=>{x.oidcClaims.run_id='100';},
  ]) {const copy=structuredClone(soloInputs());alter(copy);assert.throws(()=>assertProductionProtection(copy));}
});

test('wrong release token account is rejected before private repository or environment reads',()=>{
  const paths=[];
  assert.throws(()=>assertReleaseGitHubAccount({json:path=>{paths.push(path);return {id:1,login:'wrong-account'};}}));
  assert.deepEqual(paths,['user']);
  assert.equal(assertReleaseGitHubAccount({json:path=>{assert.equal(path,'user');return {id:1,login:'hocheunglai-oss'};}}).id,1);
});
test('preflight and execution require the exact Production environment OIDC subject',()=>{
  const x=protectedInputs();assert.equal(assertReleaseWorkflowIdentity(x.oidcClaims,x.repository,x.branch),true);
  for(const change of [{sub:`repo:${RELEASE_REPOSITORY}:ref:refs/heads/main`},{sub:`repo:${RELEASE_REPOSITORY}:environment:wrong`},{workflow_sha:sha},{repository_id:'78'}]){
    assert.throws(()=>assertReleaseWorkflowIdentity({...x.oidcClaims,...change},x.repository,x.branch));
  }
});
