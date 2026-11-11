import { requireDeploymentMutationAllowed } from './_deploymentReadOnly.js';
import { hkCompanyFxMidnight } from './_companyFxRates.js';
import { getVariableChargeSettings } from './_variableCharges.js';

const FIELDS = 'id,effective_at,rate,settings_revision,reason,recorded_at';
function error(message, status, code) {
  return Object.assign(new Error(message), { status, statusCode: status, code, expose: true });
}
async function authorize(context) {
  if (!context.profile?.id || (await getVariableChargeSettings({}, context)).canSave !== true) throw error('Only an Administrator or the active General Manager may manage company FX history.', 403, 'COMPANY_FX_HISTORY_FORBIDDEN');
}
function serialize(row) {
  return { rateId: row.id, effectiveAt: row.effective_at, usdHkdRate: Number(row.rate), revision: row.settings_revision,
    reason: row.reason, recordedAt: row.recorded_at };
}
function storageError(cause) {
  if (cause?.code === '23505') return error('A company rate already exists at this effective date. Historical entries cannot be overwritten.', 409, 'COMPANY_FX_HISTORY_DUPLICATE');
  return error('Company FX history is unavailable. Try again or contact an administrator.', 503, 'COMPANY_FX_HISTORY_UNAVAILABLE');
}

export async function listCompanyFxHistory(_body, context) {
  await authorize(context);
  const { data, error: queryError } = await context.client.from('company_fx_rate_history').select(FIELDS)
    .eq('pair', 'USD/HKD').order('effective_at', { ascending: false }).limit(100);
  if (queryError) throw storageError(queryError);
  return { rows: (data || []).map(serialize), canSave: true };
}

export async function saveHistoricalCompanyFxRate(body, context) {
  requireDeploymentMutationAllowed(true);
  await authorize(context);
  const effectiveDate = typeof body?.effectiveDate === 'string' ? body.effectiveDate.trim() : '';
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || effectiveDate >= today) {
    throw error('Choose a valid Hong Kong calendar date before today.', 400, 'COMPANY_FX_HISTORY_DATE_INVALID');
  }
  const effectiveAt = hkCompanyFxMidnight(effectiveDate);
  const value = typeof body?.usdHkdRate === 'number' || typeof body?.usdHkdRate === 'string' ? String(body.usdHkdRate).trim() : '';
  if (!/^\d{1,3}(?:\.\d{1,6})?$/.test(value) || Number(value) <= 0 || Number(value) > 100) {
    throw error('Enter a USD/HKD company rate greater than zero and no more than 100, with at most six decimal places.', 400, 'COMPANY_FX_HISTORY_RATE_INVALID');
  }
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 5 || reason.length > 1000) throw error('Explain the historical rate approval in 5 to 1,000 characters.', 400, 'COMPANY_FX_HISTORY_REASON_INVALID');
  const { data, error: insertError } = await context.client.from('company_fx_rate_history').insert({
    pair: 'USD/HKD', rate: value, effective_at: effectiveAt, settings_revision: null,
    actor_user_id: context.profile.id, reason,
  }).select(FIELDS).single();
  if (insertError || !data) throw storageError(insertError);
  return { row: serialize(data), canSave: true };
}
