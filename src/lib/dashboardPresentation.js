import { MONTHS } from './dashboardFilters.js';

// Presentation only: never change the actual filter windows or financial values.
export function dashboardPeriodLabel(years = [], months = []) {
  const ordered = [...new Set(months.map(Number))].filter((month) => month >= 1 && month <= 12).sort((a, b) => a - b);
  const label = (month) => MONTHS.find((item) => item.value === month)?.label || '';
  const consecutive = ordered.every((month, index) => index === 0 || month === ordered[index - 1] + 1);
  const monthText = ordered.length > 1 && consecutive
    ? `${label(ordered[0])}–${label(ordered.at(-1))}`
    : ordered.map(label).join(', ');
  return [monthText, [...new Set(years.map(Number))].sort((a, b) => a - b).join(', ')].filter(Boolean).join(' ');
}

export function dashboardDisplayNumber(value) {
  if (value == null || typeof value === 'boolean' || (typeof value === 'string' && !value.trim())) return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

export function dashboardEbitPresentation({ summaryComplete, financeUsable, grossProfit, finance }) {
  const n = dashboardDisplayNumber;
  if (!summaryComplete) return { type: 'none', amount: null };
  const totalProfit = n(grossProfit);
  const cost = n(finance?.financeCost);
  const amount = n(finance?.ebit);
  if (financeUsable && finance?.complete !== false && cost != null && amount != null) return { type: 'full', amount, profit: totalProfit, cost };
  const count = n(finance?.verifiedStemCount);
  const total = n(finance?.stemCount);
  const profit = n(finance?.verifiedGrossProfit);
  const partialCost = n(finance?.verifiedFinanceCost);
  const partialAmount = n(finance?.verifiedEbit);
  if (financeUsable && finance?.complete === false && Number.isInteger(count) && Number.isInteger(total)
    && count > 0 && count <= total && totalProfit != null && profit != null && partialCost != null && partialAmount != null) {
    return { type: 'partial', amount: partialAmount, profit, cost: partialCost, count, total, totalProfit, coverage: count / total * 100, excludedCount: total - count, excludedProfit: n(finance.excludedGrossProfit) };
  }
  if (totalProfit == null) return { type: 'none', amount: null };
  const missing = n(finance?.missingEvidenceCount);
  return { type: 'profit', amount: totalProfit, ...(Number.isInteger(total) && total >= 0 ? { total } : {}), ...(Number.isInteger(missing) && missing >= 0 ? { missing } : {}) };
}
