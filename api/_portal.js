import { importPKCS8, SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';

const ASSERTION_ALGORITHM = 'ES256';
const ASSERTION_LIFETIME_SECONDS = 60;
const NATIVE_APPLICATION_IDS = new Set(['emailrouter']);
const TARGET_REQUEST_TIMEOUT_MS = 10_000;
const OUTBOX_STALE_LOCK_MS = 5 * 60_000;
const PORTAL_OPERATIONS = new Set(['sync_access', 'launch', 'health', 'revoke_sessions']);
const ASSERTION_ACTIONS = {
  sync_access: 'entitlement_sync',
  launch: 'launch',
  revoke_sessions: 'revoke_sessions',
};

function portalError(message, status = 500, code = 'PORTAL_ERROR') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function normalizedPem(value) {
  return String(value || '').trim().replaceAll('\\n', '\n');
}

function environmentKeyForApplication(applicationId, suffix) {
  return `FCOS_PORTAL_${String(applicationId || '').toUpperCase().replaceAll(/[^A-Z0-9]/g, '_')}_${suffix}`;
}

function applicationBaseUrl(application, env = process.env) {
  const override = env[environmentKeyForApplication(application?.id, 'URL')];
  const raw = String(override || application?.target_base_url || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && env.NODE_ENV === 'production') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function signingConfiguration(env = process.env) {
  const privateKey = normalizedPem(env.FCOS_PORTAL_SIGNING_PRIVATE_KEY);
  const keyId = String(env.FCOS_PORTAL_SIGNING_KEY_ID || '').trim();
  const issuer = String(env.FCOS_PORTAL_ISSUER || '').trim();
  if (!privateKey || !keyId || !issuer) {
    throw portalError(
      'Application launch is not configured. Contact an FCOS administrator.',
      503,
      'PORTAL_SIGNING_NOT_CONFIGURED',
    );
  }
  try {
    const parsed = new URL(issuer);
    if (parsed.protocol !== 'https:' && env.NODE_ENV === 'production') throw new Error('HTTPS required');
  } catch {
    throw portalError(
      'FCOS Portal identity configuration is invalid.',
      503,
      'PORTAL_ISSUER_INVALID',
    );
  }
  return { privateKey, keyId, issuer: issuer.replace(/\/+$/, '') };
}

export function resolveEffectivePortalAccess(profile, application, entitlement = null) {
  if (!profile?.active || application?.application_kind !== 'external') {
    return { active: false, roleId: null, source: null };
  }
  if (['administrator', 'general_manager'].includes(profile.user_type) && application.administrator_default_role) {
    return {
      active: true,
      roleId: application.administrator_default_role,
      source: 'administrator_default',
    };
  }
  if (entitlement?.explicit_active && entitlement.explicit_role_id) {
    return {
      active: true,
      roleId: entitlement.explicit_role_id,
      source: 'explicit',
    };
  }
  return { active: false, roleId: null, source: null };
}

export function validateTargetLaunchUrl(rawUrl, application, env = process.env) {
  const baseUrl = applicationBaseUrl(application, env);
  if (!baseUrl) {
    throw portalError('The target application URL is not configured.', 503, 'PORTAL_TARGET_NOT_CONFIGURED');
  }
  let launchUrl;
  try {
    launchUrl = new URL(String(rawUrl || ''));
  } catch {
    throw portalError('The target application returned an invalid launch address.', 502, 'PORTAL_TARGET_INVALID_RESPONSE');
  }
  if (
    launchUrl.origin !== baseUrl
    || launchUrl.pathname !== '/auth/handoff'
    || launchUrl.username
    || launchUrl.password
    || launchUrl.hash
    || launchUrl.searchParams.size !== 1
  ) {
    throw portalError('The target application returned an untrusted launch address.', 502, 'PORTAL_TARGET_INVALID_RESPONSE');
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(launchUrl.searchParams.get('code') || '')) {
    throw portalError('The target application returned an invalid handoff.', 502, 'PORTAL_TARGET_INVALID_RESPONSE');
  }
  return launchUrl.toString();
}

export function validateTargetEntitlementAcknowledgement(result, entitlement) {
  const expectedRevision = Number(entitlement?.revision);
  const expectedActive = entitlement?.effective_active === true;
  const validUuid = (value) => (
    typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
  if (
    !result
    || !Number.isSafeInteger(expectedRevision)
    || expectedRevision <= 0
    || Number(result.revision) !== expectedRevision
    || result.active !== expectedActive
    || (
      expectedActive
      && (
        result.role !== entitlement.effective_role_id
        || !validUuid(result.appUserId)
        || !validUuid(result.authUserId)
      )
    )
  ) {
    throw portalError(
      'The target application returned an inconsistent access acknowledgement.',
      502,
      'PORTAL_TARGET_INVALID_ACKNOWLEDGEMENT',
    );
  }
  return result;
}

export async function signPortalAssertion({
  application,
  operation,
  profile = null,
  entitlement = null,
  requestId = null,
  reason = null,
  env = process.env,
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  if (!PORTAL_OPERATIONS.has(operation)) throw portalError('Unsupported portal operation.', 400, 'PORTAL_OPERATION_INVALID');
  if (!application?.id) throw portalError('Application is required.', 400, 'PORTAL_APPLICATION_REQUIRED');
  const config = signingConfiguration(env);
  const key = await importPKCS8(config.privateKey, ASSERTION_ALGORITHM);
  const claims = {
    action: ASSERTION_ACTIONS[operation] || operation,
    application_id: application.id,
    request_id: requestId || randomUUID(),
  };
  if (profile) {
    claims.email = String(profile.email || '').trim().toLowerCase();
    claims.display_name = String(profile.full_name || profile.email || '').trim();
    claims.source_active = profile.active === true;
  }
  if (entitlement) {
    claims.entitlement_id = entitlement.id;
    claims.entitlement_revision = Number(entitlement.revision);
    claims.active = entitlement.effective_active === true;
    claims.role = entitlement.effective_role_id || null;
  }
  if (operation === 'sync_access') {
    claims.reason = String(reason || 'FCOS Portal access policy reconciliation').trim();
  }
  if (operation === 'revoke_sessions') {
    claims.reason = String(reason || 'FCOS Portal session revocation').trim();
  }
  return new SignJWT(claims)
    .setProtectedHeader({ alg: ASSERTION_ALGORITHM, kid: config.keyId, typ: 'JWT' })
    .setIssuer(config.issuer)
    .setAudience(application.id)
    .setSubject(profile?.id || config.issuer)
    .setJti(randomUUID())
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + ASSERTION_LIFETIME_SECONDS)
    .sign(key);
}

async function loadPortalCatalog(client) {
  const [applicationsResult, rolesResult] = await Promise.all([
    client.from('portal_applications').select('*').order('sort_order').order('name'),
    client.from('portal_application_roles').select('*').order('sort_order').order('label'),
  ]);
  if (applicationsResult.error) throw applicationsResult.error;
  if (rolesResult.error) throw rolesResult.error;
  const rolesByApplication = {};
  for (const role of rolesResult.data || []) {
    if (!rolesByApplication[role.application_id]) rolesByApplication[role.application_id] = [];
    rolesByApplication[role.application_id].push(role);
  }
  return (applicationsResult.data || []).map((application) => ({
    ...application,
    roles: rolesByApplication[application.id] || [],
  }));
}

async function loadUserEntitlements(client, userId) {
  const { data, error } = await client
    .from('portal_user_app_entitlements')
    .select('*')
    .eq('user_id', userId);
  if (error) throw error;
  return data || [];
}

function effectiveFieldsChanged(entitlement, effective) {
  return Boolean(entitlement?.effective_active) !== effective.active
    || (entitlement?.effective_role_id || null) !== effective.roleId
    || (entitlement?.effective_source || null) !== effective.source;
}

async function queuePortalOperation(client, entitlement, operation, payload = {}, operationKey = null) {
  const idempotencyKey = [
    'portal',
    entitlement.application_id,
    entitlement.user_id,
    operationKey || entitlement.revision,
    operation,
  ].join(':');
  const { error } = await client
    .from('portal_entitlement_outbox')
    .upsert({
      entitlement_id: entitlement.id,
      application_id: entitlement.application_id,
      user_id: entitlement.user_id,
      entitlement_revision: entitlement.revision,
      operation,
      payload,
      idempotency_key: idempotencyKey,
      status: 'pending',
      attempts: 0,
      next_attempt_at: new Date().toISOString(),
      completed_at: null,
      last_error: null,
    }, { onConflict: 'idempotency_key', ignoreDuplicates: true });
  if (error) throw error;
}

async function writePortalEvent(client, {
  applicationId = null,
  targetUserId = null,
  actor = null,
  action,
  outcome,
  requestId = null,
  metadata = {},
}) {
  const { error } = await client.from('portal_access_events').insert({
    application_id: applicationId,
    target_user_id: targetUserId,
    actor_user_id: actor?.id || null,
    actor_email: actor?.email || null,
    action,
    outcome,
    request_id: requestId,
    metadata,
  });
  if (error) console.error('[portal] Audit event write failed.', { action, code: error.code });
}

async function reconcileOneEntitlement(
  client,
  profile,
  application,
  entitlement,
  actor = null,
  forceRevision = false,
) {
  const effective = resolveEffectivePortalAccess(profile, application, entitlement);
  if (!entitlement && !effective.active) return null;
  if (entitlement && !forceRevision && !effectiveFieldsChanged(entitlement, effective)) return entitlement;

  const revision = Number(entitlement?.revision || 0) + 1;
  const row = {
    id: entitlement?.id,
    user_id: profile.id,
    application_id: application.id,
    explicit_active: entitlement?.explicit_active === true,
    explicit_role_id: entitlement?.explicit_role_id || null,
    effective_active: effective.active,
    effective_role_id: effective.roleId,
    effective_source: effective.source,
    revision,
    sync_status: application.protocol === 'internal' ? 'not_required' : 'pending',
    last_sync_error: null,
    updated_by: actor?.id || null,
  };
  if (!row.id) delete row.id;
  let saveResult;
  if (entitlement?.id) {
    const updateRow = { ...row };
    delete updateRow.id;
    saveResult = await client
      .from('portal_user_app_entitlements')
      .update(updateRow)
      .eq('id', entitlement.id)
      .eq('revision', entitlement.revision)
      .select('*')
      .maybeSingle();
  } else {
    saveResult = await client
      .from('portal_user_app_entitlements')
      .insert(row)
      .select('*')
      .single();
  }
  const { data, error } = saveResult;
  if (error?.code === '23505') {
    const { data: latest, error: latestError } = await client
      .from('portal_user_app_entitlements')
      .select('*')
      .eq('user_id', profile.id)
      .eq('application_id', application.id)
      .maybeSingle();
    if (latestError) throw latestError;
    if (latest) {
      return reconcileOneEntitlement(
        client,
        profile,
        application,
        latest,
        actor,
        forceRevision,
      );
    }
  }
  if (error) throw error;
  if (!data) throw portalError('Application access changed. Refresh and try again.', 409, 'PORTAL_REVISION_CONFLICT');
  if (application.protocol !== 'internal') {
    await queuePortalOperation(client, data, 'sync_access');
    if (!effective.active) {
      await queuePortalOperation(client, data, 'revoke_sessions', {
        reason: 'FCOS user access disabled',
      });
    }
  }
  return data;
}

export async function reconcilePortalEntitlementsForProfile(
  client,
  profile,
  actor = null,
  { forceRevision = false, catalog: preloadedCatalog = null } = {},
) {
  const catalog = preloadedCatalog || await loadPortalCatalog(client);
  const existing = await loadUserEntitlements(client, profile.id);
  const byApplication = new Map(existing.map((row) => [row.application_id, row]));
  const reconciled = [];
  for (const application of catalog.filter((item) => item.application_kind === 'external' && !NATIVE_APPLICATION_IDS.has(item.id))) {
    const row = await reconcileOneEntitlement(
      client,
      profile,
      application,
      byApplication.get(application.id) || null,
      actor,
      forceRevision,
    );
    if (row) reconciled.push(row);
  }
  return reconciled;
}

function roleLabel(application, roleId) {
  return application.roles.find((role) => role.id === roleId)?.label || roleId || '';
}

function appConfigurationIssue(application, env = process.env) {
  if (application.application_kind !== 'external') return null;
  if (!applicationBaseUrl(application, env)) return 'Application address is not configured.';
  try {
    signingConfiguration(env);
    return null;
  } catch {
    return 'Secure launch is not configured.';
  }
}

export async function listPortalApplicationsForUser({
  client,
  profile,
  moduleAccess = {},
  env = process.env,
}) {
  const catalog = await loadPortalCatalog(client);
  const reconciled = await reconcilePortalEntitlementsForProfile(client, profile, null, { catalog });
  const entitlementMap = new Map(reconciled.map((row) => [row.application_id, row]));
  const hasFcosAccess = ['administrator', 'general_manager'].includes(profile.user_type)
    || Object.values(moduleAccess || {}).some((allowed) => allowed === true || allowed === 'read' || allowed === 'full');

  return catalog.flatMap((application) => {
    if (NATIVE_APPLICATION_IDS.has(application.id)) return [];
    if (application.application_kind === 'internal') {
      if (!hasFcosAccess) return [];
      return [{
        id: application.id,
        name: application.name,
        description: application.description,
        iconKey: application.icon_key,
        kind: 'internal',
        launchPath: application.launch_path,
        openMode: 'same_tab',
        roleId: 'member',
        roleLabel: 'Member',
        accessSource: 'module_access',
        status: application.status,
        available: application.status === 'active',
        blockingReason: application.status === 'active' ? null : (application.status_message || 'Application unavailable.'),
      }];
    }

    const entitlement = entitlementMap.get(application.id);
    if (!entitlement?.effective_active) return [];
    const configurationIssue = appConfigurationIssue(application, env);
    const syncBlockingReason = entitlement.sync_status === 'synced'
      ? null
      : entitlement.sync_status === 'error'
        ? 'Application access could not be synchronized. Contact an administrator.'
        : 'Application access is being prepared.';
    const statusBlockingReason = application.status === 'active'
      ? null
      : (application.status_message || 'Application unavailable.');
    return [{
      id: application.id,
      name: application.name,
      description: application.description,
      iconKey: application.icon_key,
      kind: 'external',
      launchPath: null,
      openMode: 'new_tab',
      roleId: entitlement.effective_role_id,
      roleLabel: roleLabel(application, entitlement.effective_role_id),
      accessSource: entitlement.effective_source,
      status: application.status,
      available: !configurationIssue && !syncBlockingReason && !statusBlockingReason,
      blockingReason: configurationIssue || syncBlockingReason || statusBlockingReason,
      syncStatus: entitlement.sync_status,
      revision: entitlement.revision,
    }];
  });
}

async function targetRequest({
  application,
  path,
  assertion,
  fetchImpl = fetch,
  env = process.env,
}) {
  const baseUrl = applicationBaseUrl(application, env);
  if (!baseUrl) throw portalError('The target application is not configured.', 503, 'PORTAL_TARGET_NOT_CONFIGURED');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TARGET_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${assertion}`,
        'cache-control': 'no-store',
      },
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw portalError(
        data.error || 'The target application rejected the request.',
        response.status >= 500 ? 502 : response.status,
        data.code || 'PORTAL_TARGET_REJECTED',
      );
    }
    return data;
  } catch (error) {
    if (error?.code) throw error;
    if (error?.name === 'AbortError') {
      throw portalError('The target application did not respond in time.', 504, 'PORTAL_TARGET_TIMEOUT');
    }
    throw portalError('The target application is unavailable.', 502, 'PORTAL_TARGET_UNAVAILABLE');
  } finally {
    clearTimeout(timeout);
  }
}

async function portalOperationReason(client, entitlement, operation) {
  const idempotencyKey = [
    'portal',
    entitlement.application_id,
    entitlement.user_id,
    entitlement.revision,
    operation,
  ].join(':');
  const { data, error } = await client
    .from('portal_entitlement_outbox')
    .select('payload')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (error) throw error;
  return String(data?.payload?.reason || 'FCOS Portal access policy reconciliation').trim();
}

async function loadEntitlementContext(client, entitlementId) {
  const { data: entitlement, error: entitlementError } = await client
    .from('portal_user_app_entitlements')
    .select('*')
    .eq('id', entitlementId)
    .maybeSingle();
  if (entitlementError) throw entitlementError;
  if (!entitlement) throw portalError('Application entitlement not found.', 404, 'PORTAL_ENTITLEMENT_NOT_FOUND');
  const [{ data: application, error: applicationError }, { data: profile, error: profileError }] = await Promise.all([
    client.from('portal_applications').select('*').eq('id', entitlement.application_id).maybeSingle(),
    client.from('user_profiles').select('id,email,full_name,user_type,active').eq('id', entitlement.user_id).maybeSingle(),
  ]);
  if (applicationError) throw applicationError;
  if (profileError) throw profileError;
  if (!application || !profile) throw portalError('Application entitlement is incomplete.', 409, 'PORTAL_ENTITLEMENT_INVALID');
  return { entitlement, application, profile };
}

async function markOutboxResult(client, entitlement, operation, {
  succeeded,
  error = null,
}) {
  const idempotencyKey = [
    'portal',
    entitlement.application_id,
    entitlement.user_id,
    entitlement.revision,
    operation,
  ].join(':');
  const now = new Date();
  const nextAttemptAt = new Date(now.getTime() + 60_000).toISOString();
  const { error: updateError } = await client
    .from('portal_entitlement_outbox')
    .update({
      status: succeeded ? 'succeeded' : 'failed',
      completed_at: succeeded ? now.toISOString() : null,
      next_attempt_at: succeeded ? now.toISOString() : nextAttemptAt,
      last_error: succeeded ? null : String(error?.message || 'Target synchronization failed').slice(0, 1000),
    })
    .eq('idempotency_key', idempotencyKey);
  if (updateError) console.error('[portal] Outbox result update failed.', { operation, code: updateError.code });
}

export async function syncPortalEntitlement({
  client,
  entitlementId,
  requestId = null,
  env = process.env,
  fetchImpl = fetch,
}) {
  const { entitlement, application, profile } = await loadEntitlementContext(client, entitlementId);
  if (application.protocol !== 'signed_handoff') return entitlement;
  const effective = resolveEffectivePortalAccess(profile, application, entitlement);
  if (effectiveFieldsChanged(entitlement, effective)) {
    return reconcileOneEntitlement(client, profile, application, entitlement);
  }

  await client
    .from('portal_user_app_entitlements')
    .update({ sync_status: 'syncing', last_sync_error: null })
    .eq('id', entitlement.id)
    .eq('revision', entitlement.revision);

  try {
    const reason = await portalOperationReason(client, entitlement, 'sync_access');
    const assertion = await signPortalAssertion({
      application,
      operation: 'sync_access',
      profile,
      entitlement,
      requestId,
      reason,
      env,
    });
    const result = await targetRequest({
      application,
      path: '/api/portal/entitlements',
      assertion,
      fetchImpl,
      env,
    });
    validateTargetEntitlementAcknowledgement(result, entitlement);
    const { data, error } = await client
      .from('portal_user_app_entitlements')
      .update({
        sync_status: 'synced',
        target_user_id: result.appUserId || entitlement.target_user_id || null,
        target_auth_user_id: result.authUserId || entitlement.target_auth_user_id || null,
        last_synced_at: new Date().toISOString(),
        last_sync_error: null,
      })
      .eq('id', entitlement.id)
      .eq('revision', entitlement.revision)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw portalError('Application access changed during synchronization.', 409, 'PORTAL_ENTITLEMENT_CHANGED');
    await markOutboxResult(client, entitlement, 'sync_access', { succeeded: true });
    await writePortalEvent(client, {
      applicationId: application.id,
      targetUserId: profile.id,
      action: 'entitlement_sync',
      outcome: 'succeeded',
      requestId,
      metadata: { revision: entitlement.revision, active: entitlement.effective_active },
    });
    return data;
  } catch (error) {
    await client
      .from('portal_user_app_entitlements')
      .update({
        sync_status: 'error',
        last_sync_error: String(error.message || 'Synchronization failed').slice(0, 1000),
      })
      .eq('id', entitlement.id)
      .eq('revision', entitlement.revision);
    await markOutboxResult(client, entitlement, 'sync_access', { succeeded: false, error });
    await writePortalEvent(client, {
      applicationId: application.id,
      targetUserId: profile.id,
      action: 'entitlement_sync',
      outcome: 'failed',
      requestId,
      metadata: { revision: entitlement.revision, code: error.code || 'PORTAL_SYNC_FAILED' },
    });
    throw error;
  }
}

async function loadApplication(client, applicationId) {
  const { data, error } = await client
    .from('portal_applications')
    .select('*')
    .eq('id', applicationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw portalError('Application not found.', 404, 'PORTAL_APPLICATION_NOT_FOUND');
  return data;
}

export async function launchPortalApplication({
  client,
  profile,
  applicationId,
  requestId = null,
  env = process.env,
  fetchImpl = fetch,
}) {
  const application = await loadApplication(client, applicationId);
  if (application.application_kind !== 'external') {
    throw portalError('This application does not use secure launch.', 400, 'PORTAL_APPLICATION_INTERNAL');
  }
  if (application.status !== 'active') {
    throw portalError(application.status_message || 'Application unavailable.', 409, 'PORTAL_APPLICATION_UNAVAILABLE');
  }
  const reconciled = await reconcilePortalEntitlementsForProfile(client, profile);
  let entitlement = reconciled.find((row) => row.application_id === application.id);
  if (!entitlement?.effective_active) {
    throw portalError('You do not have access to this application.', 403, 'PORTAL_ACCESS_DENIED');
  }
  if (entitlement.sync_status !== 'synced') {
    entitlement = await syncPortalEntitlement({
      client,
      entitlementId: entitlement.id,
      requestId,
      env,
      fetchImpl,
    });
  }
  const assertion = await signPortalAssertion({
    application,
    operation: 'launch',
    profile,
    entitlement,
    requestId,
    env,
  });
  try {
    const result = await targetRequest({
      application,
      path: '/api/portal/launch',
      assertion,
      fetchImpl,
      env,
    });
    const launchUrl = validateTargetLaunchUrl(result.launchUrl, application, env);
    await writePortalEvent(client, {
      applicationId: application.id,
      targetUserId: profile.id,
      actor: profile,
      action: 'application_launch',
      outcome: 'succeeded',
      requestId,
      metadata: { role: entitlement.effective_role_id },
    });
    return { launchUrl };
  } catch (error) {
    await writePortalEvent(client, {
      applicationId: application.id,
      targetUserId: profile.id,
      actor: profile,
      action: 'application_launch',
      outcome: 'failed',
      requestId,
      metadata: { code: error.code || 'PORTAL_LAUNCH_FAILED' },
    });
    throw error;
  }
}

export async function revokePortalSessions({
  client,
  profile,
  requestId = null,
  env = process.env,
  fetchImpl = fetch,
}) {
  const catalog = await loadPortalCatalog(client);
  const entitlements = await loadUserEntitlements(client, profile.id);
  const byApplication = new Map(entitlements.map((row) => [row.application_id, row]));
  const failures = [];
  for (const application of catalog.filter((item) => item.application_kind === 'external')) {
    const entitlement = byApplication.get(application.id);
    if (!entitlement?.effective_active && !entitlement?.target_user_id) continue;
    try {
      const assertion = await signPortalAssertion({
        application,
        operation: 'revoke_sessions',
        profile,
        entitlement,
        requestId,
        reason: 'FCOS Portal sign out',
        env,
      });
      await targetRequest({
        application,
        path: '/api/portal/revoke',
        assertion,
        fetchImpl,
        env,
      });
      await writePortalEvent(client, {
        applicationId: application.id,
        targetUserId: profile.id,
        actor: profile,
        action: 'session_revoke',
        outcome: 'succeeded',
        requestId,
      });
    } catch (error) {
      failures.push({ applicationId: application.id, message: 'Application session logout could not be confirmed.' });
      if (entitlement) {
        await queuePortalOperation(
          client,
          entitlement,
          'revoke_sessions',
          { reason: 'FCOS Portal sign out' },
          requestId || randomUUID(),
        );
      }
      await writePortalEvent(client, {
        applicationId: application.id,
        targetUserId: profile.id,
        actor: profile,
        action: 'session_revoke',
        outcome: 'failed',
        requestId,
        metadata: { code: error.code || 'PORTAL_SESSION_REVOKE_FAILED' },
      });
    }
  }
  return { failures };
}

export async function savePortalExplicitAccess({
  client,
  actor,
  userId,
  applicationId,
  enabled,
  roleId,
  expectedRevision,
  reason,
  requestId = null,
  env = process.env,
  fetchImpl = fetch,
}) {
  const normalizedReason = String(reason || '').trim();
  if (normalizedReason.length < 8 || normalizedReason.length > 255) {
    throw portalError('Enter an application access reason between 8 and 255 characters.', 400, 'PORTAL_REASON_REQUIRED');
  }
  const [{ data: profile, error: profileError }, application] = await Promise.all([
    client.from('user_profiles').select('id,email,full_name,user_type,active').eq('id', userId).maybeSingle(),
    loadApplication(client, applicationId),
  ]);
  if (profileError) throw profileError;
  if (!profile) throw portalError('User not found.', 404, 'PORTAL_USER_NOT_FOUND');
  if (application.application_kind !== 'external') {
    throw portalError('Internal FCOS access is managed through module permissions.', 400, 'PORTAL_APPLICATION_INTERNAL');
  }
  const { data: roles, error: rolesError } = await client
    .from('portal_application_roles')
    .select('id')
    .eq('application_id', application.id);
  if (rolesError) throw rolesError;
  if (enabled && !(roles || []).some((role) => role.id === roleId)) {
    throw portalError('Select a valid application role.', 400, 'PORTAL_ROLE_INVALID');
  }
  const { data: existing, error: existingError } = await client
    .from('portal_user_app_entitlements')
    .select('*')
    .eq('user_id', profile.id)
    .eq('application_id', application.id)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing && Number(expectedRevision) !== Number(existing.revision)) {
    throw portalError('Application access changed. Refresh and try again.', 409, 'PORTAL_REVISION_CONFLICT');
  }
  if (!existing && Number(expectedRevision || 0) !== 0) {
    throw portalError('Application access changed. Refresh and try again.', 409, 'PORTAL_REVISION_CONFLICT');
  }
  const draft = {
    ...(existing || {}),
    explicit_active: enabled === true,
    explicit_role_id: enabled === true ? roleId : null,
  };
  const effective = resolveEffectivePortalAccess(profile, application, draft);
  const revision = Number(existing?.revision || 0) + 1;
  const saveRow = {
    user_id: profile.id,
    application_id: application.id,
    explicit_active: draft.explicit_active,
    explicit_role_id: draft.explicit_role_id,
    effective_active: effective.active,
    effective_role_id: effective.roleId,
    effective_source: effective.source,
    revision,
    sync_status: 'pending',
    last_sync_error: null,
    updated_by: actor.id,
  };
  let saveResult;
  if (existing) {
    saveResult = await client
      .from('portal_user_app_entitlements')
      .update(saveRow)
      .eq('id', existing.id)
      .eq('revision', existing.revision)
      .select('*')
      .maybeSingle();
  } else {
    saveResult = await client
      .from('portal_user_app_entitlements')
      .insert(saveRow)
      .select('*')
      .single();
  }
  const { data: saved, error: saveError } = saveResult;
  if (saveError?.code === '23505') {
    throw portalError('Application access changed. Refresh and try again.', 409, 'PORTAL_REVISION_CONFLICT');
  }
  if (saveError) throw saveError;
  if (!saved) throw portalError('Application access changed. Refresh and try again.', 409, 'PORTAL_REVISION_CONFLICT');
  await queuePortalOperation(client, saved, 'sync_access', { reason: normalizedReason });
  if (!effective.active) await queuePortalOperation(client, saved, 'revoke_sessions', { reason: normalizedReason });
  await writePortalEvent(client, {
    applicationId: application.id,
    targetUserId: profile.id,
    actor,
    action: enabled ? (existing?.explicit_active ? 'access_role_changed' : 'access_granted') : 'access_revoked',
    outcome: 'requested',
    requestId,
    metadata: {
      reason: normalizedReason,
      explicitRole: saved.explicit_role_id,
      effectiveRole: saved.effective_role_id,
      effectiveSource: saved.effective_source,
      revision: saved.revision,
    },
  });
  let synchronized = saved;
  let syncError = null;
  try {
    synchronized = await syncPortalEntitlement({
      client,
      entitlementId: saved.id,
      requestId,
      env,
      fetchImpl,
    });
  } catch (error) {
    syncError = error.message;
  }
  return { entitlement: synchronized, syncError };
}

export async function portalAdminModel({ client, profiles, env = process.env }) {
  const catalog = await loadPortalCatalog(client);
  const externalApplications = catalog.filter((application) => application.application_kind === 'external' && !NATIVE_APPLICATION_IDS.has(application.id));
  const userIds = profiles.map((profile) => profile.id);
  const { data: entitlements, error } = userIds.length
    ? await client.from('portal_user_app_entitlements').select('*').in('user_id', userIds)
    : { data: [], error: null };
  if (error) throw error;
  const byUserAndApplication = new Map(
    (entitlements || []).map((row) => [`${row.user_id}:${row.application_id}`, row]),
  );
  const accessByUser = {};
  for (const profile of profiles) {
    accessByUser[profile.id] = {};
    for (const application of externalApplications) {
      const entitlement = byUserAndApplication.get(`${profile.id}:${application.id}`) || null;
      const effective = resolveEffectivePortalAccess(profile, application, entitlement);
      accessByUser[profile.id][application.id] = {
        entitlementId: entitlement?.id || null,
        explicitActive: entitlement?.explicit_active === true,
        explicitRoleId: entitlement?.explicit_role_id || null,
        effectiveActive: effective.active,
        effectiveRoleId: effective.roleId,
        effectiveRoleLabel: roleLabel(application, effective.roleId),
        effectiveSource: effective.source,
        revision: Number(entitlement?.revision || 0),
        syncStatus: entitlement?.sync_status || (effective.active ? 'pending' : 'not_required'),
        lastSyncError: entitlement?.last_sync_error || null,
        lastSyncedAt: entitlement?.last_synced_at || null,
      };
    }
  }
  return {
    applications: externalApplications.map((application) => ({
      id: application.id,
      name: application.name,
      description: application.description,
      iconKey: application.icon_key,
      status: application.status,
      configurationStatus: appConfigurationIssue(application, env) ? 'unavailable' : 'configured',
      roles: application.roles.map((role) => ({
        id: role.id,
        label: role.label,
        description: role.description,
        isDefault: role.is_default,
      })),
      administratorDefaultRole: application.administrator_default_role,
    })),
    accessByUser,
  };
}

export async function retryPortalAccessSync({
  client,
  entitlementId,
  requestId = null,
  env = process.env,
  fetchImpl = fetch,
}) {
  return syncPortalEntitlement({ client, entitlementId, requestId, env, fetchImpl });
}

export async function preparePortalUserDeletion({
  client,
  profile,
  actor,
  requestId = null,
  env = process.env,
  fetchImpl = fetch,
}) {
  const { data: inactiveProfile, error: inactiveProfileError } = await client
    .from('user_profiles')
    .update({
      active: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', profile.id)
    .select('id,email,full_name,user_type,active')
    .maybeSingle();
  if (inactiveProfileError) throw inactiveProfileError;
  if (!inactiveProfile) {
    throw portalError('User changed during deletion. Refresh and try again.', 409, 'PORTAL_USER_CHANGED');
  }

  const catalog = await loadPortalCatalog(client);
  const entitlements = await loadUserEntitlements(client, inactiveProfile.id);
  for (const application of catalog.filter((item) => item.application_kind === 'external')) {
    const existing = entitlements.find((row) => row.application_id === application.id);
    if (!existing) continue;
    const revision = Number(existing.revision) + 1;
    const { data: revoked, error } = await client
      .from('portal_user_app_entitlements')
      .update({
        explicit_active: false,
        explicit_role_id: null,
        effective_active: false,
        effective_role_id: null,
        effective_source: null,
        revision,
        sync_status: 'pending',
        last_sync_error: null,
        updated_by: actor.id,
      })
      .eq('id', existing.id)
      .eq('revision', existing.revision)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!revoked) throw portalError('Application access changed. Refresh and try again.', 409, 'PORTAL_REVISION_CONFLICT');
    await queuePortalOperation(client, revoked, 'sync_access', { reason: 'FCOS user deletion' });
    await queuePortalOperation(client, revoked, 'revoke_sessions', { reason: 'FCOS user deletion' });
    await syncPortalEntitlement({
      client,
      entitlementId: revoked.id,
      requestId,
      env,
      fetchImpl,
    });
    const assertion = await signPortalAssertion({
      application,
      operation: 'revoke_sessions',
      profile: inactiveProfile,
      entitlement: revoked,
      requestId,
      reason: 'FCOS user deletion',
      env,
    });
    await targetRequest({
      application,
      path: '/api/portal/revoke',
      assertion,
      fetchImpl,
      env,
    });
    await markOutboxResult(client, revoked, 'revoke_sessions', { succeeded: true });
  }
}

export async function restorePortalUserAfterFailedDeletion({
  client,
  profile,
}) {
  if (!profile?.id || profile.active !== true) {
    return { required: false, restored: false };
  }

  const { data: restoredProfile, error } = await client
    .from('user_profiles')
    .update({
      active: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', profile.id)
    .eq('active', false)
    .select('id,active')
    .maybeSingle();
  if (error) throw error;

  return {
    required: true,
    restored: restoredProfile?.active === true,
  };
}

export async function checkPortalApplicationsHealth({
  client,
  requestId = null,
  env = process.env,
  fetchImpl = fetch,
}) {
  const catalog = await loadPortalCatalog(client);
  const results = [];
  for (const application of catalog.filter((item) => item.application_kind === 'external')) {
    const configurationIssue = appConfigurationIssue(application, env);
    if (configurationIssue) {
      results.push({ id: application.id, status: 'unavailable', message: configurationIssue });
      continue;
    }
    try {
      const baseUrl = applicationBaseUrl(application, env);
      const responseValue = await fetchImpl(`${baseUrl}/api/portal/health`, {
        method: 'GET',
        headers: { 'cache-control': 'no-store' },
        signal: AbortSignal.timeout(TARGET_REQUEST_TIMEOUT_MS),
      });
      const response = await responseValue.json().catch(() => ({}));
      if (!responseValue.ok) throw portalError(
        response.error || 'The target application health check failed.',
        502,
        'PORTAL_TARGET_UNAVAILABLE',
      );
      results.push({ id: application.id, status: response.status === 'online' ? 'online' : 'warning', message: response.message || null });
    } catch (error) {
      results.push({ id: application.id, status: 'unavailable', message: 'The target application health check is unavailable.' });
    }
  }
  return results;
}

export async function processPortalOutbox({
  client,
  limit = 20,
  requestId = null,
  env = process.env,
  fetchImpl = fetch,
}) {
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 20, 50));
  const now = new Date().toISOString();
  const staleLockBefore = new Date(Date.now() - OUTBOX_STALE_LOCK_MS).toISOString();
  const { error: recoveryError } = await client
    .from('portal_entitlement_outbox')
    .update({
      status: 'failed',
      locked_at: null,
      next_attempt_at: now,
      last_error: 'Portal operation interrupted before completion',
    })
    .eq('status', 'processing')
    .lt('locked_at', staleLockBefore);
  if (recoveryError) throw recoveryError;

  const { data: queued, error } = await client
    .from('portal_entitlement_outbox')
    .select('*')
    .in('status', ['pending', 'failed'])
    .lte('next_attempt_at', now)
    .order('next_attempt_at')
    .order('created_at')
    .limit(boundedLimit);
  if (error) throw error;

  const results = [];
  for (const row of queued || []) {
    const attempts = Number(row.attempts || 0) + 1;
    const { data: claimed, error: claimError } = await client
      .from('portal_entitlement_outbox')
      .update({
        status: 'processing',
        attempts,
        locked_at: now,
      })
      .eq('id', row.id)
      .in('status', ['pending', 'failed'])
      .select('id')
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) continue;

    try {
      if (row.operation === 'sync_access') {
        await syncPortalEntitlement({
          client,
          entitlementId: row.entitlement_id,
          requestId,
          env,
          fetchImpl,
        });
      } else {
        const { entitlement, application, profile } = await loadEntitlementContext(client, row.entitlement_id);
        const assertion = await signPortalAssertion({
          application,
          operation: 'revoke_sessions',
          profile,
          entitlement,
          requestId,
          reason: row.payload?.reason,
          env,
        });
        await targetRequest({
          application,
          path: '/api/portal/revoke',
          assertion,
          fetchImpl,
          env,
        });
      }
      const { error: completionError } = await client
        .from('portal_entitlement_outbox')
        .update({
          status: 'succeeded',
          locked_at: null,
          completed_at: new Date().toISOString(),
          last_error: null,
        })
        .eq('id', row.id);
      if (completionError) throw completionError;
      results.push({ id: row.id, operation: row.operation, status: 'succeeded' });
    } catch (operationError) {
      const dead = attempts >= 10;
      const retryDelayMinutes = Math.min(60, 2 ** Math.min(attempts, 5));
      await client
        .from('portal_entitlement_outbox')
        .update({
          status: dead ? 'dead' : 'failed',
          locked_at: null,
          next_attempt_at: new Date(Date.now() + retryDelayMinutes * 60_000).toISOString(),
          last_error: String(operationError.message || 'Portal operation failed').slice(0, 1000),
        })
        .eq('id', row.id);
      results.push({
        id: row.id,
        operation: row.operation,
        status: dead ? 'dead' : 'failed',
      });
    }
  }
  return results;
}
