import { chunkIds, sfCompositeQueries, sfQuery } from './_salesforce.js';
import { buildNativeAccountingLines } from './_xeroNativeAccountingLines.js';
import { nativeDocumentSourceFingerprint } from './_xeroNativeDocumentFingerprint.js';

const ID = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;
const MAX_LINES = 100000;
const FX_FIELDS = [
  'Document_Currency__c', 'Document_HKD_Amount__c', 'Document_FX_Rate__c',
  'Document_FX_Revision__c', 'Document_FX_Confirmed_At__c', 'Document_FX_Fingerprint__c',
  'Document_FX_Side__c',
];
const LINE_FIELDS = [
  'Id', 'Buyer_Invoice__c', 'Supplier_Invoice__c', 'Source_Record_Id__c',
  'Description__c', 'Unit__c', 'Quantity__c', 'Native_Unit_Price__c', 'Native_Amount__c',
  'Pricing_Mode__c', 'Native_Minimum__c', 'Native_Lumpsum__c', 'Accounting_USD__c',
  'Currency__c', 'FX_Rate__c', 'FX_Revision__c', 'Original_Line__c', 'LastModifiedDate',
  'Original_Line__r.Id', 'Original_Line__r.Source_Record_Id__c',
  'Original_Line__r.Buyer_Invoice__c', 'Original_Line__r.Supplier_Invoice__c',
];


function validId(value) {
  return typeof value === 'string' && ID.test(value);
}

function sameId(left, right) {
  return validId(left) && validId(right) && left.slice(0, 15) === right.slice(0, 15);
}

function sourceError(message, status = 409) {
  return Object.assign(new Error(message), { code: 'XERO_NATIVE_DOCUMENT_SOURCE_INVALID', status });
}

export function completeNativeRecords(result, limit) {
  if (result?.error || result?.done === false || result?.nextRecordsUrl || !Array.isArray(result?.records) || result.totalSize !== result.records.length
      || result.records.length > limit) {
    throw sourceError('Salesforce returned incomplete credit allocation or native document evidence.', 502);
  }
  return result.records;
}

export const isNativeDocumentNumber = value => typeof value === 'string' && /^[a-z0-9][a-z0-9 ./_-]{0,79}$/i.test(value);

export async function resolveNativeDocumentId(sourceObject, documentNumber, { query = sfQuery, creditOnly = false } = {}) {
  if (!['Invoice__c', 'Supplier_Invoice__c'].includes(sourceObject)
      || !isNativeDocumentNumber(documentNumber)) {
    throw sourceError('Enter an exact Salesforce document number.', 400);
  }
  const lineage = sourceObject === 'Invoice__c' ? 'Original_Invoice__c' : 'Original_Supplier_Invoice__c';
  const filter = creditOnly ? `${lineage} != null` : 'Document_FX_Fingerprint__c != null';
  const records = completeNativeRecords(await query(
    `SELECT Id, Name FROM ${sourceObject} WHERE Name = '${documentNumber}' AND ${filter} LIMIT 2`,
    { clean: true, limit: 2 },
  ), 2);
  if (records.length !== 1 || !validId(records[0]?.Id) || records[0].Name !== documentNumber) {
    throw sourceError('The number must identify exactly one Salesforce document.');
  }
  return records[0].Id;
}

