import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { sfQuery, sfQueryAll } from './_salesforce.js';
import { safetySelectFields } from './_xeroDocumentSafety.js';
import { buildGroupedPreservationContext } from './_xeroGroupedPreservationAdapter.js';
import { derivePetroleumOwnership } from './_xeroIssuedPetroleumOwnership.js';
import { issuedSupplierHash as hash, issuedSupplierSfId as sf } from './_xeroIssuedSupplierPreservation.js';
import { collectPetroleumXeroHistory, PETROLEUM_SCOPE_LIMITS } from './_xeroIssuedPetroleumScope.js';
import { ISSUED_GROUPED_PETROLEUM_PRESERVATION_POLICY as POLICY } from './_xeroIssuedGroupedPetroleumPreservation.js';
import { issuedGroupedPetroleumScopeFingerprint } from './_xeroIssuedGroupedPetroleumPreservationAdapter.js';

const uuid = value => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value || '') ? value.toLowerCase() : null;
const fail = message => Object.assign(new Error(message), { code: 'XERO_GROUPED_PETROLEUM_SCOPE_INCOMPLETE', status: 409 });
const unique = values => [...new Set(values)].sort();
const quote = ids => ids.map(id => `'${id}'`).join(',');
const kinds = {
  buyer: { object: 'Invoice__c', prefix: 'a0K', owner: 'STEM__r.Account__c', binding: 'Buyer_Invoice__c',
    amount: 'Amount__c', snapshot: 'buyers', target: 'ACCREC',
    parentFields: 'STEM__r.Account__c, STEM__r.Account__r.Name, STEM__r.Account__r.Company_Code__c, Proforma__c, Deprecated__c, File__c' },
  supplier: { object: 'Supplier_Invoice__c', prefix: 'a06', owner: 'Supplier__c', binding: 'Supplier_Invoice__c',
    amount: 'Invoice_Amount__c', snapshot: 'suppliers', target: 'ACCPAY',
    parentFields: 'Supplier__c, Supplier__r.Name, Supplier__r.Company_Code__c' },
};
const ownerId = (row, direction) => sf(direction === 'buyer' ? row.STEM__r?.Account__c : row.Supplier__c);
const parentFields = 'Id, IsDeleted, Name, STEM__c, STEM__r.KeyStem__c, STEM__r.Delivery_Date__c, STEM__r.Vessel__c, STEM__r.Vessel__r.Name, STEM__r.Vessel__r.IMO__c, Invoice_Date__c, Invoice_Due_Date__c, LastModifiedDate';
const inventoryFields = 'Id, IsDeleted, Cancelled__c, STEM__c, Buyer_Invoice__c, Supplier_Invoice__c';
const lineFields = 'Product__c, Product__r.Name, Original_Supplier__c, Quantity_Delivered_Per_BDN__c, Quantity__c, Unit_of_Measure__c, Unit_Buy_At__c, Unit_Sell_At__c, Total_Cost__c, Total_Price__c, LastModifiedDate';
const agree = (fresh, previous, fields) => fields.every(key => !Object.hasOwn(previous, key)
  || Object.hasOwn(fresh, key) && hash(fresh[key]) === hash(previous[key]));

