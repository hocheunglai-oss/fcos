import { useState } from 'react';
import { AlertTriangle, BookOpen, CheckCircle2, Languages, ShieldCheck } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { XERO_PORTAL_MANUAL_LANGUAGES, XERO_PORTAL_MANUALS } from '@/lib/xeroPortalManual';
import { normalizeXeroPortalLanguage } from '@/lib/xeroPortalUiCopy';
import { cn } from '@/lib/utils';

const UI_COPY = Object.freeze({
  en: {
    steps: 'Follow these steps',
    details: 'Button-by-button reference',
    detailsHint: 'Open this only when you need the exact availability or data effect of a control.',
    does: 'What it does',
    available: 'When available',
    noButtons: 'This section explains status and recovery rules. There are no controls to operate here.',
    language: 'Xero Portal language',
  },
  'zh-Hant': {
    steps: '依照以下步驟',
    details: '按鈕逐項參考',
    detailsHint: '只有需要查閱控制項的可用條件或資料影響時才展開。',
    does: '功能',
    available: '可用條件',
    noButtons: '本節說明狀態及復原規則，沒有需要操作的控制項。',
    language: 'Xero Portal 語言',
  },
});

const EFFECT_STYLES = Object.freeze({
  read: 'border-sky-200 bg-sky-50 text-sky-800',
  fcos: 'border-amber-200 bg-amber-50 text-amber-900',
  xero: 'border-rose-200 bg-rose-50 text-rose-800',
  navigation: 'border-slate-200 bg-slate-50 text-slate-700',
});

export default function XeroPortalManual({ language: controlledLanguage, onLanguageChange }) {
  const [localLanguage, setLocalLanguage] = useState('en');
  const language = normalizeXeroPortalLanguage(controlledLanguage ?? localLanguage);
  const [openSection, setOpenSection] = useState('');
  const manual = XERO_PORTAL_MANUALS[language];
  const copy = UI_COPY[language];

  function changeLanguage(nextLanguage) {
    const normalized = normalizeXeroPortalLanguage(nextLanguage);
    if (onLanguageChange) onLanguageChange(normalized);
    else setLocalLanguage(normalized);
  }

  function chooseTask(sectionId) {
    setOpenSection(sectionId);
    requestAnimationFrame(() => {
      document.getElementById(`xero-manual-${sectionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  return (
    <section aria-labelledby="xero-manual-title" className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-blue-700" />
              <h2 id="xero-manual-title" className="text-xl font-semibold">{manual.title}</h2>
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{manual.subtitle}</p>
          </div>
          <div aria-label={copy.language} className="inline-flex w-fit rounded-lg border border-border bg-muted/30 p-1">
            <Languages className="mx-2 my-auto h-4 w-4 text-muted-foreground" />
            {XERO_PORTAL_MANUAL_LANGUAGES.map((option) => (
              <Button
                key={option.id}
                type="button"
                size="sm"
                variant={language === option.id ? 'default' : 'ghost'}
                className="h-8"
                aria-pressed={language === option.id}
                onClick={() => changeLanguage(option.id)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>

        <h3 className="mt-4 text-sm font-semibold">{manual.importantTitle}</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {manual.important.map((item, index) => (
            <div key={item} className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm leading-5 text-amber-950">
              {index === 0 ? <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>

      <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <h3 className="text-base font-semibold">{manual.taskTitle}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{manual.taskHint}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {manual.tasks.map(([sectionId, title, description]) => (
            <button
              key={sectionId}
              type="button"
              onClick={() => chooseTask(sectionId)}
              className="rounded-xl border border-border bg-background p-4 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="text-sm font-semibold text-foreground">{title}</span>
              <span className="mt-1.5 block text-sm leading-5 text-muted-foreground">{description}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="flex items-center gap-2 text-base font-semibold">
          <ShieldCheck className="h-5 w-5 text-emerald-700" />
          {manual.workflowTitle}
        </div>
        <ol className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {manual.workflow.map(([number, title, description]) => (
            <li key={number} className="rounded-lg border border-border bg-background p-3">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">{number}</span>
                <h3 className="text-sm font-semibold">{title}</h3>
              </div>
              <p className="mt-2 text-sm leading-5 text-muted-foreground">{description}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-xl border border-border bg-card px-4 sm:px-5">
        <Accordion type="single" collapsible value={openSection} onValueChange={setOpenSection}>
          {manual.sections.map((section) => (
            <AccordionItem key={section.id} id={`xero-manual-${section.id}`} value={section.id} className="scroll-mt-4 last:border-b-0">
              <AccordionTrigger className="py-4 text-base font-semibold hover:no-underline">{section.title}</AccordionTrigger>
              <AccordionContent>
                <p className="max-w-4xl text-sm leading-6 text-muted-foreground">{section.purpose}</p>
                <div className="mt-4 rounded-lg border border-border bg-background p-4">
                  <h4 className="flex items-center gap-2 text-sm font-semibold">
                    <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                    {copy.steps}
                  </h4>
                  <ol className="mt-2 space-y-2 pl-5 text-sm leading-6">
                    {section.steps.map((step) => <li key={step} className="list-decimal pl-1">{step}</li>)}
                  </ol>
                </div>
                {section.controls.length ? (
                  <details className="mt-4 rounded-lg border border-border bg-muted/10">
                    <summary className="cursor-pointer px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {copy.details}
                      <span className="ml-2 font-normal text-muted-foreground">— {copy.detailsHint}</span>
                    </summary>
                    <div className="grid gap-3 border-t border-border p-3 lg:grid-cols-2">
                      {section.controls.map(([label, description, availability, effect]) => (
                        <article key={`${section.id}:${label}`} className="rounded-lg border border-border bg-background p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h5 className="text-sm font-semibold text-foreground">{label}</h5>
                            <Badge variant="outline" className={cn('whitespace-nowrap', EFFECT_STYLES[effect])}>{manual.effectLabels[effect]}</Badge>
                          </div>
                          <dl className="mt-3 space-y-2 text-sm leading-5">
                            <div><dt className="text-xs font-semibold text-muted-foreground">{copy.does}</dt><dd className="mt-0.5 text-foreground">{description}</dd></div>
                            <div><dt className="text-xs font-semibold text-muted-foreground">{copy.available}</dt><dd className="mt-0.5 text-muted-foreground">{availability}</dd></div>
                          </dl>
                        </article>
                      ))}
                    </div>
                  </details>
                ) : (
                  <p className="mt-4 rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">{copy.noButtons}</p>
                )}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>
    </section>
  );
}
