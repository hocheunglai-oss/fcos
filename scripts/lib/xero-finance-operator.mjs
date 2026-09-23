import { constants } from 'node:fs';
import { open, lstat } from 'node:fs/promises';
import { FCOS_CONNECTION_POLICY } from '../../config/fcosConnections.js';
import { confirmedContactIdentitySave, confirmedContactRepair } from '../../src/lib/xeroContactResolutionResult.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SALESFORCE_ID = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;
const IDENTITY_REASONS = new Set(['used-unmatched-xero-contact', 'unused-unmatched-xero-contact', 'nonzero-balance', 'verification-stale', 'verified-xero-only']);
const ALLOWED_COMMANDS = new Set(['status', 'preview', 'run', 'apply', 'payments', 'mappings', 'contact-repair',
  'contacts-status', 'contacts-preview', 'contacts-verify', 'contacts-revoke']);
const MUTATIONS = new Set(['xeroFinancialSyncPreview', 'xeroFinancialSyncApply', 'xeroFinancialSyncRun', 'xeroFinancialPaymentApply',
  'xeroPortalContactLifecyclePreview', 'xeroContactIdentitySave', 'xeroContactRepairApply']);
const PRODUCTION_ORIGIN = new URL(FCOS_CONNECTION_POLICY.attestation.endpoint).origin;
const FCOS_AUTH_ISSUER = new URL(FCOS_CONNECTION_POLICY.integrations.fcunoIdentityFederation.oidcCallbackUrl).origin + '/auth/v1';

function operatorError(code, message) {
  return Object.assign(new Error(message), { code, operatorSafe: true });
}

function uncertainMutation() {
  return operatorError('MUTATION_RESULT_UNKNOWN', 'Result uncertain. Do not retry this mutation; retrieve the saved run before resuming.');
}

export function resolveOperatorOrigin(origin = PRODUCTION_ORIGIN, allowLocalhost = false) {
  let parsed;
  try { parsed = new URL(origin); } catch { throw operatorError('ORIGIN_INVALID', 'FCOS origin is invalid.'); }
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw operatorError('ORIGIN_INVALID', 'FCOS origin must contain only a permitted scheme and host.');
  }
  if (parsed.origin === PRODUCTION_ORIGIN) return parsed.origin;
  if (allowLocalhost && parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) return parsed.origin;
  throw operatorError('ORIGIN_NOT_PINNED', 'FCOS origin does not match the pinned production host or an explicitly allowed local test host.');
}

