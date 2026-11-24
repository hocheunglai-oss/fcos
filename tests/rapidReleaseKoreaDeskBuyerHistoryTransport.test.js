import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { unzipSync } from 'fflate';
import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { digest } from '../scripts/lib/rapid-release/contract.mjs';
import { DeploymentJournal, MemoryJournal, pendingOperations } from '../scripts/lib/rapid-release/journal.mjs';
import { applyKoreaDeskBuyerHistoryCorrection, buildKoreaDeskBuyerHistoryPacket, productionBuyerHistoryPins }
  from '../scripts/lib/rapid-release/korea-desk-buyer-history-transport.mjs';

const productionActive = `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Account__c</fullName>
    <label>Buyer</label>
    <lookupFilter>
        <active>true</active>
        <booleanFilter>((1 OR 2) AND 3) OR 4</booleanFilter>
        <errorMessage>Buyer is inactive or has incorrect record type</errorMessage>
        <filterItems>
            <field>Account.RecordTypeId</field>
            <operation>equals</operation>
            <value>Buyer</value>
        </filterItems>
        <filterItems>
            <field>Account.RecordTypeId</field>
            <operation>equals</operation>
            <value>Buyer &amp; Supplier</value>
        </filterItems>
        <filterItems>
            <field>Account.Inactive_Suspended__c</field>
            <operation>equals</operation>
            <value>False</value>
        </filterItems>
        <filterItems>
            <field>$Source.RecordTypeId</field>
            <operation>equals</operation>
            <value>Historical</value>
        </filterItems>
        <isOptional>false</isOptional>
    </lookupFilter>
    <referenceTo>Account</referenceTo>
    <relationshipName>STEM</relationshipName>
    <relationshipOrder>0</relationshipOrder>
    <reparentableMasterDetail>true</reparentableMasterDetail>
    <trackHistory>true</trackHistory>
    <trackTrending>false</trackTrending>
    <type>MasterDetail</type>
    <writeRequiresMasterRead>false</writeRequiresMasterRead>
</CustomField>
`;
const productionFinal = productionActive.replace('<trackHistory>true', '<trackHistory>false');
const sandbox = productionFinal.replace('        <errorMessage>Buyer is inactive or has incorrect record type</errorMessage>\n', '')
  .replace('    <relationshipName>', '    <relationshipLabel>STEM</relationshipLabel>\n    <relationshipName>');
const jobId = '0Af000000000001AAA';
const timestamp = '2026-11-24T18:30:00.000Z';

function scenario(org = 'production') {
  const environment = fcosSalesforceEnvironment(org);
  const state = { xml: environment.isSandbox ? sandbox : productionActive, saved: undefined, received: [], operations: [], reports: 0 };
  const field = { componentType: 'CustomField', fullName: 'STEM__c.Account__c', fileName: 'objects/STEM__c.object',
    success: true, created: false, deleted: false };
  const report = { id: jobId, status: 'Succeeded', success: true, done: true, checkOnly: false, rollbackOnError: true,
    completedDate: timestamp, numberComponentsDeployed: 1, numberComponentsTotal: 1,
    numberTestsTotal: 0, numberTestsCompleted: 0, numberComponentErrors: 0, numberTestErrors: 0,
    details: { componentSuccesses: [field, { componentType: '', fullName: 'package.xml', fileName: 'package.xml', success: true }] } };
  const input = {
    environment, cwd: '/isolated/candidate', commandEnvironment: { PATH: '/test' }, fingerprint: '1'.repeat(64),
    now: () => new Date(timestamp),
    provider: {
      async verifyIdentity(target) { assert.deepEqual(target, environment); },
      async report(target, id) { assert.deepEqual(target, environment); assert.equal(id, jobId); state.reports++; return report; },
    },
    readAccountXml: async target => { assert.deepEqual(target, environment); return state.xml; },
    journal: {
      async readCheckpoints() { return state.saved ? [state.saved] : []; },
      async checkpoint({ fingerprint, stage, operation, record }) {
        state.operations.push(record.status);
        state.saved = { fingerprint, stage, operation, outcome: record.status === 'Succeeded' ? 'resolved' : 'pending',
          evidenceDigest: digest(record), job: { id: record.jobId, validationId: record.validationJobId,
            packageSha256: record.packageSha256, submittedAt: record.submittedAt } };
      },
    },
    ownership: { async assert(binding) { return { ...binding, receiptId: '2'.repeat(64), expiresAt: '2026-11-24T18:35:00.000Z' }; } },
    async run(args) {
      assert.deepEqual(state.operations, ['submitting']);
      const path = args[args.indexOf('--metadata-dir') + 1];
      assert.equal(digest(readFileSync(path)), state.saved.job.packageSha256);
      state.received.push({ args, path });
      state.xml = environment.isSandbox ? sandbox : productionFinal;
      return { id: jobId };
    },
  };
  return { input, state, report };
}

