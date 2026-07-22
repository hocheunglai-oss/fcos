import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  UsersRound,
  X,
} from 'lucide-react';
import { appClient } from '@/api/appClient';
import PageHeader from '@/components/common/PageHeader';
import StateBlock from '@/components/common/StateBlock';
import TableShell from '@/components/common/TableShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';

const PAGE_SIZE = 100;
const UNASSIGNED_FILTER = '__unassigned__';
const ROLE_LABELS = {
  buyer: 'Buyer',
  buyer_supplier: 'Buyer & Supplier',
  broker: 'Broker',
};

function compareText(left, right) {
  return String(left || '').localeCompare(String(right || ''), undefined, { sensitivity: 'base' });
}

function formatDateTime(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Hong_Kong',
  }).format(date);
}

function sameIds(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function SummaryMetric({ label, value }) {
  return (
    <div className="min-w-0 px-4 py-3 sm:px-5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-foreground">{value.toLocaleString()}</div>
    </div>
  );
}

function ManagerCoverage({ managers }) {
  if (!managers.length) {
    return <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">Unassigned</Badge>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {managers.map((manager) => (
        <Badge key={manager.id} variant="outline" className={manager.active ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-red-200 bg-red-50 text-red-700'}>
          {manager.fullName}{manager.active ? '' : ' (inactive)'}
        </Badge>
      ))}
    </div>
  );
}

function RoleBadges({ roles }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {(roles || []).map((role) => (
        <Badge key={role} variant="outline" className={role === 'broker'
          ? 'border-violet-200 bg-violet-50 text-violet-800'
          : role === 'buyer_supplier'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : 'border-sky-200 bg-sky-50 text-sky-800'}>
          {ROLE_LABELS[role] || role}
        </Badge>
      ))}
    </div>
  );
}

