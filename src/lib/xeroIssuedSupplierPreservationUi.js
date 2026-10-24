import { ISSUED_SUPPLIER_POLICY, ISSUED_PETROLEUM_POLICY, ISSUED_PETROLEUM_V2_POLICY, isIssuedPreservationPolicy } from '../../config/xeroIssuedPreservationPolicies.js';

export const PRESERVATION_PACKET_MAX_BYTES = 200000;

export function parsePreservationPacket(text) {
  if (new TextEncoder().encode(text).length > PRESERVATION_PACKET_MAX_BYTES) throw new Error('Evidence exceeds 200 KB.');
  const packet = JSON.parse(text);
  if (!validatePreservationPacket(packet)) throw new Error('Unsupported evidence fields or records.');
  return packet;
}

const RECORD_KEYS = ['sourceId', 'xeroDocumentId', 'documentId', 'versionId', 'sha256', 'review'];
const REVIEW_KEYS = ['reviewer', 'reviewedAt', 'reviewRecordHash', 'sourceNumber', 'printedNumber', 'sellerName', 'buyerName', 'invoiceDate', 'dueDate', 'currency', 'total', 'totalTax', 'vessel', 'lines'];
const PETROLEUM_REVIEW_KEYS = [...REVIEW_KEYS, 'numberRule', 'deliveryDate', 'taxEvidence', 'counterparties'];
const PETROLEUM_LINE_KEYS = ['description', 'quantity', 'unit', 'unitPrice', 'amount', 'sourceProductId', 'sourceProductName', 'productEvidence'];
const COUNTERPARTY_KEYS = ['accountId', 'contactId', 'tenantId', 'sourceName', 'companyCode', 'printedSeller', 'printedBuyer', 'basis'];
const ATTACHMENT_KEYS = ['linkId', 'documentId', 'versionId', 'sha256', 'checksum', 'contentSize', 'fileType', 'fileExtension', 'role', 'reviewRecordHash'];
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (value, keys) => object(value) && Object.keys(value).every((key) => keys.includes(key));
const scalar = (value) => typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));

export function validatePreservationPacket(data) {
  if (!onlyKeys(data, ['records', 'policyVersion']) || !Array.isArray(data.records) || !data.records.length || data.records.length > 25) return false;
  const policy = Object.hasOwn(data, 'policyVersion') ? data.policyVersion : ISSUED_SUPPLIER_POLICY;
  if (!isIssuedPreservationPolicy(policy)) return false;
  const v2 = policy === ISSUED_PETROLEUM_V2_POLICY;
  const petroleum = v2 || policy === ISSUED_PETROLEUM_POLICY;
  return data.records.every((record) => onlyKeys(record, v2 ? [...RECORD_KEYS, 'attachments'] : RECORD_KEYS)
    && RECORD_KEYS.filter((key) => key !== 'review').every((key) => typeof record[key] === 'string' && record[key].trim())
    && (!v2 || (Array.isArray(record.attachments) && record.attachments.length >= 1 && record.attachments.length <= 20
      && record.attachments.every((entry) => onlyKeys(entry, ATTACHMENT_KEYS)
        && ATTACHMENT_KEYS.every((key) => Object.hasOwn(entry, key) && scalar(entry[key])))))
    && onlyKeys(record.review, petroleum ? PETROLEUM_REVIEW_KEYS : REVIEW_KEYS)
    && Object.entries(record.review).every(([key, value]) => key === 'lines'
      ? Array.isArray(value) && value.every((line) => onlyKeys(line, petroleum ? PETROLEUM_LINE_KEYS : ['description', 'amount'])
        && typeof line.description === 'string' && scalar(line.amount) && Object.values(line).every(scalar))
      : petroleum && key === 'counterparties'
        ? onlyKeys(value, COUNTERPARTY_KEYS) && Object.values(value).every((literal) => typeof literal === 'string')
        : (petroleum && ['deliveryDate', 'totalTax', ...(v2 ? ['invoiceDate', 'dueDate'] : [])].includes(key) && value === null) || scalar(value)));
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
