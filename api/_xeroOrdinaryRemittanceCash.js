import { validatedGroupPaymentRow } from './_xeroGroupPaymentPersistence.js';
import { createHash } from 'node:crypto';
import { issuedSupplierCanonical as canonical, issuedSupplierSfId as sfId } from './_xeroIssuedSupplierPreservation.js';
import { evaluateRemittanceSummary } from './_xeroRemittanceSummary.js';
import { resolveRemittanceBankEvidence } from './_xeroPaymentBankEvidence.js';

const POLICY = 'ordinary_remittance_cash_family_v1';
const blank = value => value == null || (typeof value === 'string' && !value.trim());
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const paymentId = value => sfId(value)?.startsWith('a0S') ? sfId(value) : null;
const name = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toUpperCase() : '';
const issue = blocker => ({ eligible: false, evidence: null, blocker });
const reference = payment => String(payment.Reference__c || payment.Name || '');
export const ordinaryRemittanceReviewFingerprint = (review, evidence) => hash({ review, ordinaryRemittanceCashEvidence: evidence });

// Reuse the deleted-inclusive, all-years inventory. No new provider read, no
// family invented for an allocation without Remittance__c, and no header hold
// propagated into an existing link or the independently reviewed Group path.
export function enrichOrdinaryRemittanceFamilies(payments, inventory) {
  const parents = new Map(); const families = new Map(); let complete = inventory?.complete === true;
  for (const parent of inventory?.parents || []) {
    const key = paymentId(parent?.Id);
    if (!key || parents.has(key)) complete = false;
    parents.set(key, parent);
  }
  for (const child of inventory?.siblings || []) {
    const key = paymentId(child?.Remittance__c);
    families.set(key, [...(families.get(key) || []), child]);
  }
  const sources = new Map([...parents].map(([key, parent]) => [key,
    { complete, parent: structuredClone(parent), siblings: structuredClone(families.get(key) || []) }]));
  return payments.map(payment => {
    const { _ordinaryRemittanceFamily: _old, ...raw } = payment;
    if (!['Receivable', 'Payable'].includes(payment.RecordType?.DeveloperName) || blank(payment.Remittance__c)) return raw;
    return { ...raw, _ordinaryRemittanceFamily: sources.get(paymentId(payment.Remittance__c)) || { complete: false } };
  });
}

function cashEvidence(payment) {
  try {
    const parentId = paymentId(payment.Remittance__c); const selectedId = paymentId(payment.Id);
    if (!parentId || !selectedId) return issue('The ordinary remittance parent or allocation identity is invalid.');
    const source = payment._ordinaryRemittanceFamily;
    if (source?.complete !== true || !Array.isArray(source.siblings)) return issue('Complete deleted-inclusive all-years ordinary remittance parent and sibling evidence is required.');
    if (!source.parent || paymentId(source.parent.Id) !== parentId) return issue('The exact ordinary remittance parent is missing or changed.');
    if ([source.parent, ...source.siblings].some(row => row?.IsDeleted !== false)) return issue('The ordinary remittance family contains deleted or unknown deletion evidence.');
    if ([source.parent, ...source.siblings].some(row => Number(row.Amount__c) <= 0)) return issue('The ordinary remittance family contains a refund, zero or negative amount; signed or non-cash adjustments require Finance review.');
    const selected = source.siblings.filter(row => paymentId(row.Id) === selectedId);
    if (selected.length !== 1) return issue('The ordinary payment must occur exactly once in its complete remittance family.');
    let current = payment;
    // Ordinary receivables may already have the existing, verified bank fallback.
    // Rebuild that exact fallback from the raw family before comparing raw facts.
    if (blank(selected[0].Bank__c) && !blank(payment.Bank__c)) {
      const rebuilt = resolveRemittanceBankEvidence(selected[0], { parent: source.parent, siblings: source.siblings, complete: true });
      if (rebuilt.reason || !rebuilt.payment._bankEvidence || canonical(rebuilt.payment._bankEvidence) !== canonical(payment._bankEvidence)
        || payment.Bank__c !== rebuilt.payment.Bank__c) return issue('The derived ordinary remittance bank proof is missing or changed.');
      current = { ...payment, Bank__c: selected[0].Bank__c };
    }
    const evaluated = evaluateRemittanceSummary(source.parent, { siblings: source.siblings,
      visiblePayments: [source.parent, ...source.siblings.map(row => paymentId(row.Id) === selectedId ? current : row)],
      complete: true, headerUnmapped: true });
    if (!evaluated.eligible) return issue(evaluated.blocker);
    const basis = { policyVersion: POLICY, complete: true, paymentId: selectedId, parentId,
      family: evaluated.evidence, source: structuredClone(source), bankEvidence: payment._bankEvidence || null };
    return { eligible: true, evidence: { ...basis, fingerprint: hash(basis) }, blocker: null };
  } catch { return issue('The ordinary remittance cash-family evidence is malformed or incomplete.'); }
}

