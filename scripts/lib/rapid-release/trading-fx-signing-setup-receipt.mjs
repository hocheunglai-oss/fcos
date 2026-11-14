import { digest, requireCondition as check, targets } from './contract.mjs';
import { TRADING_FX_SIGNING_ENVIRONMENT, TRADING_FX_SIGNING_TASK } from './trading-fx-signing-config.mjs';

const positiveId = value => Number.isSafeInteger(value) && value > 0;

export function createSigningReceiptDriver({ github, ownerId, readEnvironment, verifyPredecessor }) {
  const pins = targets(), base = '/repos/' + pins.repository;
  async function payload({plan, receipts, previousSteps, observedAt, originalOperationId}) {
    await verifyPredecessor(plan);
    const [certificate, config] = receipts;
    const postimage = await readEnvironment({plan,receipts:receipts.slice(0,1),previousSteps:previousSteps.slice(0,1),...previousSteps[1]});
    check(postimage,'SIGNING_SETUP_RECEIPT_PROVIDER_DRIFT');
    check(postimage.evidence.configurationDigest === config.configurationDigest
      && postimage.evidence.fullEnvironmentDigest === config.fullEnvironmentDigest
      && digest(postimage.changed) === config.rowDigest, 'SIGNING_SETUP_RECEIPT_PROVIDER_DRIFT');
    const evidence = {kind:'fcos_trading_fx_signing_config',schemaVersion:1,repository:plan.repository,
      candidateSha:plan.candidateSha,sourceDigest:plan.sourceDigest,controllerSha:plan.controllerSha,
      previousDeploymentId:plan.previous.deploymentId,previousSha:plan.previous.sha,
      previousConfigurationDigest:plan.previous.configurationDigest,configurationDigest:config.configurationDigest,
      projectId:plan.vercelProject,teamId:plan.vercelTeam,productionOrgId:plan.salesforceOrg,
      certificateName:certificate.certificateName,certificatePublicKeyDigest:certificate.publicKeyDigest,
      certificateExpiresAt:certificate.expiresAt,privateKeyExportable:false,isSandbox:false,
      possessionProofDigest:certificate.possessionProofDigest,changed:postimage.changed,observedAt};
    return {ref:plan.candidateSha,task:TRADING_FX_SIGNING_TASK,environment:TRADING_FX_SIGNING_ENVIRONMENT,
      production_environment:false,transient_environment:false,auto_merge:false,required_contexts:[],
      description:originalOperationId,payload:evidence};
  }

  async function find({plan,originalOperationId, intent, ...context}) {
    const request = await payload({plan,originalOperationId,...context,observedAt:intent.submittedAt});
    check(request.payload.observedAt === intent.submittedAt && request.description === intent.operationId
      && digest({...request,payload:{...request.payload,observedAt:null}}) === intent.requestDigest,
      'SIGNING_SETUP_RECEIPT_REQUEST_CHANGED');
    const rows = await github.pages(base+'/deployments?environment='+TRADING_FX_SIGNING_ENVIRONMENT+'&sha='+plan.candidateSha+'&per_page=100');
    const matches = rows.filter(row => row.description === originalOperationId || digest(row.payload ?? null) === digest(request.payload));
    check(matches.length <= 1,'SIGNING_SETUP_RECEIPT_AMBIGUOUS');
    const row = matches[0];
    if (!row) return null;
    check(positiveId(row.id) && row.creator?.id === ownerId && row.creator?.login === pins.account && row.creator?.type === 'User'
      && row.ref === plan.candidateSha && row.sha === plan.candidateSha && row.repository_url === 'https://api.github.com'+base
      && row.task === TRADING_FX_SIGNING_TASK && row.environment === TRADING_FX_SIGNING_ENVIRONMENT
      && row.original_environment === TRADING_FX_SIGNING_ENVIRONMENT && row.production_environment === false
      && row.transient_environment === false && row.description === originalOperationId
      && digest(row.payload) === digest(request.payload),'SIGNING_SETUP_RECEIPT_READBACK_CHANGED');
    return {deploymentReceiptId:row.id,ownerReceiptDigest:digest(row.payload),
      configurationDigest:row.payload.configurationDigest,operationId:plan.operationId};
  }

  return {
    async preflight(context) {
      const rows = await github.pages(base+'/deployments?environment='+TRADING_FX_SIGNING_ENVIRONMENT+'&sha='+context.plan.candidateSha+'&per_page=100');
      check(rows.every(row => row.description !== context.originalOperationId),'SIGNING_SETUP_RECEIPT_ALREADY_EXISTS');
      return digest(await payload({...context,observedAt:null}));
    },
    async submit(context) {
      const request = await payload({...context,observedAt:context.intent.submittedAt});
      check(digest({...request,payload:{...request.payload,observedAt:null}}) === context.intent.requestDigest
        && !await find(context),'SIGNING_SETUP_RECEIPT_REQUEST_CHANGED');
      await context.assertSubmission();
      await github.write(base+'/deployments',request);
    },
    discover: find,
    async verify(context) { return digest(await find(context) ?? null) === digest(context.evidence); },
  };
}
