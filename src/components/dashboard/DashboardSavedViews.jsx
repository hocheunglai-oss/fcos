import { useMemo, useState } from 'react';
import { Bookmark, BookmarkPlus, Trash2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DASHBOARD_SAVED_VIEWS_STORAGE_KEY, dashboardFilterKey, normalizeDashboardSavedViews } from '@/lib/dashboardFilters';

function readViews() {
  try { return normalizeDashboardSavedViews(JSON.parse(localStorage.getItem(DASHBOARD_SAVED_VIEWS_STORAGE_KEY) || '[]')); }
  catch { return []; }
}

export default function DashboardSavedViews({ filters, onApply, compact = false }) {
  const [views, setViews] = useState(readViews);
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const activeId = useMemo(() => views.find((view) => dashboardFilterKey(view.filters) === dashboardFilterKey(filters))?.id || '', [filters, views]);
  const persist = (next) => { setViews(next); localStorage.setItem(DASHBOARD_SAVED_VIEWS_STORAGE_KEY, JSON.stringify(next)); };
  const save = (event) => {
    event.preventDefault();
    const clean = name.trim();
    if (!clean) { setError('Enter a view name.'); return; }
    if (views.some((view) => view.name.toLowerCase() === clean.toLowerCase())) { setError('That view name is already used.'); return; }
    if (views.length >= 10) { setError('Delete a saved view before adding another.'); return; }
    const id = globalThis.crypto?.randomUUID?.() || `view-${Date.now()}`;
    persist([...views, { id, name: clean.slice(0, 60), filters, createdAt: new Date().toISOString() }]);
    setName(''); setAdding(false); setError('');
  };
  const remove = () => {
    if (!activeId) return;
    persist(views.filter((view) => view.id !== activeId));
  };
  const controls = <section aria-label="Saved Dashboard views" className={compact ? 'flex min-w-0 flex-wrap items-center gap-2' : 'workspace-inline-toolbar app-navigation-material mb-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-border px-3 py-2'}>
    <span className="text-xs font-semibold text-muted-foreground">Saved views</span>
    <select value={activeId} onChange={(event) => { const view = views.find((item) => item.id === event.target.value); if (view) onApply(view.filters); }} className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs" aria-label="Apply saved Dashboard view">
      <option value="">Current filters</option>{views.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}
    </select>
    {adding ? <form onSubmit={save} className="flex flex-wrap items-center gap-2"><Input autoFocus value={name} onChange={(event) => setName(event.target.value)} className="h-8 w-48" maxLength={60} placeholder="View name" aria-label="Saved view name" /><Button type="submit" size="sm">Save</Button><Button type="button" size="sm" variant="ghost" onClick={() => { setAdding(false); setError(''); }}>Cancel</Button></form> : <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}><BookmarkPlus className="mr-1.5 h-3.5 w-3.5" />Save current</Button>}
    {activeId ? <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={remove}><Trash2 className="mr-1.5 h-3.5 w-3.5" />Delete view</Button> : null}
    {error ? <span role="alert" className="w-full text-xs text-destructive">{error}</span> : null}
  </section>;
  if (!compact) return controls;
  return <Popover><PopoverTrigger asChild><Button type="button" size="sm" variant="outline" className="h-9 min-w-0 max-w-48 text-xs" aria-label="Saved Dashboard views"><Bookmark className="mr-1.5 h-3.5 w-3.5 shrink-0" /><span className="truncate">{views.find((view) => view.id === activeId)?.name || 'Saved views'}</span></Button></PopoverTrigger><PopoverContent align="end" className="w-[min(92vw,22rem)] p-3">{controls}</PopoverContent></Popover>;
}
