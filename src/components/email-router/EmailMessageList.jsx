import { Archive, ChevronLeft, ChevronRight, FileText, Inbox, Loader2, Newspaper, Paperclip, Send, ShieldAlert, Star, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatEmailDate } from '@/lib/emailRouter';

const EMPTY_COPY = {
  inbox: { icon: Inbox, title: 'Inbox is clear', description: 'No messages match this mailbox and search.' },
  sent: { icon: Send, title: 'No sent messages', description: 'No messages match this mailbox and search.' },
  archive: { icon: Archive, title: 'Archive is empty', description: 'No archived messages match this search.' },
  market_report: { icon: Newspaper, title: 'Market Report is empty', description: 'No market report messages match this search.' },
  trash: { icon: Trash2, title: 'Trash is empty', description: 'No deleted messages match this search.' },
  junk: { icon: ShieldAlert, title: 'Junk is empty', description: 'No junk messages match this search.' },
};

export default function EmailMessageList({
  messages, selectedId, loading, loadingMore, error, folder, hasPrevious, hasNext, onSelect, onPrevious, onNext,
}) {
  const empty = EMPTY_COPY[folder] || EMPTY_COPY.inbox;
  const EmptyIcon = empty.icon;
  if (loading && !messages.length) {
    return <div className="flex min-h-72 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading messages</div>;
  }
  if (error && !messages.length) {
    return <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center"><FileText className="h-8 w-8 text-muted-foreground" /><p className="mt-3 text-sm font-medium">Mail router is unavailable</p><p className="mt-1 max-w-sm text-sm text-muted-foreground">{error}</p></div>;
  }
  if (!messages.length) {
    return <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center"><EmptyIcon className="h-8 w-8 text-muted-foreground" /><p className="mt-3 text-sm font-medium">{empty.title}</p><p className="mt-1 text-sm text-muted-foreground">{empty.description}</p></div>;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
        {messages.map((message) => (
          <button
            type="button"
            key={message.id}
            onClick={() => onSelect(message.id)}
            className={cn(
              'grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-4 py-3 text-left transition-colors hover:bg-muted/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              selectedId === message.id && 'bg-primary/8',
              !message.isRead && 'bg-muted/30',
            )}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2"><span className={cn('truncate text-sm', !message.isRead && 'font-semibold')}>{message.from.name || message.from.email || 'Unknown sender'}</span>{message.isFlagged && <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />}</div>
              <p className={cn('mt-0.5 truncate text-sm text-foreground', !message.isRead && 'font-medium')}>{message.subject}</p>
              <p className="mt-1 truncate text-xs text-muted-foreground">{message.preview || 'No preview available'}</p>
            </div>
            <div className="flex flex-col items-end gap-2 text-xs text-muted-foreground"><time>{formatEmailDate(message.sentAt)}</time>{message.hasAttachments && <Paperclip className="h-3.5 w-3.5" />}</div>
          </button>
        ))}
      </div>
      <div className="flex h-10 shrink-0 items-center justify-end border-t border-border px-3">
        <div className="flex items-center gap-1">
          {loadingMore && <Loader2 className="mr-1 h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading more messages" />}
          <Button variant="ghost" size="icon" onClick={onPrevious} disabled={!hasPrevious || loadingMore} aria-label="Previous messages" title="Previous messages"><ChevronLeft /></Button>
          <Button variant="ghost" size="icon" onClick={onNext} disabled={!hasNext || loadingMore} aria-label="Next messages" title="Next messages"><ChevronRight /></Button>
        </div>
      </div>
    </div>
  );
}
