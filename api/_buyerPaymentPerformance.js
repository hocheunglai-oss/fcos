const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ONE_DAY_MS = 86_400_000;

export const BUYER_PAYMENT_CONSERVATIVENESS = Object.freeze({
  typical: Object.freeze({ key: 'typical', label: 'Typical', percentile: 0.5, percentileLabel: 'P50' }),
  cautious: Object.freeze({ key: 'cautious', label: 'Cautious', percentile: 0.75, percentileLabel: 'P75' }),
  severe: Object.freeze({ key: 'severe', label: 'Severe', percentile: 0.9, percentileLabel: 'P90' }),
});

export const DEFAULT_BUYER_PAYMENT_CONSERVATIVENESS = 'cautious';
export const BUYER_PAYMENT_DELAY_MIN_DAYS = -15;
export const BUYER_PAYMENT_DELAY_MAX_DAYS = 120;
export const BUYER_PAYMENT_RECENCY_HALF_LIFE_DAYS = 90;

function dateOnly(input) {
  const value = String(input ?? '').slice(0, 10);
  return ISO_DATE.test(value) ? value : null;
}

function dayDifference(fromDate, toDate) {
  const from = dateOnly(fromDate);
  const to = dateOnly(toDate);
  if (!from || !to) return null;
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / ONE_DAY_MS);
}

function clampDelay(value) {
  const delay = Number(value);
  if (!Number.isFinite(delay)) return 0;
  return Math.max(BUYER_PAYMENT_DELAY_MIN_DAYS, Math.min(BUYER_PAYMENT_DELAY_MAX_DAYS, Math.round(delay)));
}

function modelConfidence(sampleCount, minimumSamples) {
  if (sampleCount >= minimumSamples * 2) return 'High';
  if (sampleCount >= minimumSamples) return 'Medium';
  return 'Low';
}

function groupKey(sample = {}) {
  return String(sample.buyerGroupId || sample.buyerGroupName || '').trim();
}

function paymentSampleWeight(sample, today) {
  const ageDays = Math.max(0, dayDifference(sample.paymentDate, today) ?? 0);
  return Math.pow(0.5, ageDays / BUYER_PAYMENT_RECENCY_HALF_LIFE_DAYS);
}

export function normalizeBuyerPaymentConservativeness(value, fallback = DEFAULT_BUYER_PAYMENT_CONSERVATIVENESS) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return BUYER_PAYMENT_CONSERVATIVENESS[normalized] ? normalized : fallback;
}

export function recencyWeightedDelay(samples = [], today = new Date().toISOString().slice(0, 10)) {
  const usable = samples.filter((sample) => Number.isFinite(Number(sample?.delayDays)));
  let weightedTotal = 0;
  let weightTotal = 0;
  const recent = [];
  for (const sample of usable) {
    const weight = paymentSampleWeight(sample, today);
    weightedTotal += Number(sample.delayDays) * weight;
    weightTotal += weight;
    const ageDays = Math.max(0, dayDifference(sample.paymentDate, today) ?? 0);
    if (ageDays <= BUYER_PAYMENT_RECENCY_HALF_LIFE_DAYS) recent.push(sample);
  }
  if (!weightTotal) return 0;
  const weighted = weightedTotal / weightTotal;
  if (recent.length >= Math.min(3, usable.length)) {
    const recentAverage = recent.reduce((sum, sample) => sum + Number(sample.delayDays), 0) / recent.length;
    return clampDelay(weighted * 0.7 + recentAverage * 0.3);
  }
  return clampDelay(weighted);
}

export function recencyWeightedPercentile(samples = [], percentile = 0.5, today = new Date().toISOString().slice(0, 10)) {
  const usable = samples
    .filter((sample) => Number.isFinite(Number(sample?.delayDays)))
    .map((sample) => ({ delay: Number(sample.delayDays), weight: paymentSampleWeight(sample, today) }))
    .sort((left, right) => left.delay - right.delay);
  if (!usable.length) return 0;
  const target = Math.max(0, Math.min(1, Number(percentile) || 0)) * usable.reduce((sum, sample) => sum + sample.weight, 0);
  let cumulative = 0;
  for (const sample of usable) {
    cumulative += sample.weight;
    if (cumulative >= target) return clampDelay(sample.delay);
  }
  return clampDelay(usable.at(-1).delay);
}

