import { Children, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Filter, Loader2, RotateCcw, Search, SlidersHorizontal, X } from 'lucide-react';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import DashboardSavedViews from './DashboardSavedViews';
import { dashboardPeriodLabel } from '@/lib/dashboardPresentation';
import { MONTHS, DASHBOARD_DATE_PRESETS, dashboardSuggestionMatches } from '@/lib/dashboardFilters';

function optionLabel(option) { return String(option?.label ?? option?.name ?? option?.value ?? option ?? ''); }
function optionValue(option) { return String(option?.value ?? option?.canonicalValue ?? option?.id ?? optionLabel(option)); }

function Picker({ id, label, value, onCommit, options, placeholder, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  useEffect(() => { setDraft(value); setInvalid(false); }, [value]);
  const matches = useMemo(() => dashboardSuggestionMatches(options, draft, 10), [options, draft]);
  const commitDraft = () => {
    const normalized = draft.trim().toLowerCase();
    const exact = options.find((option) => [optionLabel(option), option?.name, option?.countryCode, option?.clKey]
      .some((candidate) => String(candidate || '').trim().toLowerCase() === normalized));
    const selected = activeIndex >= 0 ? matches[activeIndex] : exact || matches[0];
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
      <Input id={id} value={draft} onChange={(event) => { setDraft(event.target.value); setInvalid(false); setActiveIndex(-1); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 120)} onKeyDown={(event) => { if (['ArrowDown', 'ArrowUp'].includes(event.key) && matches.length) { event.preventDefault(); setOpen(true); setActiveIndex((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length); } if (event.key === 'Enter') { event.preventDefault(); commitDraft(); } if (event.key === 'Escape') { setDraft(value); setInvalid(false); setOpen(false); } }} placeholder={placeholder} disabled={disabled} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-results`} aria-activedescendant={activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined} aria-invalid={invalid} className="h-9 w-full min-w-0 text-sm" autoComplete="off" />
      {open && matches.length > 0 ? <div id={`${id}-results`} role="listbox" className="absolute top-full z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-popover py-1 shadow-lg">
        {matches.map((option, index) => {
          const highlighted = option?.kind === 'group' || option?.kind === 'country';
          const typeLabel = option?.kind === 'group' ? 'GROUP' : option?.kind === 'country' ? 'COUNTRY' : option?.kind === 'port' ? 'Port' : 'Company';
          return <button type="button" key={`${option?.kind || ''}:${optionValue(option)}:${optionLabel(option)}`} id={`${id}-option-${index}`} role="option" aria-selected={activeIndex === index} onMouseDown={(event) => event.preventDefault()} onClick={() => { setInvalid(false); onCommit(option); setOpen(false); }} className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs ${activeIndex === index ? 'ring-2 ring-inset ring-primary' : ''} ${highlighted ? 'bg-amber-100 text-amber-950 hover:bg-amber-200' : 'hover:bg-muted'}`}><span className="min-w-0 whitespace-normal break-words">{optionLabel(option)}</span><span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${highlighted ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-border bg-background text-muted-foreground'}`}>{typeLabel}</span></button>;
        })}
      </div> : null}
      {invalid ? <p className="mt-1 text-[11px] text-destructive">No Salesforce suggestion matches.</p> : null}
    </div>
  );
}

