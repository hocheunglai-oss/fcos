import { zeroBalanceNotRequiredEligibility } from '../src/lib/disputeWorkflowDefaults.js';
import { disputeSalesforceIdKey } from './_disputeParties.js';

function finiteBalance(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function verifiedDisputeSupplierPayableBalance(currentStem, supplierAccountId) {
  const accountKey = disputeSalesforceIdKey(supplierAccountId);
  if (!accountKey) return null;
  const invoices = (currentStem?._Supplier_Invoice_Exposure_Rows || [])
    .filter((invoice) => disputeSalesforceIdKey(invoice.supplierAccountId) === accountKey);
  if (!invoices.length || invoices.some((invoice) => (
    invoice.payableBalanceAvailable !== true
    || finiteBalance(invoice.rawPayableBalance) == null
    || Number(invoice.rawPayableBalance) < -0.005
  ))) {
    return null;
  }
  return invoices.reduce((sum, invoice) => sum + Number(invoice.rawPayableBalance), 0);
}

export function disputeNotRequiredEligibility(action, partyRows, currentStem) {
  const party = (partyRows || []).find((row) => row.id === action?.party_id) || null;
  const partyAccountId = party?.account_id || null;
  return zeroBalanceNotRequiredEligibility({
    actionType: action?.action_type,
    buyerReceivableBalance: currentStem?._Buyer_Finance_Row?.receivableBalance
      ?? currentStem?.Receivable_Balance__c
      ?? null,
    supplierPayableBalance: verifiedDisputeSupplierPayableBalance(currentStem, partyAccountId),
    partyAccountId,
  });
}
