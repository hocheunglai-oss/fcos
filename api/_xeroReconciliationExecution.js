import { createHash, randomUUID } from 'node:crypto';
import { accountingDecimalCents } from './_xeroAccountingLineCents.js';
import { splitScopes, xeroAccountingFetch } from './_xeroContactSync.js';
import { buildFinancialClassifications, documentMappingRow, loadSalesforceFinancialSnapshot,
  loadSalesforcePayments, loadStoredFinancialControls, previewPayments, xeroReviewFingerprint,
  allFinancialRows, buildXeroAccountingPayload, normalizeXeroCreditNote, normalizeXeroInvoice, XERO_FINANCIAL_CUTOFF } from './_xeroFinancialSync.js';
import { requireExternalActionGate } from './_externalActionGates.js';
import { documentConfirmationErrors, documentPostingBlockers, matchDocumentResponses, reviewedPostingMode } from './_xeroDocumentSafety.js';
import { xeroPaymentDate } from './_xeroPaymentAssociation.js';
import { reviewedPaymentReferenceRow } from './_xeroPaymentReferenceLink.js';
import { validatedGroupPaymentRow } from './_xeroGroupPaymentPersistence.js';
import { paymentPostingKey } from './_xeroPaymentPosting.js';
import { refreshCampaignInventory } from './_xeroReconciliationInventory.js';
import { loadPublishedPreviewCheckpoint } from './_xeroPreviewCheckpoint.js';
import { buildCampaignContactCases, executeCampaignContactCase } from './_xeroReconciliationContacts.js';
import { releaseXeroBudget, reserveXeroBudget, runWithXeroBudget, xeroSharedContext } from './_xeroSharedControl.js';

const MAX_CLAIM = 25;

function failure(message) {
  return Object.assign(new Error(message), { status: 409, code: 'XERO_CAMPAIGN_EXECUTION_UNVERIFIED', expose: true });
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => value[key] !== undefined).map((key) => [key, canonical(value[key])]));
  return value;
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

async function one(query, name) {
  const result = await query.maybeSingle();
  if (result.error || !result.data) throw failure(`${name} is unavailable for the claimed batch.`);
  return result.data;
}

function hold(item, reason, status = 'needs_decision') {
  return { caseId: item.id, evidenceFingerprint: item.evidenceFingerprint, status, reason };
}

function cents(value) {
  return accountingDecimalCents(value);
}

function exactAmount(left, right) {
  const a = cents(left); const b = cents(right);
  return a !== null && b !== null && a === b;
}

function documentIdentity(raw, collection) {
  return collection === 'CreditNotes' ? raw?.CreditNoteID : raw?.InvoiceID;
}

function allocationProof(raw, collection) {
  if (!raw || !['Invoices', 'CreditNotes'].includes(collection)) return null;
  if (!['Total', 'AmountPaid', collection === 'CreditNotes' ? 'RemainingCredit' : 'AmountDue']
    .every((field) => Object.hasOwn(raw, field))
    || collection === 'Invoices' && !Object.hasOwn(raw, 'AmountCredited')
    || !Array.isArray(raw.LineItems)) return null;
  const total = cents(raw.Total);
  const due = cents(collection === 'CreditNotes' ? raw.RemainingCredit : raw.AmountDue);
  const paid = cents(raw.AmountPaid ?? 0);
  const credited = collection === 'CreditNotes' ? total !== null && due !== null ? total - due : null : cents(raw.AmountCredited ?? 0);
  if ([total, due, paid, credited].some((value) => value === null || value < 0n)
    || total !== due + paid + credited) return null;
  if (paid > 0n && !Array.isArray(raw.Payments) || credited > 0n && collection === 'Invoices' && !Array.isArray(raw.CreditNotes)) return null;
  return { id: documentIdentity(raw, collection), type: raw.Type, status: raw.Status,
    contactId: raw.Contact?.ContactID, currency: raw.CurrencyCode, total: raw.Total,
    amountDue: collection === 'CreditNotes' ? raw.RemainingCredit : raw.AmountDue,
    amountPaid: raw.AmountPaid ?? 0, amountCredited: String(credited), raw: canonical(raw) };
}

function savedReview(item) {
  return xeroReviewFingerprint({ ...item.source_payload, action: item.proposed_action, status: item.status,
    blockers: item.blockers, warnings: item.warnings, differences: item.differences,
    xero: item.xero_payload, proposedPayload: item.proposed_payload });
}

function documentOutcome(caseRow, item, fresh, refreshedInventory, stored) {
  if (!item || !fresh || caseRow.category !== 'link_only' || caseRow.status !== 'ready') return hold(caseRow, 'The saved document identity or current classification is unavailable.');
  const source = item.source_payload || {};
  if (item.source_object !== caseRow.sourceObject || item.source_id !== caseRow.sourceId
    || !['link', 'protected_legacy'].includes(item.proposed_action)
    || item.xero_document_id !== caseRow.targetId || item.blockers?.length
    || source.sourceFingerprint !== fresh.sourceFingerprint
    || source.financialFingerprint !== fresh.financialFingerprint
    || fresh.salesforceObject !== caseRow.sourceObject || fresh.salesforceId !== caseRow.sourceId
    || fresh.xero?.id !== caseRow.targetId || fresh.xero?.contactId !== source.contactId
    || fresh.currency !== source.currency || !exactAmount(fresh.total, item.source_total)
    || fresh.blockers?.length || !['link', 'protected_legacy'].includes(fresh.action)
    || xeroReviewFingerprint(fresh) !== savedReview(item)) {
    return hold(caseRow, 'Source, mapping, target or approved review evidence changed. Review this exact document again.');
  }
  const special = Boolean(source.groupedPreservation || source.issuedSupplierPreservation);
  if (special) {
    const original = stored.documentMappings.find((mapping) => mapping.salesforce_object === caseRow.sourceObject
      && mapping.salesforce_id === caseRow.sourceId && mapping.xero_document_id === caseRow.targetId);
    if (!source.acceptedLegacy || !fresh.acceptedLegacy || !original?.protected_legacy) {
      return hold(caseRow, 'Grouped or issued preservation requires its original accepted proof transaction.');
    }
  }
  const collection = source.xeroCollection;
  const raw = (collection === 'CreditNotes' ? refreshedInventory.rawTargets?.creditNotes : refreshedInventory.rawTargets?.invoices)
    ?.find((row) => documentIdentity(row, collection)?.toLowerCase() === caseRow.targetId.toLowerCase());
  const proof = allocationProof(raw, collection);
  if (!proof || proof.contactId !== source.contactId || proof.currency !== source.currency
    || !exactAmount(proof.total, source.total)) {
    return hold(caseRow, 'The exact Xero target or its settlement allocation evidence is incomplete or changed.');
  }
  return { caseId: caseRow.id, evidenceFingerprint: caseRow.evidenceFingerprint, status: 'pending_verification',
    proof, mapping: documentMappingRow(item, fresh.xero, true), collection, targetId: caseRow.targetId,
    sourceFingerprint: fresh.sourceFingerprint, reviewFingerprint: xeroReviewFingerprint(fresh) };
}

