import {
  buildSpecialTermsDocumentModel,
  duplicateSuffix,
  generateSpecialTermsDocxFromModel,
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

export async function generateSpecialTermDocx(term, options = {}) {
  return generateSpecialTermsDocxFromModel(buildSpecialTermsDocumentModel(term, options));
}

export async function generateSpecialTermsDocument(term, { format = 'pdf', ...options } = {}) {
  const model = buildSpecialTermsDocumentModel(term, options);
  if (format === 'pdf') return generateSpecialTermsPdfFromModel(model);
  if (format === 'docx') return generateSpecialTermsDocxFromModel(model);
  const error = new Error('Choose PDF or Word document format.');
  error.status = 400;
  error.code = 'SPECIAL_TERMS_DOCUMENT_FORMAT_INVALID';
  throw error;
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
