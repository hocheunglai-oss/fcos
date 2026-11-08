import test from 'node:test';
import assert from 'node:assert/strict';
import { probeSupabaseProjectAccess, shouldProbeScopedSupabaseProject } from '../scripts/lib/supabase-project-access.mjs';

const project = { id: 'pjforfvchygdyqfcgpmw', ref: 'pjforfvchygdyqfcgpmw', name: 'FCOS', organization_id: 'expected-org' };
const response = (value, status = 200) => new Response(typeof value === 'string' ? value : JSON.stringify(value), { status });

test('uses only the pinned project endpoint with existing token and rejects redirects', async () => {
  const calls = [];
  const result = await probeSupabaseProjectAccess({ accessToken: 'private-test-token', fetchImpl: async (url, options) => {
    calls.push({ url, options }); return response(project);
  } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.supabase.com/v1/projects/pjforfvchygdyqfcgpmw');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer private-test-token');
  assert.equal(result.identityVerified, true);
  assert.equal(JSON.stringify(result).includes('private-test-token'), false);
});

test('fails closed for another project, conflicting IDs or wrong name', async () => {
  for (const value of [{ ...project, id: 'other' }, { ...project, ref: 'other' }, { ...project, name: 'other' }, {}]) {
    const result = await probeSupabaseProjectAccess({ accessToken: 'test', fetchImpl: async () => response(value) });
    assert.equal(result.identityVerified, false); assert.equal(result.identityStatus, 'mismatch');
  }
});

test('distinguishes authentication refusal from scoped permission refusal without retries', async () => {
  for (const status of [401, 403, 500]) {
    let calls = 0;
    const result = await probeSupabaseProjectAccess({ accessToken: 'secret', fetchImpl: async () => { calls++; return response('denied secret sbp_hidden', status); } });
    assert.equal(calls, 1); assert.equal(result.httpStatus, status);
    assert.equal(result.identityStatus, status === 401 ? 'authentication_blocked' : 'error');
    assert.equal('errorDetail' in result, false);
  }
});

test('missing credential makes no request; malformed results are not accepted', async () => {
  let calls = 0;
  const result = await probeSupabaseProjectAccess({ accessToken: '', fetchImpl: async () => { calls++; } });
  assert.equal(calls, 0); assert.equal(result.errorCode, 'CREDENTIAL_UNAVAILABLE');
  const malformed = await probeSupabaseProjectAccess({ accessToken: 'test', fetchImpl: async () => response('not-json') });
  assert.equal(malformed.errorCode, 'INVALID_PROJECT_RESPONSE');
});

test('API fallback is limited to a project-scoped credential refused by the list command', () => {
  const scoped = 'sbp_fc_fixture';
  const refused = { ok: false, status: 1, stderr: 'Access token lacks required permission' };
  assert.equal(shouldProbeScopedSupabaseProject(refused, scoped), true);
  assert.equal(shouldProbeScopedSupabaseProject(refused, 'sbp_legacy'), false);
  assert.equal(shouldProbeScopedSupabaseProject({ ...refused, ok: true }, scoped), false);
  assert.equal(shouldProbeScopedSupabaseProject({ ...refused, status: 124 }, scoped), false);
  for (const stderr of ['permission denied: 401', 'permission denied: 429', 'network error']) {
    assert.equal(shouldProbeScopedSupabaseProject({ ...refused, stderr }, scoped), false);
  }
});

test('transport errors expose a fixed code and never retain provider or credential text', async () => {
  const result = await probeSupabaseProjectAccess({ accessToken: 'private-token', fetchImpl: async () => {
    throw new Error('cancelled private-token');
  } });
  assert.equal(result.errorCode, 'PROJECT_REQUEST_FAILED');
  assert.equal('errorDetail' in result, false);
});

test('cancels oversized success and error streams before buffering the entire response', async () => {
  for (const status of [200, 403]) {
    let requests = 0;
    let chunks = 0;
    let cancelled = 0;
    const stream = new ReadableStream({
      pull(controller) { chunks++; controller.enqueue(new Uint8Array(4096)); },
      cancel() { cancelled++; },
    });
    const result = await probeSupabaseProjectAccess({ accessToken: 'test', fetchImpl: async () => {
      requests++; return new Response(stream, { status });
    } });
    assert.equal(result.identityVerified, false);
    assert.equal(result.errorCode, 'PROJECT_RESPONSE_TOO_LARGE');
    assert.equal(requests, 1); assert.equal(cancelled, 1); assert.ok(chunks <= 18);
  }
});
