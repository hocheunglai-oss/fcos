import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDashboardNomB, saveDashboardNomBPolicy, loadDashboardNomBAudit } from '../api/_dashboardNomBService.js';

const anna = { id: '00000000-0000-4000-8000-000000000001', active: true, full_name: 'Anna Chan', email: 'anna@example.test', user_type: 'trader' };
const bill = { id: '00000000-0000-4000-8000-000000000002', active: true, full_name: 'Bill Lee', email: 'bill@example.test', user_type: 'trader' };
const admin = { id: '00000000-0000-4000-8000-000000000003', active: true, full_name: 'Admin', email: 'admin@example.test', user_type: 'administrator' };
const s1 = { Id: 'a0H000000000001AAA', Name: 'STEM ONE', Delivery_Date__c: '2026-09-01', Receivable_Balance__c: '200' };
const s2 = { Id: 'a0H000000000002AAA', Name: 'STEM TWO', Expected_Delivery_Date__c: '2026-09-02', Receivable_Balance__c: '99.99' };
const confirmation = (stem, user, index) => ({ Id: `a0300000000000${index}AAA`, STEM__c: stem.Id, Name: 'Buyer confirmation', Deprecated__c: false, Replaced__c: false, RecordType: { DeveloperName: 'Buyer' }, Buyer_Supplier_Trader__c: user.full_name, BT_ST_Email_Address__c: user.email });
const c1 = confirmation(s1, anna, 1); const c2 = confirmation(s2, bill, 2);
const invoice = (stem, index) => ({ Id: `a0K00000000000${index}AAA`, STEM__c: stem.Id, Name: `${index}-INV-1`, Amount__c: '100', File__c: '/069000000000001AAA', Proforma__c: false, Deprecated__c: false });
const fields = ['Id', 'Name', 'RefCode__c', 'Delivery_Date__c', 'Expected_Delivery_Date__c', 'Invoice_Status__c', 'Receivable_Balance__c', 'LastModifiedDate', 'Account__c', 'Port__c', 'Vessel__c', 'STEM__c', 'Amount__c', 'Deprecated__c', 'Replaced__c', 'Buyer_Supplier_Trader__c', 'BT_ST_Email_Address__c', 'File__c', 'PDF__c', 'RecordTypeId', 'Proforma__c', 'Invoice_Date__c'];
function fixture(options = {}) {
  const calls = []; const queries = []; const profiles = [anna, bill, admin, ...(options.extraProfiles || [])];
  const data = { user_profiles: profiles, collaboration_roles: options.roles || [], dashboard_nom_b_policies: options.policies || [], dashboard_nom_b_events: [] };
  const client = {
    from(table) {
      let rows = [...data[table]];
      const chain = { select: () => chain, eq: (field, value) => { rows = rows.filter((row) => row[field] === value); return chain; },
        in: (field, values) => { rows = rows.filter((row) => values.includes(row[field])); return chain; },
        order: () => chain, limit: (value) => { rows = rows.slice(0, value); return chain; },
        range: (from, to) => { rows = rows.slice(from, to + 1); return chain; },
        then(resolve) { resolve({ data: rows, count: rows.length, error: null }); } };
      return chain;
    },
    async rpc(name, body) {
      calls.push({ name, body });
      if (options.rpcError) return { error: options.rpcError };
      return { data: { mode: body.p_mode, revision: body.p_expected_revision + 1, reason_code: body.p_reason_code, reason_text: body.p_reason_text } };
    },
  };
  const deps = { stemAccessCondition: "Account__r.Office__c = 'Hong Kong'", instanceUrl: 'https://example.salesforce.com', now: () => new Date('2026-09-29T01:00:00Z'),
    request: async (path) => ({ fields: [...fields.map((name) => ({ name })), ...(path.includes('/Invoice__c/') ? options.creditFields || [] : [])] }), currencyInfo: async () => {
      if (options.currencyFails) throw new Error('currency lookup failed');
      return { singleCurrency: true, corporateCurrency: 'USD' };
    },
    query: async (soql, settings) => {
      queries.push({ soql, settings }); const object = soql.match(/FROM (\w+)/)?.[1];
      if (options.fail === object) throw new Error('provider unavailable');
      const tables = { STEM__c: options.stems || [s1, s2], Nomination__c: options.confirmations || [c1, c2], Invoice__c: options.invoices || [invoice(s1, 1), invoice(s2, 2)], User: [], ContentDocumentLink: options.links || [] };
      let records = tables[object] || [];
      const whereId = soql.match(/WHERE Id = '([^']+)'/); if (whereId) records = records.filter((row) => row.Id === whereId[1]);
      return { records, totalSize: records.length + (options.truncated === object ? 1 : 0) };
    } };
  return { context: { profile: options.profile || anna, client }, deps, calls, queries };
}
test('personal read enforces identity and emits complete paginated rows with direct filing links', async () => {
  const f = fixture(); const result = await loadDashboardNomB({}, f.context, f.deps);
  assert.equal(result.counts.missing, 1); assert.equal(result.counts.waived, 0);
  assert.equal(result.rows[0].stemId, s1.Id); assert.equal(result.rows[0].confirmations[0].filingUrl, `https://example.salesforce.com/lightning/r/Nomination__c/${c1.Id}/view`);
  assert.equal(result.capabilities.canManagePolicies, false); assert.deepEqual(result.traderOptions, []);
  assert.match(f.queries.find((query) => query.soql.includes('FROM STEM__c')).soql, /Office__c = 'Hong Kong'/);
  assert.ok(f.queries.every((query) => query.settings.limit === 100000 && query.settings.softFail === false));
  assert.equal(f.calls[0].body.p_observations.length, 1); assert.equal(f.calls[0].body.p_observations[0].stemId, s1.Id);
});
test('cross-user team, filter, audit and policy attempts fail before mutation', async () => {
  const f = fixture();
  await assert.rejects(loadDashboardNomB({ scope: 'team' }, f.context, f.deps), { status: 403 });
  await assert.rejects(loadDashboardNomB({ traderId: bill.id }, f.context, f.deps), { status: 403 });
  await assert.rejects(loadDashboardNomBAudit({ stemId: s2.Id }, f.context, f.deps), { status: 403 });
  await assert.rejects(saveDashboardNomBPolicy({ stemId: s1.Id, mode: 'waive', expectedRevision: 0 }, f.context, f.deps), { status: 403 });
  await assert.rejects(loadDashboardNomB({}, f.context, { ...f.deps, stemAccessCondition: undefined }), { code: 'NOM_B_SCOPE_UNAVAILABLE' });
  assert.equal(f.calls.length, 0);
});
test('manager team lists, search, sorting, pagination and trader filter use full selection counts', async () => {
  const f = fixture({ profile: admin, policies: [{ stem_id: s2.Id, mode: 'require', reason_code: 'other', reason_text: 'Need original', revision: 1 }] });
  const first = await loadDashboardNomB({ scope: 'team', pageSize: 1, sort: 'delivery_desc' }, f.context, f.deps);
  assert.equal(first.counts.missing, 2); assert.equal(first.pagination.totalPages, 2); assert.equal(first.rows[0].stemId, s2.Id);
  const second = await loadDashboardNomB({ scope: 'team', pageSize: 1, sort: 'delivery_desc', page: 2 }, f.context, f.deps);
  assert.equal(second.rows[0].stemId, s1.Id);
  const search = await loadDashboardNomB({ scope: 'team', search: 'TWO' }, f.context, f.deps); assert.equal(search.pagination.total, 1);
  const trader = await loadDashboardNomB({ scope: 'team', traderId: anna.id }, f.context, f.deps); assert.equal(trader.pagination.total, 1); assert.equal(trader.rows[0].stemId, s1.Id);
});
test('one trader filing does not appear missing because another confirmation remains outstanding', async () => {
  const c3 = confirmation(s1, bill, 3);
  const links = [{ LinkedEntityId: c1.Id, ContentDocument: { Id: '069000000000001AAA', IsDeleted: false, Title: `${s1.Name} - NOM B.pdf`, ContentSize: 100, LatestPublishedVersionId: '068000000000001AAA' } }];
  const f = fixture({ stems: [s1], confirmations: [c1, c3], links, profile: admin });
  const team = await loadDashboardNomB({ scope: 'team', traderId: anna.id }, f.context, f.deps); assert.equal(team.counts.missing, 0);
  f.context.profile = anna;
  const own = await loadDashboardNomB({}, f.context, f.deps); assert.equal(own.counts.missing, 0);
  assert.equal(f.calls[0].body.p_observations[0].status, 'missing');
});
test('undated selection remains separate from September count', async () => {
  const undated = { ...s1, Delivery_Date__c: null, Expected_Delivery_Date__c: null };
  const f = fixture({ stems: [undated], confirmations: [c1] });
  const normal = await loadDashboardNomB({}, f.context, f.deps); assert.equal(normal.counts.missing, 0); assert.equal(normal.counts.undated, 1); assert.equal(normal.rows.length, 0);
  const separate = await loadDashboardNomB({ includeUndated: true }, f.context, f.deps); assert.equal(separate.rows.length, 1); assert.equal(separate.scope.undatedOnly, true);
});
test('incomplete file/invoice reads are visible unknowns, and source truncation never becomes zero', async () => {
  for (const fail of ['ContentDocumentLink', 'Invoice__c']) {
    const f = fixture({ fail }); const result = await loadDashboardNomB({ view: 'unable_to_verify' }, f.context, f.deps);
    assert.equal(result.complete, false); assert.equal(result.counts.unableToVerify, 1); assert.equal(result.rows[0].status, 'unable_to_verify');
  }
  const f = fixture({ truncated: 'STEM__c' }); await assert.rejects(loadDashboardNomB({}, f.context, f.deps), { code: 'NOM_B_SOURCE_INCOMPLETE' }); assert.equal(f.calls.length, 0);
  const currency = fixture({ currencyFails: true }); const response = await loadDashboardNomB({ view: 'unable_to_verify' }, currency.context, currency.deps);
  assert.equal(response.complete, false); assert.equal(response.counts.unableToVerify, 1);
});
test('collector requires invoice amount and reads only described Boolean credit indicators', async () => {
  const source = { ...invoice(s2, 2), Is_Credit_Note__c: true };
  const f = fixture({ profile: bill, stems: [s2], confirmations: [c2], invoices: [source],
    creditFields: [{ name: 'Is_Credit_Note__c', type: 'boolean' }, { name: 'CreditNote__c', type: 'string' }] });
  const result = await loadDashboardNomB({}, f.context, f.deps);
  assert.equal(result.counts.waived, 0); assert.equal(result.counts.missing, 1);
  const soql = f.queries.find((query) => query.soql.includes('FROM Invoice__c')).soql;
  assert.match(soql, /Amount__c/); assert.match(soql, /Is_Credit_Note__c/); assert.doesNotMatch(soql, /CreditNote__c/);
  const missingFlag = fixture({ profile: bill, stems: [s2], confirmations: [c2], creditFields: [{ name: 'Credit_Note__c', type: 'boolean' }] });
  assert.equal((await loadDashboardNomB({ view: 'unable_to_verify' }, missingFlag.context, missingFlag.deps)).counts.unableToVerify, 1);
  const missingAmount = fixture(); missingAmount.deps.request = async () => ({ fields: fields.filter((name) => name !== 'Amount__c').map((name) => ({ name })) });
  await assert.rejects(loadDashboardNomB({}, missingAmount.context, missingAmount.deps), { code: 'NOM_B_SCHEMA_UNAVAILABLE' });
});
test('policy saves are server role checked, access scoped and revision checked', async () => {
  const f = fixture({ profile: admin }); const result = await saveDashboardNomBPolicy({ stemId: s1.Id, mode: 'waive', expectedRevision: 0 }, f.context, f.deps);
  assert.equal(result.policy.reasonCode, 'payment_received'); assert.equal(result.policy.revision, 1);
  assert.equal(f.calls[0].body.p_actor_user_id, admin.id);
  const stale = fixture({ profile: admin, rpcError: { code: '40001' } }); await assert.rejects(saveDashboardNomBPolicy({ stemId: s1.Id, mode: 'waive', expectedRevision: 0 }, stale.context, stale.deps), { status: 409, code: 'NOM_B_REVISION_CONFLICT' });
  const inaccessible = fixture({ profile: admin, stems: [] }); await assert.rejects(saveDashboardNomBPolicy({ stemId: s1.Id, mode: 'waive', expectedRevision: 0 }, inaccessible.context, inaccessible.deps), { status: 404 });
  const gm = { ...admin, user_type: 'general_manager' };
  const invalidGm = fixture({ profile: gm }); await assert.rejects(saveDashboardNomBPolicy({ stemId: s1.Id, mode: 'waive', expectedRevision: 0 }, invalidGm.context, invalidGm.deps), { status: 403 });
  const validGm = fixture({ profile: gm, roles: [{ role: 'general_manager', active: true, user_id: gm.id }] });
  assert.equal((await saveDashboardNomBPolicy({ stemId: s1.Id, mode: 'waive', expectedRevision: 0 }, validGm.context, validGm.deps)).policy.mode, 'waive');
});

test('regenerated confirmation remains visible in personal and team views and permits owner audit', async () => {
  const f = fixture({ confirmations: [{ ...c1, Replaced__c: true }] });
  const personal = await loadDashboardNomB({}, f.context, f.deps);
  assert.equal(personal.rows[0].confirmations[0].traderName, anna.full_name);
  assert.equal(personal.counts.missing, 1);
  const query = f.queries.find(({ soql }) => soql.includes('FROM Nomination__c')).soql;
  assert.doesNotMatch(query.split('WHERE')[1], /Replaced__c/);
  assert.match(query, /Deprecated__c = false/);
  await loadDashboardNomBAudit({ stemId: s1.Id }, f.context, f.deps);
  const team = await loadDashboardNomB({ scope: 'team', search: s1.Name }, { ...f.context, profile: admin }, f.deps);
  assert.equal(team.rows[0].confirmations[0].traderName, anna.full_name);
  assert.equal(team.rows[0].status, 'missing');
});
