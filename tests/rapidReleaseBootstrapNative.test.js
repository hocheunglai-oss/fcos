import test from 'node:test';
import assert from 'node:assert/strict';
import { githubBootstrapPath,decodeBootstrapPrivateInput,assertBootstrapQualityBeforeCredential } from '../scripts/lib/rapid-release/bootstrap-native.mjs';
test('bootstrap private transport and native routes reject other targets and extra fields',()=>{
  assert.throws(()=>githubBootstrapPath('/repos/other/fcos'),/ROUTE_REFUSED/);
  assert.throws(()=>githubBootstrapPath('/repos/hocheunglai-oss/fcos/../other'),/ROUTE_REFUSED/);
  assert.equal(githubBootstrapPath('/user'),'/user');
  const input={credential:{kind:'supabase_management',token:'synthetic-token-123456789'},inventoryPath:'/private/report.json'};
  assert.deepEqual(decodeBootstrapPrivateInput(Buffer.from(JSON.stringify(input))),input);
  assert.throws(()=>decodeBootstrapPrivateInput(Buffer.from(JSON.stringify({...input,approved:true}))),/INPUT_INVALID/);
});
test('exact native PR source and successful quality producer are required before credential effects',async()=>{
  const sha='a'.repeat(40),repo={full_name:'hocheunglai-oss/fcos'};
  const pr={state:'open',base:{repo,ref:'main'},head:{repo,ref:'codex/rapid-controller-install-20261106',sha}};
  const row={id:20,name:'code-and-database',head_sha:sha,app:{id:15368},status:'completed',conclusion:'success',
    details_url:'https://github.com/hocheunglai-oss/fcos/actions/runs/10/job/20'};
  const github={read:async path=>path.endsWith('/pulls/124')?pr:path.includes('/git/ref/')?{object:{sha}}:
    path.includes('/check-runs')?{total_count:1,check_runs:[row]}:path.endsWith('/runs/10')?
      {id:10,head_sha:sha,event:'pull_request',repository:repo,head_repository:repo,path:'.github/workflows/quality.yml'}:
      {id:20,run_id:10,head_sha:sha,name:'code-and-database',status:'completed',conclusion:'success'}};
  await assertBootstrapQualityBeforeCredential({github,source:{sha}});
  row.conclusion='failure';await assert.rejects(assertBootstrapQualityBeforeCredential({github,source:{sha}}),/QUALITY_REQUIRED/);
  row.conclusion='success';pr.head.sha='b'.repeat(40);
  await assert.rejects(assertBootstrapQualityBeforeCredential({github,source:{sha}}),/EXACT_PR_REQUIRED/);
});
