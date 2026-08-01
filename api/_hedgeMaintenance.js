import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { evaluateHedgeSfsCandidates, hedgeSfsHealth } from './_hedgeSfsService.js';

export const DEFAULT_ICE_MARGINS = Object.freeze({
  S05_FULL: { im: 64765, lotSize: 1000, unit: 'mt', label: 'VLSFO Full (1000mt)', code: 'MF4' },
  S05_MINI: { im: 6477, lotSize: 100, unit: 'mt', label: 'VLSFO Mini (100mt)', code: 'MFZ' },
  S05_MICRO: { im: 648, lotSize: 10, unit: 'mt', label: 'VLSFO Micro (10mt)', code: 'GNU' },
  S380_FULL: { im: 60520, lotSize: 1000, unit: 'mt', label: 'FO380 Full (1000mt)', code: 'SYS' },
  S380_MINI: { im: 6052, lotSize: 100, unit: 'mt', label: 'FO380 Mini (100mt)', code: 'SYY' },
  S380_MICRO: { im: 605, lotSize: 10, unit: 'mt', label: 'FO380 Micro (10mt)', code: 'GNX' },
  SGO_FULL: { im: 16728, lotSize: 1000, unit: 'bbl', label: 'Gasoil Full (1000bbl)', code: 'GST' },
  SGO_MINI: { im: 1673, lotSize: 100, unit: 'bbl', label: 'Gasoil Mini (100bbl)', code: 'GSR' },
});

const DEFAULT_ICE_SOURCES = Object.freeze({
  S05_FULL: { productId: '71085671', code: 'MF4', relativePeriod: 'M2' },
  S05_MINI: { productId: '72270608', code: 'MFZ', relativePeriod: 'M2' },
  S05_MICRO: { productId: '82280460', code: 'GNU', relativePeriod: 'M2' },
  S380_FULL: { productId: '6753551', code: 'SYS', relativePeriod: 'M2' },
  S380_MINI: { productId: '6753552', code: 'SYY', relativePeriod: 'M2' },
  S380_MICRO: { productId: '82280463', code: 'GNX', relativePeriod: 'M2' },
  SGO_FULL: { productId: '6753528', code: 'GST', relativePeriod: 'M2' },
  SGO_MINI: { productId: '65898860', code: 'GSR', relativePeriod: 'M2' },
});

const ICE_HEADERS = Object.freeze({
  accept: 'application/pdf,*/*',
  'user-agent': 'Mozilla/5.0 (compatible; FCOS-Hedge-Desk/1.0; +https://fcos.fcuno.com)',
});

function maintenanceError(message, status = 502) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseMoney(value) {
  return Math.abs(Number(String(value).replace(/[$,\s]/g, '')));
}

function parseSourceDate(value) {
  return String(value || '').match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/)?.[0] || null;
}

function sourceAgeDays(value, now = new Date()) {
  const timestamp = Date.parse(`${value} 00:00:00 GMT`);
  if (!Number.isFinite(timestamp)) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const source = new Date(timestamp);
  return Math.max(0, Math.floor((today - Date.UTC(source.getUTCFullYear(), source.getUTCMonth(), source.getUTCDate())) / 86400000));
}

export function extractIceMargin(text, source) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const pattern = new RegExp(`(?:\\b|IFEU)${source.code}\\s*MONTH\\s*${source.relativePeriod}(?!\\d)\\s*([A-Za-z]{3}-\\d{2})\\s*USD\\s*(-?[\\d,]+\\.\\d{2})\\s*(-?[\\d,]+\\.\\d{2})`, 'i');
  const line = lines.find((candidate) => pattern.test(candidate));
  if (!line) throw maintenanceError(`ICE did not provide the expected ${source.code} ${source.relativePeriod} margin row.`);
  const match = line.match(pattern);
  const longIm = parseMoney(match[2]);
  const shortIm = parseMoney(match[3]);
  const im = Math.round(Math.max(longIm, shortIm));
  if (!Number.isFinite(im) || im <= 0) throw maintenanceError(`ICE returned an invalid ${source.code} margin.`);
  return { im, expiry: match[1], longIm, shortIm };
}

