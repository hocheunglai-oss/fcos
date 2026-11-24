import assert from 'node:assert/strict';
import { test } from 'node:test';
import { repairKoreaDeskBuyerHistory } from '../scripts/lib/rapid-release/salesforce-reviewed-adapter.mjs';
import { productionBuyerHistoryPins } from '../scripts/lib/rapid-release/korea-desk-buyer-history-transport.mjs';

const active = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
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
`);
const final = Buffer.from(active.toString().replace('<trackHistory>true</trackHistory>', '<trackHistory>false</trackHistory>'));
const field = 'objects/STEM__c/fields/Account__c.field-meta.xml';
const originalPin = { sha256: '26ec5e5dfb0437c47619ec879b4ec15aac23a1b268c0aeb59cd03436e514ab8b', size: 1455 };
const deploymentId = '0Af000000000002AAA';
const correctionId = '0Af000000000001AAA';

function harness({ xml = active, checkpoints = [], stopAtMirror, failPrewrite = false, failFinal = false, unverifiedStage } = {}) {
  const reviewed = {
    fingerprint: '9'.repeat(64),
    review: { nativeSupplementalContext: {
      production: { [field]: originalPin, 'objects/STEM__c/fields/Korea_Desk__c.field-meta.xml': { sha256: '1'.repeat(64), size: 42 } },
      devee: { [field]: { sha256: '2'.repeat(64), size: 1419 } }, qat: { [field]: { sha256: '2'.repeat(64), size: 1419 } },
    } },
    nativeInventories: Object.fromEntries(['devee', 'qat', 'production'].map(key =>
      [key, { final: { inventoryHash: key + '-final' }, bootstrap: { inventoryHash: key + '-bootstrap' } }])),
  };
  const original = structuredClone(reviewed), events = [], verifications = [], mutations = [];
  let mirrorCalls = 0;
  const provider = {
    async readKoreaDeskBuyerAccountXml(environment) { assert.equal(environment.key, 'production'); return xml; },
    async report(environment, id) {
      assert.equal(environment.key, 'production');
      assert.equal(id, deploymentId);
      events.push('report-deployment');
      return { id, done: true, success: true, status: 'Succeeded' };
    },
  };
  const input = {
    reviewed, provider, cwd: '/test/candidate', commandEnvironment: { PATH: '/test' },
    salesforce: { journal: { readCheckpoints: async () => checkpoints }, ownership: {} },
    async verifyMirror() {
      events.push('mirror');
      if (++mirrorCalls === stopAtMirror) throw Error('mirror draft head changed');
    },
  };
  const hooks = {
    async verifyInventory({ provider: current, environment, plan, expected }) {
      assert.equal(current, provider);
      assert.deepEqual(reviewed, original);
      const stage = environment.key;
      const pin = plan.review.nativeSupplementalContext.production[field];
      const correctedPreimage = stage === 'production' && xml.equals(active);
      const exactPlan = structuredClone(original);
      if (correctedPreimage) exactPlan.review.nativeSupplementalContext.production[field] = productionBuyerHistoryPins.active;
      assert.deepEqual(plan, exactPlan);
      assert.deepEqual(pin, correctedPreimage ? productionBuyerHistoryPins.active : originalPin);
      if (stage !== 'production' || events.includes('production')) assert.equal(plan, reviewed);
      assert.deepEqual(expected, plan.nativeInventories[stage][stage === 'production' &&
        !checkpoints.some(row => row.operation === 'deployment') ? 'bootstrap' : 'final']);
      verifications.push({ stage, mode: correctedPreimage ? 'exact active' : 'strict', expected: expected.inventoryHash });
      events.push('verify-' + stage);
      if (failPrewrite && stage === 'production' && mirrorCalls === 2) throw Error('production changed during QAT');
      if (failFinal && stage === 'production' && events.includes('production')) throw Error('unrelated metadata changed');
    },
    async applyCorrection({ environment, fingerprint, journal, ownership, readAccountXml }) {
      const stage = environment.key;
      assert.equal(fingerprint, reviewed.fingerprint);
      assert.equal(journal, input.salesforce.journal);
      assert.equal(ownership, input.salesforce.ownership);
      if (stage === 'production') {
        assert.deepEqual(await readAccountXml(environment), xml);
        if (checkpoints.some(row => row.stage === stage && row.operation === 'buyer-history-correction')) assert.deepEqual(xml, final);
        else { assert.deepEqual(xml, active); mutations.push(stage); xml = final; }
      }
      events.push(stage);
      return { operationId: 'salesforce:' + stage + ':buyer-history-correction', evidenceDigest: '3'.repeat(64), verified: stage !== unverifiedStage, intentRecorded: true };
    },
  };
  return { run: () => repairKoreaDeskBuyerHistory(input, hooks), events, verifications, mutations };
}

test('promotes DEVEE, verifies the complete mirror, promotes QAT and rechecks the mirror before Production', async () => {
  const h = harness();
  assert.deepEqual((await h.run()).map(item => item.operationId),
    ['devee', 'qat', 'production'].map(stage => 'salesforce:' + stage + ':buyer-history-correction'));
  assert.deepEqual(h.events, ['verify-production', 'verify-devee', 'devee', 'verify-devee', 'mirror',
    'verify-qat', 'qat', 'verify-qat', 'mirror', 'verify-production', 'production', 'verify-production']);
  assert.deepEqual(h.verifications.filter(v => v.stage !== 'production').map(v => v.stage), ['devee', 'devee', 'qat', 'qat']);
  assert.deepEqual(h.verifications[0], { stage: 'production', mode: 'exact active', expected: 'production-bootstrap' });
  assert.deepEqual(h.verifications.at(-1), { stage: 'production', mode: 'strict', expected: 'production-bootstrap' });
  assert.deepEqual(h.mutations, ['production']);
});

test('a changed mirror at either boundary stops the next org', async () => {
  for (const [number, expected] of [[1, ['devee', 'mirror']], [2, ['devee', 'mirror', 'qat', 'mirror']]]) {
    const h = harness({ stopAtMirror: number });
    await assert.rejects(h.run(), /mirror draft head changed/u);
    assert.deepEqual(h.events.filter(e => !e.startsWith('verify-')), expected);
    assert.deepEqual(h.mutations, []);
  }
});

test('a third field definition or unjournaled final state fails before any mutation', async () => {
  for (const xml of [Buffer.from(active.toString().replace('inactive', 'active')), final]) {
    const h = harness({ xml });
    await assert.rejects(h.run(), /KOREA_BUYER_HISTORY_PRODUCTION_PREIMAGE_CHANGED/u);
    assert.deepEqual(h.events, []);
    assert.deepEqual(h.mutations, []);
  }
});

test('a known correction can reattest the final Salesforce inventory after the original full Production deployment', async () => {
  const checkpoints = [
    { stage: 'production', operation: 'buyer-history-correction', job: { id: correctionId } },
    { stage: 'production', operation: 'deployment', job: { id: deploymentId } },
  ];
  const h = harness({ xml: final, checkpoints });
  const receipts = await h.run();
  assert.equal(receipts.length, 3);
  assert.equal(h.events[0], 'report-deployment');
  assert.ok(h.verifications.filter(v => v.stage === 'production').length >= 2);
  assert.ok(h.verifications.filter(v => v.stage === 'production').every(v => v.mode === 'strict' && v.expected === 'production-final'));
  assert.deepEqual(h.mutations, []);
  const drifted = harness({ xml: active, checkpoints });
  await assert.rejects(drifted.run(), /KOREA_BUYER_HISTORY_PRODUCTION_NOT_CORRECTED/u);
  assert.deepEqual(drifted.mutations, []);
});

test('the strict native postcheck must pass after the field was corrected', async () => {
  const h = harness({ failFinal: true });
  await assert.rejects(h.run(), /unrelated metadata changed/u);
  assert.deepEqual(h.verifications.at(-1), { stage: 'production', mode: 'strict', expected: 'production-bootstrap' });
});

test('a changed Production preimage after both sandbox checks stops the write', async () => {
  const h = harness({ failPrewrite: true });
  await assert.rejects(h.run(), /production changed during QAT/u);
  assert.deepEqual(h.events.slice(-2), ['mirror', 'verify-production']);
  assert.deepEqual(h.mutations, []);
});

test('an unverified correction receipt stops promotion at that sandbox', async () => {
  for (const stage of ['devee', 'qat']) {
    const h = harness({ unverifiedStage: stage });
    await assert.rejects(h.run(), /KOREA_BUYER_HISTORY_CORRECTION_CHECKPOINT_CHANGED/u);
    assert.equal(h.events.at(-1), 'verify-' + stage);
    assert.deepEqual(h.mutations, []);
  }
});