test('exact packets keep the complete native MasterDetail definitions and one CustomField member', () => {
  for (const org of ['devee', 'qat', 'production']) {
    const target = fcosSalesforceEnvironment(org);
    const source = target.isSandbox ? sandbox : productionActive;
    const { archive, postimage, packageSha256 } = buildKoreaDeskBuyerHistoryPacket(target, source);
    assert.equal(postimage.toString(), target.isSandbox ? sandbox : productionFinal);
    assert.equal(packageSha256, target.isSandbox ? '7269e3734c6a33e13cab1c9ec99c321876c5dba06c6eac71edad8144241fce9d'
      : productionBuyerHistoryPins.packageSha256);
    const files = unzipSync(archive);
    assert.deepEqual(Object.keys(files), ['package.xml', 'objects/STEM__c.object']);
    assert.match(Buffer.from(files['package.xml']).toString(), /<members>STEM__c.Account__c<\/members><name>CustomField<\/name>/u);
    const object = Buffer.from(files['objects/STEM__c.object']).toString();
    assert.equal((object.match(/<fields>/gu) ?? []).length, 1);
    assert.ok(object.includes('    <fullName>Account__c</fullName>'));
    assert.throws(() => buildKoreaDeskBuyerHistoryPacket(target, source.replace('Buyer', 'Seller')), /NATIVE_XML_CHANGED/u);
  }
});

test('submits after durable intent, records the original job before report, and always removes the temporary ZIP', async () => {
  for (const org of ['devee', 'qat', 'production']) {
    const { input, state } = scenario(org);
    const result = await applyKoreaDeskBuyerHistoryCorrection(input);
    assert.deepEqual(state.operations, ['submitting', 'submitted', 'Succeeded']);
    assert.equal(result.jobId, jobId);
    const [{ args, path }] = state.received;
    assert.ok(args.includes('--single-package'));
    assert.ok(!args.includes('--ignore-errors'));
    assert.equal(args[args.indexOf('--test-level') + 1], org === 'production' ? 'RunRelevantTests' : 'NoTestRun');
    assert.equal(existsSync(path), false);
    assert.equal((await applyKoreaDeskBuyerHistoryCorrection(input)).evidenceDigest, result.evidenceDigest);
    assert.equal(state.received.length, 1);
    assert.equal(state.reports, 2);
    assert.equal(state.operations.length, 3);
  }
});

test('lost submission acknowledgement stays unresolved even when Production has reached the final field bytes', async () => {
  const { input, state } = scenario();
  const run = input.run;
  input.run = async args => { await run(args); throw Error('lost acknowledgement'); };
  await assert.rejects(applyKoreaDeskBuyerHistoryCorrection(input), /ORIGINAL_JOB_UNCONFIRMED/u);
  await assert.rejects(applyKoreaDeskBuyerHistoryCorrection(input), /ORIGINAL_JOB_UNCONFIRMED/u);
  assert.equal(state.received.length, 1);
  assert.equal(existsSync(state.received[0].path), false);
  assert.deepEqual(state.operations, ['submitting']);
  assert.equal(state.reports, 0);
});

test('known job resumes through report and postimage after an interrupted native read', async () => {
  const { input, state } = scenario();
  const report = input.provider.report;
  input.provider.report = async () => { throw Error('read interrupted'); };
  await assert.rejects(applyKoreaDeskBuyerHistoryCorrection(input), /read interrupted/u);
  assert.deepEqual(state.operations, ['submitting', 'submitted']);
  input.provider.report = report;
  await applyKoreaDeskBuyerHistoryCorrection(input);
  assert.equal(state.received.length, 1);
  assert.deepEqual(state.operations, ['submitting', 'submitted', 'Succeeded']);
});

test('rejects wrong field, extra component, effective drift, or failed rollback evidence without a second submit', async () => {
  for (const corrupt of [
    ({ report }) => { report.details.componentSuccesses[0].fullName = 'STEM__c.Korea_Desk__c'; },
    ({ report }) => { report.details.componentSuccesses.push({ ...report.details.componentSuccesses[0] }); },
    ({ report }) => { report.rollbackOnError = false; },
    ({ input, state }) => { const run = input.run; input.run = async args => { const result = await run(args);
      state.xml = productionFinal.replace('inactive', 'active'); return result; }; },
  ]) {
    const harness = scenario();
    corrupt(harness);
    for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(applyKoreaDeskBuyerHistoryCorrection(harness.input));
    assert.deepEqual(harness.state.operations, ['submitting', 'submitted']);
    assert.equal(harness.state.received.length, 1);
  }
});

