import { chunkIds, getApiVersion, getInstanceUrl, sfQuery, sfRequest } from './_salesforce.js';
import { getOrLoadRuntimeCache } from './_runtimeCache.js';
import { resolveExtraCostSupplierLookup, resolveOriginalSupplierLookup } from './_disputeParties.js';
import { selectUltimateCreditGroup } from './_dashboardAccountCreditStatement.js';
import { estimateUninvoicedSupplierChild } from './_dashboardSupplierCreditStatement.js';

const ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const MAX_IDENTITIES = 100;
const MAX_DEPTH = 20;
const HK_INTEROFFICE_GROUP = 'FRATELLI COSULICH';

function error(message, status = 400, code = 'UNIFIED_COUNTERPARTY_INVALID') {
  const value = new Error(message); value.status = status; value.code = code; value.expose = status < 500; return value;
}
const text = (value) => String(value ?? '').trim();
const key = (value) => ID.test(text(value)) ? text(value).slice(0, 15) : '';
const ids = (values, label = 'Counterparty') => [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))].map((value) => {
  if (!ID.test(value)) throw error(`${label} ID is invalid.`, 400, 'UNIFIED_COUNTERPARTY_INVALID_ID');
  return value;
});
const q = (value) => text(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const values = (rows) => rows.map((row) => `'${q(row)}'`).join(',');
const currency = (value) => text(value).toUpperCase() || 'USD';
const interoffice = (context) => context?.profile?.user_type === 'interoffice';

async function all(soql) { const result = await sfQuery(soql, { clean: true, limit: Number.MAX_SAFE_INTEGER }); return result.records || []; }
async function describe(name, force) {
  const result = await getOrLoadRuntimeCache({ namespace: 'salesforce-unified-counterparty-describe', version: '1', accessScope: 'schema', apiVersion: `${getApiVersion()}@${getInstanceUrl()}`, payload: { name }, ttlSeconds: 21_600, tags: ['salesforce:schema'], force,
    loader: async () => { const data = await sfRequest(`/sobjects/${encodeURIComponent(name)}/describe/`, { readOnly: true }); return { fields: (data.fields || []).map((field) => ({ name: field.name, relationshipName: field.relationshipName || null, referenceTo: field.referenceTo || [] })) }; } });
  return result.value;
}
const map = (describeResult) => new Map((describeResult?.fields || []).map((field) => [field.name, field]));
function accountFields(fields) { return ['Id', 'Name', 'ParentId', 'Company_Code__c', 'Group_Name__c', 'Inactive_Suspended__c', 'CurrencyIsoCode'].filter((field) => fields.has(field)); }

async function chains(accounts, fields) {
  const known = new Map(accounts.map((row) => [key(row.Id), row]));
  let pending = [...new Set(accounts.map((row) => row.ParentId).filter(Boolean))].filter((id) => !known.has(key(id)));
  for (let depth = 0; pending.length && depth < MAX_DEPTH; depth += 1) {
    const rows = [];
    for (const part of chunkIds(pending)) rows.push(...await all(`SELECT ${accountFields(fields).join(',')} FROM Account WHERE Id IN (${values(part)})`));
    for (const row of rows) known.set(key(row.Id), row);
    pending = [...new Set(rows.map((row) => row.ParentId).filter(Boolean))].filter((id) => !known.has(key(id)));
  }
  if (pending.length) throw error('Salesforce GROUP hierarchy is incomplete or exceeds 20 levels.', 503, 'UNIFIED_COUNTERPARTY_GROUP_DEPTH');
  return new Map(accounts.map((account) => {
    const output = []; const seen = new Set(); let row = account;
    while (row) { if (!key(row.Id) || seen.has(key(row.Id))) throw error('Salesforce GROUP hierarchy contains a cycle.', 503, 'UNIFIED_COUNTERPARTY_GROUP_CYCLE'); seen.add(key(row.Id)); output.push(row); row = row.ParentId ? known.get(key(row.ParentId)) : null; }
    return [key(account.Id), output];
  }));
}
function root(chain) { return selectUltimateCreditGroup(chain) || null; }
function allowed(chain, isInteroffice) { return !isInteroffice || !chain.some((row) => [row.Name, row.Group_Name__c].some((name) => text(name).toUpperCase() === HK_INTEROFFICE_GROUP)); }

async function descendants(roots, fields) {
  const result = new Map(roots.map((row) => [key(row.Id), new Map([[key(row.Id), row]])]));
  let parents = roots.map((row) => row.Id);
  for (let depth = 0; parents.length && depth < MAX_DEPTH; depth += 1) {
    const rows = [];
    for (const part of chunkIds(parents)) rows.push(...await all(`SELECT ${accountFields(fields).join(',')} FROM Account WHERE ParentId IN (${values(part)}) AND Inactive_Suspended__c = false`));
    parents = [];
    for (const row of rows) {
      let owner = roots.find((rootRow) => key(rootRow.Id) === key(row.ParentId));
      if (!owner) for (const [rootId, members] of result) if (members.has(key(row.ParentId))) { owner = roots.find((rootRow) => key(rootRow.Id) === rootId); break; }
      if (owner) { result.get(key(owner.Id)).set(key(row.Id), row); parents.push(row.Id); }
    }
  }
  if (parents.length) throw error('Salesforce GROUP hierarchy exceeds 20 levels.', 503, 'UNIFIED_COUNTERPARTY_GROUP_DEPTH');
  return result;
}

async function roleCounts(accountIds, lineLookup, extraLookup, scopeWhere = '') {
  if (!accountIds.length) return new Map();
  const output = new Map(accountIds.map((id) => [key(id), { buyerStemCount: 0, supplierStemCount: 0 }]));
  const childScope = scopeWhere ? ` AND ${scopeWhere.replaceAll('Delivery_Date__c', 'STEM__r.Delivery_Date__c').replaceAll('Expected_Delivery_Date__c', 'STEM__r.Expected_Delivery_Date__c').replaceAll('Port__c', 'STEM__r.Port__c')}` : '';
  const chunks = chunkIds(accountIds);
  const [buyerChunks, lineChunks, extraChunks] = await Promise.all([
    Promise.all(chunks.map((part) => all(`SELECT Account__c accountId,COUNT(Id) count FROM STEM__c WHERE Account__c IN (${values(part)})${scopeWhere ? ` AND (${scopeWhere})` : ''} GROUP BY Account__c`))),
    Promise.all(chunks.map((part) => all(`SELECT ${lineLookup.fieldName} accountId,STEM__c FROM STEM_Line_Item__c WHERE Cancelled__c = false AND ${lineLookup.fieldName} IN (${values(part)})${childScope}`))),
    Promise.all(chunks.map((part) => all(`SELECT ${extraLookup.fieldName} accountId,STEM__c FROM STEM_Extra_Cost__c WHERE Cancelled__c = false AND ${extraLookup.fieldName} IN (${values(part)})${childScope}`))),
  ]);
  const buyers = buyerChunks.flat(); const lines = lineChunks.flat(); const extras = extraChunks.flat();
  buyers.forEach((row) => { const current = output.get(key(row.accountId)); if (current) current.buyerStemCount = Number(row.count || 0); });
  const supplierStemIds = new Map(accountIds.map((id) => [key(id), new Set()]));
  for (const row of [...lines, ...extras]) supplierStemIds.get(key(row.accountId))?.add(key(row.STEM__c));
  for (const [accountId, stemIds] of supplierStemIds) output.get(accountId).supplierStemCount = stemIds.size;
  return output;
}

async function directoryIdentityPage({ cursor, direction, limit, filters, dateWindows, disputeOnly, accessContext, force }) {
  const [accountDescribe, stemDescribe, lineDescribe, extraDescribe] = await Promise.all([
    describe('Account', force),
    describe('STEM__c', force),
    describe('STEM_Line_Item__c', force),
    describe('STEM_Extra_Cost__c', force),
  ]);
  const accountMap = map(accountDescribe);
  const stemMap = map(stemDescribe);
  const lineLookup = resolveOriginalSupplierLookup(lineDescribe.fields);
  const extraLookup = resolveExtraCostSupplierLookup(extraDescribe.fields);
  if (!accountMap.has('Inactive_Suspended__c') || !lineLookup.valid || !extraLookup.valid) throw error('Salesforce counterparty schema is incomplete.', 503, 'UNIFIED_COUNTERPARTY_SCHEMA');
  const scopeConditions = [];
  const locationAndDateScope = await scopeWhere(filters, stemMap, force, dateWindows);
  if (locationAndDateScope) scopeConditions.push(locationAndDateScope);
  if (disputeOnly) {
    if (stemMap.has('Dispute_Status__c')) scopeConditions.push("Dispute_Status__c != 'No Dispute' AND Dispute_Status__c != null");
    else if (stemMap.has('Dispute__c')) scopeConditions.push('Dispute__c = true');
    else throw error('Salesforce dispute scope is unavailable.', 503, 'UNIFIED_COUNTERPARTY_SCHEMA');
  }
  const scopeWhereValue = scopeConditions.join(' AND ');
  const output = [];
  let phase = cursor?.phase === 'account' ? 'account' : 'group';
  let after = cursor?.name && cursor?.id ? { name: cursor.name, id: cursor.id } : null;
  let exhausted = false;
  const fetchLimit = Math.max(limit * 2, 50);
  while (output.length < limit && !exhausted) {
    const conditions = ['Inactive_Suspended__c = false'];
    if (phase === 'group') conditions.push("Name LIKE 'GROUP%'");
    if (after) conditions.push(`(Name > '${q(after.name)}' OR (Name = '${q(after.name)}' AND Id > '${q(after.id)}'))`);
    const candidates = await all(`SELECT ${accountFields(accountMap).join(',')} FROM Account WHERE ${conditions.join(' AND ')} ORDER BY Name,Id LIMIT ${fetchLimit}`);
    if (!candidates.length) {
      if (phase === 'group') { phase = 'account'; after = null; continue; }
      exhausted = true; break;
    }
    const candidateChains = await chains(candidates, accountMap);
    const selected = candidates
      .filter((row) => allowed(candidateChains.get(key(row.Id)) || [], interoffice(accessContext)))
      .filter((row) => {
        const group = root(candidateChains.get(key(row.Id)) || []);
        return phase === 'group' ? group && key(group.Id) === key(row.Id) : !group || key(group.Id) !== key(row.Id);
      })
      .map((entity) => ({ entityType: phase, entity }));
    const projected = (await projectIdentities(selected, accountMap, lineLookup, extraLookup, { scopeWhereValue }))
      .filter((row) => row.roles.length)
      .filter((row) => direction === 'buyer' ? row.scopedBuyerStemCount > 0 : direction === 'supplier' ? row.scopedSupplierStemCount > 0 : row.scopedBuyerStemCount > 0 || row.scopedSupplierStemCount > 0);
    const projectedById = new Map(projected.map((row) => [key(row.entityId), row]));
    for (const candidate of candidates) {
      after = { name: candidate.Name, id: candidate.Id };
      const row = projectedById.get(key(candidate.Id));
      if (row) output.push(row);
      if (output.length >= limit) break;
    }
    if (output.length >= limit) break;
    if (candidates.length < fetchLimit) {
      if (phase === 'group') { phase = 'account'; after = null; }
      else exhausted = true;
    }
  }
  return {
    accounts: output,
    nextCursor: !exhausted && after ? Buffer.from(JSON.stringify({ phase, name: after.name, id: after.id })).toString('base64url') : null,
  };
}

async function projectIdentities(selected, accountMap, lineLookup, extraLookup, { scopeWhereValue = '' } = {}) {
  const groupRoots = selected.filter((row) => row.entityType === 'group').map((row) => row.entity);
  const groupedMembers = await descendants(groupRoots, accountMap);
  const allAccountIds = [...new Set(selected.flatMap((row) => row.entityType === 'group'
    ? [...(groupedMembers.get(key(row.entity.Id)) || new Map()).values()].map((member) => member.Id)
    : [row.entity.Id]))];
  const counts = await roleCounts(allAccountIds, lineLookup, extraLookup);
  const scopedCounts = scopeWhereValue ? await roleCounts(allAccountIds, lineLookup, extraLookup, scopeWhereValue) : counts;
  return selected.map((row) => {
    const members = row.entityType === 'group' ? [...(groupedMembers.get(key(row.entity.Id)) || new Map()).values()] : [row.entity];
    const aggregate = members.reduce((total, member) => {
      const count = counts.get(key(member.Id)) || {};
      total.buyerStemCount += Number(count.buyerStemCount || 0);
      total.supplierStemCount += Number(count.supplierStemCount || 0);
      return total;
    }, { buyerStemCount: 0, supplierStemCount: 0 });
    const roles = [['buyer', aggregate.buyerStemCount], ['supplier', aggregate.supplierStemCount]]
      .filter(([, count]) => count > 0)
      .map(([role]) => role);
    const scopedAggregate = members.reduce((total, member) => {
      const count = scopedCounts.get(key(member.Id)) || {};
      total.buyerStemCount += Number(count.buyerStemCount || 0);
      total.supplierStemCount += Number(count.supplierStemCount || 0);
      return total;
    }, { buyerStemCount: 0, supplierStemCount: 0 });
    return {
      entityKey: `${row.entityType}:${row.entity.Id}`,
      entityType: row.entityType,
      entityId: row.entity.Id,
      accountId: row.entity.Id,
      name: row.entity.Name,
      clKey: row.entity.Company_Code__c || null,
      groupName: row.entityType === 'group' ? row.entity.Name : row.entity.Group_Name__c || null,
      roles,
      ...aggregate,
      scopedBuyerStemCount: scopedAggregate.buyerStemCount,
      scopedSupplierStemCount: scopedAggregate.supplierStemCount,
      buyerGrossProfitByCurrency: [],
      supplierGrossProfitByCurrency: [],
      financialsComplete: false,
      memberAccountIds: members.map((member) => member.Id),
    };
  });
}

async function requestedIdentities(requested, { accessContext, force = false, scopeWhereValue = '' } = {}) {
  const [accountDescribe, lineDescribe, extraDescribe] = await Promise.all([
    describe('Account', force),
    describe('STEM_Line_Item__c', force),
    describe('STEM_Extra_Cost__c', force),
  ]);
  const accountMap = map(accountDescribe);
  const lineLookup = resolveOriginalSupplierLookup(lineDescribe.fields);
  const extraLookup = resolveExtraCostSupplierLookup(extraDescribe.fields);
  if (!accountMap.has('Inactive_Suspended__c') || !lineLookup.valid || !extraLookup.valid) {
    throw error('Salesforce counterparty schema is incomplete.', 503, 'UNIFIED_COUNTERPARTY_SCHEMA');
  }
  const requestedIds = [...new Set(requested.map((row) => row.entityId))];
  const rows = [];
  for (const part of chunkIds(requestedIds)) {
    rows.push(...await all(`SELECT ${accountFields(accountMap).join(',')} FROM Account WHERE Id IN (${values(part)}) AND Inactive_Suspended__c = false`));
  }
  const byId = new Map(rows.map((row) => [key(row.Id), row]));
  if (byId.size !== requestedIds.length) throw error('One or more counterparties are inactive or unavailable.', 404, 'UNIFIED_COUNTERPARTY_NOT_FOUND');
  const entityChains = await chains(rows, accountMap);
  const isInteroffice = interoffice(accessContext);
  const selected = requested.map((item) => {
    const entity = byId.get(key(item.entityId));
    const chain = entityChains.get(key(entity.Id)) || [];
    if (!allowed(chain, isInteroffice)) throw error('Counterparty is outside the Interoffice access scope.', 403, 'UNIFIED_COUNTERPARTY_ACCESS');
    if (item.entityType === 'group') {
      const group = root(chain);
      if (!group || key(group.Id) !== key(entity.Id)) throw error('The selected GROUP identity is invalid.', 400, 'UNIFIED_COUNTERPARTY_GROUP_INVALID');
    }
    return { entityType: item.entityType, entity };
  });
  return projectIdentities(selected, accountMap, lineLookup, extraLookup, { scopeWhereValue });
}

function normalizedFilters(input = {}) { const filters = input && typeof input === 'object' ? input : {}; return { portIds: ids(filters.portIds, 'Port'), countryCodes: [...new Set((Array.isArray(filters.countryCodes) ? filters.countryCodes : []).map((value) => text(value).toUpperCase()).filter(Boolean))] }; }
async function scopeWhere(filters, stemFields, force, dateWindows = []) {
  const conditions = [];
  if (filters.portIds.length) conditions.push(`Port__c IN (${values(filters.portIds)})`);
  if (filters.countryCodes.length) {
    const ports = await all(`SELECT Id FROM Port__c WHERE Country__c IN (${values(filters.countryCodes)})`);
    conditions.push(ports.length ? `Port__c IN (${values(ports.map((row) => row.Id))})` : 'Id = null');
  }
  const windows = Array.isArray(dateWindows) ? dateWindows : [];
  if (windows.length) {
    if (!stemFields.has('Delivery_Date__c')) throw error('Salesforce Delivery Date is unavailable for counterparty period filtering.', 503, 'UNIFIED_COUNTERPARTY_SCHEMA');
    const expected = stemFields.has('Expected_Delivery_Date__c');
    const dateTerms = windows.map((window) => {
      const start = text(window?.startDate || window?.start); const end = text(window?.endDate || window?.end);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) throw error('Counterparty date windows are invalid.', 400, 'UNIFIED_COUNTERPARTY_DATE_SCOPE');
      return expected ? `((Delivery_Date__c >= ${start} AND Delivery_Date__c <= ${end}) OR (Delivery_Date__c = null AND Expected_Delivery_Date__c >= ${start} AND Expected_Delivery_Date__c <= ${end}))` : `(Delivery_Date__c >= ${start} AND Delivery_Date__c <= ${end})`;
    });
    conditions.push(`(${dateTerms.join(' OR ')})`);
  }
  return conditions.join(' AND ');
}