function paymentOutcome(caseRow, saved, fresh, refreshed, stored, env) {
  if (!saved || !fresh || caseRow.category !== 'link_only' || caseRow.status !== 'ready') {
    return hold(caseRow, 'The saved payment identity or current classification is unavailable.');
  }
  const reference = Boolean(saved.retainedReferenceEvidence);
  const group = Object.hasOwn(saved, 'bankSourceEvidence');
  const eligible = (row) => row && !row.blockers?.length && !row.proposedPayment
    && (reference ? row.action === 'payment_reference_link' && row.status === 'eligible'
      || row.action === 'payment_link' && row.status === 'protected' && row.acceptedReference === true
      : row.action === 'payment_link' && row.status === 'eligible');
  if (!eligible(saved) || !eligible(fresh) || saved.action !== fresh.action || saved.status !== fresh.status
    || saved.salesforcePaymentId !== caseRow.sourceId || fresh.salesforcePaymentId !== caseRow.sourceId
    || saved.xeroPaymentId !== caseRow.targetId || fresh.xeroPaymentId !== caseRow.targetId
    || saved.sourceFingerprint !== fresh.sourceFingerprint || saved.reviewFingerprint !== fresh.reviewFingerprint
    || saved.documentMappingId !== fresh.documentMappingId || saved.xeroDocumentId !== fresh.xeroDocumentId
    || saved.bankAccountId !== fresh.bankAccountId || !exactAmount(saved.amount, fresh.amount)
    || saved.currency !== fresh.currency || saved.paymentDate !== fresh.paymentDate
    || digest(saved.confirmedPayment || null) !== digest(fresh.confirmedPayment || null)
    || digest(saved.retainedReferenceEvidence || null) !== digest(fresh.retainedReferenceEvidence || null)
    || saved.referenceReviewFingerprint !== fresh.referenceReviewFingerprint
    || digest(saved.bankSourceEvidence || null) !== digest(fresh.bankSourceEvidence || null)
    || digest(saved.documentMappingSnapshot || null) !== digest(fresh.documentMappingSnapshot || null)
    || digest(saved.bankMappingSnapshot || null) !== digest(fresh.bankMappingSnapshot || null)) {
    return hold(caseRow, 'Source payment, allocation, bank, document or approved review evidence changed. Review this exact payment again.');
  }
  if (reference) requireExternalActionGate('xero_financial_sync', env);
  let persistenceProof = {};
  try {
    if (reference) persistenceProof = { paymentReferenceRow: { ...reviewedPaymentReferenceRow(fresh),
      idempotencyKey: paymentPostingKey(refreshed.tenantId, fresh.salesforcePaymentId) } };
    else if (group) persistenceProof = { groupPaymentRow: { ...validatedGroupPaymentRow(fresh, { requireTarget: true }),
      idempotencyKey: paymentPostingKey(refreshed.tenantId, fresh.salesforcePaymentId) } };
  } catch { return hold(caseRow, 'The original payment-reference or Group proof is incomplete or changed.'); }
  const document = stored.documentMappings.find((mapping) => mapping.id === fresh.documentMappingId);
  const rawPayment = refreshed.paymentReadSnapshot?.payments?.find((row) => row.PaymentID === caseRow.targetId);
  const rawInvoice = refreshed.rawTargets?.invoices?.find((row) => row.InvoiceID === document?.xero_document_id);
  if (!document || !rawPayment || !rawInvoice || rawPayment.Invoice?.InvoiceID !== document.xero_document_id
    || !rawPayment.Account?.AccountID || rawPayment.Account.AccountID !== fresh.bankAccountId
    || document.xero_document_id !== fresh.xeroDocumentId || rawPayment.Status !== 'AUTHORISED'
    || xeroPaymentDate(rawPayment.Date) !== fresh.paymentDate
    || !exactAmount(rawPayment.Amount, fresh.amount) || rawInvoice.Contact?.ContactID !== document.xero_contact_id
    || rawInvoice.CurrencyCode !== fresh.currency || rawPayment.Invoice?.CurrencyCode !== fresh.currency
    || !allocationProof(rawInvoice, 'Invoices')
    || !Array.isArray(rawInvoice.Payments)
    || rawInvoice.Payments.filter((payment) => payment.PaymentID === rawPayment.PaymentID
      && exactAmount(payment.Amount, rawPayment.Amount)).length !== 1
    || cents(rawInvoice.AmountPaid) < cents(rawPayment.Amount)) {
    return hold(caseRow, 'The exact payment, mapped invoice or settlement evidence is incomplete.');
  }
  const paymentProof = { raw: canonical(rawPayment), document: allocationProof(rawInvoice, 'Invoices') };
  const paymentMapping = { salesforce_payment_id: fresh.salesforcePaymentId,
    salesforce_payment_name: fresh.salesforcePaymentName, document_mapping_id: fresh.documentMappingId,
    xero_payment_id: rawPayment.PaymentID, xero_bank_account_id: rawPayment.Account.AccountID,
    source_fingerprint: fresh.sourceFingerprint, amount: fresh.amount, currency: fresh.currency,
    payment_date: fresh.paymentDate, status: 'linked' };
  if (fresh.confirmedPayment && ['xero_payment_id', 'xero_bank_account_id', 'currency', 'payment_date', 'amount']
    .some((key) => Object.hasOwn(fresh.confirmedPayment, key) &&
      (key === 'amount' ? !exactAmount(fresh.confirmedPayment[key], paymentMapping[key]) : fresh.confirmedPayment[key] !== paymentMapping[key]))) {
    return hold(caseRow, 'The confirmed payment mapping conflicts with its exact approved payment.');
  }
  return { caseId: caseRow.id, evidenceFingerprint: caseRow.evidenceFingerprint,
    status: 'pending_payment_verification', paymentProof, paymentMapping,
    persistenceProof, paymentEvidence: fresh, xeroPaymentId: rawPayment.PaymentID, xeroInvoiceId: document.xero_document_id };
}

