// This module keeps the document projection local and accepts already-normalized
// clause rows; no Salesforce or export request is made while composing.
function decodeDocumentEntity(entity) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  if (Object.hasOwn(named, entity)) return named[entity];
  if (/^#\d+$/.test(entity)) return String.fromCodePoint(Number(entity.slice(1)));
  if (/^#x[\da-f]+$/i.test(entity)) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
  return `&${entity};`;
}

export function normalizeDocumentPreviewText(value) {
  let source = String(value || '').replace(/\r\n?/g, '\n');
  if (/<\/?[a-z][\s\S]*>/i.test(source)) {
    source = source
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '- ')
      .replace(/<\/(?:p|div|h[1-6]|blockquote|li)>/gi, '\n\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&([^;\s]+);/g, (_, entity) => decodeDocumentEntity(entity));
  }
  return source
    .replace(/\u00a0/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function clean(value) {
  return normalizeDocumentPreviewText(value);
}

function fallbackCompile(rows, style) {
  return (rows || []).map((row, index) => {
    const text = clean(row?.clauseText || row?.text || row);
    if (!text) return null;
    return style === 'Hyphen' ? `- ${text}` : `${index + 1}. ${text}`;
  }).filter(Boolean).join(style === 'Hyphen' ? '\n' : '\n\n');
}

function rowsFor(projection) {
  return projection?.assignments || projection?.draftAssignments || projection?.rows || projection?.activeAssignments || [];
}

export function documentProjectionText(projection) {
  const rows = rowsFor(projection);
  return rows.length ? fallbackCompile(rows, projection?.style || 'Numbered') : clean(projection?.text);
}

export function specialTermDocumentModel({ term, revision, detail, mode = 'draft' } = {}) {
  // A Special Term attachment is intentionally limited to the Terms Text
  // projection. Confirmation and Nomination remarks remain independent fields
  // and must never be rendered into this document or passed to export UI.
  const projection = mode === 'draft' && revision?.projections
    ? revision.projections.termsText
    : detail?.projections?.termsText;
  return {
    title: clean(term?.name) || 'Special Term',
    mode,
    revisionId: mode === 'draft' ? revision?.id || null : null,
    termsText: documentProjectionText(projection) || clean(term?.termsText),
    isDraft: mode === 'draft',
  };
}

export function documentPreviewKey(model) {
  return JSON.stringify({
    title: model?.title || '', mode: model?.mode || '', termsText: model?.termsText || '',
  });
}

const PREVIEW_LINE_CAPACITY = 38;
const PREVIEW_CHAR_CAPACITY = 76;

function previewBlocks(value) {
  const source = clean(value);
  if (!source) return [];
  const lines = source.split('\n');
  const numbered = [];
  let current = [];
  let expected = 1;
  let validNumbering = false;
  for (const line of lines) {
    const marker = line.match(/^\s*(\d+)\.\s+(.+)$/);
    if (marker) {
      if (Number(marker[1]) !== expected) return source.split(/\n{2,}/).filter(Boolean);
      if (current.length) numbered.push(current.join('\n').trim());
      current = [`${expected}. ${marker[2]}`];
      expected += 1;
      validNumbering = true;
    } else if (current.length) current.push(line);
    else if (line.trim()) return source.split(/\n{2,}/).filter(Boolean);
  }
  if (current.length) numbered.push(current.join('\n').trim());
  return validNumbering ? numbered : source.split(/\n{2,}/).filter(Boolean);
}

function wrapPreviewBlock(value) {
  const wrapped = [];
  for (const hardLine of String(value || '').split('\n')) {
    const words = hardLine.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      wrapped.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      if (line && `${line} ${word}`.length > PREVIEW_CHAR_CAPACITY) {
        wrapped.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    if (line) wrapped.push(line);
  }
  return wrapped;
}

/**
 * Lightweight, local-only preview pagination. Export pagination remains
 * authoritative; this prevents long drafts from being clipped while keeping
 * short clauses together and avoiding an orphaned list marker.
 */
export function paginateDocumentText(value, { title = '' } = {}) {
  const titleLines = Math.max(1, Math.ceil(clean(title).length / 55));
  const capacity = Math.max(34, PREVIEW_LINE_CAPACITY - Math.max(0, titleLines - 1) * 2);
  const pages = [];
  let pageLines = [];
  const finishPage = () => {
    pages.push(pageLines.join('\n').trimEnd());
    pageLines = [];
  };

  for (const block of previewBlocks(value)) {
    let lines = wrapPreviewBlock(block);
    const blockWeight = lines.length + 1;
    if (blockWeight <= capacity) {
      if (pageLines.length && pageLines.length + blockWeight > capacity) finishPage();
      if (pageLines.length) pageLines.push('');
      pageLines.push(...lines);
      continue;
    }

    while (lines.length) {
      let available = capacity - pageLines.length;
      if (available < 2) {
        finishPage();
        available = capacity;
      }
      pageLines.push(...lines.splice(0, available));
      if (lines.length) finishPage();
    }
  }
  if (pageLines.length || !pages.length) finishPage();
  return pages;
}
