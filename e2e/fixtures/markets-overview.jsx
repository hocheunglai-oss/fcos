import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { appClient } from '@/api/appClient';
import { MarketDecisionBrief } from '@/hedge/views/market-intelligence/MarketDecisionBrief';
import '@/index.css';
import '@/hedge/styles.css';
import '@/hedge/views/market-intelligence/marketIntelligence.css';

const reportDate = '2026-09-16';
const sourceRefs = [
  { id: 'bunkerwire', reportType: 'Bunkerwire', reportDate, page: 2, sourceHash: 'fixture-bunkerwire' },
  { id: 'marketscan', reportType: 'European Marketscan', reportDate, page: 5, sourceHash: 'fixture-marketscan' },
];
const brief = {
  asOfDate: reportDate,
  displayedDate: reportDate,
  materialChanges: [{ id: 'move', productKey: 'vlsfo', tenor: 'M1', contractMonth: '2026-10-01', change: 8.5, unit: 'USD/MT', sourceSymbol: 'AAOAJ00', sourceRefs: [sourceRefs[0]] }],
  portDislocations: [{ id: 'port', productKey: 'hsfo380', lowPort: 'Singapore', lowPortSymbol: 'PUABC00', highPort: 'Hong Kong', highPortSymbol: 'PUAER00', dispersion: 21.5, unit: 'USD/MT', sampleCount: 4, sourceRefs: [sourceRefs[0]] }],
  physicalPaperSignals: [{ id: 'paper', productKey: 'lsmgo', reportDate, state: 'divergent', physicalMove: -6, paperMove: 7.45, unit: 'USD/MT', originalPaperMove: 1, originalPaperUnit: 'USD/BBL', conversionFactor: 7.45, sourceRefs: [sourceRefs[1]] }],
  drivers: { emerging: [{ id: 'driver', title: 'Prompt supply remains tight', summary: 'Source-linked test driver.', direction: 'tightening', sourceRefs: [sourceRefs[0]] }] },
  risks: [],
  sourceRefs,
};

function product({ productKey, productName, unit, mops, delivered, sourceCode }) {
  return {
    productKey,
    productName,
    unit,
    sourceCode,
    latestMops: { value: mops, publicationDate: reportDate, sourceCode, basis: 'MOPS close', comparison: { available: true, change: productKey === 'lsmgo' ? 0.625 : 4.25, unit, currentDate: reportDate, previousDate: '2026-09-15' } },
    singaporeDelivered: { value: delivered, unit: 'USD/MT', publicationDate: reportDate, dayChange: productKey === 'hsfo380' ? null : 3.5, premium: { value: delivered == null ? null : productKey === 'lsmgo' ? 28.5 : 12.25, unit: 'USD/MT', date: reportDate } },
    monthlyEstimate: { value: productKey === 'lsmgo' ? 96.75 : mops - 2, unit, publicationDate: reportDate, evidence: { actual: 11, estimated: 1, representedPublicationDays: 12 } },
    curve: { status: productKey === 'vlsfo' ? 'contango' : 'backwardation', reportDate, spreads: [{ key: 'bmM1', value: productKey === 'lsmgo' ? 0.45 : 6.2, unit }, { key: 'm1M2', value: productKey === 'hsfo380' ? null : 1.1, unit }] },
  };
}

