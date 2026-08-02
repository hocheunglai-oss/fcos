import { Parser } from 'htmlparser2';

const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li',
  'h3', 'h4', 'blockquote', 'a', 'span',
]);

const DROP_CONTENT_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template',
]);

const EMPTY_RICH_TEXT = new Set(['', '<p></p>', '<p><br></p>']);
const COLOR_VALUE = /^(?:#[0-9a-f]{3,8}|rgb\([\d\s,.%]+\))$/i;

function escapeText(value) {
  return String(value).replace(/[&<>]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
  })[character]);
}

function escapeAttribute(value) {
  return escapeText(value).replace(/"/g, '&quot;');
}

function safeHref(value) {
  const href = String(value || '').trim().replace(/[\u0000-\u001f\u007f]/g, '');
  if (!href || href.startsWith('//')) return null;
  const scheme = href.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (scheme && !['http', 'https', 'mailto'].includes(scheme)) return null;
  return href;
}

function safeStyle(value) {
  const declarations = [];
  for (const declaration of String(value || '').split(';')) {
    const separator = declaration.indexOf(':');
    if (separator < 0) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const cssValue = declaration.slice(separator + 1).trim();
    if (!['color', 'background-color'].includes(property) || !COLOR_VALUE.test(cssValue)) continue;
    declarations.push(`${property}: ${cssValue}`);
  }
  return declarations.join('; ');
}

function openingTag(name, attributes) {
  if (name === 'br') return '<br>';
  if (name === 'a') {
    const href = safeHref(attributes.href);
    const hrefAttribute = href ? ` href="${escapeAttribute(href)}"` : '';
    return `<a${hrefAttribute} target="_blank" rel="noopener noreferrer">`;
  }
  if (name === 'span') {
    const style = safeStyle(attributes.style);
    return style ? `<span style="${escapeAttribute(style)}">` : '<span>';
  }
  return `<${name}>`;
}

export function sanitizeRichText(value, maxLength = 32768) {
  const source = String(value ?? '').slice(0, maxLength);
  const stack = [];
  let output = '';

  const parser = new Parser({
    onopentag(name, attributes) {
      const parentSuppressed = stack.some((entry) => entry.suppressed);
      const suppressed = parentSuppressed || DROP_CONTENT_TAGS.has(name);
      const emitted = !suppressed && ALLOWED_TAGS.has(name) && name !== 'br';
      stack.push({ name, suppressed, emitted });
      if (!suppressed && ALLOWED_TAGS.has(name)) output += openingTag(name, attributes);
    },
    ontext(text) {
      if (!stack.some((entry) => entry.suppressed)) output += escapeText(text);
    },
    onclosetag(name) {
      const entry = stack.pop();
      if (entry?.emitted && entry.name === name) output += `</${name}>`;
    },
  }, { decodeEntities: true, lowerCaseTags: true, recognizeSelfClosing: true });

  parser.write(source);
  parser.end();
  const sanitized = output.trim();
  return EMPTY_RICH_TEXT.has(sanitized.replaceAll(/\s/g, '').toLowerCase()) ? null : sanitized;
}

export function richTextPlainLength(value) {
  return String(value || '')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim().length;
}
