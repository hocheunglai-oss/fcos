import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCourierTemplate, parseExecutionPreflight, validateCourierLocator, assertCourierRun, parseOwnerReadbackCarrier, validateOwnerReadbackResult, readCourierGitFile, canonical, hash, REPOSITORY } from '../scripts/lib/hosted-release/xero-recovery-native-relay.mjs';
import { createJoinedBrowserBoundary } from './helpers/xero-recovery-joined-browser.mjs';

// Public, inert read-proof fixtures. These values grant no actual authority.
const at = Date.now();
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture() {
  const browser = createJoinedBrowserBoundary({ now: at, id: id(3), email: 'owner@example.invalid', subject: 'fixture-subject' });
  const binding = { operationId: hash('operation'), ownerThreadId: id(1), tenantId: id(2), actorId: id(3), expectedVersion: 451,
    refreshLeaseId: id(4), probeId: id(5), requestId: id(6), approvalSha256: hash('approval'), sourceSha256: hash('source'),
    bindingSha256: hash('binding'), organisationIdentitySha256: null, credentialPreservationCompositeApproved: true,
    preparedAt: at - 3600000, armBefore: at + 600000, absoluteNotAfter: at + 3600000, executionWindowMs: 1800000 };
  const planJson = canonical({ schemaVersion: 3, kind: 'fcos_xero_recovery_step_plan_v3', binding });
  const controller = 'a'.repeat(40), caller = 'b'.repeat(40), ref = 'refs/heads/codex/fixture';
  const template = { schemaVersion: 3, kind: 'fcos_xero_recovery_carrier_template_v3', planJson, controllerSha: controller,
    caller: { ref, sha: caller, workflowSha: caller, workflowRef: `${REPOSITORY}/.github/workflows/authenticated-release.yml@${ref}`,
      jobWorkflowRef: `${REPOSITORY}/.github/workflows/hosted-xero-recovery-carrier.yml@${controller}`, jobWorkflowSha: controller,
      jobName: 'xero-recovery-carrier', environment: 'fcos-hosted-verification', subject: `repo:${REPOSITORY}:environment:fcos-hosted-verification` },
    hostConfiguration: { actorBinding: { accessRevision: 5 } }, login: { origin: browser.publicAuth.preflight.origin, publicAuth: browser.publicAuth },
    readCredential: {}, readAcceptance: {}, issuedAt: binding.preparedAt, notAfter: binding.absoluteNotAfter, artifactCaptureAuthoritySha256: hash('capture') };
  const metadata = { schemaVersion: 1, kind: 'fcos_xero_execution_preflight_v1', operationId: binding.operationId,
    planSha256: hash(planJson), preflight: structuredClone(browser.publicAuth.preflight) };
  return { template, metadata };
}

test('v3 pairing rejects mixed versions and any precompiled execution clock', () => {
  const { template } = fixture();
  assert.equal(parseCourierTemplate(JSON.stringify(template)).plan.schemaVersion, 3);
  for (const mutate of [t => { t.schemaVersion = 2; }, t => { t.kind = 'fcos_xero_recovery_carrier_template_v2'; },
    t => { const plan = JSON.parse(t.planJson); plan.binding.firstStartedAt = at; t.planJson = canonical(plan); },
    t => { t.notAfter++; }]) {
    const changed = structuredClone(template); mutate(changed);
    assert.throws(() => parseCourierTemplate(JSON.stringify(changed)));
  }
});

test('fresh public metadata can renew read observations only for the immutable own identity/source', () => {
  const { template, metadata } = fixture();
  assert.equal(parseExecutionPreflight(canonical(metadata), template, at).identity.profileId, id(3));
  for (const mutate of [m => { m.operationId = hash('foreign'); }, m => { m.planSha256 = hash('foreign'); },
    m => { m.preflight.effectiveAdmin = false; }, m => { m.preflight.sourceSha256 = hash('foreign'); },
    m => { m.preflight.capturedAt = new Date(at - 1800001).toISOString(); }, m => { m.preflight.capturedAt = new Date(at + 31000).toISOString(); },
    m => { m.preflight.rawToken = 'NEVER_ALLOWED'; }]) {
    const changed = structuredClone(metadata); mutate(changed);
    assert.throws(() => parseExecutionPreflight(canonical(changed), template, at));
  }
  template.login.publicAuth.preflight.linkRevokedBefore = new Date(at - 1000).toISOString();
  assert.throws(() => parseExecutionPreflight(canonical(metadata), template, at), 'a newer revocation floor cannot be removed');
});

test('v3 exact locator must bind the metadata sidecar; legacy locator cannot activate it', () => {
  const { template, metadata } = fixture();
  const locator = { schemaVersion: 3, kind: 'fcos_xero_host_locator_v3', deploymentId: 'dpl_fixture', url: 'https://fixed.vercel.app', executionPreflightSha256: hash(canonical(metadata)) };
  assert.deepEqual(validateCourierLocator(canonical(locator), template), locator);
  for (const change of [{ executionPreflightSha256: null }, { schemaVersion: 1 }, { kind: 'fcos_xero_host_locator_v1' }, { url: 'https://foreign.invalid' }, { actorId: id(8) }])
    assert.throws(() => validateCourierLocator(JSON.stringify({ ...locator, ...change }), template));
});

