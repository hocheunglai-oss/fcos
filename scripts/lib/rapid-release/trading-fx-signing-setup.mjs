import { digest, isDigest, isSha, requireCondition as check, targets } from './contract.mjs';
import { fcosSalesforceEnvironment } from '../../../config/fcosConnections.js';

export const certificateName = 'FCOS_Company_FX_Signing';
export function signingCertificateDefinition(operationId) {
  return { fullName:certificateName,masterLabel:'FCOS Company FX Signing '+digest(operationId).slice(0,16),
    caSigned:false,keySize:2048,privateKeyExportable:false };
}
export const publicKeyName = 'SALESFORCE_COMPANY_FX_SIGNING_PUBLIC_KEY';
export const signedCallbackVariables = Object.freeze({
  FCOS_ENABLE_SALESFORCE_COMPANY_FX: 'true',
  SALESFORCE_COMPANY_FX_ENVIRONMENT: 'production',
});
const preSubmitEvidenceCodes = new Set(['SIGNING_SETUP_PROVIDER_PRECONDITION_CHANGED','SIGNING_SETUP_SUBMISSION_NOT_AUTHORIZED']);
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const same = (left, right) => digest(left ?? null) === digest(right ?? null);
const minimumRemainingMs = 300000;
const positiveId = value => Number.isSafeInteger(value) && value > 0;
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && value === new Date(value).toISOString();
const deploymentId = value => /^dpl_[A-Za-z0-9]+$/u.test(value || '');
export const signingSetupProviders = Object.freeze(['salesforce-certificate', 'vercel-config', 'owner-receipt']);

export function validateSigningSetupPlan(plan) {
  const pins = targets(), org = fcosSalesforceEnvironment('production');
  check(exact(plan, ['kind','schemaVersion','operationId','repository','controllerSha','candidateSha','sourceDigest',
    'previous','supabaseProject','vercelProject','vercelTeam','salesforceOrg','certificate','variables','manualRunId','terminalManualOutcome',
    'expectedSignerId','expectedVercelActorId','financialAuthority'])
    && plan.kind === 'fcos_trading_fx_signing_setup' && plan.schemaVersion === 1
    && /^trading-fx-signing-[a-z0-9-]{8,60}$/u.test(plan.operationId || '')
    && plan.repository === pins.repository && isSha(plan.controllerSha) && isSha(plan.candidateSha) && isDigest(plan.sourceDigest)
    && exact(plan.previous,['sha','deploymentId','buildId','configurationDigest','fullEnvironmentDigest','schemaDigest'])
    && isSha(plan.previous.sha) && deploymentId(plan.previous.deploymentId)
    && ['buildId','configurationDigest','fullEnvironmentDigest','schemaDigest'].every(key => isDigest(plan.previous[key]))
    && plan.supabaseProject === pins.supabaseProject && plan.vercelProject === pins.projectId && plan.vercelTeam === pins.teamId
    && plan.salesforceOrg === org.orgId && same(plan.certificate, signingCertificateDefinition(plan.operationId))
    && same(plan.variables, {...signedCallbackVariables,[publicKeyName]:'verified_salesforce_public_key'})
    && plan.manualRunId === 43582562872 && ['promoted_observed','closed_without_promotion'].includes(plan.terminalManualOutcome)
    && /^005[A-Za-z0-9]{15}$/u.test(plan.expectedSignerId || '')
    && /^[A-Za-z0-9_-]{8,64}$/u.test(plan.expectedVercelActorId || '') && plan.financialAuthority === false,
  'SIGNING_SETUP_PLAN_SCOPE_CHANGED');
  return digest(plan);
}

