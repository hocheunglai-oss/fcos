import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  decodeProtectedHeader,
  exportPKCS8,
  generateKeyPair,
  jwtVerify,
} from 'jose';
import {
  resolveEffectivePortalAccess,
  signPortalAssertion,
  validateTargetEntitlementAcknowledgement,
  validateTargetLaunchUrl,
} from '../api/_portal.js';

const application = {
  id: 'emailrouter',
  application_kind: 'external',
  administrator_default_role: 'owner',
  target_base_url: 'https://emailrouter.example',
};

test('Administrator access is automatic while explicit grants survive a downgrade', () => {
  const explicit = {
    explicit_active: true,
    explicit_role_id: 'operator',
  };
  assert.deepEqual(
    resolveEffectivePortalAccess(
      { active: true, user_type: 'administrator' },
      application,
      explicit,
    ),
    { active: true, roleId: 'owner', source: 'administrator_default' },
  );
  assert.deepEqual(
    resolveEffectivePortalAccess(
      { active: true, user_type: 'general_manager' },
      application,
      explicit,
    ),
    { active: true, roleId: 'owner', source: 'administrator_default' },
  );
  assert.deepEqual(
    resolveEffectivePortalAccess(
      { active: true, user_type: 'trader' },
      application,
      explicit,
    ),
    { active: true, roleId: 'operator', source: 'explicit' },
  );
  assert.deepEqual(
    resolveEffectivePortalAccess(
      { active: false, user_type: 'administrator' },
      application,
      explicit,
    ),
    { active: false, roleId: null, source: null },
  );
});

test('FCOS issues a keyed 60-second ES256 entitlement assertion for EmailRouter', async () => {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  const now = 1_800_000_000;
  const token = await signPortalAssertion({
    application,
    operation: 'sync_access',
    profile: {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'USER@example.com',
      full_name: 'Example User',
      active: true,
    },
    entitlement: {
      id: '22222222-2222-4222-8222-222222222222',
      revision: 4,
      effective_active: true,
      effective_role_id: 'operator',
    },
    reason: 'Grant access for operations coverage',
    nowSeconds: now,
    env: {
      NODE_ENV: 'production',
      FCOS_PORTAL_SIGNING_PRIVATE_KEY: await exportPKCS8(privateKey),
      FCOS_PORTAL_SIGNING_KEY_ID: 'portal-key-2026-01',
      FCOS_PORTAL_ISSUER: 'https://fcos.example',
    },
  });

  assert.deepEqual(decodeProtectedHeader(token), {
    alg: 'ES256',
    kid: 'portal-key-2026-01',
    typ: 'JWT',
  });
  const { payload } = await jwtVerify(token, publicKey, {
    issuer: 'https://fcos.example',
    audience: 'emailrouter',
    currentDate: new Date(now * 1000),
  });
  assert.equal(payload.action, 'entitlement_sync');
  assert.equal(payload.sub, '11111111-1111-4111-8111-111111111111');
  assert.equal(payload.email, 'user@example.com');
  assert.equal(payload.display_name, 'Example User');
  assert.equal(payload.role, 'operator');
  assert.equal(payload.entitlement_revision, 4);
  assert.equal(payload.exp - payload.iat, 60);
  assert.equal(payload.reason, 'Grant access for operations coverage');
});

test('FCOS accepts only a target-owned single-use handoff URL', () => {
  const code = 'a'.repeat(43);
  const env = {
    NODE_ENV: 'production',
    FCOS_PORTAL_EMAILROUTER_URL: 'https://emailrouter.example',
  };
  assert.equal(
    validateTargetLaunchUrl(
      `https://emailrouter.example/auth/handoff?code=${code}`,
      application,
      env,
    ),
    `https://emailrouter.example/auth/handoff?code=${code}`,
  );
  assert.throws(() => validateTargetLaunchUrl(
    `https://attacker.example/auth/handoff?code=${code}`,
    application,
    env,
  ));
  assert.throws(() => validateTargetLaunchUrl(
    'https://emailrouter.example/auth/handoff?code=short',
    application,
    env,
  ));
  assert.throws(() => validateTargetLaunchUrl(
    `https://emailrouter.example/auth/handoff?code=${code}&email=user@example.com`,
    application,
    env,
  ));
  assert.throws(() => validateTargetLaunchUrl(
    `https://emailrouter.example/auth/handoff?code=${code}#user`,
    application,
    env,
  ));
});

