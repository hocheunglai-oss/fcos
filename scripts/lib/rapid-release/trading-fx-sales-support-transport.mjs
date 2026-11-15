import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fcosSalesforceEnvironment } from '../../../config/fcosConnections.js';
import { assertSuccessfulSalesforceReport } from '../salesforce-promotion-journal.mjs';
import { authenticateHostedSalesforce } from './salesforce-hosted-auth.mjs';
import { prepareTradingFxFieldBoundDenialPackage } from './trading-fx-field-bound-denial-package.mjs';
import { assertSalesSupportRepairBinding } from './trading-fx-sales-support-source.mjs';
import { digest, isDigest, requireCondition } from './contract.mjs';
import {
  assertSalesSupportRepair, salesSupportFieldSnapshot, salesSupportProfile, salesSupportRepairFields, salesSupportRepairPackage,
  salesSupportViewAllFieldsObjects, salesSupportViewAllFieldsRepairPackage,
} from './trading-fx-sales-support-repair.mjs';

export const salesSupportCorrectionOperation = 'sales-support-correction';
const production = fcosSalesforceEnvironment('production');
const jobPattern = /^0Af[A-Za-z0-9]{15}$/u;
const productionCatalog = Object.freeze({
  unrelatedDigest: '61acc662a0f899fad1261722b38391cba9bb2a32dd67d0ecd7c99b16902d85e5',
  unrelatedCount: 1363,
});
const sandboxCatalogs = {
  devee: {
    unrelatedDigest: 'ba528041b93ec19abab9f1528dbb4ff9f7edce23c1ca3fa762db7be0b2f18f22',
    unrelatedCount: 1152,
  },
  qat: {
    unrelatedDigest: 'b680ff26dd9dc2e8f0030c5fc9839be2451c8b2047d4df395121074b452c0848',
    unrelatedCount: 849,
  },
};
const profileDigest = '03b415858374db416c71f81783c7880ba2f23d4952937b12cc09e9dedc7f4d9c';
const manifestDigest = '85ea97f7edebcc629d9c8615b44bc169df7a11247a57d8d4725bb433ebd6453a';
const terminalOutcomes = { Failed: 'failed_rolled_back', Canceled: 'canceled_rolled_back' };
const check = (value, code) => requireCondition(value, 'TRADING_FX_SALES_SUPPORT_' + code);

function correctionSandbox(stage) {
  check(Object.hasOwn(sandboxCatalogs, stage), 'SANDBOX_REQUIRED');
  const sandbox = fcosSalesforceEnvironment(stage);
  check(sandbox.isSandbox === true, 'ORG_CHANGED');
  return sandbox;
}

