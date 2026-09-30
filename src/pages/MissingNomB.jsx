import { useEffect, useReducer, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, FileUp, Loader2, RefreshCw, Search } from 'lucide-react';
import { appClient } from '@/api/appClient';
import StemDetailModal from '@/components/dashboard/StemDetailModal';
import PageHeader from '@/components/common/PageHeader';
import StateBlock from '@/components/common/StateBlock';
import TableShell from '@/components/common/TableShell';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { clearPendingUpload, createUploadAttempt, displayNomBDate, fingerprintNomBFile, initialPagination, isDefiniteNoWrite, isProvenNoWriteForOperation, isVerifiedUpload, listPayload, NOM_B_ACCEPT, paginationReducer, persistPendingUpload, recoverPendingUpload, validateNomBFile } from '@/lib/missingNomB';

const display = (value) => value == null || value === '' ? '—' : String(value);
const browserSessionStorage = () => {
  try { return window.sessionStorage; } catch { return null; }
};

function fileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',').pop() || '');
    reader.onerror = () => reject(new Error('The selected file could not be read. Choose it again and retry.'));
    reader.readAsDataURL(file);
  });
}

export default function MissingNomB() {
  const [pagination, dispatch] = useReducer(paginationReducer, initialPagination);
  const [searchInput, setSearchInput] = useState('');
  const [rows, setRows] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [asOf, setAsOf] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedStemId, setSelectedStemId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [pending, setPending] = useState(() => recoverPendingUpload(browserSessionStorage()));
  const [busy, setBusy] = useState(false);
  const requestSequence = useRef(0);
  const uploadLock = useRef(false);
  const attemptRef = useRef(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (searchInput.trim() !== pagination.search) dispatch({ type: 'search', search: searchInput });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchInput, pagination.search]);

  useEffect(() => {
    const sequence = ++requestSequence.current;
    let active = true;
    setLoading(true);
    setError('');
    appClient.functions.invoke('missingNomBList', listPayload(pagination), { force: true, cache: false })
      .then((response) => {
        if (!active || sequence !== requestSequence.current) return;
        if (response.data?.error) throw new Error(response.data.error);
        if (!Array.isArray(response.data?.rows)) throw new Error('The missing Nom B list returned an invalid response.');
        setRows(response.data.rows);
        setNextCursor(response.data.nextCursor || null);
        setAsOf(response.data.asOf || null);
        setLoading(false);
      })
      .catch((cause) => {
        if (!active || sequence !== requestSequence.current) return;
        setError(cause?.message || 'The missing Nom B list is unavailable.');
        setLoading(false);
      });
    return () => { active = false; };
  }, [pagination]);

  const refresh = () => {
    setNotice('');
    dispatch({ type: 'refresh' });
  };

  const openUpload = (row) => {
    if (!row.canUpload) return;
    if (draft?.phase === 'uncertain') {
      setDraft((current) => ({ ...current, open: true }));
      return;
    }
    if (pending) {
      const matchingRow = pending.nominationId === row.nominationId ? row : pending;
      setDraft({ row: matchingRow, file: null, open: true, phase: 'select', message: `An earlier upload for ${display(pending.stemName)} is unresolved. Select the same file, ${pending.filename}, to check its result.` });
      return;
    }
    attemptRef.current = null;
    setDraft({ row, file: null, open: true, phase: 'select', message: '' });
  };

  const resumePending = () => {
    if (!pending) return;
    setDraft({ row: pending, file: null, open: true, phase: 'select', message: `Select the same file, ${pending.filename}, to check the earlier upload.` });
  };

  const closeUpload = () => {
    if (busy) return;
    setDraft((current) => current ? { ...current, open: false } : null);
  };

  const chooseFile = (file) => {
    if (busy || draft?.phase === 'uncertain') return;
    attemptRef.current = null;
    setDraft((current) => current ? { ...current, file, phase: 'select', message: validateNomBFile(file) || '' } : null);
  };

  const upload = async () => {
    if (uploadLock.current || !draft?.row || !draft.file) return;
    const validationError = validateNomBFile(draft.file);
    if (validationError) {
      setDraft((current) => ({ ...current, message: validationError }));
      return;
    }
    uploadLock.current = true;
    setBusy(true);
    setDraft((current) => ({ ...current, phase: 'sending', message: '' }));
    let attempt;
    let contentBase64;
    try {
      const fingerprint = await fingerprintNomBFile(draft.file);
      attempt = createUploadAttempt({
        nominationId: draft.row.nominationId,
        file: draft.file,
        fingerprint,
        previous: attemptRef.current,
        pending,
        idFactory: () => crypto.randomUUID(),
      });
      contentBase64 = await fileAsBase64(attempt.file);
      const metadata = persistPendingUpload(browserSessionStorage(), attempt, draft.row);
      setPending(metadata);
    } catch (cause) {
      setDraft((current) => ({ ...current, phase: 'select', message: cause.message || 'The file could not be prepared securely. No upload was sent.' }));
      setBusy(false);
      uploadLock.current = false;
      return;
    }
    attemptRef.current = attempt;
    try {
      const response = await appClient.functions.invoke('missingNomBUpload', {
        nominationId: attempt.nominationId,
        operationId: attempt.operationId,
        filename: attempt.file.name,
        contentBase64,
      }, { force: true, cache: false });
      if (isVerifiedUpload(response.data, attempt)) {
        clearPendingUpload(browserSessionStorage(), attempt.operationId);
        setPending(null);
        attemptRef.current = null;
        setDraft(null);
        setNotice(`Nom B upload verified for ${display(draft.row.stemName)}. Refreshing the missing list.`);
        dispatch({ type: 'refresh' });
      } else if (isProvenNoWriteForOperation(response, Boolean(pending))) {
        clearPendingUpload(browserSessionStorage(), attempt.operationId);
        setPending(null);
        attemptRef.current = null;
        setDraft((current) => current ? { ...current, phase: 'rejected', message: response.data?.error || 'This upload was rejected before any file was saved. Correct the selection and try again.' } : null);
      } else {
        const priorAttemptNote = isDefiniteNoWrite(response) && pending
          ? 'This retry was rejected before writing, but the earlier attempt is still unresolved.'
          : 'The result may be uncertain.';
        setDraft((current) => current ? {
          ...current,
          phase: 'uncertain',
          message: `${response.data?.error || 'The server did not confirm the filed document and Received status.'} ${priorAttemptNote} Retry the same file to verify the result, or refresh the list to inspect the queue.`,
        } : null);
      }
    } catch (cause) {
      setDraft((current) => current ? {
        ...current,
        phase: 'uncertain',
        message: `${cause?.message || 'The upload result could not be verified.'} The result may be uncertain. Retry the same file to verify it, or refresh the list to inspect the queue.`,
      } : null);
    } finally {
      setBusy(false);
      uploadLock.current = false;
    }
  };

  const uploadRow = draft?.row;
  const selectedFile = draft?.file;
  const isUncertain = draft?.phase === 'uncertain';

  return (
    <div className="space-y-6 p-6 lg:p-8">
      <PageHeader
        eyebrow="Buyer confirmations"
        title="Missing Nom B"
        description="Active buyer confirmations awaiting a filed Nom B document, across all delivery dates and invoice stages. A green Received marker alone does not clear an item."
        meta={`Page ${pagination.page + 1} · ${rows.length} shown${asOf ? ` · Checked ${displayNomBDate(asOf, true)} HKT` : ''}`}
        actions={<><Button asChild variant="outline"><Link to="/">Dashboard</Link></Button><Button type="button" variant="outline" onClick={refresh} disabled={loading} className="gap-2"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</Button></>}
      />

      {pending && <div role="status" className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm"><span>The Nom B upload for {display(pending.stemName)} ({pending.filename}) has not been confirmed. Select the same file to check its result.</span><Button type="button" variant="outline" size="sm" onClick={resumePending}>Resume upload</Button></div>}
      <div className="relative max-w-lg">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input aria-label="Search missing Nom B" placeholder="Search STEM, buyer, vessel, port or confirmation" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} className="pl-9" />
      </div>
      {notice && <div role="status" className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm text-foreground">{notice}</div>}
      {error && <StateBlock icon={AlertTriangle} title="Missing Nom B list unavailable" description={error} action={<Button type="button" variant="outline" onClick={refresh}>Try again</Button>} />}
      {loading && !error && <StateBlock icon={Loader2} title="Loading missing Nom B" description="Checking active buyer confirmations and their filed documents." />}
      {!loading && !error && !rows.length && (nextCursor || pagination.page > 0
        ? <StateBlock icon={Search} title="No confirmations on this page" description={nextCursor ? 'More results may be available. Continue to the next page.' : 'Go back or refresh the list to check current confirmations.'} />
        : <StateBlock icon={CheckCircle2} title={pagination.search ? 'No matching confirmations' : 'No missing Nom B documents'} description={pagination.search ? 'Try a different search or clear the search field.' : 'No active buyer confirmations currently need a Nom B document.'} />)}
      {!loading && !error && rows.length > 0 && (
        <TableShell title="Buyer confirmations needing Nom B" meta={`${rows.length} on this page · All dates, including uninvoiced STEMs`} bodyClassName="p-0">
          <Table scrollLabel="Missing Nom B confirmations" className="text-xs">
            <TableHeader><TableRow>
              <TableHead>STEM</TableHead><TableHead>Buyer</TableHead><TableHead>Vessel / IMO</TableHead><TableHead>Port</TableHead><TableHead>Delivery</TableHead><TableHead>Buyer Confirmation</TableHead><TableHead>Received</TableHead><TableHead>Trader</TableHead><TableHead>Action</TableHead>
            </TableRow></TableHeader>
            <TableBody>{rows.map((row) => <TableRow key={row.nominationId}>
              <TableCell><Button type="button" variant="link" className="h-auto p-0 text-left text-xs" onClick={() => setSelectedStemId(row.stemId)} disabled={!row.stemId}>{display(row.stemName)}</Button></TableCell>
              <TableCell>{display(row.buyerName)}</TableCell>
              <TableCell><div>{display(row.vesselName)}</div><div className="text-muted-foreground">IMO {display(row.imo)}</div></TableCell>
              <TableCell>{display(row.portName)}</TableCell>
              <TableCell>{displayNomBDate(row.deliveryDate || row.expectedDeliveryDate)}{!row.deliveryDate && row.expectedDeliveryDate && <span className="ml-1 text-muted-foreground">expected</span>}</TableCell>
              <TableCell>{display(row.confirmationReference)}</TableCell>
              <TableCell><span className="font-medium">Nom B missing</span>{row.receivedStatus === '🟢' && <div className="text-amber-700 dark:text-amber-300">🟢 marker only</div>}</TableCell>
              <TableCell>{display(row.traderName)}</TableCell>
              <TableCell><Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => openUpload(row)} disabled={!row.canUpload} title={!row.canUpload ? 'Upload unavailable for this confirmation; contact an administrator.' : undefined}><FileUp className="h-3.5 w-3.5" />Upload Nom B</Button>{!row.canUpload && <div className="mt-1 max-w-40 text-[11px] text-muted-foreground">Upload unavailable for this confirmation.</div>}</TableCell>
            </TableRow>)}</TableBody>
          </Table>
        </TableShell>
      )}
      {!loading && !error && (pagination.page > 0 || nextCursor) && <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => dispatch({ type: 'previous' })} disabled={pagination.page === 0}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button>
        <Button type="button" variant="outline" onClick={() => dispatch({ type: 'next', cursor: nextCursor })} disabled={!nextCursor}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button>
      </div>}

      <StemDetailModal stemId={selectedStemId} open={Boolean(selectedStemId)} onClose={() => setSelectedStemId(null)} />

      <Dialog open={Boolean(draft?.open)} onOpenChange={(open) => { if (!open) closeUpload(); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>Upload Nom B</DialogTitle><DialogDescription>File the buyer&apos;s Nom B on the active Buyer Confirmation for {display(uploadRow?.stemName)}.</DialogDescription></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm"><div className="font-semibold">{display(uploadRow?.stemName)}</div><div className="text-muted-foreground">{display(uploadRow?.buyerName)} · {display(uploadRow?.vesselName)} · {display(uploadRow?.confirmationReference)}</div></div>
            <div className="space-y-1.5"><Label htmlFor="nom-b-file">Nom B document</Label><Input id="nom-b-file" type="file" accept={NOM_B_ACCEPT} onChange={(event) => chooseFile(event.target.files?.[0] || null)} disabled={busy || isUncertain} /><p className="text-xs text-muted-foreground">PDF, JPG, PNG, DOC or DOCX · maximum 3 MiB.</p></div>
            {selectedFile && <p className="text-xs text-muted-foreground">Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(0)} KiB)</p>}
            {draft?.message && <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">{draft.message}</div>}
            {pending && <p className="text-xs text-muted-foreground">Select the same file to verify the earlier upload before starting another.</p>}
            {isUncertain && <p className="text-xs text-muted-foreground">Retry this file or refresh the list to check the unresolved result.</p>}
          </div>
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={closeUpload} disabled={busy}>Close</Button>{isUncertain && <Button type="button" variant="outline" onClick={refresh} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Refresh list</Button>}<Button type="button" onClick={upload} disabled={busy || !selectedFile || (!isUncertain && Boolean(validateNomBFile(selectedFile)))}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileUp className="mr-2 h-4 w-4" />}{pending || isUncertain ? 'Retry same upload' : 'Upload to Salesforce'}</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
