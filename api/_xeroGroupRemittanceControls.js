import { issuedSupplierCanonical as canonical, issuedSupplierSfId as sfId } from './_xeroIssuedSupplierPreservation.js';
import { validateGroupRemittanceBankEvidence } from './_xeroGroupRemittanceBankEvidence.js';
import { validatedGroupPaymentRow } from './_xeroGroupPaymentPersistence.js';
import { paymentPostingKey } from './_xeroPaymentPosting.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const name = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toUpperCase() : '';
const snapshot = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key] ?? null]));
export const durableGroupBankMarker = mapping => mapping && Object.hasOwn(mapping, 'bank_source_evidence')
  && (!object(mapping.bank_source_evidence) || Object.keys(mapping.bank_source_evidence).length > 0);
const mappingFor = (payment, context) => [...(context.existingBySalesforce?.values() || [])]
  .find(row => sfId(row.salesforce_payment_id) === sfId(payment.Id));

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function accountTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)$/.test(value)) return null;
  const day = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value.slice(0, 10) ? timestamp : null;
}

// A completed receipt keeps its original proof. Only independently validated,
// monotonic Account timestamps may be rebound as separate current review evidence.
function completedAccountTimestampRevalidation(payment, existing, retained, current, context) {
  try {
    if (context.groupPaymentControlsComplete !== true || !Array.isArray(context.paymentMappings)
      || !(context.paymentPostingClaims instanceof Map) || !uuid(existing.id) || !uuid(existing.xero_payment_id)
      || existing.exception_reason != null || Object.keys(existing.retained_reference || {}).length) return null;
    const mappings = context.paymentMappings.filter(row => sfId(row.salesforce_payment_id) === sfId(payment.Id));
    const claims = [...context.paymentPostingClaims.entries()].filter(([key]) => sfId(key) === sfId(payment.Id)).map(([, claim]) => claim);
    const claim = claims[0]; const saved = claim?.control_totals?.paymentPosting; const reviewed = saved?.reviewed;
    if (mappings.length !== 1 || canonical(mappings[0]) !== canonical(existing) || !claims.length
      || claims.some(value => canonical(value) !== canonical(claim)) || !uuid(claim?.id) || claim.status !== 'completed'
      || claim.mode !== 'payment_apply' || !['confirmed', 'group_linked'].includes(saved?.state)
      || existing.status !== (saved.state === 'confirmed' ? 'applied' : 'linked')
      || saved.tenantId !== context.tenantId || sfId(saved.paymentId) !== sfId(payment.Id)
      || claim.idempotency_key !== paymentPostingKey(context.tenantId, payment.Id)
      || saved.confirmedPaymentId !== existing.xero_payment_id
      || !Array.isArray(saved.observedPaymentIds) || saved.observedPaymentIds.length !== 1
      || saved.observedPaymentIds[0] !== existing.xero_payment_id
      || claim.source_fingerprint !== existing.source_fingerprint || reviewed?.sourceFingerprint !== existing.source_fingerprint
      || canonical(reviewed?.bankSourceEvidence) !== canonical(retained)
      || (Object.hasOwn(reviewed, 'bankEvidence') && canonical(reviewed.bankEvidence) !== canonical(retained))) return null;
    const checked = validatedGroupPaymentRow(reviewed);
    if (sfId(checked.salesforcePaymentId) !== sfId(payment.Id) || checked.documentMappingId !== existing.document_mapping_id
      || checked.bankAccountId !== existing.xero_bank_account_id || checked.currency !== existing.currency
      || checked.paymentDate !== existing.payment_date || checked.salesforcePaymentName !== existing.salesforce_payment_name
      || typeof existing.amount !== 'number' || !Number.isFinite(existing.amount)
      || Math.abs(existing.amount - checked.amount) >= 0.0000001
      || (saved.state === 'group_linked' && checked.xeroPaymentId !== existing.xero_payment_id)) return null;
    const bank = context.bankByName?.get(name(current.bank));
    const document = context.documentMappingById?.get(existing.document_mapping_id);
    if (!bank || !document || canonical(snapshot(bank, Object.keys(checked.bankMappingSnapshot))) !== canonical(checked.bankMappingSnapshot)
      || canonical(snapshot(document, Object.keys(checked.documentMappingSnapshot))) !== canonical(checked.documentMappingSnapshot)) return null;
    const before = structuredClone(retained); const after = structuredClone(current); const changedAccounts = [];
    delete before.fingerprint; delete after.fingerprint; delete before.membershipFingerprint; delete after.membershipFingerprint;
    if (before.source.accounts.length !== after.source.accounts.length) return null;
    for (let index = 0; index < before.source.accounts.length; index += 1) {
      const oldAccount = before.source.accounts[index]; const newAccount = after.source.accounts[index];
      const oldTime = accountTimestamp(oldAccount.LastModifiedDate); const newTime = accountTimestamp(newAccount.LastModifiedDate);
      if (oldTime === null || newTime === null || newTime < oldTime) return null;
      if (oldAccount.LastModifiedDate !== newAccount.LastModifiedDate) changedAccounts.push({ accountId: oldAccount.Id,
        accountName: oldAccount.Name, before: oldAccount.LastModifiedDate, after: newAccount.LastModifiedDate });
      delete oldAccount.LastModifiedDate; delete newAccount.LastModifiedDate;
    }
    if (!changedAccounts.length || canonical(before) !== canonical(after)) return null;
    return { policyVersion: 'completed_group_account_timestamp_revalidation_v1', claimId: claim.id, mappingId: existing.id,
      retainedSourceFingerprint: existing.source_fingerprint, retainedProofFingerprint: retained.fingerprint,
      currentProofFingerprint: current.fingerprint, changedAccounts, currentBankSourceEvidence: current };
  } catch { return null; }
}

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
  let stableProof = proof; let revalidation = null;
  if (marked) {
    const retained = existing.bank_source_evidence;
    const priorSelected = retained?.source?.allocations?.find(row => sfId(row.Id) === sfId(payment.Id));
    const previous = validateGroupRemittanceBankEvidence(priorSelected, retained);
    if (!previous.eligible) return hold('The saved Group remittance bank-source evidence changed. Resolve the existing link before any further payment action.');
    if (canonical(retained) !== canonical(proof)) {
      revalidation = completedAccountTimestampRevalidation(payment, existing, retained, proof, context);
      if (!revalidation) return hold('The saved Group remittance bank-source evidence changed. Resolve the existing link before any further payment action.');
      stableProof = retained;
    }
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
  const prepared = { ...payment, Bank__c: verified.derivedBank, _bankEvidence: stableProof };
  delete prepared._groupBankSourceRevalidation;
  if (revalidation) prepared._groupBankSourceRevalidation = revalidation;
  return { payment: prepared, bankMapping: bank };
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
    ...(payment._groupBankSourceRevalidation ? { groupBankSourceRevalidation: payment._groupBankSourceRevalidation } : {}),
    bankMappingSnapshot: snapshot(bankMapping, ['id', 'salesforce_bank_name', 'xero_bank_account_id', 'revision', 'enabled']),
    ...(mapping ? { documentMappingSnapshot: snapshot(mapping, ['id', 'salesforce_object', 'salesforce_id', 'xero_document_id',
      'xero_document_type', 'xero_contact_id', 'source_fingerprint', 'retained_differences', 'protected_legacy']) } : {}),
    // Missing links already have their established Waiting blocker. A different
    // durable mapping is an identity conflict, never a fallback invoice choice.
    blocker: mapping && !agrees ? 'The Group allocation document mapping differs from its current unique buyer invoice or debtor identity.' : null,
  };
}