export async function collectGroupedPetroleumPreservationScope({ records, connection, salesforce, xero, sources, stored } = {}, {
  query = sfQuery, queryAll = sfQueryAll, ...xeroOptions
} = {}) {
  if (!Array.isArray(records) || !records.length || records.length > 25 || !Array.isArray(sources)
    || !uuid(connection?.tenantId) || connection.tenantId !== xero?.tenantId
    || !Array.isArray(salesforce?.lines) || !Array.isArray(salesforce?.extras)) throw fail('Complete current provider snapshots are required.');
  const context = buildGroupedPreservationContext(salesforce, xero, stored, sources);
  if (!context.complete) throw fail('Complete current Account and Contact identities are required.');
  const selections = records.map(record => {
    const id = sf(record?.sourceId), targetId = uuid(record?.xeroDocumentId);
    const direction = id?.startsWith(kinds.buyer.prefix) ? 'buyer' : 'supplier';
    const kind = kinds[direction];
    const current = sources.filter(row => row.salesforceObject === kind.object && sf(row.salesforceId) === id);
    const targets = [...xero.documents, ...(xero.inactiveDocuments || [])].filter(row => uuid(row.id) === targetId);
    const source = current[0], target = targets[0];
    const account = context.accountsById.get(sf(source?.accountId));
    const contacts = account ? context.matchesFor(account) : [];
    if (!id?.startsWith(kind.prefix) || !targetId || current.length !== 1 || targets.length !== 1
      || !sf(source.stemId) || !sf(source.accountId) || !uuid(source.contactId) || target.type !== kind.target
      || contacts.length !== 1 || uuid(contacts[0].id) !== uuid(source.contactId)
      || uuid(target.contactId) !== uuid(source.contactId)) throw fail('An exact typed source and Xero Contact/document are required.');
    const ownership = derivePetroleumOwnership({ tenantId: connection.tenantId, accountId: source.accountId,
      contactId: source.contactId, accounts: [...context.accountsById.values()], contacts: context.identityContacts, complete: context.complete });
    if (!ownership.eligible) throw fail('Complete current ownership evidence is required.');
    return { id, targetId, direction, kind, source, target, ownerIds: ownership.sourceAccountIds };
  });
  if (unique(selections.map(row => row.id)).length !== selections.length
    || unique(selections.map(row => row.targetId)).length !== selections.length) throw fail('Repeated selected identities are unsupported.');
  const queryFingerprints = [];
  const read = async (soql, limit, all = true) => {
    const result = await (all ? queryAll : query)(soql, { clean: true, limit });
    const rows = result?.records;
    if (result?.error || result?.done === false || !Array.isArray(rows) || result.totalSize !== rows.length || rows.length > limit
      || rows.some(row => !sf(row?.Id)) || unique(rows.map(row => sf(row.Id))).length !== rows.length) {
      throw fail('The all-years Salesforce evidence is incomplete or duplicated.');
    }
    queryFingerprints.push(hash({ soql, all, limit }));
    return [...rows].sort((a, b) => sf(a.Id).localeCompare(sf(b.Id)));
  };
  const org = fcosSalesforceEnvironment('production');
  const organizations = await read('SELECT Id, IsSandbox FROM Organization', 2, false);
  if (organizations.length !== 1 || sf(organizations[0].Id) !== sf(org.orgId) || organizations[0].IsSandbox !== false) {
    throw fail('The pinned Salesforce Production organisation is required.');
  }
  const stemIds = unique(selections.map(({ source }) => sf(source.stemId)));
  const sourceAccountIds = unique(selections.flatMap(row => row.ownerIds));
  const sourceClaims = [], sourceObjects = [], inventoryPredicates = [`STEM__c IN (${quote(stemIds)})`];
  for (const [direction, kind] of Object.entries(kinds)) {
    const selected = selections.filter(row => row.direction === direction);
    if (!selected.length) continue;
    const accounts = unique(selected.flatMap(row => row.ownerIds));
    const stems = unique(selected.map(row => sf(row.source.stemId)));
    const fields = safetySelectFields(salesforce.safetyContext, kind.object, direction === 'buyer'
      ? ['CurrencyIsoCode', 'Buyer_Charge_Snapshot__c', 'Delivery_Date__c'] : ['CurrencyIsoCode', 'Invoice_File__c', 'File__c'])
      + (direction === 'buyer' ? safetySelectFields(salesforce.safetyContext, 'STEM__c', ['CurrencyIsoCode', 'Payment_Term__c'], 'STEM__r.') : '');
    const rows = await read(`SELECT ${parentFields}, ${kind.parentFields}, ${kind.amount}${fields} FROM ${kind.object} WHERE ${kind.owner} IN (${quote(accounts)}) OR STEM__c IN (${quote(stems)}) ORDER BY Id`, PETROLEUM_SCOPE_LIMITS.parents);
    if (rows.some(row => !sf(row.Id).startsWith(kind.prefix)
      || !accounts.includes(ownerId(row, direction)) && !stems.includes(sf(row.STEM__c)))) {
      throw fail('Salesforce returned an out-of-scope typed obligation.');
    }
    sourceClaims.push(...rows.map(raw => ({ direction, salesforceObject: kind.object, raw })));
    sourceObjects.push(kind.object);
    inventoryPredicates.push(`${kind.binding} IN (${quote(selected.map(row => row.id))})`);
  }
  const childWhere = inventoryPredicates.join(' OR ');
  const optionalLineFields = safetySelectFields(salesforce.safetyContext, 'STEM_Line_Item__c', ['CurrencyIsoCode', 'Quantity_Max__c']);
  const lines = await read(`SELECT ${inventoryFields}, ${lineFields}${optionalLineFields} FROM STEM_Line_Item__c WHERE ${childWhere} ORDER BY Id`, PETROLEUM_SCOPE_LIMITS.children);
  const extras = await read(`SELECT ${inventoryFields}, Line_Total__c, Line_Total_Buy__c FROM STEM_Extra_Cost__c WHERE ${childWhere} ORDER BY Id`, PETROLEUM_SCOPE_LIMITS.children);
  for (const row of [...lines, ...extras]) {
    const bound = selections.filter(({ kind, id }) => sf(row[kind.binding]) === id);
    const stem = sf(row.STEM__c);
    if (!stemIds.includes(stem) || bound.some(({ source }) => sf(source.stemId) !== stem)) {
      throw fail('Salesforce returned a child outside the exact STEM or selected-parent scope.');
    }
  }
  const productIds = unique(selections.flatMap(({ kind, id }) => lines
    .filter(row => sf(row[kind.binding]) === id).map(row => sf(row.Product__c)).filter(Boolean)));
  const products = productIds.length ? await read(`SELECT Id, IsDeleted, IsActive, Name, RecordType.DeveloperName FROM Product2 WHERE Id IN (${quote(productIds)}) ORDER BY Id`, PETROLEUM_SCOPE_LIMITS.children) : [];
  if (products.length !== productIds.length || products.some(row => !productIds.includes(sf(row.Id)))) throw fail('The exact Product2 evidence is incomplete.');
  const currencyContext = { singleCurrency: salesforce.safetyContext?.singleCurrency === true, corporateCurrency: salesforce.safetyContext?.corporateCurrency || null };
  const sourceFacts = new Map();
  for (const { id, direction, kind, source } of selections) {
    const parent = sourceClaims.find(claim => claim.direction === direction && sf(claim.raw.Id) === id)?.raw;
    const previous = salesforce[kind.snapshot]?.filter(row => sf(row.Id) === id) || [];
    if (!parent || parent.IsDeleted !== false || previous.length !== 1 || ownerId(parent, direction) !== sf(source.accountId)
      || sf(parent.STEM__c) !== sf(source.stemId)
      || !agree(parent, previous[0], ['Name', 'Invoice_Date__c', 'Invoice_Due_Date__c', kind.amount, 'LastModifiedDate', 'CurrencyIsoCode',
        ...(direction === 'buyer' ? ['File__c', 'Buyer_Charge_Snapshot__c', 'Proforma__c', 'Deprecated__c'] : [])])) {
      throw fail('The selected source changed between the current reads.');
    }
    const stemLines = lines.filter(row => sf(row.STEM__c) === sf(source.stemId));
    const stemExtras = extras.filter(row => sf(row.STEM__c) === sf(source.stemId));
    const selectedLines = stemLines.filter(row => sf(row[kind.binding]) === id);
    const selectedExtras = stemExtras.filter(row => sf(row[kind.binding]) === id);
    const currentIds = unique([...selectedLines, ...selectedExtras].filter(row => row.IsDeleted === false && row.Cancelled__c === false).map(row => sf(row.Id)));
    const previousIds = unique([...salesforce.lines, ...salesforce.extras].filter(row => sf(row[kind.binding]) === id).map(row => sf(row.Id)));
    if (hash(currentIds) !== hash(previousIds)) throw fail('The selected child inventory changed between the current reads.');
    const selectedProducts = new Set(selectedLines.map(row => sf(row.Product__c)));
    sourceFacts.set(id, { direction, parent, lines: selectedLines, extras: selectedExtras,
      products: products.filter(row => selectedProducts.has(sf(row.Id))), stemLines, stemExtras, currencyContext });
  }
  const { targetClaims, creditClaims, accountTax, xeroContactIds, queryFingerprints: xeroFingerprints } = await collectPetroleumXeroHistory({
    connection, selections: selections.map(({ source, target }) => ({ contactId: source.contactId, target })),
  }, xeroOptions);
  const scope = { policyVersion: POLICY, salesforceOrgId: org.orgId, tenantId: connection.tenantId, sourceFacts,
    sourceClaims, targetClaims, creditClaims, accountTax, currencyContext,
    coverage: { sourceAccountIds, stemIds, xeroContactIds, sourceObjects, sourceQueryAll: true,
      sourceComplete: true, targetComplete: true, creditComplete: true, accountTaxComplete: true,
      sourceCount: sourceClaims.length, targetCount: targetClaims.length, creditCount: creditClaims.length,
      queryFingerprints: [...queryFingerprints, ...xeroFingerprints] } };
  scope.coverage.contentFingerprint = issuedGroupedPetroleumScopeFingerprint(scope);
  return scope;
}
