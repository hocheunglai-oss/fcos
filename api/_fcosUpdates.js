import { createHash } from 'node:crypto';
import { APP_VERSION_HISTORY } from '../src/lib/appVersion.js';
import {
  createSmtpTransport,
  sendWithSmtp,
  smtpAuthenticatedFromAddress,
} from './_smtp.js';

export const FCOS_UPDATE_CATEGORIES = Object.freeze([
  { id: 'new_feature', label: 'New Feature' },
  { id: 'improved_logic', label: 'Improved Logic' },
  { id: 'major_bug_fix', label: 'Major Bug Fix' },
]);

const CATEGORY_IDS = new Set(FCOS_UPDATE_CATEGORIES.map((category) => category.id));
const EDITABLE_BATCH_STATUSES = new Set(['Draft', 'Revision Requested', 'Pending Approval', 'Approved']);
const REASON_MIN_LENGTH = 8;
const REASON_MAX_LENGTH = 255;
const INTERRUPTED_DELIVERY_MINUTES = 15;
const UPDATE_TABLE_PATTERN = /fcos_update_(settings|items|batches|batch_items|deliveries|events)/i;

function updateError(message, status = 400, code = 'FCOS_UPDATE_ERROR', details = undefined) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function isMissingUpdateSchema(error) {
  return error?.code === '42P01'
    || error?.code === 'PGRST205'
    || UPDATE_TABLE_PATTERN.test(String(error?.message || ''));
}

function throwUpdateSchemaError(error) {
  if (isMissingUpdateSchema(error)) {
    throw updateError(
      'FCOS Update Emails is not configured yet. Apply the latest Supabase migration before using this workflow.',
      503,
      'FCOS_UPDATE_SCHEMA_MISSING',
    );
  }
  throw error;
}

function cleanText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function validateRequiredText(value, label, minLength, maxLength) {
  const text = cleanText(value, maxLength + 1);
  if (text.length < minLength || text.length > maxLength) {
    throw updateError(`${label} must contain between ${minLength} and ${maxLength.toLocaleString()} characters.`);
  }
  return text;
}

function validateOptionalText(value, label, maxLength) {
  const text = String(value || '').trim();
  if (text.length > maxLength) throw updateError(`${label} must not exceed ${maxLength.toLocaleString()} characters.`);
  return text;
}

function validateReason(value, label) {
  return validateRequiredText(value, label, REASON_MIN_LENGTH, REASON_MAX_LENGTH);
}

function normalizeCategory(value) {
  const category = String(value || '').trim();
  if (!CATEGORY_IDS.has(category)) {
    throw updateError('Classify every update as New Feature, Improved Logic, or Major Bug Fix.');
  }
  return category;
}

export function inferFcosUpdateCategory(text, title = '') {
  const value = `${title} ${text}`.toLowerCase();
  if (/\b(add|added|introduc|launch|new |created|enabled|support)\w*/.test(value)) return 'new_feature';
  if (/\b(correct|fixed|fix |prevent|restor|resolv|repair|blocked|harden)\w*/.test(value)) return 'major_bug_fix';
  return 'improved_logic';
}

function sourceHash(release, change, changeIndex) {
  return createHash('sha256')
    .update(JSON.stringify({
      version: release.version,
      releasedAt: release.releasedAt,
      title: release.title,
      changeIndex,
      change,
    }))
    .digest('hex');
}

export function fcosUpdateSourceCandidates(history = APP_VERSION_HISTORY, backfillStart) {
  const start = String(backfillStart || '').slice(0, 10);
  return history
    .filter((release) => String(release?.releasedAt || '').slice(0, 10) >= start)
    .flatMap((release) => (release.changes || []).map((change, changeIndex) => ({
      source_version: String(release.version || '').trim(),
      source_release_date: String(release.releasedAt || '').slice(0, 10),
      source_change_index: changeIndex,
      source_title: cleanText(release.title, 200),
      source_text: cleanText(change, 4000),
      source_hash: sourceHash(release, change, changeIndex),
      category: inferFcosUpdateCategory(change, release.title),
      email_title: cleanText(release.title, 200),
      email_body: cleanText(change, 4000),
    })))
    .filter((item) => item.source_version && item.source_release_date && item.source_title && item.source_text);
}

function redactError(value) {
  return cleanText(
    String(value || 'Email delivery failed.')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]'),
    1000,
  );
}

