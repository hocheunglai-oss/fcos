// Only the transaction's own date establishes its usage year. A payment's
// invoice date and the scan/update timestamps describe different events.
export function xeroUsageYear(record) {
  for (const value of [record?.DateString, record?.Date]) {
    if (typeof value !== 'string') continue;
    const calendar = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(value);
    if (calendar && Number.isFinite(Date.parse(value))) {
      const [year, month, day] = calendar.slice(1).map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));
      if (year >= 1000 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) return year;
    }
    const wrapped = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(value);
    if (wrapped) {
      const year = new Date(Number(wrapped[1])).getUTCFullYear();
      if (Number.isInteger(year) && year >= 1000 && year <= 9999) return year;
    }
  }
  return null;
}

export function addUsageYear(existing, record) {
  const counts = new Map((existing?.yearCounts || []).map(({ year, records }) => [year, records]));
  const year = xeroUsageYear(record);
  if (year !== null) counts.set(year, (counts.get(year) || 0) + 1);
  return {
    yearCounts: [...counts].sort(([a], [b]) => a - b).map(([year, records]) => ({ year, records })),
    undatedRecords: (existing?.undatedRecords || 0) + (year === null ? 1 : 0),
  };
}

export function hasUsageYearBreakdown(item) {
  if (!Array.isArray(item?.yearCounts) || !Number.isSafeInteger(item.undatedRecords) || item.undatedRecords < 0) return false;
  const seen = new Set();
  let total = item.undatedRecords;
  for (const entry of item.yearCounts) {
    if (!entry || typeof entry !== 'object') return false;
    const { year, records } = entry;
    if (!Number.isInteger(year) || year < 1000 || year > 9999 || seen.has(year)
      || !Number.isSafeInteger(records) || records <= 0) return false;
    seen.add(year);
    total += records;
  }
  return Number.isSafeInteger(item.records) && item.records === total;
}

export function usageYearFields(item) {
  return hasUsageYearBreakdown(item) ? {
    yearCounts: item.yearCounts.map(({ year, records }) => ({ year, records })).sort((a, b) => a.year - b.year),
    undatedRecords: item.undatedRecords,
  } : {};
}
