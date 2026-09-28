export const XERO_DOCUMENT_CORRECTION_POLICY = 'document_field_correction_v1';
export const XERO_DOCUMENT_CORRECTION_BATCH_LIMIT = 25;

const OUTCOMES = new Set(['applied', 'already_compliant', 'legacy_preserved', 'blocked', 'failed', 'uncertain']);

export function documentCorrectionPreviewValid(preview) {
  return preview?.policy === XERO_DOCUMENT_CORRECTION_POLICY
    && typeof preview.previewId === 'string' && Boolean(preview.previewId.trim())
    && Array.isArray(preview.items)
    && preview.items.every((item) => item && typeof item.id === 'string' && Boolean(item.id.trim()))
    && new Set(preview.items.map((item) => item.id)).size === preview.items.length
    && Number.isSafeInteger(preview.totalCount) && preview.totalCount === preview.items.length
    && preview.nextOffset === null;
}

export async function collectDocumentCorrectionPreview(initial, loadPage, onProgress = () => {}) {
  const fail = () => { throw new Error('Incomplete correction preview pages. No records selected. Prepare a new preview.'); };
  if (initial?.policy !== XERO_DOCUMENT_CORRECTION_POLICY || typeof initial.previewId !== 'string' || !initial.previewId.trim()
    || !Number.isSafeInteger(initial.totalCount) || initial.totalCount < 0) fail();
  const items = []; const ids = new Set(); let page = initial;
  while (true) {
    if (page?.policy !== initial.policy || page.previewId !== initial.previewId || page.totalCount !== initial.totalCount
      || !Array.isArray(page.items)) fail();
    for (const item of page.items) {
      if (!item || typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id)) fail();
      ids.add(item.id); items.push(item);
    }
    if (items.length > initial.totalCount) fail();
    onProgress(items.length, initial.totalCount);
    if (page.nextOffset === null) {
      if (items.length !== initial.totalCount) fail();
      return { ...initial, items, nextOffset: null };
    }
    if (!page.items.length || !Number.isSafeInteger(page.nextOffset) || page.nextOffset !== items.length || page.nextOffset >= initial.totalCount) fail();
    page = await loadPage(initial.previewId, page.nextOffset);
  }
}

export function documentCorrectionSelectable(preview, item) {
  return documentCorrectionPreviewValid(preview) && item?.outcome === 'eligible'
    && typeof item.projectionFingerprint === 'string' && Boolean(item.projectionFingerprint.trim())
    && Array.isArray(item.changes) && (item.changes.length > 0 || item.linkOnly === true);
}

export function documentCorrectionInitialSelection(preview) {
  if (!documentCorrectionPreviewValid(preview)) return new Set();
  return new Set(preview.items.filter((item) => documentCorrectionSelectable(preview, item))
    .slice(0, XERO_DOCUMENT_CORRECTION_BATCH_LIMIT).map((item) => item.id));
}

export function documentCorrectionSelection(preview, selected) {
  if (!documentCorrectionPreviewValid(preview) || !(selected instanceof Set)
    || !selected.size || selected.size > XERO_DOCUMENT_CORRECTION_BATCH_LIMIT) return [];
  const items = preview.items.filter((item) => selected.has(item.id));
  return items.length === selected.size && items.every((item) => documentCorrectionSelectable(preview, item))
    ? items.map((item) => item.id) : [];
}

export function documentCorrectionOutcomes(ids, items) {
  return ids.map((id) => {
    const matches = Array.isArray(items) ? items.filter((item) => item?.id === id) : [];
    const item = matches.length === 1 ? matches[0] : null;
    const outcome = item?.outcome || item?.status;
    return item && OUTCOMES.has(outcome) ? { ...item, outcome } : {
      id, outcome: 'uncertain', reason: 'Result not confirmed. Review the original attempt before retrying.',
    };
  });
}

export function documentCorrectionValue(value) {
  if (value == null || value === '') return '(empty)';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export function documentCorrectionOutcomeLabel(outcome) {
  return ({ eligible: 'Eligible', applied: 'Applied', already_compliant: 'Already compliant',
    legacy_preserved: 'Legacy preserved', blocked: 'Blocked', failed: 'Failed', uncertain: 'Uncertain' })[outcome] || 'Needs review';
}
