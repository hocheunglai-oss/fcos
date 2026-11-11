const COMPANY_FX_PAIR = 'USD/HKD';
const HK_TIME_ZONE_OFFSET = '+08:00';
const RATE_MAXIMUM = 100n;
const DECIMAL = /^([+-]?)(\d+)(?:\.(\d+))?$/;
const MAX_DECIMAL_DIGITS = 30;
const MAX_DECIMAL_SCALE = 12;
const MAX_RATE_SCALE = 6;

function companyFxError(message, code = 'COMPANY_FX_RATE_UNAVAILABLE') {
  const error = new Error(message);
  error.code = code;
  error.status = 503;
  error.statusCode = 503;
  error.expose = false;
  return error;
}

function parseDecimal(value, label, { maxScale = MAX_DECIMAL_SCALE } = {}) {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw companyFxError(`${label} must be finite.`, 'COMPANY_FX_RATE_INVALID');
  }
  let source = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  // JSON numbers can serialize small eight-decimal unit prices in exponent form.
  // Expand the decimal text before validation, without binary multiplication.
  if (typeof value === 'number' && /e/i.test(source)) {
    const scientific = source.match(/^([+-]?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/i);
    if (scientific) {
      const [, sign, whole, fraction = '', exponent] = scientific;
      const digits = whole + fraction;
      const point = whole.length + Number(exponent);
      if (Math.abs(point) > MAX_DECIMAL_DIGITS) throw companyFxError(`${label} precision is invalid.`, 'COMPANY_FX_RATE_INVALID');
      source = sign + (point <= 0 ? `0.${'0'.repeat(-point)}${digits}`
        : point >= digits.length ? digits + '0'.repeat(point - digits.length)
          : `${digits.slice(0, point)}.${digits.slice(point)}`);
    }
  }
  const match = source.match(DECIMAL);
  if (!match) throw companyFxError(`${label} is invalid.`, 'COMPANY_FX_RATE_INVALID');
  const sign = match[1] === '-' ? -1n : 1n;
  const fraction = match[3] || '';
  if (fraction.length > maxScale || match[2].length + fraction.length > MAX_DECIMAL_DIGITS) {
    throw companyFxError(`${label} precision is invalid.`, 'COMPANY_FX_RATE_INVALID');
  }
  const digits = `${match[2]}${fraction}`.replace(/^0+(?=\d)/, '') || '0';
  return { coefficient: sign * BigInt(digits), scale: fraction.length };
}

function decimalToString(decimal, scale = decimal.scale) {
  const negative = decimal.coefficient < 0n;
  let digits = (negative ? -decimal.coefficient : decimal.coefficient).toString();
  if (scale > 0) {
    digits = digits.padStart(scale + 1, '0');
    digits = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  }
  return negative && decimal.coefficient !== 0n ? `-${digits}` : digits;
}

function roundedDivision(numerator, denominator) {
  if (denominator === 0n) throw companyFxError('USD/HKD rate must be greater than zero.', 'COMPANY_FX_RATE_INVALID');
  const negative = (numerator < 0n) !== (denominator < 0n);
  const absoluteNumerator = numerator < 0n ? -numerator : numerator;
  const absoluteDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = absoluteNumerator / absoluteDenominator;
  const remainder = absoluteNumerator % absoluteDenominator;
  const rounded = remainder * 2n >= absoluteDenominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

function powerOfTen(exponent) {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 30) {
    throw companyFxError('Decimal precision is invalid.', 'COMPANY_FX_RATE_INVALID');
  }
  return 10n ** BigInt(exponent);
}

function moneyScale(options) {
  const scale = options?.scale ?? 2;
  if (!Number.isInteger(scale) || scale < 0 || scale > 12) {
    throw companyFxError('Money precision is invalid.', 'COMPANY_FX_RATE_INVALID');
  }
  return scale;
}

function validRate(value) {
  const rate = parseDecimal(value, 'USD/HKD rate', { maxScale: MAX_RATE_SCALE });
  if (rate.coefficient <= 0n || rate.coefficient > RATE_MAXIMUM * powerOfTen(rate.scale)) {
    throw companyFxError('USD/HKD rate must be greater than zero and no more than 100.', 'COMPANY_FX_RATE_INVALID');
  }
  return rate;
}

function decimalsEqual(left, right) {
  const scale = Math.max(left.scale, right.scale);
  return left.coefficient * powerOfTen(scale - left.scale) === right.coefficient * powerOfTen(scale - right.scale);
}

function validRevision(value) {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 1) {
    throw companyFxError('USD/HKD rate revision is invalid.', 'COMPANY_FX_RATE_INVALID');
  }
  return revision;
}