export function parseOperatorArgs(argv) {
  const positional = [];
  const options = { sessionFile: null, inputFile: null, origin: PRODUCTION_ORIGIN, allowLocalhost: false, mode: 'draft', showRows: false, rowIds: [] };
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    if (!['--session-file', '--input-file', '--origin', '--allow-localhost', '--mode', '--show-rows', '--row-id'].includes(arg) || (seen.has(arg) && arg !== '--row-id')) {
      throw operatorError('ARGUMENT_INVALID', 'An option is unknown or duplicated.');
    }
    seen.add(arg);
    if (arg === '--allow-localhost') options.allowLocalhost = true;
    else if (arg === '--show-rows') options.showRows = true;
    else {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw operatorError('ARGUMENT_INVALID', 'An option value is missing.');
      if (arg === '--row-id') options.rowIds.push(value);
      else options[{ '--session-file': 'sessionFile', '--input-file': 'inputFile', '--origin': 'origin', '--mode': 'mode' }[arg]] = value;
    }
  }
  const [first, ...remaining] = positional;
  const command = first === 'contacts' ? `contacts-${remaining[0] || ''}` : first;
  const ids = first === 'contacts' ? remaining.slice(1) : remaining;
  if (!ALLOWED_COMMANDS.has(command) || !options.sessionFile) throw operatorError('ARGUMENT_INVALID', 'A command and --session-file are required.');
  if (!['draft', 'authorised'].includes(options.mode) || (command !== 'preview' && seen.has('--mode'))) throw operatorError('ARGUMENT_INVALID', 'Posting mode is only valid for preview.');
  if ((['status', 'preview', 'mappings', 'contacts-status', 'contacts-preview', 'contacts-verify', 'contacts-revoke'].includes(command) && ids.length)
    || (command === 'run' && ids.length !== 1)
    || (['apply', 'payments', 'contact-repair'].includes(command) && ids.length < 2)) {
    throw operatorError('ARGUMENT_INVALID', 'Apply, payments, and contact repair require a run ID and explicit row IDs; run takes one run ID.');
  }
  if (['contacts-verify', 'contacts-revoke'].includes(command) !== Boolean(options.inputFile)) {
    throw operatorError('ARGUMENT_INVALID', '--input-file is required only for contacts verify/revoke.');
  }
  if (options.rowIds.length && (!options.showRows || !['status', 'preview', 'contacts-status', 'contacts-preview'].includes(command)
    || options.rowIds.length > 25 || new Set(options.rowIds).size !== options.rowIds.length
    || options.rowIds.some((id) => !/^[a-zA-Z0-9_-]{1,100}$/.test(id)))) {
    throw operatorError('ARGUMENT_INVALID', '--row-id requires --show-rows and at most 25 distinct current row IDs.');
  }
  if (ids.length && !UUID.test(ids[0])) throw operatorError('ARGUMENT_INVALID', 'Run ID must be a UUID.');
  if (command === 'apply' && ids.slice(1).some((id) => !UUID.test(id))) throw operatorError('ARGUMENT_INVALID', 'Document row IDs must be UUIDs.');
  if (command === 'payments' && ids.slice(1).some((id) => !SALESFORCE_ID.test(id))) throw operatorError('ARGUMENT_INVALID', 'Payment row IDs must be Salesforce IDs.');
  if (command === 'contact-repair' && (ids.length > 26 || ids.slice(1).some((id) => !/^[a-zA-Z0-9_-]{1,100}$/.test(id)))) {
    throw operatorError('ARGUMENT_INVALID', 'Contact repair requires 1 to 25 explicit lifecycle row IDs.');
  }
  if (new Set(ids.slice(1)).size !== ids.slice(1).length) throw operatorError('ARGUMENT_INVALID', 'Duplicate row IDs are not allowed.');
  return { ...options, command, ids, origin: resolveOperatorOrigin(options.origin, options.allowLocalhost) };
}

export async function readHumanSessionFile(path) {
  let handle;
  try {
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.uid !== process.getuid()
      || (before.mode & 0o077) !== 0 || before.size > 1_048_576) throw new Error('unsafe');
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const after = await handle.stat();
    if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino || after.uid !== process.getuid()
      || (after.mode & 0o077) !== 0 || after.size > 1_048_576) throw new Error('unsafe');
    const raw = (await handle.readFile({ encoding: 'utf8' })).trim();
    let token = raw;
    if (raw.startsWith('{')) token = JSON.parse(raw).access_token;
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error('invalid');
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (claims.role !== 'authenticated' || claims.iss !== FCOS_AUTH_ISSUER || !UUID.test(claims.sub || '') || claims.is_anonymous === true
      || !Number.isFinite(Number(claims.exp)) || Number(claims.exp) <= Date.now() / 1000) throw new Error('invalid');
    return { token, subject: claims.sub };
  } catch {
    throw operatorError('SESSION_UNSAFE', 'A valid, unexpired human session JWT in an owner-only regular file is required.');
  } finally { await handle?.close(); }
}

async function readReviewedIdentityInput(path, decision) {
  let handle;
  try {
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.uid !== process.getuid()
      || (before.mode & 0o077) !== 0 || before.size > 16_384) throw new Error('unsafe');
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const after = await handle.stat();
    if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino || after.uid !== process.getuid()
      || (after.mode & 0o077) !== 0 || after.size > 16_384) throw new Error('unsafe');
    const input = JSON.parse(await handle.readFile({ encoding: 'utf8' }));
    const keys = Object.keys(input || {}).sort();
    const expected = ['contactId', 'evidenceNote', 'evidenceReference', 'expectedFingerprint', 'expectedRevision', 'reviewed', 'tenantId'].sort();
    if (JSON.stringify(keys) !== JSON.stringify(expected) || input.reviewed !== true || !UUID.test(input.tenantId || '')
      || !UUID.test(input.contactId || '') || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 0
      || !/^[0-9a-f]{64}$/i.test(input.expectedFingerprint || '')
      || typeof input.evidenceNote !== 'string' || input.evidenceNote.trim().length < 15 || input.evidenceNote.length > 2000
      || typeof input.evidenceReference !== 'string' || input.evidenceReference.trim().length < 1 || input.evidenceReference.length > 500) throw new Error('invalid');
    return { ...input, decision };
  } catch {
    throw operatorError('IDENTITY_INPUT_INVALID', 'A reviewed identity input in an owner-only regular JSON file is required.');
  } finally { await handle?.close(); }
}

