import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { sfQuery, sfQueryAll } from './_salesforce.js';
import { getFreshXeroConnection, splitScopes, xeroAccountingFetch } from './_xeroContactSync.js';
import { previewEvidenceHash as hash } from './_xeroPreviewPersistence.js';
import { readXeroSharedStatus, runWithXeroBudget } from './_xeroSharedControl.js';
import { readExistingDraftQuotaPolicy, reserveExistingDraftQuota, releaseExistingDraftQuota, existingDraftSpendableCalls } from './_xeroExistingDraftQuota.js';
import { loadDocumentCorrectionInvoicePages } from './_xeroDocumentCorrectionScope.js';
import { readPaidSupplierContacts } from './_xeroPaidSupplierPagedRead.js';
import { buildFinancialClassifications, loadSalesforceDocumentLinkSnapshot,
  loadStoredDocumentLinkControls, normalizeXeroInvoice, normalizeXeroCreditNote, XERO_FINANCIAL_CUTOFF } from './_xeroFinancialSync.js';
import { loadPaymentPostingClaims } from './_xeroPaymentPosting.js';

const captures = new WeakMap();
const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const uid = v => typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : null;
const sf = v => typeof v === 'string' && /^[A-Za-z\d]{15}(?:[A-Za-z\d]{3})?$/.test(v) ? v.slice(0, 15) : null;
const sameSf = (a, b) => sf(a) !== null && sf(a) === sf(b);
const text = v => typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').toUpperCase() : '';
const unique = v => [...new Set(v)].sort();
const fail = (message, code = 'XERO_DRAFT_STATUS_EVIDENCE_INCOMPLETE') => Object.assign(Error(message), { code, status: 409 });
const assert = (ok, message, code) => { if (!ok) throw fail(message, code); };
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = v => structuredClone(v);
const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
const chunks = v => Array.from({ length: Math.ceil(v.length / 50) }, (_, i) => v.slice(i * 50, (i + 1) * 50));
const literal = v => `'${v}'`;

export function existingDraftAuthorisationForecast(count, applying = false) {
  assert(Number.isSafeInteger(count) && count >= 1 && count <= 25, 'Choose 1–25 exact approved drafts.');
  // Complete bounded inventories, not 54 repeats of the same owner discovery.
  const inventoryCalls = 11 + 4 + 6 + 4;
  const operationCalls = inventoryCalls + count + (applying ? count * 3 : 0);
  const verificationCalls = applying ? count * 2 : 0;
  return { count, inventoryCalls, operationCalls, verificationCalls, totalCalls: operationCalls + verificationCalls,
    reserve: 200, minimumAvailableCalls: 200 + operationCalls + verificationCalls,
    callsPerMinute: 45, maxConcurrent: 2, automaticRetries: 0, recoveryCalls: applying ? count : 0 };
}

async function boundedMap(values, job) {
  const result = new Array(values.length); let next = 0, error;
  const worker = async () => { while (!error && next < values.length) { const i = next++; try { result[i] = await job(values[i], i); } catch (e) { error ||= e; } } };
  await Promise.all([worker(), worker()]); if (error) throw error; return result;
}

async function rows(client, table, configure = q => q) {
  const result = [], seen = new Set();
  for (let offset = 0; offset <= 10_000; offset += 500) {
    const r = await configure(client.from(table).select('*')).order('id').range(offset, offset + 499);
    assert(!r.error && Array.isArray(r.data) && r.data.every(row => uid(row.id) && !seen.has(row.id)) && new Set(r.data.map(row => uid(row.id))).size === r.data.length, 'Complete bounded stored controls are unavailable.');
    for (const row of r.data) { seen.add(row.id); result.push(row); }
    assert(result.length <= 10_000, 'Stored controls exceed their complete bound.');
    if (r.data.length < 500) return result;
  }
  throw fail('Stored controls exceed their complete bound.');
}

