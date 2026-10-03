import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTraderComparison,
  buildTraderSeries,
  buildTraderWorkspace,
  normalizeTraderPreferences,
  traderComparisonBaseline,
} from '../api/_marketTraderWorkspaceModel.js';
import { createMarketTraderWorkspace } from '../api/_marketTraderWorkspace.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const NOW = new Date('2026-09-18T10:00:00Z');

function definition(overrides = {}) {
  return {
    id: 'series-vlsfo',
    active: true,
    market_family: 'cargo',
    port_key: 'singapore',
    port_label: 'Singapore',
    product_key: 'vlsfo',
    product_label: 'VLSFO',
    alias_label: 'MOPS',
    source_symbol: 'AMFSA00',
    source_type: 'platts_pdf',
    currency_code: 'USD',
    unit: 'USD/MT',
    value_kind: 'absolute',
    assessment_session: 'asia_moc',
    basis_metadata: { productKey: 'vlsfo', marketFamily: 'cargo', settlementBasis: 'FOB Singapore' },
    ...overrides,
  };
}

function imported(id, reportDate, sourceHash, overrides = {}) {
  return {
    id,
    status: 'completed',
    report_date: reportDate,
    source_hash: sourceHash,
    source_document_type: 'bunkerwire',
    ...overrides,
  };
}

function observation(id, seriesId, importId, priceDate, price, sourceHash, overrides = {}) {
  return {
    id,
    series_id: seriesId,
    import_id: importId,
    price_date: priceDate,
    price,
    quality_status: 'verified',
    source_hash: sourceHash,
    source_page: 1,
    contract_month: null,
    observation_unit: 'USD/MT',
    assessment_session: 'asia_moc',
    basis_metadata: { productKey: 'vlsfo', marketFamily: 'cargo', settlementBasis: 'FOB Singapore' },
    ...overrides,
  };
}

function seriesRow(key, overrides = {}) {
  const latest = {
    date: '2026-09-18',
    value: 700,
    fingerprint: `${key}-fingerprint`,
    sourceSymbol: 'AMFSA00',
    sourcePage: 1,
  };
  return {
    key,
    label: key,
    unit: 'USD/MT',
    currency: 'USD',
    session: 'asia_moc',
    sourceType: 'platts_pdf',
    valueKind: 'absolute',
    stale: false,
    points: [latest],
    latest,
    previousDate: '2026-09-17',
    change: 5,
    ...overrides,
  };
}

test('verified observations require completed matching immutable sources and omit quarantined or incomplete evidence', () => {
  const definitions = [
    definition(),
    definition({ id: 'inactive', active: false }),
    definition({ id: 'unavailable', source_type: 'unavailable' }),
  ];
  const imports = [
    imported('import-17', '2026-09-17', HASH_A),
    imported('import-18', '2026-09-18', HASH_B),
    imported('failed-import', '2026-09-18', HASH_C, { status: 'failed' }),
    imported('wrong-date', '2026-09-17', HASH_C),
  ];
  const valid17 = observation('valid-17', 'series-vlsfo', 'import-17', '2026-09-17', 690, HASH_A);
  const valid18 = observation('valid-18', 'series-vlsfo', 'import-18', '2026-09-18', 700, HASH_B);
  const rejected = [
    observation('unverified', 'series-vlsfo', 'import-18', '2026-09-18', 999, HASH_B, { quality_status: 'pending' }),
    observation('failed-source', 'series-vlsfo', 'failed-import', '2026-09-18', 998, HASH_C),
    observation('hash-mismatch', 'series-vlsfo', 'import-18', '2026-09-18', 997, HASH_A),
    observation('date-mismatch', 'series-vlsfo', 'wrong-date', '2026-09-18', 996, HASH_C),
    observation('missing-null', 'series-vlsfo', 'import-18', '2026-09-18', null, HASH_B),
    observation('missing-empty', 'series-vlsfo', 'import-18', '2026-09-18', ' ', HASH_B),
    observation('ineligible', 'series-vlsfo', 'import-18', '2026-09-18', 995, HASH_B, { basis_metadata: { publicationEligible: false } }),
    observation('future', 'series-vlsfo', 'import-18', '2026-09-19', 994, HASH_B),
    observation('inactive-definition', 'inactive', 'import-18', '2026-09-18', 993, HASH_B),
    observation('unavailable-definition', 'unavailable', 'import-18', '2026-09-18', 992, HASH_B),
  ];
  const input = {
    definitions,
    imports,
    observations: [valid18, ...rejected, valid17],
    conflicts: [{ series_id: 'series-vlsfo', price_date: '2026-09-16' }],
    endDate: '2026-09-18',
  };
  const result = buildTraderSeries(input);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].points.map(({ date, value, sourceHash }) => ({ date, value, sourceHash })), [
    { date: '2026-09-17', value: 690, sourceHash: HASH_A },
    { date: '2026-09-18', value: 700, sourceHash: HASH_B },
  ]);
  assert.equal(result[0].change, 10);
  assert.equal(result[0].stale, false);
  assert.deepEqual(buildTraderSeries({ ...input, observations: [...input.observations].reverse() }), result);
});

