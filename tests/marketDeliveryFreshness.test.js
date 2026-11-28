import assert from 'node:assert/strict';
import test from 'node:test';
import { expectedMarketDeliveries, marketDeliveryStatus, scanMarketReportDeliveries } from '../api/_marketDeliveryFreshness.js';

const before = new Date('2026-11-30T08:59:59Z');
const after = new Date('2026-11-30T09:00:35Z');
const friday = '2026-11-27';

function memoryClient() {
  const alerts = new Map();
  const snapshots = new Map();
  const handled = new Set();
  const imports = [];
  return {
    alerts, snapshots, handled, imports,
    from(table) {
      const filters = {};
      const query = {
        select() { return query; },
        eq(key, value) { filters[key] = [value]; return query; },
        in(key, values) { filters[key] = values; return query; },
        not() { return query; },
        upsert(row) {
          snapshots.set(row.idempotency_key, row.result_metadata);
          return Promise.resolve({ data: null });
        },
        then(resolve, reject) {
          const rows = {
            market_report_imports: imports,
            market_intelligence_alert_events: [...alerts.values()],
            user_profiles: [{ id: 'active-user', active: true }],
            market_intelligence_alert_notification_states: [...handled].map(alert_event_id => ({ alert_event_id, user_id: 'active-user' })),
          }[table];
          const data = rows.filter((row) => Object.entries(filters).every(([key, values]) => values.includes(row[key])));
          return Promise.resolve({ data }).then(resolve, reject);
        },
      };
      return query;
    },
    async rpc(name, input) {
      if (name === 'set_market_intelligence_alert_notification_state') {
        assert.equal(input.p_state, 'handled');
        handled.add(input.p_alert_event_id);
        return { data: {} };
      }
      assert.equal(name, 'publish_market_intelligence_alert');
      const key = input.p_dedupe_key;
      const created = !alerts.has(key);
      if (created) alerts.set(key, { id: key, alert_type: input.p_alert_type, report_date: input.p_report_date, evidence_metadata: input.p_evidence_metadata });
      return { data: { created } };
    },
  };
}

test('Friday editions wait for the Monday 17:00 HKT delivery sync', () => {
  const [feed] = expectedMarketDeliveries(new Date('2026-11-28T09:30:00Z'));
  assert.equal(feed.reportDate, friday);
  assert.equal(feed.dueAt, '2026-11-30T09:00:00.000Z');
  assert.equal(marketDeliveryStatus(feed, null, null, before).status, 'awaiting_delivery');
  assert.equal(marketDeliveryStatus(feed, null, null, after).status, 'awaiting_sync');
  assert.equal(marketDeliveryStatus(feed, { report_date: friday, created_at: '2026-11-30T08:10:00Z' }, null, before).status, 'imported');
});

test('a Hong Kong holiday delays delivery without omitting the earlier edition', async () => {
  const now = new Date('2026-10-02T09:01:00Z');
  const client = memoryClient();
  await scanMarketReportDeliveries(client, { now, runKey: 'october', files: [], failures: [], imported: [] });
  const snapshot = [...client.snapshots.values()][0];
  assert.deepEqual(snapshot.feeds.filter((row) => row.key === 'european_marketscan').map((row) => row.reportDate), ['2026-10-01', '2026-09-30']);
});

test('delivery reports missing files and rejected PDFs separately, deduplicates alerts, and clears only the recovered edition', async () => {
  const client = memoryClient();
  const files = [{ id: 'expected-eum', documentType: 'european_marketscan', reportDate: friday }];
  const failures = [{ fileId: 'expected-eum' }];
  const options = { files, failures, imported: [] };
  assert.equal((await scanMarketReportDeliveries(client, { ...options, now: before, runKey: 'too-early' })).published, 0);
  assert.equal(client.snapshots.size, 0);
  assert.equal((await scanMarketReportDeliveries(client, { ...options, now: after, runKey: 'first' })).published, 2);
  const snapshot = [...client.snapshots.values()][0];
  assert.deepEqual(snapshot.feeds.map(({ status }) => status), ['missing_from_drive', 'import_failed']);
  assert.equal((await scanMarketReportDeliveries(client, { ...options, now: after, runKey: 'next' })).published, 0);
  client.imports.push({ source_document_type: 'european_marketscan', report_date: friday, status: 'completed' });
  assert.equal((await scanMarketReportDeliveries(client, { ...options, now: after, runKey: 'recover' })).recovered, 1);
  const handled = [...client.alerts.values()].find(({ id }) => client.handled.has(id));
  assert.equal(handled.evidence_metadata.sourceType, 'european_marketscan');
  assert.equal((await scanMarketReportDeliveries(client, { ...options, now: after, runKey: 'already-handled' })).recovered, 0);
});

test('an available but deferred PDF remains awaiting import without a rejection alert', async () => {
  const client = memoryClient();
  const files = ['bunkerwire', 'european_marketscan'].map((documentType) => ({ id: documentType, documentType, reportDate: friday }));
  assert.equal((await scanMarketReportDeliveries(client, { now: after, runKey: 'deferred', files, failures: [], imported: [] })).published, 0);
  assert.deepEqual([...client.snapshots.values()][0].feeds.map(({ status }) => status), ['awaiting_import', 'awaiting_import']);
});
