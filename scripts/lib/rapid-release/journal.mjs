import { canonical, digest, requireCondition, targets } from './contract.mjs';

export const EVENT_TYPES = Object.freeze(['release.prepared', 'quality.passed', 'build.passed', 'stage.intent', 'stage.result',
  'smoke.passed', 'stage.pre_bootstrap_passed', 'approval.accepted', 'prerequisites.intent', 'prerequisites.result', 'prerequisites.passed', 'prerequisites.smoke_passed', 'promote.intent', 'promote.result', 'live.passed',
  'rollback.intent', 'rollback.result', 'release.complete', 'obstacle.detected', 'repair.attempted', 'repair.verified',
  'repair.disabled', 'release.waiting', 'salesforce.checkpoint', 'handover.completed']);
const forbiddenKeys = /(?:password|token|secret|cookie|authorizationheader|databaseurl|financialrecords|customeremail)/i;
export function assertPublicPayload(value, depth = 0) {
  requireCondition(depth <= 20, 'JOURNAL_PAYLOAD_DEPTH');
  if (typeof value === 'string') requireCondition(value.length <= 16000 && !/(?:Bearer\s+|sk-proj-|sb_secret_|postgres(?:ql)?:\/\/|-----BEGIN .*PRIVATE KEY)/i.test(value), 'JOURNAL_PRIVATE_VALUE');
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    requireCondition(!forbiddenKeys.test(key), 'JOURNAL_PRIVATE_FIELD'); assertPublicPayload(child, depth + 1);
  }
}
export function validateChain(records, manifestHash, releaseId) {
  const unique = new Map();
  for (const record of records) {
    const payload = record.payload;
    requireCondition(payload?.schemaVersion === 1 && payload.kind === 'fcos_rapid_release_event'
      && payload.manifestHash === manifestHash && payload.releaseId === releaseId && EVENT_TYPES.includes(payload.event), 'JOURNAL_RECORD_INVALID');
    const { recordHash, ...content } = payload;
    requireCondition(digest(content) === recordHash, 'JOURNAL_DIGEST_INVALID'); assertPublicPayload(payload);
    if (unique.has(recordHash)) requireCondition(canonical(unique.get(recordHash).payload) === canonical(payload), 'JOURNAL_DUPLICATE_CONFLICT');
    else unique.set(recordHash, record);
  }
  const chain = [...unique.values()].sort((a, b) => a.payload.sequence - b.payload.sequence);
  let previousHash = null;
  chain.forEach((record, index) => {
    requireCondition(record.payload.sequence === index && record.payload.previousHash === previousHash, 'JOURNAL_FORK_OR_GAP');
    previousHash = record.payload.recordHash;
  });
  return chain;
}
export class DeploymentJournal {
  constructor({ github, releaseId, manifestHash, actorIds }) { Object.assign(this, { github, releaseId, manifestHash, actorIds }); }
  async read() {
    const records = await this.github.pages(`/repos/${targets().repository}/deployments?environment=fcos-release-journal-v1&sha=${this.github.candidateSha}&per_page=100`);
    const own = records.filter(record => record.payload?.releaseId === this.releaseId);
    for (const record of own) requireCondition(this.actorIds.includes(record.creator?.id), 'JOURNAL_ACTOR_MISMATCH');
    return validateChain(own, this.manifestHash, this.releaseId);
  }
  async append(event, data, { expectedPreviousHash } = {}) {
    requireCondition(EVENT_TYPES.includes(event), 'JOURNAL_EVENT_INVALID'); assertPublicPayload(data);
    const chain = await this.read(), last = chain.at(-1)?.payload.recordHash || null;
    if (expectedPreviousHash !== undefined) requireCondition(last === expectedPreviousHash, 'JOURNAL_ADVANCED');
    const content = { schemaVersion: 1, kind: 'fcos_rapid_release_event', releaseId: this.releaseId,
      manifestHash: this.manifestHash, sequence: chain.length, previousHash: last, event, data };
    const payload = { ...content, recordHash: digest(content) };
    // Deployment OBJECT payloads retain recovery data; expiring statuses/artifacts are projections only.
    // A lost acknowledgement is read back, never blindly retried by this method.
    await this.github.write(`/repos/${targets().repository}/deployments`, {
      ref: this.github.candidateSha, task: 'fcos-release-journal', auto_merge: false,
      // This is an internal append-only record, not a deployment approval/check gate.
      // The executor independently verifies the exact native quality producer and final review.
      required_contexts: [], environment: 'fcos-release-journal-v1',
      production_environment: false, transient_environment: false, payload,
    });
    const written = (await this.read()).filter(record => record.payload.recordHash === payload.recordHash);
    requireCondition(written.length === 1, 'JOURNAL_WRITE_UNCERTAIN'); return written[0];
  }
  async assertNoUnresolvedOtherRelease() {
    const records = await this.github.pages(`/repos/${targets().repository}/deployments?environment=fcos-release-journal-v1&per_page=100`);
    const releases = new Map();
    for (const record of records) {
      const p = record.payload;
      if (p?.kind !== 'fcos_rapid_release_event' || p.releaseId === this.releaseId) continue;
      requireCondition(this.actorIds.includes(record.creator?.id), 'JOURNAL_ACTOR_MISMATCH');
      const group = releases.get(p.releaseId) || []; group.push(record); releases.set(p.releaseId, group);
    }
    for (const [id, group] of releases) {
      const chain = validateChain(group, group[0].payload.manifestHash, id);
      requireCondition(!pendingOperations(chain).length, 'EARLIER_RELEASE_OUTCOME_UNRESOLVED');
    }
  }
}
export function pendingOperations(chain) {
  const pending = new Map();
  for (const { payload: { event, data } } of chain) {
    if (event.endsWith('.intent')) pending.set(data.operationId, { event, data });
    if (event.endsWith('.result')) pending.delete(data.operationId);
  }
  return [...pending.values()];
}
export class MemoryJournal {
  constructor() { this.records = []; }
  async read() { return this.records; }
  async append(event, data) { assertPublicPayload(data); const record = { payload: { event, data } }; this.records.push(record); return record; }
  async assertNoUnresolvedOtherRelease() {}
}
