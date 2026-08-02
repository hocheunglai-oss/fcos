import { useEffect, useMemo, useState } from 'react';
import { Archive, ArrowRight, Download, Eye, File, Forward, Loader2, Mail, Paperclip, Reply, RotateCcw, Sparkles, Trash2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatAddresses, formatEmailDate, plainTextToHtml, sanitizeEmailHtml } from '@/lib/emailRouter';

function statusTone(status) {
  if (status === 'confirmed') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (status === 'uncertain') return 'border-amber-200 bg-amber-50 text-amber-900';
  if (['draft_created', 'submitted'].includes(status)) return 'border-blue-200 bg-blue-50 text-blue-900';
  return 'border-red-200 bg-red-50 text-red-800';
}

function actionStatusLabel(status) {
  return status === 'confirmed' ? 'Confirmed' : status === 'uncertain' ? 'Uncertain' : status === 'draft_created' ? 'Draft created' : status === 'submitted' ? 'Submitted' : 'Failed';
}

function attachmentName(attachment) {
  return attachment.name || attachment.fileName || attachment.filename || 'Attachment';
}

function attachmentContentType(attachment) {
  return String(attachment.contentType || attachment.content_type || '').toLowerCase();
}

function canPreviewAttachment(attachment) {
  const type = attachmentContentType(attachment);
  return type.startsWith('image/') || type === 'application/pdf' || type.startsWith('text/') || type === 'application/json' || type === 'application/xml';
}

function replaceInlineSources(value, sources) {
  let result = String(value || '');
  for (const [contentId, source] of Object.entries(sources)) {
    const escaped = contentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`cid:${escaped}`, 'gi'), source);
  }
  return result;
}

