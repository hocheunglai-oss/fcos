const currencyCodes = ['HKD', 'USD', 'SGD', 'CNY', 'EUR', 'GBP', 'AUD', 'NZD', 'CAD', 'JPY'];

export function emptyReceiptFields() {
  return {
    merchant: '',
    date: new Date().toISOString().slice(0, 10),
    total: '',
    currency: 'HKD',
    category: 'Meals and travel',
    accountCode: '429',
    taxType: 'NONE',
    note: '',
  };
}

export function parseReceiptText(text, fileName = '') {
  const normalized = String(text || '').replace(/\u00a0/g, ' ');
  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return compactFields({
    merchant: findMerchant(lines) || merchantFromFileName(fileName),
    date: findDate(normalized),
    total: findTotal(lines),
    currency: findCurrency(normalized),
    note: normalized.trim(),
  });
}

function compactFields(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined && value !== ''));
}

function findMerchant(lines) {
  return lines.find((line) => {
    if (line.length < 3 || line.length > 48) return false;
    if (/\d{4}|total|tax|invoice|receipt|amount|date|time/i.test(line)) return false;
    return /[a-z]/i.test(line);
  });
}

function merchantFromFileName(fileName) {
  const clean = String(fileName || '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b(receipt|scan|image|photo)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean || undefined;
}

function findCurrency(text) {
  const upper = String(text || '').toUpperCase();
  const explicit = currencyCodes.find((code) => upper.includes(code));
  if (explicit) return explicit;
  if (/[¥￥]/.test(text)) return 'CNY';
  if (/[€]/.test(text)) return 'EUR';
  if (/[£]/.test(text)) return 'GBP';
  if (/[$]/.test(text)) return 'HKD';
  return undefined;
}

function findDate(text) {
  const iso = String(text || '').match(/\b(20\d{2}|19\d{2})[./-](0?[1-9]|1[0-2])[./-](0?[1-9]|[12]\d|3[01])\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;

  const compact = String(text || '').match(/\b(0?[1-9]|[12]\d|3[01])[./-](0?[1-9]|1[0-2])[./-](20\d{2}|\d{2})\b/);
  if (!compact) return undefined;
  const year = compact[3].length === 2 ? `20${compact[3]}` : compact[3];
  return `${year}-${compact[2].padStart(2, '0')}-${compact[1].padStart(2, '0')}`;
}

function findTotal(lines) {
  const amountPattern = /(?:[$€£¥]|HKD|USD|SGD|CNY|EUR|GBP|AUD|NZD|CAD|JPY)?\s*(-?\d{1,3}(?:[,\s]\d{3})*|\d+)\.(\d{2})\b/gi;
  const totalLines = lines.filter((line) => /grand\s*total|amount\s*due|balance|total/i.test(line));
  const totalCandidates = extractAmounts(totalLines.join('\n'), amountPattern);
  if (totalCandidates.length) return totalCandidates.at(-1);
  const allCandidates = extractAmounts(lines.join('\n'), amountPattern);
  return allCandidates.at(-1);
}

function extractAmounts(text, amountPattern) {
  const amounts = [];
  for (const match of String(text || '').matchAll(amountPattern)) {
    const dollars = match[1].replace(/[,\s]/g, '');
    amounts.push(`${dollars}.${match[2]}`);
  }
  return amounts;
}
