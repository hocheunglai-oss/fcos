import { useEffect, useMemo, useRef, useState } from 'react';
import { Filter, Loader2, RotateCcw, Search, SlidersHorizontal, X } from 'lucide-react';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MONTHS, DASHBOARD_DATE_PRESETS, dashboardSuggestionMatches } from '@/lib/dashboardFilters';

function optionLabel(option) { return String(option?.label ?? option?.name ?? option?.value ?? option ?? ''); }
function optionValue(option) { return String(option?.value ?? option?.canonicalValue ?? option?.id ?? optionLabel(option)); }

function Picker({ id, label, value, onCommit, options, placeholder, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setDraft(value); setInvalid(false); }, [value]);
  const matches = useMemo(() => dashboardSuggestionMatches(options, draft, 10), [options, draft]);
  const commitDraft = () => {
    const normalized = draft.trim().toLowerCase();
    const exact = options.find((option) => [optionLabel(option), option?.name, option?.countryCode, option?.clKey]
      .some((candidate) => String(candidate || '').trim().toLowerCase() === normalized));
    const selected = exact || matches[0];
    if (!selected) {
      setInvalid(Boolean(normalized));
      return;
    }
    setInvalid(false);
    onCommit(selected);
    setOpen(false);
  };
  return (
    <div className="relative min-w-0">
      <Label htmlFor={id} className="sr-only">{label}</Label>
      <Input id={id} value={draft} onChange={(event) => { setDraft(event.target.value); setInvalid(false); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 120)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitDraft(); } if (event.key === 'Escape') { setDraft(value); setInvalid(false); setOpen(false); } }} placeholder={placeholder} disabled={disabled} aria-invalid={invalid} className="h-8 w-full min-w-40 text-xs sm:w-48" autoComplete="off" />
      {open && matches.length > 0 ? <div className="absolute top-full z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-popover py-1 shadow-lg">
        {matches.map((option) => {
          const highlighted = option?.kind === 'group' || option?.kind === 'country';
          const typeLabel = option?.kind === 'group' ? 'GROUP' : option?.kind === 'country' ? 'COUNTRY' : option?.kind === 'port' ? 'Port' : 'Company';
          return <button type="button" key={`${option?.kind || ''}:${optionValue(option)}:${optionLabel(option)}`} onMouseDown={(event) => { event.preventDefault(); setInvalid(false); onCommit(option); setOpen(false); }} className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs ${highlighted ? 'bg-amber-100 text-amber-950 hover:bg-amber-200' : 'hover:bg-muted'}`}><span className="min-w-0 truncate">{optionLabel(option)}</span><span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${highlighted ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-border bg-background text-muted-foreground'}`}>{typeLabel}</span></button>;
        })}
      </div> : null}
      {invalid ? <p className="mt-1 text-[11px] text-destructive">No Salesforce suggestion matches.</p> : null}
    </div>
  );
}

function FilterChip({ children, onRemove }) {
  return <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-medium text-sky-900">{children}<button type="button" onClick={onRemove} aria-label={`Remove ${children}`} className="rounded-full text-sky-800 hover:text-sky-950"><X className="h-3 w-3" /></button></span>;
}

