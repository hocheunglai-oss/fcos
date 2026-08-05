import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  ClipboardCheck,
  DollarSign,
  Eye,
  EyeOff,
  FileCheck2,
  GripVertical,
  History,
  HandCoins,
  ChartNoAxesCombined,
  CandlestickChart,
  LayoutDashboard,
  Lightbulb,
  ListTodo,
  MailSearch,
  RotateCcw,
  Save,
  Sprout,
  ReceiptText,
  RefreshCw,
  ScrollText,
  Settings,
  TrendingUp,
  UsersRound,
  WalletCards,
  UserRoundCheck,
  X,
} from 'lucide-react';
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/AuthContext';
import { appClient } from '@/api/appClient';
import { APP_VERSION, APP_VERSION_HISTORY } from '@/lib/appVersion';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import WorkNotifications from '@/components/WorkNotifications';
import { workspaceNavigation } from '@/lib/workspaceStandards';
import { readDocumentSettings, saveDocumentSettings } from '@/lib/documentSettings';

const navGroups = [
  {
    id: 'personal',
    label: 'Personal',
    items: [
      workspaceNavigation('my_commitments', { icon: UserRoundCheck }),
      workspaceNavigation('growth_coaching', { icon: Sprout }),
      workspaceNavigation('projects_tasks', { icon: ListTodo }),
      workspaceNavigation('fcos_improvements', { icon: Lightbulb }),
    ],
  },
  {
    id: 'trading',
    label: 'Trading',
    items: [
      workspaceNavigation('dashboard', { moduleId: 'dashboard', icon: LayoutDashboard }),
      workspaceNavigation('buyers_administrator', { moduleId: 'buyers_administrator', icon: UsersRound }),
      workspaceNavigation('markets', { moduleId: 'markets', icon: CandlestickChart }),
      workspaceNavigation('special_terms', { moduleId: 'special_terms', icon: ScrollText }),
      workspaceNavigation('hedge_desk', { moduleId: 'hedge_desk', icon: ChartNoAxesCombined }),
    ],
  },
  {
    id: 'cross_functions',
    label: 'Cross Functions',
    items: [
      workspaceNavigation('payment_collections', { moduleIds: ['buyer_invoices', 'incoming_payments'], icon: ReceiptText }),
      workspaceNavigation('disputes', { moduleId: 'disputes', icon: FileCheck2 }),
      workspaceNavigation('unofficial_compensation', { moduleId: 'unofficial_compensation', icon: HandCoins }),
      workspaceNavigation('brokers', { moduleId: 'brokers', icon: DollarSign }),
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    items: [
      workspaceNavigation('cashflow_forecast', { moduleId: 'cashflow_forecast', icon: WalletCards }),
    ],
  },
  {
    id: 'tools',
    label: 'Tools',
    items: [
      workspaceNavigation('email_router', { moduleId: 'email_router', icon: MailSearch }),
      workspaceNavigation('review', { moduleId: 'review', icon: ClipboardCheck }),
      workspaceNavigation('pnl', { moduleId: 'pnl', icon: TrendingUp }),
      { id: 'report_archive', to: '/brokers?tab=archive', label: 'Report Archive', moduleId: 'report_archive', icon: History },
    ],
  },
];

const DEFAULT_NAVIGATION_PREFERENCES = {
  sectionOrders: Object.fromEntries(navGroups.map((group) => [group.id, group.items.map((item) => item.id)])),
  hiddenItemIds: ['review', 'pnl', 'report_archive'],
  revision: 0,
};
const LEGACY_TRADING_DEFAULT_ORDER = ['dashboard', 'payment_collections', 'unofficial_compensation', 'cashflow_forecast', 'disputes', 'brokers', 'buyers_administrator'];

const VERSION_CHECK_INTERVAL_MS = 60_000;
const SIDEBAR_FIXED_STORAGE_KEY = 'workspace-sidebar-fixed';
const LEGACY_SIDEBAR_HIDDEN_STORAGE_KEY = 'workspace-sidebar-hidden';

function navigationCacheKey(user) {
  return `fcos:navigation:${user?.id || user?.email || 'anonymous'}`;
}

function normalizedNavigationPreferences(value = {}) {
  const hidden = new Set(Array.isArray(value.hiddenItemIds) ? value.hiddenItemIds : DEFAULT_NAVIGATION_PREFERENCES.hiddenItemIds);
  const sectionOrders = value.sectionOrders && typeof value.sectionOrders === 'object' ? value.sectionOrders : {};
  const legacyTradingOrder = Array.isArray(sectionOrders.trading) ? sectionOrders.trading : [];
  const legacyTradingWasDefault = legacyTradingOrder.length === LEGACY_TRADING_DEFAULT_ORDER.length
    && legacyTradingOrder.every((id, index) => id === LEGACY_TRADING_DEFAULT_ORDER[index]);
  return {
    sectionOrders: Object.fromEntries(navGroups.map((group) => {
      const hasDirectOrder = Array.isArray(sectionOrders[group.id]);
      const requested = hasDirectOrder
        ? sectionOrders[group.id]
        : ['cross_functions', 'finance'].includes(group.id) && !legacyTradingWasDefault
          ? legacyTradingOrder
          : [];
      const allowed = new Set(group.items.map((item) => item.id));
      const ordered = [...new Set(requested.filter((id) => allowed.has(id)))];
      if (group.id === 'tools' && !ordered.includes('email_router')) ordered.unshift('email_router');
      const missing = group.items.map((item) => item.id).filter((id) => !ordered.includes(id));
      ordered.push(...missing);
      return [group.id, ordered];
    })),
    hiddenItemIds: [...hidden].filter((id) => navGroups.some((group) => group.items.some((item) => item.id === id))),
    revision: Number(value.revision || 0),
    updatedAt: value.updatedAt || null,
  };
}

export default function Layout() {
  const location = useLocation();
  const { user, logout, hasModuleAccess, authMode } = useAuth();
  const [density, setDensity] = useState(() => localStorage.getItem('table-density') || 'compact');
  const [dirtyState, setDirtyState] = useState({ dirty: false, message: '' });
  const [versionOpen, setVersionOpen] = useState(false);
  const [versionUpdate, setVersionUpdate] = useState(null);
  const [sidebarFixed, setSidebarFixed] = useState(() => localStorage.getItem(SIDEBAR_FIXED_STORAGE_KEY) === 'true');
  const [workspacePreferences, setWorkspacePreferences] = useState(null);
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const [navigationPreferences, setNavigationPreferences] = useState(() => normalizedNavigationPreferences(DEFAULT_NAVIGATION_PREFERENCES));
  const [navigationDraft, setNavigationDraft] = useState(null);
  const [navigationEditing, setNavigationEditing] = useState(false);
  const [navigationSaving, setNavigationSaving] = useState(false);
  const [navigationError, setNavigationError] = useState('');
  const currentBuildIdRef = useRef(null);

  const activeNavigationPreferences = navigationEditing && navigationDraft ? navigationDraft : navigationPreferences;
  const accessibleGroups = useMemo(() => navGroups
    .map((group) => {
      const order = activeNavigationPreferences.sectionOrders[group.id] || [];
      const itemById = Object.fromEntries(group.items.map((item) => [item.id, item]));
      const items = order
        .map((id) => itemById[id])
        .filter(Boolean)
        .filter((item) => item.moduleIds ? item.moduleIds.some((moduleId) => hasModuleAccess(moduleId)) : !item.moduleId || hasModuleAccess(item.moduleId))
        .filter((item) => navigationEditing || !activeNavigationPreferences.hiddenItemIds.includes(item.id));
      return { ...group, items };
    })
    .filter((group) => group.items.length > 0), [activeNavigationPreferences, hasModuleAccess, navigationEditing]);
  const effectiveSidebarFixed = sidebarFixed || navigationEditing;

  const pageOwnsScroll = location.pathname === '/disputes'
    || location.pathname.startsWith('/disputes/');

  useEffect(() => {
    document.documentElement.dataset.density = density;
    localStorage.setItem('table-density', density);
  }, [density]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_FIXED_STORAGE_KEY, String(sidebarFixed));
    localStorage.removeItem(LEGACY_SIDEBAR_HIDDEN_STORAGE_KEY);
  }, [sidebarFixed]);

  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    const cacheKey = navigationCacheKey(user);
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
      if (cached) setNavigationPreferences(normalizedNavigationPreferences(cached));
    } catch {
      localStorage.removeItem(cacheKey);
    }
    const applyWorkspacePreferences = (preferences) => {
      if (!preferences) return;
      setWorkspacePreferences(preferences);
      setSidebarFixed(preferences.sidebarMode === 'fixed');
      setDensity(preferences.tableDensity === 'comfort' ? 'comfort' : 'compact');
      saveDocumentSettings({
        showOnlyRelevant: preferences.documentShowOnlyRelevant,
        relevantSourceGroups: preferences.documentSourceGroups,
      });
      window.dispatchEvent(new CustomEvent('fcos:workspace-preferences-updated', { detail: preferences }));
    };
    const load = async () => {
      const browserDocumentSettings = readDocumentSettings();
      const workspaceResponse = await appClient.functions.invoke('workspacePreferencesGet');
      if (!cancelled && workspaceResponse.data?.preferences) {
        let workspacePreferences = workspaceResponse.data.preferences;
        if (!workspacePreferences.initialized) {
          const migrated = await appClient.functions.invoke('workspacePreferencesSave', {
            sidebarMode: sidebarFixed ? 'fixed' : 'auto_hide',
            tableDensity: density,
            documentShowOnlyRelevant: browserDocumentSettings.showOnlyRelevant,
            documentSourceGroups: browserDocumentSettings.relevantSourceGroups,
            expectedRevision: workspacePreferences.revision,
          });
          if (migrated.data?.preferences) workspacePreferences = migrated.data.preferences;
          else if (migrated.data?.error) setNavigationError(migrated.data.error);
        }
        applyWorkspacePreferences(workspacePreferences);
      }
      const response = await appClient.functions.invoke('navigationPreferencesGet');
      if (cancelled) return;
      if (response.data?.preferences) {
        const next = normalizedNavigationPreferences(response.data.preferences);
        setNavigationPreferences(next);
        localStorage.setItem(cacheKey, JSON.stringify(next));
      } else if (response.data?.error) {
        setNavigationError(response.data.error);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    const openNavigationEditor = () => startNavigationEditing();
    const applyPreferences = (event) => {
      const preferences = event.detail || {};
      if (preferences.sidebarMode) setSidebarFixed(preferences.sidebarMode === 'fixed');
      if (preferences.tableDensity) setDensity(preferences.tableDensity === 'comfort' ? 'comfort' : 'compact');
      if (preferences.revision != null) {
        setWorkspacePreferences(preferences);
        setNavigationPreferences((current) => ({ ...current, revision: Number(preferences.revision) }));
      }
    };
    window.addEventListener('fcos:navigation-customize', openNavigationEditor);
    window.addEventListener('fcos:workspace-preferences-updated', applyPreferences);
    return () => {
      window.removeEventListener('fcos:navigation-customize', openNavigationEditor);
      window.removeEventListener('fcos:workspace-preferences-updated', applyPreferences);
    };
  }, [navigationPreferences]);

  const startNavigationEditing = () => {
    setNavigationDraft(normalizedNavigationPreferences(navigationPreferences));
    setNavigationError('');
    setNavigationEditing(true);
  };

  const cancelNavigationEditing = () => {
    setNavigationDraft(null);
    setNavigationError('');
    setNavigationEditing(false);
  };

  const toggleNavigationItem = (itemId) => {
    setNavigationDraft((current) => {
      const next = normalizedNavigationPreferences(current || navigationPreferences);
      const hidden = new Set(next.hiddenItemIds);
      if (hidden.has(itemId)) hidden.delete(itemId);
      else hidden.add(itemId);
      return { ...next, hiddenItemIds: [...hidden] };
    });
  };

  const moveNavigationItem = ({ source, destination, draggableId }) => {
    if (!destination || source.droppableId !== destination.droppableId || source.index === destination.index) return;
    setNavigationDraft((current) => {
      const next = normalizedNavigationPreferences(current || navigationPreferences);
      const order = [...(next.sectionOrders[source.droppableId] || [])];
      const visibleIds = accessibleGroups.find((group) => group.id === source.droppableId)?.items.map((item) => item.id) || [];
      const targetId = visibleIds.filter((id) => id !== draggableId)[destination.index] || null;
      const sourceOrderIndex = order.indexOf(draggableId);
      if (sourceOrderIndex < 0) return next;
      const [moved] = order.splice(sourceOrderIndex, 1);
      const targetOrderIndex = targetId ? order.indexOf(targetId) : order.length;
      order.splice(targetOrderIndex < 0 ? order.length : targetOrderIndex, 0, moved);
      return { ...next, sectionOrders: { ...next.sectionOrders, [source.droppableId]: order } };
    });
  };

  const saveNavigationPreferences = async () => {
    const draft = normalizedNavigationPreferences(navigationDraft || navigationPreferences);
    setNavigationSaving(true);
    setNavigationError('');
    const response = await appClient.functions.invoke('navigationPreferencesSave', {
      sectionOrders: draft.sectionOrders,
      hiddenItemIds: draft.hiddenItemIds,
      expectedRevision: navigationPreferences.revision,
    });
    if (response.data?.error) {
      setNavigationError(response.data.error);
    } else {
      const next = normalizedNavigationPreferences(response.data.preferences);
      setNavigationPreferences(next);
      setWorkspacePreferences((current) => current ? { ...current, revision: next.revision, updatedAt: next.updatedAt } : current);
      setNavigationDraft(null);
      setNavigationEditing(false);
      if (user) localStorage.setItem(navigationCacheKey(user), JSON.stringify(next));
    }
    setNavigationSaving(false);
  };

  const resetNavigationPreferences = async () => {
    setNavigationSaving(true);
    setNavigationError('');
    const response = await appClient.functions.invoke('navigationPreferencesReset', { expectedRevision: navigationPreferences.revision });
    if (response.data?.error) {
      setNavigationError(response.data.error);
    } else {
      const next = normalizedNavigationPreferences(response.data.preferences || DEFAULT_NAVIGATION_PREFERENCES);
      setNavigationPreferences(next);
      setWorkspacePreferences((current) => current ? { ...current, revision: next.revision, updatedAt: next.updatedAt } : current);
      setNavigationDraft(null);
      setNavigationEditing(false);
      if (user) localStorage.setItem(navigationCacheKey(user), JSON.stringify(next));
    }
    setNavigationSaving(false);
  };

  useEffect(() => {
    const onDirtyState = (event) => {
      setDirtyState((prev) => ({
        ...prev,
        [event.detail?.key || 'default']: event.detail || {},
      }));
    };
    window.addEventListener('fcos:dirty-state', onDirtyState);
    return () => window.removeEventListener('fcos:dirty-state', onDirtyState);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const checkVersion = async () => {
      try {
        const response = await fetch(`/app-version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) return;
        const latest = await response.json();
        const latestBuildId = latest?.buildId || latest?.commit || latest?.version;
        if (!latestBuildId || cancelled) return;
        if (!currentBuildIdRef.current) {
          currentBuildIdRef.current = latestBuildId;
          return;
        }
        if (latestBuildId !== currentBuildIdRef.current) setVersionUpdate(latest);
      } catch {
        // Background version checks must not interrupt work.
      }
    };

    const checkWhenVisible = () => {
      if (document.visibilityState === 'visible') checkVersion();
    };

    checkVersion();
    const interval = window.setInterval(checkVersion, VERSION_CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', checkWhenVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', checkWhenVisible);
    };
  }, []);

  const unsaved = Object.values(dirtyState).find((state) => state?.dirty);
  const confirmLeaveWithUnsavedChanges = () => {
    if (!unsaved) return true;
    return window.confirm(`${unsaved.message || 'You have unsaved changes.'}\n\nChoose Cancel to stay and save changes, or OK to leave without saving.`);
  };
  const handleNavigation = (event) => {
    if (!unsaved) return;
    if (!confirmLeaveWithUnsavedChanges()) event.preventDefault();
  };
  useEffect(() => {
    const openVersionAudit = () => setVersionOpen(true);
    const requestSignOut = () => {
      if (unsaved && !window.confirm(`${unsaved.message || 'You have unsaved changes.'}\n\nChoose Cancel to stay and save changes, or OK to leave without saving.`)) return;
      logout();
    };
    window.addEventListener('fcos:version-audit-open', openVersionAudit);
    window.addEventListener('fcos:sign-out-requested', requestSignOut);
    return () => {
      window.removeEventListener('fcos:version-audit-open', openVersionAudit);
      window.removeEventListener('fcos:sign-out-requested', requestSignOut);
    };
  }, [logout, unsaved]);
  const updateToLatestVersion = async () => {
    if (!confirmLeaveWithUnsavedChanges()) return;
    try {
      if ('caches' in window) {
        const cacheNames = await window.caches.keys();
        await Promise.all(cacheNames.map((cacheName) => window.caches.delete(cacheName)));
      }
    } finally {
      window.location.reload();
    }
  };

  return (
    <div className="app-workspace-shell relative flex h-screen overflow-hidden">
      {!effectiveSidebarFixed && (
        <div
          className="fixed inset-y-0 left-0 z-[39] w-1 bg-transparent"
          onMouseEnter={() => setSidebarHovered(true)}
          aria-hidden="true"
        />
      )}

      <aside
        onMouseEnter={() => setSidebarHovered(true)}
        onMouseLeave={() => setSidebarHovered(false)}
        className={cn(
          'app-workspace-sidebar fixed inset-y-0 left-0 z-40 flex w-[192px] shrink-0 flex-col border-r border-slate-200 bg-white transition-transform duration-200 ease-out',
          effectiveSidebarFixed
            ? 'translate-x-0 shadow-xl shadow-slate-900/10 md:relative md:shadow-none'
            : sidebarHovered
              ? 'translate-x-0 shadow-xl shadow-slate-900/10'
              : '-translate-x-full border-r-transparent shadow-none focus-within:translate-x-0 focus-within:border-slate-200 focus-within:shadow-xl focus-within:shadow-slate-900/10',
        )}
      >
        <div className="border-b border-slate-200 px-3 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-950">FCOS</div>
              <div className="truncate text-xs font-medium text-emerald-700">Salesforce connected</div>
            </div>
            <WorkNotifications />
          </div>
        </div>

        <nav className="min-h-0 flex-1 space-y-5 overflow-auto px-3 py-4">
          <div className="flex items-center justify-between px-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Navigation</span>
            {navigationEditing && (
              <div className="flex items-center gap-1">
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={resetNavigationPreferences} disabled={navigationSaving} title="Reset navigation" aria-label="Reset navigation">
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={cancelNavigationEditing} disabled={navigationSaving} title="Cancel navigation changes" aria-label="Cancel navigation changes">
                  <X className="h-3.5 w-3.5" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-blue-700" onClick={saveNavigationPreferences} disabled={navigationSaving} title="Save navigation" aria-label="Save navigation">
                  <Save className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
          {navigationError && <div className="mx-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">{navigationError}</div>}
          <DragDropContext onDragEnd={moveNavigationItem}>
            {accessibleGroups.map((group) => (
              <section key={group.id}>
                <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  {group.label}
                </div>
                <Droppable droppableId={group.id} isDropDisabled={!navigationEditing}>
                  {(dropProvided) => (
                    <div ref={dropProvided.innerRef} {...dropProvided.droppableProps} className="space-y-1">
                      {group.items.map(({ id, to, label, icon: Icon }, index) => {
                        const hidden = activeNavigationPreferences.hiddenItemIds.includes(id);
                        return (
                          <Draggable key={id} draggableId={id} index={index} isDragDisabled={!navigationEditing}>
                            {(dragProvided, dragSnapshot) => (
                              <div ref={dragProvided.innerRef} {...dragProvided.draggableProps} className={cn(dragSnapshot.isDragging && 'rounded-lg bg-white shadow-lg')}>
                                {navigationEditing ? (
                                  <div className={cn('flex h-9 items-center gap-2 rounded-lg border px-2 text-sm', hidden ? 'border-dashed text-slate-400' : 'border-slate-200 text-slate-700')}>
                                    <button type="button" {...dragProvided.dragHandleProps} className="cursor-grab text-slate-400" title={`Reorder ${label}`} aria-label={`Reorder ${label}`}>
                                      <GripVertical className="h-4 w-4" />
                                    </button>
                                    <Icon className="h-4 w-4 shrink-0" />
                                    <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
                                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleNavigationItem(id)} title={hidden ? `Show ${label}` : `Hide ${label}`} aria-label={hidden ? `Show ${label}` : `Hide ${label}`}>
                                      {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                    </Button>
                                  </div>
                                ) : (
                                  <NavLink
                                    to={to}
                                    end={to === '/'}
                                    onClick={handleNavigation}
                                    title={label}
                                    className={({ isActive }) => cn(
                                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                                      isActive
                                        ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-100'
                                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950',
                                    )}
                                  >
                                    <Icon className="h-4 w-4 shrink-0" />
                                    <span className="truncate">{label}</span>
                                  </NavLink>
                                )}
                              </div>
                            )}
                          </Draggable>
                        );
                      })}
                      {dropProvided.placeholder}
                    </div>
                  )}
                </Droppable>
              </section>
            ))}
          </DragDropContext>
        </nav>

        <div className="space-y-3 border-t border-slate-200 p-3">
          <NavLink
            to="/settings"
            onClick={handleNavigation}
            className={({ isActive }) => cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-100' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950',
            )}
          >
            <Settings className="h-4 w-4" />
            Settings
          </NavLink>
          {user && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="truncate text-xs font-semibold text-slate-900">{user.full_name || user.email}</div>
              <div className="truncate text-[11px] text-slate-500">{user.email}</div>
              {authMode === 'local' && <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-amber-600">Local admin mode</div>}
            </div>
          )}
        </div>
      </aside>

      <main className={cn('min-w-0 flex-1 bg-slate-50', pageOwnsScroll ? 'flex h-screen flex-col overflow-hidden' : 'overflow-auto')}>
        {versionUpdate && (
          <div className="sticky top-0 z-40 shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-amber-950 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <span className="font-semibold">New version available</span>
                <span className="ml-2 text-amber-800">Version {versionUpdate.version || APP_VERSION} is ready.</span>
              </div>
              <Button size="sm" onClick={updateToLatestVersion} className="gap-2 bg-amber-600 text-white hover:bg-amber-700">
                <RefreshCw className="h-3.5 w-3.5" />
                Update Now
              </Button>
            </div>
          </div>
        )}
        <div className={cn(pageOwnsScroll && 'min-h-0 flex-1 overflow-hidden')}>
          <Outlet />
        </div>
      </main>

      <Dialog open={versionOpen} onOpenChange={setVersionOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Version Audit Trail
            </DialogTitle>
            <DialogDescription>
              Current release {APP_VERSION}. This audit trail records released app changes.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[62vh] space-y-4 overflow-auto pr-1">
            {APP_VERSION_HISTORY.map((entry) => (
              <section key={entry.version} className="rounded-lg border border-border bg-card/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-foreground">Version {entry.version}</div>
                    <div className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{entry.title}</div>
                  </div>
                  <div className="rounded-md border border-border bg-muted/40 px-2 py-1 text-xs font-medium text-muted-foreground">
                    {entry.releasedAt}
                  </div>
                </div>
                <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                  {entry.changes.map((change) => (
                    <li key={change} className="flex gap-2">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      <span>{change}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
