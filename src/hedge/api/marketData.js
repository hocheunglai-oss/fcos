import { appClient } from '@/api/appClient';

async function request(payload) {
  const response = await appClient.functions.invoke('hedgeMarkets', payload, { cache: false });
  if (response.data?.error) throw new Error(response.data.error);
  return response.data?.data;
}

export const MarketPrice = {
  list(sort = '-created_date', limit = 1000) {
    return request({ action: 'list', entity: 'MopsPrice', sort, limit });
  },
  create(payload) {
    return request({ action: 'create', entity: 'MopsPrice', payload });
  },
  update(id, payload, expectedRevision = null) {
    return request({ action: 'update', entity: 'MopsPrice', id, payload, expectedRevision });
  },
  delete(id, expectedRevision = null) {
    return request({ action: 'delete', entity: 'MopsPrice', id, expectedRevision });
  },
};

export function loadMarketSnapshot() {
  return request({ action: 'snapshot' });
}

export function saveForwardSpreads(value, expectedRevision) {
  return request({ action: 'save_spreads', value, expectedRevision });
}