async function counterpartyIdentities({ query = '', limit = 25, cursor = null, filters = {}, force = false, accessContext = null }) {
  const [accountDescribe, lineDescribe, extraDescribe] = await Promise.all([describe('Account', force), describe('STEM_Line_Item__c', force), describe('STEM_Extra_Cost__c', force)]);
  const accountMap = map(accountDescribe); const lineLookup = resolveOriginalSupplierLookup(lineDescribe.fields); const extraLookup = resolveExtraCostSupplierLookup(extraDescribe.fields);
  if (!accountMap.has('Inactive_Suspended__c') || !lineLookup.valid || !extraLookup.valid) throw error('Salesforce counterparty schema is incomplete.', 503, 'UNIFIED_COUNTERPARTY_SCHEMA');
  const search = text(query).slice(0, 100); const conditions = ['Inactive_Suspended__c = false'];
  if (search) { const like = `%${q(search)}%`; conditions.push(`(Name LIKE '${like}'${accountMap.has('Company_Code__c') ? ` OR Company_Code__c LIKE '${like}'` : ''})`); }
  if (cursor?.name && cursor?.id) conditions.push(`(Name > '${q(cursor.name)}' OR (Name = '${q(cursor.name)}' AND Id > '${q(cursor.id)}'))`);
  const candidates = await all(`SELECT ${accountFields(accountMap).join(',')} FROM Account WHERE ${conditions.join(' AND ')} ORDER BY Name,Id LIMIT ${Math.min(limit * 4 + 1, 401)}`);
  const candidateChains = await chains(candidates, accountMap); const isInteroffice = interoffice(accessContext);
  const eligible = candidates.filter((row) => allowed(candidateChains.get(key(row.Id)) || [], isInteroffice));
  const roots = new Map();
  for (const row of eligible) {
    // Exact Account matches are always retained.  A matching descendant also
    // contributes one distinct GROUP identity under the shared approved rule.
    const group = root(candidateChains.get(key(row.Id)) || []);
    if (!group || key(group.Id) !== key(row.Id)) roots.set(`account:${key(row.Id)}`, { entityType: 'account', entity: row });
    if (group) roots.set(`group:${key(group.Id)}`, { entityType: 'group', entity: group });
  }
  const selected = [...roots.values()].sort((left, right) => (left.entityType === right.entityType ? text(left.entity.Name).localeCompare(text(right.entity.Name)) : left.entityType === 'group' ? -1 : 1)).slice(0, limit);
  // Role badges are lifetime facts.  They must not flicker with dashboard
  // period/location filters; only exposure and period financial requests are scoped.
  return (await projectIdentities(selected, accountMap, lineLookup, extraLookup)).filter((row) => row.roles.length);
}

