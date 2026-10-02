import assert from 'node:assert/strict';
import test from 'node:test';
import { collectPreviewEmailSignerEvidence, PREVIEW_EMAIL_SIGNER_BODY, PREVIEW_EMAIL_SIGNER_MAILBOX_REGISTRY_ID,
  previewEmailSignerEnabled, previewEmailSignerEvidenceVerified, previewEmailSignerSourceHashes, previewEmailSignerSourceProof } from '../scripts/lib/preview-email-signer.mjs';

const sha = 'ff8859b287009e20462c5c0cceff89ae12f13010';
const otherSha = 'ee28300d25470fa9ca9a6dda37b3752287f20f19';
const sourceDigest = 'a'.repeat(64);
const origin = 'https://fcos-abcdefghi-hocheunglai-6535s-projects.vercel.app';
const deploymentId = 'dpl_signer_fixture';
const now = 1_790_000_000_000;

function signedEnvelope(overrides = {}) {
  const payload = {
    mailboxId: PREVIEW_EMAIL_SIGNER_MAILBOX_REGISTRY_ID,
    messageId: PREVIEW_EMAIL_SIGNER_BODY.messageId,
    attachmentId: PREVIEW_EMAIL_SIGNER_BODY.attachmentId,
    expiresAt: now + 5 * 60_000,
    ...overrides.payload,
  };
  const token = overrides.token || `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${Buffer.alloc(32, 7).toString('base64url')}`;
  return {
    token,
    url: `/api/email-router-attachment?token=${encodeURIComponent(token)}`,
    expiresAt: new Date(payload.expiresAt).toISOString(),
    ...overrides.envelope,
  };
}

function response(envelope = signedEnvelope(), overrides = {}) {
  return {
    status: 200,
    ok: true,
    redirected: false,
    url: `${origin}/api/functions/emailRouterAttachmentUrl`,
    json: async () => envelope,
    ...overrides,
  };
}

async function collect({ responseValue = response(), originValue = origin, shaValue = sha, digestValue = sourceDigest,
  nowValue = now, fetchImpl } = {}) {
  return collectPreviewEmailSignerEvidence({ origin: originValue, deploymentId, sha: shaValue, sourceDigest: digestValue,
    bearerToken: 'private-normal-role-fixture', protectionBypass: 'private-bypass-fixture', now: () => nowValue,
    fetchImpl: fetchImpl || (async () => responseValue) });
}

test('the exception is enabled only for the two reviewed immutable candidates and pins exact source bytes', () => {
  assert.equal(previewEmailSignerEnabled(sha), true);
  assert.equal(previewEmailSignerEnabled(otherSha), true);
  assert.equal(previewEmailSignerEnabled('a'.repeat(40)), false);
  for (const commit of [sha, otherSha]) {
    const hashes = previewEmailSignerSourceHashes(commit);
    assert.deepEqual(previewEmailSignerSourceProof({ commit }), hashes);
    assert.deepEqual(Object.keys(hashes).sort(), ['api/_emailRouterCore.js', 'api/_emailRouterHandlers.js', 'api/functions/[name].js'].sort());
    assert.ok(Object.values(hashes).every(value => /^[0-9a-f]{64}$/.test(value)));
  }
  assert.throws(() => previewEmailSignerSourceHashes('a'.repeat(40)));
  assert.throws(() => previewEmailSignerSourceProof({ commit: sha, cwd: '/private/tmp/not-a-repository' }));
});

test('the signing probe sends only the bounded synthetic request and exports sanitized proof', async () => {
  const calls = [];
  const evidence = await collect({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return response();
  } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${origin}/api/functions/emailRouterAttachmentUrl`);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.body, '{"messageId":"fcos-verification-message","attachmentId":"fcos-verification-attachment"}');
  assert.deepEqual(JSON.parse(calls[0].options.body), PREVIEW_EMAIL_SIGNER_BODY);
  assert.deepEqual(Object.keys(JSON.parse(calls[0].options.body)).sort(), ['attachmentId', 'messageId']);
  assert.equal(evidence.result, 'pass');
  assert.equal(evidence.noAttachmentFetch, true);
  assert.equal(evidence.mailboxRegistryId, PREVIEW_EMAIL_SIGNER_MAILBOX_REGISTRY_ID);
  assert.deepEqual(evidence.sourceHashes, previewEmailSignerSourceHashes(sha));
  assert.equal(previewEmailSignerEvidenceVerified(evidence, { deployment: { id: deploymentId, sha }, sourceDigest, now }), true);
  const serialized = JSON.stringify(evidence);
  for (const privateValue of ['private-normal-role-fixture', 'private-bypass-fixture', signedEnvelope().token, signedEnvelope().url, signedEnvelope().expiresAt]) {
    assert.doesNotMatch(serialized, new RegExp(privateValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('wrong origin, status, redirects, malformed tokens and expired tokens cannot produce signer evidence', async () => {
  let calls = 0;
  await assert.rejects(() => collect({ originValue: 'http://fcos-abcdefghi-hocheunglai-6535s-projects.vercel.app', fetchImpl: async () => { calls += 1; return response(); } }));
  assert.equal(calls, 0);
  for (const badResponse of [response(signedEnvelope(), { status: 403, ok: false }), response(signedEnvelope(), { redirected: true }),
    response(signedEnvelope(), { url: 'https://foreign.example/collect' }), response(signedEnvelope({ token: 'not-a-token' })),
    response(signedEnvelope({ payload: { expiresAt: now - 1 } })), response(signedEnvelope({ payload: { expiresAt: now + 1 } }))]) {
    await assert.rejects(() => collect({ responseValue: badResponse }));
  }
});

test('mailbox and synthetic IDs, envelope extras, deployment and source changes are fail-closed', async () => {
  for (const badEnvelope of [
    signedEnvelope({ payload: { mailboxId: 'e7a386ee-3d81-43be-b330-537205ef57ed' } }),
    signedEnvelope({ payload: { messageId: 'other-message' } }),
    signedEnvelope({ payload: { attachmentId: 'other-attachment' } }),
    signedEnvelope({ payload: { extra: true } }),
    signedEnvelope({ envelope: { extra: true } }),
  ]) await assert.rejects(() => collect({ responseValue: response(badEnvelope) }));
  let sourceFailureFetches = 0;
  await assert.rejects(() => collect({ shaValue: 'b'.repeat(40), fetchImpl: async () => { sourceFailureFetches += 1; return response(); } }));
  assert.equal(sourceFailureFetches, 0);
  await assert.rejects(() => collect({ digestValue: 'not-a-source-digest' }));
  const evidence = await collect();
  for (const changed of [
    { deploymentId: 'dpl_other' }, { sourceDigest: 'b'.repeat(64) }, { capturedAt: new Date(now - 30 * 60_001).toISOString() },
    { sourceHashes: { ...evidence.sourceHashes, 'api/_emailRouterCore.js': '0'.repeat(64) } }, { extra: true },
  ]) assert.throws(() => previewEmailSignerEvidenceVerified({ ...evidence, ...changed }, { deployment: { id: deploymentId, sha }, sourceDigest, now }));
});

test('provider error content is never preserved in diagnostics or evidence', async () => {
  const secret = 'private-signing-provider-detail';
  await assert.rejects(() => collect({ fetchImpl: async () => { throw new Error(secret); } }), error => {
    assert.doesNotMatch(error.message, new RegExp(secret));
    assert.equal(error.message, 'Preview Email Router signer evidence is unavailable.');
    return true;
  });
});
