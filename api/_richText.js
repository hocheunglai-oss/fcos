import sanitizeHtml from 'sanitize-html';

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li',
  'h3', 'h4', 'blockquote', 'a', 'span',
];

const EMPTY_RICH_TEXT = new Set(['', '<p></p>', '<p><br></p>']);

export function sanitizeRichText(value, maxLength = 32768) {
  const source = String(value ?? '').slice(0, maxLength);
  const sanitized = sanitizeHtml(source, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      span: ['style'],
    },
    allowedStyles: {
      span: {
        color: [/^#[0-9a-f]{3,8}$/i, /^rgb\([\d\s,.%]+\)$/i],
        'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgb\([\d\s,.%]+\)$/i],
      },
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tagName, attributes) => ({
        tagName: 'a',
        attribs: {
          ...attributes,
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
    },
    disallowedTagsMode: 'discard',
  }).trim();
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
