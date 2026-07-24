export const FULL_PAYMENT_RECEIVED_REASON = 'Full payment received from buyer';
export const NO_BALANCE_PAYMENT_INSTRUCTION = 'No Balance Payment';
export const DISPUTE_ZERO_BALANCE_THRESHOLD = 0.005;

export function isExplicitZero(value) {
  if (value == null || value === '') return false;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) < DISPUTE_ZERO_BALANCE_THRESHOLD;
}

function finiteBalance(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function zeroBalanceNotRequiredEligibility({
  actionType,
  buyerReceivableBalance,
  supplierPayableBalance,
  partyAccountId = null,
} = {}) {
  const balanceType = actionType === 'close_buyer_dispute'
    ? 'buyer_receivable'
    : actionType === 'close_supplier_dispute'
      ? 'supplier_payable'
      : null;
  const balanceLabel = balanceType === 'buyer_receivable'
    ? 'buyer receivable'
    : balanceType === 'supplier_payable'
      ? 'supplier payable'
      : null;
  const balance = finiteBalance(
    balanceType === 'buyer_receivable'
      ? buyerReceivableBalance
      : balanceType === 'supplier_payable'
        ? supplierPayableBalance
        : null
  );

  return {
    eligible: balanceType != null && isExplicitZero(balance),
    balance,
    balanceType,
    balanceLabel,
    partyAccountId: partyAccountId || null,
  };
}

export function disputeClosureDefaults({
  actionType,
  buyerReceivableBalance,
  supplierPayableBalance,
} = {}) {
  const isBuyerOrSupplierClosure = actionType === 'close_buyer_dispute'
    || actionType === 'close_supplier_dispute';

  return {
    closeReason: isBuyerOrSupplierClosure && isExplicitZero(buyerReceivableBalance)
      ? FULL_PAYMENT_RECEIVED_REASON
      : '',
    balancePaymentInstruction: actionType === 'close_supplier_dispute'
      && isExplicitZero(supplierPayableBalance)
      ? NO_BALANCE_PAYMENT_INSTRUCTION
      : '',
  };
}
