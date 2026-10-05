import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRepairApex,
  buildRepairPlan,
  createApprovedPlan,
  repairPlanHash,
  salesforceFailureMessage,
  validateApprovedPlan,
} from '../scripts/repair-non-hong-kong-variable-charges.mjs';

const STEM = 'a0Hfu00000AFjofEAD';
const SUPPLIER = '001fu0000090FjnAAE';
const SOURCE = 'a04fu00000EvDLbAAN';
const ROW = 'a04fu00000U3WriAAF';
const HK_STEM = 'a0Hfu00000AFjogEAD';
const MODIFIED = '2026-09-08T07:04:42.000+0000';
const STEM_MODIFIED = '2026-09-08T07:04:41.000+0000';

function fixture(overrides = {}) {
  const row = {
    Id: ROW,
    STEM__c: STEM,
    STEM__r: {
      Name: 'HK2625402T - TEST - GIBRALTAR',
      Port__c: 'a092x000001a1WbAAI',
      LastModifiedDate: STEM_MODIFIED,
      Port__r: { Name: 'GIBRALTAR', Country__c: 'GIBRALTAR' },
    },
    Supplier__c: SUPPLIER,
    Product2Id__c: '01t2x000000iylhAAA',
    Product2Id__r: { Name: 'AGENCY FEE' },
    CreatedDate: MODIFIED,
    LastModifiedDate: MODIFIED,
    Cancelled__c: false,
    Hong_Kong_Bundle_Managed__c: true,
    Hong_Kong_Bundle_Source__c: SOURCE,
    Hong_Kong_Bundle_Key__c: `HKBC|${STEM}|${SUPPLIER}|AGENCY_FEE`,
    Hong_Kong_Bundle_Source__r: {
      STEM__c: STEM,
      Supplier__c: SUPPLIER,
      Product2Id__r: { Name: 'BASIC CALLING COST' },
      Cancelled__c: false,
      LastModifiedDate: '2026-09-08T07:04:40.000+0000',
    },
    Buyer_Invoice__c: null,
    Supplier_Invoice__c: null,
    Fixed__c: true,
    Quantity__c: 1,
    Unit_Cost__c: null,
    Lumpsum_Cost__c: null,
    Line_Total_Buy__c: 0,
    Unit_Price__c: null,
    Lumpsum_Price__c: 0,
    Line_Total__c: 0,
    Supplier_Cost_Input_Currency__c: 'USD',
    Supplier_Cost_Input_Value__c: null,
    Supplier_Cost_USD_HKD_Rate__c: null,
    Supplier_Cost_FX_Settings_Revision__c: null,
  };
  return { ...row, ...overrides };
}

test('mixed-port audit selects only safe outside-Hong-Kong managed rows', () => {
  const outside = fixture({
    Supplier_Cost_Input_Currency__c: 'HKD',
    Supplier_Cost_Input_Value__c: 58,
  });
  const hongKong = fixture({
    Id: 'a04fu00000U3WrjAAF',
    STEM__c: HK_STEM,
    Hong_Kong_Bundle_Source__c: 'a04fu00000EvDLcAAN',
    Hong_Kong_Bundle_Key__c: `HKBC|${HK_STEM}|${SUPPLIER}|LIGHT_DUES`,
    Hong_Kong_Bundle_Source__r: {
      ...outside.Hong_Kong_Bundle_Source__r,
      STEM__c: HK_STEM,
    },
    STEM__r: {
      ...outside.STEM__r,
      Port__c: 'a092x000001a1WcAAI',
      Port__r: { Name: 'Hong Kong', Country__c: 'HK' },
    },
  });
  const plan = buildRepairPlan([hongKong, outside]);

  assert.equal(plan.blockers.length, 0);
  assert.deepEqual(plan.candidates.map(({ id }) => id), [ROW]);
  assert.equal(plan.candidates[0].financial.Supplier_Cost_Input_Value__c, 58);
  assert.deepEqual(plan.ignored, [{ rowId: hongKong.Id, reason: 'hong_kong_port' }]);
});

