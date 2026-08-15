import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const SALESFORCE_ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
export const PAYMENT_REMINDER_PREVIEW_TTL_MS = 5 * 60 * 1000;

function operationError(message, status = 409, code = 'PAYMENT_REMINDER_OPERATION_FAILED') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function canonicalEmails(value) {
  const entries = Array.isArray(value) ? value : String(value || '').split(/[;,\n]/);
  return [...new Set(entries.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean))].sort();
}

function canonicalStemIds(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item || '').trim())
    .filter((item) => SALESFORCE_ID.test(item)))].sort();
}

function canonicalBatches(value) {
  return (Array.isArray(value) ? value : [])
    .map((batch) => ({
      key: String(batch?.key || '').trim(),
      stemIds: canonicalStemIds(batch?.stemIds),
      to: canonicalEmails(batch?.to),
      cc: canonicalEmails(batch?.cc),
      bcc: canonicalEmails(batch?.bcc),
    }))
    .filter((batch) => batch.key)
    .sort((left, right) => left.key.localeCompare(right.key));
}

export function paymentReminderRequestHash(input = {}) {
  return createHash('sha256').update(JSON.stringify({
    anchorStemId: String(input.anchorStemId || input.stemId || '').trim(),
    stemIds: canonicalStemIds(input.stemIds || input.invoiceStemIds),
    recipientBatches: canonicalBatches(input.recipientBatches),
    subjectHash: createHash('sha256').update(String(input.subject || '')).digest('hex'),
    bodyHash: createHash('sha256').update(String(input.body || '')).digest('hex'),
  })).digest('hex');
}

export function paymentReminderBatchHash(batch = {}, message = {}) {
  return createHash('sha256').update(JSON.stringify({
    batch: canonicalBatches([batch])[0] || null,
    subjectHash: createHash('sha256').update(String(message.subject || '')).digest('hex'),
    bodyHash: createHash('sha256').update(String(message.body || message.html || '')).digest('hex'),
  })).digest('hex');
}

export function paymentReminderPreviewSecret(env = process.env, explicitSecret = null) {
  const secret = String(
    explicitSecret
      || env.FCOS_PAYMENT_REMINDER_PREVIEW_SECRET
      || env.FCOS_SPECIAL_TERMS_PREVIEW_SECRET
      || env.SUPABASE_SERVICE_ROLE_KEY
      || '',
  ).trim();
  if (secret.length < 32) {
    throw operationError(
      'Payment reminder preparation is unavailable because its signing key is not configured.',
      503,
      'PAYMENT_REMINDER_PREVIEW_SECRET_MISSING',
    );
  }
  return secret;
}

export function signPaymentReminderPreview(payload, secret, now = Date.now()) {
  const value = {
    ...payload,
    issuedAt: now,
    expiresAt: now + PAYMENT_REMINDER_PREVIEW_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(`payment-reminder-preview-v1:${encoded}`)
    .digest('base64url');
  return `${encoded}.${signature}`;
}

export function verifyPaymentReminderPreview(token, secret, now = Date.now()) {
  const [encoded, suppliedSignature, ...rest] = String(token || '').split('.');
  if (!encoded || !suppliedSignature || rest.length) {
    throw operationError('The payment reminder review is invalid. Reopen it before sending.', 409, 'PAYMENT_REMINDER_PREVIEW_INVALID');
  }
  const expectedSignature = createHmac('sha256', secret)
    .update(`payment-reminder-preview-v1:${encoded}`)
    .digest('base64url');
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw operationError('The payment reminder review is invalid. Reopen it before sending.', 409, 'PAYMENT_REMINDER_PREVIEW_INVALID');
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw operationError('The payment reminder review is invalid. Reopen it before sending.', 409, 'PAYMENT_REMINDER_PREVIEW_INVALID');
  }
  if (!Number.isFinite(payload?.expiresAt) || payload.expiresAt <= now) {
    throw operationError('The payment reminder review expired. Reopen it before sending.', 409, 'PAYMENT_REMINDER_PREVIEW_EXPIRED');
  }
  return payload;
}

function assertRpc(result, fallbackMessage) {
  if (result?.error) throw operationError(result.error.message || fallbackMessage, 409);
  return result?.data || null;
}

