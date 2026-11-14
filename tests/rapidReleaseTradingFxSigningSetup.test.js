import assert from 'node:assert/strict';
import test from 'node:test';
import { digest, targets } from '../scripts/lib/rapid-release/contract.mjs';
import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { assertPublicPayload, pendingOperations } from '../scripts/lib/rapid-release/journal.mjs';
import { validateSigningSetupPlan, executeSigningSetup, signingSetupProviders, signingCertificateDefinition } from '../scripts/lib/rapid-release/trading-fx-signing-setup.mjs';

const pins = targets(), org = fcosSalesforceEnvironment('production'), hex = digit => digit.repeat(64);
const plan = {
  kind: 'fcos_trading_fx_signing_setup', schemaVersion: 1, operationId: 'trading-fx-signing-test-0001',
  repository: pins.repository, controllerSha: 'a'.repeat(40), candidateSha: 'b'.repeat(40), sourceDigest: hex('a'),
  previous: { sha:'c'.repeat(40), deploymentId:'dpl_previous', buildId:hex('b'), configurationDigest:hex('c'),
    fullEnvironmentDigest:hex('d'), schemaDigest:hex('e') },
  supabaseProject: pins.supabaseProject, vercelProject:pins.projectId, vercelTeam:pins.teamId, salesforceOrg:org.orgId,
  certificate:signingCertificateDefinition('trading-fx-signing-test-0001'),
  variables:{ FCOS_ENABLE_SALESFORCE_COMPANY_FX:'true',SALESFORCE_COMPANY_FX_ENVIRONMENT:'production',
    SALESFORCE_COMPANY_FX_SIGNING_PUBLIC_KEY:'verified_salesforce_public_key' },
  manualRunId:43582562872,terminalManualOutcome:'promoted_observed',expectedSignerId:'005000000000000AAA',expectedVercelActorId:'fixture-actor',financialAuthority:false,
};
const received = [
  {orgId:org.orgId,certificateId:'000000000000000AAA',certificateName:plan.certificate.fullName,
    publicKeyDigest:hex('a'),possessionProofDigest:hex('b'),expiresAt:'2027-11-14T12:00:00.000Z',privateKeyExportable:false,
    keySize:2048,isSandbox:false,caSigned:false,createdAt:'2026-11-14T12:00:00.000Z',auditEvidenceDigest:hex('c')},
  {projectId:pins.projectId,teamId:pins.teamId,configurationDigest:hex('f'),fullEnvironmentDigest:hex('0'),
    rowDigest:hex('1'),keyDigest:hex('a'),previousDeploymentId:plan.previous.deploymentId,eventEvidenceDigest:hex('2')},
  {deploymentReceiptId:99,ownerReceiptDigest:hex('6'),configurationDigest:hex('f'),operationId:plan.operationId},
];

function fixture() {
  const chain = [], calls = [], native = new Map();
  const journal = {
    read: async () => structuredClone(chain),
    async append(event,data,{expectedPreviousHash}) {
      assertPublicPayload(data);
      const previousHash = chain.at(-1)?.payload.recordHash ?? null;
      assert.equal(expectedPreviousHash,previousHash);
      const payload = {event,data,previousHash,sequence:chain.length};
      chain.push({payload:{...payload,recordHash:digest(payload)}});
    },
    async assertNoUnresolvedOtherRelease() {},
  };
  const providers = Object.fromEntries(signingSetupProviders.map((name,index) => [name,{
    preflight: async ({originalOperationId}) => digest(originalOperationId),
    async submit({intent}) { calls.push(name); native.set(intent.operationId,received[index]); },
    discover: async ({intent}) => native.get(intent.operationId),
    async verify({intent,evidence}) { return digest(native.get(intent.operationId) ?? null) === digest(evidence); },
  }]));
  const context = {plan,journal,providers,clock:()=> '2026-11-14T12:00:00.000Z',
    admission: async () => ({runId:432,approvalHash:hex('7'),maySubmit:true})};
  return {chain,calls,native,context};
}

test('signing setup pins certificate, public values, reviewed predecessor and disables financial authority', () => {
  assert.match(validateSigningSetupPlan(plan),/^[a-f0-9]{64}$/u);
  for (const mutated of [{...plan,financialAuthority:true},{...plan,manualRunId:1},{...plan,terminalManualOutcome:'waiting'},
    {...plan,certificate:{...plan.certificate,privateKeyExportable:true}},
    {...plan,variables:{...plan.variables,FCOS_ENABLE_XERO_FINANCIAL_SYNC:'true'}}]) {
    assert.throws(() => validateSigningSetupPlan(mutated),{code:'SIGNING_SETUP_PLAN_SCOPE_CHANGED'});
  }
});

