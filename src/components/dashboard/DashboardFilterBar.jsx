import { useEffect, useMemo, useState } from 'react';
import { Filter, RotateCcw, Search, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MONTHS, DASHBOARD_DATE_PRESETS } from '@/lib/dashboardFilters';

function optionLabel(option) { return String(option?.label ?? option?.name ?? option?.value ?? option ?? ''); }
function optionValue(option) { return String(option?.value ?? option?.canonicalValue ?? option?.id ?? optionLabel(option)); }

function Picker({ id, label, value, onCommit, options, placeholder, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setDraft(value); setInvalid(false); }, [value]);
  const matches = useMemo(() => options.filter((option) => !draft || optionLabel(option).toLowerCase().includes(draft.toLowerCase())).slice(0, 10), [options, draft]);
  const commitDraft = () => {
    const normalized = draft.trim().toLowerCase();
    const exact = options.find((option) => [optionLabel(option), option?.name, option?.countryCode, option?.clKey]
      .some((candidate) => String(candidate || '').trim().toLowerCase() === normalized));
    if (!exact) {
      setInvalid(Boolean(normalized));
      return;
    }
    setInvalid(false);
    onCommit(exact);
    setOpen(false);
  };
  return (
    <div className="relative min-w-0">
      <Label htmlFor={id} className="sr-only">{label}</Label>
      <Input id={id} value={draft} onChange={(event) => { setDraft(event.target.value); setInvalid(false); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 120)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitDraft(); } if (event.key === 'Escape') { setDraft(value); setInvalid(false); setOpen(false); } }} placeholder={placeholder} disabled={disabled} aria-invalid={invalid} className="h-8 w-full min-w-40 text-xs sm:w-48" autoComplete="off" />
      {open && matches.length > 0 ? <div className="absolute top-full z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-popover py-1 shadow-lg">
        {matches.map((option) => <button type="button" key={`${optionValue(option)}:${optionLabel(option)}`} onMouseDown={(event) => { event.preventDefault(); setInvalid(false); onCommit(option); setOpen(false); }} className="block w-full px-3 py-2 text-left text-xs hover:bg-muted">{optionLabel(option)}</button>)}
      </div> : null}
      {invalid ? <p className="mt-1 text-[11px] text-destructive">Select an exact Salesforce option.</p> : null}
    </div>
  );
}

function FilterChip({ children, onRemove }) {
  return <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-medium text-sky-900">{children}<button type="button" onClick={onRemove} aria-label={`Remove ${children}`} className="rounded-full text-sky-800 hover:text-sky-950"><X className="h-3 w-3" /></button></span>;
}

export default function DashboardFilterBar({ filters, years, portOptions, companyOptions, loading, onChange, onReset, onAiSearch }) {
  const [showCustom, setShowCustom] = useState(filters.datePreset === 'custom');
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const selectedMonthLabel = filters.selectedMonths.length === 12 ? 'All months' : filters.selectedMonths.map((month) => MONTHS.find((item) => item.value === month)?.label).join(', ');
  const hasFilters = filters.disputeOnly || filters.company || filters.portCountry || filters.datePreset !== 'this_month';
  const set = (patch) => onChange({ ...filters, ...patch });
  const setPreset = (datePreset) => { setShowCustom(datePreset === 'custom'); set({ datePreset }); };
  const submitAi = (event) => { event.preventDefault(); if (aiPrompt.trim().length >= 3) onAiSearch?.(aiPrompt.trim()); };
  return <section className="sticky top-0 z-30 -mx-3 mb-5 border-y border-border bg-background/95 px-3 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8" aria-label="Dashboard filters">
    <div className="mx-auto max-w-[1600px] rounded-xl border border-border bg-card p-3 shadow-sm">
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

      <div className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-2 xl:grid-cols-[auto_minmax(10rem,1fr)_minmax(10rem,1fr)] xl:items-center">
        <div className="flex rounded-md border border-border p-0.5"><button type="button" onClick={() => set({ counterpartyMode: 'buyer', company: '', companyId: '' })} className={`flex-1 rounded px-2 py-1 text-xs font-semibold ${filters.counterpartyMode === 'buyer' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}>Buyer</button><button type="button" onClick={() => set({ counterpartyMode: 'supplier', company: '', companyId: '' })} className={`flex-1 rounded px-2 py-1 text-xs font-semibold ${filters.counterpartyMode === 'supplier' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}>Supplier</button></div>
        <Picker id="dashboard-company" label="Exact company" value={filters.company} onCommit={(option) => set({ company: optionLabel(option), companyId: option?.id || optionValue(option) })} options={companyOptions} placeholder={`Exact ${filters.counterpartyMode} company`} />
        <Picker id="dashboard-port-country" label="Port or country" value={filters.portCountry} onCommit={(option) => set({ portCountry: optionLabel(option), portCountryId: option?.kind === 'country' ? `country:${option.countryCode}` : option?.id || optionValue(option) })} options={portOptions} placeholder="Port or country" />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5" aria-live="polite">
        <FilterChip onRemove={() => set({ datePreset: 'this_month' })}>{selectedMonthLabel} {filters.selectedYears.join(', ')}</FilterChip>
        {filters.disputeOnly ? <FilterChip onRemove={() => set({ disputeOnly: false })}>Disputed</FilterChip> : null}
        {filters.company ? <FilterChip onRemove={() => set({ company: '', companyId: '' })}>{filters.counterpartyMode}: {filters.company}</FilterChip> : null}
        {filters.portCountry ? <FilterChip onRemove={() => set({ portCountry: '', portCountryId: '' })}>Port: {filters.portCountry}</FilterChip> : null}
      </div>

      {aiOpen ? <form onSubmit={submitAi} className="mt-3 flex gap-2 border-t border-border pt-3"><Label htmlFor="dashboard-ai-search" className="sr-only">AI search</Label><Input id="dashboard-ai-search" value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} placeholder="Ask a precise dashboard question (optional)" className="h-9 text-sm" maxLength={500} /><Button type="submit" size="sm" disabled={aiPrompt.trim().length < 3 || loading}><SlidersHorizontal className="mr-1 h-3.5 w-3.5" />Apply</Button></form> : null}
    </div>
  </section>;
}
