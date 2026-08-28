import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  CircleAlert,
  Eye,
  FilePenLine,
  Loader2,
  MailCheck,
  MailWarning,
  Megaphone,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  SkipForward,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { appClient } from '@/api/appClient';
import { cn } from '@/lib/utils';
import StateBlock from '@/components/common/StateBlock';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const VIEW_OPTIONS = [
  { id: 'pending', label: 'Pending' },
  { id: 'batches', label: 'Batches' },
  { id: 'sent', label: 'Sent' },
  { id: 'skipped', label: 'Skipped' },
];
const ITEMS_PER_PAGE = 50;

const CATEGORY_LABELS = {
  new_feature: 'New Feature',
  improved_logic: 'Improved Logic',
  major_bug_fix: 'Major Bug Fix',
};

const CATEGORY_STYLES = {
  new_feature: 'border-blue-200 bg-blue-50 text-blue-700',
  improved_logic: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  major_bug_fix: 'border-amber-200 bg-amber-50 text-amber-800',
};

const STATUS_STYLES = {
  Draft: 'border-slate-200 bg-slate-50 text-slate-700',
  Sending: 'border-blue-200 bg-blue-50 text-blue-700',
  Sent: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  'Partial Failure': 'border-red-200 bg-red-50 text-red-700',
  Cancelled: 'border-slate-200 bg-slate-100 text-slate-500',
};

const EMPTY_BATCH = {
  id: null,
  revision: 0,
  status: 'Draft',
  subject: '',
  introduction: 'The following FCOS updates are now available.',
  closing: 'Please sign in to FCOS to review the latest changes.',
  items: [],
  recipients: [],
  deliveries: [],
};

function formatDate(value, includeTime = false) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      ...(includeTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
      timeZone: 'Asia/Hong_Kong',
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function matchesKeyword(values, keyword) {
  if (!keyword) return true;
  return values.join(' ').toLowerCase().includes(keyword.toLowerCase());
}

function itemBatchDraft(item) {
  return {
    itemId: item.id,
    category: item.category || 'improved_logic',
    emailTitle: item.emailTitle || item.sourceTitle,
    emailBody: item.emailBody || item.sourceText,
    expectedRevision: item.revision,
    sourceVersion: item.sourceVersion,
    sourceReleaseDate: item.sourceReleaseDate,
  };
}

function batchFromRecord(batch) {
  return {
    ...EMPTY_BATCH,
    ...batch,
    items: (batch.items || []).map((item) => ({
      itemId: item.itemId,
      category: item.category,
      emailTitle: item.emailTitle,
      emailBody: item.emailBody,
      expectedRevision: item.source?.revision || item.itemRevisionSnapshot,
      sourceVersion: item.source?.sourceVersion || '',
      sourceReleaseDate: item.source?.sourceReleaseDate || '',
    })),
    recipients: (batch.recipients || []).map((recipient) => ({
      userId: recipient.userId,
      name: recipient.name,
      email: recipient.email,
    })),
  };
}

function comparableBatch(batch) {
  return JSON.stringify({
    subject: batch?.subject || '',
    introduction: batch?.introduction || '',
    closing: batch?.closing || '',
    items: (batch?.items || []).map((item) => ({
      itemId: item.itemId,
      category: item.category,
      emailTitle: item.emailTitle,
      emailBody: item.emailBody,
      expectedRevision: item.expectedRevision,
    })),
    recipients: (batch?.recipients || []).map((recipient) => ({
      userId: recipient.userId,
      name: recipient.name,
      email: recipient.email,
    })),
  });
}

function ViewButton({ active, count, children, onClick }) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? 'default' : 'outline'}
      onClick={onClick}
      className="min-w-[112px]"
    >
      {children}
      <span className={cn(
        'ml-1 rounded px-1.5 py-0.5 text-[10px]',
        active ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground',
      )}>
        {count}
      </span>
    </Button>
  );
}

function CategorySelect({ value, disabled, onChange }) {
  return (
    <select
      value={value || 'improved_logic'}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="h-9 rounded-md border border-input bg-background px-2 text-xs font-semibold disabled:opacity-60"
    >
      <option value="new_feature">New Feature</option>
      <option value="improved_logic">Improved Logic</option>
      <option value="major_bug_fix">Major Bug Fix</option>
    </select>
  );
}

