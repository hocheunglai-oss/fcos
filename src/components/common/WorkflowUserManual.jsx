import { BookOpen, CheckCircle2, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

const TONE = Object.freeze({
  read: 'border-sky-200 bg-sky-50 text-sky-800',
  save: 'border-amber-200 bg-amber-50 text-amber-900',
  external: 'border-rose-200 bg-rose-50 text-rose-800',
  navigation: 'border-slate-200 bg-slate-50 text-slate-700',
});

const EFFECT = Object.freeze({
  read: 'Read only',
  save: 'Saves data',
  external: 'External write',
  navigation: 'Navigation',
});

export default function WorkflowUserManual({ manual, compact = false }) {
  if (!manual) return null;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size={compact ? 'icon' : 'default'} className={compact ? '' : 'gap-2'} aria-label={`${manual.title} user manual`} title={`${manual.title} user manual`}>
          <BookOpen className="h-4 w-4" />{compact ? null : 'User Manual'}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><BookOpen className="h-5 w-5 text-blue-700" />{manual.title} User Manual</DialogTitle>
          <DialogDescription>{manual.introduction}</DialogDescription>
        </DialogHeader>

        <section className="rounded-xl border border-border bg-muted/20 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4 text-emerald-700" />Before you start</h3>
          <ul className="mt-3 grid gap-2 text-sm leading-5 sm:grid-cols-2">
            {manual.beforeYouStart.map((item) => <li key={item} className="rounded-lg border border-border bg-background px-3 py-2">{item}</li>)}
          </ul>
        </section>

        <section>
          <h3 className="text-sm font-semibold">Recommended workflow</h3>
          <ol className="mt-3 grid gap-3 md:grid-cols-2">
            {manual.workflow.map((item, index) => (
              <li key={item.title} className="rounded-xl border border-border p-3">
                <div className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">{index + 1}</span><span className="text-sm font-semibold">{item.title}</span></div>
                <p className="mt-2 text-sm leading-5 text-muted-foreground">{item.description}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Detailed guide</h3>
          {manual.sections.map((section) => (
            <details key={section.title} className="rounded-xl border border-border bg-card" open={section.open === true}>
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{section.title}</summary>
              <div className="space-y-4 border-t border-border p-4">
                <p className="text-sm leading-6 text-muted-foreground">{section.purpose}</p>
                <ol className="space-y-2 pl-5 text-sm leading-6">
                  {section.steps.map((step) => <li key={step} className="list-decimal pl-1">{step}</li>)}
                </ol>
                {section.controls?.length ? (
                  <div className="grid gap-3 lg:grid-cols-2">
                    {section.controls.map((control) => (
                      <article key={`${section.title}:${control.label}`} className="rounded-lg border border-border bg-background p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold">{control.label}</h4><Badge variant="outline" className={TONE[control.effect] || TONE.navigation}>{EFFECT[control.effect] || EFFECT.navigation}</Badge></div>
                        <p className="mt-2 text-sm leading-5 text-muted-foreground">{control.description}</p>
                      </article>
                    ))}
                  </div>
                ) : null}
              </div>
            </details>
          ))}
        </section>

        <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><CheckCircle2 className="h-4 w-4" />Finished when</h3>
          <p className="mt-2 text-sm leading-5">{manual.finishedWhen}</p>
        </section>
      </DialogContent>
    </Dialog>
  );
}
