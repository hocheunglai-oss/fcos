import { digest, fail } from './contract.mjs';

const time = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const seconds = (end, start) => end !== null && start !== null ? Math.max(0, end - start) / 1000 : null;
/** Only observed timestamps are used. Overlapping compute is reported separately
 * from wall time; an unobserved queue/approval timestamp remains null. */
export function releaseTiming({ run, jobs, approval, prerequisiteCompletedAt, recoveredRunIds = [] }) {
  const created = time(run.created_at), start = time(run.run_started_at);
  const completed = jobs.filter(row => row.status === 'completed').map(row => time(row.completed_at)).filter(value => value !== null);
  const computeSeconds = jobs.reduce((sum, row) => sum + (seconds(time(row.completed_at), time(row.started_at)) || 0), 0);
  return { runId: run.id, initialQueueSeconds: seconds(start, created), computeSeconds,
    approvalWaitSeconds: seconds(time(approval?.approvedAt), time(prerequisiteCompletedAt)),
    wallSeconds: completed.length ? seconds(Math.max(...completed), created) : null,
    recovery: { runIds: [...new Set(recoveredRunIds)], currentRunIsRecovery: recoveredRunIds.length > 0 },
    phases: jobs.map(row => ({ name: row.name, status: row.status, conclusion: row.conclusion,
      startedAt: row.started_at, completedAt: row.completed_at, computeSeconds: seconds(time(row.completed_at), time(row.started_at)) })) };
}

export function releaseNotification({ manifest, status, phase, runId, missing = [] }) {
  const events = { ready: 'approval_actionable', intervention_required: 'intervention_required', failed: 'intervention_required',
    rolled_back: 'rolled_back', complete: 'complete', qualification_passed: 'qualification_complete' };
  const event = events[status];
  if (!event) return null;
  if (!/^[1-9][0-9]*$/.test(String(runId))) fail('NOTIFICATION_RUN');
  return { schemaVersion: 2, event, key: digest({ releaseId: manifest.releaseId, event, phase: phase || null, missing }),
    releaseId: manifest.releaseId, manifestHash: digest(manifest), phase: phase || null, missing,
    url: `https://github.com/${manifest.targets.repository}/actions/runs/${runId}`,
    delivery: { channel: 'github_native', iphoneReceiptVerified: false } };
}

export function assertNotificationDeliveryReceipt({ receipt, challenge, repository, operator }) {
  if (receipt?.challenge !== challenge || receipt.repository !== repository || receipt.operator !== operator
    || receipt.device !== 'iphone' || receipt.confirmedByHuman !== true || !Number.isFinite(time(receipt.receivedAt))) fail('IPHONE_DELIVERY_NOT_VERIFIED');
  return true;
}
