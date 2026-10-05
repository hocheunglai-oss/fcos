import { createHash } from 'node:crypto';
import { marketPublicationEligible, nextMarketPublicationDate } from './_marketIntelligence.js';

const numeric = (value) => value == null || String(value).trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const round = (value) => Math.round(value * 1e6) / 1e6;
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const EMPTY_MARKET_PREFERENCES = Object.freeze({ pins: [], comparisons: [], subscriptions: [] });
export function traderError(message, statusCode = 400, code = 'MARKET_TRADER_INVALID') { return Object.assign(new Error(message), { statusCode, code }); }
function expectedDate(date, session) {
  const cursor = new Date(`${date}T00:00:00Z`);
  for (let index = 0; index < 16; index += 1) {
    const candidate = cursor.toISOString().slice(0, 10); const valid = marketPublicationEligible(candidate, session);
    if (valid == null) return null;
    if (valid) return candidate;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return null;
}

export function buildTraderSeries({ definitions = [], observations = [], imports = [], conflicts = [], endDate }) {
  const definitionsById = new Map(definitions.filter((row) => row.active !== false && row.source_type !== 'unavailable').map((row) => [row.id, row]));
  const importsById = new Map(imports.filter((row) => row.status === 'completed').map((row) => [row.id, row]));
  const quarantined = new Set(conflicts.map((row) => `${row.series_id}:${row.price_date}`));
  const groups = new Map();
  for (const row of observations) {
    const definition = definitionsById.get(row.series_id); const source = importsById.get(row.import_id);
    const value = numeric(row.price);
    if (!definition || !source || row.quality_status !== 'verified' || value == null || row.price_date > endDate
      || source.report_date !== row.price_date || source.source_hash !== row.source_hash
      || row.basis_metadata?.publicationEligible === false || quarantined.has(`${row.series_id}:${row.price_date}`)) continue;
    const productKey = row.basis_metadata?.productKey || definition.basis_metadata?.productKey || definition.product_key;
    const family = row.basis_metadata?.marketFamily || definition.basis_metadata?.marketFamily || definition.market_family;
    const unit = String(row.observation_unit || definition.unit || '').toUpperCase();
    const session = row.assessment_session || definition.assessment_session;
    const month = /^\d{4}-(0[1-9]|1[0-2])-01$/.test(String(row.contract_month || '')) ? row.contract_month.slice(0, 7) : null;
    if (!['USD/MT', 'USD/BBL'].includes(unit) || (family === 'forward' && !month)) continue;
    const basis = row.basis_metadata?.settlementBasis || definition.basis_metadata?.settlementBasis || '';
    const kind = definition.value_kind || 'absolute';
    const key = family === 'forward' && kind === 'absolute'
      ? ['forward', productKey, month, unit, session, basis].join('|')
      : [definition.id, month || 'spot', unit, session, basis].join('|');
    if (!groups.has(key)) groups.set(key, { key, label: [definition.port_label, definition.product_label || productKey, family === 'cargo' ? 'MOPS' : family === 'forward' ? month : definition.alias_label, kind === 'spread' ? 'spread' : null].filter(Boolean).join(' · '),
      productKey, portKey: definition.port_key || null, contractMonth: month, unit, session, currency: definition.currency_code,
      sourceType: definition.source_type, valueKind: kind, family, sourceSymbol: definition.source_symbol, byDate: new Map() });
    const target = groups.get(key); const candidates = target.byDate.get(row.price_date) || [];
    candidates.push({ date: row.price_date, value, sourceHash: row.source_hash, sourcePage: row.source_page, sourceSymbol: definition.source_symbol, source: source.source_document_type });
    target.byDate.set(row.price_date, candidates);
  }
  return [...groups.values()].map(({ byDate, ...series }) => {
    const points = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([, entries]) => {
      // Conflicting same-date values are omitted rather than choosing an edition.
      if (new Set(entries.map((entry) => entry.value)).size > 1) return [];
      const ordered = entries.sort((a, b) => a.sourceHash.localeCompare(b.sourceHash) || a.sourceSymbol.localeCompare(b.sourceSymbol));
      return [{ ...ordered[0], fingerprint: hash(ordered.map((row) => [row.sourceHash, row.sourceSymbol, row.sourcePage, row.value])) }];
    });
    const latest = points.at(-1) || null; const previous = points.at(-2) || null;
    const consecutive = previous && nextMarketPublicationDate(previous.date, series.session) === latest?.date;
    return { ...series, points, latest, sourceSymbol: latest?.sourceSymbol || series.sourceSymbol,
      change: consecutive ? round(latest.value - previous.value) : null, previousDate: previous?.date || null,
      stale: !latest || latest.date !== expectedDate(endDate, series.session) };
  }).sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
}

