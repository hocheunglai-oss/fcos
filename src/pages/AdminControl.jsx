import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronRight,
  ExternalLink,
  GitBranch,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { appClient } from '@/api/appClient';
import { APP_CAPABILITIES, APP_MODULES, USER_TYPES, isAdministratorUserType } from '@/lib/authModules';
import { useAuth } from '@/lib/AuthContext';
import PageHeader from '@/components/common/PageHeader';
import DraftNotice from '@/components/common/DraftNotice';
import StateBlock from '@/components/common/StateBlock';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { clearDraft, readDraft, sameDraftValue, useDraftAutosave } from '@/lib/draftAutosave';
import ReportingLinesPanel from '@/components/admin/ReportingLinesPanel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useNavigationAwareRequest } from '@/hooks/useNavigationAwareRequest';

const emptyUserForm = {
  id: null,
  email: '',
  full_name: '',
  user_type: 'viewer',
  active: true,
  password: '',
  use_type_defaults: true,
  permissions: {},
  capabilities: {},
};

const emptyTypeForm = {
  id: null,
  label: '',
  description: '',
  sort_order: 100,
  is_system: false,
  permissions: { dashboard: true },
  capabilities: {},
};

const REPORT_ARCHIVE_MODULE_ID = 'report_archive';
const FCUNO_USER_MANAGEMENT_URL = 'https://fcuno.com/admin/usermanagement';
const REPORT_ARCHIVE_ACCESS_OPTIONS = [
  { value: 'none', label: 'No Access' },
  { value: 'read', label: 'Read Only' },
  { value: 'full', label: 'Full Access' },
];

function reportArchiveAccess(value) {
  if (value === 'full' || value === true) return 'full';
  if (value === 'read') return 'read';
  return 'none';
}

function permissionCanView(moduleId, value) {
  if (moduleId === REPORT_ARCHIVE_MODULE_ID) return reportArchiveAccess(value) !== 'none';
  return value === true;
}

function normalizedPermissions(modules, permissions = {}) {
  return Object.fromEntries(modules.map((module) => [
    module.id,
    module.id === REPORT_ARCHIVE_MODULE_ID
      ? reportArchiveAccess(permissions?.[module.id])
      : permissions?.[module.id] === true,
  ]));
}

function normalizedCapabilities(definitions, capabilities = {}) {
  return Object.fromEntries(definitions.map((capability) => [capability.id, capabilities?.[capability.id] === true]));
}

function typeLabel(type) {
  return String(type?.label || type?.id || '').replaceAll('_', ' ');
}

function compareText(a, b) {
  return String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' });
}

function permissionSummary(modules, permissions = {}) {
  const count = modules.filter((module) => permissionCanView(module.id, permissions?.[module.id])).length;
  if (count === modules.length) return 'All modules';
  if (count === 0) return 'No modules';
  return `${count} modules`;
}

function userInitials(user) {
  const source = String(user?.full_name || user?.email || '?').trim();
  const words = source.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words.at(-1)[0]}` : source.slice(0, 2)).toUpperCase();
}

function userDraftKey(form) {
  return form?.id ? `admin:user:${form.id}` : 'admin:user:new';
}

function userTypeDraftKey(form) {
  return form?.id ? `admin:user-type:${form.id}` : 'admin:user-type:new';
}

function safeUserDraft(form) {
  return { ...form, password: '' };
}

function SegmentButton({ active, children, icon: Icon, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs font-semibold ${
        active ? 'bg-primary text-primary-foreground shadow-sm' : 'border border-border bg-background text-muted-foreground hover:text-foreground'
      }`}
    >
      {Icon && <Icon className="h-4 w-4" />}
      {children}
    </button>
  );
}