export function EmailMessageDetail({ message, loading, error, actionResult, advisor, advisorLoading, advisorError, onAdvisor, onAction, onFetchAttachment, onDownloadAttachment }) {
  const [downloadingId, setDownloadingId] = useState(null);
  const [inlineSources, setInlineSources] = useState({});
  const [preview, setPreview] = useState(null);
  const content = useMemo(() => sanitizeEmailHtml(replaceInlineSources(message?.bodyHtml || plainTextToHtml(message?.bodyText || message?.preview || 'No message content available.'), inlineSources)), [inlineSources, message?.bodyHtml, message?.bodyText, message?.preview]);
  const history = message?.actionHistory || [];

  useEffect(() => {
    let active = true;
    const urls = [];
    setInlineSources({});
    const inline = (message?.attachments || []).filter((attachment) => attachment.isInline && attachment.contentId && attachmentContentType(attachment).startsWith('image/'));
    Promise.all(inline.map(async (attachment) => {
      const downloaded = await onFetchAttachment(attachment);
      if (!downloaded || !active) return null;
      const url = URL.createObjectURL(downloaded.blob);
      urls.push(url);
      return [String(attachment.contentId).replace(/^<|>$/g, ''), url];
    })).then((entries) => {
      if (active) setInlineSources(Object.fromEntries(entries.filter(Boolean)));
    });
    return () => {
      active = false;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [message?.id, onFetchAttachment]);

  const download = async (attachment) => {
    const id = attachment.id || attachment.attachmentId || attachmentName(attachment);
    setDownloadingId(id);
    await onDownloadAttachment(attachment);
    setDownloadingId(null);
  };
  const openPreview = async (attachment) => {
    const id = attachment.id || attachment.attachmentId || attachmentName(attachment);
    setDownloadingId(id);
    const downloaded = await onFetchAttachment(attachment);
    setDownloadingId(null);
    if (!downloaded) return;
    const type = downloaded.contentType || attachmentContentType(attachment);
    if (type.startsWith('text/') || type === 'application/json' || type === 'application/xml') {
      setPreview({ name: attachmentName(attachment), type: 'text', content: await downloaded.blob.text() });
      return;
    }
    setPreview({ name: attachmentName(attachment), type: type.startsWith('image/') ? 'image' : 'pdf', url: URL.createObjectURL(downloaded.blob) });
  };
  const closePreview = () => {
    if (preview?.url) URL.revokeObjectURL(preview.url);
    setPreview(null);
  };

  if (loading && !message) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading message</div>;
  if (!message) return <div className="flex h-full flex-col items-center justify-center px-6 text-center"><Mail className="h-8 w-8 text-muted-foreground" /><p className="mt-3 text-sm font-medium">Select a message</p><p className="mt-1 text-sm text-muted-foreground">Review message detail and available actions.</p></div>;

  return <TooltipProvider delayDuration={250}>
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border px-5 py-5 sm:px-6">
        <h2 className="break-words text-xl font-semibold leading-7">{message.subject}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{formatEmailDate(message.sentAt)}</p>
      </header>
      <div className="border-b border-border px-5 py-4 text-sm sm:px-6">
        <div className="flex gap-3"><span className="w-12 shrink-0 text-muted-foreground">From</span><span className="min-w-0 break-words">{formatAddresses(message.from) || 'Unknown sender'}</span></div>
        <div className="mt-2 flex gap-3"><span className="w-12 shrink-0 text-muted-foreground">To</span><span className="min-w-0 break-words">{formatAddresses(message.to) || 'Not available'}</span></div>
        {message.cc.length > 0 && <div className="mt-2 flex gap-3"><span className="w-12 shrink-0 text-muted-foreground">Cc</span><span className="min-w-0 break-words">{formatAddresses(message.cc)}</span></div>}
      </div>
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-4 py-2">
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={() => onAction('reply')} aria-label="Reply"><Reply /></Button></TooltipTrigger><TooltipContent>Reply</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={() => onAction('forward')} aria-label="Forward"><Forward /></Button></TooltipTrigger><TooltipContent>Forward</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={() => onAction('redirect')} aria-label="Redirect"><ArrowRight /></Button></TooltipTrigger><TooltipContent>Redirect</TooltipContent></Tooltip>
        <span className="mx-1 h-5 border-l border-border" />
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={() => onAction('archive')} aria-label="Archive message"><Archive /></Button></TooltipTrigger><TooltipContent>Archive</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={() => onAction('delete')} aria-label="Delete message"><Trash2 /></Button></TooltipTrigger><TooltipContent>Delete</TooltipContent></Tooltip>
        {actionResult?.undoToken && actionResult.status === 'confirmed' && <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={() => onAction('undo', actionResult)} aria-label="Undo last action"><Undo2 /></Button></TooltipTrigger><TooltipContent>Undo last action</TooltipContent></Tooltip>}
      </div>
      {actionResult && <div className={cn('mx-5 mt-4 flex flex-wrap items-start gap-3 border p-3 text-sm sm:mx-6', statusTone(actionResult.status))}><Mail className="mt-0.5 h-4 w-4 shrink-0" /><div className="min-w-0 flex-1"><p className="font-medium">{actionStatusLabel(actionResult.status)}: {actionResult.action}</p><p className="mt-0.5">{actionResult.message}</p></div>{actionResult.status === 'uncertain' && actionResult.actionId && <Button size="sm" variant="outline" onClick={() => onAction('retry', actionResult)}>Review retry</Button>}</div>}
      {error && <div className="mx-5 mt-4 border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 sm:mx-6">The full message could not be refreshed. Showing the available message information. {error}</div>}
      <section className="mx-5 mt-4 border border-border bg-muted/20 p-4 sm:mx-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h3 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-primary" />Email Router Advisor</h3><p className="mt-1 text-xs text-muted-foreground">Read-only routing suggestions. A user must still review and confirm every mail action.</p></div>
          <Button variant="outline" size="sm" onClick={onAdvisor} disabled={advisorLoading}>{advisorLoading ? <Loader2 className="animate-spin" /> : <Sparkles />}{advisorLoading ? 'Reviewing' : advisor ? 'Review again' : 'Suggest routing'}</Button>
        </div>
        {advisorError && <p className="mt-3 text-sm text-destructive">{advisorError}</p>}
        {advisor && <div className="mt-3 space-y-3 text-sm">
          <div className="flex flex-wrap gap-2">{advisor.destinations?.length ? advisor.destinations.map((destination) => <Button key={destination.id} variant="secondary" size="sm" onClick={() => onAction('redirect', null, destination.id)}>{destination.label}</Button>) : <span className="text-muted-foreground">No destination recommended.</span>}</div>
          <p className="text-muted-foreground">{Math.round((advisor.confidence || 0) * 100)}% confidence · {advisor.rationale || 'No rationale provided.'}</p>
          {advisor.question && <p className="border-l-2 border-amber-400 pl-3 text-amber-900">{advisor.question}</p>}
        </div>}
      </section>
      <article className="email-router-content px-5 py-6 text-sm leading-6 text-foreground sm:px-6" dangerouslySetInnerHTML={{ __html: content }} />
      {message.attachments.length > 0 && <section className="border-t border-border px-5 py-5 sm:px-6"><h3 className="flex items-center gap-2 text-sm font-semibold"><Paperclip className="h-4 w-4" />Attachments ({message.attachments.length})</h3><div className="mt-3 divide-y divide-border border-y border-border">{message.attachments.map((attachment, index) => { const id = attachment.id || attachment.attachmentId || `${attachmentName(attachment)}-${index}`; return <div key={id} className="flex items-center justify-between gap-3 py-3"><div className="flex min-w-0 items-center gap-2"><File className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="truncate text-sm">{attachmentName(attachment)}</span>{attachment.size && <span className="shrink-0 text-xs text-muted-foreground">{attachment.size}</span>}</div><div className="flex shrink-0 items-center gap-1">{canPreviewAttachment(attachment) && <Button variant="ghost" size="icon" onClick={() => openPreview(attachment)} disabled={downloadingId === id} aria-label={`Preview ${attachmentName(attachment)}`} title={`Preview ${attachmentName(attachment)}`}><Eye /></Button>}<Button variant="ghost" size="icon" onClick={() => download(attachment)} disabled={downloadingId === id} aria-label={`Download ${attachmentName(attachment)}`} title={`Download ${attachmentName(attachment)}`}>{downloadingId === id ? <Loader2 className="animate-spin" /> : <Download />}</Button></div></div>; })}</div></section>}
      <section className="border-t border-border px-5 py-5 sm:px-6"><h3 className="flex items-center gap-2 text-sm font-semibold"><RotateCcw className="h-4 w-4" />Action history</h3>{history.length ? <ol className="mt-3 space-y-3">{history.map((entry, index) => <li key={entry.id || entry.actionId || `${entry.action || 'action'}-${index}`} className="border-l-2 border-border pl-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{entry.label || entry.action || 'Mail action'}{entry.status && <span className="ml-2 text-xs font-normal text-muted-foreground">{actionStatusLabel(entry.status)}</span>}</p>{entry.status === 'uncertain' && entry.id && ['redirect', 'reply', 'forward'].includes(entry.action) && <Button size="sm" variant="outline" onClick={() => onAction('retry', { actionId: entry.id, action: entry.action, status: entry.status })}>Review retry</Button>}</div><p className="mt-0.5 text-xs text-muted-foreground">{formatEmailDate(entry.at || entry.createdAt || entry.timestamp)}{entry.actor ? ` by ${entry.actor}` : ''}</p>{entry.detail && <p className="mt-1 text-muted-foreground">{entry.detail}</p>}</li>)}</ol> : <p className="mt-2 text-sm text-muted-foreground">No mail actions are recorded for this message.</p>}</section>
      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && closePreview()}><DialogContent className="h-[85vh] max-w-5xl overflow-hidden"><DialogHeader><DialogTitle className="truncate">{preview?.name || 'Attachment preview'}</DialogTitle><DialogDescription>Temporary preview from Microsoft 365. The file is not stored in FCOS.</DialogDescription></DialogHeader>{preview?.type === 'text' ? <pre className="h-full overflow-auto whitespace-pre-wrap border border-border bg-muted/20 p-4 text-xs">{preview.content}</pre> : preview?.type === 'image' ? <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/20"><img src={preview.url} alt={preview.name} className="max-h-full max-w-full object-contain" /></div> : preview?.url ? <iframe src={preview.url} title={preview.name} className="h-full w-full border border-border" /> : null}</DialogContent></Dialog>
    </div>
  </TooltipProvider>;
}

export default function EmailMessageSheet(props) {
  return <Sheet open={props.open} onOpenChange={props.onOpenChange}>
    <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-3xl">
      <SheetHeader className="sr-only"><SheetTitle>{props.message?.subject || 'Email message'}</SheetTitle><SheetDescription>Review message details and actions.</SheetDescription></SheetHeader>
      <EmailMessageDetail {...props} />
    </SheetContent>
  </Sheet>;
}