async function credits(connection, read) {
  const records = [], seen = new Set(); let expected;
  for (let page = 1; page <= 6; page++) {
    const p = new URLSearchParams({ page: String(page), pageSize: '1000', order: 'CreditNoteID ASC', includeArchived: 'true', unitdp: '4' });
    const r = await read(connection, `/CreditNotes?${p}`);
    assert(Array.isArray(r.CreditNotes) && r.CreditNotes.length <= 1000, 'Credit-note scope is incomplete.');
    const pagination = r.pagination;
    if (pagination != null) {
      assert(plain(pagination) && ['page', 'pageSize', 'itemCount', 'pageCount'].every(k => pagination[k] === undefined || Number.isSafeInteger(pagination[k]) && pagination[k] >= 0)
        && (pagination.page === undefined || pagination.page === page) && (pagination.pageSize === undefined || pagination.pageSize === 1000), 'Credit-note pagination is invalid.');
      const count = { itemCount: pagination.itemCount ?? null, pageCount: pagination.pageCount ?? null };
      assert(!expected || hash(expected) === hash(count), 'Credit-note inventory changed while reading.'); expected = count;
      assert(count.itemCount === null || count.itemCount <= 5000, 'Credit-note scope exceeds its complete bound.');
    } else assert(!expected, 'Credit-note pagination disappeared.');
    for (const row of r.CreditNotes) { const id = uid(row?.CreditNoteID); assert(id && !seen.has(id), 'Credit-note identity repeats or is missing.'); seen.add(id); records.push(row); }
    assert(records.length <= 5000, 'Credit-note scope exceeds its complete bound.');
    if (r.CreditNotes.length < 1000) { assert(expected?.itemCount == null || expected.itemCount === records.length, 'Credit-note scope was truncated.'); assert(expected?.pageCount == null || page >= expected.pageCount, 'Credit-note pages are missing.'); return records; }
    if (expected?.itemCount === records.length && expected?.pageCount === page) return records;
  }
  throw fail('Credit-note inventory exceeds its complete bound.');
}

export async function readExistingDraftDetail(connection, targetId, read, phase = 'operation') {
  assert(uid(targetId), 'An exact approved target is required.');
  const r = await read(connection, `/Invoices/${targetId}?unitdp=4`, { budgetPhase: phase });
  assert(Array.isArray(r.Invoices) && r.Invoices.length === 1 && uid(r.Invoices[0]?.InvoiceID) === uid(targetId)
    && (!r.pagination || r.pagination.itemCount === 1 && r.pagination.pageCount === 1 && r.pagination.page === 1), 'The exact full invoice detail is unavailable.');
  return clone(r.Invoices[0]);
}

