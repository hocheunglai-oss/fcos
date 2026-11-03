import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { federationDatabase, userId } from './fcunoDatabaseFixture.js';

const source = await readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8');
function implementation(name, next) {
  const start = source.indexOf(`async function ${name}(`); let end = source.indexOf(`async function ${next}(`, start);
  if (end < 0) end = source.indexOf('\nasync function ', start + 1);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

function fixture({ profileClient = null, initialProfile = null, generalManager = null, afterAuthUpdate = async () => {} } = {}) {
  const state = { profile: initialProfile || { id: 'local-user', email: 'user@fcuno.example', full_name: 'FCUNO User', active: false, user_type: 'viewer', use_type_defaults: false },
    audits: [], authWrites: [], permissions: [], auditUnavailable: false, otherAdministrators: 1 };
  const gm = generalManager || { id: 'general-manager', active: true, user_type: 'general_manager' };
  const client = {
    auth: { admin: { updateUserById: async (id, patch) => { state.authWrites.push(patch); await afterAuthUpdate(); return { data: { user: { id } }, error: null }; } } },
    from(table) {
      if (table === 'user_profiles' && profileClient) return profileClient.from(table);
      if (table === 'user_profiles') return {
        select() {
          const q = { eq: () => q, in: () => q, neq: async () => ({ count: state.otherAdministrators, error: null }),
            maybeSingle: async () => ({ data: { ...state.profile }, error: null }) };
          return q;
        },
        upsert: async (patch) => { Object.assign(state.profile, patch); return { error: null }; },
        update(patch) {
          const filters = {};
          const q = { eq: (key, value) => { filters[key] = value; return q; }, select: () => q, maybeSingle: async () => {
            if (Object.entries(filters).some(([key, value]) => state.profile[key] !== value)) return { data: null, error: null };
            Object.assign(state.profile, patch); return { data: { email: state.profile.email, full_name: state.profile.full_name, active: state.profile.active }, error: null };
          } };
          return q;
        },
      };
      if (table === 'user_module_permissions') return {
        delete: () => ({ eq: async () => { state.permissions = []; return { error: null }; } }),
        insert: async (rows) => { state.permissions.push(...rows); return { error: null }; },
      };
      if (table === 'admin_audit_logs') return { insert: async (row) => {
        if (state.auditUnavailable) return { error: new Error('FIXTURE_AUDIT_UNAVAILABLE') };
        state.audits.push(row); return { error: null };
      } };
      throw new Error(`Unexpected activation table ${table}`);
    },
  };
  const dependencies = {
    appError: (message, status = 500, code) => Object.assign(new Error(message), { status, code }),
    listAccessModel: async () => ({ userTypes: [{ id: 'viewer' }, { id: 'administrator' }, { id: 'general_manager' }], typePermissions: {}, typeCapabilities: {} }),
    isAdministratorUserType: (type) => ['administrator', 'general_manager'].includes(type),
    normalizePermissions: (_type, values) => values, normalizeCapabilities: (_type, values) => values,
    fcunoFederationConfig: () => ({ federationEnabled: true }), loadActiveGeneralManager: async () => gm,
    findAuthUserByEmail: () => { throw new Error('FCUNO must own identity creation'); },
    ADMINISTRATIVE_USER_TYPES: ['administrator', 'general_manager'], ADMIN_APP_MODULES: [], ADMIN_CAPABILITIES: [],
    REPORT_ARCHIVE_MODULE_ID: 'report_archive', REPORT_ARCHIVE_MANAGE_MODULE_ID: 'report_archive_manage',
    ensureReportArchiveManageModule: async () => {}, permissionCanView: () => false,
    reportArchiveAccessLevel: () => 'none', loadEffectiveGroupAccess: async () => ({permissions:{},capabilities:{},groups:[],access_revision:1,grant_sources:{}}),
  };
  // Execute the production sanitizer, continuity checks, audit and persistence
  // together. Only provider/database dependencies are fixture implementations.
  const persist = Function(...Object.keys(dependencies), `${implementation('sanitizeManagedUserPayload', 'findAuthUserByEmail')}
    ${implementation('writeAdminAudit', 'loadActiveGeneralManager')}
    ${implementation('assertAdministratorContinuity', 'ensureReportArchiveManageModule')}
    ${implementation('persistManagedUser', 'adminUsersList')}
    return persistManagedUser;`)(...Object.values(dependencies));
  const payload = (patch = {}) => ({ ...state.profile, permissions: {}, capabilities: {}, ...patch });
  const actor = { id: gm.id, email: 'admin@fcuno.example' };
  return { state, save: (patch) => persist(client, payload(patch), actor), gm };
}

test('a local administrator can activate and disable FCOS access while FCUNO retains identity ownership', async () => {
  const { state, save } = fixture();
  assert.equal((await save({ active: true })).active, true);
  assert.deepEqual(state.authWrites, [{ app_metadata: { user_type: 'viewer' } }]);
  assert.equal(state.profile.email, 'user@fcuno.example'); assert.equal(state.profile.full_name, 'FCUNO User');
  assert.equal(state.profile.user_type, 'viewer'); assert.equal(state.profile.use_type_defaults, false);
  assert.ok(state.permissions.every((row) => row.can_view === false));
  assert.deepEqual(state.audits[0].metadata, { previous_active: false, active: true, user_type: 'viewer', identity_authority: 'fcuno', activation_authority: 'fcos' });
  assert.equal((await save({ active: false })).active, false);
});

test('identity edits, creation and General Manager deactivation remain blocked', async () => {
  const { state, save, gm } = fixture();
  for (const patch of [{ email: 'other@example.com' }, { full_name: 'Other name' }, { password: 'new-password' }]) {
    await assert.rejects(save(patch), { code: 'FCUNO_IDENTITY_READ_ONLY' });
  }
  await assert.rejects(save({ id: null, password: 'new-password' }), { code: 'FCUNO_IDENTITY_CREATE_REQUIRED' });
  assert.equal(state.authWrites.length, 0); assert.equal(state.audits.length, 0);
  Object.assign(state.profile, { id: gm.id, active: true, user_type: 'general_manager' });
  await assert.rejects(save({ active: false }), /Transfer General Manager authority/);
});

test('unavailable activation audit fails before changing Auth or granting FCOS application access', async () => {
  const { state, save } = fixture(); state.auditUnavailable = true;
  await assert.rejects(save({ active: true }), /FIXTURE_AUDIT_UNAVAILABLE/);
  assert.equal(state.profile.active, false); assert.equal(state.authWrites.length, 0);
});

test('a permissions-only update does not implicitly activate an inactive federated profile', async () => {
  const { state, save } = fixture();
  assert.equal((await save({ active: undefined })).active, false);
  await assert.rejects(save({ active: 'false' }), { code: 'FCOS_APPLICATION_ACCESS_INVALID' });
  assert.equal(state.profile.active, false);
  assert.ok(state.audits.every((row) => row.action !== 'fcos_application_access_authorized'));
});

test('executed activation path preserves a concurrently projected identity in PostgreSQL', async (t) => {
  const { query, client } = await federationDatabase(t);
  await query("update user_profiles set active=false,user_type='viewer',use_type_defaults=false where id=$1", [userId]);
  const initialProfile = (await query('select * from user_profiles where id=$1', [userId])).rows[0];
  const { save } = fixture({ initialProfile, profileClient: client,
    // Simulate the identity projection after the save's validation read and
    // before its final authorization write, reproducing the reported race.
    afterAuthUpdate: () => query("update user_profiles set email='new@fcuno.example',full_name='New FCUNO Name' where id=$1", [userId]),
  });
  const result = await save({ active: true });
  const stored = (await query('select email,full_name,active,user_type from user_profiles where id=$1', [userId])).rows[0];
  assert.deepEqual(stored, { email: 'new@fcuno.example', full_name: 'New FCUNO Name', active: true, user_type: 'viewer' });
  assert.equal(result.email, stored.email); assert.equal(result.full_name, stored.full_name);
});

test('activation-only request preserves a role changed before its initial server read', async (t) => {
  const { query, client } = await federationDatabase(t);
  await query("update user_profiles set active=false,user_type='viewer',use_type_defaults=false where id=$1", [userId]);
  const stalePageProfile = (await query('select * from user_profiles where id=$1', [userId])).rows[0];
  const { save, state } = fixture({ initialProfile: stalePageProfile, profileClient: client });
  // A separate role edit completes after page load, before this save reads it.
  await query("update user_profiles set user_type='administrator' where id=$1", [userId]);
  const result = await save({ activationOnly: true, active: true, user_type: 'viewer' });
  assert.deepEqual((await query('select active,user_type,use_type_defaults from user_profiles where id=$1', [userId])).rows[0],
    { active: true, user_type: 'administrator', use_type_defaults: false });
  assert.deepEqual(state.authWrites, [{ app_metadata: { user_type: 'administrator' } }]);
  assert.equal(result.user_type, 'administrator');
  assert.equal(state.audits[0].metadata.user_type, 'administrator');
  assert.equal(state.permissions.length, 0);
});

test('activation-only omission cannot fall back to Viewer and malformed activation-only requests stop before writes', async () => {
  const { save, state } = fixture({ initialProfile: { id: 'local-user', email: 'user@fcuno.example', full_name: 'FCUNO User', active: false, user_type: 'administrator', use_type_defaults: false } });
  assert.equal((await save({ activationOnly: true, active: true, user_type: undefined })).user_type, 'administrator');
  assert.equal(state.profile.user_type, 'administrator');
  assert.deepEqual(state.authWrites[0], { app_metadata: { user_type: 'administrator' } });
  const before = state.authWrites.length;
  for (const patch of [{ activationOnly: 'true', active: false }, { activationOnly: true, active: undefined }, { activationOnly: true, id: null, password: 'fixture-password', active: true }]) {
    await assert.rejects(save(patch), { code: 'FCOS_APPLICATION_ACCESS_INVALID' });
  }
  assert.equal(state.authWrites.length, before);
});

test('permissions-only save conflicts safely when activation changes concurrently', async (t) => {
  const { query, client } = await federationDatabase(t);
  await query("update user_profiles set active=false,user_type='viewer',use_type_defaults=false where id=$1", [userId]);
  const initialProfile = (await query('select * from user_profiles where id=$1', [userId])).rows[0];
  const { save, state } = fixture({ initialProfile, profileClient: client,
    afterAuthUpdate: () => query('update user_profiles set active=true where id=$1', [userId]),
  });
  await assert.rejects(save({ active: undefined }), { status: 409, code: 'FCOS_AUTHORIZATION_CONFLICT' });
  assert.equal((await query('select active from user_profiles where id=$1', [userId])).rows[0].active, true);
  assert.equal(state.audits.length, 0);
});

test('authorization compare-and-set preserves a concurrent General Manager transfer', async (t) => {
  const { query, client } = await federationDatabase(t);
  const formerManagerId = '77777777-7777-4777-8777-777777777777';
  await query('insert into auth.users(id) values($1)', [formerManagerId]);
  await query("insert into user_profiles(id,email,full_name,active,user_type) values($1,'manager@fcuno.example','Manager A',true,'general_manager')", [formerManagerId]);
  await query("update user_profiles set active=true,user_type='viewer',use_type_defaults=false where id=$1", [userId]);
  const initialProfile = (await query('select * from user_profiles where id=$1', [userId])).rows[0];
  const generalManager = (await query('select * from user_profiles where id=$1', [formerManagerId])).rows[0];
  const { save, state } = fixture({ initialProfile, generalManager, profileClient: client,
    // Complete A→B after continuity validation but before the pending save's
    // authorization write. A remains an Administrator, so a last-admin check
    // alone cannot protect the new General Manager from the old save.
    afterAuthUpdate: async () => {
      await query('begin');
      await query("update user_profiles set user_type='administrator' where id=$1", [formerManagerId]);
      await query("update user_profiles set user_type='general_manager' where id=$1", [userId]);
      await query('commit');
    },
  });
  await assert.rejects(save({ active: false }), { status: 409, code: 'FCOS_AUTHORIZATION_CONFLICT' });
  assert.deepEqual((await query('select user_type,active from user_profiles where id=$1', [userId])).rows[0], { user_type: 'general_manager', active: true });
  assert.deepEqual((await query('select user_type,active from user_profiles where id=$1', [formerManagerId])).rows[0], { user_type: 'administrator', active: true });
  assert.ok(state.audits.every((row) => row.action !== 'user_updated'));
});

test('the administrator entrypoint and desktop form expose local application activation with identity read-only', async () => {
  const admin = await readFile(new URL('../src/pages/AdminControl.jsx', import.meta.url), 'utf8');
  assert.match(implementation('adminUserSave', 'adminUserDelete'), /requireAdministrator\(req\)/);
  assert.match(admin, /FCOS application access/);
  assert.match(admin, /activationOnly: true, active: currentPerson\.active !== true/);
  assert.doesNotMatch(admin.slice(admin.indexOf('const toggleFcosAccess'), admin.indexOf('const openIdentity')), /user_type:/);
  assert.doesNotMatch(admin, /Managed in FCUNO/);
  assert.match(admin, /Identity is read-only from FCUNO/);
});
