import { createHash } from 'node:crypto';
import { validateAccountInsightReportPresetConfig } from './_accountInsightReport.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fail = (message, status = 400) => Object.assign(new Error(message), { status, expose: true, code: 'ACCOUNT_INSIGHT_PRESET' });
const serialize = (row) => ({ id: row.id, ownerUserId: row.owner_user_id, scope: row.scope, name: row.name, configuration: row.configuration, revision: row.revision, archivedAt: row.archived_at, updatedAt: row.updated_at });
const PRESENTATION_KEYS = new Set(['audience', 'sections', 'columns', 'depth', 'includeExpected', 'includeCharts']);

function presentationConfiguration(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw fail('Choose a report presentation before saving.');
  if (typeof value.audience !== 'string' || !['internal', 'buyer', 'supplier'].includes(value.audience.trim())) throw fail('Choose an audience for this preset.');
  for (const key of Object.keys(value)) if (!PRESENTATION_KEYS.has(key)) throw fail('Saved presets contain presentation choices only.');
  return validateAccountInsightReportPresetConfig(value);
}

function actor(context) {
  if (!context?.profile?.active || !UUID.test(context.profile.id || '')) throw fail('Sign in with an active FCOS account.', 403);
  return context.profile.id;
}

export async function listAccountInsightReportPresets(context) {
  const userId = actor(context);
  const { data, error } = await context.client.from('account_insight_report_presets')
    .select('id,owner_user_id,scope,name,configuration,revision,archived_at,updated_at')
    .is('archived_at', null).or(`owner_user_id.eq.${userId},scope.eq.company`).order('updated_at', { ascending: false }).limit(501);
  if (error) throw error;
  if ((data || []).length > 500) throw fail('Too many report presets. Archive unused presets before continuing.', 413);
  return { presets: (data || []).map(serialize) };
}

export async function saveAccountInsightReportPreset(context, body, { archive = false, manageCompanyPresets = false } = {}) {
  const userId = actor(context);
  if (!body || Array.isArray(body) || typeof body !== 'object') throw fail('Preset details are required.');
  if (!['personal', 'company'].includes(body.scope)) throw fail('Choose Personal or Company preset.');
  if (body.scope === 'company' && !manageCompanyPresets) throw fail('Only the active General Manager or an Administrator may manage company presets.', 403);
  if (body.id != null && !UUID.test(body.id)) throw fail('Preset is invalid.');
  if (!UUID.test(body.idempotencyKey || '')) throw fail('A valid save request key is required.');
  if (archive && !body.id) throw fail('Choose a preset to archive.');
  const expectedRevision = body.expectedRevision ?? 0;
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw fail('Reload the preset before saving.', 409);
  const name = archive ? null : String(body.name || '').trim();
  if (!archive && (!name || name.length > 80)) throw fail('Enter a preset name up to 80 characters.');
  const configuration = archive ? null : presentationConfiguration(body.configuration);
  const request = { id: body.id || null, name, scope: body.scope, configuration, expectedRevision, archive };
  const { data, error } = await context.client.rpc('save_account_insight_report_preset', {
    p_actor_user_id: userId, p_id: request.id, p_name: name, p_scope: body.scope,
    p_configuration: configuration, p_expected_revision: expectedRevision,
    p_idempotency_key: body.idempotencyKey,
    p_request_hash: createHash('sha256').update(JSON.stringify(request)).digest('hex'),
    p_archive: archive,
  });
  if (error?.code === '40001') throw fail('This preset changed or the request key was reused. Reload it before saving.', 409);
  if (error?.code === '42501') throw fail('This preset is not available to your account.', 403);
  if (error) throw error;
  return { preset: serialize(data) };
}
