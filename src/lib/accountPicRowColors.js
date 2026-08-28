const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const ACCOUNT_PIC_ROW_COLOR_MAX_RULES = 50;

export const ACCOUNT_PIC_ROW_COLOR_PALETTE = Object.freeze([
  { key: 'blue', label: 'Blue', swatchClass: 'bg-blue-200 dark:bg-blue-800', rowClass: 'bg-blue-50/70 dark:bg-blue-950/20' },
  { key: 'emerald', label: 'Green', swatchClass: 'bg-emerald-200 dark:bg-emerald-800', rowClass: 'bg-emerald-50/70 dark:bg-emerald-950/20' },
  { key: 'amber', label: 'Amber', swatchClass: 'bg-amber-200 dark:bg-amber-800', rowClass: 'bg-amber-50/70 dark:bg-amber-950/20' },
  { key: 'rose', label: 'Rose', swatchClass: 'bg-rose-200 dark:bg-rose-800', rowClass: 'bg-rose-50/70 dark:bg-rose-950/20' },
  { key: 'violet', label: 'Violet', swatchClass: 'bg-violet-200 dark:bg-violet-800', rowClass: 'bg-violet-50/70 dark:bg-violet-950/20' },
  { key: 'cyan', label: 'Cyan', swatchClass: 'bg-cyan-200 dark:bg-cyan-800', rowClass: 'bg-cyan-50/70 dark:bg-cyan-950/20' },
  { key: 'orange', label: 'Orange', swatchClass: 'bg-orange-200 dark:bg-orange-800', rowClass: 'bg-orange-50/70 dark:bg-orange-950/20' },
  { key: 'slate', label: 'Grey', swatchClass: 'bg-slate-200 dark:bg-slate-700', rowClass: 'bg-slate-100/70 dark:bg-slate-900/30' },
]);

const COLOR_BY_KEY = new Map(ACCOUNT_PIC_ROW_COLOR_PALETTE.map((color) => [color.key, color]));

function normalizedText(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').trim().replace(/\s+/g, ' ');
}

export function accountPicRowColorValue(column, value) {
  if (!column) return 'empty';
  if (column.inputType === 'checkbox') return `boolean:${value === true}`;
  if (column.inputType === 'number') {
    if (value == null || value === '') return 'empty';
    const number = Number(value);
    return Number.isFinite(number) ? `number:${number}` : 'empty';
  }
  if (column.inputType === 'buyer_trader' || column.inputType === 'supplier_trader') {
    const profileId = normalizedText(value?.profileId || value?.id);
    return profileId ? `profile:${profileId.toLowerCase()}` : 'empty';
  }
  const text = normalizedText(value);
  return text ? `text:${text.toLocaleLowerCase('en-US')}` : 'empty';
}

export function accountPicRowColorValueLabel(column, value) {
  if (!column) return 'Blank';
  if (column.inputType === 'checkbox') return value === true ? 'Checked' : 'Not checked';
  if (column.inputType === 'number') return value == null || value === '' ? 'Blank' : Number(value).toLocaleString();
  if (column.inputType === 'buyer_trader' || column.inputType === 'supplier_trader') {
    return normalizedText(value?.name || value?.email) || 'Not selected';
  }
  return normalizedText(value) || 'Blank';
}

export function accountPicRowColorOptions(column, rows = []) {
  const options = new Map();
  if (column?.inputType === 'checkbox') {
    options.set('boolean:true', { value: 'boolean:true', label: 'Checked' });
    options.set('boolean:false', { value: 'boolean:false', label: 'Not checked' });
  } else {
    options.set('empty', { value: 'empty', label: column?.inputType === 'buyer_trader' || column?.inputType === 'supplier_trader' ? 'Not selected' : 'Blank' });
  }
  for (const row of rows) {
    const value = row?.cells?.[column?.id];
    const key = accountPicRowColorValue(column, value);
    if (!options.has(key)) options.set(key, { value: key, label: accountPicRowColorValueLabel(column, value) });
  }
  return [...options.values()].sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }));
}