function PermissionChoice({ active, children, disabled = false, onClick }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 min-w-[78px] items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed ${
        active
          ? 'border-primary bg-primary text-primary-foreground shadow-sm'
          : 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground disabled:opacity-55'
      }`}
    >
      {active && <Check className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

function ModuleGrid({ modules, permissions, locked = false, onSetAccess }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {modules.map((module) => {
        if (module.id === REPORT_ARCHIVE_MODULE_ID) {
          const currentAccess = reportArchiveAccess(permissions?.[module.id]);
          return (
            <div
              key={module.id}
              className={`min-h-10 rounded-md border border-border bg-background/60 px-3 py-2 text-sm ${locked ? 'opacity-75' : ''}`}
            >
              <div className="mb-2 font-medium text-foreground">{module.label}</div>
              <div className="grid grid-cols-3 overflow-hidden rounded-md border border-border">
                {REPORT_ARCHIVE_ACCESS_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    disabled={locked}
                    onClick={() => onSetAccess?.(module.id, option.value)}
                    className={`h-8 px-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed ${
                      currentAccess === option.value
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          );
        }

        const allowed = permissions?.[module.id] === true;
        return (
          <div
            key={module.id}
            className={`flex min-h-14 flex-col justify-between gap-2 rounded-xl border border-border bg-background/60 px-3 py-2.5 sm:flex-row sm:items-center ${locked ? 'opacity-80' : ''}`}
          >
            <span className="font-medium text-foreground">{module.label}</span>
            <div className="grid grid-cols-2 gap-1.5" role="group" aria-label={`${module.label} access`}>
              <PermissionChoice active={!allowed} disabled={locked} onClick={() => onSetAccess?.(module.id, false)}>
                No access
              </PermissionChoice>
              <PermissionChoice active={allowed} disabled={locked} onClick={() => onSetAccess?.(module.id, true)}>
                Access
              </PermissionChoice>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CapabilityGrid({ definitions, capabilities, locked = false, onSetAccess }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {definitions.map((capability) => {
        const allowed = capabilities?.[capability.id] === true;
        return (
          <div
            key={capability.id}
            className={`flex min-h-20 flex-col justify-between gap-2 rounded-xl border border-border bg-background/60 px-3 py-2.5 ${locked ? 'opacity-80' : ''}`}
          >
            <span>
              <span className="block font-medium text-foreground">{capability.label}</span>
              <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">{capability.description}</span>
            </span>
            <div className="grid grid-cols-2 gap-1.5 self-stretch sm:self-end" role="group" aria-label={`${capability.label} permission`}>
              <PermissionChoice active={!allowed} disabled={locked} onClick={() => onSetAccess?.(capability.id, false)}>
                Not allowed
              </PermissionChoice>
              <PermissionChoice active={allowed} disabled={locked} onClick={() => onSetAccess?.(capability.id, true)}>
                Allowed
              </PermissionChoice>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ReadOnlyPermissionGrid({ items, values, capability = false }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => {
        const value = item.id === REPORT_ARCHIVE_MODULE_ID
          ? reportArchiveAccess(values?.[item.id])
          : values?.[item.id] === true;
        const allowed = value === true || value === 'read' || value === 'full';
        const label = item.id === REPORT_ARCHIVE_MODULE_ID
          ? REPORT_ARCHIVE_ACCESS_OPTIONS.find((option) => option.value === value)?.label || 'No Access'
          : allowed ? capability ? 'Allowed' : 'Access' : capability ? 'Not allowed' : 'No access';
        return (
          <div key={item.id} className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-border bg-background/60 px-3 py-2">
            <span className="min-w-0 text-sm font-medium text-foreground">{item.label}</span>
            <Badge variant="outline" className={allowed ? 'shrink-0 border-emerald-200 bg-emerald-50 text-emerald-700' : 'shrink-0 border-border bg-muted/30 text-muted-foreground'}>
              {label}
            </Badge>
          </div>
        );
      })}
    </div>
  );
}

export default function AdminControl({ methodologyAction = null }) {
  const { request: requestUsers } = useNavigationAwareRequest('collaboration');
  const { authMode, isSupabaseConfigured, user: currentUser } = useAuth();
  const [activeSection, setActiveSection] = useState('access');
  const [selectedTypeId, setSelectedTypeId] = useState('');
  const [users, setUsers] = useState([]);
  const [modules, setModules] = useState(APP_MODULES);
  const [userTypes, setUserTypes] = useState(USER_TYPES);
  const [typePermissions, setTypePermissions] = useState({});
  const [capabilityDefinitions, setCapabilityDefinitions] = useState(APP_CAPABILITIES);
  const [typeCapabilities, setTypeCapabilities] = useState({});
  const [generalManager, setGeneralManager] = useState(null);
  const [identityAuthority, setIdentityAuthority] = useState('fcos');
  const [searchTerm, setSearchTerm] = useState('');
  const [userStatusFilter, setUserStatusFilter] = useState('all');
  const [userForm, setUserForm] = useState(emptyUserForm);
  const [typeForm, setTypeForm] = useState(emptyTypeForm);
  const [baseUserForm, setBaseUserForm] = useState(emptyUserForm);
  const [baseTypeForm, setBaseTypeForm] = useState(emptyTypeForm);
  const [userDraftRestoredAt, setUserDraftRestoredAt] = useState(null);
  const [typeDraftRestoredAt, setTypeDraftRestoredAt] = useState(null);
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [typeDialogOpen, setTypeDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savingUser, setSavingUser] = useState(false);
  const [savingType, setSavingType] = useState(false);
  const [deletingUser, setDeletingUser] = useState(false);
  const [deletingType, setDeletingType] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const sortedModules = useMemo(
    () => modules.slice().sort((a, b) => Number(a.sortOrder || a.sort_order || 0) - Number(b.sortOrder || b.sort_order || 0)),
    [modules]
  );
  const editableModules = useMemo(
    () => sortedModules.filter((module) => !['settings', 'admin'].includes(module.id)),
    [sortedModules]
  );
  const sortedUserTypes = useMemo(
    () => userTypes.slice().sort((a, b) => compareText(typeLabel(a), typeLabel(b))),
    [userTypes]
  );
  const sortedUsers = useMemo(
    () => users.slice().sort((a, b) => compareText(a.full_name || a.email, b.full_name || b.email)),
    [users]
  );
  const userTypeMap = useMemo(() => Object.fromEntries(userTypes.map((item) => [item.id, item])), [userTypes]);
  const filteredUsers = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return sortedUsers.filter((item) => {
      if (userStatusFilter === 'active' && item.active === false) return false;
      if (userStatusFilter === 'disabled' && item.active !== false) return false;
      if (!query) return true;
      const type = typeLabel(userTypeMap[item.user_type] || { id: item.user_type });
      return `${item.full_name || ''} ${item.email || ''} ${type}`.toLowerCase().includes(query);
    });
  }, [searchTerm, sortedUsers, userStatusFilter, userTypeMap]);
  const selectedAccessType = useMemo(
    () => sortedUserTypes.find((item) => item.id === selectedTypeId) || sortedUserTypes[0] || null,
    [selectedTypeId, sortedUserTypes]
  );
  const selectedAccessTypePermissions = useMemo(
    () => selectedAccessType
      ? normalizedPermissions(sortedModules, typePermissions[selectedAccessType.id] || {})
      : {},
    [selectedAccessType, sortedModules, typePermissions]
  );
  const selectedAccessTypeCapabilities = useMemo(
    () => selectedAccessType
      ? normalizedCapabilities(capabilityDefinitions, typeCapabilities[selectedAccessType.id] || {})
      : {},
    [capabilityDefinitions, selectedAccessType, typeCapabilities]
  );
  const activeUserCount = useMemo(() => users.filter((item) => item.active !== false).length, [users]);
  const disabledUserCount = users.length - activeUserCount;
  const selectedTypePermissions = useMemo(
    () => normalizedPermissions(sortedModules, typePermissions[userForm.user_type] || {}),
    [sortedModules, typePermissions, userForm.user_type]
  );
  const selectedTypeCapabilities = useMemo(
    () => normalizedCapabilities(capabilityDefinitions, typeCapabilities[userForm.user_type] || {}),
    [capabilityDefinitions, typeCapabilities, userForm.user_type]
  );
  const administratorPermissions = useMemo(
    () => Object.fromEntries(sortedModules.map((module) => [module.id, module.id === REPORT_ARCHIVE_MODULE_ID ? 'full' : true])),
    [sortedModules]
  );
  const administratorCapabilities = useMemo(
    () => Object.fromEntries(capabilityDefinitions.map((capability) => [capability.id, true])),
    [capabilityDefinitions]
  );
  const effectiveUserPermissions = isAdministratorUserType(userForm.user_type)
    ? administratorPermissions
    : userForm.use_type_defaults
      ? selectedTypePermissions
      : normalizedPermissions(sortedModules, userForm.permissions);
  const effectiveUserCapabilities = isAdministratorUserType(userForm.user_type)
    ? administratorCapabilities
    : userForm.use_type_defaults
      ? selectedTypeCapabilities
      : normalizedCapabilities(capabilityDefinitions, userForm.capabilities);
  const activeTypePermissions = isAdministratorUserType(typeForm.id)
    ? administratorPermissions
    : normalizedPermissions(sortedModules, typeForm.permissions);
  const activeTypeCapabilities = isAdministratorUserType(typeForm.id)
    ? administratorCapabilities
    : normalizedCapabilities(capabilityDefinitions, typeForm.capabilities);
  const selectedTypeAssignedCount = useMemo(
    () => users.filter((item) => item.user_type === typeForm.id).length,
    [typeForm.id, users]
  );
  const selectedUserIsGeneralManager = Boolean(userForm.id && userForm.id === generalManager?.userId);
  const generalManagerTransferPending = userForm.user_type === 'general_manager'
    && userForm.id !== generalManager?.userId;
  const activeUserDraftKey = userDraftKey(userForm);
  const activeTypeDraftKey = userTypeDraftKey(typeForm);
  const userDraftValue = useMemo(() => safeUserDraft(userForm), [userForm]);
  const baseUserDraftValue = useMemo(() => safeUserDraft(baseUserForm), [baseUserForm]);
  const userDraftDirty = Boolean(userDialogOpen && !sameDraftValue(userDraftValue, baseUserDraftValue));
  const typeDraftDirty = Boolean(typeDialogOpen && !sameDraftValue(typeForm, baseTypeForm));
  useDraftAutosave(activeUserDraftKey, userDraftValue, {
    enabled: userDialogOpen,
    dirty: userDraftDirty,
    message: 'Autosaved admin user draft. Save or discard it before leaving.',
  });
  useDraftAutosave(activeTypeDraftKey, typeForm, {
    enabled: typeDialogOpen,
    dirty: typeDraftDirty,
    message: 'Autosaved admin user type draft. Save or discard it before leaving.',
  });

  const load = async (options = {}) => {
    if (!isSupabaseConfigured) return;
    setLoading(true);
    setError('');
    try {
      await requestUsers({
        name: 'adminUsersList',
        force: options.force,
        apply: (usersRes) => {
          if (usersRes.data?.error) {
            setError(usersRes.data.error);
          } else {
            const nextModules = usersRes.data.modules?.length ? usersRes.data.modules : APP_MODULES;
            const nextUserTypes = usersRes.data.userTypes?.length ? usersRes.data.userTypes : USER_TYPES;
            setModules(nextModules);
            setUsers(usersRes.data.users || []);
            setUserTypes(nextUserTypes);
            setTypePermissions(usersRes.data.typePermissions || {});
            setCapabilityDefinitions(usersRes.data.capabilities?.length ? usersRes.data.capabilities : APP_CAPABILITIES);
            setTypeCapabilities(usersRes.data.typeCapabilities || {});
            setGeneralManager(usersRes.data.generalManager || null);
            setIdentityAuthority(usersRes.data.identityAuthority === 'fcuno' ? 'fcuno' : 'fcos');
          }
        },
      });
    } catch (loadError) {
      setError(loadError.message || 'Unable to load admin data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [isSupabaseConfigured]);

  const resetAlerts = () => {
    setMessage('');
    setError('');
  };

  const openUserDialog = (item) => {
    resetAlerts();
    setActiveSection('access');
    if (!item) {
      const base = {
        ...emptyUserForm,
        permissions: normalizedPermissions(sortedModules, typePermissions.viewer || {}),
        capabilities: normalizedCapabilities(capabilityDefinitions, typeCapabilities.viewer || {}),
      };
      const draft = readDraft(userDraftKey(base));
      const next = draft?.data && !sameDraftValue(draft.data, safeUserDraft(base))
        ? { ...base, ...draft.data, password: '' }
        : base;
      setBaseUserForm(base);
      setUserForm(next);
      setUserDraftRestoredAt(draft?.data && !sameDraftValue(safeUserDraft(next), safeUserDraft(base)) ? draft.updatedAt : null);
      setUserDialogOpen(true);
      return;
    }

    const useTypeDefaults = isAdministratorUserType(item.user_type) ? true : item.use_type_defaults !== false;
    const sourcePermissions = useTypeDefaults
      ? typePermissions[item.user_type] || item.permissions || {}
      : item.permissions || {};
    const sourceCapabilities = useTypeDefaults
      ? typeCapabilities[item.user_type] || item.capabilities || {}
      : item.capabilities || {};
    const base = {
      id: item.id,
      email: item.email || '',
      full_name: item.full_name || '',
      user_type: item.user_type || 'viewer',
      active: item.active !== false,
      password: '',
      use_type_defaults: useTypeDefaults,
      permissions: normalizedPermissions(sortedModules, sourcePermissions),
      capabilities: normalizedCapabilities(capabilityDefinitions, sourceCapabilities),
      identity_source: item.identity_source || 'fcos',
    };
    const draft = readDraft(userDraftKey(base));
    let next = draft?.data && !sameDraftValue(draft.data, safeUserDraft(base))
      ? { ...base, ...draft.data, password: '' }
      : base;
    if (item.id === generalManager?.userId) {
      next = { ...next, user_type: 'general_manager', active: true, use_type_defaults: true };
    }
    setBaseUserForm(base);
    setUserForm(next);
    setUserDraftRestoredAt(draft?.data && !sameDraftValue(safeUserDraft(next), safeUserDraft(base)) ? draft.updatedAt : null);
    setUserDialogOpen(true);
  };

  const setUserType = (userType) => {
    setUserForm((prev) => {
      const useTypeDefaults = isAdministratorUserType(userType) ? true : prev.use_type_defaults;
      const typeDefaults = normalizedPermissions(sortedModules, typePermissions[userType] || {});
      const capabilityDefaults = normalizedCapabilities(capabilityDefinitions, typeCapabilities[userType] || {});
      return {
        ...prev,
        user_type: userType,
        use_type_defaults: useTypeDefaults,
        permissions: useTypeDefaults ? typeDefaults : normalizedPermissions(sortedModules, prev.permissions),
        capabilities: useTypeDefaults ? capabilityDefaults : normalizedCapabilities(capabilityDefinitions, prev.capabilities),
      };
    });
  };

  const setUseTypeDefaults = (checked) => {
    setUserForm((prev) => ({
      ...prev,
      use_type_defaults: checked,
      permissions: checked
        ? normalizedPermissions(sortedModules, typePermissions[prev.user_type] || {})
        : normalizedPermissions(sortedModules, effectiveUserPermissions),
      capabilities: checked
        ? normalizedCapabilities(capabilityDefinitions, typeCapabilities[prev.user_type] || {})
        : normalizedCapabilities(capabilityDefinitions, effectiveUserCapabilities),
    }));
  };

  const setUserModuleAccess = (moduleId, access) => {
    setUserForm((prev) => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [moduleId]: moduleId === REPORT_ARCHIVE_MODULE_ID ? reportArchiveAccess(access) : access === true,
      },
    }));
  };

  const setUserCapabilityAccess = (capabilityId, allowed) => {
    setUserForm((prev) => ({
      ...prev,
      capabilities: {
        ...prev.capabilities,
        [capabilityId]: allowed === true,
      },
    }));
  };

  const saveUser = async (event) => {
    event.preventDefault();
    if (generalManagerTransferPending) {
      const confirmed = window.confirm(
        `Transfer General Manager authority from ${generalManager?.name || generalManager?.email || 'the current General Manager'} to ${userForm.full_name.trim() || userForm.email.trim()}? The former General Manager will become an Administrator and will need a reporting line.`,
      );
      if (!confirmed) return;
    }
    setSavingUser(true);
    setError('');
    setMessage('');
    const payload = {
      id: userForm.id,
      email: userForm.email.trim().toLowerCase(),
      full_name: userForm.full_name.trim(),
      user_type: userForm.user_type,
      active: userForm.active,
      password: userForm.password,
      use_type_defaults: isAdministratorUserType(userForm.user_type) ? true : userForm.use_type_defaults,
      permissions: isAdministratorUserType(userForm.user_type) ? administratorPermissions : normalizedPermissions(sortedModules, userForm.permissions),
      capabilities: isAdministratorUserType(userForm.user_type) ? administratorCapabilities : normalizedCapabilities(capabilityDefinitions, userForm.capabilities),
      confirmGeneralManagerTransfer: generalManagerTransferPending,
    };
    const res = await appClient.functions.invoke('adminUserSave', payload);
    setSavingUser(false);
    if (res.data?.error) {
      setError(res.data.error);
      return;
    }
    clearDraft(activeUserDraftKey);
    setUserDraftRestoredAt(null);
    const syncFailures = res.data.portalSyncErrors || [];
    const transfer = res.data.user?.generalManagerTransfer;
    setMessage(transfer?.transferred
      ? `General Manager authority transferred to ${transfer.generalManagerName || userForm.full_name}. ${transfer.formerGeneralManagerName || 'The former General Manager'} is now an Administrator and should be assigned a Primary Manager.`
      : syncFailures.length
        ? `User saved. ${syncFailures.length} application access update${syncFailures.length === 1 ? '' : 's'} will be retried.`
        : 'User saved.');
    setUserDialogOpen(false);
    setUserForm((prev) => ({ ...prev, id: res.data.user?.id || prev.id, password: '' }));
    await load({ force: true });
  };

  const deleteUser = async () => {
    if (!userForm.id || userForm.id === currentUser?.id) return;
    const confirmed = window.confirm(
      `Delete ${userForm.email}? This revokes registered application sessions, then removes the Supabase login and access profile.`,
    );
    if (!confirmed) return;
    setDeletingUser(true);
    setError('');
    setMessage('');
    const res = await appClient.functions.invoke('adminUserDelete', { id: userForm.id });
    setDeletingUser(false);
    if (res.data?.error) {
      setError(res.data.error);
      return;
    }
    setMessage('User deleted.');
    clearDraft(activeUserDraftKey);
    setUserDraftRestoredAt(null);
    setUserDialogOpen(false);
    setUserForm(emptyUserForm);
    await load({ force: true });
  };

  const openTypeDialog = (item) => {
    resetAlerts();
    setActiveSection('access');
    if (!item) {
      const base = {
        ...emptyTypeForm,
        permissions: normalizedPermissions(sortedModules, { dashboard: true }),
        capabilities: normalizedCapabilities(capabilityDefinitions, {}),
      };
      const draft = readDraft(userTypeDraftKey(base));
      const next = draft?.data && !sameDraftValue(draft.data, base)
        ? { ...base, ...draft.data }
        : base;
      setBaseTypeForm(base);
      setTypeForm(next);
      setTypeDraftRestoredAt(draft?.data && !sameDraftValue(next, base) ? draft.updatedAt : null);
      setTypeDialogOpen(true);
      return;
    }

    const base = {
      id: item.id,
      label: item.label || item.id,
      description: item.description || '',
      sort_order: item.sort_order ?? item.sortOrder ?? 100,
      is_system: item.is_system === true,
      permissions: normalizedPermissions(sortedModules, typePermissions[item.id] || {}),
      capabilities: normalizedCapabilities(capabilityDefinitions, typeCapabilities[item.id] || {}),
    };
    const draft = readDraft(userTypeDraftKey(base));
    const next = draft?.data && !sameDraftValue(draft.data, base)
      ? { ...base, ...draft.data }
      : base;
    setBaseTypeForm(base);
    setTypeForm(next);
    setSelectedTypeId(item.id);
    setTypeDraftRestoredAt(draft?.data && !sameDraftValue(next, base) ? draft.updatedAt : null);
    setTypeDialogOpen(true);
  };

  const setTypeModuleAccess = (moduleId, access) => {
    setTypeForm((prev) => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [moduleId]: moduleId === REPORT_ARCHIVE_MODULE_ID ? reportArchiveAccess(access) : access === true,
      },
    }));
  };

  const setTypeCapabilityAccess = (capabilityId, allowed) => {
    setTypeForm((prev) => ({
      ...prev,
      capabilities: {
        ...prev.capabilities,
        [capabilityId]: allowed === true,
      },
    }));
  };

  const saveUserType = async (event) => {
    event.preventDefault();
    setSavingType(true);
    setError('');
    setMessage('');
    const payload = {
      id: typeForm.id,
      label: typeForm.label.trim(),
      description: typeForm.description.trim(),
      sort_order: typeForm.sort_order,
      permissions: isAdministratorUserType(typeForm.id) ? administratorPermissions : normalizedPermissions(sortedModules, typeForm.permissions),
      capabilities: isAdministratorUserType(typeForm.id) ? administratorCapabilities : normalizedCapabilities(capabilityDefinitions, typeForm.capabilities),
    };
    const res = await appClient.functions.invoke('adminUserTypeSave', payload);
    setSavingType(false);
    if (res.data?.error) {
      setError(res.data.error);
      return;
    }
    clearDraft(activeTypeDraftKey);
    setTypeDraftRestoredAt(null);
    setMessage('User type saved.');
    setTypeDialogOpen(false);
    setSelectedTypeId(res.data.userType?.id || typeForm.id || '');
    setTypeForm((prev) => ({
      ...prev,
      id: res.data.userType?.id || prev.id,
      is_system: res.data.userType?.is_system === true,
      permissions: normalizedPermissions(sortedModules, res.data.userType?.permissions || prev.permissions),
      capabilities: normalizedCapabilities(capabilityDefinitions, res.data.userType?.capabilities || prev.capabilities),
    }));
    await load({ force: true });
  };

  const deleteUserType = async () => {
    if (!typeForm.id || isAdministratorUserType(typeForm.id)) return;
    if (selectedTypeAssignedCount > 0) {
      setError('This user type is assigned to users. Reassign those users before deleting it.');
      return;
    }
    const confirmed = window.confirm(`Delete user type ${typeForm.label}?`);
    if (!confirmed) return;
    setDeletingType(true);
    setError('');
    setMessage('');
    const res = await appClient.functions.invoke('adminUserTypeDelete', { id: typeForm.id });
    setDeletingType(false);
    if (res.data?.error) {
      setError(res.data.error);
      return;
    }
    setMessage('User type deleted.');
    clearDraft(activeTypeDraftKey);
    setTypeDraftRestoredAt(null);
    setTypeDialogOpen(false);
    setTypeForm(emptyTypeForm);
    setSelectedTypeId('');
    await load({ force: true });
  };

  const canDeleteSelectedType = typeForm.id && !isAdministratorUserType(typeForm.id) && selectedTypeAssignedCount === 0;
  const discardUserDraft = () => {
    clearDraft(activeUserDraftKey);
    setUserForm(baseUserForm);
    setUserDraftRestoredAt(null);
  };
  const discardTypeDraft = () => {
    clearDraft(activeTypeDraftKey);
    setTypeForm(baseTypeForm);
    setTypeDraftRestoredAt(null);
  };

  return (
    <div className="workspace-administration-canvas mx-auto max-w-[1440px] p-4 sm:p-6 lg:p-8">
      <PageHeader
        icon={ShieldCheck}
        eyebrow="Administration"
        title="People & Access"
        description="Choose a person to manage their FCOS access, or review the reusable permission group that supplies it."
        actions={(
          <>
            {methodologyAction}
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => load({ force: true })}
              disabled={loading || !isSupabaseConfigured}
              title="Refresh People & Access"
              aria-label="Refresh People & Access"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </>
        )}
      />

      {!isSupabaseConfigured && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Supabase is not configured yet. Add the Supabase keys in Vercel and run the migration in this repo.
        </div>
      )}

      {authMode === 'local' && isSupabaseConfigured && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Local administrator mode is active. Sign in with Supabase to enforce production access control.
        </div>
      )}

      {error && <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {message && <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div>}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-2">
        <div className="flex flex-wrap items-center gap-2">
            <SegmentButton active={activeSection === 'access'} icon={Users} onClick={() => setActiveSection('access')}>
              Access overview
            </SegmentButton>
            <SegmentButton active={activeSection === 'reporting'} icon={GitBranch} onClick={() => setActiveSection('reporting')}>
              Reporting Lines
            </SegmentButton>
        </div>
        {activeSection === 'access' && <span className="px-2 text-xs text-muted-foreground">{activeUserCount} active · {disabledUserCount} disabled · {userTypes.length} permission groups</span>}
      </div>

      {activeSection === 'reporting' ? (
        <section className="mt-4 rounded-2xl border border-border bg-card p-4 lg:p-5">
          <ReportingLinesPanel />
        </section>
      ) : (
        <>
          {identityAuthority === 'fcuno' && (
            <div className="mt-4 flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 sm:flex-row sm:items-center sm:justify-between">
              <div><span className="font-semibold">People are managed in FCUNO.</span> Names, email addresses, and account status are read-only here; FCOS permissions remain editable below.</div>
              <Button type="button" variant="outline" className="shrink-0 gap-2 border-blue-200 bg-white text-blue-800" onClick={() => window.open(FCUNO_USER_MANAGEMENT_URL, '_blank', 'noopener,noreferrer')}>
                Open FCUNO Users <ExternalLink className="h-4 w-4" />
              </Button>
            </div>
          )}

          <div className="mt-4 grid min-h-0 gap-4 xl:grid-cols-[minmax(310px,0.8fr)_minmax(0,1.45fr)]">
            <section className="overflow-hidden rounded-2xl border border-border bg-card" aria-labelledby="people-panel-title">
              <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/20 px-4 py-3">
                <div>
                  <h2 id="people-panel-title" className="text-sm font-semibold text-foreground">People</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">{users.length} account{users.length === 1 ? '' : 's'}</p>
                </div>
                {identityAuthority !== 'fcuno' && (
                  <Button type="button" size="sm" onClick={() => openUserDialog(null)} disabled={!isSupabaseConfigured} className="gap-2">
                    <UserPlus className="h-4 w-4" /> Add user
                  </Button>
                )}
              </div>
              <div className="grid gap-2 border-b border-border p-3 sm:grid-cols-[minmax(0,1fr)_120px] xl:grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_120px]">
                <div className="relative min-w-0">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search name, email, or type" className="h-9 pl-8" />
                </div>
                <Select value={userStatusFilter} onValueChange={setUserStatusFilter}>
                  <SelectTrigger className="h-9" aria-label="User status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All users</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="disabled">Disabled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {loading ? (
                <StateBlock icon={Loader2} title="Loading people..." description="Fetching FCOS access records." />
              ) : filteredUsers.length ? (
                <div className="max-h-[calc(100vh-315px)] space-y-2 overflow-auto p-3">
                  {filteredUsers.map((item) => {
                    const permissions = item.use_type_defaults !== false
                      ? typePermissions[item.user_type] || item.permissions || {}
                      : item.permissions || {};
                    return (
                      <div key={item.id} className="grid grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-border bg-background/60 p-2.5 transition-colors hover:border-primary/30 hover:bg-muted/20">
                        <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-xs font-semibold text-primary" aria-hidden="true">{userInitials(item)}</div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-foreground">{item.full_name || item.email}</div>
                          <div className="mt-0.5 truncate text-xs text-muted-foreground">{item.email}</div>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <Badge variant="outline">{typeLabel(userTypeMap[item.user_type] || { id: item.user_type })}</Badge>
                            <Badge variant="outline" className={item.active ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}>{item.active ? 'Active' : 'Disabled'}</Badge>
                            {item.id === generalManager?.userId && <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">Reporting root</Badge>}
                          </div>
                          <div className="mt-1.5 text-[11px] text-muted-foreground">{item.use_type_defaults !== false ? 'Uses permission group' : `Custom access · ${permissionSummary(sortedModules, permissions)}`}</div>
                        </div>
                        <Button type="button" variant="ghost" size="icon" onClick={() => openUserDialog(item)} title={`Edit ${item.full_name || item.email}`} aria-label={`Edit ${item.full_name || item.email}`}>
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <StateBlock title="No matching people" description="Change the search or status filter." />
              )}
            </section>

            <section className="overflow-hidden rounded-2xl border border-border bg-card" aria-labelledby="permission-groups-title">
              <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/20 px-4 py-3">
                <div>
                  <h2 id="permission-groups-title" className="text-sm font-semibold text-foreground">Permission groups</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">Reusable FCOS access for people with the same responsibilities</p>
                </div>
                <Button type="button" size="sm" variant="outline" onClick={() => openTypeDialog(null)} disabled={!isSupabaseConfigured} className="gap-2">
                  <Plus className="h-4 w-4" /> New group
                </Button>
              </div>

              {loading ? (
                <StateBlock icon={Loader2} title="Loading permission groups..." description="Fetching access templates." />
              ) : selectedAccessType ? (
                <div className="max-h-[calc(100vh-250px)] overflow-auto p-4">
                  <div className="flex gap-2 overflow-x-auto pb-2" aria-label="Permission groups">
                    {sortedUserTypes.map((item) => {
                      const active = item.id === selectedAccessType.id;
                      const assignedCount = users.filter((userItem) => userItem.user_type === item.id).length;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setSelectedTypeId(item.id)}
                          className={`shrink-0 rounded-full border px-3 py-2 text-xs font-semibold transition-colors ${active ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'border-border bg-background text-muted-foreground hover:text-foreground'}`}
                        >
                          {typeLabel(item)} <span className="font-normal opacity-80">· {assignedCount}</span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-border bg-muted/15 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-foreground">{typeLabel(selectedAccessType)}</h3>
                        <Badge variant="outline">{selectedAccessType.is_system ? 'System group' : 'Custom group'}</Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{selectedAccessType.description || 'No description provided.'}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {users.filter((item) => item.user_type === selectedAccessType.id).length} assigned · {permissionSummary(editableModules, selectedAccessTypePermissions)}
                      </p>
                    </div>
                    <Button type="button" onClick={() => openTypeDialog(selectedAccessType)} className="shrink-0 gap-2">
                      <Pencil className="h-4 w-4" /> Edit permissions
                    </Button>
                  </div>

                  <div className="mt-5 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Workspace access</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">Pages and operational workspaces available to this group</p>
                    </div>
                    {isAdministratorUserType(selectedAccessType.id) && <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground"><KeyRound className="h-3.5 w-3.5" /> Full access</span>}
                  </div>
                  <div className="mt-2">
                    <ReadOnlyPermissionGrid items={editableModules} values={isAdministratorUserType(selectedAccessType.id) ? administratorPermissions : selectedAccessTypePermissions} />
                  </div>

                  <div className="mt-5">
                    <h3 className="text-sm font-semibold text-foreground">Approval and administration permissions</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">Higher-risk actions granted in addition to workspace access</p>
                  </div>
                  <div className="mt-2">
                    <ReadOnlyPermissionGrid items={capabilityDefinitions} values={isAdministratorUserType(selectedAccessType.id) ? administratorCapabilities : selectedAccessTypeCapabilities} capability />
                  </div>
                </div>
              ) : (
                <StateBlock title="No permission groups" description="Create a group to define reusable FCOS access." />
              )}
            </section>
          </div>
        </>
      )}

      <Dialog open={userDialogOpen} onOpenChange={setUserDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-5 py-4">
            <DialogTitle>{userForm.id ? `Manage access for ${userForm.full_name || userForm.email}` : 'Add person'}</DialogTitle>
            <DialogDescription>{identityAuthority === 'fcuno' ? 'Identity is read-only from FCUNO. Manage only FCOS authorization here.' : 'Set the person’s identity and FCOS permissions.'}</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveUser} className="min-h-0">
            <div className="max-h-[calc(90vh-150px)] overflow-auto px-5 py-4">
              <DraftNotice restoredAt={userDraftRestoredAt} label="Admin user draft restored" onDiscard={discardUserDraft} className="mb-4" />
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email</span>
                  <input
                    type="email"
                    value={userForm.email}
                    onChange={(event) => setUserForm((prev) => ({ ...prev, email: event.target.value }))}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    required
                    disabled={Boolean(userForm.id) || identityAuthority === 'fcuno'}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Full Name</span>
                  <input
                    value={userForm.full_name}
                    onChange={(event) => setUserForm((prev) => ({ ...prev, full_name: event.target.value }))}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    disabled={identityAuthority === 'fcuno'}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Permission Group</span>
                  <select
                    value={userForm.user_type}
                    onChange={(event) => setUserType(event.target.value)}
                    disabled={selectedUserIsGeneralManager}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {sortedUserTypes.map((item) => <option key={item.id} value={item.id}>{typeLabel(item)}</option>)}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{userForm.id ? 'New Password' : 'Password'}</span>
                  <input
                    type="password"
                    value={userForm.password}
                    onChange={(event) => setUserForm((prev) => ({ ...prev, password: event.target.value }))}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    required={!userForm.id}
                    minLength={8}
                    placeholder={userForm.id ? 'Leave blank to keep current password' : ''}
                    disabled={identityAuthority === 'fcuno'}
                  />
                </label>
              </div>

              {selectedUserIsGeneralManager && (
                <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                  This user is the active General Manager and reporting root. To appoint a successor, edit the successor and select General Manager as their user type.
                </div>
              )}
              {generalManagerTransferPending && (
                <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  Saving will transfer General Manager authority from <span className="font-semibold">{generalManager?.name || generalManager?.email}</span> to this user. The former General Manager will become an Administrator and appear in Reporting Lines until a Primary Manager is assigned.
                </div>
              )}

              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <section className="rounded-xl border border-border bg-muted/15 p-3" aria-labelledby="account-status-heading">
                  <div id="account-status-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Account status</div>
                  {identityAuthority === 'fcuno' ? (
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <Badge variant="outline" className={userForm.active ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}>{userForm.active ? 'Active' : 'Disabled'}</Badge>
                      <span className="text-xs text-muted-foreground">Managed in FCUNO</span>
                    </div>
                  ) : (
                    <div className="mt-2 grid grid-cols-2 gap-2" role="group" aria-label="Account status">
                      <PermissionChoice
                        active={userForm.active}
                        disabled={selectedUserIsGeneralManager || userForm.user_type === 'general_manager'}
                        onClick={() => setUserForm((prev) => ({ ...prev, active: true }))}
                      >
                        Active
                      </PermissionChoice>
                      <PermissionChoice
                        active={!userForm.active}
                        disabled={selectedUserIsGeneralManager || userForm.user_type === 'general_manager'}
                        onClick={() => setUserForm((prev) => ({ ...prev, active: false }))}
                      >
                        Disabled
                      </PermissionChoice>
                    </div>
                  )}
                </section>

                <section className="rounded-xl border border-border bg-muted/15 p-3" aria-labelledby="access-source-heading">
                  <div id="access-source-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Access source</div>
                  <div className="mt-2 grid grid-cols-2 gap-2" role="group" aria-label="Access source">
                    <PermissionChoice
                      active={isAdministratorUserType(userForm.user_type) || userForm.use_type_defaults}
                      onClick={() => setUseTypeDefaults(true)}
                    >
                      Permission group
                    </PermissionChoice>
                    <PermissionChoice
                      active={!isAdministratorUserType(userForm.user_type) && !userForm.use_type_defaults}
                      disabled={isAdministratorUserType(userForm.user_type)}
                      onClick={() => setUseTypeDefaults(false)}
                    >
                      Custom access
                    </PermissionChoice>
                  </div>
                  <p className="mt-2 text-xs leading-4 text-muted-foreground">
                    {isAdministratorUserType(userForm.user_type) || userForm.use_type_defaults
                      ? `Uses the ${typeLabel(userTypeMap[userForm.user_type] || { id: userForm.user_type })} group permissions.`
                      : 'Uses access choices set specifically for this person.'}
                  </p>
                </section>
              </div>

              <div className="mt-6">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Workspace Access</div>
                  <div className="text-xs text-muted-foreground">
                    {userForm.use_type_defaults || isAdministratorUserType(userForm.user_type) ? 'Inherited' : 'Custom'}
                  </div>
                </div>
                <ModuleGrid
                  modules={editableModules}
                  permissions={effectiveUserPermissions}
                  locked={isAdministratorUserType(userForm.user_type) || userForm.use_type_defaults}
                  onSetAccess={setUserModuleAccess}
                />
              </div>
              <div className="mt-6">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Approval and Administration Permissions</div>
                  <div className="text-xs text-muted-foreground">
                    {userForm.use_type_defaults || isAdministratorUserType(userForm.user_type) ? 'Inherited' : 'Custom'}
                  </div>
                </div>
                <CapabilityGrid
                  definitions={capabilityDefinitions}
                  capabilities={effectiveUserCapabilities}
                  locked={isAdministratorUserType(userForm.user_type) || userForm.use_type_defaults}
                  onSetAccess={setUserCapabilityAccess}
                />
              </div>
            </div>
            <DialogFooter className="border-t border-border px-5 py-4">
              {identityAuthority !== 'fcuno' && userForm.id && userForm.id !== currentUser?.id && (
                <button
                  type="button"
                  onClick={deleteUser}
                  disabled={deletingUser || !isSupabaseConfigured}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-700 disabled:opacity-60"
                >
                  {deletingUser ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Delete
                </button>
              )}
              <button
                type="button"
                onClick={() => setUserDialogOpen(false)}
                className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-semibold text-foreground"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingUser || !isSupabaseConfigured}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {savingUser ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Access
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={typeDialogOpen} onOpenChange={setTypeDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-5 py-4">
            <DialogTitle>{typeForm.id ? `Edit ${typeForm.label || 'permission group'}` : 'New permission group'}</DialogTitle>
            <DialogDescription>Set reusable workspace and approval access for people with the same responsibilities.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveUserType}>
            <div className="max-h-[calc(90vh-150px)] overflow-auto px-5 py-4">
              <DraftNotice restoredAt={typeDraftRestoredAt} label="Admin user type draft restored" onDiscard={discardTypeDraft} className="mb-4" />
              {isAdministratorUserType(typeForm.id) && (
                <div className="mb-4 rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                  {typeForm.id === 'general_manager' ? 'General Manager' : 'Administrator'} is protected and always has full access.
                </div>
              )}
              {typeForm.id && !isAdministratorUserType(typeForm.id) && selectedTypeAssignedCount > 0 && (
                <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  This type has {selectedTypeAssignedCount} assigned user{selectedTypeAssignedCount === 1 ? '' : 's'}. Reassign them before deleting it.
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Group Name</span>
                  <input
                    value={typeForm.label}
                    onChange={(event) => setTypeForm((prev) => ({ ...prev, label: event.target.value }))}
                    disabled={isAdministratorUserType(typeForm.id)}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                    required
                  />
                </label>
                <label className="space-y-1.5 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</span>
                  <input
                    value={typeForm.description}
                    onChange={(event) => setTypeForm((prev) => ({ ...prev, description: event.target.value }))}
                    disabled={isAdministratorUserType(typeForm.id)}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </label>
              </div>

              <div className="mt-6">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Workspace Access</div>
                  {isAdministratorUserType(typeForm.id) && (
                    <div className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                      <KeyRound className="h-3.5 w-3.5" /> Always full access
                    </div>
                  )}
                </div>
                <ModuleGrid
                  modules={editableModules}
                  permissions={activeTypePermissions}
                  locked={isAdministratorUserType(typeForm.id)}
                  onSetAccess={setTypeModuleAccess}
                />
              </div>
              <div className="mt-6">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Approval and Administration Permissions</div>
                  {isAdministratorUserType(typeForm.id) && (
                    <div className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                      <KeyRound className="h-3.5 w-3.5" /> Always full access
                    </div>
                  )}
                </div>
                <CapabilityGrid
                  definitions={capabilityDefinitions}
                  capabilities={activeTypeCapabilities}
                  locked={isAdministratorUserType(typeForm.id)}
                  onSetAccess={setTypeCapabilityAccess}
                />
              </div>
            </div>
            <DialogFooter className="border-t border-border px-5 py-4">
              {typeForm.id && !isAdministratorUserType(typeForm.id) && (
                <button
                  type="button"
                  onClick={deleteUserType}
                  disabled={!canDeleteSelectedType || deletingType || !isSupabaseConfigured}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-700 disabled:opacity-50"
                  title={selectedTypeAssignedCount > 0 ? 'Reassign users before deleting this type.' : ''}
                >
                  {deletingType ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Delete
                </button>
              )}
              <button
                type="button"
                onClick={() => setTypeDialogOpen(false)}
                className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-semibold text-foreground"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingType || !isSupabaseConfigured}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {savingType ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Permission Group
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
