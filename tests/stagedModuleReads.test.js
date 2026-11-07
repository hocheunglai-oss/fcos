import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';
import { FCOS_READ_ONLY_CI } from '../config/fcosCiIdentity.js';
import { isReadOnlyHedgeDeskAction } from '../api/_deploymentReadActions.js';
import { isDeploymentReadOnly, requireDeploymentMutationAllowed, runWithDeploymentRequestSafety } from '../api/_deploymentReadOnly.js';
import { isReadOnlyCiProfile, requireReadOnlyCiOperation } from '../api/_readOnlyCiAccess.js';
import { handlerPolicyFor, registeredHandlerBehavior } from '../api/_handlerPolicyRegistry.js';
import { handleHedgeDeskEntity, loadHedgeDeskSnapshot } from '../api/_hedgeDeskService.js';
import dispatcher from '../api/functions/[name].js';

const source = readFileSync(new URL('../api/functions/[name].js', import.meta.url), 'utf8');
const canonicalHost = new URL(FCOS_CONNECTION_POLICY.attestation.endpoint).hostname;
const production = { VERCEL: '1', VERCEL_ENV: 'production' };
const profile = { id: 'user-fixture', email: 'normal@example.invalid', user_type: 'finance' };
const scope = (readOnly, run) => runWithDeploymentRequestSafety({ headers: { host: readOnly ? 'fcos-stage.vercel.app' : canonicalHost } }, run, production);
const denial = { code: 'FCOS_DEPLOYMENT_READ_ONLY' };

// Execute the actual maintained function body while replacing only its provider bindings.
function sourceFunction(name, bindings) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0);
  const tail = source.slice(start), end = tail.slice(1).search(/\n(?:async )?function \w+\(/);
  return vm.runInNewContext(`(${end < 0 ? tail : tail.slice(0, end + 1)})`, bindings);
}
function readClient() {
  const calls = [], writes = [];
  const records = { hedge_physical_trades: [{ id: 'physical-1', product: 'S380', qty_min: 10, is_closed: false }] };
  const client = { from(table) {
    const query = {};
    for (const method of ['select', 'eq', 'in', 'order', 'limit']) query[method] = (...args) => { calls.push({ table, method, args }); return query; };
    for (const method of ['insert', 'update', 'upsert', 'delete']) query[method] = () => { writes.push({ table, method }); throw Error('Unexpected business write'); };
    query.maybeSingle = async () => ({ data: records[table]?.[0] || null, error: null });
    query.then = (resolve, reject) => Promise.resolve({ data: records[table] || [], error: null }).then(resolve, reject);
    return query;
  }, rpc(name) { writes.push({ rpc: name }); throw Error('Unexpected financial RPC'); } };
  return { client, calls, writes };
}

test('only exact bounded Hedge Desk read shapes receive the staging exception', () => {
  for (const body of [
    { action: 'snapshot' }, { action: 'list', entity: 'PhysicalTrade', limit: 1 },
    { action: 'list', entity: 'AppConfig', sort: '-created_date', limit: 1000 },
    { action: 'filter', entity: 'AppConfig', params: { key: 'assistant_model' }, sort: '-updated_date', limit: 1 },
    { action: 'get', entity: 'Invoice', id: '12345678-1234-4234-8234-123456789abc' },
  ]) assert.equal(isReadOnlyHedgeDeskAction(body), true, JSON.stringify(body));
  for (const body of [null, [], {}, Object.create({ action: 'snapshot' }), { action: 'SNAPSHOT' },
    { action: 'snapshot', entity: 'PhysicalTrade' }, { action: 'snapshot', force: false },
    { action: 'create', entity: 'PhysicalTrade', payload: {} }, { action: 'brokerSettlementUpdate' },
    { action: 'list', entity: 'Unknown' }, { action: 'list', entity: 'Invoice', limit: 5001 },
    { action: 'list', entity: 'Invoice', limit: '1' }, { action: 'list', entity: 'Invoice', sort: 'unknown_column' },
    { action: 'list', entity: 'Invoice', payload: {} }, { action: 'list', entity: 'Invoice', revision: 1 },
    { action: 'filter', entity: 'PhysicalTrade', params: {} },
    { action: 'filter', entity: 'AppConfig', params: { key: 'assistant_model', action: 'save' } },
    { action: 'filter', entity: 'AppConfig', params: { key: { value: 'assistant_model' } } },
    { action: 'get', entity: 'Invoice', id: ' read-id ' }, { action: 'get', entity: 'Invoice', id: 'read-id', options: { update: false } },
  ]) assert.equal(isReadOnlyHedgeDeskAction(body), false, JSON.stringify(body));
  assert.equal(registeredHandlerBehavior('hedgeDeskEntity').mutation, true, 'static registry stays default-deny');
});

