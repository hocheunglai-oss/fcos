import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { digest } from '../scripts/lib/rapid-release/contract.mjs';
import {
  salesSupportFieldSnapshot, salesSupportRepairFields, salesSupportRepairPackage,
} from '../scripts/lib/rapid-release/trading-fx-sales-support-repair.mjs';
import {
  applyTradingFxSalesSupportCorrection, runSalesSupportCorrection, salesSupportCorrectionOperation,
  verifyTradingFxSalesSupportReadGrants,
} from '../scripts/lib/rapid-release/trading-fx-sales-support-transport.mjs';

const production = fcosSalesforceEnvironment('production');
const jobId = '0Affu000001AFzhCAG';
const otherJob = '0Affu000001XYZhCAG';
const creatorId = '005123456789012ABC';
const parentId = '0PS123456789012ABC';
const operation = salesSupportCorrectionOperation;
const fingerprint = digest('compiled review');
const receiptId = digest('protected ownership');
const date = '2026-11-15T11:00:00.000Z';
const row = (Field, PermissionsRead, PermissionsEdit = false) =>
  ({ Field, PermissionsRead, PermissionsEdit, ParentId: parentId });
const unrelated = row('Account.Other__c', true, true);
const reviewedCatalog = salesSupportFieldSnapshot({ rows: [unrelated], done: true, parentId });
const packet = salesSupportRepairPackage();

