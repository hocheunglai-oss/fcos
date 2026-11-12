import { richTextToCopyText } from '../../shared/specialTermsCopyText.js';

export { richTextToCopyText };

const RICH_TEXT_TAG = /<\/?(?:p|br|strong|b|em|i|u|s|ul|ol|li|h3|h4|blockquote|a|span)\b/i;

function escapeRichText(value) {
  return String(value).replace(/[&<>]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
  })[character]);
}

export function specialTermEditorValue(value) {
  const source = String(value || '').trim();
  if (!source || RICH_TEXT_TAG.test(source)) return source;
  return source
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeRichText(paragraph).replaceAll('\n', '<br>')}</p>`)
    .join('');
}

export function richTextToPlain(value) {
  return richTextToCopyText(value).replace(/\s+/g, ' ').trim();
}

export function specialTermFilenameKey(value) {
  return String(value ?? '')
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .slice(0, 120)
    .toLowerCase() || 'special term';
}
