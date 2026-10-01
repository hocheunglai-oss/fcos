import { NOM_B_EXTENSIONS, NOM_B_MAX_BYTES } from '../../shared/missingNomB.js';

export const NOM_B_ACCEPT = NOM_B_EXTENSIONS.map((extension) => `.${extension}`).join(',');
export const PENDING_NOM_B_UPLOAD_KEY = 'fcos:missing-nom-b:pending-upload:v1';

export function nomBDataIssues(row) {
  return [['buyerName', 'Buyer details unavailable'], ['vesselName', 'Vessel details unavailable'],
    ['portName', 'Port details unavailable'], ['imo', 'IMO unavailable']]
    .filter(([field]) => !String(row?.[field] || '').trim()).map(([, message]) => message);
}

export function validateNomBFile(file) {
  if (!file) return 'Choose a Nom B document.';
  const extension = String(file.name || '').match(/\.([^.]+)$/)?.[1]?.toLowerCase();
  if (!extension || !NOM_B_EXTENSIONS.includes(extension)) {
    return 'Choose a PDF, JPG, PNG, DOC, or DOCX file.';
  }
  if (!Number.isFinite(file.size) || file.size <= 0) return 'The selected file is empty.';
  if (file.size > NOM_B_MAX_BYTES) return 'Nom B files must be 3 MiB or smaller.';
  return null;
}

export async function fingerprintNomBFile(file, cryptoApi = globalThis.crypto) {
  const bytes = await file.arrayBuffer();
  if (!cryptoApi?.subtle?.digest) throw new Error('Secure file verification is unavailable in this browser.');
  const digest = await cryptoApi.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function recoverPendingUpload(storage) {
  let value;
  try { value = JSON.parse(storage?.getItem(PENDING_NOM_B_UPLOAD_KEY) || 'null'); } catch { return null; }
  if (!value || typeof value !== 'object') return null;
  if (![value.nominationId, value.operationId, value.filename, value.fingerprint].every((item) => typeof item === 'string' && item.length > 0)) return null;
  if (!Number.isSafeInteger(value.size) || value.size <= 0 || value.size > NOM_B_MAX_BYTES) return null;
  if (!/^[a-f0-9]{64}$/.test(value.fingerprint)) return null;
  return value;
}

export function persistPendingUpload(storage, attempt, row) {
  const metadata = {
    nominationId: attempt.nominationId,
    operationId: attempt.operationId,
    filename: attempt.file.name,
    size: attempt.file.size,
    fingerprint: attempt.fingerprint,
    stemName: row?.stemName || '',
    buyerName: row?.buyerName || '',
    vesselName: row?.vesselName || '',
    confirmationReference: row?.confirmationReference || '',
  };
  storage.setItem(PENDING_NOM_B_UPLOAD_KEY, JSON.stringify(metadata));
  return metadata;
}

export function clearPendingUpload(storage, operationId) {
  try {
    const current = recoverPendingUpload(storage);
    if (current?.operationId === operationId) storage.removeItem(PENDING_NOM_B_UPLOAD_KEY);
    return true;
  } catch {
    return false;
  }
}

export function createUploadAttempt({ nominationId, file, fingerprint, previous, pending, idFactory }) {
  const validationError = validateNomBFile(file);
  if (validationError) throw new Error(validationError);
  if (!nominationId) throw new Error('This nomination cannot be identified. Refresh the list.');
  if (!/^[a-f0-9]{64}$/.test(fingerprint || '')) throw new Error('The selected file could not be verified.');
  if (pending) {
    if (pending.nominationId !== nominationId || pending.filename !== file.name || pending.size !== file.size || pending.fingerprint !== fingerprint) {
      throw new Error('This file does not match the unfinished upload. Choose the same file to retry that operation.');
    }
    return { nominationId, file, fingerprint, operationId: pending.operationId };
  }
  if (previous?.nominationId === nominationId && previous.fingerprint === fingerprint && previous.file.name === file.name) return previous;
  const operationId = idFactory();
  if (!operationId) throw new Error('A secure upload ID could not be created.');
  return { nominationId, file, fingerprint, operationId };
}

export function isDefiniteNoWrite(response) {
  const code = response?.data?.code;
  if (response?.meta?.cacheLayer === 'client' && code === 'CLIENT_FUNCTION_CONTRACT_INVALID') return true;
  return [
    'MISSING_NOM_B_ID_INVALID',
    'MISSING_NOM_B_OPERATION_INVALID',
    'MISSING_NOM_B_FILENAME_INVALID',
    'MISSING_NOM_B_FILE_TYPE',
    'MISSING_NOM_B_FILE_INVALID',
    'MISSING_NOM_B_CONTENT_TYPE',
    'MISSING_NOM_B_UPLOAD_FORBIDDEN',
    'MISSING_NOM_B_PREVIEW_WRITE_DISABLED',
    'MISSING_NOM_B_NOT_FOUND',
    'MISSING_NOM_B_CONFIRMATION_STALE',
    'MISSING_NOM_B_NOT_OWNER',
    'MISSING_NOM_B_SOURCE_CHANGED',
    'MISSING_NOM_B_ALREADY_FILED',
    'MISSING_NOM_B_DELIVERY_BEFORE_CUTOFF',
    'MISSING_NOM_B_DELIVERY_UNVERIFIED',
    'MISSING_NOM_B_COMPOSITE_ROLLED_BACK',
    'AUTH_REQUIRED',
    'ACCESS_DENIED',
    'EXTERNAL_ACTION_GATE_DISABLED',
  ].includes(code);
}

export function isProvenNoWriteForOperation(response, hadEarlierUncertainAttempt) {
  return !hadEarlierUncertainAttempt && isDefiniteNoWrite(response);
}

const hkDate = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Hong_Kong', day: '2-digit', month: 'short', year: 'numeric' });
const hkDateTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Hong_Kong', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

export function displayNomBDate(value, withTime = false) {
  if (!value) return '—';
  const raw = String(value);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00+08:00`) : new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return withTime ? hkDateTime.format(date) : hkDate.format(date);
}

export function isVerifiedUpload(data, attempt) {
  return Boolean(
    data?.verified === true
    && data.nominationId === attempt?.nominationId
    && data.contentDocumentId
    && data.receivedStatus === '🟢'
  );
}

export const initialPagination = { search: '', cursors: [null], page: 0, refreshKey: 0 };

export function paginationReducer(state, action) {
  switch (action.type) {
    case 'search':
      return { search: action.search.trim(), cursors: [null], page: 0, refreshKey: state.refreshKey + 1 };
    case 'refresh':
      return { ...state, cursors: [null], page: 0, refreshKey: state.refreshKey + 1 };
    case 'next':
      if (!action.cursor) return state;
      return { ...state, cursors: [...state.cursors.slice(0, state.page + 1), action.cursor], page: state.page + 1 };
    case 'previous':
      return state.page > 0 ? { ...state, page: state.page - 1 } : state;
    default:
      return state;
  }
}

export function listPayload(pagination) {
  return { cursor: pagination.cursors[pagination.page] || null, search: pagination.search };
}
