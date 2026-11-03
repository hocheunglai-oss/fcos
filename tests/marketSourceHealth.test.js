import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMarketSourceHealth } from '../api/_marketSourceHealth.js';

function clientFor({
  code = 'MARKET_SECONDARY_CSV_EMPTY_SERIES_PPXDK00',
  status = 'failed',
  startedAt = '2026-09-17T10:00:00Z',
  fail = false,
  secondary = {
    id: 'secondary-import-1',
    status: 'completed_with_conflicts',
    source_row_count: 428,
    comparison_date_count: 299,
    published_date_count: 1,
    matched_date_count: 426,
    conflict_date_count: 1,
    created_at: '2026-09-16T09:00:00Z',
  },
} = {}) {
  return {
    from(table) {
      const filters = {};
      const query = {
        select() { return query; },
        order() { return query; },
        eq(column, value) { filters[column] = value; return query; },
        in() { return query; },
        limit() {
          let data;
          if (table === 'market_report_sync_runs') {
            data = [{ status, error_code: code, started_at: startedAt, completed_at: startedAt }];
          } else if (table === 'market_report_imports') {
            data = [{ report_date: '2026-09-16', created_at: '2026-09-17T09:00:00Z' }];
          } else if (table === 'market_mops_secondary_imports') {
            data = secondary ? [secondary] : [];
          } else if (table === 'market_mops_secondary_evidence') {
            assert.equal(filters.import_id, secondary?.id);
            assert.equal(filters.outcome, 'published');
            data = [{ report_date: '2026-09-16' }];
          } else {
            throw new Error(`Unexpected table ${table}`);
          }
          return Promise.resolve({ error: fail ? new Error('private details') : null, data });
        },
      };
      return query;
    },
  };
}
const now = new Date('2026-09-17T10:30:00Z');

test('a failed secondary attempt retains the last successful import, coverage, and actual missing series', async () => {
  const result = await loadMarketSourceHealth(clientFor(), { now });
  assert.equal(result.status, 'warning');
  assert.deepEqual(result.sources.map((row) => row.status), ['available', 'available', 'warning']);
  assert.equal(result.sources[0].lastPublicationDate, '2026-09-16');
  assert.equal(result.sources[2].lastSuccessAt, '2026-09-16T09:00:00Z');
  assert.equal(result.sources[2].lastPublicationDate, '2026-09-16');
  assert.equal(result.sources[2].successfulImportStatus, 'completed_with_conflicts');
  assert.deepEqual(result.sources[2].coverage, {
    sourceRowCount: 428,
    comparisonDateCount: 299,
    publishedDateCount: 1,
    matchedDateCount: 426,
    conflictDateCount: 1,
  });
  assert.deepEqual(result.sources[2].lastAttemptError.affectedSeries, ['PPXDK00']);
  assert.match(result.sources[2].lastAttemptError.message, /PPXDK00/);
  assert.match(result.sources[2].message, /428 complete source dates/);
  assert.equal(result.lastAttempt.errorCode, 'MARKET_SECONDARY_CSV_EMPTY_SERIES_PPXDK00');
});

test('source status independently reports outages, stale checks, recovery, and unavailable diagnostics', async () => {
  const failed = await loadMarketSourceHealth(clientFor({ code: 'MARKET_DRIVE_AUTH_FAILED' }), { now });
  assert.equal(failed.status, 'warning');
  assert.match(failed.message, /latest source sync failed/);
  assert.equal(failed.lastAttempt.errorCode, 'MARKET_DRIVE_AUTH_FAILED');
  const stale = await loadMarketSourceHealth(clientFor({ status: 'completed', startedAt: '2026-09-17T07:00:00Z' }), { now });
  assert.equal(stale.status, 'warning');
  assert.match(stale.message, /overdue/);
  const recovered = await loadMarketSourceHealth(clientFor({
    status: 'completed',
    code: null,
    secondary: {
      id: 'secondary-import-2',
      status: 'completed',
      source_row_count: 428,
      comparison_date_count: 299,
      published_date_count: 1,
      matched_date_count: 427,
      conflict_date_count: 0,
      created_at: '2026-09-17T09:00:00Z',
    },
  }), { now });
  assert.equal(recovered.status, 'available');
  assert.equal(recovered.sources[2].status, 'available');
  assert.equal(recovered.sources[2].lastAttemptError, null);
  const unavailable = await loadMarketSourceHealth(clientFor({ fail: true }), { now });
  assert.equal(unavailable.status, 'unavailable');
  assert.deepEqual(unavailable.sources, []);
  assert.equal(JSON.stringify(unavailable).includes('private'), false);
});

test('a secondary failure without a prior successful import remains explicit without inventing coverage', async () => {
  const result = await loadMarketSourceHealth(clientFor({ secondary: null }), { now });
  assert.equal(result.sources[2].status, 'warning');
  assert.equal(result.sources[2].lastSuccessAt, null);
  assert.equal(result.sources[2].coverage, null);
  assert.deepEqual(result.sources[2].lastAttemptError.affectedSeries, ['PPXDK00']);
});
