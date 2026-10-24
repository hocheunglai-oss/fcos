// Operator preparation only. No provider, authentication, refresh, SQL execution or resource timer.
import {readFileSync,realpathSync,lstatSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {canonical,digest,ReleaseError} from './json-contract.mjs';
import {fcosConnectionIdentifier} from '../../../config/fcosConnections.js';
export const QUALIFICATION_XERO_METADATA_QUERY = `select jsonb_build_object('kind','actual_release_verification_connection_metadata_only_v1','observedAt',clock_timestamp(),'database',current_database(),'currentUser',current_user,'sessionUser',session_user,'roleSetting',current_setting('role',true),'connectionId',id,'tenantId',tenant_id,'expiresAt',expires_at,'accessTokenPresent',coalesce(length(access_token)>0,false),'freshMoreThan90Seconds',expires_at>clock_timestamp()+interval '90 seconds') as result from public.xero_contact_sync_connections where id='primary' and current_database()='postgres' and current_user='postgres' and session_user='postgres' and current_setting('role',true)='none';\n`;
const need=(v,code='QUALIFICATION_CONNECTION_METADATA_INVALID')=>{if(!v)throw new ReleaseError(code,'qualification.connection_preflight','Keep all new qualification resources uncreated. Renew the existing connection only through a new independently admitted ordinary renewal; completed recovery and the consumed Organisations grant stay closed. This diagnostic grants no refresh or retry.');};
const same=(a,b)=>canonical(a)===canonical(b);
const timestamp=v=>typeof v==='string'&&/T.*(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v));
const exact=(v,ks)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).length===ks.length&&ks.every(k=>Object.hasOwn(v,k));
function read(r){need(exact(r,['path','sha256'])&&isAbsolute(r.path)&&realpathSync(r.path)===r.path&&lstatSync(r.path).isFile()&&/^[a-f0-9]{64}$/.test(r.sha256));const b=readFileSync(r.path);need(b.length<=524288&&digest(b)===r.sha256,'QUALIFICATION_CONNECTION_METADATA_REF_CHANGED');return JSON.parse(b);}
export function metadataFromToolRecord(record){
  let x=record.result;
  if(x?.content){need(x.isError!==true&&Array.isArray(x.content)&&x.content.length===1&&x.content[0].type==='text');x=JSON.parse(x.content[0].text);}
  if(x&&typeof x==='object'&&!Array.isArray(x)&&typeof x.result==='string')x=x.result;
  if(typeof x==='string'){
    const match=/<untrusted-data-([a-f0-9-]+)>\s*(\[[\s\S]*?\])\s*<\/untrusted-data-\1>/.exec(x);need(match);const text=match[2].trim().replace(/^\\n(?:\\n)?/,'').replace(/(?:\\n)+$/,'');
    try{x=JSON.parse(text);}catch{try{x=JSON.parse(JSON.parse('"'+text+'"'));}catch{need(false);}}
  }
  need(Array.isArray(x)&&x.length===1&&exact(x[0],['result']));return x[0].result;
}
export function assertStoredXeroSessionFresh(metadata,{tenantId,now=Date.now()}={}){
  need(Number.isFinite(now)&&metadata?.kind==='actual_release_verification_connection_metadata_only_v1'&&metadata.currentUser==='postgres'&&metadata.sessionUser==='postgres'&&metadata.roleSetting==='none'&&metadata.tenantId===tenantId&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(tenantId||'')&&timestamp(metadata.observedAt)&&timestamp(metadata.expiresAt));
  const captured=Date.parse(metadata.observedAt),expires=Date.parse(metadata.expiresAt);
  need(captured<=now&&now-captured<=90000&&metadata.accessTokenPresent===true&&metadata.freshMoreThan90Seconds===true&&expires>captured+90000&&expires>now+90000,'EXPIRED_SESSION_WAITING_AUTH_RENEWAL');
  return {capturedAt:metadata.observedAt,sessionExpiresAt:metadata.expiresAt,eligibleUntil:new Date(Math.min(captured+90000,expires-90000)).toISOString(),necessaryEligibilityOnly:true,authenticationProven:false};
}
export function assertQualificationConnectionReadiness(input,{now=Date.now()}={}){
  need(exact(input,['manifest','metadata','toolRecord','rootAcceptance']));
  const manifest=read(input.manifest),metadata=read(input.metadata),tool=read(input.toolRecord),acceptance=read(input.rootAcceptance);
  need(manifest.executionMode==='qualification'&&manifest.stage==='qualification'&&manifest.scope?.financialAuthority===false&&/^[a-f0-9]{40}$/.test(manifest.controller?.sha||'')&&/^[a-f0-9]{40}$/.test(manifest.candidate?.sha||'')&&/^[a-f0-9]{40}$/.test(manifest.qualificationSource?.bootstrapSha||''));
  const tenantId=manifest.runtime?.expectedPreview?.auth?.xero?.target;
  need(tool?.projectId===fcosConnectionIdentifier('supabase','Project ref')&&tool?.query===QUALIFICATION_XERO_METADATA_QUERY&&same(metadataFromToolRecord(tool),metadata)&&exact(metadata,['kind','observedAt','database','currentUser','sessionUser','roleSetting','connectionId','tenantId','expiresAt','accessTokenPresent','freshMoreThan90Seconds'])&&metadata.database==='postgres'&&metadata.connectionId==='primary');
  need(acceptance?.kind==='root_actual_qualification_connection_metadata_acceptance_v1'&&acceptance.accepted===true&&acceptance.reviewerId==='/root'&&acceptance.projectRef===fcosConnectionIdentifier('supabase','Project ref')&&acceptance.manifestHash===digest(manifest)&&same(acceptance.metadata,input.metadata)&&same(acceptance.toolRecord,input.toolRecord)&&acceptance.querySha256===digest(QUALIFICATION_XERO_METADATA_QUERY)&&acceptance.readOnly===true&&acceptance.metadataOnly===true&&acceptance.noProviderAuthOrRefresh===true&&timestamp(acceptance.reviewedAt)&&Date.parse(acceptance.reviewedAt)>=Date.parse(metadata.observedAt)&&Date.parse(acceptance.reviewedAt)<=now,'GENUINE_CURRENT_OPERATOR_METADATA_ACCEPTANCE_REQUIRED');
  return {kind:'qualification_resource_connection_eligibility_v1',manifestHash:digest(manifest),controllerSha:manifest.controller.sha,candidateSha:manifest.candidate.sha,callerSha:manifest.qualificationSource.bootstrapSha,metadata:input.metadata,rootAcceptance:input.rootAcceptance,...assertStoredXeroSessionFresh(metadata,{tenantId,now}),providerCalls:0,credentialValuesReadByPreparer:false,financialAuthorityGranted:false,productionAuthorityGranted:false};
}

/** Integrate only into a NEW operator materializer, before any resource callback. */
export function withQualificationConnectionPreflight(materializeNewCycle){
  if(typeof materializeNewCycle!=='function')throw Error('EXPLICIT_LOCAL_MATERIALIZER_REQUIRED');
  return async function prepare({connectionPreflight,cycleInput},{now=Date.now()}={}){
    const eligibility=assertQualificationConnectionReadiness(connectionPreflight,{now});
    need(same(cycleInput?.manifest,connectionPreflight.manifest),'QUALIFICATION_CONNECTION_CYCLE_BINDING_MISMATCH');
    return {eligibility,preparation:await materializeNewCycle(cycleInput,eligibility),executionAuthorityGranted:false};
  };
}
