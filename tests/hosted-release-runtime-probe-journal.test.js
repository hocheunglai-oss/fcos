import test from 'node:test';
import assert from 'node:assert/strict';
import { createVercelAdapter } from '../scripts/lib/hosted-release/vercel.mjs';
import { collectRuntimeObservation } from '../scripts/collect-preview-parity.mjs';
import { digest, validateManifest } from '../scripts/lib/hosted-release/contract.mjs';
import { PREVIEW_PARITY_POLICY } from '../scripts/lib/preview-parity.mjs';
import { fixtureManifest } from './helpers/hosted-release-manifest.mjs';

const H = 'a'.repeat(64), id = 'dpl_SYNTHETICJOURNAL', url = 'https://fcos-aaaaaaaaa-hocheunglai-6535s-projects.vercel.app';
const now = Date.parse('2026-10-24T08:00:00Z'), SECRET = 'SYNTHETIC_PRIVATE_TOKEN';
const expected = readOnly => ({
  flags: Object.fromEntries(PREVIEW_PARITY_POLICY.runtimeFlags.map(key => [key, { state: 'known', value: true }])),
  safety: { readOnly, externalActions: Object.fromEntries(PREVIEW_PARITY_POLICY.externalActions.map(key => [key, false])) },
  auth: { supabase: { state: 'authenticated', target: 'synthetic-supabase', mode: 'service_role' },
    salesforce: { state: 'authenticated', target: 'synthetic-salesforce', mode: 'application' },
    xero: { state: 'authenticated', target: '11111111-1111-4111-8111-111111111111', mode: 'oauth' } },
});
function fixture({ phase = 'preview', legacy = false } = {}) {
  const manifest = fixtureManifest(), checks = {}, events = [], requests = [];
  if (!legacy) {
    manifest.candidate.sha = '1e25147dc9fc9ba008096f1200b681993d49d428';
    manifest.candidate.sourceProfile = 'compat_runtime_metering_20261024';
  }
  manifest.runtime = { expectedPreview: expected(true), expectedProduction: expected(false), expectedSha256: digest(expected(false)),
    ...(!legacy ? { probeProtocol: 'xero_metered_v1' } : {}) };
  manifest.verification = { runtime: { image: `ghcr.io/hocheunglai-oss/fcos-release-checks@sha256:${H}`, node: 'v24.18.0', python: 'Python 3.11.2', platform: 'linux', arch: 'x64' },
    publicBuildEnvironment: { VITE_FCOS_ENABLE_FCUNO_OIDC: 'true' },
    projectSettings: { framework: 'vite', nodeVersion: '24.x', rootDirectory: null, installCommand: 'npm install', buildCommand: 'npm run build', devCommand: null, outputDirectory: null } };
  const state = { now, outcome: 'success', intentAck: { appended: true }, resultAck: { appended: true }, snapshotChange: () => {}, changeRuntime: () => {} };
  const coordinator = {
    snapshot: async binding => {
      events.push('snapshot'); assert.deepEqual(binding, { releaseId: manifest.releaseId, manifestHash: digest(manifest) });
      const value = { epoch: manifest.epoch, registration: { release_id: manifest.releaseId, epoch: manifest.epoch,
        manifest_hash: digest(manifest), manifest: structuredClone(manifest) }, checks: structuredClone(checks) };
      state.snapshotChange(value); return value;
    },
    appendEvidence: async payload => {
      const kind = payload.key.endsWith('.intent') ? 'intent' : 'result'; events.push(kind);
      assert.equal(payload.manifestHash, digest(manifest)); assert.equal(payload.releaseId, manifest.releaseId);
      checks[payload.key] = { ...structuredClone(payload.evidence), key: payload.key };
      const ack = kind === 'intent' ? state.intentAck : state.resultAck;
      if (ack instanceof Error) throw ack;
      return structuredClone(ack);
    },
  };
  const fetchImpl = async (input, request = {}) => {
    const target = String(input);
    if (target.startsWith('https://api.vercel.com/v13/deployments/')) {
      events.push('deployment');
      return Response.json({ id, url: url.slice(8), projectId: manifest.targets.vercelProject, teamId: manifest.targets.vercelTeam,
        readyState: 'READY', target: phase === 'preview' ? null : 'production', createdAt: now - 1000, projectSettings: manifest.verification.projectSettings,
        meta: { githubCommitSha: state.deploymentSha ?? manifest.candidate.sha, fcosSourceSha256: manifest.candidate.sourceSha256,
          fcosHostedManifest: digest(manifest), fcosVerificationSha256: digest(manifest.verification) } });
    }
    if (target.endsWith('/app-version.json')) {
      events.push('version'); state.now += state.versionAdvance || 0; return Response.json({ commit: manifest.candidate.sha, deploymentId: id,
        provenance: { sourceDigest: manifest.candidate.sourceSha256, releaseEligible: true } });
    }
    assert.equal(target, `${url}/api/connection-runtime`); assert.equal(request.method, 'POST'); events.push('POST');
    requests.push(JSON.parse(request.body));
    if (state.outcome === 'throw') throw Error(SECRET);
    if (state.outcome === 'http') return new Response('', { status: 503 });
    const runtime = { schemaVersion: 1, deploymentId: id, sha: manifest.candidate.sha, sourceDigest: manifest.candidate.sourceSha256,
      capturedAt: new Date(state.now).toISOString(), runtimeValidUntil: new Date(state.now + 120000).toISOString(),
      ...expected(phase === 'preview'), secret: SECRET };
    state.changeRuntime(runtime); return Response.json(runtime);
  };
  const adapter = (override = {}) => createVercelAdapter({ manifest, candidateDirectory: '.', coordinator, fetchImpl,
    env: { FCOS_HOSTED_VERCEL_TOKEN: 'SYNTHETIC', FCOS_HOSTED_VERCEL_TOKEN_ID: 'SYNTHETIC' }, now: () => state.now,
    runtimeTokenProvider: async () => { events.push('token'); return SECRET; }, ...override });
  return { manifest, checks, events, requests, state, coordinator, adapter, verify: value => value.verifyArtifact({ id }, manifest, phase) };
}

