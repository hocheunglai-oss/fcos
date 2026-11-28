import { createHash } from 'node:crypto';
import { marketPublicationEligible } from './_marketIntelligence.js';

export const MARKET_REPORT_FEEDS = [
  { key: 'bunkerwire', label: 'Bunkerwire', sessions: ['asia_moc', 'london_moc'] },
  { key: 'european_marketscan', label: 'European Marketscan', sessions: ['london_moc'] },
];
export const DELIVERY_OPERATION = 'market_report_delivery_check';
const DELIVERY_ALERT = 'market_report_delivery';
const DELIVERY_HOUR = 17;
const DAY_MS = 86_400_000;
const HKT_MS = 8 * 60 * 60 * 1000;
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Weekday general holidays from the Hong Kong Government gazettes.
const HK_HOLIDAYS = {
  2026: '01-01 02-17 02-18 02-19 04-03 04-06 04-07 05-01 05-25 06-19 07-01 10-01 10-19 12-25',
  2027: '01-01 02-08 02-09 03-26 03-29 04-05 05-13 06-09 07-01 09-16 10-01 10-08 12-27',
};
const dateOnly = (ms) => new Date(ms).toISOString().slice(0, 10);
const weekday = (ms) => ![0, 6].includes(new Date(ms).getUTCDay());

function deliveryWorkingDay(ms) {
  const date = dateOnly(ms);
  const holidays = HK_HOLIDAYS[date.slice(0, 4)];
  if (!holidays) return null;
  return weekday(ms) && !holidays.split(' ').includes(date.slice(5));
}

// Use the published local holiday calendars for delivery expectations in 2027.
// The canonical financial-assessment calendar remains separately governed.
const PUBLICATION_HOLIDAYS_2027 = {
  asia_moc: '01-01 02-08 03-10 03-26 05-17 05-20 08-09 10-28',
  london_moc: '01-01 03-26 03-29 05-03 05-31 08-30 12-27 12-28',
};

function publicationExpected(reportDate, session) {
  if (reportDate.startsWith('2027-')) return !PUBLICATION_HOLIDAYS_2027[session].split(' ').includes(reportDate.slice(5));
  return marketPublicationEligible(reportDate, session);
}

function nextWorkingDayCutoff(edition) {
  for (let offset = 1; offset <= 14; offset += 1) {
    const delivery = edition + offset * DAY_MS;
    const working = deliveryWorkingDay(delivery);
    if (working == null) return null;
    if (working) return new Date(delivery + DELIVERY_HOUR * 3_600_000 - HKT_MS).toISOString();
  }
  return null;
}

export function scheduledMarketEditions(now = new Date()) {
  const today = Date.parse(dateOnly(now.getTime() + HKT_MS));
  return MARKET_REPORT_FEEDS.flatMap(({ key, label, sessions }) => {
    const entries = [];
    for (let offset = 1; offset <= 14; offset += 1) {
      const edition = today - offset * DAY_MS;
      if (!weekday(edition)) continue;
      const reportDate = dateOnly(edition);
      const publications = sessions.map((session) => publicationExpected(reportDate, session));
      // The reviewed publication calendar does not establish an edition if any
      // relevant session is unknown and no relevant session is known open.
      if (!publications.includes(true)) {
        if (publications.includes(null)) break;
        continue;
      }
      const dueAt = nextWorkingDayCutoff(edition);
      if (!dueAt || (entries.length && entries[0].dueAt !== dueAt)) break;
      entries.push({ key, label, reportDate, dueAt });
    }
    return entries;
  });
}

export function expectedMarketDeliveries(now = new Date()) {
  const planned = scheduledMarketEditions(now);
  return MARKET_REPORT_FEEDS.map(({ key, label }) => planned.find((row) => row.key === key) || { key, label, reportDate: null, dueAt: null });
}

export function marketDeliveryStatus(expected, latestImport, snapshot, now) {
  if (!expected.reportDate) return { ...expected, status: 'calendar_unavailable' };
  if (latestImport?.report_date === expected.reportDate) {
    return { ...expected, status: 'imported', importedAt: latestImport.created_at || null };
  }
  if (now < new Date(expected.dueAt)) return { ...expected, status: 'awaiting_delivery' };
  const checked = snapshot?.feeds?.find((row) => row.key === expected.key && row.reportDate === expected.reportDate);
  return { ...expected, status: checked?.status === 'imported' ? 'awaiting_sync' : checked?.status || 'awaiting_sync',
    checkedAt: checked ? snapshot.checkedAt : null };
}

