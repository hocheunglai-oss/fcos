const SPREADSHEET_FORMULA_PREFIX_RE = /^[\s\u0000-\u001F]*[=+\-@]/u;

/**
 * Make untrusted text literal for spreadsheet applications without changing
 * the value kept in application state. Numeric cells must use the RFC encoder
 * directly so valid negative numbers remain numeric in exports.
 */
export function spreadsheetLiteralText(value) {
  const text = String(value ?? '');
  return SPREADSHEET_FORMULA_PREFIX_RE.test(text) ? `'${text}` : text;
}

/** RFC 4180 escaping only; it intentionally does not change cell semantics. */
export function spreadsheetCsvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Encode an untrusted string-valued spreadsheet cell as literal text. */
export function spreadsheetCsvTextCell(value) {
  return spreadsheetCsvCell(spreadsheetLiteralText(value));
}