test('dispatcher denies writes and malformed mixed bodies before authentication/provider execution', async () => {
  const previous = process.env.VERCEL_ENV, originalFetch = globalThis.fetch;
  let providerCalls = 0;
  process.env.VERCEL_ENV = 'production';
  globalThis.fetch = async () => { providerCalls++; throw Error('No provider calls in denied dispatch'); };
  const invoke = async body => {
    const res = { statusCode: 200, setHeader() {}, end(value) { this.body = String(value); } };
    await dispatcher({ method: 'POST', url: '/api/functions/hedgeDeskEntity', headers: { host: 'fcos-stage.vercel.app' }, body }, res);
    return res;
  };
  try {
    for (const body of [{ action: 'create', entity: 'Invoice', payload: {} }, { action: 'snapshot', force: false },
      { action: 'future_action' }, { action: 'list', entity: 'PhysicalTrade', limit: 0 }, { action: 'get', entity: 'Invoice', id: 'id', payload: {} }]) {
      const res = await invoke(body);
      assert.equal(res.statusCode, 403); assert.equal(JSON.parse(res.body).code, denial.code);
    }
    assert.equal((await invoke({ action: 'snapshot' })).statusCode, 401, 'valid reads still require real authentication');
    assert.equal(providerCalls, 0);
  } finally { globalThis.fetch = originalFetch; if (previous === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = previous; }
});

test('dynamic read access keeps normal module permission checks and excludes the two-module CI identity', async () => {
  let currentProfile = profile, allowed = true, moduleChecks = 0;
  const access = sourceFunction('requireHandlerAccess', {
    handlerPolicyFor, HANDLER_POLICY_REGISTRY: { hedgeDeskEntity: { ...registeredHandlerBehavior('hedgeDeskEntity'), modules: ['hedge_desk'], authentication: 'active_user' } },
    requireActiveUser: async () => ({ profile: currentProfile, client: {} }), requireReadOnlyCiOperation, isReadOnlyCiProfile,
    isReadOnlyHedgeDeskAction, requireDeploymentMutationAllowed,
    userHasAnyModuleAccess: async (_client, _profile, modules) => { moduleChecks++; assert.deepEqual([...modules], ['hedge_desk']); return allowed; },
    appError: (message, status) => Object.assign(new Error(message), { status }),
  });
  await scope(true, async () => {
    assert.equal((await access('hedgeDeskEntity', {}, { action: 'snapshot' })).profile, profile);
    allowed = false; await assert.rejects(access('hedgeDeskEntity', {}, { action: 'snapshot' }), { status: 403 });
    currentProfile = { ...profile, email: FCOS_READ_ONLY_CI.email, read_only_ci: true };
    const before = moduleChecks;
    await assert.rejects(access('hedgeDeskEntity', {}, { action: 'snapshot' }), { code: 'FCOS_CI_READ_ONLY' });
    assert.equal(moduleChecks, before);
  });
});

test('actual Hedge Desk snapshot returns real book reads without expiry maintenance on staging', async () => {
  const staged = readClient();
  const snapshot = await scope(true, () => loadHedgeDeskSnapshot({ client: staged.client, capabilities: {} }));
  assert.equal(snapshot.physicals[0].id, 'physical-1');
  for (const key of ['physicals', 'swaps', 'mops', 'clearing', 'counterparties', 'invoices', 'auditLogs']) assert.ok(Array.isArray(snapshot[key]));
  assert.deepEqual(snapshot.expiryAutomation, { status: 'not_run', reason: 'deployment_read_only', readOnly: true });
  assert.equal(staged.calls.filter(call => call.table === 'hedge_swap_hedges' && call.method === 'eq' && call.args[0] === 'is_expired').length, 0);
  assert.equal(staged.writes.length, 0);
  const canonical = readClient();
  const live = await scope(false, () => loadHedgeDeskSnapshot({ client: canonical.client, capabilities: {} }));
  assert.equal(live.expiryAutomation.checked, 0);
  assert.equal(canonical.calls.filter(call => call.table === 'hedge_swap_hedges' && call.method === 'eq' && call.args[0] === 'is_expired').length, 1, 'canonical expiry evaluator still executes');
});

test('actual Hedge Desk entity service enforces read shapes and CI restrictions before database access', async () => {
  const fixture = readClient();
  await scope(true, async () => {
    const result = await handleHedgeDeskEntity({ action: 'list', entity: 'PhysicalTrade', limit: 1 }, profile, { client: fixture.client, capabilities: {} });
    assert.equal(result[0].id, 'physical-1');
    const before = fixture.calls.length;
    await assert.rejects(handleHedgeDeskEntity({ action: 'create', entity: 'Invoice', payload: {} }, profile, { client: fixture.client, capabilities: {} }), denial);
    await assert.rejects(handleHedgeDeskEntity({ action: 'snapshot' }, { ...profile, email: FCOS_READ_ONLY_CI.email }, { client: fixture.client, capabilities: {} }), { code: 'FCOS_CI_READ_ONLY' });
    assert.equal(fixture.calls.length, before); assert.equal(fixture.writes.length, 0);
  });
});

test('actual Disputes list suppresses supplier reconciliation only in the request read-only context', async () => {
  let reconciles = 0, writes = 0, workflowReads = 0;
  const row = { Id: 'stem-1', _Supplier_Settlement_Schema: { valid: true } };
  const workflow = { case: { id: 'case-1', approvalStatus: 'Approved', workflowStatus: 'Open' }, actions: [{ actionType: 'resolve_supplier_dispute' }], parties: [] };
  const list = sourceFunction('disputeBetaList', {
    isDeploymentReadOnly, cachedSalesforceValue: async () => ({ value: { rows: [row] } }),
    loadDisputeBetaWorkflowMap: async () => { workflowReads++; return { 'stem-1': workflow }; },
    disputeWorkflowCapabilities: async () => ({ canApprove: false, canAccount: false }),
    getDisputeBetaCase: async () => workflow.case, loadDisputeWorkflowActions: async () => ({ partyRows: [], actionRows: [], instructionRows: [] }),
    reconcileApprovedSupplierInstructions: async () => { reconciles++; writes++; return { changed: true }; },
    projectExternallyClosedDisputeWorkflows() {}, disputeRegistryWithSelection: () => [],
  });
  const context = { profile, client: {} };
  const stage = await scope(true, () => list({ limit: 100 }, null, context));
  assert.equal(stage.rows.length, 1); assert.equal(reconciles, 0); assert.equal(writes, 0); assert.equal(workflowReads, 1);
  await scope(false, () => list({ limit: 100 }, null, context));
  assert.equal(reconciles, 1); assert.equal(writes, 1); assert.equal(workflowReads, 3, 'canonical reconciliation rereads the updated workflow');
});

test('actual Cashflow holiday reads return fetched data while optional cache persistence is skipped only on staging', async () => {
  let writes = 0, fetches = 0;
  const holidays = [{ date: '2026-12-25', countryCode: 'US', name: 'Christmas Day' }];
  const client = { from() { const query = { select() { return query; }, eq() { return query; }, maybeSingle: async () => ({ data: null }),
    upsert: async () => { writes++; return { error: null }; } }; return query; } };
  const read = sourceFunction('cashflowCachedHolidays', {
    isDeploymentReadOnly, safeSupabaseAdminClient: () => client, CASHFLOW_HOLIDAY_SOURCE: 'fixture-read-source',
    fetchNagerHolidays: async () => { fetches++; return holidays; },
  });
  const staged = await scope(true, () => read('US', 2026, []));
  assert.equal(staged.holidays, holidays); assert.equal(writes, 0); assert.equal(fetches, 1);
  const canonical = await scope(false, () => read('US', 2026, []));
  assert.equal(canonical.holidays, holidays); assert.equal(writes, 1); assert.equal(fetches, 2);
});
