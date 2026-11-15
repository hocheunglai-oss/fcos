import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fcosSalesforceEnvironment } from '../../../config/fcosConnections.js';
import { assertSuccessfulSalesforceReport } from '../salesforce-promotion-journal.mjs';
import { digest, isDigest, requireCondition } from './contract.mjs';
import {
  assertSalesSupportRepair, salesSupportFieldSnapshot, salesSupportProfile, salesSupportRepairFields, salesSupportRepairPackage,
} from './trading-fx-sales-support-repair.mjs';

export const salesSupportCorrectionOperation = 'sales-support-correction';
const target = fcosSalesforceEnvironment('production');
const jobPattern = /^0Af[A-Za-z0-9]{15}$/u;
const productionCatalog = Object.freeze({
  unrelatedDigest: '61acc662a0f899fad1261722b38391cba9bb2a32dd67d0ecd7c99b16902d85e5',
  unrelatedCount: 1363,
});
const profileDigest = '03b415858374db416c71f81783c7880ba2f23d4952937b12cc09e9dedc7f4d9c';
const manifestDigest = '85ea97f7edebcc629d9c8615b44bc169df7a11247a57d8d4725bb433ebd6453a';
const packageSha256 = digest({ profileDigest, manifestDigest });
const check = (value, code) => requireCondition(value, 'TRADING_FX_SALES_SUPPORT_' + code);

function command(program, args, cwd, { env, timeout }) {
  const raw = execFileSync(program, args, { cwd, env, timeout, maxBuffer: 12 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const result = JSON.parse(raw);
    check(result?.status === 0, 'NATIVE_COMMAND_REFUSED');
    return result.result;
  } finally {
    raw.fill(0);
  }
}

function nativeConnection(cwd, env, run) {
  return (args, directory = cwd, timeout = 30000) =>
    run('sf', [...args, '--target-org', target.alias, '--json'], directory, { env, timeout });
}

function verifyIdentity(sf) {
  const identity = sf(['org', 'display']);
  check(identity?.id === target.orgId && identity.connectedStatus === 'Connected'
    && identity.username === target.username && identity.instanceUrl === target.instanceUrl && target.isSandbox === false, 'ORG_CHANGED');
  const query = sql => sf(['data', 'query', '--query', sql]);
  const org = query('SELECT Id, IsSandbox FROM Organization LIMIT 1');
  check(org?.done === true && org.records?.length === 1 && org.records[0].Id === target.orgId
    && org.records[0].IsSandbox === false, 'ORG_CHANGED');
}

function nativeCatalog(sf) {
  const query = sql => sf(['data', 'query', '--query', sql]);
  const profile = query("SELECT Id, IsOwnedByProfile FROM PermissionSet WHERE IsOwnedByProfile = true AND Profile.Name = 'Sales Support'");
  const parentId = profile?.records?.[0]?.Id;
  check(profile?.done === true && profile.records.length === 1 && profile.records[0].IsOwnedByProfile === true
    && /^0PS[A-Za-z0-9]{15}$/u.test(parentId || ''), 'PROFILE_CHANGED');
  const grants = query("SELECT Field, ParentId, PermissionsRead, PermissionsEdit FROM FieldPermissions WHERE ParentId = '" + parentId + "'");
  return salesSupportFieldSnapshot({ rows: grants?.records, done: grants?.done, parentId });
}

const snapshot = (sf, read, reviewedCatalog) => {
  const current = nativeCatalog(sf);
  check(current.unrelatedDigest === reviewedCatalog.unrelatedDigest
    && current.unrelatedCount === reviewedCatalog.unrelatedCount, 'UNRELATED_GRANTS_CHANGED');
  check(current.target.every(row => row.read === read && row.edit === false), read ? 'PREIMAGE_CHANGED' : 'DENY_UNVERIFIED');
  return current;
};

function assertReport(report, jobId, submittedAt, now) {
  try { assertSuccessfulSalesforceReport(report, { environment: target, jobId }); }
  catch { check(false, 'ORIGINAL_JOB_UNVERIFIED'); }
  const rows = report.details?.componentSuccesses;
  const successes = Array.isArray(rows) ? rows : rows ? [rows] : [];
  const descriptors = successes.filter(item => item.success === true && item.componentType === '' && item.fullName === 'package.xml'
    && ['package.xml', 'zip/package.xml'].includes(item.fileName));
  const profiles = successes.filter(item => item.success === true && item.componentType === 'Profile' && item.fullName === salesSupportProfile
    && ['profiles/Sales Support.profile', 'zip/profiles/Sales Support.profile'].includes(item.fileName)
    && item.created !== true && item.deleted !== true);
  const tests = Number(report.numberTestsTotal);
  check(Number(report.numberComponentsTotal) === 1 && Number(report.numberComponentsDeployed) === 1 && profiles.length === 1
    && descriptors.length <= 1 && successes.length === profiles.length + descriptors.length
    && Number.isSafeInteger(tests) && tests >= 0 && Number(report.numberTestsCompleted) === tests
    && !report.details?.runTestResult?.codeCoverageWarnings?.length, 'ORIGINAL_JOB_SCOPE_CHANGED');
  const completedAt = Date.parse(report.completedDate);
  check(completedAt >= Date.parse(submittedAt) - 30000 && completedAt <= now().getTime() + 30000, 'ORIGINAL_JOB_TIME_CHANGED');
  return report.completedDate;
}

function writePackage(folder) {
  const packet = salesSupportRepairPackage();
  check(packet.profileDigest === profileDigest && packet.manifestDigest === manifestDigest, 'PACKAGE_CHANGED');
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
        && digest(readFileSync(manifest)) === manifestDigest && digest(readFileSync(profile)) === profileDigest, 'PACKAGE_CHANGED');
    },
  };
}

