import { createHash } from 'node:crypto';
import { isIssuedFinalBuyerInvoice } from './_buyerInvoiceApproval.js';

export const NOM_B_FROM = '2026-09-01';
export const NOM_B_ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
export const NOM_B_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const text = (value) => String(value ?? '').trim();
const email = (value) => text(value).toLowerCase();
const name = (value) => text(value).replace(/\s+/g, ' ').toLowerCase();
export const nomBError = (message, status = 400, code = 'NOM_B_INVALID') => Object.assign(new Error(message), { status, code, expose: true });
export function nomBDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text(value))) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}
export function nomBToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function nomBDelivery(stem) {
  const actual = text(stem.Delivery_Date__c); const expected = text(stem.Expected_Delivery_Date__c);
  const source = actual ? 'actual' : expected ? 'expected' : null;
  const date = nomBDate(actual || expected);
  return { date, source, undated: !source, invalid: Boolean(source && !date), inScope: !source || Boolean(date && date >= NOM_B_FROM) };
}
export function activeNomBConfirmation(row) {
  return row?.IsDeleted !== true && row?.Deprecated__c === false && row?.Replaced__c === false
    && row?.RecordType?.DeveloperName === 'Buyer';
}
export function resolveNomBTrader(confirmation, profiles, salesforceUsers = []) {
  const traderName = text(confirmation.Buyer_Supplier_Trader__c);
  const formulaEmail = email(confirmation.BT_ST_Email_Address__c);
  const users = salesforceUsers.filter((user) => user.IsActive === true && name(user.Name) === name(traderName));
  const emails = [...new Set([formulaEmail, ...users.map((user) => email(user.Email))].filter(Boolean))];
  // Conflicting formula/User identities are not resolved by choosing the first match.
  const candidates = profiles.filter((profile) => profile.active === true && emails.includes(email(profile.email))
    && (name(profile.full_name) === name(traderName) || (users.length === 1 && email(users[0].Email) === email(profile.email))));
  if (emails.length === 1 && candidates.length === 1) return { id: candidates[0].id, name: candidates[0].full_name || traderName, email: candidates[0].email, resolved: true };
  return { id: null, name: traderName || 'Unassigned', email: formulaEmail || null, resolved: false,
    reason: emails.length > 1 || candidates.length > 1 ? 'Buyer Trader identity is ambiguous.' : 'Buyer Trader does not resolve to one active FCOS profile by verified email.' };
}
export function isNomBFile(link, confirmation, stem) {
  const document = link?.ContentDocument;
  if (link?.LinkedEntityId !== confirmation.Id || !document || document.IsDeleted !== false
    || !NOM_B_ID.test(document.Id || '') || !NOM_B_ID.test(document.LatestPublishedVersionId || '')
    || !(Number(document.ContentSize) > 0)) return false;
  // Salesforce names uploads "<STEM name> - NOM B". The mutable vessel/port
  // portion may later change, so bind the stable reference and exact document
  // marker, in addition to the authoritative confirmation link.
  const title = text(document.Title).replace(/\.(?:pdf|docx?|eml|msg|jpe?g|png|tiff?)$/i, '');
  const reference = text(stem.RefCode__c || text(stem.Name).split(' - ')[0]);
  if (!reference || !title.toUpperCase().startsWith(`${reference.toUpperCase()} - `) || !/ - NOM B(?: - [^\r\n]+)?$/i.test(title)) return false;
  const generated = [confirmation.File__c, confirmation.PDF__c].map(text).filter(Boolean);
  return !generated.some((value) => value === document.Id || value.includes(document.Id) || value.includes(document.LatestPublishedVersionId));
}
function decimal(value) {
  if (value == null || typeof value === 'boolean' || !/^-?\d+(?:\.\d+)?$/.test(String(value))) return null;
  const raw = String(value); if (raw.length > 60) return null;
  const [whole, fraction = ''] = raw.replace(/^-/, '').split('.');
  if (fraction.length > 20) return null;
  return { n: BigInt(`${whole}${fraction}`) * (raw.startsWith('-') ? -1n : 1n), d: 10n ** BigInt(fraction.length) };
}
function roundedCents(n, d) {
  const negative = n < 0n; const a = (negative ? -n : n) * 100n;
  const cents = a / d + ((a % d) * 2n >= d ? 1n : 0n);
  return negative ? -cents : cents;
}
function money(cents) {
  const negative = cents < 0n; const value = negative ? -cents : cents;
  return `${negative ? '-' : ''}${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}
export function nomBReceivable(stem, invoices, currencyEvidence, rates, asOfDate, complete = true) {
  const original = stem.Receivable_Balance__c;
  const currency = stem.CurrencyIsoCode ?? (currencyEvidence?.singleCurrency === true ? currencyEvidence.corporateCurrency : null);
  const result = { amount: original == null ? null : String(original), currency: currency || null, usdEquivalent: null,
    rate: null, rateDate: null, rateSource: 'Salesforce company accounting rate', invoiceIds: [], invoiceEvidence: [], evidenceStatus: 'unavailable', eligible: false };
  if (!complete) return { ...result, reason: 'Receivable or invoice evidence could not be completely read.' };
  const finals = invoices.filter((invoice) => invoice.STEM__c === stem.Id && invoice.IsDeleted !== true
    && invoice.Proforma__c === false && invoice.Deprecated__c === false && isIssuedFinalBuyerInvoice(invoice));
  result.invoiceIds = finals.map((invoice) => invoice.Id).sort();
  result.invoiceEvidence = finals.map((invoice) => ({ id: invoice.Id, name: invoice.Name, file: invoice.File__c, invoiceDate: invoice.Invoice_Date__c || null,
    proforma: invoice.Proforma__c, deprecated: invoice.Deprecated__c, lastModifiedAt: invoice.LastModifiedDate || null })).sort((a, b) => a.id.localeCompare(b.id));
  if (!finals.length) return { ...result, evidenceStatus: 'verified', reason: 'No active issued final buyer invoice.' };
  if (!currencyEvidence || !/^[A-Z]{3}$/.test(currencyEvidence.corporateCurrency || '')) return { ...result, reason: 'Salesforce company currency evidence is unavailable.' };
  const amount = decimal(original);
  if (!amount) return { ...result, reason: 'Salesforce receivable balance is missing or invalid.' };
  if (!/^[A-Z]{3}$/.test(currency || '')) return { ...result, reason: 'Verified receivable currency is missing or invalid.' };
  let numerator = 1n; let denominator = 1n; let rateDate = asOfDate;
  if (currency !== 'USD') {
    if (!/^[A-Z]{3}$/.test(currencyEvidence?.corporateCurrency || '')) return { ...result, reason: 'Salesforce corporate currency is unavailable.' };
    const matching = (code) => code === currencyEvidence.corporateCurrency
      ? [{ ConversionRate: '1', StartDate: asOfDate }]
      : (rates || []).filter((rate) => rate.IsoCode === code && rate.IsActive !== false
        && nomBDate(rate.StartDate) && rate.StartDate <= asOfDate && (!rate.NextStartDate || rate.NextStartDate > asOfDate));
    const source = matching(currency); const target = matching('USD');
    if (source.length !== 1 || target.length !== 1) return { ...result, reason: 'An unambiguous Salesforce accounting rate effective today is unavailable.' };
    const from = decimal(source[0].ConversionRate); const to = decimal(target[0].ConversionRate);
    if (!from || !to || from.n <= 0n || to.n <= 0n) return { ...result, reason: 'Salesforce accounting rate is invalid.' };
    numerator = to.n * from.d; denominator = to.d * from.n;
    rateDate = [currency !== currencyEvidence.corporateCurrency ? source[0].StartDate : null,
      currencyEvidence.corporateCurrency !== 'USD' ? target[0].StartDate : null].filter(Boolean).sort().at(-1);
  }
  const cents = roundedCents(amount.n * numerator, amount.d * denominator);
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < -BigInt(Number.MAX_SAFE_INTEGER)) return { ...result, reason: 'Receivable balance is outside the supported range.' };
  return { ...result, usdEquivalent: money(cents), rate: currency === 'USD' ? '1' : `${numerator}/${denominator}`, rateDate,
    evidenceStatus: 'verified', eligible: cents < 10000n, reason: cents < 10000n ? 'Receivable below USD 100' : 'Receivable is USD 100 or more.' };
}
export function nomBPolicy(row) {
  return { mode: row?.mode || 'automatic', reasonCode: row?.reason_code || null, reasonText: row?.reason_text || '', revision: Number(row?.revision || 0),
    updatedAt: row?.updated_at || null, updatedBy: row?.updated_by_name || row?.updated_by_email || null };
}
export function validateNomBPolicy(body) {
  if (!NOM_B_ID.test(body?.stemId || '')) throw nomBError('Choose a valid STEM.');
  if (!['automatic', 'waive', 'require'].includes(body.mode)) throw nomBError('Choose Automatic, Waive, or Require Nom B.');
  if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) throw nomBError('Refresh this STEM before saving.', 409, 'NOM_B_REVISION_CONFLICT');
  const reasonText = text(body.reasonText);
  if (reasonText.length > 1000) throw nomBError('The reason must contain at most 1,000 characters.');
  const reasonCode = body.mode === 'automatic' ? null : body.reasonCode || (body.mode === 'waive' ? 'payment_received' : 'other');
  if (reasonCode && !['payment_received', 'management_exception', 'other'].includes(reasonCode)) throw nomBError('Choose a valid reason.');
  if ((body.mode === 'require' || reasonCode === 'other') && !reasonText) throw nomBError('An explanation is required.');
  return { stemId: body.stemId, mode: body.mode, reasonCode, reasonText: body.mode === 'automatic' ? '' : reasonText, expectedRevision: body.expectedRevision };
}
export function evaluateNomB({ stem, confirmations, links, profiles, salesforceUsers, invoices, currencyEvidence, rates, policy: storedPolicy, asOfDate, documentsComplete = true, invoicesComplete = true }) {
  const delivery = nomBDelivery(stem); const policy = nomBPolicy(storedPolicy);
  const active = confirmations.filter((row) => row.STEM__c === stem.Id && activeNomBConfirmation(row));
  const details = active.map((confirmation) => {
    const documents = links.filter((link) => isNomBFile(link, confirmation, stem)).map((link) => ({ id: link.ContentDocument.Id, title: link.ContentDocument.Title,
      versionId: link.ContentDocument.LatestPublishedVersionId, size: link.ContentDocument.ContentSize }));
    return { id: confirmation.Id, name: confirmation.Name, trader: resolveNomBTrader(confirmation, profiles, salesforceUsers), documents,
      status: !documentsComplete ? 'unable_to_verify' : documents.length ? 'filed' : 'missing' };
  });
  const receivable = nomBReceivable(stem, invoices, currencyEvidence, rates, asOfDate, invoicesComplete);
  let status = 'missing'; let waiverType = null; let reason = 'Buyer Nomination document has not been filed.';
  if (details.length && details.every((row) => row.status === 'filed')) { status = 'filed'; reason = 'All active Buyer Confirmations have a filed Nom B.'; }
  else if (policy.mode === 'waive') { status = 'waived'; waiverType = 'manual'; reason = ({ payment_received: 'Payment Received', management_exception: 'Management Exception', other: policy.reasonText })[policy.reasonCode]; }
  else if (!documentsComplete || !details.length || details.some((row) => !row.trader.resolved) || delivery.invalid) {
    status = 'unable_to_verify'; reason = !documentsComplete ? 'Buyer Nomination files could not be completely read.' : !details.length ? 'No active Buyer Confirmation is available.' : delivery.invalid ? 'Delivery date is invalid.' : 'Buyer Trader assignment requires manager review.';
  } else if (policy.mode === 'require') { reason = `Management requires Nom B: ${policy.reasonText}`; }
  else if (receivable.evidenceStatus !== 'verified') { status = 'unable_to_verify'; reason = receivable.reason; }
  else if (receivable.eligible) { status = 'waived'; waiverType = 'automatic'; reason = 'Receivable below USD 100'; }
  const evidence = { asOfDate, receivable, confirmations: details.map((row) => ({ id: row.id, status: row.status, traderId: row.trader.id, documents: row.documents })), sourceModifiedAt: stem.LastModifiedDate || null };
  return { stemId: stem.Id, stemReference: stem.Name, vessel: stem.Vessel__r?.Name || '', buyer: stem.Account__r?.Name || '', port: stem.Port__r?.Name || '',
    deliveryDate: delivery.date, deliveryDateSource: delivery.source, undated: delivery.undated, inScope: stem.Invoice_Status__c !== 'Cancelled' && stem.IsDeleted !== true && (delivery.inScope || delivery.invalid),
    traders: [...new Map(details.map((row) => [row.trader.id || row.trader.name, row.trader])).values()],
    confirmations: details.map((row) => ({ ...row, traderName: row.trader.name })), status, waiverType, reason, receivable, policy,
    evidence, evidenceFingerprint: createHash('sha256').update(JSON.stringify(evidence)).digest('hex') };
}
