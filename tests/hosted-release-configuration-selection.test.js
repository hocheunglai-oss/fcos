import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { CONFIGURATION_SELECTION, selectionBuildGuard, assertSelectionSource, assertSelectionEnvironment } from '../scripts/lib/hosted-release/configuration-selection.mjs';
const sha='a'.repeat(40);
const m={candidate:{sha},targets:{repository:'hocheunglai-oss/fcos',vercelProject:'prj_fixture',vercelTeam:'team_fixture'},verification:{projectSettings:{framework:'vite',nodeVersion:'24.x',rootDirectory:null,installCommand:'npm ci',buildCommand:null}}};
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'fcos-selection-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));writeFileSync(join(dir,'vercel.json'),JSON.stringify({installCommand:'npm ci'}));writeFileSync(join(dir,'package.json'),JSON.stringify({name:'guard-fixture',version:'1.0.0',engines:{node:'24.x'},scripts:{preinstall:'node candidate.cjs',prepare:'node candidate.cjs'}}));return dir;}
function git(directory, overrides={}) {return args=>{const k=args.join(' ');if(k==='symbolic-ref -q HEAD'){if(overrides.attached)return'refs/heads/main';const e=new Error('detached');e.status=1;throw e;}return overrides[k]??({'rev-parse --show-toplevel':directory,'rev-parse --abbrev-ref HEAD':'HEAD','rev-parse HEAD':sha,'status --porcelain --untracked-files=no':'','remote get-url origin':'https://github.com/hocheunglai-oss/fcos.git'})[k];};}
test('selection source requires physical clean detached checkout and npm-first entry',t=>{const dir=fixture(t);assert.equal(assertSelectionSource(dir,m,{git:git(dir)}).strategy,CONFIGURATION_SELECTION);for(const change of [{attached:true},{'rev-parse HEAD':'b'.repeat(40)},{'rev-parse --show-toplevel':tmpdir()},{'status --porcelain --untracked-files=no':' M package.json'},{'remote get-url origin':'https://github.com/other/repo.git'}])assert.throws(()=>assertSelectionSource(dir,m,{git:git(dir,change)}),/SOURCE_INVALID/);assert.throws(()=>assertSelectionSource(dir,{...m,verification:{projectSettings:{...m.verification.projectSettings,rootDirectory:'subdir'}}},{git:git(dir)}),/ENTRY_INVALID/);for(const installCommand of ['node wrapper.mjs && npm ci','env -u NODE_OPTIONS npm ci','./npm ci']){writeFileSync(join(dir,'vercel.json'),JSON.stringify({installCommand}));assert.throws(()=>assertSelectionSource(dir,m,{git:git(dir)}),/ENTRY_INVALID/);}});
test('all startup and system identity overrides are rejected regardless of record value',()=>{const p={autoExposeSystemEnvs:true,rootDirectory:null};assert.equal(assertSelectionEnvironment(p,[{key:'FCOS_MICROSOFT_TENANT_ID',target:['preview']}],m),true);for(const key of ['NODE_OPTIONS','PATH','BASH_ENV','ENV','SHELLOPTS','BASHOPTS','BASH_FUNC_npm%%','LD_PRELOAD','DYLD_INSERT_LIBRARIES','VERCEL_GIT_COMMIT_REF','VERCEL_GIT_COMMIT_SHA','GIT_DIR','NPM_CONFIG_SCRIPT_SHELL','HUGO_VERSION','ZOLA_VERSION','GUTENBERG_VERSION'])assert.throws(()=>assertSelectionEnvironment(p,[{key,target:['production']}],m),/ENV_OVERRIDE/);assert.throws(()=>assertSelectionEnvironment({...p,rootDirectory:'subdir'},[],{...m,verification:{projectSettings:{...m.verification.projectSettings,rootDirectory:'subdir'}}}),/SYSTEM_ENV_REQUIRED/);assert.throws(()=>assertSelectionEnvironment({},[],m),/SYSTEM_ENV_REQUIRED/);assert.throws(()=>assertSelectionEnvironment(p,[{}],m),/ENV_INCOMPLETE/);});
test('actual npm ci refuses wrong/missing selection before malicious lifecycle; matching source runs', t => {
  const dir = fixture(t);
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({name:'guard-fixture', version:'1.0.0', lockfileVersion:3, requires:true,
    packages:{'':{name:'guard-fixture', version:'1.0.0', hasInstallScript:true}}}));
  writeFileSync(join(dir, 'candidate.cjs'), "delete process.env.NODE_OPTIONS;require('fs').writeFileSync('candidate-ran','yes');console.log('FORGED_SELECTION_SUCCESS');");
  const guard = selectionBuildGuard(m);
  for (const selection of [{ref:'old-branch', sha}, {sha}, {ref:'HEAD', sha:'b'.repeat(40)}, {ref:'HEAD'}, {ref:'HEAD', sha}]) {
    const env = {PATH:process.env.PATH, NODE_OPTIONS:guard.nodeOptions, NPM_CONFIG_CACHE:join(dir,'cache'),
      ...(selection.ref ? {VERCEL_GIT_COMMIT_REF:selection.ref} : {}), ...(selection.sha ? {VERCEL_GIT_COMMIT_SHA:selection.sha} : {})};
    const r = spawnSync('npm', ['ci','--offline','--no-audit','--no-fund'], {cwd:dir, env, encoding:'utf8', timeout:10000});
    assert.equal(r.stdout.includes(guard.proof), false);
    if (selection.ref === 'HEAD' && selection.sha === sha) {
      assert.equal(r.status, 0, r.stderr);
      assert.ok(r.stderr.split('\n').includes(guard.proof));
      assert.ok(existsSync(join(dir,'candidate-ran')));
    } else {
      assert.notEqual(r.status, 0);
      assert.equal(existsSync(join(dir,'candidate-ran')), false);
      assert.equal(r.stdout.includes('FORGED_SELECTION_SUCCESS'), false);
      assert.ok(r.stderr.includes('FCOS_CONFIGURATION_SELECTION_REFUSED'));
    }
  }
});
test('real Vite package and npm version subprocesses retain parseable stdout with inherited guard', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const expected = JSON.parse(readFileSync(join(root,'node_modules/vite/package.json'),'utf8')).version;
  const guard = selectionBuildGuard(m), env = {PATH:process.env.PATH, NODE_OPTIONS:guard.nodeOptions,
    VERCEL_GIT_COMMIT_REF:'HEAD', VERCEL_GIT_COMMIT_SHA:sha};
  // Vercel54.20.1 detectFrameworkVersion executes this exact package-version expression.
  const vite = spawnSync(process.execPath, ['-p', "require('vite/package.json').version"], {cwd:root, env, encoding:'utf8', timeout:10000});
  assert.equal(vite.status, 0, vite.stderr);
  assert.equal(vite.stdout, expected+'\n');
  assert.equal(vite.stderr, guard.proof+'\n');
  const plain = spawnSync('npm', ['--version'], {cwd:root, env:{PATH:process.env.PATH}, encoding:'utf8', timeout:10000});
  const guarded = spawnSync('npm', ['--version'], {cwd:root, env, encoding:'utf8', timeout:10000});
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(guarded.status, 0, guarded.stderr);
  assert.match(plain.stdout.trim(), /^\d+\.\d+\.\d+$/);
  assert.equal(guarded.stdout, plain.stdout);
  assert.equal(guarded.stderr, guard.proof+'\n');
});
test('synchronous stderr proof survives immediate exit without contaminating candidate stdout', () => {
  const guard = selectionBuildGuard(m);
  const r = spawnSync(process.execPath, ['-e', "process.stdout.write('candidate-result');process.exit(0)"],
    {env:{PATH:process.env.PATH, NODE_OPTIONS:guard.nodeOptions, VERCEL_GIT_COMMIT_REF:'HEAD', VERCEL_GIT_COMMIT_SHA:sha}, encoding:'utf8', timeout:10000});
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'candidate-result');
  assert.equal(r.stderr, guard.proof+'\n');
});
test('project and applicable shared inventory must be complete before build',async()=>{const {collectSelectionEnvironment}=await import('../scripts/lib/hosted-release/configuration-selection.mjs');const p={autoExposeSystemEnvs:true},calls=[];const read=async path=>{calls.push(path);return path.startsWith('/v10')?{envs:[{key:'TENANT',target:['preview']}]}:{data:[],pagination:{count:0,next:null}};};assert.equal((await collectSelectionEnvironment({read,project:p,manifest:m})).recordCount,1);assert.equal(calls.length,2);for(const response of [{data:[]},{data:[],pagination:{count:1,next:null}},{data:[],pagination:{count:0,next:12}}])await assert.rejects(collectSelectionEnvironment({read:async path=>path.startsWith('/v10')?{envs:[]}:response,project:p,manifest:m}),/ENV_INCOMPLETE/);await assert.rejects(collectSelectionEnvironment({read:async path=>path.startsWith('/v10')?{envs:[]}:{data:[{key:'BASH_ENV',target:['preview'],projectId:[m.targets.vercelProject]}],pagination:{count:1,next:null}},project:p,manifest:m}),/ENV_OVERRIDE/);});

test('Node-only policy rejects alternate Bun source/tooling selection',t=>{const dir=fixture(t);for(const c of [{installCommand:'npm ci',bunVersion:'1.3.0'}]){writeFileSync(join(dir,'vercel.json'),JSON.stringify(c));assert.throws(()=>assertSelectionSource(dir,m,{git:git(dir)}),/ENTRY_INVALID/);}writeFileSync(join(dir,'vercel.json'),JSON.stringify({installCommand:'npm ci'}));writeFileSync(join(dir,'package.json'),JSON.stringify({engines:{node:'24.x',bun:'1.3.0'}}));assert.throws(()=>assertSelectionSource(dir,m,{git:git(dir)}),/ENTRY_INVALID/);assert.throws(()=>assertSelectionEnvironment({autoExposeSystemEnvs:true,bunVersion:'1.3.0'},[],m),/SYSTEM_ENV_REQUIRED/);});
