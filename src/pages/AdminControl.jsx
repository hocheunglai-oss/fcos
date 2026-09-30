import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, GitBranch, Loader2, Plus, RefreshCw, Save, Search, ShieldCheck, Trash2, Users } from 'lucide-react';
import { appClient } from '@/api/appClient';
import { APP_CAPABILITIES, APP_MODULES, USER_TYPES, isAdministratorUserType } from '@/lib/authModules';
import { useAuth } from '@/lib/AuthContext';
import { notifyAccessChanged } from '@/lib/accessRefresh';
import { resolveGroupAccess } from '../../shared/accessGroups.js';
import PageHeader from '@/components/common/PageHeader';
import StateBlock from '@/components/common/StateBlock';
import ReportingLinesPanel from '@/components/admin/ReportingLinesPanel';
import AccessPermissionPanel, { accessChanges, accessValueLabel } from '@/components/admin/AccessPermissionPanel';
import useAccessNavigationGuard from '@/components/admin/useAccessNavigationGuard';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { useNavigationAwareRequest } from '@/hooks/useNavigationAwareRequest';

const FCUNO_USER_MANAGEMENT_URL = 'https://fcuno.com/admin/usermanagement';
const blankGroup = { id: null, label: '', description: '', sort_order: 100, revision: 0, permissions: {}, capabilities: {} };
const nameOf = (person) => person?.full_name || person?.email || 'Unnamed person';
const idsOf = (person) => person?.group_ids || [];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sortedIds = (ids) => [...new Set(ids || [])].sort();
const formOf = (group) => ({ id: group.id, label: group.label || group.id, description: group.description || '', sort_order: group.sort_order ?? 100, revision: group.revision ?? 0, permissions: { ...group.permissions }, capabilities: { ...group.capabilities } });

function TabButton({ active, onClick, children, icon: Icon }) {
  return <Button type="button" size="sm" variant={active ? 'default' : 'ghost'} aria-pressed={active} onClick={onClick} className="gap-2">{Icon && <Icon className="h-4 w-4" />}{children}</Button>;
}

function SearchInput({ label, value, onChange, placeholder }) {
  return <div className="relative min-w-0 flex-1"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label={label} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} className="h-9 pl-8" /></div>;
}