export async function loadDashboardCounterpartySearch({ body = {}, accessContext, force = false }) {
  const started = Date.now(); const limit = Math.min(Math.max(Number(body.limit) || 25, 1), 100); const filters = normalizedFilters(body.filters); const cursor = body.cursor && typeof body.cursor === 'object' ? body.cursor : null;
  const cached = await getOrLoadRuntimeCache({ namespace: 'salesforce-dashboard-counterparty-search', version: '1', accessScope: interoffice(accessContext) ? 'interoffice' : 'standard', apiVersion: `${getApiVersion()}@${getInstanceUrl()}`, payload: { query: text(body.query), limit, cursor, filters }, ttlSeconds: 60, tags: ['salesforce:dashboard', 'salesforce:account', 'salesforce:group', 'salesforce:stem', 'salesforce:line-item', 'salesforce:extra-cost', 'salesforce:counterparty'], force,
    loader: () => counterpartyIdentities({ query: body.query, limit, cursor, filters, force, accessContext }) });
  return { results: cached.value, meta: { redacted: true, cache: cached.cache?.status || null, elapsedMs: Date.now() - started, returnedCount: cached.value.length } };
}

export async function resolveUnifiedCounterpartyMemberIds(counterparty, { accessContext, force = false } = {}) {
  if (!counterparty || typeof counterparty !== 'object') return [];
  const entityType = counterparty.entityType === 'group' ? 'group' : counterparty.entityType === 'account' ? 'account' : null;
  const entityId = ids([counterparty.entityId], 'Counterparty')[0];
  if (!entityType) throw error('Counterparty entity type is invalid.', 400, 'UNIFIED_COUNTERPARTY_ENTITY_TYPE');
  const accountDescribe = await describe('Account', force); const fields = map(accountDescribe);
  const rows = await all(`SELECT ${accountFields(fields).join(',')} FROM Account WHERE Id = '${q(entityId)}' AND Inactive_Suspended__c = false`);
  const entity = rows[0]; if (!entity) throw error('Counterparty is inactive or unavailable.', 404, 'UNIFIED_COUNTERPARTY_NOT_FOUND');
  const entityChain = await chains([entity], fields);
  if (!allowed(entityChain.get(key(entity.Id)) || [], interoffice(accessContext))) throw error('Counterparty is outside the Interoffice access scope.', 403, 'UNIFIED_COUNTERPARTY_ACCESS');
  if (entityType === 'account') return [entity.Id];
  const group = root(entityChain.get(key(entity.Id)) || []);
  if (!group || key(group.Id) !== key(entity.Id)) throw error('The selected GROUP identity is invalid.', 400, 'UNIFIED_COUNTERPARTY_GROUP_INVALID');
  return [...(await descendants([group], fields)).get(key(group.Id)).values()].map((row) => row.Id);
}

