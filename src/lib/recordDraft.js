// Three-way comparison: carry edits forward only when their source field did
// not change. Arrays are reviewed as a whole so identifiers cannot be mixed.
export function stableRecordValue(value) {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableRecordValue).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableRecordValue(value[key])}`).join(',')}}`;
}

export const sameRecordValue = (left, right) => stableRecordValue(left) === stableRecordValue(right);
const object = (value) => value != null && typeof value === 'object' && !Array.isArray(value);

export function mergeRecordDraft(base, draft, current, path = '') {
  if (sameRecordValue(base, draft)) return { value: current, conflicts: [], changes: [] };
  if (object(base) && object(draft) && object(current)) {
    const result = { value: { ...current }, conflicts: [], changes: [] };
    for (const key of new Set([...Object.keys(base), ...Object.keys(draft)])) {
      // Do not assign prototype setters from recovered browser storage.
      if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
      const next = mergeRecordDraft(base[key], draft[key], current[key], path ? `${path}.${key}` : key);
      if (next.value === undefined) delete result.value[key];
      else result.value[key] = next.value;
      result.conflicts.push(...next.conflicts);
      result.changes.push(...next.changes);
    }
    return result;
  }
  const change = { field: path, before: base, draft, current };
  if (!sameRecordValue(base, current) && !sameRecordValue(draft, current)) {
    return { value: current, conflicts: [change], changes: [change] };
  }
  return { value: draft, conflicts: [], changes: sameRecordValue(draft, current) ? [] : [change] };
}

export function changedRecordFields(before, after, labels = {}) {
  return mergeRecordDraft(before, after, before).changes.map((change) => ({
    ...change, label: labels[change.field] || change.field.replaceAll('.', ' / ').replace(/([a-z])([A-Z])/g, '$1 $2'),
  }));
}