export default function AccountManagers() {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedManagerKeys, setSelectedManagerKeys] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [editingKey, setEditingKey] = useState('');
  const [draftManagerIds, setDraftManagerIds] = useState([]);
  const [savingKey, setSavingKey] = useState('');
  const [retryingKey, setRetryingKey] = useState('');

  const loadAccounts = useCallback(async ({ background = false } = {}) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    setError('');
    const response = await appClient.functions.invoke('accountManagersList', {}, { force: true });
    if (response.data?.error) {
      setError(response.data.error);
    } else {
      setAccounts(response.data?.accounts || []);
      setUsers(response.data?.users || []);
      setCurrentPage(1);
      setSelectedManagerKeys(null);
      setEditingKey('');
      setDraftManagerIds([]);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const activeUsers = useMemo(() => users
    .filter((user) => user.active)
    .sort((left, right) => compareText(left.fullName || left.email, right.fullName || right.email)), [users]);

  const managerFilterOptions = useMemo(() => {
    const assignedIds = new Set(accounts.flatMap((account) => account.managers.map((manager) => manager.id)));
    const assignedUsers = users
      .filter((user) => assignedIds.has(user.id))
      .sort((left, right) => compareText(left.fullName || left.email, right.fullName || right.email));
    return [
      { key: UNASSIGNED_FILTER, label: 'Unassigned' },
      ...assignedUsers.map((user) => ({ key: user.id, label: user.fullName || user.email })),
    ];
  }, [accounts, users]);
  const allManagerFilterKeys = useMemo(() => managerFilterOptions.map((option) => option.key), [managerFilterOptions]);
  const effectiveManagerKeys = selectedManagerKeys === null ? allManagerFilterKeys : selectedManagerKeys;
  const allManagersSelected = effectiveManagerKeys.length === allManagerFilterKeys.length;

  const stats = useMemo(() => ({
    total: accounts.length,
    unassigned: accounts.filter((account) => account.managerCount === 0).length,
    assigned: accounts.filter((account) => account.managerCount > 0).length,
    syncIssues: accounts.filter((account) => account.salesforceSyncStatus !== 'synced').length,
  }), [accounts]);

  const filteredAccounts = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const selected = new Set(effectiveManagerKeys);
    const filterActive = effectiveManagerKeys.length !== allManagerFilterKeys.length;
    return accounts.filter((account) => {
      if (filterActive) {
        if (!account.managers.length && !selected.has(UNASSIGNED_FILTER)) return false;
        if (account.managers.length && !account.managers.some((manager) => selected.has(manager.id))) return false;
      }
      if (!keyword) return true;
      const searchable = [
        account.accountName,
        ...(account.roles || []).map((role) => ROLE_LABELS[role] || role),
        ...account.managers.flatMap((manager) => [manager.fullName, manager.email]),
      ].join(' ').toLowerCase();
      return searchable.includes(keyword);
    });
  }, [accounts, allManagerFilterKeys.length, effectiveManagerKeys, search]);

  const pageCount = Math.max(1, Math.ceil(filteredAccounts.length / PAGE_SIZE));
  const visiblePage = Math.min(currentPage, pageCount);
  const paginatedAccounts = useMemo(() => {
    const start = (visiblePage - 1) * PAGE_SIZE;
    return filteredAccounts.slice(start, start + PAGE_SIZE);
  }, [filteredAccounts, visiblePage]);

  const replaceAccount = (savedAccount) => {
    setAccounts((current) => current.map((account) => account.accountNameKey === savedAccount.accountNameKey
      ? { ...account, ...savedAccount }
      : account));
  };

  const beginEdit = (account) => {
    setEditingKey(account.accountNameKey);
    setDraftManagerIds(account.managers.map((manager) => manager.id));
  };

  const cancelEdit = () => {
    if (savingKey) return;
    setEditingKey('');
    setDraftManagerIds([]);
  };

  const addManager = () => {
    if (draftManagerIds.length >= 3 || draftManagerIds.some((userId) => !userId)) return;
    setDraftManagerIds((current) => [...current, '']);
  };

  const changeManager = (index, userId) => {
    setDraftManagerIds((current) => current.map((value, itemIndex) => itemIndex === index ? userId : value));
  };

  const removeManager = (index) => {
    setDraftManagerIds((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const saveAccount = async (account) => {
    const invalid = draftManagerIds.some((userId) => !userId || !usersById.get(userId)?.active);
    if (invalid) return;
    setSavingKey(account.accountNameKey);
    const response = await appClient.functions.invoke('accountManagersSave', {
      accountNameKey: account.accountNameKey,
      accountName: account.accountName,
      managerUserIds: draftManagerIds,
      expectedRevision: account.revision,
    });
    setSavingKey('');

    if (response.data?.error) {
      toast({ title: 'Account managers not saved', description: response.data.error, variant: 'destructive' });
      return;
    }

    replaceAccount(response.data.account);
    setEditingKey('');
    setDraftManagerIds([]);
    if (response.data.syncError) {
      toast({ title: 'Saved with a Salesforce sync issue', description: response.data.syncError, variant: 'destructive' });
    } else {
      toast({
        title: 'Account managers updated',
        description: draftManagerIds.length
          ? `${account.accountName}: ${draftManagerIds.length} manager${draftManagerIds.length === 1 ? '' : 's'}`
          : `${account.accountName}: unassigned`,
      });
    }
  };

  const retrySync = async (account) => {
    setRetryingKey(account.accountNameKey);
    const response = await appClient.functions.invoke('accountManagersRetrySync', {
      accountNameKey: account.accountNameKey,
    });
    setRetryingKey('');
    if (response.data?.error) {
      toast({ title: 'Salesforce sync not completed', description: response.data.error, variant: 'destructive' });
      return;
    }
    replaceAccount(response.data.account);
    if (response.data.syncError) {
      toast({ title: 'Salesforce sync not completed', description: response.data.syncError, variant: 'destructive' });
    } else {
      toast({ title: 'Salesforce synchronized', description: account.accountName });
    }
  };

  const toggleManagerFilter = (key) => {
    setSelectedManagerKeys((current) => {
      const selected = current === null ? allManagerFilterKeys : current;
      return selected.includes(key) ? selected.filter((value) => value !== key) : [...selected, key];
    });
    setCurrentPage(1);
  };

  return (
    <div className="min-w-0 pb-8">
      <PageHeader
        icon={UsersRound}
        title="Account Managers"
        meta={`${stats.total.toLocaleString()} active Account names`}
        actions={(
          <Button
            variant="outline"
            size="icon"
            onClick={() => loadAccounts({ background: true })}
            disabled={loading || refreshing}
            aria-label="Refresh Accounts"
            title="Refresh Accounts"
          >
            <RefreshCw className={refreshing ? 'animate-spin' : ''} />
          </Button>
        )}
      />

      <div className="mb-5 grid grid-cols-2 divide-x divide-y overflow-hidden rounded-lg border border-border bg-card sm:grid-cols-4 sm:divide-y-0">
        <SummaryMetric label="Account names" value={stats.total} />
        <SummaryMetric label="Unassigned" value={stats.unassigned} />
        <SummaryMetric label="With managers" value={stats.assigned} />
        <SummaryMetric label="Sync issues" value={stats.syncIssues} />
      </div>

      <TableShell
        title="Account Ownership"
        meta={`${filteredAccounts.length.toLocaleString()} of ${accounts.length.toLocaleString()} names`}
        bodyClassName="p-0"
        actions={(
          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setCurrentPage(1);
              }}
              className="pl-9"
              placeholder="Search Accounts or managers"
              aria-label="Search Accounts or managers"
            />
          </div>
        )}
      >
        {!loading && !error && accounts.length > 0 && (
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <Label className="text-xs font-semibold uppercase text-muted-foreground">Account Manager</Label>
              <button
                type="button"
                onClick={() => {
                  setSelectedManagerKeys(allManagersSelected ? [] : null);
                  setCurrentPage(1);
                }}
                className="text-xs text-primary hover:underline"
              >
                {allManagersSelected ? 'Clear all' : 'Select all'}
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {managerFilterOptions.map((option) => {
                const selected = effectiveManagerKeys.includes(option.key);
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => toggleManagerFilter(option.key)}
                    className={`rounded-md border px-3 py-1 text-xs font-medium transition-colors ${selected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-muted/40 text-muted-foreground hover:border-primary/50'}`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {loading ? (
          <StateBlock icon={Loader2} title="Loading Accounts..." description="Reading active Accounts and manager assignments." />
        ) : error ? (
          <StateBlock
            icon={CircleAlert}
            title="Accounts could not be loaded"
            description={error}
            action={<Button variant="outline" onClick={() => loadAccounts()}>Try again</Button>}
          />
        ) : filteredAccounts.length ? (
          <>
            <Table className="min-w-[1080px]">
              <TableHeader className="sticky top-0 z-10 bg-muted/90 backdrop-blur">
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Account Type</TableHead>
                  <TableHead>Account Managers</TableHead>
                  <TableHead>Last Updated</TableHead>
                  <TableHead className="w-28 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedAccounts.map((account) => {
                  const editing = editingKey === account.accountNameKey;
                  const saving = savingKey === account.accountNameKey;
                  const invalidSelection = draftManagerIds.some((userId) => !userId || !usersById.get(userId)?.active);
                  const dirty = editing && !sameIds(draftManagerIds, account.managers.map((manager) => manager.id));
                  const noMoreUsers = draftManagerIds.length >= 3
                    || draftManagerIds.some((userId) => !userId)
                    || !activeUsers.some((user) => !draftManagerIds.includes(user.id));
                  return (
                    <TableRow key={account.accountNameKey} className={editing ? 'bg-muted/25' : undefined}>
                      <TableCell className="min-w-[250px] align-top">
                        <div className="font-medium text-foreground">{account.accountName}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {account.salesforceAccountCount} active Salesforce Account{account.salesforceAccountCount === 1 ? '' : 's'}
                        </div>
                      </TableCell>
                      <TableCell className="min-w-[190px] align-top"><RoleBadges roles={account.roles} /></TableCell>
                      <TableCell className="min-w-[390px] align-top">
                        {editing ? (
                          <div className="space-y-2">
                            {draftManagerIds.length ? draftManagerIds.map((userId, index) => {
                              const selectedUser = usersById.get(userId);
                              return (
                                <div key={`${account.accountNameKey}-${index}`} className="flex items-center gap-2">
                                  <Select value={userId || undefined} onValueChange={(value) => changeManager(index, value)} disabled={saving}>
                                    <SelectTrigger className="h-9 min-w-0 flex-1" aria-label={`Account manager ${index + 1}`}>
                                      <SelectValue placeholder="Select a manager">{selectedUser?.fullName || selectedUser?.email}</SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                      {users
                                        .slice()
                                        .sort((left, right) => compareText(left.fullName || left.email, right.fullName || right.email))
                                        .map((user) => (
                                          <SelectItem
                                            key={user.id}
                                            value={user.id}
                                            disabled={!user.active || draftManagerIds.some((selectedId, selectedIndex) => selectedIndex !== index && selectedId === user.id)}
                                          >
                                            {user.fullName || user.email}{user.active ? '' : ' · Inactive'}
                                          </SelectItem>
                                        ))}
                                    </SelectContent>
                                  </Select>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => removeManager(index)}
                                    disabled={saving}
                                    aria-label={`Remove ${selectedUser?.fullName || selectedUser?.email || 'manager'}`}
                                    title="Remove manager"
                                  >
                                    <Trash2 />
                                  </Button>
                                </div>
                              );
                            }) : (
                              <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">Unassigned</Badge>
                            )}
                            <Button type="button" variant="outline" size="sm" onClick={addManager} disabled={saving || noMoreUsers}>
                              <Plus />
                              Add manager
                            </Button>
                          </div>
                        ) : (
                          <ManagerCoverage managers={account.managers} />
                        )}
                      </TableCell>
                      <TableCell className="min-w-[190px] align-top text-xs">
                        <div>{formatDateTime(account.updatedAt)}</div>
                        {account.updatedByEmail && <div className="mt-0.5 truncate text-muted-foreground">{account.updatedByEmail}</div>}
                        {account.salesforceSyncStatus !== 'synced' && (
                          <Badge
                            variant="outline"
                            className={`mt-2 ${account.salesforceSyncStatus === 'failed'
                              ? 'border-red-200 bg-red-50 text-red-700'
                              : 'border-amber-300 bg-amber-50 text-amber-800'}`}
                            title={account.salesforceSyncError || 'Salesforce differs from FCOS'}
                          >
                            {account.salesforceSyncStatus === 'failed' ? 'Sync failed' : 'Needs sync'}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="align-top text-right">
                        <div className="flex justify-end gap-1">
                          {editing ? (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={cancelEdit}
                                disabled={saving}
                                aria-label="Cancel changes"
                                title="Cancel changes"
                              >
                                <X />
                              </Button>
                              <Button
                                size="icon"
                                onClick={() => saveAccount(account)}
                                disabled={saving || invalidSelection || !dirty}
                                aria-label="Save Account managers"
                                title="Save Account managers"
                              >
                                {saving ? <Loader2 className="animate-spin" /> : <Check />}
                              </Button>
                            </>
                          ) : (
                            <>
                              {account.salesforceSyncStatus !== 'synced' && account.revision > 0 && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => retrySync(account)}
                                  disabled={Boolean(retryingKey || savingKey)}
                                  aria-label="Retry Salesforce sync"
                                  title="Retry Salesforce sync"
                                >
                                  <RotateCcw className={retryingKey === account.accountNameKey ? 'animate-spin' : ''} />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => beginEdit(account)}
                                disabled={Boolean(editingKey || retryingKey || savingKey)}
                                aria-label={`Edit managers for ${account.accountName}`}
                                title="Edit Account managers"
                              >
                                <Pencil />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
              <div className="text-xs text-muted-foreground">
                Showing {((visiblePage - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(visiblePage * PAGE_SIZE, filteredAccounts.length).toLocaleString()} of {filteredAccounts.length.toLocaleString()}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  disabled={visiblePage <= 1}
                  aria-label="Previous page"
                  title="Previous page"
                >
                  <ChevronLeft />
                </Button>
                <span className="min-w-24 text-center text-xs font-medium text-foreground">Page {visiblePage} of {pageCount}</span>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))}
                  disabled={visiblePage >= pageCount}
                  aria-label="Next page"
                  title="Next page"
                >
                  <ChevronRight />
                </Button>
              </div>
            </div>
          </>
        ) : (
          <StateBlock title="No Accounts found" description="No active Account names match the current filters." />
        )}
      </TableShell>
    </div>
  );
}