test('quarantine and conflicting duplicate values remove the date instead of selecting an edition', () => {
  const definitions = [definition()];
  const imports = [
    imported('import-16', '2026-09-16', HASH_A),
    imported('import-17a', '2026-09-17', HASH_B),
    imported('import-17b', '2026-09-17', HASH_C, { source_document_type: 'european_marketscan' }),
    imported('import-18', '2026-09-18', 'd'.repeat(64)),
  ];
  const observations = [
    observation('quarantined', 'series-vlsfo', 'import-16', '2026-09-16', 680, HASH_A),
    observation('duplicate-a', 'series-vlsfo', 'import-17a', '2026-09-17', 690, HASH_B),
    observation('duplicate-b', 'series-vlsfo', 'import-17b', '2026-09-17', 691, HASH_C),
    observation('valid', 'series-vlsfo', 'import-18', '2026-09-18', 700, 'd'.repeat(64)),
  ];
  const [series] = buildTraderSeries({
    definitions,
    imports,
    observations,
    conflicts: [{ series_id: 'series-vlsfo', price_date: '2026-09-16' }],
    endDate: '2026-09-18',
  });
  assert.deepEqual(series.points.map((row) => row.date), ['2026-09-18']);
  assert.equal(series.change, null);
});

test('forward series use exact contract keys and never join adjacent rollover months', () => {
  const definitions = [
    definition({ id: 'oct-a', market_family: 'forward', source_symbol: 'OCT_A', basis_metadata: { productKey: 'vlsfo', marketFamily: 'forward', settlementBasis: 'FOB Singapore' } }),
    definition({ id: 'oct-b', market_family: 'forward', source_symbol: 'OCT_B', basis_metadata: { productKey: 'vlsfo', marketFamily: 'forward', settlementBasis: 'FOB Singapore' } }),
    definition({ id: 'nov', market_family: 'forward', source_symbol: 'NOV', basis_metadata: { productKey: 'vlsfo', marketFamily: 'forward', settlementBasis: 'FOB Singapore' } }),
  ];
  const imports = [
    imported('oct-import-a', '2026-09-18', HASH_A),
    imported('oct-import-b', '2026-09-18', HASH_B),
    imported('nov-import', '2026-09-18', HASH_C),
  ];
  const observations = [
    observation('oct-a', 'oct-a', 'oct-import-a', '2026-09-18', 700, HASH_A, { contract_month: '2026-10-01', basis_metadata: {} }),
    observation('oct-b', 'oct-b', 'oct-import-b', '2026-09-18', 700, HASH_B, { contract_month: '2026-10-01', basis_metadata: {} }),
    observation('nov', 'nov', 'nov-import', '2026-09-18', 710, HASH_C, { contract_month: '2026-11-01', basis_metadata: {} }),
  ];
  const result = buildTraderSeries({ definitions, imports, observations, conflicts: [], endDate: '2026-09-18' });
  assert.deepEqual(result.map((row) => row.key), [
    'forward|vlsfo|2026-10|USD/MT|asia_moc|FOB Singapore',
    'forward|vlsfo|2026-11|USD/MT|asia_moc|FOB Singapore',
  ]);
  assert.equal(result[0].points.length, 1);
  assert.equal(result[0].points[0].value, 700);
});

