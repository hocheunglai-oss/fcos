import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, CalendarOff, CheckCircle2, Inbox, Loader2, Mail, RefreshCw, Search, Send, Settings2, ShieldCheck, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PageHeader from '@/components/common/PageHeader';
import PageMethodology from '@/components/common/PageMethodology';
import { EMAIL_ROUTER_METHODOLOGY } from '@/lib/pageMethodologies';
import { cn } from '@/lib/utils';
import { actionLabel, emailRouter, isLikelyUncertain, newOperationId, normaliseActionResult, normaliseDetailResponse, normaliseListResponse } from '@/lib/emailRouter';
import { supabase } from '@/lib/supabaseClient';
import EmailActionDialog from './EmailActionDialog';
import EmailMessageList from './EmailMessageList';
import EmailMessageSheet, { EmailMessageActions, EmailMessageDetail } from './EmailMessageSheet';
import EmailRedirectPanel from './EmailRedirectPanel';
import EmailRoutingLeaveDialog from './EmailRoutingLeaveDialog';
import EmailRouterSettings from './EmailRouterSettings';
import { navigationCacheOptions } from '@/lib/navigationCachePolicy';
import { useAuth } from '@/lib/AuthContext';

const LIMIT = 30;
const ACTION_STATUS_POLL_DELAYS = [1_500, 2_500, 4_000, 6_000, 8_000, 10_000];
const ACTION_STATUS_POLL_TIMEOUT_MS = 75_000;
function messageError(data, fallback) {
  return data?.error || fallback || '';
}

function recordEmailRouterTiming(operation, startedAt, server = null) {
  if (typeof window === 'undefined' || typeof window.performance?.now !== 'function') return;
  const detail = {
    operation,
    durationMs: Math.max(0, Math.round(window.performance.now() - startedAt)),
    ...(server && typeof server === 'object' ? { server } : {}),
  };
  window.dispatchEvent(new CustomEvent('fcos:email-router-performance', { detail }));
}

function ResultNotice({ result, compact = false }) {
  if (!result) return <div className={cn('flex items-center border border-border bg-background/60 text-muted-foreground', compact ? 'min-h-9 px-3 py-2 text-xs' : 'min-h-12 px-4 py-3 text-sm')} role="status" aria-live="polite"><Mail className="mr-2 h-4 w-4 shrink-0" />{compact ? <><span className="sm:hidden">Ready</span><span className="hidden sm:inline">Ready for mail actions</span></> : 'Ready for mail actions'}</div>;
  const tracking = result.tracking === true;
  const filingReview = result.filingNeedsReview === true;
  const pending = !filingReview && (tracking || result.status === 'submitted');
  const accepted = result.status === 'draft_created';
  const Icon = result.status === 'confirmed' ? CheckCircle2 : filingReview || result.status === 'uncertain' && !tracking ? ShieldCheck : pending ? Loader2 : accepted ? CheckCircle2 : XCircle;
  const tone = result.status === 'confirmed' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : filingReview || result.status === 'uncertain' && !tracking ? 'border-amber-200 bg-amber-50 text-amber-950' : pending || accepted ? 'border-blue-200 bg-blue-50 text-blue-950' : 'border-red-200 bg-red-50 text-red-900';
  const label = result.status === 'confirmed' ? 'Confirmed' : filingReview ? 'Sent · filing needs review' : tracking ? (accepted ? 'Sending securely' : 'Confirming') : result.status === 'uncertain' ? 'Outcome uncertain' : accepted ? 'Queued securely' : result.status === 'submitted' ? 'Submitted' : 'Failed';
  return <div className={cn('flex min-h-12 items-start gap-3 border px-4 py-3 text-sm', tone)} role="status" aria-live="polite"><Icon className={cn('mt-0.5 h-4 w-4 shrink-0', pending && 'animate-spin')} /><div className="min-w-0"><span className="font-semibold">{label}</span><span className="mx-1">·</span>{actionLabel(result.action)}<p className="mt-0.5 break-words">{result.message}</p></div></div>;
}

