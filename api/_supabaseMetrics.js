const THRESHOLDS = Object.freeze({
  warning: 70,
  critical: 85,
  memoryWarning: 80,
  memoryCritical: 90,
  maxWaitCriticalSeconds: 1,
});

const METRIC_NAMES = Object.freeze({
  databaseConnections: new Set([
    'pg_stat_database_num_backends',
    'pg_stat_database_numbackends',
  ]),
  maxConnections: new Set([
    'max_connections_connection_count',
    'pg_settings_max_connections',
    'pg_max_connections',
  ]),
  pgbouncerUp: new Set(['pgbouncer_up']),
  waitingConnections: new Set([
    'pgbouncer_waiting_connections',
    'pgbouncer_pools_waiting_clients',
    'pgbouncer_pools_waiting_connections',
    'pgbouncer_pools_client_waiting_connections',
  ]),
  maxWaitSeconds: new Set([
    'pgbouncer_max_wait_seconds',
    'pgbouncer_pools_maxwait_seconds',
    'pgbouncer_pools_max_wait_seconds',
    'pgbouncer_pools_client_maxwait_seconds',
  ]),
  memoryTotal: new Set(['node_memory_MemTotal_bytes', 'mem_total_bytes']),
  memoryAvailable: new Set(['node_memory_MemAvailable_bytes', 'mem_available_bytes']),
  diskSize: new Set(['node_filesystem_size_bytes', 'disk_total_bytes']),
  diskAvailable: new Set([
    'node_filesystem_avail_bytes',
    'node_filesystem_free_bytes',
    'disk_free_bytes',
  ]),
  cacheHits: new Set(['pg_stat_database_blks_hit', 'pg_stat_database_blks_hit_total']),
  cacheReads: new Set(['pg_stat_database_blks_read', 'pg_stat_database_blks_read_total']),
  deadlocks: new Set(['pg_stat_database_deadlocks', 'pg_stat_database_deadlocks_total']),
});

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function percentage(used, total) {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return null;
  return (used / total) * 100;
}

