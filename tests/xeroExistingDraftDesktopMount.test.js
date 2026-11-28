import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const root=fileURLToPath(new URL('../',import.meta.url));
async function component(file){
 const result=await build({entryPoints:[path.join(root,file)],bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',define:{'window.self':'globalThis','window.top':'globalThis'},plugins:[{name:'local-auth-and-transport',setup(b){
  b.onResolve({filter:/^react(?:\/.*)?$/},args=>({path:pathToFileURL(path.join(root,'node_modules',args.path==='react'?'react/index.js':args.path+'.js')).href,external:true}));
  b.onResolve({filter:/AuthContext$/},()=>({path:'auth',namespace:'synthetic'}));
  b.onResolve({filter:/api\/appClient$/},()=>({path:'transport',namespace:'synthetic'}));
  b.onLoad({filter:/.*/,namespace:'synthetic'},args=>({contents:args.path==='auth'?'export const useAuth=()=>globalThis.__financialFollowonTestAuth;':'export const appClient={functions:{invoke:()=>{throw Error("No SSR provider calls permitted")}}};',loader:'js'}));
  b.onResolve({filter:/^@\//},args=>({path:['','.js','.jsx'].map(extension=>path.join(root,'src',args.path.slice(2))+extension).find(existsSync)}));
 }}]});
 return (await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'))).default;
}
test('desktop status mount is absent for readonly/revoked users and opens no provider request on rendering',async()=>{
 const Panel=await component('src/components/xero/XeroExistingDraftAuthorisationPanel.jsx');
 const auth={user:{id:'synthetic',active:true,read_only_ci:false},isAuthenticated:true,hasModuleAccess:()=>true,hasCapability:()=>true,deploymentMutationAllowed:true};
 try{globalThis.__financialFollowonTestAuth=auth;const permitted=renderToStaticMarkup(React.createElement(Panel));assert.match(permitted,/hidden lg:block/);assert.match(permitted,/Open approved drafts/);assert.doesNotMatch(permitted,/Run approved drafts/);
  globalThis.__financialFollowonTestAuth={...auth,deploymentMutationAllowed:false};
  const held=renderToStaticMarkup(React.createElement(Panel));
  assert.match(held,/Draft authorisation is disabled on this deployment/);assert.doesNotMatch(held,/<button/);
  for(const patch of [{isAuthenticated:false},{hasCapability:()=>false},{hasModuleAccess:()=>false},{user:{...auth.user,read_only_ci:true}}]){globalThis.__financialFollowonTestAuth={...auth,...patch};assert.equal(renderToStaticMarkup(React.createElement(Panel)),'');}
 }finally{delete globalThis.__financialFollowonTestAuth;}
 const Child=await component('src/components/xero/XeroExistingDraftAuthorisation.jsx');const disabled=renderToStaticMarkup(React.createElement(Child,{disabled:true}));assert.equal((disabled.match(/disabled=""/g)||[]).length,2);
});
test('retired accounting UI is not mounted alongside Finance tools',async()=>{
 const [app,layout,page]=await Promise.all(['src/App.jsx','src/components/Layout.jsx','src/pages/XeroPortal.jsx'].map(p=>readFile(path.join(root,p),'utf8')));
 assert.doesNotMatch(app,/xero-portal/);assert.doesNotMatch(layout,/xero_portal/);assert.match(layout,/Finance/);assert.match(page,/<XeroExistingDraftAuthorisationPanel \/>/);assert.match(page,/<XeroFinancialSync portalStatus=/);assert.match(page,/<XeroNativeDocumentPreview verificationOnly/);assert.match(page,/<XeroContactResolution /);
});

test('a fresh execution denial stops every status mutation before transport', async () => {
  const { invokeExistingDraftAction, verifyExistingDraftExecutionGate } = await import('../src/lib/xeroExistingDraftExecutionGate.js');
  const calls = [];
  const invoke = async name => {
    calls.push(name);
    assert.equal(name, 'authContext');
    return { data: { user: { id: 'fixture-user', active: true }, moduleAccess: { xero_portal: true },
      capabilities: { xero_portal_manage: true }, deploymentCapabilities: { mutationsAllowed: false } } };
  };
  for (const name of ['xeroExistingDraftAuthorisationPreview', 'xeroExistingDraftAuthorisationApply', 'xeroExistingDraftAuthorisationRecover']) {
    await assert.rejects(invokeExistingDraftAction(invoke, () => verifyExistingDraftExecutionGate(invoke, 'fixture-user'), name),
      /execution-enabled deployment/);
  }
  assert.deepEqual(calls, ['authContext', 'authContext', 'authContext']);
});
