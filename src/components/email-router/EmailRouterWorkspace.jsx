import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, CheckCircle2, Inbox, Loader2, Mail, RefreshCw, Search, Send, ShieldCheck, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PageHeader from '@/components/common/PageHeader';
import PageMethodology from '@/components/common/PageMethodology';
import { cn } from '@/lib/utils';
import { emailRouter, isLikelyUncertain, newOperationId, normaliseActionResult, normaliseDetailResponse, normaliseListResponse } from '@/lib/emailRouter';
import { supabase } from '@/lib/supabaseClient';
import EmailActionDialog from './EmailActionDialog';
import EmailMessageList from './EmailMessageList';
import EmailMessageSheet, { EmailMessageDetail } from './EmailMessageSheet';

const LIMIT = 30;
const METHODOLOGY = {
  title: 'Email Router',
  description: 'How FCOS retrieves messages and submits controlled mailbox actions.',
  sections: [
    { title: 'Mailbox data', body: 'Inbox, Sent, and Archive are read from the connected mailbox service. The workspace preserves the server result and does not infer delivery or deletion outcomes.' },
    { title: 'Controlled actions', body: 'Redirect, Reply, Forward, Archive, Delete, and Undo each require an explicit confirmation. FCOS records the submitted request and shows confirmed, failed, or uncertain outcomes returned by the service.' },
    { title: 'Message safety', body: 'Message HTML is sanitized before display. Attachments are requested through a time-limited URL only when a user selects Download.' },
    { title: 'Availability', body: 'When the router backend is unavailable, FCOS keeps the workspace read-only and reports the service state instead of simulating mail activity.' },
  ],
};

function messageError(data, fallback) {
  return data?.error || fallback || '';
}

function ResultNotice({ result }) {
  if (!result) return null;
  const pending = ['draft_created', 'submitted'].includes(result.status);
  const Icon = result.status === 'confirmed' ? CheckCircle2 : result.status === 'uncertain' ? ShieldCheck : pending ? Loader2 : XCircle;
  const tone = result.status === 'confirmed' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : result.status === 'uncertain' ? 'border-amber-200 bg-amber-50 text-amber-950' : pending ? 'border-blue-200 bg-blue-50 text-blue-950' : 'border-red-200 bg-red-50 text-red-900';
  const label = result.status === 'confirmed' ? 'Confirmed' : result.status === 'uncertain' ? 'Outcome uncertain' : result.status === 'draft_created' ? 'Draft created' : result.status === 'submitted' ? 'Submitted' : 'Failed';
  return <div className={cn('flex items-start gap-3 border px-4 py-3 text-sm', tone)}><Icon className={cn('mt-0.5 h-4 w-4 shrink-0', pending && 'animate-spin')} /><div><span className="font-semibold">{label}</span><span className="mx-1">·</span>{result.action}<p className="mt-0.5">{result.message}</p></div></div>;
}

