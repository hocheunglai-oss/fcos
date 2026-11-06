import test from 'node:test';
import assert from 'node:assert/strict';
import { parseModuleInventory, readCandidateModuleInventory } from '../scripts/lib/rapid-release/modules.mjs';
import { selectChecks } from '../scripts/lib/rapid-release/contract.mjs';
test('module extraction reads literal candidate data without evaluating module code',()=>{
 const source="globalThis.shouldNeverExecute=true; export const APP_MODULES=[{id:'dashboard',path:'/',label:'Dashboard',sortOrder:10},{id:'new_module',path:'/new',label:'New'}]";
 assert.deepEqual(parseModuleInventory(source),[{id:'dashboard',path:'/'},{id:'new_module',path:'/new'}]);
 assert.equal(globalThis.shouldNeverExecute,undefined);
 for(const source of ["export const APP_MODULES=(()=>{globalThis.pwned=true;return []})()", "export const APP_MODULES=[{id:'dashboard',path:getPath()}]", "export const APP_MODULES=[...other]", "export const APP_MODULES=[{id:'dashboard',path:'//foreign.example'}]", "export const APP_MODULES=[{id:'dashboard',path:'/'},{id:'dashboard',path:'/other'}]"])
  assert.throws(()=>parseModuleInventory(source),/CANDIDATE_MODULE_INVENTORY_UNCLASSIFIED/);
 assert.equal(globalThis.pwned,undefined);
});
test('shared, authorization, Salesforce and unknown changes require every actual candidate module',()=>{
 const inventory=[{id:'dashboard',path:'/'},{id:'markets',path:'/markets'},{id:'new_module',path:'/new'}];
 for(const path of ['api/_auth.js','src/lib/AuthContext.jsx','force-app/main/default/classes/Example.cls','unknown/feature.js']){
  const selected=selectChecks([path],inventory);
  assert.equal(selected.normalRole,true);assert.deepEqual(selected.modules,inventory.map(item=>item.id).sort());
 }
});
test('scoped frontend modules require normal-role coverage and map shared collection surfaces to both modules',()=>{
 assert.equal(selectChecks(['src/components/invoices/InvoiceTable.jsx']).normalRole,true);
 assert.deepEqual(selectChecks(['src/pages/PaymentCollections.jsx']).modules,['buyer_invoices','incoming_payments']);
 const dashboard=selectChecks(['src/components/dashboard/Table.jsx']);assert.equal(dashboard.normalRole,false);assert.deepEqual(dashboard.modules,['dashboard']);
});
test('the actual candidate registry is complete and deterministically ordered',()=>{
 const actual=readCandidateModuleInventory(process.cwd());
 assert.ok(actual.length>=15);assert.ok(actual.some(item=>item.id==='admin'));assert.deepEqual(actual.map(item=>item.id),actual.map(item=>item.id).sort());
});
