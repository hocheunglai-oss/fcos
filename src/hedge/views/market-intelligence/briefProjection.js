const PRODUCT_LABELS = {
  hsfo380: 'HSFO 380',
  hsfo: 'HSFO 380',
  s380: 'HSFO 380',
  vlsfo: 'S0.5%',
  s05: 'S0.5%',
  lsmgo: 'LSMGO',
  sgo: 'LSMGO',
};

function number(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function monthLabel(value) {
  const match = /^(\d{4})-(\d{2})/.exec(String(value || ''));
  if (!match) return null;
  return new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${match[1]}-${match[2]}-01T00:00:00Z`));
}

export function briefProductLabel(productKey) {
  return PRODUCT_LABELS[String(productKey || '').toLowerCase()] || productKey || 'Market';
}

export function formatBriefMetric(value, unit = 'USD/MT') {
  const parsed = number(value);
  if (parsed == null) return 'Unavailable';
  const normalizedUnit = String(unit || 'USD/MT').toUpperCase();
  const digits = normalizedUnit === 'USD/BBL' ? 3 : 2;
  const amount = new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(parsed));
  return `${parsed > 0 ? '+' : parsed < 0 ? '−' : ''}${amount} ${normalizedUnit}`;
}

export function projectMaterialChange(row = {}) {
  const product = briefProductLabel(row.productKey);
  const tenor = String(row.tenor || 'outright').toUpperCase();
  const contract = monthLabel(row.contractMonth);
  const change = number(row.change);
  return {
    ...row,
    product: row.productKey,
    title: `${product} ${tenor} daily move`,
    summary: `The exact${contract ? ` ${contract}` : ''} ${tenor} outright moved ${formatBriefMetric(row.change, row.unit)}.`,
    direction: change == null ? 'neutral' : change > 0 ? 'up' : change < 0 ? 'down' : 'neutral',
    metricBasis: [row.sourceSymbol, contract, tenor, 'report daily change'].filter(Boolean).join(' · '),
  };
}

export function projectPortDislocation(row = {}) {
  const product = briefProductLabel(row.productKey);
  const sampleCount = number(row.sampleCount);
  const portCount = sampleCount == null ? 'the available' : `${sampleCount}`;
  return {
    ...row,
    product: row.productKey,
    title: `${product} delivered-port dispersion`,
    summary: row.highPort && row.lowPort
      ? `${row.highPort} was ${formatBriefMetric(row.dispersion, row.unit)} above ${row.lowPort} across ${portCount} same-date assessed ports.`
      : `Same-date assessed-port dispersion was ${formatBriefMetric(row.dispersion, row.unit)}.`,
    direction: 'mixed',
    metricBasis: 'Same-date assessed delivered prices',
  };
}

export function projectPhysicalPaperSignal(row = {}) {
  const product = briefProductLabel(row.productKey);
  const state = String(row.state || 'unavailable').toLowerCase();
  const stateLabel = state.charAt(0).toUpperCase() + state.slice(1);
  let paper = formatBriefMetric(row.paperMove, row.unit);
  if (number(row.originalPaperMove) != null && row.originalPaperUnit) {
    paper += ` (${formatBriefMetric(row.originalPaperMove, row.originalPaperUnit)} × ${row.conversionFactor || 'conversion factor'})`;
  }
  return {
    ...row,
    product: row.productKey,
    title: `${product} physical versus M1 paper · ${stateLabel}`,
    summary: state === 'unavailable'
      ? 'A same-date delivered move or exact M1 paper move is unavailable; FCOS makes no relationship inference.'
      : `Delivered assessments moved ${formatBriefMetric(row.physicalMove, row.unit)} on average; exact M1 paper moved ${paper}.`,
    direction: state === 'confirmed' ? 'neutral' : state === 'divergent' ? 'mixed' : 'neutral',
    metricBasis: [row.reportDate, 'same-date delivered average vs exact M1 paper'].filter(Boolean).join(' · '),
  };
}

export function projectBriefDriver(row = {}) {
  const confidence = number(row.confidence);
  return {
    ...row,
    product: row.productKey || row.product,
    port: row.portKey || row.port,
    confidenceLabel: confidence == null ? null : `${Math.round(confidence * 100)}% confidence`,
  };
}
