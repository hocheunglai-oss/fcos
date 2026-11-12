// @ts-check
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';

// Provisional Apex budget; activation still requires measured DEVEE heap proof.
export const FILING_LIMITS = Object.freeze({ file: 512 * 1024, batch: 4 * 1024 * 1024, count: 8 });
const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
export const filingError = (code, status = 409) => Object.assign(new Error(code.replaceAll('_', ' ')), { code, status });
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value ?? null);
}
export const filingHash = (value) => createHash('sha256').update(Buffer.isBuffer(value) || typeof value === 'string' ? value : canonical(value)).digest('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function filingManifest(files) {
  if (!Array.isArray(files) || !files.length || files.length > FILING_LIMITS.count) throw filingError('INVALID_FILE_COUNT', 400);
  const seen = new Set();
  const manifest = files.map((f) => {
    const ext = String(f?.name || '').split('.').pop()?.toLowerCase();
    if (!f || !ext || MIME[ext] !== f.mime || !f.name || f.name.length > 180 || /[\\/\x00-\x1f\x7f]/u.test(f.name)
      || !Number.isSafeInteger(f.size) || f.size < 1 || f.size > FILING_LIMITS.file || !/^[a-f0-9]{64}$/.test(f.sha256)
      || typeof f.id !== 'string' || !f.id || f.id.length > 180 || typeof f.sourceId !== 'string' || !f.sourceId || f.sourceId.length > 256) throw filingError('UNSUPPORTED_FILE', 400);
    if (seen.has(f.id) || seen.has(`${f.name}:${f.sha256}`)) throw filingError('DUPLICATE_SELECTION', 400);
    seen.add(f.id); seen.add(`${f.name}:${f.sha256}`);
    return { id: f.id, sourceId: f.sourceId, name: f.name, mime: f.mime, size: f.size, sha256: f.sha256 };
  });
  if (manifest.reduce((n, f) => n + f.size, 0) > FILING_LIMITS.batch) throw filingError('BATCH_TOO_LARGE', 413);
  if (new Set(manifest.map((f) => f.sourceId)).size !== 1) throw filingError('MESSAGE_SNAPSHOT_CHANGED');
  if (new Set(manifest.map((f) => f.mime)).size !== 1) throw filingError('MIXED_FORMAT_VERSIONS_UNVERIFIED');
  return manifest;
}

export function filingBytes(file, identity) {
  if (typeof file?.base64 !== 'string' || file.base64.length > Math.ceil(FILING_LIMITS.file / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64)) throw filingError('INVALID_FILE_DATA', 400);
  const bytes = Buffer.from(file.base64, 'base64');
  if (bytes.length !== identity.size || bytes.toString('base64') !== file.base64 || filingHash(bytes) !== identity.sha256) throw filingError('FILE_CHANGED', 400);
  const valid = identity.mime === 'application/pdf' ? bytes.subarray(0, 5).toString() === '%PDF-'
    : identity.mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!valid) throw filingError('FILE_SIGNATURE_MISMATCH', 400);
  return bytes;
}