test('comparisons require matching units, currencies, sessions and price types and use exact shared dates', () => {
  const left = seriesRow('left', {
    points: [
      { date: '2026-09-16', value: 690 },
      { date: '2026-09-18', value: 700 },
    ],
  });
  const right = seriesRow('right', {
    points: [
      { date: '2026-09-17', value: 500 },
      { date: '2026-09-18', value: 510 },
    ],
  });
  const comparison = buildTraderComparison({ id: 'spread', leftKey: 'left', rightKey: 'right' }, [left, right]);
  assert.equal(comparison.available, true);
  assert.deepEqual(comparison.points, [{
    date: '2026-09-18',
    value: 190,
    leftValue: 700,
    rightValue: 510,
    leftSource: left.points[1],
    rightSource: right.points[1],
  }]);
  assert.deepEqual(comparison.range, { low: 190, high: 190, average: 190, samples: 1 });
  for (const mismatch of [
    { unit: 'USD/BBL' },
    { currency: 'EUR' },
    { session: 'london_moc' },
    { sourceType: 'manual' },
    { valueKind: 'spread' },
  ]) {
    const unavailable = buildTraderComparison({ id: 'bad', leftKey: 'left', rightKey: 'other' }, [left, { ...right, ...mismatch, key: 'other' }]);
    assert.equal(unavailable.available, false);
    assert.match(unavailable.reason, /matching units, currency, assessment sessions and price types/);
  }
});

test('visit changes distinguish same-date source corrections from later assessments', () => {
  const corrected = seriesRow('corrected', { latest: { date: '2026-09-18', value: 701, fingerprint: 'new-proof', sourceSymbol: 'AMFSA00', sourcePage: 2 } });
  const advanced = seriesRow('advanced', { latest: { date: '2026-09-18', value: 510, fingerprint: 'assessment-18', sourceSymbol: 'PPXDK00', sourcePage: 3 } });
  const unchanged = seriesRow('unchanged');
  const workspace = buildTraderWorkspace({
    state: {
      preferences: { pins: [], comparisons: [], subscriptions: [] },
      visit: {
        id: 'prior-visit',
        at: '2026-09-17T10:00:00Z',
        current: {
          corrected: { date: '2026-09-18', value: 700, fingerprint: 'old-proof' },
          advanced: { date: '2026-09-17', value: 500, fingerprint: 'assessment-17' },
          unchanged: { date: '2026-09-18', value: 700, fingerprint: 'unchanged-fingerprint' },
        },
      },
    },
    revision: 3,
    series: [corrected, advanced, unchanged],
    visitId: 'current-visit',
    now: NOW,
  });
  assert.deepEqual(workspace.changes.map(({ key, kind, change }) => ({ key, kind, change })), [
    { key: 'corrected', kind: 'source_correction', change: 1 },
    { key: 'advanced', kind: 'new_assessment', change: 10 },
  ]);
});

test('alerts require fresh consecutive changes and respect threshold direction and event-specific acknowledgement', () => {
  const up = seriesRow('up', { change: 6 });
  const down = seriesRow('down', { change: -7, latest: { date: '2026-09-18', value: 493, fingerprint: 'down-event', sourceSymbol: 'PPXDK00', sourcePage: 4 } });
  const stale = seriesRow('stale', { change: 20, stale: true });
  const gapped = seriesRow('gapped', { change: null });
  const subscriptions = [
    { id: 'either-rule', seriesKey: 'up', threshold: 5, direction: 'either' },
    { id: 'up-rule', seriesKey: 'up', threshold: 6, direction: 'up' },
    { id: 'wrong-up', seriesKey: 'down', threshold: 5, direction: 'up' },
    { id: 'down-rule', seriesKey: 'down', threshold: 5, direction: 'down' },
    { id: 'stale-rule', seriesKey: 'stale', threshold: 5, direction: 'either' },
    { id: 'gapped-rule', seriesKey: 'gapped', threshold: 5, direction: 'either' },
  ];
  const base = {
    preferences: { pins: [], comparisons: [], subscriptions },
    alertState: {},
  };
  const initial = buildTraderWorkspace({ state: base, series: [up, down, stale, gapped], now: NOW });
  assert.deepEqual(initial.alerts.map((row) => row.id), ['either-rule', 'up-rule', 'down-rule']);
  assert.equal(initial.warnings.length, 1);
  const currentEvent = initial.alerts[0].eventKey;
  const acknowledged = buildTraderWorkspace({
    state: { ...base, alertState: { 'either-rule': { acknowledgedEventKey: currentEvent } } },
    series: [up, down, stale, gapped],
    now: NOW,
  });
  assert.equal(acknowledged.alerts[0].acknowledged, true);
  const changedEvent = buildTraderWorkspace({
    state: { ...base, alertState: { 'either-rule': { acknowledgedEventKey: currentEvent } } },
    series: [{ ...up, latest: { ...up.latest, fingerprint: 'replacement-proof' } }, down, stale, gapped],
    now: NOW,
  });
  assert.equal(changedEvent.alerts[0].acknowledged, false);
});