test('NFKC-normalized port name HK is treated as Hong Kong', () => {
  const row = fixture({
    STEM__r: {
      ...fixture().STEM__r,
      Port__r: { Name: ' ＨＫ ', Country__c: 'China' },
    },
  });
  const plan = buildRepairPlan([row]);

  assert.equal(plan.candidates.length, 0);
  assert.equal(plan.blockers.length, 0);
  assert.deepEqual(plan.ignored, [{ rowId: ROW, reason: 'hong_kong_port' }]);
});

test('manual, invoiced, nonzero, and unknown-port exceptions fail closed', () => {
  const manual = fixture({
    Id: 'a04fu00000U3WrjAAF',
    Hong_Kong_Bundle_Managed__c: false,
  });
  const invoiced = fixture({ Id: 'a04fu00000U3WrkAAF', Buyer_Invoice__c: 'a1Ifu0000000001AAA' });
  const nonzero = fixture({
    Id: 'a04fu00000U3WrlAAF',
    Hong_Kong_Bundle_Key__c: `HKBC|${STEM}|${SUPPLIER}|LIGHT_DUES`,
    Lumpsum_Cost__c: 1,
  });
  const unknown = fixture({
    Id: 'a04fu00000U3WrmAAF',
    Hong_Kong_Bundle_Key__c: `HKBC|${STEM}|${SUPPLIER}|ANCHORAGE_DUES`,
    STEM__r: { ...fixture().STEM__r, Port__c: null, Port__r: null },
  });
  const ordinaryManual = fixture({
    Id: 'a04fu00000U3WrnAAF',
    Hong_Kong_Bundle_Managed__c: false,
    Hong_Kong_Bundle_Key__c: null,
    Supplier_Cost_Input_Currency__c: 'USD',
  });
  const nonManagedHkd = fixture({
    Id: 'a04fu00000U3WroAAF',
    Hong_Kong_Bundle_Managed__c: false,
    Hong_Kong_Bundle_Key__c: null,
    Supplier_Cost_Input_Currency__c: 'HKD',
  });
  const plan = buildRepairPlan([manual, invoiced, nonzero, unknown, ordinaryManual, nonManagedHkd]);

  assert.equal(plan.candidates.length, 0);
  assert.deepEqual(
    plan.blockers.map(({ code }) => code).sort(),
    ['INVOICED_MANAGED_ROW', 'NONZERO_FINANCIAL_ROW', 'NON_MANAGED_BUNDLE_KEY', 'NON_MANAGED_HKD_ROW', 'UNKNOWN_PORT'].sort(),
  );
  assert.deepEqual(plan.ignored, [{ rowId: ordinaryManual.Id, reason: 'not_managed' }]);
});

test('cancelled managed rows make the repair idempotent', () => {
  const plan = buildRepairPlan([fixture({ Cancelled__c: true })]);
  assert.equal(plan.candidates.length, 0);
  assert.equal(plan.blockers.length, 0);
  assert.deepEqual(plan.ignored, [{ rowId: ROW, reason: 'already_cancelled' }]);
});

test('duplicate active managed keys fail closed instead of choosing a row', () => {
  const duplicate = fixture({ Id: 'a04fu00000U3WrjAAF' });
  const plan = buildRepairPlan([fixture(), duplicate]);
  assert.equal(plan.candidates.length, 2);
  assert.deepEqual(plan.blockers, [{
    code: 'DUPLICATE_ACTIVE_BUNDLE_KEY',
    bundleKey: `HKBC|${STEM}|${SUPPLIER}|AGENCY_FEE`,
    rowIds: [ROW, duplicate.Id].sort(),
  }]);
});

test('invalid key or Basic Calling Cost source cannot enter the repair', () => {
  const wrongKey = fixture({ Hong_Kong_Bundle_Key__c: `HKBC|${STEM}|001fu0000090BadAAE|AGENCY_FEE` });
  const wrongSource = fixture({
    Id: 'a04fu00000U3WrjAAF',
    Hong_Kong_Bundle_Source__r: { ...fixture().Hong_Kong_Bundle_Source__r, Product2Id__r: { Name: 'OTHER' } },
  });
  const plan = buildRepairPlan([wrongKey, wrongSource]);
  assert.deepEqual(plan.blockers.map(({ code }) => code).sort(), ['BUNDLE_KEY_MISMATCH', 'SOURCE_BASIC_INVALID']);
});

