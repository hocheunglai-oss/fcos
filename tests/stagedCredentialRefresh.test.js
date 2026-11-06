import test from 'node:test';
import assert from 'node:assert/strict';
import { runWithDeploymentRequestSafety } from '../api/_deploymentReadOnly.js';
import { exchangeGoogleDriveRefreshToken } from '../api/_googleDriveOAuth.js';

const staged = action => runWithDeploymentRequestSafety({headers:{host:'qualified-stage.vercel.app'}},action,{VERCEL_ENV:'production'});
test('staging refuses Google refresh before contacting the provider',async()=>{
 let calls=0;
 await assert.rejects(staged(()=>exchangeGoogleDriveRefreshToken({clientId:'fixture',clientSecret:'fixture',refreshToken:'fixture'},{fetchImpl:async()=>{calls++;throw Error('unexpected provider request');}})),{code:'FCOS_DEPLOYMENT_READ_ONLY'});
 assert.equal(calls,0);
});
test('staging refuses uncached Salesforce refresh before contacting the provider',async()=>{
 const keys=['SALESFORCE_JWT_CLIENT_ID','SALESFORCE_JWT_USERNAME','SALESFORCE_JWT_PRIVATE_KEY','SALESFORCE_USERNAME','SALESFORCE_CLIENT_ID','SALESFORCE_CLIENT_SECRET','SALESFORCE_REFRESH_TOKEN'];
 const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 try{
  for(const key of keys)delete process.env[key];
  Object.assign(process.env,{SALESFORCE_CLIENT_ID:'fixture',SALESFORCE_CLIENT_SECRET:'fixture',SALESFORCE_REFRESH_TOKEN:'fixture'});
  const salesforce=await import('../api/_salesforce.js?staged-refresh-fixture');
  let calls=0;const original=globalThis.fetch;globalThis.fetch=async()=>{calls++;throw Error('unexpected provider request');};
  try{await assert.rejects(staged(()=>salesforce.getAccessToken()),{code:'FCOS_DEPLOYMENT_READ_ONLY'});assert.equal(calls,0);}finally{globalThis.fetch=original;}
 }finally{for(const key of keys)if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
});
