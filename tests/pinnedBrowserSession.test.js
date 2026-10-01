import test from 'node:test';
import assert from 'node:assert/strict';
import { approvedBrowserProfile, createPinnedBrowserSession } from '../scripts/lib/pinned-browser-session.mjs';

const context = { provider: 'fcos', environment: 'production', purpose: 'verification' };
const routes = { cli: 'unsupported', api: 'unsupported' };
function fixture(profile = 'Otto') {
  const calls = [];
  const browser = { id: 'owned-browser', type: 'extension', metadata: { profileName: profile } };
  return { calls, api: {
    list: async () => { calls.push('list'); return [browser]; },
    select: async (id) => { calls.push(`select:${id}`); return browser; },
    open: async (id) => { calls.push('open'); return { id: 'owned-tab', browserId: id }; },
    close: async (_id, tab) => { calls.push(`close:${tab}`); },
    release: async () => { calls.push('release'); },
  } };
}
test('inventory and exact profile precede tab access; cleanup owns only task tabs', async () => {
  const f = fixture();
  const session = await createPinnedBrowserSession({ api: f.api, context, routes });
  await session.open('https://fcos.fcuno.com');
  assert.deepEqual(await session.cleanup(), { complete: true, remainingOwnedTabs: 0, ownershipUncertain: false, blockers: [] });
  assert.deepEqual(f.calls, ['list', 'select:owned-browser', 'open', 'close:owned-tab', 'release']);
  await assert.rejects(() => session.open('https://fcos.fcuno.com'), /BROWSER_SESSION_CLOSED/);
});
test('wrong or missing metadata and ambiguous profile fail before selection', async () => {
  for (const browsers of [[], [ { id:'wrong', type:'extension', metadata:{ profileName:'Vincent' } } ],
    [ { id:'a', type:'extension', metadata:{ profileName:'Otto' } }, { id:'b', type:'extension', metadata:{ profileName:'Otto' } } ]]) {
    const f = fixture(); f.api.list = async () => browsers;
    await assert.rejects(() => createPinnedBrowserSession({ api:f.api, context, routes }), /BROWSER_PINNED_PROFILE_UNAVAILABLE/);
    assert.deepEqual(f.calls, []);
  }
});
test('capable CLI or API and denied approval prevent browser fallback', async () => {
  for (const r of [{ cli:'available', api:'unsupported' }, { cli:'unsupported', api:'available' }, { ...routes, approvalDenied:true }]) {
    const f = fixture();
    await assert.rejects(() => createPinnedBrowserSession({ api:f.api, context, routes:r }), /BROWSER_/);
    assert.deepEqual(f.calls, []);
  }
});
test('selected browser metadata drift releases session and refuses tabs', async () => {
  const f = fixture(); f.api.select = async () => ({ id:'foreign', metadata:{ profileName:'Otto' } });
  await assert.rejects(() => createPinnedBrowserSession({ api:f.api, context, routes }), /BROWSER_SELECTED_PROFILE_MISMATCH/);
  assert.deepEqual(f.calls, ['list', 'release']);
});
test('cleanup releases runtime even when owned tab close fails', async () => {
  const f = fixture(); f.api.close = async () => { throw new Error('private provider error'); };
  const session = await createPinnedBrowserSession({ api:f.api, context, routes });
  await session.open('https://fcos.fcuno.com');
  assert.deepEqual(await session.cleanup(), { complete:false, remainingOwnedTabs:1, ownershipUncertain:false, blockers:['BROWSER_TAB_CLEANUP_FAILED'] });
  assert.equal(f.calls.at(-1), 'release');
});
test('Salesforce and Drive authentication preserve environment profiles', () => {
  assert.equal(approvedBrowserProfile({ provider:'salesforce', environment:'production', purpose:'authentication' }), 'Vincent');
  assert.equal(approvedBrowserProfile({ provider:'salesforce', environment:'devee', purpose:'authentication' }), 'Otto');
  assert.equal(approvedBrowserProfile({ provider:'salesforce-mirror', environment:'devee', purpose:'verification' }), 'vincexai');
  assert.equal(approvedBrowserProfile({ provider:'drive', environment:'production', purpose:'authentication' }), 'Vincent');
  assert.throws(() => approvedBrowserProfile({ provider:'salesforce', environment:'production', purpose:'verification' }), /AUTH_ONLY/);
});