test('a snooze applies only to the exact alert event that was snoozed', () => {
  const rule = { id: 'up-rule', seriesKey: 'up', threshold: 5, direction: 'up' };
  const up = seriesRow('up', { change: 6 });
  const initial = buildTraderWorkspace({
    state: { preferences: { pins: [], comparisons: [], subscriptions: [rule] } },
    series: [up],
    now: NOW,
  });
  const eventKey = initial.alerts[0].eventKey;
  const snoozed = buildTraderWorkspace({
    state: {
      preferences: { pins: [], comparisons: [], subscriptions: [rule] },
      alertState: { 'up-rule': { snoozedEventKey: eventKey, snoozedUntil: '2026-09-18T18:00:00Z' } },
    },
    series: [up],
    now: NOW,
  });
  assert.equal(snoozed.alerts[0].snoozedUntil, '2026-09-18T18:00:00Z');
  const laterEvent = buildTraderWorkspace({
    state: {
      preferences: { pins: [], comparisons: [], subscriptions: [rule] },
      alertState: { 'up-rule': { snoozedEventKey: eventKey, snoozedUntil: '2026-09-18T18:00:00Z' } },
    },
    series: [{ ...up, latest: { ...up.latest, date: '2026-09-19', fingerprint: 'later-event' } }],
    now: NOW,
  });
  assert.notEqual(laterEvent.alerts[0].eventKey, eventKey);
  assert.equal(laterEvent.alerts[0].snoozedUntil, null);
});

test('personal preference normalization enforces bounds, compatible selections and unique identifiers', () => {
  const a = seriesRow('a');
  const b = seriesRow('b');
  const mismatch = seriesRow('mismatch', { unit: 'USD/BBL' });
  assert.deepEqual(normalizeTraderPreferences({
    pins: ['a', 'a'],
    comparisons: [{ id: 'ab', label: 'A minus B', leftKey: 'a', rightKey: 'b' }],
    subscriptions: [{ id: 'move-a', seriesKey: 'a', threshold: '5', direction: 'either' }],
  }, [a, b, mismatch]), {
    pins: ['a'],
    comparisons: [{ id: 'ab', label: 'A minus B', leftKey: 'a', rightKey: 'b' }],
    subscriptions: [{ id: 'move-a', seriesKey: 'a', threshold: 5, direction: 'either' }],
  });
  const empty = { pins: [], comparisons: [], subscriptions: [] };
  assert.throws(() => normalizeTraderPreferences({ ...empty, pins: Array(21).fill('a') }, [a, b]), /up to 20/);
  assert.throws(() => normalizeTraderPreferences({ ...empty, comparisons: Array(11).fill({ id: 'ab', label: 'AB', leftKey: 'a', rightKey: 'b' }) }, [a, b]), /up to 10/);
  assert.throws(() => normalizeTraderPreferences({ ...empty, subscriptions: Array(21).fill({ id: 'a', seriesKey: 'a', threshold: 1, direction: 'up' }) }, [a]), /up to 20/);
  assert.throws(() => normalizeTraderPreferences({ ...empty, pins: ['unknown'] }, [a]), /unavailable/);
  assert.throws(() => normalizeTraderPreferences({ ...empty, comparisons: [{ id: 'bad', label: 'Bad', leftKey: 'a', rightKey: 'mismatch' }] }, [a, mismatch]), /matching units/);
  assert.throws(() => normalizeTraderPreferences({ ...empty, subscriptions: [{ id: 'bad', seriesKey: 'a', threshold: 0, direction: 'up' }] }, [a]), /positive alert threshold/);
  assert.throws(() => normalizeTraderPreferences({ ...empty, subscriptions: [
    { id: 'same', seriesKey: 'a', threshold: 1, direction: 'up' },
    { id: 'same', seriesKey: 'a', threshold: 2, direction: 'down' },
  ] }, [a]), /identifiers must be unique/);
});

