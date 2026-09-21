const EXPORT_PAGE_SIZE = 200;

function abortError() {
  const error = new Error('Dashboard export cancelled.');
  error.name = 'AbortError';
  return error;
}

function assertNotAborted(signal) {
  if (signal?.aborted) throw abortError();
}

const incomplete = (reason) => new Error(`Dashboard export incomplete: ${reason}. No file was downloaded.`);

/**
 * Fetches the complete ordinary Dashboard STEM selection. Each page is checked
 * against the first page so a changing result set can never become a partial
 * download that looks complete.
 */
export async function fetchAllDashboardStems({
  invoke,
  filterPayload,
  search = '',
  sort,
  includeFinanceCosts = false,
  signal,
  onProgress,
  pageSize = EXPORT_PAGE_SIZE,
} = {}) {
  if (typeof invoke !== 'function') throw new TypeError('An authenticated Dashboard API invoker is required.');
  const safePageSize = Math.min(Math.max(Number(pageSize) || EXPORT_PAGE_SIZE, 1), EXPORT_PAGE_SIZE);
  const rows = [];
  const ids = new Set();
  const seenCursors = new Set();
  let cursor = null;
  let expectedCount = null;
  let finance = null;
  const financeWarnings = new Set();
  let pageNumber = 0;

  while (true) {
    assertNotAborted(signal);
    if (cursor != null) {
      const cursorKey = String(cursor);
      if (seenCursors.has(cursorKey)) throw incomplete('repeated a page cursor');
      seenCursors.add(cursorKey);
    }
    const payload = {
      ...(filterPayload || {}),
      cursor,
      pageSize: safePageSize,
      sort,
      search: String(search || '').trim() || null,
      ...(includeFinanceCosts ? { includeFinanceCosts: true } : {}),
      ...(includeFinanceCosts && finance ? { financeSnapshot: { revision: finance.revision, asOfDate: finance.asOfDate } } : {}),
    };
    const response = await invoke('dashboardStemList', payload, {
      cache: false,
      force: true,
      signal,
    });
    assertNotAborted(signal);
    if (response?.data?.cancelled) throw abortError();
    if (response?.data?.error) throw new Error(response.data.error);

    const data = response?.data || {};
    const currentRows = data.stems;
    if (!Array.isArray(currentRows)) throw incomplete('invalid STEM page');
    const matchingCount = Number(data.matchingCount);
    if (!Number.isSafeInteger(matchingCount) || matchingCount < 0) {
      throw incomplete('invalid matching row count');
    }
    if (expectedCount == null) expectedCount = matchingCount;
    else if (matchingCount !== expectedCount) {
      throw incomplete('selection changed; please export again');
    }

    const pageFinance = data.finance;
    if (includeFinanceCosts && pageNumber === 0) {
      if (!pageFinance || pageFinance.revision == null || !pageFinance.asOfDate) {
        throw incomplete('finance snapshot unavailable');
      }
      finance = pageFinance;
    } else if (includeFinanceCosts && !pageFinance) {
      throw incomplete('finance snapshot missing from a later page');
    } else if (includeFinanceCosts) {
      if (String(pageFinance.revision) !== String(finance.revision) || String(pageFinance.asOfDate) !== String(finance.asOfDate)) {
        throw incomplete('rate or calculation date changed; please export again');
      }
      if (Number(pageFinance.annualInterestRatePct) !== Number(finance.annualInterestRatePct) || String(pageFinance.dayCountBasis || '') !== String(finance.dayCountBasis || '')) {
        throw incomplete('finance methodology changed; please export again');
      }
    }
    if (includeFinanceCosts) for (const warning of pageFinance.warnings || []) if (warning) financeWarnings.add(String(warning));

    for (const row of currentRows) {
      const id = row?.id;
      if (!id) throw incomplete('STEM row has no stable ID');
      const key = String(id);
      if (ids.has(key)) throw incomplete('duplicate STEM');
      ids.add(key);
      rows.push(row);
    }

    if (rows.length > expectedCount) throw incomplete('more STEMs than the matching count');
    const nextCursor = data.nextCursor ?? null;
    pageNumber += 1;
    onProgress?.({ loaded: rows.length, total: expectedCount, page: pageNumber });

    if (nextCursor == null || nextCursor === '') {
      if (rows.length !== expectedCount) {
        throw incomplete(`export stopped at ${rows.length.toLocaleString()} of ${expectedCount.toLocaleString()} STEMs`);
      }
      break;
    }
    if (!currentRows.length || (currentRows.length < safePageSize && rows.length < expectedCount)) {
      throw incomplete('incomplete page before the end of the selection');
    }
    if (rows.length >= expectedCount) {
      throw incomplete('another page followed the matching count');
    }
    const nextKey = String(nextCursor);
    if (nextKey === String(cursor ?? '') || seenCursors.has(nextKey)) {
      throw incomplete('repeated a page cursor');
    }
    cursor = nextCursor;
  }

  if (finance) {
    finance = {
      ...finance,
      complete: rows.every((row) => row?.finance?.complete === true),
      warnings: [...financeWarnings],
    };
  }
  return { rows, matchingCount: expectedCount ?? 0, finance };
}

