import assert from 'node:assert/strict';
import test from 'node:test';
import { authenticatedFunction } from '../api/_authenticatedFunction.js';
import nominationFiling from '../api/outlook/nomination-filing.js';

test('standalone authenticated JSON applies the same UTF-8 limit to parsed and raw bodies', async (t) => {
  const url = 'https://pjforfvchygdyqfcgpmw.supabase.co';
  const user = { id: '00000000-0000-4000-8000-000000000001' };
  const env = {
    SUPABASE_URL: url,
    SUPABASE_SECRET_KEY: 'fixture-only-key',
    FCOS_ENABLE_FCUNO_FEDERATION: 'false',
  };
  for (const [name, value] of Object.entries(env)) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
  t.mock.method(globalThis, 'fetch', async (input) => {
    const target = new URL(typeof input === 'string' ? input : input.url);
    assert.equal(target.origin, url);
    if (target.pathname === '/auth/v1/user') return Response.json(user);
    assert.equal(target.pathname, '/rest/v1/user_profiles');
    return Response.json({ ...user, active: true, user_type: 'viewer' });
  });
  let calls = 0;
  const handler = authenticatedFunction({
    handlerName: 'fixtureBodyLimit',
    execute(body) {
      calls += 1;
      return { value: body.text };
    },
  });
  async function invoke(body, endpoint = handler, chunks = []) {
    const req = {
      method: 'POST', headers: { authorization: 'Bearer fixture-token' }, body,
      async *[Symbol.asyncIterator]() { yield* chunks; },
    };
    const res = { setHeader() {}, end(text) { this.body = JSON.parse(text); } };
    await endpoint(req, res);
    return res;
  }
  const large = { text: 'é'.repeat(150_000) };
  for (const body of [large, JSON.stringify(large)]) {
    const result = await invoke(body);
    assert.equal(result.statusCode, 413);
    assert.equal(result.body.code, 'FCOS_REQUEST_TOO_LARGE');
  }
  assert.equal(calls, 0);
  for (const body of [{ text: 'small' }, '{"text":"small"}']) {
    assert.deepEqual((await invoke(body)).body, { value: 'small' });
  }
  assert.equal(calls, 2);

  const upload = authenticatedFunction({
    handlerName: 'fixtureUpload', maxJsonBodyBytes: 1024 * 1024,
    execute: body => ({ base64Length: body.file.base64.length }),
  });
  const file = { file: { base64: Buffer.alloc(512 * 1024).toString('base64') } };
  const encoded = Buffer.from(JSON.stringify(file));
  const chunks = [encoded.subarray(0, 300_000), encoded.subarray(300_000)];
  assert.equal((await invoke(undefined, handler, chunks)).statusCode, 413);
  for (const result of [await invoke(file, upload), await invoke(encoded.toString(), upload),
    await invoke(undefined, upload, chunks)]) {
    assert.deepEqual(result.body, { base64Length: file.file.base64.length });
  }
  const oversized = Buffer.from(JSON.stringify({ file: { base64: 'A'.repeat(1024 * 1024) } }));
  for (const result of [await invoke(oversized.toString(), upload),
    await invoke(undefined, upload, [oversized.subarray(0, 600_000), oversized.subarray(600_000)])]) {
    assert.equal(result.statusCode, 413);
    assert.equal(result.body.code, 'FCOS_REQUEST_TOO_LARGE');
  }
  assert.throws(() => authenticatedFunction({ handlerName: 'fixtureOversizedLimit', maxJsonBodyBytes: 1024 * 1024 + 1, execute() {} }), RangeError);
});

test('Outlook filing remains off by default and rejects staged requests before reading or authenticating', async t => {
  const original = process.env.FCOS_ENABLE_NOMINATION_FILING;
  const vercel = process.env.VERCEL_ENV;
  t.after(() => {
    if (original === undefined) delete process.env.FCOS_ENABLE_NOMINATION_FILING;
    else process.env.FCOS_ENABLE_NOMINATION_FILING = original;
    if (vercel === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = vercel;
  });
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected provider request'); });
  async function invoke(host) {
    const headers = {};
    const res = { setHeader(key, value) { headers[key.toLowerCase()] = value; }, end(text) { this.body = JSON.parse(text); } };
    await nominationFiling({ method: 'POST', url: '/api/outlook/nomination-filing',
      headers: { host, authorization: 'Bearer fixture-token' },
      get body() { throw new Error('Unexpected body read'); },
    }, res);
    return { ...res, headers };
  }
  process.env.VERCEL_ENV = 'production';
  delete process.env.FCOS_ENABLE_NOMINATION_FILING;
  const disabled = await invoke('fcos.fcuno.com');
  assert.equal(disabled.statusCode, 503);
  assert.equal(disabled.body.code, 'NOMINATION_FILING_NOT_ACTIVATED');
  process.env.FCOS_ENABLE_NOMINATION_FILING = 'true';
  const staged = await invoke('fcos-staged-runtime.vercel.app');
  assert.equal(staged.statusCode, 403);
  assert.equal(staged.body.code, 'FCOS_DEPLOYMENT_READ_ONLY');
  assert.equal(staged.headers['x-fcos-external-action'], '1');
  assert.equal(fetch.mock.callCount(), 0);
});

test('Outlook filing requires an explicit module grant and refuses a privileged pilot identity', async t => {
  const url = 'https://pjforfvchygdyqfcgpmw.supabase.co';
  const user = { id: '00000000-0000-4000-8000-000000000001' };
  for (const [name, value] of Object.entries({
    SUPABASE_URL: url,
    SUPABASE_SECRET_KEY: 'fixture-only-key',
    FCOS_ENABLE_FCUNO_FEDERATION: 'false',
    FCOS_ENABLE_NOMINATION_FILING: 'true',
  })) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
  let userType = 'operations';
  const calls = [];
  t.mock.method(globalThis, 'fetch', async input => {
    const target = new URL(typeof input === 'string' ? input : input.url);
    assert.equal(target.origin, url);
    calls.push(target.pathname);
    if (target.pathname === '/auth/v1/user') return Response.json(user);
    if (target.pathname === '/rest/v1/user_profiles') return Response.json({ ...user, active: true, user_type: userType });
    assert.equal(target.pathname, '/rest/v1/rpc/fcos_effective_access');
    return Response.json({ user_id: user.id, permissions: { outlook_nomination_filing: userType === 'administrator' } });
  });
  async function invoke() {
    const res = { setHeader() {}, end(text) { this.body = JSON.parse(text); } };
    await nominationFiling({ method: 'POST', url: '/api/outlook/nomination-filing',
      headers: { host: 'fcos.fcuno.com', authorization: 'Bearer fixture-token' },
      body: { action: 'destinations' },
    }, res);
    assert.equal(res.statusCode, 403);
    return res.body.code;
  }
  assert.equal(await invoke(), 'FCOS_MODULE_FORBIDDEN');
  userType = 'administrator';
  assert.equal(await invoke(), 'NOMINATION_FILING_PILOT_ROLE_REQUIRED');
  assert.deepEqual(calls, Array.from({ length: 2 }, () => [
    '/auth/v1/user', '/rest/v1/user_profiles', '/rest/v1/rpc/fcos_effective_access',
  ]).flat());
});