function harness() {
  const checkpoints = [];
  const calls = [];
  const scenario = { beforeAllowed: true, afterAllowed: false, unrelated, submitted: false, grantEffect: false, reportOverrides: {} };
  const options = {
    cwd: process.cwd(), commandEnvironment: { PATH: '/pinned/sf/bin' }, fingerprint,
    now: () => new Date(date),
    ownership: {
      assert(binding) {
        assert.deepEqual(binding, { fingerprint, stage: 'production', orgId: production.orgId, operation });
        calls.push('lease');
        return { ...binding, receiptId, expiresAt: '2026-11-15T12:00:00.000Z' };
      },
    },
    journal: {
      readCheckpoints() { return checkpoints.slice(-1).map(({ checkpoint }) => checkpoint); },
      checkpoint({ fingerprint, stage, operation, record }) {
        calls.push(record.status);
        checkpoints.push({ record, checkpoint: { fingerprint, stage, operation,
          outcome: record.status === 'Succeeded' ? 'resolved' : 'pending', evidenceDigest: digest(record),
          job: { id: record.jobId, submittedAt: record.submittedAt, validationId: record.validationJobId,
            packageSha256: record.packageSha256 } } });
      },
    },
    run(program, args, cwd, { env }) {
      assert.equal(program, 'sf');
      assert.equal(cwd, options.cwd);
      assert.equal(env, options.commandEnvironment);
      assert.deepEqual(args.slice(-3), ['--target-org', production.alias, '--json']);
      if (args[0] === 'org') {
        calls.push('identity');
        const { orgId: id, username, instanceUrl } = production;
        return { id, username, instanceUrl, connectedStatus: 'Connected', ...scenario.identityOverrides };
      }
      if (args[0] === 'data') {
        const query = args[args.indexOf('--query') + 1];
        if (query.includes('FROM User')) return { done: true, records: [{ Id: creatorId }] };
        if (query.includes('FROM DeployRequest')) {
          assert.equal(args.includes('--use-tooling-api'), true);
          assert.match(query, new RegExp(creatorId, 'u'));
          calls.push('discover');
          const records = scenario.discovered ? scenario.discovered.map(Id => ({
            Id, CreatedDate: date, CreatedById: creatorId, CheckOnly: false, RollbackOnError: true, TestLevel: 'RunRelevantTests',
          })) : [];
          return { records, done: true, totalSize: records.length };
        }
        if (query.includes('FROM Organization')) {
          return { done: true, records: [{ Id: production.orgId, IsSandbox: false }] };
        }
        if (query.includes('FROM PermissionSet')) {
          assert.match(query, /IsOwnedByProfile = true AND Profile.Name = 'Sales Support'/u);
          return { done: true, records: [{ Id: parentId, IsOwnedByProfile: true }] };
        }
        assert.match(query, new RegExp(`FROM FieldPermissions WHERE ParentId = '${parentId}'`, 'u'));
        calls.push('catalog');
        const read = scenario.grantEffect ? scenario.afterAllowed : scenario.beforeAllowed;
        const grants = read ? salesSupportRepairFields.map(field => row(field, true)) : [];
        return { done: true, records: [scenario.unrelated, ...grants] };
      }
      if (args[2] === 'start') {
        calls.push('submit');
        assert.equal(scenario.submitted, false);
        assert.equal(checkpoints.at(-1).record.status, 'submitting');
        assert.equal(checkpoints.at(-1).record.jobId, null);
        const directory = args[args.indexOf('--metadata-dir') + 1];
        assert.deepEqual(readdirSync(directory).sort(), ['package.xml', 'profiles']);
        assert.deepEqual(readdirSync(join(directory, 'profiles')), ['Sales Support.profile']);
        assert.equal(readFileSync(join(directory, 'profiles', 'Sales Support.profile'), 'utf8'), packet.profile);
        assert.equal(readFileSync(join(directory, 'package.xml'), 'utf8'), packet.manifest);
        assert.deepEqual(args.slice(5, 10), ['--api-version', '67.0', '--test-level', 'RunRelevantTests', '--async']);
        scenario.submitted = true;
        if (scenario.loseAcknowledgment) throw new Error('unavailable response');
        return { id: jobId };
      }
      assert.deepEqual(args.slice(0, 7), ['project', 'deploy', 'report', '--job-id', jobId, '--wait', '15']);
      assert.ok([jobId, null].includes(checkpoints.at(-1).record.jobId));
      calls.push('report');
      if (scenario.reportUnavailable) throw new Error('unavailable original job report');
      scenario.grantEffect = true;
      return {
        id: jobId, status: 'Succeeded', success: true, done: true, checkOnly: false, rollbackOnError: true,
        numberComponentsTotal: 1, numberComponentsDeployed: 1, numberComponentErrors: 0,
        numberTestsTotal: 0, numberTestsCompleted: 0, numberTestErrors: 0, completedDate: date,
        details: { componentSuccesses: [
          { componentType: '', fullName: 'package.xml', fileName: 'zip/package.xml', success: true },
          { componentType: 'Profile', fullName: 'Sales Support', fileName: 'zip/profiles/Sales Support.profile',
            success: true, created: false, deleted: false },
        ] },
        ...scenario.reportOverrides,
      };
    },
  };
  return { calls, checkpoints, scenario, options, apply: () => runSalesSupportCorrection(options, reviewedCatalog) };
}

test('persists exact intent and native job before readback and verifies the scoped denial', async () => {
  const { apply, calls, checkpoints } = harness();
  const result = await apply();
  assert.deepEqual(calls, ['lease', 'identity', 'catalog', 'submitting', 'submit', 'submitted', 'report', 'identity', 'catalog', 'Succeeded']);
  assert.deepEqual(checkpoints.map(({ record }) => record.jobId), [null, jobId, jobId]);
  assert.equal(result.operationId, 'salesforce:production:' + operation);
  assert.equal(result.verified, true);
  assert.equal(result.record.proof.fields, 23);
  assert.equal(result.evidenceDigest, digest(result.record));
  assert.deepEqual(result.record, checkpoints.at(-1).record);
  const replay = await apply();
  assert.equal(replay.evidenceDigest, result.evidenceDigest);
  assert.equal(calls.filter(call => call === 'submit').length, 1);
  assert.equal(calls.filter(call => call === 'report').length, 2);
});