// Dependencies are explicitly supplied; importing this module cannot make a provider call.
export function createNominationFilingService({ ledger, gateway, authorize, targets = async (_context) => [], now = Date.now }) {
  async function access(context, destination) {
    if (!context?.profile?.active || !context.profile.id) throw filingError('ACTIVE_USER_REQUIRED', 403);
    if (!destination || Object.keys(destination).some((key) => !['environment', 'recordId', 'slot'].includes(key)) || !['NOM B', 'CON S', 'Others'].includes(destination.slot) || !/^[a-zA-Z0-9]{18}$/.test(destination.recordId || '')) throw filingError('INVALID_DESTINATION', 400);
    const environment = fcosSalesforceEnvironment(destination.environment);
    const grant = await authorize(context, { ...destination, orgId: environment.orgId });
    if (!grant || grant.userId !== context.profile.id || grant.orgId !== environment.orgId || grant.recordId !== destination.recordId || grant.slot !== destination.slot
      || !/^005[a-zA-Z0-9]{15}$/.test(grant.salesforceUserId || '') || !/^[a-f0-9]{64}$/.test(grant.proofHash || '') || grant.permissionsVerified !== true || grant.audienceVerified !== true || !Number.isFinite(grant.expiresAt) || grant.expiresAt <= now() || grant.expiresAt > now() + 10 * 60_000) throw filingError('RECORD_SLOT_FORBIDDEN', 403);
    await gateway.verifyEnvironment(environment);
    return { environment, grant };
  }
  async function bound(context, body) {
    const op = await ledger.read(body.operationId);
    if (!op || op.userId !== context?.profile?.id || !equal(op.tokenHash, filingHash(String(body.token || '')))) throw filingError('CONFIRMATION_INVALID', 403);
    if (filingHash(body.destination) !== filingHash(op.destination)) throw filingError('DESTINATION_CHANGED');
    const verified = await access(context, op.destination);
    if (verified.grant.salesforceUserId !== op.salesforceUserId || verified.grant.proofHash !== op.grantProofHash) throw filingError('AUTHORIZATION_CHANGED', 403);
    return { op, ...verified };
  }
  return {
    async destinations(context) {
      const destinations = await targets(context);
      const result = [];
      for (const destination of destinations.slice(0, 20)) {
        const { environment, grant } = await access(context, destination);
        const snapshot = await gateway.snapshot({ ...destination, salesforceUserId: grant.salesforceUserId }, environment);
        result.push({ ...destination, orgId: environment.orgId, object: 'Nomination__c', name: snapshot.recordName, recordType: snapshot.recordType, recordTypeDeveloperName: snapshot.recordTypeDeveloperName, stemName: snapshot.stemName, revision: snapshot.fingerprint, recordUrl: environment.instanceUrl + '/lightning/r/Nomination__c/' + destination.recordId + '/view', key: environment.orgId + ':' + destination.recordId + ':' + destination.slot });
      }
      return result;
    },
    async proposal(context, body) {
      const files = filingManifest(body.files);
      const { environment, grant } = await access(context, body.destination);
      const snapshot = await gateway.snapshot({ ...body.destination, salesforceUserId: grant.salesforceUserId }, environment);
      if (snapshot.currentMime && snapshot.currentMime !== files[0].mime) throw filingError('MIXED_FORMAT_VERSIONS_UNVERIFIED');
      const prior = await ledger.completed(context.profile.id, environment.orgId, body.destination, files);
      let version = snapshot.versionNumber || 0;
      const entries = files.map((f, index) => ({ ...f, index, action: prior[index] ? 'already-filed' : 'new-version', historicalReceipt: prior[index] || null, projectedVersion: prior[index] ? prior[index].versionNumber : ++version }));
      return { destination: body.destination, orgId: environment.orgId, snapshot, files: entries, workflow: body.destination.slot === 'Others' || !entries.some((f) => f.action === 'new-version') ? 'unchanged' : 'set-received-green', projectedLatest: [...entries].reverse().find((f) => f.action === 'new-version')?.name || snapshot.latestName || null };
    },
    async confirm(context, body) {
      const proposal = await this.proposal(context, body);
      if (!equal(filingHash(proposal), body.proposalHash)) throw filingError('PROPOSAL_CHANGED');
      const { grant } = await access(context, body.destination);
      const token = randomBytes(32).toString('hex');
      const operation = { id: randomUUID(), userId: context.profile.id, destination: body.destination, orgId: proposal.orgId, salesforceUserId: grant.salesforceUserId, grantProofHash: grant.proofHash, tokenHash: filingHash(token), expiresAt: now() + 10 * 60_000, proposal, snapshot: proposal.snapshot, cursor: 0, state: 'confirmed', receipts: [] };
      await ledger.create(operation);
      return { operationId: operation.id, token, proposalHash: filingHash(proposal) };
    },
    async upload(context, body) {
      const { op, environment } = await bound(context, body);
      if (op.state === 'cancelled') throw filingError('OPERATION_CANCELLED');
      const file = op.proposal.files[op.cursor];
      if (!file || file.id !== body.file?.id || ['sourceId', 'name', 'mime', 'sha256'].some((k) => body.file?.[k] !== file[k])) throw filingError('FILE_ORDER_OR_IDENTITY_CHANGED');
      filingBytes(body.file, file);
      if (op.state === 'confirmed' && op.expiresAt <= now()) throw filingError('CONFIRMATION_EXPIRED');
      const requestKey = filingHash([op.userId, op.orgId, op.destination.recordId, op.destination.slot, file.name, file.sha256]);
      const claim = await ledger.claim(op.id, op.userId, op.cursor, { requestKey });
      if (!claim) throw filingError('OPERATION_BUSY_OR_RECONCILIATION_REQUIRED');
      try {
        let result;
        if (file.action === 'already-filed') {
          const snapshot = await gateway.snapshot({ ...op.destination, salesforceUserId: op.salesforceUserId }, environment);
          if (snapshot.fingerprint !== op.snapshot.fingerprint) throw filingError('SLOT_CHANGED');
          const verified = await gateway.reconcile(file.historicalReceipt.key, environment);
          if (!verified) throw filingError('HISTORICAL_FILE_NOT_VERIFIED');
          if (verified.snapshot.fingerprint !== op.snapshot.fingerprint) throw filingError('SLOT_CHANGED');
          result = verified;
        } else {
          result = await gateway.commit({ requestKey, requestHash: filingHash([op.id, file, op.snapshot]), destination: op.destination, salesforceUserId: op.salesforceUserId, expectedSnapshot: op.snapshot.fingerprint, file: { ...body.file, size: file.size } }, environment);
        }
        result.receipt = { ...result.receipt, action: file.action, workflow: file.action === 'already-filed' || op.destination.slot === 'Others' ? 'unchanged' : 'set-received-green' };
        validateFilingReceipt(result, file, op, environment);
        await ledger.advance(op.id, claim, result);
        return result.receipt;
      } catch (error) {
        if (error?.code === 'FCOS_FILING_ROLLED_BACK') {
          const resolved = await ledger.failed(op.id, claim);
          if (resolved?.state === 'cancelled') throw filingError('OPERATION_CANCELLED');
          throw filingError('FILING_FAILED_SAFE_TO_RETRY');
        }
        // Persist uncertainty before releasing the slot. A failed/unknown RPC never permits another create.
        await ledger.uncertain(op.id, claim, { requestKey, code: String(error?.code || 'PROVIDER_OUTCOME_UNKNOWN') });
        throw filingError('RECONCILIATION_REQUIRED');
      }
    },
    async reconcile(context, body) {
      const { op, environment } = await bound(context, body);
      if (op.state !== 'uncertain') return { state: op.state, receipts: op.receipts, cursor: op.cursor };
      const result = await gateway.reconcile(op.pending.requestKey, environment);
      if (!result) return { state: 'uncertain', receipts: op.receipts, cursor: op.cursor };
      const file = op.proposal.files[op.cursor];
      result.receipt = { ...result.receipt, action: file.action, workflow: file.action === 'already-filed' || op.destination.slot === 'Others' ? 'unchanged' : 'set-received-green' };
      validateFilingReceipt(result, file, op, environment);
      if (result.receipt.sha256 !== file.sha256 || result.receipt.fileName !== file.name || result.receipt.recordId !== op.destination.recordId || result.receipt.slot !== op.destination.slot || result.receipt.salesforceUserId !== op.salesforceUserId) throw filingError('RECONCILIATION_IDENTITY_MISMATCH');
      const recovered = await ledger.recover(op.id, { cursor: op.cursor, requestKey: op.pending.requestKey, attemptId: op.pending.attemptId }, result);
      if (!recovered) throw filingError('RECONCILIATION_CHANGED');
      return { state: 'recovered', receipt: result.receipt };
    },
    async cancel(context, body) {
      const { op } = await bound(context, body);
      return ledger.cancel(op.id, op.userId);
    },
  };
}

