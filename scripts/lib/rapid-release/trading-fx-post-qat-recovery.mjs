import { FCOS_CONNECTION_POLICY } from '../../../config/fcosConnections.js';
import { assertAuthorization, digest, isDigest, requireCondition, targets, validateManifest } from './contract.mjs';
import { DeploymentJournal, pendingOperations } from './journal.mjs';
import { LOCAL_MIRROR_ENVIRONMENT, verifyLocalMirrorReceipt } from './local-mirror-handoff.mjs';
import { assertFrozenWorkflow, nativeWorkflowPath } from './providers.mjs';

const policy = FCOS_CONNECTION_POLICY.providers.find(({ id }) => id === 'salesforce');
const botId = 41898282;
const journalEnvironment = 'fcos-release-journal-v1';
const workflowPath = '.github/workflows/fcos-rapid-release.yml';
const sandboxStages = ['devee', 'qat'];
const jobOperations = ['bootstrap', 'validation', 'deployment'];
const permissionName = 'Fcos_Trading_FX_Data';
export const TRADING_FX_POST_QAT_STOPPED = 'trading_fx_stopped_after_qat_deployment_with_verified_partial_effects';
const positive = value => Number.isSafeInteger(value) && value > 0;
const jobId = value => /^0Af[A-Za-z0-9]{15}$/u.test(value || '');
const isBot = row => row?.creator?.id === botId && row.creator.login === 'github-actions[bot]';
const sequence = row => row.payload.sequence;
const dataOf = row => row?.payload?.data;
const checkpointKey = data => `${data.stage}:${data.operation}`;
const same = (left, right) => digest(left ?? null) === digest(right ?? null);