async function documentAuthority(client, actor, campaign, batch, row) {
  const current = await one(client.from('xero_reconciliation_batches').select('*').eq('id', batch.id), 'document claim');
  const savedCampaign = await one(client.from('xero_reconciliation_campaigns').select('*').eq('id', campaign.id), 'document campaign');
  const savedCase = await one(client.from('xero_reconciliation_cases').select('*')
    .eq('campaign_id', campaign.id).eq('id', row.id), 'document case');
  if (current.campaign_id !== campaign.id || current.category !== 'draft' || current.status !== 'running'
    || current.claim_id !== batch.claim_id || !current.claim_case_ids?.includes(row.id)
    || !current.approved_by || !current.approved_at || savedCampaign.tenant_id !== campaign.tenant_id
    || savedCase.evidence_fingerprint !== row.evidenceFingerprint) throw failure('The approved draft claim changed.');
  const access = await client.rpc('xero_campaign_actor_v1', { p_actor: actor.id, p_tenant: campaign.tenant_id });
  if (access?.error) throw failure('Current Finance access is required for the draft claim.');
  return { campaignId: campaign.id, batchId: batch.id, claimId: batch.claim_id, caseId: row.id,
    tenantId: campaign.tenant_id, evidenceFingerprint: row.evidenceFingerprint };
}

async function documentAudit(client, actor, eventType, outcome, fingerprints) {
  const result = await client.from('xero_financial_audit_events').insert({ run_id: null, actor_id: actor.id,
    actor_email: actor.email, event_type: eventType, outcome, record_counts: { documents: 1 }, fingerprints })
    .select('id').maybeSingle();
  const id = String(result?.data?.id || '');
  if (result?.error || typeof result?.data?.id === 'number' && !Number.isSafeInteger(result.data.id) || !/^[1-9][0-9]*$/.test(id)) throw failure('The draft operation journal could not be durably saved.');
  return id;
}

async function documentHistory(client, authority) {
  const result = await client.from('xero_financial_audit_events').select('id,event_type,outcome,fingerprints')
    .eq('fingerprints->>tenantId', authority.tenantId).eq('fingerprints->>caseId', authority.caseId)
    .in('event_type', ['campaign_document_intent', 'campaign_document_response', 'campaign_document_verified'])
    .order('created_at').order('id').limit(1001);
  if (result?.error || !Array.isArray(result?.data) || result.data.length > 1000
    || result.data.some((event) => !/^[1-9][0-9]*$/.test(String(event.id))
      || typeof event.id === 'number' && !Number.isSafeInteger(event.id))) throw failure('The draft journal is incomplete.');
  const events = result.data.map((event) => ({ ...event, id: String(event.id) }));
  const sameClaim = (proof) => ['campaignId', 'batchId', 'claimId'].every((key) => proof[key] === authority[key]);
  for (const intent of events.filter((event) => event.event_type === 'campaign_document_intent' && !sameClaim(event.fingerprints))) {
    const matches = (event) => Object.keys(authority).every((key) => event.fingerprints[key] === intent.fingerprints[key])
      && event.fingerprints.originalIntentId === intent.id;
    const responses = events.filter((event) => event.event_type === 'campaign_document_response' && matches(event));
    if (responses.length === 1 && responses[0].outcome === 'rejected'
      && responses[0].fingerprints.definitiveNoWrite === true && responses[0].fingerprints.outcomeUnknown === false) continue;
    const verified = events.filter((event) => event.event_type === 'campaign_document_verified' && event.outcome === 'verified' && matches(event));
    let finished = false;
    for (const receipt of verified) {
      const outcomes = await client.from('xero_reconciliation_events').select('evidence')
        .eq('campaign_id', intent.fingerprints.campaignId).eq('batch_id', intent.fingerprints.batchId)
        .eq('event_type', 'case_outcome').eq('evidence->>receiptId', receipt.id).limit(2);
      if (outcomes.error || !Array.isArray(outcomes.data)) throw failure('The earlier draft finish evidence is unavailable.');
      const outcome = outcomes.data.length === 1 ? outcomes.data[0].evidence : null;
      if (outcome?.status === 'reconciled' && outcome.caseId === authority.caseId
        && outcome.evidenceFingerprint === intent.fingerprints.evidenceFingerprint && outcome.originalIntentId === intent.id
        && outcome.verificationFingerprint === receipt.fingerprints.verificationFingerprint
        && outcome.sourceFingerprint === intent.fingerprints.sourceFingerprint && outcome.targetId === receipt.fingerprints.targetId
        && digest(outcome.mapping) === digest(receipt.fingerprints.mapping)) finished = true;
    }
    if (!finished) throw failure('The original draft intent changed or an earlier claim remains unresolved. No draft was resent.');
  }
  return events.filter((event) => sameClaim(event.fingerprints));
}

async function documentRequest(client, authority, intent) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(intent.postRequestId || '') || !intent.postBudgetId) {
    throw failure('The original draft intent has no durable shared request authority. No draft was resent.');
  }
  const result = await client.from('xero_shared_requests').select('*').eq('tenant_id', authority.tenantId).eq('id', intent.postRequestId).maybeSingle();
  if (result.error) throw failure('The original draft admission receipt is unavailable.');
  if (!result.data) return null;
  const request = result.data;
  const budget = await one(client.from('xero_shared_budgets').select('*').eq('tenant_id', authority.tenantId).eq('id', intent.postBudgetId), 'original draft request budget');
  if (request.id !== intent.postRequestId || request.tenant_id !== authority.tenantId || budget.tenant_id !== authority.tenantId
    || budget.id !== intent.postBudgetId || request.method !== 'POST' || request.resource_key !== intent.collection
    || request.budget_id !== intent.postBudgetId || request.token_version !== intent.postTokenVersion
    || request.phase !== 'operation' || budget.owner_key !== `campaign:${authority.campaignId}:${authority.batchId}:${authority.claimId}`
    || !['inflight', 'complete', 'unknown'].includes(request.state)) throw failure('The original draft admission authority changed.');
  if (request.state === 'inflight' && (!Number.isFinite(Date.parse(request.deadline_at)) || Date.parse(request.deadline_at) > Date.now())) {
    throw failure('The original draft request is still in flight. Wait for its deadline before recovery.');
  }
  return request;
}

