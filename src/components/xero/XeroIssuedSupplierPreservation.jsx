import { useEffect, useRef, useState } from 'react';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PRESERVATION_PACKET_MAX_BYTES, parsePreservationPacket, preservationOutcomes, preservationRowSelectable, preservationSelection } from '@/lib/xeroIssuedSupplierPreservationUi';

const OPTIONS = { force: true, cache: false, invalidateCache: true };
const INPUT_ERROR = 'Use valid JSON evidence: 1–25 records, at most 200 KB; printed facts and identifiers only, no PDFs or credentials.';

export default function XeroIssuedSupplierPreservation({ onClose, enabled, onAllowance }) {
  const [packet, setPacket] = useState(null);
  const [filename, setFilename] = useState('');
  const [preview, setPreview] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [outcomes, setOutcomes] = useState(null);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const generation = useRef(0);
  const requestBusy = useRef(false);
  const pastedInput = useRef(null);
  useEffect(() => () => { generation.current += 1; }, []);
  const selectedIds = preservationSelection(preview, selected);

  function resetEvidence(name) {
    const current = ++generation.current;
    setPacket(null); setPreview(null); setSelected(new Set()); setOutcomes(null); setAttempted(false); setError('');
    setFilename(name);
    return current;
  }

  function pastePacket(event) {
    if (busy || requestBusy.current) return;
    resetEvidence('Pasted evidence');
    const text = event.target.value;
    if (!text.trim()) return;
    try { setPacket(parsePreservationPacket(text)); }
    catch { setError(INPUT_ERROR); }
  }

  async function choosePacket(event) {
    if (busy || requestBusy.current) return;
    const file = event.target.files?.[0];
    const current = resetEvidence(file?.name || '');
    if (pastedInput.current) pastedInput.current.value = '';
    if (!file) return;
    setBusy('reading');
    try {
      if (file.size > PRESERVATION_PACKET_MAX_BYTES) throw new Error(INPUT_ERROR);
      const data = parsePreservationPacket(await file.text());
      if (current !== generation.current) return;
      setPacket(data);
    } catch {
      if (current === generation.current) setError(INPUT_ERROR);
    } finally { if (current === generation.current) setBusy(''); }
  }

  async function verifyRecords() {
    if (!packet || busy || requestBusy.current || attempted) return;
    requestBusy.current = true;
    const current = ++generation.current;
    setBusy('verify'); setError(''); setPreview(null); setSelected(new Set());
    try {
      const result = await appClient.functions.invoke('xeroFinancialDocumentPreservationPreview', { packet }, OPTIONS);
      if (current !== generation.current) return;
      onAllowance?.(result.data);
      if (result.data?.error) throw new Error(result.data.error);
      if (!result.data?.run?.id || result.data.run.revision == null || !Array.isArray(result.data.rows)) {
        throw new Error('Incomplete verification response. No records selected.');
      }
      setPreview(result.data);
      if (result.data.run.status === 'authorised') setSelected(new Set(result.data.rows.filter((row) => row.selected).map((row) => row.id)));
    } catch (failure) {
      if (current === generation.current) { onAllowance?.(failure); setError(failure.message || 'Record verification failed.'); }
    } finally { requestBusy.current = false; if (current === generation.current) setBusy(''); }
  }

  async function linkRecords() {
    if (!enabled || busy || requestBusy.current || attempted || !selectedIds.length) return;
    requestBusy.current = true;
    const current = ++generation.current;
    const ids = [...selectedIds];
    setBusy('link'); setAttempted(true); setError('');
    try {
      const result = await appClient.functions.invoke('xeroFinancialDocumentPreservationRun', {
        runId: preview.run.id, revision: preview.run.revision, selectedItemIds: ids, reviewed: true,
      }, OPTIONS);
      if (current !== generation.current) return;
      onAllowance?.(result.data);
      if (result.data?.error) throw new Error(result.data.error);
      setOutcomes(preservationOutcomes(ids, result.data?.outcomes));
      if (result.data?.financialWrites !== 0) setError('Zero financial writes were not confirmed. Check the saved run before another action.');
      if (result.data?.run) setPreview((value) => ({ ...value, run: result.data.run }));
    } catch (failure) {
      if (current === generation.current) {
        onAllowance?.(failure);
        setOutcomes(preservationOutcomes(ids));
        setError(`${failure.message || 'The link result could not be confirmed.'} No automatic retry will occur.`);
      }
    } finally { requestBusy.current = false; if (current === generation.current) setBusy(''); }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto" onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onInteractOutside={(event) => { if (busy) event.preventDefault(); }}>
      <DialogHeader>
        <DialogTitle>Preserve verified bills</DialogTitle>
        <DialogDescription>Verify issued Salesforce documents and link selected existing Xero bills. Bill details, amounts, lines, tax, status and payments stay unchanged. No bills or payments are created.</DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <label className="block text-sm font-medium" htmlFor="xero-preservation-packet">JSON evidence packet (1–25 records, maximum 200 KB)</label>
        <input id="xero-preservation-packet" type="file" accept=".json,application/json" disabled={Boolean(busy)} onChange={choosePacket} className="block w-full rounded-md border p-2 text-sm" />
        <label className="block text-sm font-medium" htmlFor="xero-preservation-paste">Or paste JSON evidence</label>
        <textarea id="xero-preservation-paste" ref={pastedInput} rows={3} disabled={Boolean(busy)} onChange={pastePacket} className="block w-full rounded-md border p-2 text-sm" />
        <p className="text-xs text-muted-foreground">Include printed facts and Salesforce / Xero IDs only; no PDFs or credentials. The server independently checks private issued PDFs.</p>
        <Button type="button" variant="outline" disabled={!packet || Boolean(busy) || attempted} onClick={verifyRecords}>{busy === 'verify' ? 'Verifying records…' : 'Verify records'}</Button>
      </div>
      {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {preview && <>
        <p className="text-sm">{filename} · {preview.rows.length} records · {preview.rows.filter((row) => row.status === 'eligible').length} eligible · Run {preview.run.id} / revision {preview.run.revision}</p>
        <div className="overflow-auto rounded-md border">
          <Table><TableHeader><TableRow>{['Select', 'Salesforce → Xero bill', 'Amount', 'Verification / result'].map((label) => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader>
            <TableBody>{preview.rows.map((row) => {
              const outcome = outcomes?.find((value) => value.id === row.id);
              const eligible = preservationRowSelectable(preview, row);
              return <TableRow key={row.id}>
                <TableCell><Checkbox aria-label={`Select ${row.sourceNumber || row.sourceId} to link to ${row.xeroNumber || row.xeroDocumentId}`} checked={selected.has(row.id)} disabled={!eligible || Boolean(busy) || attempted} onCheckedChange={(checked) => setSelected((value) => { const next = new Set(value); if (checked === true) next.add(row.id); else next.delete(row.id); return next; })} /></TableCell>
                <TableCell><span className="block">{row.sourceNumber || row.sourceId} → {row.xeroNumber || row.xeroDocumentId}</span><span className="text-xs text-muted-foreground">{row.sourceId} → {row.xeroDocumentId}</span></TableCell>
                <TableCell className="whitespace-nowrap">{row.currency} {row.total}</TableCell>
                <TableCell><span className="block">{outcome?.status || row.status}</span>{(row.blockers || []).join('; ')}{outcome && <span className="block text-xs">{outcome.error || outcome.reason || outcome.message || (outcome.status === 'linked' ? 'Link confirmed; Xero bill details preserved.' : 'Review the saved run before another attempt.')}</span>}</TableCell>
              </TableRow>;
            })}</TableBody>
          </Table>
        </div>
        <p className="text-sm">{selectedIds.length} selected. Only selected verified records will be linked. Xero financial writes: 0.</p>
      </>}
      {attempted && <p role="status" className="text-sm">{busy === 'link' ? 'Linking the selected records…' : 'Attempt retained above. Review failed or uncertain results before a new packet. No automatic retries.'}</p>}
      {!enabled && <p className="text-sm text-amber-800">Financial actions are locked. Verification remains available.</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={Boolean(busy)}>Close</Button>
        <Button type="button" onClick={linkRecords} disabled={!enabled || Boolean(busy) || attempted || !selectedIds.length}>{busy === 'link' ? 'Linking…' : 'Link and preserve Xero details'}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
