import { isDeepStrictEqual } from 'node:util';
import { nativeDocumentSourceFingerprint } from './_xeroNativeDocumentFingerprint.js';
import { sfCompositeQueries, sfQuery } from './_salesforce.js';
import { completeNativeRecords, loadNativeDocumentLineSources, readNativeDocuments, resolveNativeDocumentId } from './_xeroNativeDocumentSource.js';

const ID = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;

function validId(value) {
  return typeof value === 'string' && ID.test(value);
}

function sameId(left, right) {
  return validId(left) && validId(right) && left.slice(0, 15) === right.slice(0, 15);
}

function sourceError(message, status = 409) {
  return Object.assign(new Error(message), { code: 'XERO_CREDIT_ALLOCATION_SOURCE_INVALID', status });
}

export function resolveCreditAllocationSourceId(sourceObject, creditNumber, query = sfQuery) {
  return resolveNativeDocumentId(sourceObject, creditNumber, { query, creditOnly: true });
}

export async function loadCreditAllocationSalesforceSource(sourceObject, creditId, {
  query = sfQuery,
  composite = sfCompositeQueries,
} = {}) {
  if (!['Invoice__c', 'Supplier_Invoice__c'].includes(sourceObject) || !validId(creditId)) {
    throw sourceError('Select one exact Salesforce credit document.', 400);
  }

  const supplier = sourceObject === 'Supplier_Invoice__c';
  const lineage = supplier ? 'Original_Supplier_Invoice__c' : 'Original_Invoice__c';
  const parent = supplier ? 'Supplier_Invoice__c' : 'Buyer_Invoice__c';

  const lookup = await query(
    `SELECT Id, ${lineage} FROM ${sourceObject} WHERE Id = '${creditId}'`,
    { clean: true, limit: 2 },
  );
  const selected = completeNativeRecords(lookup, 2);
  const originalId = selected[0]?.[lineage];
  if (selected.length !== 1 || !sameId(selected[0].Id, creditId)
      || !validId(originalId) || sameId(creditId, originalId)) {
    throw sourceError('The credit must identify a distinct exact original invoice.');
  }

  const { documents, documentLines } = await readNativeDocuments(sourceObject, [selected[0].Id, originalId], composite);
  const credit = documents.find(row => sameId(row?.Id, creditId));
  const original = documents.find(row => sameId(row?.Id, originalId));
  const party = row => supplier ? row?.Supplier__c : row?.STEM__r?.Account__c;
  const fileField = supplier ? 'Invoice_File__c' : 'File__c';
  if (documents.length !== 2 || !credit || !original || credit[lineage] !== original.Id
      || original[lineage] || !sameId(credit.STEM__c, original.STEM__c) || !sameId(party(credit), party(original))
      || documents.some(row => !row[fileField] || row.Proforma__c !== false || (!supplier && row.Deprecated__c !== false))) {
    throw sourceError('The exact issued credit and original invoice could not be confirmed for one STEM and party.');
  }

  const originalLines = new Map();
  const creditLines = [];
  for (const line of documentLines) {
    if (line[parent] === original.Id) originalLines.set(line.Id, line);
    else creditLines.push(line);
  }
  if (!originalLines.size || creditLines.length !== originalLines.size
      || new Set(creditLines.map(line => line.Original_Line__c)).size !== originalLines.size
      || creditLines.some(line => originalLines.get(line.Original_Line__c)?.Source_Record_Id__c !== line.Source_Record_Id__c)) {
    throw sourceError('Each credit line must identify one exact immutable original line.');
  }
  return { credit, original, documentLines };
}

export async function verifyCreditAllocationSourceMappings(sourceObject, source, mappings, composite = sfCompositeQueries) {
  const supplier = sourceObject === 'Supplier_Invoice__c';
  const parent = supplier ? 'Supplier_Invoice__c' : 'Buyer_Invoice__c';
  const prefix = supplier ? 'ACCPAY' : 'ACCREC';
  const creditMapping = mappings.find(row => row.salesforce_id === source.credit.Id);
  const invoiceMapping = mappings.find(row => row.salesforce_id === source.original.Id);
  if (mappings.length !== 2 || !creditMapping || !invoiceMapping
      || mappings.some(row => row.salesforce_object !== sourceObject || row.protected_legacy !== false)
      || creditMapping.xero_document_type !== `${prefix}CREDIT` || invoiceMapping.xero_document_type !== prefix) {
    throw sourceError('Unique native credit and original invoice mappings are required.');
  }

  const originalAdjustment = invoiceMapping.currency_evidence?.roundingAdjustment;
  const creditAdjustment = creditMapping.currency_evidence?.roundingAdjustment;
  if (originalAdjustment || creditAdjustment) {
    const { originalMappingId, originalSourceFingerprint, reversal, ...base } = creditAdjustment || {};
    if (!originalAdjustment || reversal !== true || originalMappingId !== invoiceMapping.id
        || originalSourceFingerprint !== invoiceMapping.source_fingerprint
        || !isDeepStrictEqual(base, originalAdjustment)) {
      throw sourceError('The credit rounding adjustment does not reverse the exact original mapping.');
    }
  }

  const sourceRows = await loadNativeDocumentLineSources(source.documentLines, source.original.STEM__c, composite);
  const verify = (document, mapping, adjustment) => {
    const lines = source.documentLines.filter(line => line[parent] === document.Id);
    const sourceFingerprint = nativeDocumentSourceFingerprint(document, lines, sourceRows, adjustment);
    if (sourceFingerprint !== mapping.source_fingerprint) {
      throw sourceError('Current immutable Salesforce evidence does not match the saved document mapping.');
    }
    return { sourceFingerprint };
  };
  return {
    creditMapping,
    invoiceMapping,
    sourceCredit: verify(source.credit, creditMapping, creditAdjustment),
    sourceOriginal: verify(source.original, invoiceMapping, originalAdjustment),
  };
}
