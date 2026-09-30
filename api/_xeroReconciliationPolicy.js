import { createHash } from 'node:crypto';

const CUTOFF = '2026-01-01';
const STATES = ['ready', 'needs_decision', 'waiting_dependency', 'reconciled', 'legacy_excluded', 'future_activity'];
const CATEGORIES = ['link_only', 'contact', 'draft', 'decision', 'correction_deferred', 'legacy_excluded', 'future_activity'];

function required(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} is required`);
  return value.trim();
}

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    // Salesforce modification time is not accounting evidence. All financial
    // fields and their source fingerprints remain bound to the case proof.
    .filter((key) => key !== 'lastModifiedDate' && value[key] !== undefined)
    .map((key) => [key, canonical(value[key])]));
  return value;
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function date(value) {
  return typeof value === 'string' ? value.slice(0, 10) : '';
}

function isOldDocument(source) {
  if (source.documentFieldProjection?.scope) return source.documentFieldProjection.scope === 'legacy';
  const delivery = date(source.deliveryDate);
  const invoice = date(source.invoiceDate);
  return Boolean(delivery && delivery < CUTOFF && (!invoice || invoice < CUTOFF));
}

function documentCategory(item, source, blockers) {
  if (isOldDocument(source)) return 'legacy_excluded';
  if (blockers.some((reason) => /contact|account identity/i.test(reason)) && !source.contactId) return 'contact';
  if (['link', 'protected_legacy'].includes(item.proposed_action) && item.xero_document_id) return 'link_only';
  if (item.proposed_action === 'create_draft') return 'draft';
  if (item.proposed_action === 'safe_update' || (!blockers.length && item.xero_document_id && (item.differences || []).length)) return 'correction_deferred';
  return 'decision';
}

function documentCase({ tenantId, item, ownerId, baselineAt }) {
  const source = item.source_payload || {};
  const sourceObject = required(item.source_object || source.salesforceObject, 'source_object');
  const sourceId = required(item.source_id || source.salesforceId, 'source_id');
  if (source.salesforceObject && source.salesforceObject !== sourceObject
    || source.salesforceId && source.salesforceId !== sourceId) throw new TypeError('Saved source identity conflicts with classification');
  const blockers = unique([...(item.blockers || []), ...(item.error_message ? [item.error_message] : [])]);
  const category = documentCategory(item, source, blockers);
  const reasons = unique([...blockers, ...(source.reviewRequired ? ['Finance review of the saved match is required.'] : [])]);
  if (!reasons.length && (item.differences || []).length) reasons.push('The existing Xero document has recorded differences.');
  if (!reasons.length && category === 'legacy_excluded') reasons.push('Delivery and invoice predate the 2026 campaign.');
  if (!reasons.length && category === 'link_only') reasons.push('Existing Xero document can be linked without a Xero write.');
  if (!reasons.length && category === 'draft') reasons.push('No existing Xero document was matched; a draft requires review.');
  if (!reasons.length) reasons.push('Finance must review the classified document.');
  const status = category === 'legacy_excluded' ? 'legacy_excluded'
    : ['linked', 'created', 'updated'].includes(item.status) || (item.status === 'protected' && source.acceptedLegacy && !blockers.length) ? 'reconciled'
      : blockers.length || category === 'correction_deferred' || category === 'decision' ? 'needs_decision' : 'ready';
  const targetId = item.xero_document_id || item.xero_payload?.id || null;
  const caseKey = `${tenantId}:${sourceObject}:${sourceId}`;
  return {
    id: caseKey, caseKey, category, status,
    title: `${source.documentKind || item.source_type || sourceObject} ${source.documentNumber || item.source_document_number || sourceId}`,
    accountName: source.accountName || null, documentNumber: source.documentNumber || item.source_document_number || null,
    reason: reasons[0], reasons, dependencies: [], ownerId, ownerName: null,
    sourceObject, sourceId, targetId, sampleKey: `${sourceObject}:${source.xeroType || ''}:${item.xero_payload?.status || ''}`,
    currency: item.currency || source.currency || null,
    total: item.source_total ?? source.total ?? null, baselineAt,
    evidenceFingerprint: fingerprint({ caseKey, sourceFingerprint: source.sourceFingerprint || null,
      financialFingerprint: source.financialFingerprint || null, source, xero: item.xero_payload || null,
      targetId, proposedAction: item.proposed_action, proposedPayload: item.proposed_payload || null,
      blockers, differences: item.differences || [] }),
  };
}

function paymentCase({ tenantId, row, ownerId, baselineAt, documentCases }) {
  const sourceId = required(row.salesforcePaymentId, 'salesforcePaymentId');
  const caseKey = `${tenantId}:Payment__c:${sourceId}`;
  const blockers = unique(row.blockers || []);
  const buyerDocuments = row.stemId ? [...documentCases.values()]
    .filter((item) => item.sourceObject === 'Invoice__c' && item.stemId === row.stemId) : [];
  const dependency = row.supplierInvoiceId && documentCases.get(`Supplier_Invoice__c:${row.supplierInvoiceId}`)
    || (buyerDocuments.length === 1 ? buyerDocuments[0] : null);
  const dependencies = dependency ? [dependency.caseKey] : [];
  const waiting = blockers.length > 0 && row.blockerCodes?.length === blockers.length
    && row.blockerCodes.every((code) => ['invoice_link_pending', 'invoice_authorisation_pending'].includes(code));
  const category = row.action === 'remittance_summary' ? 'future_activity'
    : row.action === 'payment_link' || row.action === 'payment_reference_link' ? 'link_only'
      : row.action === 'payment_apply' ? 'decision' : 'decision';
  const reasons = unique([...blockers, ...(row.reviewRequired ? ['Finance review of the payment match is required.'] : [])]);
  if (!reasons.length) reasons.push(category === 'link_only' ? 'Existing Xero payment can be linked without a Xero write.' : 'Finance must review the payment allocation.');
  const status = category === 'future_activity' ? 'future_activity'
    : row.status === 'protected' && row.action === 'payment_link' && !blockers.length ? 'reconciled'
      : waiting ? 'waiting_dependency'
        : blockers.length || category === 'decision' ? 'needs_decision' : 'ready';
  return {
    id: caseKey, caseKey, category, status,
    title: `Payment ${row.salesforcePaymentName || sourceId}`, accountName: row.accountName || null,
    documentNumber: dependency?.documentNumber || row.xeroDocumentNumber || null,
    reason: reasons[0], reasons, dependencies, ownerId, ownerName: null,
    sourceObject: 'Payment__c', sourceId, targetId: row.xeroPaymentId || null,
    currency: row.currency || null, total: row.amount ?? null, baselineAt,
    evidenceFingerprint: fingerprint({ caseKey, sourceFingerprint: row.sourceFingerprint || null,
      reviewFingerprint: row.reviewFingerprint || null, payment: row, dependency: dependency?.evidenceFingerprint || null,
    }),
  };
}

function holdDuplicateTargets(cases) {
  const byTarget = new Map();
  for (const item of cases) {
    if (!item.targetId || item.status === 'legacy_excluded' || item.sourceObject === 'Account') continue;
    const targetKey = `${item.sourceObject === 'Payment__c' ? 'payment' : 'document'}:${item.targetId}`;
    byTarget.set(targetKey, [...(byTarget.get(targetKey) || []), item]);
  }
  for (const [targetKey, matches] of byTarget) {
    if (matches.length < 2) continue;
    for (const item of matches) {
      const reason = 'More than one Salesforce source claims this exact Xero target. Finance must resolve the identity.';
      item.reasons = unique([reason, ...item.reasons]);
      item.reason = reason;
      item.category = 'decision';
      item.status = 'needs_decision';
      item.evidenceFingerprint = fingerprint({ previous: item.evidenceFingerprint, targetKey,
        conflictingCaseKeys: matches.map((match) => match.caseKey).sort() });
    }
  }
}

/** Derive a fixed campaign from one complete, saved, server-classified preview. */
export function buildReconciliationCases({ tenantId, run, items, ownerId, baselineAt } = {}) {
  tenantId = required(tenantId, 'tenantId');
  ownerId = required(ownerId, 'ownerId');
  const snapshot = run?.control_totals?.workflowSnapshot;
  if (run?.mode !== 'preview' || !snapshot?.complete || snapshot.tenantId !== tenantId
    || snapshot.includePayments !== true || !Array.isArray(snapshot.payments?.rows)
    || snapshot.payments.tenantId !== tenantId || !Array.isArray(items)
    || snapshot.expectedItemCount !== items.length || items.some((item) => item.run_id !== run.id)) {
    throw new TypeError('A complete saved document and payment preview for this tenant is required');
  }
  baselineAt = baselineAt || run.created_at;
  required(baselineAt, 'baselineAt');
  const documentCases = new Map();
  for (const item of items) {
    const result = documentCase({ tenantId, item, ownerId, baselineAt });
    if (documentCases.has(`${result.sourceObject}:${result.sourceId}`)) throw new TypeError('Duplicate source document identity in saved preview');
    result.stemId = item.source_payload?.stemId || null;
    documentCases.set(`${result.sourceObject}:${result.sourceId}`, result);
  }
  const results = [...documentCases.values()];
  for (const row of snapshot.payments.rows) results.push(paymentCase({ tenantId, row, ownerId, baselineAt, documentCases }));
  const contacts = snapshot.contactCases || [];
  if (!Array.isArray(contacts) || contacts.some((row) => row.sourceObject !== 'Account'
    || row.category !== 'contact' || row.ownerId !== ownerId || row.caseKey !== `${tenantId}:Account:${row.sourceId}`
    || row.id !== row.caseKey || !/^[a-f0-9]{64}$/.test(row.evidenceFingerprint || ''))) {
    throw new TypeError('Complete saved Contact-family cases are required');
  }
  for (const contact of contacts) {
    results.push(contact);
    const accountIds = new Set((contact.sourceIds || [contact.sourceId]).map((id) => id.slice(0, 15)));
    for (const item of items) {
      const doc = documentCases.get(`${item.source_object}:${item.source_id}`);
      if (doc.category !== 'contact' || !accountIds.has((item.source_payload?.accountId || '').slice(0, 15))) continue;
      doc.category = 'decision';
      doc.dependencies = [contact.caseKey];
      const contactOnly = (item.blockers || []).every((reason) => /contact|account identity|CL key/i.test(reason));
      if (contact.status === 'ready' && contactOnly) doc.status = 'waiting_dependency';
      const reason = contact.status === 'ready' ? 'The exact Account family requires its reviewed Contact operation first.' : contact.reason;
      doc.reason = reason;
      doc.reasons = unique([reason, ...doc.reasons]);
      doc.evidenceFingerprint = fingerprint({ previous: doc.evidenceFingerprint, contact: contact.evidenceFingerprint });
    }
  }
  if (new Set(results.map((item) => item.caseKey)).size !== results.length) throw new TypeError('Duplicate source payment identity in saved preview');
  holdDuplicateTargets(results);
  return results.sort((left, right) => left.caseKey.localeCompare(right.caseKey));
}

export function summariseReconciliationCases(cases = []) {
  if (!Array.isArray(cases)) throw new TypeError('cases must be an array');
  const counts = { total: cases.length, ready: 0, needsDecision: 0, waitingDependency: 0,
    reconciled: 0, excluded: 0, byCategory: Object.fromEntries(CATEGORIES.map((category) => [category, 0])) };
  for (const item of cases) {
    if (!STATES.includes(item.status) || !CATEGORIES.includes(item.category)) throw new TypeError('Unknown reconciliation case state');
    counts.byCategory[item.category] += 1;
    if (item.status === 'ready') counts.ready += 1;
    else if (item.status === 'needs_decision') counts.needsDecision += 1;
    else if (item.status === 'waiting_dependency') counts.waitingDependency += 1;
    else if (item.status === 'reconciled') counts.reconciled += 1;
    else counts.excluded += 1;
  }
  return counts;
}

function calls(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a nonnegative integer`);
  return value;
}