export default function EmailRouterWorkspace() {
  const [useDetailSheet, setUseDetailSheet] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1024);
  const [folder, setFolder] = useState('inbox');
  const [search, setSearch] = useState('');
  const [messages, setMessages] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [cursorStack, setCursorStack] = useState([]);
  const [currentCursor, setCurrentCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [actionDialog, setActionDialog] = useState(null);
  const [directory, setDirectory] = useState([]);
  const [presets, setPresets] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [actionResult, setActionResult] = useState(null);
  const [advisor, setAdvisor] = useState(null);
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const [advisorError, setAdvisorError] = useState('');
  const requestId = useRef(0);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 1023px)');
    const update = () => setUseDetailSheet(query.matches);
    query.addEventListener('change', update);
    update();
    return () => query.removeEventListener('change', update);
  }, []);

  const loadList = async ({ cursor = null, history = [], foreground = true, force = false } = {}) => {
    const id = ++requestId.current;
    if (foreground) setLoading(true); else setLoadingMore(true);
    setListError('');
    try {
      const response = await emailRouter.list({ folder, query: search.trim(), cursor, limit: LIMIT }, { force });
      if (id !== requestId.current) return;
      const error = messageError(response.data);
      if (error) {
        setListError(error);
        if (foreground) setMessages([]);
      } else {
        const result = normaliseListResponse(response.data);
        setMessages(result.messages);
        setNextCursor(result.nextCursor);
        setCurrentCursor(cursor);
        setCursorStack(history);
        setSelectedId((selected) => result.messages.some((message) => message.id === selected) ? selected : null);
        setDetail((current) => result.messages.some((message) => message.id === current?.id) ? current : null);
      }
    } catch (error) {
      if (id !== requestId.current) return;
      setListError(error?.message || 'The mailbox service is unavailable.');
      if (foreground) setMessages([]);
    } finally {
      if (id === requestId.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  useEffect(() => {
    const handle = window.setTimeout(() => loadList({ cursor: null, history: [] }), 250);
    return () => window.clearTimeout(handle);
  }, [folder, search]);

  useEffect(() => {
    if (!selectedId) return undefined;
    let active = true;
    setDetailLoading(true);
    setDetailError('');
    setAdvisor(null);
    setAdvisorError('');
    const fallback = messages.find((message) => message.id === selectedId) || null;
    setDetail(fallback);
    emailRouter.detail({ messageId: selectedId }).then((response) => {
      if (!active) return;
      const error = messageError(response.data);
      if (error) setDetailError(error);
      else setDetail(normaliseDetailResponse(response.data));
    }).catch((error) => { if (active) setDetailError(error?.message || 'Message details are unavailable.'); }).finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [selectedId, messages]);

  const openAction = async (action, undoResult = null, initialDestinationId = '') => {
    if (!detail) return;
    setActionDialog({ action, undoResult, initialDestinationId });
    if (!['redirect', 'forward'].includes(action)) return;
    try {
      const [directoryResponse, presetResponse] = await Promise.all([emailRouter.directory({}, { force: true }), emailRouter.presets({}, { force: true })]);
      if (!directoryResponse.data?.error) setDirectory(directoryResponse.data.directory || directoryResponse.data.destinations || directoryResponse.data.items || []);
      else setDirectory([]);
      if (!presetResponse.data?.error) setPresets(presetResponse.data.presets || presetResponse.data.items || []);
      else if (!directoryResponse.data?.error) setPresets(directoryResponse.data.presets || []);
      else setPresets([]);
    } catch {
      setDirectory([]);
      setPresets([]);
    }
  };

  const loadAdvisor = async () => {
    if (!detail) return;
    setAdvisorLoading(true);
    setAdvisorError('');
    try {
      const response = await emailRouter.advisor({ messageId: detail.id }, { force: true });
      if (response.data?.error) setAdvisorError(response.data.error);
      else setAdvisor(response.data?.recommendation || null);
    } catch (error) {
      setAdvisorError(error?.message || 'Email Router Advisor is unavailable.');
    } finally {
      setAdvisorLoading(false);
    }
  };

  const submitAction = async (payload) => {
    if (!detail || !actionDialog) return;
    const operationId = newOperationId();
    const submitted = { status: 'submitted', action: payload.action, message: 'FCOS submitted the action request and is waiting for confirmation.' };
    setSubmitting(true);
    setActionResult(submitted);
    let response;
    try {
      response = payload.action === 'undo'
        ? await emailRouter.undo({ messageId: detail.id, undoToken: actionDialog.undoResult?.undoToken, actionId: actionDialog.undoResult?.actionId, operationId })
        : payload.action === 'retry'
          ? await emailRouter.retry({ messageId: detail.id, actionId: actionDialog.undoResult?.actionId, confirmedNotSent: true, operationId })
        : await emailRouter.action({ messageId: detail.id, threadId: detail.threadId || null, operationId, ...payload });
      const result = normaliseActionResult(response.data, payload.action);
      setActionResult(result);
      setDetail((current) => current ? { ...current, actionHistory: [{ id: result.actionId || operationId, action: result.action, status: result.status, detail: result.message, at: new Date().toISOString() }, ...(current.actionHistory || [])] } : current);
      setActionDialog(null);
      if (result.status === 'confirmed') loadList({ cursor: currentCursor, history: cursorStack, foreground: false, force: true });
    } catch (error) {
      setActionResult({ status: isLikelyUncertain(error?.message) ? 'uncertain' : 'failed', action: payload.action, message: error?.message || 'The action did not complete.' });
      setActionDialog(null);
    } finally {
      setSubmitting(false);
    }
  };

  const fetchAttachment = useCallback(async (attachment) => {
    if (!detail) return;
    try {
      const response = await emailRouter.attachmentUrl({ messageId: detail.id, attachmentId: attachment.id || attachment.attachmentId }, { force: true });
      const token = response.data?.token;
      if (!token) {
        setDetailError(messageError(response.data, 'Attachment download is unavailable.'));
        return null;
      }
      const session = await supabase.auth.getSession();
      const accessToken = session.data?.session?.access_token;
      if (!accessToken) throw new Error('Sign in again to download this attachment.');
      const download = await fetch(`/api/email-router-attachment?token=${encodeURIComponent(token)}`, {
        headers: { authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      });
      if (!download.ok) {
        const failure = await download.json().catch(() => ({}));
        throw new Error(failure.error || 'Attachment download is unavailable.');
      }
      const blob = await download.blob();
      return { blob, contentType: download.headers.get('content-type') || blob.type || attachment.contentType || 'application/octet-stream' };
    } catch (error) {
      setDetailError(error?.message || 'Attachment download is unavailable.');
      return null;
    }
  }, [detail?.id]);

  const downloadAttachment = async (attachment) => {
    const downloaded = await fetchAttachment(attachment);
    if (!downloaded) return;
    try {
      const { blob } = downloaded;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = String(attachment.name || attachment.fileName || 'attachment').replace(/[\\/:*?"<>|]/g, '_').slice(0, 180);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (error) {
      setDetailError(error?.message || 'Attachment download is unavailable.');
    }
  };

  const previous = () => {
    if (!cursorStack.length) return;
    const prior = cursorStack.at(-1);
    loadList({ cursor: prior, history: cursorStack.slice(0, -1), foreground: false });
  };
  const next = () => nextCursor && loadList({ cursor: nextCursor, history: [...cursorStack, currentCursor], foreground: false });
  const selectMessage = (messageId) => {
    if (messageId !== selectedId) setActionResult(null);
    setSelectedId(messageId);
  };

  return <div className="space-y-4">
    <PageHeader
      icon={Mail}
      eyebrow="Operations"
      title="Email Router"
      description="Review connected mailbox traffic and submit controlled routing actions."
      meta={loading ? 'Loading mailbox...' : listError ? 'Mailbox service unavailable' : `${messages.length.toLocaleString()} messages loaded`}
      actions={<><PageMethodology {...METHODOLOGY} /><Button variant="outline" size="icon" onClick={() => loadList({ cursor: currentCursor, history: cursorStack, force: true })} disabled={loading || loadingMore} aria-label="Refresh mailbox" title="Refresh mailbox">{loading || loadingMore ? <Loader2 className="animate-spin" /> : <RefreshCw />}</Button></>}
    />
    <ResultNotice result={actionResult} />
    <section className="flex min-h-[620px] flex-col overflow-hidden border border-border bg-background lg:flex-row">
      <div className="flex min-h-0 w-full flex-col border-b border-border lg:w-[420px] lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="border-b border-border px-4 py-3"><Tabs value={folder} onValueChange={setFolder}><TabsList className="grid w-full grid-cols-3"><TabsTrigger value="inbox" className="gap-1.5"><Inbox className="h-3.5 w-3.5" />Inbox</TabsTrigger><TabsTrigger value="sent" className="gap-1.5"><Send className="h-3.5 w-3.5" />Sent</TabsTrigger><TabsTrigger value="archive" className="gap-1.5"><Archive className="h-3.5 w-3.5" />Archive</TabsTrigger></TabsList></Tabs></div>
        <div className="border-b border-border p-3"><div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search sender, subject, or content" className="pl-9" /></div></div>
        <EmailMessageList messages={messages} selectedId={selectedId} loading={loading} loadingMore={loadingMore} error={listError} folder={folder} hasPrevious={cursorStack.length > 0} hasNext={Boolean(nextCursor)} onSelect={selectMessage} onPrevious={previous} onNext={next} />
      </div>
      <div className="hidden min-h-0 flex-1 overflow-y-auto lg:block"><EmailMessageDetail message={detail} loading={detailLoading} error={detailError} actionResult={actionResult} advisor={advisor} advisorLoading={advisorLoading} advisorError={advisorError} onAdvisor={loadAdvisor} onAction={openAction} onFetchAttachment={fetchAttachment} onDownloadAttachment={downloadAttachment} /></div>
    </section>
    {useDetailSheet && <EmailMessageSheet open={Boolean(selectedId)} onOpenChange={(open) => !open && setSelectedId(null)} message={detail} loading={detailLoading} error={detailError} actionResult={actionResult} advisor={advisor} advisorLoading={advisorLoading} advisorError={advisorError} onAdvisor={loadAdvisor} onAction={openAction} onFetchAttachment={fetchAttachment} onDownloadAttachment={downloadAttachment} />}
    <EmailActionDialog open={Boolean(actionDialog)} onOpenChange={(open) => !open && setActionDialog(null)} action={actionDialog?.action} message={detail} directory={directory} presets={presets} submitting={submitting} initialDestinationId={actionDialog?.initialDestinationId} onSubmit={submitAction} />
  </div>;
}
