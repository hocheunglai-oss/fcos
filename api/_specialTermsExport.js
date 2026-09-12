import {
  buildSpecialTermsDocumentModel,
  duplicateSuffix,
  generateSpecialTermsPdfFromModel,
  hongKongDateToken,
  normalizeTermsText,
  safeFilenamePart,
  safelyParseLegacyNumbering,
  SPECIAL_TERMS_DOCUMENT_TOKENS,
} from './_specialTermsDocumentModel.js';

/** Backwards-compatible PDF entry point used by older FCOS clients. */
export function generateSpecialTermPdf(term, options = {}) {
  return generateSpecialTermsPdfFromModel(buildSpecialTermsDocumentModel(term, options));
}

export async function generateSpecialTermsDocument(term, { format = 'pdf', ...options } = {}) {
  if (format !== 'pdf') {
    const error = new Error('Special Terms are available as PDF only.');
    error.status = 400;
    error.code = 'SPECIAL_TERMS_DOCUMENT_FORMAT_INVALID';
    throw error;
  }
  return generateSpecialTermsPdfFromModel(buildSpecialTermsDocumentModel(term, options));
}

export const specialTermsExportInternals = {
  buildSpecialTermsDocumentModel,
  duplicateSuffix,
  hongKongDateToken,
  normalizeTermsText,
  safeFilenamePart,
  safelyParseLegacyNumbering,
  SPECIAL_TERMS_DOCUMENT_TOKENS,
};