function draftDetail(item, raw) {
  const payload = item.proposed_payload;
  const errors = documentConfirmationErrors(item, raw || {});
  const proof = allocationProof(raw, item.source_payload.xeroCollection);
  const lines = raw?.LineItems;
  const expected = payload.LineItems;
  const zero = (value) => cents(value) === 0n;
  const sameLine = (line, target) => line.Description === target.Description
    && line.Quantity === target.Quantity && line.UnitAmount === target.UnitAmount
    && String(line.AccountCode) === String(target.AccountCode)
    && (line.TaxType || 'NONE') === (target.TaxType || 'NONE')
    && zero(line.TaxAmount ?? 0) && zero(line.DiscountAmount ?? 0) && zero(line.DiscountRate ?? 0);
  // Preserve line multiplicity while allowing Xero to assign IDs and reorder lines.
  const unmatched = Array.isArray(lines) ? [...lines] : [];
  for (const line of expected || []) {
    const index = unmatched.findIndex((target) => sameLine(target, line));
    if (index < 0) errors.push('The reviewed draft lines were not confirmed.'); else unmatched.splice(index, 1);
  }
  if (!proof || documentIdentity(raw, item.source_payload.xeroCollection) === '00000000-0000-0000-0000-000000000000'
    || raw.Status !== 'DRAFT' || !zero(raw.AmountPaid) || !zero(proof.amountCredited)
    || !exactAmount(proof.amountDue, item.source_total) || unmatched.length || !expected?.length
    || xeroPaymentDate(raw.Date) !== payload.Date
    || item.source_payload.xeroCollection === 'Invoices' && xeroPaymentDate(raw.DueDate) !== payload.DueDate
    || String(raw.Reference || '') !== String(payload.Reference || '')
    || raw.LineAmountTypes !== payload.LineAmountTypes || raw.HasValidationErrors === true
    || Array.isArray(raw.ValidationErrors) && raw.ValidationErrors.length) errors.push('The exact unsettled DRAFT payload was not confirmed.');
  if (errors.length) throw failure(errors.join(' '));
  return proof;
}