// This transient capture, never HTTP evidence or flags, is the only collector output accepted by the workflow.
export const existingDraftCollectionPrivateEvidence = collection => captures.get(collection) || null;
export async function collectExistingDraftAuthorisation({ targetIds } = {}, deps = {}) {
  const actorId = uid(deps.accessContext?.profile?.id);
  const actor = { id: actorId, email: String(deps.accessContext?.profile?.email || '').trim().toLowerCase() };
  assert(actorId && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(actor.email) && Array.isArray(targetIds) && targetIds.length >= 1 && targetIds.length <= 25
    && targetIds.every(v => uid(v) === v) && new Set(targetIds).size === targetIds.length, 'An authenticated exact approved draft scope is required.');
  const client = deps.client, env = deps.env || process.env, fetchImpl = deps.fetchImpl;
  assert(client?.from, 'Server storage is unavailable.');
  const expectedOrg = fcosSalesforceEnvironment('production');
  const orgRead = await (deps.query || sfQuery)('SELECT Id, IsSandbox FROM Organization', { clean: true, limit: 2 });
  assert(!orgRead.error && orgRead.totalSize === 1 && orgRead.records?.length === 1
    && orgRead.records[0].Id === expectedOrg.orgId && orgRead.records[0].IsSandbox === false, 'The exact read-only Salesforce Production connection is unverified.');
  const connection = deps.connection || await (deps.getConnection || getFreshXeroConnection)(client, { env, fetchImpl });
  const startedAt = new Date().toISOString(), tenantId = uid(connection?.tenantId), tokenVersion = connection?.tokenVersion;
  const scopes = splitScopes(connection?.scope || '');
  assert(tenantId && connection.accessToken && Number.isSafeInteger(tokenVersion) && tokenVersion > 0
    && scopes.some(s => ['accounting.invoices', 'accounting.transactions'].includes(s)) && scopes.includes('accounting.contacts')
    && scopes.some(s => ['accounting.settings', 'accounting.settings.read'].includes(s)), 'The scoped Xero connection is unavailable.');
  const approvedRead = await client.from('xero_existing_draft_authorisation_approved_records').select('*').eq('tenant_id', tenantId).in('target_id', targetIds).order('target_id').limit(26);
  assert(!approvedRead.error && Array.isArray(approvedRead.data), 'Approved scope storage is unavailable.');
  const selected = approvedRead.data;
  assert(selected.length === targetIds.length && new Set(selected.map(r => uid(r.target_id))).size === targetIds.length,
    'The exact human-approved draft records are unavailable.');
  const approved = targetIds.map(id => selected.find(r => uid(r.target_id) === id));
  assert(approved.every(r => r && uid(r.tenant_id) === tenantId && plain(r.selection) && plain(r.reviewed_target)), 'Approved original evidence is incomplete.');
  const policy = await (deps.readQuotaPolicy || readExistingDraftQuotaPolicy)(connection, { client, actor, targetIds });
  const planned = existingDraftAuthorisationForecast(targetIds.length, deps.applying === true);
  const combinedCalls = planned.totalCalls + (deps.applying === true ? 0 : existingDraftAuthorisationForecast(targetIds.length, true).totalCalls);
  const forecast = { ...planned, reserve: policy.reserveFloor, minimumAvailableCalls: policy.reserveFloor + planned.totalCalls,
    startRequiredCalls: combinedCalls, minimumStartAvailableCalls: policy.reserveFloor + combinedCalls };
  const guard = () => assert(!deps.signal?.aborted && uid(connection.tenantId) === tenantId && connection.tokenVersion === tokenVersion
    && Date.parse(connection.expiresAt) > Date.now() + 90_000 && Date.now() - Date.parse(startedAt) <= 600_000,
  'The draft-status observation was cancelled or its connection expired.');
  guard();
  const status = await (deps.readStatus || readXeroSharedStatus)(connection);
  assert(status?.allowanceKnown === true && Number.isSafeInteger(status.availableCalls) && Number.isSafeInteger(status.reservedCalls)
    && status.reservedCalls >= 0 && !status.dailyHold && !status.retryAt && status.unresolvedWrites === 0
    && existingDraftSpendableCalls(status, policy) >= combinedCalls,
  'The complete draft-status batch, verification and recovery cannot fit within the current scoped Xero allowance.', 'XERO_DRAFT_STATUS_QUOTA_HELD');
  const budget = await (deps.reserveBudget || reserveExistingDraftQuota)(connection, { client, actor, targetIds,
    mode: deps.applying === true ? 'apply' : 'preview', runId: deps.applying === true ? deps.runId : null, ttlSeconds: 600 });
  assert(uid(budget?.id), 'Draft-status capacity was not durably reserved.');
  if (budget.reserveFloor !== policy.reserveFloor) {
    // A grant can expire between policy lookup and atomic reservation. Return
    // the unused capacity without making any provider request.
    await (deps.releaseBudget || releaseExistingDraftQuota)(connection, { client, actor, budgetId: budget.id, reason: 'Quota scope changed before collection' });
    throw fail('Draft-status capacity was not durably reserved under the current scope.');
  }
  const receipts = [], sourceReads = []; let calls = 0, released = false;
  const read = async (current, path, options = {}) => {
    guard(); assert(current === connection && (!options.method || options.method === 'GET'), 'Draft-status collection permits scoped GETs only.');
    const phase = options.budgetPhase || 'operation'; assert(['operation', 'verification'].includes(phase), 'Invalid draft-status read phase.'); calls++;
    let receiptCount = 0;
    const response = await (deps.withBudget || runWithXeroBudget)(connection, { budgetId: budget.id, budgetPhase: phase }, () =>
      (deps.accountingFetch || xeroAccountingFetch)(connection, path, { ...options, method: 'GET', budgetId: budget.id, budgetPhase: phase,
        env, fetchImpl, transientRetryLimit: 0, retryOnRateLimit: false, callsPerMinute: 45, maxConcurrent: 2,
        onResponse(event) { assert(uid(event.requestId) && event.method === 'GET' && event.pathName === path && uid(event.budgetId) === uid(budget.id)
          && event.status >= 200 && event.status < 300 && !receipts.some(r => r.requestId === event.requestId), 'The complete read receipt is unavailable.');
        receiptCount++; receipts.push({ requestId: event.requestId, budgetId: budget.id, tenantId, tokenVersion, method: 'GET', path, status: event.status, phase }); } }));
    guard(); assert(receiptCount === 1, 'The successful scoped read has no exact durable receipt.'); assert(plain(response) && response.HasErrors !== true && response.HasValidationErrors !== true
      && (response.ValidationErrors === undefined || Array.isArray(response.ValidationErrors) && response.ValidationErrors.length === 0), 'Xero returned invalid draft-status evidence.');
    assert(response.Pagination === undefined || response.pagination === undefined || hash(response.Pagination) === hash(response.pagination), 'Xero returned conflicting pagination.');
    return response.Pagination && !response.pagination ? { ...response, pagination: response.Pagination } : response;
  };
  const release = async reason => { if (!released) { await (deps.releaseBudget || releaseExistingDraftQuota)(connection, { client, actor, budgetId: budget.id, reason }); released = true; } };
  try {
    const inventoryResults = await Promise.allSettled([
      (deps.loadInvoicePages || loadDocumentCorrectionInvoicePages)(connection, '/Invoices?', { accountingFetch: read }),
      (deps.readContacts || readPaidSupplierContacts)(connection, read, { signal: deps.signal }),
    ]);
    const rejected = inventoryResults.find(r => r.status === 'rejected'); if (rejected) throw rejected.reason;
    const [invoices, contactsRaw] = inventoryResults.map(r => r.value);
    const creditNotes = await credits(connection, read);
    const [orgs, accounts, taxes] = await boundedMap(['/Organisations', '/Accounts', '/TaxRates'], path => read(connection, path));
    assert(orgs.Organisations?.length === 1 && uid(orgs.Organisations[0]?.OrganisationID) === tenantId
      && orgs.Organisations[0]?.BaseCurrency === 'USD' && Array.isArray(accounts.Accounts) && Array.isArray(taxes.TaxRates), 'The exact Xero organisation and accounting settings are unavailable.');
    const organisation = orgs.Organisations[0];
    const contacts = contactsRaw.map(r => ({ id: uid(r.ContactID), name: r.Name, status: r.ContactStatus,
      accountNumber: r.AccountNumber ?? '', contactNumber: r.ContactNumber ?? '', mergedToContactId: r.MergedToContactID || null }));
    const snapshot = { tenantId, complete: true, contactsComplete: true, documentIdentityScopeComplete: true, cutoffDate: XERO_FINANCIAL_CUTOFF,
      contacts, documents: [...invoices.map(normalizeXeroInvoice), ...creditNotes.map(normalizeXeroCreditNote)].filter(r => ['DRAFT','SUBMITTED','AUTHORISED','PAID'].includes(r.status)),
      inactiveDocuments: [...invoices.map(normalizeXeroInvoice), ...creditNotes.map(normalizeXeroCreditNote)].filter(r => !['DRAFT','SUBMITTED','AUTHORISED','PAID'].includes(r.status)),
      organisation: { periodLockDate: organisation.PeriodLockDate || null, endOfYearLockDate: organisation.EndOfYearLockDate || null, baseCurrency: organisation.BaseCurrency } };
    const links = approved.map(r => ({ category: 'link_only', sourceObject: r.source_object, sourceId: r.source_id, targetId: r.target_id }));
    const query = async requests => {
      const results = await boundedMap(requests, async request => {
        guard(); const soql = request.soql.replace(/^\s*SELECT\s+/i, 'SELECT IsDeleted, ');
        const r = await (deps.queryAll || sfQueryAll)(soql, { clean: true, limit: 100000 });
        assert(!r.error && r.done !== false && !r.nextRecordsUrl && Array.isArray(r.records) && r.totalSize === r.records.length
          && r.records.every(row => sf(row.Id) && typeof row.IsDeleted === 'boolean') && new Set(r.records.map(row => sf(row.Id))).size === r.records.length,
        'Complete read-only Salesforce source evidence is unavailable.');
        sourceReads.push({ soql, rawRecords: clone(r.records), complete: true, queryAll: true, fingerprint: hash(r.records) });
        const active = r.records.filter(row => !row.IsDeleted); return { records: active, totalSize: active.length, done: true };
      }); return results;
    };
    const salesforce = await (deps.loadSources || loadSalesforceDocumentLinkSnapshot)(XERO_FINANCIAL_CUTOFF, links, { querySalesforce: query, xeroSnapshot: snapshot });
    assert(salesforce.groupedAccountSnapshot?.complete === true && salesforce.documentLinkScope?.complete === true, 'Global source ownership is incomplete.');
    const stored = await (deps.loadControls || loadStoredDocumentLinkControls)(client, { salesforce, xeroSnapshot: snapshot, documentLinks: links });
    const { sources } = buildFinancialClassifications(salesforce, snapshot, stored, { postingMode: 'draft', linkFirst: true });
    const detail = await boundedMap(targetIds, id => readExistingDraftDetail(connection, id, read));
    const stemIds = unique(approved.flatMap(r => sources.filter(s => s.salesforceObject === r.source_object && sameSf(s.salesforceId, r.source_id)).map(s => s.stemId)));
    assert(stemIds.length > 0 && stemIds.every(sf), 'A selected STEM identity is missing.');
    const paymentFields = 'Id, IsDeleted, Name, RecordType.DeveloperName, Supplier_Invoice__c, Remittance__c, STEM__c, Account__c, Bank__c, Is_Deposit__c, Is_Volume_Discount__c, Commission_Invoice__c, Amount__c, Date__c, Reference__c, CreatedDate, LastModifiedDate';
    const paymentQuery = async predicate => {
      guard(); const soql = `SELECT ${paymentFields} FROM Payment__c WHERE ${predicate} ORDER BY Id`;
      const r = await (deps.queryAll || sfQueryAll)(soql, { clean: true, limit: 10000 });
      assert(!r.error && r.done !== false && !r.nextRecordsUrl && Array.isArray(r.records) && r.totalSize === r.records.length
        && r.records.every(p => sf(p.Id) && typeof p.IsDeleted === 'boolean')
        && new Set(r.records.map(p => sf(p.Id))).size === r.records.length, 'Payment dependencies are incomplete.');
      sourceReads.push({ soql, rawRecords: clone(r.records), complete: true, queryAll: true, fingerprint: hash(r.records) }); return r.records;
    };
    const payments = await paymentQuery(`STEM__c IN (${stemIds.map(literal).join(',')})`);
    const remittanceIds = unique(payments.map(p => sf(p.Remittance__c)).filter(Boolean));
    const families = remittanceIds.length ? await paymentQuery(`Id IN (${remittanceIds.map(literal).join(',')}) OR Remittance__c IN (${remittanceIds.map(literal).join(',')})`) : [];
    const paymentIds = unique([...payments, ...families].map(p => p.Id));
    const postingClaims = [];
    for (const ids of chunks(paymentIds)) postingClaims.push(...(await loadPaymentPostingClaims(client, tenantId, ids)).values());
    const [disputes, references] = await Promise.all([
      rows(client, 'dispute_beta_cases', q => q.or(stemIds.map(id => `stem_id.like.${sf(id)}%`).join(','))),
      rows(client, 'xero_financial_payment_mappings', q => q.in('document_mapping_id', stored.documentMappings.filter(m => targetIds.includes(uid(m.xero_document_id))).map(m => m.id))),
    ]);
    assert(disputes.every(row => stemIds.some(id => sameSf(id, row.stem_id))), 'Dispute scope returned an unrelated STEM.');
    const orgAfter = await read(connection, '/Organisations');
    assert(orgAfter.Organisations?.length === 1 && hash(orgAfter.Organisations[0]) === hash(organisation), 'Organisation accounting locks changed during collection.');
    const discoveryFingerprint = hash({ accounts: salesforce.groupedAccountSnapshot, contacts: contactsRaw, invoices, creditNotes });
    const globalControls = { ...stored, disputes, references, postingClaims };
    const items = approved.map((r, i) => {
      try {
      const src = sources.filter(s => s.salesforceObject === r.source_object && sameSf(s.salesforceId, r.source_id));
      assert(src.length === 1 && src[0].blockers.length === 0, 'The current source financial evidence is incomplete or changed.');
      // Match the existing builder's JSON persistence semantics; provider originals stay untouched.
      const source = JSON.parse(JSON.stringify(src[0])), before = detail[i];
      const mappings = stored.documentMappings.filter(m => sameSf(m.salesforce_id, source.salesforceId) && m.salesforce_object === source.salesforceObject || uid(m.xero_document_id) === r.target_id);
      assert(mappings.length === 1 && mappings[0].salesforce_object === source.salesforceObject && sameSf(mappings[0].salesforce_id, source.salesforceId)
        && uid(mappings[0].xero_document_id) === r.target_id && mappings[0].xero_document_type === source.xeroType && uid(mappings[0].xero_contact_id) === uid(source.contactId)
        && /^[a-f0-9]{64}$/.test(mappings[0].source_fingerprint || '') && /^[a-f0-9]{64}$/.test(mappings[0].financial_fingerprint || ''),
      'The exact existing draft ownership or accepted source provenance changed.');
      // Accepted hashes identify the original creation evidence. Current builder
      // metadata/formatting is a different domain; the dedicated policy checks
      // current signed accounting buckets against the approved existing target.
      // Never replace those original mapping hashes.
      const account = salesforce.groupedAccountSnapshot.accounts.filter(a => sameSf(a.id, source.accountId));
      const contact = contacts.filter(c => c.id === uid(source.contactId));
      const nameFamily = salesforce.groupedAccountSnapshot.accounts.filter(a => text(a.name) === text(source.accountName));
      assert(account.length === 1 && account[0].inactiveSuspended === false && contact.length === 1 && contact[0].status === 'ACTIVE'
        && !contact[0].mergedToContactId && text(contact[0].name) === text(source.accountName)
        && contacts.filter(c => c.status === 'ACTIVE' && text(c.name) === text(source.accountName)).length === 1,
      'The active Account and unique same-name Contact identity changed.');
      for (const value of [contact[0].accountNumber, contact[0].contactNumber]) if (/^001/i.test(value.trim())) assert(sf(value.trim()) && nameFamily.some(a => sameSf(a.id, value.trim())), 'The Contact claims a different explicit Salesforce Account.');
      assert(uid(before.Contact?.ContactID) === uid(source.contactId) && before.Type === source.xeroType, 'The current exact target Contact or type changed.');
      const num = text(before.InvoiceNumber);
      const targetClaims = invoices.filter(t => t.Type === source.xeroType && (uid(t.Contact?.ContactID) === uid(source.contactId) || source.xeroType === 'ACCREC' && text(t.InvoiceNumber) === num));
      assert(!targetClaims.some(t => uid(t.InvoiceID) !== r.target_id && !['DELETED','VOIDED','ARCHIVED'].includes(t.Status)
        && text(t.InvoiceNumber) === num && (source.xeroType === 'ACCREC' || uid(t.Contact?.ContactID) === uid(source.contactId))), 'Another active Xero record claims this invoice identity.');
      const sourceClaims = sources.filter(s => nameFamily.some(a => sameSf(a.id, s.accountId)));
      assert(!sourceClaims.some(s => !sameSf(s.salesforceId, source.salesforceId) && s.salesforceObject === source.salesforceObject
        && text(s.documentNumber) === text(source.documentNumber)), 'Another active Salesforce record claims this invoice identity.');
      const localPayments = payments.filter(p => sameSf(p.STEM__c, source.stemId)), localIds = unique([...localPayments, ...families].map(p => sf(p.Id)));
      assert(!postingClaims.some(c => localIds.includes(sf(c.control_totals?.paymentPosting?.paymentId)) && c.status !== 'completed'), 'A current payment operation on this STEM is unresolved.');
      assert(!references.some(ref => ref.document_mapping_id === mappings[0].id && !['applied','linked'].includes(ref.status)), 'A draft settlement mapping is unresolved.');
      assert(!disputes.some(d => sameSf(d.stem_id, source.stemId) && !['closed','resolved','cancelled'].includes(text(d.workflow_status).toLowerCase())), 'A selected STEM has an active dispute.');
      const parents = [...salesforce.buyers, ...salesforce.suppliers].filter(p => sameSf(p.Id, source.salesforceId));
      const children = [...salesforce.lines, ...salesforce.extras].filter(p => sameSf(p.Buyer_Invoice__c, source.salesforceId) || sameSf(p.Supplier_Invoice__c, source.salesforceId));
      const controls = { ...stored, documentMappings: mappings, disputes: disputes.filter(d => sameSf(d.stem_id, source.stemId)),
        references: references.filter(ref => ref.document_mapping_id === mappings[0].id), postingClaims: postingClaims.filter(c => localIds.includes(sf(c.control_totals?.paymentPosting?.paymentId))) };
      const identity = { accounts: nameFamily, contact: contact[0], sourceClaims, targetClaims, credits: creditNotes.filter(t => uid(t.Contact?.ContactID) === uid(source.contactId)),
        globalDiscoveryFingerprint: discoveryFingerprint, globalAccountCount: salesforce.groupedAccountSnapshot.accounts.length, globalContactCount: contactsRaw.length,
        complete: true, sourceScopeFingerprint: hash(salesforce.documentLinkScope), targetCount: invoices.length, creditCount: creditNotes.length };
      const sourceEvidence = { parents, children, products: salesforce.productRecords, safetyContext: salesforce.safetyContext,
        buyers: salesforce.buyers.filter(p => sameSf(p.STEM__c, source.stemId)), payments: localPayments, families: families.filter(p => localPayments.some(row => sameSf(row.Remittance__c, p.Id) || sameSf(row.Remittance__c, p.Remittance__c))), queryFingerprints: sourceReads.map(q => q.fingerprint) };
      const current = { tenantId, orgId: fcosSalesforceEnvironment('production').orgId, observedAt: new Date().toISOString(),
        sourceSnapshotHash: hash(sourceEvidence), controlSnapshotHash: hash(controls), identitySnapshotHash: hash(identity), organisation,
        sourceEvidence, controls, identity, receipts: { provider: clone(receipts) } };
      return { selection: clone(r.selection), source: clone(source), reviewedTarget: clone(r.reviewed_target), before, current };
      } catch (error) {
        return { selection: clone(r.selection), reviewedTarget: clone(r.reviewed_target), before: detail[i],
          held: { policyVersion: 'authorise_existing_xero_drafts_v1', targetId: r.target_id, reasonCode: /^[A-Z_]{1,100}$/.test(error.code || '') ? error.code : 'XERO_DRAFT_STATUS_RECORD_HELD', message: error.message } };
      }
    });
    guard();
    const recheck = async targetId => {
      guard();
      const index = targetIds.indexOf(targetId), expected = items[index];
      assert(index >= 0 && !expected.held, 'The exact current source is held.');
      const refreshed = await (deps.loadSources || loadSalesforceDocumentLinkSnapshot)(XERO_FINANCIAL_CUTOFF, [links[index]], { querySalesforce: query, xeroSnapshot: snapshot });
      assert(refreshed.groupedAccountSnapshot?.complete === true && refreshed.documentLinkScope?.complete === true, 'Source ownership became incomplete.');
      const currentControls = await (deps.loadControls || loadStoredDocumentLinkControls)(client, { salesforce: refreshed, xeroSnapshot: snapshot, documentLinks: [links[index]] });
      const rebuilt = buildFinancialClassifications(refreshed, snapshot, currentControls, { postingMode: 'draft', linkFirst: true }).sources
        .filter(s => s.salesforceObject === expected.source.salesforceObject && sameSf(s.salesforceId, expected.source.salesforceId));
      assert(rebuilt.length === 1 && hash(rebuilt[0]) === hash(expected.source), 'The source changed immediately before authorisation.');
      const nowMappings = currentControls.documentMappings.filter(m => uid(m.xero_document_id) === targetId || sameSf(m.salesforce_id, expected.source.salesforceId) && m.salesforce_object === expected.source.salesforceObject);
      assert(hash(nowMappings) === hash(expected.current.controls.documentMappings), 'The stored ownership changed immediately before authorisation.');
      const family = refreshed.groupedAccountSnapshot.accounts.filter(a => text(a.name) === text(expected.source.accountName));
      assert(hash(family) === hash(expected.current.identity.accounts), 'The current Account identity changed.');
      const nowPayments = await paymentQuery(`STEM__c = ${literal(expected.source.stemId)}`);
      assert(hash(nowPayments) === hash(expected.current.sourceEvidence.payments), 'Current settlement evidence changed.');
      const familyIds = unique(nowPayments.map(p => sf(p.Remittance__c)).filter(Boolean));
      const nowFamilies = familyIds.length ? await paymentQuery(`Id IN (${familyIds.map(literal).join(',')}) OR Remittance__c IN (${familyIds.map(literal).join(',')})`) : [];
      assert(hash(nowFamilies) === hash(expected.current.sourceEvidence.families), 'Current remittance evidence changed.');
      const currentOrganisation = await read(connection, '/Organisations');
      assert(currentOrganisation.Organisations?.length === 1 && hash(currentOrganisation.Organisations[0]) === hash(organisation), 'Accounting locks changed immediately before authorisation.');
      guard();
    };
    const collection = freeze({ complete: true, actorId, tenantId, targetIds: clone(targetIds), observedAt: new Date().toISOString(),
      scopeFingerprint: hash({ selected: approved, discoveryFingerprint, sourceReads: sourceReads.map(r => r.fingerprint), controls: globalControls, detail }),
      forecast, calls, financialWrites: 0, documentVerification: 'UNVERIFIED' });
    captures.set(collection, { items: freeze(items), connection, budget, read, guard, release, recheck, receipts, sourceReads, globalControls });
    if (deps.applying !== true) await release('Draft-status preview collection complete');
    return collection;
  } catch (error) { await release('Draft-status collection held').catch(() => {}); throw error; }
}