export function guardNewOrdinaryRemittancePayment(row, payment, context) {
  if (row.action !== 'payment_apply' || row.status !== 'eligible' || Object.hasOwn(row, 'bankSourceEvidence') || blank(payment.Remittance__c)) return row;
  const result = cashEvidence(payment); const parentId = paymentId(payment.Remittance__c);
  const controlsComplete = context.paymentPostingClaims instanceof Map && context.existingBySalesforce instanceof Map;
  const parentReserved = controlsComplete && ([...context.existingBySalesforce.values()].some(mapping => sfId(mapping.salesforce_payment_id) === parentId)
    || [...context.paymentPostingClaims.keys()].some(key => sfId(key) === parentId));
  const blocker = !result.eligible ? result.blocker : !controlsComplete ? 'Complete current remittance header mapping and posting-claim controls are required.'
    : parentReserved ? 'The ordinary remittance header already has a payment mapping or posting claim. Resolve its existing cash outcome before posting a child.' : null;
  if (blocker) return { ...row, action: 'blocked', status: 'blocked', proposedPayment: null,
    blockers: [...row.blockers, blocker], blockerCodes: [...row.blockerCodes, 'remittance_cash_family_invalid'],
    reviewFingerprint: ordinaryRemittanceReviewFingerprint(row.reviewFingerprint, { source: payment._ordinaryRemittanceFamily || null, blocker }) };
  return { ...row, ordinaryRemittanceParentId: parentId, ordinaryRemittanceCashEvidence: result.evidence,
    ordinaryRemittanceReviewBase: row.reviewFingerprint,
    reviewFingerprint: ordinaryRemittanceReviewFingerprint(row.reviewFingerprint, result.evidence) };
}

// Preflight the whole new posting batch before creating any intent/audit or POST.
// Existing confirmed/link/recovery claims never pass through this new boundary.
export function assertOrdinaryRemittancePostingRow(row) {
  const fail = () => { throw Object.assign(new Error('Complete unchanged ordinary remittance cash-family review evidence is required before a new payment intent or POST.'),
    { code: 'XERO_ORDINARY_REMITTANCE_REVIEW_CHANGED', status: 409 }); };
  const marked = ['ordinaryRemittanceParentId', 'ordinaryRemittanceCashEvidence', 'ordinaryRemittanceReviewBase'].some(key => Object.hasOwn(row, key));
  if (Object.hasOwn(row, 'bankSourceEvidence')) {
    if (marked) return fail();
    validatedGroupPaymentRow(row);
    return;
  }
  if (!marked) return;
  try {
    const proof = row.ordinaryRemittanceCashEvidence;
    if (!proof || proof.policyVersion !== POLICY || row.action !== 'payment_apply' || row.status !== 'eligible'
      || row.blockers?.length || !/^[a-f0-9]{64}$/.test(row.ordinaryRemittanceReviewBase || '')
      || row.ordinaryRemittanceParentId !== proof.parentId || paymentId(row.salesforcePaymentId) !== proof.paymentId) return fail();
    const selected = proof.source?.siblings?.filter(payment => paymentId(payment.Id) === proof.paymentId);
    if (selected?.length !== 1) return fail();
    const payment = { ...selected[0], Bank__c: row.bank, _bankEvidence: proof.bankEvidence,
      _ordinaryRemittanceFamily: proof.source };
    const rebuilt = cashEvidence(payment);
    if (!rebuilt.eligible || canonical(rebuilt.evidence) !== canonical(proof)
      || row.reviewFingerprint !== ordinaryRemittanceReviewFingerprint(row.ordinaryRemittanceReviewBase, proof)
      || row.type !== selected[0].RecordType?.DeveloperName || row.amount !== Number(selected[0].Amount__c)
      || row.paymentDate !== selected[0].Date__c || row.currency !== proof.family.currency
      || row.salesforcePaymentName !== selected[0].Name || sfId(row.supplierInvoiceId) !== sfId(selected[0].Supplier_Invoice__c)
      || sfId(row.stemId) !== sfId(selected[0].STEM__c) || name(row.bank) !== name(proof.source.parent.Bank__c)
      || row.proposedPayment?.Amount !== row.amount || row.proposedPayment?.Date !== row.paymentDate
      || row.proposedPayment?.Reference !== reference(selected[0]) || row.proposedPayment?.Invoice?.InvoiceID !== row.xeroDocumentId
      || row.proposedPayment?.Account?.AccountID !== row.bankAccountId) return fail();
  } catch { return fail(); }
}
