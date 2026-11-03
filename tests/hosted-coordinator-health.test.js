import test from 'node:test';
import assert from 'node:assert/strict';
import {createNodeCoordinatorServer} from '../supabase/functions/release-coordinator/server.mjs';

test('native health exposes only the loaded public policy digest and never dispatches',async()=>{
  let calls=0;
  const digest='a'.repeat(64);
  const server=createNodeCoordinatorServer(async()=>{calls++;return new Response('{}',{status:401});},{policySha256:digest});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const r=await fetch(`${base}/health`);
    assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
    assert.deepEqual(await r.json(),{kind:'fcos_coordinator_health_v1',policySha256:digest});
    assert.equal(calls,0);
    const refused=await fetch(`${base}/health`,{method:'POST',body:'not-a-token'});
    assert.equal(refused.status,405);assert.equal(refused.headers.get('allow'),'GET');assert.equal(calls,0);
    const protectedResponse=await fetch(`${base}/coordinate`,{method:'POST',body:'{}'});
    assert.equal(protectedResponse.status,401);assert.equal(calls,1);
    const query=await fetch(`${base}/health?policy=anything`);
    assert.equal(query.status,401);assert.equal(calls,2);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('health is absent by default and malformed policy digests refuse before listening',async()=>{
  assert.throws(()=>createNodeCoordinatorServer(()=>{}, {policySha256:'raw-policy-or-secret'}),/COORDINATION_HEALTH_POLICY_INVALID/);
  let calls=0;
  const server=createNodeCoordinatorServer(async()=>{calls++;return new Response('{}',{status:401});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/health`)).status,401);assert.equal(calls,1);}
  finally{await new Promise(resolve=>server.close(resolve));}
});
