import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import handler from '../api/functions/[name].js';
import {registeredHandlerBehavior} from '../api/_handlerPolicyRegistry.js';
import {deploymentCapabilities} from '../api/_deploymentReadOnly.js';
import {serverSupabaseConfig} from '../api/_supabaseConfig.js';
import {requireReadOnlyCiOperation} from '../api/_readOnlyCiAccess.js';
import {FCOS_READ_ONLY_CI} from '../config/fcosCiIdentity.js';
const selectedFinancialHandlers=['xeroExistingDraftAuthorisationApprovedScope','xeroExistingDraftAuthorisationPreview','xeroExistingDraftAuthorisationRead','xeroExistingDraftAuthorisationApply','xeroExistingDraftAuthorisationRecover','xeroSupplierFinancialBucketPreview','xeroSupplierFinancialBucketRead','xeroSupplierFinancialBucketApply'];
test('composed real dispatcher resolves all dedicated financial routes but denies anonymous callers before provider access',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;assert.fail('No provider request before authentication');};
 try {for(const name of selectedFinancialHandlers){let body;const res={statusCode:200,setHeader(){},end(raw){body=JSON.parse(raw);}};await handler({url:'/api/functions/'+name,method:'POST',headers:{},body:{}},res);assert.equal(res.statusCode,401,name);assert.notEqual(body.code,'HANDLER_ACCESS_POLICY_MISSING');const p=registeredHandlerBehavior(name);assert.equal(p.capability,'xero_portal_manage');assert.equal(p.cache,'none');}assert.equal(calls,0);}finally{globalThis.fetch=original;}
});
test('preserved Nom B cron cannot execute from Preview or explicit verification deployment',async()=>{
 const before={VERCEL_ENV:process.env.VERCEL_ENV,FCOS_ENABLE_READ_ONLY_CI:process.env.FCOS_ENABLE_READ_ONLY_CI};const fetch=globalThis.fetch;globalThis.fetch=async()=>assert.fail('No provider access');
 try{for(const env of [{VERCEL_ENV:'preview'},{VERCEL_ENV:'production',FCOS_ENABLE_READ_ONLY_CI:'true'}]){for(const k of Object.keys(before)){if(env[k]===undefined)delete process.env[k];else process.env[k]=env[k];}let payload;const res={statusCode:200,setHeader(){},end(raw){payload=JSON.parse(raw);}};await handler({url:'/api/functions/missingNomBReminderCron',headers:{},method:'POST',body:{}},res);assert.equal(res.statusCode,403);assert.equal(payload.code,'FCOS_DEPLOYMENT_READ_ONLY');}}finally{globalThis.fetch=fetch;for(const[k,v]of Object.entries(before)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
test('application config preserves all eleven actual Production source schedules and disabled branch pins',async()=>{
 const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url)));assert.deepEqual(config.crons,PRODUCTION_CRONS);assert.equal(config.crons.length,11);assert.equal(config.git.deploymentEnabled.main,false);assert.ok(Object.values(config.git.deploymentEnabled).every(v=>v===false));
});
test('new financial surface retains canonical database target and independently restricted deployment authority',()=>{
 assert.equal(serverSupabaseConfig({SUPABASE_URL:'https://foreign.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'SYNTHETIC'}).configured,false);
 for(const env of [{VERCEL_ENV:'preview'},{VERCEL_ENV:'production',FCOS_ENABLE_READ_ONLY_CI:'true'}])assert.equal(deploymentCapabilities(env).mutationsAllowed,false);
 assert.equal(deploymentCapabilities({VERCEL_ENV:'production'},{readOnlyProfile:true}).mutationsAllowed,false);
});
const PRODUCTION_CRONS=[{"path":"/api/functions/missingNomBReminderCron","schedule":"*/5 * * * *"},{"path":"/api/functions/outstandingBuyerInvoicesEmailCron","schedule":"0 0 * * 1-5"},{"path":"/api/functions/outstandingBuyerInvoicesEmailCron","schedule":"0 6 * * 1-5"},{"path":"/api/functions/paymentCollectionsReconcileCron","schedule":"30 23 * * 0-4"},{"path":"/api/functions/portalEntitlementSyncCron","schedule":"30 18 * * *"},{"path":"/api/functions/collaborationDailyCron","schedule":"0 1 * * *"},{"path":"/api/functions/growthCoachingDailyCron","schedule":"30 0 * * 1-5"},{"path":"/api/functions/hedgeDeskMaintenanceCron","schedule":"30 0 * * *"},{"path":"/api/functions/marketReportDriveSyncCron","schedule":"0 * * * *"},{"path":"/api/functions/masterContractReconcileCron","schedule":"15 * * * *"},{"path":"/api/functions/emailRouterMaintenanceCron","schedule":"*/5 * * * *"}];

test('fixed readonly CI principal cannot invoke any dedicated financial action',()=>{
 for(const name of selectedFinancialHandlers)assert.throws(()=>requireReadOnlyCiOperation({email:FCOS_READ_ONLY_CI.email},name,{}),{code:'FCOS_CI_READ_ONLY'});
});
