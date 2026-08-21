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

async function requestMarketIntelligence(handler, payload = {}, options = {}) {
  const response = await appClient.functions.invoke(handler, payload, options);
  if (response.data?.error) throw new Error(response.data.error);
  return response.data?.data ?? response.data;
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

export function loadMarketHistory(payload, options = {}) {
  return request({ action: 'market_history', ...payload }, {
    cache: true,
    cacheTtlMs: 60_000,
    cacheTags: ['markets', 'market-history'],
    ...options,
  });
}

export function loadMarketPulseSnapshot(options = {}) {
  return requestMarketIntelligence('marketPulseSnapshot', {}, {
    cache: true,
    cacheTtlMs: 60_000,
    cacheTags: ['markets', 'market-pulse'],
    ...options,
  });
}


export function loadMarketIntelligenceBrief(payload = {}, options = {}) {
  return requestMarketIntelligence('marketIntelligenceBrief', payload, {
    cache: true,
    cacheTtlMs: 60_000,
    cacheTags: ['markets', 'market-intelligence-brief'],
    ...options,
  });
}

export function loadMarketIntelligenceCurve(payload = {}, options = {}) {
  return requestMarketIntelligence('marketIntelligenceCurve', payload, {
    cache: true,
    cacheTtlMs: 60_000,
    cacheTags: ['markets', 'market-intelligence-curve'],
    ...options,
  });
}

export function saveMarketForwardFallback(payload, options = {}) {
  return requestMarketIntelligence('marketForwardFallbackSave', payload, {
    cache: false,
    invalidateCache: true,
    ...options,
  });
}

export function loadMarketIntelligenceAlertRules(options = {}) {
  return requestMarketIntelligence('marketIntelligenceAlertRulesGet', {}, {
    cache: true,
    cacheTtlMs: 60_000,
    cacheTags: ['markets', 'market-intelligence-alert-rules'],
    ...options,
  });
}

export function saveMarketIntelligenceAlertRules(payload, options = {}) {
  return requestMarketIntelligence('marketIntelligenceAlertRulesSave', payload, {
    cache: false,
    invalidateCache: true,
    ...options,
  });
}

export function saveMarketIntelligenceCurveCutover(payload, options = {}) {
  return requestMarketIntelligence('marketIntelligenceCurveCutoverSave', payload, {
    cache: false,
    invalidateCache: true,
    ...options,
  });
}

export function replayMarketIntelligenceArchive(payload, options = {}) {
  return requestMarketIntelligence('marketIntelligenceArchiveReplay', payload, {
    cache: false,
    invalidateCache: true,
    ...options,
  });
}

export function previewMarketIntradaySnapshot(payload, options = {}) {
  return requestMarketIntelligence('marketIntradaySnapshotPreview', payload, {
    cache: false,
    ...options,
  });
}

export function saveMarketIntradaySnapshot(payload, options = {}) {
  return requestMarketIntelligence('marketIntradaySnapshotSave', payload, {
    cache: false,
    invalidateCache: true,
    ...options,
  });
}

export function loadMarketIntradayTimeline(payload = {}, options = {}) {
  return requestMarketIntelligence('marketIntradayTimeline', payload, {
    cache: true,
    cacheTtlMs: 60_000,
    cacheTags: ['markets', 'market-intraday'],
    ...options,
  });
}
