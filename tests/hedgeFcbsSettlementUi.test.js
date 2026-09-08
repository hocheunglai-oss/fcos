import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('FCBS own-account settlement has a bounded, server-canonical review path', async () => {
  const view = await readFile(new URL('../src/hedge/views/SettlementView.jsx', import.meta.url), 'utf8');

  assert.match(view, /import \{ buildFcbsOwnAccountSettlement \} from "\.\.\/lib\/fcbsOwnAccountSettlement"/);
  assert.match(view, /buildFcbsOwnAccountSettlement\(\{[\s\S]*swaps: data\.swaps,[\s\S]*mops: data\.mops,[\s\S]*monthlyVerifications: data\.mopsMonthVerifications,[\s\S]*counterparties: data\.counterparties,[\s\S]*invoices: data\.invoices/);
  assert.match(view, /FCBS — FCBHK own-account settlement/);
  assert.match(view, /FCBS-venue hedges/);
  assert.match(view, /buildCounterpartySettlementGroups\(\s*summary\.monthSwaps,/);
  assert.match(view, /pdfPreview\?\.mode !== "existing"/);
  assert.match(view, /\{ invoiceId: invoice\.id \} : payload/);
  assert.match(view, /settlementBasis === "fcbs_own_account_venue"/);
  assert.match(view, /settlementBasis: invoiceDrawer\.settlementBasis,[\s\S]*settlementMonth: month,[\s\S]*swapIds: invoiceDrawer\.records\.map/);
  assert.match(view, /const payload = isFcbsOwnAccount \? result\?\.reviewPayload : requestedPayload/);
  assert.match(view, /source_fingerprint: payload\.sourceFingerprint/);
  assert.match(view, /idempotency_key: pdfPreview\.idempotencyKey/);
  assert.match(view, /globalThis\.crypto\.randomUUID\(\)/);
  assert.match(view, /app-page app-page--settlement/);
  assert.match(view, /await Invoice\.update\(pdfPreview\.existingInvoice\.id, invoicePayload, pdfPreview\.existingInvoice\.revision\)/);
  assert.match(view, /pdfBase64: pdfPreview\.pdfBase64/);
  assert.doesNotMatch(view, /generateOtcInvoice\(pdfPreview\.payload\)/);
});

test('settlement tabs cannot widen the mobile page', async () => {
  const css = await readFile(new URL('../src/hedge/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.app-page--settlement > \.app-segmented \{ max-width: 100%; min-width: 0; \}/);
});

test('FCBS settlement UI preserves document and payment controls while legacy internal hedges remain blocked', async () => {
  const [view, methodology] = await Promise.all([
    readFile(new URL('../src/hedge/views/SettlementView.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/hedge/lib/methodology.js', import.meta.url), 'utf8'),
  ]);

  assert.match(view, /Existing monthly draft/);
  assert.match(view, /Issued FCBS own-account documents are immutable/);
  assert.match(view, /Payer: \{paymentDirection\.payer\.fullName\} · Payee: \{paymentDirection\.payee\.fullName\}/);
  assert.match(view, /group\.blockingReasons/);
  assert.match(view, /displayMtm \?\? -mtm/);
  assert.match(view, /Internal hedge — no external settlement document/);
  assert.match(methodology, /FCBHK own-account hedges retain their internal allocation panel/);
  assert.match(methodology, /it does not add exposure, fees or P&L again/);
  assert.match(methodology, /unavailable valuation, incomplete finality or a zero net amount/);
});
