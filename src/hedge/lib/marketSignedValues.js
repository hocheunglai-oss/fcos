export function marketSignedTone(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount === 0) return 'neutral';
  return amount > 0 ? 'up' : 'down';
}

export function formatMarketSignedNumber(value, { digits = 2 } = {}) {
  if (value == null || value === '') return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  const sign = amount > 0 ? '+' : amount < 0 ? '−' : '';
  return `${sign}${Math.abs(amount).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

const EXPLICIT_SIGNED_NUMBER = /(^|[^\p{L}\p{N}_])([+−-]\d[\d,]*(?:\.\d+)?)(?![\p{L}\p{N}_-])/gu;

export function marketSignedTextParts(value) {
  const text = String(value ?? '');
  const parts = [];
  let cursor = 0;

  for (const match of text.matchAll(EXPLICIT_SIGNED_NUMBER)) {
    const prefix = match[1] || '';
    const token = match[2];
    const tokenStart = Number(match.index) + prefix.length;
    if (tokenStart > cursor) parts.push({ type: 'text', value: text.slice(cursor, tokenStart) });
    const amount = Number(token.replace(/,/g, '').replace('−', '-'));
    parts.push({ type: 'signed', value: token, amount, tone: marketSignedTone(amount) });
    cursor = tokenStart + token.length;
  }

  if (cursor < text.length) parts.push({ type: 'text', value: text.slice(cursor) });
  return parts.length ? parts : [{ type: 'text', value: text }];
}