test('lost provider acknowledgement resolves the original and never replays a completed setup', async () => {
  const {chain,calls,context} = fixture();
  const step = context.providers['salesforce-certificate'];
  const submit = step.submit;
  step.submit = async values => { await submit(values); throw Error('lost acknowledgement'); };
  const result = await executeSigningSetup(context);
  assert.equal(result.state,'verified');
  assert.equal(result.ownerReceiptId,99);
  assert.deepEqual(calls,signingSetupProviders);
  assert.equal(chain.length,8);
  assert.deepEqual(pendingOperations(chain),[]);
  assert.deepEqual(await executeSigningSetup(context),result);
  assert.deepEqual(calls,signingSetupProviders);
  assert.equal(chain.length,8);
});

test('unknown original certificate blocks later writes and all competing releases', async () => {
  const {chain,calls,context,native} = fixture();
  const step = context.providers['salesforce-certificate'];
  step.submit = async () => { calls.push('salesforce-certificate'); throw Error('lost'); };
  const expected = await executeSigningSetup(context);
  assert.equal(expected.state,'original_operation_unresolved');
  assert.equal(expected.provider,'salesforce-certificate');
  assert.deepEqual(await executeSigningSetup(context),expected);
  assert.deepEqual(calls,['salesforce-certificate']);
  assert.deepEqual(pendingOperations(chain).map(row=>row.event),['signing_setup.intent','signing_provider.intent']);
  native.set(expected.operationId,received[0]);
  assert.equal((await executeSigningSetup(context)).state,'verified');
  assert.deepEqual(calls,signingSetupProviders);
});

test('a lost journal acknowledgement reads the exact append before the still-running process submits', async () => {
  const {chain,calls,context} = fixture();
  const append = context.journal.append;
  context.journal.append = async (event,...args) => {
    await append(event,...args);
    if (event === 'signing_provider.intent') throw Error('lost journal acknowledgement');
  };
  assert.equal((await executeSigningSetup(context)).state,'verified');
  assert.deepEqual(calls,signingSetupProviders);
  assert.deepEqual(pendingOperations(chain),[]);
});

test('a missing journal acknowledgement and inconclusive readback starts no provider action', async () => {
  const {chain,calls,context} = fixture();
  const append = context.journal.append;
  context.journal.append = async (event,...args) => {
    if (event === 'signing_provider.intent') throw Error('no observed native append');
    await append(event,...args);
  };
  await assert.rejects(executeSigningSetup(context),/no observed native append/u);
  assert.deepEqual(calls,[]);
  assert.equal(pendingOperations(chain).length,1);
});

test('partial Vercel applies no later writes, and expired approval can only read back', async () => {
  const {chain,calls,context,native} = fixture();
  context.providers['vercel-config'].submit = async () => { calls.push('vercel-config'); throw Error('partial'); };
  const partial = await executeSigningSetup(context);
  assert.equal(partial.provider,'vercel-config');
  native.set(partial.operationId,received[1]);
  context.admission = async () => ({runId:432,approvalHash:hex('7'),maySubmit:false});
  const result = await executeSigningSetup(context);
  assert.equal(result.state,'awaiting_authorized_submission');
  assert.equal(result.provider,'owner-receipt');
  assert.deepEqual(calls,['salesforce-certificate','vercel-config']);
  assert.deepEqual(pendingOperations(chain).map(row=>row.event),['signing_setup.intent']);
  context.admission = async () => ({runId:433,approvalHash:hex('7'),maySubmit:true});
  await assert.rejects(executeSigningSetup(context),{code:'SIGNING_SETUP_EXACT_APPROVAL_REQUIRED'});
});

test('provider result with a different key fails and leaves the original open', async () => {
  const {chain,calls,context,native} = fixture();
  context.providers['vercel-config'].submit = async ({intent}) => {
    calls.push('vercel-config');
    native.set(intent.operationId,{...received[1],keyDigest:hex('8')});
  };
  await assert.rejects(executeSigningSetup(context),{code:'SIGNING_SETUP_VERCEL_EVIDENCE_INVALID'});
  assert.deepEqual(calls,['salesforce-certificate','vercel-config']);
  assert.deepEqual(pendingOperations(chain).map(row=>row.event),['signing_setup.intent','signing_provider.intent']);
});

test('an expired exact setup can complete readback for every previously submitted step', async () => {
  const {chain,calls,context,native} = fixture();
  context.providers['owner-receipt'].submit = async () => { calls.push('owner-receipt'); throw Error('lost'); };
  const pending = await executeSigningSetup(context);
  assert.equal(pending.provider,'owner-receipt');
  context.admission = async () => ({runId:432,approvalHash:hex('7'),maySubmit:false});
  native.set(pending.operationId,received[2]);
  assert.equal((await executeSigningSetup(context)).state,'verified');
  assert.deepEqual(calls,signingSetupProviders);
  assert.deepEqual(pendingOperations(chain),[]);
});