test('collector keeps legacy body and sends only a supplied canonical public request UUID', async () => {
  const requestId = '11111111-1111-5111-8111-111111111111', requests = [];
  const options = { url, deployment: { id, url, sha: 'b'.repeat(40), createdAt: now - 1000 }, sourceDigest: H, token: SECRET, now,
    fetchImpl: async (_url, request) => { requests.push(JSON.parse(request.body)); return Response.json({ schemaVersion: 1, deploymentId: id,
      sha: 'b'.repeat(40), sourceDigest: H, capturedAt: new Date(now).toISOString(), runtimeValidUntil: new Date(now + 120000).toISOString(), flags: {}, safety: {}, auth: {} }); } };
  assert.equal(Object.hasOwn(await collectRuntimeObservation(options), 'runtimeValidUntil'), false);
  assert.equal((await collectRuntimeObservation({ ...options, requestId })).runtimeValidUntil, new Date(now + 120000).toISOString());
  assert.deepEqual(requests, [{ action: 'probe' }, { action: 'probe', requestId }]);
  for (const invalid of [null, '', 'private-secret', requestId.replace('11111111', 'AAAAAAAA'), '00000000-0000-0000-0000-000000000000']) {
    assert.equal(await collectRuntimeObservation({ ...options, requestId: invalid }), null);
  }
  assert.equal(requests.length, 2);
});

