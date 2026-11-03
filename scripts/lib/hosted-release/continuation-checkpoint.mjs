import { createHash, randomUUID } from 'node:crypto';
import { openSync, closeSync, writeFileSync, readFileSync, fsyncSync, renameSync, unlinkSync, realpathSync, statSync, lstatSync, fstatSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const hash = value => createHash('sha256').update(value).digest('hex');
const requireFact = (value, code) => { if (!value) throw new Error(code); };
const countKeys = ['remoteStatusPosts', 'existingGrantRefreshes', 'workflowDispatches', 'compatibilityPreviews', 'organisationsProbeAttempts'];
const legacyCounts = { remoteStatusPosts:'normalStatusRemoteAdmitted', existingGrantRefreshes:'normalStatusNewRefreshes',
  workflowDispatches:'newWorkflowDispatches', compatibilityPreviews:'newCompatibilityPreviewCountConsumed',
  organisationsProbeAttempts:'organisationsProbeAttempts' };
const sameQuestion = (a, b) => Boolean(a && b
  && (!a.questionItemId || !b.questionItemId || a.questionItemId === b.questionItemId)
  && a.scope?.sha256 === b.scope?.sha256 && a.questionRecord?.sha256 === b.questionRecord?.sha256
  && a.expectedAnswer === b.expectedAnswer && a.tool === b.tool && a.questionIndex === b.questionIndex);

/** Operator state only: this record never grants authority or resolves an outcome. */
export function harmonizeContinuationCheckpoint(previous, update, { now = Date.now } = {}) {
  requireFact(previous && typeof previous === 'object' && update && typeof update === 'object', 'CONTINUATION_STATE_REQUIRED');
  requireFact(/^[a-z][a-z0-9_]{2,99}$/.test(update.status || '') && typeof update.next === 'string' && update.next.trim(), 'CONTINUATION_CURRENT_PHASE_REQUIRED');
  requireFact(Array.isArray(update.evidenceRefs) && update.evidenceRefs.length > 0 && update.evidenceRefs.every(r =>
    typeof r?.path === 'string' && /^[a-f0-9]{64}$/.test(r.sha256 || '')), 'CONTINUATION_ACTUAL_EVIDENCE_REQUIRED');
  const time = now();
  requireFact(Number.isFinite(time), 'CONTINUATION_REAL_CLOCK_REQUIRED');
  const pending = Object.hasOwn(update, 'pendingHumanDecision') ? update.pendingHumanDecision : previous.pendingHumanDecision ?? null;
  requireFact(!(previous.pendingHumanDecision?.presented === true && previous.pendingHumanDecision.actualAnswerReceived === false
    && !sameQuestion(previous.pendingHumanDecision, pending)),
    'CONTINUATION_UNANSWERED_DECISION_CANNOT_DISAPPEAR');
  requireFact(!(previous.pendingHumanDecision?.actualAnswerReceived === true && sameQuestion(previous.pendingHumanDecision, pending)
    && pending.actualAnswerReceived !== true), 'CONTINUATION_ANSWERED_DECISION_CANNOT_REOPEN');
  if (sameQuestion(previous.pendingHumanDecision, pending)) {
    for (const key of ['questionItemId', 'actualApprovalRef', 'actualReplyEnvelopeRef']) {
      const prior = previous.pendingHumanDecision[key];
      if (prior !== undefined && prior !== null) requireFact(isDeepStrictEqual(prior, pending[key]),
        'CONTINUATION_DECISION_PROVENANCE_IMMUTABLE');
    }
  }
  if (update.status.startsWith('waiting_human')) requireFact(pending?.presented === true && pending.actualAnswerReceived === false
    && pending.approvalInferred !== true && typeof pending.expectedAnswer === 'string'
    && /^[a-f0-9]{64}$/.test(pending.scope?.sha256 || ''), 'CONTINUATION_UNANSWERED_EXACT_DECISION_REQUIRED');
  const consumption = { ...(previous.currentState?.consumption || {}), ...(update.consumption || {}) };
  for (const key of countKeys) {
    const observed = [previous.currentState?.consumption?.[key] ?? 0, previous.activeContinuation?.[legacyCounts[key]] ?? 0];
    requireFact(observed.every(n => Number.isSafeInteger(n) && n >= 0), 'CONTINUATION_PREVIOUS_CONSUMPTION_INVALID');
    const before = Math.max(...observed);
    const after = consumption[key] ?? before;
    requireFact(Number.isSafeInteger(after) && after >= before && after >= 0, 'CONTINUATION_CONSUMPTION_CANNOT_DECREASE');
    consumption[key] = after;
  }
  requireFact(update.status !== 'complete' || update.productionStagesVerified === 2 && update.remainingRequiredPaths === 0,
    'CONTINUATION_UNRESOLVED_WORK_NOT_COMPLETE');
  const capturedAt = new Date(time).toISOString();
  const historicalCurrentStates = [...(previous.historicalCurrentStates || []), {
    status: previous.status ?? null, capturedAt: previous.capturedAt ?? null, next: previous.next ?? null,
    activeStatus: previous.activeContinuation?.status ?? null, activeNext: previous.activeContinuation?.next ?? null,
    supersededAt: capturedAt,
  }];
  const currentState = { status: update.status, next: update.next, capturedAt, consumption,
    evidenceRefs: update.evidenceRefs, pendingHumanDecision: pending,
    stateDoesNotGrantAuthority: true, ...(update.dependency ? { dependency: update.dependency } : {}) };
  const completedHumanDecisionHistory = [...(previous.completedHumanDecisionHistory || [])];
  if (!sameQuestion(previous.pendingHumanDecision, pending) && previous.pendingHumanDecision?.actualAnswerReceived === true
    && !completedHumanDecisionHistory.some(x => sameQuestion(x, previous.pendingHumanDecision)
      && x.actualApprovalRef?.sha256 === previous.pendingHumanDecision.actualApprovalRef?.sha256))
    completedHumanDecisionHistory.push(previous.pendingHumanDecision);
  const activeCounts = Object.fromEntries(countKeys.map(key => [legacyCounts[key], consumption[key]]));
  const result = { ...previous, historicalCurrentStates, completedHumanDecisionHistory, currentState,
    activeContinuation: { ...(previous.activeContinuation || {}), ...(update.activePatch || {}),
      ...activeCounts, status: currentState.status, next: currentState.next, currentState },
    status: currentState.status, next: currentState.next, capturedAt, lastMeaningfulProgressRecordedAt: capturedAt,
    pendingHumanDecision: pending };
  assertContinuationCheckpointConsistency(result);
  return result;
}

export function assertContinuationCheckpointConsistency(value) {
  const current = value?.currentState;
  requireFact(current?.stateDoesNotGrantAuthority === true && value.status === current.status
    && value.activeContinuation?.status === current.status && value.next === current.next
    && value.activeContinuation?.next === current.next && value.capturedAt === current.capturedAt,
  'CONTINUATION_CONTRADICTORY_CURRENT_ALIASES');
  if (current.status.startsWith('waiting_human')) requireFact(value.pendingHumanDecision?.actualAnswerReceived === false,
    'CONTINUATION_ANSWERED_DECISION_NOT_PENDING');
  for (const key of countKeys) requireFact(value.activeContinuation[legacyCounts[key]] === current.consumption[key],
    'CONTINUATION_CONTRADICTORY_CONSUMPTION');
  return true;
}

/** Serialized local replacement. All cooperating writers must use this lock. */
export function writeAuthoritativeContinuation(checkpointPath, update, { expectedPriorSha256, now = Date.now } = {}) {
  const target = resolve(checkpointPath);
  requireFact(realpathSync(target) === target && statSync(target).isFile(), 'CONTINUATION_PHYSICAL_FILE_REQUIRED');
  const lockPath = target + '.write-lock', owner = JSON.stringify({ pid:process.pid, token:randomUUID() });
  let lock;
  try { lock = openSync(lockPath, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('CONTINUATION_WRITER_BUSY'); throw error; }
  const held = fstatSync(lock);
  let ownerWritten = false;
  try {
  writeFileSync(lock, owner); fsyncSync(lock); ownerWritten = true;
  requireFact(realpathSync(target) === target && statSync(target).isFile(), 'CONTINUATION_PHYSICAL_FILE_REQUIRED');
  const original = readFileSync(target);
  requireFact(/^[a-f0-9]{64}$/.test(expectedPriorSha256 || '') && hash(original) === expectedPriorSha256,
    'CONTINUATION_COMPARE_AND_SWAP_FAILED');
  for (const ref of update.evidenceRefs || []) requireFact(realpathSync(ref.path) === ref.path
    && statSync(ref.path).isFile() && hash(readFileSync(ref.path)) === ref.sha256, 'CONTINUATION_EVIDENCE_CHANGED');
  const result = harmonizeContinuationCheckpoint(JSON.parse(original), update, { now });
  const temporary = target + '.owned-' + randomUUID() + '.tmp';
  const fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(result, null, 2) + '\n'); fsyncSync(fd); }
  finally { closeSync(fd); }
  if (hash(readFileSync(target)) !== expectedPriorSha256) {
    unlinkSync(temporary); throw new Error('CONTINUATION_COMPARE_AND_SWAP_FAILED');
  }
  renameSync(temporary, target);
  const directory = openSync(dirname(target), 'r');
  try { fsyncSync(directory); } finally { closeSync(directory); }
  return { checkpointPath: target, sha256: hash(readFileSync(target)), currentState: result.currentState };
  } finally {
    closeSync(lock);
    const current = lstatSync(lockPath);
    requireFact(current.ino === held.ino && current.dev === held.dev && !current.isSymbolicLink()
      && (!ownerWritten || readFileSync(lockPath, 'utf8') === owner), 'CONTINUATION_LOCK_OWNERSHIP_CHANGED');
    unlinkSync(lockPath);
  }
}
