export const PRESERVATION_PACKET_MAX_BYTES = 200000;

const RECORD_KEYS = ['sourceId', 'xeroDocumentId', 'documentId', 'versionId', 'sha256', 'review'];
const REVIEW_KEYS = ['reviewer', 'reviewedAt', 'reviewRecordHash', 'sourceNumber', 'printedNumber', 'sellerName', 'buyerName', 'invoiceDate', 'dueDate', 'currency', 'total', 'totalTax', 'vessel', 'lines'];
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (value, keys) => object(value) && Object.keys(value).every((key) => keys.includes(key));
const scalar = (value) => typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));

export function validatePreservationPacket(data) {
  if (!onlyKeys(data, ['records']) || !Array.isArray(data.records) || !data.records.length || data.records.length > 25) return false;
  return data.records.every((record) => onlyKeys(record, RECORD_KEYS)
    && RECORD_KEYS.filter((key) => key !== 'review').every((key) => typeof record[key] === 'string' && record[key].trim())
    && onlyKeys(record.review, REVIEW_KEYS)
    && Object.entries(record.review).every(([key, value]) => key === 'lines'
      ? Array.isArray(value) && value.every((line) => onlyKeys(line, ['description', 'amount']) && typeof line.description === 'string' && scalar(line.amount))
      : scalar(value)));
}

export function preservationSelection(preview, selected) {
  if (!preview?.run?.id || preview.run.revision == null || !Array.isArray(preview.rows) || !selected?.size) return [];
  const rows = preview.rows.filter((row) => selected.has(row.id));
  if (rows.length !== selected.size || new Set(rows.map((row) => row.id)).size !== rows.length
    || rows.some((row) => !preservationRowSelectable(preview, row))) return [];
  if (preview.run.status === 'authorised' && preview.rows.filter((row) => row.selected).length !== selected.size) return [];
  return rows.map((row) => row.id);
}

export function preservationRowSelectable(preview, row) {
  const status = preview?.run?.status;
  return Boolean(row?.id && !row.blockers?.length && row.fingerprint
    && (status === 'authorised' ? row.status === 'selected' && row.selected === true
      : status === 'ready_for_review' && row.status === 'eligible'));
}

// Missing or duplicate outcomes never stand in for confirmed links.
export function preservationOutcomes(ids, outcomes) {
  return ids.map((id) => {
    const matches = Array.isArray(outcomes) ? outcomes.filter((row) => row.id === id) : [];
    return matches.length === 1 && ['linked', 'failed'].includes(matches[0].status)
      ? matches[0] : { id, status: 'uncertain', error: 'No unique confirmed result was received. Check the saved run before attempting this record again.' };
  });
}
