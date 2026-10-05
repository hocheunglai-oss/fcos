import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { appClient } from '@/api/appClient';
import { MarketTraderWorkspace } from '@/components/markets/MarketTraderWorkspace';
import '@/index.css';
import '@/hedge/styles.css';

const dates = Array.from({ length: 30 }, (_, index) => `2026-08-${String(index + 1).padStart(2, '0')}`);
const series = [
  {
    key: 'singapore:vlsfo:oct26', label: 'Singapore VLSFO Oct 2026', productKey: 'VLSFO', portKey: 'Singapore', contractMonth: '2026-10', unit: 'USD/MT', sourceSymbol: 'AMFSA00',
    sourceType: 'assessment', session: 'asia_moc', family: 'forward',
    latest: { date: '2026-08-30', value: 512.25, sourceHash: 'fixture-vlsfo', sourcePage: 5, source: 'European Marketscan', sourceSymbol: 'AMFSA00' }, change: 8.5,
    points: dates.map((date, index) => ({ date, value: 482 + index * 1.04 })),
  },
  {
    key: 'singapore:hsfo:oct26', label: 'Singapore HSFO 380 Oct 2026', productKey: 'HSFO 380', portKey: 'Singapore', contractMonth: '2026-10', unit: 'USD/MT', sourceSymbol: 'PPXDK00',
    sourceType: 'assessment', session: 'asia_moc', family: 'forward',
    latest: { date: '2026-08-30', value: 426.5, sourceHash: 'fixture-hsfo', sourcePage: 5, source: 'European Marketscan', sourceSymbol: 'PPXDK00' }, change: -2.25,
    points: dates.map((date, index) => ({ date, value: 445 - index * 0.64 })),
  },
  {
    key: 'rotterdam:vlsfo:nov26', label: 'Rotterdam VLSFO Nov 2026', productKey: 'VLSFO', portKey: 'Rotterdam', contractMonth: '2026-11', unit: 'USD/MT', sourceSymbol: 'AAWYZ00',
    sourceType: 'posted', session: 'posted', family: 'delivered',
    latest: { date: '2026-08-30', value: 486.75, sourceHash: 'fixture-rdam', sourcePage: 7, source: 'Bunkerwire', sourceSymbol: 'AAWYZ00' }, change: null, points: [],
  },
];

let preferences = {
  pins: ['singapore:vlsfo:oct26', 'singapore:hsfo:oct26', 'expired-series-key'],
  comparisons: [{ id: 'comparison-fixture', label: 'Singapore clean vs residual', leftKey: 'singapore:vlsfo:oct26', rightKey: 'singapore:hsfo:oct26' }],
  subscriptions: [{ id: 'subscription-fixture', seriesKey: 'singapore:vlsfo:oct26', threshold: 7.5, direction: 'either' }],
};
let revision = 4;
let calls = [];
let conflictPending = new URLSearchParams(location.search).get('state') === 'conflict';
let staleReadPending = new URLSearchParams(location.search).get('state') === 'stale-read';

function buildWorkspace() {
  const comparisonPreference = preferences.comparisons[0];
  const comparisons = comparisonPreference ? [{
    ...comparisonPreference,
    available: true,
    reason: null,
    unit: 'USD/MT',
    points: dates.slice(-12).map((date, index) => ({ date, value: 79 + index * 0.62, leftValue: 505 + index, rightValue: 426 + index * 0.38 })),
    latest: { date: '2026-08-30', value: 85.75 },
    range: { low: 79, high: 85.75, average: 82.38, samples: 12 },
  }] : [];
  return {
    generatedAt: '2026-08-30T09:15:00.000Z',
    revision,
    preferences,
    series,
    pinned: preferences.pins.map((key) => series.find((item) => item.key === key) || { key, label: 'Unavailable series', latest: null, change: null, points: [] }),
    comparisons,
    changes: [
      { key: series[0].key, label: series[0].label, kind: 'new_assessment', date: '2026-08-30', value: 512.25, previousValue: null, change: 8.5, unit: 'USD/MT', sourceSymbol: 'AMFSA00', sourcePage: 5 },
      { key: series[1].key, label: series[1].label, kind: 'source_correction', date: '2026-08-29', value: 428.75, previousValue: 429.25, change: -0.5, unit: 'USD/MT', sourceSymbol: 'PPXDK00', sourcePage: 5 },
      { key: 'comparison:comparison-fixture', label: 'Singapore clean vs residual', kind: 'spread_move', date: '2026-08-30', value: 85.75, previousValue: 79.25, change: 6.5, unit: 'USD/MT', sourceSymbol: 'AMFSA00 / PPXDK00', sourcePage: 5 },
    ],
    alerts: [{ id: 'subscription-fixture', eventKey: 'event-fixture', seriesKey: series[0].key, label: 'Singapore VLSFO moved', date: '2026-08-30', change: 8.5, unit: 'USD/MT', acknowledged: false, snoozedUntil: null, sourceSymbol: 'AMFSA00', sourcePage: 5 }],
    previousVisitAt: '2026-08-27T02:00:00.000Z',
    warnings: ['One saved series has no trend points.'],
  };
}

appClient.functions.invoke = async (name, payload, options) => {
  calls = [...calls, { name, payload, options }];
  window.__marketTraderCalls = calls;
  if (name === 'marketTraderWorkspace') {
    const readCount = calls.filter((call) => call.name === 'marketTraderWorkspace').length;
    if (staleReadPending && readCount === 2) {
      staleReadPending = false;
      const stale = buildWorkspace();
      await new Promise((resolve) => window.setTimeout(resolve, 800));
      return { data: { data: stale } };
    }
    return { data: { data: buildWorkspace() } };
  }
  if (name !== 'marketTraderWorkspaceSave') return { data: { error: `Unexpected fixture request: ${name}` } };
  if (payload.action === 'preferences' && conflictPending) {
    conflictPending = false;
    revision += 1;
    return { data: { error: 'Revision conflict', code: 'REVISION_CONFLICT', status: 409 } };
  }
  if (payload.expectedRevision !== revision) return { data: { error: 'Revision conflict', code: 'REVISION_CONFLICT', status: 409 } };
  if (payload.action === 'snooze' && payload.eventKey !== 'event-fixture') return { data: { error: 'Alert event changed', code: 'REVISION_CONFLICT', status: 409 } };
  if (payload.action === 'preferences') preferences = payload.preferences;
  revision += 1;
  const next = buildWorkspace();
  if (payload.action === 'acknowledge') next.alerts[0].acknowledged = true;
  if (payload.action === 'snooze') next.alerts[0].snoozedUntil = '2026-08-30T17:15:00.000Z';
  return { data: { data: next } };
};

function Fixture() {
  const params = new URLSearchParams(location.search);
  const [refreshKey, setRefreshKey] = useState(0);
  const historical = params.get('state') === 'historical';
  return <div className="hedge-desk-root workspace-trading"><main className="app-page" style={{ maxWidth: 1160, margin: '0 auto', padding: 16 }}>
    <button type="button" onClick={() => setRefreshKey((value) => value + 1)}>Fixture refresh</button>
    <MarketTraderWorkspace historical={historical} refreshKey={refreshKey} />
  </main></div>;
}

createRoot(document.getElementById('root')).render(<Fixture />);
