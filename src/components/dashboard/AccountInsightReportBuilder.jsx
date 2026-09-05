import { useEffect, useMemo, useState } from 'react';
import { Archive, ChevronDown, ChevronUp, FileText, Loader2, Save } from 'lucide-react';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DEFAULT_REPORT_CONFIG, REPORT_COLUMNS, REPORT_PRESETS, REPORT_SECTIONS } from '@/lib/accountInsightReportCatalogue';
import { moveReportItem } from '@/components/dashboard/accountInsightPresentation';

const FALLBACK_SECTIONS = [
  ['profile', 'Account profile'], ['trading', 'Trading performance'], ['credit', 'Credit exposure'], ['payments', 'Payment performance'], ['stems', 'STEM evidence'], ['risks', 'Risk & workflow'],
];
const FALLBACK_COLUMNS = [
  ['stem', 'STEM'], ['date', 'Date'], ['status', 'Status'], ['currency', 'Currency'], ['vessel', 'Vessel'], ['port', 'Port'], ['product', 'Product'], ['quantity', 'Quantity'], ['invoice', 'Invoice'], ['payments', 'Payments'], ['balance', 'Balance'], ['dueDate', 'Due date'],
];

function items(value, fallback) {
  if (Array.isArray(value) && value.length) return value.map((item) => ({ id: item.id || item.value, label: item.label || item.name || item.id || item.value, audiences: item.audiences }));
  return fallback.map(([id, label]) => ({ id, label }));
}

function defaultConfig(catalogue = {}) {
  const configured = catalogue.defaultReportConfig || catalogue.defaultConfig;
  return presentationConfig({ ...DEFAULT_REPORT_CONFIG, ...configured });
}

function presentationConfig(value = {}) {
  return {
    audience: value.audience || 'internal',
    sections: Array.isArray(value.sections) ? value.sections : DEFAULT_REPORT_CONFIG.sections,
    columns: Array.isArray(value.columns) ? value.columns : DEFAULT_REPORT_CONFIG.columns,
    depth: value.depth || 'summary',
    includeExpected: value.includeExpected === true,
    includeCharts: value.includeCharts !== false,
    detailSelection: value.detailSelection || 'all',
    selectedStemIds: Array.isArray(value.selectedStemIds) ? value.selectedStemIds : [],
  };
}

function presetConfiguration(value) {
  const { audience, sections, columns, depth, includeExpected, includeCharts } = presentationConfig(value);
  return { audience, sections, columns, depth, includeExpected, includeCharts };
}

function allowedChoices(choices, audience) {
  return choices.filter((choice) => !Array.isArray(choice.audiences) || choice.audiences.includes(audience));
}