function counts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, number]) => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(key) && typeof number === 'number' && Number.isFinite(number)));
}

function safeText(value) {
  if (typeof value !== 'string') return null;
  const text = value.slice(0, 240);
  return /bearer\s+\S+|(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|password)\s*[:=]|\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\./i.test(text)
    ? '[REDACTED]' : text;
}

function runSummary(run) {
  if (!run || typeof run !== 'object') return null;
  return { id: safeText(run.id), status: safeText(run.status), revision: Number.isInteger(run.revision) ? run.revision : null,
    postingMode: ['draft', 'authorised'].includes(run.postingMode || run.controlTotals?.postingMode)
      ? run.postingMode || run.controlTotals?.postingMode : 'draft' };
}

function finiteNumber(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function safeScalar(value) { return typeof value === 'string' ? safeText(value) : typeof value === 'boolean' ? value : finiteNumber(value); }
function safeMessages(value) { return Array.isArray(value) ? value.slice(0, 20).map(safeText).filter(Boolean) : []; }
function safeLine(line) {
  return { description: safeText(line?.description)?.slice(0, 160) || null, quantity: finiteNumber(line?.quantity),
    unitAmount: finiteNumber(line?.unitAmount), lineAmount: finiteNumber(line?.lineAmount), taxAmount: finiteNumber(line?.taxAmount),
    accountCode: safeText(line?.accountCode), taxType: safeText(line?.taxType), discount: finiteNumber(line?.discount) };
}
function safeDifference(difference) {
  const field = safeText(difference?.field);
  if (!['documentNumber', 'invoiceDate', 'dueDate', 'reference', 'currency', 'total', 'status', 'detailedLines'].includes(field)) return { field: '[REDACTED]', xero: null, salesforce: null };
  if (field === 'detailedLines') return { field, xeroLineCount: Array.isArray(difference.xero) ? difference.xero.length : 0,
    salesforceLineCount: Array.isArray(difference.salesforce) ? difference.salesforce.length : 0,
    xero: Array.isArray(difference.xero) ? difference.xero.slice(0, 25).map(safeLine) : [],
    salesforce: Array.isArray(difference.salesforce) ? difference.salesforce.slice(0, 25).map(safeLine) : [] };
  return { field, xero: safeScalar(difference?.xero), salesforce: safeScalar(difference?.salesforce) };
}
function safeMatchEvidence(value) {
  if (!value || typeof value !== 'object') return null;
  return { basis: safeText(value.basis), sharedAccounts: Array.isArray(value.sharedAccounts)
    ? value.sharedAccounts.slice(0, 25).map((account) => ({ accountId: safeText(account.accountId), accountName: safeText(account.accountName), companyCode: safeText(account.companyCode) })) : [],
  candidates: Array.isArray(value.candidates) ? value.candidates.slice(0, 25).map((candidate) => ({
    id: safeText(candidate.id), number: safeText(candidate.number), contactName: safeText(candidate.contactName),
    date: safeText(candidate.date), currency: safeText(candidate.currency), total: finiteNumber(candidate.total) })) : [] };
}

function documentRow(row) {
  return { id: safeText(row.id), documentNumber: safeText(row.documentNumber), action: safeText(row.action),
    status: safeText(row.status), salesforceObject: safeText(row.salesforceObject), salesforceId: safeText(row.salesforceId),
    documentKind: safeText(row.documentKind), stemId: safeText(row.stemId), accountId: safeText(row.accountId),
    accountName: safeText(row.accountName), companyCode: safeText(row.companyCode),
    xeroDocumentId: safeText(row.xero?.id), xeroDocumentNumber: safeText(row.xero?.number), xeroStatus: safeText(row.xero?.status),
    currency: safeText(row.currency), total: finiteNumber(row.total), xeroTotal: finiteNumber(row.xero?.total),
    reviewFingerprint: /^[0-9a-f]{64}$/i.test(row.reviewFingerprint || '') ? row.reviewFingerprint : null,
    reviewRequired: row.reviewRequired === true, blockerCodes: Array.isArray(row.blockerCodes) ? row.blockerCodes.filter((code) => /^[a-z_]+$/.test(code)) : [],
    blockers: safeMessages(row.blockers), warnings: safeMessages(row.warnings),
    blockerCount: Array.isArray(row.blockers) ? row.blockers.length : 0,
    differences: Array.isArray(row.differences) ? row.differences.slice(0, 25).map(safeDifference) : [],
    differenceCount: Array.isArray(row.differences) ? row.differences.length : 0,
    matchEvidence: safeMatchEvidence(row.matchEvidence) };
}

function paymentRow(row) {
  return { id: safeText(row.salesforcePaymentId), name: safeText(row.salesforcePaymentName), action: safeText(row.action),
    status: safeText(row.status), currency: safeText(row.currency), amount: Number.isFinite(Number(row.amount)) ? Number(row.amount) : null,
    blockerCodes: Array.isArray(row.blockerCodes) ? row.blockerCodes.filter((code) => /^[a-z_]+$/.test(code)) : [],
    blockerCount: Array.isArray(row.blockers) ? row.blockers.length : 0 };
}

function readRows(preview, showRows, ids = []) {
  if (!showRows) return {};
  const documents = preview?.rows || [];
  const payments = preview?.payments?.rows || [];
  const selectedDocuments = ids.length ? documents.filter((row) => ids.includes(row.id)) : documents.slice(0, 100);
  const selectedPayments = ids.length ? payments.filter((row) => ids.includes(row.salesforcePaymentId)) : payments.slice(0, 100);
  if (ids.length && selectedDocuments.length + selectedPayments.length !== ids.length) throw operatorError('ROW_NOT_FOUND', 'One or more requested rows are missing from the current preview.');
  return { documents: selectedDocuments.map(documentRow), payments: selectedPayments.map(paymentRow),
    rowsTruncated: !ids.length && (documents.length > 100 || payments.length > 100) };
}

function contactRunSummary(run) {
  if (!run || typeof run !== 'object') return null;
  return { id: safeText(run.id), state: safeText(run.state), tenantId: safeText(run.xero?.tenantId),
    rowCount: Number.isInteger(run.rowCount) ? run.rowCount : Array.isArray(run.rows) ? run.rows.length : null };
}

function contactRow(row) {
  return { id: safeText(row.id), xeroContactId: safeText(row.xeroContactId), xeroContactName: safeText(row.xeroContactName),
    salesforceAccountId: safeText(row.salesforceAccountId), salesforceName: safeText(row.salesforceName),
    action: safeText(row.action), status: safeText(row.status), reason: safeText(row.reason),
    identityFingerprint: /^[0-9a-f]{64}$/i.test(row.identityFingerprint || '') ? row.identityFingerprint : null,
    identityRevision: Number.isInteger(row.identityDecision?.revision) ? row.identityDecision.revision : 0,
    identityDecision: safeText(row.identityDecision?.decision),
    identityEvidenceReference: safeText(row.identityDecision?.evidence_reference),
    identityEvidenceNote: safeText(row.identityDecision?.evidence_note) };
}

function requireContactRun(data, runId = null, requireTenant = true) {
  const run = data?.run;
  if (!run?.id || (runId && run.id !== runId) || !Array.isArray(run.rows) || (requireTenant && !UUID.test(run.xero?.tenantId || ''))) {
    throw operatorError('CONTACT_PREVIEW_NOT_CURRENT', 'The current contact preview is unavailable or does not match the requested run.');
  }
  return run;
}

function validateHuman(auth, subject) {
  if (!auth || typeof auth !== 'object' || !auth.user || auth.user.active !== true || auth.user.read_only_ci === true
    || !UUID.test(auth.user.id || '') || auth.user.id !== subject || !auth.user.email
    || auth.moduleAccess?.xero_portal !== true || auth.capabilities?.xero_portal_manage !== true) {
    throw operatorError('FINANCE_ACCESS_DENIED', 'An active FCOS human with Xero Portal access and xero_portal_manage capability is required.');
  }
  return { id: auth.user.id, email: auth.user.email };
}

function requirePreview(data, runId) {
  const preview = data?.preview;
  if (!preview?.run?.id || preview.run.id !== runId || !Array.isArray(preview.rows)) {
    throw operatorError('PREVIEW_NOT_CURRENT', 'The requested run is not the current saved preview. Retrieve status and review the current run.');
  }
  return preview;
}

export async function runXeroFinanceOperator(argv, { fetchImpl = fetch } = {}) {
  const args = parseOperatorArgs(argv);
  const { token, subject } = await readHumanSessionFile(args.sessionFile);
  const call = async (name, body = {}) => {
    let response;
    try {
      response = await fetchImpl(`${args.origin}/api/functions/${name}`, {
        method: 'POST', redirect: 'error', cache: 'no-store', credentials: 'omit',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-fcos-cache-bypass': '1' },
        body: JSON.stringify(body),
      });
    } catch {
      throw operatorError(MUTATIONS.has(name) ? 'MUTATION_RESULT_UNKNOWN' : 'NETWORK_UNAVAILABLE',
        MUTATIONS.has(name) ? 'Result uncertain. Do not retry this mutation; retrieve the saved run before resuming.' : 'FCOS could not be reached.');
    }
    if (!response || typeof response.ok !== 'boolean' || response.redirected === true || (response.url && !response.url.startsWith(`${args.origin}/api/functions/`))) {
      throw MUTATIONS.has(name) ? uncertainMutation() : operatorError('RESPONSE_INVALID', 'FCOS returned an unexpected response.');
    }
    let data;
    try {
      if (!String(response.headers?.get?.('content-type') || '').toLowerCase().includes('application/json')) throw new Error('not-json');
      data = await response.json();
    } catch {
      throw operatorError(MUTATIONS.has(name) ? 'MUTATION_RESULT_UNKNOWN' : 'RESPONSE_INVALID',
        MUTATIONS.has(name) ? 'Result uncertain. Do not retry this mutation; retrieve the saved run before resuming.' : 'FCOS returned an invalid response.');
    }
    if (!response.ok || data?.error) {
      const code = typeof data?.code === 'string' && /^[A-Z][A-Z0-9_]{1,80}$/.test(data.code) ? data.code : 'FCOS_REQUEST_REJECTED';
      throw operatorError(code, `FCOS rejected ${name} (HTTP ${response.status}).`);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw MUTATIONS.has(name) ? uncertainMutation() : operatorError('RESPONSE_INVALID', 'FCOS returned an invalid response.');
    }
    return data;
  };
  const auth = await call('authContext');
  const actor = validateHuman(auth, subject);
  if (args.command === 'status') {
    const [portal, latest] = await Promise.all([call('xeroPortalStatus'), call('xeroFinancialSyncLatest')]);
    return { command: 'status', actor, origin: args.origin, connected: portal.xero?.connected === true,
      financialGateEnabled: portal.externalActions?.xero_financial_sync?.enabled === true,
      run: runSummary(latest.preview?.run), summary: counts(latest.preview?.summary),
      ...readRows(latest.preview, args.showRows, args.rowIds) };
  }
  if (args.command === 'mappings') {
    const data = await call('xeroFinancialMappingsGet');
    if (!Array.isArray(data.productMappings) || !Array.isArray(data.bankMappings)) throw operatorError('RESPONSE_INVALID', 'FCOS mapping response is incomplete.');
    return { command: 'mappings', actor, productMappingCount: data.productMappings.length, bankMappingCount: data.bankMappings.length,
      ...(args.showRows ? { productMappings: data.productMappings.map((row) => ({ direction: safeText(row.direction), salesforceProductId: safeText(row.salesforceProductId), salesforceProductName: safeText(row.salesforceProductName),
        xeroAccountCode: safeText(row.xeroAccountCode), xeroTaxType: safeText(row.xeroTaxType), enabled: row.enabled === true })),
      bankMappings: data.bankMappings.map((row) => ({ salesforceBankName: safeText(row.salesforceBankName), xeroBankAccountName: safeText(row.xeroBankAccountName), enabled: row.enabled === true })) } : {}) };
  }
  if (args.command === 'contacts-status' || args.command === 'contacts-preview') {
    const data = await call(args.command === 'contacts-status' ? 'xeroPortalContactLifecycleLatest' : 'xeroPortalContactLifecyclePreview',
      args.command === 'contacts-preview' ? { forceUsageRefresh: false, incrementalUsageRefresh: false } : {});
    if (args.command === 'contacts-preview' && (!data.run?.id || !UUID.test(data.run.id) || !UUID.test(data.run.xero?.tenantId || '') || !Array.isArray(data.run.rows))) throw uncertainMutation();
    const run = data.run ? requireContactRun(data, null, false) : null;
    const rows = run?.rows || [];
    const selected = args.rowIds.length ? rows.filter((row) => args.rowIds.includes(row.id)) : rows.slice(0, 100);
    if (args.rowIds.length && selected.length !== args.rowIds.length) throw operatorError('ROW_NOT_FOUND', 'One or more requested rows are missing from the current preview.');
    return { command: args.command, actor, run: contactRunSummary(run), summary: counts(run?.summary),
      ...(args.showRows ? { rows: selected.map(contactRow), rowsTruncated: !args.rowIds.length && rows.length > 100 } : {}) };
  }
  if (args.command === 'contacts-verify' || args.command === 'contacts-revoke') {
    const decision = args.command === 'contacts-verify' ? 'verified_xero_only' : 'revoked';
    const input = await readReviewedIdentityInput(args.inputFile, decision);
    const run = requireContactRun(await call('xeroPortalContactLifecycleLatest'));
    const matches = run.rows.filter((row) => row.xeroContactId === input.contactId);
    const row = matches[0];
    if (run.xero.tenantId !== input.tenantId || matches.length !== 1 || row.identityFingerprint !== input.expectedFingerprint
      || (row.identityDecision?.revision ?? 0) !== input.expectedRevision || !IDENTITY_REASONS.has(row.reason)
      || row.salesforceAccountId || String(row.xeroContactStatus || '').toUpperCase() !== 'ACTIVE'
      || (decision === 'revoked' && !row.identityDecision)) {
      throw operatorError('CONTACT_IDENTITY_STALE', 'Contact identity or audited revision changed. Review a fresh contact preview.');
    }
    const data = await call('xeroContactIdentitySave', input);
    if (!confirmedContactIdentitySave(data, input) || data.decision.actor_id !== actor.id
      || String(data.decision.actor_email).toLowerCase() !== actor.email.toLowerCase()) throw uncertainMutation();
    return { command: args.command, actor, contact: contactRow(row), decision: safeText(data.decision?.decision),
      revision: Number.isInteger(data.decision?.revision) ? data.decision.revision : null, refreshPreview: data.refreshPreview === true };
  }
  if (args.command === 'contact-repair') {
    const run = requireContactRun(await call('xeroPortalContactLifecycleLatest'), args.ids[0]);
    const byId = new Map(run.rows.map((row) => [row.id, row]));
    const selected = args.ids.slice(1).map((id) => byId.get(id));
    if (selected.some((row) => !row || row.reason !== 'missing-xero-contact' || row.action !== 'exception'
      || row.status !== 'blocked' || !row.salesforceAccountId || row.xeroContactId)) {
      throw operatorError('ROW_NOT_ELIGIBLE', 'Only explicit blocked missing-Xero-contact rows may be repaired.');
    }
    const data = await call('xeroContactRepairApply', { runId: run.id, rowIds: args.ids.slice(1), reviewed: true });
    if (!confirmedContactRepair(data, run.id, args.ids.slice(1))) throw uncertainMutation();
    return { command: 'contact-repair', actor, run: contactRunSummary(run), reviewedRows: selected.map(contactRow),
      summary: counts(data.summary), refreshPreview: data.refreshPreview === true,
      outcomes: Array.isArray(data.outcomes) ? data.outcomes.map((row) => ({ id: safeText(row.rowId), status: safeText(row.status), errorCode: safeText(row.errorCode) })) : [] };
  }
  if (args.command === 'preview') {
    const data = await call('xeroFinancialSyncPreview', { postingMode: args.mode, includePayments: true, recordExactMatches: false });
    if (!UUID.test(data.run?.id || '') || !Array.isArray(data.rows) || !data.summary
      || (data.run.postingMode || data.postingMode) !== args.mode) throw uncertainMutation();
    return { command: 'preview', actor, run: runSummary(data.run), summary: counts(data.summary),
      paymentSummary: counts(data.payments?.summary), ...readRows(data, args.showRows, args.rowIds) };
  }
  const latest = await call('xeroFinancialSyncLatest');
  const preview = requirePreview(latest, args.ids[0]);
  if (args.command === 'apply') {
    if (preview.run.status !== 'ready_for_review') throw operatorError('PREVIEW_NOT_REVIEWABLE', 'The saved run is not ready for document review.');
    const byId = new Map(preview.rows.map((row) => [row.id, row]));
    const selected = args.ids.slice(1).map((id) => byId.get(id));
    if (selected.some((row) => !row || row.status !== 'eligible' || row.blockers?.length)) throw operatorError('ROW_NOT_ELIGIBLE', 'Every explicit document row must be present and eligible in the saved preview.');
    const data = await call('xeroFinancialSyncApply', { runId: preview.run.id, revision: preview.run.revision, reviewed: true, selectedItemIds: args.ids.slice(1) });
    if (data.run?.id !== preview.run.id || data.run.status !== 'authorised' || !Number.isInteger(data.run.revision)
      || data.run.revision <= preview.run.revision || data.selectedCount !== selected.length) throw uncertainMutation();
    return { command: 'apply', actor, run: runSummary(data.run), selectedCount: data.selectedCount ?? args.ids.length - 1,
      reviewedRows: selected.map(documentRow) };
  }
  if (args.command === 'run') {
    if (!['authorised', 'partial', 'failed'].includes(preview.run.status)) throw operatorError('RUN_NOT_AUTHORISED', 'Authorise explicit rows first, or retrieve the current run to resume.');
    const data = await call('xeroFinancialSyncRun', { runId: preview.run.id, revision: preview.run.revision });
    if (data.run?.id !== preview.run.id || !['completed', 'partial'].includes(data.run.status)
      || !Number.isInteger(data.run.revision) || data.run.revision <= preview.run.revision
      || !Array.isArray(data.outcomes) || data.summary?.total !== data.outcomes.length) throw uncertainMutation();
    return { command: 'run', actor, run: runSummary(data.run), summary: counts(data.summary),
      outcomes: Array.isArray(data.outcomes) ? data.outcomes.map((row) => ({ id: safeText(row.id), status: safeText(row.status), reviewRequired: row.reviewRequired === true })) : [] };
  }
  const byId = new Map((preview.payments?.rows || []).map((row) => [row.salesforcePaymentId, row]));
  const selected = args.ids.slice(1).map((id) => byId.get(id));
  if (selected.some((row) => !row || row.action !== 'payment_apply' || row.status !== 'eligible' || row.blockers?.length
    || !row.sourceFingerprint || !row.reviewFingerprint)) throw operatorError('ROW_NOT_ELIGIBLE', 'Every explicit payment row must be present, exact, and eligible in the saved preview.');
  const data = await call('xeroFinancialPaymentApply', { mode: 'apply', reviewed: true,
    selectedPayments: selected.map((row) => ({ id: row.salesforcePaymentId, sourceFingerprint: row.sourceFingerprint, reviewFingerprint: row.reviewFingerprint })) });
  if (!Array.isArray(data.outcomes) || data.outcomes.length !== selected.length || data.summary?.total !== selected.length
    || new Set(data.outcomes.map((row) => row.salesforcePaymentId)).size !== selected.length
    || data.outcomes.some((row) => !args.ids.slice(1).includes(row.salesforcePaymentId))) throw uncertainMutation();
  return { command: 'payments', actor, run: runSummary(preview.run), summary: counts(data.summary),
    reviewedRows: selected.map(paymentRow), outcomes: Array.isArray(data.outcomes) ? data.outcomes.map((row) => ({ id: safeText(row.salesforcePaymentId), status: safeText(row.status), reviewRequired: row.reviewRequired === true })) : [] };
}
