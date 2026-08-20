import { appClient } from '@/api/appClient';

async function request(payload, options = { cache: false }) {
  const backgroundUpdate = options.onBackgroundUpdate;
  const mutates = ['create', 'update', 'delete', 'save_spreads', 'verify_month', 'market_report_import'].includes(payload?.action);
  const response = await appClient.functions.invoke('hedgeMarkets', payload, {
    ...options,
    invalidateCache: options.invalidateCache ?? mutates,
    onBackgroundUpdate: backgroundUpdate
      ? (result) => backgroundUpdate(result.data?.data)
      : undefined,
  });
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

export function loadMarketSnapshot(options) {
  return request({ action: 'snapshot' }, options);
}

export function saveForwardSpreads(value, expectedRevision) {
  return request({ action: 'save_spreads', value, expectedRevision });
}

export function verifyMopsMonth(month, sourceMessage, expectedRevision = 0) {
  return request({ action: 'verify_month', month, sourceMessage, expectedRevision });
}

export function previewMarketReport(payload) {
  return request({ action: 'market_report_preview', ...payload });
}

export function importMarketReport(payload) {
  return request({ action: 'market_report_import', ...payload });
}