export function validateIceMarginChanges(current, fetched, threshold = 0.25) {
  const changes = [];
  const blocked = [];
  for (const [key, next] of Object.entries(fetched)) {
    const previous = Number(current?.[key]?.im ?? DEFAULT_ICE_MARGINS[key]?.im ?? 0);
    if (!Number.isFinite(next.im) || next.im <= 0) {
      blocked.push(`${key} has an invalid value.`);
      continue;
    }
    const change = previous > 0 ? Math.abs(next.im - previous) / previous : null;
    if (change != null && change > threshold) blocked.push(`${key} changed ${(change * 100).toFixed(1)}%, above the ${(threshold * 100).toFixed(1)}% safety threshold.`);
    if (next.im !== previous) changes.push({ key, previous, next: next.im, change });
  }
  return { changes, blocked };
}

function iceSources(env) {
  if (!env.ICE_MARGIN_SOURCES_JSON) return DEFAULT_ICE_SOURCES;
  return { ...DEFAULT_ICE_SOURCES, ...JSON.parse(env.ICE_MARGIN_SOURCES_JSON) };
}

async function loadSetting(client, key) {
  const result = await client.from('hedge_settings').select('*').eq('key', key).maybeSingle();
  if (result.error) throw maintenanceError(`Hedge setting ${key} could not be loaded: ${result.error.message}`);
  return result.data || null;
}

async function saveSetting(client, key, value, label, notes) {
  const existing = await loadSetting(client, key);
  const result = existing
    ? await client.from('hedge_settings').update({ value, label, notes, updated_by_id: null }).eq('id', existing.id)
    : await client.from('hedge_settings').insert({ key, value, label, notes, created_by: 'system' });
  if (result.error) throw maintenanceError(`Hedge setting ${key} could not be saved: ${result.error.message}`);
}

async function writeEvent(client, type, label, metadata = {}) {
  const result = await client.from('hedge_events').insert({
    event_type: type,
    entity_type: 'System',
    entity_legacy_id: 'ice_margins',
    label,
    metadata,
    actor_email: 'system',
    source: 'fcos',
  });
  if (result.error) throw maintenanceError(`Hedge maintenance audit failed: ${result.error.message}`);
}

async function writeHealth(client, serviceKey, label, status, detail, metadata = {}, checkedAt = new Date().toISOString()) {
  const result = await client.from('hedge_health_history').insert({
    service_key: serviceKey,
    label,
    category: 'Hedge Desk',
    status,
    detail,
    checked_at: checkedAt,
    metadata,
  });
  if (result.error) throw maintenanceError(`Hedge health history could not be saved: ${result.error.message}`);
}

async function fetchIceSource(source, fetchImpl) {
  const url = `https://www.ice.com/api/productguide/margin-rates/${source.productId}/pdf`;
  const response = await fetchImpl(url, { headers: ICE_HEADERS, signal: AbortSignal.timeout(20_000) });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok || buffer.subarray(0, 4).toString('utf8') !== '%PDF') throw maintenanceError(`ICE PDF request failed for ${source.code} (${response.status}).`);
  const parsed = await pdfParse(buffer);
  return { text: parsed.text || '', url };
}

