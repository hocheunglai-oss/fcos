import { issuedSupplierCanonical as canonical, issuedSupplierSfId as sfId } from './_xeroIssuedSupplierPreservation.js';
import { validateGroupRemittanceBankEvidence } from './_xeroGroupRemittanceBankEvidence.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const name = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toUpperCase() : '';
const snapshot = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key] ?? null]));
export const durableGroupBankMarker = mapping => mapping && Object.hasOwn(mapping, 'bank_source_evidence')
  && (!object(mapping.bank_source_evidence) || Object.keys(mapping.bank_source_evidence).length > 0);
const mappingFor = (payment, context) => [...(context.existingBySalesforce?.values() || [])]
  .find(row => sfId(row.salesforce_payment_id) === sfId(payment.Id));

// The source proof is rebuilt on each preview. These local controls are separate
// from Salesforce membership and never convert the Group into the legal debtor.
export function prepareGroupRemittancePayment(payment, context) {
  const existing = mappingFor(payment, context);
  const marked = durableGroupBankMarker(existing);
  const supplied = Object.hasOwn(payment, '_groupBankEvidence');
  if (!supplied && !marked && !payment._groupBankEvidenceBlocker) return { payment, bankMapping: null };
  const hold = reason => ({ payment: { ...payment, _bankEvidenceBlocker: reason }, bankMapping: null });
  if (payment._groupBankEvidenceBlocker) return hold(payment._groupBankEvidenceBlocker);
  const verified = validateGroupRemittanceBankEvidence(payment, payment._groupBankEvidence);
  if (!verified.eligible) return hold('Complete current Group remittance bank-source evidence is missing or changed.');
  const proof = verified.evidence;
  if (marked) {
    const retained = existing.bank_source_evidence;
    const priorSelected = retained?.source?.allocations?.find(row => sfId(row.Id) === sfId(payment.Id));
    const previous = validateGroupRemittanceBankEvidence(priorSelected, retained);
    if (!previous.eligible || canonical(retained) !== canonical(proof)) return hold('The saved Group remittance bank-source evidence changed. Resolve the existing link before any further payment action.');
  } else if (existing) {
    return hold('The existing payment link has no reviewed Group bank-source evidence. Resolve its original identity before replacing the saved evidence.');
  }
  if (context.groupPaymentControlsComplete !== true || !Array.isArray(context.paymentMappings)
    || !(context.paymentPostingClaims instanceof Map)) return hold('Complete current payment mappings and posting claims are required for the Group remittance.');
  const parentId = proof.parentId;
  if (context.paymentMappings.some(row => sfId(row.salesforce_payment_id) === parentId)
    || [...context.paymentPostingClaims.keys()].some(id => sfId(id) === parentId)) {
    return hold('The Group remittance header has an existing payment mapping or posting claim. Resolve the original outcome before using its bank for an allocation.');
  }
  const bank = context.bankByName?.get(name(verified.derivedBank));
  const account = context.bankAccounts?.get(bank?.xero_bank_account_id);
  if (!bank?.id || bank.enabled !== true || !Number.isInteger(bank.revision) || bank.revision < 1
    || name(bank.salesforce_bank_name) !== name(verified.derivedBank)) return hold('The Group remittance bank needs a current approved bank mapping.');
  if (!account || account.Status !== 'ACTIVE' || account.Type !== 'BANK'
    || account.CurrencyCode !== proof.currency || context.organisation?.baseCurrency !== proof.currency) {
    return hold('The Group remittance requires the current active bank and organisation to use its verified currency.');
  }
  return { payment: { ...payment, Bank__c: verified.derivedBank, _bankEvidence: proof }, bankMapping: bank };
}

export function groupRemittanceRowEvidence(payment, row, bankMapping, context) {
  if (!payment._groupBankEvidence || !bankMapping || !payment._bankEvidence) return null;
  const mapping = context.documentMappingById?.get(row.documentMappingId);
  const proof = payment._bankEvidence;
  const selected = proof.source.allocations.find(item => item.Id === sfId(payment.Id));
  const inventory = proof.source.buyerDocumentInventories.find(item => item.stemId === selected.STEM__c);
  const invoices = inventory.records.filter(item => item.Proforma__c === false && item.Deprecated__c === false);
  const agrees = mapping && mapping.salesforce_object === 'Invoice__c' && mapping.xero_document_type === 'ACCREC'
    && invoices.length === 1 && sfId(mapping.salesforce_id) === invoices[0].Id
    && sfId(mapping.retained_differences?.accountId) === selected.Account__c
    && sfId(mapping.retained_differences?.stemId) === selected.STEM__c;
  return {
    bankSourceEvidence: proof, bankAccountId: bankMapping.xero_bank_account_id,
    bankMappingSnapshot: snapshot(bankMapping, ['id', 'salesforce_bank_name', 'xero_bank_account_id', 'revision', 'enabled']),
    ...(mapping ? { documentMappingSnapshot: snapshot(mapping, ['id', 'salesforce_object', 'salesforce_id', 'xero_document_id',
      'xero_document_type', 'xero_contact_id', 'source_fingerprint', 'retained_differences', 'protected_legacy']) } : {}),
    // Missing links already have their established Waiting blocker. A different
    // durable mapping is an identity conflict, never a fallback invoice choice.
    blocker: mapping && !agrees ? 'The Group allocation document mapping differs from its current unique buyer invoice or debtor identity.' : null,
  };
}
