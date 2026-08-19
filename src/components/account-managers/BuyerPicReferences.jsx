import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';
import {
  ArrowLeft,
  Check,
  Download,
  FileUp,
  GripVertical,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  UsersRound,
  X,
} from 'lucide-react';
import { appClient } from '@/api/appClient';
import { useNavigationAwareRequest } from '@/hooks/useNavigationAwareRequest';
import PageHeader from '@/components/common/PageHeader';
import PageMethodology from '@/components/common/PageMethodology';
import DataStatus from '@/components/common/DataStatus';
import StateBlock from '@/components/common/StateBlock';
import TableShell from '@/components/common/TableShell';
import WorkspaceViewBar from '@/components/common/WorkspaceViewBar';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import {
  ACCOUNT_PIC_CSV_HEADERS,
  ACCOUNT_PIC_MAX_CSV_BYTES,
  accountPicCsvText,
  accountPicSaveRows,
  normalizeAccountPicRow,
  parseAccountPicCsv,
} from '@/lib/accountPicCsv';

const ACCOUNT_PIC_FIELDS = Object.freeze([
  { key: 'portRegion', label: 'Port / Region', required: true },
  { key: 'responsiblePersonnel', label: 'Responsible Personnel' },
  { key: 'team', label: 'Team' },
  { key: 'reportingSupervision', label: 'Reporting / Supervision' },
  { key: 'vesselTypesCovered', label: 'Vessel Types Covered' },
]);