export async function readNativeDocuments(sourceObject, sourceIds, composite = sfCompositeQueries) {
  if (!['Invoice__c', 'Supplier_Invoice__c'].includes(sourceObject) || !Array.isArray(sourceIds)
      || !sourceIds.length || sourceIds.length > 2 || sourceIds.some(id => !validId(id))
      || new Set(sourceIds.map(id => id.slice(0, 15))).size !== sourceIds.length) {
    throw sourceError('Exact Salesforce native document identities are required.', 400);
  }
  const supplier = sourceObject === 'Supplier_Invoice__c';
  const lineage = supplier ? 'Original_Supplier_Invoice__c' : 'Original_Invoice__c';
  const originalRelationship = lineage.replace(/__c$/, '__r');
  const reissue = supplier ? 'Reissue_Of_Supplier_Invoice__c' : 'Reissue_Of_Invoice__c';
  const parent = supplier ? 'Supplier_Invoice__c' : 'Buyer_Invoice__c';
  const otherParent = supplier ? 'Buyer_Invoice__c' : 'Supplier_Invoice__c';
  const fields = [
    'Id', 'Name', 'CreatedDate', 'LastModifiedDate', 'STEM__c', 'STEM__r.Name',
    'STEM__r.KeyStem__c', 'Invoice_Date__c', 'Invoice_Due_Date__c', 'Proforma__c',
    'Final_Of_Proforma__c', 'Document_Operation_Id__c', 'Document_Request_Fingerprint__c',
    ...FX_FIELDS, lineage, reissue,
    ...['Id', 'Final_Of_Proforma__c', reissue, ...FX_FIELDS].map(field => `${originalRelationship}.${field}`),
    ...(supplier
      ? ['Supplier__c', 'Supplier__r.Name',
        'Supplier__r.Company_Code__c', 'Supplier__r.Inactive_Suspended__c', 'Invoice_File__c', 'Invoice_Amount__c', 'Payable_Balance__c']
      : ['STEM__r.Account__c', 'STEM__r.Account__r.Name',
        'STEM__r.Account__r.Company_Code__c', 'STEM__r.Account__r.Inactive_Suspended__c', 'STEM__r.Delivery_Date__c',
        'File__c', 'Amount__c', 'Deprecated__c']),
  ];

  const ids = `(${sourceIds.map(id => `'${id}'`).join(', ')})`;
  const [headers, lines] = await composite([
    { soql: `SELECT ${fields.join(', ')} FROM ${sourceObject} WHERE Id IN ${ids}`, clean: true, limit: sourceIds.length + 1 },
    { soql: `SELECT ${LINE_FIELDS.join(', ')} FROM Trade_Document_Line__c WHERE ${parent} IN ${ids} ORDER BY Id`,
      clean: true, limit: MAX_LINES },
  ]);
  const documents = completeNativeRecords(headers, sourceIds.length + 1);
  if (documents.length !== sourceIds.length || sourceIds.some(id => documents.filter(row => sameId(row?.Id, id)).length !== 1)) {
    throw sourceError('The exact issued native document selection could not be confirmed.');
  }
  const documentIds = new Set(documents.map(row => row.Id));
  const documentLines = completeNativeRecords(lines, MAX_LINES);
  const seen = new Set();
  for (const line of documentLines) {
    if (!validId(line?.Id) || !validId(line.Source_Record_Id__c) || seen.has(line.Id.slice(0, 15))
        || line[otherParent] || !documentIds.has(line[parent])) {
      throw sourceError('The immutable native evidence contains a duplicate or out-of-scope line.');
    }
    seen.add(line.Id.slice(0, 15));
  }
  return { documents, documentLines };
}

// These are the original product identities used to generate the native mapping
// fingerprint. Read only the rows referenced by the issued immutable snapshots.
export async function loadNativeDocumentLineSources(documentLines, stemId, composite = sfCompositeQueries) {
  const ids = [...new Set(documentLines.map(line => line.Source_Record_Id__c))];
  if (!ids.length || ids.some(id => !validId(id))) throw sourceError('Exact immutable line sources are required.');
  const rowsById = new Map();
  for (const group of chunkIds(ids, 200)) {
    const scope = new Set(group);
    const idsLiteral = group.map(id => `'${id}'`).join(', ');
    const results = await composite([
      { soql: `SELECT Id, STEM__c, Product__c, Product__r.Name FROM STEM_Line_Item__c WHERE Id IN (${idsLiteral})`, clean: true, limit: 201 },
      { soql: `SELECT Id, STEM__c, Product2Id__c, Product2Id__r.Name FROM STEM_Extra_Cost__c WHERE Id IN (${idsLiteral})`, clean: true, limit: 201 },
    ]);
    if (results.length !== 2) throw sourceError('Salesforce returned incomplete immutable line sources.', 502);
    for (const result of results) {
      for (const row of completeNativeRecords(result, 201)) {
        const product = row?.Product__c || row?.Product2Id__c;
        if (!scope.has(row?.Id) || rowsById.has(row.Id) || !sameId(row.STEM__c, stemId) || !validId(product)) {
          throw sourceError('An immutable line source or product does not belong to the selected invoice.');
        }
        rowsById.set(row.Id, row);
      }
    }
  }
  if (rowsById.size !== ids.length) throw sourceError('Some immutable line sources could not be verified.');
  return rowsById;
}


export async function loadNativeAccountingSource(sourceObject, documentId, {
  composite = sfCompositeQueries, productMappings, tenantId, roundingPolicy, originalMapping, loadControls,
} = {}) {
  if (!(productMappings instanceof Map) && !loadControls) throw sourceError('Scoped Finance product mappings are required.');
  const { documents: [record], documentLines } = await readNativeDocuments(sourceObject, [documentId], composite);
  const direction = sourceObject === 'Invoice__c' ? 'buyer' : 'supplier';
  const sourceRows = await loadNativeDocumentLineSources(documentLines, record.STEM__c, composite);
  const controls = loadControls
    ? await loadControls({ record, sourceObject, direction, sourceRows }) : { productMappings, roundingPolicy, originalMapping };
  const { currentMapping = null, ...accountingControls } = controls;
  const accounting = buildNativeAccountingLines({
    record, direction, snapshots: documentLines, sourceRows, tenantId, ...accountingControls,
  });
  return {
    record, ...accounting, currentMapping,
    sourceFingerprint: nativeDocumentSourceFingerprint(record, documentLines, sourceRows, accounting.roundingAdjustment),
  };
}
