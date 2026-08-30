import { useState } from 'react';
import { AlertTriangle, BookOpen, CheckCircle2, Languages, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { XERO_PORTAL_MANUAL_LANGUAGES, XERO_PORTAL_MANUALS } from '@/lib/xeroPortalManual';
import { cn } from '@/lib/utils';

const UI_COPY = Object.freeze({
  en: {
    contents: 'Contents',
    steps: 'Step-by-step workflow',
    controls: 'Buttons and controls',
    control: 'Button / control',
    does: 'What it does',
    available: 'When it is available',
    effect: 'Data effect',
    noButtons: 'This section explains the status and recovery rules used throughout the portal.',
  },
  'zh-Hant': {
    contents: '目錄',
    steps: '逐步工作流程',
    controls: '按鈕及控制項',
    control: '按鈕／控制項',
    does: '功能',
    available: '可用條件',
    effect: '資料影響',
    noButtons: '本節說明整個 Portal 共用的狀態及復原規則。',
  },
});

const EFFECT_STYLES = Object.freeze({
  read: 'border-sky-200 bg-sky-50 text-sky-800',
  fcos: 'border-amber-200 bg-amber-50 text-amber-900',
  xero: 'border-rose-200 bg-rose-50 text-rose-800',
  navigation: 'border-slate-200 bg-slate-50 text-slate-700',
});

export default function XeroPortalManual() {
  const [language, setLanguage] = useState('en');
  const manual = XERO_PORTAL_MANUALS[language];
  const copy = UI_COPY[language];
  const controlCount = manual.sections.reduce((sum, section) => sum + section.controls.length, 0);

  function openSection(sectionId) {
    document.getElementById(`xero-manual-${sectionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <section aria-labelledby="xero-manual-title" className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <BookOpen className="h-5 w-5 text-blue-700" />
              <h2 id="xero-manual-title" className="text-xl font-semibold">{manual.title}</h2>
              <Badge variant="outline">{controlCount} {language === 'en' ? 'controls explained' : '個控制項說明'}</Badge>
            </div>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-muted-foreground">{manual.subtitle}</p>
          </div>
          <div aria-label="Manual language" className="inline-flex w-fit rounded-lg border border-border bg-muted/30 p-1">
            <Languages className="mx-2 my-auto h-4 w-4 text-muted-foreground" />
            {XERO_PORTAL_MANUAL_LANGUAGES.map((option) => (
              <Button
                key={option.id}
                type="button"
                size="sm"
                variant={language === option.id ? 'default' : 'ghost'}
                className="h-8"
                aria-pressed={language === option.id}
                onClick={() => setLanguage(option.id)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950">
          <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />{manual.importantTitle}</div>
          <ul className="mt-2 space-y-1.5 pl-5 text-sm leading-6">
            {manual.important.map((item) => <li key={item} className="list-disc">{item}</li>)}
          </ul>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="h-fit rounded-xl border border-border bg-card p-3 xl:sticky xl:top-3">
          <div className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{copy.contents}</div>
          <nav aria-label={copy.contents} className="space-y-1">
            {manual.sections.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => openSection(section.id)}
                className="w-full rounded-md px-2 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {section.title}
              </button>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 space-y-4">
          <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
            <div className="flex items-center gap-2 text-base font-semibold"><ShieldCheck className="h-5 w-5 text-emerald-700" />{manual.workflowTitle}</div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {manual.workflow.map(([number, title, description]) => (
                <article key={number} className="rounded-lg border border-border bg-background p-3">
                  <div className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">{number}</span><h3 className="text-sm font-semibold">{title}</h3></div>
                  <p className="mt-2 text-sm leading-5 text-muted-foreground">{description}</p>
                </article>
              ))}
            </div>
          </section>

          {manual.sections.map((section) => (
            <article key={section.id} id={`xero-manual-${section.id}`} className="scroll-mt-4 rounded-xl border border-border bg-card p-4 sm:p-5">
              <h3 className="text-base font-semibold">{section.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{section.purpose}</p>

              <div className="mt-4">
                <h4 className="flex items-center gap-2 text-sm font-semibold"><CheckCircle2 className="h-4 w-4 text-emerald-700" />{copy.steps}</h4>
                <ol className="mt-2 space-y-2 pl-5 text-sm leading-6">
                  {section.steps.map((step) => <li key={step} className="list-decimal pl-1">{step}</li>)}
                </ol>
              </div>

              <div className="mt-5">
                <h4 className="text-sm font-semibold">{copy.controls}</h4>
                {section.controls.length ? (
                  <div className="mt-2 overflow-x-auto rounded-lg border border-border">
                    <table className="w-full min-w-[880px] text-left text-sm">
                      <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                        <tr>
                          <th className="w-[190px] px-3 py-2.5 font-semibold">{copy.control}</th>
                          <th className="px-3 py-2.5 font-semibold">{copy.does}</th>
                          <th className="w-[260px] px-3 py-2.5 font-semibold">{copy.available}</th>
                          <th className="w-[125px] px-3 py-2.5 font-semibold">{copy.effect}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {section.controls.map(([label, description, availability, effect]) => (
                          <tr key={`${section.id}:${label}`} className="align-top">
                            <td className="px-3 py-3 font-semibold text-foreground">{label}</td>
                            <td className="px-3 py-3 leading-5 text-foreground">{description}</td>
                            <td className="px-3 py-3 leading-5 text-muted-foreground">{availability}</td>
                            <td className="px-3 py-3"><Badge variant="outline" className={cn('whitespace-nowrap', EFFECT_STYLES[effect])}>{manual.effectLabels[effect]}</Badge></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="mt-2 rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">{copy.noButtons}</p>}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
