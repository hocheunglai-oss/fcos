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