export async function loadDashboardUnifiedCreditDirectory({ body = {}, accessContext, force = false }) {
  let cursor = null;
  if (body.cursor) {
    try { cursor = JSON.parse(Buffer.from(String(body.cursor), 'base64url').toString('utf8')); } catch { throw error('Directory cursor is invalid.', 400, 'UNIFIED_COUNTERPARTY_CURSOR'); }
    if (!['group', 'account'].includes(cursor?.phase) || !text(cursor?.name) || !ID.test(text(cursor?.id))) throw error('Directory cursor is invalid.', 400, 'UNIFIED_COUNTERPARTY_CURSOR');
  }
  const selectedCounterparty = body.counterparty && typeof body.counterparty === 'object'
    ? [{ entityType: body.counterparty.entityType, entityId: ids([body.counterparty.entityId], 'Counterparty')[0] }]
    : null;
  if (selectedCounterparty && !['account', 'group'].includes(selectedCounterparty[0].entityType)) throw error('Counterparty entity type is invalid.', 400, 'UNIFIED_COUNTERPARTY_ENTITY_TYPE');
  const direction = ['buyer', 'supplier', 'both'].includes(body.direction) ? body.direction : 'both';
  const limit = Math.min(Math.max(Number(body.limit) || 25, 1), 100);
  const filters = normalizedFilters(body.filters);
  const dateWindows = Array.isArray(body.dateWindows) ? body.dateWindows : [];
  const disputeOnly = body.disputeOnly === true;
  if (selectedCounterparty) {
    const stemMap = map(await describe('STEM__c', force));
    const scopeConditions = [];
    const selectedScope = await scopeWhere(filters, stemMap, force, dateWindows);
    if (selectedScope) scopeConditions.push(selectedScope);
    if (disputeOnly) {
      if (stemMap.has('Dispute_Status__c')) scopeConditions.push("Dispute_Status__c != 'No Dispute' AND Dispute_Status__c != null");
      else if (stemMap.has('Dispute__c')) scopeConditions.push('Dispute__c = true');
      else throw error('Salesforce dispute scope is unavailable.', 503, 'UNIFIED_COUNTERPARTY_SCHEMA');
    }
    const identities = await requestedIdentities(selectedCounterparty, { accessContext, force, scopeWhereValue: scopeConditions.join(' AND ') });
    const accounts = identities.filter((row) => direction === 'buyer' ? row.scopedBuyerStemCount > 0 : direction === 'supplier' ? row.scopedSupplierStemCount > 0 : row.scopedBuyerStemCount > 0 || row.scopedSupplierStemCount > 0);
    return { accounts, nextCursor: null, meta: { redacted: true, cache: 'live', returnedCount: accounts.length, direction } };
  }
  const cached = await getOrLoadRuntimeCache({
    namespace: 'salesforce-dashboard-unified-account-directory', version: '1', accessScope: interoffice(accessContext) ? 'interoffice' : 'standard', apiVersion: `${getApiVersion()}@${getInstanceUrl()}`,
    payload: { cursor, direction, limit, filters, dateWindows, disputeOnly }, ttlSeconds: 60,
    tags: ['salesforce:dashboard', 'salesforce:account', 'salesforce:group', 'salesforce:stem', 'salesforce:line-item', 'salesforce:extra-cost', 'salesforce:counterparty'], force,
    loader: () => directoryIdentityPage({ cursor, direction, limit, filters, dateWindows, disputeOnly, accessContext, force }),
  });
  return { ...cached.value, meta: { redacted: true, cache: cached.cache?.status || null, returnedCount: cached.value.accounts.length, direction } };
}