test('a lost report resumes through the durable original job without a second submission', async () => {
  const { apply, calls, scenario, checkpoints } = harness();
  scenario.reportUnavailable = true;
  await assert.rejects(apply(), /unavailable original job report/u);
  assert.equal(checkpoints.at(-1).record.jobId, jobId);
  scenario.reportUnavailable = false;
  assert.equal((await apply()).jobId, jobId);
  assert.equal(calls.filter(call => call === 'submit').length, 1);
});

test('an unknown submission ID permits only unique original-job discovery and readback', async () => {
  const { apply, calls, scenario, checkpoints } = harness();
  scenario.loseAcknowledgment = true;
  await assert.rejects(apply(), /ORIGINAL_SUBMISSION_UNKNOWN/u);
  assert.equal(checkpoints.at(-1).record.jobId, null);
  const priorCalls = calls.length;
  await assert.rejects(apply(), /ORIGINAL_SUBMISSION_UNKNOWN/u);
  assert.deepEqual(calls.slice(priorCalls), ['lease', 'identity', 'discover']);
  scenario.discovered = [jobId, otherJob];
  await assert.rejects(apply(), /ORIGINAL_SUBMISSION_UNKNOWN/u);
  scenario.discovered = [jobId];
  assert.equal((await apply()).jobId, jobId);
  assert.equal(calls.filter(call => call === 'submit').length, 1);
  assert.deepEqual(checkpoints.map(({ record }) => record.jobId), [null, jobId]);
});

test('checks the exact organization, projected grants, and unrelated grants before submission', async () => {
  const wrongOrg = harness();
  wrongOrg.scenario.identityOverrides = { id: '00D000000000000ABC' };
  await assert.rejects(wrongOrg.apply(), /ORG_CHANGED/u);
  const noProjection = harness();
  noProjection.scenario.beforeAllowed = false;
  await assert.rejects(noProjection.apply(), /PREIMAGE_CHANGED/u);
  const changedCatalog = harness();
  changedCatalog.scenario.unrelated = row(unrelated.Field, false);
  await assert.rejects(changedCatalog.apply(), /UNRELATED_GRANTS_CHANGED/u);
  assert.ok([wrongOrg, noProjection, changedCatalog].every(({ checkpoints }) => checkpoints.length === 0));
});

test('keeps a known job unresolved when report scope, original ID, or denied grants do not verify', async () => {
  const unexpected = harness();
  unexpected.scenario.reportOverrides = { numberComponentsTotal: 2 };
  await assert.rejects(unexpected.apply(), /ORIGINAL_JOB_SCOPE_CHANGED/u);
  const drift = harness();
  drift.scenario.reportOverrides = { id: otherJob };
  await assert.rejects(drift.apply(), /ORIGINAL_JOB_UNVERIFIED/u);
  const reportWithoutDenial = harness();
  reportWithoutDenial.scenario.afterAllowed = true;
  await assert.rejects(reportWithoutDenial.apply(), /DENY_UNVERIFIED/u);
  assert.ok([unexpected, drift, reportWithoutDenial].every(({ checkpoints }) =>
    checkpoints.length === 2 && checkpoints.at(-1).checkpoint.outcome === 'pending' && checkpoints.at(-1).record.jobId === jobId));
});

test('protected entry points enforce the pinned Production catalog', async () => {
  const { options, calls } = harness();
  await assert.rejects(applyTradingFxSalesSupportCorrection(options), /UNRELATED_GRANTS_CHANGED/u);
  assert.throws(() => verifyTradingFxSalesSupportReadGrants({ ...options, read: true }), /UNRELATED_GRANTS_CHANGED/u);
  assert.throws(() => verifyTradingFxSalesSupportReadGrants({ ...options, read: false }), /UNRELATED_GRANTS_CHANGED/u);
  assert.throws(() => verifyTradingFxSalesSupportReadGrants(options), /PROTECTED_CONTEXT_REQUIRED/u);
  assert.equal(calls.includes('submit'), false);
});
