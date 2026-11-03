import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import AdminControl from '@/pages/AdminControl';
import { appClient } from '@/api/appClient';
import { resolveGroupAccess } from '../../shared/accessGroups.js';
import '@/styles/fonts.css';
import '@/index.css';

const modules = [{ id: 'dashboard', label: 'Dashboard', sortOrder: 10 }, { id: 'disputes', label: 'Dispute Workflow', sortOrder: 20 }, { id: 'xero_portal', label: 'Xero Portal', sortOrder: 30 }, { id: 'report_archive', label: 'Report Archive', sortOrder: 40 }, { id: 'settings', label: 'Settings', sortOrder: 50 }, { id: 'admin', label: 'People & Access', sortOrder: 60 }];
const capabilities = [{ id: 'disputes_approve', label: 'Approve disputes', description: 'Approve or reject dispute instructions.' }, { id: 'xero_portal_manage', label: 'Manage Xero Portal', description: 'Maintain the Xero connection.' }];
const groups = [
  { id: 'operations', label: 'Operations', description: 'Delivery work', revision: 2, is_system: true, permissions: { dashboard: true, disputes: true, report_archive: 'read' }, capabilities: { disputes_approve: true } },
  { id: 'finance', label: 'Finance', description: 'Finance work', revision: 3, is_system: true, permissions: { dashboard: true, xero_portal: true, report_archive: 'full' }, capabilities: { xero_portal_manage: true } },
  { id: 'viewer', label: 'Viewer', description: 'Dashboard viewing', revision: 1, is_system: true, permissions: { dashboard: true }, capabilities: {} },
  { id: 'personal_alice', label: 'Legacy · Alice Example', description: 'Preserved individual access', revision: 1, is_legacy: true, permissions: { disputes: true }, capabilities: {} },
  { id: 'empty_group', label: 'Unused group', description: 'No members', revision: 1, permissions: {}, capabilities: {} },
];
const users = [
  { id: 'alice', full_name: 'Alice Example', email: 'alice@example.invalid', user_type: 'operations', active: true, group_ids: ['operations', 'finance'], access_revision: 4 },
  { id: 'bob', full_name: 'Bob Example', email: 'bob@example.invalid', user_type: 'viewer', active: true, group_ids: ['operations'], access_revision: 2 },
  { id: 'carol', full_name: 'Carol Example', email: 'carol@example.invalid', user_type: 'finance', active: false, group_ids: ['finance'], access_revision: 0 },
  { id: 'admin', full_name: 'Admin Example', email: 'admin@example.invalid', user_type: 'administrator', active: true, group_ids: [], access_revision: 1 },
];
window.peopleAccessFixture = { groups, users, requests: [], conflict: false, saves: 0 };
appClient.functions.invoke = async (name, body = {}) => {
  const fixture = window.peopleAccessFixture;
  fixture.requests.push({ name, body: structuredClone(body) });
  if (name === 'adminUsersList') return { data: { identityAuthority: new URLSearchParams(window.location.search).get('authority') === 'fcos' ? 'fcos' : 'fcuno', modules, capabilities, permissionGroups: fixture.groups.map((group) => ({ ...group, member_count: fixture.users.filter((person) => person.group_ids.includes(group.id)).length })), users: fixture.users.map((person) => ({ ...person, ...resolveGroupAccess({ groups: fixture.groups, groupIds: person.group_ids, moduleIds: modules.map((module) => module.id), capabilityIds: capabilities.map((capability) => capability.id), active: person.active, privileged: person.user_type === 'administrator' }) })), generalManager: null } };
  if (name === 'adminPermissionGroupSave') {
    if (fixture.conflict) return { data: { error: 'Another administrator changed this group.', code: 'ACCESS_REVISION_CONFLICT' } };
    const existing = fixture.groups.find((group) => group.id === body.id);
    if (existing && existing.revision !== body.expectedRevision) return { data: { error: 'Concurrent group edit.', code: 'ACCESS_REVISION_CONFLICT' } };
    const group = { ...existing, ...body, id: body.id || body.label.toLowerCase().replaceAll(' ', '_'), revision: (existing?.revision || 0) + 1 };
    fixture.groups = fixture.groups.filter((item) => item.id !== group.id).concat(group);
    fixture.saves++;
    return { data: { group } };
  }
  if (name === 'adminUserGroupsSave') {
    if (fixture.conflict) return { data: { error: 'Another administrator changed these memberships.', code: 'ACCESS_REVISION_CONFLICT' } };
    const person = fixture.users.find((item) => item.id === body.userId);
    if (person.access_revision !== body.expectedRevision) return { data: { error: 'Concurrent membership edit.' } };
    const affected = new Set([...person.group_ids, ...body.groupIds]);
    fixture.groups.forEach((group) => { if (affected.has(group.id)) group.revision++; });
    person.group_ids = [...body.groupIds]; person.access_revision++;
    fixture.saves++;
    return { data: { userId: person.id, groupIds: person.group_ids, accessRevision: person.access_revision } };
  }
  if (name === 'adminPermissionGroupDelete') { fixture.groups = fixture.groups.filter((group) => group.id !== body.id); return { data: { deleted: true, id: body.id } }; }
  if (name === 'adminUserSave') { let person = fixture.users.find((item) => item.id === body.id); if (!person) { person = { id: 'new-person', group_ids: [], access_revision: 0 }; fixture.users.push(person); } Object.assign(person, { email: body.email, full_name: body.full_name, active: body.active, user_type: body.user_type }); return { data: { user: person } }; }
  if (name === 'adminUserDelete') { fixture.users = fixture.users.filter((person) => person.id !== body.id); return { data: { deleted: true } }; }
  throw new Error(`Unexpected isolated fixture request: ${name}`);
};
createRoot(document.getElementById('root')).render(<MemoryRouter><AdminControl /></MemoryRouter>);
