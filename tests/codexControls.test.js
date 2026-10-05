import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CONTROL_FILES, verifyCodexControls } from '../.codex/control-validation.mjs';

const source = new URL('../',import.meta.url);
function fixture() {
  const root=mkdtempSync(join(tmpdir(),'fcos-controls-')); mkdirSync(join(root,'.codex'));
  for (const p of [...CONTROL_FILES,'.codex/control-policy.json']) writeFileSync(join(root,p),readFileSync(new URL(p,source)));
  return root;
}
function rehash(root) {
  const path=join(root,'.codex/control-policy.json'), policy=JSON.parse(readFileSync(path));
  for (const p of CONTROL_FILES) policy.files[p]=createHash('sha256').update(readFileSync(join(root,p))).digest('hex');
  writeFileSync(path,JSON.stringify(policy));
}
test('versioned current controls verify without writing',()=>{
  const root=fixture();try {assert.deepEqual(verifyCodexControls(root),{schemaVersion:1,revision:1,nodeMajor:24,verified:true});}finally{rmSync(root,{recursive:true});}
});
test('changed setup or configuration invalidates the saved revision',()=>{
  const root=fixture();try {writeFileSync(join(root,'.codex/setup.mjs'),'changed');assert.throws(()=>verifyCodexControls(root),/revision mismatch/);}finally{rmSync(root,{recursive:true});}
});
test('unsafe defaults and credential assignments cannot be accepted by rehashing',()=>{
  for(const change of [s=>s.replace('workspace-write','danger-full-access'),s=>s.replace('approval_policy = "on-request"','approval_policy = "never"'),s=>s+'\npassword = "private"\n']){
    const root=fixture();try {const p=join(root,'.codex/config.toml');writeFileSync(p,change(readFileSync(p,'utf8')));rehash(root);assert.throws(()=>verifyCodexControls(root),/invalid|forbidden/);}finally{rmSync(root,{recursive:true});}
  }
});
test('symlinked source controls are refused',()=>{
  const root=fixture();try {const p=join(root,'.codex/config.toml');rmSync(p);symlinkSync(new URL('.codex/config.toml',source).pathname,p);assert.throws(()=>verifyCodexControls(root),/regular files/);}finally{rmSync(root,{recursive:true});}
});

test('symlinked control directories are refused',()=>{
  const root=mkdtempSync(join(tmpdir(),'fcos-controls-directory-'));
  try { symlinkSync(new URL('.codex/',source).pathname,join(root,'.codex')); assert.throws(()=>verifyCodexControls(root),/regular directory/); }
  finally {rmSync(root,{recursive:true});}
});
