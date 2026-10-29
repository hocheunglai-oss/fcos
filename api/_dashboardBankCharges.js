import { validateBankChargesUsd } from './_dashboardFinanceSettings.js';

const idKey = (value) => String(value || '').slice(0, 15);
const token = (value) => String(value || '').toLowerCase().replace(/[^a-z]/g, '');
const cents = (value) => {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const result = Math.round(Number(value) * 100);
  return Number.isSafeInteger(result) ? result : null;
};
const validDate = (value, asOfDate) => /^\d{4}-\d{2}-\d{2}$/.test(value || '')
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value && value <= asOfDate;
const excluded = (payment) => payment.isRemittance || token(payment.type).includes('remittance')
  || /void|cancel|reject/i.test(payment.status || '') || payment.volumeDiscountId || payment.isVolumeDiscount
  || payment.isDeposit || payment.commissionInvoiceId || token(payment.type) === 'commission';
export const isSupplierRemittanceAllocation = (payment) => !excluded(payment) && token(payment.type) === 'payable' && cents(payment.amount) > 0;
const missing = (issue) => ({ complete: false, amountCents: null, issue });

/** Allocate a single wire's fee in cents across its full cash history, never the selected page. */
export function allocateRemittanceCharge(parent, allocations, bankChargesUsd, asOfDate) {
  const fees = validateBankChargesUsd(bankChargesUsd);
  if (!parent || token(parent.type) !== 'payableremittance' || /void|cancel|reject|revers/i.test(parent.status || '')
    || !/^[A-Z]{3}$/.test(parent.currency || '') || !validDate(parent.date, asOfDate) || !Object.hasOwn(fees, parent.bank) || cents(parent.amount) <= 0) {
    return missing('The supplier remittance bank, amount or actual payment date is unavailable.');
  }
  const all = new Map();
  for (const payment of allocations) {
    const key = idKey(payment.id);
    if (!key || (all.has(key) && JSON.stringify(all.get(key)) !== JSON.stringify(payment))) return missing('Remittance allocations have missing or conflicting identifiers.');
    all.set(key, payment);
  }
  const cash = []; let netCash = 0n;
  for (const payment of all.values()) {
    if (idKey(payment.remittanceId) !== idKey(parent.id)) return missing('Remittance allocation ownership cannot be reconciled.');
    if (excluded(payment)) continue;
    if (token(payment.type) !== 'payable' || cents(payment.amount) == null
      || (/revers/i.test(payment.status || '') && cents(payment.amount) >= 0) || !validDate(payment.date, asOfDate)
      || payment.currency !== parent.currency || (payment.bank && payment.bank !== parent.bank)) {
      return missing('The complete supplier remittance cash allocations cannot be reconciled.');
    }
    netCash += BigInt(cents(payment.amount));
    if (cents(payment.amount) > 0) cash.push(payment);
  }
  const total = cash.reduce((sum, payment) => sum + BigInt(cents(payment.amount)), 0n);
  const difference = BigInt(cents(parent.amount)) - netCash;
  if (!total || difference > 1n || difference < -1n) return missing('Supplier remittance allocations do not reconcile to the full transfer amount.');
  // Signed credits reconcile the net wire but do not incur an outgoing share.
  const fee = BigInt(cents(fees[parent.bank]));
  const shares = cash.map((payment) => {
    const numerator = fee * BigInt(cents(payment.amount));
    return { id: idKey(payment.id), value: numerator / total, remainder: numerator % total };
  });
  shares.sort((a, b) => a.remainder === b.remainder ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.remainder > b.remainder ? -1 : 1);
  let leftover = fee - shares.reduce((sum, share) => sum + share.value, 0n);
  for (const share of shares) if (leftover > 0n) { share.value += 1n; leftover -= 1n; }
  return { complete: true, allocations: new Map(shares.map((share) => [share.id, share.value])) };
}

function calculateSupplierBankCharge({ payments, groups, sourceComplete = true }, { bankChargesUsd, asOfDate, currency }) {
  const fees = validateBankChargesUsd(bankChargesUsd);
  const issues = []; const transfers = new Set(); const seen = new Map(); let total = 0n;
  for (const payment of payments) {
    const key = idKey(payment.id);
    if (seen.has(key)) {
      if (seen.get(key) !== JSON.stringify(payment)) issues.push('Duplicate supplier payment evidence disagrees.');
      continue;
    }
    seen.set(key, JSON.stringify(payment));
    if (payment.isDeposit && cents(payment.amount) !== 0 && token(payment.type) === 'payable') {
      issues.push('The bank charge for the original supplier deposit funding is unavailable.'); continue;
    }
    if (excluded(payment) || token(payment.type) !== 'payable') continue;
    const amount = cents(payment.amount);
    if (!key || amount == null || !validDate(payment.date, asOfDate) || (/revers/i.test(payment.status || '') && amount >= 0)) {
      issues.push('A supplier payment has incomplete actual remittance evidence.'); continue;
    }
    // Signed refunds are incoming cash and do not create another outgoing transfer.
    if (amount <= 0) continue;
    if (payment.remittanceId) {
      const group = groups.get(idKey(payment.remittanceId));
      if (!group?.complete || !group.allocations.has(key)) {
        issues.push(group?.issue || 'The full supplier remittance could not be loaded.'); continue;
      }
      total += group.allocations.get(key); transfers.add(idKey(payment.remittanceId));
    } else if (Object.hasOwn(fees, payment.bank)) {
      total += BigInt(cents(fees[payment.bank])); transfers.add(key);
    } else issues.push('The bank used for a supplier payment is unavailable or has no configured charge.');
  }
  if (!sourceComplete) issues.push('Supplier remittance evidence could not be loaded completely.');
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) issues.push('Bank charges exceed supported monetary precision.');
  const bankChargeUsd = issues.length ? null : Number(total) / 100;
  if (total > 0n && currency !== 'USD') issues.push('The USD bank charge cannot be converted to the STEM currency without verified exchange-rate evidence.');
  return { bankCharge: issues.length ? null : Number(total) / 100, bankChargeUsd,
    bankChargeComplete: issues.length === 0, bankChargeIssues: [...new Set(issues)], bankChargeTransferCount: transfers.size };
}

