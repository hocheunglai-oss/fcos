import test from 'node:test';
import assert from 'node:assert/strict';
import { digest } from '../scripts/lib/hosted-release/json-contract.mjs';
import { validateSourceUpgradeProof,sourceUpgradeSql } from '../scripts/lib/hosted-release/qualification-source-upgrade.mjs';
import { sourceUpgradeFixture,repinSourceUpgrade } from './helpers/hosted-qualification-source-upgrade.mjs';

// Synthetic integrity fixtures only. The native SQL tests and actual private
// coordinator row must authenticate the historical bindings before live use.
function fixture() {
  let p=sourceUpgradeFixture().upgrade;
  const parent='fcos-qualification-6a3fbd8f-2ef733d1-source-20261022';
  p.parent={...p.parent,kind:'source_upgrade',releaseId:parent};
  p.previous.plan.releaseId=parent;p.previous.manifest.releaseId=parent;
  p.parent.manifestHash=digest(p.previous.manifest);
  p.setup.verification.vercelSourceTransport='fcos_source_api_archive_v1';
  p.manifest.verification.vercelSourceTransport='fcos_source_api_archive_v1';
  for(const name of ['auth.mjs','core.mjs']) {
    const i=p.checkerManifest.findIndex(v=>v.path===`supabase/functions/release-coordinator/${name}`);
    const bytes=Buffer.from(`// SYNTHETIC isolated local test ${name}\n`);
    p.checkerFiles[i].data=bytes.toString('base64');p.checkerManifest[i].sha256=digest(bytes);p.checkerManifest[i].byteLength=bytes.length;
  }
  p=repinSourceUpgrade(p);
  return {p,q:admission(p)};
}
function admission(p) {
  const proof={kind:'fcos_exact_preview_uncertainty_quarantine_v1',originalOutcome:'unknown',replayAllowed:false,
    successor:{sourceUpgradeId:p.operationId,releaseId:p.plan.releaseId,controllerSha:p.setup.controllerSha,
      callerSha:p.setup.qualificationSource.bootstrapSha,ref:p.setup.qualificationSource.ref,candidateSha:p.manifest.candidate.sha,
      setupSha256:p.setupSha256,checkerManifestSha256:digest(p.checkerManifest)}};
  return {operationId:'fcos-qualification-6a3fbd8f-2ef733d1-source-20261022-preview-create',originalOutcome:'unknown',
    replayAllowed:false,active:true,proof,proofSha256:digest(proof)};
}
test('actual SQL generator forwards exact quarantine scope through validator',()=>{
  const {p,q}=fixture();assert.throws(()=>validateSourceUpgradeProof(p));
  assert.equal(validateSourceUpgradeProof(p,{previewQuarantine:q}),p);
  const query=sourceUpgradeSql('snapshot',p,{previewQuarantine:q});
  assert.equal(query.projectRef,'pjforfvchygdyqfcgpmw');assert.deepEqual(query.parameters,[p.operationId,digest(p)]);
});
test('revoked, unrelated or changed-scope quarantine cannot relax checker/setup comparisons',()=>{
  const {p,q}=fixture();
  for(const patch of [{active:false},{operationId:'another'}, {proofSha256:'f'.repeat(64)}, {replayAllowed:true}])
    assert.throws(()=>sourceUpgradeSql('admit',p,{previewQuarantine:{...q,...patch}}));
  for(const patch of [{checkerManifestSha256:'f'.repeat(64)},{controllerSha:'f'.repeat(40)},{setupSha256:'f'.repeat(64)},
    {callerSha:'f'.repeat(40)},{sourceUpgradeId:'another'},{releaseId:'another'}]) {
    const proof={...q.proof,successor:{...q.proof.successor,...patch}};
    assert.throws(()=>validateSourceUpgradeProof(p,{previewQuarantine:{...q,proof,proofSha256:digest(proof)}}));
  }
});
test('quarantine permits only the one new transport, no other verification or checker changes',()=>{
  const f=fixture();
  for(const mutate of [p=>{p.setup.verification.extraAuthority=true;p.manifest.verification.extraAuthority=true;},
    p=>{p.setup.verification.vercelSourceTransport='unreviewed';p.manifest.verification.vercelSourceTransport='unreviewed';},
    p=>{const i=p.checkerManifest.findIndex(v=>v.path.endsWith('/index.ts'));const b=Buffer.from('// changed entrypoint');p.checkerFiles[i].data=b.toString('base64');p.checkerManifest[i].sha256=digest(b);p.checkerManifest[i].byteLength=b.length;}]) {
    const p=structuredClone(f.p);mutate(p);const repinned=repinSourceUpgrade(p);
    assert.throws(()=>validateSourceUpgradeProof(repinned,{previewQuarantine:admission(repinned)}));
  }
});