/** Conservative planning estimate; execution must still recheck live allowance and evidence. */
/** Exact document reads are batched for invoices and individual for credits. */
export function campaignDocumentReadCalls(cases) {
  // Only a single executable claim can share one exact-target request. Larger
  // approval previews retain the conservative per-record planning estimate.
  if (!Array.isArray(cases) || !cases.length || cases.length > 25) return null;
  const invoices = new Set(); const credits = new Set();
  for (const item of cases) {
    if (item.category !== 'link_only' || !['Invoice__c', 'Supplier_Invoice__c'].includes(item.sourceObject)
      || typeof item.targetId !== 'string' || !item.targetId.trim()) return null;
    const sample = String(item.sampleKey || '').split(':');
    const type = sample[0] === item.sourceObject ? sample[1] : null;
    const collection = item.xeroCollection || (['ACCREC', 'ACCPAY'].includes(type) ? 'Invoices'
      : ['ACCRECCREDIT', 'ACCPAYCREDIT'].includes(type) ? 'CreditNotes' : null);
    if (collection === 'Invoices') invoices.add(item.targetId.toLowerCase());
    else if (collection === 'CreditNotes') credits.add(item.targetId.toLowerCase());
    else return null;
  }
  return Math.ceil(invoices.size / 50) + credits.size;
}

