import { Parser } from 'htmlparser2';

const BLOCK_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote']);
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

export function richTextToCopyText(value) {
  if (!value) return '';
  let output = '';
  const lists = [];
  const parser = new Parser({
    onopentag(name) {
      if (name === 'br') output += '\n';
      else if (name === 'ol') lists.push({ ordered: true, index: 0 });
      else if (name === 'ul') lists.push({ ordered: false, index: 0 });
      else if (name === 'li') {
        if (output && !output.endsWith('\n')) output += '\n';
        const list = lists.at(-1);
        if (list?.ordered) list.index += 1;
        const orderedPath = lists.filter((entry) => entry.ordered).map((entry) => entry.index).filter(Boolean);
        const prefix = list?.ordered ? `${orderedPath.join('.')}. ` : '- ';
        output += prefix;
      }
    },
    ontext(valueText) {
      output += valueText;
    },
    onclosetag(name) {
      if (name === 'li') output += '\n';
      else if (name === 'ol' || name === 'ul') lists.pop();
      else if (BLOCK_TAGS.has(name)) output += '\n\n';
    },
  }, { decodeEntities: true, lowerCaseTags: true });
  parser.write(String(value));
  parser.end();
  return output
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
