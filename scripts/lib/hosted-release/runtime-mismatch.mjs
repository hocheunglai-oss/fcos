// Closed, bounded public diagnostics. No raw target, token, response or error text.
import { canonical, digest } from './json-contract.mjs';
const FLAGS = Object.freeze(['VARIABLE_CHARGE_PAIRED_WORKFLOW_ENABLED','FCOS_ENABLE_FCUNO_FEDERATION','FCOS_ENABLE_FCUNO_IDENTITY_SYNC','FCOS_ENABLE_FCUNO_LEGACY_PASSWORD_LOGIN']);
const ACTIONS = Object.freeze(['salesforce_write','google_drive','email_delivery','missing_nom_b_reminders','outlook_calendar','growth_coaching_email','bank_execution','payment_promotion','xero_contact_sync','xero_financial_sync']);
const PROVIDERS = Object.freeze(['supabase','salesforce','xero','drive','fcuno','microsoft','openai']);
const MODES = Object.freeze(['jwt','oauth','service_role','secret_key','api_key','oidc','application','']);
const STATES = Object.freeze(['known','unknown','authenticated','missing','invalid']);
const keys = (v, expected) => v && Object.getPrototypeOf(v) === Object.prototype && Object.keys(v).length === expected.length && expected.every(k => Object.hasOwn(v,k));
const mode = v => MODES.includes(v) ? v : null;
const state = v => STATES.includes(v) ? v : v === undefined ? 'missing' : 'invalid';
const bool = v => typeof v === 'boolean' ? v : null;
function projection(value, expected) {
  return { flags: Object.fromEntries(FLAGS.map(k => [k,{state:state(value?.flags?.[k]?.state),value:bool(value?.flags?.[k]?.value)}])),
    safety: {readOnly:bool(value?.safety?.readOnly),externalActions:Object.fromEntries(ACTIONS.map(k=>[k,bool(value?.safety?.externalActions?.[k])]))},
    auth:Object.fromEntries(PROVIDERS.map(k=>{const a=value?.auth?.[k],e=expected?.auth?.[k];return [k,{state:a===undefined?'missing':state(a.state),mode:mode(a?.mode),targetMatchesExpected:typeof a?.target==='string'&&typeof e?.target==='string'?a.target===e.target:null}];})) };
}
function differences(a,b,p='',out=[]) { for(const k of Object.keys(a)){const x=a[k],y=b[k],key=p?p+'.'+k:k;if(x&&typeof x==='object')differences(x,y,key,out);else if(x!==y)out.push(key);}return out; }
export function runtimeMismatchDetail(expected,runtime,{manifestHash,candidateSha,deploymentId}={}) {
  if(!/^[a-f0-9]{64}$/.test(manifestHash||'')||!/^[a-f0-9]{40}$/.test(candidateSha||'')||!/^dpl_[A-Za-z0-9]{1,128}$/.test(deploymentId||''))return undefined;
  const captured=Date.parse(runtime?.capturedAt);
  const wanted=projection(expected,expected),observed=projection(runtime,expected);
  return {schemaVersion:1,kind:'fcos_preview_runtime_mismatch_v1',manifestHash,candidateSha,deploymentId,
    capturedAt:Number.isFinite(captured)?new Date(captured).toISOString():null,
    expected:wanted,observed,differingFields:differences(wanted,observed),
    expectedProjectionSha256:digest(wanted),observedProjectionSha256:digest(observed)};
}
function validProjection(v){
  if(!keys(v,['flags','safety','auth'])||!keys(v.flags,FLAGS)||!keys(v.safety,['readOnly','externalActions'])||!keys(v.safety.externalActions,ACTIONS)||!keys(v.auth,PROVIDERS))return false;
  return FLAGS.every(k=>keys(v.flags[k],['state','value'])&&STATES.includes(v.flags[k].state)&&(v.flags[k].value===null||typeof v.flags[k].value==='boolean'))
    &&(v.safety.readOnly===null||typeof v.safety.readOnly==='boolean')&&ACTIONS.every(k=>v.safety.externalActions[k]===null||typeof v.safety.externalActions[k]==='boolean')
    &&PROVIDERS.every(k=>keys(v.auth[k],['state','mode','targetMatchesExpected'])&&STATES.includes(v.auth[k].state)&&(v.auth[k].mode===null||MODES.includes(v.auth[k].mode))&&(v.auth[k].targetMatchesExpected===null||typeof v.auth[k].targetMatchesExpected==='boolean'));
}
export function safeRuntimeMismatch(value){
  if(!keys(value,['schemaVersion','kind','manifestHash','candidateSha','deploymentId','capturedAt','expected','observed','differingFields','expectedProjectionSha256','observedProjectionSha256'])||value.schemaVersion!==1||value.kind!=='fcos_preview_runtime_mismatch_v1'
    ||!/^[a-f0-9]{64}$/.test(value.manifestHash||'')||!/^[a-f0-9]{40}$/.test(value.candidateSha||'')||!/^dpl_[A-Za-z0-9]{1,128}$/.test(value.deploymentId||'')
    ||!(value.capturedAt===null||typeof value.capturedAt==='string'&&Number.isFinite(Date.parse(value.capturedAt))&&new Date(Date.parse(value.capturedAt)).toISOString()===value.capturedAt)
    ||!validProjection(value.expected)||!validProjection(value.observed))return undefined;
  const changed=differences(value.expected,value.observed);
  if(canonical(changed)!==canonical(value.differingFields)||digest(value.expected)!==value.expectedProjectionSha256||digest(value.observed)!==value.observedProjectionSha256||Buffer.byteLength(canonical(value))>8192)return undefined;
  return JSON.parse(canonical(value));
}
