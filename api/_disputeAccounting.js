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

// This shortcut is deliberately narrower than Finance's manual Not Required option.
export function zeroBalanceClosureEligibility(actions = [], parties = [], stem = {}, instructions = []) {
  const reasons = [];
  if (!actions.length || !parties.length) reasons.push('Select the disputed parties and record their closing outcomes.');
  if (instructions.some((row) => row.status !== 'Superseded')) reasons.push('Supplier instructions require Finance completion.');
  for (const party of parties) {
    for (const side of party.roles || []) {
      if (!actions.some((action) => action.party_id === party.id && action.party_side === side)) reasons.push(`Record the ${side} outcome for ${party.account_name}.`);
    }
  }
  for (const action of actions) {
    if (!['close_buyer_dispute', 'close_supplier_dispute'].includes(action.action_type)
      || Math.abs(Number(action.amount || 0)) >= 0.005
      || action.linked_agreed_compensation_id || action.close_reason !== 'Full payment received from buyer'
      || (action.action_type === 'close_supplier_dispute' && action.balance_payment_instruction !== 'No Balance Payment')) {
      reasons.push('Credits, recoveries, claims and outstanding obligations require Finance completion.');
      continue;
    }
    if (!disputeNotRequiredEligibility(action, parties, stem).eligible) reasons.push('Every affected balance must be verified as zero.');
  }
  return { eligible: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export function disputeAgreementSummary(actions = [], fallback = '') {
  const entries = actions.map((action) => [action.action_label || action.actionLabel,
    action.description || action.close_reason || action.closeReason].filter(Boolean).join(': ')).filter(Boolean);
  return entries.join('\n') || String(fallback || '').trim();
}