const previewOrigin = 'https://fcos-immutable-test.vercel.app';
const now = Date.parse('2026-10-01T00:00:00.000Z');
const previewContext = { provider:'fcos', environment:'preview', purpose:'verification', deploymentUrl:previewOrigin, expectedSha:'a'.repeat(40) };
const proof = { url:previewOrigin, account:'hocheunglai-6535', teamId:'team_MbKDazzCrou3eKTuausPv4X2', projectId:'prj_0pUORPGfFPyKtYhKr6ecwJ9ydvEs',
  environment:'preview', readyState:'READY', sha:previewContext.expectedSha, deploymentId:'dpl_fixture', verifiedAt:new Date(now).toISOString() };
const success = { complete:true, remainingOwnedTabs:0, ownershipUncertain:false, blockers:[] };

test('browser target pins reject other organizations, provider paths, origins and secret URL material before opening', async () => {
  for (const [target,profile,url] of [
    [context,'Otto','https://evil.example.test'],
    [context,'Otto','https://fcos.fcuno.com/api/functions/financialAction'],
    [{provider:'github',environment:'repository',purpose:'verification'},'Otto','https://github.com/other/repository'],
    [{provider:'vercel',environment:'production',purpose:'verification'},'Otto','https://vercel.com/other/fcos'],
    [{provider:'supabase',environment:'production',purpose:'verification'},'Otto','https://supabase.com/dashboard/project/other'],
    [{provider:'salesforce',environment:'production',purpose:'authentication'},'Vincent','https://fratellicosulich--devee.sandbox.my.salesforce.com/'],
    [{provider:'salesforce',environment:'production',purpose:'authentication'},'Vincent','https://fratellicosulich.my.salesforce.com/lightning/setup/'],
    [{provider:'drive',environment:'production',purpose:'authentication'},'Vincent','https://drive.google.com/drive/my-drive'],
    [context,'Otto','https://fcos.fcuno.com/?access_token=private-value'],
    [context,'Otto','https://fcos.fcuno.com/?code=private-value'],
    [context,'Otto','https://fcos.fcuno.com/#access_token=private-value'],
    [context,'Otto','https://credential@fcos.fcuno.com/'],
    [context,'Otto','http://fcos.fcuno.com/'],
    [context,'Otto','https://fcos.fcuno.com/?next=https%3A%2F%2Fevil.example.test'],
    [context,'Otto','https://fcos.fcuno.com/?next=%2F%3Fnext%3Dhttps%253A%252F%252Fevil.example.test'],
  ]) {
    const f=fixture(profile);
    const session=await createPinnedBrowserSession({api:f.api,context:target,routes});
    await assert.rejects(()=>session.open(url), e=>e.code.startsWith('BROWSER_') && !JSON.stringify(e).includes('private-value'));
    assert.ok(!f.calls.includes('open'));
    assert.equal(f.calls.at(-1),'release');
    assert.deepEqual(await session.cleanup(),success);
  }
});

test('canonical repository, provider dashboard, Salesforce and Google authentication targets are admitted', async () => {
  for (const [target,profile,url] of [
    [{provider:'github',environment:'repository',purpose:'verification'},'Otto','https://github.com/hocheunglai-oss/fcos/pull/72'],
    [{provider:'salesforce-mirror',environment:'devee',purpose:'verification'},'vincexai','https://github.com/ivanyk20/fcbhk/pulls'],
    [{provider:'vercel',environment:'production',purpose:'verification'},'Otto','https://vercel.com/hocheunglai-6535s-projects/fcos/deployments'],
    [{provider:'supabase',environment:'production',purpose:'verification'},'Otto','https://supabase.com/dashboard/project/pjforfvchygdyqfcgpmw'],
    [{provider:'salesforce',environment:'production',purpose:'authentication'},'Vincent','https://fratellicosulich.my.salesforce.com/'],
    [{provider:'drive',environment:'production',purpose:'authentication'},'Vincent','https://accounts.google.com/o/oauth2/v2/auth?response_type=code'],
  ]) {
    const f=fixture(profile), session=await createPinnedBrowserSession({api:f.api,context:target,routes});
    await session.open(url);
    assert.deepEqual(await session.cleanup(),success);
  }
});

