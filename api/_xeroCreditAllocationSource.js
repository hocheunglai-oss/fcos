import { isDeepStrictEqual } from 'node:util';
import { nativeDocumentSourceFingerprint } from './_xeroNativeDocumentFingerprint.js';
import { sfCompositeQueries, sfQuery } from './_salesforce.js';
import { completeNativeRecords, loadNativeDocumentLineSources, readNativeDocuments, resolveNativeDocumentId } from './_xeroNativeDocumentSource.js';
import { XERO_FINANCIAL_CUTOFF } from './_xeroFinancialSync.js';

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

/** Enumerate issued credit candidates, including those held for missing lineage. */
export async function readCreditAllocationSourceCohort({ cutoff, through } = {}, { composite = sfCompositeQueries } = {}) {
  const upper = Date.parse(through);
  if (cutoff !== XERO_FINANCIAL_CUTOFF || !Number.isFinite(upper)
      || new Date(upper).toISOString() !== through || upper < Date.parse(cutoff)) {
    throw sourceError('An exact credit cohort cutoff and creation watermark are required.', 400);
  }
  const sources = [
    { object: 'Invoice__c', original: 'Original_Invoice__c', amount: 'Amount__c', file: 'File__c', buyer: true },
    { object: 'Supplier_Invoice__c', original: 'Original_Supplier_Invoice__c', amount: 'Invoice_Amount__c', file: 'Invoice_File__c', buyer: false },
  ];
  const limit = 100000;
  const results = await composite(sources.map(({ object, original, amount, file, buyer }) => ({
    soql: `SELECT Id, Name, CreatedDate, LastModifiedDate, Invoice_Date__c, ${original}, ${amount}, ${file},
        Proforma__c${buyer ? ', Deprecated__c' : ''}
      FROM ${object}
      WHERE CreatedDate <= ${through} AND Proforma__c = false AND ${file} != null
        ${buyer ? 'AND Deprecated__c = false' : ''}
        AND (${original} != null OR ${amount} < 0${buyer ? " OR Name LIKE '%-CN-%'" : ''})
        AND (Invoice_Date__c >= ${cutoff} OR (Invoice_Date__c = null AND CreatedDate >= ${cutoff}T00:00:00Z))
      ORDER BY Id`,
    clean: true,
    limit,
  })));
  if (!Array.isArray(results) || results.length !== sources.length) {
    throw sourceError('Salesforce returned incomplete credit cohort evidence.', 502);
  }
  const seen = new Set();
  const rows = sources.flatMap(({ object, original, amount, file, buyer }, index) =>
    completeNativeRecords(results[index], limit).map(row => {
      const date = row?.Invoice_Date__c;
      const created = Date.parse(row?.CreatedDate);
      const modified = Date.parse(row?.LastModifiedDate);
      const creditByAmountOrName = Number(row?.[amount]) < 0 || (buyer && /-CN-/i.test(row?.Name || ''));
      if (!validId(row?.Id) || seen.has(row.Id.slice(0, 15)) || !row[file]
          || row.Proforma__c !== false || (buyer && row.Deprecated__c !== false)
          || !Number.isFinite(created) || !Number.isFinite(modified) || created > upper || modified < created
          || (date == null ? created < Date.parse(cutoff)
            : typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
              || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date < cutoff)
          || (row[original] == null && !creditByAmountOrName)) {
        throw sourceError('Salesforce returned duplicate or out-of-scope credit cohort evidence.', 502);
      }
      seen.add(row.Id.slice(0, 15));
      const originalId = validId(row[original]) && !sameId(row.Id, row[original]) ? row[original] : null;
      return {
        sourceObject: object,
        creditId: row.Id,
        originalId,
        modifiedAt: new Date(modified).toISOString(),
        sourceHold: !date ? 'missing_invoice_date' : !originalId ? 'missing_original_invoice' : null,
      };
    }));
  return { cutoff, through, rows };
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
