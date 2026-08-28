import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSupabasePrometheusMetrics } from '../api/_supabaseMetrics.js';

const metrics = `
# HELP pg_stat_database_num_backends Current database connections
pg_stat_database_num_backends{datname="postgres"} 35
max_connections_connection_count 100
pgbouncer_up 1
pgbouncer_pools_waiting_clients{database="postgres"} 0
pgbouncer_pools_maxwait_seconds{database="postgres"} 0.4
node_memory_MemTotal_bytes 1000
node_memory_MemAvailable_bytes 150
node_filesystem_size_bytes{mountpoint="/data",fstype="ext4"} 1000
node_filesystem_avail_bytes{mountpoint="/data",fstype="ext4"} 250
pg_stat_database_blks_hit{datname="postgres"} 900
pg_stat_database_blks_read{datname="postgres"} 100
pg_stat_database_deadlocks{datname="postgres"} 2
`;

test('normalizes Supabase Prometheus database, pool, memory, disk, and cache KPIs', () => {
  const result = parseSupabasePrometheusMetrics(metrics);

  assert.equal(result.monitoringAvailable, true);
  assert.equal(result.severity, 'warning');
  assert.deepEqual(result.kpis, {
    databaseConnections: 35,
    maxConnections: 100,
    connectionUtilizationPercent: 35,
    pgbouncerUp: 1,
    waitingConnections: 0,
    maxWaitSeconds: 0.4,
    memoryUsedPercent: 85,
    diskUsedPercent: 75,
    databaseCacheHitPercent: 90,
    deadlocksTotal: 2,
  });
});

test('aggregates database values and uses a durable filesystem when /data is absent', () => {
  const result = parseSupabasePrometheusMetrics(`
pg_stat_database_numbackends{datname="postgres"} 12
pg_stat_database_numbackends{datname="app"} 8
pg_settings_max_connections 40
node_filesystem_size_bytes{mountpoint="/",fstype="ext4"} 800
node_filesystem_avail_bytes{mountpoint="/",fstype="ext4"} 160
node_filesystem_size_bytes{mountpoint="/run",fstype="tmpfs"} 100
node_filesystem_avail_bytes{mountpoint="/run",fstype="tmpfs"} 100
`);

  assert.equal(result.kpis.databaseConnections, 20);
  assert.equal(result.kpis.connectionUtilizationPercent, 50);
  assert.equal(result.kpis.diskUsedPercent, 80);
  assert.equal(result.severity, 'warning');
});

test('applies pool, capacity, and pgbouncer availability severities', () => {
  const waiting = parseSupabasePrometheusMetrics(`
pgbouncer_up 1
pgbouncer_waiting_connections 1
pgbouncer_max_wait_seconds 1.1
`);
  assert.equal(waiting.severity, 'critical');

  const pgbouncerDown = parseSupabasePrometheusMetrics('pgbouncer_up 0');
  assert.equal(pgbouncerDown.severity, 'unavailable');

  const capacity = parseSupabasePrometheusMetrics(`
pg_stat_database_num_backends 85
max_connections_connection_count 100
`);
  assert.equal(capacity.severity, 'critical');
});

test('keeps unavailable individual metrics null and treats malformed input as unavailable', () => {
  const partial = parseSupabasePrometheusMetrics('pg_stat_database_num_backends 3');
  assert.equal(partial.monitoringAvailable, true);
  assert.equal(partial.kpis.databaseConnections, 3);
  assert.equal(partial.kpis.maxConnections, null);
  assert.equal(partial.kpis.connectionUtilizationPercent, null);
  assert.equal(partial.kpis.diskUsedPercent, null);

  for (const input of ['', 'not prometheus', '# HELP only a comment', 'metric{bad="unterminated} 1', null]) {
    const result = parseSupabasePrometheusMetrics(input);
    assert.equal(result.monitoringAvailable, false);
    assert.equal(result.severity, 'monitoring_unavailable');
  }
});

test('rejects impossible capacity samples instead of reporting negative usage', () => {
  const result = parseSupabasePrometheusMetrics(`
node_memory_MemTotal_bytes 1000
node_memory_MemAvailable_bytes 1200
node_filesystem_size_bytes{mountpoint="/data",fstype="ext4"} 1000
node_filesystem_avail_bytes{mountpoint="/data",fstype="ext4"} 1760
`);

  assert.equal(result.monitoringAvailable, false);
  assert.equal(result.kpis.memoryUsedPercent, null);
  assert.equal(result.kpis.diskUsedPercent, null);
});
