const ALLOWED_STYLE_PROPERTIES = new Set([
  'background', 'background-color', 'border', 'border-bottom', 'border-collapse', 'border-color',
  'border-left', 'border-radius', 'border-right', 'border-spacing', 'border-style', 'border-top',
  'border-width', 'color', 'display', 'font-family', 'font-size', 'font-style', 'font-weight',
  'height', 'letter-spacing', 'line-height', 'margin', 'margin-bottom', 'margin-left', 'margin-right',
  'margin-top', 'max-height', 'max-width', 'min-height', 'min-width', 'opacity', 'padding',
  'padding-bottom', 'padding-left', 'padding-right', 'padding-top', 'text-align', 'text-decoration',
  'text-transform', 'vertical-align', 'white-space', 'width', 'word-break', 'word-wrap',
]);

const PRESENTATION_COMMENT_PATTERNS = [
  /<!--([\s\S]*?)-->/g,
  /(?:&lt;|&#0*60;|&#x0*3c;)!--([\s\S]*?)--(?:&gt;|&#0*62;|&#x0*3e;)/gi,
];

function isPresentationStylesheet(value) {
  const source = String(value || '').trim();
  if (!source || source.length > 50_000) return false;
  const hasSelector = /(?:^|[}\s])(?:\.[a-z][\w-]*|body|html|p|table|td|th)\s*(?:,[^{]+)?\{/i.test(source);
  const hasDeclaration = /\b(?:background(?:-color)?|border|color|display|font(?:-family|-size|-style|-weight)?|line-height|margin|padding|text-align|width)\s*:/i.test(source);
  return hasSelector && hasDeclaration && source.includes('}');
}

export function stripEmailPresentationComments(value) {
  return PRESENTATION_COMMENT_PATTERNS.reduce(
    (content, pattern) => content.replace(pattern, (match, body) => isPresentationStylesheet(body) ? '' : match),
    String(value || ''),
  );
}

export function safeEmailImageSource(value) {
  try {
    const url = new URL(value);
    return ['blob:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

export function sanitizeEmailInlineStyle(value) {
  return String(value || '').split(';').map((declaration) => {
    const separator = declaration.indexOf(':');
    if (separator <= 0) return '';
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const styleValue = declaration.slice(separator + 1).trim().slice(0, 300);
    if (!ALLOWED_STYLE_PROPERTIES.has(property) || !styleValue) return '';
    if (/url\s*\(|expression\s*\(|javascript:|@import|behavior\s*:|-moz-binding/i.test(styleValue)) return '';
    return `${property}: ${styleValue}`;
  }).filter(Boolean).join('; ');
}
