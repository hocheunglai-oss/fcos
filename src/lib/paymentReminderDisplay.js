// Keep native reminder balances separate from their USD carrying equivalents.
// A raw CurrencyIsoCode alone is not enough: local fallback rows retain legacy
// USD semantics until the server has completed its native-currency review.
function finiteNumber(value) {
  return value != null && value !== '' && Number.isFinite(Number(value));
}

export function reminderCurrency(row = {}) {
  const currency = String(row.currency || 'USD').trim().toUpperCase();
  if (!['USD', 'HKD'].includes(currency)) return null;
  return row.reminderCurrencyVerified === true && currency === 'HKD'
    ? 'HKD'
    : 'USD';
}

export function reminderMoney(value, currency = 'USD', legacyUsd = false) {
  if (!finiteNumber(value)) return '-';
  if (!['USD', 'HKD'].includes(currency)) return '-';
  const number = Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === 'USD' && legacyUsd ? `$${number}` : `${currency} ${number}`;
}

export function reminderTotals(rows, legacyUsd = false) {
  const totals = new Map();
  for (const row of rows) {
    const currency = reminderCurrency(row);
    if (!currency || !finiteNumber(row.receivableBalance)) return '-';
    totals.set(currency, (totals.get(currency) || 0) + Number(row.receivableBalance));
  }
  if (!totals.size) return reminderMoney(0, 'USD', legacyUsd);
  return [...totals]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amount]) => reminderMoney(amount, currency, legacyUsd && totals.size === 1))
    .join(' / ');
}

export function reminderAccountingTotal(rows) {
  let total = 0;
  for (const row of rows) {
    const currency = reminderCurrency(row);
    const amount = currency === 'HKD' ? row.accountingReceivableUsd : row.receivableBalance;
    if (!currency || !finiteNumber(amount)) return null;
    total += Number(amount);
  }
  return total;
}
