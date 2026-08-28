import { AlertTriangle, Bot, CheckCircle2, Loader2, RefreshCw, Save } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

function integer(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function usd(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return '$0.00';
  return amount < 0.01
    ? `$${amount.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 })}`
    : amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function dateTime(value) {
  if (!value) return 'Not used';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not used';
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

function StatusPill({ label, available }) {
  return (
    <Badge
      variant="outline"
      className={available
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : 'border-amber-200 bg-amber-50 text-amber-800'}
    >
      {available ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <AlertTriangle className="mr-1 h-3 w-3" />}
      {label}
    </Badge>
  );
}

export default function AiModelSettingsCard({
  title,
  description,
  icon: Icon = Bot,
  modelLabel = 'AI model',
  models = [],
  selectedModelId = '',
  savedModelId = '',
  usageByModel = {},
  periodLabel = '',
  loading = false,
  saving = false,
  error = '',
  message = '',
  canManage = false,
  apiConfigured = true,
  storageAvailable = true,
  onModelChange,
  onSave,
  onRefresh,
  updatedAt = null,
  privacyNote = '',
  permissionNote = '',
}) {
  const dirty = Boolean(selectedModelId && selectedModelId !== savedModelId);
  const selectedModel = models.find((model) => model.id === selectedModelId);
  const totals = Object.values(usageByModel).reduce((sum, row) => ({
    requests: sum.requests + Number(row?.requests || 0),
    cost: sum.cost + Number(row?.estimatedCostUsd || 0),
  }), { requests: 0, cost: 0 });

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 rounded-md bg-muted p-2 text-muted-foreground"><Icon className="h-4 w-4" /></div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            <p className="mt-0.5 max-w-3xl text-xs leading-5 text-muted-foreground">{description}</p>
          </div>
        </div>
        <Button type="button" variant="outline" size="icon" onClick={onRefresh} disabled={loading || saving} title={`Refresh ${title}`} aria-label={`Refresh ${title}`}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 border-b border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {message && !error && <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">{message}</div>}

      {loading && !models.length ? (
        <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading model settings...</div>
      ) : (
        <>
          <div className="grid gap-3 border-b border-border px-4 py-3 lg:grid-cols-[minmax(260px,1fr)_auto_auto_auto] lg:items-end">
            <div className="space-y-1.5">
              <Label className="text-xs">{modelLabel}</Label>
              <Select value={selectedModelId} onValueChange={onModelChange} disabled={!canManage || saving || !storageAvailable}>
                <SelectTrigger><SelectValue placeholder="Select a model" /></SelectTrigger>
                <SelectContent>
                  {models.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.label}{model.recommended ? ' · Recommended' : ''}{model.costTier ? ` · ${model.costTier}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="min-h-5 text-xs text-muted-foreground">{selectedModel?.description || 'Select the model used for this FCOS AI purpose.'}</p>
            </div>
            <div className="flex flex-wrap gap-2 lg:max-w-[240px]">
              <StatusPill label={apiConfigured ? 'API configured' : 'API unavailable'} available={apiConfigured} />
              <StatusPill label={storageAvailable ? 'Setting available' : 'Setting unavailable'} available={storageAvailable} />
            </div>
            <div className="min-w-[150px]">
              <p className="text-[11px] font-semibold uppercase text-muted-foreground">Recorded usage</p>
              <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">{usd(totals.cost)}</p>
              <p className="text-xs tabular-nums text-muted-foreground">{integer(totals.requests)} requests</p>
            </div>
            {canManage && (
              <Button type="button" onClick={onSave} disabled={!dirty || saving || !storageAvailable} className="gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? 'Saving' : 'Save model'}
              </Button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-semibold">Model</th>
                  <th className="px-3 py-2 text-right font-semibold">Requests</th>
                  <th className="px-3 py-2 text-right font-semibold">Input</th>
                  <th className="px-3 py-2 text-right font-semibold">Cached input</th>
                  <th className="px-3 py-2 text-right font-semibold">Output</th>
                  <th className="px-3 py-2 text-right font-semibold">Estimated USD</th>
                  <th className="px-4 py-2 font-semibold">Last used</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {models.map((model) => {
                  const usage = usageByModel[model.id] || {};
                  const selected = model.id === selectedModelId;
                  return (
                    <tr key={model.id} className={selected ? 'bg-primary/5' : 'bg-background'}>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{model.label}</span>
                          {selected && <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">Selected</Badge>}
                        </div>
                        {model.pricing && (
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            Per 1M: {usd(model.pricing.inputPerMillion)} input · {usd(model.pricing.cachedInputPerMillion)} cached · {usd(model.pricing.outputPerMillion)} output
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{integer(usage.requests)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{integer(usage.inputTokens)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{integer(usage.cachedInputTokens)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{integer(usage.outputTokens)}</td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="font-medium tabular-nums text-foreground">{usd(usage.estimatedCostUsd)}</div>
                        {periodLabel && <div className="text-[11px] tabular-nums text-muted-foreground">{periodLabel}: {usd(usage.periodCostUsd)}</div>}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{dateTime(usage.lastUsedAt)}</td>
                    </tr>
                  );
                })}
                {!models.length && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No models are available for this AI purpose.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-1 border-t border-border bg-muted/10 px-4 py-2.5 text-[11px] leading-5 text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>{privacyNote}</span>
            <span className="shrink-0">{canManage ? (updatedAt ? `Updated ${dateTime(updatedAt)}` : 'Changes use revision protection') : permissionNote}</span>
          </div>
        </>
      )}
    </section>
  );
}
