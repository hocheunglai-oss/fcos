import { cn } from '@/lib/utils';

export default function StemDetailLink({ stemId, onOpen, children, className }) {
  if (!stemId || typeof onOpen !== 'function') {
    return <span className={className} data-technical-identifier>{children || '—'}</span>;
  }

  const accessibleStemName = typeof children === 'string' && children.trim() ? children.trim() : 'STEM';

  return (
    <button
      type="button"
      data-technical-identifier
      className={cn(
        'text-left font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
      aria-label={`Open STEM details for ${accessibleStemName}`}
      title="Open STEM details"
      onClick={(event) => {
        event.stopPropagation();
        onOpen(stemId);
      }}
    >
      {children}
    </button>
  );
}