export async function reservePaymentReminderOperation(client, values) {
  const result = await client.rpc('reserve_buyer_invoice_payment_reminder_operation', {
    p_idempotency_key: values.idempotencyKey,
    p_request_hash: values.requestHash,
    p_anchor_stem_id: values.anchorStemId,
    p_selected_stem_ids: canonicalStemIds(values.selectedStemIds),
    p_batch_count: Number(values.batchCount || 0),
    p_actor_user_id: values.actorUserId,
    p_actor_email: values.actorEmail,
  });
  return assertRpc(result, 'The payment reminder operation could not be reserved.');
}

export async function reservePaymentReminderBatch(client, values) {
  const result = await client.rpc('reserve_buyer_invoice_payment_reminder_batch', {
    p_operation_id: values.operationId,
    p_batch_key_hash: values.batchKeyHash,
    p_request_hash: values.requestHash,
    p_stem_ids: canonicalStemIds(values.stemIds),
    p_row_count: Number(values.rowCount || 0),
    p_recipient_count: Number(values.recipientCount || 0),
  });
  return assertRpc(result, 'The payment reminder batch could not be reserved.');
}

export async function completePaymentReminderBatch(client, values) {
  const result = await client.rpc('complete_buyer_invoice_payment_reminder_batch', {
    p_operation_id: values.operationId,
    p_batch_key_hash: values.batchKeyHash,
    p_status: values.status,
    p_provider_request_id: values.providerRequestId || null,
    p_graph_ms: Number.isFinite(values.graphMs) ? Math.max(0, Math.round(values.graphMs)) : null,
    p_error_code: values.errorCode || null,
  });
  return assertRpc(result, 'The payment reminder batch outcome could not be recorded.');
}

export async function completePaymentReminderOperation(client, values) {
  const result = await client.rpc('complete_buyer_invoice_payment_reminder_operation', {
    p_operation_id: values.operationId,
    p_status: values.status,
    p_accepted_batch_count: Number(values.acceptedBatchCount || 0),
    p_failed_batch_count: Number(values.failedBatchCount || 0),
    p_timeline_recorded: values.timelineRecorded === true,
    p_prepare_ms: Number.isFinite(values.prepareMs) ? Math.max(0, Math.round(values.prepareMs)) : null,
    p_validation_ms: Number.isFinite(values.validationMs) ? Math.max(0, Math.round(values.validationMs)) : null,
    p_graph_ms: Number.isFinite(values.graphMs) ? Math.max(0, Math.round(values.graphMs)) : null,
    p_timeline_ms: Number.isFinite(values.timelineMs) ? Math.max(0, Math.round(values.timelineMs)) : null,
    p_result_snapshot: values.resultSnapshot || {},
    p_error_code: values.errorCode || null,
  });
  return assertRpc(result, 'The payment reminder operation outcome could not be recorded.');
}

export async function savePaymentReminderTimeline(client, values) {
  const result = await client.rpc('save_buyer_invoice_payment_reminder_timeline', {
    p_operation_id: values.operationId,
    p_rows: Array.isArray(values.rows) ? values.rows : [],
    p_actor_user_id: values.actorUserId,
    p_actor_email: values.actorEmail,
  });
  return assertRpc(result, 'The payment reminder timeline could not be recorded.');
}

export async function repairPaymentReminderTimelines(client, limit = 20) {
  const result = await client.rpc('repair_buyer_invoice_payment_reminder_timelines', {
    p_limit: Math.max(1, Math.min(Number(limit) || 20, 100)),
  });
  return assertRpc(result, 'Pending payment reminder timelines could not be repaired.');
}

export function paymentReminderDeliveryUncertain(error) {
  return error?.mailDeliveryUncertain === true
    || error?.fcosUpdateUncertain === true
    || String(error?.code || '') === 'MICROSOFT_GRAPH_SEND_UNCERTAIN';
}

export async function mapPaymentReminderBatches(items, worker, limit = 3) {
  const source = Array.isArray(items) ? items : [];
  const results = new Array(source.length);
  let cursor = 0;
  const runnerCount = Math.min(Math.max(1, Number(limit) || 1), source.length);
  const runners = Array.from({ length: runnerCount }, async () => {
    while (cursor < source.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(source[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export const paymentReminderOperationInternals = {
  canonicalBatches,
  canonicalEmails,
  canonicalStemIds,
};