function ToggleList({ label, choices, selected, onChange }) {
  const chosen = new Set(selected);
  return <fieldset><legend className="mb-1.5 text-xs font-semibold text-muted-foreground">{label}</legend><div className="flex flex-wrap gap-1.5">{choices.map((choice) => <label key={choice.id} className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium ${chosen.has(choice.id) ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground'}`}><input className="sr-only" type="checkbox" checked={chosen.has(choice.id)} onChange={() => onChange(chosen.has(choice.id) ? selected.filter((id) => id !== choice.id) : [...selected, choice.id])} />{choice.label}</label>)}</div></fieldset>;
}

function ReorderList({ label, choices, selected, onChange }) {
  const labels = new Map(choices.map((choice) => [choice.id, choice.label]));
  if (!selected.length) return null;
  return <div className="rounded-md border border-border p-2"><div className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">{label}</div><div className="space-y-1">{selected.map((id, index) => <div key={id} className="flex items-center gap-2 rounded bg-muted/40 px-2 py-1"><span className="min-w-0 flex-1 truncate text-xs">{index + 1}. {labels.get(id) || id}</span><Button type="button" size="icon" variant="ghost" className="h-6 w-6" disabled={index === 0} onClick={() => onChange(moveReportItem(selected, id, -1))} aria-label={`Move ${labels.get(id) || id} up`}><ChevronUp className="h-3.5 w-3.5" /></Button><Button type="button" size="icon" variant="ghost" className="h-6 w-6" disabled={index === selected.length - 1} onClick={() => onChange(moveReportItem(selected, id, 1))} aria-label={`Move ${labels.get(id) || id} down`}><ChevronDown className="h-3.5 w-3.5" /></Button></div>)}</div></div>;
}

export default function AccountInsightReportBuilder({ open, onClose, onBuild, sharedScope = {}, scopeDisplay = {}, stemRows = [], returnFocusRef = null }) {
  const [options, setOptions] = useState(null);
  const [presets, setPresets] = useState([]);
  const [config, setConfig] = useState(() => defaultConfig());
  const [name, setName] = useState('');
  const [editingPreset, setEditingPreset] = useState(null);
  const [saving, setSaving] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState(null);
  const catalogue = options?.catalogue || {};
  const sections = useMemo(() => items(catalogue.sections || REPORT_SECTIONS, FALLBACK_SECTIONS), [catalogue.sections]);
  const columns = useMemo(() => items(catalogue.columns || REPORT_COLUMNS, FALLBACK_COLUMNS), [catalogue.columns]);
  const availableSections = allowedChoices(sections, config.audience);
  const availableColumns = allowedChoices(columns, config.audience);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setError(null);
    Promise.all([
      appClient.functions.invoke('dashboardAccountInsightReportOptions', sharedScope, { cache: true, cacheTtlMs: 300_000 }),
      appClient.functions.invoke('dashboardAccountInsightReportPresetsList', sharedScope, { cache: true, cacheTtlMs: 60_000 }),
    ]).then(([optionsResponse, presetResponse]) => {
      if (cancelled) return;
      if (optionsResponse.data?.error) throw new Error(optionsResponse.data.error);
      if (presetResponse.data?.error) throw new Error(presetResponse.data.error);
      setOptions(optionsResponse.data || {});
      setPresets(presetResponse.data?.presets || []);
      setConfig(defaultConfig(optionsResponse.data?.catalogue || {}));
    }).catch((loadError) => { if (!cancelled) setError(loadError.message || 'Report options could not be loaded.'); });
    return () => { cancelled = true; };
  }, [open, sharedScope]);

  const update = (patch) => setConfig((current) => ({ ...current, ...patch }));
  const setAudience = (audience) => setConfig((current) => {
    const nextSections = allowedChoices(sections, audience).map((choice) => choice.id);
    const nextColumns = allowedChoices(columns, audience).map((choice) => choice.id);
    return { ...current, audience, sections: current.sections.filter((id) => nextSections.includes(id)), columns: current.columns.filter((id) => nextColumns.includes(id)) };
  });
  const applyPreset = (preset) => { setConfig(presentationConfig({ ...defaultConfig(catalogue), ...(preset.configuration || preset) })); setEditingPreset(preset.scope ? preset : null); setName(preset.scope ? preset.name : ''); };
  const savePreset = async (scope, existingPreset = null) => {
    if (!name.trim()) { setError('Enter a preset name before saving.'); return; }
    setSaving(true); setError(null);
    try {
      const response = await appClient.functions.invoke('dashboardAccountInsightReportPresetsSave', { ...sharedScope, ...(existingPreset ? { id: existingPreset.id, expectedRevision: existingPreset.revision } : {}), name: name.trim(), scope, configuration: presetConfiguration(config), idempotencyKey: crypto.randomUUID() });
      if (response.data?.error) throw new Error(response.data.error);
      const savedPreset = response.data?.preset;
      if (!savedPreset) throw new Error('The server did not return the saved preset.');
      setPresets((current) => [...current.filter((preset) => preset.id !== savedPreset.id), savedPreset]);
      setEditingPreset(savedPreset);
      setName(savedPreset.name || name.trim());
    } catch (saveError) { setError(saveError.message || 'The preset could not be saved.'); } finally { setSaving(false); }
  };
  const archivePreset = async (preset) => {
    setSaving(true); setError(null);
    try {
      const response = await appClient.functions.invoke('dashboardAccountInsightReportPresetsArchive', { ...sharedScope, id: preset.id, scope: preset.scope, expectedRevision: preset.revision, idempotencyKey: crypto.randomUUID() });
      if (response.data?.error) throw new Error(response.data.error);
      setPresets((current) => current.filter((item) => item.id !== preset.id));
    } catch (archiveError) { setError(archiveError.message || 'The preset could not be archived.'); } finally { setSaving(false); }
  };
  const build = async () => {
    setBuilding(true); setError(null);
    try { await onBuild(config); onClose(); }
    catch (buildError) { setError(buildError.message || 'The report could not be built.'); }
    finally { setBuilding(false); }
  };

  const groupScopeLabel = scopeDisplay.groupName
    ? `GROUP ${scopeDisplay.groupName}${Number.isFinite(scopeDisplay.selectedCount) ? ` · ${scopeDisplay.selectedCount}${Number.isFinite(scopeDisplay.totalCount) ? ` of ${scopeDisplay.totalCount}` : ''} selected` : ''}`
    : `Exact account${Number.isFinite(scopeDisplay.selectedCount) ? ` · ${scopeDisplay.selectedCount} selected` : ''}`;

  return <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
    <DialogContent className="account-insight-report-builder left-auto right-0 top-0 z-[70] h-[100dvh] w-full max-w-xl translate-x-0 translate-y-0 overflow-y-auto rounded-none border-l border-border p-5 shadow-2xl sm:max-w-xl sm:p-6" onCloseAutoFocus={(event) => { if (returnFocusRef?.current) { event.preventDefault(); returnFocusRef.current.focus(); } }}>
      <DialogHeader className="pr-8 text-left">
        <DialogTitle>Build report</DialogTitle>
        <DialogDescription>The exported PDF keeps the current reporting scope.</DialogDescription>
      </DialogHeader>
      <dl className="mt-4 grid gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs sm:grid-cols-2" aria-label="Report scope">
        <div><dt className="font-semibold text-muted-foreground">Account</dt><dd className="mt-0.5 text-foreground">{scopeDisplay.accountName || 'Selected account'}{scopeDisplay.accountClKey ? ` · CL Key ${scopeDisplay.accountClKey}` : ''}</dd></div>
        <div><dt className="font-semibold text-muted-foreground">GROUP selection</dt><dd className="mt-0.5 text-foreground">{groupScopeLabel}</dd></div>
        <div><dt className="font-semibold text-muted-foreground">Trading period</dt><dd className="mt-0.5 text-foreground">{scopeDisplay.periodLabel || 'Selected period'}</dd></div>
        <div><dt className="font-semibold text-muted-foreground">Current statement as of</dt><dd className="mt-0.5 text-foreground">{scopeDisplay.statementAsOf || 'Not available'}</dd></div>
      </dl>
      {error ? <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
      <div className="mt-5 space-y-5">
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-muted-foreground">Audience<select className="mt-1.5 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground" value={config.audience} onChange={(event) => setAudience(event.target.value)}><option value="internal">Internal</option><option value="buyer">Buyer</option><option value="supplier">Supplier</option></select></label><label className="text-xs font-semibold text-muted-foreground">Depth<select className="mt-1.5 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground" value={config.depth} onChange={(event) => update({ depth: event.target.value })}><option value="summary">Summary</option><option value="detail">Detail</option></select></label></div>
        <ToggleList label="Sections" choices={availableSections} selected={config.sections} onChange={(next) => update({ sections: next })} />
        <details className="rounded-md border border-border p-3"><summary className="cursor-pointer text-xs font-semibold text-foreground">Section order</summary><div className="mt-3"><ReorderList label="Section order" choices={availableSections} selected={config.sections} onChange={(next) => update({ sections: next })} /></div></details>
        <details className="rounded-md border border-border p-3"><summary className="cursor-pointer text-xs font-semibold text-foreground">Detail columns</summary><div className="mt-3 space-y-4"><ToggleList label="Detail columns" choices={availableColumns} selected={config.columns} onChange={(next) => update({ columns: next })} /><ReorderList label="Column order" choices={availableColumns} selected={config.columns} onChange={(next) => update({ columns: next })} /></div></details>
        <div className="grid gap-2 sm:grid-cols-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.includeExpected} onChange={(event) => update({ includeExpected: event.target.checked })} />Include expected amounts</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.includeCharts} onChange={(event) => update({ includeCharts: event.target.checked })} />Include charts</label></div>
        {config.depth === 'detail' ? <fieldset><legend className="mb-1.5 text-xs font-semibold text-muted-foreground">Detail STEMs</legend><select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={config.detailSelection} onChange={(event) => update({ detailSelection: event.target.value, selectedStemIds: event.target.value === 'all' ? [] : config.selectedStemIds })}><option value="all">All matching STEMs{Number.isFinite(options?.detailRowCount) ? ` (${options.detailRowCount.toLocaleString()} available)` : ''}</option><option value="selected">Selected STEMs only</option></select>{config.detailSelection === 'selected' ? <div className="mt-2 max-h-36 space-y-1 overflow-y-auto rounded-md border border-border p-2">{stemRows.map((stem) => <label key={stem.stemId} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={config.selectedStemIds.includes(stem.stemId)} onChange={() => update({ selectedStemIds: config.selectedStemIds.includes(stem.stemId) ? config.selectedStemIds.filter((id) => id !== stem.stemId) : [...config.selectedStemIds, stem.stemId] })} />{stem.stemName || stem.stemId}</label>)}{!stemRows.length ? <span className="text-xs text-muted-foreground">No loaded STEM rows. Choose all, or load STEM evidence first.</span> : null}</div> : null}</fieldset> : null}
        <div className="border-t border-border pt-4"><div className="mb-2 text-xs font-semibold text-muted-foreground">Presets</div><div className="flex flex-wrap gap-2">{[...(catalogue.presets || REPORT_PRESETS), ...presets].map((preset) => <div key={preset.id || preset.name} className="inline-flex overflow-hidden rounded-md border border-border"><button type="button" className="px-2.5 py-1.5 text-xs font-medium hover:bg-muted" onClick={() => applyPreset(preset)}>{preset.label || preset.name}</button>{preset.scope && preset.scope !== 'built_in' ? <button type="button" className="border-l border-border px-2 text-muted-foreground hover:bg-muted" onClick={() => archivePreset(preset)} aria-label={`Archive ${preset.name}`} disabled={saving}><Archive className="h-3.5 w-3.5" /></button> : null}</div>)}</div><div className="mt-3 flex gap-2"><input value={name} onChange={(event) => { setEditingPreset(null); setName(event.target.value); }} className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm" placeholder="Preset name" aria-label="Preset name" /><Button type="button" size="sm" variant="outline" onClick={() => savePreset(editingPreset?.scope || 'personal', editingPreset)} disabled={saving}><Save className="mr-1.5 h-3.5 w-3.5" />{editingPreset ? 'Update' : 'Personal'}</Button>{options?.capabilities?.manageCompanyPresets ? <Button type="button" size="sm" variant="outline" onClick={() => savePreset('company', editingPreset?.scope === 'company' ? editingPreset : null)} disabled={saving}>Company</Button> : null}</div></div>
      </div>
      <div className="sticky bottom-0 mt-6 flex justify-end gap-2 border-t border-border bg-background pt-4"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="button" onClick={build} disabled={building || !config.sections.length || !config.columns.length}>{building ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}Build PDF</Button></div>
    </DialogContent>
  </Dialog>;
}