export default function FcosUpdatesPanel() {
  const [model, setModel] = useState({
    items: [],
    batches: [],
    counters: {},
    authority: {},
    settings: {},
    activeRecipientCount: 0,
  });
  const [view, setView] = useState('pending');
  const [itemPage, setItemPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [editItem, setEditItem] = useState(null);
  const [batchDraft, setBatchDraft] = useState(EMPTY_BATCH);
  const [batchOpen, setBatchOpen] = useState(false);
  const [reasonAction, setReasonAction] = useState(null);
  const [reason, setReason] = useState('');
  const [sendConfirmation, setSendConfirmation] = useState(null);
  const [discardConfirmation, setDiscardConfirmation] = useState(false);
  const [addRecipientId, setAddRecipientId] = useState('');

  const applyModel = (nextModel) => {
    setModel(nextModel || {});
    setSelectedIds((current) => current.filter((id) => (
      nextModel?.items || []
    ).some((item) => item.id === id && item.status === 'Pending' && !item.assignedBatchId)));
  };

  const load = async ({
    force = false,
    sync = false,
    blocking = false,
    includePreparation = true,
  } = {}) => {
    if (blocking) setLoading(true);
    setError('');
    try {
      const response = await appClient.functions.invoke('adminFcosUpdatesList', {
        sync,
        includePreparation,
      }, {
        cache: true,
        force,
        cacheKey: `adminFcosUpdatesList:${sync ? 'sync' : 'read'}:${includePreparation ? 'full' : 'queue'}`,
      });
      if (response.data?.error) setError(response.data.error);
      else applyModel(response.data);
    } catch (loadError) {
      setError(loadError.message || 'FCOS updates could not be loaded.');
    } finally {
      if (blocking) setLoading(false);
    }
  };

  const syncReleases = async ({ announce = false } = {}) => {
    setSyncing(true);
    if (announce) clearFeedback();
    try {
      const response = await appClient.functions.invoke('adminFcosUpdatesSync', {}, { cache: false });
      if (response.data?.error) setError(response.data.error);
      else {
        applyModel(response.data);
        if (announce) setMessage('Release queue is up to date.');
      }
    } catch (syncError) {
      setError(syncError.message || 'The release check could not be completed. The saved queue remains available.');
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    load({
      force: false,
      sync: false,
      blocking: true,
      includePreparation: false,
    }).then(() => syncReleases());
  }, []);

  const pendingItems = useMemo(() => (model.items || []).filter((item) => (
    item.status === 'Pending' && !item.assignedBatchId
  )), [model.items]);
  const sentItems = useMemo(() => (model.items || []).filter((item) => item.status === 'Sent'), [model.items]);
  const skippedItems = useMemo(() => (model.items || []).filter((item) => item.status === 'Skipped'), [model.items]);
  const filteredItems = useMemo(() => {
    const source = view === 'sent' ? sentItems : view === 'skipped' ? skippedItems : pendingItems;
    return source.filter((item) => matchesKeyword([
      item.sourceVersion,
      item.sourceTitle,
      item.sourceText,
      item.emailTitle,
      item.emailBody,
      CATEGORY_LABELS[item.category],
      item.skipReason,
    ], keyword));
  }, [keyword, pendingItems, sentItems, skippedItems, view]);
  const filteredBatches = useMemo(() => (model.batches || []).filter((batch) => matchesKeyword([
    batch.subject,
    batch.status,
    batch.createdByEmail,
    batch.updatedByEmail,
    ...(batch.items || []).flatMap((item) => [item.emailTitle, item.emailBody, item.source?.sourceVersion]),
  ], keyword)), [keyword, model.batches]);
  const itemPageCount = Math.max(1, Math.ceil(filteredItems.length / ITEMS_PER_PAGE));
  const boundedItemPage = Math.min(itemPage, itemPageCount);
  const visibleItems = useMemo(() => filteredItems.slice(
    (boundedItemPage - 1) * ITEMS_PER_PAGE,
    boundedItemPage * ITEMS_PER_PAGE,
  ), [boundedItemPage, filteredItems]);
  const storedBatch = useMemo(
    () => (model.batches || []).find((batch) => batch.id === batchDraft.id) || null,
    [batchDraft.id, model.batches],
  );
  const batchIsDirty = useMemo(
    () => !batchDraft.id || !storedBatch || comparableBatch(batchDraft) !== comparableBatch(batchFromRecord(storedBatch)),
    [batchDraft, storedBatch],
  );

  const clearFeedback = () => {
    setError('');
    setMessage('');
  };

  const runAction = async (key, name, payload, successMessage, options = {}) => {
    setWorking(key);
    clearFeedback();
    const response = await appClient.functions.invoke(name, payload);
    setWorking('');
    if (response.data?.error) {
      setError(response.data.error);
      return false;
    }
    if (successMessage) setMessage(successMessage);
    await load({ force: true, sync: options.sync === true });
    return true;
  };

  const toggleSelection = (itemId) => {
    setSelectedIds((current) => current.includes(itemId)
      ? current.filter((id) => id !== itemId)
      : [...current, itemId]);
  };

  const openNewBatch = () => {
    const selected = selectedIds
      .map((id) => pendingItems.find((item) => item.id === id))
      .filter(Boolean);
    if (!selected.length) return;
    setBatchDraft({
      ...EMPTY_BATCH,
      subject: selected.length === 1
        ? `FCOS Update: ${selected[0].emailTitle || selected[0].sourceTitle}`
        : `FCOS Updates: ${selected.length} changes`,
      items: selected.map(itemBatchDraft),
      recipients: (model.activeRecipients || []).map((recipient) => ({
        userId: recipient.userId,
        name: recipient.name,
        email: recipient.email,
      })),
    });
    setAddRecipientId('');
    setBatchOpen(true);
  };

  const openBatch = (batch) => {
    const draft = batchFromRecord(batch);
    if (
      !draft.recipients.length
      && draft.status === 'Draft'
    ) {
      draft.recipients = (model.activeRecipients || []).map((recipient) => ({
        userId: recipient.userId,
        name: recipient.name,
        email: recipient.email,
      }));
    }
    setBatchDraft(draft);
    setAddRecipientId('');
    setBatchOpen(true);
  };

  const saveItem = async () => {
    if (!editItem) return;
    const succeeded = await runAction(
      `item:${editItem.id}`,
      'adminFcosUpdateItemSave',
      {
        itemId: editItem.id,
        expectedRevision: editItem.revision,
        category: editItem.category,
        emailTitle: editItem.emailTitle,
        emailBody: editItem.emailBody,
      },
      'Update wording saved.',
    );
    if (succeeded) setEditItem(null);
  };

  const updateBatchItem = (index, patch) => {
    setBatchDraft((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    }));
  };

  const moveBatchItem = (index, direction) => {
    setBatchDraft((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.items.length) return current;
      const items = [...current.items];
      [items[index], items[target]] = [items[target], items[index]];
      return { ...current, items };
    });
  };

  const removeBatchItem = (index) => {
    setBatchDraft((current) => ({
      ...current,
      items: current.items.filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const updateRecipient = (index, patch) => {
    setBatchDraft((current) => ({
      ...current,
      recipients: current.recipients.map((recipient, recipientIndex) => (
        recipientIndex === index ? { ...recipient, ...patch } : recipient
      )),
    }));
  };

  const removeRecipient = (index) => {
    setBatchDraft((current) => ({
      ...current,
      recipients: current.recipients.filter((_, recipientIndex) => recipientIndex !== index),
    }));
  };

  const addRecipient = () => {
    const recipient = (model.activeRecipients || []).find((item) => item.userId === addRecipientId);
    if (!recipient || batchDraft.recipients.some((item) => item.userId === recipient.userId)) return;
    setBatchDraft((current) => ({
      ...current,
      recipients: [
        ...current.recipients,
        { userId: recipient.userId, name: recipient.name, email: recipient.email },
      ],
    }));
    setAddRecipientId('');
  };

  const saveBatch = async () => {
    const response = await appClient.functions.invoke('adminFcosUpdateBatchSave', {
      batchId: batchDraft.id,
      expectedRevision: batchDraft.revision,
      subject: batchDraft.subject,
      introduction: batchDraft.introduction,
      closing: batchDraft.closing,
      items: batchDraft.items,
      recipients: batchDraft.recipients,
    });
    if (response.data?.error) {
      setError(response.data.error);
      return null;
    }
    setMessage('FCOS update email draft saved.');
    setSelectedIds([]);
    const savedId = response.data?.batch?.id || batchDraft.id;
    const listResponse = await appClient.functions.invoke('adminFcosUpdatesList', { sync: false }, { force: true });
    if (listResponse.data?.error) {
      setError(listResponse.data.error);
      return null;
    }
    setModel(listResponse.data || {});
    const saved = (listResponse.data?.batches || []).find((batch) => batch.id === savedId);
    if (saved) setBatchDraft(batchFromRecord(saved));
    return saved || response.data?.batch || null;
  };

  const saveAndCloseBatch = async () => {
    setWorking('batch:save');
    clearFeedback();
    const saved = await saveBatch();
    setWorking('');
    if (saved) setBatchOpen(false);
  };

  const openReasonAction = (type, target) => {
    setReason('');
    setReasonAction({ type, target });
  };

  const executeReasonAction = async () => {
    if (!reasonAction) return;
    const actionMap = {
      skip: {
        name: 'adminFcosUpdateItemSkip',
        payload: {
          itemId: reasonAction.target.id,
          expectedRevision: reasonAction.target.revision,
          reason,
        },
        message: 'Update skipped.',
      },
      restore: {
        name: 'adminFcosUpdateItemRestore',
        payload: {
          itemId: reasonAction.target.id,
          expectedRevision: reasonAction.target.revision,
          reason,
        },
        message: 'Update restored to Pending.',
      },
      cancel: {
        name: 'adminFcosUpdateBatchCancel',
        payload: {
          batchId: reasonAction.target.id,
          expectedRevision: reasonAction.target.revision,
          reason,
        },
        message: 'Email batch cancelled.',
      },
    };
    const action = actionMap[reasonAction.type];
    if (!action) return;
    const succeeded = await runAction(
      `reason:${reasonAction.type}`,
      action.name,
      action.payload,
      action.message,
    );
    if (succeeded) {
      setReasonAction(null);
      setReason('');
      if (reasonAction.type === 'cancel') setBatchOpen(false);
    }
  };

  const sendBatch = async () => {
    if (!sendConfirmation) return;
    const succeeded = await runAction(
      'batch:send',
      'adminFcosUpdateBatchSend',
      {
        batchId: sendConfirmation.id,
        expectedRevision: sendConfirmation.revision,
        expectedRecipientCount: sendConfirmation.recipientCount,
      },
      'FCOS update email delivery completed.',
    );
    if (succeeded) {
      setSendConfirmation(null);
      setBatchOpen(false);
    }
  };

  const retryDeliveries = async (includeUncertain) => {
    const uncertainCount = Number(batchDraft.uncertainCount || 0);
    if (includeUncertain && uncertainCount && !window.confirm(
      `${uncertainCount} uncertain deliver${uncertainCount === 1 ? 'y' : 'ies'} may already have been received. Send them again?`,
    )) return;
    const succeeded = await runAction(
      `batch:retry:${includeUncertain}`,
      'adminFcosUpdateDeliveryRetry',
      {
        batchId: batchDraft.id,
        expectedRevision: batchDraft.revision,
        includeUncertain,
        confirmUncertain: includeUncertain,
      },
      'Delivery retry completed.',
    );
    if (succeeded) setBatchOpen(false);
  };

  const openSendConfirmation = async () => {
    if (batchIsDirty) {
      setError('Save these changes before sending.');
      return;
    }
    setWorking('batch:preflight');
    clearFeedback();
    const response = await appClient.functions.invoke(
      'adminFcosUpdatesList',
      { sync: false },
      { force: true },
    );
    setWorking('');
    if (response.data?.error) {
      setError(response.data.error);
      return;
    }
    setModel(response.data || {});
    const current = (response.data?.batches || []).find((batch) => batch.id === batchDraft.id);
    if (!current || current.status !== 'Draft' || current.revision !== batchDraft.revision) {
      setError('This draft changed after it was opened. Review and save the current revision before sending.');
      return;
    }
    setSendConfirmation({
      ...current,
      recipientCount: Number(current.recipients?.length || 0),
    });
  };

  const requestBatchClose = () => {
    if (batchIsDirty) {
      setDiscardConfirmation(true);
      return;
    }
    setBatchOpen(false);
  };

  const counts = {
    pending: model.counters?.pending || 0,
    batches: model.batches?.length || 0,
    sent: model.counters?.sent || 0,
    skipped: model.counters?.skipped || 0,
  };
  const batchReadOnly = ['Sending', 'Sent', 'Partial Failure', 'Cancelled'].includes(batchDraft.status);
  const canControl = model.authority?.canControl === true && model.preparationReady === true;
  const availableRecipients = (model.activeRecipients || []).filter((recipient) => (
    !batchDraft.recipients.some((selected) => selected.userId === recipient.userId)
  ));

  return (
    <div className="min-h-[calc(100vh-322px)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <p className="text-xs text-muted-foreground">
            Release history from {formatDate(model.settings?.backfillStart)} onward
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={canControl
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-slate-200 bg-slate-50 text-slate-600'}
            >
              {canControl ? 'Draft and send' : 'Draft preparation'}
            </Badge>
            <Button
              size="sm"
              variant="outline"
              disabled={loading || syncing || Boolean(working)}
              onClick={() => syncReleases({ announce: true })}
            >
              {loading || syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {syncing ? 'Checking releases' : 'Check releases'}
            </Button>
          </div>
      </div>

      {error && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {message && (
        <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex flex-wrap gap-2">
          {VIEW_OPTIONS.map((option) => (
            <ViewButton
              key={option.id}
              active={view === option.id}
              count={counts[option.id]}
              onClick={() => { setView(option.id); setItemPage(1); }}
            >
              {option.label}
            </ViewButton>
          ))}
        </div>
        <div className="flex min-w-0 w-full flex-wrap justify-end gap-2 lg:w-auto lg:flex-1">
          <div className="relative min-w-[180px] flex-1 lg:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(event) => { setKeyword(event.target.value); setItemPage(1); }}
              placeholder="Search version or update"
              className="pl-9"
            />
          </div>
          {view === 'pending' && (
            <Button size="sm" className="shrink-0" disabled={!selectedIds.length} onClick={openNewBatch}>
              <Megaphone className="h-4 w-4" />
              Create email ({selectedIds.length})
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <StateBlock icon={Loader2} title="Loading FCOS updates..." description="Opening the saved release queue." />
      ) : view === 'batches' ? (
        filteredBatches.length ? (
          <div className="divide-y divide-border">
            {filteredBatches.map((batch) => (
              <button
                key={batch.id}
                type="button"
                onClick={() => openBatch(batch)}
                className="grid w-full gap-3 px-4 py-3 text-left hover:bg-muted/30 md:grid-cols-[minmax(0,1fr)_150px_120px_150px]"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground">{batch.subject}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {batch.items.length} update{batch.items.length === 1 ? '' : 's'} · Updated {formatDate(batch.updatedAt, true)}
                  </div>
                </div>
                <Badge variant="outline" className={cn('w-fit self-center', STATUS_STYLES[batch.status])}>{batch.status}</Badge>
                <div className="self-center text-xs text-muted-foreground">
                  {batch.recipientCount || batch.recipients?.length || 0} recipients
                </div>
                <div className="self-center text-xs text-muted-foreground">
                  {batch.status === 'Partial Failure'
                    ? `${batch.failedCount} failed · ${batch.uncertainCount} uncertain`
                    : batch.status === 'Sent'
                      ? `${batch.sentCount} sent`
                    : batch.updatedByEmail
                      ? `Saved by ${batch.updatedByEmail}`
                      : batch.createdByEmail}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <StateBlock title="No email batches found" description="Create a batch from one or more pending release updates." />
        )
      ) : filteredItems.length ? (
        <>
          <div className="divide-y divide-border">
            {visibleItems.map((item) => (
            <div key={item.id} className="grid gap-3 px-4 py-4 md:grid-cols-[28px_minmax(0,1fr)_auto]">
              <div className="pt-1">
                {view === 'pending' ? (
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(item.id)}
                    onChange={() => toggleSelection(item.id)}
                    aria-label={`Select version ${item.sourceVersion} update`}
                  />
                ) : (
                  <span className={cn(
                    'block h-2.5 w-2.5 rounded-full',
                    view === 'sent' ? 'bg-emerald-500' : 'bg-slate-400',
                  )} />
                )}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-muted-foreground">Version {item.sourceVersion}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(item.sourceReleaseDate)}</span>
                  <Badge variant="outline" className={CATEGORY_STYLES[item.category]}>
                    {CATEGORY_LABELS[item.category] || 'Needs classification'}
                  </Badge>
                  {item.sourceChanged && (
                    <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">Source changed</Badge>
                  )}
                </div>
                <div className="mt-1 text-sm font-semibold text-foreground">{item.emailTitle}</div>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{item.emailBody}</p>
                {view === 'skipped' && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Skipped by {item.skippedByEmail || 'General Manager'} on {formatDate(item.skippedAt, true)} · {item.skipReason}
                  </div>
                )}
                {view === 'sent' && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Sent {formatDate(item.sentAt, true)}
                  </div>
                )}
              </div>
              <div className="flex items-start gap-2">
                {view === 'pending' && (
                  <>
                    <Button size="icon" variant="outline" title="Edit update wording" onClick={() => setEditItem({ ...item })}>
                      <FilePenLine className="h-4 w-4" />
                    </Button>
                    {canControl && (
                      <Button size="icon" variant="outline" title="Skip update" onClick={() => openReasonAction('skip', item)}>
                        <SkipForward className="h-4 w-4" />
                      </Button>
                    )}
                  </>
                )}
                {view === 'skipped' && canControl && (
                  <Button size="sm" variant="outline" onClick={() => openReasonAction('restore', item)}>
                    <RotateCcw className="h-4 w-4" />
                    Restore
                  </Button>
                )}
              </div>
            </div>
            ))}
          </div>
          {itemPageCount > 1 ? <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
            <span>Page {boundedItemPage} of {itemPageCount} · {filteredItems.length} updates</span>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" disabled={boundedItemPage === 1} onClick={() => setItemPage((page) => Math.max(1, page - 1))}>Previous</Button>
              <Button type="button" size="sm" variant="outline" disabled={boundedItemPage === itemPageCount} onClick={() => setItemPage((page) => Math.min(itemPageCount, page + 1))}>Next</Button>
            </div>
          </div> : null}
        </>
      ) : (
        <StateBlock
          title={`No ${view} updates found`}
          description={keyword ? 'No updates match the current search.' : 'No release updates currently require attention.'}
        />
      )}

      <Dialog open={Boolean(editItem)} onOpenChange={(open) => !open && setEditItem(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit FCOS update</DialogTitle>
            <DialogDescription>
              Keep the wording concise and suitable for every active FCOS user.
            </DialogDescription>
          </DialogHeader>
          {editItem && (
            <div className="space-y-4">
              <div className="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
                <div className="font-semibold text-foreground">Version {editItem.sourceVersion} · {editItem.sourceTitle}</div>
                <div className="mt-1">{editItem.sourceText}</div>
              </div>
              <div>
                <Label>Category</Label>
                <div className="mt-1">
                  <CategorySelect
                    value={editItem.category}
                    onChange={(category) => setEditItem((current) => ({ ...current, category }))}
                  />
                </div>
              </div>
              <div>
                <Label>Update title</Label>
                <Input
                  className="mt-1"
                  maxLength={200}
                  value={editItem.emailTitle}
                  onChange={(event) => setEditItem((current) => ({ ...current, emailTitle: event.target.value }))}
                />
              </div>
              <div>
                <Label>Update description</Label>
                <Textarea
                  className="mt-1 min-h-28"
                  maxLength={4000}
                  value={editItem.emailBody}
                  onChange={(event) => setEditItem((current) => ({ ...current, emailBody: event.target.value }))}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditItem(null)}>Cancel</Button>
            <Button onClick={saveItem} disabled={working === `item:${editItem?.id}`}>
              {working === `item:${editItem?.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={batchOpen}
        onOpenChange={(open) => {
          if (open) setBatchOpen(true);
          else requestBatchClose();
        }}
      >
        <DialogContent className="max-h-[94vh] max-w-5xl overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-5 py-4">
            <DialogTitle className="flex items-center gap-2">
              <Megaphone className="h-5 w-5" />
              {batchDraft.id ? 'FCOS update email' : 'Create FCOS update email'}
            </DialogTitle>
            <DialogDescription>
              {batchDraft.id
                ? `${batchDraft.status} · Revision ${batchDraft.revision}`
                : 'Review and arrange the selected updates before saving the draft.'}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[calc(94vh-150px)] overflow-auto px-5 py-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
              <div className="min-w-0 space-y-4">
                <div>
                  <Label>Email subject</Label>
                  <Input
                    className="mt-1"
                    maxLength={200}
                    disabled={batchReadOnly}
                    value={batchDraft.subject}
                    onChange={(event) => setBatchDraft((current) => ({ ...current, subject: event.target.value }))}
                  />
                </div>
                <div>
                  <Label>Introduction</Label>
                  <Textarea
                    className="mt-1 min-h-20"
                    maxLength={2000}
                    disabled={batchReadOnly}
                    value={batchDraft.introduction}
                    onChange={(event) => setBatchDraft((current) => ({ ...current, introduction: event.target.value }))}
                  />
                </div>

                <div>
                  <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <Label>Recipients</Label>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Each recipient receives a separate private email. Save all recipient changes before the General Manager sends.
                      </p>
                    </div>
                    <span className="text-xs font-semibold text-muted-foreground">
                      {batchDraft.recipients.length} selected
                    </span>
                  </div>
                  {!batchReadOnly && availableRecipients.length > 0 && (
                    <div className="mb-2 flex min-w-0 gap-2">
                      <select
                        value={addRecipientId}
                        onChange={(event) => setAddRecipientId(event.target.value)}
                        className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                        aria-label="Add active FCOS recipient"
                      >
                        <option value="">Add an active FCOS user...</option>
                        {availableRecipients.map((recipient) => (
                          <option key={recipient.userId} value={recipient.userId}>
                            {recipient.name} · {recipient.email}
                          </option>
                        ))}
                      </select>
                      <Button type="button" variant="outline" onClick={addRecipient} disabled={!addRecipientId}>
                        <UserPlus className="h-4 w-4" />
                        Add
                      </Button>
                    </div>
                  )}
                  <div className="max-h-72 overflow-auto border-y border-border">
                    {batchDraft.recipients.map((recipient, index) => (
                      <div
                        key={recipient.userId}
                        className="grid gap-2 border-b border-border py-2 last:border-b-0 sm:grid-cols-[minmax(140px,0.8fr)_minmax(220px,1.2fr)_36px]"
                      >
                        <Input
                          maxLength={255}
                          disabled={batchReadOnly}
                          value={recipient.name}
                          aria-label={`Recipient ${index + 1} name`}
                          onChange={(event) => updateRecipient(index, { name: event.target.value })}
                        />
                        <Input
                          type="email"
                          maxLength={320}
                          disabled={batchReadOnly}
                          value={recipient.email}
                          aria-label={`Recipient ${index + 1} email`}
                          onChange={(event) => updateRecipient(index, { email: event.target.value })}
                        />
                        {!batchReadOnly && (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            title="Remove recipient"
                            onClick={() => removeRecipient(index)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                    {!batchDraft.recipients.length && (
                      <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                        Add at least one active FCOS recipient before saving.
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-y border-border">
                  {batchDraft.items.map((item, index) => (
                    <div key={item.itemId} className="space-y-3 border-b border-border py-4 last:border-b-0">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-semibold text-muted-foreground">
                          {index + 1}. Version {item.sourceVersion} · {formatDate(item.sourceReleaseDate)}
                        </div>
                        {!batchReadOnly && (
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" disabled={index === 0} title="Move up" onClick={() => moveBatchItem(index, -1)}>
                              <ArrowUp className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" disabled={index === batchDraft.items.length - 1} title="Move down" onClick={() => moveBatchItem(index, 1)}>
                              <ArrowDown className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" title="Remove from email" onClick={() => removeBatchItem(index)}>
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                      <CategorySelect
                        value={item.category}
                        disabled={batchReadOnly}
                        onChange={(category) => updateBatchItem(index, { category })}
                      />
                      <Input
                        maxLength={200}
                        disabled={batchReadOnly}
                        value={item.emailTitle}
                        onChange={(event) => updateBatchItem(index, { emailTitle: event.target.value })}
                      />
                      <Textarea
                        className="min-h-24"
                        maxLength={4000}
                        disabled={batchReadOnly}
                        value={item.emailBody}
                        onChange={(event) => updateBatchItem(index, { emailBody: event.target.value })}
                      />
                    </div>
                  ))}
                </div>

                <div>
                  <Label>Closing</Label>
                  <Textarea
                    className="mt-1 min-h-20"
                    maxLength={1000}
                    disabled={batchReadOnly}
                    value={batchDraft.closing}
                    onChange={(event) => setBatchDraft((current) => ({ ...current, closing: event.target.value }))}
                  />
                </div>

                {batchDraft.deliveries?.length > 0 && (
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <Label>Recipient delivery results</Label>
                      <span className="text-xs text-muted-foreground">
                        {batchDraft.sentCount} sent · {batchDraft.failedCount} failed · {batchDraft.uncertainCount} uncertain
                      </span>
                    </div>
                    <div className="max-h-56 overflow-auto border-y border-border">
                      {batchDraft.deliveries.map((delivery) => (
                        <div key={delivery.id} className="grid gap-2 border-b border-border px-2 py-2 text-xs last:border-b-0 sm:grid-cols-[minmax(0,1fr)_110px_90px]">
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-foreground">{delivery.recipientName}</div>
                            <div className="truncate text-muted-foreground">{delivery.recipientEmail}</div>
                            {delivery.lastError && <div className="mt-1 break-words text-red-600 [overflow-wrap:anywhere]">{delivery.lastError}</div>}
                          </div>
                          <div className="text-muted-foreground">{formatDate(delivery.lastAttemptAt, true)}</div>
                          <Badge variant="outline" className={cn(
                            'h-fit w-fit',
                            delivery.status === 'Sent'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : delivery.status === 'Failed' || delivery.status === 'Uncertain'
                                ? 'border-red-200 bg-red-50 text-red-700'
                                : 'border-blue-200 bg-blue-50 text-blue-700',
                          )}>
                            {delivery.status}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="min-w-0 border-l-0 border-border lg:border-l lg:pl-4">
                <div className="sticky top-0">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                      <Eye className="h-4 w-4" />
                      Email preview
                    </div>
                    <span className="text-xs text-muted-foreground">{batchDraft.recipients.length} recipients</span>
                  </div>
                  <div className="border-y border-border bg-slate-50 px-4 py-5">
                    <div className="text-xs font-bold text-blue-700">FCOS</div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      From: {model.sender?.name || 'FCOS Updates'} &lt;{model.sender?.address || 'Sender not configured'}&gt;
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      Microsoft Graph with Vercel OIDC · {model.sender?.authenticatedAddress || 'Mailbox not configured'}
                    </div>
                    <div className="mt-1 text-xl font-semibold text-slate-950">System updates</div>
                    {batchDraft.introduction && (
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{batchDraft.introduction}</p>
                    )}
                    <div className="mt-4 space-y-4">
                      {batchDraft.items.map((item) => (
                        <section key={item.itemId} className="border-y border-slate-200 bg-white px-3 py-3">
                          <div className="text-[10px] font-bold uppercase text-blue-700">{CATEGORY_LABELS[item.category]}</div>
                          <div className="mt-1 text-sm font-semibold text-slate-950">{item.emailTitle}</div>
                          <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-600">{item.emailBody}</p>
                          <div className="mt-2 text-[10px] text-slate-400">Version {item.sourceVersion} · {item.sourceReleaseDate}</div>
                        </section>
                      ))}
                    </div>
                    {batchDraft.closing && (
                      <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-600">{batchDraft.closing}</p>
                    )}
                    <div className="mt-4 inline-flex h-9 items-center rounded-md bg-blue-700 px-4 text-xs font-bold text-white">
                      Open FCOS
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="flex-wrap border-t border-border px-5 py-3 sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {batchDraft.id
                && !['Sending', 'Sent', 'Partial Failure', 'Cancelled'].includes(batchDraft.status)
                && batchDraft.status === 'Draft' && (
                <Button variant="outline" onClick={() => openReasonAction('cancel', batchDraft)}>
                  <Trash2 className="h-4 w-4" />
                  Cancel batch
                </Button>
              )}
              {batchDraft.status === 'Partial Failure' && canControl && batchDraft.failedCount > 0 && (
                <Button variant="outline" onClick={() => retryDeliveries(false)}>
                  <RotateCcw className="h-4 w-4" />
                  Retry failed
                </Button>
              )}
              {batchDraft.status === 'Partial Failure' && canControl && batchDraft.uncertainCount > 0 && (
                <Button variant="outline" onClick={() => retryDeliveries(true)}>
                  <CircleAlert className="h-4 w-4" />
                  Retry uncertain
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={requestBatchClose}>Close</Button>
              {!batchReadOnly && (
                <Button
                  variant="outline"
                  onClick={saveAndCloseBatch}
                  disabled={!batchDraft.items.length || !batchDraft.recipients.length || (Boolean(batchDraft.id) && !batchIsDirty) || working === 'batch:save'}
                >
                  {working === 'batch:save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save draft
                </Button>
              )}
              {batchDraft.status === 'Draft' && canControl && Boolean(batchDraft.id) && (
                <Button onClick={openSendConfirmation} disabled={Boolean(working) || batchIsDirty}>
                  {working === 'batch:preflight' ? <Loader2 className="h-4 w-4 animate-spin" /> : <MailCheck className="h-4 w-4" />}
                  Send now
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={discardConfirmation} onOpenChange={setDiscardConfirmation}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>
              The email preview contains changes that have not been saved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscardConfirmation(false)}>Continue editing</Button>
            <Button
              variant="destructive"
              onClick={() => {
                setDiscardConfirmation(false);
                setBatchOpen(false);
              }}
            >
              Discard changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(reasonAction)} onOpenChange={(open) => !open && setReasonAction(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {reasonAction?.type === 'skip' && 'Skip FCOS update'}
              {reasonAction?.type === 'restore' && 'Restore FCOS update'}
              {reasonAction?.type === 'cancel' && 'Cancel email batch'}
            </DialogTitle>
            <DialogDescription>
              Enter an audit reason between 8 and 255 characters.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label>Reason</Label>
            <Textarea
              className="mt-1 min-h-24"
              maxLength={255}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <div className="mt-1 text-right text-xs text-muted-foreground">{reason.trim().length}/255</div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReasonAction(null)}>Cancel</Button>
            <Button
              onClick={executeReasonAction}
              disabled={reason.trim().length < 8 || working.startsWith('reason:')}
            >
              {working.startsWith('reason:') ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(sendConfirmation)} onOpenChange={(open) => !open && setSendConfirmation(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MailWarning className="h-5 w-5 text-amber-600" />
              Send FCOS update?
            </DialogTitle>
            <DialogDescription>
              This sends one individual email to each saved recipient. It cannot be recalled.
            </DialogDescription>
          </DialogHeader>
          <div className="border-y border-border py-4">
            <div className="text-sm font-semibold text-foreground">{sendConfirmation?.subject}</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {sendConfirmation?.items?.length || 0} update{sendConfirmation?.items?.length === 1 ? '' : 's'} · {sendConfirmation?.recipientCount || 0} saved recipients
            </div>
            <div className="mt-3 max-h-52 overflow-auto border-y border-border">
              {(sendConfirmation?.recipients || []).map((recipient) => (
                <div key={recipient.userId} className="border-b border-border px-2 py-2 text-xs last:border-b-0">
                  <div className="font-semibold text-foreground">{recipient.name}</div>
                  <div className="text-muted-foreground">{recipient.email}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 text-xs text-muted-foreground">
              Sender: {model.sender?.name || 'FCOS Updates'} &lt;{model.sender?.address || 'Not configured'}&gt;
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Microsoft Graph with Vercel OIDC · {model.sender?.authenticatedAddress || 'an unconfigured mailbox'}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendConfirmation(null)}>Cancel</Button>
            <Button onClick={sendBatch} disabled={working === 'batch:send'}>
              {working === 'batch:send' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send to saved recipients
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
