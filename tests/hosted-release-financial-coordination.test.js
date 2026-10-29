import test from 'node:test';
import assert from 'node:assert/strict';
import { createFinancialCoordinationBridge } from '../scripts/lib/hosted-release/financial-coordination.mjs';
const H='a'.repeat(64),J='b'.repeat(64),input={action:'link_only',operationId:'original-finance-operation',businessApprovalFingerprint:H,requestFingerprint:H,legacyLockFingerprint:J};
function fixture(){const calls=[],states=new Map();let authority=true,locked=true;
 const coordinator={async register(p){calls.push(['register',p]);},async begin(p){calls.push(['begin',p]);const old=states.get(p.operationId);if(old)return{disposition:old,evidence:{outcome:old==='complete'?'applied':'unknown'}};states.set(p.operationId,'readback');return{disposition:'execute'};},
 async uncertain(p){calls.push(['uncertain',p]);return{disposition:'readback'};},async complete(p){calls.push(['complete',p]);states.set(p.operationId,'complete');return{disposition:'complete'};},async readback(p){calls.push(['readback',p]);return{disposition:p.evidence.outcome==='unknown'?'readback':'complete'};},async snapshot(p){return p;}};
 const config={coordinator,epoch:2,ownerId:'existing-financial-owner',existingOwnerThreadId:'sole-original-owner',businessScopeSha256:H,legacyLockScopeSha256:J,
 recheckExistingAuthority:async b=>authority?{existingOwnerThreadId:b.existingOwnerThreadId,businessScopeSha256:H,businessApprovalFingerprint:b.businessApprovalFingerprint,requestFingerprint:b.requestFingerprint}:null,
 recheckExistingLocks:async b=>({existingOwnerThreadId:b.existingOwnerThreadId,legacyLockScopeSha256:J,legacyLockFingerprint:b.legacyLockFingerprint,held:locked})};
 return{config,coordinator,calls,bridge:createFinancialCoordinationBridge(config),setAuthority:v=>{authority=v;},setLocked:v=>{locked=v;}};
}
test('bridge preserves original approval and lock fingerprints and grants serialization only',async()=>{const f=fixture();const first=await f.bridge.begin(input);assert.equal(first.disposition,'execute');assert.equal(first.providerAuthorityGranted,false);assert.equal(first.missionDispatchAuthorized,false);
 const manifest=f.calls[0][1].manifest;assert.equal(manifest.existingOwnerThreadId,'sole-original-owner');assert.equal(manifest.businessApprovalFingerprint,H);assert.equal(manifest.legacyLockScopeSha256,J);
 assert.equal((await f.bridge.begin(input)).disposition,'readback');await f.bridge.uncertain(input);await f.bridge.complete(input,{outcome:'applied',result:{providerId:'original'}});assert.equal((await f.bridge.begin(input)).disposition,'complete');
 assert.equal(Object.hasOwn(f.bridge,'submit'),false);assert.equal(Object.hasOwn(f.bridge,'dispatch'),false);
});
test('approval/locks fail before remote intent, and changed scope or messaging cannot acquire authority',async()=>{const f=fixture();f.setAuthority(false);await assert.rejects(f.bridge.begin(input),/EXISTING_APPROVAL_REQUIRED/);assert.equal(f.calls.length,0);f.setAuthority(true);f.setLocked(false);await assert.rejects(f.bridge.begin(input),/EXISTING_LOCKS_REQUIRED/);assert.equal(f.calls.length,0);
 f.setLocked(true);await f.bridge.begin(input);await assert.rejects(f.bridge.begin({...input,requestFingerprint:J}),/ORIGINAL_BINDING_REQUIRED/);await assert.rejects(f.bridge.begin({...input,action:'mission_dispatch'}),/BOUND_SCOPE_REQUIRED/);
});
test('a restarted owner may perform original GET-only readback while approval is unavailable',async()=>{const f=fixture();await f.bridge.begin(input);f.setAuthority(false);f.setLocked(false);const recovered=createFinancialCoordinationBridge(f.config);
 const result=await recovered.recover(input,{outcome:'unknown'});assert.equal(result.disposition,'readback');assert.equal(result.providerAuthorityGranted,false);assert.equal(f.calls.at(-1)[0],'readback');
});