const pulse = {
  asOfDate: reportDate,
  currentMonth: '2026-09',
  curveReportDate: reportDate,
  products: [
    product({ productKey: 'hsfo380', productName: 'HSFO 380', unit: 'USD/MT', mops: 426.5, delivered: null, sourceCode: 'PPXDK00' }),
    product({ productKey: 'vlsfo', productName: 'S0.5%', unit: 'USD/MT', mops: 512.25, delivered: 528.75, sourceCode: 'AMFSA00' }),
    product({ productKey: 'lsmgo', productName: 'LSMGO', unit: 'USD/BBL', mops: 97.125, delivered: 752, sourceCode: 'POABC00' }),
  ],
  sourceHealth: {
    checkedAt: '2026-09-17T08:30:00.000Z',
    status: 'degraded',
    message: 'One expected HSFO 380 close series is unavailable; valid Bunkerwire and Marketscan values remain visible.',
    sources: [
      { key: 'drive', label: 'Licensed report imports', status: 'healthy', lastSuccessAt: '2026-09-17T08:25:00.000Z', lastPublicationDate: reportDate },
      { key: 'csv', label: 'Historical CSV archive', status: 'degraded', lastSuccessAt: '2026-09-16T08:25:00.000Z', lastPublicationDate: '2026-09-15', message: 'Supply a corrected CSV containing PPXDK00 close values.' },
    ],
  },
};

const bookContext = {
  generatedAt: '2026-09-17T08:35:00.000Z',
  rows: [
    { key: 'a', counterparty: 'Atlas Shipping', product: 'HSFO', unit: 'MT', physicalQty: 1200, hedgeQty: 1080, netExposure: 120, hedgeRatio: 90 },
    { key: 'b', counterparty: 'Blue Ocean', product: 'VLSFO', unit: 'MT', physicalQty: 800, hedgeQty: 600, netExposure: 200, hedgeRatio: 75 },
    { key: 'c', counterparty: 'Caspian Marine', product: 'SGO', unit: 'BBL', physicalQty: 7450, hedgeQty: 7450, netExposure: 0, hedgeRatio: 100 },
    { key: 'd', counterparty: 'Delta Fleet', product: 'HSFO', unit: 'MT', physicalQty: 500, hedgeQty: 550, netExposure: -50, hedgeRatio: 110 },
    { key: 'e', counterparty: 'Eastern Lines', product: 'VLSFO', unit: 'MT', physicalQty: 300, hedgeQty: 285, netExposure: 15, hedgeRatio: 95 },
    { key: 'f', counterparty: 'Far Horizon', product: 'SGO', unit: 'BBL', physicalQty: null, hedgeQty: null, netExposure: null, hedgeRatio: null },
  ],
  totals: { openPhysicalCount: 6, liveHedgeCount: 5 },
  warnings: ['Fixture coverage note.'],
  monthlyCoverage: {
    deliveryRows: [
      { key: 'delivery-atlas-sep', counterparty: 'Atlas Shipping', product: 'S380', unit: 'MT', month: '2026-09', physicalQty: 1200, tradeCount: 2, unallocated: false },
      { key: 'delivery-atlas-oct', counterparty: 'Atlas Shipping', product: 'S380', unit: 'MT', month: '2026-10', physicalQty: 300, tradeCount: 1, unallocated: false },
      { key: 'delivery-blue-sep', counterparty: 'Blue Ocean', product: 'S0.5', unit: 'MT', month: '2026-09', physicalQty: 800, tradeCount: 1, unallocated: false },
      { key: 'delivery-caspian-sep', counterparty: 'Caspian Marine', product: 'SGO', unit: 'BBL', month: '2026-09', physicalQty: 7450, tradeCount: 1, unallocated: false },
      { key: 'delivery-delta-oct', counterparty: 'Delta Fleet', product: 'S380', unit: 'MT', month: '2026-10', physicalQty: 500, tradeCount: 1, unallocated: false },
      { key: 'delivery-far-unallocated', counterparty: 'Far Horizon', product: 'SGO', unit: 'BBL', month: null, physicalQty: null, tradeCount: 1, unallocated: true },
    ],
    pricingRows: [
      { key: 'pricing-atlas-sep', counterparty: 'Atlas Shipping', product: 'S380', unit: 'MT', month: '2026-09', basis: 'WMA', balanceStartDate: null, physicalBuyFloatingQty: 100, physicalSellFloatingQty: 1200, fixedBuyQty: 0, fixedSellQty: 100, buyHedgeQty: 0, sellHedgeQty: 1080, physicalNet: 1100, hedgeNet: -1080, residualNet: 20, uncoveredQty: 20, excessHedgeQty: 0, unknownCount: 0 },
      { key: 'pricing-atlas-oct', counterparty: 'Atlas Shipping', product: 'S380', unit: 'MT', month: '2026-10', basis: 'WMA', balanceStartDate: null, physicalBuyFloatingQty: 0, physicalSellFloatingQty: 300, fixedBuyQty: 0, fixedSellQty: 0, buyHedgeQty: 0, sellHedgeQty: 350, physicalNet: 300, hedgeNet: -350, residualNet: -50, uncoveredQty: 0, excessHedgeQty: 50, unknownCount: 0 },
      { key: 'pricing-blue-sep-bal', counterparty: 'Blue Ocean', product: 'S0.5', unit: 'MT', month: '2026-09', basis: 'BAL_TODAY', balanceStartDate: '2026-09-12', physicalBuyFloatingQty: 200, physicalSellFloatingQty: 800, fixedBuyQty: 40, fixedSellQty: 0, buyHedgeQty: 600, sellHedgeQty: 0, physicalNet: 600, hedgeNet: 600, residualNet: null, uncoveredQty: null, excessHedgeQty: null, unknownCount: 1 },
      { key: 'pricing-caspian-sep', counterparty: 'Caspian Marine', product: 'SGO', unit: 'BBL', month: '2026-09', basis: 'WMA', balanceStartDate: null, physicalBuyFloatingQty: 7450, physicalSellFloatingQty: 0, fixedBuyQty: 0, fixedSellQty: 0, buyHedgeQty: 7450, sellHedgeQty: 0, physicalNet: -7450, hedgeNet: 7450, residualNet: 0, uncoveredQty: 0, excessHedgeQty: 0, unknownCount: 0 },
      { key: 'pricing-far-unallocated', counterparty: 'Far Horizon', product: 'SGO', unit: 'BBL', month: null, basis: null, balanceStartDate: null, physicalBuyFloatingQty: null, physicalSellFloatingQty: null, fixedBuyQty: null, fixedSellQty: null, buyHedgeQty: null, sellHedgeQty: null, physicalNet: null, hedgeNet: null, residualNet: null, uncoveredQty: null, excessHedgeQty: null, unknownCount: 2 },
    ],
    warnings: ['One delivery window crosses a month boundary and remains unallocated.'],
    methodology: 'Fixture quantities retain their native units and are grouped only within an exact month and pricing basis.',
  },
};