function UnifiedCounterpartyPicker({ selection, onCommit, disabled = false }) {
  const [draft, setDraft] = useState(selection?.name || '');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [error, setError] = useState('');
  const abortRef = useRef(null);
  useEffect(() => { setDraft(selection?.name || ''); }, [selection?.entityId, selection?.name]);
  useEffect(() => {
    const query = draft.trim();
    if (query.length < 2) { setResults([]); return undefined; }
    if (selection?.entityId && query === String(selection.name || '').trim()) { setResults([]); return undefined; }
    const timer = window.setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      try {
        const response = await appClient.functions.invoke('dashboardCounterpartySearch', { query, limit: 12 }, { cache: true, cacheTtlMs: 45_000, signal: controller.signal });
        if (!controller.signal.aborted) { if (response.data?.error) setError(response.data.error); else { setResults(Array.isArray(response.data?.results) ? response.data.results : []); setError(''); setActiveIndex(-1); } }
      } catch (searchError) { if (!controller.signal.aborted) setError(searchError.message || 'Search is unavailable.'); } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [draft, selection?.entityId, selection?.name]);
  useEffect(() => () => abortRef.current?.abort(), []);
  const choose = (entry) => { onCommit(entry); setDraft(entry.name); setOpen(false); };
  const restoreSelection = () => { setDraft(selection?.name || ''); setOpen(false); setActiveIndex(-1); setError(''); };
  const onKeyDown = (event) => { if (event.key === 'Escape') { restoreSelection(); return; } if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (!results.length) return; setOpen(true); setActiveIndex((index) => (event.key === 'ArrowDown' ? (index + 1 + results.length) % results.length : (index - 1 + results.length) % results.length)); } if (event.key === 'Enter' && open && results.length) { event.preventDefault(); choose(results[Math.max(0, activeIndex)]); } };
  return <div className="relative min-w-0 sm:w-[27rem]" data-testid="dashboard-unified-counterparty-search"><Label htmlFor="dashboard-counterparty" className="sr-only">Company or GROUP</Label><div className="relative"><Input id="dashboard-counterparty" value={draft} onChange={(event) => { setDraft(event.target.value); setOpen(true); setError(''); }} onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(restoreSelection, 140)} onKeyDown={onKeyDown} placeholder="Search Company or GROUP" disabled={disabled} className="h-8 w-full pr-8 text-xs" autoComplete="off" aria-expanded={open} aria-controls="dashboard-counterparty-results" aria-activedescendant={activeIndex >= 0 ? `dashboard-counterparty-option-${activeIndex}` : undefined} />{loading ? <Loader2 className="absolute right-2.5 top-2 h-4 w-4 animate-spin text-muted-foreground" /> : null}</div>{open && results.length ? <div id="dashboard-counterparty-results" role="listbox" className="absolute top-full z-50 mt-1 max-h-72 w-full overflow-auto rounded-md border border-border bg-popover py-1 shadow-lg">{results.map((entry, index) => { const group = entry.entityType === 'group'; const roles = Array.isArray(entry.roles) && entry.roles.length ? entry.roles.map((role) => role[0].toUpperCase() + role.slice(1)).join(' / ') : 'Unavailable'; return <button id={`dashboard-counterparty-option-${index}`} type="button" role="option" aria-selected={activeIndex === index} key={entry.entityKey || `${entry.entityType}:${entry.entityId}`} onMouseDown={(event) => { event.preventDefault(); choose(entry); }} className={`block w-full px-3 py-2 text-left text-xs ${activeIndex === index ? 'ring-2 ring-inset ring-primary' : ''} ${group ? 'bg-amber-50 text-amber-950 hover:bg-amber-100' : 'hover:bg-muted'}`}><span className="flex items-center justify-between gap-2"><span className="min-w-0 truncate font-semibold">{entry.name}</span><span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase ${group ? 'border-amber-300 bg-amber-100 text-amber-900' : 'border-border text-muted-foreground'}`}>{group ? 'GROUP' : 'Account'}</span></span><span className="mt-1 block text-[11px] opacity-80">{roles} · lifetime {Number(entry.buyerStemCount || 0).toLocaleString()} buyer / {Number(entry.supplierStemCount || 0).toLocaleString()} supplier STEMs{entry.clKey ? ` · ${entry.clKey}` : ''}</span></button>; })}</div> : null}{open && draft.trim().length >= 2 && !loading && !results.length && !error ? <p className="absolute top-full z-50 mt-1 w-full rounded-md border border-border bg-popover px-3 py-2 text-xs text-muted-foreground shadow-lg">No Company or GROUP matches.</p> : null}{error ? <p className="mt-1 text-[11px] text-destructive">{error}</p> : null}</div>;
}

export default function DashboardFilterBar({ filters, years, portOptions = [], loading, onChange, onReset, onAiSearch }) {
  const [showCustom, setShowCustom] = useState(filters.datePreset === 'custom');
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const selectedMonthLabel = filters.selectedMonths.length === 12 ? 'All months' : filters.selectedMonths.map((month) => MONTHS.find((item) => item.value === month)?.label).join(', ');
  const hasFilters = filters.disputeOnly || filters.counterparty || filters.port || filters.country || filters.datePreset !== 'year_to_date';
  const set = (patch) => onChange({ ...filters, ...patch });
  const setPreset = (datePreset) => { setShowCustom(datePreset === 'custom'); set({ datePreset }); };
  const submitAi = (event) => { event.preventDefault(); if (aiPrompt.trim().length >= 3) onAiSearch?.(aiPrompt.trim()); };
  return <section className="app-navigation-material workspace-filter-rail sticky top-[var(--workspace-toolbar-height)] z-30 -mx-3 mb-5 border-y border-border px-3 py-2.5 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8" aria-label="Dashboard filters">
    <div className="workspace-filter-panel mx-auto max-w-[1600px] rounded-[var(--radius-panel)] border border-border bg-card p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Filter className="h-3.5 w-3.5" />Period</span>
        {DASHBOARD_DATE_PRESETS.map((preset) => <button type="button" key={preset.value} onClick={() => setPreset(preset.value)} className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors ${filters.datePreset === preset.value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:text-foreground'}`}>{preset.label}</button>)}
        <span className="hidden h-5 border-l border-border sm:block" />
        <button type="button" onClick={() => set({ disputeOnly: !filters.disputeOnly })} className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold ${filters.disputeOnly ? 'border-red-300 bg-red-50 text-red-800' : 'border-border text-muted-foreground hover:text-foreground'}`}>Disputed only</button>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setAiOpen((value) => !value)} aria-expanded={aiOpen}><Search className="mr-1 h-3.5 w-3.5" />AI search</Button>
          {hasFilters ? <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={onReset}><RotateCcw className="mr-1 h-3.5 w-3.5" />Reset</Button> : null}
        </div>
      </div>

      {(showCustom || filters.datePreset === 'custom') ? <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <span className="text-xs font-semibold text-muted-foreground">Custom</span>
        <div className="flex flex-wrap gap-1">{years.map((year) => <button type="button" key={year} onClick={() => set({ datePreset: 'custom', selectedYears: filters.selectedYears.includes(year) ? (filters.selectedYears.length > 1 ? filters.selectedYears.filter((value) => value !== year) : filters.selectedYears) : [...filters.selectedYears, year] })} className={`rounded border px-2 py-1 text-xs ${filters.selectedYears.includes(year) ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground'}`}>{year}</button>)}</div>
        <div className="flex flex-wrap gap-1">{MONTHS.map((month) => <button type="button" key={month.value} onClick={() => set({ datePreset: 'custom', selectedMonths: filters.selectedMonths.includes(month.value) ? (filters.selectedMonths.length > 1 ? filters.selectedMonths.filter((value) => value !== month.value) : filters.selectedMonths) : [...filters.selectedMonths, month.value] })} className={`rounded border px-2 py-1 text-xs ${filters.selectedMonths.includes(month.value) ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground'}`}>{month.label}</button>)}</div>
      </div> : null}

      <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-start">
        <div className="flex rounded-md border border-border p-0.5 sm:w-48 sm:shrink-0"><button type="button" onClick={() => set({ counterpartyMode: 'buyer' })} disabled={Boolean(filters.counterparty && !((filters.counterparty.roles || []).includes('buyer')))} className={`flex-1 rounded px-2 py-1 text-xs font-semibold ${filters.counterpartyMode === 'buyer' ? 'bg-muted text-foreground' : 'text-muted-foreground'} disabled:cursor-not-allowed disabled:opacity-40`}>Buyer</button><button type="button" onClick={() => set({ counterpartyMode: 'supplier' })} disabled={Boolean(filters.counterparty && !((filters.counterparty.roles || []).includes('supplier')))} className={`flex-1 rounded px-2 py-1 text-xs font-semibold ${filters.counterpartyMode === 'supplier' ? 'bg-muted text-foreground' : 'text-muted-foreground'} disabled:cursor-not-allowed disabled:opacity-40`}>Supplier</button></div>
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start" data-testid="dashboard-keyword-filter-group">
          <UnifiedCounterpartyPicker selection={filters.counterparty} onCommit={(entry) => { const roles = Array.isArray(entry.roles) ? entry.roles : []; set({ counterparty: entry, counterpartyMode: roles.includes(filters.counterpartyMode) ? filters.counterpartyMode : (roles[0] || 'buyer'), company: '', companyId: '', group: '', groupId: '', groupAccountIds: [] }); }} />
          <Picker id="dashboard-location" label="Port or COUNTRY" value={filters.country || filters.port} onCommit={(option) => option?.kind === 'country'
            ? set({ country: option?.countryCode || optionLabel(option), countryCode: option?.countryCode || optionValue(option), port: '', portId: '' })
            : set({ port: option?.name || optionLabel(option), portId: option?.id || optionValue(option), country: '', countryCode: '' })} options={portOptions} placeholder="Port or COUNTRY" />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5" aria-live="polite">
        <FilterChip onRemove={() => set({ datePreset: 'year_to_date' })}>{selectedMonthLabel} {filters.selectedYears.join(', ')}</FilterChip>
        {filters.disputeOnly ? <FilterChip onRemove={() => set({ disputeOnly: false })}>Disputed</FilterChip> : null}
        {filters.counterparty ? <FilterChip onRemove={() => set({ counterparty: null })}>{filters.counterparty.entityType === 'group' ? 'GROUP' : 'Account'}: {filters.counterparty.name}</FilterChip> : null}
        {filters.port ? <FilterChip onRemove={() => set({ port: '', portId: '' })}>Port: {filters.port}</FilterChip> : null}
        {filters.country ? <FilterChip onRemove={() => set({ country: '', countryCode: '' })}>Country: {filters.country}</FilterChip> : null}
      </div>

      {aiOpen ? <form onSubmit={submitAi} className="mt-3 flex gap-2 border-t border-border pt-3"><Label htmlFor="dashboard-ai-search" className="sr-only">AI search</Label><Input id="dashboard-ai-search" value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} placeholder="Ask a precise dashboard question (optional)" className="h-9 text-sm" maxLength={500} /><Button type="submit" size="sm" disabled={aiPrompt.trim().length < 3 || loading}><SlidersHorizontal className="mr-1 h-3.5 w-3.5" />Apply</Button></form> : null}
    </div>
  </section>;
}