async function executeDraft({ client, connection, campaign, batch, caseRow, item, fresh, refreshed,
  actor, env, fetchImpl, recovering, accountingFetch, withBudget, budgetId, recheckSource }) {
  const authority = await documentAuthority(client, actor, campaign, batch, caseRow);
  const previous = await documentHistory(client, authority);
  const intents = previous.filter((event) => event.event_type === 'campaign_document_intent');
  if (recovering && !intents.length) return { ...hold(caseRow,
    'No durable draft intent exists, so this claim performed no document POST. Review and approve a new claim.'), definitiveNoWrite: true };
  if (intents.length > 1) throw failure('Recovery requires one original durable document intent. No draft was resent.');
  const recovery = recovering || intents.length > 0;
  let intent = intents[0]?.fingerprints; let originalIntentId = intents[0]?.id;
  if (intent && Object.entries(authority).some(([key, value]) => intent[key] !== value)) throw failure('The original draft intent changed. No draft was resent.');
  const originalResponses = previous.filter((event) => event.event_type === 'campaign_document_response'
    && event.fingerprints.originalIntentId === originalIntentId);
  if (originalResponses.length > 1) throw failure('The original draft intent has conflicting response receipts.');
  if (originalResponses[0]?.fingerprints.definitiveNoWrite === true && originalResponses[0].fingerprints.outcomeUnknown === false) {
    return { ...hold(caseRow, 'The original draft request conclusively made no document change. Refresh and review this document again.'),
      definitiveNoWrite: true, receiptId: String(originalResponses[0].id), originalIntentId };
  }
  if (!recovery) requireExternalActionGate('xero_financial_sync', env);
  const scopes = splitScopes(connection.scope);
  if (recovery ? !scopes.includes('accounting.invoices') && !scopes.includes('accounting.invoices.read') : !scopes.includes('accounting.invoices')) {
    throw failure(recovery ? 'Xero financial document read scope is required for exact recovery.' : 'Xero financial document write scope is required.');
  }
  const source = item?.source_payload;
  if (!item || !fresh || caseRow.category !== 'draft' || caseRow.status !== 'ready'
    || item.proposed_action !== 'create_draft' || caseRow.targetId || item.xero_document_id
    || item.blockers?.length || fresh.blockers?.length || source.postingMode !== 'draft'
    || fresh.postingMode !== 'draft' || source.groupedPreservation || source.issuedSupplierPreservation
    || source.sourceFingerprint !== fresh.sourceFingerprint || source.financialFingerprint !== fresh.financialFingerprint
    || source.salesforceObject !== caseRow.sourceObject || source.salesforceId !== caseRow.sourceId
    || !exactAmount(source.total, item.source_total) || !exactAmount(fresh.total, item.source_total)
    || !['Invoices', 'CreditNotes'].includes(source.xeroCollection)
    || documentPostingBlockers(fresh, refreshed.organisation).length) throw failure('The reviewed draft source or financial evidence changed.');
  const payload = buildXeroAccountingPayload(fresh);
  if (payload.Status !== 'DRAFT' || payload.InvoiceID || payload.CreditNoteID
    || digest(payload) !== digest(item.proposed_payload)) throw failure('The draft payload differs from the approved source.');
  if (intent && (Object.entries(authority).some(([key, value]) => intent[key] !== value)
    || intent.itemId !== item.id || intent.sourceFingerprint !== source.sourceFingerprint
    || intent.financialFingerprint !== source.financialFingerprint || intent.reviewFingerprint !== savedReview(item)
    || digest(intent.proposedPayload) !== digest(payload))) throw failure('The original draft intent changed. No draft was resent.');
  const collection = source.xeroCollection;
  const numberKey = collection === 'Invoices' ? 'InvoiceNumber' : 'CreditNoteNumber';
  let postResponse = null; let postRequest = null; let postUnknown = false; let verificationRequest = null;
  const read = (path, phase = 'verification') => withBudget(connection, { budgetId, budgetPhase: phase },
    () => accountingFetch(connection, path, { method: 'GET', env, fetchImpl,
      onResponse: (event) => { if (phase === 'verification') verificationRequest = event; } }));
  const findExact = async (phase) => {
    const supplier = payload.Type.startsWith('ACCPAY');
    const contactId = payload.Contact?.ContactID;
    const validContact = (id) => typeof id === 'string'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      && id !== '00000000-0000-0000-0000-000000000000';
    if (supplier && !validContact(contactId)) throw failure('The exact supplier Contact identity is incomplete.');
    const where = `${numberKey}==${JSON.stringify(payload[numberKey])}${supplier
      ? `&&Type==${JSON.stringify(payload.Type)}&&Contact.ContactID==Guid(${JSON.stringify(contactId)})` : ''}`;
    const params = new URLSearchParams({ where, page: '1', pageSize: '100', summaryOnly: 'false', unitdp: '4' });
    const response = await read(`/${collection}?${params}`, phase);
    const rows = response?.[collection];
    if (!Array.isArray(rows) || rows.length >= 100 || response.pagination?.pageCount > 1) throw failure('Exact draft identity search is incomplete.');
    if (!supplier) return rows;
    const types = collection === 'Invoices' ? ['ACCREC', 'ACCPAY'] : ['ACCRECCREDIT', 'ACCPAYCREDIT'];
    if (rows.some((row) => !row || !types.includes(row.Type) || !validContact(row.Contact?.ContactID)
      || typeof row[numberKey] !== 'string' || !row[numberKey].trim())) throw failure('The returned supplier draft identity evidence is incomplete.');
    // Provider filters are not admission authority: explicitly validate identity
    // before excluding another supplier's legitimate repeated bill reference.
    return rows.filter((row) => row.Type === payload.Type && row[numberKey] === payload[numberKey]
      && row.Contact.ContactID.toLowerCase() === contactId.toLowerCase());
  };
  if (!recovery) {
    if (fresh.action !== 'create_draft' || fresh.status !== 'eligible' || fresh.xero?.id
      || xeroReviewFingerprint(fresh) !== savedReview(item)) throw failure('The original draft classification changed.');
    // Re-read the authoritative source and controls immediately before the write,
    // then separately rule out a document created after the inventory snapshot.
    await recheckSource();
    if ((await findExact('operation')).length) throw failure('A Xero document with this exact number now exists. Review before creating a draft.');
    await documentAuthority(client, actor, campaign, batch, caseRow);
    if (!budgetId || !Number.isSafeInteger(connection.tokenVersion) || connection.tokenVersion < 1) throw failure('Durable draft budget and token authority are required before submission.');
    intent = { ...authority, itemId: item.id, sourceFingerprint: source.sourceFingerprint,
      financialFingerprint: source.financialFingerprint, reviewFingerprint: savedReview(item), proposedPayload: payload,
      postRequestId: randomUUID(), postBudgetId: budgetId, postTokenVersion: connection.tokenVersion, collection,
      payloadFingerprint: digest(payload), idempotencyKey: `campaign-document-${digest([authority.claimId, caseRow.id, caseRow.evidenceFingerprint]).slice(0, 40)}` };
    originalIntentId = await documentAudit(client, actor, 'campaign_document_intent', 'intent', intent);
    await documentAuthority(client, actor, campaign, batch, caseRow);
    let providerError = null; let submitted = false;
    try {
      requireExternalActionGate('xero_financial_sync', env);
      if (!splitScopes(connection.scope).includes('accounting.invoices')) throw failure('Xero financial document write scope is required.');
      submitted = true;
      postResponse = await accountingFetch(connection, `/${collection}?summarizeErrors=false`, { method: 'POST',
        body: { [collection]: [payload] }, requestId: intent.postRequestId, idempotencyKey: intent.idempotencyKey, retryOnRateLimit: false, env, fetchImpl,
        onResponse: (event) => { postRequest = event; } });
    } catch (error) { providerError = error; postUnknown = error?.details?.outcomeUnknown === true;
      postRequest = postRequest || { requestId: error?.details?.requestId || null }; }
    if (postRequest?.requestId && postRequest.requestId !== intent.postRequestId) throw failure('The draft response belongs to another shared request.');
    const neverAdmitted = submitted && providerError && !postRequest?.status && !await documentRequest(client, authority, intent);
    const definitiveNoWrite = neverAdmitted || !postUnknown && (!submitted || rejectedDraft(item, postResponse)
      || postRequest?.status === 400 && Boolean(postRequest.requestId)
        && providerError?.status === 400 && providerError?.code === 'XERO_CONTACT_SYNC_XERO_REQUEST_FAILED');
    const responseId = await documentAudit(client, actor, 'campaign_document_response', definitiveNoWrite ? 'rejected' : providerError ? 'uncertain' : 'received',
      { ...authority, originalIntentId, response: postResponse, postRequestId: intent.postRequestId,
        providerStatus: postRequest?.status || null, submitted: submitted && !neverAdmitted, definitiveNoWrite, outcomeUnknown: neverAdmitted ? false : postUnknown,
        providerErrorCode: /^[A-Z_]{1,100}$/.test(providerError?.code || '') ? providerError.code : null });
    if (definitiveNoWrite) return { ...hold(caseRow, submitted
      ? 'Xero conclusively rejected this draft; no document was created. Refresh and review it again.'
      : 'The posting gate or write scope prevented this draft submission. Review and approve a new claim.'),
      definitiveNoWrite: true, receiptId: responseId, originalIntentId };
  } else {
    postResponse = originalResponses[0]?.fingerprints.response || null;
    postRequest = { requestId: intent.postRequestId };
    postUnknown = originalResponses[0]?.fingerprints.outcomeUnknown === true;
  }
  const admission = await documentRequest(client, authority, intent);
  if (!admission) {
    const receiptId = originalResponses[0]?.id || await documentAudit(client, actor, 'campaign_document_response', 'rejected',
      { ...authority, originalIntentId, submitted: false, definitiveNoWrite: true, outcomeUnknown: false, postRequestId: intent.postRequestId, response: null });
    return { ...hold(caseRow, 'The durable draft intent was never admitted, so no document POST occurred. Review and approve a new claim.'),
      definitiveNoWrite: true, originalIntentId, receiptId };
  }
  if (postRequest?.requestId && postRequest.requestId !== intent.postRequestId) throw failure('The draft response belongs to another shared request.');
  postRequest = { ...postRequest, requestId: intent.postRequestId };
  postUnknown = admission.outcome_unknown === true || admission.state === 'unknown' || admission.state === 'inflight';
  let targetId;
  if (postResponse) {
    const returned = postResponse[collection];
    const confirmation = matchDocumentResponses([item], returned)[0];
    if (!Array.isArray(returned) || returned.length !== 1 || confirmation.errors.length) throw failure('The original draft response is not uniquely confirmed. No draft was resent.');
    draftDetail(item, confirmation.response);
    targetId = documentIdentity(confirmation.response, collection);
  } else {
    const candidates = await findExact('verification');
    if (candidates.length !== 1) throw failure('The previous draft outcome is unconfirmed. No draft was resent.');
    draftDetail(item, candidates[0]);
    targetId = documentIdentity(candidates[0], collection);
  }
  const readback = await read(`/${collection}?IDs=${encodeURIComponent(targetId)}&summaryOnly=false&unitdp=4`);
  const details = readback?.[collection];
  if (!Array.isArray(details) || details.length !== 1 || documentIdentity(details[0], collection) !== targetId) throw failure('Exact draft readback is incomplete.');
  const verifiedDocument = details[0]; const proof = draftDetail(item, verifiedDocument);
  const normalized = collection === 'Invoices' ? normalizeXeroInvoice(verifiedDocument) : normalizeXeroCreditNote(verifiedDocument);
  const mapping = documentMappingRow(item, normalized, false);
  const verified = { ...authority, originalIntentId, itemId: item.id, targetId, mapping,
    sourceFingerprint: source.sourceFingerprint, financialFingerprint: source.financialFingerprint,
    reviewFingerprint: savedReview(item), proposedPayload: payload, payloadFingerprint: digest(payload),
    verifiedDocument, proof, postRequestId: postRequest?.requestId || null,
    verificationRequestId: verificationRequest?.requestId || null, recovery };
  const verificationFingerprint = digest(verified);
  const receiptId = await documentAudit(client, actor, 'campaign_document_verified', 'verified', { ...verified, verificationFingerprint });
  if (postUnknown) {
    if (!verificationRequest?.requestId) throw failure('The verified shared draft readback receipt is unavailable.');
    await xeroSharedContext(connection).sharedControl.resolveUnknown({ tenantId: connection.tenantId,
      requestId: postRequest.requestId, verificationRequestId: verificationRequest.requestId,
      evidenceReference: `xero_financial_audit_events:${receiptId}` });
  }
  return { caseId: caseRow.id, evidenceFingerprint: caseRow.evidenceFingerprint, status: 'reconciled', receiptId,
    mapping, targetId, sourceFingerprint: source.sourceFingerprint, reviewFingerprint: savedReview(item), verificationFingerprint, originalIntentId };
}

