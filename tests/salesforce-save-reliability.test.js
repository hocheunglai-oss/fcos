import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceRoot = new URL('../force-app/main/default/lwc/', import.meta.url);

async function readBundleFile(bundle, file) {
  return readFile(new URL(`${bundle}/${file}`, sourceRoot), 'utf8');
}

test('transport costs are awaited and async failures are shown instead of leaving the modal busy', async () => {
  const source = await readBundleFile('fcbEditStemLineItemModal', 'fcbEditStemLineItemModal.js');

  assert.match(source, /await offerLineItemExtraCostsComponent\.upsertExtraCosts/);
  assert.doesNotMatch(source, /upsertExtraCosts\([^;]+\.then\(/s);
  assert.match(source, /this\.actionExecuting = false;\s+this\.showOperationError\(\s*'Related cost update failed'/s);
  assert.match(source, /return Promise\.all\(\(this\.stemBuyerBrokers \|\| \[\]\)\.map/);
});

test('BDN details save only dirty lines and the parent awaits them sequentially', async () => {
  const child = await readBundleFile('fcbStemLineItem', 'fcbStemLineItem.js');
  const parent = await readBundleFile('fcbStemProcessing', 'fcbStemProcessing.js');
  const bdnSaveMethod = parent.slice(
    parent.indexOf('async handleSubmitAllProductLineItems()'),
    parent.indexOf('handleSubmitAllCommisions('),
  );

  assert.match(child, /if \(!this\.isDirty\) \{\s+return Promise\.resolve\(\{ skipped: true \}\);/s);
  assert.match(child, /this\._pendingSave = new Promise/);
  assert.match(child, /this\._rejectPendingSave\(new Error\(getErrorMessage\(event\)\)\)/);
  assert.match(bdnSaveMethod, /for \(const form of recordForms\) \{\s+await form\.submitForm\(\);\s+\}/s);
  assert.doesNotMatch(bdnSaveMethod, /recordForms\.forEach/);
  assert.match(bdnSaveMethod, /title: "BDN details were not fully saved"/);
});

test('BDN file binding propagates failures to the aggregate save', async () => {
  const source = await readBundleFile('fcbFileUploadBinder', 'fcbFileUploadBinder.js');
  const bindMethod = source.slice(source.indexOf('async bindWithParent()'), source.indexOf('removeFile()'));

  assert.match(bindMethod, /await uploadFile/);
  assert.match(bindMethod, /await refreshApex/);
  assert.doesNotMatch(bindMethod, /\.catch\(/);
});

test('BDN controls are locked while the sequential save is running', async () => {
  const template = await readBundleFile('fcbStemProcessing', 'fcbStemProcessing.html');

  assert.equal((template.match(/disabled=\{isSavingBdnDetails\}/g) || []).length, 2);
  assert.match(template, /alternative-text="Saving BDN details"/);
});

test('STEM Processing waits for both independent record and product wires before reading payment terms', async () => {
  const source = await readBundleFile('fcbStemProcessing', 'fcbStemProcessing.js');
  const productWire = source.slice(source.indexOf('@wire(getProductInfo'), source.indexOf('@wire(getInvoices'));

  assert.match(source, /this\.paymentTermValue = this\.stem\.Payment_Term__c\?\.value \|\| ''/);
  assert.match(source, /this\.fcbsReference = this\.stem\.FCBS_Reference__c\.value;\s+this\.applyProductInfo\(\);/s);
  assert.match(productWire, /this\.productInfo = data;\s+this\.applyProductInfo\(\);/s);
  assert.match(productWire, /applyProductInfo\(\) \{\s+if \(!this\.stem \|\| !Array\.isArray\(this\.productInfo\)\) return;/s);
  assert.doesNotMatch(productWire, /this\.stem\.Payment_Term__c\.value/);
});
