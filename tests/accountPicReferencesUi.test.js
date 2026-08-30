import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pageUrl = new URL('../src/pages/AccountManagers.jsx', import.meta.url);
const componentUrl = new URL('../src/components/account-managers/BuyerPicReferences.jsx', import.meta.url);
const rowColorsUrl = new URL('../src/components/account-managers/BuyerPicRowColorsDialog.jsx', import.meta.url);

test('Account Managers exposes the two approved subpages', async () => {
  const source = await readFile(pageUrl, 'utf8');
  assert.match(source, /id: 'managers', label: 'Account Managers'/);
  assert.match(source, /id: 'buyer-pic-references', label: 'Buyer PIC References'/);
  assert.match(source, /<BuyerPicReferences/);
});

test('Buyer PIC row colours support any column, exact values, ordered precedence, and local authoritative merging', async () => {
  const source = await readFile(componentUrl, 'utf8');
  const dialog = await readFile(rowColorsUrl, 'utf8');
  assert.match(source, />Row colours</);
  assert.match(source, /accountPicRowColorsSave/);
  assert.match(source, /expectedRevision: directory\.revision/);
  assert.match(source, /setDirectory\(next\)/);
  assert.match(source, /rowColorRules=\{directory\.rowColorRules\}/);
  assert.match(dialog, /Colour a row when any selected column exactly matches a value/);
  assert.match(dialog, /The first matching rule wins/);
  assert.match(dialog, /columns\.map/);
  assert.match(dialog, /accountPicRowColorOptions/);
  assert.match(dialog, /Move colour rule/);
  assert.match(dialog, /Save row colours/);
});

test('Buyer PIC editor is flexible, reference-only, responsive, revisioned, and saves without a list reload', async () => {
  const source = await readFile(componentUrl, 'utf8');
  assert.match(source, /do not route work, assign people, modify Enquiries\/STEMs, or classify vessels/);
  assert.match(source, /hidden overflow-x-auto md:block/);
  assert.match(source, /space-y-3 md:hidden/);
  assert.match(source, /expectedRevision: directory\.revision/);
  assert.match(source, /Add vessel type/);
  assert.match(source, /Row header \(optional\)/);
  assert.match(source, /buyer_trader/);
  assert.match(source, /supplier_trader/);
  assert.match(source, /idempotencyKey: operationKey\(kind, payload\)/);
  assert.match(source, /mergeSummary\(next\)/);
  assert.doesNotMatch(source, /loadSummaries\(\{ background: true \}\).*saved/s);
});