function rejectedDraft(item, response) {
  const collection = item.source_payload.xeroCollection;
  const rows = response?.[collection];
  if (!Array.isArray(rows) || rows.length !== 1) return false;
  const raw = rows[0]; const id = documentIdentity(raw, collection);
  const key = collection === 'Invoices' ? 'InvoiceNumber' : 'CreditNoteNumber';
  return Boolean(raw && (!id || id === '00000000-0000-0000-0000-000000000000')
    && raw.Type === item.proposed_payload.Type && raw.Contact?.ContactID === item.proposed_payload.Contact.ContactID
    && raw.CurrencyCode === item.proposed_payload.CurrencyCode && raw[key] === item.proposed_payload[key]
    && raw.Status !== 'PAID' && raw.StatusAttributeString !== 'OK' && raw.HasErrors !== false && raw.HasValidationErrors !== false
    && (raw.HasErrors === true || raw.HasValidationErrors === true || raw.StatusAttributeString === 'ERROR')
    && Array.isArray(raw.ValidationErrors) && raw.ValidationErrors.length
    && raw.ValidationErrors.every((error) => typeof error?.Message === 'string' && error.Message.trim()));
}

async function claimBudget({ client, connection, campaign, batch, callBudget, recovering, reserveBudget, releaseBudget }) {
  const ownerKey = `campaign:${campaign.id}:${batch.id}:${batch.claim_id}`;
  if (recovering) {
    const { data: existing } = await allFinancialRows(client, 'xero_shared_budgets', (query) => query
      .eq('tenant_id', connection.tenantId).eq('owner_key', ownerKey));
    for (const original of existing) {
      const { data: inflight } = await allFinancialRows(client, 'xero_shared_requests', (query) => query
        .eq('tenant_id', connection.tenantId).eq('budget_id', original.id).eq('state', 'inflight'));
      if (inflight.some((request) => !Number.isFinite(Date.parse(request.deadline_at)) || Date.parse(request.deadline_at) > Date.now())) {
        throw failure('The original provider request is still in flight. Wait for its deadline before readback recovery.');
      }
    }
    const active = existing.filter((row) => row.state === 'active' && Date.parse(row.expires_at) > Date.now());
    if (active.length > 1) throw failure('More than one active reservation claims this exact batch. Resolve its budget ownership before recovery.');
    if (active.length) {
      const original = active[0];
      if ([original.operation_remaining, original.verification_remaining].some((remaining) => !Number.isSafeInteger(remaining) || remaining < 0)) {
        throw failure('The original request reservation has invalid remaining capacity.');
      }
      if (original.operation_remaining >= callBudget.operationCalls && original.verification_remaining >= callBudget.verificationCalls) return original;
      // Releasing capacity does not clear the unresolved provider-write barrier.
      // Independent readback can use a new reservation only after this expires or releases.
      await releaseBudget(connection, { budgetId: original.id, reason: 'Rotate exact claim reservation for readback recovery' });
      const { data: released } = await allFinancialRows(client, 'xero_shared_budgets', (query) => query
        .eq('tenant_id', connection.tenantId).eq('id', original.id));
      if (released.length !== 1 || released[0].state !== 'released' || released[0].owner_key !== ownerKey) {
        throw failure('The original reservation release is unconfirmed. No fresh recovery budget was reserved.');
      }
    }
  }
  return reserveBudget(connection, { budgetId: randomUUID(), ownerKey, ...callBudget, ttlSeconds: 600 });
}

function budgetFrom(batch, cases) {
  const forecast = batch.forecast || {};
  const operationCalls = Number(forecast.readCalls || 0) + Number(forecast.recoveryCalls || 0)
    + Number(forecast.otherActivityCalls || 0) + Number(forecast.writeCalls || 0);
  const verificationCalls = Number(forecast.verificationCalls || 0);
  const draftCount = cases.filter((row) => row.category === 'draft').length;
  const contactCount = cases.filter((row) => row.category === 'contact').length;
  const paymentCount = cases.filter((row) => row.category === 'link_only' && row.sourceObject === 'Payment__c').length;
  if (!Number.isSafeInteger(operationCalls) || !Number.isSafeInteger(verificationCalls)
    || operationCalls < 1 || verificationCalls < cases.length + contactCount + paymentCount + draftCount
    || operationCalls + verificationCalls > 10_000) {
    throw failure('The approved Xero call budget is incomplete.');
  }
  return { operationCalls, verificationCalls };
}