export function forecastReconciliationBatch({ category, cases = [], inventoryCalls = 0,
  otherActivityCalls = 0, recoveryCalls = null, remainingCalls = null, reserveCalls = 200 } = {}) {
  if (!CATEGORIES.includes(category) || !Array.isArray(cases) || cases.some((item) => item.category !== category)) throw new TypeError('One known category is required');
  const pending = cases.filter((item) => item.status === 'ready');
  const documentReads = category === 'link_only' ? campaignDocumentReadCalls(pending) : null;
  const readCalls = calls(inventoryCalls, 'inventoryCalls') + (documentReads ?? pending.length);
  const writeCalls = ['contact', 'draft'].includes(category) ? pending.length : 0;
  const verificationCalls = documentReads ?? pending.reduce((sum, item) => sum + (['contact', 'draft'].includes(category) || item.sourceObject === 'Payment__c' ? 2 : 1), 0);
  const recovery = calls(recoveryCalls ?? Math.max(1, documentReads ?? pending.length), 'recoveryCalls');
  const other = calls(otherActivityCalls, 'otherActivityCalls');
  const reserve = calls(reserveCalls, 'reserveCalls');
  const callsNeeded = readCalls + writeCalls + verificationCalls + recovery + other;
  if (remainingCalls !== null) calls(remainingCalls, 'remainingCalls');
  return { readCalls, writeCalls, verificationCalls, recoveryCalls: recovery,
    ...(documentReads !== null ? { linkVerificationMode: 'bulk_exact_documents_v1' } : {}),
    otherActivityCalls: other, callsNeeded,
    canProceed: remainingCalls === null ? null : remainingCalls - reserve >= callsNeeded,
    reason: remainingCalls === null ? 'Live remaining allowance is required before execution.'
      : remainingCalls - reserve >= callsNeeded ? null : 'Estimated calls would cross the reserved Xero allowance.' };
}