test('actual same-run execution observation requires the completed preparation job', async () => {
  const { template } = fixture(), repo = { id: 1278654816, full_name: REPOSITORY };
  const run = { id: 123, run_attempt: 1, repository: repo, head_repository: repo, actor: { id: 265701760, login: 'hocheunglai-oss' },
    event: 'workflow_dispatch', head_sha: template.caller.sha, head_branch: template.caller.ref.slice(11), path: '.github/workflows/authenticated-release.yml', status: 'in_progress' };
  const execution = { id: 22, run_id: 123, name: 'xero-recovery-carrier', labels: ['ubuntu-24.04'], status: 'in_progress' };
  const preparation = { id: 21, run_id: 123, name: 'xero-recovery-preparation', labels: ['ubuntu-24.04'], status: 'completed', conclusion: 'success' };
  let jobs = [execution, preparation];
  const read = async route => route.endsWith('/attempts/1/jobs?per_page=100') ? { jobs, total_count: jobs.length } : route.endsWith('/actions/runs/123') ? run : repo;
  assert.equal((await assertCourierRun(read, template, '123')).job.id, 22);
  for (const invalid of [[execution], [execution, { ...preparation, conclusion: 'failure' }], [execution, preparation, preparation]]) {
    jobs = invalid; await assert.rejects(assertCourierRun(read, template, '123'));
  }
  jobs = [{ ...preparation, status: 'in_progress' }];
  assert.equal((await assertCourierRun(read, template, '123', { phase: 'preparation' })).job.id, 21);
});

test('workflow keeps preparation credential-minimal and starts a separate bounded execution job', () => {
  const workflow = readFileSync(new URL('../.github/workflows/hosted-xero-recovery-carrier.yml', import.meta.url), 'utf8');
  const preparation = workflow.split('  xero-recovery-preparation:')[1].split('  xero-recovery-carrier:')[0];
  assert.match(preparation, /FCOS_XERO_CARRIER_PHASE: preparation/);
  assert.match(preparation, /Object\.hasOwn\(p, 'environment'\)/);
  assert.match(preparation, /repo:hocheunglai-oss\/fcos:ref:/);
  assert.doesNotMatch(preparation, /environment:|secrets\.FCOS_HOSTED_VERCEL_READ_TOKEN|secrets\.FCOS_HOSTED_RUNTIME_|secrets\.FCOS_XERO_RECOVERY_REQUEST_NONCE|secrets\.FCOS_PRODUCTION_VERIFICATION_BYPASS/);
  const execution = workflow.split('  xero-recovery-carrier:')[1];
  assert.match(execution, /needs: xero-recovery-preparation/);
  assert.match(execution, /timeout-minutes: 30/);
  assert.match(execution, /secrets\.FCOS_HOSTED_RUNTIME_PASSWORD/);
});


test('v3 owner readback binds fresh public metadata without rearming the original clock or allowing POST scope', () => {
  const {template,metadata}=fixture(),parsed=parseCourierTemplate(JSON.stringify(template));
  const value={schemaVersion:1,kind:'fcos_xero_owner_readback_carrier_v1',templateSha256:parsed.templateSha256,planSha256:parsed.planSha256,
    originalBinding:{runId:'123',jobId:22,hostOrigin:'https://fixed.vercel.app',deploymentId:'dpl_fixture',rootAdmissionSha256:hash('root'),executionPreflightSha256:hash(canonical(metadata)),executionJobStartedAt:at-1000},
    requestSha256:hash('request'),originalClaimSha256:hash('claim'),originalStoppedSha256:hash('stopped'),originalUncertainSha256:hash('uncertain'),admissionScopeSha256:hash('scope'),dispatchId:id(9),issuedAt:at,notAfter:at+300000,
    executionPreflightJson:canonical(metadata)};
  assert.equal(parseOwnerReadbackCarrier(JSON.stringify(value),parsed).originalBinding.runId,'123');
  assert.throws(()=>parseOwnerReadbackCarrier(JSON.stringify({...value,maximumHostPosts:1}),parsed));
  assert.throws(()=>parseOwnerReadbackCarrier(JSON.stringify({...value,executionPreflightJson:canonical({...metadata,operationId:hash('foreign')})}),parsed));
  const result={kind:'fcos_xero_recovery_step_readback_v3',operationId:parsed.plan.binding.operationId,planSha256:parsed.planSha256,state:'submitted_unknown',nextStep:null,currentStep:'preflight',submissionId:id(8),lastResultSha256:null,checkpoint:{},execution:{firstStartedAt:at,executionDeadlineAt:at+1800000},executionAuthorityGranted:false,qualificationAccepted:false};
  assert.equal(validateOwnerReadbackResult(result,{plan:parsed.plan,planSha256:parsed.planSha256,now:at+1800001}).state,'submitted_unknown');
});


test('legacy locator readers still refuse the new two-file tree without explicit v3 admission',async()=>{
  const ref='refs/heads/codex/fcos-xero-'+hash('op').slice(0,16)+'-123/locator',commit='a'.repeat(40),tree='b'.repeat(40);let reads=0;
  const read=async route=>{reads++;if(route.includes('/git/ref/'))return{ref,object:{type:'commit',sha:commit}};
    if(route.includes('/git/commits/'))return{sha:commit,parents:[],tree:{sha:tree}};
    if(route.includes('/git/trees/'))return{sha:tree,truncated:false,tree:[{path:'locator.json',mode:'100644',type:'blob',sha:'c'.repeat(40)},{path:'execution-preflight.json',mode:'100644',type:'blob',sha:'d'.repeat(40)}]};
    assert.fail('No blob fetch after legacy tree refusal');};
  await assert.rejects(readCourierGitFile(read,ref,'locator.json',2048));assert.equal(reads,3);
});
