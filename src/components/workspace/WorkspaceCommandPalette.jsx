import { useEffect, useMemo, useRef, useState } from 'react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Building2, Loader2, Settings2, SlidersHorizontal, UsersRound } from 'lucide-react';
import { appClient } from '@/api/appClient';

function counterpartyTarget(entry) {
  const roles = Array.isArray(entry.roles) ? entry.roles.filter((role) => role === 'buyer' || role === 'supplier') : [];
  const entityType = entry.entityType === 'group' ? 'group' : 'account';
  const role = entityType === 'group' ? 'group' : roles.length > 1 ? 'both' : roles[0] || 'buyer';
  const statementSide = roles.length > 1 ? 'both' : roles[0] || 'buyer';
  const params = new URLSearchParams({
    tab: 'accounts',
    insightAccountId: String(entry.entityId || ''),
    insightName: String(entry.name || 'Account'),
    insightRole: role,
    insightRoles: roles.join(','),
    insightEntityType: entityType,
    insightTab: 'overview',
    insightStatementSide: statementSide,
    insightPeriod: 'dashboard_period',
    insightScope: 'dashboard',
  });
  return `/?${params.toString()}`;
}

export default function WorkspaceCommandPalette({ open, onOpenChange, groups, onNavigate, onCustomizeNavigation, canSearchCounterparties = false }) {
  const [query, setQuery] = useState('');
  const [counterparties, setCounterparties] = useState([]);
  const [counterpartyLoading, setCounterpartyLoading] = useState(false);
  const [counterpartyError, setCounterpartyError] = useState('');
  const abortRef = useRef(null);
  const items = useMemo(() => groups.flatMap((group) => group.items.map((item) => ({ ...item, groupLabel: group.label }))), [groups]);
  useEffect(() => {
    if (!open || !canSearchCounterparties || query.trim().length < 2) {
      abortRef.current?.abort();
      setCounterparties([]);
      setCounterpartyLoading(false);
      setCounterpartyError('');
      return undefined;
    }
    const timer = window.setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setCounterpartyLoading(true);
      setCounterpartyError('');
      try {
        const response = await appClient.functions.invoke('dashboardCounterpartySearch', { query: query.trim(), limit: 8 }, {
          cache: true,
          cacheTtlMs: 45_000,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.data?.error) {
          setCounterparties([]);
          setCounterpartyError(response.data.error);
        } else {
          setCounterparties(Array.isArray(response.data?.results) ? response.data.results : []);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setCounterparties([]);
          setCounterpartyError(error?.message || 'Account search is temporarily unavailable.');
        }
      } finally {
        if (!controller.signal.aborted) setCounterpartyLoading(false);
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [canSearchCounterparties, open, query]);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    if (!open) {
      setQuery('');
      setCounterparties([]);
      setCounterpartyError('');
    }
  }, [open]);
  const choose = (action) => {
    onOpenChange(false);
    window.requestAnimationFrame(action);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="workspace-command-palette top-[18%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0 sm:rounded-[18px]" aria-describedby="workspace-command-description">
        <DialogTitle className="sr-only">FCOS command palette</DialogTitle>
        <DialogDescription id="workspace-command-description" className="sr-only">Search accessible workspaces and FCOS actions.</DialogDescription>
        <Command className="bg-transparent">
          <CommandInput autoFocus value={query} onValueChange={setQuery} placeholder={canSearchCounterparties ? 'Search workspaces, Accounts and GROUPs…' : 'Search workspaces and actions…'} />
          <CommandList className="max-h-[min(60vh,30rem)]">
            <CommandEmpty>{counterpartyLoading ? 'Searching Accounts and GROUPs…' : 'No accessible command or counterparty found.'}</CommandEmpty>
            {counterparties.length ? (
              <CommandGroup heading="Accounts and GROUPs">
                {counterparties.map((entry) => {
                  const isGroup = entry.entityType === 'group';
                  const Icon = isGroup ? UsersRound : Building2;
                  const roles = Array.isArray(entry.roles) && entry.roles.length ? entry.roles.map((role) => role[0].toUpperCase() + role.slice(1)).join(' & ') : 'No active role';
                  return (
                    <CommandItem
                      key={entry.entityKey || `${entry.entityType}:${entry.entityId}`}
                      value={`${entry.name} ${entry.clKey || ''} ${isGroup ? 'GROUP' : 'Account'} ${roles}`}
                      onSelect={() => choose(() => onNavigate(counterpartyTarget(entry)))}
                      className={isGroup ? 'bg-amber-50/70 text-amber-950 data-[selected=true]:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-100 dark:data-[selected=true]:bg-amber-900/60' : undefined}
                    >
                      <Icon className="mr-1 h-4 w-4" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{entry.name}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{isGroup ? 'GROUP' : 'Account'} · {roles} · {Number(entry.buyerStemCount || 0).toLocaleString()} buyer / {Number(entry.supplierStemCount || 0).toLocaleString()} supplier STEMs{entry.clKey ? ` · ${entry.clKey}` : ''}</span>
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null}
            {counterpartyLoading ? <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Searching exact Salesforce identities…</div> : null}
            {counterpartyError ? <div className="px-3 py-2 text-xs text-destructive">{counterpartyError}</div> : null}
            {groups.map((group) => (
              <CommandGroup key={group.id} heading={group.label}>
                {items.filter((item) => item.groupLabel === group.label).map((item) => {
                  const Icon = item.icon;
                  return <CommandItem key={item.id} value={`${item.label} ${group.label}`} onSelect={() => choose(() => onNavigate(item.to))}><Icon className="mr-2 h-4 w-4" />{item.label}</CommandItem>;
                })}
              </CommandGroup>
            ))}
            <CommandSeparator />
            <CommandGroup heading="Workspace">
              <CommandItem onSelect={() => choose(() => onNavigate('/settings'))}><Settings2 className="mr-2 h-4 w-4" />My Settings<CommandShortcut>⌘,</CommandShortcut></CommandItem>
              <CommandItem onSelect={() => choose(onCustomizeNavigation)}><SlidersHorizontal className="mr-2 h-4 w-4" />Customize Dock</CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