const newIdempotencyKey = () => globalThis.crypto?.randomUUID?.() || `account-pic-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function formatDateTime(value) {
  if (!value) return 'Not yet saved';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not yet saved';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Hong_Kong',
  }).format(date);
}

function directoryFromResponse(response) {
  return response?.data?.directory || response?.data?.account || response?.data || null;
}

function summaryFromDirectory(directory) {
  if (!directory?.accountId) return null;
  return {
    accountId: directory.accountId,
    accountName: directory.accountName,
    clKey: directory.clKey || '',
    rowCount: directory.rows?.length ?? directory.rowCount ?? 0,
    revision: directory.revision ?? 0,
    updatedAt: directory.updatedAt || null,
    updatedByEmail: directory.updatedByEmail || '',
    isActive: directory.isActive !== false,
  };
}

function normalizedDirectory(directory) {
  if (!directory) return null;
  return {
    ...directory,
    rows: (directory.rows || []).map((row, index) => normalizeAccountPicRow(row, index + 1)),
  };
}

function rowsAreEqual(left, right) {
  return JSON.stringify(accountPicSaveRows(left)) === JSON.stringify(accountPicSaveRows(right));
}

function downloadCsv(accountName, rows) {
  const fileName = `${String(accountName || 'buyer-pic-reference').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'buyer-pic-reference'} Buyer PIC References.csv`;
  const url = URL.createObjectURL(new Blob([accountPicCsvText(rows)], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function directorySearchText(directory) {
  return [directory.accountName, directory.clKey, directory.updatedByEmail].filter(Boolean).join(' ').toLowerCase();
}

function AccountLabel({ accountName, clKey }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-medium text-foreground">{accountName}</div>
      <div className="mt-1 truncate text-xs text-muted-foreground">{clKey ? `CL Key · ${clKey}` : 'CL Key not set'}</div>
    </div>
  );
}

function PicRowFields({ row, index, disabled, onChange }) {
  return (
    <div className="grid gap-2 md:grid-cols-5">
      {ACCOUNT_PIC_FIELDS.map((field) => (
        <div key={field.key} className="min-w-0">
          <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:sr-only" htmlFor={`${row.clientKey}-${field.key}`}>
            {field.label}
          </Label>
          <Textarea
            id={`${row.clientKey}-${field.key}`}
            value={row[field.key]}
            onChange={(event) => onChange(field.key, event.target.value)}
            disabled={disabled}
            rows={field.key === 'portRegion' ? 2 : 3}
            className="mt-1 min-h-0 resize-y text-sm md:mt-0"
            aria-label={`${field.label}, row ${index + 1}`}
            placeholder={field.required ? 'Required' : '—'}
          />
        </div>
      ))}
    </div>
  );
}

function PicReferenceEditorRows({ rows, saving, onRowsChange }) {
  const updateRow = (index, key, value) => {
    onRowsChange((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
  };
  const removeRow = (index) => onRowsChange((current) => current.filter((_, rowIndex) => rowIndex !== index));
  const reorder = ({ source, destination }) => {
    if (!destination || source.index === destination.index) return;
    onRowsChange((current) => {
      const next = current.slice();
      const [moved] = next.splice(source.index, 1);
      next.splice(destination.index, 0, moved);
      return next;
    });
  };

  return (
    <DragDropContext onDragEnd={reorder}>
      <Droppable droppableId="buyer-pic-reference-rows">
        {(provided) => (
          <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-2">
            {rows.map((row, index) => (
              <Draggable key={row.clientKey} draggableId={row.clientKey} index={index} isDragDisabled={saving}>
                {(draggableProvided, snapshot) => (
                  <article
                    ref={draggableProvided.innerRef}
                    {...draggableProvided.draggableProps}
                    className={`rounded-lg border bg-background p-3 ${snapshot.isDragging ? 'border-primary shadow-lg' : 'border-border'}`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <button
                          type="button"
                          {...draggableProvided.dragHandleProps}
                          disabled={saving}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed"
                          aria-label={`Move row ${index + 1}`}
                          title="Drag to change reference order"
                        >
                          <GripVertical className="h-4 w-4" />
                        </button>
                        <span className="text-xs font-semibold tabular-nums text-muted-foreground">{index + 1}</span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => removeRow(index)}
                        disabled={saving}
                        aria-label={`Remove row ${index + 1}`}
                        title="Remove row"
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    <PicRowFields row={row} index={index} disabled={saving} onChange={(key, value) => updateRow(index, key, value)} />
                  </article>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  );
}

function PicReferenceReadOnly({ rows }) {
  if (!rows.length) {
    return <StateBlock title="No reference rows" description="Use Edit table to add the first Port or Region reference." />;
  }
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <Table className="min-w-[1080px]">
          <TableHeader className="bg-muted/60">
            <TableRow>{ACCOUNT_PIC_CSV_HEADERS.map((header) => <TableHead key={header}>{header}</TableHead>)}</TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.clientKey}>
                {ACCOUNT_PIC_FIELDS.map((field) => <TableCell key={field.key} className="min-w-[180px] align-top whitespace-pre-wrap break-words text-sm">{row[field.key] || '—'}</TableCell>)}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="space-y-3 md:hidden">
        {rows.map((row, index) => (
          <article key={row.clientKey} className="rounded-lg border border-border bg-background p-4">
            <div className="text-xs font-semibold tabular-nums text-muted-foreground">{index + 1}</div>
            {ACCOUNT_PIC_FIELDS.map((field) => (
              <div key={field.key} className="mt-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{field.label}</div>
                <div className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">{row[field.key] || '—'}</div>
              </div>
            ))}
          </article>
        ))}
      </div>
    </>
  );
}

export default function BuyerPicReferences({ activeView, onViewChange, methodology }) {
  const { toast } = useToast();
  const { request: requestDirectory } = useNavigationAwareRequest('collaboration');
  const fileInputRef = useRef(null);
  const openerRef = useRef(null);
  const scrollYRef = useRef(0);
  const saveOperationRef = useRef(null);
  const [summaries, setSummaries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [responseMeta, setResponseMeta] = useState(null);
  const [search, setSearch] = useState('');
  const [directory, setDirectory] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [editing, setEditing] = useState(false);
  const [draftRows, setDraftRows] = useState([]);
  const [saving, setSaving] = useState(false);
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [accountOptionQuery, setAccountOptionQuery] = useState('');
  const [accountOptions, setAccountOptions] = useState([]);
  const [accountOptionsLoading, setAccountOptionsLoading] = useState(false);
  const [importPreview, setImportPreview] = useState(null);

  const loadSummaries = useCallback(async ({ background = false, force = background } = {}) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    setError('');
    const response = await requestDirectory({
      name: 'accountPicDirectoryList',
      payload: { limit: 100 },
      force,
      cacheKey: 'account-pic-directory-list',
      cacheTags: ['account-pic-directory'],
      apply: (result) => {
        setResponseMeta(result.meta);
        if (result.data?.error) {
          setError(result.data.error);
          return;
        }
        setSummaries(result.data?.accounts || result.data?.directories || result.data?.items || []);
        setError('');
      },
    });
    if (response?.data?.cancelled) return;
    setLoading(false);
    setRefreshing(false);
  }, [requestDirectory]);

  useEffect(() => {
    loadSummaries();
  }, [loadSummaries]);

  useEffect(() => {
    if (!addAccountOpen) return undefined;
    let current = true;
    const timer = window.setTimeout(async () => {
      setAccountOptionsLoading(true);
      const response = await appClient.functions.invoke('accountPicAccountOptions', {
        query: accountOptionQuery.trim(),
        limit: 50,
      }, {
        cache: true,
        cacheTtlMs: 30_000,
        cacheTags: ['account-pic-options'],
      });
      if (!current) return;
      if (response.data?.error) {
        toast({ title: 'Buyer Accounts could not be searched', description: response.data.error, variant: 'destructive' });
        setAccountOptions([]);
      } else {
        setAccountOptions(response.data?.accounts || response.data?.items || []);
      }
      setAccountOptionsLoading(false);
    }, 200);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [accountOptionQuery, addAccountOpen, toast]);

  const filteredSummaries = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return summaries;
    return summaries.filter((item) => directorySearchText(item).includes(keyword));
  }, [search, summaries]);

  const mergeSummary = useCallback((nextDirectory) => {
    const summary = summaryFromDirectory(nextDirectory);
    if (!summary) return;
    setSummaries((current) => {
      const existing = current.some((item) => item.accountId === summary.accountId);
      const next = existing
        ? current.map((item) => item.accountId === summary.accountId ? { ...item, ...summary } : item)
        : [summary, ...current];
      return next.slice().sort((left, right) => String(left.accountName || '').localeCompare(String(right.accountName || ''), undefined, { sensitivity: 'base' }));
    });
  }, []);

  const openDirectory = useCallback(async (summary, event) => {
    openerRef.current = event?.currentTarget || null;
    scrollYRef.current = window.scrollY;
    setDetailLoading(true);
    setDetailError('');
    saveOperationRef.current = null;
    const response = await appClient.functions.invoke('accountPicDirectoryDetail', { accountId: summary.accountId }, {
      force: true,
      cache: false,
    });
    if (response.data?.error) {
      setDetailError(response.data.error);
      toast({ title: 'Buyer PIC Reference could not be opened', description: response.data.error, variant: 'destructive' });
      setDetailLoading(false);
      return;
    }
    const nextDirectory = normalizedDirectory(directoryFromResponse(response));
    if (!nextDirectory?.accountId) {
      setDetailError('The server returned no Buyer PIC Reference directory.');
      setDetailLoading(false);
      return;
    }
    mergeSummary(nextDirectory);
    setDirectory(nextDirectory);
    setDraftRows(nextDirectory.rows);
    setEditing(false);
    setDetailLoading(false);
  }, [mergeSummary, toast]);

  const closeDirectory = () => {
    if (saving) return;
    setDirectory(null);
    setDetailError('');
    setEditing(false);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: scrollYRef.current, behavior: 'instant' });
      openerRef.current?.focus?.();
    });
  };

  const beginEdit = () => {
    if (!directory) return;
    setDraftRows(directory.rows.map((row, index) => normalizeAccountPicRow(row, index + 1)));
    setEditing(true);
  };

  const addRow = () => setDraftRows((current) => [...current, normalizeAccountPicRow({}, current.length + 1)]);
  const draftInvalid = draftRows.some((row) => !String(row.portRegion || '').trim());
  const draftDirty = directory ? !rowsAreEqual(draftRows, directory.rows) : false;

  const operationKey = (operation, rows) => {
    const signature = JSON.stringify({
      operation,
      accountId: directory?.accountId,
      revision: directory?.revision,
      rows: accountPicSaveRows(rows),
    });
    if (saveOperationRef.current?.signature === signature) return saveOperationRef.current.key;
    const key = newIdempotencyKey();
    saveOperationRef.current = { signature, key };
    return key;
  };

  const saveDirectory = async () => {
    if (!directory || draftInvalid || !draftDirty) return;
    setSaving(true);
    const payload = {
      accountId: directory.accountId,
      expectedRevision: directory.revision,
      rows: accountPicSaveRows(draftRows),
      idempotencyKey: operationKey('save', draftRows),
    };
    const response = await appClient.functions.invoke('accountPicDirectorySave', payload, {
      force: true,
      cache: false,
      invalidateCache: false,
      invalidateNames: ['accountPicDirectoryList', 'accountPicDirectoryDetail', 'accountPicAccountOptions'],
      invalidateTags: ['account-pic-directory', 'account-pic-options'],
    });
    setSaving(false);
    if (response.data?.error) {
      toast({ title: 'Buyer PIC Reference not saved', description: response.data.error, variant: 'destructive' });
      return;
    }
    const nextDirectory = normalizedDirectory(directoryFromResponse(response));
    if (!nextDirectory?.accountId) {
      toast({ title: 'Buyer PIC Reference not saved', description: 'The server returned no saved directory.', variant: 'destructive' });
      return;
    }
    setDirectory(nextDirectory);
    setDraftRows(nextDirectory.rows);
    saveOperationRef.current = null;
    mergeSummary(nextDirectory);
    setEditing(false);
    setImportPreview(null);
    toast({
      title: 'Buyer PIC Reference saved',
      description: `${nextDirectory.rows.length} ordered reference row${nextDirectory.rows.length === 1 ? '' : 's'}.`,
    });
  };

  const startImport = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !directory) return;
    if (file.size > ACCOUNT_PIC_MAX_CSV_BYTES) {
      toast({ title: 'CSV is too large', description: 'Choose a Buyer PIC Reference CSV smaller than 2 MB.', variant: 'destructive' });
      return;
    }
    try {
      const csvText = await file.text();
      const rows = parseAccountPicCsv(csvText);
      setImportPreview({ fileName: file.name, csvText, rows });
    } catch (parseError) {
      toast({ title: 'CSV cannot be imported', description: parseError?.message || 'The CSV could not be read.', variant: 'destructive' });
    }
  };

  const confirmImport = () => {
    if (!importPreview) return;
    setDraftRows(importPreview.rows);
    window.requestAnimationFrame(() => {
      void saveImportedRows(importPreview);
    });
  };

  const saveImportedRows = async (preview) => {
    if (!directory) return;
    setSaving(true);
    const response = await appClient.functions.invoke('accountPicDirectoryImport', {
      accountId: directory.accountId,
      expectedRevision: directory.revision,
      rows: accountPicSaveRows(preview.rows),
      csvText: preview.csvText,
      importSource: 'csv',
      idempotencyKey: operationKey('import', preview.rows),
    }, {
      force: true,
      cache: false,
      invalidateCache: false,
      invalidateNames: ['accountPicDirectoryList', 'accountPicDirectoryDetail', 'accountPicAccountOptions'],
      invalidateTags: ['account-pic-directory', 'account-pic-options'],
    });
    setSaving(false);
    if (response.data?.error) {
      toast({ title: 'CSV import not saved', description: response.data.error, variant: 'destructive' });
      return;
    }
    const nextDirectory = normalizedDirectory(directoryFromResponse(response));
    if (!nextDirectory?.accountId) {
      toast({ title: 'CSV import not saved', description: 'The server returned no saved directory.', variant: 'destructive' });
      return;
    }
    setDirectory(nextDirectory);
    setDraftRows(nextDirectory.rows);
    saveOperationRef.current = null;
    mergeSummary(nextDirectory);
    setEditing(false);
    setImportPreview(null);
    toast({ title: 'CSV imported', description: `${nextDirectory.rows.length} ordered reference row${nextDirectory.rows.length === 1 ? '' : 's'}.` });
  };

  const selectAccount = (account) => {
    scrollYRef.current = window.scrollY;
    setAddAccountOpen(false);
    setAccountOptionQuery('');
    setAccountOptions([]);
    const firstRow = normalizeAccountPicRow({}, 1);
    setDirectory({
      accountId: account.accountId,
      accountName: account.accountName,
      clKey: account.clKey || '',
      role: account.role,
      revision: 0,
      rowCount: 0,
      updatedAt: null,
      updatedByEmail: '',
      rows: [],
    });
    setDraftRows([firstRow]);
    setDetailError('');
    saveOperationRef.current = null;
    setEditing(true);
  };

  const views = [
    { id: 'managers', label: 'Account Managers', icon: UsersRound },
    { id: 'buyer-pic-references', label: 'Buyer PIC References', icon: UsersRound, count: summaries.length },
  ];

  if (directory || detailLoading) {
    return (
      <div className="min-w-0 pb-8">
        <PageHeader
          icon={UsersRound}
          title="Buyer PIC References"
          meta={directory ? `${directory.rows.length} reference row${directory.rows.length === 1 ? '' : 's'} · revision ${directory.revision}` : 'Opening reference table'}
          actions={<PageMethodology {...methodology} />}
        />
        <WorkspaceViewBar views={views} value={activeView} onValueChange={onViewChange} />
        <div className="mt-5">
          {detailLoading ? <StateBlock icon={Loader2} title="Opening Buyer PIC Reference..." description="Verifying the live Buyer Account and reading its reference rows." /> : null}
          {detailError && !detailLoading ? <StateBlock title="Buyer PIC Reference could not be opened" description={detailError} action={<Button variant="outline" onClick={closeDirectory}>Back to references</Button>} /> : null}
          {directory && !detailLoading ? (
            <TableShell
              title={directory.accountName}
              meta={`${directory.clKey ? `CL Key · ${directory.clKey} · ` : ''}Revision ${directory.revision} · Updated ${formatDateTime(directory.updatedAt)}${directory.updatedByEmail ? ` by ${directory.updatedByEmail}` : ''}`}
              bodyClassName="p-0"
              actions={(
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={closeDirectory} disabled={saving}><ArrowLeft />Back</Button>
                  <Button variant="outline" size="sm" onClick={() => downloadCsv(directory.accountName, directory.rows)} disabled={editing || saving}><Download />Export CSV</Button>
                  {!editing ? <Button size="sm" onClick={beginEdit}><Pencil />Edit table</Button> : null}
                </div>
              )}
            >
              <div className="border-b border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
                Reference only. FCOS does not use these rows to route work, assign people, modify Enquiries/STEMs, or classify vessels.
              </div>
              {editing ? (
                <div className="space-y-4 p-4">
                  <div className="hidden grid-cols-5 gap-2 px-10 md:grid">
                    {ACCOUNT_PIC_CSV_HEADERS.map((header) => <div key={header} className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{header}</div>)}
                  </div>
                  <PicReferenceEditorRows rows={draftRows} saving={saving} onRowsChange={setDraftRows} />
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                    <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={saving}><Plus />Add row</Button>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => { setDraftRows(directory.rows); setEditing(false); }} disabled={saving}><X />Cancel</Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={saving}><FileUp />Import CSV</Button>
                      <Button type="button" size="sm" onClick={() => saveDirectory()} disabled={saving || !draftDirty || draftInvalid}>
                        {saving ? <Loader2 className="animate-spin" /> : <Check />}Save table
                      </Button>
                    </div>
                  </div>
                  {draftInvalid ? <p className="text-xs text-destructive">Every reference row needs Port / Region before it can be saved.</p> : null}
                </div>
              ) : <PicReferenceReadOnly rows={directory.rows} />}
            </TableShell>
          ) : null}
        </div>
        <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={startImport} />
        <Dialog open={Boolean(importPreview)} onOpenChange={(open) => { if (!open && !saving) setImportPreview(null); }}>
          <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Import Buyer PIC Reference CSV?</DialogTitle>
              <DialogDescription>{importPreview?.fileName} contains {importPreview?.rows.length || 0} ordered row{importPreview?.rows.length === 1 ? '' : 's'}. Saving replaces this Account’s current reference table.</DialogDescription>
            </DialogHeader>
            <div className="overflow-x-auto rounded-md border border-border">
              <Table className="min-w-[900px] text-xs">
                <TableHeader className="bg-muted/60"><TableRow>{ACCOUNT_PIC_CSV_HEADERS.map((header) => <TableHead key={header}>{header}</TableHead>)}</TableRow></TableHeader>
                <TableBody>{(importPreview?.rows || []).map((row) => <TableRow key={row.clientKey}>{ACCOUNT_PIC_FIELDS.map((field) => <TableCell key={field.key} className="max-w-52 whitespace-pre-wrap break-words align-top">{row[field.key] || '—'}</TableCell>)}</TableRow>)}</TableBody>
              </Table>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setImportPreview(null)} disabled={saving}>Cancel</Button>
              <Button type="button" onClick={confirmImport} disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : <Upload />}Replace with CSV rows</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="min-w-0 pb-8">
      <PageHeader
        icon={UsersRound}
        title="Buyer PIC References"
        meta={`${summaries.length.toLocaleString()} configured Buyer Account${summaries.length === 1 ? '' : 's'}`}
        actions={(
          <>
            <PageMethodology {...methodology} />
            <DataStatus meta={responseMeta} state={loading || refreshing ? 'refreshing' : undefined} label="References" />
            <Button variant="outline" size="icon" onClick={() => loadSummaries({ background: true })} disabled={loading || refreshing} aria-label="Refresh Buyer PIC References" title="Refresh Buyer PIC References">
              <RefreshCw className={refreshing ? 'animate-spin' : ''} />
            </Button>
          </>
        )}
      />
      <WorkspaceViewBar views={views} value={activeView} onValueChange={onViewChange} />
      <TableShell
        className="mt-5"
        title="Configured Buyer PIC References"
        meta="Reference tables for active Buyer and Buyer & Supplier Accounts"
        bodyClassName="p-0"
        actions={(
          <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
            <div className="relative min-w-56 flex-1 sm:w-80 sm:flex-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Search configured Accounts or CL Key" aria-label="Search configured Buyer PIC References" />
            </div>
            <Button size="sm" onClick={(event) => { openerRef.current = event.currentTarget; setAddAccountOpen(true); }}><Plus />Add Account</Button>
          </div>
        )}
      >
        {loading ? <StateBlock icon={Loader2} title="Loading Buyer PIC References..." description="Reading configured active Buyer Account reference tables." /> : null}
        {error && !loading ? <StateBlock title="Buyer PIC References could not be loaded" description={error} action={<Button variant="outline" onClick={() => loadSummaries()}>Try again</Button>} /> : null}
        {!loading && !error && filteredSummaries.length ? (
          <>
            <div className="hidden overflow-x-auto md:block">
              <Table className="min-w-[900px]">
                <TableHeader className="sticky top-0 z-10 bg-muted/90 backdrop-blur"><TableRow><TableHead>Buyer Account</TableHead><TableHead>Reference rows</TableHead><TableHead>Revision</TableHead><TableHead>Last updated</TableHead><TableHead className="w-28 text-right">Action</TableHead></TableRow></TableHeader>
                <TableBody>{filteredSummaries.map((item) => <TableRow key={item.accountId}><TableCell className="min-w-[320px]"><AccountLabel accountName={item.accountName} clKey={item.clKey} /></TableCell><TableCell><Badge variant="outline">{Number(item.rowCount || 0).toLocaleString()} rows</Badge></TableCell><TableCell className="tabular-nums text-sm">{item.revision ?? 0}</TableCell><TableCell className="text-xs text-muted-foreground"><div>{formatDateTime(item.updatedAt)}</div>{item.updatedByEmail ? <div className="mt-0.5 truncate">{item.updatedByEmail}</div> : null}</TableCell><TableCell className="text-right"><Button size="sm" onClick={(event) => openDirectory(item, event)}>Open</Button></TableCell></TableRow>)}</TableBody>
              </Table>
            </div>
            <div className="divide-y divide-border md:hidden">{filteredSummaries.map((item) => <article key={item.accountId} className="space-y-3 p-4"><div className="flex items-start justify-between gap-3"><AccountLabel accountName={item.accountName} clKey={item.clKey} /><Badge variant="outline" className="shrink-0">{Number(item.rowCount || 0)} rows</Badge></div><div className="text-xs text-muted-foreground">Revision {item.revision ?? 0} · {formatDateTime(item.updatedAt)}{item.updatedByEmail ? ` · ${item.updatedByEmail}` : ''}</div><Button className="w-full" size="sm" onClick={(event) => openDirectory(item, event)}>Open reference</Button></article>)}</div>
          </>
        ) : null}
        {!loading && !error && !filteredSummaries.length ? <StateBlock title={summaries.length ? 'No matching Buyer PIC References' : 'No Buyer PIC References yet'} description={summaries.length ? 'Change the search term to find a configured reference table.' : 'Add an active Buyer Account to create its first reference table.'} /> : null}
      </TableShell>
      <Dialog open={addAccountOpen} onOpenChange={(open) => { setAddAccountOpen(open); if (!open) { setAccountOptionQuery(''); setAccountOptions([]); } }}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>Add Buyer PIC Reference</DialogTitle><DialogDescription>Choose an active Buyer or Buyer & Supplier Salesforce Account. This creates a reference table only; it does not create routing or assignments.</DialogDescription></DialogHeader>
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input autoFocus value={accountOptionQuery} onChange={(event) => setAccountOptionQuery(event.target.value)} className="pl-9" placeholder="Search active Buyer Accounts or CL Key" aria-label="Search active Buyer Accounts" /></div>
          <div className="max-h-72 overflow-y-auto rounded-md border border-border">
            {accountOptionsLoading ? <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Searching active Buyer Accounts...</div> : null}
            {!accountOptionsLoading && accountOptions.map((account) => <button key={account.accountId} type="button" className="flex w-full items-center justify-between gap-3 border-b border-border px-4 py-3 text-left last:border-b-0 hover:bg-muted/60" onClick={() => selectAccount(account)}><AccountLabel accountName={account.accountName} clKey={account.clKey} /><Plus className="h-4 w-4 shrink-0 text-primary" /></button>)}
            {!accountOptionsLoading && !accountOptions.length ? <div className="p-4 text-sm text-muted-foreground">No eligible active Buyer Account matches this search.</div> : null}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setAddAccountOpen(false)}>Cancel</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
