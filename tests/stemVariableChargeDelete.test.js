import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const repositoryFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('guarded STEM delete warns about and transactionally removes linked Variable Charge suppliers', async () => {
  const [relationship, trigger, handler, stemObject, page, controller, controllerTest, permissionSet] = await Promise.all([
    repositoryFile('force-app/main/default/objects/STEM_Variable_Charge_Supplier__c/fields/STEM__c.field-meta.xml'),
    repositoryFile('force-app/main/default/triggers/StemTrigger.trigger'),
    repositoryFile('force-app/main/default/classes/StemTriggerHandler.cls'),
    repositoryFile('force-app/main/default/objects/STEM__c/STEM__c.object-meta.xml'),
    repositoryFile('force-app/main/default/pages/StemDeleteConfirm.page'),
    repositoryFile('force-app/main/default/classes/StemDeleteConfirmController.cls'),
    repositoryFile('force-app/main/default/classes/StemDeleteConfirmControllerTest.cls'),
    repositoryFile('force-app/main/default/permissionsets/FCOS_Variable_Charges_User.permissionset-meta.xml'),
  ]);

  assert.match(relationship, /<deleteConstraint>Restrict<\/deleteConstraint>/);
  assert.match(trigger, /deleteVariableChargeSuppliers\(Trigger\.oldMap\)/);
  assert.match(handler, /delete \[\s*SELECT Id\s*FROM STEM_Variable_Charge_Supplier__c\s*WHERE STEM__c IN: stemMap\.keySet\(\)/);
  assert.equal((stemObject.match(/<actionName>Delete<\/actionName>[\s\S]*?<content>StemDeleteConfirm<\/content>[\s\S]*?<type>Visualforce<\/type>/g) || []).length, 1);
  assert.match(page, /standardController="STEM__c" extensions="StemDeleteConfirmController"/);
  assert.match(page, /Any associated STEM Variable Charge supplier records listed below will be permanently deleted too/);
  assert.match(page, /value="\{!variableChargeSuppliers\}"/);
  assert.match(page, /value="Delete STEM and Variable Charges" action="\{!deleteStemAndVariableCharges\}"/);
  assert.match(controller, /Savepoint deleteSavepoint = Database\.setSavepoint\(\)/);
  assert.match(controller, /Database\.rollback\(deleteSavepoint\)/);
  assert.match(controller, /if \(!linkedVariableCharges\.isEmpty\(\)\) delete linkedVariableCharges;[\s\S]*delete lockedStem;/);
  assert.match(controllerTest, /rollsBackBothRecordsAndShowsTheFailure/);
  assert.match(permissionSet, /<apexClass>StemDeleteConfirmController<\/apexClass><enabled>true<\/enabled>/);
  assert.match(permissionSet, /<apexPage>StemDeleteConfirm<\/apexPage><enabled>true<\/enabled>/);
});
