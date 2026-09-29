import { sfQuery, sfRequest, sfUserCurrencyInfo, getInstanceUrl } from './_salesforce.js';
import { evaluateNomB, resolveNomBTrader, activeNomBConfirmation, nomBPolicy, validateNomBPolicy, nomBError, nomBToday, NOM_B_FROM, NOM_B_ID, NOM_B_UUID, NOM_B_CREDIT_FIELDS } from './_dashboardNomBPolicy.js';

const text = (value) => String(value ?? '').trim();
const quote = (value) => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const chunks = (values, size = 100) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
const ids = (values) => values.map(quote).join(',');
const SCHEMA = {
  STEM__c: ['Id', 'Name', 'RefCode__c', 'Delivery_Date__c', 'Expected_Delivery_Date__c', 'Invoice_Status__c', 'Receivable_Balance__c', 'LastModifiedDate', 'Account__c', 'Port__c', 'Vessel__c'],
  Nomination__c: ['Id', 'Name', 'STEM__c', 'Deprecated__c', 'Replaced__c', 'Buyer_Supplier_Trader__c', 'BT_ST_Email_Address__c', 'File__c', 'PDF__c', 'RecordTypeId'],
  Invoice__c: ['Id', 'Name', 'STEM__c', 'Amount__c', 'Deprecated__c', 'Proforma__c', 'File__c', 'Invoice_Date__c', 'LastModifiedDate'],
};
function actor(context) {
  if (!context?.profile?.active || !NOM_B_UUID.test(context.profile.id || '')) throw nomBError('An active FCOS profile is required.', 403, 'NOM_B_FORBIDDEN');
  return context.profile;
}
async function permissions(context) {
  const profile = actor(context);
  if (profile.user_type === 'administrator') return true;
  if (profile.user_type !== 'general_manager') return false;
  const { data, error } = await context.client.from('collaboration_roles').select('user_id').eq('role', 'general_manager').eq('active', true).limit(2);
  if (error) throw error;
  return data?.length === 1 && data[0].user_id === profile.id;
}
function dependencySet(deps) {
  // An omitted access condition is not equivalent to unrestricted access.
  if (typeof deps.stemAccessCondition !== 'string') throw nomBError('STEM access scope is unavailable.', 503, 'NOM_B_SCOPE_UNAVAILABLE');
  const query = deps.query || sfQuery;
  return { ...deps, request: deps.request || sfRequest, currencyInfo: deps.currencyInfo || sfUserCurrencyInfo,
    all: async (soql) => {
      const result = await query(soql, { clean: false, limit: 100000, softFail: false });
      if (!Array.isArray(result?.records) || result.error || !Number.isInteger(result.totalSize) || result.records.length !== result.totalSize) {
        throw nomBError('Salesforce returned incomplete Nom B evidence. Refresh to try again.', 503, 'NOM_B_SOURCE_INCOMPLETE');
      }
      return result.records;
    } };
}
async function profileDirectory(client) {
  const rows = [];
  for (let start = 0; start < 100000; start += 1000) {
    const { data, error } = await client.from('user_profiles').select('id,email,full_name,user_type,active').eq('active', true).order('id').range(start, start + 999);
    if (error) throw error;
    rows.push(...(data || [])); if ((data || []).length < 1000) return rows;
  }
  throw nomBError('The profile directory could not be read completely.', 503, 'NOM_B_SOURCE_INCOMPLETE');
}
async function schema(deps) {
  const objects = {};
  for (const [object, required] of Object.entries(SCHEMA)) {
    const description = await deps.request(`/sobjects/${object}/describe/`, { readOnly: true });
    const fields = new Set((description.fields || []).map((field) => field.name));
    if (required.some((field) => !fields.has(field))) throw nomBError(`Salesforce ${object} Nom B evidence fields are unavailable.`, 503, 'NOM_B_SCHEMA_UNAVAILABLE');
    objects[object] = fields;
    if (object === 'Invoice__c') objects.invoiceCreditFields = (description.fields || [])
      .filter((field) => field.type === 'boolean' && NOM_B_CREDIT_FIELDS.includes(field.name)).map((field) => field.name);
  }
  return objects;
}
const currencySelect = (objects, object) => objects[object].has('CurrencyIsoCode') ? ',CurrencyIsoCode' : '';
async function queryRelated(deps, object, fields, lookup, values, extra = '') {
  const rows = [];
  for (const group of chunks(values)) rows.push(...await deps.all(`SELECT ${fields} FROM ${object} WHERE ${lookup} IN (${ids(group)})${extra}`));
  return rows;
}
async function fetchRates(deps, currencies, currencyEvidence, asOfDate) {
  if (currencies.every((currency) => currency === 'USD') || !currencies.length || !currencyEvidence) return [];
  const needed = [...new Set([...currencies, 'USD'])].filter((currency) => currency !== currencyEvidence.corporateCurrency && /^[A-Z]{3}$/.test(currency || ''));
  let dated = true;
  try { await deps.request('/sobjects/DatedConversionRate/describe/', { readOnly: true }); }
  catch (error) {
    // Current CurrencyType rates are only used when dated rates are not enabled,
    // never when an enabled accounting-rate source merely failed to respond.
    if (error?.status === 404 || /INVALID_TYPE|NOT_FOUND/.test(String(error?.code || error?.message || ''))) dated = false;
    else throw error;
  }
  if (dated) return deps.all(`SELECT IsoCode,ConversionRate,StartDate,NextStartDate FROM DatedConversionRate WHERE IsoCode IN (${ids(needed)}) AND StartDate <= ${asOfDate} AND NextStartDate > ${asOfDate}`);
  return (await deps.all(`SELECT IsoCode,ConversionRate,IsActive,IsCorporate FROM CurrencyType WHERE IsoCode IN (${ids(needed)}) AND IsActive = true`))
    .map((row) => ({ ...row, StartDate: asOfDate }));
}
async function loadSources(context, deps, { stemId = null } = {}) {
  const objects = await schema(deps);
  const access = deps.stemAccessCondition ? ` AND (${deps.stemAccessCondition})` : '';
  const scope = stemId ? `Id = ${quote(stemId)}` : `(Delivery_Date__c >= ${NOM_B_FROM} OR (Delivery_Date__c = null AND Expected_Delivery_Date__c >= ${NOM_B_FROM}) OR (Delivery_Date__c = null AND Expected_Delivery_Date__c = null)) AND (Invoice_Status__c = null OR Invoice_Status__c != 'Cancelled')`;
  const stems = await deps.all(`SELECT ${SCHEMA.STEM__c.join(',')},Account__r.Name,Port__r.Name,Vessel__r.Name${currencySelect(objects, 'STEM__c')} FROM STEM__c WHERE ${scope}${access}`);
  const profiles = await profileDirectory(context.client);
  const confirmations = await queryRelated(deps, 'Nomination__c', `${SCHEMA.Nomination__c.join(',')},RecordType.DeveloperName`, 'STEM__c', stems.map((row) => row.Id), " AND Deprecated__c = false AND RecordType.DeveloperName = 'Buyer'");
  const traderNames = [...new Set(confirmations.map((row) => text(row.Buyer_Supplier_Trader__c)).filter(Boolean))];
  const salesforceUsers = await queryRelated(deps, 'User', 'Id,Name,Email,IsActive', 'Name', traderNames, ' AND IsActive = true');
  return { stems, confirmations, profiles, salesforceUsers, objects };
}
function belongsTo(row, profileId) {
  return row.confirmations.some((confirmation) => confirmation.trader.id === profileId);
}
function serializeRow(row, instance) {
  const { evidence: _evidence, evidenceFingerprint: _fingerprint, inScope: _inScope, ...visible } = row;
  return { ...visible, stemUrl: `${instance}/lightning/r/STEM__c/${row.stemId}/view`,
    confirmations: row.confirmations.map(({ trader, ...confirmation }) => ({ ...confirmation, traderName: trader.name,
      filingUrl: `${instance}/lightning/r/Nomination__c/${confirmation.id}/view` })) };
}
function pagination(body) {
  const page = body.page ?? 1; const pageSize = body.pageSize ?? 25;
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw nomBError('Invalid pagination.');
  return { page, pageSize };
}
function rpcError(error) {
  if (error?.code === '40001') throw nomBError('This Nom B policy changed. Refresh the list and reopen this STEM before saving.', 409, 'NOM_B_REVISION_CONFLICT');
  if (error?.code === '42501') throw nomBError('Nom B management permission is required.', 403, 'NOM_B_FORBIDDEN');
  if (error) throw error;
}
export async function loadDashboardNomB(body = {}, context, suppliedDeps = {}) {
  const profile = actor(context); const deps = dependencySet(suppliedDeps); const canManage = await permissions(context);
  const requestedScope = body.scope || 'mine';
  if (!['mine', 'team'].includes(requestedScope) || (requestedScope === 'team' && !canManage)) throw nomBError('Team Nom B access requires General Manager or Administrator authority.', 403, 'NOM_B_FORBIDDEN');
  if (body.traderId && (!canManage || requestedScope !== 'team' || (body.traderId !== 'unassigned' && !NOM_B_UUID.test(body.traderId)))) throw nomBError('The selected trader is outside this view.', 403, 'NOM_B_FORBIDDEN');
  const view = body.view || 'missing';
  if (!['missing', 'waived', 'unable_to_verify'].includes(view)) throw nomBError('Choose a valid Nom B view.');
  const sort = body.sort || 'delivery_asc'; if (!['delivery_asc', 'delivery_desc'].includes(sort)) throw nomBError('Choose a valid delivery sort.');
  const search = text(body.search); if (search.length > 200) throw nomBError('Search must contain at most 200 characters.');
  if (body.includeUndated != null && typeof body.includeUndated !== 'boolean') throw nomBError('Choose a valid undated scope.');
  const { page, pageSize } = pagination(body);
  const observedAt = (deps.now?.() || new Date()).toISOString(); const asOfDate = nomBToday(new Date(observedAt));
  const source = await loadSources(context, deps);
  const visibleStems = source.stems.filter((stem) => requestedScope === 'team' || source.confirmations.some((confirmation) => confirmation.STEM__c === stem.Id
    && activeNomBConfirmation(confirmation) && resolveNomBTrader(confirmation, source.profiles, source.salesforceUsers).id === profile.id));
  const stemIds = visibleStems.map((row) => row.Id);
  const confirmations = source.confirmations.filter((row) => stemIds.includes(row.STEM__c));
  const loaded = await Promise.allSettled([
    queryRelated(deps, 'ContentDocumentLink', 'Id,LinkedEntityId,ContentDocument.Id,ContentDocument.Title,ContentDocument.IsDeleted,ContentDocument.LatestPublishedVersionId,ContentDocument.ContentSize', 'LinkedEntityId', confirmations.map((row) => row.Id)),
    queryRelated(deps, 'Invoice__c', [...SCHEMA.Invoice__c, ...source.objects.invoiceCreditFields].join(',') + currencySelect(source.objects, 'Invoice__c'), 'STEM__c', stemIds),
    deps.currencyInfo(),
  ]);
  const links = loaded[0].status === 'fulfilled' ? loaded[0].value : [];
  const invoices = loaded[1].status === 'fulfilled' ? loaded[1].value.map((invoice) => ({ ...invoice, _nomBCreditFields: source.objects.invoiceCreditFields })) : [];
  let currencyEvidence = loaded[2].status === 'fulfilled' ? loaded[2].value : null;
  if (currencyEvidence?.singleCurrency && (source.objects.STEM__c.has('CurrencyIsoCode') || source.objects.Invoice__c.has('CurrencyIsoCode'))) currencyEvidence = null;
  let rates = []; let ratesComplete = true;
  try { rates = await fetchRates(deps, [...new Set(visibleStems.map((stem) => stem.CurrencyIsoCode ?? (currencyEvidence?.singleCurrency ? currencyEvidence.corporateCurrency : null)))], currencyEvidence, asOfDate); }
  catch { ratesComplete = false; }
  const policies = [];
  for (const group of chunks(stemIds)) {
    const { data, error } = await context.client.from('dashboard_nom_b_policies').select('*').in('stem_id', group);
    if (error) throw error; policies.push(...(data || []));
  }
  const policyMap = new Map(policies.map((row) => [row.stem_id, row]));
  let rows = visibleStems.map((stem) => evaluateNomB({ stem, confirmations, links, profiles: source.profiles, salesforceUsers: source.salesforceUsers, invoices,
    currencyEvidence, rates, policy: policyMap.get(stem.Id), asOfDate, documentsComplete: loaded[0].status === 'fulfilled', invoicesComplete: loaded[1].status === 'fulfilled' }));
  // Persist the complete STEM observation before personal projection, so another
  // trader's already-filed confirmation cannot alter the audit state.
  for (const group of chunks(rows, 250)) {
    const { error } = await context.client.rpc('observe_dashboard_nom_b', { p_actor_user_id: profile.id, p_observed_at: observedAt,
      p_observations: group.map((row) => ({ stemId: row.stemId, status: row.status, waiverType: row.waiverType, policyRevision: row.policy.revision, evidence: row.evidence })) });
    rpcError(error);
  }
  const selectedTrader = requestedScope === 'mine' ? profile.id : body.traderId && body.traderId !== 'unassigned' ? body.traderId : null;
  if (selectedTrader) rows = visibleStems.map((stem) => evaluateNomB({ stem,
    confirmations: confirmations.filter((confirmation) => resolveNomBTrader(confirmation, source.profiles, source.salesforceUsers).id === selectedTrader),
    links, profiles: source.profiles, salesforceUsers: source.salesforceUsers, invoices, currencyEvidence, rates,
    policy: policyMap.get(stem.Id), asOfDate, documentsComplete: loaded[0].status === 'fulfilled', invoicesComplete: loaded[1].status === 'fulfilled' }));
  if (body.traderId) rows = rows.filter((row) => body.traderId === 'unassigned' ? !row.confirmations.length || row.traders.some((trader) => !trader.resolved) : belongsTo(row, body.traderId));
  const eligible = rows.filter((row) => row.inScope);
  const complete = loaded.every((result) => result.status === 'fulfilled') && ratesComplete;
  const dated = eligible.filter((row) => !row.undated);
  const counts = { missing: dated.filter((row) => row.status === 'missing').length, waived: dated.filter((row) => row.status === 'waived').length,
    unableToVerify: dated.filter((row) => row.status === 'unable_to_verify').length, undated: eligible.filter((row) => row.undated && row.status !== 'filed').length, complete };
  rows = eligible.filter((row) => row.undated === (body.includeUndated === true) && row.status === view);
  if (search) rows = rows.filter((row) => [row.stemReference, row.vessel, row.buyer, row.port, ...row.traders.map((trader) => trader.name)].join(' ').toLowerCase().includes(search.toLowerCase()));
  rows.sort((a, b) => ((a.deliveryDate || '9999').localeCompare(b.deliveryDate || '9999') * (sort === 'delivery_desc' ? -1 : 1)) || a.stemId.localeCompare(b.stemId));
  const total = rows.length;
  return { success: true, scope: { from: NOM_B_FROM, type: requestedScope, undatedOnly: body.includeUndated === true }, asOfDate, lastCheckedAt: observedAt, complete, counts,
    capabilities: { canManagePolicies: canManage, canViewTeam: canManage },
    traderOptions: canManage ? source.profiles.map((item) => ({ id: item.id, name: item.full_name || item.email, email: item.email })) : [],
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    rows: rows.slice((page - 1) * pageSize, page * pageSize).map((row) => serializeRow(row, deps.instanceUrl || getInstanceUrl())) };
}
async function assertStemAccess(stemId, context, deps, manager = false) {
  if (!NOM_B_ID.test(stemId || '')) throw nomBError('Choose a valid STEM.');
  const source = await loadSources(context, deps, { stemId });
  if (source.stems.length !== 1) throw nomBError('This STEM is unavailable in your permitted scope.', 404, 'NOM_B_STEM_UNAVAILABLE');
  if (!manager && !source.confirmations.some((row) => row.STEM__c === source.stems[0].Id && activeNomBConfirmation(row) && resolveNomBTrader(row, source.profiles, source.salesforceUsers).id === context.profile.id)) {
    throw nomBError('This STEM is not assigned to your Buyer Trader identity.', 403, 'NOM_B_FORBIDDEN');
  }
  return source.stems[0].Id;
}
export async function saveDashboardNomBPolicy(body = {}, context, suppliedDeps = {}) {
  const profile = actor(context); const deps = dependencySet(suppliedDeps);
  if (!await permissions(context)) throw nomBError('Only a General Manager or Administrator may change Nom B policy.', 403, 'NOM_B_FORBIDDEN');
  const request = validateNomBPolicy(body); const stemId = await assertStemAccess(request.stemId, context, deps, true);
  const { data, error } = await context.client.rpc('save_dashboard_nom_b_policy', { p_stem_id: stemId, p_mode: request.mode, p_reason_code: request.reasonCode,
    p_reason_text: request.reasonText, p_expected_revision: request.expectedRevision, p_actor_user_id: profile.id });
  rpcError(error);
  // These endpoints intentionally bypass runtime caches. A subsequent read always
  // applies the saved revision to fresh source evidence.
  return { success: true, policy: nomBPolicy(Array.isArray(data) ? data[0] : data) };
}
export async function loadDashboardNomBAudit(body = {}, context, suppliedDeps = {}) {
  actor(context); const deps = dependencySet(suppliedDeps); const { page, pageSize } = pagination(body);
  const stemId = await assertStemAccess(body.stemId, context, deps, await permissions(context));
  const { data, error, count } = await context.client.from('dashboard_nom_b_events').select('*', { count: 'exact' }).eq('stem_id', stemId)
    .order('created_at', { ascending: false }).order('id').range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw error;
  return { success: true, rows: (data || []).map((row) => ({ id: row.id, createdAt: row.created_at, actorName: row.actor_name || row.actor_email,
    eventType: row.event_type, previousMode: row.previous_mode, mode: row.mode, reasonCode: row.reason_code, reasonText: row.reason_text,
    previousStatus: row.previous_status, status: row.status, evidence: row.evidence })), pagination: { page, pageSize, total: count, totalPages: Math.ceil(count / pageSize) } };
}