export async function updateHedgeIceMargins(client, { env = process.env, fetchImpl = fetch, dryRun = false, now = new Date() } = {}) {
  const sources = iceSources(env);
  const thresholdValue = Number(env.ICE_MARGIN_MAX_CHANGE_PCT || 0.25);
  const maxAgeValue = Number(env.ICE_MARGIN_MAX_SOURCE_AGE_DAYS || 14);
  const threshold = Number.isFinite(thresholdValue) && thresholdValue > 0 ? thresholdValue : 0.25;
  const maxAge = Number.isFinite(maxAgeValue) && maxAgeValue > 0 ? maxAgeValue : 14;
  const fetched = {};
  const sourceDates = {};
  const sourceUrls = {};
  const sourceAges = {};

  for (const [key, source] of Object.entries(sources)) {
    const downloaded = await fetchIceSource(source, fetchImpl);
    const sourceDate = parseSourceDate(downloaded.text);
    if (!sourceDate) throw maintenanceError(`ICE source date is missing for ${source.code}.`);
    const age = sourceAgeDays(sourceDate, now);
    if (age == null) throw maintenanceError(`ICE source date is invalid for ${source.code}.`);
    fetched[key] = extractIceMargin(downloaded.text, source);
    sourceDates[key] = sourceDate;
    sourceUrls[key] = downloaded.url;
    sourceAges[key] = age;
  }

  const currentRow = await loadSetting(client, 'ice_margins');
  const current = currentRow?.value || DEFAULT_ICE_MARGINS;
  const validation = validateIceMarginChanges(current, fetched, threshold);
  const stale = Object.entries(sourceAges).filter(([, age]) => age > maxAge);
  if (stale.length) validation.blocked.push(`ICE source data exceeds ${maxAge} days for ${stale.map(([key]) => key).join(', ')}.`);
  const checkedAt = now.toISOString();
  if (validation.blocked.length) {
    const status = { status: 'blocked', checked_at: checkedAt, source_dates: sourceDates, changes: validation.changes, blocked: validation.blocked };
    if (!dryRun) {
      await saveSetting(client, 'ice_margin_status', status, 'ICE Margin Automation Status', 'Latest guarded ICE margin refresh result');
      await writeEvent(client, 'ice_margin_update_blocked', 'ICE margin refresh was blocked by safety validation.', { blocked: validation.blocked, changeCount: validation.changes.length });
      await writeHealth(client, 'ice_margins', 'ICE margin automation', 'Warning', validation.blocked.join(' '), { changeCount: validation.changes.length }, checkedAt);
    }
    return { ok: false, ...status };
  }

  const next = Object.fromEntries(Object.entries(DEFAULT_ICE_MARGINS).map(([key, spec]) => [key, {
    ...spec,
    ...(current?.[key] || {}),
    im: fetched[key].im,
    source: { ...sources[key], expiry: fetched[key].expiry, sourceDate: sourceDates[key], url: sourceUrls[key] },
  }]));
  next._meta = { updated_at: checkedAt, source_dates: sourceDates, source: 'ICE Product Guide Margin Rates PDFs', relative_period: 'M2' };
  const statusName = validation.changes.length ? 'auto_applied' : 'no_change';
  const status = { status: statusName, checked_at: checkedAt, source_dates: sourceDates, changes: validation.changes };
  if (!dryRun) {
    await saveSetting(client, 'ice_margins', next, 'ICE Initial Margin Rates', 'Automatically refreshed from guarded ICE margin PDFs');
    await saveSetting(client, 'ice_margin_status', status, 'ICE Margin Automation Status', 'Latest guarded ICE margin refresh result');
    await writeEvent(client, validation.changes.length ? 'ice_margin_auto_update' : 'ice_margin_no_change', `ICE margins checked with ${validation.changes.length} change(s).`, { changeCount: validation.changes.length });
    await writeHealth(client, 'ice_margins', 'ICE margin automation', 'Online', `ICE margins checked with ${validation.changes.length} change(s).`, { changeCount: validation.changes.length }, checkedAt);
  }
  return { ok: true, ...status };
}

function hongKongWeekday(now) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Hong_Kong', weekday: 'short' }).format(now);
}

export async function runHedgeMaintenance(client, { forceIce = false, dryRun = false, env = process.env, fetchImpl = fetch, now = new Date() } = {}) {
  const iceDue = forceIce || hongKongWeekday(now) === 'Mon';
  let ice = { skipped: true, reason: 'ICE refresh runs on Monday Hong Kong time.' };
  if (iceDue) {
    try {
      ice = await updateHedgeIceMargins(client, { env, fetchImpl, dryRun, now });
    } catch (error) {
      ice = { ok: false, error: error.message };
      if (!dryRun) await writeHealth(client, 'ice_margins', 'ICE margin automation', 'Critical', error.message, {}, now.toISOString()).catch(() => {});
    }
  }
  const sfs = await evaluateHedgeSfsCandidates(client, { dryRun, now });
  const sfsHealth = await hedgeSfsHealth(client);
  if (!dryRun) {
    await writeHealth(client, 'sfs_reports', 'SFS monthly reports', sfsHealth.status, sfsHealth.detail, { evaluatedMonths: sfs.length }, now.toISOString());
    await client.from('hedge_integration_operations').delete().lt('expires_at', now.toISOString());
  }
  return { ok: ice.ok !== false && sfsHealth.status !== 'Unavailable', ice, sfs, sfsHealth };
}
