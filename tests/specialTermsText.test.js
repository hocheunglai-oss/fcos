import assert from 'node:assert/strict';
import test from 'node:test';
import { richTextToCopyText, richTextToPlain, specialTermFilenameKey } from '../src/lib/specialTermsText.js';

test('Special Term remarks copy as readable plain text', () => {
  const richText = '<p>Hello &amp; welcome</p><ul><li>First <strong>item</strong></li><li>Second&nbsp;item</li></ul><p>Final<br>line</p>';
  assert.equal(richTextToCopyText(richText), 'Hello & welcome\n\n- First item\n- Second item\nFinal\nline');
  assert.equal(richTextToPlain(richText), 'Hello & welcome - First item - Second item Final line');
});

test('Special Term remark conversion tolerates malformed rich text and empty values', () => {
  assert.equal(richTextToCopyText('<p>Open <strong>format</p><li>Recovered'), 'Open format\n\n- Recovered');
  assert.equal(richTextToCopyText(''), '');
  assert.equal(richTextToPlain(null), '');
});

test('Special Term duplicate detection follows the server filename sanitizer', () => {
  assert.equal(specialTermFilenameKey(' Port / Product: Terms? '), 'port product terms');
  assert.equal(specialTermFilenameKey('Port: Product / Terms*'), 'port product terms');
  assert.equal(specialTermFilenameKey(''), 'special term');
});
