import { fcosSalesforceEnvironment } from '../../../config/fcosConnections.js';
import { isDigest, requireCondition } from './contract.mjs';

const operation = 'publication';
const stage = 'shared_mirror';

export async function promoteSalesSupportCorrection({ fingerprint, sourceTreeHash, verifySource, verifySandbox, context,
  sandbox, mirror, originalMirror, retainedMirror, production }) {
  const orgId = fcosSalesforceEnvironment('devee').orgId;
  const completed = result => {
    requireCondition(result?.verified === true && result.intentRecorded === true && isDigest(result.evidenceDigest),
      'TRADING_FX_SALES_SUPPORT_CORRECTION_CHECKPOINT_REQUIRED');
    const { operationId, evidenceDigest, verified, intentRecorded } = result;
    return { operationId, evidenceDigest, verified, intentRecorded };
  };
  await verifySource();
  const devee = await sandbox('devee');
  const deveeProof = completed(devee);
  await verifySandbox('devee');
  await verifySource();
  const readMirror = async () => (await context.journal.readCheckpoints())
    .find(row => row.stage === stage && row.operation === operation);
  let checkpoint = await readMirror();
  const deployment = { status: 'Succeeded', fingerprint, orgId, jobId: devee.jobId, validationJobId: null };
  let intent;
  if (!checkpoint) {
    const lease = await context.ownership.assert({ fingerprint, stage: 'devee', orgId, operation: 'shared-publication' });
    intent = { status: 'submitting', receiptId: lease.receiptId, receiptExpiresAt: lease.expiresAt };
    await context.journal.checkpoint({ fingerprint, stage, operation, record: intent });
  } else requireCondition(['pending', 'resolved'].includes(checkpoint.outcome), 'TRADING_FX_SALES_SUPPORT_MIRROR_CHECKPOINT_CHANGED');
  const mode = intent ? 'publish' : checkpoint.outcome === 'resolved' ? 'check' : 'recover';
  const checked = await mirror(mode, deployment, intent);
  requireCondition(checked?.sourceTreeHash === sourceTreeHash && checked.sourceDeploymentJobId === devee.jobId
    && checked.pullRequest?.number === originalMirror.pullRequest.number && checked.commit !== originalMirror.commit
    && (!retainedMirror || (checked.commit === retainedMirror.commit && retainedMirror.sourceTreeHash === sourceTreeHash
      && retainedMirror.pullRequest?.number === checked.pullRequest.number)),
  'TRADING_FX_SALES_SUPPORT_MIRROR_CHANGED');
  if (!checkpoint || checkpoint.outcome !== 'resolved') {
    await context.journal.checkpoint({ fingerprint, stage, operation, record: { status: 'Succeeded', result: checked } });
    checkpoint = await readMirror();
  }
  requireCondition(checkpoint?.outcome === 'resolved' && checkpoint.mirror?.commit === checked.commit,
    'TRADING_FX_SALES_SUPPORT_MIRROR_CHECKPOINT_CHANGED');
  const mirrorProof = completed({ operationId: 'salesforce:shared_mirror:sales-support-correction',
    evidenceDigest: checkpoint.evidenceDigest, verified: true, intentRecorded: true });
  const verifyMirror = async () => {
    const current = await mirror('check', deployment);
    requireCondition(current?.commit === checked.commit && current.sourceTreeHash === sourceTreeHash
      && current.sourceDeploymentJobId === devee.jobId && current.pullRequest?.number === checked.pullRequest.number,
    'TRADING_FX_SALES_SUPPORT_MIRROR_CHANGED');
  };
  await verifySource();
  const qat = completed(await sandbox('qat'));
  await verifySandbox('qat');
  await verifyMirror();
  await verifySource();
  const prod = completed(await production());
  return { operations: [deveeProof, mirrorProof, qat, prod], verifyMirror };
}
