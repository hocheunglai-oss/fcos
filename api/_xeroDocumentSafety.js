import { buyerInvoiceSnapshotComparison } from './_buyerInvoiceApproval.js';
import { sfRequest, sfUserCurrencyInfo } from './_salesforce.js';

const SOURCE_OBJECTS = ['Invoice__c', 'Supplier_Invoice__c', 'STEM__c', 'STEM_Line_Item__c', 'STEM_Extra_Cost__c', 'Payment__c'];
const text = (value) => String(value ?? '').trim();
const currencyCode = (value) => /^[A-Z]{3}$/.test(text(value)) ? text(value) : null;
const moneyEqual = (left, right) => Number.isFinite(Number(left)) && Number.isFinite(Number(right)) && Math.abs(Number(left) - Number(right)) < 0.005;
const description = (value) => text(value).replace(/\s+/g, ' ');

export function normalizePostingMode(value = 'draft') {
  if (!['draft', 'authorised'].includes(value)) throw safetyError('Posting mode must be draft or authorised.', 'XERO_FINANCIAL_POSTING_MODE_INVALID', 400);
  return value;
}

export function reviewedPostingMode(run, requested) {
  const saved = normalizePostingMode(run?.control_totals?.postingMode ?? 'draft');
  if (requested !== undefined && normalizePostingMode(requested) !== saved) {
    throw safetyError('Posting mode changed. Create and review a new preview before applying it.', 'XERO_FINANCIAL_POSTING_MODE_CHANGED');
  }
  return saved;
}

export async function loadFinancialSafetyContext({ request = sfRequest, userCurrency = sfUserCurrencyInfo } = {}) {
  const entries = await Promise.all(SOURCE_OBJECTS.map(async (name) => {
    const result = await request(`/sobjects/${name}/describe/`, { readOnly: true });
    if (!Array.isArray(result?.fields)) throw safetyError('Salesforce accounting schema evidence is unavailable.', 'XERO_FINANCIAL_SALESFORCE_INCOMPLETE', 502);
    return [name, result.fields.map((field) => field.name)];
  }));
  const fields = Object.fromEntries(entries);
  const evidence = await userCurrency();
  const singleCurrency = evidence.singleCurrency === true && SOURCE_OBJECTS.every((name) => !fields[name].includes('CurrencyIsoCode'));
  const corporateCurrency = singleCurrency ? currencyCode(evidence.corporateCurrency) : null;
  return { fields, singleCurrency, corporateCurrency };
}

export function safetySelectFields(context, object, candidates, prefix = '') {
  return candidates.filter((name) => context?.fields?.[object]?.includes(name)).map((name) => `, ${prefix}${name}`).join('');
}

export function financialSourceCurrency(record, children, context = {}, object = 'Invoice__c') {
  const sourceCurrency = currencyCode(record.CurrencyIsoCode)
    || (context.singleCurrency === true ? currencyCode(context.corporateCurrency) : null);
  const blockers = [];
  if (record.CurrencyIsoCode != null && !currencyCode(record.CurrencyIsoCode)) blockers.push('Salesforce document CurrencyIsoCode is invalid.');
  if (!sourceCurrency) blockers.push('Authoritative Salesforce document currency is missing. Confirm source currency before posting.');
  if (context.fields?.[object]?.includes('CurrencyIsoCode') && !currencyCode(record.CurrencyIsoCode)) blockers.push('Salesforce document CurrencyIsoCode is missing or invalid.');
  for (const child of children) {
    const childObject = child.Product__c ? 'STEM_Line_Item__c' : 'STEM_Extra_Cost__c';
    const childCurrency = currencyCode(child.CurrencyIsoCode);
    if (context.fields?.[childObject]?.includes('CurrencyIsoCode') && !childCurrency) blockers.push('Salesforce accounting line currency is missing or invalid.');
    if (child.CurrencyIsoCode && !childCurrency) blockers.push('Salesforce accounting line currency is invalid.');
    if (childCurrency && childCurrency !== sourceCurrency) blockers.push('Salesforce document and accounting line currencies differ. An explicit FX workflow is required.');
  }
  return { currency: sourceCurrency, blockers: [...new Set(blockers)] };
}

