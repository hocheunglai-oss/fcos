import { spawnSync } from 'node:child_process';
import {
  accountNameKey,
  expandLegacyAccountManager,
  groupEligibleSalesforceAccounts,
} from '../api/_accountManagers.js';

const SALESFORCE_API_VERSION = 'v67.0';
const SALESFORCE_ALIAS = process.env.SALESFORCE_ORG_ALIAS || 'source-salesforce';
const ACTOR_EMAIL = process.env.ACCOUNT_MANAGER_MIGRATION_ACTOR || 'vincent@cosulich.com.hk';
const APPLY = process.argv.includes('--apply');

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function salesforceOrg() {
  const result = spawnSync('npx', [
    '--yes',
    '@salesforce/cli',
    'org',
    'display',
    '--target-org',
    SALESFORCE_ALIAS,
    '--json',
  ], {
    encoding: 'utf8',
    env: { ...process.env, SF_TEMP_SHOW_SECRETS: 'true' },
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Salesforce CLI authentication failed.');
  const org = JSON.parse(result.stdout).result || {};
  if (!org.accessToken || !org.instanceUrl) throw new Error('Salesforce CLI did not return a usable authenticated org.');
  return org;
}

function normalizedPersonName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

async function responseJson(response) {
  const body = await response.json().catch(() => null);
  if (response.ok) return body;
  const message = Array.isArray(body)
    ? body.flatMap((item) => item?.message || []).filter(Boolean).join('; ')
    : body?.message || body?.hint || body?.details || response.statusText;
  throw new Error(message || `Request failed with status ${response.status}.`);
}

async function main() {
  const supabaseUrl = requiredEnv('VITE_SUPABASE_URL').replace(/\/$/, '');
  const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  const org = salesforceOrg();
  const salesforceHeaders = {
    Authorization: `Bearer ${org.accessToken}`,
    'Content-Type': 'application/json',
  };
  const supabaseHeaders = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  };

  async function sfRequest(path, options = {}) {
    const response = await fetch(`${org.instanceUrl}/services/data/${SALESFORCE_API_VERSION}${path}`, {
      ...options,
      headers: { ...salesforceHeaders, ...(options.headers || {}) },
    });
    return responseJson(response);
  }

  async function sfQuery(soql) {
    const records = [];
    let path = `/query?q=${encodeURIComponent(soql)}`;
    while (path) {
      const page = await sfRequest(path);
      records.push(...(page.records || []));
      path = page.nextRecordsUrl
        ? page.nextRecordsUrl.replace(`/services/data/${SALESFORCE_API_VERSION}`, '')
        : '';
    }
    return records;
  }

  async function supabaseRequest(path, options = {}) {
    const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
      ...options,
      headers: { ...supabaseHeaders, ...(options.headers || {}) },
    });
    return responseJson(response);
  }

  const describe = await sfRequest('/sobjects/Account/describe');
  const managerField = (describe.fields || []).find((field) => field.name === 'Account_Manager__c');
  if (!managerField || managerField.type !== 'string' || managerField.updateable !== true || Number(managerField.length) < 255) {
    throw new Error('Salesforce Account.Account_Manager__c must be writable text with a length of at least 255.');
  }

  const accountFields = [
    'Id',
    'Name',
    'Buyer_Payment_Term__c',
    'Supplier_Payment_Term__c',
    'Is_Broker__c',
    'Inactive_Suspended__c',
    'Account_Manager__c',
  ].join(', ');
  const [legacyAccounts, eligibleAccounts, profiles, storedGroups] = await Promise.all([
    sfQuery(`SELECT ${accountFields} FROM Account WHERE Account_Manager__c != null ORDER BY Name, Id`),
    sfQuery(`SELECT ${accountFields} FROM Account WHERE Inactive_Suspended__c = false AND (Is_Broker__c = true OR Buyer_Payment_Term__c != null) ORDER BY Name, Id`),
    supabaseRequest('user_profiles?select=id,email,full_name,user_type,active&active=eq.true'),
    supabaseRequest('account_manager_groups?select=account_name_key,revision'),
  ]);

  const profileByName = new Map();
  for (const profile of profiles || []) {
    const key = normalizedPersonName(profile.full_name || profile.email);
    if (!key) continue;
    if (profileByName.has(key)) throw new Error(`Multiple active FCOS users match ${profile.full_name || profile.email}.`);
    profileByName.set(key, profile);
  }
  const actor = (profiles || []).find((profile) => String(profile.email || '').toLowerCase() === ACTOR_EMAIL.toLowerCase());
  if (!actor) throw new Error(`The active FCOS migration actor ${ACTOR_EMAIL} was not found.`);

  const legacyByNameKey = new Map();
  const desiredSalesforceValues = new Map();
  for (const account of legacyAccounts) {
    const expanded = expandLegacyAccountManager(account.Account_Manager__c);
    desiredSalesforceValues.set(account.Id, expanded);
    const key = accountNameKey(account.Name);
    if (!legacyByNameKey.has(key)) legacyByNameKey.set(key, { name: account.Name, managerTexts: new Set() });
    legacyByNameKey.get(key).managerTexts.add(expanded);
  }
  const legacyEligibleNameKeys = new Set(
    groupEligibleSalesforceAccounts(legacyAccounts).map((group) => group.accountNameKey),
  );

  const storedRevisionByKey = new Map((storedGroups || []).map((group) => [group.account_name_key, Number(group.revision || 0)]));
  const seedGroups = [];
  for (const group of groupEligibleSalesforceAccounts(eligibleAccounts)) {
    const legacy = legacyByNameKey.get(group.accountNameKey);
    if (!legacy || !legacyEligibleNameKeys.has(group.accountNameKey)) continue;
    if (legacy.managerTexts.size !== 1) {
      throw new Error(`${group.accountName} has conflicting legacy Account Manager assignments.`);
    }
    const managerText = [...legacy.managerTexts][0];
    const managerNames = managerText.split('/').map((name) => name.trim()).filter(Boolean);
    const managerProfiles = managerNames.map((name) => profileByName.get(normalizedPersonName(name)));
    if (managerProfiles.some((profile) => !profile)) {
      const missing = managerNames.filter((_, index) => !managerProfiles[index]);
      throw new Error(`Active FCOS users were not found for: ${missing.join(', ')}.`);
    }
    for (const accountId of group.salesforceAccountIds) {
      const existing = desiredSalesforceValues.get(accountId);
      if (existing && existing !== managerText) {
        throw new Error(`${group.accountName} resolves to conflicting Salesforce Account Manager values.`);
      }
      desiredSalesforceValues.set(accountId, managerText);
    }
    seedGroups.push({
      ...group,
      managerText,
      managerUserIds: managerProfiles.map((profile) => profile.id),
      expectedRevision: storedRevisionByKey.get(group.accountNameKey) || 0,
    });
  }

  const summary = {
    mode: APPLY ? 'apply' : 'dry-run',
    legacySalesforceRecords: legacyAccounts.length,
    salesforceRecordsToUpdate: desiredSalesforceValues.size,
    activeEligibleNameGroupsToSeed: seedGroups.length,
    groups: seedGroups.map((group) => ({
      accountName: group.accountName,
      roles: group.roles,
      salesforceAccountCount: group.salesforceAccountIds.length,
      managers: group.managerText,
    })),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!APPLY) {
    console.log('Dry run complete. Re-run with --apply to write Supabase and Salesforce.');
    return;
  }

  const savedGroups = [];
  for (const group of seedGroups) {
    const saved = await supabaseRequest('rpc/save_account_manager_group', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        p_account_name_key: group.accountNameKey,
        p_account_name: group.accountName,
        p_salesforce_account_ids: group.salesforceAccountIds,
        p_account_roles: group.roles,
        p_salesforce_manager_text: group.managerText,
        p_manager_user_ids: group.managerUserIds,
        p_actor_user_id: actor.id,
        p_actor_email: actor.email,
        p_expected_revision: group.expectedRevision,
      }),
    });
    savedGroups.push({ group, row: saved });
  }

  try {
    const records = [...desiredSalesforceValues].map(([Id, managerText]) => ({
      attributes: { type: 'Account' },
      Id,
      Account_Manager__c: managerText,
    }));
    for (let index = 0; index < records.length; index += 200) {
      const result = await sfRequest('/composite/sobjects', {
        method: 'PATCH',
        body: JSON.stringify({ allOrNone: true, records: records.slice(index, index + 200) }),
      });
      const failures = (Array.isArray(result) ? result : []).filter((item) => item?.success !== true);
      if (failures.length) {
        const message = failures.flatMap((item) => item.errors || []).map((error) => error.message).filter(Boolean).join('; ');
        throw new Error(message || 'Salesforce rejected the legacy Account Manager cleanup.');
      }
    }
  } catch (error) {
    for (const saved of savedGroups) {
      await supabaseRequest('rpc/finalize_account_manager_sync', {
        method: 'POST',
        body: JSON.stringify({
          p_account_name_key: saved.group.accountNameKey,
          p_revision: saved.row.revision,
          p_sync_status: 'failed',
          p_sync_error: String(error.message || error).slice(0, 2000),
          p_actor_user_id: actor.id,
          p_actor_email: actor.email,
        }),
      }).catch(() => null);
    }
    throw error;
  }

  for (const saved of savedGroups) {
    await supabaseRequest('rpc/finalize_account_manager_sync', {
      method: 'POST',
      body: JSON.stringify({
        p_account_name_key: saved.group.accountNameKey,
        p_revision: saved.row.revision,
        p_sync_status: 'synced',
        p_sync_error: null,
        p_actor_user_id: actor.id,
        p_actor_email: actor.email,
      }),
    });
  }

  console.log(`Applied ${desiredSalesforceValues.size} Salesforce updates and seeded ${savedGroups.length} Account Manager groups.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
