import assert from 'node:assert/strict';
import test from 'node:test';
import { variableChargeInternals } from '../api/_variableCharges.js';
test('closed paired cases disclose incomplete reviews without claiming an active waiting task', () => {
  const row = { pairedWorkflowEnabled: true, status: 'completed', supplierRequirements: [{supplierId:'supplier-1', sides:{cost:{status:'pending',currentAssignee:{name:'Trader'},permissions:{}},buyerCharge:{status:'pending',permissions:{}}}}] };
  const result=variableChargeInternals.plainLanguageWorkflow(row);
  assert.equal(result.simplifiedQueue,'completed');
  assert.equal(result.nextAction,'Closed; paired reviews incomplete');
  assert.equal(result.isMyTask,false);
  assert.equal(row.status,'completed');
  row.supplierRequirements[0].sides.cost.permissions.canConfirm=true;
  assert.equal(variableChargeInternals.plainLanguageWorkflow(row).simplifiedQueue,'my_tasks');
  assert.match(variableChargeInternals.plainLanguageWorkflow(row).nextAction,/Confirm/);
});
