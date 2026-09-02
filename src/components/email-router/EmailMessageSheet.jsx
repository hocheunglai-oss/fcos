import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Archive, Download, Eye, File, FileWarning, FolderInput, Loader2, Mail, Paperclip, RotateCcw, Search, ShieldCheck, Trash2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { actionLabel, formatAddresses, formatEmailDate, plainTextToHtml, sanitizeEmailHtml } from '@/lib/emailRouter';
import { attachmentIntelligence, emailImageSourceSummary, recordEmailRouterClientMetric, senderDomain, trustEmailImageDomain, trustedEmailImageDomains } from '@/lib/emailRouterEnhancements';

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

function likelyTrackingImage(image) {
  const width = Number(image.getAttribute('width'));
  const height = Number(image.getAttribute('height'));
  const style = String(image.getAttribute('style') || '');
  return (width > 0 && width <= 2 && height > 0 && height <= 2)
    || /\b(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\D|$))/i.test(style);
}

function unavailableImage(document, image, label, title) {
  const placeholder = document.createElement('span');
  const alternative = String(image.getAttribute('alt') || '').trim();
  placeholder.setAttribute('title', title);
  placeholder.textContent = alternative ? `${label}: ${alternative}` : label;
  image.replaceWith(placeholder);
}

export function replaceEmailRouterInlineSources(value, sources, { allowRemote = true } = {}) {
  const html = String(value || '');
  if (typeof DOMParser === 'undefined') {
    return html.replace(/<img\b[^>]*\bsrc\s*=\s*(["'])\s*cid:[\s\S]*?\1[^>]*>/gi, '<span title="Inline image unavailable">Inline image unavailable</span>');
  }
  const document = new DOMParser().parseFromString(html, 'text/html');
  for (const image of document.querySelectorAll('img')) {
    const source = image.getAttribute('src') || '';
    if (/^\s*cid:/i.test(source)) {
      const resolved = sources[normalizeContentId(source)];
      if (resolved) {
        image.setAttribute('src', resolved);
        continue;
      }
      unavailableImage(document, image, 'Inline image unavailable', 'Inline image unavailable');
      continue;
    }
    if (!/^\s*https?:/i.test(source)) continue;
    if (likelyTrackingImage(image)) {
      unavailableImage(document, image, 'Tracking image blocked', 'A likely tracking image was blocked');
      continue;
    }
    if (!allowRemote) unavailableImage(document, image, 'Remote image blocked', 'Remote images are blocked for this sender');
  }
  return document.body.innerHTML;
}

function HighlightedText({ value, query }) {
  const text = String(value || '');
  const search = String(query || '').trim();
  if (!search) return text;
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.split(new RegExp(`(${escaped})`, 'gi')).map((part, index) => part.toLowerCase() === search.toLowerCase() ? <mark key={`${index}:${part}`}>{part}</mark> : part);
}

export function EmailMessageActions({ message, actionResult, actionPending = false, onAction, className = '' }) {
  const disabled = !message || actionPending;
  const buttonClassName = 'h-8 shrink-0 gap-1.5 border-blue-200 bg-blue-50 px-2.5 text-blue-800 hover:border-blue-300 hover:bg-blue-100 hover:text-blue-900 disabled:border-border disabled:bg-muted/30 disabled:text-muted-foreground';
  return <TooltipProvider delayDuration={250}>
    <div className={`flex min-w-max items-center gap-1.5 ${className}`} aria-label="Message actions">
      <Tooltip><TooltipTrigger asChild><Button variant="outline" size="sm" className={buttonClassName} onClick={() => onAction('archive')} disabled={disabled}><Archive className="h-3.5 w-3.5" />Archive</Button></TooltipTrigger><TooltipContent>Move immediately to Archive</TooltipContent></Tooltip>
      <Tooltip><TooltipTrigger asChild><Button variant="outline" size="sm" className={buttonClassName} onClick={() => onAction('delete')} disabled={disabled}><Trash2 className="h-3.5 w-3.5" />Trash</Button></TooltipTrigger><TooltipContent>Move this message to Deleted Items</TooltipContent></Tooltip>
      <Tooltip><TooltipTrigger asChild><Button variant="outline" size="sm" className={buttonClassName} onClick={() => onAction('move_market_report')} disabled={disabled}><FolderInput className="h-3.5 w-3.5" />Market Report</Button></TooltipTrigger><TooltipContent>Move immediately to the Market Report folder</TooltipContent></Tooltip>
      {actionResult?.messageId === message?.id && actionResult?.undoToken && actionResult.status === 'confirmed' && <Tooltip><TooltipTrigger asChild><Button variant="outline" size="sm" className={buttonClassName} onClick={() => onAction('undo', actionResult)} disabled={actionPending}><Undo2 className="h-3.5 w-3.5" />Undo</Button></TooltipTrigger><TooltipContent>Undo the last move</TooltipContent></Tooltip>}
    </div>
  </TooltipProvider>;
}

export function EmailMessageDetail({ message, loading, error, actionResult, actionPending = false, onAction, onFetchAttachment, onExtractAttachmentText, onDownloadAttachment, showActions = true }) {
  const [downloadingId, setDownloadingId] = useState(null);
  const [inlineSources, setInlineSources] = useState({});
  const [preview, setPreview] = useState(null);
  const [trustedDomains, setTrustedDomains] = useState(() => trustedEmailImageDomains());
  const [loadRemoteOnce, setLoadRemoteOnce] = useState(false);
  const [hideRemote, setHideRemote] = useState(false);
  const [pdfText, setPdfText] = useState({ loading: false, value: '', pages: 0, error: '' });
  const [pdfSearch, setPdfSearch] = useState('');
  const articleRef = useRef(null);
  const rawContent = message?.bodyHtml || plainTextToHtml(message?.bodyText || message?.preview || 'No message content available.');
  const imageSummary = useMemo(() => emailImageSourceSummary(rawContent), [rawContent]);
  const domain = senderDomain(message);
  const remoteAllowed = !hideRemote && (loadRemoteOnce || trustedDomains.includes(domain));
  const content = useMemo(() => sanitizeEmailHtml(replaceEmailRouterInlineSources(rawContent, inlineSources, { allowRemote: remoteAllowed })), [inlineSources, rawContent, remoteAllowed]);
  const attachmentInsights = useMemo(() => attachmentIntelligence(message?.attachments || []), [message?.attachments]);
  const history = message?.actionHistory || [];

  useEffect(() => {
    setLoadRemoteOnce(false);
    setHideRemote(false);
  }, [message?.id]);

  useEffect(() => {
    const article = articleRef.current;
    if (!article) return undefined;
    const failed = (event) => {
      const image = event.target;
      if (!(image instanceof HTMLImageElement)) return;
      const source = image.src;
      const placeholder = document.createElement('span');
      placeholder.className = 'inline-flex items-center gap-2 border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900';
      placeholder.textContent = image.alt ? `Image unavailable: ${image.alt}` : 'Image unavailable';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'font-semibold underline underline-offset-2';
      retry.textContent = 'Retry';
      retry.addEventListener('click', () => {
        const next = image.cloneNode(true);
        const url = new URL(source);
        url.searchParams.set('fcos_retry', String(Date.now()));
        next.src = url.href;
        placeholder.replaceWith(next);
      }, { once: true });
      placeholder.appendChild(retry);
      image.replaceWith(placeholder);
      recordEmailRouterClientMetric({ operation: 'remote_image', outcome: 'failed' });
    };
    article.addEventListener('error', failed, true);
    return () => article.removeEventListener('error', failed, true);
  }, [content]);

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
    setPdfText({ loading: false, value: '', pages: 0, error: '' });
    setPdfSearch('');
    setPreview({ attachment, name: attachmentName(attachment), type: type.startsWith('image/') ? 'image' : 'pdf', url: URL.createObjectURL(downloaded.blob) });
  };
  const extractPdfText = async () => {
    if (preview?.type !== 'pdf' || !preview.attachment || !onExtractAttachmentText || pdfText.loading) return;
    setPdfText({ loading: true, value: '', pages: 0, error: '' });
    const result = await onExtractAttachmentText(preview.attachment);
    if (!result) {
      setPdfText({ loading: false, value: '', pages: 0, error: 'PDF text could not be extracted.' });
      return;
    }
    setPdfText({ loading: false, value: result.text || '', pages: Number(result.pages || 0), error: result.error || '' });
  };
  const closePreview = () => {
    if (preview?.url) URL.revokeObjectURL(preview.url);
    setPreview(null);
    setPdfText({ loading: false, value: '', pages: 0, error: '' });
    setPdfSearch('');
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
      {imageSummary.remote > 0 && <div className="mx-5 mt-4 flex flex-wrap items-center justify-between gap-2 border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950 sm:mx-6"><div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 shrink-0" /><span>{imageSummary.tracking ? `${imageSummary.tracking} likely tracking image${imageSummary.tracking === 1 ? '' : 's'} blocked. ` : ''}{remoteAllowed ? `${Math.max(0, imageSummary.remote - imageSummary.tracking)} remote image${imageSummary.remote - imageSummary.tracking === 1 ? '' : 's'} allowed for ${domain || 'this message'}.` : `${Math.max(0, imageSummary.remote - imageSummary.tracking)} remote image${imageSummary.remote - imageSummary.tracking === 1 ? '' : 's'} blocked for privacy.`}</span></div><div className="flex flex-wrap gap-2">{remoteAllowed ? <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setHideRemote(true)}>Hide remote images</Button> : <><Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setLoadRemoteOnce(true); setHideRemote(false); recordEmailRouterClientMetric({ operation: 'remote_image', outcome: 'loaded_once' }); }}>Load images once</Button>{domain ? <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => { const next = trustEmailImageDomain(domain); setTrustedDomains(next); setHideRemote(false); recordEmailRouterClientMetric({ operation: 'remote_image', outcome: 'trusted_domain' }); }}>Always trust {domain}</Button> : null}</>}</div></div>}
      <div className="email-router-content-shell mx-5 my-6 overflow-x-auto bg-white sm:mx-6">
        <article ref={articleRef} className="email-router-content min-w-0 text-sm leading-6 text-foreground" dangerouslySetInnerHTML={{ __html: content }} />
      </div>
      {message.attachments.length > 0 && <section className="border-t border-border px-5 py-5 sm:px-6"><h3 className="flex items-center gap-2 text-sm font-semibold"><Paperclip className="h-4 w-4" />Attachments ({message.attachments.length})</h3><div className="mt-3 divide-y divide-border border-y border-border">{message.attachments.map((attachment, index) => { const id = attachment.id || attachment.attachmentId || `${attachmentName(attachment)}-${index}`; const insight = attachmentInsights[index] || { warnings: [] }; return <div key={id} className="flex items-center justify-between gap-3 py-3"><div className="flex min-w-0 items-start gap-2">{insight.warnings.length ? <FileWarning className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" /> : <File className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}<div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="max-w-full truncate text-sm">{attachmentName(attachment)}</span>{attachment.size && <span className="shrink-0 text-xs text-muted-foreground">{attachment.size}</span>}</div>{insight.warnings.length ? <div className="mt-1 flex flex-wrap gap-1">{insight.warnings.map((warning) => <span key={warning} className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">{warning}</span>)}</div> : null}</div></div><div className="flex shrink-0 items-center gap-1">{canPreviewAttachment(attachment) && <Button variant="ghost" size="icon" onClick={() => openPreview(attachment)} disabled={downloadingId === id || insight.dangerous} aria-label={`Preview ${attachmentName(attachment)}`} title={insight.dangerous ? 'Preview disabled for this file type' : `Preview ${attachmentName(attachment)}`}><Eye /></Button>}<Button variant="ghost" size="icon" onClick={() => download(attachment)} disabled={downloadingId === id} aria-label={`Download ${attachmentName(attachment)}`} title={`Download ${attachmentName(attachment)}`}>{downloadingId === id ? <Loader2 className="animate-spin" /> : <Download />}</Button></div></div>; })}</div></section>}
      <section className="border-t border-border px-5 py-5 sm:px-6"><h3 className="flex items-center gap-2 text-sm font-semibold"><RotateCcw className="h-4 w-4" />Action history</h3>{history.length ? <ol className="mt-3 space-y-3">{history.map((entry, index) => <li key={entry.id || entry.actionId || `${entry.action || 'action'}-${index}`} className="border-l-2 border-border pl-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{entry.label || actionLabel(entry.action)}{entry.status && <span className="ml-2 text-xs font-normal text-muted-foreground">{actionStatusLabel(entry.status)}</span>}</p>{entry.status === 'uncertain' && entry.id && ['redirect', 'reply', 'forward'].includes(entry.action) && <Button size="sm" variant="outline" onClick={() => onAction('retry', { actionId: entry.id, action: entry.action, status: entry.status })}>Review retry</Button>}</div><p className="mt-0.5 text-xs text-muted-foreground">{formatEmailDate(entry.at || entry.createdAt || entry.timestamp)}{entry.actor ? ` by ${entry.actor}` : ''}</p>{entry.detail && <p className="mt-1 text-muted-foreground">{entry.detail}</p>}</li>)}</ol> : <p className="mt-2 text-sm text-muted-foreground">No mail actions are recorded for this message.</p>}</section>
      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && closePreview()}><DialogContent className="grid h-[92vh] max-w-[min(96vw,90rem)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden"><DialogHeader><DialogTitle className="truncate">{preview?.name || 'Attachment preview'}</DialogTitle><DialogDescription>Temporary preview from Microsoft 365. FCOS does not retain the file or extracted text.</DialogDescription></DialogHeader>{preview?.type === 'text' ? <pre className="h-full overflow-auto whitespace-pre-wrap border border-border bg-muted/20 p-4 text-xs">{preview.content}</pre> : preview?.type === 'image' ? <div className="flex min-h-0 items-center justify-center overflow-auto bg-muted/20"><img src={preview.url} alt={preview.name} className="max-h-full max-w-full object-contain" /></div> : preview?.url ? <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3"><div className="flex flex-wrap items-center gap-2"><Button type="button" size="sm" variant="outline" onClick={extractPdfText} disabled={pdfText.loading}>{pdfText.loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Search className="mr-1.5 h-4 w-4" />}{pdfText.value ? 'Refresh extracted text' : 'Extract searchable text'}</Button>{pdfText.pages ? <span className="text-xs text-muted-foreground">{pdfText.pages} page{pdfText.pages === 1 ? '' : 's'}</span> : null}{pdfText.value ? <div className="relative ml-auto w-full sm:w-72"><Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" /><Input value={pdfSearch} onChange={(event) => setPdfSearch(event.target.value)} placeholder="Search extracted text" className="h-8 pl-8 text-xs" /></div> : null}</div><div className={`grid min-h-0 gap-3 ${pdfText.value || pdfText.error ? 'lg:grid-cols-[minmax(0,3fr)_minmax(20rem,2fr)]' : ''}`}><iframe src={preview.url} title={preview.name} referrerPolicy="no-referrer" className="h-full min-h-[32rem] w-full border border-border" />{pdfText.value || pdfText.error ? <div className="min-h-0 overflow-auto border border-border bg-muted/20 p-4"><div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Transient extracted text</div>{pdfText.error ? <div className="flex gap-2 text-sm text-amber-800"><AlertTriangle className="h-4 w-4 shrink-0" />{pdfText.error}</div> : <pre className="whitespace-pre-wrap break-words text-xs leading-5"><HighlightedText value={pdfText.value} query={pdfSearch} /></pre>}</div> : null}</div></div> : null}</DialogContent></Dialog>
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
