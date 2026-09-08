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