export async function createDashboardStemWorkbook(options) {
  const { createDashboardStemWorkbookBytes } = await import('./dashboardStemWorkbook.js');
  return new Blob([createDashboardStemWorkbookBytes({ ...options, scopeLabels: { ...options?.scopeLabels, period: dashboardStemExportPeriod(options?.filterPayload), koreaDesk: dashboardStemDeskLabel(options?.filterPayload, options?.scopeLabels) } })], { type: 'application/vnd.ms-excel' });
}

function deliveryWindows(filterPayload) {
  const date = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  const windows = (filterPayload?.dateWindows || []).map(({ startDate, endDate }) => {
    if (!date(startDate) || !date(endDate) || startDate > endDate) throw new Error('Dashboard export has an invalid delivery period.');
    return { startDate, endDate };
  }).sort((left, right) => left.startDate.localeCompare(right.startDate));
  const merged = [];
  for (const window of windows) {
    const last = merged.at(-1);
    if (last && Date.parse(window.startDate) <= Date.parse(last.endDate) + 86_400_000) {
      if (window.endDate > last.endDate) last.endDate = window.endDate;
    } else merged.push(window);
  }
  return merged;
}

export function dashboardStemExportPeriod(filterPayload) {
  const windows = deliveryWindows(filterPayload);
  return windows.length ? windows.map(({ startDate, endDate }) => startDate === endDate ? startDate : `${startDate} to ${endDate}`).join('; ') : 'All delivery dates';
}

export function dashboardStemDeskLabel(filterPayload, scopeLabels = {}) {
  if (filterPayload?.filters?.excludedCountryCodes?.includes('KOREA')) return 'Exclude Korea Desk';
  if (scopeLabels.koreaDesk === 'Korea Desk') return 'Korea Desk';
  const countries = filterPayload?.filters?.countryCodes || [];
  return countries.length === 1 && countries[0] === 'KOREA' ? 'Korea Desk' : 'All';
}

export function dashboardStemExportFileName({ filterPayload = {}, scopeLabels = {} } = {}) {
  const windows = deliveryWindows(filterPayload);
  const period = windows.length > 3 ? `${windows.length}_Selected_Delivery_Periods` : dashboardStemExportPeriod(filterPayload).replaceAll('; ', '_and_');
  const desk = dashboardStemDeskLabel(filterPayload, scopeLabels);
  const labels = [desk, scopeLabels.counterparty, ...(desk === 'Korea Desk' ? [] : [scopeLabels.port, scopeLabels.country]), filterPayload.disputeOnly ? 'Disputed only' : ''];
  const sanitize = (value) => String(value || '').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001F\u007F]/g, '').trim().replace(/\s+/g, '_').replace(/[. ]+$/g, '');
  const active = [...new Set(labels.filter((label) => label && label !== 'All').map(sanitize).filter(Boolean))];
  // Keep a safe filename on Windows/macOS; the Scope sheet always records every restriction.
  const suffix = active.join('_').slice(0, 75);
  let base = `FCOS_Dashboard_STEMs_${sanitize(period)}${suffix ? `_${suffix}` : ''}`;
  while (new TextEncoder().encode(base).length > 240) base = Array.from(base).slice(0, -1).join('');
  return `${base}.xls`;
}

export function downloadDashboardStemWorkbook(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
