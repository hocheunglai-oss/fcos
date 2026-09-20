import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { providerRuntime } from './fcos-connections.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_ROOT = resolve(REPO_ROOT, 'outputs/non-hk-correction');
const EXPECTED_ORG = Object.freeze(fcosSalesforceEnvironment('production'));
const MIGRATION = 'cancel-non-hong-kong-managed-bundle-v1';
const SALESFORCE_ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const BUNDLE_KEY = /^HKBC\|([A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?)\|([A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?)\|(AGENCY_FEE|PORT_CLEARANCE_FEE|PORT_CLEARANCE_EXTENSION|LIGHT_DUES|ANCHORAGE_DUES)$/;
const FINANCIAL_FIELDS = Object.freeze([
  'Unit_Cost__c',
  'Lumpsum_Cost__c',
  'Line_Total_Buy__c',
  'Unit_Price__c',
  'Lumpsum_Price__c',
  'Line_Total__c',
]);
const PRESERVED_FIELDS = Object.freeze([
  ...FINANCIAL_FIELDS,
  'Supplier_Cost_Input_Currency__c',
  'Supplier_Cost_Input_Value__c',
  'Supplier_Cost_USD_HKD_Rate__c',
  'Supplier_Cost_FX_Settings_Revision__c',
]);
const AUDIT_SOQL = `SELECT Id, STEM__c, STEM__r.Name, STEM__r.LastModifiedDate, STEM__r.Port__c, STEM__r.Port__r.Name,
  STEM__r.Port__r.Country__c, Supplier__c, Product2Id__c, Product2Id__r.Name,
  CreatedDate, LastModifiedDate, Cancelled__c, Hong_Kong_Bundle_Managed__c,
  Hong_Kong_Bundle_Source__c, Hong_Kong_Bundle_Key__c, Buyer_Invoice__c,
  Supplier_Invoice__c, Fixed__c, Quantity__c, Unit_Cost__c, Lumpsum_Cost__c,
  Line_Total_Buy__c, Unit_Price__c, Lumpsum_Price__c, Line_Total__c,
  Supplier_Cost_Input_Currency__c, Supplier_Cost_Input_Value__c,
  Supplier_Cost_USD_HKD_Rate__c, Supplier_Cost_FX_Settings_Revision__c,
  Hong_Kong_Bundle_Source__r.STEM__c, Hong_Kong_Bundle_Source__r.Supplier__c,
  Hong_Kong_Bundle_Source__r.Product2Id__r.Name,
  Hong_Kong_Bundle_Source__r.Cancelled__c, Hong_Kong_Bundle_Source__r.LastModifiedDate
  FROM STEM_Extra_Cost__c
  WHERE Hong_Kong_Bundle_Managed__c = true
    OR Hong_Kong_Bundle_Key__c != null
    OR Supplier_Cost_Input_Currency__c = 'HKD'`;

function sha256(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function normalize(value) {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
}

function isZero(value) {
  return value === null || value === undefined || (typeof value === 'number' && value === 0);
}

function validTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function safeIdentity(identity) {
  return {
    alias: identity.alias,
    orgId: identity.orgId,
    username: identity.username,
    instanceUrl: identity.instanceUrl,
    isSandbox: identity.isSandbox,
  };
}

function portState(row) {
  const name = normalize(row.STEM__r?.Port__r?.Name);
  const country = normalize(row.STEM__r?.Port__r?.Country__c);
  if (!name && !country) return 'unknown';
  if (name === 'HONG KONG' || name === 'HK' || country === 'HONG KONG' || country === 'HK') return 'hong_kong';
  return 'outside_hong_kong';
}

function sourceState(row) {
  const source = row.Hong_Kong_Bundle_Source__r;
  if (!row.Hong_Kong_Bundle_Source__c || !source) return 'missing';
  if (source.STEM__c !== row.STEM__c || source.Supplier__c !== row.Supplier__c) return 'identity_mismatch';
  if (normalize(source.Product2Id__r?.Name) !== 'BASIC CALLING COST') return 'not_basic_calling_cost';
  if (source.Cancelled__c === true) return 'cancelled';
  if (!validTimestamp(source.LastModifiedDate)) return 'timestamp_missing';
  return 'valid';
}

function rowSnapshot(row) {
  return {
    id: row.Id,
    stemId: row.STEM__c,
    stemName: row.STEM__r?.Name ?? null,
    stemLastModifiedDate: row.STEM__r?.LastModifiedDate ?? null,
    portId: row.STEM__r?.Port__c ?? null,
    portName: row.STEM__r?.Port__r?.Name ?? null,
    portCountry: row.STEM__r?.Port__r?.Country__c ?? null,
    supplierId: row.Supplier__c,
    productId: row.Product2Id__c,
    productName: row.Product2Id__r?.Name ?? null,
    bundleKey: row.Hong_Kong_Bundle_Key__c,
    sourceId: row.Hong_Kong_Bundle_Source__c,
    sourceLastModifiedDate: row.Hong_Kong_Bundle_Source__r?.LastModifiedDate ?? null,
    createdDate: row.CreatedDate ?? null,
    lastModifiedDate: row.LastModifiedDate,
    cancelled: row.Cancelled__c === true,
    managed: row.Hong_Kong_Bundle_Managed__c === true,
    buyerInvoiceId: row.Buyer_Invoice__c ?? null,
    supplierInvoiceId: row.Supplier_Invoice__c ?? null,
    fixed: row.Fixed__c ?? null,
    quantity: row.Quantity__c ?? null,
    financial: Object.fromEntries(PRESERVED_FIELDS.map((field) => [field, row[field] ?? null])),
  };
}

function blocker(code, row, detail = null) {
  return { code, rowId: row.Id ?? null, stemId: row.STEM__c ?? null, detail };
}

function sortReportRows(rows) {
  return rows.sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
}

export function buildRepairPlan(rows, { identity = EXPECTED_ORG } = {}) {
  if (!Array.isArray(rows)) throw new Error('Audit rows must be an array.');
  const candidates = [];
  const blockers = [];
  const ignored = [];
  const activeManagedKeys = new Map();

  for (const row of rows) {
    const state = portState(row);
    const managed = row.Hong_Kong_Bundle_Managed__c === true;
    const active = row.Cancelled__c !== true;
    if (managed && active && row.Hong_Kong_Bundle_Key__c) {
      const current = activeManagedKeys.get(row.Hong_Kong_Bundle_Key__c) || [];
      current.push(row.Id);
      activeManagedKeys.set(row.Hong_Kong_Bundle_Key__c, current);
    }

    if (!managed) {
      const bundleLike = String(row.Hong_Kong_Bundle_Key__c ?? '').startsWith('HKBC|');
      const outsideHkd = state === 'outside_hong_kong'
        && normalize(row.Supplier_Cost_Input_Currency__c) === 'HKD';
      if (active && (bundleLike || outsideHkd)) {
        blockers.push(blocker(bundleLike ? 'NON_MANAGED_BUNDLE_KEY' : 'NON_MANAGED_HKD_ROW', row));
      } else {
        ignored.push({ rowId: row.Id ?? null, reason: 'not_managed' });
      }
      continue;
    }
    if (!active) {
      ignored.push({ rowId: row.Id, reason: 'already_cancelled' });
      continue;
    }
    if (state === 'hong_kong') {
      ignored.push({ rowId: row.Id, reason: 'hong_kong_port' });
      continue;
    }
    if (state === 'unknown') {
      blockers.push(blocker('UNKNOWN_PORT', row));
      continue;
    }
    if (row.Buyer_Invoice__c || row.Supplier_Invoice__c) {
      blockers.push(blocker('INVOICED_MANAGED_ROW', row));
      continue;
    }
    const nonzeroFields = FINANCIAL_FIELDS.filter((field) => !isZero(row[field]));
    if (nonzeroFields.length) {
      blockers.push(blocker('NONZERO_FINANCIAL_ROW', row, nonzeroFields));
      continue;
    }
    const keyMatch = BUNDLE_KEY.exec(String(row.Hong_Kong_Bundle_Key__c ?? ''));
    if (!keyMatch || keyMatch[1] !== row.STEM__c || keyMatch[2] !== row.Supplier__c) {
      blockers.push(blocker('BUNDLE_KEY_MISMATCH', row));
      continue;
    }
    const source = sourceState(row);
    if (source !== 'valid') {
      blockers.push(blocker('SOURCE_BASIC_INVALID', row, source));
      continue;
    }
    if (!SALESFORCE_ID.test(String(row.Id ?? ''))
        || !SALESFORCE_ID.test(String(row.STEM__r?.Port__c ?? ''))
        || !SALESFORCE_ID.test(String(row.Hong_Kong_Bundle_Source__c ?? ''))
        || !validTimestamp(row.LastModifiedDate)
        || !validTimestamp(row.STEM__r?.LastModifiedDate)) {
      blockers.push(blocker('ROW_IDENTITY_OR_TIMESTAMP_INVALID', row));
      continue;
    }
    candidates.push(rowSnapshot(row));
  }

  for (const [key, ids] of activeManagedKeys) {
    if (ids.length > 1) blockers.push({ code: 'DUPLICATE_ACTIVE_BUNDLE_KEY', bundleKey: key, rowIds: [...ids].sort() });
  }

  return {
    schemaVersion: 1,
    migration: MIGRATION,
    target: safeIdentity(identity),
    auditedRowCount: rows.length,
    candidates: sortReportRows(candidates),
    blockers: sortReportRows(blockers),
    ignored: sortReportRows(ignored),
  };
}

export function repairPlanHash(plan) {
  const { planHash: _planHash, generatedAt: _generatedAt, ...approved } = plan || {};
  return sha256(stableJson(approved));
}

export function createApprovedPlan(plan, { generatedAt = new Date().toISOString() } = {}) {
  const approved = { ...plan, generatedAt };
  return { ...approved, planHash: repairPlanHash(approved) };
}

export function validateApprovedPlan({ approvedPlan, approvedHash, livePlan }) {
  if (!approvedPlan || approvedPlan.schemaVersion !== 1 || approvedPlan.migration !== MIGRATION) {
    throw new Error('Approved repair plan has an unsupported schema or migration.');
  }
  if (!/^[a-f0-9]{64}$/.test(String(approvedHash ?? ''))) throw new Error('Execution requires an approved SHA-256 plan hash.');
  const embeddedHash = repairPlanHash(approvedPlan);
  if (approvedPlan.planHash !== embeddedHash || approvedHash !== embeddedHash) {
    throw new Error('Approved repair plan hash does not match its contents.');
  }
  if (approvedPlan.blockers?.length) throw new Error('Approved repair plan contains blockers.');
  if (livePlan.blockers?.length) throw new Error('Live repair audit contains blockers.');
  if (repairPlanHash(livePlan) !== embeddedHash) throw new Error('Approved repair plan is stale against live Salesforce state.');
  return true;
}

function apexString(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function apexDatetime(value) {
  const jsonDatetime = JSON.stringify(new Date(value).toISOString());
  return `(Datetime)JSON.deserialize(${apexString(jsonDatetime)}, Datetime.class)`;
}

function apexNullableString(value) {
  return value === null || value === undefined ? 'null' : apexString(value);
}

function apexIdSet(values) {
  return `new Set<Id>{${values.map(apexString).join(',')}}`;
}

function apexMap(rows, key, value, formatter = apexString) {
  return `new Map<Id,${formatter === apexDatetime ? 'Datetime' : 'String'}>{${rows
    .map((row) => `${apexString(row[key])}=>${formatter(row[value])}`).join(',')}}`;
}

export function buildRepairApex(plan) {
  const rows = plan.candidates || [];
  if (!rows.length) return '';
  const rowIds = rows.map((row) => row.id);
  const stemIds = [...new Set(rows.map((row) => row.stemId))].sort();
  const sourceIds = [...new Set(rows.map((row) => row.sourceId))].sort();
  const stemRows = [...new Map(rows.map((row) => [row.stemId, row])).values()];
  const sourceRows = [...new Map(rows.map((row) => [row.sourceId, row])).values()];
  const portRows = [...new Map(rows.map((row) => [row.portId, row])).values()];
  const portIds = portRows.map((row) => row.portId).sort();
  return `
Set<Id> expectedRowIds = ${apexIdSet(rowIds)};
Set<Id> expectedStemIds = ${apexIdSet(stemIds)};
Set<Id> expectedSourceIds = ${apexIdSet(sourceIds)};
Set<Id> expectedPortIds = ${apexIdSet(portIds)};
Map<Id,String> expectedKeys = ${apexMap(rows, 'id', 'bundleKey')};
Map<Id,String> expectedStems = ${apexMap(rows, 'id', 'stemId')};
Map<Id,String> expectedSuppliers = ${apexMap(rows, 'id', 'supplierId')};
Map<Id,String> expectedSources = ${apexMap(rows, 'id', 'sourceId')};
Map<Id,String> expectedStemPorts = ${apexMap(stemRows, 'stemId', 'portId')};
Map<Id,String> expectedPortNames = ${apexMap(portRows, 'portId', 'portName', apexNullableString)};
Map<Id,String> expectedPortCountries = ${apexMap(portRows, 'portId', 'portCountry', apexNullableString)};
Map<Id,Datetime> expectedRowModified = ${apexMap(rows, 'id', 'lastModifiedDate', apexDatetime)};
Map<Id,Datetime> expectedStemModified = ${apexMap(stemRows, 'stemId', 'stemLastModifiedDate', apexDatetime)};
Map<Id,Datetime> expectedSourceModified = ${apexMap(sourceRows, 'sourceId', 'sourceLastModifiedDate', apexDatetime)};
Map<Id,Port__c> ports = new Map<Id,Port__c>([
  SELECT Id, Name, Country__c FROM Port__c WHERE Id IN :expectedPortIds FOR UPDATE
]);
if (ports.size() != expectedPortIds.size()) throw new IllegalArgumentException('REPAIR_PORT_SET_CHANGED');
for (Port__c port : ports.values()) {
  if (port.Name != expectedPortNames.get(port.Id) || port.Country__c != expectedPortCountries.get(port.Id)) {
    throw new IllegalArgumentException('REPAIR_PORT_METADATA_CHANGED');
  }
}
Map<Id,STEM__c> stems = new Map<Id,STEM__c>([
  SELECT Id, Port__c, LastModifiedDate FROM STEM__c WHERE Id IN :expectedStemIds FOR UPDATE
]);
if (stems.size() != expectedStemIds.size()) throw new IllegalArgumentException('REPAIR_STEM_SET_CHANGED');
for (STEM__c stem : stems.values()) {
  if (String.valueOf(stem.Port__c) != expectedStemPorts.get(stem.Id)) {
    throw new IllegalArgumentException('REPAIR_STEM_PORT_CHANGED');
  }
  if (stem.LastModifiedDate != expectedStemModified.get(stem.Id)) {
    throw new IllegalArgumentException('REPAIR_STEM_TIMESTAMP_CHANGED');
  }
}
Map<Id,STEM_Extra_Cost__c> sources = new Map<Id,STEM_Extra_Cost__c>([
  SELECT Id, STEM__c, Supplier__c, Product2Id__r.Name, Cancelled__c, LastModifiedDate
  FROM STEM_Extra_Cost__c WHERE Id IN :expectedSourceIds FOR UPDATE
]);
if (sources.size() != expectedSourceIds.size()) throw new IllegalArgumentException('REPAIR_SOURCE_SET_CHANGED');
for (STEM_Extra_Cost__c source : sources.values()) {
  if (source.Cancelled__c == true || source.Product2Id__r == null
      || source.Product2Id__r.Name == null || source.Product2Id__r.Name.trim().toUpperCase() != 'BASIC CALLING COST'
      || source.LastModifiedDate != expectedSourceModified.get(source.Id)) {
    throw new IllegalArgumentException('REPAIR_SOURCE_PREDICATE_CHANGED');
  }
}
Map<Id,STEM_Extra_Cost__c> lockedRows = new Map<Id,STEM_Extra_Cost__c>([
  SELECT Id, STEM__c, Supplier__c, Hong_Kong_Bundle_Source__c, Hong_Kong_Bundle_Key__c,
    Hong_Kong_Bundle_Managed__c, Cancelled__c, Buyer_Invoice__c, Supplier_Invoice__c,
    Unit_Cost__c, Lumpsum_Cost__c, Line_Total_Buy__c, Unit_Price__c, Lumpsum_Price__c,
    Line_Total__c, LastModifiedDate FROM STEM_Extra_Cost__c WHERE Id IN :expectedRowIds FOR UPDATE
]);
if (lockedRows.size() != expectedRowIds.size()) throw new IllegalArgumentException('REPAIR_ROW_SET_CHANGED');
List<STEM_Extra_Cost__c> cancellations = new List<STEM_Extra_Cost__c>();
for (STEM_Extra_Cost__c row : lockedRows.values()) {
  STEM_Extra_Cost__c source = sources.get(row.Hong_Kong_Bundle_Source__c);
  if (row.Hong_Kong_Bundle_Managed__c != true || row.Cancelled__c == true
      || row.Buyer_Invoice__c != null || row.Supplier_Invoice__c != null
      || row.Hong_Kong_Bundle_Key__c != expectedKeys.get(row.Id)
      || String.valueOf(row.STEM__c) != expectedStems.get(row.Id)
      || String.valueOf(row.Supplier__c) != expectedSuppliers.get(row.Id)
      || String.valueOf(row.Hong_Kong_Bundle_Source__c) != expectedSources.get(row.Id)
      || source == null || source.STEM__c != row.STEM__c || source.Supplier__c != row.Supplier__c
      || row.LastModifiedDate != expectedRowModified.get(row.Id)
      || (row.Unit_Cost__c != null && row.Unit_Cost__c != 0)
      || (row.Lumpsum_Cost__c != null && row.Lumpsum_Cost__c != 0)
      || (row.Line_Total_Buy__c != null && row.Line_Total_Buy__c != 0)
      || (row.Unit_Price__c != null && row.Unit_Price__c != 0)
      || (row.Lumpsum_Price__c != null && row.Lumpsum_Price__c != 0)
      || (row.Line_Total__c != null && row.Line_Total__c != 0)) {
    throw new IllegalArgumentException('REPAIR_ROW_PREDICATE_CHANGED');
  }
  cancellations.add(new STEM_Extra_Cost__c(Id = row.Id, Cancelled__c = true));
}
Boolean previousSkip = ContextManager.skipTriggers;
try {
  ContextManager.skipTriggers = true;
  update cancellations;
} finally {
  ContextManager.skipTriggers = previousSkip;
}
VariableChargeInvoiceReadinessService.invalidateForExtraCostChanges(null, lockedRows);
`;
}

function argument(args, name) {
  const inline = args.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function sanitizeSalesforceDiagnostic(value) {
  return String(value ?? '')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b(access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|authorization)\b\s*[:=]\s*["']?[^"',;\s]+/gi, '$1=[redacted]')
    .replace(/https?:\/\/[^\s"']+/gi, '[url]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
}

export function salesforceFailureMessage(payload, fallbackCode = 'SALESFORCE_COMMAND_FAILED') {
  const result = payload?.result && typeof payload.result === 'object' ? payload.result : payload;
  const rawCode = payload?.name ?? payload?.errorCode ?? payload?.code
    ?? result?.name ?? result?.errorCode ?? fallbackCode;
  const code = String(rawCode ?? fallbackCode).toUpperCase().replace(/[^A-Z0-9_.:-]/g, '_').slice(0, 80)
    || fallbackCode;
  const statuses = [];
  if (typeof result?.compiledSuccess === 'boolean') statuses.push(`compiledSuccess=${result.compiledSuccess}`);
  if (typeof result?.success === 'boolean') statuses.push(`success=${result.success}`);
  if (Number.isInteger(result?.line)) statuses.push(`line=${result.line}`);
  if (Number.isInteger(result?.column)) statuses.push(`column=${result.column}`);
  const detail = sanitizeSalesforceDiagnostic(
    result?.compileProblem ?? result?.exceptionMessage ?? result?.message ?? payload?.message,
  );
  return `[${code}]${statuses.length ? ` (${statuses.join(', ')})` : ''}${detail ? `: ${detail}` : ''}`;
}

function salesforceFailure(payload, fallbackCode) {
  return new Error(`Salesforce command failed ${salesforceFailureMessage(payload, fallbackCode)}.`);
}

function sf(runtime, args, { input } = {}) {
  let output;
  try {
    output = execFileSync(runtime.command, args, {
      cwd: REPO_ROOT,
      env: runtime.env,
      encoding: 'utf8',
      input,
      maxBuffer: 80 * 1024 * 1024,
    });
  } catch (error) {
    let failurePayload = null;
    try {
      failurePayload = JSON.parse(typeof error?.stdout === 'string' ? error.stdout : error?.stdout?.toString('utf8'));
    } catch {
      // The CLI did not return structured JSON. Do not expose raw stdout/stderr.
    }
    throw salesforceFailure(failurePayload, `SALESFORCE_CLI_EXIT_${Number.isInteger(error?.status) ? error.status : 'UNKNOWN'}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw salesforceFailure(null, 'SALESFORCE_JSON_INVALID');
  }
  if (parsed.status !== undefined && parsed.status !== 0) throw salesforceFailure(parsed, 'SALESFORCE_STATUS_NONZERO');
  return parsed.result ?? parsed;
}

function verifyProductionIdentity(runtime, alias) {
  if (alias !== EXPECTED_ORG.alias) throw new Error(`Use --target-org ${EXPECTED_ORG.alias}.`);
  const display = sf(runtime, ['org', 'display', '--target-org', alias, '--json']);
  const organization = sf(runtime, [
    'data', 'query', '--target-org', alias,
    '--query', 'SELECT Id, IsSandbox FROM Organization LIMIT 1', '--result-format', 'json', '--json',
  ]).records?.[0];
  if ((display.id ?? display.orgId) !== EXPECTED_ORG.orgId
      || display.username !== EXPECTED_ORG.username
      || String(display.instanceUrl ?? '').replace(/\/$/, '') !== EXPECTED_ORG.instanceUrl.replace(/\/$/, '')
      || organization?.Id !== EXPECTED_ORG.orgId
      || organization?.IsSandbox !== EXPECTED_ORG.isSandbox) {
    throw new Error('Salesforce Production identity mismatch.');
  }
  return safeIdentity(EXPECTED_ORG);
}

function queryAudit(runtime, alias) {
  const result = sf(runtime, [
    'data', 'query', '--target-org', alias, '--query', AUDIT_SOQL,
    '--result-format', 'json', '--json',
  ]);
  const records = result.records || [];
  if (result.done !== true || result.totalSize !== records.length) {
    throw new Error('Salesforce audit query was incomplete; no repair plan was created.');
  }
  return records;
}

function exactPathInsideOutput(value, approvedHash) {
  const path = realpathSync(resolve(value));
  const boundary = relative(realpathSync(OUTPUT_ROOT), path);
  if (boundary.startsWith('..') || boundary === '' || basename(path) !== `repair-plan-${approvedHash}.json`) {
    throw new Error('Approved plan must be a dry-run repair-plan JSON under outputs/non-hk-correction.');
  }
  return path;
}

function safeStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}

function writeApprovedPlan(path, value) {
  if (!existsSync(path)) {
    writeJson(path, value);
    return;
  }
  const existing = JSON.parse(readFileSync(path, 'utf8'));
  if (existing.planHash !== value.planHash || repairPlanHash(existing) !== value.planHash) {
    throw new Error('Existing dry-run plan path does not contain the same approved plan.');
  }
}

function runApex(runtime, alias, apex) {
  const directory = mkdtempSync(join(tmpdir(), 'fcos-non-hk-repair-'));
  const path = join(directory, 'repair.apex');
  try {
    writeFileSync(path, apex, { mode: 0o600 });
    const result = sf(runtime, ['apex', 'run', '--target-org', alias, '--file', path, '--json']);
    if (result.compiledSuccess === false || result.success === false) {
      throw salesforceFailure({
        name: result.compiledSuccess === false ? 'APEX_COMPILE_FAILED' : 'APEX_EXECUTION_FAILED',
        result,
      }, 'APEX_REPAIR_REJECTED');
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function financialSnapshot(row) {
  return Object.fromEntries(PRESERVED_FIELDS.map((field) => [field, row[field] ?? null]));
}

function verifyAfter(runtime, alias, approvedPlan) {
  const ids = approvedPlan.candidates.map((row) => row.id);
  if (!ids.length) return [];
  const select = ['Id', 'Cancelled__c', ...PRESERVED_FIELDS].join(', ');
  const quoted = ids.map((id) => apexString(id)).join(',');
  const rows = sf(runtime, [
    'data', 'query', '--target-org', alias,
    '--query', `SELECT ${select} FROM STEM_Extra_Cost__c WHERE Id IN (${quoted})`,
    '--result-format', 'json', '--json',
  ]).records || [];
  const byId = new Map(rows.map((row) => [row.Id, row]));
  for (const expected of approvedPlan.candidates) {
    const actual = byId.get(expected.id);
    if (!actual || actual.Cancelled__c !== true
        || stableJson(financialSnapshot(actual)) !== stableJson(expected.financial)) {
      throw new Error(`Post-repair verification failed for ${expected.id}.`);
    }
  }
  return rows;
}

export function main(args = process.argv.slice(2)) {
  const execute = args.includes('--execute');
  const alias = argument(args, '--target-org') || EXPECTED_ORG.alias;
  const runtime = providerRuntime('salesforce');
  const identity = verifyProductionIdentity(runtime, alias);
  const rows = queryAudit(runtime, alias);
  const livePlan = buildRepairPlan(rows, { identity });
  mkdirSync(OUTPUT_ROOT, { recursive: true });

  if (!execute) {
    const approvedPlan = createApprovedPlan(livePlan);
    const stamp = safeStamp();
    const auditPath = join(OUTPUT_ROOT, `repair-audit-${stamp}.json`);
    const planPath = join(OUTPUT_ROOT, `repair-plan-${approvedPlan.planHash}.json`);
    writeJson(auditPath, { checkedAt: new Date().toISOString(), identity, rows, plan: livePlan });
    writeApprovedPlan(planPath, approvedPlan);
    process.stdout.write(`${JSON.stringify({
      mode: 'dry-run', planHash: approvedPlan.planHash, planPath,
      auditPath, candidates: livePlan.candidates.length, blockers: livePlan.blockers.length,
      executeCommand: `node scripts/repair-non-hong-kong-variable-charges.mjs --execute --target-org ${alias} --approved-plan ${planPath} --approved-plan-hash ${approvedPlan.planHash}`,
    }, null, 2)}\n`);
    return;
  }

  const approvedPathArg = argument(args, '--approved-plan');
  const approvedHash = argument(args, '--approved-plan-hash');
  if (!approvedPathArg || !approvedHash) {
    throw new Error('Execution requires --approved-plan and --approved-plan-hash from a dry run.');
  }
  const approvedPath = exactPathInsideOutput(approvedPathArg, approvedHash);
  const approvedPlan = JSON.parse(readFileSync(approvedPath, 'utf8'));
  validateApprovedPlan({ approvedPlan, approvedHash, livePlan });
  const backupPath = join(OUTPUT_ROOT, `repair-execution-backup-${safeStamp()}-${approvedHash}.json`);
  writeJson(backupPath, { backedUpAt: new Date().toISOString(), identity, approvedHash, rows });
  if (approvedPlan.candidates.length) runApex(runtime, alias, buildRepairApex(approvedPlan));
  verifyAfter(runtime, alias, approvedPlan);
  process.stdout.write(`${JSON.stringify({
    mode: 'execute', planHash: approvedHash, backupPath,
    cancelledRows: approvedPlan.candidates.map((row) => row.id), verified: true,
  }, null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
