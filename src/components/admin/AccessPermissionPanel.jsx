import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

const RELATED_ACTIONS = {
  disputes: ['disputes_approve', 'disputes_account'],
  buyer_invoices: ['buyer_invoices_manage'],
  cashflow_forecast: ['cashflow_forecast_manage', 'cashflow_bank_reconcile'],
  hedge_desk: ['hedge_book_manage', 'hedge_settlement_manage', 'hedge_close_approve', 'hedge_admin'],
  special_terms: ['special_terms_manage', 'special_terms_clause_approve'],
  brokers: ['broker_settings_manage'],
  xero_portal: ['xero_portal_manage'],
  settings: ['financial_report_settings_manage'],
};

export function permissionEnabled(id, value) {
  return id === 'report_archive' ? value === 'full' || value === 'read' || value === true : value === true;
}

export function accessRows(modules, capabilities) {
  const used = new Set();
  const sections = modules.map((module) => {
    const actions = capabilities.filter((action) => RELATED_ACTIONS[module.id]?.includes(action.id));
    actions.forEach((action) => used.add(action.id));
    return { id: module.id, label: module.label, rows: [{ ...module, kind: 'permissions' }, ...actions.map((action) => ({ ...action, kind: 'capabilities' }))] };
  });
  const other = capabilities.filter((action) => !used.has(action.id));
  if (other.length) sections.push({ id: 'other_actions', label: 'Other actions', rows: other.map((action) => ({ ...action, kind: 'capabilities' })) });
  return sections;
}

export function accessChanges(before, after, modules, capabilities) {
  return accessRows(modules, capabilities).flatMap((section) => section.rows).filter((row) => {
    const previous = before?.[row.kind]?.[row.id];
    const next = after?.[row.kind]?.[row.id];
    return row.id === 'report_archive'
      ? (previous === true ? 'full' : previous || 'none') !== (next === true ? 'full' : next || 'none')
      : (previous === true) !== (next === true);
  }).map((row) => ({ ...row, previous: before?.[row.kind]?.[row.id], next: after?.[row.kind]?.[row.id] }));
}

export function accessValueLabel(id, value) {
  if (id === 'report_archive') return value === 'full' || value === true ? 'Full access' : value === 'read' ? 'Read only' : 'No access';
  return value === true ? 'Allowed' : 'No access';
}

export default function AccessPermissionPanel({ modules, capabilities, value, onChange, locked = false, query, onQuery, enabledOnly, onEnabledOnly, readOnly = false, sources = {} }) {
  const search = query.trim().toLowerCase();
  const sections = accessRows(modules, capabilities).map((section) => ({ ...section, rows: section.rows.filter((row) =>
    (!enabledOnly || permissionEnabled(row.id, value?.[row.kind]?.[row.id]))
    && (!search || `${section.label} ${row.label} ${row.description || ''}`.toLowerCase().includes(search))) })).filter((section) => section.rows.length);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-border p-3">
        <div className="relative min-w-0 flex-1"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label={readOnly ? 'Search effective access' : 'Search permissions'} className="h-9 pl-8" placeholder="Find a page or action…" value={query} onChange={(event) => onQuery(event.target.value)} /></div>
        <label className="flex shrink-0 items-center gap-2 text-xs"><input type="checkbox" checked={enabledOnly} onChange={(event) => onEnabledOnly(event.target.checked)} /> Enabled only</label>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3">
        {!sections.length && <p className="p-4 text-sm text-muted-foreground">No matching permissions.</p>}
        {sections.map((section) => <section key={section.id} className="overflow-hidden rounded-lg border border-border">
          <h3 className="bg-muted/30 px-3 py-1.5 text-xs font-semibold">{section.label}</h3>
          {section.rows.map((row) => {
            const current = value?.[row.kind]?.[row.id];
            const enabled = permissionEnabled(row.id, current);
            const grantingGroups = sources[row.id] || [];
            return <div key={`${row.kind}:${row.id}`} className="flex min-w-0 items-center justify-between gap-4 border-t border-border px-3 py-2">
              <div className="min-w-0"><div className="text-sm font-medium">{row.label} {row.kind === 'permissions' && <span className="text-[10px] font-normal text-muted-foreground">· Page access</span>}</div>
                {row.description && <p className="text-xs text-muted-foreground">{row.description}</p>}
                {row.id === 'admin' && <p className="text-xs text-muted-foreground">Management actions also require an Administrator or General Manager organizational role.</p>}
                {readOnly && <p className="mt-0.5 text-xs text-muted-foreground">{enabled ? `Granted by ${grantingGroups.map((group) => group.label).join(', ') || 'no group'}` : 'No group grants this permission'}</p>}
              </div>
              {readOnly ? <span className={`shrink-0 text-xs font-medium ${enabled ? 'text-emerald-700' : 'text-muted-foreground'}`}>{accessValueLabel(row.id, current)}</span>
                : row.id === 'report_archive' ? <select aria-label={`${row.label} access`} value={current === true ? 'full' : current || 'none'} disabled={locked} onChange={(event) => onChange(row.kind, row.id, event.target.value)} className="h-8 shrink-0 rounded-md border border-input bg-background px-2 text-xs"><option value="none">No access</option><option value="read">Read only</option><option value="full">Full access</option></select>
                  : <Switch aria-label={`${row.label} permission`} checked={enabled} disabled={locked} onCheckedChange={(checked) => onChange(row.kind, row.id, checked)} />}
            </div>;
          })}
        </section>)}
      </div>
    </div>
  );
}