/** Recorded receipt fees settle the buyer invoice but are not additional cash receipts. */
export function calculateReceiptBankCharge({ payments, stemId, buyerAccountId, sourceComplete = true }, { asOfDate, currency }) {
  const issues = []; const seen = new Map(); let total = 0n; let count = 0;
  for (const payment of payments) {
    if (token(payment.type) !== 'bankcharge') continue;
    const key = idKey(payment.id); const signature = JSON.stringify(payment);
    if (seen.has(key)) {
      if (seen.get(key) !== signature) issues.push('Duplicate buyer receipt charge evidence disagrees.');
      continue;
    }
    seen.set(key, signature);
    if (/void|cancel|reject/i.test(payment.status || '')) continue;
    const amount = cents(payment.amount);
    if (!key || amount == null || !validDate(payment.date, asOfDate)
      || (/revers/i.test(payment.status || '') && amount >= 0)) {
      issues.push('A buyer receipt charge has an invalid amount, date or signed reversal.'); continue;
    }
    if (!stemId || idKey(payment.stemId) !== idKey(stemId) || !buyerAccountId || idKey(payment.accountId) !== idKey(buyerAccountId)
      || payment.supplierInvoiceId || excluded(payment)) {
      issues.push('A buyer receipt charge cannot be reconciled to this STEM and buyer.'); continue;
    }
    if (!/^[A-Z]{3}$/.test(currency || '') || payment.currency !== currency) {
      issues.push('A buyer receipt charge cannot be converted to the STEM currency without verified exchange-rate evidence.'); continue;
    }
    // Signed fee refunds reduce the recorded expense; never apply a supplier default here.
    total += BigInt(amount); count += amount !== 0 ? 1 : 0;
  }
  if (!sourceComplete) issues.push('Buyer receipt charge evidence could not be loaded completely.');
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < -BigInt(Number.MAX_SAFE_INTEGER)) issues.push('Buyer receipt charges exceed supported monetary precision.');
  return { receiptBankCharge: issues.length ? null : Number(total) / 100, receiptBankChargeCount: count,
    complete: issues.length === 0, issues: [...new Set(issues)] };
}

export function calculateStemBankCharge(source, context) {
  const supplier = calculateSupplierBankCharge(source, context);
  const receipt = calculateReceiptBankCharge(source, context);
  const issues = [...supplier.bankChargeIssues, ...receipt.issues];
  const total = supplier.bankChargeComplete && receipt.complete
    ? BigInt(cents(supplier.bankCharge)) + BigInt(cents(receipt.receiptBankCharge)) : null;
  if (total != null && (total > BigInt(Number.MAX_SAFE_INTEGER) || total < -BigInt(Number.MAX_SAFE_INTEGER))) issues.push('Bank charges exceed supported monetary precision.');
  const complete = issues.length === 0;
  return { ...supplier, bankCharge: complete ? Number(total) / 100 : null,
    bankChargeUsd: context.currency === 'USD' ? (complete ? Number(total) / 100 : null)
      : receipt.complete && receipt.receiptBankCharge === 0 ? supplier.bankChargeUsd : null,
    supplierBankChargeUsd: supplier.bankChargeUsd, receiptBankCharge: receipt.receiptBankCharge,
    receiptBankChargeCount: receipt.receiptBankChargeCount,
    bankChargeComplete: complete, bankChargeIssues: [...new Set(issues)] };
}

export function deductBankCharge(finance, bank) {
  const complete = finance.complete && bank.bankChargeComplete;
  const net = complete ? cents(finance.ebit) - cents(bank.bankCharge) : null;
  const safe = net == null || Number.isSafeInteger(net);
  return { ...finance, ...bank, ebit: complete && safe ? net / 100 : null, complete: complete && safe,
    status: complete && safe ? finance.status : 'unavailable',
    issues: [...new Set([...finance.issues, ...bank.bankChargeIssues, ...(safe ? [] : ['EBIT exceeds supported monetary precision.'])])] };
}
