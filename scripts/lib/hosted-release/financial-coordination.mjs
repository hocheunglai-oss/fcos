import { createHash } from 'node:crypto';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const need=(v,code)=>{if(!v)fail(code);};
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?`[${v.map(canonical).join(',')}]`:`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
const digest=v=>createHash('sha256').update(canonical(v)).digest('hex');
/** Serialization adapter only. The existing financial owner executes and authorizes every write. */
export function createFinancialCoordinationBridge({coordinator,epoch,ownerId,existingOwnerThreadId,businessScopeSha256,legacyLockScopeSha256,recheckExistingAuthority,recheckExistingLocks}) {
  need(coordinator&&Number.isSafeInteger(epoch)&&epoch>0&&typeof ownerId==='string'&&ownerId
    &&typeof existingOwnerThreadId==='string'&&existingOwnerThreadId&&hash(businessScopeSha256)&&hash(legacyLockScopeSha256)
    &&typeof recheckExistingAuthority==='function'&&typeof recheckExistingLocks==='function','FINANCIAL_BRIDGE_CONFIGURATION_REQUIRED');
  const bindings=new Map();
  const binding=input=>{
    need(input&&hash(input.businessApprovalFingerprint)&&hash(input.requestFingerprint)&&hash(input.legacyLockFingerprint)
      &&/^[a-z][a-z0-9_]{1,60}$/.test(input.action)&&!/(dispatch|message|send)/.test(input.action)
      &&/^[a-zA-Z0-9._:-]{1,200}$/.test(input.operationId),'FINANCIAL_BRIDGE_BOUND_SCOPE_REQUIRED');
    const identity={epoch,ownerId,existingOwnerThreadId,businessScopeSha256,legacyLockScopeSha256,
      businessApprovalFingerprint:input.businessApprovalFingerprint,legacyLockFingerprint:input.legacyLockFingerprint,
      requestFingerprint:input.requestFingerprint,action:input.action,operationId:input.operationId};
    const manifest={schemaVersion:1,epoch,executionMode:'financial',...identity,coordinationOnly:true,providerAuthorityGranted:false,missionDispatchAuthorized:false};
    return {...identity,manifest,manifestHash:digest(manifest),releaseId:`financial-${digest(identity).slice(0,48)}`,phase:`financial.${input.action}`};
  };
  const recheck=async b=>{
    const authority=await recheckExistingAuthority(b),locks=await recheckExistingLocks(b);
    need(authority?.existingOwnerThreadId===existingOwnerThreadId&&authority.businessScopeSha256===businessScopeSha256
      &&authority.businessApprovalFingerprint===b.businessApprovalFingerprint&&authority.requestFingerprint===b.requestFingerprint,
      'FINANCIAL_EXISTING_APPROVAL_REQUIRED');
    need(locks?.existingOwnerThreadId===existingOwnerThreadId&&locks.legacyLockScopeSha256===legacyLockScopeSha256
      &&locks.legacyLockFingerprint===b.legacyLockFingerprint&&locks.held===true,'FINANCIAL_EXISTING_LOCKS_REQUIRED');
  };
  const retrieve=input=>{const b=binding(input),old=bindings.get(input.operationId);need(old&&old.manifestHash===b.manifestHash,'FINANCIAL_ORIGINAL_BINDING_REQUIRED');return b;};
  const result=value=>({...value,coordinationOnly:true,providerAuthorityGranted:false,missionDispatchAuthorized:false});
  return Object.freeze({
    async begin(input){const b=binding(input),old=bindings.get(input.operationId);need(!old||old.manifestHash===b.manifestHash,'FINANCIAL_ORIGINAL_BINDING_REQUIRED');
      await recheck(b);await coordinator.register({releaseId:b.releaseId,manifestHash:b.manifestHash,manifest:b.manifest});bindings.set(input.operationId,b);
      return result(await coordinator.begin({releaseId:b.releaseId,manifestHash:b.manifestHash,phase:b.phase,operationId:b.operationId,requestHash:b.requestFingerprint}));},
    async uncertain(input,evidence={outcome:'unknown'}){const b=retrieve(input);return result(await coordinator.uncertain({releaseId:b.releaseId,manifestHash:b.manifestHash,phase:b.phase,operationId:b.operationId,evidence}));},
    async complete(input,evidence){const b=retrieve(input);need(['applied','not_applied'].includes(evidence?.outcome),'FINANCIAL_DEFINITIVE_READBACK_REQUIRED');
      return result(await coordinator.complete({releaseId:b.releaseId,manifestHash:b.manifestHash,phase:b.phase,operationId:b.operationId,evidence}));},
    async recover(input,evidence){const b=binding(input);need(['applied','not_applied','unknown'].includes(evidence?.outcome),'FINANCIAL_READBACK_REQUIRED');
      // Durable bindings survive runner-local memory loss; endpoint validates the original manifest and intent.
      bindings.set(input.operationId,b);return result(await coordinator.readback({releaseId:b.releaseId,manifestHash:b.manifestHash,phase:b.phase,operationId:b.operationId,evidence}));},
    async snapshot(input){const b=binding(input);return coordinator.snapshot({releaseId:b.releaseId,manifestHash:b.manifestHash});},
  });
}
