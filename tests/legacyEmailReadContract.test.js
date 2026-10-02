import assert from 'node:assert/strict';
import test from 'node:test';
import { PREVIEW_EMAIL_SIGNER_BODY } from '../scripts/lib/preview-email-signer.mjs';
import { normalRoleReadRequest } from '../scripts/lib/normal-role-read-requests.mjs';

test('the retained Preview signer exception admits only its exact synthetic two-key request', () => {
  assert.equal(normalRoleReadRequest('emailRouterAttachmentUrl', PREVIEW_EMAIL_SIGNER_BODY), true);
  assert.equal(normalRoleReadRequest('emailRouterAttachmentUrl', { ...PREVIEW_EMAIL_SIGNER_BODY }), true);
  assert.deepEqual(Object.keys(PREVIEW_EMAIL_SIGNER_BODY), ['messageId', 'attachmentId']);
});

test('arbitrary attachment identifiers, nested values, aliases and extra keys are denied', () => {
  const rejected = [
    {}, { messageId: PREVIEW_EMAIL_SIGNER_BODY.messageId }, { attachmentId: PREVIEW_EMAIL_SIGNER_BODY.attachmentId },
    { messageId: 'other-message', attachmentId: PREVIEW_EMAIL_SIGNER_BODY.attachmentId },
    { messageId: PREVIEW_EMAIL_SIGNER_BODY.messageId, attachmentId: 'other-attachment' },
    { messageId: PREVIEW_EMAIL_SIGNER_BODY.messageId, attachmentId: PREVIEW_EMAIL_SIGNER_BODY.attachmentId, force: false },
    { messageId: { value: PREVIEW_EMAIL_SIGNER_BODY.messageId }, attachmentId: PREVIEW_EMAIL_SIGNER_BODY.attachmentId },
    { messageId: PREVIEW_EMAIL_SIGNER_BODY.messageId, attachmentId: { id: PREVIEW_EMAIL_SIGNER_BODY.attachmentId } },
    { message_id: PREVIEW_EMAIL_SIGNER_BODY.messageId, attachment_id: PREVIEW_EMAIL_SIGNER_BODY.attachmentId },
    Object.assign(Object.create(null), PREVIEW_EMAIL_SIGNER_BODY),
  ];
  for (const body of rejected) assert.equal(normalRoleReadRequest('emailRouterAttachmentUrl', body), false, JSON.stringify(body));
  assert.equal(normalRoleReadRequest('emailRouterAttachmentStream', PREVIEW_EMAIL_SIGNER_BODY), false);
  assert.equal(normalRoleReadRequest('emailRouterAttachmentUrl', null), false);
  assert.equal(normalRoleReadRequest('emailRouterAttachmentUrl', []), false);
});