export function validateFilingReceipt(result, file, op, environment) {
  const r = result?.receipt;
  if (!r || r.mock !== false || r.sha256 !== file.sha256 || r.fileName !== file.name || r.mime !== file.mime || r.size !== file.size || r.recordId !== op.destination.recordId || r.slot !== op.destination.slot || r.salesforceUserId !== op.salesforceUserId
    || r.key !== filingHash([op.userId, op.orgId, op.destination.recordId, op.destination.slot, file.name, file.sha256])
    || !/^069[A-Za-z0-9]{15}$/.test(r.contentDocumentId || '') || !/^068[A-Za-z0-9]{15}$/.test(r.contentVersionId || '') || !Number.isSafeInteger(r.versionNumber) || r.versionNumber < 1 || r.slotVerified !== true || r.receivedVerified !== true
    || r.action !== file.action || r.workflow !== (file.action === 'already-filed' || op.destination.slot === 'Others' ? 'unchanged' : 'set-received-green')
    || r.receivedStatus !== result.snapshot?.receivedStatus || (r.workflow === 'set-received-green' && r.receivedStatus !== '🟢') || !result.snapshot?.fingerprint
    || result.snapshot.recordId !== op.destination.recordId || result.snapshot.slot !== op.destination.slot || result.snapshot.salesforceUserId !== op.salesforceUserId || result.snapshot.documentId !== r.contentDocumentId
    || r.recordUrl !== environment.instanceUrl + '/lightning/r/Nomination__c/' + r.recordId + '/view'
    || r.fileUrl !== environment.instanceUrl + '/lightning/r/ContentDocument/' + r.contentDocumentId + '/view') throw filingError('INVALID_PROVIDER_RECEIPT');
  if (file.action === 'already-filed' && result.snapshot.fingerprint !== op.snapshot.fingerprint) throw filingError('SLOT_CHANGED_AFTER_CONFIRMATION');
  if (file.action === 'new-version' && (r.versionNumber !== file.projectedVersion || r.snapshotFingerprint !== result.snapshot.fingerprint)) throw filingError('SLOT_CHANGED_AFTER_COMMIT');
}