async function loadDashboardAccountExposureBatchUncached({ body = {}, accessContext, force = false }) {
  const entities = Array.isArray(body.entities) ? body.entities : [];
  if (!entities.length || entities.length > MAX_IDENTITIES) throw error(`Provide between 1 and ${MAX_IDENTITIES} counterparty identities.`, 400, 'UNIFIED_COUNTERPARTY_BATCH_LIMIT');
  const requested = entities.map((row) => ({ entityType: row?.entityType === 'group' ? 'group' : row?.entityType === 'account' ? 'account' : null, entityId: ids([row?.entityId], 'Counterparty')[0] })).map((row) => { if (!row.entityType) throw error('Counterparty entity type is invalid.', 400, 'UNIFIED_COUNTERPARTY_ENTITY_TYPE'); return row; });
  const identities = await requestedIdentities(requested, { accessContext, force });
  const allIds = [...new Set(identities.flatMap((row) => row.memberAccountIds))];
  const [stemDescribe, invoiceDescribe, lineDescribe, extraDescribe] = await Promise.all([describe('STEM__c', force), describe('Supplier_Invoice__c', force), describe('STEM_Line_Item__c', force), describe('STEM_Extra_Cost__c', force)]);
  const stemMap = map(stemDescribe); const invoiceMap = map(invoiceDescribe); const lineMap = map(lineDescribe); const extraMap = map(extraDescribe); const lineLookup = resolveOriginalSupplierLookup(lineDescribe.fields); const extraLookup = resolveExtraCostSupplierLookup(extraDescribe.fields);
  if (!stemMap.has('QLIK_Receivable_Balance__c') || !invoiceMap.has('Payable_Balance__c') || !lineLookup.valid || !extraLookup.valid) throw error('Salesforce exposure schema is incomplete.', 503, 'UNIFIED_COUNTERPARTY_SCHEMA');
  const filters = normalizedFilters(body.filters); const scoped = await scopeWhere(filters, stemMap, force);
  const relatedStemScope = scoped ? scoped.replaceAll('Delivery_Date__c', 'STEM__r.Delivery_Date__c').replaceAll('Expected_Delivery_Date__c', 'STEM__r.Expected_Delivery_Date__c').replaceAll('Port__c', 'STEM__r.Port__c') : '';
  const lineSelect = ['STEM__c', lineLookup.fieldName, 'Quantity__c', 'Quantity_Delivered_Per_BDN__c', 'Quantity_Max__c', 'Is_Quantity_Range__c', 'Cost_Per_Unit__c', 'Unit_Buy_At__c', 'Unit_Cost__c', 'UOM__c', 'CurrencyIsoCode'].filter((field) => lineMap.has(field));
  const extraSelect = ['STEM__c', extraLookup.fieldName, 'Quantity__c', 'Quantity_Delivered_Per_BDN__c', 'Quantity_Range_Max__c', 'Is_Quantity_Range__c', 'Unit_Cost__c', 'Line_Total_Buy__c', 'UOM__c', 'CurrencyIsoCode'].filter((field) => extraMap.has(field));
  const accountChunks = chunkIds(allIds);
  const [buyerStemChunks, invoiceChunks, unbilledLineChunks, unbilledExtraChunks] = await Promise.all([
    Promise.all(accountChunks.map((part) => all(`SELECT Id,Account__c,CurrencyIsoCode,QLIK_Receivable_Balance__c FROM STEM__c WHERE Account__c IN (${values(part)}) AND QLIK_Receivable_Balance__c != 0${scoped ? ` AND ${scoped}` : ''}`))),
    Promise.all(accountChunks.map((part) => all(`SELECT Id,STEM__c,Supplier__c,CurrencyIsoCode,Payable_Balance__c FROM Supplier_Invoice__c WHERE Supplier__c IN (${values(part)}) AND Payable_Balance__c != 0${relatedStemScope ? ` AND (${relatedStemScope})` : ''}`))),
    Promise.all(accountChunks.map((part) => all(`SELECT ${lineSelect.join(',')} FROM STEM_Line_Item__c WHERE Cancelled__c = false AND Supplier_Invoice__c = null AND ${lineLookup.fieldName} IN (${values(part)})${relatedStemScope ? ` AND (${relatedStemScope})` : ''}`))),
    Promise.all(accountChunks.map((part) => all(`SELECT ${extraSelect.join(',')} FROM STEM_Extra_Cost__c WHERE Cancelled__c = false AND Supplier_Invoice__c = null AND ${extraLookup.fieldName} IN (${values(part)})${relatedStemScope ? ` AND (${relatedStemScope})` : ''}`))),
  ]);
  const buyerStems = buyerStemChunks.flat(); const invoices = invoiceChunks.flat();
  const unbilledLines = unbilledLineChunks.flat(); const unbilledExtras = unbilledExtraChunks.flat();
  const bucket = (rows, amountField, idsFor) => { const result = new Map(); for (const row of rows) for (const owner of idsFor(row)) { const entry = result.get(owner) || new Map(); const code = currency(row.CurrencyIsoCode); const current = entry.get(code) || { currency: code, exposure: 0, openStemIds: new Set() }; current.exposure += Number(row[amountField] || 0); if (row.STEM__c || row.Id) current.openStemIds.add(row.STEM__c || row.Id); entry.set(code, current); result.set(owner, entry); } return result; };
  const ownerKeys = (row, field) => identities.filter((identity) => identity.memberAccountIds.some((id) => key(id) === key(row[field]))).map((identity) => identity.entityKey);
  const buyer = bucket(buyerStems, 'QLIK_Receivable_Balance__c', (row) => ownerKeys(row, 'Account__c'));
  const supplier = bucket(invoices, 'Payable_Balance__c', (row) => ownerKeys(row, 'Supplier__c'));
  const uninvoicedEstimates = [
    ...unbilledLines.map((row) => ({ ownerId: row[lineLookup.fieldName], stemId: row.STEM__c, estimate: estimateUninvoicedSupplierChild({ ...row, _uom: row.UOM__c }, 'line_item') })),
    ...unbilledExtras.map((row) => ({ ownerId: row[extraLookup.fieldName], stemId: row.STEM__c, estimate: estimateUninvoicedSupplierChild({ ...row, _uom: row.UOM__c }, 'extra_cost') })),
  ];
  const incompleteSuppliers = new Set(uninvoicedEstimates.filter((row) => !row.estimate.complete).flatMap((row) => identities.filter((identity) => identity.memberAccountIds.some((member) => key(member) === key(row.ownerId))).map((identity) => identity.entityKey)));
  const exposures = identities.map((identity) => {
    const buyerRows = [...(buyer.get(identity.entityKey)?.values() || [])].map((row) => ({ currency: row.currency, exposure: row.exposure, openStemCount: row.openStemIds.size }));
    const supplierComplete = !incompleteSuppliers.has(identity.entityKey);
    const supplierRows = supplierComplete ? [...(supplier.get(identity.entityKey)?.values() || [])].map((row) => ({ currency: row.currency, exposure: row.exposure, openStemIds: new Set(row.openStemIds) })) : [];
    if (supplierComplete) for (const row of uninvoicedEstimates.filter((row) => identity.memberAccountIds.some((id) => key(id) === key(row.ownerId)))) {
      const code = currency(row.estimate.currency); const existing = supplierRows.find((item) => item.currency === code);
      if (existing) { existing.exposure += Number(row.estimate.amount || 0); if (row.stemId) existing.openStemIds.add(row.stemId); }
      else supplierRows.push({ currency: code, exposure: Number(row.estimate.amount || 0), openStemIds: new Set(row.stemId ? [row.stemId] : []) });
    }
    const completeSupplierRows = supplierRows.map((row) => ({ currency: row.currency, exposure: row.exposure, openStemCount: row.openStemIds.size }));
    const codes = [...new Set([...buyerRows.map((row) => row.currency), ...completeSupplierRows.map((row) => row.currency)])].sort();
    const netComplete = supplierComplete;
    return { entityKey: identity.entityKey, buyer: { complete: true, byCurrency: buyerRows }, supplier: { complete: supplierComplete, byCurrency: completeSupplierRows }, net: { complete: netComplete, byCurrency: netComplete ? codes.map((code) => ({ currency: code, amount: (buyerRows.find((row) => row.currency === code)?.exposure || 0) - (completeSupplierRows.find((row) => row.currency === code)?.exposure || 0) })) : [], warning: netComplete ? null : 'Uninvoiced supplier exposure exists; the supplier and net exposure are suppressed until authoritative statement evidence is complete.' } };
  });
  return { exposures, meta: { redacted: true, cache: 'live', complete: exposures.every((row) => row.buyer.complete && row.supplier.complete), returnedCount: exposures.length } };
}

export async function loadDashboardAccountExposureBatch({ body = {}, accessContext, force = false }) {
  const entities = (Array.isArray(body.entities) ? body.entities : []).map((row) => ({ entityType: row?.entityType, entityId: row?.entityId }));
  const cached = await getOrLoadRuntimeCache({
    namespace: 'salesforce-dashboard-account-exposure-batch', version: '1', accessScope: interoffice(accessContext) ? 'interoffice' : 'standard', apiVersion: `${getApiVersion()}@${getInstanceUrl()}`,
    payload: { entities, filters: normalizedFilters(body.filters) }, ttlSeconds: 60,
    tags: ['salesforce:dashboard', 'salesforce:account', 'salesforce:group', 'salesforce:stem', 'salesforce:supplier-invoice', 'salesforce:line-item', 'salesforce:extra-cost', 'salesforce:account-credit'], force,
    loader: () => loadDashboardAccountExposureBatchUncached({ body, accessContext, force }),
  });
  return { ...cached.value, meta: { ...cached.value.meta, cache: cached.cache?.status || null } };
}
