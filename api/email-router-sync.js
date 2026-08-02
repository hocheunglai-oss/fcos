import { timingSafeEqual } from 'node:crypto';
import { createEmailRouterServiceClient, currentEmailRouterMailbox, syncEmailRouterFolderFromStoredCursor } from './_emailRouterCore.js';

const CONTRACT_VERSION = 'emailrouter-fcos-operational-migration/v1';
const ALLOWED_FOLDERS = new Set(['inbox', 'sentitems', 'archive']);

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

function bearer(req) {
  return String(req.headers?.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1] || '';
}

function authorized(req, expected) {
  const supplied = bearer(req);
  return Boolean(expected && supplied && Buffer.byteLength(expected) === Buffer.byteLength(supplied)
    && timingSafeEqual(Buffer.from(expected), Buffer.from(supplied)));
}

async function requestBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function validateRequest(value) {
  const folders = Array.isArray(value?.folders) ? value.folders : [];
  if (value?.contractVersion !== CONTRACT_VERSION
      || value?.operation !== 'rebuild_mail_metadata'
      || value?.mailboxPurposeKey !== 'email_router_mailbox'
      || !/^[0-9a-f]{64}$/.test(String(value?.idempotencyKey || ''))
      || folders.length !== 3
      || folders.some((folder) => !ALLOWED_FOLDERS.has(folder))) {
    throw Object.assign(new Error('Invalid Email Router synchronization request.'), { status: 400 });
  }
  return { folders: [...new Set(folders)], idempotencyKey: value.idempotencyKey };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  if (!authorized(req, String(process.env.FCOS_EMAIL_ROUTER_SYNC_SECRET || '').trim())) {
    return json(res, 401, { error: 'Synchronization authorization failed.' });
  }
  try {
    const request = validateRequest(await requestBody(req));
    const client = createEmailRouterServiceClient();
    const mailbox = await currentEmailRouterMailbox(client);
    const results = {};
    let complete = true;
    for (const folder of request.folders) {
      let result = null;
      let pages = 0;
      let synced = 0;
      let removed = 0;
      for (let cycle = 0; cycle < 10; cycle += 1) {
        result = await syncEmailRouterFolderFromStoredCursor({ client, mailbox, folder, maxPages: 10 });
        pages += result.pages;
        synced += result.synced;
        removed += result.removed;
        if (!result.nextLink) break;
      }
      results[folder] = { synced, removed, pages, complete: !result?.nextLink };
      if (result?.nextLink) complete = false;
    }
    if (!complete) return json(res, 409, { error: 'Mailbox synchronization is still in progress. Run the migration synchronization again.', results });

    const schema = client.schema('emailrouter');
    const { data: migrationRun, error: readError } = await schema.from('migration_runs').select('id').order('applied_at', { ascending: false }).limit(1).maybeSingle();
    if (readError || !migrationRun) throw Object.assign(new Error('Email Router migration state is unavailable.'), { status: 503 });
    const { error: updateError } = await schema.from('migration_runs').update({ metadata_sync_fingerprint: request.idempotencyKey }).eq('id', migrationRun.id);
    if (updateError) throw updateError;
    const { error: eventError } = await schema.from('events').insert({
      event_type: 'migration.metadata_sync_completed',
      entity_type: 'mailbox_connection',
      entity_id: mailbox.id,
      idempotency_key: request.idempotencyKey,
    });
    if (eventError && eventError.code !== '23505') throw eventError;
    return json(res, 200, { ok: true, results });
  } catch (error) {
    const code = String(error.code || 'EMAIL_ROUTER_SYNC_FAILED')
      .replaceAll(/[^a-zA-Z0-9_.-]/g, '_')
      .slice(0, 120);
    return json(res, error.status || error.statusCode || 500, {
      error: error.message || 'Email Router synchronization failed.',
      code,
    });
  }
}
