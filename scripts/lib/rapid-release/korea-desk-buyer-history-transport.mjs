import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { fcosSalesforceEnvironment } from '../../../config/fcosConnections.js';
import { assertReviewedJobReport } from '../salesforce-reviewed-release.mjs';
import { digest, isDigest, requireCondition } from './contract.mjs';

export const buyerHistoryOperation = 'buyer-history-correction';
const field = 'STEM__c.Account__c';
const terminalOutcomes = { Failed: 'failed_rolled_back', Canceled: 'canceled_rolled_back' };
const jobIdPattern = /^0Af[A-Za-z0-9]{15}$/u;
const xmlDeclaration = '<?xml version="1.0" encoding="UTF-8"?>\n';
const ns = 'http://soap.sforce.com/2006/04/metadata';
const manifest = Buffer.from(xmlDeclaration + '<Package xmlns="' + ns + '">\n'
  + '    <types><members>STEM__c.Account__c</members><name>CustomField</name></types>\n'
  + '    <version>67.0</version>\n</Package>\n');

export const productionBuyerHistoryPins = Object.freeze({
  active: Object.freeze({ sha256: '43052e84145bfd05e65880c763cacb2c040437d8f9463ff73229eac267a84272', size: 1493 }),
  final: Object.freeze({ sha256: '0631d8050a3134d26317b1d450afe6cdb738da6dfcac6112e7663a5fd8929987', size: 1494 }),
  packageSha256: 'fc3c90ab5efe4182b02c5bae11713e43ffb96fc641ec57c4075f6e0e1cba6d61',
});
const sandboxXml = { sha256: '87650135ed2a9d7f904bb1ffd38db4539b62581eb10cb3eb61cacc9840de8d98', size: 1458 };
const sandboxPins = { active: sandboxXml, final: sandboxXml, packageSha256: '7269e3734c6a33e13cab1c9ec99c321876c5dba06c6eac71edad8144241fce9d' };
const check = (condition, code) => requireCondition(condition, 'KOREA_DESK_BUYER_HISTORY_' + code);

function pinnedTarget(environment) {
  const target = fcosSalesforceEnvironment(environment.key);
  check(['orgId', 'isSandbox', 'alias', 'username'].every(key => environment[key] === target[key]), 'TARGET_CHANGED');
  return target;
}
function verifyXml(input, pin) {
  check(typeof input === 'string' || Buffer.isBuffer(input) || input instanceof Uint8Array, 'XML_REQUIRED');
  const bytes = Buffer.from(input);
  check(bytes.length === pin.size && digest(bytes) === pin.sha256, 'NATIVE_XML_CHANGED');
  return bytes;
}

export function buildKoreaDeskBuyerHistoryPacket(environment, activeXml) {
  const target = pinnedTarget(environment);
  const pins = target.isSandbox ? sandboxPins : productionBuyerHistoryPins;
  const active = verifyXml(activeXml, pins.active);
  const postimage = verifyXml(active.toString('utf8').replace('<trackHistory>true</trackHistory>', '<trackHistory>false</trackHistory>'), pins.final);
  const opening = xmlDeclaration + '<CustomField xmlns="' + ns + '">\n';
  const closing = '</CustomField>\n';
  const content = postimage.toString('utf8').slice(opening.length, -closing.length);
  const object = Buffer.from(xmlDeclaration + '<CustomObject xmlns="' + ns + '">\n<fields>\n' + content + '</fields>\n</CustomObject>\n');
  const archive = Buffer.from(zipSync({ 'package.xml': manifest, 'objects/STEM__c.object': object },
    { level: 0, mtime: new Date(2000, 0, 1, 0, 0, 0), os: 0, attrs: 0 }));
  check(digest(archive) === pins.packageSha256, 'PACKAGE_CHANGED');
  return { archive, postimage, packageSha256: pins.packageSha256 };
}

