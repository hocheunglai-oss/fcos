import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const HOOK=fileURLToPath(new URL('../.githooks/pre-push',import.meta.url)),REMOTE_URL='https://github.com/hocheunglai-oss/fcos.git',ZERO='0'.repeat(40);
function fixture(t,{metadata=true}={}) {
  const base=mkdtempSync(join(tmpdir(),'fcos-pre-push-')),repo=join(base,'repo'),remote=join(base,'published.git'),bin=join(base,'bin'),log=join(base,'mirror.log');
  t.after(()=>rmSync(base,{recursive:true,force:true}));mkdirSync(repo);mkdirSync(bin);
  const env={PATH:process.env.PATH,HOME:base,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'};
  const git=(...args)=>execFileSync('git',args,{cwd:repo,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-q','-b','old');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');git('config','fcos.expectedGithubAccount','hocheunglai-oss');
  const edit=(path,text)=>{const p=join(repo,path);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,text);};
  const commit=(path,text)=>{edit(path,text);git('add',path);git('commit','-qm',path);return git('rev-parse','HEAD');};
  const old=commit(metadata?'force-app/main/default/classes/Legacy.cls':'api/old.js','old\n');git('checkout','-qb','main');
  if(metadata)commit('force-app/main/default/classes/Legacy.cls','new published main\n');else commit('api/main.js','main\n');
  const main=git('rev-parse','HEAD');execFileSync('git',['clone','--bare','--quiet',repo,remote],{env,stdio:'pipe'});git('remote','add','origin',REMOTE_URL);
  git('config',`url.file://${remote}.insteadOf`,REMOTE_URL);git('checkout','old');
  writeFileSync(join(bin,'gh'),'#!/bin/sh\nprintf "%s\\n" "${FCOS_TEST_ACCOUNT:-hocheunglai-oss}"\n',{mode:0o700});
  writeFileSync(join(bin,'npm'),'#!/bin/sh\nprintf "%s\\n" "$*" >> "$FCOS_TEST_MIRROR_LOG"\nexit "${FCOS_TEST_MIRROR_EXIT:-0}"\n',{mode:0o700});
  const run=(updates,extra={})=>{const result=spawnSync('/bin/sh',[HOOK,'origin',REMOTE_URL],{cwd:repo,env:{...env,PATH:bin+':'+env.PATH,FCOS_TEST_MIRROR_LOG:log,...extra},input:updates.map(([local,oldRemote=ZERO,name='new'])=>`refs/heads/${name} ${local} refs/heads/${name} ${oldRemote}`).join('\n')+'\n',encoding:'utf8'});
    return {...result,mirrorCalls:existsSync(log)?readFileSync(log,'utf8').trim().split('\n').length:0};};
  return {base,repo,remote,env,git,edit,commit,old,main,run};
}
test('new child of actually published old branch does not re-mirror historical metadata differences from main',t=>{
  const f=fixture(t);f.git('checkout','-qb','correction');const sha=f.commit('api/correction.js','corrected\n');
  // Deliberately stale unrelated local tracking state cannot supply the proof.
  f.git('update-ref','refs/remotes/origin/main',f.main);
  const r=f.run([[sha]]);assert.equal(r.status,0,r.stderr);assert.equal(r.mirrorCalls,0,r.stderr);
});
test('a metadata edit on that exact old history still requires the mandatory mirror',t=>{
  const f=fixture(t),sha=f.commit('force-app/main/default/classes/New.cls','new metadata\n'),r=f.run([[sha]],{FCOS_TEST_MIRROR_EXIT:'1'});
  assert.equal(r.status,1);assert.equal(r.mirrorCalls,1);assert.match(r.stderr,/Salesforce metadata must be published byte-for-byte/);
});
test('new metadata introduced then reverted cannot hide behind an unchanged endpoint tree',t=>{
  const f=fixture(t);f.commit('force-app/main/default/classes/Legacy.cls','temporary metadata\n');const sha=f.commit('force-app/main/default/classes/Legacy.cls','old\n');
  const r=f.run([[sha]]);assert.equal(r.status,0,r.stderr);assert.equal(r.mirrorCalls,1);
});
test('unknown remote history inspects all local history, never trusts unpublished tracking refs',t=>{
  const f=fixture(t),sha=f.commit('api/correction.js','new\n');f.git('update-ref','refs/remotes/origin/unpublished',sha);
  f.git('config',`url.file://${f.remote}.insteadOf`,'https://unused.invalid');
  // A native local destination with no published refs is returned by ls-remote.
  const empty=join(f.base,'empty.git');execFileSync('git',['init','--bare','-q',empty],{env:f.env});f.git('config',`url.file://${empty}.insteadOf`,REMOTE_URL);
  const r=f.run([[sha]]);assert.equal(r.status,0,r.stderr);assert.equal(r.mirrorCalls,1);
});
test('initial root metadata is conservative, while a fully observed source history without metadata needs no mirror',t=>{
  const f=fixture(t,{metadata:false});const sha=f.commit('api/new.js','new\n');assert.equal(f.run([[sha]]).mirrorCalls,0);
  const g=fixture(t);g.git('checkout','--orphan','unknown-root');g.git('rm','-rf','.');const root=g.commit('force-app/main/default/classes/Root.cls','root metadata\n');assert.equal(g.run([[root]]).mirrorCalls,1);
});
test('new merge checks every parent and catches Salesforce merge resolutions',t=>{
  const f=fixture(t);f.git('checkout','-qb','api-side');f.commit('api/side.js','side\n');f.git('checkout','old');f.commit('api/other.js','other\n');f.git('merge','--no-commit','--no-ff','api-side');
  f.edit('force-app/main/default/classes/Legacy.cls','merge-only metadata\n');f.git('add','.');f.git('commit','-qm','merge resolution');const sha=f.git('rev-parse','HEAD');const r=f.run([[sha]]);assert.equal(r.status,0,r.stderr);assert.equal(r.mirrorCalls,1);
});
test('metadata-free merge of published history plus new API edits avoids mirror',t=>{
  const f=fixture(t);f.git('checkout','-qb','left');f.commit('api/left.js','left\n');f.git('checkout','old');f.commit('api/right.js','right\n');f.git('merge','--no-ff','-m','merge','left');assert.equal(f.run([[f.git('rev-parse','HEAD')]]).mirrorCalls,0);
});
test('multiple updates are evaluated together; one metadata branch invokes the gate once',t=>{
  const f=fixture(t),api=f.commit('api/new.js','new\n');f.git('checkout','-qb','metadata',f.old);const sf=f.commit('force-app/main/default/classes/New.cls','metadata\n');const r=f.run([[api,ZERO,'api'],[sf,ZERO,'metadata']]);assert.equal(r.status,0,r.stderr);assert.equal(r.mirrorCalls,1);
});
test('deletions are skipped without suppressing a different metadata update',t=>{
  const f=fixture(t);const deletion=f.run([[ZERO,f.old,'old']]);assert.equal(deletion.status,0,deletion.stderr);assert.equal(deletion.mirrorCalls,0);
  const sha=f.commit('force-app/main/default/classes/New.cls','new\n');const r=f.run([[ZERO,f.old,'old'],[sha,ZERO,'metadata']]);assert.equal(r.mirrorCalls,1);
});
test('existing-ref metadata net changes and reverted intermediate edits still require mirror',t=>{
  const f=fixture(t),sha=f.commit('force-app/main/default/classes/Legacy.cls','existing branch edit\n');assert.equal(f.run([[sha,f.old,'old']]).mirrorCalls,1);
  const g=fixture(t);g.commit('force-app/main/default/classes/Legacy.cls','temporary\n');const reverted=g.commit('force-app/main/default/classes/Legacy.cls','old\n');assert.equal(g.run([[reverted,g.old,'old']]).mirrorCalls,1);
});
test('unknown objects and shallow history cannot become a metadata-free pass',t=>{
  const f=fixture(t);assert.equal(f.run([['1'.repeat(40)]]).mirrorCalls,1);
  const g=fixture(t);writeFileSync(join(g.repo,'.git/shallow'),g.old+'\n');assert.equal(g.run([[g.old]]).mirrorCalls,1);
});
test('wrong isolated GitHub identity blocks before any mirror operation',t=>{
  const f=fixture(t),r=f.run([[f.old]],{FCOS_TEST_ACCOUNT:'wrong-account'});assert.equal(r.status,1);assert.equal(r.mirrorCalls,0);assert.match(r.stderr,/identity does not match/);
});

test('only actually advertised tag ancestry can exclude old metadata history',t=>{
  const f=fixture(t);f.git('tag','-a','published-old','-m','published old',f.old);
  execFileSync('git',['--git-dir',f.remote,'fetch','--quiet',f.repo,'refs/tags/published-old:refs/tags/published-old'],{env:f.env});
  execFileSync('git',['--git-dir',f.remote,'update-ref','-d','refs/heads/old'],{env:f.env});
  execFileSync('git',['--git-dir',f.remote,'update-ref','-d','refs/heads/main'],{env:f.env});
  const sha=f.commit('api/new.js','tag ancestor\n'),r=f.run([[sha]]);assert.equal(r.status,0,r.stderr);assert.equal(r.mirrorCalls,0,r.stderr);
});
test('failed actual remote advertisement inspects full history rather than stale tracking refs',t=>{
  const f=fixture(t),sha=f.commit('api/new.js','new\n');f.git('update-ref','refs/remotes/origin/old',f.old);
  f.git('config',`url.file://${f.remote}.insteadOf`,'https://unused.invalid');
  f.git('config',`url.file://${join(f.base,'missing.git')}.insteadOf`,REMOTE_URL);
  const r=f.run([[sha]]);assert.equal(r.status,0,r.stderr);assert.equal(r.mirrorCalls,1);
});
test('actual pre-push destination is used even when the remote fetch URL differs',t=>{
  const f=fixture(t),sha=f.commit('api/new.js','new\n');f.git('remote','set-url','origin','https://unrelated.invalid/fetch.git');
  const r=f.run([[sha]]);assert.equal(r.status,0,r.stderr);assert.equal(r.mirrorCalls,0);
});
