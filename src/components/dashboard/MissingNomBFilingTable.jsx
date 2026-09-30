import { useEffect, useReducer, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, FileUp, Loader2, RefreshCw, Search } from 'lucide-react';
import { appClient } from '@/api/appClient';
import StemDetailModal from './StemDetailModal';
import StateBlock from '@/components/common/StateBlock';
import TableShell from '@/components/common/TableShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { clearPendingUpload, createUploadAttempt, displayNomBDate, fingerprintNomBFile, initialPagination, isDefiniteNoWrite, isProvenNoWriteForOperation, isVerifiedUpload, listPayload, NOM_B_ACCEPT, paginationReducer, persistPendingUpload, recoverPendingUpload, validateNomBFile } from '@/lib/missingNomB';

const display = (value) => value == null || value === '' ? '—' : String(value);
const sessionStorage = () => { try { return window.sessionStorage; } catch { return null; } };

function fileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',').pop() || '');
    reader.onerror = () => reject(new Error('The file could not be read. Choose it again.'));
    reader.readAsDataURL(file);
  });
}

function DropArea({ row, disabled, onFiles, recovery = false }) {
  const name = recovery ? `Retry the unfinished Nom B for ${display(row.stemName)}` : `Choose or drop Nom B for ${display(row.stemName)}`;
  return <div role="group" aria-label={name} className={`rounded-md border-2 border-dashed p-2 text-center ${disabled ? 'border-border bg-muted/30 text-muted-foreground' : 'border-primary/50 bg-primary/5'}`}
    onDragOver={(event) => event.preventDefault()}
    onDrop={(event) => { event.preventDefault(); if (!disabled) onFiles(row, event.dataTransfer.files); }}>
    <label className={disabled ? 'block cursor-not-allowed' : 'block cursor-pointer'}>
      <span className="flex items-center justify-center gap-1 text-xs font-medium"><FileUp className="h-3.5 w-3.5" />{recovery ? 'Drop the same file here to retry' : 'Drop Nom B here or choose a file'}</span>
      <input type="file" aria-label={name} accept={NOM_B_ACCEPT} disabled={disabled} className="mt-1 block w-full max-w-48 text-[11px] file:mr-2 file:rounded file:border-0 file:bg-background file:px-2 file:py-1 file:text-xs" onChange={(event) => { onFiles(row, event.target.files); event.target.value = ''; }} />
    </label>
  </div>;
}