test('Preview target must be verified independently before browser inventory; a local proof object cannot authorize it', async () => {
  const f=fixture();
  await assert.rejects(()=>createPinnedBrowserSession({api:f.api,context:{...previewContext,proof,verified:true},routes,now:()=>now}), /PREVIEW_VERIFICATION_UNAVAILABLE/);
  assert.deepEqual(f.calls,[]);
  const session=await createPinnedBrowserSession({api:f.api,context:previewContext,routes,now:()=>now,verifyDeployment:async (origin,pins)=>{
    f.calls.push('verify-deployment');
    assert.equal(origin,previewOrigin); assert.equal(pins.expectedSha,previewContext.expectedSha); assert.equal(pins.projectId,proof.projectId);
    return proof;
  }});
  assert.deepEqual(f.calls.slice(0,3),['verify-deployment','list','select:owned-browser']);
  await session.open(`${previewOrigin}/payment-collections?tab=variable-charges`);
  assert.deepEqual(await session.cleanup(),success);
});

test('wrong, stale, unready or alternate Preview proof blocks before browser access', async () => {
  for (const changed of [{account:'other'}, {teamId:'team_other'}, {projectId:'prj_other'}, {environment:'production'}, {readyState:'BUILDING'},
    {sha:'b'.repeat(40)}, {url:'https://other.vercel.app'}, {deploymentId:'unknown'}, {verifiedAt:new Date(now-900001).toISOString()},
    {verifiedAt:new Date(now+300001).toISOString()}]) {
    const f=fixture();
    await assert.rejects(()=>createPinnedBrowserSession({api:f.api,context:previewContext,routes,now:()=>now,verifyDeployment:async()=>({...proof,...changed})}), /PREVIEW_PROOF_INVALID/);
    assert.deepEqual(f.calls,[]);
  }
});

test('verified Preview proof expires before any later tab open', async () => {
  let clock=now;
  const f=fixture(), session=await createPinnedBrowserSession({api:f.api,context:previewContext,routes,now:()=>clock,verifyDeployment:async()=>proof});
  clock+=900001;
  await assert.rejects(()=>session.open(previewOrigin), /PREVIEW_PROOF_EXPIRED/);
  assert.ok(!f.calls.includes('open'));
  assert.deepEqual(await session.cleanup(),success);
});

test('mismatched open never closes a foreign tab and reports persistent ownership uncertainty', async () => {
  const f=fixture(); f.api.open=async()=>{f.calls.push('open');return {id:'foreign-tab',browserId:'foreign-browser'};};
  const session=await createPinnedBrowserSession({api:f.api,context,routes});
  await assert.rejects(()=>session.open('https://fcos.fcuno.com'), e=>e.code==='BROWSER_TAB_PROFILE_MISMATCH' && e.cleanup.complete===false && e.cleanup.ownershipUncertain);
  const result=await session.cleanup();
  assert.equal(result.complete,false); assert.equal(result.ownershipUncertain,true); assert.equal(result.remainingOwnedTabs,0);
  assert.deepEqual(result.blockers,['BROWSER_SESSION_OWNERSHIP_UNCERTAIN']);
  assert.ok(!f.calls.some(call=>call.startsWith('close:')));
  assert.equal(f.calls.filter(call=>call==='release').length,1);
});

