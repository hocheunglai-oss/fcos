const PURPOSES = new Set([
  'outstanding_invoice_reports',
  'incoming_payment_reports',
  'incoming_payment_interest_requests',
  'hedge_sfs_reports',
]);

function settingsError(message, status = 400, code = 'FINANCIAL_REPORT_SETTINGS_INVALID') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.expose = true;
  return error;
}

function purposeKey(value) {
  const key = String(value || '').trim();
  if (!PURPOSES.has(key)) throw settingsError('Financial report purpose is not registered.');
  return key;
}

function settingsObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw settingsError('Financial report settings must be an object.');
  }
  const settings = { ...value };
  for (const key of ['from', 'sender', 'senderEmail', 'senderName', 'mailbox', 'mailboxId']) delete settings[key];
  return settings;
}

function recipientValues(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return String(value || '')
    .split(/[;,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizedSettings(input) {
  const settings = settingsObject(input);
  for (const key of ['to', 'cc', 'bcc']) {
    if (Object.prototype.hasOwnProperty.call(settings, key)) settings[key] = recipientValues(settings[key]);
  }
  return settings;
}

export function financialReportConfigured(settings) {
  return recipientValues(settings?.to).length > 0;
}

export function serializeFinancialReportSettings(row) {
  return {
    purposeKey: row?.purpose_key || null,
    label: row?.label || null,
    settings: row?.settings || {},
    configured: row?.configured === true,
    revision: Number(row?.revision || 0),
    updatedAt: row?.updated_at || null,
    updatedByEmail: row?.updated_by_email || null,
  };
}

export async function loadFinancialReportSettings(client, purpose, { required = false } = {}) {
  const key = purposeKey(purpose);
  const { data, error } = await client
    .from('financial_report_settings')
    .select('purpose_key,label,settings,configured,revision,updated_by_email,updated_at')
    .eq('purpose_key', key)
    .maybeSingle();
  if (error) {
    throw settingsError('Financial report settings are unavailable. Sending is disabled until storage is restored.', 503, 'FINANCIAL_REPORT_SETTINGS_UNAVAILABLE');
  }
  if (!data) {
    throw settingsError('Financial report settings have not been initialized. Apply the latest FCOS database migration.', 503, 'FINANCIAL_REPORT_SETTINGS_MISSING');
  }
  const result = serializeFinancialReportSettings(data);
  if (required && (!result.configured || !financialReportConfigured(result.settings))) {
    throw settingsError(`${result.label || 'Financial report'} recipients are not configured. Sending is disabled.`, 503, 'FINANCIAL_REPORT_NOT_CONFIGURED');
  }
  return result;
}

export async function saveFinancialReportSettings(client, purpose, input, profile) {
  const key = purposeKey(purpose);
  const settings = normalizedSettings(input?.settings || input || {});
  const expectedRevision = Number(input?.expectedRevision ?? input?.expected_revision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw settingsError('Refresh these settings before saving. A current revision is required.', 409, 'FINANCIAL_REPORT_REVISION_REQUIRED');
  }
  const configured = financialReportConfigured(settings);
  const { data, error } = await client
    .rpc('save_financial_report_settings', {
      p_purpose_key: key,
      p_settings: settings,
      p_configured: configured,
      p_expected_revision: expectedRevision,
      p_actor_user_id: profile?.id || null,
      p_actor_email: profile?.email || null,
    })
    .single();
  if (error) {
    if (error.code === '40001' || /changed after/i.test(error.message || '')) {
      throw settingsError('These report settings changed after they were opened. Refresh before saving.', 409, 'FINANCIAL_REPORT_REVISION_CONFLICT');
    }
    throw settingsError('Financial report settings could not be saved.', 503, 'FINANCIAL_REPORT_SETTINGS_SAVE_FAILED');
  }
  return serializeFinancialReportSettings(data);
}