test('rejects a wrong org or ownership scope, expired lease, and unacknowledged intent before submit', async () => {
  for (const change of [
    ({ input }) => { input.environment = { ...input.environment, alias: 'other-org' }; },
    ({ input }) => { input.ownership.assert = async binding => ({ ...binding, orgId: 'other-org', receiptId: '2'.repeat(64), expiresAt: '2026-11-24T18:35:00.000Z' }); },
    ({ input }) => { input.ownership.assert = async binding => ({ ...binding, receiptId: '2'.repeat(64), expiresAt: timestamp }); },
    ({ input }) => { input.journal.checkpoint = async () => undefined; },
    ({ state }) => { state.xml = productionFinal; },
  ]) {
    const harness = scenario();
    change(harness);
    await assert.rejects(applyKoreaDeskBuyerHistoryCorrection(harness.input));
    assert.equal(harness.state.received.length, 0);
  }
});

function terminalScenario(status, org = 'production') {
  const setup = scenario(org);
  const { input, state, report } = setup;
  Object.assign(report, { success: false, done: true, status });
  const log = new MemoryJournal(), submitted = input.run;
  // Exercise the deployed journal projection, including its pending-operations calculation.
  input.journal = {
    readCheckpoints: () => DeploymentJournal.prototype.readSalesforceCheckpoints.call(log, input.fingerprint),
    async checkpoint(entry) {
      const result = await DeploymentJournal.prototype.checkpoint.call(log, entry);
      state.saved = result.payload.data;
      state.operations.push(entry.record.status);
      return result;
    },
  };
  input.run = async args => {
    const original = state.xml;
    const response = await submitted(args);
    state.xml = original;
    return response;
  };
  return { ...setup, log };
}

test('verified failed and canceled original jobs close their correction checkpoint and keep promotion stopped', async () => {
  for (const org of ['devee', 'production']) {
    for (const [status, outcome] of [['Failed', 'failed_rolled_back'], ['Canceled', 'canceled_rolled_back']]) {
      const { input, state, log, report } = terminalScenario(status, org);
      const error = { code: 'KOREA_DESK_BUYER_HISTORY_ORIGINAL_JOB_' + outcome.toUpperCase() };
      await assert.rejects(applyKoreaDeskBuyerHistoryCorrection(input), error);
      assert.deepEqual(state.operations, ['submitting', 'submitted', status]);
      assert.equal(state.saved.outcome, 'resolved');
      assert.equal(state.saved.terminalOutcome, outcome);
      assert.equal(state.saved.job.id, jobId);
      assert.equal(state.saved.reportDigest, digest(report));
      assert.deepEqual(pendingOperations(await log.read()), []);
      await assert.rejects(applyKoreaDeskBuyerHistoryCorrection(input), error);
      assert.deepEqual(state.operations, ['submitting', 'submitted', status]);
      assert.equal(state.received.length, 1);
      assert.equal(state.reports, 1);
    }
  }
});

test('incomplete, contradictory or time-mismatched rollback evidence leaves the original job pending', async () => {
  for (const changes of [
    { id: '0Af000000000009AAA' }, { done: false }, { success: true }, { rollbackOnError: false },
    { checkOnly: true }, { testLevel: 'NoTestRun' }, { completedDate: 'invalid' }, { completedDate: '2025-12-01T00:00:00Z' },
  ]) {
    const { input, state, log, report } = terminalScenario('Failed');
    Object.assign(report, changes);
    await assert.rejects(applyKoreaDeskBuyerHistoryCorrection(input), /TERMINAL_JOB_UNVERIFIED|JOB_TIME_CHANGED/u);
    assert.deepEqual(state.operations, ['submitting', 'submitted']);
    assert.equal(pendingOperations(await log.read()).length, 1);
    assert.equal(state.received.length, 1);
  }
});

test('a failed job with changed field bytes remains pending until its unchanged native preimage is proved', async () => {
  const { input, state, log } = terminalScenario('Failed');
  const submit = input.run;
  input.run = async args => { const result = await submit(args); state.xml = productionFinal; return result; };
  await assert.rejects(applyKoreaDeskBuyerHistoryCorrection(input), /NATIVE_XML_CHANGED/u);
  assert.deepEqual(state.operations, ['submitting', 'submitted']);
  assert.equal(pendingOperations(await log.read()).length, 1);
  state.xml = productionActive;
  await assert.rejects(applyKoreaDeskBuyerHistoryCorrection(input), /ORIGINAL_JOB_FAILED_ROLLED_BACK/u);
  assert.deepEqual(pendingOperations(await log.read()), []);
  assert.equal(state.received.length, 1);
  assert.equal(state.reports, 2);
});