function workspaceClient({ state = {}, revision = 0, rpcError = null, tabularRpc = false } = {}) {
  const reads = [];
  const rpcs = [];
  const client = {
    reads,
    rpcs,
    from(table) {
      reads.push({ table, userId: null });
      const entry = reads.at(-1);
      const query = {
        select() { return query; },
        eq(column, value) { if (column === 'user_id') entry.userId = value; return query; },
        maybeSingle: async () => ({ data: { state, revision }, error: null }),
      };
      return query;
    },
    async rpc(name, payload) {
      rpcs.push({ name, payload });
      return rpcError
        ? { data: null, error: rpcError }
        : { data: tabularRpc ? [{ state: payload.p_state, revision: revision + 1 }] : { state: payload.p_state, revision: revision + 1 }, error: null };
    },
  };
  return client;
}

function workspaceApi({ client, series = [seriesRow('a')], allowed = true, at = NOW } = {}) {
  const calls = { requireUser: 0, access: 0, loadSeries: 0 };
  const api = createMarketTraderWorkspace({
    requireActiveUser: async () => {
      calls.requireUser += 1;
      return { client, profile: { id: 'owner-user-id' } };
    },
    userHasAnyModuleAccess: async (_client, _profile, modules) => {
      calls.access += 1;
      assert.deepEqual(modules, ['markets']);
      return allowed;
    },
    loadSeries: async (receivedClient) => {
      calls.loadSeries += 1;
      assert.equal(receivedClient, client);
      return series;
    },
    now: () => at,
  });
  return { api, calls };
}

test('authentication and Markets authorization complete before owner-scoped workspace reads', async () => {
  const deniedClient = workspaceClient();
  const denied = workspaceApi({ client: deniedClient, allowed: false });
  await assert.rejects(denied.api.marketTraderWorkspace({}, {}), (error) => error.code === 'MARKET_TRADER_ACCESS_DENIED' && error.statusCode === 403);
  assert.deepEqual(deniedClient.reads, []);
  assert.equal(denied.calls.loadSeries, 0);

  const allowedClient = workspaceClient();
  const allowed = workspaceApi({ client: allowedClient });
  await allowed.api.marketTraderWorkspace({ visitId: 'visit-123' }, {});
  assert.deepEqual(allowedClient.reads, [{ table: 'market_trader_workspaces', userId: 'owner-user-id' }]);
  assert.equal(allowed.calls.requireUser, 1);
  assert.equal(allowed.calls.access, 1);
});

test('expired selections can be removed or retained while new unavailable selections are rejected', () => {
  const previous = { pins: ['expired'], comparisons: [{ id: 'ab', label: 'Expired pair', leftKey: 'expired', rightKey: 'a' }], subscriptions: [{ id: 'old', seriesKey: 'expired', threshold: 5, direction: 'up' }] };
  const next = { ...previous, pins: ['expired', 'a'] };
  assert.deepEqual(normalizeTraderPreferences(next, [seriesRow('a')], previous), next);
  assert.deepEqual(normalizeTraderPreferences({ ...next, pins: ['a'] }, [seriesRow('a')], previous).pins, ['a']);
  assert.throws(() => normalizeTraderPreferences({ ...next, pins: ['unknown'] }, [seriesRow('a')], previous), /unavailable/);
  assert.throws(() => normalizeTraderPreferences({ ...next, comparisons: [{ ...previous.comparisons[0], id: 'new' }] }, [seriesRow('a')], previous), /unavailable/);
  for (const id of ['__proto__', 'constructor', 'prototype']) {
    assert.throws(() => normalizeTraderPreferences({ pins: [], comparisons: [], subscriptions: [{ id, seriesKey: 'a', threshold: 1, direction: 'up' }] }, [seriesRow('a')]), /identifier/);
  }
});

test('saved comparison moves use the preceding visit baseline and survive the current visit acknowledgement', () => {
  const left = seriesRow('left');
  const right = seriesRow('right', { latest: { ...left.latest, value: 500 }, points: [{ ...left.latest, value: 500 }] });
  const preferences = { pins: ['left'], comparisons: [{ id: 'spread', label: 'Left minus right', leftKey: 'left', rightKey: 'right' }], subscriptions: [] };
  const old = traderComparisonBaseline(preferences, [left, right]);
  const moved = { ...left, latest: { ...left.latest, value: 706 }, points: [{ ...left.latest, value: 706 }] };
  const current = traderComparisonBaseline(preferences, [moved, right]);
  const state = { preferences, visit: { id: 'this-visit', previousAt: '2026-09-17T10:00:00Z', previous: {}, previousComparisons: old, currentComparisons: current } };
  const workspace = buildTraderWorkspace({ state, series: [moved, right], visitId: 'this-visit', now: NOW });
  assert.equal(workspace.changes.find((row) => row.kind === 'spread_move').change, 6);
  const third = seriesRow('third');
  const replaced = buildTraderWorkspace({ state: { ...state, preferences: { ...preferences, comparisons: [{ ...preferences.comparisons[0], rightKey: 'third' }] } }, series: [moved, right, third], visitId: 'this-visit', now: NOW });
  assert.equal(replaced.changes.some((row) => row.kind === 'spread_move'), false);
});