export function documentReadiness(record, direction, children, context = {}) {
  const blockers = [];
  const buyer = direction === 'buyer';
  const fieldNames = context.fields?.[buyer ? 'Invoice__c' : 'Supplier_Invoice__c'] || [];
  if (buyer) {
    if (record.Proforma__c !== false || record.Deprecated__c !== false) blockers.push('Authorised posting requires a verified non-proforma, non-deprecated buyer document.');
    if (!text(record.File__c)) blockers.push('Buyer invoice or credit note has no issued source file.');
    if (text(record.Buyer_Charge_Snapshot__c)) {
      const comparison = buyerInvoiceSnapshotComparison(record, { stem: { ...record.STEM__r, Id: record.STEM__c },
        allLineItems: children.filter((row) => row.Product__c), allExtraCosts: children.filter((row) => !row.Product__c) });
      if (comparison.matches !== true) blockers.push('Issued buyer invoice snapshot no longer matches its source file or accounting evidence.');
    }
  } else {
    if (!children.length || children.some((row) => row.Supplier_Invoice__c !== record.Id || row.Cancelled__c === true)) {
      blockers.push('Supplier posting requires current non-cancelled children linked to this exact issued invoice.');
    }
    if (children.some((row) => row.STEM__c && row.STEM__c !== record.STEM__c)) blockers.push('Supplier invoice and linked accounting children identify different STEMs.');
    if (children.some((row) => row.Supplier__c && row.Supplier__c !== record.Supplier__c)) blockers.push('Supplier invoice and linked accounting children identify different suppliers.');
    const fileFields = ['Invoice_File__c', 'File__c'].filter((field) => fieldNames.includes(field) || Object.hasOwn(record, field));
    if (!fileFields.length || !fileFields.some((field) => text(record[field]))) blockers.push('Supplier invoice has no verified issued source file.');
    for (const field of ['Status__c', 'Invoice_Status__c']) {
      if (!fieldNames.includes(field) && !Object.hasOwn(record, field)) continue;
      if (!['issued', 'approved', 'authorised', 'authorized', 'posted', 'paid', 'partially paid', 'unpaid', 'received'].includes(text(record[field]).toLowerCase())) blockers.push(`Supplier invoice ${field} does not confirm an issued document.`);
    }
  }
  return { ready: blockers.length === 0, blockers, file: text(record.File__c || record.Invoice_File__c) || null,
    snapshot: text(record.Buyer_Charge_Snapshot__c) || null,
    linkedChildren: children.map((row) => row.Id).sort() };
}

export function documentPostingBlockers(source, organisation = {}, current = null) {
  const blockers = [];
  const baseCurrency = currencyCode(organisation.baseCurrency);
  if (!baseCurrency) blockers.push('Verified Xero organisation base currency is missing.');
  else if (source.currency !== baseCurrency) blockers.push('Document currency differs from Xero base currency. Routine FX posting is not supported.');
  if (source.postingMode === 'authorised') blockers.push(...(source.readiness?.blockers || (source.readiness?.ready === true ? [] : ['Issued source readiness evidence is missing.'])));
  const lockDate = [organisation.periodLockDate, organisation.endOfYearLockDate].filter(Boolean).sort().at(-1);
  if ((source.postingMode === 'authorised' || current?.status === 'AUTHORISED') && lockDate && source.invoiceDate && source.invoiceDate <= lockDate) {
    blockers.push('The proposed accounting date falls in a locked Xero period.');
  }
  return blockers;
}