export function verifyTradingFxSalesSupportReadGrants({ cwd, commandEnvironment, read, run = command }) {
  check(typeof cwd === 'string' && commandEnvironment?.PATH && typeof read === 'boolean', 'PROTECTED_CONTEXT_REQUIRED');
  const sf = nativeConnection(cwd, commandEnvironment, run);
  verifyIdentity(sf);
  return snapshot(sf, read, productionCatalog);
}

export function applyTradingFxSalesSupportCorrection(input) {
  return runSalesSupportCorrection(input, productionCatalog);
}

// Separate parameters let the native transport be exercised in isolation from
// the pinned Production snapshot. The protected adapter uses the entry above.
export async function runSalesSupportCorrection({
  cwd, commandEnvironment, fingerprint, ownership, journal, run = command, now = () => new Date(),
}, reviewedCatalog) {
  const stage = 'production', operation = salesSupportCorrectionOperation;
  check(isDigest(fingerprint) && typeof cwd === 'string' && commandEnvironment?.PATH
    && typeof ownership?.assert === 'function' && typeof journal?.readCheckpoints === 'function'
    && typeof journal?.checkpoint === 'function' && isDigest(reviewedCatalog?.unrelatedDigest)
    && Number.isSafeInteger(reviewedCatalog.unrelatedCount) && reviewedCatalog.unrelatedCount >= 0, 'PROTECTED_CONTEXT_REQUIRED');
  const sf = nativeConnection(cwd, commandEnvironment, run);
  async function current() {
    const records = (await journal.readCheckpoints()).filter(row => row.stage === stage && row.operation === operation);
    check(records.length <= 1, 'CHECKPOINT_AMBIGUOUS');
    if (!records.length) return undefined;
    const [row] = records, { job } = row;
    check(row.fingerprint === fingerprint && ['pending', 'resolved'].includes(row.outcome)
      && isDigest(row.evidenceDigest) && job?.validationId === null && job.packageSha256 === packageSha256
      && (job.id === null && row.outcome === 'pending' || jobPattern.test(job.id || ''))
      && Number.isFinite(Date.parse(job.submittedAt)) && new Date(job.submittedAt).toISOString() === job.submittedAt,
    'CHECKPOINT_CHANGED');
    return row;
  }
  async function save(record) {
    await journal.checkpoint({ fingerprint, stage, operation, record });
    const row = await current();
    check(row?.job.id === record.jobId && row.job.submittedAt === record.submittedAt
      && row.outcome === (record.status === 'Succeeded' ? 'resolved' : 'pending')
      && row.evidenceDigest === digest(record), 'CHECKPOINT_NOT_DURABLE');
    return row;
  }
  const lease = await ownership.assert({ fingerprint, stage, orgId: target.orgId, operation });
  check(lease?.fingerprint === fingerprint && lease.stage === stage && lease.orgId === target.orgId
    && lease.operation === operation && isDigest(lease.receiptId)
    && Date.parse(lease.expiresAt) > now().getTime(), 'OWNERSHIP_EXPIRED');
  let saved = await current();
  check(saved?.job.id !== null, 'ORIGINAL_SUBMISSION_UNKNOWN');
  verifyIdentity(sf);
  let before;
  if (!saved) {
    before = snapshot(sf, true, reviewedCatalog);
    const folder = mkdtempSync(join(tmpdir(), 'fcos-sales-support-correction-'));
    try {
      const prepared = writePackage(folder);
      const intent = { status: 'submitting', jobId: null, validationJobId: null, submittedAt: now().toISOString(), packageSha256,
        beforeDigest: digest(before), receiptId: lease.receiptId };
      await save(intent);
      check(Date.parse(lease.expiresAt) > now().getTime(), 'OWNERSHIP_EXPIRED');
      prepared.verify();
      let result;
      try {
        result = sf(['project', 'deploy', 'start', '--metadata-dir', prepared.directory, '--api-version', '67.0',
          '--test-level', 'RunRelevantTests', '--async'], cwd, 45000);
      } catch { check(false, 'ORIGINAL_SUBMISSION_UNKNOWN'); }
      check(jobPattern.test(result?.id || ''), 'ORIGINAL_SUBMISSION_UNKNOWN');
      saved = await save({ ...intent, status: 'submitted', jobId: result.id });
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }

  // Only the durable original job may be polled. This branch never submits.
  const { id: jobId, submittedAt } = saved.job;
  const report = sf(['project', 'deploy', 'report', '--job-id', jobId, '--wait', '15'], cwd, 16 * 60000);
  const completedAt = assertReport(report, jobId, submittedAt, now);
  verifyIdentity(sf);
  const after = snapshot(sf, false, reviewedCatalog);
  // On a resumed attempt the native receipt and reviewed catalog preimage are
  // the reference. The target reads must still be denied on every re-entry.
  const reviewedBefore = before ?? { ...after, target: salesSupportRepairFields.map(field => ({ field, read: true, edit: false })) };
  const proof = assertSalesSupportRepair({ before: reviewedBefore, after, expectedPreimage: 'unexpected-projected-reads' });
  const record = { status: 'Succeeded', jobId, submittedAt, validationJobId: null, packageSha256, completedAt,
    reportDigest: digest(report), profileDigest, manifestDigest, proof };
  if (saved.outcome === 'pending') saved = await save(record);
  return { operationId: 'salesforce:production:' + operation, evidenceDigest: saved.evidenceDigest, record,
    jobId, verified: true, intentRecorded: true };
}
