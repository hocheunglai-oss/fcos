import { appClient } from '@/api/appClient';

const entityNames = new Set([
  'PhysicalTrade',
  'SwapHedge',
  'MopsPrice',
  'ClearingAccount',
  'Invoice',
  'Counterparty',
  'AppConfig',
]);

async function requestEntities(payload) {
  const response = await appClient.functions.invoke('hedgeDeskEntity', payload, { cache: false });
  if (response.data?.error) throw new Error(response.data.error);
  return response.data?.data;
}

async function entityRequest(entity, action, payload = {}) {
  if (!entityNames.has(entity)) throw new Error(`Unknown Hedge Desk entity: ${entity}`);
  return requestEntities({ entity, action, ...payload });
}

export function loadDeskSnapshot() {
  return requestEntities({ action: 'snapshot' });
}

function createEntity(entityName) {
  return {
    list(sort = '-created_date', limit = 1000) {
      return entityRequest(entityName, 'list', { sort, limit });
    },
    filter(params = {}, sort = '-created_date', limit = 1000) {
      return entityRequest(entityName, 'filter', { params, sort, limit });
    },
    get(id) {
      return entityRequest(entityName, 'get', { id });
    },
    create(payload) {
      return entityRequest(entityName, 'create', { payload });
    },
    update(id, payload, expectedRevision = null) {
      return entityRequest(entityName, 'update', { id, payload, expectedRevision });
    },
    delete(id, expectedRevision = null) {
      return entityRequest(entityName, 'delete', { id, expectedRevision });
    },
  };
}

export const PhysicalTrade = createEntity('PhysicalTrade');
export const SwapHedge = createEntity('SwapHedge');
export const MopsPrice = createEntity('MopsPrice');
export const ClearingAccount = createEntity('ClearingAccount');
export const Invoice = createEntity('Invoice');
export const Counterparty = createEntity('Counterparty');
export const AppConfig = createEntity('AppConfig');