test('FCOS accepts only an exact target entitlement acknowledgement', () => {
  const entitlement = {
    revision: 7,
    effective_active: true,
    effective_role_id: 'operator',
  };
  const acknowledgement = {
    appUserId: '11111111-1111-4111-8111-111111111111',
    authUserId: '22222222-2222-4222-8222-222222222222',
    role: 'operator',
    active: true,
    revision: 7,
  };
  assert.equal(
    validateTargetEntitlementAcknowledgement(acknowledgement, entitlement),
    acknowledgement,
  );
  assert.throws(() => validateTargetEntitlementAcknowledgement(
    { ...acknowledgement, revision: 6 },
    entitlement,
  ));
  assert.throws(() => validateTargetEntitlementAcknowledgement(
    { ...acknowledgement, role: 'owner' },
    entitlement,
  ));
  assert.throws(() => validateTargetEntitlementAcknowledgement(
    { ...acknowledgement, appUserId: 'not-a-uuid' },
    entitlement,
  ));

  assert.doesNotThrow(() => validateTargetEntitlementAcknowledgement(
    {
      appUserId: null,
      authUserId: null,
      role: null,
      active: false,
      revision: 8,
    },
    {
      revision: 8,
      effective_active: false,
      effective_role_id: null,
    },
  ));
});

test('portal storage is service-only, revisioned, and protects the final Administrator', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20260730113000_universal_app_portal.sql', import.meta.url),
    'utf8',
  );
  for (const table of [
    'portal_applications',
    'portal_application_roles',
    'portal_user_app_entitlements',
    'portal_entitlement_outbox',
    'portal_access_events',
  ]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table}`));
  }
  assert.match(migration, /revision bigint not null/);
  assert.match(migration, /administrator_default/);
  assert.match(migration, /protect_last_active_administrator/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /At least one active FCOS Administrator is required/);
});

test('portal routes use bearer assertions and preserve FCOS deep links', async () => {
  const [portalSource, functionSource, appSource, loginSource, adminSource] = await Promise.all([
    readFile(new URL('../api/_portal.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/Login.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/AdminControl.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(portalSource, /authorization: `Bearer \$\{assertion\}`/);
  assert.match(portalSource, /path: '\/api\/portal\/entitlements'/);
  assert.match(portalSource, /path: '\/api\/portal\/revoke'/);
  assert.match(portalSource, /const updateRow = \{ \.\.\.row \};[\s\S]*delete updateRow\.id;[\s\S]*\.update\(updateRow\)/);
  assert.match(portalSource, /OUTBOX_STALE_LOCK_MS/);
  assert.match(portalSource, /Portal operation interrupted before completion/);
  assert.match(portalSource, /status: 'succeeded',[\s\S]*locked_at: null/);
  assert.match(
    portalSource,
    /preparePortalUserDeletion[\s\S]*from\('user_profiles'\)[\s\S]*active: false[\s\S]*syncPortalEntitlement/,
  );
  assert.match(functionSource, /forceRevision: true/);
  assert.match(functionSource, /async function portalApplicationLaunch/);
  assert.match(functionSource, /async function adminPortalAccessSave/);
  assert.match(functionSource, /assertAdministratorContinuity/);
  assert.match(appSource, /path="\/apps" element=\{<Navigate to="\/" replace \/>\}/);
  assert.match(appSource, /path="\/"/);
  assert.match(appSource, /location\.pathname === '\/' \? undefined : \{ from: location \}/);
  assert.match(loginSource, /const returnTo = from[\s\S]*: '\/'/);
  assert.doesNotMatch(appSource, /AppPortal/);
  assert.match(adminSource, /syncStatus: data\.syncError \? 'error' : \(returned\.sync_status \|\| 'synced'\)/);
});
