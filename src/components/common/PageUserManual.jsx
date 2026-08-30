import { useState } from 'react';
import { CheckCircle2, CircleHelp, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const EMPTY_ITEMS = Object.freeze([]);

export default function PageUserManual({
  title,
  description,
  startHere = EMPTY_ITEMS,
  tasks = EMPTY_ITEMS,
  reminders = EMPTY_ITEMS,
  className,
  iconOnly = false,
  triggerLabel = 'User Manual',
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
        <CircleHelp className="h-4 w-4" />
        {iconOnly ? null : <span className="hidden sm:inline">{triggerLabel}</span>}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{title} User Manual</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-5 text-sm text-foreground">
            {startHere.length ? (
              <section className="rounded-xl border border-blue-200 bg-blue-50/70 p-4">
                <h3 className="flex items-center gap-2 font-semibold text-blue-950">
                  <CheckCircle2 className="h-4 w-4" />
                  Start here
                </h3>
                <ol className="mt-2 space-y-1.5 pl-5 text-blue-950/80">
                  {startHere.map((step) => <li key={step} className="list-decimal leading-6">{step}</li>)}
                </ol>
              </section>
            ) : null}

            <section>
              <h3 className="font-semibold">Common tasks</h3>
              <p className="mt-1 text-sm text-muted-foreground">Open the task you want to complete and follow the steps in order.</p>
              <div className="mt-3 space-y-2">
                {tasks.map((task, index) => (
                  <details key={task.title} className="group rounded-xl border border-border bg-card open:shadow-sm">
                    <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{index + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-foreground">{task.title}</span>
                        {task.summary ? <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{task.summary}</span> : null}
                      </span>
                      <span aria-hidden="true" className="mt-0.5 text-muted-foreground transition-transform group-open:rotate-45">+</span>
                    </summary>
                    <div className="border-t border-border px-4 py-3 sm:pl-14">
                      <ol className="space-y-2 pl-5 text-muted-foreground">
                        {task.steps.map((step) => <li key={step} className="list-decimal leading-6">{step}</li>)}
                      </ol>
                      {task.note ? <p className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground"><span className="font-semibold text-foreground">Note:</span> {task.note}</p> : null}
                    </div>
                  </details>
                ))}
              </div>
            </section>

            {reminders.length ? (
              <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                <h3 className="flex items-center gap-2 font-semibold text-amber-950">
                  <Lightbulb className="h-4 w-4" />
                  Remember
                </h3>
                <ul className="mt-2 space-y-1.5 pl-5 text-amber-950/80">
                  {reminders.map((reminder) => <li key={reminder} className="list-disc leading-6">{reminder}</li>)}
                </ul>
              </section>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
