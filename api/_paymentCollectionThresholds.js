const FALLBACK_THRESHOLD = 0.005;

function thresholdError(message, status = 400, code = 'PAYMENT_THRESHOLD_INVALID') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.expose = true;
  return error;
}

export function normalizeCurrencyIsoCode(value) {
  const currencyIsoCode = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currencyIsoCode) ? currencyIsoCode : null;
}

function serializeThreshold(row) {
  return {
    currencyIsoCode: row.currency_iso_code,
    threshold: Number(row.threshold),
    revision: Number(row.revision || 0),
    updatedAt: row.updated_at || null,
    updatedByEmail: row.updated_by_email || null,
  };
}

export async function loadPaymentCollectionThresholds(client) {
  if (!client) {
    return {
      available: false,
      fallbackThreshold: FALLBACK_THRESHOLD,
      thresholds: [],
      byCurrency: {},
    };
  }
  const { data, error } = await client
    .from('payment_collection_currency_thresholds')
    .select('currency_iso_code,threshold,revision,updated_by_email,updated_at')
    .order('currency_iso_code');
  if (error) {
    return {
      available: false,
      fallbackThreshold: FALLBACK_THRESHOLD,
      thresholds: [],
      byCurrency: {},
    };
  }
  const thresholds = (data || []).map(serializeThreshold);
  return {
    available: true,
    fallbackThreshold: FALLBACK_THRESHOLD,
    thresholds,
    byCurrency: Object.fromEntries(thresholds.map((item) => [item.currencyIsoCode, item])),
  };
}

export function paymentCollectionThresholdPolicy(state, currencyValue) {
  const currencyIsoCode = normalizeCurrencyIsoCode(currencyValue);
  const configured = currencyIsoCode ? state?.byCurrency?.[currencyIsoCode] : null;
  if (configured) {
    return {
      currencyIsoCode,
      threshold: Number(configured.threshold),
      inclusive: true,
      configured: true,
      revision: configured.revision,
    };
  }
  return {
    currencyIsoCode,
    threshold: FALLBACK_THRESHOLD,
    inclusive: false,
    configured: false,
    revision: 0,
  };
}

export function paymentCollectionBalanceIsSettled(balanceValue, policy) {
  if (balanceValue == null || balanceValue === '') return false;
  const balance = Number(balanceValue);
  if (!Number.isFinite(balance)) return false;
  const threshold = Number(policy?.threshold ?? FALLBACK_THRESHOLD);
  return policy?.inclusive === true ? balance <= threshold : balance < threshold;
}

export function paymentCollectionThresholdCacheKey(state) {
  return (state?.thresholds || [])
    .map((item) => `${item.currencyIsoCode}:${item.threshold}:${item.revision}`)
    .join('|') || 'fallback:<0.005';
}

export async function savePaymentCollectionThreshold(client, input, profile) {
  const currencyIsoCode = normalizeCurrencyIsoCode(input?.currencyIsoCode || input?.currency_iso_code);
  const threshold = Number(input?.threshold);
  const expectedRevision = Number(input?.expectedRevision ?? input?.expected_revision ?? 0);
  if (!currencyIsoCode) throw thresholdError('Currency must be a three-letter ISO code.');
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1000000) {
    throw thresholdError('Threshold must be a number between 0 and 1,000,000.');
  }
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw thresholdError('Refresh these thresholds before saving.', 409, 'PAYMENT_THRESHOLD_REVISION_REQUIRED');
  }
  const { data, error } = await client
    .rpc('save_payment_collection_currency_threshold', {
      p_currency_iso_code: currencyIsoCode,
      p_threshold: Number(threshold.toFixed(4)),
      p_expected_revision: expectedRevision,
      p_actor_user_id: profile?.id || null,
      p_actor_email: profile?.email || null,
    })
    .single();
  if (error) {
    if (error.code === '40001' || /changed after/i.test(error.message || '')) {
      throw thresholdError('This currency threshold changed after it was opened. Refresh before saving.', 409, 'PAYMENT_THRESHOLD_REVISION_CONFLICT');
    }
    throw thresholdError('The currency threshold could not be saved.', 503, 'PAYMENT_THRESHOLD_SAVE_FAILED');
  }
  return serializeThreshold(data);
}

export async function savePaymentCollectionThresholds(client, inputs, profile) {
  if (!Array.isArray(inputs) || inputs.length > 50) {
    throw thresholdError('Provide no more than 50 currency thresholds.');
  }
  const normalized = inputs.map((input) => {
    const currencyIsoCode = normalizeCurrencyIsoCode(input?.currencyIsoCode || input?.currency_iso_code);
    const threshold = Number(input?.threshold);
    const expectedRevision = Number(input?.expectedRevision ?? input?.expected_revision ?? 0);
    if (!currencyIsoCode) throw thresholdError('Currency must be a three-letter ISO code.');
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1000000) {
      throw thresholdError('Threshold must be a number between 0 and 1,000,000.');
    }
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw thresholdError('Refresh these thresholds before saving.', 409, 'PAYMENT_THRESHOLD_REVISION_REQUIRED');
    }
    return { currencyIsoCode, threshold: Number(threshold.toFixed(4)), expectedRevision };
  }).sort((left, right) => left.currencyIsoCode.localeCompare(right.currencyIsoCode));
  if (new Set(normalized.map((item) => item.currencyIsoCode)).size !== normalized.length) {
    throw thresholdError('Each currency may appear only once in a threshold batch.');
  }
  if (!normalized.length) return [];
  const { data, error } = await client.rpc('save_payment_collection_currency_thresholds', {
    p_thresholds: normalized,
    p_actor_user_id: profile?.id || null,
    p_actor_email: profile?.email || null,
  });
  if (error) {
    if (error.code === '40001' || /changed after/i.test(error.message || '')) {
      throw thresholdError('One or more currency thresholds changed after they were opened. Refresh before saving.', 409, 'PAYMENT_THRESHOLD_REVISION_CONFLICT');
    }
    throw thresholdError('The currency thresholds could not be saved.', 503, 'PAYMENT_THRESHOLD_SAVE_FAILED');
  }
  return (Array.isArray(data) ? data : []).map(serializeThreshold);
}

export const PAYMENT_COLLECTION_FALLBACK_THRESHOLD = FALLBACK_THRESHOLD;
