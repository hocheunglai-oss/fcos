import assert from 'node:assert/strict';
import test from 'node:test';
import { authenticatedFunction } from '../api/_authenticatedFunction.js';

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
  async function invoke(body) {
    const req = { method: 'POST', headers: { authorization: 'Bearer fixture-token' }, body };
    const res = { setHeader() {}, end(text) { this.body = JSON.parse(text); } };
    await handler(req, res);
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
});
