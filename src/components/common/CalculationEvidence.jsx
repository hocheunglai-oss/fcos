import { Calculator, CheckCircle2, CircleHelp, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

const CLASSIFICATION = {
  actual: { label: 'Actual', className: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200' },
  expected: { label: 'Expected', className: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-200' },
  forecast: { label: 'Forecast', className: 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-200' },
  calculated: { label: 'Calculated', className: 'border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-200' },
  incomplete: { label: 'Incomplete', className: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100' },
  unavailable: { label: 'Unavailable', className: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200' },
};

function dateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function EvidenceList({ label, values = [] }) {
  const rows = values.filter(Boolean);
  if (!rows.length) return null;
  return <section><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h3><ul className="mt-2 space-y-2 text-sm">{rows.map((value, index) => <li key={`${index}:${value}`} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/70" /><span>{value}</span></li>)}</ul></section>;
}

export default function CalculationEvidence({
  title,
  value,
  classification = 'calculated',
  formula,
  sources = [],
  exclusions = [],
  warnings = [],
  asOf,
  complete = true,
  triggerLabel = 'How calculated',
  className,
}) {
  const definition = CLASSIFICATION[complete ? classification : 'incomplete'] || CLASSIFICATION.calculated;
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className={cn('h-6 w-6 shrink-0 rounded-full text-muted-foreground hover:text-foreground', className)} aria-label={`${triggerLabel}: ${title}`} title={triggerLabel}>
          <CircleHelp className="h-3.5 w-3.5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[min(92vw,30rem)] overflow-y-auto sm:max-w-[30rem]">
        <SheetHeader>
          <div className="flex items-center gap-2"><Calculator className="h-4 w-4 text-muted-foreground" /><Badge variant="outline" className={definition.className}>{definition.label}</Badge></div>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>Calculation, authority and evidence used for this displayed figure.</SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-6">
          {value != null ? <section className="rounded-lg border border-border bg-muted/25 p-4"><div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Displayed value</div><div className="mt-1 text-xl font-semibold tabular-nums text-foreground">{value}</div></section> : null}
          {formula ? <section><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Formula</h3><div className="mt-2 rounded-lg border border-border bg-card p-3 text-sm leading-6">{formula}</div></section> : null}
          <EvidenceList label="Source evidence" values={sources} />
          <EvidenceList label="Excluded or not combined" values={exclusions} />
          {warnings.length ? <section className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100"><div className="flex items-center gap-2 font-semibold"><TriangleAlert className="h-4 w-4" />Data notes</div><ul className="mt-2 space-y-1.5">{warnings.map((warning, index) => <li key={`${index}:${warning}`}>{warning}</li>)}</ul></section> : <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" />No calculation warning is recorded.</div>}
          {asOf ? <div className="border-t border-border pt-4 text-xs text-muted-foreground">Evidence current at {dateTime(asOf)} Hong Kong time.</div> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export { CLASSIFICATION as CALCULATION_EVIDENCE_CLASSIFICATIONS };