test('approved plan validation rejects forged contents and stale live timestamps', () => {
  const dryPlan = buildRepairPlan([fixture()]);
  const approved = createApprovedPlan(dryPlan, { generatedAt: '2026-09-11T00:00:00.000Z' });
  assert.equal(validateApprovedPlan({
    approvedPlan: approved,
    approvedHash: approved.planHash,
    livePlan: buildRepairPlan([fixture()]),
  }), true);

  const forged = structuredClone(approved);
  forged.candidates[0].financial.Line_Total__c = 99;
  assert.throws(() => validateApprovedPlan({
    approvedPlan: forged,
    approvedHash: approved.planHash,
    livePlan: dryPlan,
  }), /hash does not match/);

  const staleLive = buildRepairPlan([fixture({ LastModifiedDate: '2026-09-08T07:05:42.000+0000' })]);
  assert.throws(() => validateApprovedPlan({
    approvedPlan: approved,
    approvedHash: approved.planHash,
    livePlan: staleLive,
  }), /stale/);
  assert.equal(repairPlanHash(approved), approved.planHash);
});

test('atomic Apex locks exact records, makes a sparse cancellation, and invalidates without deleting', () => {
  const apex = buildRepairApex(createApprovedPlan(buildRepairPlan([fixture()])));
  assert.match(apex, /FOR UPDATE/);
  assert.match(apex, /FROM Port__c WHERE Id IN :expectedPortIds FOR UPDATE/);
  assert.match(apex, /port\.Name != expectedPortNames\.get\(port\.Id\)/);
  assert.match(apex, /port\.Country__c != expectedPortCountries\.get\(port\.Id\)/);
  assert.match(apex, /String\.valueOf\(stem\.Port__c\) != expectedStemPorts\.get\(stem\.Id\)/);
  assert.match(apex, /REPAIR_STEM_PORT_CHANGED/);
  assert.match(apex, /LastModifiedDate != expectedRowModified/);
  assert.match(apex, /ContextManager\.skipTriggers = true/);
  assert.match(apex, /new STEM_Extra_Cost__c\(Id = row\.Id, Cancelled__c = true\)/);
  assert.match(apex, /invalidateForExtraCostChanges\(null, lockedRows\)/);
  assert.doesNotMatch(apex, /\bdelete\b/i);
  assert.doesNotMatch(apex, /Verified|Approved/);
});

test('atomic Apex preserves timestamp milliseconds in live predicates', () => {
  const row = fixture({
    LastModifiedDate: '2026-09-08T07:04:42.123+0000',
    STEM__r: { ...fixture().STEM__r, LastModifiedDate: '2026-09-08T07:04:41.456+0000' },
    Hong_Kong_Bundle_Source__r: {
      ...fixture().Hong_Kong_Bundle_Source__r,
      LastModifiedDate: '2026-09-08T07:04:40.789+0000',
    },
  });
  const apex = buildRepairApex(createApprovedPlan(buildRepairPlan([row])));

  assert.match(apex, /JSON\.deserialize\('"2026-09-08T07:04:42\.123Z"', Datetime\.class\)/);
  assert.match(apex, /JSON\.deserialize\('"2026-09-08T07:04:41\.456Z"', Datetime\.class\)/);
  assert.match(apex, /JSON\.deserialize\('"2026-09-08T07:04:40\.789Z"', Datetime\.class\)/);
  assert.doesNotMatch(apex, /valueOfGmt/);
});

test('Salesforce failures expose bounded compile detail while redacting secrets and URLs', () => {
  const message = salesforceFailureMessage({
    name: 'ApexExecution',
    message: 'ignored outer message',
    result: {
      compiledSuccess: false,
      success: false,
      line: 17,
      column: 9,
      compileProblem: 'Unexpected token near Bearer abcdefghijklmnopqrstuvwxyz0123456789 at https://example.my.salesforce.com/path',
      log: 'access_token=must-never-appear',
    },
  });

  assert.match(message, /\[APEXEXECUTION\]/);
  assert.match(message, /compiledSuccess=false/);
  assert.match(message, /line=17/);
  assert.match(message, /Unexpected token/);
  assert.match(message, /Bearer \[redacted\]/);
  assert.match(message, /\[url\]/);
  assert.doesNotMatch(message, /abcdefghijklmnopqrstuvwxyz0123456789/);
  assert.doesNotMatch(message, /must-never-appear/);
});