function hkEndOfDay(date) {
  const source = String(date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source)) {
    throw companyFxError('An ISO calendar date is required for the FX lookup.', 'COMPANY_FX_DATE_INVALID');
  }
  const timestamp = new Date(`${source}T23:59:59.999${HK_TIME_ZONE_OFFSET}`);
  if (!Number.isFinite(timestamp.getTime()) || timestamp.toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' }) !== source) {
    throw companyFxError('The FX lookup date is invalid.', 'COMPANY_FX_DATE_INVALID');
  }
  return timestamp.toISOString();
}

function serializeHistoryRate(row) {
  if (!row || row.pair !== COMPANY_FX_PAIR || !row.id || !row.effective_at) {
    throw companyFxError('USD/HKD rate history is unavailable. Apply the required Supabase migration.');
  }
  const rate = validRate(row.rate);
  const effectiveAt = new Date(row.effective_at);
  if (!Number.isFinite(effectiveAt.getTime())) {
    throw companyFxError('USD/HKD rate history has an invalid effective time.', 'COMPANY_FX_RATE_INVALID');
  }
  return {
    usdHkdRate: decimalToString(rate),
    revision: row.settings_revision == null ? null : validRevision(row.settings_revision),
    rateId: String(row.id),
    effectiveAt: effectiveAt.toISOString(),
  };
}

function requireResult(result, message) {
  if (result?.error || !result?.data) {
    throw companyFxError(message, result?.error ? 'COMPANY_FX_RATE_QUERY_FAILED' : 'COMPANY_FX_RATE_UNAVAILABLE');
  }
  return result.data;
}

export function roundedDecimalAmount(value, options = {}) {
  const amount = parseDecimal(value, 'Amount');
  const scale = moneyScale(options);
  const coefficient = roundedDivision(amount.coefficient * powerOfTen(scale), powerOfTen(amount.scale));
  return decimalToString({ coefficient, scale }, scale);
}

export function usdFromHkd(amountHkd, usdHkdRate, options = {}) {
  const amount = parseDecimal(amountHkd, 'HKD amount');
  const rate = validRate(usdHkdRate);
  const scale = moneyScale(options);
  const minorUnits = roundedDivision(
    amount.coefficient * powerOfTen(rate.scale + scale),
    rate.coefficient * powerOfTen(amount.scale),
  );
  return decimalToString({ coefficient: minorUnits, scale }, scale);
}

export function hkdFromUsd(amountUsd, usdHkdRate, options = {}) {
  const amount = parseDecimal(amountUsd, 'USD amount');
  const rate = validRate(usdHkdRate);
  const scale = moneyScale(options);
  const minorUnits = roundedDivision(
    amount.coefficient * rate.coefficient * powerOfTen(scale),
    powerOfTen(amount.scale + rate.scale),
  );
  return decimalToString({ coefficient: minorUnits, scale }, scale);
}

export async function loadCurrentCompanyFxRate(client) {
  const settings = requireResult(await client.from('variable_charge_settings')
    .select('id,usd_hkd_rate,revision,updated_at')
    .eq('id', 'company')
    .maybeSingle(), 'Company USD/HKD settings are unavailable. Apply the required Supabase migration.');
  const revision = validRevision(settings.revision);
  const history = requireResult(await client.from('company_fx_rate_history')
    .select('id,pair,rate,settings_revision,effective_at')
    .eq('pair', COMPANY_FX_PAIR)
    .eq('settings_revision', revision)
    .maybeSingle(), 'The current company USD/HKD rate has no immutable history record.');
  const serialized = serializeHistoryRate(history);
  if (!decimalsEqual(validRate(history.rate), validRate(settings.usd_hkd_rate))
      || serialized.effectiveAt !== new Date(settings.updated_at).toISOString()) {
    throw companyFxError('Company USD/HKD settings do not match their immutable history record.', 'COMPANY_FX_RATE_MISMATCH');
  }
  return serialized;
}

export async function loadCompanyFxRateForDate(client, date) {
  const cutoff = hkEndOfDay(date);
  const history = requireResult(await client.from('company_fx_rate_history')
    .select('id,pair,rate,settings_revision,effective_at')
    .eq('pair', COMPANY_FX_PAIR)
    .lte('effective_at', cutoff)
    .order('effective_at', { ascending: false })
    .limit(1)
    .maybeSingle(), 'No company USD/HKD rate was effective on the requested Hong Kong date.');
  return serializeHistoryRate(history);
}

export const companyFxRateInternals = { COMPANY_FX_PAIR, hkEndOfDay, serializeHistoryRate, decimalsEqual, validRate };