// Updates retain every existing line. No positional matching, line deletion or implicit recreation.
export function matchedXeroLines(sourceLines = [], currentLines = []) {
  const failed = (message) => ({ lines: null, blockers: [message] });
  const ambiguous = 'Source-to-Xero line correspondence is ambiguous. Review the historical line identity before updating.';
  if (!sourceLines.length || sourceLines.length !== currentLines.length) return failed('Source and Xero line counts differ. Finance must resolve historical line additions or removals.');
  const ids = currentLines.map((line) => text(line.LineItemID));
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) return failed('Xero line identity is missing or duplicated; historical lines cannot be safely updated.');
  if (currentLines.some((line) => Number(line.DiscountRate || 0) !== 0 || Number(line.DiscountAmount || 0) !== 0 || Number(line.TaxAmount || 0) !== 0)) {
    return failed('Existing Xero discount or tax amounts require Finance review before line updates.');
  }
  const chosen = sourceLines.map((line) => {
    const scored = currentLines.map((existing, index) => {
      const sameDescription = description(line.description) === description(existing.Description);
      const sameAmount = moneyEqual(Number(line.quantity) * Number(line.unitAmount), existing.LineAmount ?? Number(existing.Quantity) * Number(existing.UnitAmount));
      const sameAccounting = String(line.accountCode) === String(existing.AccountCode) && String(line.taxType || 'NONE') === String(existing.TaxType || 'NONE');
      return { index, score: sameDescription ? 4 + Number(sameAmount) + Number(sameAccounting) : sameAmount && sameAccounting ? 2 : 0 };
    });
    const highest = Math.max(...scored.map((item) => item.score));
    const matches = scored.filter((item) => item.score > 0 && item.score === highest);
    return matches.length === 1 ? matches[0].index : -1;
  });
  if (chosen.some((index) => index < 0) || new Set(chosen).size !== sourceLines.length) {
    // A single line on each side permits a factual comparison, but does not
    // establish that the two lines represent the same historical accounting.
    if (sourceLines.length === 1 && currentLines.length === 1) {
      const source = sourceLines[0]; const existing = currentLines[0];
      const descriptionsDiffer = description(source.description) !== description(existing.Description);
      const accountsDiffer = String(source.accountCode) !== String(existing.AccountCode);
      const taxesDiffer = String(source.taxType || 'NONE') !== String(existing.TaxType || 'NONE');
      if (descriptionsDiffer && (accountsDiffer || taxesDiffer)) {
        const safeCode = (value) => {
          const code = text(value);
          return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,31}$/.test(code) ? code : code ? '(unrecognized)' : '(missing)';
        };
        const differences = ['Salesforce and Xero descriptions differ'];
        if (accountsDiffer) differences.push(`mapped account ${safeCode(source.accountCode)} versus Xero ${safeCode(existing.AccountCode)}`);
        if (taxesDiffer) differences.push(`mapped tax type ${safeCode(source.taxType || 'NONE')} versus Xero ${safeCode(existing.TaxType || 'NONE')}`);
        return failed(`Line identity cannot be verified: ${differences.join('; ')}. Review the issued invoice and accounting mapping before updating.`);
      }
    }
    return failed(ambiguous);
  }
  return { blockers: [], lines: sourceLines.map((line, index) => {
    const { LineAmount: _lineAmount, TaxAmount: _taxAmount, ...existing } = currentLines[chosen[index]];
    return { ...existing, Description: line.description, Quantity: line.quantity, UnitAmount: line.unitAmount,
      AccountCode: line.accountCode, TaxType: line.taxType || 'NONE' };
  }) };
}

