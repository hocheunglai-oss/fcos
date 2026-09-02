import assert from 'node:assert/strict';
import test from 'node:test';
import { richTextToCopyText, richTextToPlain, specialTermEditorValue, specialTermFilenameKey } from '../src/lib/specialTermsText.js';

test('Special Term remarks copy as readable plain text', () => {
  const richText = '<p>Hello &amp; welcome</p><ul><li>First <strong>item</strong></li><li>Second&nbsp;item</li></ul><p>Final<br>line</p>';
  assert.equal(richTextToCopyText(richText), 'Hello & welcome\n\n- First item\n- Second item\nFinal\nline');
  assert.equal(richTextToPlain(richText), 'Hello & welcome - First item - Second item Final line');
});

test('Special Term legacy previews remove Salesforce rich-text markup', () => {
  assert.equal(
    richTextToCopyText('<p><span style="font-size: 14px;">- SUPPLIERS SHALL PROVIDE A QUALITY CLAIM TIME BAR OF (14) DAYS FROM THE DATE OF DELIVERY.</span></p>'),
    '- SUPPLIERS SHALL PROVIDE A QUALITY CLAIM TIME BAR OF (14) DAYS FROM THE DATE OF DELIVERY.',
  );
  assert.equal(
    richTextToCopyText('<p><span style="background-color: rgb(255, 255, 255);">- SUPPLIERS SHALL PROVIDE A QUALITY CLAIM TIME BAR OF (14) DAYS FROM THE DATE OF DELIVERY, OVERRIDING SUPPLIER GENERAL SALES TERMS AND CONDITIONS IF A SHORTER DEFAULT PERIOD IS SET OUT THEREIN.</span></p>'),
    '- SUPPLIERS SHALL PROVIDE A QUALITY CLAIM TIME BAR OF (14) DAYS FROM THE DATE OF DELIVERY, OVERRIDING SUPPLIER GENERAL SALES TERMS AND CONDITIONS IF A SHORTER DEFAULT PERIOD IS SET OUT THEREIN.',
  );
});

test('Special Term remark conversion tolerates malformed rich text and empty values', () => {
  assert.equal(richTextToCopyText('<p>Open <strong>format</p><li>Recovered'), 'Open format\n\n- Recovered');
  assert.equal(richTextToCopyText(''), '');
  assert.equal(richTextToPlain(null), '');
});

test('Special Term editor safely presents existing Salesforce plain text as rich text', () => {
  assert.equal(
    specialTermEditorValue('1. First clause\ncontinued\n\n2. Second <clause> & condition'),
    '<p>1. First clause<br>continued</p><p>2. Second &lt;clause&gt; &amp; condition</p>',
  );
  assert.equal(specialTermEditorValue('<ol><li>First clause</li><li>Second clause</li></ol>'), '<ol><li>First clause</li><li>Second clause</li></ol>');
});

test('Special Term ordered lists retain visible numbering in plain-text views', () => {
  assert.equal(
    richTextToCopyText('<ol><li>First clause</li><li>Second clause<ol><li>Nested clause</li></ol></li></ol>'),
    '1. First clause\n2. Second clause\n2.1. Nested clause',
  );
});

test('Special Term duplicate detection follows the server filename sanitizer', () => {
  assert.equal(specialTermFilenameKey(' Port / Product: Terms? '), 'port product terms');
  assert.equal(specialTermFilenameKey('Port: Product / Terms*'), 'port product terms');
  assert.equal(specialTermFilenameKey(''), 'special term');
});