function FilterChip({ children, onRemove }) {
  return <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-medium text-sky-900"><span className="min-w-0 break-words">{children}</span><button type="button" onClick={onRemove} aria-label={`Remove ${Children.toArray(children).join('')}`} className="shrink-0 rounded-full text-sky-800 hover:text-sky-950"><X className="h-3 w-3" /></button></span>;
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
  return <div className="relative min-w-0 dashboard-company-picker" data-testid="dashboard-unified-counterparty-search"><Label htmlFor="dashboard-counterparty" className="sr-only">Company or GROUP</Label><div className="relative"><Input id="dashboard-counterparty" value={draft} onChange={(event) => { setDraft(event.target.value); setOpen(true); setError(''); }} onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(restoreSelection, 140)} onKeyDown={onKeyDown} placeholder="Search Company or GROUP" disabled={disabled} className="h-9 w-full min-w-0 pr-8 text-sm" autoComplete="off" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls="dashboard-counterparty-results" aria-activedescendant={activeIndex >= 0 ? `dashboard-counterparty-option-${activeIndex}` : undefined} />{loading ? <Loader2 className="absolute right-2.5 top-2 h-4 w-4 animate-spin text-muted-foreground" /> : null}</div>{open && results.length ? <div id="dashboard-counterparty-results" role="listbox" className="absolute top-full z-50 mt-1 max-h-72 w-full overflow-auto rounded-md border border-border bg-popover py-1 shadow-lg">{results.map((entry, index) => { const group = entry.entityType === 'group'; const roles = Array.isArray(entry.roles) && entry.roles.length ? entry.roles.map((role) => role[0].toUpperCase() + role.slice(1)).join(' / ') : 'Unavailable'; return <button id={`dashboard-counterparty-option-${index}`} type="button" role="option" aria-selected={activeIndex === index} key={entry.entityKey || `${entry.entityType}:${entry.entityId}`} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(entry)} className={`block w-full px-3 py-2 text-left text-xs ${activeIndex === index ? 'ring-2 ring-inset ring-primary' : ''} ${group ? 'bg-amber-50 text-amber-950 hover:bg-amber-100' : 'hover:bg-muted'}`}><span className="flex items-center justify-between gap-2"><span className="min-w-0 whitespace-normal break-words font-semibold">{entry.name}</span><span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase ${group ? 'border-amber-300 bg-amber-100 text-amber-900' : 'border-border text-muted-foreground'}`}>{group ? 'GROUP' : 'Account'}</span></span><span className="mt-1 block text-[11px] opacity-80">{roles} · lifetime {Number(entry.buyerStemCount || 0).toLocaleString()} buyer / {Number(entry.supplierStemCount || 0).toLocaleString()} supplier STEMs{entry.clKey ? ` · ${entry.clKey}` : ''}</span></button>; })}</div> : null}{open && draft.trim().length >= 2 && !loading && !results.length && !error ? <p className="absolute top-full z-50 mt-1 w-full rounded-md border border-border bg-popover px-3 py-2 text-xs text-muted-foreground shadow-lg">No Company or GROUP matches.</p> : null}{error ? <p className="mt-1 text-[11px] text-destructive">{error}</p> : null}</div>;
}

export default function DashboardFilterBar({ filters, years, portOptions = [], loading, onChange, onReset, onAiSearch, showPerspective = true }) {
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const periodLabel = dashboardPeriodLabel(filters.selectedYears, filters.selectedMonths);
  const hasFilters = filters.disputeOnly || filters.counterparty || filters.port || filters.country || filters.datePreset !== 'year_to_date';
  const set = (patch) => onChange({ ...filters, ...patch });
  const setPreset = (datePreset) => { setShowCustom(datePreset === 'custom'); set({ datePreset }); };
  const submitAi = (event) => { event.preventDefault(); if (aiPrompt.trim().length >= 3) onAiSearch?.(aiPrompt.trim()); };
  return <section className="app-navigation-material workspace-filter-rail dashboard-controls sticky z-30 mb-3 rounded-[var(--radius-panel)] border border-border" aria-label="Dashboard filters">
    <button type="button" className="dashboard-mobile-filter-summary flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm" onClick={() => setMobileExpanded((value) => !value)} aria-expanded={mobileExpanded} aria-controls="dashboard-filter-controls">
      <Filter className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1"><span className="font-medium">Filters</span><span className="ml-2 text-xs text-muted-foreground">{periodLabel}</span>{filters.counterparty || filters.port || filters.country || filters.disputeOnly ? <span className="block break-words text-xs text-muted-foreground">{[filters.counterparty?.name, filters.country ? `COUNTRY - ${filters.country}` : filters.port, filters.disputeOnly ? 'Disputed only' : ''].filter(Boolean).join(' · ')}</span> : null}</span><ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${mobileExpanded ? 'rotate-180' : ''}`} />
    </button>
    <div id="dashboard-filter-controls" className={`workspace-filter-panel dashboard-filter-content p-3 ${mobileExpanded ? 'is-expanded' : ''}`}>
      <div className="dashboard-control-topline">
        <div className="dashboard-period-control"><Label htmlFor="dashboard-period" className="text-xs font-medium text-muted-foreground">Period</Label><select id="dashboard-period" value={filters.datePreset} onChange={(event) => setPreset(event.target.value)} className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-sm">{DASHBOARD_DATE_PRESETS.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}</select>{filters.datePreset === 'custom' ? <Button type="button" size="sm" variant="outline" className="h-9 text-xs" onClick={() => setShowCustom((value) => !value)} aria-expanded={showCustom} aria-controls="dashboard-custom-period">Edit dates</Button> : null}</div>
        <div className="dashboard-control-actions">
          <button type="button" onClick={() => set({ disputeOnly: !filters.disputeOnly })} aria-pressed={filters.disputeOnly} className={`h-9 rounded-md border px-2.5 text-xs font-medium ${filters.disputeOnly ? 'border-red-300 bg-red-50 text-red-800' : 'border-border text-muted-foreground hover:text-foreground'}`}>Disputed only</button>
          <DashboardSavedViews filters={filters} onApply={onChange} compact />
          <Button type="button" variant="ghost" size="sm" className="h-9 px-2 text-xs" onClick={() => setAiOpen((value) => !value)} aria-expanded={aiOpen} aria-controls="dashboard-ai-form"><Search className="mr-1 h-3.5 w-3.5" />AI search</Button>
          {hasFilters ? <Button type="button" variant="ghost" size="sm" className="h-9 px-2 text-xs" onClick={onReset}><RotateCcw className="mr-1 h-3.5 w-3.5" />Reset</Button> : null}
        </div>
      </div>

      {showCustom && filters.datePreset === 'custom' ? <div id="dashboard-custom-period" className="mt-2 space-y-2 rounded-lg border border-border bg-background/60 p-2.5">
        <fieldset><legend className="mb-1 text-xs font-medium">Years</legend><div className="flex flex-wrap gap-1">{years.map((year) => <button type="button" key={year} aria-pressed={filters.selectedYears.includes(year)} onClick={() => set({ datePreset: 'custom', selectedYears: filters.selectedYears.includes(year) ? (filters.selectedYears.length > 1 ? filters.selectedYears.filter((value) => value !== year) : filters.selectedYears) : [...filters.selectedYears, year] })} className={`min-h-9 rounded border px-2 text-xs ${filters.selectedYears.includes(year) ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground'}`}>{year}</button>)}</div></fieldset>
        <fieldset><legend className="mb-1 text-xs font-medium">Months</legend><div className="flex flex-wrap gap-1">{MONTHS.map((month) => <button type="button" key={month.value} aria-pressed={filters.selectedMonths.includes(month.value)} onClick={() => set({ datePreset: 'custom', selectedMonths: filters.selectedMonths.includes(month.value) ? (filters.selectedMonths.length > 1 ? filters.selectedMonths.filter((value) => value !== month.value) : filters.selectedMonths) : [...filters.selectedMonths, month.value] })} className={`min-h-9 rounded border px-2 text-xs ${filters.selectedMonths.includes(month.value) ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground'}`}>{month.label}</button>)}</div></fieldset>
      </div> : null}

      <div className={`dashboard-search-row mt-2 ${showPerspective ? 'with-perspective' : ''}`}>
        {showPerspective ? <div role="group" aria-label="Trading perspective" className="dashboard-perspective flex rounded-md border border-border p-0.5">{['buyer', 'supplier'].map((side) => <button key={side} type="button" aria-pressed={filters.counterpartyMode === side} onClick={() => set({ counterpartyMode: side })} disabled={Boolean(filters.counterparty && !((filters.counterparty.roles || []).includes(side)))} className={`min-h-8 flex-1 rounded px-2 text-xs font-medium ${filters.counterpartyMode === side ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'} disabled:cursor-not-allowed disabled:opacity-40`}>{side === 'buyer' ? 'Buyer' : 'Supplier'}</button>)}</div> : null}
        <div className="dashboard-keyword-filters" data-testid="dashboard-keyword-filter-group">
          <UnifiedCounterpartyPicker selection={filters.counterparty} onCommit={(entry) => { const roles = Array.isArray(entry.roles) ? entry.roles : []; set({ counterparty: entry, counterpartyMode: roles.includes(filters.counterpartyMode) ? filters.counterpartyMode : (roles[0] || 'buyer'), company: '', companyId: '', group: '', groupId: '', groupAccountIds: [] }); }} />
          <Picker id="dashboard-location" label="Port or COUNTRY" value={filters.country || filters.port} onCommit={(option) => option?.kind === 'country'
            ? set({ country: option?.countryCode || optionLabel(option), countryCode: option?.countryCode || optionValue(option), port: '', portId: '' })
            : set({ port: option?.name || optionLabel(option), portId: option?.id || optionValue(option), country: '', countryCode: '' })} options={portOptions} placeholder="Port or COUNTRY" />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5" aria-live="polite">
        <FilterChip onRemove={() => set({ datePreset: 'year_to_date' })}>{periodLabel}</FilterChip>
        {filters.disputeOnly ? <FilterChip onRemove={() => set({ disputeOnly: false })}>Disputed</FilterChip> : null}
        {filters.counterparty ? <FilterChip onRemove={() => set({ counterparty: null })}>{filters.counterparty.entityType === 'group' ? 'GROUP' : 'Account'}: {filters.counterparty.name}</FilterChip> : null}
        {filters.port ? <FilterChip onRemove={() => set({ port: '', portId: '' })}>Port: {filters.port}</FilterChip> : null}
        {filters.country ? <FilterChip onRemove={() => set({ country: '', countryCode: '' })}>COUNTRY: {filters.country}</FilterChip> : null}
      </div>

      {aiOpen ? <form id="dashboard-ai-form" onSubmit={submitAi} className="mt-2 flex flex-wrap gap-2 border-t border-border pt-2"><Label htmlFor="dashboard-ai-search" className="sr-only">AI search</Label><Input id="dashboard-ai-search" value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} placeholder="Ask a precise dashboard question (optional)" className="h-9 min-w-0 flex-[1_1_12rem] text-sm" maxLength={500} /><Button type="submit" size="sm" disabled={aiPrompt.trim().length < 3 || loading}><SlidersHorizontal className="mr-1 h-3.5 w-3.5" />Apply</Button></form> : null}
    </div>
  </section>;
}