function assertResult(result) {
  if (result.error) {
    throw Object.assign(new Error('Markets delivery evidence could not be recorded or read.'), { code: 'MARKET_DELIVERY_CHECK_FAILED' });
  }
  return result.data;
}

async function recoverDeliveryAlerts(client, recovered) {
  if (!recovered.length) return 0;
  const dates = [...new Set(recovered.map(({ reportDate }) => reportDate))];
  const keys = new Set(recovered.map(({ key, reportDate }) => `${key}:${reportDate}`));
  const alerts = assertResult(await client.from('market_intelligence_alert_events')
    .select('id,report_date,evidence_metadata').eq('alert_type', DELIVERY_ALERT).in('report_date', dates)) || [];
  const matched = alerts.filter((row) => keys.has(`${row.evidence_metadata?.sourceType}:${row.report_date}`));
  if (!matched.length) return 0;
  const [usersResult, statesResult] = await Promise.all([
    client.from('user_profiles').select('id').eq('active', true),
    client.from('market_intelligence_alert_notification_states').select('alert_event_id,user_id')
      .in('alert_event_id', matched.map((row) => row.id)).not('handled_at', 'is', null),
  ]);
  const users = assertResult(usersResult) || [];
  const handled = new Set((assertResult(statesResult) || []).map((row) => `${row.alert_event_id}:${row.user_id}`));
  let recoveredCount = 0;
  for (const alert of matched) {
    for (const user of users) {
      if (handled.has(`${alert.id}:${user.id}`)) continue;
      assertResult(await client.rpc('set_market_intelligence_alert_notification_state', {
        p_alert_event_id: alert.id, p_user_id: user.id, p_state: 'handled', p_snoozed_until: null,
      }));
      recoveredCount += 1;
    }
  }
  return recoveredCount;
}

export async function scanMarketReportDeliveries(client, { now, runKey, files, failures, imported, scheduled = scheduledMarketEditions(now) }) {
  const due = scheduled.filter((row) => now >= new Date(row.dueAt));
  if (!due.length && !imported.length) return { published: 0, evaluated: 0, recovered: 0 };
  const dates = [...new Set(due.map((row) => row.reportDate))];
  const imports = dates.length ? assertResult(await client.from('market_report_imports')
    .select('report_date,source_document_type').eq('status', 'completed').in('report_date', dates)
    .in('source_document_type', MARKET_REPORT_FEEDS.map(({ key }) => key))) || [] : [];
  const recovered = [...imported];
  const rejected = new Set(failures.map(({ fileId }) => fileId));
  const results = due.map(({ key, reportDate, dueAt }) => {
    if (imports.some((row) => row.source_document_type === key && row.report_date === reportDate)) {
      recovered.push({ key, reportDate });
      return { key, reportDate, dueAt, status: 'imported' };
    }
    const candidates = files.filter((file) => file.documentType === key && file.reportDate === reportDate);
    if (!candidates.length) return { key, reportDate, dueAt, status: 'missing_from_drive' };
    return { key, reportDate, dueAt, status: candidates.every((file) => rejected.has(file.id)) ? 'import_failed' : 'awaiting_import' };
  });
  if (results.length) {
    const resultMetadata = { checkedAt: now.toISOString(), feeds: results };
    assertResult(await client.from('market_intelligence_operations').upsert({
      idempotency_key: `${DELIVERY_OPERATION}:${runKey}`,
      operation_type: DELIVERY_OPERATION, request_hash: hash(results),
      entity_id: 'platts-pdf-feeds', result_status: 'completed', result_metadata: resultMetadata,
      actor_email: 'market-sync@fcos.internal',
    }, { onConflict: 'idempotency_key', ignoreDuplicates: true }));
  }
  let published = 0;
  for (const feed of results.filter(({ status }) => ['missing_from_drive', 'import_failed'].includes(status))) {
    const label = MARKET_REPORT_FEEDS.find(({ key }) => key === feed.key).label;
    const alert = assertResult(await client.rpc('publish_market_intelligence_alert', {
      p_dedupe_key: hash([DELIVERY_ALERT, feed.key, feed.reportDate]), p_report_id: null, p_report_date: feed.reportDate,
      p_series_id: null, p_rule_version: 1, p_alert_type: DELIVERY_ALERT, p_severity: 'warning',
      p_title: `${label} delivery needs attention`,
      p_message: 'This edition did not import by its scheduled delivery check. Markets shows the current report status.',
      p_evidence_metadata: { sourceType: feed.key, dueAt: feed.dueAt },
    }));
    if (alert?.created) published += 1;
  }
  return { published, evaluated: results.length, recovered: await recoverDeliveryAlerts(client, recovered) };
}
