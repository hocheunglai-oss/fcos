import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8');
function implementation(name, next) {
  const start = source.indexOf(`async function ${name}(`), end = source.indexOf(`async function ${next}(`, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

function fixture() {
  const state = { profile: { id: 'local-user', email: 'user@fcuno.example', full_name: 'FCUNO User', active: false, user_type: 'viewer', use_type_defaults: false },
    audits: [], authWrites: [], permissions: [], auditUnavailable: false, otherAdministrators: 1 };
  const gm = { id: 'general-manager', active: true, user_type: 'general_manager' };
  const client = {
    auth: { admin: { updateUserById: async (id, patch) => { state.authWrites.push(patch); return { data: { user: { id } }, error: null }; } } },
    from(table) {
      if (table === 'user_profiles') return {
        select() {
          const q = { eq: () => q, in: () => q, neq: async () => ({ count: state.otherAdministrators, error: null }),
            maybeSingle: async () => ({ data: { ...state.profile }, error: null }) };
          return q;
        },
        upsert: async (patch) => { Object.assign(state.profile, patch); return { error: null }; },
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
    reportArchiveAccessLevel: () => 'none',
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

test('the administrator entrypoint and desktop form expose local application activation with identity read-only', async () => {
  const admin = await readFile(new URL('../src/pages/AdminControl.jsx', import.meta.url), 'utf8');
  assert.match(implementation('adminUserSave', 'adminUserDelete'), /requireAdministrator\(req\)/);
  assert.match(admin, /FCOS application access/);
  assert.doesNotMatch(admin, /Managed in FCUNO/);
  assert.match(admin, /Identity is read-only from FCUNO/);
});