function sum(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

function max(values) {
  return values.length ? Math.max(...values) : null;
}

function parseLabels(source) {
  const labels = Object.create(null);
  if (!source) return labels;

  let index = 0;
  while (index < source.length) {
    while (index < source.length && /[\s,]/.test(source[index])) index += 1;
    const keyStart = index;
    while (index < source.length && /[A-Za-z0-9_]/.test(source[index])) index += 1;
    const key = source.slice(keyStart, index);
    if (!key || source[index] !== '=') break;
    index += 1;
    if (source[index] !== '"') break;
    index += 1;

    let value = '';
    let closed = false;
    while (index < source.length) {
      const character = source[index];
      if (character === '\\' && index + 1 < source.length) {
        const escaped = source[index + 1];
        value += escaped === 'n' ? '\n' : escaped;
        index += 2;
      } else if (character === '"') {
        index += 1;
        closed = true;
        break;
      } else {
        value += character;
        index += 1;
      }
    }
    if (!closed) return Object.create(null);
    labels[key] = value;
  }
  return labels;
}

function parseSample(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const firstSpace = trimmed.search(/\s/);
  if (firstSpace < 1) return null;

  const identity = trimmed.slice(0, firstSpace);
  const numericToken = trimmed.slice(firstSpace).trim().split(/\s+/, 1)[0];
  const value = Number(numericToken);
  if (!Number.isFinite(value)) return null;

  const labelStart = identity.indexOf('{');
  if (labelStart === -1) return { name: identity, labels: Object.create(null), value };
  if (!identity.endsWith('}')) return null;
  const name = identity.slice(0, labelStart);
  if (!/^[A-Za-z_:][A-Za-z0-9_:]*$/.test(name)) return null;
  return { name, labels: parseLabels(identity.slice(labelStart + 1, -1)), value };
}

function isDataFilesystem(labels) {
  return labels.mountpoint === '/data';
}

function selectDiskValue(values) {
  const data = values.filter(({ labels }) => isDataFilesystem(labels));
  if (data.length) return sum(data.map(({ value }) => value));

  const root = values.filter(({ labels }) => labels.mountpoint === '/');
  if (root.length) return sum(root.map(({ value }) => value));

  const durable = values.filter(({ labels }) => {
    const filesystem = String(labels.fstype || '').toLowerCase();
    return !['tmpfs', 'devtmpfs', 'overlay', 'squashfs'].includes(filesystem);
  });
  return sum((durable.length ? durable : values).map(({ value }) => value));
}

function severityForPercent(value, warning, critical) {
  if (value == null) return 'monitoring_unavailable';
  if (value >= critical) return 'critical';
  if (value >= warning) return 'warning';
  return 'online';
}

function overallSeverity(kpis) {
  if (kpis.pgbouncerUp === 0) return 'unavailable';
  if (kpis.maxWaitSeconds != null && kpis.maxWaitSeconds > THRESHOLDS.maxWaitCriticalSeconds) return 'critical';
  if ([kpis.connectionUtilizationPercent, kpis.diskUsedPercent].some((value) => value != null && value >= THRESHOLDS.critical)
    || (kpis.memoryUsedPercent != null && kpis.memoryUsedPercent >= THRESHOLDS.memoryCritical)) return 'critical';
  if (kpis.waitingConnections != null && kpis.waitingConnections > 0
    || [kpis.connectionUtilizationPercent, kpis.diskUsedPercent].some((value) => value != null && value >= THRESHOLDS.warning)
    || (kpis.memoryUsedPercent != null && kpis.memoryUsedPercent >= THRESHOLDS.memoryWarning)) return 'warning';
  return 'online';
}

/**
 * Parses the Supabase Prometheus endpoint into a small, UI-ready health payload.
 * It intentionally ignores unsupported and malformed samples rather than failing a
 * normal FCOS health check because one exporter metric is malformed.
 */
export function parseSupabasePrometheusMetrics(text) {
  const unavailable = {
    monitoringAvailable: false,
    severity: 'monitoring_unavailable',
    kpis: {
      databaseConnections: null,
      maxConnections: null,
      connectionUtilizationPercent: null,
      pgbouncerUp: null,
      waitingConnections: null,
      maxWaitSeconds: null,
      memoryUsedPercent: null,
      diskUsedPercent: null,
      databaseCacheHitPercent: null,
      deadlocksTotal: null,
    },
    thresholds: THRESHOLDS,
  };
  if (typeof text !== 'string' || !text.trim()) return unavailable;

  const samples = text.split(/\r?\n/).map(parseSample).filter(Boolean);
  if (!samples.length) return unavailable;

  const pick = (names) => samples.filter(({ name }) => names.has(name));
  const values = (names) => pick(names).map(({ value }) => value);
  const databaseConnections = sum(values(METRIC_NAMES.databaseConnections));
  const maxConnections = max(values(METRIC_NAMES.maxConnections));
  const pgbouncerUp = max(values(METRIC_NAMES.pgbouncerUp));
  const waitingConnections = sum(values(METRIC_NAMES.waitingConnections));
  const maxWaitSeconds = max(values(METRIC_NAMES.maxWaitSeconds));
  const memoryTotal = sum(values(METRIC_NAMES.memoryTotal));
  const memoryAvailable = sum(values(METRIC_NAMES.memoryAvailable));
  const diskSize = selectDiskValue(pick(METRIC_NAMES.diskSize));
  const diskAvailable = selectDiskValue(pick(METRIC_NAMES.diskAvailable));
  const cacheHits = sum(values(METRIC_NAMES.cacheHits));
  const cacheReads = sum(values(METRIC_NAMES.cacheReads));
  const deadlocksTotal = sum(values(METRIC_NAMES.deadlocks));

  const kpis = {
    databaseConnections,
    maxConnections,
    connectionUtilizationPercent: percentage(databaseConnections, maxConnections),
    pgbouncerUp: numberOrNull(pgbouncerUp),
    waitingConnections,
    maxWaitSeconds,
    memoryUsedPercent: percentage(memoryTotal - memoryAvailable, memoryTotal),
    diskUsedPercent: percentage(diskSize - diskAvailable, diskSize),
    databaseCacheHitPercent: percentage(cacheHits, (cacheHits ?? 0) + (cacheReads ?? 0)),
    deadlocksTotal,
  };
  const hasRecognizedMetric = Object.values(kpis).some((value) => value != null);
  if (!hasRecognizedMetric) return unavailable;

  return {
    monitoringAvailable: true,
    severity: overallSeverity(kpis),
    kpis,
    thresholds: THRESHOLDS,
    severities: {
      connections: severityForPercent(kpis.connectionUtilizationPercent, THRESHOLDS.warning, THRESHOLDS.critical),
      disk: severityForPercent(kpis.diskUsedPercent, THRESHOLDS.warning, THRESHOLDS.critical),
      memory: severityForPercent(kpis.memoryUsedPercent, THRESHOLDS.memoryWarning, THRESHOLDS.memoryCritical),
      pgbouncer: kpis.pgbouncerUp == null ? 'monitoring_unavailable' : kpis.pgbouncerUp === 0 ? 'unavailable' : 'online',
    },
  };
}