function evidenceFor(phase, evidence, operationId, receipts) {
  if (phase === 'salesforce-certificate') {
    check(exact(evidence,['orgId','certificateId','certificateName','publicKeyDigest','possessionProofDigest','expiresAt',
      'privateKeyExportable','keySize','isSandbox','caSigned','createdAt','auditEvidenceDigest'])
      && evidence.orgId === fcosSalesforceEnvironment('production').orgId && /^[A-Za-z0-9]{18}$/u.test(evidence.certificateId || '')
      && evidence.certificateName === certificateName && [evidence.publicKeyDigest,evidence.possessionProofDigest,evidence.auditEvidenceDigest].every(isDigest)
      && iso(evidence.expiresAt) && iso(evidence.createdAt) && Date.parse(evidence.expiresAt) > Date.parse(evidence.createdAt)
      && evidence.privateKeyExportable === false && evidence.keySize === 2048 && evidence.caSigned === false && evidence.isSandbox === false,
    'SIGNING_SETUP_CERTIFICATE_EVIDENCE_INVALID');
  } else if (phase === 'vercel-config') {
    check(exact(evidence,['projectId','teamId','configurationDigest','fullEnvironmentDigest','rowDigest','keyDigest','previousDeploymentId','eventEvidenceDigest'])
      && evidence.projectId === targets().projectId && evidence.teamId === targets().teamId
      && [evidence.configurationDigest,evidence.fullEnvironmentDigest,evidence.rowDigest,evidence.keyDigest,evidence.eventEvidenceDigest].every(isDigest)
      && evidence.keyDigest === receipts[0]?.publicKeyDigest && deploymentId(evidence.previousDeploymentId),
    'SIGNING_SETUP_VERCEL_EVIDENCE_INVALID');
  } else {
    check(exact(evidence,['deploymentReceiptId','ownerReceiptDigest','configurationDigest','operationId'])
      && positiveId(evidence.deploymentReceiptId) && isDigest(evidence.ownerReceiptDigest) && evidence.operationId === operationId
      && evidence.configurationDigest === receipts[1]?.configurationDigest, 'SIGNING_SETUP_OWNER_RECEIPT_INVALID');
  }
  return evidence;
}

function checkpoints(chain, operationId, planHash) {
  const records = chain.map(row => row.payload);
  const setup = records.filter(row => row.event === 'signing_setup.intent');
  check(setup.length <= 1 && setup.every(row => exact(row.data,['operationId','planHash','approvalHash','runId'])
    && row.data.operationId === operationId && row.data.planHash === planHash && isDigest(row.data.approvalHash)
    && positiveId(row.data.runId)), 'SIGNING_SETUP_INTENT_CHANGED');
  const expectedSteps = signingSetupProviders.map(provider => operationId + ':' + provider);
  const progress = records.filter(row => ['signing_provider.intent','signing_provider.result'].includes(row.event));
  check(progress.length <= expectedSteps.length * 2 && progress.every((row, index) => {
    const phase = Math.floor(index/2);
    return row.sequence > setup[0]?.sequence && row.data.operationId === expectedSteps[phase]
      && row.data.planHash === planHash && row.data.provider === signingSetupProviders[phase]
      && row.event === (index % 2 ? 'signing_provider.result' : 'signing_provider.intent')
      && (index % 2 ? exact(row.data,['operationId','planHash','provider','evidence','outcome'])
        && (row.data.outcome === 'verified' || row.data.outcome === 'not_submitted'
          && exact(row.data.evidence,['reason','requestDigest']) && preSubmitEvidenceCodes.has(row.data.evidence.reason)
          && row.data.evidence.requestDigest === progress[index-1].data.requestDigest)
        : exact(row.data,['operationId','planHash','provider','requestDigest','submittedAt'])
          && iso(row.data.submittedAt) && isDigest(row.data.requestDigest));
  }), 'SIGNING_SETUP_PROVIDER_SEQUENCE_CHANGED');
  const stopped = records.filter(row => row.event === 'signing_provider.result' && row.data.outcome === 'not_submitted');
  check(stopped.length <= 1 && stopped.every(row => row === progress.at(-1)), 'SIGNING_SETUP_TERMINAL_PROVIDER_CHANGED');
  const closed = records.filter(row => row.event === 'signing_setup.result');
  check(closed.length <= 1 && closed.every(row => row.sequence > progress.at(-1)?.sequence
    && exact(row.data,['operationId','planHash','outcome','evidenceDigest']) && row.data.operationId === operationId
    && row.data.planHash === planHash
    && (row.data.outcome === 'verified' && progress.length === expectedSteps.length*2 && stopped.length === 0
      || row.data.outcome === 'stopped_before_provider_request' && stopped.length === 1)
    && row.data.evidenceDigest === digest(progress.filter(item => item.event.endsWith('.result')).map(item => item.data.evidence))),
  'SIGNING_SETUP_RESULT_CHANGED');
  return { setup: setup[0]?.data, closed: closed[0]?.data,
    steps: expectedSteps.map((id, index) => ({ id, intent:progress[2*index]?.data, result:progress[2*index+1]?.data })) };
}