test('actual opt-in entrypoint persists exact intent before HTTP and successful sanitized result after parity', async () => {
  const f = fixture(); validateManifest(f.manifest);
  const result = await f.verify(f.adapter());
  assert.deepEqual(f.events, ['snapshot', 'deployment', 'version', 'intent', 'token', 'POST', 'result']);
  const intent = f.checks['runtime.probe.preview.intent'].result;
  assert.match(intent.requestId, /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.deepEqual(f.requests, [{ action: 'probe', requestId: intent.requestId }]);
  assert.equal(intent.manifestHash, digest(f.manifest)); assert.equal(intent.candidateSha, f.manifest.candidate.sha);
  assert.equal(intent.sourceSha256, f.manifest.candidate.sourceSha256); assert.equal(intent.deploymentId, id); assert.equal(intent.phase, 'preview');
  assert.equal(Object.hasOwn(intent, 'capturedAt'), false);
  assert.deepEqual(result.runtime, f.checks['runtime.probe.preview.result'].result.runtime);
  assert.equal(JSON.stringify(f.checks).includes(SECRET), false);
});

test('fresh persisted success is reused across adapters with no second HTTP or login', async () => {
  const f = fixture(), first = await f.verify(f.adapter()), original = structuredClone(f.checks);
  f.events.length = 0; f.state.now += 1000;
  const second = await f.verify(f.adapter());
  assert.deepEqual(second.runtime, first.runtime); assert.deepEqual(f.checks, original);
  assert.deepEqual(f.events, ['snapshot', 'deployment', 'version']); assert.equal(f.requests.length, 1);
});

test('valid cached success still requires current target and source identity', async () => {
  const f = fixture(); await f.verify(f.adapter());
  f.state.deploymentSha = 'f'.repeat(40); f.events.length = 0;
  await assert.rejects(f.verify(f.adapter()), { code: 'ARTIFACT_IDENTITY' });
  assert.deepEqual(f.events, ['snapshot', 'deployment']); assert.equal(f.requests.length, 1);
});

test('cached validity is checked again after current provider reads', async () => {
  const f = fixture(); await f.verify(f.adapter());
  f.state.versionAdvance = 120000; f.events.length = 0;
  await assert.rejects(f.verify(f.adapter()), { code: 'RUNTIME_PROBE_RESULT_STALE' });
  assert.deepEqual(f.events, ['snapshot', 'deployment', 'version']); assert.equal(f.requests.length, 1);
});

test('fresh capture cannot extend a cached Xero session beyond its exact validity deadline', async () => {
  const f = fixture(); const result = await f.verify(f.adapter());
  f.state.now = Date.parse(result.runtime.runtimeValidUntil); f.events.length = 0;
  assert(f.state.now - Date.parse(result.runtime.capturedAt) < PREVIEW_PARITY_POLICY.maxAgeSeconds * 1000);
  await assert.rejects(f.verify(f.adapter()), { code: 'RUNTIME_PROBE_RESULT_STALE' });
  assert.deepEqual(f.events, ['snapshot']); assert.equal(f.requests.length, 1);
});

test('absent, malformed or out-of-bounds validity never produces success evidence or a retry', async () => {
  for (const change of [r => { delete r.runtimeValidUntil; }, r => { r.runtimeValidUntil = SECRET; },
    r => { r.runtimeValidUntil = now + 120000; }, r => { r.runtimeValidUntil = r.capturedAt; },
    r => { r.runtimeValidUntil = new Date(now + PREVIEW_PARITY_POLICY.maxAgeSeconds * 1000 + 1).toISOString(); },
    r => { r.capturedAt = new Date(now - 1000).toISOString(); r.runtimeValidUntil = new Date(now - 1).toISOString(); }]) {
    const f = fixture(), adapter = f.adapter(); f.state.changeRuntime = change;
    await assert.rejects(f.verify(adapter), { code: 'RUNTIME_OBSERVATION_MISSING' });
    assert.equal(f.checks['runtime.probe.preview.result'], undefined); assert.equal(f.events.at(-1), 'POST');
    const before = f.events.length; await assert.rejects(f.verify(adapter), { code: 'RUNTIME_PROBE_READBACK_REQUIRED' });
    assert.equal(f.events.length, before); assert.equal(f.requests.length, 1);
  }
});

test('validity expiring during the HTTP round trip stops before result append', async () => {
  const f = fixture(); f.state.changeRuntime = () => { f.state.now += 120000; };
  await assert.rejects(f.verify(f.adapter()), { code: 'RUNTIME_PROBE_RESULT_STALE' });
  assert.equal(f.checks['runtime.probe.preview.result'], undefined); assert.equal(f.events.at(-1), 'POST'); assert.equal(f.requests.length, 1);
});

test('unknown transport and runtime mismatch leave intent consumed, no result RPC or automatic retry', async () => {
  for (const outcome of ['throw', 'http', 'wrong-source', 'mismatch']) {
    const f = fixture(), adapter = f.adapter(); f.state.outcome = outcome;
    if (outcome === 'wrong-source') f.state.changeRuntime = r => { r.sourceDigest = 'f'.repeat(64); };
    if (outcome === 'mismatch') f.state.changeRuntime = r => { r.flags.FCOS_ENABLE_FCUNO_FEDERATION.value = false; };
    await assert.rejects(f.verify(adapter), { code: outcome === 'mismatch' ? 'PREVIEW_RUNTIME_MISMATCH' : 'RUNTIME_OBSERVATION_MISSING' });
    assert.equal(f.checks['runtime.probe.preview.result'], undefined); assert.equal(f.requests.length, 1);
    assert.equal(f.events.at(-1), 'POST'); const before = f.events.length;
    await assert.rejects(f.verify(adapter), { code: 'RUNTIME_PROBE_READBACK_REQUIRED' }); assert.equal(f.events.length, before);
    await assert.rejects(f.verify(f.adapter()), { code: 'RUNTIME_PROBE_READBACK_REQUIRED' });
    assert.equal(f.requests.length, 1); assert.equal(f.events.at(-1), 'snapshot');
  }
});

test('unresolved persisted intent on a fresh adapter blocks before any provider read', async () => {
  const f = fixture(); f.state.outcome = 'throw';
  await assert.rejects(f.verify(f.adapter()), { code: 'RUNTIME_OBSERVATION_MISSING' });
  f.events.length = 0;
  await assert.rejects(f.verify(f.adapter()), { code: 'RUNTIME_PROBE_READBACK_REQUIRED' });
  assert.deepEqual(f.events, ['snapshot']);
  assert.equal(f.requests.length, 1);
});

test('stale, changed or orphaned persisted evidence refuses without HTTP or a result append', async () => {
  for (const change of [
    f => { f.state.now += (PREVIEW_PARITY_POLICY.maxAgeSeconds + 1) * 1000; },
    f => { f.checks['runtime.probe.preview.intent'].result.requestId = '22222222-2222-5222-8222-222222222222'; },
    f => { f.checks['runtime.probe.preview.result'].result.deploymentId = 'dpl_FOREIGN'; },
    f => { f.checks['runtime.probe.preview.result'].result.runtime.secret = SECRET; },
    f => { delete f.checks['runtime.probe.preview.intent']; },
    f => { f.checks['runtime.probe.preview.result'].capturedAt = new Date(now + 1).toISOString(); },
  ]) {
    const f = fixture(); await f.verify(f.adapter()); change(f); f.events.length = 0;
    await assert.rejects(f.verify(f.adapter()), error => /^RUNTIME_PROBE_(?:RESULT_STALE|RESULT_CHANGED|INTENT_CHANGED)$/.test(error.code));
    assert.deepEqual(f.events, ['snapshot']); assert.equal(f.requests.length, 1);
  }
});

test('snapshot and intent ACK refusals stop before token or HTTP, including ambiguous throw', async () => {
  for (const change of [
    f => { f.state.snapshotChange = s => { s.epoch++; }; },
    f => { f.state.snapshotChange = s => { s.registration.manifest_hash = H; }; },
    f => { f.state.snapshotChange = s => { delete s.checks; }; },
    f => { f.state.intentAck = null; },
    f => { f.state.intentAck = { appended: false }; },
    f => { f.state.intentAck = { appended: true, unexpected: true }; },
    f => { f.state.intentAck = new Error(SECRET); },
  ]) {
    const f = fixture(); change(f); const adapter = f.adapter(); await assert.rejects(f.verify(adapter));
    assert.equal(f.requests.length, 0); assert.equal(f.events.includes('token'), false); assert.equal(f.events.includes('result'), false);
    const before = f.events.length; await assert.rejects(f.verify(adapter), { code: 'RUNTIME_PROBE_READBACK_REQUIRED' }); assert.equal(f.events.length, before);
  }
});

test('invalid result ACK does not return success or permit local replay', async () => {
  const f = fixture(), adapter = f.adapter(); f.state.resultAck = { appended: false };
  await assert.rejects(f.verify(adapter), { code: 'RUNTIME_PROBE_RESULT_ACK_INVALID' });
  assert.equal(f.requests.length, 1); const before = f.events.length;
  await assert.rejects(f.verify(adapter), { code: 'RUNTIME_PROBE_READBACK_REQUIRED' }); assert.equal(f.events.length, before);
});

test('persisted Production results cannot add raw private fields hidden from the parity predicate', async () => {
  for (const change of [r => { r.auth.xero.access_token = SECRET; },
    r => { r.flags.FCOS_ENABLE_FCUNO_FEDERATION.raw = SECRET; }, r => { r.safety.raw = SECRET; }]) {
    const f = fixture({ phase: 'staged' }); await f.verify(f.adapter()); change(f.checks['runtime.probe.staged.result'].result.runtime);
    f.events.length = 0; await assert.rejects(f.verify(f.adapter()), { code: 'RUNTIME_PROBE_RESULT_STALE' });
    assert.deepEqual(f.events, ['snapshot']); assert.equal(f.requests.length, 1);
  }
});

test('one adapter admits only one concurrent first probe', async () => {
  const f = fixture(), adapter = f.adapter();
  const results = await Promise.allSettled([f.verify(adapter), f.verify(adapter)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'RUNTIME_PROBE_READBACK_REQUIRED'); assert.equal(f.requests.length, 1);
});

test('Preview, staged and live phases receive distinct stable request UUIDs', async () => {
  const ids = [];
  for (const phase of ['preview', 'staged', 'live']) {
    const f = fixture({ phase }); await f.verify(f.adapter()); const requestId = f.requests[0].requestId; ids.push(requestId);
    const repeated = fixture({ phase }); repeated.state.now += 5000; await repeated.verify(repeated.adapter());
    assert.equal(repeated.requests[0].requestId, requestId);
  }
  assert.equal(new Set(ids).size, 3);
});

test('opt-in requires coordinator capability and rejects unknown protocol before provider callbacks', async () => {
  for (const coordinator of [undefined, { snapshot: async () => ({}) }, { appendEvidence: async () => ({ appended: true }) }]) {
    const f = fixture(); await assert.rejects(f.verify(f.adapter({ coordinator })), { code: 'RUNTIME_PROBE_COORDINATOR_REQUIRED' }); assert.deepEqual(f.events, []);
  }
  const f = fixture(), adapter = f.adapter(); f.manifest.runtime.probeProtocol = 'unknown';
  await assert.rejects(f.verify(adapter), { code: 'RUNTIME_PROBE_PROTOCOL' }); assert.deepEqual(f.events, []);
});

test('legacy adapter retains action-only request and never invokes a journal', async () => {
  const f = fixture({ legacy: true }); await f.verify(f.adapter({ coordinator: undefined }));
  assert.deepEqual(f.requests, [{ action: 'probe' }]); assert.equal(f.events.includes('snapshot'), false);
});
