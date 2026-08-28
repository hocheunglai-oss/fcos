import { Check, Layers3 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function GroupAccountScopeSelector({ groupScope, selectedAccountIds = null, onChange, disabled = false }) {
  if (!groupScope?.selectable || !Array.isArray(groupScope.availableAccounts)) return null;
  const available = groupScope.availableAccounts;
  const effectiveIds = selectedAccountIds === null
    ? groupScope.includedAccountIds || available.filter((account) => account.included).map((account) => account.accountId)
    : selectedAccountIds;
  const selected = new Set(effectiveIds);
  const toggle = (accountId) => {
    const next = new Set(selected);
    if (next.has(accountId)) next.delete(accountId); else next.add(accountId);
    onChange?.([...next]);
  };
  return <section className="rounded-lg border border-sky-200 bg-sky-50/70 p-3" aria-label="GROUP Account scope">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-sky-950"><Layers3 className="h-4 w-4" />Accounts included in this GROUP statement</div>
        <p className="mt-1 text-xs text-sky-900">Select the active hierarchy Accounts whose STEMs and exposure should be combined. Changes refresh only this Credit Statement.</p>
      </div>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" disabled={disabled || selected.size === available.length} onClick={() => onChange?.(null)}>Select all</Button>
        <Button type="button" size="sm" variant="outline" disabled={disabled || selected.size === 0} onClick={() => onChange?.([])}>Clear all</Button>
      </div>
    </div>
    <div className="mt-3 flex flex-wrap gap-2">
      {available.map((account) => {
        const active = selected.has(account.accountId);
        return <button
          key={account.accountId}
          type="button"
          aria-pressed={active}
          disabled={disabled}
          title={account.clKey ? `${account.name} · ${account.clKey}` : account.name}
          onClick={() => toggle(account.accountId)}
          className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1.5 text-left text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${active ? 'border-sky-600 bg-sky-600 text-white' : 'border-sky-200 bg-white text-sky-950 hover:border-sky-400'}`}
        >
          {active ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
          <span className="truncate">{account.isGroupRoot ? `GROUP account · ${account.name}` : account.name}</span>
        </button>;
      })}
    </div>
    <div className="mt-2 text-[11px] text-sky-900">{selected.size} of {available.length} Accounts included{selected.size !== available.length ? ' · scoped view' : ''}</div>
  </section>;
}