// The native runner owns authorization, provider identities and complete
// readbacks. This state machine owns durable admission of each submission.
export async function executeSigningSetup({ plan, journal, admission, providers, clock = () => new Date().toISOString() }) {
  const planHash = validateSigningSetupPlan(plan);
  check(signingSetupProviders.every(name => ['preflight','submit','discover','verify'].every(method =>
    typeof providers?.[name]?.[method] === 'function')), 'SIGNING_SETUP_PROVIDERS_REQUIRED');

  let chain = await journal.read();
  const get = () => checkpoints(chain,plan.operationId,planHash);
  async function append(event,data) {
    const previousHash = chain.at(-1)?.payload.recordHash ?? null;
    const sequence = chain.length;
    try { await journal.append(event,data,{expectedPreviousHash:previousHash}); }
    catch (error) {
      // This invocation has not reached the provider callback. Recover the
      // same native append once, without a second journal or provider POST.
      chain = await journal.read();
      const observed = chain[sequence]?.payload;
      if (chain.length !== sequence+1 || observed?.previousHash !== previousHash
        || observed.event !== event || !same(observed.data,data)) throw error;
      return;
    }
    chain = await journal.read();
  }
  let state = get();
  const authorize = async () => {
    const approval = await admission({ plan, planHash, original:state.setup });
    check(exact(approval,['approvalHash','runId','maySubmit']) && isDigest(approval.approvalHash)
      && positiveId(approval.runId) && typeof approval.maySubmit === 'boolean'
      && (!state.setup || state.setup.approvalHash === approval.approvalHash && state.setup.runId === approval.runId),
    'SIGNING_SETUP_EXACT_APPROVAL_REQUIRED');
    await journal.assertNoUnresolvedOtherRelease();
    return approval;
  };
  let approval = await authorize();
  if (!state.setup) {
    check(approval.maySubmit, 'SIGNING_SETUP_SUBMISSION_NOT_AUTHORIZED');
    await append('signing_setup.intent',{operationId:plan.operationId,planHash,approvalHash:approval.approvalHash,runId:approval.runId});
    state = get();
    check(state.setup, 'SIGNING_SETUP_INTENT_UNCONFIRMED');
  }
  const receipts = [], previousSteps = [];
  async function closeBeforeSubmit(label, step, evidence) {
    const evidenceDigest = digest([...receipts,evidence]);
    if (!state.closed) {
      await append('signing_setup.result',{operationId:plan.operationId,planHash,outcome:'stopped_before_provider_request',evidenceDigest});
    }
    check(get().closed?.evidenceDigest === evidenceDigest,'SIGNING_SETUP_RESULT_UNCONFIRMED');
    return {state:'stopped_before_provider_request',provider:label,operationId:step.id,
      completedProviders:previousSteps.map(item=>item.intent.provider),evidenceDigest,providerCallsResubmitted:0};
  }
  function currentEvidence(label, evidence) {
    if (label === 'salesforce-certificate') {
      check(Date.parse(evidence.expiresAt) > Date.parse(clock())+minimumRemainingMs,'SIGNING_SETUP_CERTIFICATE_EXPIRES_TOO_SOON');
    } else if (label === 'vercel-config') {
      check(evidence.previousDeploymentId === plan.previous.deploymentId
        && evidence.configurationDigest !== plan.previous.configurationDigest
        && evidence.fullEnvironmentDigest !== plan.previous.fullEnvironmentDigest,'SIGNING_SETUP_VERCEL_PREDECESSOR_CHANGED');
    }
    return evidence;
  }
  for (const [index, label] of signingSetupProviders.entries()) {
    const driver = providers[label], step = state.steps[index];
    const context = { plan, planHash, originalOperationId: step.id, receipts: [...receipts], previousSteps: [...previousSteps] };
    if (step.result?.outcome === 'not_submitted') return closeBeforeSubmit(label,step,step.result.evidence);
    if (step.result) {
      const evidence = currentEvidence(label,evidenceFor(label,step.result.evidence,plan.operationId,receipts));
      check(await driver.verify({...context,evidence,intent:step.intent}) === true,'SIGNING_SETUP_READBACK_CHANGED');
      receipts.push(evidence);
      previousSteps.push({originalOperationId:step.id,intent:step.intent,evidence});
      continue;
    }
    let intent = step.intent;
    if (!intent) {
      approval = await authorize();
      if (!approval.maySubmit) return {state:'awaiting_authorized_submission',provider:label,operationId:step.id,providerCallsResubmitted:0};
      const requestDigest = await driver.preflight(context);
      check(isDigest(requestDigest),'SIGNING_SETUP_REQUEST_UNVERIFIED');
      check((await authorize()).maySubmit, 'SIGNING_SETUP_SUBMISSION_NOT_AUTHORIZED');
      intent = {operationId:step.id,planHash,provider:label,requestDigest,submittedAt:clock()};
      check(iso(intent.submittedAt),'SIGNING_SETUP_TIME_INVALID');
      await append('signing_provider.intent',intent);
      state = get();
      check(same(state.steps[index].intent,intent),'SIGNING_SETUP_SUBMISSION_INTENT_UNCONFIRMED');
      let requestBoundaryReached = false;
      const submitOnce = async submit => {
        check(!requestBoundaryReached,'SIGNING_SETUP_DUPLICATE_PROVIDER_REQUEST');
        check((await authorize()).maySubmit, 'SIGNING_SETUP_SUBMISSION_NOT_AUTHORIZED');
        requestBoundaryReached = true;
        return submit();
      };
      try {
        await driver.submit({...context,intent,submitOnce});
        check(requestBoundaryReached,'SIGNING_SETUP_PROVIDER_PRECONDITION_CHANGED');
      }
      catch (error) {
        if (!requestBoundaryReached) {
          const code = 'SIGNING_SETUP_SUBMISSION_NOT_AUTHORIZED';
          const evidence = {reason:error?.code === code ? code : 'SIGNING_SETUP_PROVIDER_PRECONDITION_CHANGED',requestDigest};
          await append('signing_provider.result',{operationId:step.id,planHash,provider:label,outcome:'not_submitted',evidence});
          state = get();
          return closeBeforeSubmit(label,step,evidence);
        }
        // A request entered the transport. Only original-operation readback can resolve it.
      }
    }
    const found = await driver.discover({...context,intent});
    if (!found) return {state:'original_operation_unresolved',provider:label,operationId:step.id,providerCallsResubmitted:0};
    const evidence = currentEvidence(label,evidenceFor(label,found,plan.operationId,receipts));
    await append('signing_provider.result',{operationId:step.id,planHash,provider:label,outcome:'verified',evidence});
    state = get();
    check(same(state.steps[index].result?.evidence,evidence),'SIGNING_SETUP_PROVIDER_RESULT_UNCONFIRMED');
    receipts.push(evidence);
    previousSteps.push({originalOperationId:step.id,intent,evidence});
  }
  const evidenceDigest = digest(receipts);
  if (!state.closed) await append('signing_setup.result',{operationId:plan.operationId,planHash,outcome:'verified',evidenceDigest});
  check(get().closed?.evidenceDigest === evidenceDigest,'SIGNING_SETUP_RESULT_UNCONFIRMED');
  return {state:'verified',ownerReceiptId:receipts.at(-1).deploymentReceiptId,evidenceDigest,providerCallsResubmitted:0};
}