test('an API open rejection releases the task session and cannot claim unknown tab cleanup succeeded', async () => {
  const f=fixture(); f.api.open=async()=>{throw new Error('private-provider-session');};
  const session=await createPinnedBrowserSession({api:f.api,context,routes});
  await assert.rejects(()=>session.open('https://fcos.fcuno.com'), e=>e.code==='BROWSER_TAB_OPEN_FAILED' && e.cleanup.ownershipUncertain && !JSON.stringify(e).includes('private-provider-session'));
  assert.equal((await session.cleanup()).complete,false);
  assert.equal(f.calls.at(-1),'release');
});

test('unexpected returned URL closes only the confirmed task-owned tab', async () => {
  const f=fixture(); f.api.open=async id=>({id:'owned-tab',browserId:id,url:'https://evil.example.test'});
  const session=await createPinnedBrowserSession({api:f.api,context,routes});
  await assert.rejects(()=>session.open('https://fcos.fcuno.com'), e=>e.code==='BROWSER_URL_TARGET_MISMATCH' && e.cleanup.complete);
  assert.ok(f.calls.includes('close:owned-tab')); assert.deepEqual(await session.cleanup(),success);
});

function deferred() { let resolve; const promise=new Promise(r=>{resolve=r;});return {promise,resolve}; }

test('cleanup seals immediately, waits for an in-flight open and never starts a queued open', async () => {
  const f=fixture(), opened=deferred(), entered=deferred();
  f.api.open=async id=>{f.calls.push('open');entered.resolve();await opened.promise;return {id:'owned-tab',browserId:id};};
  const session=await createPinnedBrowserSession({api:f.api,context,routes});
  const first=session.open('https://fcos.fcuno.com').catch(e=>e.code);
  const queued=session.open('https://fcos.fcuno.com/settings').catch(e=>e.code);
  await entered.promise;
  const closing=session.cleanup();
  await assert.rejects(()=>session.open('https://fcos.fcuno.com/markets'), /BROWSER_SESSION_CLOSED/);
  assert.ok(!f.calls.includes('release'));
  opened.resolve();
  assert.equal(await first,'BROWSER_SESSION_CLOSED'); assert.equal(await queued,'BROWSER_SESSION_CLOSED');
  assert.deepEqual(await closing,success);
  assert.deepEqual(f.calls,['list','select:owned-browser','open','close:owned-tab','release']);
});

test('concurrent cleanup calls share closes and session release, while failed closes remain reviewable', async () => {
  const f=fixture(), released=deferred(), entered=deferred();
  f.api.release=async()=>{f.calls.push('release');entered.resolve();await released.promise;};
  const session=await createPinnedBrowserSession({api:f.api,context,routes});
  await session.open('https://fcos.fcuno.com');
  const one=session.cleanup(), two=session.cleanup(); await entered.promise; released.resolve();
  assert.deepEqual(await one,success); assert.deepEqual(await two,success);
  assert.equal(f.calls.filter(c=>c==='close:owned-tab').length,1); assert.equal(f.calls.filter(c=>c==='release').length,1);
});

test('selection and release errors are sanitized and preserve session uncertainty', async () => {
  const f=fixture();f.api.select=async()=>{throw new Error('private-credential');};f.api.release=async()=>{throw new Error('private-credential');};
  await assert.rejects(()=>createPinnedBrowserSession({api:f.api,context,routes}), e=>e.code==='BROWSER_SELECTION_FAILED' && e.cleanup.ownershipUncertain && e.cleanup.blockers.includes('BROWSER_SESSION_RELEASE_FAILED') && !JSON.stringify(e).includes('private-credential'));
});

test('inventory provider errors are sanitized before any selection', async () => {
  const f=fixture(); f.api.list=async()=>{throw new Error('private-provider-error');};
  await assert.rejects(()=>createPinnedBrowserSession({api:f.api,context,routes}), e=>e.code==='BROWSER_INVENTORY_UNAVAILABLE' && !JSON.stringify(e).includes('private-provider-error'));
  assert.deepEqual(f.calls,[]);
});