// A read-only bridge from a terminal attempt on identical application and Salesforce
// source. This checks provenance only; the successor still rereads the actual jobs,
// inventories, permission assignments, mirror head and original database operation.
export async function readTradingFxPostQatRecovery({ manifest, github, receiptId, ownerId, readQatRecovery }) {
  validateManifest(manifest);
  const nextPlan = manifest.prerequisites?.plan;
  requireCondition(manifest.prerequisites?.adapter === 'trading-fx-prerequisites'
    && positive(receiptId) && nextPlan?.tradingFxPostQatRecoveryReceiptId === receiptId
    && nextPlan.tradingFxQatRecoveryReceiptId === undefined && nextPlan.tradingFxRecoveryReceiptId === undefined
    && ownerId === policy.publication.requiredAccountId && typeof readQatRecovery === 'function', 'TRADING_FX_POST_QAT_RECOVERY_LOCATOR_INVALID');
  const base = '/repos/' + targets().repository;
  const deployment = id => github.read(base + '/deployments/' + id);
  const owner = row => row?.creator?.id === ownerId && row.creator.login === targets().account;
  const receipt = await deployment(receiptId);
  const event = receipt?.payload;
  const closure = dataOf(receipt);
  requireCondition(receipt?.id === receiptId && owner(receipt) && receipt.environment === journalEnvironment
    && receipt.sha === manifest.candidate.sha && event?.kind === 'fcos_rapid_release_event'
    && event.event === 'prerequisites.result' && isDigest(event.manifestHash) && event.releaseId !== manifest.releaseId
    && closure?.outcome === TRADING_FX_POST_QAT_STOPPED && isDigest(closure.evidenceDigest) && jobId(closure.qatDeploymentJob)
    && [closure.originalRunId, closure.originalIntent, closure.databaseClosure, closure.previousRecoveryClosure, closure.mirrorReceipt].every(positive),
  'TRADING_FX_POST_QAT_CLOSURE_REQUIRED');

  const journal = new DeploymentJournal({ github: { ...github, candidateSha: receipt.sha }, actorIds: [ownerId, botId],
    manifestHash: event.manifestHash, releaseId: event.releaseId });
  const [chain, run, mirrorReceipt] = await Promise.all([journal.read(),
    github.read(base + '/actions/runs/' + closure.originalRunId), deployment(closure.mirrorReceipt)]);
  const historical = chain.slice(0, -1);
  const uniqueBotEvent = name => {
    const matches = historical.filter(row => row.payload.event === name);
    return matches.length === 1 && isBot(matches[0]) ? matches[0] : undefined;
  };
  const prepared = uniqueBotEvent('release.prepared');
  const prior = dataOf(prepared)?.manifest;
  const oldPlan = prior?.prerequisites?.plan;
  requireCondition(prior && oldPlan && validateManifest(prior) === event.manifestHash && prior.releaseId === event.releaseId
    && prior.controllerSha !== manifest.controllerSha && prior.prerequisites.adapter === manifest.prerequisites.adapter
    && oldPlan.tradingFxQatRecoveryReceiptId === closure.previousRecoveryClosure && oldPlan.tradingFxRecoveryReceiptId === undefined
    && oldPlan.tradingFxPostQatRecoveryReceiptId === undefined && oldPlan.mirrorPublication === 'local-collaborator'
    && oldPlan.backwardCompatible === true && isDigest(oldPlan.salesforceFingerprint) && isDigest(oldPlan.salesforceSourceTreeHash),
  'TRADING_FX_POST_QAT_MANIFEST_CHANGED');
  const { tradingFxQatRecoveryReceiptId, ...retainedPlan } = oldPlan;
  const { tradingFxPostQatRecoveryReceiptId: _postQatLocator, ...successorPlan } = nextPlan;
  requireCondition(same(retainedPlan, successorPlan)
    && ['candidate', 'previous', 'paths', 'moduleInventory', 'selection', 'build'].every(field => same(prior[field], manifest[field])),
  'TRADING_FX_POST_QAT_MANIFEST_CHANGED');

  const staged = uniqueBotEvent('stage.result');
  const approval = uniqueBotEvent('approval.accepted');
  const intent = uniqueBotEvent('prerequisites.intent');
  const request = { planDigest: digest(prior.prerequisites), candidateSha: receipt.sha };
  const operationId = `${prior.releaseId}-prerequisites`;
  const pending = pendingOperations(historical);
  const authority = [prepared, staged, approval, intent];
  requireCondition(chain.at(-1)?.id === receiptId && chain.at(-1).payload.recordHash === event.recordHash
    && chain.every(row => row.sha === receipt.sha && row.environment === journalEnvironment && positive(row.id))
    && historical.every(row => isBot(row) && !/^(?:promote\.|rollback\.|live\.|release\.complete|prerequisites\.(?:result|passed|smoke_passed|database_submitting))/u.test(row.payload.event))
    && pending.length === 1 && pending[0].event === 'prerequisites.intent' && same(pending[0].data, dataOf(intent))
    && pendingOperations(chain).length === 0 && closure.operationId === operationId && intent?.id === closure.originalIntent
    && same(dataOf(intent), { operationId, requestHash: digest(request), request })
    && dataOf(staged)?.outcome === 'applied' && dataOf(staged).result?.sha === receipt.sha
    && dataOf(staged).result.manifestHash === event.manifestHash && dataOf(staged).result.buildId === prior.build.buildId
    && isDigest(dataOf(staged).result.artifactDigest) && dataOf(approval)?.runId === closure.originalRunId
    && authority.every((row, index) => row && (!index || sequence(authority[index - 1]) < sequence(row))),
  'TRADING_FX_POST_QAT_ORIGINAL_OPERATION_REQUIRED');
  assertAuthorization(dataOf(approval), prior, dataOf(staged).result, Date.parse(approval.created_at));

  const title = new RegExp(`^FCOS rapid (?:release|resume) ${event.manifestHash} ${receipt.sha}$`, 'u');
  requireCondition(run?.id === closure.originalRunId && run.repository?.full_name === targets().repository
    && run.actor?.id === ownerId && run.actor.login === targets().account && run.event === 'workflow_dispatch'
    && nativeWorkflowPath(run) === workflowPath && title.test(run.display_title || '') && positive(run.run_attempt)
    && run.status === 'completed' && run.conclusion === 'failure', 'TRADING_FX_POST_QAT_TERMINAL_RUN_REQUIRED');

  const checkpointRows = historical.filter(row => row.payload.event === 'salesforce.checkpoint');
  const productionReadbacks = ['inventory-checkpoint', 'restoration-checkpoint'];
  requireCondition(checkpointRows.every(row => sequence(row) > sequence(intent)
    && dataOf(row)?.fingerprint === oldPlan.salesforceFingerprint && isDigest(dataOf(row).evidenceDigest)
    && (dataOf(row).stage !== 'production' || dataOf(row).outcome === 'evidence' && productionReadbacks.includes(dataOf(row).operation))),
  'TRADING_FX_POST_QAT_CHECKPOINT_REQUIRED');
  const checkpoints = new Map(checkpointRows.map(row => [checkpointKey(dataOf(row)), row]));
  const get = key => {
    const row = checkpoints.get(key);
    requireCondition(dataOf(row)?.outcome === 'resolved', 'TRADING_FX_POST_QAT_CHECKPOINT_REQUIRED');
    return row;
  };
  const jobs = sandboxStages.flatMap(stage => jobOperations.map(operation => get(`${stage}:${operation}`)));
  for (const row of jobs) {
    const { operation, job } = dataOf(row);
    requireCondition(jobId(job?.id) && Number.isFinite(Date.parse(job.submittedAt))
      && (operation === 'deployment' ? jobId(job.validationId) && job.packageSha256 === undefined : job.validationId === null && isDigest(job.packageSha256))
      && (operation === 'bootstrap' || checkpointRows.some(entry => sequence(entry) < sequence(row)
        && dataOf(entry).outcome === 'pending' && checkpointKey(dataOf(entry)) === checkpointKey(dataOf(row)) && same(dataOf(entry).job, job))),
    'TRADING_FX_POST_QAT_CHECKPOINT_REQUIRED');
  }
  const permissions = sandboxStages.map(stage => {
    const row = get(`${stage}:permission:${permissionName}`);
    const permission = dataOf(row).permission;
    requireCondition(permission?.name === permissionName && permission.orgId === policy.environments.find(item => item.key === stage).orgId
      && typeof permission.prestate === 'boolean', 'TRADING_FX_POST_QAT_CHECKPOINT_REQUIRED');
    return row;
  });
  const [deveeBootstrap, deveeValidation, deveeDeployment, qatBootstrap, qatValidation, qatDeployment] = jobs;
  const mirror = get('shared_mirror:publication');
  const ownedOperations = new Set([...jobs, ...permissions, mirror].map(row => checkpointKey(dataOf(row))));
  requireCondition([...checkpoints.values()].every(row => dataOf(row).outcome === 'evidence' || ownedOperations.has(checkpointKey(dataOf(row))))
    && new Set(jobs.map(row => dataOf(row).job.id)).size === jobs.length
    && dataOf(deveeDeployment).job.validationId === dataOf(deveeValidation).job.id
    && dataOf(qatDeployment).job.validationId === dataOf(qatValidation).job.id && dataOf(qatDeployment).job.id === closure.qatDeploymentJob
    && [deveeBootstrap, deveeValidation, deveeDeployment, mirror, qatValidation, qatDeployment].every((row, index, ordered) =>
      !index || sequence(ordered[index - 1]) < sequence(row)) && sequence(qatBootstrap) < sequence(qatValidation)
    && permissions.every((row, index) => sequence(row) < sequence([deveeValidation, qatValidation][index])),
  'TRADING_FX_POST_QAT_CHECKPOINT_ORDER_CHANGED');

  requireCondition(mirrorReceipt?.id === closure.mirrorReceipt && owner(mirrorReceipt)
    && mirrorReceipt.environment === LOCAL_MIRROR_ENVIRONMENT && positive(mirrorReceipt.payload?.requestId), 'TRADING_FX_POST_QAT_ORIGINAL_MIRROR_REQUIRED');
  const [mirrorRequest, runJobs] = await Promise.all([deployment(mirrorReceipt.payload.requestId),
    github.read(`${base}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`),
    assertFrozenWorkflow({ github, controllerSha: prior.controllerSha, dispatcherSha: run.head_sha })]);
  const goLive = runJobs?.jobs?.filter(row => row.name === 'go-live');
  requireCondition(goLive?.length === 1 && goLive[0].status === 'completed' && goLive[0].conclusion === 'failure'
    && Date.parse(goLive[0].completed_at) >= Date.parse(qatDeployment.created_at)
    && Date.parse(receipt.created_at) >= Date.parse(goLive[0].completed_at), 'TRADING_FX_POST_QAT_TERMINAL_RUN_REQUIRED');
  const publication = mirrorRequest?.payload;
  const mirrorIntent = checkpointRows.find(row => sequence(row) < sequence(mirror) && dataOf(row).stage === 'shared_mirror'
    && dataOf(row).operation === 'publication' && dataOf(row).outcome === 'pending' && dataOf(row).evidenceDigest === publication?.intentHash);
  requireCondition(mirrorRequest?.id === mirrorReceipt.payload.requestId && isBot(mirrorRequest)
    && publication?.manifestHash === event.manifestHash && publication.controllerSha === prior.controllerSha && publication.candidateSha === receipt.sha
    && publication.runId === run.id && publication.runAttempt === run.run_attempt && publication.mode === 'publish'
    && publication.deveeOrgId === policy.environments.find(item => item.key === 'devee').orgId
    && publication.deploymentJobId === dataOf(deveeDeployment).job.id && publication.validationJobId === dataOf(deveeValidation).job.id
    && mirrorIntent && sequence(deveeDeployment) < sequence(mirrorIntent)
    && Date.parse(mirrorIntent.created_at) <= Date.parse(mirrorRequest.created_at)
    && Date.parse(mirrorReceipt.created_at) <= Date.parse(mirror.created_at), 'TRADING_FX_POST_QAT_ORIGINAL_MIRROR_REQUIRED');
  const proof = verifyLocalMirrorReceipt({ request: publication, requestDeployment: mirrorRequest, receiptDeployment: mirrorReceipt,
    reviewed: { fingerprint: oldPlan.salesforceFingerprint, binding: { sourceTreeHash: oldPlan.salesforceSourceTreeHash } },
    workflowActorId: botId, publisherId: ownerId, now: Date.parse(mirrorReceipt.created_at) });
  requireCondition(same(dataOf(mirror).mirror, { commit: proof.commit, pullRequest: proof.pullRequest.number }),
    'TRADING_FX_POST_QAT_ORIGINAL_MIRROR_REQUIRED');

  const nested = await readQatRecovery(prior);
  requireCondition(nested?.receipt?.id === tradingFxQatRecoveryReceiptId
    && nested.receipt.payload?.data?.databaseClosure === closure.databaseClosure
    && nested.database?.schemaDigest === manifest.previous.schemaDigest
    && isDigest(nested.database.operationDigest) && isDigest(nested.database.baselineSchemaDigest)
    && typeof nested.database.operationId === 'string'
    && nested.bootstrap?.length === sandboxStages.length && nested.permissions?.length === sandboxStages.length
    && [deveeBootstrap, qatBootstrap].every(row => nested.bootstrap.some(original => dataOf(original)?.stage === dataOf(row).stage
      && same(dataOf(original).job, dataOf(row).job)))
    && permissions.every(row => nested.permissions.some(original => dataOf(original)?.stage === dataOf(row).stage
      && same(dataOf(original).permission, dataOf(row).permission))), 'TRADING_FX_POST_QAT_ORIGINAL_DATABASE_OR_BOOTSTRAP_REQUIRED');
  return { prior, nested, database: nested.database, receipt, jobs, permissions, mirror: { checkpoint: mirror, receipt: mirrorReceipt, request: mirrorRequest } };
}
