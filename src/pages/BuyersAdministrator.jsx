import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CircleAlert,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UsersRound,
} from 'lucide-react';
import { appClient } from '@/api/appClient';
import PageHeader from '@/components/common/PageHeader';
import StateBlock from '@/components/common/StateBlock';
import TableShell from '@/components/common/TableShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';

const ASSIGNMENT_FILTERS = [
  { value: 'all', label: 'All assignments' },
  { value: '0', label: 'Unassigned' },
  { value: '1', label: '1 trader' },
  { value: '2', label: '2 traders' },
  { value: '3', label: '3 traders' },
];
const PAGE_SIZE = 100;

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

function accountSuffix(value) {
  const id = String(value || '');
  return id ? id.slice(-5) : '';
}

function CoverageBadge({ count }) {
  if (count === 0) {
    return <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">Unassigned</Badge>;
  }
  if (count === 3) {
    return <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800">3 traders</Badge>;
  }
  return <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-800">{count} trader{count === 1 ? '' : 's'}</Badge>;
}

function SummaryMetric({ label, value }) {
  return (
    <div className="min-w-0 px-4 py-3 sm:px-5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-foreground">{value.toLocaleString()}</div>
    </div>
  );
}

export default function BuyersAdministrator() {
  const { toast } = useToast();
  const [buyers, setBuyers] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [assignmentFilter, setAssignmentFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [editingBuyer, setEditingBuyer] = useState(null);
  const [selectedTraderIds, setSelectedTraderIds] = useState([]);

  const loadBuyers = useCallback(async ({ background = false } = {}) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    setError('');
    const response = await appClient.functions.invoke('buyersAdministratorList', {}, { force: true });
    if (response.data?.error) {
      setError(response.data.error);
    } else {
      setBuyers(response.data?.buyers || []);
      setUsers(response.data?.users || []);
      setCurrentPage(1);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    loadBuyers();
  }, [loadBuyers]);

  const activeUsers = useMemo(() => users
    .filter((user) => user.active)
    .sort((left, right) => compareText(left.fullName || left.email, right.fullName || right.email)), [users]);

  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);

  const duplicateNameCounts = useMemo(() => {
    const counts = new Map();
    for (const buyer of buyers) {
      const key = String(buyer.buyerName || '').trim().toLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }, [buyers]);

  const stats = useMemo(() => ({
    total: buyers.filter((buyer) => buyer.salesforceActive).length,
    unassigned: buyers.filter((buyer) => buyer.salesforceActive && buyer.traderCount === 0).length,
    assigned: buyers.filter((buyer) => buyer.salesforceActive && buyer.traderCount > 0).length,
    maximum: buyers.filter((buyer) => buyer.salesforceActive && buyer.traderCount === 3).length,
  }), [buyers]);

  const filteredBuyers = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return buyers.filter((buyer) => {
      if (assignmentFilter !== 'all' && String(buyer.traderCount) !== assignmentFilter) return false;
      if (!keyword) return true;
      const searchable = [
        buyer.buyerName,
        buyer.buyerAccountId,
        buyer.buyerAccountKey,
        ...buyer.traders.flatMap((trader) => [trader.fullName, trader.email]),
      ].join(' ').toLowerCase();
      return searchable.includes(keyword);
    });
  }, [assignmentFilter, buyers, search]);
  const pageCount = Math.max(1, Math.ceil(filteredBuyers.length / PAGE_SIZE));
  const visiblePage = Math.min(currentPage, pageCount);
  const paginatedBuyers = useMemo(() => {
    const start = (visiblePage - 1) * PAGE_SIZE;
    return filteredBuyers.slice(start, start + PAGE_SIZE);
  }, [filteredBuyers, visiblePage]);

  const openEditor = (buyer) => {
    setEditingBuyer(buyer);
    setSelectedTraderIds(buyer.traders.map((trader) => trader.id));
  };

  const closeEditor = () => {
    if (saving) return;
    setEditingBuyer(null);
    setSelectedTraderIds([]);
  };

  const addTrader = () => {
    const available = activeUsers.find((user) => !selectedTraderIds.includes(user.id));
    if (!available || selectedTraderIds.length >= 3) return;
    setSelectedTraderIds((current) => [...current, available.id]);
  };

  const changeTrader = (index, userId) => {
    setSelectedTraderIds((current) => current.map((value, itemIndex) => itemIndex === index ? userId : value));
  };

  const removeTrader = (index) => {
    setSelectedTraderIds((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const saveAssignments = async () => {
    if (!editingBuyer) return;
    setSaving(true);
    const response = await appClient.functions.invoke('buyersAdministratorSave', {
      buyerAccountId: editingBuyer.buyerAccountId,
      buyerName: editingBuyer.buyerName,
      traderUserIds: selectedTraderIds,
      expectedUpdatedAt: editingBuyer.updatedAt,
    });
    setSaving(false);

    if (response.data?.error) {
      toast({ title: 'Assignments not saved', description: response.data.error, variant: 'destructive' });
      return;
    }

    const savedBuyer = response.data?.buyer;
    setBuyers((current) => current.map((buyer) => buyer.buyerAccountKey === savedBuyer.buyerAccountKey
      ? { ...buyer, ...savedBuyer }
      : buyer));
    setEditingBuyer(null);
    setSelectedTraderIds([]);
    toast({
      title: 'Buyer traders updated',
      description: selectedTraderIds.length
        ? `${savedBuyer.buyerName}: ${selectedTraderIds.length} trader${selectedTraderIds.length === 1 ? '' : 's'}`
        : `${savedBuyer.buyerName}: unassigned`,
    });
  };

  const noMoreUsers = selectedTraderIds.length >= 3
    || !activeUsers.some((user) => !selectedTraderIds.includes(user.id));

  return (
    <div className="min-w-0 pb-8">
      <PageHeader
        icon={UsersRound}
        title="Buyers Administrator"
        meta={`${stats.total.toLocaleString()} Salesforce buyer accounts`}
        actions={(
          <Button
            variant="outline"
            size="icon"
            onClick={() => loadBuyers({ background: true })}
            disabled={loading || refreshing}
            aria-label="Refresh buyer accounts"
            title="Refresh buyer accounts"
          >
            <RefreshCw className={refreshing ? 'animate-spin' : ''} />
          </Button>
        )}
      />

      <div className="mb-5 grid grid-cols-2 divide-x divide-y overflow-hidden rounded-lg border border-border bg-card sm:grid-cols-4 sm:divide-y-0">
        <SummaryMetric label="Buyer accounts" value={stats.total} />
        <SummaryMetric label="Unassigned" value={stats.unassigned} />
        <SummaryMetric label="With traders" value={stats.assigned} />
        <SummaryMetric label="At 3-trader limit" value={stats.maximum} />
      </div>

      <TableShell
        title="Buyer Ownership"
        meta={`${filteredBuyers.length.toLocaleString()} of ${buyers.length.toLocaleString()} accounts`}
        bodyClassName="p-0"
        actions={(
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <div className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setCurrentPage(1);
                }}
                className="pl-9"
                placeholder="Search buyers or traders"
                aria-label="Search buyers or traders"
              />
            </div>
            <Select value={assignmentFilter} onValueChange={(value) => {
              setAssignmentFilter(value);
              setCurrentPage(1);
            }}>
              <SelectTrigger className="w-[160px]" aria-label="Filter by assignment count">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASSIGNMENT_FILTERS.map((filter) => (
                  <SelectItem key={filter.value} value={filter.value}>{filter.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      >
        {loading ? (
          <StateBlock icon={Loader2} title="Loading buyer accounts..." description="Reading buyer Accounts from Salesforce and current assignments." />
        ) : error ? (
          <StateBlock
            icon={CircleAlert}
            title="Buyer accounts could not be loaded"
            description={error}
            action={<Button variant="outline" onClick={() => loadBuyers()}>Try again</Button>}
          />
        ) : filteredBuyers.length ? (
          <>
          <Table className="min-w-[760px]">
            <TableHeader className="sticky top-0 z-10 bg-muted/90 backdrop-blur">
              <TableRow>
                <TableHead>Buyer Account</TableHead>
                <TableHead>Buyer Traders</TableHead>
                <TableHead>Last Updated</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedBuyers.map((buyer) => {
                const duplicateName = duplicateNameCounts.get(String(buyer.buyerName || '').trim().toLowerCase()) > 1;
                return (
                  <TableRow key={buyer.buyerAccountKey}>
                    <TableCell className="min-w-[220px]">
                      <div className="font-medium text-foreground">{buyer.buyerName}</div>
                      {duplicateName && (
                        <div className="mt-0.5 text-xs text-muted-foreground">Account …{accountSuffix(buyer.buyerAccountId)}</div>
                      )}
                      {!buyer.salesforceActive && (
                        <Badge variant="outline" className="mt-1 border-slate-300 bg-slate-50 text-slate-600">Not in current STEM data</Badge>
                      )}
                    </TableCell>
                    <TableCell className="min-w-[300px]">
                      <div className="flex items-start gap-2">
                        <CoverageBadge count={buyer.traderCount} />
                        {buyer.traders.length > 0 && (
                          <div className="min-w-0 space-y-1">
                            {buyer.traders.map((trader) => (
                              <div key={trader.id} className="truncate text-xs text-foreground">
                                {trader.fullName}
                                {!trader.active && <span className="ml-1 text-destructive">(inactive)</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="min-w-[180px] text-xs">
                      <div>{formatDateTime(buyer.updatedAt)}</div>
                      {buyer.updatedByEmail && <div className="mt-0.5 truncate text-muted-foreground">{buyer.updatedByEmail}</div>}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEditor(buyer)}
                        disabled={!buyer.salesforceActive}
                        title={buyer.salesforceActive ? 'Manage buyer traders' : 'This Account is no longer used by a Salesforce STEM'}
                      >
                        <Pencil />
                        Manage
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
            <div className="text-xs text-muted-foreground">
              Showing {((visiblePage - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(visiblePage * PAGE_SIZE, filteredBuyers.length).toLocaleString()} of {filteredBuyers.length.toLocaleString()}
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
          <StateBlock title="No buyer accounts found" description="No accounts match the current search and assignment filter." />
        )}
      </TableShell>

      <Dialog open={Boolean(editingBuyer)} onOpenChange={(open) => !open && closeEditor()}>
        <DialogContent className="max-h-[90vh] max-w-2xl gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-5 py-4 pr-12">
            <DialogTitle>Manage Buyer Traders</DialogTitle>
            <DialogDescription className="mt-1">
              {editingBuyer?.buyerName}
              {duplicateNameCounts.get(String(editingBuyer?.buyerName || '').trim().toLowerCase()) > 1
                ? ` · Account …${accountSuffix(editingBuyer?.buyerAccountId)}`
                : ''}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[62vh] overflow-y-auto px-5 py-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <Label>Assigned Traders</Label>
              <Badge variant="outline">{selectedTraderIds.length} / 3</Badge>
            </div>

            {selectedTraderIds.length ? (
              <div className="space-y-2">
                {selectedTraderIds.map((userId, index) => {
                  const selectedUser = usersById.get(userId);
                  return (
                    <div key={userId} className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <Select value={userId} onValueChange={(value) => changeTrader(index, value)} disabled={saving}>
                          <SelectTrigger aria-label={`Assigned trader ${index + 1}`}>
                            <SelectValue>{selectedUser?.fullName || selectedUser?.email || 'Select trader'}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {users
                              .slice()
                              .sort((left, right) => compareText(left.fullName || left.email, right.fullName || right.email))
                              .map((user) => (
                                <SelectItem
                                  key={user.id}
                                  value={user.id}
                                  disabled={!user.active || selectedTraderIds.some((selectedId, selectedIndex) => selectedIndex !== index && selectedId === user.id)}
                                >
                                  {user.fullName || user.email} · {user.email}{user.active ? '' : ' · Inactive'}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeTrader(index)}
                        disabled={saving}
                        aria-label={`Remove ${selectedUser?.fullName || selectedUser?.email || 'trader'}`}
                        title="Remove trader"
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                No buyer trader assigned.
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              className="mt-3"
              onClick={addTrader}
              disabled={saving || noMoreUsers}
            >
              <Plus />
              Add Trader
            </Button>
          </div>

          <DialogFooter className="border-t border-border bg-muted/30 px-5 py-4">
            <Button type="button" variant="outline" onClick={closeEditor} disabled={saving}>Cancel</Button>
            <Button type="button" onClick={saveAssignments} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <UsersRound />}
              Save Assignments
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
