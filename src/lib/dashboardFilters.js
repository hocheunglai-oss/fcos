export const MONTHS = [
  { value: 1, label: 'Jan' }, { value: 2, label: 'Feb' }, { value: 3, label: 'Mar' },
  { value: 4, label: 'Apr' }, { value: 5, label: 'May' }, { value: 6, label: 'Jun' },
  { value: 7, label: 'Jul' }, { value: 8, label: 'Aug' }, { value: 9, label: 'Sep' },
  { value: 10, label: 'Oct' }, { value: 11, label: 'Nov' }, { value: 12, label: 'Dec' },
];

const now = new Date();

export const THIS_YEAR = now.getFullYear();
export const THIS_MONTH = now.getMonth() + 1;

export const getRecentYears = (baseYear = THIS_YEAR, count = 3) =>
  Array.from({ length: count }, (_, index) => baseYear - index);

export function buildDashboardDateWindows(years, months) {
  const normalizedYears = [...new Set((years || []).map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
  const normalizedMonths = [...new Set((months || []).map(Number).filter((month) => Number.isInteger(month) && month >= 1 && month <= 12))].sort((a, b) => a - b);
  const useFullYear = normalizedMonths.length === 0 || normalizedMonths.length === 12;
  const windows = [];

  for (const year of normalizedYears) {
    if (useFullYear) {
      windows.push({ startDate: `${year}-01-01`, endDate: `${year}-12-31` });
      continue;
    }
    for (const month of normalizedMonths) {
      const monthToken = String(month).padStart(2, '0');
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      windows.push({
        startDate: `${year}-${monthToken}-01`,
        endDate: `${year}-${monthToken}-${String(lastDay).padStart(2, '0')}`,
      });
    }
  }
  return windows;
}

export function formatSelectedMonths(selectedMonths) {
  if (selectedMonths.length === 12) return 'All months';
  return selectedMonths
    .slice()
    .sort((a, b) => Number(a) - Number(b))
    .map(month => MONTHS.find(item => item.value === Number(month))?.label)
    .filter(Boolean)
    .join(', ');
}

export const DASHBOARD_FILTER_STORAGE_KEY = 'fcos:dashboard-filter-v2';

export const DASHBOARD_DATE_PRESETS = [
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'this_quarter', label: 'This quarter' },
  { value: 'year_to_date', label: 'Year to date' },
  { value: 'custom', label: 'Custom' },
];

function previousMonth(year, month) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export function presetDashboardPeriod(preset, currentDate = new Date()) {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;
  if (preset === 'last_month') {
    const prior = previousMonth(year, month);
    return { selectedYears: [prior.year], selectedMonths: [prior.month] };
  }
  if (preset === 'this_quarter') {
    const quarterStart = Math.floor((month - 1) / 3) * 3 + 1;
    return { selectedYears: [year], selectedMonths: [quarterStart, quarterStart + 1, quarterStart + 2] };
  }
  if (preset === 'year_to_date') return { selectedYears: [year], selectedMonths: Array.from({ length: month }, (_, index) => index + 1) };
  return { selectedYears: [year], selectedMonths: [month] };
}

export function normalizeDashboardFilters(input = {}) {
  const years = [...new Set((input.selectedYears || [THIS_YEAR]).map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
  const months = [...new Set((input.selectedMonths || [THIS_MONTH]).map(Number).filter((month) => month >= 1 && month <= 12))].sort((a, b) => a - b);
  return {
    datePreset: DASHBOARD_DATE_PRESETS.some((item) => item.value === input.datePreset) ? input.datePreset : 'this_month',
    selectedYears: years.length ? years : [THIS_YEAR],
    selectedMonths: months.length ? months : [THIS_MONTH],
    disputeOnly: input.disputeOnly === true,
    counterpartyMode: input.counterpartyMode === 'supplier' ? 'supplier' : 'buyer',
    company: String(input.company ?? input.companyKeyword ?? '').trim(),
    companyId: String(input.companyId ?? '').trim(),
    portCountry: String(input.portCountry ?? '').trim(),
    portCountryId: String(input.portCountryId ?? '').trim(),
  };
}

export function dashboardFilterPayload(input = {}) {
  const filters = normalizeDashboardFilters(input);
  const accountIds = filters.counterpartyMode === 'buyer' && filters.companyId ? [filters.companyId] : [];
  const supplierIds = filters.counterpartyMode === 'supplier' && filters.companyId ? [filters.companyId] : [];
  const countryPrefix = 'country:';
  const countryCodes = filters.portCountryId.toLowerCase().startsWith(countryPrefix)
    ? [filters.portCountryId.slice(countryPrefix.length).trim().toUpperCase()].filter(Boolean)
    : [];
  const portIds = filters.portCountryId && !countryCodes.length ? [filters.portCountryId] : [];
  return {
    dateWindows: buildDashboardDateWindows(filters.selectedYears, filters.selectedMonths),
    disputeOnly: filters.disputeOnly,
    counterpartyMode: filters.counterpartyMode,
    filters: { accountIds, supplierIds, portIds, countryCodes },
  };
}

export function dashboardFilterKey(input = {}) {
  const filters = dashboardFilterPayload(input);
  return JSON.stringify(filters);
}
