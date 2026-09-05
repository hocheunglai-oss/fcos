import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Markets and Hedge Desk use native trading chrome without changing market handlers', async () => {
  const [markets, hedgeDesk, intelligence, styles] = await Promise.all([
    read('src/pages/Markets.jsx'),
    read('src/pages/HedgeDesk.jsx'),
    read('src/hedge/views/MarketIntelligenceWorkspace.jsx'),
    read('src/hedge/styles.css'),
  ]);

  assert.match(markets, /hedge-desk-root workspace-trading/);
  assert.match(markets, /loadMarketPulseSnapshot/);
  assert.match(hedgeDesk, /hedge-desk-commandbar app-navigation-material workspace-primary-navigation/);
  assert.match(hedgeDesk, /hedge-desk-tabs app-navigation-caption-material/);
  assert.match(intelligence, /workspace-trading-canvas/);
  assert.match(intelligence, /market-workspace-tabs app-navigation-caption-material/);
  assert.match(styles, /font-family: var\(--font-ui\)/);
  assert.match(styles, /\.workspace-trading \.app-panel/);
  assert.match(styles, /\.workspace-trading \.app-drawer/);
});

test('Market Pulse uses appearance-aware surfaces while preserving signed and regime semantics', async () => {
  const [pulse, shellCss, board, boardCss, signedCss] = await Promise.all([
    read('src/components/market-pulse/MarketPulse.jsx'),
    read('src/index.css'),
    read('src/components/markets/MarketPriceBoard.jsx'),
    read('src/components/markets/MarketPriceBoard.css'),
    read('src/components/markets/MarketSignedValue.css'),
  ]);

  assert.match(pulse, /market-pulse-surface/);
  assert.match(pulse, /glass-floating/);
  assert.match(pulse, /MarketPriceBoard pulse=\{data\} compact/);
  assert.match(board, /MarketSignedValue/);
  assert.match(board, /backwardation: 'market-price-board__regime--backwardation'/);
  assert.doesNotMatch(pulse, /border-slate-200 bg-white/);
  assert.match(shellCss, /\.market-pulse-surface/);
  assert.match(boardCss, /background: var\(--app-surface/);
  assert.match(boardCss, /market-price-board__regime--backwardation[^}]*#6d28d9/);
  assert.match(boardCss, /market-price-board__regime--contango[^}]*#92400e/);
  assert.match(signedCss, /market-signed-value--up[^{]*\{[^}]*#087447/);
  assert.match(signedCss, /market-signed-value--down[^{]*\{[^}]*#c02632/);
});

test('Account Managers, Buyer PIC References, and Special Terms share reference materials', async () => {
  const [accountManagers, specialTerms, specialTermEditor, shellCss] = await Promise.all([
    read('src/pages/AccountManagers.jsx'),
    read('src/pages/SpecialTerms.jsx'),
    read('src/pages/SpecialTermEditor.jsx'),
    read('src/index.css'),
  ]);

  assert.match(accountManagers, /workspace-reference/);
  assert.match(accountManagers, /BuyerPicReferences/);
  assert.match(specialTerms, /workspace-reference/);
  assert.match(specialTermEditor, /workspace-reference/);
  assert.match(shellCss, /\.workspace-reference/);
  assert.match(shellCss, /backdrop-filter: none/);
});
