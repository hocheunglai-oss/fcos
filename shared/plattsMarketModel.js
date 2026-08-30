const TENORS = new Set(['BM', 'M1', 'M2']);
const PRODUCTS = new Set(['hsfo380', 'vlsfo', 'lsmgo']);
const PRODUCT_UNITS = Object.freeze({ hsfo380: 'USD/MT', vlsfo: 'USD/MT', lsmgo: 'USD/BBL' });

function isoMonth(value) {
  const month = String(value || '').slice(0, 7);
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : null;
}

function isoDate(value) {
  const date = String(value || '').slice(0, 10);
  return /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(date) ? date : null;
}

export function shiftContractMonth(yearMonth, offset) {
  const month = isoMonth(yearMonth);
  if (!month || !Number.isInteger(offset)) return null;
  const [year, monthNumber] = month.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function contractMonthForTenor({ reportDate, tenor, printedContractMonth = null } = {}) {
  const reportMonth = isoMonth(reportDate);
  const normalizedTenor = String(tenor || '').toUpperCase();
  if (!reportMonth || !TENORS.has(normalizedTenor)) return null;
  const derived = shiftContractMonth(reportMonth, normalizedTenor === 'BM' ? 0 : Number(normalizedTenor.slice(1)));
  const printed = printedContractMonth == null ? null : isoMonth(printedContractMonth);
  if (printedContractMonth != null && !printed) return null;
  // The contract month printed in the licensed report is the evidence authority.
  // A mismatch with the relative tenor is retained here and rejected separately
  // by the publication/session eligibility gate, rather than losing the mark's
  // true contract identity (for example around an intramonth prompt roll).
  return printed || derived;
}

function numeric(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rounded(value, digits = 3) {
  return Number(Number(value).toFixed(digits));
}

export function projectedMopsSettlement({
  contractMonth,
  asOfDate,
  publicationDays = [],
  actuals = [],
  balanceMonthValue = null,
  approvedActualAverage = null,
} = {}) {
  const month = isoMonth(contractMonth);
  const date = isoDate(asOfDate);
  if (!month || !date) return { available: false, reason: 'invalid_scope' };
  const asOfMonth = date.slice(0, 7);
  if (month < asOfMonth) {
    const approved = numeric(approvedActualAverage);
    return approved == null
      ? { available: false, reason: 'closed_month_not_approved' }
      : { available: true, value: approved, source: 'approved_actual', contractMonth: month };
  }
  if (month > asOfMonth) return { available: false, reason: 'future_month_requires_outright' };

  const days = [...new Set((publicationDays || []).map(isoDate).filter((item) => item?.startsWith(`${month}-`)))].sort();
  if (!days.includes(date)) return { available: false, reason: 'as_of_not_publication_day' };
  const bm = numeric(balanceMonthValue);
  if (bm == null) return { available: false, reason: 'balance_month_missing' };

  const actualByDate = new Map();
  for (const row of actuals || []) {
    const actualDate = isoDate(row?.date || row?.priceDate || row?.price_date);
    const value = numeric(row?.value ?? row?.price);
    if (actualDate && actualDate < date && days.includes(actualDate) && value != null && row?.isEstimate !== true && row?.is_estimate !== true) {
      actualByDate.set(actualDate, value);
    }
  }
  const elapsedDays = days.filter((day) => day < date);
  if (elapsedDays.some((day) => !actualByDate.has(day))) {
    return { available: false, reason: 'prior_actuals_incomplete', missingDates: elapsedDays.filter((day) => !actualByDate.has(day)) };
  }
  const remainingDays = days.filter((day) => day >= date);
  const actualSum = elapsedDays.reduce((sum, day) => sum + actualByDate.get(day), 0);
  const value = (actualSum + bm * remainingDays.length) / days.length;
  return {
    available: true,
    value: rounded(value),
    source: 'balance_month_projection',
    contractMonth: month,
    actualDays: elapsedDays.length,
    projectedDays: remainingDays.length,
    totalPublicationDays: days.length,
    balanceMonthValue: bm,
  };
}

export function exactOutrightForContract({ product, contractMonth, asOfDate = null, observations = [], fallbacks = [] } = {}) {
  const normalizedProduct = String(product || '').toLowerCase();
  const month = isoMonth(contractMonth);
  const cutoff = asOfDate == null ? null : isoDate(asOfDate);
  if (!PRODUCTS.has(normalizedProduct) || !month || (asOfDate != null && !cutoff)) return { available: false, reason: 'invalid_scope' };
  const requiredUnit = PRODUCT_UNITS[normalizedProduct];
  const eligibleObservations = (observations || [])
    .filter((row) => String(row?.product || row?.productKey || '').toLowerCase() === normalizedProduct)
    .filter((row) => ['forward', 'curve', 'derivative'].includes(String(row?.marketFamily || row?.market_family || 'forward').toLowerCase()))
    .filter((row) => String(row?.unit || '').toUpperCase() === requiredUnit)
    .filter((row) => row?.qualityStatus === 'verified' || row?.quality_status === 'verified')
    .filter((row) => {
      if (!cutoff) return true;
      const reportDate = isoDate(row?.reportDate || row?.report_date);
      return Boolean(reportDate && reportDate <= cutoff);
    })
    .filter((row) => numeric(row?.value ?? row?.price) != null);
  const latestReportDate = eligibleObservations
    .map((row) => isoDate(row?.reportDate || row?.report_date))
    .filter(Boolean)
    .sort()
    .at(-1) || null;
  const latestMatches = eligibleObservations
    .filter((row) => isoDate(row?.reportDate || row?.report_date) === latestReportDate)
    .filter((row) => isoMonth(row?.contractMonth || row?.contract_month) === month);
  const distinctLatestValues = new Set(latestMatches.map((row) => numeric(row?.value ?? row?.price)));
  if (distinctLatestValues.size > 1) return { available: false, reason: 'latest_snapshot_conflict', asOfDate: latestReportDate };
  const verified = latestMatches[0];
  if (verified) return {
    available: true,
    value: numeric(verified.value ?? verified.price),
    unit: verified.unit,
    source: 'verified_report',
    observationId: verified.id || null,
    asOfDate: verified.reportDate || verified.report_date || null,
  };

  const activeFallback = (fallbacks || [])
    .filter((row) => String(row?.product || '').toLowerCase() === normalizedProduct)
    .filter((row) => isoMonth(row?.contractMonth || row?.contract_month) === month)
    .filter((row) => String(row?.unit || '').toUpperCase() === requiredUnit)
    .filter((row) => row?.status === 'active' && numeric(row?.value ?? row?.outrightValue ?? row?.outright_value) != null)
    .filter((row) => {
      if (!cutoff) return true;
      const markDate = isoDate(row?.asOfDate || row?.as_of_date);
      return Boolean(markDate && markDate <= cutoff);
    })
    .filter((row) => {
      const expiresOn = isoDate(row?.expiresOn || row?.expires_on || row?.expiresAt || row?.expires_at);
      return !expiresOn || !cutoff || cutoff < expiresOn;
    })
    .sort((left, right) => String(right?.asOfDate || right?.as_of_date || '').localeCompare(String(left?.asOfDate || left?.as_of_date || '')))[0];
  if (!activeFallback) return { available: false, reason: 'exact_outright_missing' };
  return {
    available: true,
    value: numeric(activeFallback.value ?? activeFallback.outrightValue ?? activeFallback.outright_value),
    unit: activeFallback.unit,
    source: 'authorized_manual_fallback',
    fallbackId: activeFallback.id || null,
    asOfDate: activeFallback.asOfDate || activeFallback.as_of_date || null,
  };
}

export function manualFallbackExpiry(mark = {}, { nextPublicationDate = null, verifiedReportDate = null, nextContractRollDate = null, today = null } = {}) {
  const asOf = isoDate(mark.asOfDate || mark.as_of_date);
  const contractMonth = isoMonth(mark.contractMonth || mark.contract_month);
  const current = isoDate(today);
  if (!asOf || !contractMonth || !current) return { active: false, reason: 'invalid_fallback' };
  const expiryCandidates = [nextPublicationDate, verifiedReportDate]
    .map(isoDate)
    .filter((date) => date && date > asOf);
  const contractRoll = isoDate(nextContractRollDate) || `${shiftContractMonth(contractMonth, 1)}-01`;
  expiryCandidates.push(contractRoll);
  const expiresOn = expiryCandidates.sort()[0];
  if (current >= expiresOn) {
    const reason = verifiedReportDate && expiresOn === isoDate(verifiedReportDate)
      ? 'verified_report_available'
      : expiresOn === contractRoll ? 'contract_rolled' : 'next_publication_day';
    return { active: false, reason, expiresOn };
  }
  return { active: true, reason: null, expiresOn };
}

function forwardObservation(rows, product, tenor) {
  const unit = PRODUCT_UNITS[product];
  const matches = rows.filter((item) => String(item?.product || item?.productKey || '').toLowerCase() === product
    && String(item?.tenor || '').toUpperCase() === tenor
    && ['forward', 'curve', 'derivative'].includes(String(item?.marketFamily || item?.market_family || '').toLowerCase())
    && String(item?.unit || '').toUpperCase() === unit
    && isoMonth(item?.contractMonth || item?.contract_month)
    && numeric(item?.value ?? item?.price) != null);
  if (matches.length !== 1) return null;
  return {
    value: numeric(matches[0]?.value ?? matches[0]?.price),
    contractMonth: isoMonth(matches[0]?.contractMonth || matches[0]?.contract_month),
  };
}

export function sameSnapshotSignals(observations = []) {
  const snapshots = new Set((observations || []).map((row) => `${row?.reportId || row?.report_id || ''}:${row?.reportDate || row?.report_date || ''}:${row?.sourceHash || row?.source_hash || ''}`));
  if (snapshots.size !== 1 || snapshots.has('::')) return { complete: false, reason: 'same_snapshot_required' };
  const result = { complete: true, products: {}, crossGrade: {}, source: [...snapshots][0] };
  for (const product of PRODUCTS) {
    const bm = forwardObservation(observations, product, 'BM');
    const m1 = forwardObservation(observations, product, 'M1');
    const m2 = forwardObservation(observations, product, 'M2');
    const bmM1 = bm && m1 && shiftContractMonth(bm.contractMonth, 1) === m1.contractMonth ? rounded(bm.value - m1.value) : null;
    const m1M2 = m1 && m2 && shiftContractMonth(m1.contractMonth, 1) === m2.contractMonth ? rounded(m1.value - m2.value) : null;
    const slopes = [bmM1, m1M2].filter((value) => value != null && value !== 0).map((value) => Math.sign(value));
    const frontSlope = bmM1 ?? m1M2;
    result.products[product] = {
      bmM1,
      m1M2,
      regime: slopes.length > 1 && new Set(slopes).size > 1
        ? 'mixed'
        : frontSlope == null ? 'unavailable' : frontSlope > 0 ? 'backwardation' : frontSlope < 0 ? 'contango' : 'flat',
    };
  }
  for (const tenor of ['M1', 'M2']) {
    const vlsfo = forwardObservation(observations, 'vlsfo', tenor);
    const hsfo = forwardObservation(observations, 'hsfo380', tenor);
    result.crossGrade[tenor.toLowerCase()] = !vlsfo || !hsfo || vlsfo.contractMonth !== hsfo.contractMonth
      ? null
      : rounded(vlsfo.value - hsfo.value);
  }
  return result;
}

export function adaptiveAlertThreshold(history = [], floor, minimumSamples = 20) {
  const configuredFloor = numeric(floor);
  if (configuredFloor == null || configuredFloor < 0) return null;
  const values = (history || []).map((value) => Math.abs(Number(value))).filter(Number.isFinite).sort((left, right) => left - right);
  if (values.length < minimumSamples) return configuredFloor;
  const nearestRankIndex = Math.max(0, Math.ceil(values.length * 0.95) - 1);
  return Math.max(configuredFloor, values[nearestRankIndex]);
}

export function evaluateCurveShadow(comparisons = [], minimumPublicationDays = 10, { expectedPublicationDays = [] } = {}) {
  const rows = (comparisons || [])
    .map((row) => ({
      publicationDate: isoDate(row?.publicationDate || row?.publication_date),
      product: String(row?.product || '').toLowerCase(),
      contractMonth: isoMonth(row?.contractMonth || row?.contract_month),
      unit: String(row?.unit || PRODUCT_UNITS[String(row?.product || '').toLowerCase()] || '').toUpperCase(),
      legacyValue: numeric(row?.legacyValue ?? row?.legacy_value),
      curveValue: numeric(row?.curveValue ?? row?.curve_value),
      complete: row?.complete !== false,
    }))
    .filter((row) => row.complete && row.publicationDate && PRODUCTS.has(row.product) && row.contractMonth && row.unit === PRODUCT_UNITS[row.product] && row.legacyValue != null && row.curveValue != null)
    .map((row) => ({ ...row, variance: rounded(row.curveValue - row.legacyValue) }));
  const publicationDays = [...new Set(rows.map((row) => row.publicationDate))].sort();
  const expected = [...new Set((expectedPublicationDays || []).map(isoDate).filter(Boolean))].sort();
  const seriesGroups = new Map();
  for (const row of rows) {
    const key = `${row.product}:${row.contractMonth}:${row.unit}`;
    if (!seriesGroups.has(key)) seriesGroups.set(key, []);
    seriesGroups.get(key).push(row);
  }
  const series = [...seriesGroups.entries()].map(([key, seriesRows]) => {
    const available = new Set(seriesRows.map((row) => row.publicationDate));
    const relevantExpected = expected.length ? expected.filter((day) => day <= publicationDays.at(-1)) : [...available].sort();
    let consecutiveCompleteDays = 0;
    const missingExpectedDays = [];
    for (const day of relevantExpected) {
      if (available.has(day)) consecutiveCompleteDays += 1;
      else {
        missingExpectedDays.push(day);
        consecutiveCompleteDays = 0;
      }
    }
    return { key, publicationDayCount: available.size, consecutiveCompletePublicationDayCount: consecutiveCompleteDays, missingExpectedDays };
  });
  const consecutiveCompleteDays = series.length ? Math.min(...series.map((item) => item.consecutiveCompletePublicationDayCount)) : 0;
  const missingExpectedDays = [...new Set(series.flatMap((item) => item.missingExpectedDays))].sort();
  const absoluteVariances = rows.map((row) => Math.abs(row.variance));
  return {
    status: series.length && series.every((item) => item.consecutiveCompletePublicationDayCount >= minimumPublicationDays) ? 'ready_for_variance_review' : 'shadowing',
    publicationDayCount: publicationDays.length,
    consecutiveCompletePublicationDayCount: consecutiveCompleteDays,
    missingExpectedDays,
    series,
    minimumPublicationDays,
    firstPublicationDate: publicationDays[0] || null,
    latestPublicationDate: publicationDays.at(-1) || null,
    comparisonCount: rows.length,
    meanAbsoluteVariance: absoluteVariances.length ? rounded(absoluteVariances.reduce((sum, value) => sum + value, 0) / absoluteVariances.length) : null,
    maximumAbsoluteVariance: absoluteVariances.length ? rounded(Math.max(...absoluteVariances)) : null,
    cutoverApproved: false,
  };
}

export const plattsMarketModelInternals = Object.freeze({ isoDate, isoMonth, numeric });
