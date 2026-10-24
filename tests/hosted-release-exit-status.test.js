import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

// Exercise the actual CLI and persisted report. Only admission and candidate
// execution are local fixtures; no provider or credential path is entered.
for (const status of ['passed','failed']) test(`checks CLI reports ${status} through both its file and process exit`, t => {
  const directory=mkdtempSync(join(tmpdir(),'fcos-cli-exit-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const mocks={
    './lib/hosted-release/session.mjs':`import fs from 'node:fs';export const hostedSession=()=>{throw Error('NO_PROVIDER_SESSION')};export const readManifest=JSON.parse;export const writeJson=(p,v)=>fs.writeFileSync(p,JSON.stringify(v));export const workflowOutput=()=>{};`,
    './lib/hosted-release/admission.mjs':`export const assertHostedController=()=>{};export const assertHostedSetup=()=>{};export const assertSourceAdmission=()=>{};`,
    './lib/hosted-release/candidate-bootstrap.mjs':`export const prepareCandidateChecks=()=>{};export const assertPublicBuildInputs=()=>{};`,
    './lib/hosted-release/checks.mjs':`export const runReleaseChecks=async()=>({status:process.env.TEST_CHECK_STATUS,checks:[{checkId:'migrations',status:'passed'},{checkId:'missing_nom_b_database',status:process.env.TEST_CHECK_STATUS}]});`,
  };
  const loader=join(directory,'loader.mjs');
  writeFileSync(loader,`const mocks=${JSON.stringify(mocks)};export async function resolve(s,c,next){if(c.parentURL?.endsWith('/scripts/hosted-release.mjs')&&Object.hasOwn(mocks,s))return{url:'data:text/javascript,'+encodeURIComponent(mocks[s]),shortCircuit:true};return next(s,c);}`);
  const output=join(directory,'database.json'),script=fileURLToPath(new URL('../scripts/hosted-release.mjs',import.meta.url));
  const manifest={candidate:{sha:'a'.repeat(40),sourceProfile:'local-fixture'},controller:{sha:'b'.repeat(40)},verification:{runtime:{image:'local-fixture'},publicBuildEnvironment:{}}};
  const r=spawnSync(process.execPath,['--no-warnings','--experimental-loader',pathToFileURL(loader).href,script,'checks'],{
    env:{PATH:process.env.PATH,HOME:directory,FCOS_RELEASE_MANIFEST:JSON.stringify(manifest),FCOS_RELEASE_OUTPUT:output,FCOS_CHECK_GROUP:'database',TEST_CHECK_STATUS:status},encoding:'utf8',timeout:10000,maxBuffer:65536,
  });
  assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,status==='passed'?0:1,r.stderr);
  assert.equal(JSON.parse(r.stdout).status,status);
  const report=JSON.parse(readFileSync(output,'utf8'));assert.equal(report.status,status);
  assert.deepEqual(report.checks,[{checkId:'migrations',status:'passed'},{checkId:'missing_nom_b_database',status}]);
});

test('failed check artifact remains available while publication still requires successful jobs',()=>{
  const workflow=readFileSync(new URL('../.github/workflows/hosted-release-controller.yml',import.meta.url),'utf8');
  const checks=workflow.slice(workflow.indexOf('\n  checks:'),workflow.indexOf('\n  preview:'));
  assert.match(checks,/uses: actions\/upload-artifact@[^\n]+\n\s+if: \$\{\{ always\(\) && steps\.run\.outcome != 'skipped' && steps\.run\.outcome != '' \}\}/);
  assert.match(workflow,/needs\.checks\.result == 'success' \|\| needs\.checks\.result == 'skipped'/);
});
