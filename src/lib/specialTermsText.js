import { Parser } from 'htmlparser2';

const BLOCK_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote']);

export function richTextToCopyText(value) {
  if (!value) return '';
  let output = '';
  const parser = new Parser({
    onopentag(name) {
      if (name === 'br') output += '\n';
      else if (name === 'li') output += '- ';
    },
    ontext(valueText) {
      output += valueText;
    },
    onclosetag(name) {
      if (name === 'li') output += '\n';
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