function compatible(left, right) {
  return left && right && left.unit === right.unit && left.currency === right.currency && left.session === right.session && left.sourceType === right.sourceType && left.valueKind === right.valueKind;
}
export function buildTraderComparison(spec, series) {
  const left = series.find((row) => row.key === spec.leftKey); const right = series.find((row) => row.key === spec.rightKey);
  if (!left || !right) return { ...spec, available: false, reason: 'A selected series has no verified observations in the current 90-day window.', points: [] };
  if (!compatible(left, right)) return { ...spec, available: false, reason: 'Choose matching units, currency, assessment sessions and price types. No automatic conversion is applied.', points: [] };
  const rhs = new Map(right.points.map((row) => [row.date, row]));
  const points = left.points.filter((row) => rhs.has(row.date)).map((row) => ({ date: row.date, value: round(row.value - rhs.get(row.date).value), leftValue: row.value, rightValue: rhs.get(row.date).value, leftSource: row, rightSource: rhs.get(row.date) }));
  const values = points.map((row) => row.value);
  return { ...spec, available: Boolean(points.length), reason: points.length ? null : 'No matching verified publication dates.', unit: left.unit, points, latest: points.at(-1) || null,
    range: values.length ? { low: Math.min(...values), high: Math.max(...values), average: round(values.reduce((sum, value) => sum + value, 0) / values.length), samples: values.length } : null };
}

