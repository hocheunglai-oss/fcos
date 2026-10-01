import assert from 'node:assert/strict';
import test from 'node:test';
import { normalRoleReadRequest } from '../scripts/lib/normal-role-read-requests.mjs';

test('normal-role reads reject nested execution flags and action aliases while keeping actual module filters', () => {
  const flags = ['refresh', 'forceRefresh', 'FORCE_REFRESH', 'autoSync', 'auto_sync', 'reconcile',
    'retry', 'resume', 'recover', 'finalize', 'publish', 'process', 'backgroundProcess', 'repair', 'reset', 'invalidate'];
  for (const flag of flags) {
    for (const value of [true, false, 'yes']) {
      assert.equal(normalRoleReadRequest('dashboardStemList', { [flag]: value }), false, flag);
      assert.equal(normalRoleReadRequest('dashboardStemList', { filters: [{ options: { [flag]: value } }] }), false, flag);
    }
  }
  for (const alias of ['action', 'actionType', 'ACTION_NAME', 'operation', 'operation_type', 'command',
    'commandType', 'op', 'verb', 'method', 'intent', 'mode', 'request_action']) {
    assert.equal(normalRoleReadRequest('dashboardStemList', { [alias]: 'refresh' }), false, alias);
    assert.equal(normalRoleReadRequest('dashboardStemList', { filters: { [alias]: 'process' } }), false, alias);
  }
  for (const [handler, body] of [
    ['dashboardStemList', { search: 'TEST', from: '2026-09-01', to: '2026-10-01', deliveryDateFrom: '2026-09-01', page: 1, currency: 'USD' }],
    ['workNotificationsList', { source: 'all', state: 'active', type: 'all' }],
    ['emailRouterList', { search: 'sent', sender: 'trader@example.test', folder: 'Inbox', page: 1, pageSize: 25 }],
    ['buyerInvoiceCollectionList', { status: 'Processing', accountId: 'account', from: '2026-09-01' }],
    ['exceptionReviewWorkflowList', { stemIds: ['stem'] }],
  ]) assert.equal(normalRoleReadRequest(handler, body), true, handler);
});

test('Hedge Desk reads retain intended entity and parameter scope rather than authorizing an action alone', () => {
  assert.equal(normalRoleReadRequest('hedgeDeskEntity', { action: 'snapshot' }), true);
  assert.equal(normalRoleReadRequest('hedgeMarkets', { action: 'snapshot' }), true);
  const entities = ['PhysicalTrade', 'SwapHedge', 'MopsPrice', 'ClearingAccount', 'Invoice', 'Counterparty', 'AppConfig'];
  for (const entity of entities) {
    assert.equal(normalRoleReadRequest('hedgeDeskEntity', { action: 'list', entity, sort: '-created_date', limit: 1000 }), true);
    assert.equal(normalRoleReadRequest('hedgeDeskEntity', { action: 'filter', entity, params: { id: ['record-1'] }, limit: 25 }), true);
    assert.equal(normalRoleReadRequest('hedgeDeskEntity', { action: 'get', entity, id: 'record-1' }), true);
  }
  assert.equal(normalRoleReadRequest('hedgeDeskEntity', { entity: 'AppConfig' }), true);
  assert.equal(normalRoleReadRequest('hedgeDeskEntity', { action: 'filter', entity: 'AppConfig', params: { key: 'assistant_model' }, sort: '-updated_date', limit: 1 }), true);
  assert.equal(normalRoleReadRequest('hedgeDeskEntity', { action: 'filter', entity: 'Invoice', params: { created_date: '2026-09-01' } }), true);
  for (const body of [
    {}, { action: 'list' }, { action: 'future_read', entity: 'Invoice' }, { action: 'list', entity: 'Profile' },
    { action: 'get', entity: 'Invoice', id: '' }, { action: 'get', entity: 'Invoice', id: 'record-1', payload: {} },
    { action: 'list', entity: 'Invoice', table: 'profiles' }, { action: 'snapshot', table: 'profiles' },
    { action: 'snapshot', entity: 'Profile' }, { action: 'snapshot', env: { VERCEL_ENV: 'production' } },
    { action: 'list', entity: 'Invoice', limit: -1 }, { action: 'list', entity: 'Invoice', limit: 10001 },
    { action: 'list', entity: 'Invoice', sort: 'status; delete' },
    { action: 'filter', entity: 'Invoice', params: { table: 'profiles' } },
    { action: 'filter', entity: 'Invoice', params: { options: { refresh: true } } },
    { action: 'filter', entity: 'Invoice', params: { id: [{ action: 'get' }] } },
    { action: 'filter', entity: 'Invoice', params: { created_date: { refresh: true } } },
    { action: 'snapshot', skipExpiry: false }, { action: 'snapshot', forceRefresh: false },
  ]) assert.equal(normalRoleReadRequest('hedgeDeskEntity', body), false, JSON.stringify(body));
  assert.equal(normalRoleReadRequest('hedgeMarkets', { action: 'snapshot', options: { refresh: false } }), false);
  assert.equal(normalRoleReadRequest('hedgeMarkets', { action: 'snapshot', table: 'profiles' }), false);
});