test('a PostgREST composite row result preserves saved revision and owner preferences', async () => {
  const client = workspaceClient({ revision: 2, tabularRpc: true });
  const { api } = workspaceApi({ client });
  const result = await api.marketTraderWorkspaceSave({ action: 'preferences', expectedRevision: 2, preferences: { pins: ['a'], comparisons: [], subscriptions: [] } }, {});
  assert.equal(result.revision, 3);
  assert.deepEqual(result.preferences.pins, ['a']);
});

test('save enforces revision conflicts while an identical visit replay is idempotent', async () => {
  const conflictClient = workspaceClient({ revision: 4 });
  const conflict = workspaceApi({ client: conflictClient });
  await assert.rejects(
    conflict.api.marketTraderWorkspaceSave({ action: 'preferences', expectedRevision: 3, preferences: { pins: [], comparisons: [], subscriptions: [] } }, {}),
    (error) => error.code === 'MARKET_TRADER_REVISION_CONFLICT' && error.statusCode === 409,
  );
  assert.equal(conflictClient.rpcs.length, 0);

  const state = {
    preferences: { pins: [], comparisons: [], subscriptions: [] },
    visit: {
      id: 'same-visit',
      at: '2026-09-18T09:00:00Z',
      previousAt: null,
      previous: {},
      current: { a: { date: '2026-09-18', value: 700, fingerprint: 'a-fingerprint' } },
    },
  };
  const replayClient = workspaceClient({ state, revision: 5 });
  const replay = workspaceApi({ client: replayClient });
  const result = await replay.api.marketTraderWorkspaceSave({ action: 'visit', visitId: 'same-visit' }, {});
  assert.equal(result.revision, 5);
  assert.equal(replayClient.rpcs.length, 0);
});

test('acknowledge and snooze writes require the current alert event key', async () => {
  const series = [seriesRow('up', { change: 6 })];
  const rule = { id: 'up-rule', seriesKey: 'up', threshold: 5, direction: 'up' };
  const state = { preferences: { pins: [], comparisons: [], subscriptions: [rule] }, alertState: {} };
  const baseline = buildTraderWorkspace({ state, series, now: NOW });
  const eventKey = baseline.alerts[0].eventKey;

  const acknowledgeClient = workspaceClient({ state, revision: 2 });
  const acknowledge = workspaceApi({ client: acknowledgeClient, series });
  await assert.rejects(
    acknowledge.api.marketTraderWorkspaceSave({ action: 'acknowledge', expectedRevision: 2, subscriptionId: 'up-rule', eventKey: 'stale-event' }, {}),
    (error) => error.statusCode === 409,
  );
  const acknowledged = await acknowledge.api.marketTraderWorkspaceSave({ action: 'acknowledge', expectedRevision: 2, subscriptionId: 'up-rule', eventKey }, {});
  assert.equal(acknowledged.alerts[0].acknowledged, true);
  assert.equal(acknowledgeClient.rpcs[0].payload.p_user_id, 'owner-user-id');
  assert.equal(acknowledgeClient.rpcs[0].payload.p_actor_user_id, 'owner-user-id');

  const snoozeClient = workspaceClient({ state, revision: 2 });
  const snooze = workspaceApi({ client: snoozeClient, series });
  await assert.rejects(
    snooze.api.marketTraderWorkspaceSave({ action: 'snooze', expectedRevision: 2, subscriptionId: 'up-rule', eventKey: 'stale-event', hours: 8 }, {}),
    (error) => error.statusCode === 409,
  );
  const snoozed = await snooze.api.marketTraderWorkspaceSave({ action: 'snooze', expectedRevision: 2, subscriptionId: 'up-rule', eventKey, hours: 8 }, {});
  assert.equal(snoozed.alerts[0].snoozedUntil, '2026-09-18T18:00:00.000Z');
  assert.equal(snoozeClient.rpcs[0].payload.p_state.alertState['up-rule'].snoozedEventKey, eventKey);
});