export default function MissingNomBFilingTable() {
  const [pagination, dispatch] = useReducer(paginationReducer, initialPagination);
  const [searchInput, setSearchInput] = useState('');
  const [rows, setRows] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [asOf, setAsOf] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [pending, setPending] = useState(() => recoverPendingUpload(sessionStorage()));
  const [verifiedId, setVerifiedId] = useState(null);
  const [cleanupProof, setCleanupProof] = useState(null);
  const [selectedStemId, setSelectedStemId] = useState(null);
  const pendingRef = useRef(pending);
  const verifiedRef = useRef(null);
  const attemptRef = useRef(null);
  const uploadLock = useRef(false);
  const mounted = useRef(false);
  const requestSequence = useRef(0);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
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
        if (verifiedRef.current) {
          if (response.data.rows.some((row) => row.nominationId === verifiedRef.current)) setNotice('The upload was verified, but this confirmation is still in the list. Refresh to check again.');
          else { verifiedRef.current = null; setVerifiedId(null); if (!pendingRef.current) setFeedback(null); setNotice(pendingRef.current ? 'The upload was verified, but saved retry information still needs to be cleared.' : 'Nom B upload verified and the confirmation is no longer missing.'); }
        }
      })
      .catch((cause) => {
        if (!active || sequence !== requestSequence.current) return;
        setError(cause?.message || 'The missing Nom B list is unavailable.');
        setLoading(false);
      });
    return () => { active = false; };
  }, [pagination]);

  const refresh = () => { setNotice(''); dispatch({ type: 'refresh' }); };
  const finishCleanup = () => {
    if (!cleanupProof || pendingRef.current?.operationId !== cleanupProof.operationId) return;
    const saved = recoverPendingUpload(sessionStorage());
    if (saved?.operationId !== cleanupProof.operationId || !clearPendingUpload(sessionStorage(), cleanupProof.operationId)) {
      setNotice('Saved retry information could not be cleared. Please try again.');
      return;
    }
    pendingRef.current = null;
    setPending(null);
    attemptRef.current = null;
    setCleanupProof(null);
    setFeedback(null);
    setNotice(cleanupProof.kind === 'verified' ? 'Nom B upload verified. Saved retry information cleared.' : 'Rejected upload cleared. Choose a corrected file to try again.');
  };
  const handleFiles = async (row, files) => {
    if (uploadLock.current || verifiedId === row.nominationId) return;
    if (cleanupProof) { setNotice('Finish clearing the confirmed result before selecting another file.'); return; }
    const savedPending = recoverPendingUpload(sessionStorage());
    if (savedPending && savedPending.operationId !== pendingRef.current?.operationId) { pendingRef.current = savedPending; setPending(savedPending); }
    if (pendingRef.current && pendingRef.current.nominationId !== row.nominationId) {
      setNotice(`Finish the unresolved Nom B upload for ${display(pendingRef.current.stemName)} before filing another confirmation.`);
      return;
    }
    if (!files || files.length !== 1) {
      setFeedback({ nominationId: row.nominationId, phase: 'invalid', message: 'Choose or drop exactly one Nom B file.' });
      return;
    }
    const file = files[0];
    const validationError = validateNomBFile(file);
    if (validationError) {
      setFeedback({ nominationId: row.nominationId, phase: 'invalid', message: validationError });
      return;
    }
    uploadLock.current = true;
    setNotice('');
    setFeedback({ nominationId: row.nominationId, phase: 'preparing', message: `Preparing ${file.name}…` });
    const earlierPending = pendingRef.current || recoverPendingUpload(sessionStorage());
    let attempt;
    try {
      const fingerprint = await fingerprintNomBFile(file);
      attempt = createUploadAttempt({ nominationId: row.nominationId, file, fingerprint, previous: attemptRef.current, pending: earlierPending, idFactory: () => crypto.randomUUID() });
      const contentBase64 = await fileAsBase64(file);
      if (!mounted.current) return;
      const latestPending = recoverPendingUpload(sessionStorage());
      if ((latestPending?.operationId || null) !== (earlierPending?.operationId || null)) throw new Error('Another unfinished upload was found. Refresh and retry the saved file.');
      const metadata = persistPendingUpload(sessionStorage(), attempt, row);
      pendingRef.current = metadata;
      setPending(metadata);
      attemptRef.current = attempt;
      setFeedback({ nominationId: row.nominationId, phase: 'sending', message: `Filing ${file.name}…` });
      const response = await appClient.functions.invoke('missingNomBUpload', { nominationId: attempt.nominationId, operationId: attempt.operationId, filename: file.name, contentBase64 }, { force: true, cache: false });
      if (!mounted.current) return;
      if (isVerifiedUpload(response.data, attempt)) {
        requestSequence.current += 1;
        const cleared = recoverPendingUpload(sessionStorage())?.operationId === attempt.operationId && clearPendingUpload(sessionStorage(), attempt.operationId);
        if (cleared) { pendingRef.current = null; setPending(null); attemptRef.current = null; }
        else { setCleanupProof({ operationId: attempt.operationId, kind: 'verified' }); setNotice('The Nom B upload was verified, but saved retry information could not be cleared. Finish the confirmed upload below.'); }
        verifiedRef.current = attempt.nominationId;
        setVerifiedId(attempt.nominationId);
        setFeedback({ nominationId: row.nominationId, phase: 'verified', message: 'Upload verified. Refreshing the missing list…' });
        dispatch({ type: 'refresh' });
      } else if (isProvenNoWriteForOperation(response, Boolean(earlierPending))) {
        const cleared = recoverPendingUpload(sessionStorage())?.operationId === attempt.operationId && clearPendingUpload(sessionStorage(), attempt.operationId);
        if (cleared) { pendingRef.current = null; setPending(null); attemptRef.current = null; }
        else setCleanupProof({ operationId: attempt.operationId, kind: 'rejected' });
        setFeedback({ nominationId: row.nominationId, phase: cleared ? 'rejected' : 'uncertain', message: cleared ? response.data?.error || 'This upload was rejected before a file was saved. Choose a corrected file.' : 'The server rejected this upload, but saved retry information could not be cleared. Use Clear rejected upload below.' });
      } else {
        const explanation = isDefiniteNoWrite(response) && earlierPending ? 'This retry was rejected, but the earlier upload is still unresolved.' : 'The result could not be verified.';
        setFeedback({ nominationId: row.nominationId, phase: 'uncertain', message: `${response.data?.error || 'The server did not confirm the filed document.'} ${explanation} Drop or choose the same file again to check the result.` });
      }
    } catch (cause) {
      if (!mounted.current) return;
      if (attempt && pendingRef.current?.operationId === attempt.operationId) {
        setFeedback({ nominationId: row.nominationId, phase: 'uncertain', message: `${cause?.message || 'The upload result could not be verified.'} Drop or choose the same file again to check the result.` });
      } else {
        setFeedback({ nominationId: row.nominationId, phase: 'invalid', message: cause?.message || 'The file could not be prepared. No upload was sent.' });
      }
    } finally {
      uploadLock.current = false;
    }
  };

  const pendingVisible = pending && !loading && !error && rows.some((row) => row.nominationId === pending.nominationId && row.canUpload);
  const feedbackVisible = feedback && !loading && !error && rows.some((row) => row.nominationId === feedback.nominationId);
  const busy = uploadLock.current;
  return <div className="space-y-4" aria-label="Missing Nom B filing" onDragOver={(event) => { if (Array.from(event.dataTransfer?.types || []).includes('Files')) event.preventDefault(); }} onDrop={(event) => event.preventDefault()}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-medium">Active Buyer Confirmations missing a filed Nom B</p><p className="text-xs text-muted-foreground">All delivery dates, including uninvoiced STEMs. A green Received marker alone does not clear a missing document.</p><p className="text-xs text-muted-foreground">Drop one PDF, JPG, PNG, DOC, or DOCX file onto its confirmation, or choose a file. Maximum 3 MiB.</p></div><Button type="button" variant="outline" size="sm" onClick={refresh} disabled={loading}><RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh filing list</Button></div>
    {pending && <div role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{cleanupProof ? `The result for ${display(pending.stemName)} is confirmed, but saved retry information needs to be cleared.` : `The Nom B upload for ${display(pending.stemName)} (${pending.filename}) is unresolved. Select the same file to check the result. Other uploads are paused.`}</div>}
    {cleanupProof && <Button type="button" variant="outline" size="sm" onClick={finishCleanup}>{cleanupProof.kind === 'verified' ? 'Finish confirmed upload' : 'Clear rejected upload'}</Button>}
    {pending && !pendingVisible && !cleanupProof && <div className="max-w-sm rounded-lg border border-amber-500/40 p-3"><p className="mb-2 text-sm font-medium">Resume upload for {display(pending.stemName)}</p><DropArea row={pending} recovery disabled={busy} onFiles={handleFiles} /></div>}
    <div className="relative max-w-lg"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search missing Nom B" placeholder="Search STEM, buyer, vessel, port or confirmation" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} className="pl-9" /></div>
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {feedback && !feedbackVisible && <p role={['invalid', 'rejected', 'uncertain'].includes(feedback.phase) ? 'alert' : 'status'} className="text-sm">{feedback.message}</p>}
    {error && <StateBlock icon={AlertTriangle} title="Missing Nom B list unavailable" description={error} action={<Button type="button" variant="outline" onClick={refresh}>Try again</Button>} />}
    {loading && !error && <StateBlock icon={Loader2} title="Loading missing Nom B" description="Checking active Buyer Confirmations and filed documents." />}
    {!loading && !error && !rows.length && (nextCursor || pagination.page > 0
      ? <StateBlock icon={Search} title="No confirmations on this page" description={nextCursor ? 'More results may be available. Continue to the next page.' : 'Go back or refresh the list to check current confirmations.'} />
      : <StateBlock icon={CheckCircle2} title={pagination.search ? 'No matching confirmations' : 'No missing Nom B documents'} description={pagination.search ? 'Try a different search or clear the search field.' : 'No active Buyer Confirmations currently need a Nom B document.'} />)}
    {!loading && !error && rows.length > 0 && <TableShell title="Buyer confirmations needing Nom B" meta={`Page ${pagination.page + 1} · ${rows.length} shown${asOf ? ` · Checked ${displayNomBDate(asOf, true)} HKT` : ''}`} bodyClassName="p-0"><Table scrollLabel="Missing Nom B confirmations" className="text-xs"><TableHeader><TableRow><TableHead>STEM</TableHead><TableHead>Buyer</TableHead><TableHead>Vessel / IMO</TableHead><TableHead>Port</TableHead><TableHead>Delivery</TableHead><TableHead>Buyer Confirmation</TableHead><TableHead>Received</TableHead><TableHead>Trader</TableHead><TableHead>Nom B document</TableHead></TableRow></TableHeader><TableBody>{rows.map((row) => {
      const rowFeedback = feedback?.nominationId === row.nominationId ? feedback : null;
      const rowDisabled = !row.canUpload || busy || Boolean(pending && pending.nominationId !== row.nominationId) || verifiedId === row.nominationId;
      return <TableRow key={row.nominationId}><TableCell><Button type="button" variant="link" className="h-auto p-0 text-left text-xs" onClick={() => setSelectedStemId(row.stemId)} disabled={!row.stemId}>{display(row.stemName)}</Button></TableCell><TableCell>{display(row.buyerName)}</TableCell><TableCell><div>{display(row.vesselName)}</div><div className="text-muted-foreground">IMO {display(row.imo)}</div></TableCell><TableCell>{display(row.portName)}</TableCell><TableCell>{displayNomBDate(row.deliveryDate || row.expectedDeliveryDate)}{!row.deliveryDate && row.expectedDeliveryDate && <span className="ml-1 text-muted-foreground"> expected</span>}</TableCell><TableCell>{display(row.confirmationReference)}</TableCell><TableCell><span className="font-medium">Nom B missing</span>{row.receivedStatus === '🟢' && <div className="text-amber-700 dark:text-amber-300">🟢 marker only</div>}</TableCell><TableCell>{display(row.traderName)}</TableCell><TableCell className="min-w-56"><DropArea row={row} disabled={rowDisabled} onFiles={handleFiles} />{!row.canUpload && <p className="mt-1 text-[11px] text-muted-foreground">Upload unavailable for this confirmation.</p>}{rowFeedback && <p role={['invalid', 'rejected', 'uncertain'].includes(rowFeedback.phase) ? 'alert' : 'status'} className="mt-1 text-xs">{rowFeedback.message}</p>}</TableCell></TableRow>;
    })}</TableBody></Table></TableShell>}
    {!loading && !error && (pagination.page > 0 || nextCursor) && <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => dispatch({ type: 'previous' })} disabled={pagination.page === 0}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button><Button type="button" variant="outline" onClick={() => dispatch({ type: 'next', cursor: nextCursor })} disabled={!nextCursor}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button></div>}
    <StemDetailModal stemId={selectedStemId} open={Boolean(selectedStemId)} onClose={() => setSelectedStemId(null)} />
  </div>;
}