export function buyerPaymentDelayModel(samples = [], level = 'Buyer', minimumSamples = 1, { today } = {}) {
  const usable = samples.filter((sample) => Number.isFinite(Number(sample?.delayDays)));
  if (!usable.length) return null;
  const effectiveToday = dateOnly(today) || new Date().toISOString().slice(0, 10);
  const percentiles = Object.fromEntries(Object.values(BUYER_PAYMENT_CONSERVATIVENESS).map((option) => [
    option.key,
    recencyWeightedPercentile(usable, option.percentile, effectiveToday),
  ]));
  return {
    level,
    predictedDelayDays: recencyWeightedDelay(usable, effectiveToday),
    weightedDelayDays: recencyWeightedDelay(usable, effectiveToday),
    percentiles,
    sampleCount: usable.length,
    minSamples: minimumSamples,
    confidence: modelConfidence(usable.length, minimumSamples),
  };
}

export function buildBuyerPaymentDelayModels(samples = [], settings = {}, { today } = {}) {
  const byBuyer = new Map();
  const byGroup = new Map();
  for (const sample of samples) {
    if (sample?.buyerAccountId) {
      if (!byBuyer.has(sample.buyerAccountId)) byBuyer.set(sample.buyerAccountId, []);
      byBuyer.get(sample.buyerAccountId).push(sample);
    }
    const key = groupKey(sample);
    if (key) {
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key).push(sample);
    }
  }
  const minBuyerSamples = Math.max(1, Number(settings.minBuyerSamples) || 3);
  const minGroupSamples = Math.max(1, Number(settings.minGroupSamples) || 5);
  const buyerModels = Object.fromEntries([...byBuyer.entries()].map(([id, rows]) => [
    id,
    buyerPaymentDelayModel(rows, 'Buyer', minBuyerSamples, { today }),
  ]).filter(([, model]) => model));
  const groupModels = Object.fromEntries([...byGroup.entries()].map(([key, rows]) => [
    key,
    buyerPaymentDelayModel(rows, 'Buyer Group', minGroupSamples, { today }),
  ]).filter(([, model]) => model));
  const globalModel = buyerPaymentDelayModel(samples, 'Global', 1, { today }) || {
    level: 'Default',
    predictedDelayDays: 0,
    weightedDelayDays: 0,
    percentiles: { typical: 0, cautious: 0, severe: 0 },
    sampleCount: 0,
    minSamples: 1,
    confidence: 'Low',
  };
  return { buyerModels, groupModels, globalModel };
}

export function selectBuyerPaymentDelayModel(row = {}, models = {}, settings = {}, options = {}) {
  const minBuyerSamples = Math.max(1, Number(settings.minBuyerSamples) || 3);
  const minGroupSamples = Math.max(1, Number(settings.minGroupSamples) || 5);
  const buyerModel = row.buyerAccountId ? models.buyerModels?.[row.buyerAccountId] : null;
  const groupModelKey = groupKey(row);
  const groupModel = groupModelKey ? models.groupModels?.[groupModelKey] : null;
  const selected = buyerModel?.sampleCount >= minBuyerSamples
    ? buyerModel
    : groupModel?.sampleCount >= minGroupSamples
      ? groupModel
      : models.globalModel;
  const conservativeness = options.conservativeness
    ? normalizeBuyerPaymentConservativeness(options.conservativeness)
    : null;
  const predictedDelayDays = conservativeness
    ? selected?.percentiles?.[conservativeness] ?? selected?.weightedDelayDays ?? 0
    : selected?.weightedDelayDays ?? selected?.predictedDelayDays ?? 0;
  return {
    ...selected,
    predictedDelayDays: clampDelay(predictedDelayDays),
    conservativeness,
    percentile: conservativeness ? BUYER_PAYMENT_CONSERVATIVENESS[conservativeness].percentile : null,
    percentileLabel: conservativeness ? BUYER_PAYMENT_CONSERVATIVENESS[conservativeness].percentileLabel : null,
  };
}