export default function AdminControl({ methodologyAction = null }) {
  const { toast } = useToast();
  const { isSupabaseConfigured, authMode, user: currentUser } = useAuth();
  const { request } = useNavigationAwareRequest('collaboration');
  const [data, setData] = useState({ users: [], permissionGroups: [], modules: APP_MODULES, capabilities: APP_CAPABILITIES });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [section, setSection] = useState('groups');
  const [groupTab, setGroupTab] = useState('permissions');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [groupForm, setGroupForm] = useState(null);
  const [baseGroup, setBaseGroup] = useState(null);
  const [groupSearch, setGroupSearch] = useState('');
  const [showLegacy, setShowLegacy] = useState(false);
  const [permissionSearch, setPermissionSearch] = useState('');
  const [enabledOnly, setEnabledOnly] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [peopleSearch, setPeopleSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [personForm, setPersonForm] = useState(null);
  const [personDialog, setPersonDialog] = useState(false);
  const [groupChoiceSearch, setGroupChoiceSearch] = useState('');
  const [effectiveSearch, setEffectiveSearch] = useState('');
  const [effectiveEnabled, setEffectiveEnabled] = useState(true);
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const [impact, setImpact] = useState(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState(false);
  const [rolePerson, setRolePerson] = useState(null);
  const [roleValue, setRoleValue] = useState('viewer');
  const [confirmRoleTransfer, setConfirmRoleTransfer] = useState(false);
  const [identityForm, setIdentityForm] = useState(null);
  const [identityBase, setIdentityBase] = useState(null);
  const mounted = useRef(true);
  const dataRef = useRef(data);
  dataRef.current = data;
  const workspaceRef = useRef(null);
  const groups = data.permissionGroups || [];
  const users = data.users || [];
  const modules = data.modules?.length ? data.modules : APP_MODULES;
  const capabilities = data.capabilities?.length ? data.capabilities : APP_CAPABILITIES;
  const groupMap = useMemo(() => Object.fromEntries(groups.map((group) => [group.id, group])), [groups]);
  const selectedGroup = groupMap[selectedGroupId];
  const groupDirty = Boolean(groupForm && !same(groupForm, baseGroup));
  const personDirty = Boolean(personForm && !same(sortedIds(personForm.groupIds), sortedIds(personForm.baseIds)));
  const roleDirty = Boolean(rolePerson && rolePerson.user_type !== roleValue);
  const identityDirty = Boolean(identityForm && !same(identityForm, identityBase));
  const dirty = groupDirty || personDirty || roleDirty || identityDirty;
  const privilege = (person) => person?.privileged_access === true || isAdministratorUserType(person?.user_type);
  const resolve = (person, groupIds, definitions = groups) => resolveGroupAccess({ groups: definitions, groupIds, moduleIds: modules.map((module) => module.id), capabilityIds: capabilities.map((capability) => capability.id), privileged: privilege(person), active: person?.active !== false });
  const currentPerson = personForm ? users.find((person) => person.id === personForm.userId) : null;
  const personAccess = currentPerson ? resolve(currentPerson, personForm.groupIds) : null;
  const personChanges = currentPerson ? accessChanges(resolve(currentPerson, personForm.baseIds), personAccess, modules, capabilities) : [];
  const protectedGroup = Boolean(groupForm && isAdministratorUserType(groupForm.id));
  const groupMembers = selectedGroup ? users.filter((person) => idsOf(person).includes(selectedGroup.id)) : [];

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!message) return undefined;
    toast({ title: 'People & Access', description: message });
    const timer = window.setTimeout(() => setMessage(''), 10_000);
    return () => window.clearTimeout(timer);
  }, [message, toast]);
  useLayoutEffect(() => {
    const measure = () => {
      const panel = workspaceRef.current;
      if (panel) panel.style.setProperty('--access-workspace-height', `${Math.max(320, window.innerHeight - panel.getBoundingClientRect().top - 16)}px`);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [section, message, error, loading]);
  const load = useCallback(async (force = false) => {
    if (!isSupabaseConfigured) { setLoading(false); return null; }
    setLoading(true);
    setError('');
    let received = null;
    try {
      await request({ name: 'adminUsersList', force, apply: (response) => {
        if (response.data?.error) throw new Error(response.data.error);
        received = response.data;
        dataRef.current = response.data;
        setData(response.data);
      } });
      return received;
    } catch (failure) { setError(failure.message || 'Unable to load People & Access.'); return null; }
    finally { if (mounted.current) setLoading(false); }
  }, [isSupabaseConfigured, request]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (groupForm || !groups.length) return;
    let stored = '';
    try { stored = window.localStorage.getItem(`fcos:access:last-group:${currentUser?.id || ''}`) || ''; } catch { /* Preferences are optional. */ }
    const first = groups.find((group) => group.id === stored) || groups[0];
    setSelectedGroupId(first.id);
    setBaseGroup(formOf(first));
    setGroupForm(formOf(first));
    if (first.is_legacy) setShowLegacy(true);
  }, [groups, groupForm, currentUser?.id]);

  const navigate = (action) => {
    if (saving || loading) return;
    if (dirty) setPendingNavigation(() => action);
    else action();
  };
  useAccessNavigationGuard({ dirty, busy: saving });
  const selectGroup = (group) => { if (group.id === selectedGroupId) return; navigate(() => {
    const currentGroup = dataRef.current.permissionGroups?.find((item) => item.id === group.id) || group;
    setError(''); setSelectedGroupId(currentGroup.id); setBaseGroup(formOf(currentGroup)); setGroupForm(formOf(currentGroup)); setPermissionSearch(''); setGroupTab('permissions');
    try { window.localStorage.setItem(`fcos:access:last-group:${currentUser?.id || ''}`, group.id); } catch { /* Optional preference. */ }
  }); };
  const discard = () => { setGroupForm(baseGroup); setPersonForm((previous) => previous ? { ...previous, groupIds: [...previous.baseIds] } : null); setRoleValue(rolePerson?.user_type || 'viewer'); setIdentityForm(identityBase); };
  const openPerson = (person, toggleGroup = null) => navigate(() => {
    setError('');
    const selectedPerson = dataRef.current.users?.find((item) => item.id === person.id) || person;
    const baseIds = sortedIds(idsOf(selectedPerson));
    const groupIds = toggleGroup ? baseIds.includes(toggleGroup) ? baseIds.filter((id) => id !== toggleGroup) : [...baseIds, toggleGroup] : [...baseIds];
    setPersonForm({ userId: selectedPerson.id, groupIds, baseIds, expectedRevision: selectedPerson.access_revision ?? 0 });
    setGroupChoiceSearch(''); setEffectiveSearch(''); setPersonDialog(section !== 'people'); setRolePerson(null);
  });
  const invoke = async (name, payload) => {
    const response = await appClient.functions.invoke(name, payload);
    if (response.data?.error) throw new Error(response.data.error);
    if (response.error) throw new Error(response.error.message || response.error);
    return response.data;
  };
  const saveMembership = async (afterSave = null) => {
    if (!personForm || saving) return false;
    setSaving(true); setError(''); setMessage('');
    try {
      await invoke('adminUserGroupsSave', { userId: personForm.userId, groupIds: sortedIds(personForm.groupIds), expectedRevision: personForm.expectedRevision });
      notifyAccessChanged();
      const next = await load(true);
      const updated = next?.users?.find((person) => person.id === personForm.userId);
      const refreshedGroup = next?.permissionGroups?.find((group) => group.id === selectedGroupId);
      if (refreshedGroup && !groupDirty) { setGroupForm(formOf(refreshedGroup)); setBaseGroup(formOf(refreshedGroup)); }
      setPersonForm(updated ? { userId: updated.id, groupIds: sortedIds(idsOf(updated)), baseIds: sortedIds(idsOf(updated)), expectedRevision: updated.access_revision } : null);
      setMessage('Permission groups saved.'); setPersonDialog(false);
      if (afterSave) afterSave();
      return true;
    } catch (failure) { setError(`${failure.message} Your choices are retained. Refresh and review current access before retrying.`); return false; }
    finally { setSaving(false); }
  };
  const previewGroupSave = (afterSave = null) => {
    if (!groupForm?.label.trim()) { setError('Enter a permission group name.'); return; }
    const nextGroups = groupForm.id ? groups.map((group) => group.id === groupForm.id ? { ...group, ...groupForm } : group) : groups;
    const affected = groupMembers.map((person) => ({ person, changes: accessChanges(resolve(person, idsOf(person)), resolve(person, idsOf(person), nextGroups), modules, capabilities) })).filter((item) => item.changes.length);
    setImpact({ changes: accessChanges(baseGroup, groupForm, modules, capabilities), affected, afterSave });
  };
  const saveGroup = async () => {
    if (!impact || saving) return;
    const afterSave = impact.afterSave;
    setSaving(true); setError(''); setMessage('');
    try {
      const result = await invoke('adminPermissionGroupSave', { ...groupForm, label: groupForm.label.trim(), description: groupForm.description.trim(), expectedRevision: groupForm.revision });
      notifyAccessChanged();
      const next = await load(true);
      const saved = next?.permissionGroups?.find((group) => group.id === result.group?.id) || result.group;
      if (saved) { setSelectedGroupId(saved.id); setGroupForm(formOf(saved)); setBaseGroup(formOf(saved)); }
      setImpact(null); setMessage('Permission group saved.');
      if (afterSave) afterSave();
    } catch (failure) { setError(`${failure.message} Your edits are retained. Refresh and review the current group before retrying.`); }
    finally { setSaving(false); }
  };
  const deleteGroup = async () => {
    setSaving(true); setError('');
    try {
      await invoke('adminPermissionGroupDelete', { id: groupForm.id, expectedRevision: groupForm.revision });
      notifyAccessChanged(); setDeleteConfirmation(false); const next = await load(true); const first = next?.permissionGroups?.[0]; setSelectedGroupId(first?.id || ''); setGroupForm(first ? formOf(first) : null); setBaseGroup(first ? formOf(first) : null); setMessage('Permission group deleted.');
    } catch (failure) { setError(failure.message); }
    finally { setSaving(false); }
  };
  const generalManagerTransferPending = roleValue === 'general_manager' && rolePerson?.id !== data.generalManager?.userId;
  const saveRole = async (afterSave = null) => {
    if (!rolePerson || saving) return;
    if (generalManagerTransferPending && !confirmRoleTransfer) { setError('Confirm the General Manager transfer before saving.'); return; }
    setSaving(true); setError('');
    try {
      await invoke('adminUserSave', { id: rolePerson.id, email: rolePerson.email, full_name: rolePerson.full_name, active: rolePerson.active, user_type: roleValue, confirmGeneralManagerTransfer: generalManagerTransferPending });
      notifyAccessChanged(); setRolePerson(null); await load(true); setMessage('Organizational role saved.'); if (afterSave) afterSave();
    } catch (failure) { setError(failure.message); }
    finally { setSaving(false); }
  };
  const openIdentity = (person = null) => navigate(() => {
    setError('');
    const form = { id: person?.id || null, email: person?.email || '', full_name: person?.full_name || '', active: person?.active !== false, password: '', user_type: person?.user_type || 'viewer' };
    setIdentityForm(form); setIdentityBase(form);
  });
  const saveIdentity = async (afterSave = null) => {
    if (!identityForm || saving) return;
    if (!identityForm.email.trim() || (!identityForm.id && identityForm.password.length < 8)) { setError('Enter an email and a password of at least 8 characters for a new person.'); return; }
    setSaving(true); setError('');
    try {
      await invoke('adminUserSave', { ...identityForm, email: identityForm.email.trim().toLowerCase(), full_name: identityForm.full_name.trim() });
      notifyAccessChanged(); setIdentityForm(null); setIdentityBase(null); await load(true); setMessage('Person saved. Manage permission groups separately.'); if (afterSave) afterSave();
    } catch (failure) { setError(failure.message); }
    finally { setSaving(false); }
  };
  const deleteIdentity = async () => {
    if (!identityForm?.id || identityForm.id === currentUser?.id || identityForm.id === data.generalManager?.userId) return;
    if (!window.confirm(`Delete ${identityForm.email}? This revokes registered application sessions and removes their company login.`)) return;
    setSaving(true); setError('');
    try {
      await invoke('adminUserDelete', { id: identityForm.id }); notifyAccessChanged(); setIdentityForm(null); setIdentityBase(null); setPersonForm(null); await load(true); setMessage('Person deleted.');
    } catch (failure) { setError(failure.message); }
    finally { setSaving(false); }
  };
  const completePending = () => { const action = pendingNavigation; setPendingNavigation(null); action?.(); };
  const saveBeforeLeaving = () => {
    const afterSave = completePending;
    if (identityDirty) saveIdentity(afterSave);
    else if (personDirty) saveMembership(afterSave);
    else if (roleDirty) saveRole(afterSave);
    else if (groupDirty) { setPendingNavigation(null); previewGroupSave(afterSave); }
  };
  const visibleGroups = groups.filter((group) => (showLegacy || !group.is_legacy) && `${group.label} ${group.description}`.toLowerCase().includes(groupSearch.toLowerCase()));
  const filteredUsers = users.filter((person) => (statusFilter === 'all' || (statusFilter === 'active') === (person.active !== false)) && `${nameOf(person)} ${person.email} ${idsOf(person).map((id) => groupMap[id]?.label || id).join(' ')}`.toLowerCase().includes(peopleSearch.toLowerCase()));
  const memberCandidates = users.filter((person) => `${nameOf(person)} ${person.email}`.toLowerCase().includes(memberSearch.toLowerCase())).sort((a, b) => Number(idsOf(b).includes(selectedGroupId)) - Number(idsOf(a).includes(selectedGroupId)) || nameOf(a).localeCompare(nameOf(b)));
  const personEditor = currentPerson && <>
    <div className="shrink-0 border-b border-border p-3"><h2 className="font-semibold">{nameOf(currentPerson)}</h2><p className="break-all text-xs text-muted-foreground">{currentPerson.email}</p><div className="mt-2 flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">Organizational role: {USER_TYPES.find((role) => role.id === currentPerson.user_type)?.label || currentPerson.user_type}</span>{data.identityAuthority !== 'fcuno' && <Button variant="outline" size="sm" onClick={() => openIdentity(currentPerson)}>Manage identity</Button>}<Button variant="outline" size="sm" onClick={() => navigate(() => { setRolePerson(currentPerson); setRoleValue(currentPerson.user_type); setConfirmRoleTransfer(false); })}>Manage role</Button></div>{privilege(currentPerson) && <p className="mt-2 text-xs text-amber-800">Privileged organizational role grants full access independently of permission groups.</p>}{currentPerson.active === false && <p className="mt-2 text-xs text-red-700">Account disabled. Assigned groups do not grant access while disabled.</p>}</div>
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(190px,.8fr)_minmax(0,1.2fr)]">
      <section className="flex min-h-0 flex-col border-r border-border" aria-label="Assigned permission groups"><div className="space-y-2 border-b border-border p-3"><h3 className="text-xs font-semibold">Assign permission groups</h3><SearchInput label="Search assignment groups" value={groupChoiceSearch} onChange={setGroupChoiceSearch} placeholder="Find a group…" /></div><div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">{groups.filter((group) => group.label.toLowerCase().includes(groupChoiceSearch.toLowerCase())).map((group) => <label key={group.id} className="flex cursor-pointer items-start gap-2 rounded-md p-2 hover:bg-muted/30"><input type="checkbox" className="mt-0.5" checked={personForm.groupIds.includes(group.id)} disabled={saving || loading} onChange={(event) => setPersonForm((previous) => ({ ...previous, groupIds: event.target.checked ? [...previous.groupIds, group.id] : previous.groupIds.filter((id) => id !== group.id) }))} /><span className="min-w-0 text-sm"><span className="font-medium">{group.label}</span>{group.is_legacy && <span className="ml-1 text-[10px] text-muted-foreground">Legacy</span>}<span className="block text-xs text-muted-foreground">{group.description}</span></span></label>)}</div><p className="border-t border-border p-3 text-xs text-muted-foreground">{personForm.groupIds.length} selected · Grants combine across groups.</p></section>
      <section className="flex min-h-0 flex-col" aria-label="Effective access"><h3 className="border-b border-border px-3 py-2 text-xs font-semibold">Effective access {personDirty && <span className="font-normal text-muted-foreground">· Preview</span>}</h3><p className="shrink-0 border-b border-border px-3 py-2 text-[11px] text-muted-foreground">Groups grant page and action access. Administrator / General Manager-only controls also require the separate organizational role.</p><AccessPermissionPanel modules={modules} capabilities={capabilities} value={personAccess} readOnly sources={personAccess?.grant_sources} query={effectiveSearch} onQuery={setEffectiveSearch} enabledOnly={effectiveEnabled} onEnabledOnly={setEffectiveEnabled} /></section>
    </div>
    <div className="shrink-0 border-t border-border bg-background p-3"><p className="mb-2 text-xs text-muted-foreground">{personDirty ? `${personChanges.length} effective permission changes. Organizational role remains ${currentPerson.user_type}.` : 'Choose all groups this person needs. Save applies their combined access.'}</p>{personChanges.length > 0 && <details className="mb-2 text-xs"><summary className="cursor-pointer">Review access changes</summary><ul className="max-h-24 overflow-auto">{personChanges.map((change) => <li key={change.id}>{change.label}: {accessValueLabel(change.id, change.previous)} → {accessValueLabel(change.id, change.next)}</li>)}</ul></details>}<div className="flex justify-end gap-2"><Button variant="outline" disabled={!personDirty || saving} onClick={() => setPersonForm((previous) => ({ ...previous, groupIds: [...previous.baseIds] }))}>Cancel</Button><Button disabled={!personDirty || saving || !isSupabaseConfigured} onClick={() => saveMembership()}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save groups</Button></div></div>
  </>;

  return <div className="workspace-administration-canvas mx-auto max-w-[1600px] p-4 sm:p-6 lg:p-5">
    <PageHeader icon={ShieldCheck} title="People & Access" eyebrow="Administration" description="Choose a group, set its access, and assign it to people." actions={<>{methodologyAction}<Button variant="outline" size="icon" aria-label="Refresh People & Access" disabled={loading || saving} onClick={() => navigate(async () => { const next = await load(true); if (next) { const group = next.permissionGroups?.find((item) => item.id === selectedGroupId) || next.permissionGroups?.[0]; setGroupForm(group ? formOf(group) : null); setBaseGroup(group ? formOf(group) : null); setSelectedGroupId(group?.id || ''); setPersonForm(null); } })}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></Button></>} />
    {!isSupabaseConfigured && <p role="alert" className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">Access settings are unavailable until the company connection is configured.</p>}
    {authMode === 'local' && <p className="mt-3 text-xs text-amber-800">Local administrator mode is active.</p>}
    {error && <div role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {message && <p role="status" className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-700">{message}</p>}
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-1.5"><div className="flex gap-1"><TabButton active={section === 'groups'} onClick={() => navigate(() => { setSection('groups'); setPersonForm(null); })} icon={ShieldCheck}>Permission Groups</TabButton><TabButton active={section === 'people'} onClick={() => navigate(() => { setSection('people'); setPersonDialog(false); })} icon={Users}>People</TabButton><TabButton active={section === 'reporting'} onClick={() => navigate(() => setSection('reporting'))} icon={GitBranch}>Reporting Lines</TabButton></div><span className="px-2 text-xs text-muted-foreground">{groups.length} groups · {users.filter((person) => person.active !== false).length} active people</span></div>
    {data.identityAuthority === 'fcuno' && <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-muted-foreground"><p><strong>People are managed in FCUNO.</strong> Identity is read-only from FCUNO; assign FCOS groups here.</p><Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => window.open(FCUNO_USER_MANAGEMENT_URL, '_blank', 'noopener,noreferrer')}>Open FCUNO Users <ExternalLink className="h-3 w-3" /></Button></div>}
    {section === 'reporting' ? <section className="mt-3 rounded-xl border border-border bg-card p-4"><ReportingLinesPanel /></section>
      : loading && !groups.length ? <StateBlock icon={Loader2} title="Loading People & Access…" />
        : section === 'groups' ? <div ref={workspaceRef} className="mt-3 grid min-h-[420px] gap-3 lg:h-[var(--access-workspace-height)] lg:min-h-[320px] lg:grid-cols-[260px_minmax(0,1fr)]">
          <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card" aria-labelledby="permission-groups-title"><div className="flex items-center justify-between border-b border-border p-3"><h2 id="permission-groups-title" className="text-sm font-semibold">Permission groups</h2><Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => navigate(() => { setSelectedGroupId(''); setBaseGroup(blankGroup); setGroupForm({ ...blankGroup }); setGroupTab('permissions'); })}><Plus className="h-3 w-3" />New</Button></div><div className="space-y-2 border-b border-border p-3"><SearchInput label="Search permission groups" value={groupSearch} onChange={setGroupSearch} placeholder="Search groups…" /><label className="flex gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={showLegacy} onChange={(event) => setShowLegacy(event.target.checked)} />Show personal legacy groups</label></div><div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">{visibleGroups.map((group) => <button key={group.id} type="button" aria-pressed={selectedGroupId === group.id} onClick={() => selectGroup(group)} className={`w-full rounded-lg border px-3 py-2 text-left ${selectedGroupId === group.id ? 'border-primary/40 bg-primary/10' : 'border-transparent hover:bg-muted/30'}`}><span className="flex items-start justify-between gap-2 text-sm font-semibold"><span className="min-w-0 break-words">{group.label}</span><span className="shrink-0 text-xs font-normal text-muted-foreground">{group.member_count ?? users.filter((person) => idsOf(person).includes(group.id)).length}</span></span><span className="mt-0.5 block text-[11px] text-muted-foreground">{group.is_legacy ? 'Personal legacy group' : isAdministratorUserType(group.id) ? 'Protected group' : group.is_system ? 'Standard group' : 'Custom group'}</span></button>)}{!visibleGroups.length && <p className="p-3 text-sm text-muted-foreground">No matching groups.</p>}</div></section>
          <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card" aria-label="Group details">{groupForm ? <>
            <div className="shrink-0 space-y-2 border-b border-border p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0 flex-1"><label className="sr-only" htmlFor="access-group-name">Group name</label><Input id="access-group-name" value={groupForm.label} disabled={protectedGroup || saving || loading} onChange={(event) => setGroupForm((previous) => ({ ...previous, label: event.target.value }))} placeholder="Group name" className="h-9 max-w-xl font-semibold" /><label className="sr-only" htmlFor="access-group-description">Group description</label><Input id="access-group-description" value={groupForm.description} disabled={protectedGroup || saving || loading} onChange={(event) => setGroupForm((previous) => ({ ...previous, description: event.target.value }))} placeholder="What does this group do?" className="mt-2 h-8 max-w-xl text-xs" /></div><span className="shrink-0 text-xs text-muted-foreground">{groupMembers.length} members</span></div><div className="flex items-center gap-1"><TabButton active={groupTab === 'permissions'} onClick={() => navigate(() => setGroupTab('permissions'))}>Permissions</TabButton><TabButton active={groupTab === 'members'} onClick={() => navigate(() => setGroupTab('members'))}>Members</TabButton>{protectedGroup && <span className="ml-2 text-xs text-muted-foreground">Protected · Full access</span>}</div></div>
            {groupTab === 'permissions' ? <AccessPermissionPanel modules={modules} capabilities={capabilities} value={groupForm} locked={protectedGroup || saving || loading} query={permissionSearch} onQuery={setPermissionSearch} enabledOnly={enabledOnly} onEnabledOnly={setEnabledOnly} onChange={(kind, id, value) => setGroupForm((previous) => ({ ...previous, [kind]: { ...previous[kind], [id]: value } }))} />
              : <div className="flex min-h-0 flex-1 flex-col"><div className="border-b border-border p-3"><SearchInput label="Search group members" value={memberSearch} onChange={setMemberSearch} placeholder="Find people to add or remove…" /></div><div className="min-h-0 flex-1 overflow-y-auto p-3">{!groupForm.id && <p className="text-sm text-muted-foreground">Save the new group before adding members.</p>}{groupForm.id && memberCandidates.map((person) => <div key={person.id} className="flex items-center justify-between gap-3 border-b border-border py-2"><div className="min-w-0"><p className="truncate text-sm font-medium">{nameOf(person)} {person.active === false && <span className="text-xs text-muted-foreground">· Disabled</span>}</p><p className="truncate text-xs text-muted-foreground">{person.email}</p></div><Button size="sm" variant="outline" onClick={() => openPerson(person, groupForm.id)}>{idsOf(person).includes(groupForm.id) ? 'Remove' : 'Add'}</Button></div>)}</div></div>}
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-background p-3"><div>{groupForm.id && !protectedGroup && <Button size="sm" variant="ghost" className="text-red-700" disabled={saving || groupDirty || groupMembers.length > 0} title={groupMembers.length ? 'Reassign all members before deleting this group.' : ''} onClick={() => setDeleteConfirmation(true)}><Trash2 className="mr-1 h-4 w-4" />Delete</Button>}{groupMembers.length > 0 && !protectedGroup && <span className="text-[11px] text-muted-foreground">Reassign members to delete</span>}</div><div className="flex gap-2"><Button variant="outline" size="sm" disabled={!groupDirty || saving} onClick={() => setGroupForm(baseGroup)}>Cancel</Button><Button size="sm" disabled={!groupDirty || protectedGroup || saving || !isSupabaseConfigured} onClick={() => previewGroupSave()}><Save className="mr-1 h-4 w-4" />Review & save</Button></div></div>
          </> : <StateBlock title="Choose a permission group" description="Select a group on the left or create one." />}</section>
        </div>
          : <div ref={workspaceRef} className="mt-3 grid min-h-[420px] gap-3 lg:h-[var(--access-workspace-height)] lg:min-h-[320px] lg:grid-cols-[minmax(300px,.8fr)_minmax(0,1.2fr)]">
            <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card" aria-labelledby="people-panel-title"><div className="border-b border-border p-3"><div className="mb-2 flex items-center justify-between"><h2 id="people-panel-title" className="text-sm font-semibold">People</h2>{data.identityAuthority !== 'fcuno' && <Button size="sm" variant="outline" onClick={() => openIdentity()}>Add person</Button>}</div><div className="flex gap-2"><SearchInput label="Search people" value={peopleSearch} onChange={setPeopleSearch} placeholder="Name, email or group…" /><select aria-label="People status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-xs"><option value="all">All</option><option value="active">Active</option><option value="disabled">Disabled</option></select></div></div><div className="min-h-0 flex-1 overflow-y-auto"><table className="w-full table-fixed text-left text-sm"><thead className="sticky top-0 bg-muted"><tr><th className="w-[48%] p-3 text-xs">Person</th><th className="p-3 text-xs">Assigned groups</th></tr></thead><tbody>{filteredUsers.map((person) => <tr key={person.id} className={currentPerson?.id === person.id ? 'bg-primary/10' : 'hover:bg-muted/20'}><td className="border-b border-border p-3 align-top"><button type="button" className="w-full text-left" onClick={() => openPerson(person)}><span className="block truncate font-semibold">{nameOf(person)}</span><span className="block truncate text-xs text-muted-foreground">{person.email}</span><span className="block text-[11px] text-muted-foreground">{person.active === false ? 'Disabled' : 'Active'}</span></button></td><td className="border-b border-border p-3 align-top"><button type="button" className="flex w-full flex-wrap gap-1 text-left" aria-label={`Manage groups for ${nameOf(person)}`} onClick={() => openPerson(person)}>{idsOf(person).length ? idsOf(person).map((id) => <Badge key={id} variant="outline" className="max-w-full break-words text-[10px]">{groupMap[id]?.label || id}</Badge>) : <span className="text-xs text-muted-foreground">No groups</span>}</button></td></tr>)}</tbody></table>{!filteredUsers.length && <p className="p-4 text-sm text-muted-foreground">No matching people.</p>}</div></section>
            <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card" aria-label="Person access">{personEditor || <StateBlock icon={Users} title="Choose a person" description="Assign multiple groups and see exactly which permissions they grant." />}</section>
          </div>}
    <Dialog open={personDialog} onOpenChange={(open) => { if (!open) navigate(() => { setPersonDialog(false); setPersonForm(null); }); }}><DialogContent className="flex h-[80vh] max-w-5xl flex-col gap-0 overflow-hidden p-0"><DialogHeader className="border-b border-border p-4"><DialogTitle>Assign permission groups</DialogTitle><DialogDescription>Review combined access before saving.</DialogDescription></DialogHeader>{error && <p role="alert" className="bg-red-50 p-3 text-sm text-red-700">{error}</p>}{personEditor}</DialogContent></Dialog>
    <Dialog open={Boolean(pendingNavigation)} onOpenChange={(open) => { if (!open) setPendingNavigation(null); }}><DialogContent><DialogHeader><DialogTitle>Save your changes?</DialogTitle><DialogDescription>You have unsaved access changes. Save them, discard them, or stay here to continue editing.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setPendingNavigation(null)} disabled={saving}>Stay</Button><Button variant="outline" disabled={saving} onClick={() => { discard(); completePending(); }}>Discard</Button><Button disabled={saving} onClick={saveBeforeLeaving}>Save</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(impact)} onOpenChange={(open) => { if (!open && !saving) setImpact(null); }}><DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>Review group changes</DialogTitle><DialogDescription>{groupForm?.label} · {groupMembers.length} assigned people, {impact?.affected.length || 0} with effective access changes. Organizational roles remain unchanged.</DialogDescription></DialogHeader>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}<div className="space-y-3"><h3 className="text-sm font-semibold">Group permissions</h3>{!impact?.changes.length && <p className="text-xs text-muted-foreground">Name or description changes only.</p>}{impact?.changes.map((change) => <div key={change.id} className="flex justify-between gap-3 text-sm"><span>{change.label}</span><span className="text-xs">{accessValueLabel(change.id, change.previous)} → {accessValueLabel(change.id, change.next)}</span></div>)}{impact?.affected.length > 0 && <><h3 className="text-sm font-semibold">People affected</h3>{impact.affected.map(({ person, changes }) => <details key={person.id} className="rounded-md border border-border p-2"><summary className="cursor-pointer text-sm">{nameOf(person)} · {changes.length} permission changes</summary><ul className="mt-2 text-xs">{changes.map((change) => <li key={change.id}>{change.label}: {accessValueLabel(change.id, change.previous)} → {accessValueLabel(change.id, change.next)}</li>)}</ul></details>)}</>}</div><DialogFooter><Button variant="outline" disabled={saving} onClick={() => setImpact(null)}>Cancel</Button><Button disabled={saving} onClick={saveGroup}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save permission group</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={deleteConfirmation} onOpenChange={setDeleteConfirmation}><DialogContent><DialogHeader><DialogTitle>Delete {groupForm?.label}?</DialogTitle><DialogDescription>This empty permission group will be removed. The server rechecks memberships before deletion.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDeleteConfirmation(false)}>Cancel</Button><Button variant="destructive" disabled={saving} onClick={deleteGroup}>Delete group</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(identityForm)} onOpenChange={(open) => { if (!open) navigate(() => { setIdentityForm(null); setIdentityBase(null); }); }}><DialogContent><DialogHeader><DialogTitle>{identityForm?.id ? 'Manage identity' : 'Add person'}</DialogTitle><DialogDescription>Company login identity is separate from FCOS permission groups. New people receive no protected workspace grants until assigned a group.</DialogDescription></DialogHeader>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}<div className="space-y-3"><label className="block text-sm">Email<Input type="email" aria-label="Identity email" value={identityForm?.email || ''} disabled={Boolean(identityForm?.id) || saving} onChange={(event) => setIdentityForm((previous) => ({ ...previous, email: event.target.value }))} /></label><label className="block text-sm">Full name<Input aria-label="Identity full name" value={identityForm?.full_name || ''} disabled={saving} onChange={(event) => setIdentityForm((previous) => ({ ...previous, full_name: event.target.value }))} /></label><label className="block text-sm">{identityForm?.id ? 'New password (leave blank to keep current)' : 'Password'}<Input type="password" aria-label="Identity password" value={identityForm?.password || ''} disabled={saving} autoComplete="new-password" onChange={(event) => setIdentityForm((previous) => ({ ...previous, password: event.target.value }))} /></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={identityForm?.active !== false} disabled={saving || identityForm?.id === data.generalManager?.userId} onChange={(event) => setIdentityForm((previous) => ({ ...previous, active: event.target.checked }))} />Active account</label></div><DialogFooter>{identityForm?.id && <Button variant="destructive" disabled={saving || identityForm.id === currentUser?.id || identityForm.id === data.generalManager?.userId} onClick={deleteIdentity}>Delete person</Button>}<Button variant="outline" disabled={saving} onClick={() => navigate(() => { setIdentityForm(null); setIdentityBase(null); })}>Cancel</Button><Button disabled={saving || !identityDirty} onClick={() => saveIdentity()}>Save person</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(rolePerson)} onOpenChange={(open) => { if (!open) navigate(() => setRolePerson(null)); }}><DialogContent><DialogHeader><DialogTitle>Organizational role · {nameOf(rolePerson)}</DialogTitle><DialogDescription>Role administration is separate from permission group assignment. Administrator and General Manager grant privileged authority.</DialogDescription></DialogHeader>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}<label className="space-y-2 text-sm">Organizational role<select aria-label="Organizational role" value={roleValue} disabled={rolePerson?.id === data.generalManager?.userId || saving} onChange={(event) => { setRoleValue(event.target.value); setConfirmRoleTransfer(false); }} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3">{!USER_TYPES.some((role) => role.id === roleValue) && <option value={roleValue}>{roleValue}</option>}{USER_TYPES.map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}</select></label>{rolePerson?.id === data.generalManager?.userId && <p className="text-xs text-muted-foreground">This is the active reporting root. To appoint a successor, edit the successor and select General Manager as their user type.</p>}{generalManagerTransferPending && <label className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-xs text-amber-900"><input type="checkbox" checked={confirmRoleTransfer} onChange={(event) => setConfirmRoleTransfer(event.target.checked)} />Transfer General Manager authority from {data.generalManager?.name || data.generalManager?.email || 'the current General Manager'} to {nameOf(rolePerson)}. The former General Manager becomes an Administrator.</label>}<DialogFooter><Button variant="outline" disabled={saving} onClick={() => navigate(() => setRolePerson(null))}>Cancel</Button><Button disabled={saving || !roleDirty || (generalManagerTransferPending && !confirmRoleTransfer)} onClick={() => saveRole()}>Save role</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
