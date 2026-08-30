import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fcosConnectionProvider } from '../config/fcosConnections.js';

const EXPECTED = Object.freeze(Object.fromEntries(
  fcosConnectionProvider('salesforce').environments.map((environment) => [
    environment.alias,
    { orgId: environment.orgId, sandbox: environment.isSandbox },
  ]),
));

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const alias = argument('--target-org');

function sf(args, { input } = {}) {
  const output = execFileSync('sf', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    input,
    maxBuffer: 20 * 1024 * 1024,
  });
  const parsed = JSON.parse(output);
  if (Object.hasOwn(parsed, 'status') && parsed.status !== 0) throw new Error(parsed.message || `Salesforce command failed: ${args.join(' ')}`);
  return Object.hasOwn(parsed, 'result') ? parsed.result : parsed;
}

function sha256(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

export function removeLeadingShipAgentLine(value) {
  const source = String(value ?? '');
  if (/^Ship Agent[\t ]*$/i.test(source)) return '';
  return source.replace(/^Ship Agent[\t ]*(?:\r\n|\n|\r)(?:[\t ]*(?:\r\n|\n|\r))*/i, '');
}

function query(soql) {
  return sf(['data', 'query', '--target-org', alias, '--query', soql, '--result-format', 'json', '--json']).records || [];
}

function chunk(values, size = 25) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function composite(requests) {
  if (!requests.length) return [];
  const response = sf([
    'api', 'request', 'rest', '/services/data/v65.0/composite', '--target-org', alias,
    '--method', 'POST', '--body', '-',
  ], { input: JSON.stringify({ allOrNone: true, compositeRequest: requests }) });
  const rows = response.compositeResponse || [];
  const failed = rows.find((row) => row.httpStatusCode < 200 || row.httpStatusCode >= 300);
  if (failed) throw new Error(failed.body?.[0]?.message || failed.body?.message || 'Salesforce rejected the Variable Charges backfill.');
  return rows;
}

function staleHeader(lastModifiedDate) {
  const parsed = new Date(lastModifiedDate);
  if (Number.isNaN(parsed.getTime())) throw new Error('A Salesforce LastModifiedDate is required for every backfill write.');
  return { 'If-Unmodified-Since': parsed.toUTCString() };
}

export function main() {
if (!alias || !EXPECTED[alias]) {
  throw new Error('Use --target-org fcos-devee, fcos-qat, or source-salesforce.');
}
const expected = EXPECTED[alias];
const org = sf(['org', 'display', '--target-org', alias, '--verbose', '--json']);
const orgId = org.id || org.orgId;
const sandbox = org.isSandbox === true || org.instanceUrl?.includes('.sandbox.') || org.instanceUrl?.includes('--');
if (orgId !== expected.orgId || sandbox !== expected.sandbox) {
  throw new Error(`Salesforce identity mismatch for ${alias}; expected ${expected.orgId} sandbox=${expected.sandbox}.`);
}

// Imported_Particulars__c is a long-text field and Salesforce does not permit
// filtering it in SOQL. Load only active Accounts, then apply the exact leading
// line predicate locally so the migration remains deterministic and repeatable.
const accountCandidates = query('SELECT Id, Name, Imported_Particulars__c, Is_Agent__c, Inactive_Suspended__c, LastModifiedDate FROM Account WHERE Inactive_Suspended__c = false');
const accountChanges = accountCandidates.map((account) => {
  const cleaned = removeLeadingShipAgentLine(account.Imported_Particulars__c);
  const exactMarker = cleaned !== String(account.Imported_Particulars__c ?? '');
  if (!exactMarker) return null;
  return {
    id: account.Id,
    name: account.Name,
    lastModifiedDate: account.LastModifiedDate,
    beforeHash: sha256(account.Imported_Particulars__c),
    afterHash: sha256(cleaned),
    body: { Is_Agent__c: true, Imported_Particulars__c: cleaned || null },
  };
}).filter(Boolean);

const stemCandidates = query('SELECT Id, Ship_Agent_Charges_Confirmed__c, Variable_Charges_Confirmed__c, LastModifiedDate FROM STEM__c');
const stemChanges = stemCandidates.filter((stem) => stem.Ship_Agent_Charges_Confirmed__c === true && stem.Variable_Charges_Confirmed__c !== true);

let requestNumber = 0;
const accountRequests = accountChanges
  .filter((change) => change.body.Is_Agent__c !== true || change.beforeHash !== change.afterHash)
  .map((change) => ({
    method: 'PATCH',
    url: `/services/data/v65.0/sobjects/Account/${change.id}`,
    referenceId: `account${requestNumber++}`,
    httpHeaders: staleHeader(change.lastModifiedDate),
    body: change.body,
  }));
const stemRequests = stemChanges.map((stem) => ({
  method: 'PATCH',
  url: `/services/data/v65.0/sobjects/STEM__c/${stem.Id}`,
  referenceId: `stem${requestNumber++}`,
  httpHeaders: staleHeader(stem.LastModifiedDate),
  body: { Variable_Charges_Confirmed__c: true },
}));

for (const requests of chunk([...accountRequests, ...stemRequests])) composite(requests);

const verifiedAccounts = accountChanges.length
  ? query(`SELECT Id, Is_Agent__c, Imported_Particulars__c FROM Account WHERE Id IN (${accountChanges.map((row) => `'${row.id}'`).join(',')})`)
  : [];
for (const row of verifiedAccounts) {
  const expectedRow = accountChanges.find((item) => item.id === row.Id);
  if (row.Is_Agent__c !== true || sha256(row.Imported_Particulars__c) !== expectedRow.afterHash) {
    throw new Error(`Account ${row.Id} did not match the verified Variable Charges backfill projection.`);
  }
}

const report = {
  migration: 'variable-charges-is-agent-v1',
  targetAlias: alias,
  orgId,
  sandbox,
  completedAt: new Date().toISOString(),
  accountCount: accountChanges.length,
  stemConfirmationCount: stemChanges.length,
  accounts: accountChanges.map(({ id, beforeHash, afterHash }) => ({ id, beforeHash, afterHash })),
  reportHash: sha256(JSON.stringify({ orgId, accounts: accountChanges.map(({ id, beforeHash, afterHash }) => ({ id, beforeHash, afterHash })), stems: stemChanges.map(({ Id }) => Id) })),
};
mkdirSync(resolve('output'), { recursive: true });
writeFileSync(resolve('output', `variable-charges-backfill-${alias}.json`), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
