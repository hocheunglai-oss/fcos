export function financeError(message, status = 400, code = 'FINANCE_SETTINGS_INVALID') {
  return Object.assign(new Error(message), { status, code, expose: true });
}

export function validateAnnualInterestRate(value) {
  if (!['number', 'string'].includes(typeof value) || !/^\d{1,3}(?:\.\d{1,2})?$/.test(String(value).trim())) {
    throw financeError('Enter an annual financing rate from 0 to 100 with at most two decimal places.');
  }
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw financeError('The annual financing rate must be between 0 and 100.');
  return rate;
}

export function validateBankChargesUsd(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'DBS,UBS') throw financeError('Enter USD remittance charges for UBS and DBS.');
  const result = {};
  for (const bank of ['UBS', 'DBS']) {
    const amount = value[bank];
    if (!['number', 'string'].includes(typeof amount) || !/^\d{1,7}(?:\.\d{1,2})?$/.test(String(amount).trim())
      || !Number.isFinite(Number(amount)) || Number(amount) < 0 || Number(amount) > 1000000) {
      throw financeError('Bank charges must be from USD 0 to 1,000,000 with at most two decimal places.');
    }
    result[bank] = Number(amount);
  }
  return result;
}

export function serializeFinanceSettings(row) {
  if (!row || !Number.isSafeInteger(Number(row.revision)) || Number(row.revision) < 1) {
    throw financeError('Company financing settings are unavailable. Refresh to retry.', 503, 'FINANCE_SETTINGS_UNAVAILABLE');
  }
  return { annualInterestRatePct: validateAnnualInterestRate(row.annual_interest_rate_pct),
    bankChargesUsd: validateBankChargesUsd(row.bank_charges_usd), revision: Number(row.revision), updatedAt: row.updated_at || null, updatedByEmail: row.updated_by_email || null };
}

export async function loadFinanceSettings(client) {
  const result = await client.from('company_finance_settings')
    .select('annual_interest_rate_pct,bank_charges_usd,revision,updated_at,updated_by_email').eq('setting_key', 'company').maybeSingle();
  if (result.error) throw financeError('Company financing settings could not be loaded.', 503, 'FINANCE_SETTINGS_UNAVAILABLE');
  return serializeFinanceSettings(result.data);
}

export function createFinanceSettingsHandlers({ requireActiveUser, userHasAnyModuleAccess, userHasCapability, expireCache }) {
  async function contextFor(req, accessContext) {
    const context = accessContext || await requireActiveUser(req);
    const canManageSettings = await userHasCapability(context.client, context.profile, 'financial_report_settings_manage');
    if (!canManageSettings && !await userHasAnyModuleAccess(context.client, context.profile, ['dashboard'])) {
      throw financeError('Dashboard or Finance settings access is required.', 403, 'FINANCE_SETTINGS_ACCESS_DENIED');
    }
    return { ...context, canManageSettings };
  }
  async function financeSettingsGet(body = {}, req = null, accessContext = null) {
    const context = await contextFor(req, accessContext);
    return { settings: await loadFinanceSettings(context.client), permissions: { canManageSettings: context.canManageSettings } };
  }
  async function financeSettingsSave(body = {}, req = null, accessContext = null) {
    const context = await contextFor(req, accessContext);
    if (!context.canManageSettings) throw financeError('Finance settings management permission is required.', 403, 'FINANCE_SETTINGS_ACCESS_DENIED');
    const rate = validateAnnualInterestRate(body.annualInterestRatePct);
    if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1) throw financeError('Refresh Finance settings before saving.', 409, 'FINANCE_SETTINGS_REVISION_CONFLICT');
    const bankCharges = Object.hasOwn(body, 'bankChargesUsd') ? validateBankChargesUsd(body.bankChargesUsd) : null;
    const result = await context.client.rpc('save_company_finance_settings_v2', {
      p_annual_interest_rate_pct: rate, p_expected_revision: body.expectedRevision, p_actor_user_id: context.profile.id, p_bank_charges_usd: bankCharges,
    });
    if (result.error) {
      if (result.error.code === '40001') throw financeError('Finance settings changed after they were opened. Refresh before saving.', 409, 'FINANCE_SETTINGS_REVISION_CONFLICT');
      if (result.error.code === '42501') throw financeError('Finance settings management permission is required.', 403, 'FINANCE_SETTINGS_ACCESS_DENIED');
      throw financeError('Finance settings could not be saved. Refresh to check the current values before retrying.', 503, 'FINANCE_SETTINGS_SAVE_FAILED');
    }
    const settings = serializeFinanceSettings(Array.isArray(result.data) ? result.data[0] : result.data);
    await expireCache(['salesforce:dashboard', 'dashboard:finance-settings']);
    return { settings, permissions: { canManageSettings: true } };
  }
  return { financeSettingsGet, financeSettingsSave };
}
