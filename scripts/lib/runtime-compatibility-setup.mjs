import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fcosConnectionIdentifier } from '../../config/fcosConnections.js';
import { githubProviderTimestamp } from './github-provider-timestamp.mjs';

export const DURABLE_SETUP_MODE = 'durable-setup-v2';
export const DURABLE_SETUP_CONTRACT_SHA256 = 'a22557be43d23f6b85993966a8714f5fe298e26f5fb086a989dee94cb655fda9';
const bytes = readFileSync(new URL('../../config/runtime-compatibility-setup.json', import.meta.url));
if (createHash('sha256').update(bytes).digest('hex') !== DURABLE_SETUP_CONTRACT_SHA256) throw new Error('Durable setup policy bytes differ.');
export const DURABLE_SETUP_POLICY = Object.freeze(JSON.parse(bytes));
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const iso = value => githubProviderTimestamp(value) && new Date(Date.parse(value)).toISOString() === value;
const fail = () => { throw new Error('Durable Preview setup differs or expired; no action authority.'); };
export function isDurableSuccessorSetup(context) {
  return context?.schemaVersion === 2 && context.kind === 'fcos_exact_04ee_setup_context'
    && context.contractSha256 === DURABLE_SETUP_CONTRACT_SHA256;
}

// These are original creation/cleanup clocks, not observation clocks. No run,
// upload, review or successful read can extend the owned settings' lifetime.
export function durableSuccessorSetupDeadline(context, now = Date.now()) {
  if (!isDurableSuccessorSetup(context) || !Number.isFinite(now)
    || ![context.provisionedAt, context.setupExpiresAt, context.cleanupDeadline].every(iso)) fail();
  const start = Date.parse(context.provisionedAt), expiry = Date.parse(context.setupExpiresAt), cleanup = Date.parse(context.cleanupDeadline);
  if (start > now || expiry <= now || expiry <= start || expiry > cleanup
    || expiry - start > DURABLE_SETUP_POLICY.maxSetupLifetimeSeconds * 1000) fail();
  return expiry;
}

const recordKeys = ['id', 'key', 'type', 'target', 'gitBranch', 'createdAt', 'updatedAt', 'comment'];
const settings = { tenantRecordId: 'FCOS_MICROSOFT_TENANT_ID', clientRecordId: 'FCOS_MICROSOFT_CLIENT_ID',
  attachmentRecordId: 'FCOS_EMAIL_ROUTER_ATTACHMENT_SECRET' };
export function assertDurableSetupMetadata(context, now = Date.now()) {
  durableSuccessorSetupDeadline(context, now);
  if (!exact(context.recordMetadata, Object.keys(settings))) fail();
  for (const [name, key] of Object.entries(settings)) {
    const row = context.recordMetadata[name], attachment = name === 'attachmentRecordId';
    if (!exact(row, recordKeys) || row.id !== context.records?.[name] || row.key !== key
      || row.type !== (attachment ? 'sensitive' : 'plain') || !Array.isArray(row.target) || row.target.length !== 1 || row.target[0] !== 'preview'
      || row.gitBranch !== context.branch || !Number.isSafeInteger(row.createdAt) || row.createdAt <= 0
      || !Number.isSafeInteger(row.updatedAt) || row.updatedAt < row.createdAt || row.updatedAt > Date.parse(context.provisionedAt)
      || row.comment !== null && (typeof row.comment !== 'string' || row.comment.length > 1000)
      || attachment && row.comment !== `Dedicated read-only Preview signing key ${context.attachmentOperationId}; no Production credential copied`) fail();
  }
  return true;
}
// Compare every non-secret metadata field. A changed, duplicate, missing or late
// record fails closed; this function has no repair, rotation or write adapter.
export function assertDurableSetupRecordReadback(context, snapshot, now = Date.now()) {
  assertDurableSetupMetadata(context, now);
  if (snapshot?.projectId !== fcosConnectionIdentifier('vercel', 'Project ID') || snapshot?.teamId !== fcosConnectionIdentifier('vercel', 'Team ID')
    || snapshot?.complete !== true || !Array.isArray(snapshot.records) || !iso(snapshot.capturedAt)
    || Date.parse(snapshot.capturedAt) > now || now - Date.parse(snapshot.capturedAt) > 600000) fail();
  for (const [name, key] of Object.entries(settings)) {
    const matches = snapshot.records.filter(row => row.key === key && row.gitBranch === context.branch && row.target?.includes('preview'));
    const actual = matches[0], expected = context.recordMetadata[name];
    if (matches.length !== 1 || !exact(actual, recordKeys)
      || recordKeys.some(k => JSON.stringify(actual[k]) !== JSON.stringify(expected[k]))) fail();
  }
  return true;
}