function command(program, args, cwd, { env, timeout }) {
  let raw;
  try {
    raw = execFileSync(program, args, { cwd, env, timeout, maxBuffer: 12 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    const result = JSON.parse(raw);
    check(result?.status === 0, 'NATIVE_COMMAND_REFUSED');
    return result.result;
  } catch (error) {
    if (Buffer.isBuffer(error.stdout)) error.stdout.fill(0);
    if (Buffer.isBuffer(error.stderr)) error.stderr.fill(0);
    check(false, 'NATIVE_COMMAND_REFUSED');
  } finally {
    raw?.fill(0);
  }
}

function nativeConnection(cwd, env, run, target) {
  return (args, directory = cwd, timeout = 30000) =>
    run('sf', [...args, '--target-org', target.alias, '--json'], directory, { env, timeout });
}

function verifyIdentity(sf, target) {
  const identity = sf(['org', 'display']);
  check(identity?.id === target.orgId && identity.connectedStatus === 'Connected'
    && identity.username === target.username && identity.instanceUrl === target.instanceUrl, 'ORG_CHANGED');
  const query = sql => sf(['data', 'query', '--query', sql]);
  const org = query('SELECT Id, IsSandbox FROM Organization LIMIT 1');
  check(org?.done === true && org.records?.length === 1 && org.records[0].Id === target.orgId
    && org.records[0].IsSandbox === target.isSandbox, 'ORG_CHANGED');
}

function nativeCatalog(sf, viewAllFields) {
  const query = sql => sf(['data', 'query', '--query', sql]);
  const profile = query("SELECT Id, IsOwnedByProfile FROM PermissionSet WHERE IsOwnedByProfile = true AND Profile.Name = 'Sales Support'");
  const parentId = profile?.records?.[0]?.Id;
  check(profile?.done === true && profile.records.length === 1 && profile.records[0].IsOwnedByProfile === true
    && /^0PS[A-Za-z0-9]{15}$/u.test(parentId || ''), 'PROFILE_CHANGED');
  const grants = query("SELECT Field, ParentId, PermissionsRead, PermissionsEdit FROM FieldPermissions WHERE ParentId = '" + parentId + "'");
  const native = salesSupportFieldSnapshot({ rows: grants?.records, done: grants?.done, parentId });
  if (viewAllFields === undefined) return native;
  const objects = query('SELECT ParentId, SobjectType, PermissionsCreate, PermissionsDelete, PermissionsEdit, PermissionsRead, '
    + 'PermissionsModifyAllRecords, PermissionsViewAllFields, PermissionsViewAllRecords FROM ObjectPermissions WHERE ParentId = '
    + "'" + parentId + "' AND SobjectType IN ('" + salesSupportViewAllFieldsObjects.join("','") + "')");
  const rows = objects?.records?.map(({ attributes, ...row }) => row).sort((a, b) => a.SobjectType.localeCompare(b.SobjectType));
  const expected = [...salesSupportViewAllFieldsObjects].sort((a, b) => a.localeCompare(b)).map(SobjectType => ({ ParentId: parentId, SobjectType,
    PermissionsCreate: true, PermissionsDelete: true, PermissionsEdit: true, PermissionsRead: true, PermissionsModifyAllRecords: true,
    PermissionsViewAllFields: viewAllFields, PermissionsViewAllRecords: true }));
  check(objects?.done === true && digest(rows ?? null) === digest(expected), 'OBJECT_PERMISSIONS_CHANGED');
  return { ...native, objectPermissions: rows };
}

const snapshot = (sf, read, reviewedCatalog, viewAllFields) => {
  const current = nativeCatalog(sf, viewAllFields);
  check(current.unrelatedDigest === reviewedCatalog.unrelatedDigest
    && current.unrelatedCount === reviewedCatalog.unrelatedCount, 'UNRELATED_GRANTS_CHANGED');
  check(current.target.every(row => row.read === read && row.edit === false), read ? 'PREIMAGE_CHANGED' : 'DENY_UNVERIFIED');
  return current;
};

function assertReport(report, jobId, submittedAt, now, target, binding) {
  try { assertSuccessfulSalesforceReport(report, { environment: target, jobId }); }
  catch { check(false, 'ORIGINAL_JOB_UNVERIFIED'); }
  const rows = report.details?.componentSuccesses;
  const successes = Array.isArray(rows) ? rows : rows ? [rows] : [];
  const descriptors = successes.filter(item => item.success === true && item.componentType === '' && item.fullName === 'package.xml'
    && ['package.xml', 'zip/package.xml'].includes(item.fileName));
  const profiles = successes.filter(item => item.success === true && item.componentType === 'Profile' && item.fullName === salesSupportProfile
    && ['profiles/Sales Support.profile', 'zip/profiles/Sales Support.profile'].includes(item.fileName)
    && item.created !== true && item.deleted !== true);
  const fields = successes.filter(item => item.success === true && item.componentType === 'CustomField'
    && salesSupportRepairFields.includes(item.fullName) && item.created !== true && item.deleted !== true);
  const fieldNames = new Set(fields.map(item => item.fullName));
  const expectedFields = binding.fieldBound ? salesSupportRepairFields.length : 0;
  const tests = report.numberTestsTotal;
  const warnings = report.details?.runTestResult?.codeCoverageWarnings;
  check(report.numberComponentsTotal === 1 + expectedFields && report.numberComponentsDeployed === 1 + expectedFields && profiles.length === 1
    && fields.length === expectedFields && fieldNames.size === expectedFields
    && descriptors.length <= 1 && successes.length === profiles.length + descriptors.length + fields.length
    && report.numberComponentErrors === 0 && report.numberTestErrors === 0
    && Number.isSafeInteger(tests) && tests >= 0 && report.numberTestsCompleted === tests && (!target.isSandbox || tests === 0)
    && (warnings == null || (Array.isArray(warnings) && warnings.length === 0)), 'ORIGINAL_JOB_SCOPE_CHANGED');
  return assertReportTime(report, submittedAt, now);
}

function assertReportTime(report, submittedAt, now) {
  const completedAt = Date.parse(report.completedDate);
  check(completedAt >= Date.parse(submittedAt) - 30000 && completedAt <= now().getTime() + 30000, 'ORIGINAL_JOB_TIME_CHANGED');
  return report.completedDate;
}

function findOriginalJob(sf, { submittedAt, target, testLevel, id }) {
  const principal = sf(['data', 'query', '--query', "SELECT Id FROM User WHERE Username = '" + target.username + "'"]);
  const creatorId = principal.records?.[0]?.Id;
  check(principal.done === true && principal.records?.length === 1 && /^005[A-Za-z0-9]{15}$/u.test(creatorId || ''),
    'ORIGINAL_SUBMISSION_PRINCIPAL_UNKNOWN');
  const submitted = Date.parse(submittedAt);
  const from = new Date(submitted - 30_000).toISOString();
  const through = new Date(submitted + 120_000).toISOString();
  const discovery = sf(['data', 'query', '--use-tooling-api', '--query',
    'SELECT Id, CreatedById, CreatedDate, Status, CheckOnly, RollbackOnError, TestLevel FROM DeployRequest'
      + " WHERE CreatedById = '" + creatorId + "' AND CreatedDate >= " + from + ' AND CreatedDate <= ' + through
      + (id ? " AND Id = '" + id + "'" : '')]);
  const records = discovery.records;
  const job = records?.[0];
  const createdAt = Date.parse(job?.CreatedDate);
  check(discovery.done === true && records?.length === 1 && discovery.totalSize === 1 && jobPattern.test(job?.Id || '') && (!id || job.Id === id)
    && job.CreatedById === creatorId && createdAt >= Date.parse(from) && createdAt <= Date.parse(through)
    && job.CheckOnly === false && job.TestLevel === testLevel && job.RollbackOnError === true,
    'ORIGINAL_SUBMISSION_UNKNOWN');
  return job;
}

function isExactCorrectionJob(job, binding) {
  return job?.validationId === null && job.packageSha256 === binding.packageSha256
    && Number.isFinite(Date.parse(job.submittedAt)) && new Date(job.submittedAt).toISOString() === job.submittedAt;
}

function readCorrectionReport(sf, cwd, jobId) {
  return sf(['project', 'deploy', 'report', '--job-id', jobId, '--wait', '15'], cwd, 16 * 60000);
}

function verifyCorrectionResult({ sf, report, target, reviewedCatalog, jobId, submittedAt, now, binding }) {
  const completedAt = assertReport(report, jobId, submittedAt, now, target, binding);
  verifyIdentity(sf, target);
  return { completedAt, reportDigest: digest(report), after: snapshot(sf, false, reviewedCatalog, binding.override ? false : undefined) };
}

function verifyTerminalCorrectionResult({ sf, report, originalJob, target, reviewedCatalog, readBefore, jobId, submittedAt, testLevel, now, binding }) {
  check(report.id === jobId && report.done === true && report.success === false
    && report.checkOnly === false && report.rollbackOnError === true, 'ORIGINAL_TERMINAL_JOB_UNVERIFIED');
  const completedAt = assertReportTime(report, submittedAt, now);
  verifyIdentity(sf, target);
  const job = originalJob?.Status === report.status ? originalJob : findOriginalJob(sf, { submittedAt, target, testLevel, id: jobId });
  check(job.Status === report.status && Date.parse(completedAt) >= Date.parse(job.CreatedDate), 'ORIGINAL_TERMINAL_JOB_UNVERIFIED');
  const preimageDigest = digest(snapshot(sf, readBefore, reviewedCatalog, binding.override ? readBefore : undefined));
  return { status: report.status, terminalOutcome: terminalOutcomes[report.status], orgId: target.orgId,
    jobId, submittedAt, validationJobId: null, packageSha256: binding.packageSha256, completedAt,
    profileDigest: binding.profileDigest, manifestDigest: binding.manifestDigest,
    reportDigest: digest(report), nativeJobDigest: digest(job), checkOnly: false, rollbackOnError: true, preimageDigest };
}

function stopTerminalCorrection(outcome) {
  check(false, 'ORIGINAL_JOB_' + outcome.toUpperCase());
}

function correctionPackageBinding(repair) {
  if (repair) assertSalesSupportRepairBinding(repair);
  const fieldBound = Boolean(repair?.fieldBoundPackageSha256);
  const override = repair?.viewAllFieldsCorrection === true;
  const packet = override ? salesSupportViewAllFieldsRepairPackage() : { profileDigest, manifestDigest };
  return { fieldBound, override, profileDigest: packet.profileDigest,
    packageSha256: fieldBound ? repair.fieldBoundPackageSha256 : digest({ profileDigest: packet.profileDigest, manifestDigest: packet.manifestDigest }),
    manifestDigest: fieldBound ? repair.fieldBoundManifestDigest : packet.manifestDigest };
}

function writePackage(folder, binding) {
  const packet = binding.override ? salesSupportViewAllFieldsRepairPackage() : salesSupportRepairPackage();
  check(packet.profileDigest === binding.profileDigest && packet.manifestDigest === binding.manifestDigest, 'PACKAGE_CHANGED');
  const directory = join(folder, 'mdapi');
  const profiles = join(directory, 'profiles');
  mkdirSync(profiles, { recursive: true, mode: 0o700 });
  const manifest = join(directory, 'package.xml'), profile = join(profiles, 'Sales Support.profile');
  writeFileSync(manifest, packet.manifest, { flag: 'wx', mode: 0o600 });
  writeFileSync(profile, packet.profile, { flag: 'wx', mode: 0o600 });
  return {
    directory,
    verify() {
      check(readdirSync(directory).sort().join('|') === 'package.xml|profiles'
        && readdirSync(profiles).join('|') === 'Sales Support.profile'
        && digest(readFileSync(manifest)) === binding.manifestDigest && digest(readFileSync(profile)) === binding.profileDigest, 'PACKAGE_CHANGED');
    },
  };
}

export function verifyTradingFxSalesSupportReadGrants({ cwd, commandEnvironment, read, repair, run = command }) {
  check(typeof cwd === 'string' && commandEnvironment?.PATH && typeof read === 'boolean', 'PROTECTED_CONTEXT_REQUIRED');
  const sf = nativeConnection(cwd, commandEnvironment, run, production);
  verifyIdentity(sf, production);
  return snapshot(sf, read, productionCatalog, correctionPackageBinding(repair).override ? read : undefined);
}

export function verifyTradingFxSalesSupportSandboxDenial({ stage, cwd, commandEnvironment, run = command }) {
  const target = correctionSandbox(stage);
  check(typeof cwd === 'string' && commandEnvironment?.PATH, 'PROTECTED_CONTEXT_REQUIRED');
  const sf = nativeConnection(cwd, commandEnvironment, run, target);
  verifyIdentity(sf, target);
  return snapshot(sf, false, sandboxCatalogs[stage]);
}

export function verifyTradingFxSalesSupportSandboxJob({
  stage, cwd, commandEnvironment, job, repair, run = command, now = () => new Date(),
}) {
  const target = correctionSandbox(stage);
  check(typeof cwd === 'string' && commandEnvironment?.PATH, 'PROTECTED_CONTEXT_REQUIRED');
  const binding = correctionPackageBinding(repair);
  check(isExactCorrectionJob(job, binding) && jobPattern.test(job.id), 'CHECKPOINT_CHANGED');
  const sf = nativeConnection(cwd, commandEnvironment, run, target);
  verifyIdentity(sf, target);
  const report = readCorrectionReport(sf, cwd, job.id);
  const { completedAt, reportDigest, after } = verifyCorrectionResult({ sf, report, target, reviewedCatalog: sandboxCatalogs[stage],
    jobId: job.id, submittedAt: job.submittedAt, now, binding });
  return { orgId: target.orgId, jobId: job.id, submittedAt: job.submittedAt, completedAt, packageSha256: binding.packageSha256, reportDigest,
    proof: assertSalesSupportRepair({ before: after, after, expectedPreimage: 'denied' }) };
}

export function applyTradingFxSalesSupportCorrection(input) {
  return runSalesSupportCorrection(input, productionCatalog);
}

export function applyTradingFxSalesSupportSandboxCorrection({ stage, ...input }) {
  return runSalesSupportCorrection(input, sandboxCatalogs[stage], correctionSandbox(stage).key);
}

// Tests can supply a fixture catalog. The protected entry points above take
// their catalog and identities from the reviewed source.
export async function runSalesSupportCorrection({
  cwd, commandEnvironment, fingerprint, ownership, journal, repair, run = command, now = () => new Date(),
}, reviewedCatalog, stage = 'production') {
  const target = stage === 'production' ? production : correctionSandbox(stage);
  const operation = salesSupportCorrectionOperation;
  const readBefore = !target.isSandbox;
  const testLevel = target.isSandbox ? 'NoTestRun' : 'RunRelevantTests';
  check(isDigest(fingerprint) && typeof cwd === 'string' && commandEnvironment?.PATH
    && typeof ownership?.assert === 'function' && typeof journal?.readCheckpoints === 'function'
    && typeof journal?.checkpoint === 'function' && isDigest(reviewedCatalog?.unrelatedDigest)
    && Number.isSafeInteger(reviewedCatalog.unrelatedCount) && reviewedCatalog.unrelatedCount >= 0, 'PROTECTED_CONTEXT_REQUIRED');
  const binding = correctionPackageBinding(repair);
  check(!repair || repair.correctionFingerprint === fingerprint, 'SOURCE_BINDING_CHANGED');
  const sf = nativeConnection(cwd, commandEnvironment, run, target);
  async function current() {
    const records = (await journal.readCheckpoints()).filter(row => row.stage === stage && row.operation === operation);
    check(records.length <= 1, 'CHECKPOINT_AMBIGUOUS');
    if (!records.length) return undefined;
    const [row] = records, { job } = row;
    check(row.fingerprint === fingerprint && ['pending', 'resolved'].includes(row.outcome)
      && isDigest(row.evidenceDigest) && isExactCorrectionJob(job, binding)
      && (job.id === null && row.outcome === 'pending' || jobPattern.test(job.id || ''))
      && (row.terminalOutcome === undefined || (row.outcome === 'resolved' && isDigest(row.reportDigest)
        && Object.values(terminalOutcomes).includes(row.terminalOutcome))),
    'CHECKPOINT_CHANGED');
    return row;
  }
  async function save(record) {
    await journal.checkpoint({ fingerprint, stage, operation, record });
    const row = await current();
    check(row?.job.id === record.jobId && row.job.submittedAt === record.submittedAt
      && row.outcome === (record.status === 'Succeeded' || record.terminalOutcome ? 'resolved' : 'pending')
      && row.terminalOutcome === record.terminalOutcome && (!record.terminalOutcome || row.reportDigest === record.reportDigest)
      && row.evidenceDigest === digest(record), 'CHECKPOINT_NOT_DURABLE');
    return row;
  }
  const lease = await ownership.assert({ fingerprint, stage, orgId: target.orgId, operation });
  check(lease?.fingerprint === fingerprint && lease.stage === stage && lease.orgId === target.orgId
    && lease.operation === operation && isDigest(lease.receiptId)
    && Date.parse(lease.expiresAt) > now().getTime(), 'OWNERSHIP_EXPIRED');
  let saved = await current();
  if (saved?.terminalOutcome) stopTerminalCorrection(saved.terminalOutcome);
  verifyIdentity(sf, target);
  let before;
  if (!saved) {
    before = snapshot(sf, readBefore, reviewedCatalog, binding.override ? readBefore : undefined);
    const folder = mkdtempSync(join(tmpdir(), 'fcos-sales-support-correction-'));
    try {
      const prepared = binding.fieldBound ? prepareTradingFxFieldBoundDenialPackage({
        cwd, project: folder, repair, convert: (args, project) => run('sf', [...args, '--json'], project,
          { env: commandEnvironment, timeout: 30000 }),
      }) : writePackage(folder, binding);
      const intent = { status: 'submitting', jobId: null, validationJobId: null, submittedAt: now().toISOString(), packageSha256: binding.packageSha256,
        beforeDigest: digest(before), receiptId: lease.receiptId };
      await save(intent);
      check(Date.parse(lease.expiresAt) > now().getTime(), 'OWNERSHIP_EXPIRED');
      prepared.verify();
      let result;
      try {
        result = sf(['project', 'deploy', 'start', '--metadata-dir', prepared.directory, '--api-version', '67.0',
          '--test-level', testLevel, '--async'], cwd, 45000);
      } catch { check(false, 'ORIGINAL_SUBMISSION_UNKNOWN'); }
      check(jobPattern.test(result?.id || ''), 'ORIGINAL_SUBMISSION_UNKNOWN');
      saved = await save({ ...intent, status: 'submitted', jobId: result.id });
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }

  // Only the durable original job may be polled. This branch never submits.
  const { id, submittedAt } = saved.job;
  const originalJob = id ? undefined : findOriginalJob(sf, { submittedAt, target, testLevel });
  const jobId = id ?? originalJob.Id;
  const report = readCorrectionReport(sf, cwd, jobId);
  if (Object.hasOwn(terminalOutcomes, report?.status)) {
    check(saved.outcome === 'pending', 'CHECKPOINT_CHANGED');
    const terminal = verifyTerminalCorrectionResult({ sf, report, originalJob, target, reviewedCatalog,
      readBefore, jobId, submittedAt, testLevel, now, binding });
    await save(terminal);
    stopTerminalCorrection(terminal.terminalOutcome);
  }
  const { completedAt, reportDigest, after } = verifyCorrectionResult({ sf, report, target, reviewedCatalog, jobId, submittedAt, now, binding });
  // On a resumed attempt the native receipt and reviewed catalog preimage are
  // the reference. The target reads must still be denied on every re-entry.
  const reviewedBefore = before ?? { ...after, target: salesSupportRepairFields.map(field => ({ field, read: readBefore, edit: false })) };
  const proof = assertSalesSupportRepair({ before: reviewedBefore, after, expectedPreimage: readBefore ? 'unexpected-projected-reads' : 'denied' });
  const record = { status: 'Succeeded', jobId, submittedAt, validationJobId: null, packageSha256: binding.packageSha256, completedAt,
    reportDigest, profileDigest: binding.profileDigest, manifestDigest: binding.manifestDigest, proof };
  if (saved.outcome === 'pending') saved = await save(record);
  return { operationId: 'salesforce:' + stage + ':' + operation, evidenceDigest: saved.evidenceDigest, record,
    jobId, verified: true, intentRecorded: true };
}


export function verifyHostedTradingFxSalesSupportDenial({ cwd, env, repair }) {
  const directory = mkdtempSync(join(tmpdir(), 'fcos-sales-support-readback-'));
  try {
    const commandEnvironment = authenticateHostedSalesforce({ directory, cwd, env: { ...env, HOME: directory },
      onlyProductionForSigningRead: true, requireMirrorCredential: false });
    return verifyTradingFxSalesSupportReadGrants({ cwd, commandEnvironment, read: false, repair });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