/** Execute a claimed batch. All durable mapping writes belong to finish_v1. */
export async function executeCampaignBatch({ client, connection, campaign, batch, cases, actor, env = process.env, fetchImpl,
  recovering = false, accountingFetch = xeroAccountingFetch,
  loadSalesforce = loadSalesforceFinancialSnapshot, loadControls = loadStoredFinancialControls,
  refreshInventory = refreshCampaignInventory, classify = buildFinancialClassifications,
  executeContact = executeCampaignContactCase, loadPayments = loadSalesforcePayments,
  classifyPayments = previewPayments,
  reserveBudget = reserveXeroBudget, withBudget = runWithXeroBudget, releaseBudget = releaseXeroBudget,
  persistInventory = async (args) => client.rpc('xero_campaign_inventory_v1', args) } = {}) {
  if (!client || !connection?.tenantId || !campaign?.id || campaign.tenant_id !== connection.tenantId
    || !batch?.id || !batch.claim_id || !Array.isArray(cases) || !cases.length || cases.length > MAX_CLAIM
    || new Set(cases.map((row) => row.id)).size !== cases.length
    || cases.some((row) => row.category !== batch.category || !/^[a-f0-9]{64}$/.test(row.evidenceFingerprint || ''))) {
    throw failure('The claimed campaign, tenant or case evidence is invalid.');
  }
  const run = await one(client.from('xero_financial_sync_runs').select('*').eq('id', campaign.review_run_id || campaign.run_id), 'saved financial check');
  const snapshot = run.control_totals?.workflowSnapshot;
  let inventory = campaign.inventory || snapshot?.inventory;
  if (!inventory && snapshot?.inventoryReference) {
    const captured = await loadPublishedPreviewCheckpoint(client, snapshot.inventoryReference,
      { runId: run.id, actorId: actor.id, tenantId: connection.tenantId });
    inventory = { ...captured.payload.provider.xero, observedSince: captured.payload.snapshotStartedAt, complete: true };
  }
  if (!snapshot?.complete || !snapshot.linkFirst || !inventory?.complete || inventory.tenantId !== connection.tenantId) {
    throw failure('A complete same-tenant link-first inventory is required.');
  }
  const items = (await allFinancialRows(client, 'xero_financial_sync_items', (query) => query.eq('run_id', run.id))).data;
  const bySource = new Map(items.map((item) => [`${item.source_object}:${item.source_id}`, item]));
  const targetCases = cases.filter((row) => row.category === 'link_only' && row.sourceObject !== 'Payment__c');
  let selectedInvoiceIds = targetCases.filter((row) => bySource.get(`${row.sourceObject}:${row.sourceId}`)?.source_payload?.xeroCollection === 'Invoices')
    .map((row) => row.targetId);
  const selectedCreditNoteIds = targetCases.filter((row) => bySource.get(`${row.sourceObject}:${row.sourceId}`)?.source_payload?.xeroCollection === 'CreditNotes')
    .map((row) => row.targetId);
  const callBudget = budgetFrom(batch, cases);
  const budget = await claimBudget({ client, connection, campaign, batch, callBudget, recovering, reserveBudget, releaseBudget });
  if (!budget?.id) throw failure('The shared Xero call reservation was not confirmed.');
  let unresolvedWrite = false;
  try {
    return await withBudget(connection, { budgetId: budget.id, budgetPhase: 'operation' }, async () => {
      const [salesforce, stored] = await Promise.all([loadSalesforce(XERO_FINANCIAL_CUTOFF), loadControls(client)]);
      if (salesforce?.groupedAccountSnapshot?.complete !== true) throw failure('Current Salesforce Account evidence is incomplete.');
      const paymentCases = cases.filter((row) => row.category === 'link_only' && row.sourceObject === 'Payment__c');
      const savedPayments = new Map((snapshot.payments?.rows || []).map((row) => [row.salesforcePaymentId, row]));
      selectedInvoiceIds = [...new Set([...selectedInvoiceIds, ...paymentCases.map((row) =>
        stored.documentMappings.find((mapping) => mapping.id === savedPayments.get(row.sourceId)?.documentMappingId)?.xero_document_id)
        .filter(Boolean)])];
      let refreshed = await refreshInventory({ connection, inventory, env, fetchImpl, accountingFetch,
        selectedInvoiceIds, selectedCreditNoteIds });
      if (!refreshed?.complete || refreshed.tenantId !== connection.tenantId) throw failure('Fresh Xero inventory is incomplete.');
      const saved = await persistInventory({ p_actor: actor.id, p_campaign: campaign.id,
        p_claim: batch.claim_id, p_inventory: refreshed });
      if (saved?.error || !saved?.data) throw failure('Fresh inventory could not be saved under the claim.');
      const classified = classify(salesforce, refreshed, stored, { postingMode: run.control_totals?.postingMode || 'draft', linkFirst: true });
      if (!Array.isArray(classified?.rows)) throw failure('Fresh financial classification is incomplete.');
      const freshBySource = new Map(classified.rows.map((row) => [`${row.salesforceObject}:${row.salesforceId}`, row]));
      let freshPayments = new Map();
      if (paymentCases.length) {
        const sourcePayments = await loadPayments(XERO_FINANCIAL_CUTOFF, salesforce.safetyContext);
        const current = await classifyPayments({ recordExactMatches: false }, { accessContext: { profile: actor },
          env, fetchImpl, client, xeroReadSnapshot: { ...refreshed.paymentReadSnapshot, sourcePayments } });
        if (current?.tenantId !== connection.tenantId || !Array.isArray(current.rows)) throw failure('Fresh payment classification is incomplete.');
        freshPayments = new Map(current.rows.map((row) => [row.salesforcePaymentId, row]));
      }
      const prepared = cases.map((caseRow) => caseRow.category === 'draft'
        ? { status: 'pending_draft', caseRow }
        : caseRow.category === 'contact'
        ? { status: 'pending_contact', caseRow }
        : caseRow.category === 'link_only' && caseRow.sourceObject === 'Payment__c'
          ? paymentOutcome(caseRow, savedPayments.get(caseRow.sourceId), freshPayments.get(caseRow.sourceId), refreshed, stored, env)
        : caseRow.category === 'link_only' && caseRow.sourceObject !== 'Payment__c'
        ? documentOutcome(caseRow, bySource.get(`${caseRow.sourceObject}:${caseRow.sourceId}`),
          freshBySource.get(`${caseRow.sourceObject}:${caseRow.sourceId}`), refreshed, stored)
        : hold(caseRow, `${caseRow.category} requires its original verified operation receipt.`));
      const results = [];
      let currentContacts = refreshed.contacts;
      let contactsAwaitingInventory = false;
      for (const row of prepared) {
        if (row.status === 'pending_draft') {
          if (reviewedPostingMode(run) !== 'draft') throw failure('Campaign document creation requires reviewed DRAFT posting mode.');
          const item = bySource.get(`${row.caseRow.sourceObject}:${row.caseRow.sourceId}`);
          unresolvedWrite = true;
          const outcome = await executeDraft({ client, connection, campaign, batch, caseRow: row.caseRow,
            item, fresh: freshBySource.get(`${row.caseRow.sourceObject}:${row.caseRow.sourceId}`), refreshed,
            actor, env, fetchImpl, recovering, accountingFetch, withBudget, budgetId: budget.id,
            recheckSource: async () => {
              const [currentSource, currentControls] = await Promise.all([loadSalesforce(XERO_FINANCIAL_CUTOFF), loadControls(client)]);
              const current = classify(currentSource, refreshed, currentControls, { postingMode: 'draft', linkFirst: true });
              const matches = current?.rows?.filter((fresh) => fresh.salesforceObject === row.caseRow.sourceObject && fresh.salesforceId === row.caseRow.sourceId);
              if (currentSource?.groupedAccountSnapshot?.complete !== true || matches?.length !== 1
                || matches[0].financialFingerprint !== item?.source_payload?.financialFingerprint
                || xeroReviewFingerprint(matches[0]) !== savedReview(item)) throw failure('Source or accounting controls changed immediately before the draft POST.');
            } });
          results.push(outcome);
          unresolvedWrite = false;
          continue;
        }
        if (row.status === 'pending_contact') {
          unresolvedWrite = true;
          const outcome = await executeContact({ case: row.caseRow, currentAccounts: salesforce.groupedAccountSnapshot.accounts,
            currentContacts, connection, client, actor, batch, env, fetchImpl, recovering, accountingFetch, budgetId: budget.id });
          if (outcome?.caseId === row.caseRow.id && outcome.evidenceFingerprint === row.caseRow.evidenceFingerprint
            && outcome.status === 'needs_decision' && outcome.definitiveNoWrite === true && typeof outcome.reason === 'string' && outcome.reason.trim()) {
            results.push(outcome);
            unresolvedWrite = contactsAwaitingInventory;
            continue;
          }
          if (outcome?.status !== 'reconciled' || !outcome.receiptId || !outcome.verifiedContact?.id) {
            throw failure('The Contact adapter did not return a verified original operation receipt.');
          }
          results.push(outcome);
          contactsAwaitingInventory = true;
          currentContacts = [...currentContacts.filter((contact) => contact.id !== outcome.verifiedContact.id), outcome.verifiedContact];
          continue;
        }
        if (row.status === 'pending_payment_verification') {
          let paymentResponse; let invoiceResponse;
          try {
            paymentResponse = await withBudget(connection, { budgetId: budget.id, budgetPhase: 'verification' },
              () => accountingFetch(connection, `/Payments/${encodeURIComponent(row.xeroPaymentId)}`, { method: 'GET', env, fetchImpl }));
            invoiceResponse = await withBudget(connection, { budgetId: budget.id, budgetPhase: 'verification' },
              () => accountingFetch(connection, `/Invoices?IDs=${encodeURIComponent(row.xeroInvoiceId)}&summaryOnly=false&unitdp=4`,
                { method: 'GET', env, fetchImpl }));
          } catch (error) {
            if (error?.status !== 404) throw error;
            results.push(hold(cases.find((item) => item.id === row.caseId), 'The exact payment or invoice disappeared before verification.'));
            continue;
          }
          const payment = paymentResponse?.Payments;
          const invoice = invoiceResponse?.Invoices;
          const second = Array.isArray(payment) && payment.length === 1
            && payment[0]?.PaymentID === row.xeroPaymentId
            && Array.isArray(invoice) && invoice.length === 1
            && invoice[0]?.InvoiceID === row.xeroInvoiceId
            ? { raw: canonical(payment[0]), document: allocationProof(invoice[0], 'Invoices') } : null;
          if (!second?.document || digest(second) !== digest(row.paymentProof)) {
            results.push(hold(cases.find((item) => item.id === row.caseId), 'Payment or invoice allocation evidence changed during exact readback.'));
            continue;
          }
          results.push({ caseId: row.caseId, evidenceFingerprint: row.evidenceFingerprint,
            status: 'reconciled', verificationFingerprint: digest({ first: row.paymentProof, second,
              sourceFingerprint: row.paymentEvidence.sourceFingerprint,
              reviewFingerprint: row.paymentEvidence.reviewFingerprint }),
            ...(Object.keys(row.persistenceProof).length ? row.persistenceProof : { paymentMapping: row.paymentMapping }),
            paymentEvidence: row.paymentEvidence });
          continue;
        }
        if (row.status !== 'pending_verification') { results.push(row); continue; }
        const path = `/${row.collection}?IDs=${encodeURIComponent(row.targetId)}&summaryOnly=false&unitdp=4`;
        let response;
        try {
          response = await withBudget(connection, { budgetId: budget.id, budgetPhase: 'verification' },
            () => accountingFetch(connection, path, { method: 'GET', env, fetchImpl }));
        } catch (error) {
          if (error?.status !== 404) throw error;
          results.push(hold(cases.find((item) => item.id === row.caseId), 'The exact Xero target disappeared before verification.'));
          continue;
        }
        const matches = response?.[row.collection];
        if (!Array.isArray(matches) || matches.length !== 1 || documentIdentity(matches[0], row.collection)?.toLowerCase() !== row.targetId.toLowerCase()) {
          results.push(hold(cases.find((item) => item.id === row.caseId), 'The exact Xero target was not uniquely present on verification readback.'));
          continue;
        }
        const second = allocationProof(matches[0], row.collection);
        if (!second || digest(second) !== digest(row.proof)) {
          results.push(hold(cases.find((item) => item.id === row.caseId), 'Xero settlement or line evidence changed during verification.'));
          continue;
        }
        results.push({ caseId: row.caseId, evidenceFingerprint: row.evidenceFingerprint,
          status: 'reconciled', verificationFingerprint: digest({ first: row.proof, second,
            sourceFingerprint: row.sourceFingerprint, reviewFingerprint: row.reviewFingerprint }), mapping: row.mapping });
      }
      if (cases.some((row) => row.category === 'contact') && contactsAwaitingInventory) {
        refreshed = await refreshInventory({ connection, inventory: { ...refreshed, contacts: currentContacts },
          env, fetchImpl, accountingFetch });
        if (!refreshed?.complete || refreshed.tenantId !== connection.tenantId) throw failure('Contact inventory readback is incomplete.');
        for (const outcome of results.filter((result) => result.status === 'reconciled')) {
          const caseRow = cases.find((item) => item.id === outcome.caseId);
          const unresolved = buildCampaignContactCases({ tenantId: connection.tenantId,
            accounts: salesforce.groupedAccountSnapshot.accounts, contacts: refreshed.contacts, complete: true,
            requiredAccountIds: outcome.sourceIds || caseRow?.sourceIds || [], ownerId: caseRow.ownerId,
            baselineAt: caseRow.baselineAt });
          if (unresolved.length) throw failure('Final Contact inventory has a changed identity or collision. Read back the claimed outcome.');
        }
        const savedContacts = await persistInventory({ p_actor: actor.id, p_campaign: campaign.id,
          p_claim: batch.claim_id, p_inventory: refreshed });
        if (savedContacts?.error || !savedContacts?.data) throw failure('Verified Contact inventory could not be saved.');
        unresolvedWrite = false;
      }
      return results;
    });
  } finally {
    if (!unresolvedWrite) await releaseBudget(connection, { budgetId: budget.id,
      reason: recovering ? 'Recovered claim verified' : 'Claim verified' });
  }
}