function submitCli(args, cwd, commandEnvironment) {
  const result = JSON.parse(execFileSync('sf', args, { cwd, env: commandEnvironment, timeout: 45000,
    maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
  check(result.status === 0, 'SUBMISSION_UNCONFIRMED');
  return result.result;
}

function assertReport(report, jobId, target, testLevel, submittedAt, now) {
  assertReviewedJobReport(report, { environment: target, jobId, bootstrap: true,
    testPlan: { level: testLevel, tests: [], minimumTests: 0 }, expectedComponents: ['CustomField:' + field] });
  const successes = report.details.componentSuccesses;
  const rows = Array.isArray(successes) ? successes : [successes];
  const correctField = row => row?.success === true && row.componentType === 'CustomField' && row.fullName === field
    && ['objects/STEM__c.object', 'zip/objects/STEM__c.object'].includes(row.fileName) && row.created === false && row.deleted === false;
  const descriptor = row => row?.success === true && row.componentType === '' && row.fullName === 'package.xml'
    && ['package.xml', 'zip/package.xml'].includes(row.fileName);
  const warnings = report.details.runTestResult?.codeCoverageWarnings;
  check(report.numberComponentsTotal === 1 && report.numberComponentsDeployed === 1
    && report.numberComponentErrors === 0 && report.numberTestErrors === 0
    && rows.filter(correctField).length === 1 && rows.filter(descriptor).length <= 1 && rows.every(row => correctField(row) || descriptor(row))
    && (warnings == null || (Array.isArray(warnings) && warnings.length === 0))
    && (!report.testLevel || report.testLevel === testLevel), 'JOB_SCOPE_CHANGED');
  assertCompletedAt(report.completedDate, submittedAt, now);
}

function assertCompletedAt(completedDate, submittedAt, now) {
  const completed = Date.parse(completedDate);
  check(completed >= Date.parse(submittedAt) - 30_000 && completed <= now().getTime() + 30_000, 'JOB_TIME_CHANGED');
}

function stopRolledBack(outcome) {
  check(false, 'ORIGINAL_JOB_' + outcome.toUpperCase());
}

export async function applyKoreaDeskBuyerHistoryCorrection({
  environment, provider, cwd, commandEnvironment, fingerprint, journal, ownership, readAccountXml,
  now = () => new Date(), run = submitCli,
}) {
  const target = pinnedTarget(environment);
  const stage = target.key, orgId = target.orgId, operation = buyerHistoryOperation;
  const pins = target.isSandbox ? sandboxPins : productionBuyerHistoryPins;
  const testLevel = target.isSandbox ? 'NoTestRun' : 'RunRelevantTests';
  check(isDigest(fingerprint) && typeof cwd === 'string' && commandEnvironment?.PATH
    && typeof provider?.verifyIdentity === 'function' && typeof provider.report === 'function'
    && typeof readAccountXml === 'function' && typeof journal?.readCheckpoints === 'function'
    && typeof journal.checkpoint === 'function' && typeof ownership?.assert === 'function', 'PROTECTED_CONTEXT_REQUIRED');
  async function current() {
    const rows = (await journal.readCheckpoints()).filter(item => item.stage === stage && item.operation === operation);
    check(rows.length <= 1, 'CHECKPOINT_AMBIGUOUS');
    const row = rows[0];
    if (row) {
      const job = row.job;
      check(row.fingerprint === fingerprint && isDigest(row.evidenceDigest) && ['pending', 'resolved'].includes(row.outcome)
        && job?.packageSha256 === pins.packageSha256 && job.validationId === null
        && (jobIdPattern.test(job.id ?? '') || (row.outcome === 'pending' && job.id === null))
        && Number.isFinite(Date.parse(job.submittedAt)) && new Date(job.submittedAt).toISOString() === job.submittedAt
        && (row.terminalOutcome === undefined || (row.outcome === 'resolved' && jobIdPattern.test(job.id)
          && Object.values(terminalOutcomes).includes(row.terminalOutcome) && isDigest(row.reportDigest))), 'CHECKPOINT_CHANGED');
    }
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
  await provider.verifyIdentity(target);
  let saved = await current();
  if (saved?.terminalOutcome) stopRolledBack(saved.terminalOutcome);
  if (!saved) {
    const packet = buildKoreaDeskBuyerHistoryPacket(target, await readAccountXml(target));
    const folder = mkdtempSync(join(tmpdir(), 'fcos-korea-buyer-history-'));
    try {
      const file = join(folder, 'buyer-history.zip');
      writeFileSync(file, packet.archive, { flag: 'wx', mode: 0o600 });
      const lease = await ownership.assert({ fingerprint, stage, orgId, operation });
      check(isDigest(lease?.receiptId) && lease.fingerprint === fingerprint && lease.stage === stage && lease.orgId === orgId
        && lease.operation === operation && Date.parse(lease.expiresAt) > now().getTime(), 'OWNERSHIP_REQUIRED');
      const intent = { status: 'submitting', jobId: null, validationJobId: null, submittedAt: now().toISOString(),
        packageSha256: pins.packageSha256, testLevel, preimageSha256: pins.active.sha256, receiptId: lease.receiptId };
      await save(intent);
      await provider.verifyIdentity(target);
      check(Date.parse(lease.expiresAt) > now().getTime() && digest(readFileSync(file)) === pins.packageSha256, 'SUBMISSION_BINDING_CHANGED');
      let result;
      try {
        result = await run(['project', 'deploy', 'start', '--target-org', target.alias, '--metadata-dir', file, '--single-package',
          '--api-version', '67.0', '--test-level', testLevel, '--async', '--json'], cwd, commandEnvironment);
      } catch { check(false, 'ORIGINAL_JOB_UNCONFIRMED'); }
      check(jobIdPattern.test(result?.id ?? ''), 'ORIGINAL_JOB_UNCONFIRMED');
      saved = await save({ ...intent, status: 'submitted', jobId: result.id });
    } finally { rmSync(folder, { recursive: true, force: true }); }
  }
  const { id: jobId, submittedAt } = saved.job;
  check(jobIdPattern.test(jobId ?? ''), 'ORIGINAL_JOB_UNCONFIRMED');
  const report = await provider.report(target, jobId);
  if (Object.hasOwn(terminalOutcomes, report?.status)) {
    check(saved.outcome === 'pending' && report.id === jobId && report.done === true && report.success === false
      && report.checkOnly === false && report.rollbackOnError === true && (report.testLevel === undefined || report.testLevel === testLevel),
    'TERMINAL_JOB_UNVERIFIED');
    assertCompletedAt(report.completedDate, submittedAt, now);
    await provider.verifyIdentity(target);
    const before = verifyXml(await readAccountXml(target), pins.active);
    const terminalOutcome = terminalOutcomes[report.status];
    await save({ status: report.status, terminalOutcome, orgId, jobId, submittedAt, validationJobId: null,
      packageSha256: pins.packageSha256, completedAt: report.completedDate, testLevel, checkOnly: false,
      rollbackOnError: true, reportDigest: digest(report), preimageSha256: digest(before) });
    stopRolledBack(terminalOutcome);
  }
  assertReport(report, jobId, target, testLevel, submittedAt, now);
  await provider.verifyIdentity(target);
  verifyXml(await readAccountXml(target), pins.final);
  const record = { status: 'Succeeded', jobId, submittedAt, validationJobId: null, packageSha256: pins.packageSha256,
    testLevel, orgId, completedAt: report.completedDate, postimageSha256: pins.final.sha256,
    reportDigest: digest({ jobId, orgId, completedAt: report.completedDate, tests: report.numberTestsCompleted,
      component: field, rollbackOnError: report.rollbackOnError }) };
  if (saved.outcome === 'pending') saved = await save(record);
  else check(saved.evidenceDigest === digest(record), 'RESOLVED_EVIDENCE_CHANGED');
  return { operationId: 'salesforce:' + stage + ':' + operation, evidenceDigest: saved.evidenceDigest, record,
    jobId, verified: true, intentRecorded: true };
}
