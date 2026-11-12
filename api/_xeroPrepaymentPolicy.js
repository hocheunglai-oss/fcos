import { requireDeploymentMutationAllowed } from './_deploymentReadOnly.js';
import {
  assertXeroFinancialDailyReserve, xeroFinancialAccountingFetch, xeroFinancialRateSnapshot,
} from './_xeroFinancialSync.js';
import {
  getFreshXeroConnection,
  splitScopes,
  xeroContactSyncError,
  xeroContactSyncServiceClient,
} from './_xeroContactSync.js';

export const XERO_PREPAYMENT_POLICY_TABLE = 'xero_prepayment_posting_policies';
const DIRECTIONS = Object.freeze(['Buy', 'Sell']);
const CURRENCIES = Object.freeze(['USD', 'HKD']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function reject(message, status = 409, code = 'XERO_PREPAYMENT_POLICY_INVALID') {
  throw Object.assign(xeroContactSyncError(message, status, code, status < 500), { expose: status < 500 });
}

function requiredText(value, label) {
  const result = String(value ?? '').trim();
  if (!result) reject(`${label} is required.`, 400);
  return result;
}

function requiredUuid(value, label) {
  const result = requiredText(value, label);
  if (!UUID.test(result)) reject(`${label} must be a UUID.`, 400);
  return result;
}

function exactChoice(value, choices, label) {
  if (!choices.includes(value)) reject(`${label} must be ${choices.join(' or ')}.`, 400);
  return value;
}

function requireProfile(accessContext) {
  const id = requiredUuid(accessContext?.profile?.id, 'Active Finance profile');
  return { id, email: String(accessContext.profile.email || '').trim().toLowerCase() || null };
}

function requireSettingsScope(connection) {
  const scopes = splitScopes(connection?.scope || '');
  if (!scopes.includes('accounting.settings.read') && !scopes.includes('accounting.settings')) {
    reject('Prepayment posting policy requires reconnecting Xero with accounting.settings.read.', 409, 'XERO_PREPAYMENT_POLICY_SCOPE_MISSING');
  }
}

function strictZeroTax(tax) {
  const components = tax?.TaxComponents;
  return tax?.Status === 'ACTIVE'
    && tax.TaxType
    && tax.DisplayTaxRate != null
    && tax.DisplayTaxRate !== ''
    && Number.isFinite(Number(tax.DisplayTaxRate))
    && Number(tax.DisplayTaxRate) === 0
    && tax.EffectiveRate != null
    && tax.EffectiveRate !== ''
    && Number.isFinite(Number(tax.EffectiveRate))
    && Number(tax.EffectiveRate) === 0
    && Array.isArray(components)
    && components.every((component) => component?.Rate != null && component.Rate !== ''
      && Number.isFinite(Number(component.Rate)) && Number(component.Rate) === 0);
}

function eligibleAccount(account) {
  return account?.Status === 'ACTIVE'
    && UUID.test(String(account.AccountID || ''))
    && Boolean(String(account.Code || '').trim())
    && Boolean(account.Type)
    && account.Type !== 'BANK'
    && !account.BankAccountNumber;
}

export function validatePrepaymentPostingEvidence(policy, accounts = [], taxes = []) {
  const accountId = requiredUuid(policy?.accountId ?? policy?.account_id, 'Deposit account ID');
  const accountCode = requiredText(policy?.accountCode ?? policy?.account_code, 'Deposit account code');
  const taxType = requiredText(policy?.taxType ?? policy?.tax_type, 'Zero-tax type');
  const accountMatches = accounts.filter((row) => row?.AccountID === accountId || row?.Code === accountCode);
  const taxMatches = taxes.filter((row) => row?.TaxType === taxType);
  const [account] = accountMatches;
  const [zeroTaxRate] = taxMatches;
  if (accountMatches.length !== 1 || account.AccountID !== accountId || account.Code !== accountCode || !eligibleAccount(account)) {
    reject('Choose an active non-bank Xero account with the exact AccountID and Code.', 409, 'XERO_PREPAYMENT_POLICY_ACCOUNT_INVALID');
  }
  if (taxMatches.length !== 1 || !strictZeroTax(zeroTaxRate)) {
    reject('Choose an active Xero tax type whose display, effective and component rates are all zero.', 409, 'XERO_PREPAYMENT_POLICY_TAX_INVALID');
  }
  return { depositAccount: account, zeroTaxRate };
}

function serializePolicy(row, tenantId, direction, currency) {
  if (!row) {
    return {
      tenantId,
      direction,
      currency,
      enabled: false,
      accountId: null,
      accountCode: null,
      taxType: null,
      revision: 0,
      reason: null,
      reviewedBy: null,
      reviewedAt: null,
      configured: false,
    };
  }
  return {
    tenantId: row.tenantId ?? row.tenant_id,
    direction: row.direction,
    currency: row.currency,
    enabled: row.enabled === true,
    accountId: row.accountId ?? row.account_id ?? null,
    accountCode: row.accountCode ?? row.account_code ?? null,
    taxType: row.taxType ?? row.tax_type ?? null,
    revision: Number(row.revision),
    reason: row.reason || null,
    reviewedBy: row.reviewedBy ?? row.reviewed_by ?? null,
    reviewedAt: row.reviewedAt ?? row.reviewed_at ?? null,
    configured: true,
  };
}

function accountChoice(row) {
  return {
    id: row.AccountID,
    code: row.Code,
    name: row.Name || '',
    type: row.Type || '',
  };
}

function taxChoice(row) {
  return {
    taxType: row.TaxType,
    name: row.Name || row.TaxType,
    displayRate: Number(row.DisplayTaxRate),
    effectiveRate: Number(row.EffectiveRate),
  };
}

function storageFailure(error, label) {
  const fingerprint = `${error?.code || ''} ${error?.message || ''}`;
  const stale = fingerprint.includes('40001') || /revision changed/i.test(fingerprint);
  reject(
    stale ? 'The prepayment policy changed after it was loaded. Refresh and review it again.' : `${label} failed.`,
    stale ? 409 : 500,
    stale ? 'XERO_PREPAYMENT_POLICY_STALE_WRITE' : 'XERO_PREPAYMENT_POLICY_STORAGE_FAILED',
  );
}

function verifiedTenant(connection, env) {
  const tenantId = requiredUuid(connection?.tenantId, 'Verified Xero tenant');
  if (env.XERO_TENANT_ID && env.XERO_TENANT_ID !== tenantId) {
    reject('The connected Xero tenant differs from the configured tenant.', 409, 'XERO_PREPAYMENT_POLICY_TENANT_CHANGED');
  }
  return tenantId;
}

export async function loadPrepaymentPostingSettings(connection, { env = process.env, fetchImpl, xeroFetch = xeroFinancialAccountingFetch } = {}) {
  requireSettingsScope(connection);
  let rate = {};
  const onResponse = ({ headers }) => {
    rate = xeroFinancialRateSnapshot(headers, rate);
    assertXeroFinancialDailyReserve(rate, env);
  };
  const options = { method: 'GET', env, fetchImpl, onResponse };
  const [accountResponse, taxResponse] = await Promise.all([
    xeroFetch(connection, '/Accounts', options),
    xeroFetch(connection, '/TaxRates', options),
  ]);
  if (!Array.isArray(accountResponse?.Accounts) || !Array.isArray(taxResponse?.TaxRates)) {
    reject('Xero posting settings returned an incomplete response.', 502, 'XERO_PREPAYMENT_POLICY_SETTINGS_INCOMPLETE');
  }
  return { accounts: accountResponse.Accounts, taxes: taxResponse.TaxRates };
}

export async function xeroPrepaymentPolicyGet(_body = {}, {
  accessContext = null,
  env = process.env,
  fetchImpl = fetch,
  client = xeroContactSyncServiceClient(env),
  getConnection = getFreshXeroConnection,
  xeroFetch = xeroFinancialAccountingFetch,
} = {}) {
  requireProfile(accessContext);
  requireDeploymentMutationAllowed(true, env);
  const connection = await getConnection(client, { env, fetchImpl });
  const tenantId = verifiedTenant(connection, env);
  const [stored, live] = await Promise.all([
    client.from(XERO_PREPAYMENT_POLICY_TABLE).select('*').eq('tenant_id', tenantId),
    loadPrepaymentPostingSettings(connection, { env, fetchImpl, xeroFetch }),
  ]);
  if (stored.error) storageFailure(stored.error, 'Reading prepayment policy');
  const rows = stored.data;
  if (!Array.isArray(rows) || rows.some((row) => row?.tenant_id !== tenantId
    || !DIRECTIONS.includes(row.direction) || !CURRENCIES.includes(row.currency))) {
    reject('Stored prepayment policies are outside the selected tenant or scope.', 502, 'XERO_PREPAYMENT_POLICY_STORAGE_FAILED');
  }
  const byKey = new Map(rows.map((row) => [`${row.direction}:${row.currency}`, row]));
  if (byKey.size !== rows.length) reject('Stored prepayment policy identities are ambiguous.', 502, 'XERO_PREPAYMENT_POLICY_STORAGE_FAILED');
  return {
    tenantId,
    policies: DIRECTIONS.flatMap((direction) => CURRENCIES.map((currency) => (
      serializePolicy(byKey.get(`${direction}:${currency}`), tenantId, direction, currency)
    ))),
    accountOptions: live.accounts.filter(eligibleAccount).map(accountChoice),
    taxOptions: live.taxes.filter(strictZeroTax).map(taxChoice),
  };
}

export async function xeroPrepaymentPolicySave(body = {}, {
  accessContext = null,
  env = process.env,
  fetchImpl = fetch,
  client = xeroContactSyncServiceClient(env),
  getConnection = getFreshXeroConnection,
  xeroFetch = xeroFinancialAccountingFetch,
} = {}) {
  const actor = requireProfile(accessContext);
  requireDeploymentMutationAllowed(true, env);
  const requestedTenantId = requiredUuid(body.tenantId, 'Reviewed Xero tenant');
  const direction = exactChoice(body.direction, DIRECTIONS, 'Direction');
  const currency = exactChoice(body.currency, CURRENCIES, 'Currency');
  if (typeof body.enabled !== 'boolean') reject('Enabled must be explicitly true or false.', 400);
  if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 0) reject('Expected revision must be a non-negative integer.', 400);
  const reason = requiredText(body.reason, 'Finance review reason');
  if (reason.length < 5 || reason.length > 1000) reject('Finance review reason must contain 5 to 1000 characters.', 400);

  const connection = await getConnection(client, { env, fetchImpl });
  const tenantId = verifiedTenant(connection, env);
  if (requestedTenantId !== tenantId) {
    reject('The connected Xero tenant changed after this policy was loaded. Refresh before saving.', 409, 'XERO_PREPAYMENT_POLICY_TENANT_CHANGED');
  }
  let accountId = null;
  let accountCode = null;
  let taxType = null;
  if (body.enabled) {
    accountId = requiredUuid(body.accountId, 'Deposit account ID');
    accountCode = requiredText(body.accountCode, 'Deposit account code');
    taxType = requiredText(body.taxType, 'Zero-tax type');
    const { accounts, taxes } = await loadPrepaymentPostingSettings(connection, { env, fetchImpl, xeroFetch });
    validatePrepaymentPostingEvidence({ accountId, accountCode, taxType }, accounts, taxes);
  } else if ([body.accountId, body.accountCode, body.taxType].some((value) => value != null && String(value).trim() !== '')) {
    reject('Disabled prepayment policies must not retain posting account or tax coordinates.', 400);
  }

  const { data, error } = await client.rpc('save_xero_prepayment_posting_policy_v1', {
    p_tenant_id: tenantId,
    p_direction: direction,
    p_currency: currency,
    p_enabled: body.enabled,
    p_account_id: accountId,
    p_account_code: accountCode,
    p_tax_type: taxType,
    p_expected_revision: body.expectedRevision,
    p_reason: reason,
    p_actor_id: actor.id,
  });
  if (error) storageFailure(error, 'Saving prepayment policy');
  const saved = serializePolicy(data, tenantId, direction, currency);
  if (!saved.configured || saved.tenantId !== tenantId || saved.direction !== direction || saved.currency !== currency
    || saved.enabled !== body.enabled || saved.revision !== body.expectedRevision + 1
    || saved.accountId !== accountId || saved.accountCode !== accountCode || saved.taxType !== taxType
    || saved.reviewedBy !== actor.id) {
    reject('The prepayment policy save acknowledgement could not be verified. Reload the current policy.', 502, 'XERO_PREPAYMENT_POLICY_ACK_UNVERIFIED');
  }
  return { tenantId, policy: saved };
}

export function resolvePrepaymentPostingPolicy(policies, event, accounts, taxes, tenantId) {
  const exactTenant = requiredUuid(tenantId, 'Verified Xero tenant');
  const direction = exactChoice(event?.Direction__c ?? event?.direction, DIRECTIONS, 'Cash-event direction');
  const currency = exactChoice(event?.Currency__c ?? event?.currency, CURRENCIES, 'Cash-event currency');
  const matches = (policies || []).map((row) => serializePolicy(row, exactTenant, direction, currency)).filter((row) => (
    row.configured && row.tenantId === exactTenant && row.direction === direction && row.currency === currency
  ));
  if (matches.length !== 1 || !matches[0].enabled || !Number.isInteger(matches[0].revision) || matches[0].revision <= 0) {
    reject(`Finance must enable one exact ${direction} ${currency} prepayment posting policy for this Xero tenant.`, 409, 'XERO_PREPAYMENT_POLICY_REQUIRED');
  }
  const policy = matches[0];
  const { depositAccount, zeroTaxRate } = validatePrepaymentPostingEvidence(policy, accounts, taxes);
  return { policy, depositAccount, zeroTaxRate };
}
