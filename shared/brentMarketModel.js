const SINGAPORE_OFFSET_MS = 8 * 60 * 60 * 1000;
const CUTOFF_MINUTES = 16 * 60 + 30;

export const TRADINGVIEW_BRENT_SYMBOL = 'ICEEUR:BRN1!';
export const BRENT_LIVE_MODES = Object.freeze([
  'tradingview_indicative',
  'licensed_live',
  'unavailable',
]);

function isoDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function nextEligibleDate(date, eligibleDates) {
  return eligibleDates.find((candidate) => candidate >= date) || null;
}

function followingDate(date) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

export function singaporePricingDay(timestamp, eligiblePricingDates = []) {
  const instant = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(instant.getTime())) return null;
  const local = new Date(instant.getTime() + SINGAPORE_OFFSET_MS);
  const localDate = local.toISOString().slice(0, 10);
  const localMinutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const candidate = localMinutes <= CUTOFF_MINUTES ? localDate : followingDate(localDate);
  const calendar = [...new Set((eligiblePricingDates || []).map(isoDate).filter(Boolean))].sort();
  if (!calendar.length) return null;
  return nextEligibleDate(candidate, calendar);
}

export function tradingViewIndicativeBrent() {
  return {
    mode: 'unavailable',
    attemptedMode: 'tradingview_indicative',
    instrumentName: 'Front-month ICE Brent',
    symbol: TRADINGVIEW_BRENT_SYMBOL,
    unit: 'USD/BBL',
    provider: 'TradingView',
    disclosure: 'Indicative · provider delay may apply',
    reason: 'TradingView does not permit ICEEUR:BRN1! to be displayed in website widgets.',
    followsSingaporeCutoff: false,
    singaporeCutoff: '16:30 Asia/Singapore',
    activeContract: null,
    quote: null,
    quoteAt: null,
    latencySeconds: null,
    intradayPoints: [],
    pricingDaySnapshots: [],
    change: null,
    changePercent: null,
    rollMarkers: [],
  };
}

function unavailable(reason) {
  return {
    mode: 'unavailable',
    reason,
    activeContract: null,
    quote: null,
    quoteAt: null,
    latencySeconds: null,
    intradayPoints: [],
    pricingDaySnapshots: [],
    change: null,
    changePercent: null,
    rollMarkers: [],
  };
}

export function licensedBrentSnapshot(input = {}, {
  now = new Date(),
  maxAgeSeconds = 120,
  eligiblePricingDates = [],
} = {}) {
  if (input.entitlementVerified !== true
    || input.rights?.internalDisplay !== true
    || input.rights?.history !== true) {
    return unavailable('Licensed ICE Brent display and history rights are not verified.');
  }
  if (!/^BRN[A-Z]\d{2}$/.test(String(input.activeContract || '').toUpperCase())) {
    return unavailable('The active ICE Brent contract identity is not verified.');
  }
  if (String(input.unit || '').toUpperCase() !== 'USD/BBL') {
    return unavailable('The licensed ICE Brent quote unit is not USD/BBL.');
  }
  const quote = Number(input.quote);
  const quoteAt = new Date(input.quoteAt);
  const current = now instanceof Date ? now : new Date(now);
  const latencySeconds = Math.max(0, (current.getTime() - quoteAt.getTime()) / 1000);
  if (!Number.isFinite(quote) || Number.isNaN(quoteAt.getTime()) || Number.isNaN(current.getTime())) {
    return unavailable('The licensed ICE Brent quote is incomplete.');
  }
  if (latencySeconds > maxAgeSeconds || quoteAt.getTime() > current.getTime() + 5_000) {
    return unavailable('The licensed ICE Brent quote is stale or has an invalid timestamp.');
  }
  const points = (input.intradayPoints || []).map((point) => {
    const value = Number(point.value);
    const timestamp = new Date(point.timestamp);
    const contract = String(point.contract || '').toUpperCase();
    const pricingDay = singaporePricingDay(timestamp, eligiblePricingDates);
    if (!Number.isFinite(value) || Number.isNaN(timestamp.getTime()) || !/^BRN[A-Z]\d{2}$/.test(contract) || !pricingDay) return null;
    return { timestamp: timestamp.toISOString(), value, contract, pricingDay };
  }).filter(Boolean).sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  if (!points.length) return unavailable('The licensed ICE Brent two-pricing-day trace is unavailable.');

  const snapshots = [];
  for (const pricingDay of [...new Set(points.map((point) => point.pricingDay))]) {
    const bucket = points.filter((point) => point.pricingDay === pricingDay);
    snapshots.push({ pricingDay, ...bucket[bucket.length - 1] });
  }
  const recent = snapshots.slice(-2);
  const recentPricingDays = new Set(recent.map((snapshot) => snapshot.pricingDay));
  const recentPoints = points.filter((point) => recentPricingDays.has(point.pricingDay));
  const previous = recent.length === 2 ? recent[0].value : null;
  const change = previous == null ? null : recent[1].value - previous;
  const rollMarkers = recentPoints.slice(1).flatMap((point, index) => point.contract === recentPoints[index].contract ? [] : [{
    timestamp: point.timestamp,
    fromContract: recentPoints[index].contract,
    toContract: point.contract,
  }]);

  return {
    mode: 'licensed_live',
    instrumentName: 'Front-month ICE Brent',
    unit: 'USD/BBL',
    provider: String(input.provider || 'Licensed provider'),
    activeContract: String(input.activeContract).toUpperCase(),
    quote,
    quoteAt: quoteAt.toISOString(),
    latencySeconds,
    singaporeCutoff: '16:30 Asia/Singapore',
    intradayPoints: recentPoints,
    pricingDaySnapshots: recent,
    change,
    changePercent: previous ? (change / previous) * 100 : null,
    rollMarkers,
  };
}
