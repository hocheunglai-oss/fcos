import { useState } from 'react';
import { CircleHelp } from 'lucide-react';
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
  size,
  className,
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={size}
        className={cn('gap-2', className)}
        onClick={() => setOpen(true)}
      >
        <CircleHelp className="h-4 w-4" />
        Methodology
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
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