export default function EmailRouterWorkspace({ settingsOpen = false, onSettingsOpenChange = () => {} }) {
  const { isAdministrator } = useAuth();
  const [useDetailSheet, setUseDetailSheet] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1280);
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
  const [routingFolders, setRoutingFolders] = useState([]);
  const [routeAction, setRouteAction] = useState('redirect');
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionResult, setActionResult] = useState(null);
  const [advisor, setAdvisor] = useState(null);
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const [advisorError, setAdvisorError] = useState('');
  const [leaveOpen, setLeaveOpen] = useState(false);
  const requestId = useRef(0);
  const loadListRef = useRef(null);
  const messagesRef = useRef([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const actionId = actionResult?.actionId;
    const shouldTrack = Boolean(actionId) && actionResult?.filingNeedsReview !== true
      && (actionResult?.tracking === true || ['draft_created', 'submitted'].includes(actionResult?.status));
    if (!shouldTrack) return undefined;
    let active = true;
    let timer = null;
    let attempt = 0;
    const startedAt = Date.now();
    const messageId = actionResult.messageId;
    const action = actionResult.action;

    const schedule = () => {
      if (!active) return;
      const delay = ACTION_STATUS_POLL_DELAYS[Math.min(attempt, ACTION_STATUS_POLL_DELAYS.length - 1)];
      attempt += 1;
      timer = window.setTimeout(poll, delay);
    };
    const poll = async () => {
      if (!active) return;
      try {
        const response = await emailRouter.actionStatus({ actionId }, { force: true, cache: false, invalidateCache: false });
        if (!active) return;
        let next = { ...normaliseActionResult(response.data, action), messageId };
        const pending = next.filingNeedsReview !== true && (next.tracking === true || ['draft_created', 'submitted'].includes(next.status));
        if (pending && Date.now() - startedAt >= ACTION_STATUS_POLL_TIMEOUT_MS) {
          next = {
            ...next,
            status: 'uncertain',
            tracking: false,
            message: 'Microsoft 365 has not confirmed the outcome yet. FCOS will not resend automatically; review Sent Items before retrying.',
          };
        }
        setActionResult((current) => current?.actionId === actionId ? next : current);
        if (next.status === 'confirmed') {
          loadListRef.current?.({ cursor: currentCursor, history: cursorStack, foreground: false, force: true, silent: true });
          return;
        }
        if (next.filingNeedsReview !== true && (next.tracking === true || ['draft_created', 'submitted'].includes(next.status))) schedule();
      } catch (error) {
        if (!active) return;
        if (Date.now() - startedAt >= ACTION_STATUS_POLL_TIMEOUT_MS) {
          setActionResult((current) => current?.actionId === actionId ? {
            ...current,
            status: 'uncertain',
            tracking: false,
            message: 'FCOS could not confirm the Microsoft 365 outcome. It will not resend automatically; review Sent Items before retrying.',
          } : current);
          return;
        }
        schedule();
      }
    };
    schedule();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [actionResult?.actionId]);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 1279px)');
    const update = () => setUseDetailSheet(query.matches);
    query.addEventListener('change', update);
    update();
    return () => query.removeEventListener('change', update);
  }, []);

  const loadRoutingOptions = useCallback(async ({ force = false } = {}) => {
    setDirectoryLoading(true);
    setDirectoryError('');
    try {
      const applyDirectory = (directoryResponse) => {
        const directoryFailure = messageError(directoryResponse.data);
        if (directoryFailure) return;
        setDirectory(directoryResponse.data?.directory || directoryResponse.data?.destinations || directoryResponse.data?.items || []);
        setPresets(directoryResponse.data?.presets || []);
        setRoutingFolders(directoryResponse.data?.folders || []);
      };
      const directoryResponse = await emailRouter.directory({}, { ...navigationCacheOptions('collaboration', applyDirectory), force });
      const directoryFailure = messageError(directoryResponse.data);
      if (directoryFailure) {
        setDirectory([]);
        setPresets([]);
        setRoutingFolders([]);
        setDirectoryError(directoryFailure);
      } else {
        setDirectory(directoryResponse.data?.directory || directoryResponse.data?.destinations || directoryResponse.data?.items || []);
        setPresets(directoryResponse.data?.presets || []);
        setRoutingFolders(directoryResponse.data?.folders || []);
      }
    } catch (error) {
      setDirectory([]);
      setPresets([]);
      setRoutingFolders([]);
      setDirectoryError(error?.message || 'The routing directory is unavailable.');
    } finally {
      setDirectoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRoutingOptions();
  }, [loadRoutingOptions]);

  const loadList = async ({ cursor = null, history = [], foreground = true, force = false, silent = false } = {}) => {
    const startedAt = typeof window !== 'undefined' ? window.performance.now() : 0;
    const id = ++requestId.current;
    if (foreground) setLoading(true); else if (!silent) setLoadingMore(true);
    setListError('');
    try {
      const applyList = (response) => {
        if (id !== requestId.current) return;
        const error = messageError(response.data);
        if (error) {
          setListError(error);
          if (foreground) setMessages([]);
          return;
        }
        const result = normaliseListResponse(response.data);
        setListError('');
        setMessages(result.messages);
        setNextCursor(result.nextCursor);
        setCurrentCursor(cursor);
        setCursorStack(history);
        setSelectedId((selected) => result.messages.some((message) => message.id === selected) ? selected : null);
        setDetail((current) => result.messages.some((message) => message.id === current?.id) ? current : null);
      };
      const response = await emailRouter.list(
        { folder, query: search.trim(), cursor, limit: LIMIT },
        cursor ? { cache: true, cacheTtlMs: 30_000, force } : { ...navigationCacheOptions('collaboration', applyList), force },
      );
      applyList(response);
      recordEmailRouterTiming('mailbox_list', startedAt, response.data?.performance);
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
  loadListRef.current = loadList;

  useEffect(() => {
    const handleBackgroundSync = () => {
      loadListRef.current?.({ cursor: currentCursor, history: cursorStack, foreground: false, force: true, silent: true });
    };
    window.addEventListener('fcos:email-router-synced', handleBackgroundSync);
    return () => window.removeEventListener('fcos:email-router-synced', handleBackgroundSync);
  }, [currentCursor, cursorStack]);

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
    const fallback = messagesRef.current.find((message) => message.id === selectedId) || null;
    setDetail(fallback);
    const applyDetail = (response) => {
      if (!active) return;
      const error = messageError(response.data);
      if (error) setDetailError(error);
      else {
        setDetailError('');
        setDetail(normaliseDetailResponse(response.data));
      }
      setDetailLoading(false);
    };
    const startedAt = window.performance.now();
    emailRouter.detail(
      { messageId: selectedId, hasAttachments: fallback?.hasAttachments === true },
      navigationCacheOptions('collaboration', applyDetail),
    ).then((response) => {
      applyDetail(response);
      recordEmailRouterTiming('message_detail', startedAt, response.data?.performance);
    }).catch((error) => { if (active) setDetailError(error?.message || 'Message details are unavailable.'); }).finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [selectedId]);

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

  const submitAction = async (payload, sourceMessage = detail, { refreshList = true } = {}) => {
    if (!sourceMessage || (['undo', 'retry'].includes(payload.action) && !actionDialog)) return null;
    const startedAt = window.performance.now();
    const operationId = newOperationId();
    const submitted = { status: 'submitted', action: payload.action, messageId: sourceMessage.id, message: 'FCOS submitted the action request and is waiting for confirmation.' };
    setSubmitting(true);
    setActionResult(submitted);
    let response;
    try {
      response = payload.action === 'undo'
        ? await emailRouter.undo({ messageId: sourceMessage.id, undoToken: actionDialog.undoResult?.undoToken, actionId: actionDialog.undoResult?.actionId, operationId })
        : payload.action === 'retry'
          ? await emailRouter.retry({ messageId: sourceMessage.id, actionId: actionDialog.undoResult?.actionId, confirmedNotSent: true, operationId })
        : await emailRouter.action({ messageId: sourceMessage.id, threadId: sourceMessage.threadId || null, operationId, ...payload });
      const result = { ...normaliseActionResult(response.data, payload.action), messageId: sourceMessage.id };
      recordEmailRouterTiming(`action_${payload.action}`, startedAt, response.data?.performance);
      setActionResult(result);
      setDetail((current) => current?.id === sourceMessage.id ? { ...current, actionHistory: [{ id: result.actionId || operationId, action: result.action, status: result.status, detail: result.message, at: new Date().toISOString() }, ...(current.actionHistory || [])] } : current);
      setActionDialog(null);
      if (refreshList && result.status === 'confirmed') loadList({ cursor: currentCursor, history: cursorStack, foreground: false, force: true });
      return result;
    } catch (error) {
      const result = { status: isLikelyUncertain(error?.message) ? 'uncertain' : 'failed', action: payload.action, messageId: sourceMessage.id, message: error?.message || 'The action did not complete.' };
      setActionResult(result);
      setActionDialog(null);
      return result;
    } finally {
      setSubmitting(false);
    }
  };

  const openAction = async (action, undoResult = null) => {
    if (!detail || submitting) return;
    if (action === 'archive' || action === 'move_market_report') {
      const movedMessage = detail;
      const movedIndex = Math.max(0, messagesRef.current.findIndex((message) => message.id === movedMessage.id));
      setMessages((current) => current.filter((message) => message.id !== movedMessage.id));
      setSelectedId(null);
      setDetail(null);
      const payload = action === 'archive'
        ? { action: 'archive' }
        : { action: 'move', destinationFolderKey: 'market_report' };
      const result = await submitAction(payload, movedMessage, { refreshList: false });
      if (result?.status === 'failed') {
        setMessages((current) => {
          if (current.some((message) => message.id === movedMessage.id)) return current;
          const restored = [...current];
          restored.splice(Math.min(movedIndex, restored.length), 0, movedMessage);
          return restored;
        });
        setSelectedId(movedMessage.id);
        setDetail(movedMessage);
      }
      return;
    }
    if (action === 'forward') {
      setRouteAction('forward');
      loadRoutingOptions({ force: true });
      return;
    }
    setActionDialog({ action, undoResult });
  };

  const retryFiling = async () => {
    if (!actionResult?.actionId || submitting) return;
    setSubmitting(true);
    try {
      const response = await emailRouter.retryFiling({ actionId: actionResult.actionId }, { force: true, cache: false });
      setActionResult({ ...normaliseActionResult(response.data, actionResult.action), messageId: actionResult.messageId });
      loadList({ cursor: currentCursor, history: cursorStack, foreground: false, force: true, silent: true });
    } catch (error) {
      setActionResult((current) => ({ ...current, status: 'failed', message: error?.message || 'The source message could not be filed.' }));
    } finally {
      setSubmitting(false);
    }
  };

  const fetchAttachment = useCallback(async (attachment) => {
    if (!detail) return;
    const startedAt = window.performance.now();
    try {
      const session = await supabase.auth.getSession();
      const accessToken = session.data?.session?.access_token;
      if (!accessToken) throw new Error('Sign in again to download this attachment.');
      const downloadFrom = (url) => fetch(url, { headers: { authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
      let streamUrl = attachment.streamUrl && new Date(attachment.streamExpiresAt || 0).getTime() > Date.now()
        ? attachment.streamUrl
        : null;
      if (!streamUrl) {
        const response = await emailRouter.attachmentUrl({ messageId: detail.id, attachmentId: attachment.id || attachment.attachmentId }, { force: true });
        streamUrl = response.data?.url || (response.data?.token ? `/api/email-router-attachment?token=${encodeURIComponent(response.data.token)}` : null);
        if (!streamUrl) throw new Error(messageError(response.data, 'Attachment download is unavailable.'));
      }
      let download = await downloadFrom(streamUrl);
      if (!download.ok && attachment.streamUrl && [401, 403].includes(download.status)) {
        const response = await emailRouter.attachmentUrl({ messageId: detail.id, attachmentId: attachment.id || attachment.attachmentId }, { force: true });
        const refreshedUrl = response.data?.url || (response.data?.token ? `/api/email-router-attachment?token=${encodeURIComponent(response.data.token)}` : null);
        if (refreshedUrl) download = await downloadFrom(refreshedUrl);
      }
      if (!download.ok) {
        const failure = await download.json().catch(() => ({}));
        throw new Error(failure.error || 'Attachment download is unavailable.');
      }
      const blob = await download.blob();
      recordEmailRouterTiming('attachment_open', startedAt);
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
    setSelectedId(messageId);
  };
  const redirectPanel = (className = '') => <EmailRedirectPanel
    message={detail}
    directory={directory}
    presets={presets}
    folders={routingFolders}
    actionMode={routeAction}
    onActionModeChange={setRouteAction}
    directoryLoading={directoryLoading}
    directoryError={directoryError}
    submitting={submitting}
    advisor={advisor}
    advisorLoading={advisorLoading}
    advisorError={advisorError}
    actionResult={actionResult}
    onAdvisor={loadAdvisor}
    onSubmit={submitAction}
    className={className}
  />;

  return <div>
    <PageHeader
      title="Email Router"
      status={<div className="flex items-center gap-2"><ResultNotice result={actionResult} compact />{actionResult?.filingRetryAllowed && <Button size="sm" variant="outline" onClick={retryFiling} disabled={submitting}>Retry filing only</Button>}</div>}
      actions={<>{isAdministrator && <Button size="sm" variant="outline" onClick={() => onSettingsOpenChange(true)}><Settings2 /><span className="sm:hidden">Setup</span><span className="hidden sm:inline">Routing Setup</span></Button>}<Button size="sm" variant="outline" onClick={() => setLeaveOpen(true)}><CalendarOff /><span className="sm:hidden">Leave</span><span className="hidden sm:inline">Routing Leave</span></Button><PageMethodology {...EMAIL_ROUTER_METHODOLOGY} /><Button variant="outline" size="icon" className="h-9 w-9" onClick={() => loadList({ cursor: currentCursor, history: cursorStack, force: true })} disabled={loading || loadingMore} aria-label="Refresh mailbox" title="Refresh mailbox">{loading || loadingMore ? <Loader2 className="animate-spin" /> : <RefreshCw />}</Button></>}
      compact
      className="mb-3"
    />
    <section className="flex min-h-[620px] flex-col overflow-hidden border border-border bg-background xl:h-[calc(100dvh-8rem)]">
      <div className="flex shrink-0 items-center gap-3 overflow-x-auto border-b border-border px-3 py-2">
        <Tabs value={folder} onValueChange={setFolder} className="shrink-0"><TabsList><TabsTrigger value="inbox" className="gap-1.5"><Inbox className="h-3.5 w-3.5" />Inbox</TabsTrigger><TabsTrigger value="sent" className="gap-1.5"><Send className="h-3.5 w-3.5" />Sent</TabsTrigger><TabsTrigger value="archive" className="gap-1.5"><Archive className="h-3.5 w-3.5" />Archive</TabsTrigger></TabsList></Tabs>
        <span className="h-7 shrink-0 border-l border-border" aria-hidden="true" />
        <span className="shrink-0 text-[11px] font-semibold uppercase text-blue-700">Actions</span>
        <EmailMessageActions message={detail} actionResult={actionResult} actionPending={submitting} onAction={openAction} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
        <div className="flex min-h-0 w-full flex-col border-b border-border xl:w-[340px] xl:shrink-0 xl:border-b-0 xl:border-r">
          <div className="border-b border-border p-3"><div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search sender, subject, or content" className="pl-9" /></div></div>
          <EmailMessageList messages={messages} selectedId={selectedId} loading={loading} loadingMore={loadingMore} error={listError} folder={folder} hasPrevious={cursorStack.length > 0} hasNext={Boolean(nextCursor)} onSelect={selectMessage} onPrevious={previous} onNext={next} />
        </div>
        {!useDetailSheet && <><div className="min-h-0 min-w-0 flex-1 overflow-y-auto"><EmailMessageDetail message={detail} loading={detailLoading} error={detailError} actionResult={actionResult} actionPending={submitting} onAction={openAction} onFetchAttachment={fetchAttachment} onDownloadAttachment={downloadAttachment} showActions={false} /></div>{redirectPanel('w-[390px] shrink-0')}</>}
      </div>
    </section>
    {useDetailSheet && <EmailMessageSheet open={Boolean(selectedId)} onOpenChange={(open) => !open && setSelectedId(null)} message={detail} loading={detailLoading} error={detailError} actionResult={actionResult} actionPending={submitting} onAction={openAction} onFetchAttachment={fetchAttachment} onDownloadAttachment={downloadAttachment} redirectPanel={redirectPanel('border-l-0 border-t')} />}
    <EmailActionDialog open={Boolean(actionDialog)} onOpenChange={(open) => !open && setActionDialog(null)} action={actionDialog?.action} message={detail} submitting={submitting} onSubmit={submitAction} />
    <EmailRoutingLeaveDialog open={leaveOpen} onOpenChange={(open) => { setLeaveOpen(open); if (!open) loadRoutingOptions({ force: true }); }} canManageAll={isAdministrator} />
    {isAdministrator && <Dialog open={settingsOpen} onOpenChange={onSettingsOpenChange}>
      <DialogContent className="grid h-[min(92dvh,58rem)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden p-0 sm:max-w-[min(96vw,92rem)]">
        <DialogHeader className="border-b border-border px-5 py-4 pr-12">
          <DialogTitle>Routing Setup</DialogTitle>
          <DialogDescription>Manage the routing directory, presets, leave rules, approved filing folders, and company routing learning.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto p-4 lg:p-5"><EmailRouterSettings embedded /></div>
      </DialogContent>
    </Dialog>}
  </div>;
}
