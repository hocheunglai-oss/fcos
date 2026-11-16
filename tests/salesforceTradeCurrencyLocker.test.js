import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const editorPath = new URL('../force-app/main/default/lwc/fcosTradeCurrencyEditor/fcosTradeCurrencyEditor.js', import.meta.url);
const source = readFileSync(editorPath, 'utf8')
  .replace(/^import .*;\r?$/gm, '')
  .replace(/^\s*@api\s*$/gm, '')
  .replace('export default class', 'class');

test('the currency editor loads when the Lightning Locker global BigInt is unavailable', () => {
  const Editor = runInNewContext(`${source}\nFcosTradeCurrencyEditor`, {
    BigInt: undefined,
    LightningElement: class {},
  });
  const editor = new Editor();
  editor.amendmentOriginalReview = { currencyCode: 'USD', nativeUnitPrice: '100000000.00000005' };
  editor.amendmentRate = { usdHkdRate: '7.8' };
  editor.handleAmendmentCurrencyChange({ detail: { value: 'HKD' } });
  assert.equal(editor.amendmentNativeUnitPrice, '780000000.00000039');

  editor.amendmentOriginalReview = { currencyCode: 'HKD', nativeUnitPrice: '1', rate: '6' };
  editor.handleAmendmentCurrencyChange({ detail: { value: 'USD' } });
  assert.equal(editor.amendmentNativeUnitPrice, '0.16666667');

  editor.amendmentOriginalReview = { currencyCode: 'USD', nativeUnitPrice: '0.000000005' };
  editor.amendmentRate = { usdHkdRate: '1' };
  editor.handleAmendmentCurrencyChange({ detail: { value: 'HKD' } });
  assert.equal(editor.amendmentNativeUnitPrice, '0.00000001');
});