export function normalizeTraderPreferences(input, series, previous = EMPTY_MARKET_PREFERENCES) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw traderError('Choose valid personal market preferences.');
  const list = (key, max) => { if (!Array.isArray(input[key]) || input[key].length > max) throw traderError(`${key} allows up to ${max} entries.`); return input[key]; };
  const known = new Set(series.map((row) => row.key));
  // An expired selection may be retained or removed without blocking unrelated edits.
  const key = (value, retained = []) => { if (typeof value !== 'string' || value.length > 240 || (!known.has(value) && !retained.includes(value))) throw traderError('A selected market series is unavailable. Reload and select it again.'); return value; };
  const id = (value) => { if (!/^[a-zA-Z0-9_-]{1,80}$/.test(String(value || '')) || ['__proto__', 'prototype', 'constructor'].includes(value)) throw traderError('Invalid saved item identifier.'); return value; };
  const pins = [...new Set(list('pins', 20).map((value) => key(value, previous.pins || [])))];
  const comparisons = list('comparisons', 10).map((row) => {
    const old = previous.comparisons?.find((item) => item.id === row?.id);
    const retained = old?.leftKey === row?.leftKey && old?.rightKey === row?.rightKey ? [old.leftKey, old.rightKey] : [];
    const result = { id: id(row?.id), label: String(row?.label || '').trim(), leftKey: key(row?.leftKey, retained), rightKey: key(row?.rightKey, retained) };
    if (!result.label || result.label.length > 80 || result.leftKey === result.rightKey) throw traderError('Give the comparison a name and choose two different series.');
    if ((known.has(result.leftKey) && known.has(result.rightKey)) && !compatible(series.find((entry) => entry.key === result.leftKey), series.find((entry) => entry.key === result.rightKey))) throw traderError('Comparison series must have matching units, currency, assessment sessions and price types.');
    return result;
  });
  const subscriptions = list('subscriptions', 20).map((row) => {
    const threshold = numeric(row?.threshold);
    if (threshold == null || threshold <= 0 || threshold > 1000000 || !['either', 'up', 'down'].includes(row?.direction)) throw traderError('Choose a positive alert threshold and direction.');
    const old = previous.subscriptions?.find((item) => item.id === row?.id);
    return { id: id(row?.id), seriesKey: key(row?.seriesKey, old ? [old.seriesKey] : []), threshold, direction: row.direction };
  });
  if (new Set(comparisons.map((row) => row.id)).size !== comparisons.length || new Set(subscriptions.map((row) => row.id)).size !== subscriptions.length) throw traderError('Saved item identifiers must be unique.');
  return { pins, comparisons, subscriptions };
}
export function traderBaseline(series) { return Object.fromEntries(series.filter((row) => row.latest).map((row) => [row.key, { date: row.latest.date, value: row.latest.value, fingerprint: row.latest.fingerprint }])); }
export function traderComparisonBaseline(preferences, series) { return Object.fromEntries((preferences?.comparisons || []).map((spec) => buildTraderComparison(spec, series)).filter((row) => row.latest).map((row) => [row.id, { leftKey: row.leftKey, rightKey: row.rightKey, date: row.latest.date, value: row.latest.value, fingerprint: hash([row.latest.leftSource?.fingerprint, row.latest.rightSource?.fingerprint]) }])); }
export function buildTraderWorkspace({ state = {}, revision = 0, series = [], visitId = '', now = new Date() }) {
  const preferences = state.preferences || { ...EMPTY_MARKET_PREFERENCES };
  const previous = state.visit?.id === visitId ? state.visit.previous : state.visit?.current;
  const previousVisitAt = state.visit?.id === visitId ? state.visit.previousAt : state.visit?.at;
  const selected = preferences.pins.length ? series.filter((row) => preferences.pins.includes(row.key)) : series;
  const changes = !previousVisitAt ? [] : selected.flatMap((row) => {
    const prior = previous?.[row.key]; const point = row.latest;
    if (!point || (prior && point.date < prior.date) || (prior?.date === point.date && prior.fingerprint === point.fingerprint)) return [];
    return [{ key: row.key, label: row.label, kind: prior?.date === point.date ? 'source_correction' : 'new_assessment', date: point.date, value: point.value,
      previousValue: prior?.value ?? null, change: prior ? round(point.value - prior.value) : null, unit: row.unit, sourceSymbol: point.sourceSymbol, sourcePage: point.sourcePage }];
  });
  const comparisons = preferences.comparisons.map((spec) => buildTraderComparison(spec, series));
  const priorComparisons = state.visit?.id === visitId ? state.visit.previousComparisons : state.visit?.currentComparisons;
  if (previousVisitAt) for (const row of comparisons) {
    const prior = priorComparisons?.[row.id]; const point = row.latest;
    if (!prior || !point || prior.leftKey !== row.leftKey || prior.rightKey !== row.rightKey || point.date < prior.date || point.value === prior.value) continue;
    changes.push({ key: `comparison:${row.id}`, label: row.label, kind: 'spread_move', date: point.date, value: point.value, previousValue: prior.value, change: round(point.value - prior.value), unit: row.unit, sourceSymbol: [point.leftSource.sourceSymbol, point.rightSource.sourceSymbol].join(' − '), sourcePage: null });
  }
  const alerts = preferences.subscriptions.flatMap((rule) => {
    const row = series.find((entry) => entry.key === rule.seriesKey);
    if (!row || row.stale || row.change == null || Math.abs(row.change) < rule.threshold || (rule.direction === 'up' && row.change <= 0) || (rule.direction === 'down' && row.change >= 0)) return [];
    const eventKey = hash([rule, row.latest.date, row.latest.fingerprint]); const status = Object.hasOwn(state.alertState || {}, rule.id) ? state.alertState[rule.id] : {};
    return [{ id: rule.id, eventKey, seriesKey: row.key, label: row.label, date: row.latest.date, change: row.change, unit: row.unit,
      acknowledged: status.acknowledgedEventKey === eventKey, snoozedUntil: status.snoozedEventKey === eventKey && Date.parse(status.snoozedUntil) > now.getTime() ? status.snoozedUntil : null,
      sourceSymbol: row.latest.sourceSymbol, sourcePage: row.latest.sourcePage }];
  });
  return { generatedAt: now.toISOString(), revision: Number(revision), preferences, series, pinned: preferences.pins.map((key) => series.find((row) => row.key === key) || { key, label: 'Saved series unavailable', points: [], latest: null, change: null }),
    comparisons, changes, alerts, previousVisitAt: previousVisitAt || null,
    warnings: selected.some((row) => row.stale) ? ['Some series are older than the expected publication date. Personal alerts exclude stale prices.'] : [] };
}
