import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateXeroRecoverySourceInventory} from '../scripts/lib/hosted-release/xero-recovery-source-inventory.mjs';

// Exact shape observed from the actual credential-free Vercel deployment.
// File contents below are harmless synthetic fixtures, never provider proof.
const hash=(algorithm,value)=>createHash(algorithm).update(value).digest('hex');
const team='team_MbKDazzCrou3eKTuausPv4X2';
function fixture(mode='probe'){
  const route=mode==='probe'?'.well-known/fcos-ingress-probe':'xero-recovery';
  const expectedFiles=[['.vercel/output/config.json','{"version":3}\n'],[`.vercel/output/functions/${route}.func/.vc-config.json`,'{"runtime":"nodejs24.x","handler":"index.mjs"}\n'],[`.vercel/output/functions/${route}.func/index.mjs`,'export default (_req,res)=>res.end("SYNTHETIC-NOT-PROVIDER-PROOF");\n']].map(([path,text])=>({path,sha256:hash('sha256',text),bytes:Buffer.byteLength(text),contentBase64:Buffer.from(text).toString('base64')}));
  const tree=[];
  function put(path,leaf){let rows=tree;const parts=path.split('/');for(let i=0;i<parts.length-1;i++){let dir=rows.find(row=>row.name===parts[i]);if(!dir){dir={name:parts[i],type:'directory',mode:16749,children:[]};rows.push(dir);}rows=dir.children;}rows.push({name:parts.at(-1),...leaf});}
  for(const file of expectedFiles)put('src/'+file.path,{type:'file',mode:33152,uid:hash('sha1',Buffer.from(file.contentBase64,'base64'))});
  put('out/'+route,{type:'lambda',mode:49590,uid:team+'-85b3f55c2cd16c60faaacbed52fb020f35'});
  return{tree,expectedFiles,mode};
}
const rowsAt=(tree,path)=>{let rows=tree;for(const name of path.split('/'))rows=rows.find(row=>row.name===name).children;return rows;};
const rejected=value=>assert.throws(()=>validateXeroRecoverySourceInventory(value),{code:'XERO_RECOVERY_SOURCE_INVENTORY_REFUSED'});
test('observed src/out layout maps exact source UIDs while compiled lambda proves no source bytes',()=>{
  for(const mode of ['probe','host']){const f=fixture(mode),result=validateXeroRecoverySourceInventory(f);assert.equal(result.sourceFiles.length,3);for(const file of result.sourceFiles){assert.equal(file.inventoryPath,'src/'+file.path);assert.equal(file.uid,hash('sha1',Buffer.from(file.contentBase64,'base64')));}assert.equal(result.compiledOutput.path,mode==='probe'?'out/.well-known/fcos-ingress-probe':'out/xero-recovery');assert.equal(result.sourceBytesProven,false);assert.equal(result.compiledOutputBytesProven,false);assert.equal(result.executionAuthorityGranted,false);assert.ok(Object.isFrozen(result.sourceFiles));}
});
test('altered/missing source prefix and unknown top-level layouts are denied',()=>{
  for(const name of ['source','SRC','src/../out','src\\out']){const f=fixture();f.tree[0].name=name;rejected(f);}const f=fixture();f.tree.shift();rejected(f);const direct=fixture();direct.tree=direct.tree[0].children;rejected(direct);
});
test('omitted or extra source files/directories cannot hide under a valid src prefix',()=>{
  const missing=fixture();rowsAt(missing.tree,'src/.vercel/output').shift();rejected(missing);
  const extra=fixture();rowsAt(extra.tree,'src/.vercel/output').push({name:'foreign.js',type:'file',mode:33152,uid:'a'.repeat(40)});rejected(extra);
  const empty=fixture();rowsAt(empty.tree,'src/.vercel/output').push({name:'unreviewed',type:'directory',mode:16749,children:[]});rejected(empty);
});
test('duplicate file, directory or source UID entries are rejected',()=>{
  const file=fixture();rowsAt(file.tree,'src/.vercel/output').push(structuredClone(rowsAt(file.tree,'src/.vercel/output')[0]));rejected(file);
  const dir=fixture();dir.tree.push(structuredClone(dir.tree[0]));rejected(dir);
  const uid=fixture();const name=uid.expectedFiles[1].path.split('/').slice(0,-1).join('/');const leaves=rowsAt(uid.tree,'src/'+name);leaves[1].uid=leaves[0].uid;rejected(uid);
});
test('source lambda substitution and output file substitution are rejected',()=>{
  const source=fixture();rowsAt(source.tree,'src/.vercel/output')[0].type='lambda';rejected(source);
  const output=fixture();rowsAt(output.tree,'out/.well-known')[0].type='file';rejected(output);
});
test('only the exact fixed mode output route and exact pinned-team lambda UID are admitted',()=>{
  for(const change of [row=>row.name='xero-recovery',row=>row.uid='team_foreign-'+'a'.repeat(32),row=>row.uid='private-arbitrary-output',row=>row.mode=33152]){const f=fixture();change(rowsAt(f.tree,'out/.well-known')[0]);rejected(f);}const f=fixture();f.mode='host';rejected(f);const missing=fixture();missing.tree.pop();rejected(missing);const extra=fixture();rowsAt(extra.tree,'out/.well-known').push({...rowsAt(extra.tree,'out/.well-known')[0],name:'foreign'});rejected(extra);
});
test('wrong SHA1 UID, source byte substitution and inconsistent expected hashes are rejected',()=>{
  const uid=fixture();rowsAt(uid.tree,'src/.vercel/output')[0].uid='0'.repeat(40);rejected(uid);
  for(const change of [f=>f.contentBase64=Buffer.from('SUBSTITUTED-SOURCE').toString('base64'),f=>f.sha256='0'.repeat(64),f=>f.bytes++,f=>f.contentBase64+='\n']){const f=fixture();change(f.expectedFiles[0]);rejected(f);}
  const expected=fixture();expected.expectedFiles.push(expected.expectedFiles[0]);rejected(expected);
});
test('unknown properties, types, modes and hostile path names fail with no payload reflection',()=>{
  for(const change of [r=>r.secret='PRIVATE-MUST-NOT-REFLECT',r=>r.mode=33188,r=>r.type='symlink',r=>r.name='..',r=>r.name='x\nPRIVATE-MUST-NOT-REFLECT']){const f=fixture();change(rowsAt(f.tree,'src/.vercel/output')[0]);assert.throws(()=>validateXeroRecoverySourceInventory(f),e=>e.code==='XERO_RECOVERY_SOURCE_INVENTORY_REFUSED'&&!e.message.includes('PRIVATE'));}
});
test('untrusted leaf order is irrelevant but complete exact layout remains mandatory',()=>{const f=fixture();f.tree.reverse();rowsAt(f.tree,'src/.vercel/output').reverse();assert.equal(validateXeroRecoverySourceInventory(f).sourceFiles.length,3);rejected({...f,mode:'anything'});});
