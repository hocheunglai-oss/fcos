import { useEffect, useMemo, useState } from 'react';
import { Archive, Download, Eye, File, FolderInput, Forward, Loader2, Mail, Paperclip, Reply, RotateCcw, Trash2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { actionLabel, formatAddresses, formatEmailDate, plainTextToHtml, sanitizeEmailHtml } from '@/lib/emailRouter';

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

function normalizeContentId(value) {
  let result = String(value || '')
    .replace(/&lt;|&#0*60;|&#x0*3c;/gi, '<')
    .replace(/&gt;|&#0*62;|&#x0*3e;/gi, '>')
    .replace(/&amp;|&#0*38;|&#x0*26;/gi, '&')
    .trim()
    .replace(/^cid:/i, '')
    .replace(/^<|>$/g, '')
    .trim();
  try { result = decodeURIComponent(result); } catch { /* Preserve the provider value for matching. */ }
  return result.replace(/^<|>$/g, '').trim().toLowerCase();
}

function inlineAttachmentAliases(attachment) {
  return [...new Set([
    ...(Array.isArray(attachment.inlineAliases) ? attachment.inlineAliases : []),
    attachment.contentId,
  ].map(normalizeContentId).filter(Boolean))];
}

export function replaceEmailRouterInlineSources(value, sources) {
  const html = String(value || '');
  if (typeof DOMParser === 'undefined') {
    return html.replace(/<img\b[^>]*\bsrc\s*=\s*(["'])\s*cid:[\s\S]*?\1[^>]*>/gi, '<span title="Inline image unavailable">Inline image unavailable</span>');
  }
  const document = new DOMParser().parseFromString(html, 'text/html');
  for (const image of document.querySelectorAll('img')) {
    const source = image.getAttribute('src') || '';
    if (!/^\s*cid:/i.test(source)) continue;
    const resolved = sources[normalizeContentId(source)];
    if (resolved) {
      image.setAttribute('src', resolved);
      continue;
    }
    const placeholder = document.createElement('span');
    const alternative = String(image.getAttribute('alt') || '').trim();
    placeholder.setAttribute('title', 'Inline image unavailable');
    placeholder.textContent = alternative ? `Inline image unavailable: ${alternative}` : 'Inline image unavailable';
    image.replaceWith(placeholder);
  }
  return document.body.innerHTML;
}

export function EmailMessageActions({ message, actionResult, actionPending = false, onAction, className = '' }) {
  const disabled = !message || actionPending;
  const buttonClassName = 'h-8 shrink-0 gap-1.5 border-blue-200 bg-blue-50 px-2.5 text-blue-800 hover:border-blue-300 hover:bg-blue-100 hover:text-blue-900 disabled:border-border disabled:bg-muted/30 disabled:text-muted-foreground';
  return <TooltipProvider delayDuration={250}>
    <div className={`flex min-w-max items-center gap-1.5 ${className}`} aria-label="Message actions">
      <Tooltip><TooltipTrigger asChild><Button variant="outline" size="sm" className={buttonClassName} onClick={() => onAction('reply')} disabled={disabled}><Reply className="h-3.5 w-3.5" />Reply</Button></TooltipTrigger><TooltipContent>Reply to this message</TooltipContent></Tooltip>
      <Tooltip><TooltipTrigger asChild><Button variant="outline" size="sm" className={buttonClassName} onClick={() => onAction('forward')} disabled={disabled}><Forward className="h-3.5 w-3.5" />Forward</Button></TooltipTrigger><TooltipContent>Forward this message</TooltipContent></Tooltip>
      <Tooltip><TooltipTrigger asChild><Button variant="outline" size="sm" className={buttonClassName} onClick={() => onAction('archive')} disabled={disabled}><Archive className="h-3.5 w-3.5" />Archive</Button></TooltipTrigger><TooltipContent>Move immediately to Archive</TooltipContent></Tooltip>
      <Tooltip><TooltipTrigger asChild><Button variant="outline" size="sm" className={buttonClassName} onClick={() => onAction('delete')} disabled={disabled}><Trash2 className="h-3.5 w-3.5" />Trash</Button></TooltipTrigger><TooltipContent>Move this message to Deleted Items</TooltipContent></Tooltip>
      <Tooltip><TooltipTrigger asChild><Button variant="outline" size="sm" className={buttonClassName} onClick={() => onAction('move_market_report')} disabled={disabled}><FolderInput className="h-3.5 w-3.5" />Market Report</Button></TooltipTrigger><TooltipContent>Move immediately to the Market Report folder</TooltipContent></Tooltip>
      {actionResult?.messageId === message?.id && actionResult?.undoToken && actionResult.status === 'confirmed' && <Tooltip><TooltipTrigger asChild><Button variant="outline" size="sm" className={buttonClassName} onClick={() => onAction('undo', actionResult)} disabled={actionPending}><Undo2 className="h-3.5 w-3.5" />Undo</Button></TooltipTrigger><TooltipContent>Undo the last move</TooltipContent></Tooltip>}
    </div>
  </TooltipProvider>;
}

export function EmailMessageDetail({ message, loading, error, actionResult, actionPending = false, onAction, onFetchAttachment, onDownloadAttachment, showActions = true }) {
  const [downloadingId, setDownloadingId] = useState(null);
  const [inlineSources, setInlineSources] = useState({});
  const [preview, setPreview] = useState(null);
  const content = useMemo(() => sanitizeEmailHtml(replaceEmailRouterInlineSources(message?.bodyHtml || plainTextToHtml(message?.bodyText || message?.preview || 'No message content available.'), inlineSources)), [inlineSources, message?.bodyHtml, message?.bodyText, message?.preview]);
  const history = message?.actionHistory || [];

  useEffect(() => {
    let active = true;
    const urls = [];
    setInlineSources({});
    const inline = (message?.attachments || []).filter((attachment) => inlineAttachmentAliases(attachment).length && attachmentContentType(attachment).startsWith('image/'));
    Promise.allSettled(inline.map(async (attachment) => {
      const downloaded = await onFetchAttachment(attachment);
      if (!downloaded || !active) return null;
      const url = URL.createObjectURL(downloaded.blob);
      urls.push(url);
      return inlineAttachmentAliases(attachment).map((contentId) => [contentId, url]);
    })).then((entries) => {
      if (!active) return;
      const resolved = entries
        .filter((entry) => entry.status === 'fulfilled' && Array.isArray(entry.value))
        .flatMap((entry) => entry.value);
      setInlineSources(Object.fromEntries(resolved));
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
      {showActions && <div className="overflow-x-auto border-b border-border px-4 py-2"><EmailMessageActions message={message} actionResult={actionResult} actionPending={actionPending} onAction={onAction} /></div>}
      <header className="border-b border-border px-5 py-5 sm:px-6">
        <h2 className="break-words text-xl font-semibold leading-7">{message.subject}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{formatEmailDate(message.sentAt)}</p>
      </header>
      <div className="border-b border-border px-5 py-4 text-sm sm:px-6">
        <div className="flex gap-3"><span className="w-12 shrink-0 text-muted-foreground">From</span><span className="min-w-0 break-words">{formatAddresses(message.from) || 'Unknown sender'}</span></div>
        <div className="mt-2 flex gap-3"><span className="w-12 shrink-0 text-muted-foreground">To</span><span className="min-w-0 break-words">{formatAddresses(message.to) || 'Not available'}</span></div>
        {message.cc.length > 0 && <div className="mt-2 flex gap-3"><span className="w-12 shrink-0 text-muted-foreground">Cc</span><span className="min-w-0 break-words">{formatAddresses(message.cc)}</span></div>}
      </div>
      {error && <div className="mx-5 mt-4 border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 sm:mx-6">The full message could not be refreshed. Showing the available message information. {error}</div>}
      {message.detailWarnings?.map((warning) => <div key={warning} className="mx-5 mt-4 border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 sm:mx-6">{warning}</div>)}
      <div className="email-router-content-shell mx-5 my-6 overflow-x-auto bg-white sm:mx-6">
        <article className="email-router-content min-w-0 text-sm leading-6 text-foreground" dangerouslySetInnerHTML={{ __html: content }} />
      </div>
      {message.attachments.length > 0 && <section className="border-t border-border px-5 py-5 sm:px-6"><h3 className="flex items-center gap-2 text-sm font-semibold"><Paperclip className="h-4 w-4" />Attachments ({message.attachments.length})</h3><div className="mt-3 divide-y divide-border border-y border-border">{message.attachments.map((attachment, index) => { const id = attachment.id || attachment.attachmentId || `${attachmentName(attachment)}-${index}`; return <div key={id} className="flex items-center justify-between gap-3 py-3"><div className="flex min-w-0 items-center gap-2"><File className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="truncate text-sm">{attachmentName(attachment)}</span>{attachment.size && <span className="shrink-0 text-xs text-muted-foreground">{attachment.size}</span>}</div><div className="flex shrink-0 items-center gap-1">{canPreviewAttachment(attachment) && <Button variant="ghost" size="icon" onClick={() => openPreview(attachment)} disabled={downloadingId === id} aria-label={`Preview ${attachmentName(attachment)}`} title={`Preview ${attachmentName(attachment)}`}><Eye /></Button>}<Button variant="ghost" size="icon" onClick={() => download(attachment)} disabled={downloadingId === id} aria-label={`Download ${attachmentName(attachment)}`} title={`Download ${attachmentName(attachment)}`}>{downloadingId === id ? <Loader2 className="animate-spin" /> : <Download />}</Button></div></div>; })}</div></section>}
      <section className="border-t border-border px-5 py-5 sm:px-6"><h3 className="flex items-center gap-2 text-sm font-semibold"><RotateCcw className="h-4 w-4" />Action history</h3>{history.length ? <ol className="mt-3 space-y-3">{history.map((entry, index) => <li key={entry.id || entry.actionId || `${entry.action || 'action'}-${index}`} className="border-l-2 border-border pl-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{entry.label || actionLabel(entry.action)}{entry.status && <span className="ml-2 text-xs font-normal text-muted-foreground">{actionStatusLabel(entry.status)}</span>}</p>{entry.status === 'uncertain' && entry.id && ['redirect', 'reply', 'forward'].includes(entry.action) && <Button size="sm" variant="outline" onClick={() => onAction('retry', { actionId: entry.id, action: entry.action, status: entry.status })}>Review retry</Button>}</div><p className="mt-0.5 text-xs text-muted-foreground">{formatEmailDate(entry.at || entry.createdAt || entry.timestamp)}{entry.actor ? ` by ${entry.actor}` : ''}</p>{entry.detail && <p className="mt-1 text-muted-foreground">{entry.detail}</p>}</li>)}</ol> : <p className="mt-2 text-sm text-muted-foreground">No mail actions are recorded for this message.</p>}</section>
      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && closePreview()}><DialogContent className="h-[85vh] max-w-5xl overflow-hidden"><DialogHeader><DialogTitle className="truncate">{preview?.name || 'Attachment preview'}</DialogTitle><DialogDescription>Temporary preview from Microsoft 365. The file is not stored in FCOS.</DialogDescription></DialogHeader>{preview?.type === 'text' ? <pre className="h-full overflow-auto whitespace-pre-wrap border border-border bg-muted/20 p-4 text-xs">{preview.content}</pre> : preview?.type === 'image' ? <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/20"><img src={preview.url} alt={preview.name} className="max-h-full max-w-full object-contain" /></div> : preview?.url ? <iframe src={preview.url} title={preview.name} className="h-full w-full border border-border" /> : null}</DialogContent></Dialog>
    </div>
  </TooltipProvider>;
}

export default function EmailMessageSheet(props) {
  return <Sheet open={props.open} onOpenChange={props.onOpenChange}>
    <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-4xl">
      <SheetHeader className="sr-only"><SheetTitle>{props.message?.subject || 'Email message'}</SheetTitle><SheetDescription>Review message details and actions.</SheetDescription></SheetHeader>
      <EmailMessageDetail {...props} />
      {props.redirectPanel}
    </SheetContent>
  </Sheet>;
}
