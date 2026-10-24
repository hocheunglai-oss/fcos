// Bounded decimal arithmetic for source accounting-line representation only.
// This does not change invoice matching, settlement comparisons or rounding policy.
const MAX_CENTS = 99_999_999_999_999n;
const MAX_UNIT_SCALED = 9_999_999_999_999_999n;

function decimal(value) {
  if (!['number', 'string'].includes(typeof value)) return null;
  const text = String(value);
  if (!/^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,12})?$/.test(text)) return null;
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.');
  return { integer: BigInt(whole + fraction) * (negative ? -1n : 1n), scale: fraction.length };
}

// Decimal half up on the magnitude, including negative credit amounts.
function rounded(integer, scale, targetScale) {
  if (scale <= targetScale) return integer * 10n ** BigInt(targetScale - scale);
  const negative = integer < 0n;
  const magnitude = negative ? -integer : integer;
  const divisor = 10n ** BigInt(scale - targetScale);
  return ((2n * magnitude + divisor) / (2n * divisor)) * (negative ? -1n : 1n);
}

const bounded = (value, maximum) => value <= maximum && value >= -maximum ? value : null;

export function accountingDecimalCents(value) {
  const parsed = decimal(value);
  return parsed ? bounded(rounded(parsed.integer, parsed.scale, 2), MAX_CENTS) : null;
}

export function accountingProductCents(quantity, unitAmount) {
  const left = decimal(quantity); const right = decimal(unitAmount);
  return left && right ? bounded(rounded(left.integer * right.integer, left.scale + right.scale, 2), MAX_CENTS) : null;
}

export function accountingUnitNumber(value) {
  const parsed = decimal(value);
  const scaled = parsed ? bounded(rounded(parsed.integer, parsed.scale, 4), MAX_UNIT_SCALED) : null;
  if (scaled === null || scaled > BigInt(Number.MAX_SAFE_INTEGER) || scaled < -BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(scaled) / 10000;
}

export function accountingCentsNumber(value) {
  return typeof value === 'bigint' && bounded(value, MAX_CENTS) !== null ? Number(value) / 100 : null;
}

export function accountingCentsText(value) {
  if (typeof value !== 'bigint') return 'invalid';
  const magnitude = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${magnitude / 100n}.${String(magnitude % 100n).padStart(2, '0')}`;
}
