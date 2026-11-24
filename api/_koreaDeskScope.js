export const KOREA_DESK_MEMBER_FIELD = 'Korea_Desk_Member__c';

// STEM field lists cached before the Salesforce rollout cannot describe Korea Desk.
export function koreaDeskDescribeCacheVersion(objectName, version) {
  return objectName.toLowerCase() === 'stem__c' ? `${version}:korea-desk` : version;
}

export function normalizeKoreaDeskMode(value) {
  if (value == null || value === '') return 'all';
  if (['all', 'include', 'exclude'].includes(value)) return value;
  const error = new Error('Korea Desk filter is invalid.');
  error.status = 400;
  error.code = 'KOREA_DESK_FILTER_INVALID';
  throw error;
}

export function koreaDeskCondition(mode, prefix = '') {
  mode = normalizeKoreaDeskMode(mode);
  if (mode === 'all') return '';
  const field = `${prefix}${KOREA_DESK_MEMBER_FIELD}`;
  return mode === 'include' ? `${field} = true` : `(${field} = false OR ${field} = null)`;
}

export function koreaDeskMatches(stem, mode) {
  mode = normalizeKoreaDeskMode(mode);
  if (mode === 'all') return true;
  if (!Object.hasOwn(stem || {}, KOREA_DESK_MEMBER_FIELD)) {
    const error = new Error('Korea Desk membership is unavailable in Salesforce.');
    error.status = 503;
    error.code = 'KOREA_DESK_SCHEMA';
    throw error;
  }
  return mode === 'include' ? stem[KOREA_DESK_MEMBER_FIELD] === true : stem[KOREA_DESK_MEMBER_FIELD] !== true;
}

export function requireKoreaDeskField(fields, mode) {
  mode = normalizeKoreaDeskMode(mode);
  if (mode !== 'all' && !fields.has(KOREA_DESK_MEMBER_FIELD)) {
    const error = new Error('Korea Desk membership is unavailable in Salesforce.');
    error.status = 503;
    error.code = 'KOREA_DESK_SCHEMA';
    throw error;
  }
}
