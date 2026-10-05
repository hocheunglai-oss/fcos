import test from 'node:test';
import assert from 'node:assert/strict';
import { createPortalRetryScheduler } from '../api/_portalRetryScheduler.js';

test('Preview and read-only deployments do not schedule background work or consume throttle', async () => {
  let env={VERCEL_ENV:'preview'}, calls=0, pending;
  const schedule=createPortalRetryScheduler({environment:()=>env,now:()=>1,waitUntil:p=>{calls++;pending=p;},processPortalOutbox:async()=>{calls++;},requestId:()=>{calls++;return 'ref';}});
  assert.equal(schedule({}),false); assert.equal(calls,0);
  env={VERCEL_ENV:'production',FCOS_ENABLE_READ_ONLY_CI:'true'};
  assert.equal(schedule({}),false); assert.equal(calls,0);
  env={VERCEL_ENV:'production'};
  assert.equal(schedule({}),true); await pending; assert.equal(calls,3);
});
test('Production keeps bounded retry, request reference, throttle and sanitized failure handling', async () => {
  let now=100000,pending,error;
  const client={}, calls=[];
  const schedule=createPortalRetryScheduler({environment:()=>({VERCEL_ENV:'production'}),now:()=>now,waitUntil:p=>{pending=p;},processPortalOutbox:async input=>{calls.push(input);throw new Error('transient');},requestId:()=> 'request-ref',onFailure:e=>{error=e;}});
  assert.equal(schedule(client),true); await pending;
  assert.deepEqual(calls,[{client,limit:3,requestId:'request-ref'}]); assert.equal(error.message,'transient');
  assert.equal(schedule(client),false); now+=60000; assert.equal(schedule(client),true); await pending;
  assert.equal(calls.length,2);
});
