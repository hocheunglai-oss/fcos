import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMarketSourceHealth } from '../api/_marketSourceHealth.js';

function clientFor({ code = 'MARKET_SECONDARY_CSV_EMPTY_SERIES', status = 'failed', startedAt = '2026-09-17T10:00:00Z', fail = false } = {}) {
  return { from(table) {
    const query = {
      select() { return query; }, order() { return query; }, eq() { return query; },
      limit() { return Promise.resolve({ error: fail ? new Error('private details') : null, data: table === 'market_report_sync_runs'
        ? [{ status, error_code: code, started_at: startedAt }]
        : [{ report_date: table === 'market_report_imports' ? '2026-09-16' : null, created_at: '2026-09-17T09:00:00Z' }] }); },
    };
    return query;
  } };
}
const now = new Date('2026-09-17T10:30:00Z');

test('a failed secondary export is distinguished from available dated PDF imports', async () => {
  const result = await loadMarketSourceHealth(clientFor(), { now });
  assert.equal(result.status, 'warning');
  assert.deepEqual(result.sources.map((row) => row.status), ['available', 'available', 'warning']);
  assert.equal(result.sources[0].lastPublicationDate, '2026-09-16');
  assert.match(result.sources[2].message, /PPXDK00/);
  assert.match(result.sources[2].message, /replace the incomplete CSV/);
  assert.equal(result.sources[2].lastPublicationDate, null);
});

test('source status independently reports outages, stale checks, recovery, and unavailable diagnostics', async () => {
  const failed = await loadMarketSourceHealth(clientFor({ code: 'MARKET_DRIVE_AUTH_FAILED' }), { now });
  assert.equal(failed.status, 'warning');
  assert.match(failed.message, /latest source sync failed/);
  const stale = await loadMarketSourceHealth(clientFor({ status: 'completed', startedAt: '2026-09-17T07:00:00Z' }), { now });
  assert.equal(stale.status, 'warning'); assert.match(stale.message, /overdue/);
  const recovered = await loadMarketSourceHealth(clientFor({ status: 'completed', code: null }), { now });
  assert.equal(recovered.status, 'available');
  assert.equal(recovered.sources[2].status, 'available');
  const unavailable = await loadMarketSourceHealth(clientFor({ fail: true }), { now });
  assert.equal(unavailable.status, 'unavailable'); assert.deepEqual(unavailable.sources, []);
  assert.equal(JSON.stringify(unavailable).includes('private'), false);
});
