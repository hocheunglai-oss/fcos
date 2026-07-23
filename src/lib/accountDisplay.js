function cleanText(value) {
  return String(value || '').trim();
}

export function normalizeAccountClKeys(value) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.map(cleanText).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
}

export function accountClKeyLabel(value) {
  const clKeys = normalizeAccountClKeys(value);
  if (!clKeys.length) return 'CL Key not set';
  return `${clKeys.length === 1 ? 'CL Key' : 'CL Keys'}: ${clKeys.join(', ')}`;
}

export function accountSearchDisplayText(accountName, clKeys) {
  return `${cleanText(accountName) || 'Unnamed Account'} · ${accountClKeyLabel(clKeys)}`;
}