export function normalizeAccountPicRowColorRules(rules = [], columns = [], { strict = false } = {}) {
  if (!Array.isArray(rules)) {
    if (strict) throw new Error('Row colour rules must be a list.');
    return [];
  }
  if (rules.length > ACCOUNT_PIC_ROW_COLOR_MAX_RULES) throw new Error(`Use no more than ${ACCOUNT_PIC_ROW_COLOR_MAX_RULES} row colour rules.`);
  const columnIds = new Set((columns || []).map((column) => String(column.id || '').trim()).filter(Boolean));
  const seen = new Set();
  const normalized = [];
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index];
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      if (strict) throw new Error(`Row colour rule ${index + 1} is invalid.`);
      continue;
    }
    const id = String(rule.id || '').trim();
    const columnId = String(rule.columnId || '').trim();
    const matchValue = String(rule.matchValue || '').trim();
    const matchLabel = normalizedText(rule.matchLabel).slice(0, 300);
    const color = String(rule.color || '').trim().toLowerCase();
    if (!UUID_RE.test(id) || !UUID_RE.test(columnId) || !matchValue || matchValue.length > 4_100 || !COLOR_BY_KEY.has(color) || !columnIds.has(columnId)) {
      if (strict) throw new Error(`Row colour rule ${index + 1} is incomplete or references an unavailable column.`);
      continue;
    }
    const uniqueKey = `${columnId}\u0000${matchValue}`;
    if (seen.has(uniqueKey)) {
      if (strict) throw new Error('Each column value can have only one row colour rule.');
      continue;
    }
    seen.add(uniqueKey);
    normalized.push({ id, position: normalized.length + 1, columnId, matchValue, matchLabel: matchLabel || matchValue, color });
  }
  return normalized;
}

export function accountPicRowTint(row, columns = [], rules = []) {
  const normalizedRules = normalizeAccountPicRowColorRules(rules, columns);
  if (normalizedRules.length) {
    const columnById = new Map(columns.map((column) => [column.id, column]));
    const match = normalizedRules.find((rule) => accountPicRowColorValue(columnById.get(rule.columnId), row?.cells?.[rule.columnId]) === rule.matchValue);
    return match ? COLOR_BY_KEY.get(match.color)?.rowClass || '' : '';
  }

  // Preserve the original COSCO Team tints until a directory saves explicit rules.
  const team = columns.find((column) => String(column.label || '').trim().toLocaleLowerCase('en-US') === 'team');
  const teamValue = normalizedText(team ? row?.cells?.[team.id] : '').toLocaleLowerCase('en-US');
  if (teamValue.includes('sylvia')) return COLOR_BY_KEY.get('blue').rowClass;
  if (teamValue.includes('marcus')) return COLOR_BY_KEY.get('emerald').rowClass;
  if (teamValue.includes('xinning')) return COLOR_BY_KEY.get('amber').rowClass;
  return '';
}

export function initialAccountPicRowColorRules(columns = [], rows = [], createId = () => globalThis.crypto?.randomUUID?.()) {
  const team = columns.find((column) => String(column.label || '').trim().toLocaleLowerCase('en-US') === 'team');
  if (!team) return [];
  const seeds = [
    { token: 'sylvia', color: 'blue' },
    { token: 'marcus', color: 'emerald' },
    { token: 'xinning', color: 'amber' },
  ];
  const rules = [];
  for (const seed of seeds) {
    for (const option of accountPicRowColorOptions(team, rows)) {
      if (!option.label.toLocaleLowerCase('en-US').includes(seed.token)) continue;
      rules.push({ id: createId(), columnId: team.id, matchValue: option.value, matchLabel: option.label, color: seed.color });
    }
  }
  return normalizeAccountPicRowColorRules(rules, columns);
}