export function accountingPayload(source, xeroDocumentId = null, currentStatus = null, current = null) {
  const mode = normalizePostingMode(source.postingMode);
  const match = xeroDocumentId ? matchedXeroLines(source.lines, current?.lineItems || []) : null;
  if (match?.blockers.length) throw safetyError(match.blockers.join(' '), 'XERO_FINANCIAL_LINE_IDENTITY_UNSAFE');
  const common = { ...(current?.unowned || {}), Contact: { ContactID: source.contactId }, Date: source.invoiceDate,
    DueDate: source.dueDate || source.invoiceDate, Reference: source.reference, CurrencyCode: source.currency,
    LineAmountTypes: 'NoTax', Status: mode === 'authorised' ? 'AUTHORISED' : currentStatus || 'DRAFT',
    LineItems: match?.lines || source.lines.map((line) => ({ Description: line.description, Quantity: line.quantity,
      UnitAmount: line.unitAmount, AccountCode: line.accountCode, TaxType: line.taxType || 'NONE' })) };
  if (source.xeroCollection === 'CreditNotes') {
    const { DueDate: _dueDate, ...credit } = common;
    return { ...(xeroDocumentId ? { CreditNoteID: xeroDocumentId } : {}), ...credit, Type: source.xeroType, CreditNoteNumber: source.documentNumber };
  }
  return { ...(xeroDocumentId ? { InvoiceID: xeroDocumentId } : {}), ...common, Type: source.xeroType, InvoiceNumber: source.documentNumber };
}

export function unownedXeroMetadata(row) {
  return Object.fromEntries(['Url', 'BrandingThemeID', 'CurrencyRate', 'SentToContact', 'ExpectedPaymentDate', 'PlannedPaymentDate'].filter((key) => row[key] !== undefined).map((key) => [key, row[key]]));
}

function documentResponseKeys(row) {
  return row.source_payload?.xeroCollection === 'CreditNotes'
    ? { id: 'CreditNoteID', number: 'CreditNoteNumber' } : { id: 'InvoiceID', number: 'InvoiceNumber' };
}

// The provider may reorder a batch. A successful response must identify exactly one reviewed row.
export function matchDocumentResponses(rows, responses) {
  const returned = Array.isArray(responses) ? responses.filter((row) => row && typeof row === 'object') : [];
  const matches = rows.map((row) => {
    const keys = documentResponseKeys(row); const payload = row.proposed_payload || {};
    const expectedId = payload[keys.id] || row.xero_document_id;
    return returned.filter((response) => expectedId ? response[keys.id] === expectedId
      : response.Type === payload.Type && response.Contact?.ContactID === payload.Contact?.ContactID
        && response[keys.number] === payload[keys.number]);
  });
  return matches.map((candidates, index) => {
    const response = candidates[0]; const keys = documentResponseKeys(rows[index]);
    const ambiguous = candidates.length !== 1 || matches.filter((items) => items.includes(response)).length !== 1
      || returned.filter((item) => item[keys.id] === response?.[keys.id]).length !== 1;
    return ambiguous ? { response: {}, errors: ['Xero did not return a unique accounting identity for this reviewed document. Refresh and review the returned transactions.'] }
      : { response, errors: [] };
  });
}

export function documentConfirmationErrors(row, response) {
  const errors = []; const keys = documentResponseKeys(row);
  const source = row.source_payload || {}; const payload = row.proposed_payload || {};
  const id = response[keys.id]; const expectedId = payload[keys.id] || row.xero_document_id;
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) errors.push('Xero did not confirm a valid transaction ID.');
  if ((row.proposed_action === 'safe_update' && !expectedId) || (expectedId && id !== expectedId)) errors.push('Xero did not confirm the exact reviewed transaction ID.');
  for (const [field, actual, expected] of [
    ['accounting status', response.Status, payload.Status], ['transaction type', response.Type, source.xeroType],
    ['Contact', response.Contact?.ContactID, source.contactId], ['currency', response.CurrencyCode, source.currency],
    ['document number', response[keys.number], source.documentNumber],
  ]) if (typeof actual !== 'string' || !actual || !expected || actual !== expected) errors.push(`Xero did not confirm the reviewed ${field}.`);
  if (typeof response.Total !== 'number' || !Number.isFinite(response.Total) || !Number.isFinite(source.total) || !moneyEqual(response.Total, source.total)) errors.push('Xero did not confirm the reviewed document total.');
  if (response.HasErrors === true || (response.ValidationErrors !== undefined && !Array.isArray(response.ValidationErrors))) errors.push('Xero reported an unconfirmed transaction result.');
  return errors;
}

function safetyError(message, code, status = 409) { return Object.assign(new Error(message), { code, status }); }
