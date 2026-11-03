// Each request resolves against current storage. No process-wide authorization cache.
import { resolveGroupAccess } from '../shared/accessGroups.js';
const requestAccess = new WeakMap();
export async function loadEffectiveGroupAccess(client, profile) {
  if (!profile?.id) throw Object.assign(new Error('A registered user is required.'), { status: 403 });
  let pending = requestAccess.get(profile);
  if (!pending) {
    pending = (async () => {
      const { data, error } = await client.rpc('fcos_effective_access', { p_user_id: profile.id });
      if (error) throw error;
      if (!data || data.user_id !== profile.id) throw Object.assign(new Error('Access state could not be verified.'), { status: 503 });
      return data;
    })();
    requestAccess.set(profile, pending);
  }
  return pending;
}
export async function readAllAccessRows(client, table, columns, orderBy = 'id') {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    let query = client.from(table).select(columns).order(orderBy, { ascending: true });
    if (table === 'user_permission_groups') query = query.order('group_id', { ascending: true });
    const result = await query.range(offset, offset + 999);
    if (result.error) throw result.error;
    rows.push(...(result.data || []));
    if ((result.data || []).length < 1000) return rows;
  }
}
export function serializeGroupUser(profile, groups, memberships, moduleIds, capabilityIds) {
  return { ...profile, ...resolveGroupAccess({ groups, groupIds: memberships.filter((m) => m.user_id === profile.id).map((m) => m.group_id), moduleIds, capabilityIds, privileged: ['administrator', 'general_manager'].includes(profile.user_type), active: profile.active === true }) };
}
export function accessOperationError(error) {
  const status = error?.code === '40001' ? 409 : error?.code === '42501' ? 403 : ['23503', '23505', '55000'].includes(error?.code) ? 409 : ['22023', '22P02'].includes(error?.code) ? 400 : 500;
  const code = error?.code === '40001' ? 'ACCESS_REVISION_CONFLICT' : /members/i.test(error?.message || '') ? 'ACCESS_GROUP_HAS_MEMBERS' : 'ACCESS_CHANGE_REJECTED';
  return Object.assign(new Error(status < 500 ? error.message : 'Access storage could not complete the change.'), { status, code });
}