// The production brief refreshes on mount; keep that read local and deterministic.
appClient.functions.invoke = async (name) => {
  if (name === 'marketIntelligenceBrief') return { data: { data: brief } };
  throw new Error(`Unexpected fixture request: ${name}`);
};

function Fixture() {
  const requested = new URLSearchParams(location.search).get('state') || 'current';
  const [bookState, setBookState] = useState(requested);
  const [navigated, setNavigated] = useState('brief');
  const historical = requested === 'historical';
  return <div className="hedge-desk-root workspace-trading"><main className="app-page market-intelligence-workspace" style={{ maxWidth: 1280, margin: '0 auto', padding: 16 }}>
      <p aria-live="polite">Selected market view: <strong>{navigated}</strong></p>
      <MarketDecisionBrief
        initialBrief={brief}
        pulse={pulse}
        dateMode={historical ? 'historical' : 'latest'}
        requestedDate={historical ? reportDate : null}
        canReadBook
        bookContext={bookState === 'current' || bookState === 'historical' ? bookContext : null}
        bookLoading={bookState === 'loading'}
        bookError={bookState === 'error' ? new Error('Fixture book read failed.') : null}
        onRetryBook={() => setBookState('current')}
        onNavigateMarketView={setNavigated}
      />
    </main></div>;
}

createRoot(document.getElementById('root')).render(<MemoryRouter><Fixture /></MemoryRouter>);