function serializeItem(row = {}) {
  return {
    id: row.id,
    sourceVersion: row.source_version,
    sourceReleaseDate: row.source_release_date,
    sourceChangeIndex: row.source_change_index,
    sourceTitle: row.source_title,
    sourceText: row.source_text,
    sourceChanged: row.source_changed === true,
    category: row.category,
    emailTitle: row.email_title,
    emailBody: row.email_body,
    copyEdited: row.copy_edited === true,
    status: row.status,
    assignedBatchId: row.assigned_batch_id || null,
    revision: Number(row.revision || 0),
    editedByEmail: row.edited_by_email || null,
    editedAt: row.edited_at || null,
    skippedByEmail: row.skipped_by_email || null,
    skippedAt: row.skipped_at || null,
    skipReason: row.skip_reason || null,
    restoredByEmail: row.restored_by_email || null,
    restoredAt: row.restored_at || null,
    restoreReason: row.restore_reason || null,
    sentAt: row.sent_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeDelivery(row = {}) {
  return {
    id: row.id,
    batchId: row.batch_id,
    userId: row.user_id,
    recipientName: row.recipient_name || '',
    recipientEmail: row.recipient_email || '',
    status: row.status,
    attemptCount: Number(row.attempt_count || 0),
    messageId: row.email_message_id || null,
    lastError: row.last_error || null,
    lastAttemptAt: row.last_attempt_at || null,
    sentAt: row.sent_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeBatchItem(row = {}) {
  const source = row.fcos_update_items || row.item || null;
  return {
    id: row.id,
    batchId: row.batch_id,
    itemId: row.item_id,
    sortOrder: Number(row.sort_order || 0),
    category: row.category,
    emailTitle: row.email_title,
    emailBody: row.email_body,
    itemRevisionSnapshot: Number(row.item_revision_snapshot || 0),
    source: source ? serializeItem(source) : null,
  };
}

function serializeBatch(row = {}) {
  return {
    id: row.id,
    status: row.status,
    subject: row.subject || '',
    introduction: row.introduction || '',
    closing: row.closing || '',
    revision: Number(row.revision || 0),
    approvedRevision: row.approved_revision == null ? null : Number(row.approved_revision),
    recipientCount: Number(row.recipient_count || 0),
    sentCount: Number(row.sent_count || 0),
    failedCount: Number(row.failed_count || 0),
    uncertainCount: Number(row.uncertain_count || 0),
    createdByEmail: row.created_by_email || null,
    updatedByEmail: row.updated_by_email || null,
    submittedByEmail: row.submitted_by_email || null,
    submittedAt: row.submitted_at || null,
    approvedByEmail: row.approved_by_email || null,
    approvedAt: row.approved_at || null,
    returnedByEmail: row.returned_by_email || null,
    returnedAt: row.returned_at || null,
    returnReason: row.return_reason || null,
    cancelledByEmail: row.cancelled_by_email || null,
    cancelledAt: row.cancelled_at || null,
    cancellationReason: row.cancellation_reason || null,
    sendStartedByEmail: row.send_started_by_email || null,
    sendStartedAt: row.send_started_at || null,
    completedAt: row.completed_at || null,
    items: (row.fcos_update_batch_items || row.items || [])
      .map(serializeBatchItem)
      .sort((left, right) => left.sortOrder - right.sortOrder),
    deliveries: (row.fcos_update_deliveries || row.deliveries || [])
      .map(serializeDelivery)
      .sort((left, right) => left.recipientName.localeCompare(right.recipientName)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function writeEvent(client, {
  itemId = null,
  batchId = null,
  deliveryId = null,
  type,
  actor = null,
  summary,
  metadata = {},
}) {
  const { error } = await client.from('fcos_update_events').insert({
    item_id: itemId,
    batch_id: batchId,
    delivery_id: deliveryId,
    event_type: type,
    actor_user_id: actor?.id || null,
    actor_email: actor?.email || null,
    summary: cleanText(summary, 1000),
    metadata,
  });
  if (error) throwUpdateSchemaError(error);
}

async function isGeneralManager(client, profile) {
  const { data, error } = await client.rpc('fcos_update_is_general_manager', {
    p_user_id: profile.id,
  });
  if (error) throwUpdateSchemaError(error);
  return data === true;
}

async function requireGeneralManager(client, profile) {
  if (!await isGeneralManager(client, profile)) {
    throw updateError(
      'Only the active General Manager assigned to Vincent Lee can perform this action.',
      403,
      'GENERAL_MANAGER_REQUIRED',
    );
  }
}

async function loadSettings(client) {
  const { data, error } = await client
    .from('fcos_update_settings')
    .select('id,initial_backfill_start,last_synced_at,last_synced_version')
    .eq('id', 'default')
    .maybeSingle();
  if (error) throwUpdateSchemaError(error);
  if (!data) throw updateError('FCOS Update Email settings are missing.', 503, 'FCOS_UPDATE_SETTINGS_MISSING');
  return data;
}

export async function syncFcosUpdateItems({ client, profile }) {
  const settings = await loadSettings(client);
  const candidates = fcosUpdateSourceCandidates(APP_VERSION_HISTORY, settings.initial_backfill_start);
  const { data: stored, error: storedError } = await client
    .from('fcos_update_items')
    .select('id,source_version,source_change_index,source_hash,copy_edited,status,revision,email_title,email_body')
    .gte('source_release_date', settings.initial_backfill_start);
  if (storedError) throwUpdateSchemaError(storedError);

  const byKey = new Map((stored || []).map((item) => [
    `${item.source_version}:${item.source_change_index}`,
    item,
  ]));
  let imported = 0;
  let changed = 0;

  for (const candidate of candidates) {
    const key = `${candidate.source_version}:${candidate.source_change_index}`;
    const existing = byKey.get(key);
    if (!existing) {
      const { data, error } = await client
        .from('fcos_update_items')
        .insert({
          ...candidate,
          status: 'Pending',
          revision: 1,
        })
        .select('id')
        .single();
      if (error?.code === '23505') continue;
      if (error) throwUpdateSchemaError(error);
      imported += 1;
      await writeEvent(client, {
        itemId: data.id,
        type: 'update_imported',
        actor: profile,
        summary: `Version ${candidate.source_version} update imported for review.`,
        metadata: {
          version: candidate.source_version,
          changeIndex: candidate.source_change_index,
        },
      });
      continue;
    }
    if (existing.source_hash === candidate.source_hash) continue;

    const patch = {
      source_release_date: candidate.source_release_date,
      source_title: candidate.source_title,
      source_text: candidate.source_text,
      source_hash: candidate.source_hash,
      source_changed: true,
      revision: Number(existing.revision || 0) + 1,
    };
    if (!existing.copy_edited && existing.status === 'Pending') {
      patch.email_title = candidate.email_title;
      patch.email_body = candidate.email_body;
    }
    const { data: updated, error } = await client
      .from('fcos_update_items')
      .update(patch)
      .eq('id', existing.id)
      .eq('revision', existing.revision)
      .select('id')
      .maybeSingle();
    if (error) throwUpdateSchemaError(error);
    if (!updated) continue;
    changed += 1;
    await writeEvent(client, {
      itemId: existing.id,
      type: 'source_changed',
      actor: profile,
      summary: `Version ${candidate.source_version} source release note changed.`,
      metadata: {
        version: candidate.source_version,
        changeIndex: candidate.source_change_index,
      },
    });
  }

  const latestVersion = candidates[0]?.source_version || settings.last_synced_version || null;
  const { error: settingsError } = await client
    .from('fcos_update_settings')
    .update({
      last_synced_at: new Date().toISOString(),
      last_synced_version: latestVersion,
    })
    .eq('id', 'default');
  if (settingsError) throwUpdateSchemaError(settingsError);

  return { imported, changed, latestVersion, backfillStart: settings.initial_backfill_start };
}

const ITEM_SELECT = [
  'id',
  'source_version',
  'source_release_date',
  'source_change_index',
  'source_title',
  'source_text',
  'source_changed',
  'category',
  'email_title',
  'email_body',
  'copy_edited',
  'status',
  'assigned_batch_id',
  'revision',
  'edited_by_email',
  'edited_at',
  'skipped_by_email',
  'skipped_at',
  'skip_reason',
  'restored_by_email',
  'restored_at',
  'restore_reason',
  'sent_at',
  'created_at',
  'updated_at',
].join(',');

const BATCH_SELECT = [
  'id',
  'status',
  'subject',
  'introduction',
  'closing',
  'revision',
  'approved_revision',
  'recipient_count',
  'sent_count',
  'failed_count',
  'uncertain_count',
  'created_by_email',
  'updated_by_email',
  'submitted_by_email',
  'submitted_at',
  'approved_by_email',
  'approved_at',
  'returned_by_email',
  'returned_at',
  'return_reason',
  'cancelled_by_email',
  'cancelled_at',
  'cancellation_reason',
  'send_started_by_email',
  'send_started_at',
  'completed_at',
  'created_at',
  'updated_at',
  `fcos_update_batch_items(
    id,batch_id,item_id,sort_order,category,email_title,email_body,item_revision_snapshot,
    fcos_update_items(${ITEM_SELECT})
  )`,
  'fcos_update_deliveries(id,batch_id,user_id,recipient_name,recipient_email,status,attempt_count,email_message_id,last_error,last_attempt_at,sent_at,created_at,updated_at)',
].join(',');

export async function listFcosUpdates({ client, profile, sync = true }) {
  let syncResult = null;
  if (sync) syncResult = await syncFcosUpdateItems({ client, profile });
  await recoverInterruptedFcosUpdateDeliveries(client, profile);

  const [itemsResult, batchesResult, recipientsResult, settings, generalManager] = await Promise.all([
    client
      .from('fcos_update_items')
      .select(ITEM_SELECT)
      .order('source_release_date', { ascending: false })
      .order('source_version', { ascending: false })
      .order('source_change_index', { ascending: true }),
    client
      .from('fcos_update_batches')
      .select(BATCH_SELECT)
      .order('updated_at', { ascending: false })
      .limit(200),
    client
      .from('user_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('active', true),
    loadSettings(client),
    isGeneralManager(client, profile),
  ]);
  if (itemsResult.error) throwUpdateSchemaError(itemsResult.error);
  if (batchesResult.error) throwUpdateSchemaError(batchesResult.error);
  if (recipientsResult.error) throw recipientsResult.error;

  const items = (itemsResult.data || []).map(serializeItem);
  const batches = (batchesResult.data || []).map(serializeBatch);
  const counters = {
    pending: items.filter((item) => item.status === 'Pending' && !item.assignedBatchId).length,
    batches: batches.filter((batch) => !['Sent', 'Cancelled'].includes(batch.status)).length,
    sent: items.filter((item) => item.status === 'Sent').length,
    skipped: items.filter((item) => item.status === 'Skipped').length,
    failed: batches.filter((batch) => batch.status === 'Partial Failure').length,
  };

  return {
    items,
    batches,
    counters,
    activeRecipientCount: Number(recipientsResult.count || 0),
    authority: {
      canPrepare: profile.user_type === 'administrator',
      canControl: generalManager,
    },
    settings: {
      backfillStart: settings.initial_backfill_start,
      lastSyncedAt: settings.last_synced_at,
      lastSyncedVersion: settings.last_synced_version,
    },
    sync: syncResult,
    categories: FCOS_UPDATE_CATEGORIES,
  };
}

export async function saveFcosUpdateItem({ client, profile, body }) {
  const itemId = String(body.itemId || '').trim();
  const expectedRevision = Number(body.expectedRevision);
  if (!itemId || !Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw updateError('A current FCOS update revision is required.');
  }
  const category = normalizeCategory(body.category);
  const emailTitle = validateRequiredText(body.emailTitle, 'Update title', 1, 200);
  const emailBody = validateRequiredText(body.emailBody, 'Update description', 1, 4000);

  const { data: current, error: currentError } = await client
    .from('fcos_update_items')
    .select(ITEM_SELECT)
    .eq('id', itemId)
    .maybeSingle();
  if (currentError) throwUpdateSchemaError(currentError);
  if (!current) throw updateError('FCOS update was not found.', 404);
  if (Number(current.revision) !== expectedRevision) {
    throw updateError('This FCOS update was changed by another Administrator.', 409, 'REVISION_CONFLICT', {
      item: serializeItem(current),
    });
  }
  if (current.status !== 'Pending' || current.assigned_batch_id) {
    throw updateError('Only unassigned pending updates can be edited.', 409);
  }

  const { data, error } = await client
    .from('fcos_update_items')
    .update({
      category,
      email_title: emailTitle,
      email_body: emailBody,
      copy_edited: emailTitle !== current.source_title || emailBody !== current.source_text,
      source_changed: false,
      revision: expectedRevision + 1,
      edited_by: profile.id,
      edited_by_email: profile.email,
      edited_at: new Date().toISOString(),
    })
    .eq('id', itemId)
    .eq('revision', expectedRevision)
    .eq('status', 'Pending')
    .is('assigned_batch_id', null)
    .select(ITEM_SELECT)
    .maybeSingle();
  if (error) throwUpdateSchemaError(error);
  if (!data) throw updateError('This FCOS update changed before it could be saved.', 409, 'REVISION_CONFLICT');
  await writeEvent(client, {
    itemId,
    type: 'update_edited',
    actor: profile,
    summary: `Version ${current.source_version} update wording edited.`,
    metadata: { version: current.source_version, category },
  });
  return { item: serializeItem(data) };
}

function normalizeBatchItems(value) {
  if (!Array.isArray(value) || !value.length) throw updateError('Select at least one FCOS update.');
  const seen = new Set();
  return value.map((item, index) => {
    const itemId = String(item?.itemId || '').trim();
    if (!itemId || seen.has(itemId)) throw updateError('Each selected FCOS update must be unique.');
    seen.add(itemId);
    return {
      itemId,
      sortOrder: index,
      category: normalizeCategory(item.category),
      emailTitle: validateRequiredText(item.emailTitle, 'Update title', 1, 200),
      emailBody: validateRequiredText(item.emailBody, 'Update description', 1, 4000),
      expectedRevision: Number(item.expectedRevision),
    };
  });
}

export async function saveFcosUpdateBatch({ client, profile, body }) {
  const batchId = body.batchId ? String(body.batchId).trim() : null;
  const expectedRevision = batchId ? Number(body.expectedRevision) : 0;
  if (batchId && (!Number.isInteger(expectedRevision) || expectedRevision < 1)) {
    throw updateError('A current email batch revision is required.');
  }
  const items = normalizeBatchItems(body.items);
  if (items.some((item) => !Number.isInteger(item.expectedRevision) || item.expectedRevision < 1)) {
    throw updateError('Every update must include its current revision.');
  }

  const { data, error } = await client.rpc('save_fcos_update_batch', {
    p_batch_id: batchId,
    p_expected_revision: expectedRevision,
    p_subject: validateRequiredText(body.subject, 'Email subject', 1, 200),
    p_introduction: validateOptionalText(body.introduction, 'Email introduction', 2000),
    p_closing: validateOptionalText(body.closing, 'Email closing', 1000),
    p_items: items,
    p_actor_id: profile.id,
    p_actor_email: profile.email,
  });
  if (error) {
    if (error.code === '40001') throw updateError(error.message, 409, 'REVISION_CONFLICT');
    if (error.code === '23505') throw updateError(error.message, 409, 'UPDATE_ALREADY_ASSIGNED');
    throwUpdateSchemaError(error);
  }
  return { batch: serializeBatch(data) };
}

async function loadBatch(client, batchId) {
  const { data, error } = await client
    .from('fcos_update_batches')
    .select(BATCH_SELECT)
    .eq('id', batchId)
    .maybeSingle();
  if (error) throwUpdateSchemaError(error);
  if (!data) throw updateError('FCOS update email batch was not found.', 404);
  return data;
}

function requireExpectedBatchRevision(batch, body) {
  const expectedRevision = Number(body.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw updateError('Refresh this email before continuing.', 409, 'REVISION_CONFLICT', {
      batch: serializeBatch(batch),
    });
  }
  if (expectedRevision !== Number(batch.revision)) {
    throw updateError('This FCOS update email changed after it was opened.', 409, 'REVISION_CONFLICT', {
      batch: serializeBatch(batch),
    });
  }
  return expectedRevision;
}

async function updateBatchWithRevision(client, batch, patch) {
  const nextRevision = Number(batch.revision || 0) + 1;
  const { data, error } = await client
    .from('fcos_update_batches')
    .update({ ...patch, revision: nextRevision })
    .eq('id', batch.id)
    .eq('revision', batch.revision)
    .select(BATCH_SELECT)
    .maybeSingle();
  if (error) throwUpdateSchemaError(error);
  if (!data) throw updateError('This FCOS update email changed before the action completed.', 409, 'REVISION_CONFLICT');
  return data;
}

export async function submitFcosUpdateBatch({ client, profile, body }) {
  const batch = await loadBatch(client, body.batchId);
  requireExpectedBatchRevision(batch, body);
  if (!['Draft', 'Revision Requested'].includes(batch.status)) {
    throw updateError('Only a Draft or Revision Requested email can be submitted.');
  }
  if (!batch.fcos_update_batch_items?.length) throw updateError('Select at least one FCOS update.');
  const updated = await updateBatchWithRevision(client, batch, {
    status: 'Pending Approval',
    submitted_by: profile.id,
    submitted_by_email: profile.email,
    submitted_at: new Date().toISOString(),
    approved_revision: null,
    updated_by: profile.id,
    updated_by_email: profile.email,
  });
  await writeEvent(client, {
    batchId: batch.id,
    type: 'batch_submitted',
    actor: profile,
    summary: 'FCOS update email submitted for General Manager approval.',
    metadata: { itemCount: batch.fcos_update_batch_items.length, revision: updated.revision },
  });
  return { batch: serializeBatch(updated) };
}

export async function approveFcosUpdateBatch({ client, profile, body }) {
  await requireGeneralManager(client, profile);
  const batch = await loadBatch(client, body.batchId);
  requireExpectedBatchRevision(batch, body);
  if (batch.status !== 'Pending Approval') throw updateError('Only a Pending Approval email can be approved.');
  if (!batch.fcos_update_batch_items?.length) throw updateError('Select at least one FCOS update.');

  for (const batchItem of batch.fcos_update_batch_items) {
    const item = batchItem.fcos_update_items;
    if (!item || item.status !== 'Pending' || item.assigned_batch_id !== batch.id) {
      throw updateError('A selected update is no longer available. Return the email for revision.', 409);
    }
    if (Number(item.revision) !== Number(batchItem.item_revision_snapshot)) {
      throw updateError('A selected update changed after submission. Return the email for revision.', 409);
    }
  }

  const nextRevision = Number(batch.revision) + 1;
  const updated = await updateBatchWithRevision(client, batch, {
    status: 'Approved',
    approved_revision: nextRevision,
    approved_by: profile.id,
    approved_by_email: profile.email,
    approved_at: new Date().toISOString(),
    updated_by: profile.id,
    updated_by_email: profile.email,
  });
  await writeEvent(client, {
    batchId: batch.id,
    type: 'batch_approved',
    actor: profile,
    summary: 'FCOS update email approved.',
    metadata: { itemCount: batch.fcos_update_batch_items.length, revision: updated.revision },
  });
  return { batch: serializeBatch(updated) };
}

export async function returnFcosUpdateBatch({ client, profile, body }) {
  await requireGeneralManager(client, profile);
  const reason = validateReason(body.reason, 'Return reason');
  const batch = await loadBatch(client, body.batchId);
  requireExpectedBatchRevision(batch, body);
  if (!['Pending Approval', 'Approved'].includes(batch.status)) {
    throw updateError('Only a pending or approved unsent email can be returned for revision.');
  }
  const updated = await updateBatchWithRevision(client, batch, {
    status: 'Revision Requested',
    approved_revision: null,
    approved_by: null,
    approved_by_email: null,
    approved_at: null,
    returned_by: profile.id,
    returned_by_email: profile.email,
    returned_at: new Date().toISOString(),
    return_reason: reason,
    updated_by: profile.id,
    updated_by_email: profile.email,
  });
  await writeEvent(client, {
    batchId: batch.id,
    type: 'batch_returned',
    actor: profile,
    summary: 'FCOS update email returned for revision.',
    metadata: { reason, revision: updated.revision },
  });
  return { batch: serializeBatch(updated) };
}

export async function cancelFcosUpdateBatch({ client, profile, body }) {
  const reason = validateReason(body.reason, 'Cancellation reason');
  const batch = await loadBatch(client, body.batchId);
  const expectedRevision = requireExpectedBatchRevision(batch, body);
  if (!EDITABLE_BATCH_STATUSES.has(batch.status)) {
    throw updateError('This FCOS update email can no longer be cancelled.');
  }
  if (['Pending Approval', 'Approved'].includes(batch.status)) {
    await requireGeneralManager(client, profile);
  }

  const { data, error } = await client.rpc('cancel_fcos_update_batch', {
    p_batch_id: batch.id,
    p_expected_revision: expectedRevision,
    p_reason: reason,
    p_actor_id: profile.id,
    p_actor_email: profile.email,
  });
  if (error?.code === '40001') {
    throw updateError(error.message, 409, 'REVISION_CONFLICT', {
      batch: serializeBatch(await loadBatch(client, batch.id)),
    });
  }
  if (error?.code === '42501') throw updateError(error.message, 403, 'GENERAL_MANAGER_REQUIRED');
  if (error) throwUpdateSchemaError(error);
  return { batch: serializeBatch(data) };
}

export async function skipFcosUpdateItem({ client, profile, body }) {
  await requireGeneralManager(client, profile);
  const reason = validateReason(body.reason, 'Skip reason');
  const { data: item, error: itemError } = await client
    .from('fcos_update_items')
    .select(ITEM_SELECT)
    .eq('id', body.itemId)
    .maybeSingle();
  if (itemError) throwUpdateSchemaError(itemError);
  if (!item) throw updateError('FCOS update was not found.', 404);
  if (item.status !== 'Pending' || item.assigned_batch_id) {
    throw updateError('Only an unassigned pending update can be skipped.');
  }
  if (Number(item.revision) !== Number(body.expectedRevision)) {
    throw updateError('This FCOS update was changed by another Administrator.', 409, 'REVISION_CONFLICT');
  }
  const { data, error } = await client
    .from('fcos_update_items')
    .update({
      status: 'Skipped',
      revision: Number(item.revision) + 1,
      skipped_by: profile.id,
      skipped_by_email: profile.email,
      skipped_at: new Date().toISOString(),
      skip_reason: reason,
    })
    .eq('id', item.id)
    .eq('revision', item.revision)
    .select(ITEM_SELECT)
    .maybeSingle();
  if (error) throwUpdateSchemaError(error);
  if (!data) throw updateError('This FCOS update changed before it could be skipped.', 409);
  await writeEvent(client, {
    itemId: item.id,
    type: 'update_skipped',
    actor: profile,
    summary: `Version ${item.source_version} update skipped.`,
    metadata: { reason, version: item.source_version },
  });
  return { item: serializeItem(data) };
}

export async function restoreFcosUpdateItem({ client, profile, body }) {
  await requireGeneralManager(client, profile);
  const reason = validateReason(body.reason, 'Restore reason');
  const { data: item, error: itemError } = await client
    .from('fcos_update_items')
    .select(ITEM_SELECT)
    .eq('id', body.itemId)
    .maybeSingle();
  if (itemError) throwUpdateSchemaError(itemError);
  if (!item) throw updateError('FCOS update was not found.', 404);
  if (item.status !== 'Skipped') throw updateError('Only a skipped update can be restored.');
  if (Number(item.revision) !== Number(body.expectedRevision)) {
    throw updateError('This FCOS update was changed by another Administrator.', 409, 'REVISION_CONFLICT');
  }
  const { data, error } = await client
    .from('fcos_update_items')
    .update({
      status: 'Pending',
      revision: Number(item.revision) + 1,
      restored_by: profile.id,
      restored_by_email: profile.email,
      restored_at: new Date().toISOString(),
      restore_reason: reason,
    })
    .eq('id', item.id)
    .eq('revision', item.revision)
    .select(ITEM_SELECT)
    .maybeSingle();
  if (error) throwUpdateSchemaError(error);
  if (!data) throw updateError('This FCOS update changed before it could be restored.', 409);
  await writeEvent(client, {
    itemId: item.id,
    type: 'update_restored',
    actor: profile,
    summary: `Version ${item.source_version} update restored to review.`,
    metadata: { reason, version: item.source_version },
  });
  return { item: serializeItem(data) };
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function paragraphHtml(value) {
  return escapeHtml(value).replaceAll('\n', '<br>');
}

function categoryLabel(value) {
  return FCOS_UPDATE_CATEGORIES.find((category) => category.id === value)?.label || 'FCOS Update';
}

export function buildFcosUpdateEmail(batch, publicUrl) {
  const items = [...(batch.fcos_update_batch_items || batch.items || [])]
    .sort((left, right) => Number(left.sort_order ?? left.sortOrder) - Number(right.sort_order ?? right.sortOrder));
  const subject = validateRequiredText(batch.subject, 'Email subject', 1, 200);
  const introduction = validateOptionalText(batch.introduction, 'Email introduction', 2000);
  const closing = validateOptionalText(batch.closing, 'Email closing', 1000);
  const url = new URL(publicUrl).toString();

  const htmlItems = items.map((item) => {
    const source = item.fcos_update_items || item.source || {};
    const category = item.category;
    const title = item.email_title ?? item.emailTitle;
    const body = item.email_body ?? item.emailBody;
    return `
      <section style="margin:0 0 18px;padding:16px;border:1px solid #dbe3ef;border-radius:6px;background:#ffffff">
        <div style="margin-bottom:8px;color:#1d4ed8;font-size:12px;font-weight:700;text-transform:uppercase">${escapeHtml(categoryLabel(category))}</div>
        <h2 style="margin:0 0 8px;color:#0f172a;font-size:17px;line-height:1.35">${escapeHtml(title)}</h2>
        <p style="margin:0 0 10px;color:#334155;font-size:14px;line-height:1.6">${paragraphHtml(body)}</p>
        <div style="color:#64748b;font-size:12px">Version ${escapeHtml(source.source_version ?? source.sourceVersion ?? '')} · ${escapeHtml(source.source_release_date ?? source.sourceReleaseDate ?? '')}</div>
      </section>
    `;
  }).join('');

  const html = `<!doctype html>
  <html>
    <body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a">
      <div style="max-width:680px;margin:0 auto;padding:28px 16px">
        <div style="margin-bottom:18px">
          <div style="color:#1d4ed8;font-size:13px;font-weight:700">FCOS</div>
          <h1 style="margin:4px 0 8px;font-size:24px;line-height:1.25">System updates</h1>
          ${introduction ? `<p style="margin:0;color:#475569;font-size:14px;line-height:1.6">${paragraphHtml(introduction)}</p>` : ''}
        </div>
        ${htmlItems}
        ${closing ? `<p style="margin:18px 0;color:#475569;font-size:14px;line-height:1.6">${paragraphHtml(closing)}</p>` : ''}
        <a href="${escapeHtml(url)}" style="display:inline-block;margin-top:4px;padding:10px 16px;border-radius:6px;background:#1d4ed8;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700">Open FCOS</a>
        <p style="margin:24px 0 0;color:#94a3b8;font-size:11px;line-height:1.5">This operational update was sent to active FCOS users.</p>
      </div>
    </body>
  </html>`;

  const textItems = items.map((item) => {
    const source = item.fcos_update_items || item.source || {};
    return [
      categoryLabel(item.category),
      item.email_title ?? item.emailTitle,
      item.email_body ?? item.emailBody,
      `Version ${source.source_version ?? source.sourceVersion ?? ''} · ${source.source_release_date ?? source.sourceReleaseDate ?? ''}`,
    ].join('\n');
  }).join('\n\n');
  const text = [
    'FCOS system updates',
    introduction,
    textItems,
    closing,
    `Open FCOS: ${url}`,
    'This operational update was sent to active FCOS users.',
  ].filter(Boolean).join('\n\n');

  return { subject, html, text };
}

async function updateBatchDeliverySummary(client, batchId, actor) {
  const { data, error } = await client.rpc('finalize_fcos_update_delivery', {
    p_batch_id: batchId,
    p_actor_id: actor.id,
    p_actor_email: actor.email,
  });
  if (error) throwUpdateSchemaError(error);
  return {
    total: Number(data?.total || 0),
    sent: Number(data?.sent || 0),
    failed: Number(data?.failed || 0),
    uncertain: Number(data?.uncertain || 0),
    pending: Number(data?.pending || 0),
    status: data?.status || 'Partial Failure',
  };
}

async function markInterruptedFcosUpdateDeliveries(client, batchId, actor) {
  const now = new Date().toISOString();
  const { error: uncertainError } = await client
    .from('fcos_update_deliveries')
    .update({
      status: 'Uncertain',
      last_error: 'Delivery started, but FCOS could not confirm whether SMTP completed. Confirm before retrying.',
      last_attempt_at: now,
    })
    .eq('batch_id', batchId)
    .eq('status', 'Sending');
  if (uncertainError) throwUpdateSchemaError(uncertainError);

  const { error: failedError } = await client
    .from('fcos_update_deliveries')
    .update({
      status: 'Failed',
      last_error: 'Delivery stopped before SMTP submission. Manual retry is required.',
      last_attempt_at: now,
    })
    .eq('batch_id', batchId)
    .eq('status', 'Pending');
  if (failedError) throwUpdateSchemaError(failedError);

  return updateBatchDeliverySummary(client, batchId, actor);
}

async function recoverInterruptedFcosUpdateDeliveries(client, profile) {
  const cutoff = new Date(Date.now() - INTERRUPTED_DELIVERY_MINUTES * 60 * 1000).toISOString();
  const { data: staleBatches, error } = await client
    .from('fcos_update_batches')
    .select('id,send_started_by,send_started_by_email')
    .eq('status', 'Sending')
    .or(`send_started_at.lt.${cutoff},send_started_at.is.null`);
  if (error) throwUpdateSchemaError(error);

  for (const batch of staleBatches || []) {
    const actor = batch.send_started_by
      ? { id: batch.send_started_by, email: batch.send_started_by_email || profile.email }
      : profile;
    const summary = await markInterruptedFcosUpdateDeliveries(client, batch.id, actor);
    await writeEvent(client, {
      batchId: batch.id,
      type: 'delivery_interrupted',
      summary: 'An interrupted FCOS update delivery was moved to manual review.',
      metadata: summary,
    });
  }
}

async function processFcosUpdateDeliveries({
  client,
  profile,
  batch,
  transporter,
  statuses,
}) {
  const publicUrl = String(process.env.FCOS_PUBLIC_URL || '').trim();
  if (!publicUrl) {
    throw updateError('FCOS_PUBLIC_URL is required before update emails can be sent.', 503, 'FCOS_PUBLIC_URL_MISSING');
  }
  const senderName = cleanText(process.env.FCOS_UPDATE_SENDER_NAME || 'FCOS Updates', 100);
  const from = smtpAuthenticatedFromAddress(
    { user: process.env.SMTP_USER },
    `${senderName} <${process.env.SMTP_USER || ''}>`,
  );
  if (!from) throw updateError('SMTP_USER is required before update emails can be sent.', 503, 'SMTP_SENDER_MISSING');
  const message = buildFcosUpdateEmail(batch, publicUrl);
  const { count: eligibleCount, error: eligibleError } = await client
    .from('fcos_update_deliveries')
    .select('id', { count: 'exact', head: true })
    .eq('batch_id', batch.id)
    .in('status', statuses);
  if (eligibleError) throwUpdateSchemaError(eligibleError);
  let remaining = Number(eligibleCount || 0);

  while (remaining > 0) {
    const { data: claimed, error: claimError } = await client.rpc('claim_fcos_update_deliveries', {
      p_batch_id: batch.id,
      p_statuses: statuses,
      p_limit: Math.min(remaining, 100),
    });
    if (claimError) throwUpdateSchemaError(claimError);
    if (!claimed?.length) break;
    remaining -= claimed.length;

    for (let index = 0; index < claimed.length; index += 3) {
      const group = claimed.slice(index, index + 3);
      await Promise.all(group.map(async (delivery) => {
        let result;
        try {
          result = await sendWithSmtp({
            transporter,
            from,
            to: [delivery.recipient_email],
            subject: message.subject,
            html: message.html,
            text: message.text,
          });
          if (!Array.isArray(result.accepted) || result.accepted.length !== 1) {
            throw new Error('The SMTP provider did not accept this recipient.');
          }
        } catch (error) {
          const { error: updateErrorValue } = await client
            .from('fcos_update_deliveries')
            .update({
              status: 'Failed',
              last_error: redactError(error?.message || error),
            })
            .eq('id', delivery.id)
            .eq('status', 'Sending');
          if (updateErrorValue) throwUpdateSchemaError(updateErrorValue);
          return;
        }

        const { data: confirmed, error: sentError } = await client
          .from('fcos_update_deliveries')
          .update({
            status: 'Sent',
            email_message_id: result.id || null,
            provider_result: {
              acceptedCount: result.accepted.length,
              rejectedCount: Array.isArray(result.rejected) ? result.rejected.length : 0,
            },
            sent_at: new Date().toISOString(),
            last_error: null,
          })
          .eq('id', delivery.id)
          .eq('status', 'Sending')
          .select('id')
          .maybeSingle();
        if (!sentError && confirmed) return;

        const { error: uncertainError } = await client
          .from('fcos_update_deliveries')
          .update({
            status: 'Uncertain',
            last_error: 'SMTP accepted the message, but FCOS could not confirm the delivery record.',
          })
          .eq('id', delivery.id)
          .eq('status', 'Sending');
        if (uncertainError) throwUpdateSchemaError(uncertainError);
      }));
    }
  }

  return updateBatchDeliverySummary(client, batch.id, profile);
}

async function activeRecipientRows(client) {
  const { data, error } = await client
    .from('user_profiles')
    .select('id,email,full_name')
    .eq('active', true)
    .order('full_name', { ascending: true })
    .order('email', { ascending: true });
  if (error) throw error;
  if (!data?.length) throw updateError('There are no active FCOS users to receive this update.');
  return data;
}

export async function sendFcosUpdateBatch({ client, profile, body }) {
  await requireGeneralManager(client, profile);
  const batch = await loadBatch(client, body.batchId);
  const expectedRevision = requireExpectedBatchRevision(batch, body);
  if (batch.status !== 'Approved' || Number(batch.approved_revision) !== Number(batch.revision)) {
    throw updateError('Only the current approved revision can be sent.');
  }
  const recipients = await activeRecipientRows(client);
  const expectedRecipientCount = Number(body.expectedRecipientCount);
  if (!Number.isInteger(expectedRecipientCount) || expectedRecipientCount < 1) {
    throw updateError('Refresh the active-recipient count before sending.', 409, 'RECIPIENT_PREFLIGHT_REQUIRED');
  }
  if (expectedRecipientCount !== recipients.length) {
    throw updateError(
      `The active-recipient count changed from ${expectedRecipientCount} to ${recipients.length}. Review the updated count before sending.`,
      409,
      'RECIPIENT_COUNT_CHANGED',
    );
  }
  const transporter = await createSmtpTransport({}, { pool: true, maxConnections: 3, maxMessages: 100 });
  let sendingStarted = false;
  try {
    const { error } = await client.rpc('start_fcos_update_delivery', {
      p_batch_id: batch.id,
      p_expected_revision: expectedRevision,
      p_expected_recipient_count: expectedRecipientCount,
      p_recipients: recipients.map((recipient) => ({
        userId: recipient.id,
        name: recipient.full_name || recipient.email,
        email: String(recipient.email || '').trim().toLowerCase(),
      })),
      p_actor_id: profile.id,
      p_actor_email: profile.email,
    });
    if (error?.code === '40001') {
      throw updateError(error.message, 409, 'REVISION_CONFLICT', {
        batch: serializeBatch(await loadBatch(client, batch.id)),
      });
    }
    if (error?.code === '42501') throw updateError(error.message, 403, 'GENERAL_MANAGER_REQUIRED');
    if (error) throwUpdateSchemaError(error);
    const sendingBatch = await loadBatch(client, batch.id);
    sendingStarted = true;

    const summary = await processFcosUpdateDeliveries({
      client,
      profile,
      batch: sendingBatch,
      transporter,
      statuses: ['Pending'],
    });
    return { batch: serializeBatch(await loadBatch(client, batch.id)), deliverySummary: summary };
  } catch (error) {
    if (sendingStarted) {
      await markInterruptedFcosUpdateDeliveries(client, batch.id, profile).catch(() => {});
    }
    throw error;
  } finally {
    if (typeof transporter.close === 'function') transporter.close();
  }
}

export async function retryFcosUpdateDeliveries({ client, profile, body }) {
  await requireGeneralManager(client, profile);
  const batch = await loadBatch(client, body.batchId);
  requireExpectedBatchRevision(batch, body);
  if (batch.status !== 'Partial Failure') throw updateError('Only a partially failed email can be retried.');
  const includeUncertain = body.includeUncertain === true;
  if (includeUncertain && body.confirmUncertain !== true) {
    throw updateError('Confirm that uncertain deliveries may be sent a second time.');
  }
  const statuses = includeUncertain ? ['Uncertain'] : ['Failed'];
  const eligible = (batch.fcos_update_deliveries || []).filter((delivery) => statuses.includes(delivery.status));
  if (!eligible.length) throw updateError('No eligible failed deliveries remain.');

  const transporter = await createSmtpTransport({}, { pool: true, maxConnections: 3, maxMessages: 100 });
  let retryStarted = false;
  try {
    const { data: retryingBatch, error: batchError } = await client
      .from('fcos_update_batches')
      .update({
        status: 'Sending',
        updated_by: profile.id,
        updated_by_email: profile.email,
        completed_at: null,
      })
      .eq('id', batch.id)
      .eq('status', 'Partial Failure')
      .select('id')
      .maybeSingle();
    if (batchError) throwUpdateSchemaError(batchError);
    if (!retryingBatch) throw updateError('Another delivery retry has already started.', 409, 'REVISION_CONFLICT');
    retryStarted = true;
    const summary = await processFcosUpdateDeliveries({
      client,
      profile,
      batch,
      transporter,
      statuses,
    });
    await writeEvent(client, {
      batchId: batch.id,
      type: 'delivery_retried',
      actor: profile,
      summary: 'FCOS update email delivery retried.',
      metadata: {
        includedUncertain: includeUncertain,
        attemptedCount: eligible.length,
        ...summary,
      },
    });
    return { batch: serializeBatch(await loadBatch(client, batch.id)), deliverySummary: summary };
  } catch (error) {
    if (retryStarted) {
      await markInterruptedFcosUpdateDeliveries(client, batch.id, profile).catch(() => {});
    }
    throw error;
  } finally {
    if (typeof transporter.close === 'function') transporter.close();
  }
}
