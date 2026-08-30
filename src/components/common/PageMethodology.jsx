import { useState } from 'react';
import { BookOpen, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export default function PageMethodology({
  title,
  description,
  sections = [],
  sources = [],
  className,
  triggerIcon: TriggerIcon = BookOpen,
  iconOnly = false,
  triggerLabel = 'Methodology',
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        aria-label={`Open ${triggerLabel.toLowerCase()}`}
        title={triggerLabel}
        className={cn(
          'h-[38px] gap-[7px] rounded-[7px] px-2.5 text-xs font-medium text-muted-foreground shadow-sm hover:text-foreground sm:px-3.5',
          className,
        )}
        onClick={() => setOpen(true)}
      >
        <TriggerIcon className="h-4 w-4" />
        {!iconOnly && <span className="hidden sm:inline">{triggerLabel}</span>}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{title} Methodology</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-5 text-sm text-foreground">
            {sections.map((section) => {
              const paragraphs = Array.isArray(section.body) ? section.body : [section.body];
              return (
                <section key={section.title}>
                  <h3 className="font-semibold">{section.title}</h3>
                  {paragraphs.filter(Boolean).map((paragraph) => (
                    <p key={paragraph} className="mt-1 leading-6 text-muted-foreground">{paragraph}</p>
                  ))}
                  {!!section.points?.length && (
                    <ul className="mt-2 space-y-1.5 pl-5 text-muted-foreground">
                      {section.points.map((point) => <li key={point} className="list-disc leading-6">{point}</li>)}
                    </ul>
                  )}
                </section>
              );
            })}
            {!!sources.length && (
              <section>
                <h3 className="font-semibold">Sources</h3>
                <div className="mt-2 flex flex-col items-start gap-2">
                  {sources.map((source) => (
                    <a
                      key={source.url}
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 text-primary hover:underline"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {source.label}
                    </a>
                  ))}
                </div>
              </section>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
