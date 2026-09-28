import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { appClient } from '@/api/appClient';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import XeroDailyAllowance from '@/components/xero/XeroDailyAllowance';
import { latestXeroDailyAllowance } from '@/lib/xeroDailyAllowance';
import { collectDocumentCorrectionPreview, documentCorrectionInitialSelection, documentCorrectionOutcomeLabel, documentCorrectionOutcomes, documentCorrectionPreviewError,
  documentCorrectionSelectable, documentCorrectionSelection, documentCorrectionValue,
  XERO_DOCUMENT_CORRECTION_BATCH_LIMIT } from '@/lib/xeroDocumentCorrectionsUi';
import './XeroDocumentCorrections.css';

const OPTIONS = { force: true, cache: false, invalidateCache: true };
const FIELD_LABELS = { Date: 'Document date', DueDate: 'Due date', Reference: 'Reference', InvoiceNumber: 'Document number' };
const KIND_LABELS = { buyer_invoice: 'Buyer invoice', supplier_invoice: 'Supplier bill', supplier_bill: 'Supplier bill',
  debit_note: 'Debit note', credit_note: 'Credit note' };
const MUTED = 'text-xs text-muted-foreground';
const BLOCK_MUTED = `block ${MUTED}`;
const DETAIL_LINK = 'cursor-pointer text-sm text-blue-700 underline';
const SPINNER = <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />;

export default function XeroDocumentCorrections({ onClose, enabled, canPreview, onAllowance }) {
  const [preview, setPreview] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [outcomes, setOutcomes] = useState(null);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [allowance, setAllowance] = useState(null);
  const [previewProgress, setPreviewProgress] = useState(null);
  const [tablePage, setTablePage] = useState(0);
  const [selectedOnly, setSelectedOnly] = useState(false);
  const generation = useRef(0);
  const requestBusy = useRef(false);
  useEffect(() => () => { generation.current += 1; }, []);
  const selectedIds = documentCorrectionSelection(preview, selected);
  const items = preview?.items || [];
  const uncertainIds = (outcomes || []).filter((item) => item.outcome === 'uncertain').map((item) => item.id);
  const tableItems = selectedOnly ? items.filter((item) => selected.has(item.id)) : items;
  const tablePageCount = Math.max(1, Math.ceil(tableItems.length / 100));
  const visibleItems = tableItems.slice(tablePage * 100, (tablePage + 1) * 100);
  const limitReached = selected.size >= XERO_DOCUMENT_CORRECTION_BATCH_LIMIT;

  function captureAllowance(value) {
    setAllowance((current) => latestXeroDailyAllowance(current, value));
    onAllowance?.(value);
  }

  async function previewCorrections() {
    if (!canPreview || busy || requestBusy.current) return;
    requestBusy.current = true;
    const current = ++generation.current;
    setBusy('preview'); setError(''); setSelected(new Set()); setPreview(null); setOutcomes(null); setAttempted(false);
    setPreviewProgress(null); setTablePage(0); setSelectedOnly(false);
    try {
      const result = await appClient.functions.invoke('xeroFinancialDocumentCorrectionPreview', {}, OPTIONS);
      if (current !== generation.current) return;
      captureAllowance(result.data);
      if (result.data?.error) throw new Error(documentCorrectionPreviewError(result) || result.data.error);
      const complete = await collectDocumentCorrectionPreview(result.data, async (previewId, offset) => {
        const next = await appClient.functions.invoke('xeroFinancialDocumentCorrectionPage', { previewId, offset }, OPTIONS);
        if (current !== generation.current) throw new Error('Preview closed.');
        captureAllowance(next.data);
        if (next.data?.error) throw new Error(documentCorrectionPreviewError(next) || next.data.error);
        return next.data;
      }, (received, total) => { if (current === generation.current) setPreviewProgress({ received, total }); });
      setPreview(complete);
      const initialSelection = documentCorrectionInitialSelection(complete);
      setSelected(initialSelection);
      setTablePage(Math.max(0, Math.floor(complete.items.findIndex((item) => initialSelection.has(item.id)) / 100)));
    } catch (failure) {
      if (current === generation.current) {
        captureAllowance(failure);
        setError(failure.message || 'Preview failed.');
      }
    } finally { requestBusy.current = false; if (current === generation.current) setBusy(''); }
  }

  async function applyCorrections() {
    if (!enabled || !canPreview || busy || requestBusy.current || attempted || !selectedIds.length) return;
    requestBusy.current = true;
    const current = ++generation.current;
    const ids = [...selectedIds];
    setBusy('apply'); setAttempted(true); setError('');
    try {
      const result = await appClient.functions.invoke('xeroFinancialDocumentCorrectionApply', {
        previewId: preview.previewId, itemIds: ids,
      }, OPTIONS);
      if (current !== generation.current) return;
      captureAllowance(result.data);
      if (result.data?.error) throw new Error(result.data.error);
      setOutcomes(documentCorrectionOutcomes(ids, result.data?.items));
    } catch (failure) {
      if (current === generation.current) {
        captureAllowance(failure);
        setOutcomes(documentCorrectionOutcomes(ids));
        setError(`${failure.message || 'Result not confirmed.'} No automatic retry will occur.`);
      }
    } finally { requestBusy.current = false; if (current === generation.current) setBusy(''); }
  }

  async function verifyUncertainResults() {
    if (!canPreview || busy || requestBusy.current || !preview?.previewId || !uncertainIds.length) return;
    requestBusy.current = true;
    const current = ++generation.current;
    const ids = [...uncertainIds];
    setBusy('verify'); setError('');
    const retainResults = (values) => setOutcomes((existing) => (existing || []).map((item) => values.find((value) => value.id === item.id) || item));
    try {
      const result = await appClient.functions.invoke('xeroFinancialDocumentCorrectionVerify', {
        previewId: preview.previewId, itemIds: ids,
      }, OPTIONS);
      if (current !== generation.current) return;
      captureAllowance(result.data);
      if (result.data?.error) throw new Error(result.data.error);
      retainResults(documentCorrectionOutcomes(ids, result.data?.items));
    } catch (failure) {
      if (current === generation.current) {
        captureAllowance(failure);
        retainResults(documentCorrectionOutcomes(ids));
        setError(`${failure.message || 'Verification failed.'} No corrections were resent.`);
      }
    } finally { requestBusy.current = false; if (current === generation.current) setBusy(''); }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className={`finance-correction-dialog w-[min(96vw,80rem)] max-w-[min(96vw,80rem)] ${busy ? 'finance-correction-busy' : ''}`} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onInteractOutside={(event) => { if (busy) event.preventDefault(); }}>
      <DialogHeader>
        <DialogTitle>Date and reference corrections</DialogTitle>
        <DialogDescription>Review Salesforce dates, numbers and references. Amounts, lines, tax and payments are preserved; paid documents remain eligible when Xero supports the change.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="outline" onClick={previewCorrections} disabled={!canPreview || Boolean(busy)}>
          {busy === 'preview' && SPINNER}
          {busy === 'preview' ? 'Preparing correction preview…' : 'Preview date and reference corrections'}
        </Button>
        <p className="text-sm text-muted-foreground">Maximum {XERO_DOCUMENT_CORRECTION_BATCH_LIMIT} corrections per batch.</p>
      </div>
      {!canPreview && <p role="status" className="text-sm text-amber-900">Connect Xero with invoice access to preview corrections.</p>}
      {!enabled && <p role="status" className="text-sm text-amber-900">Financial actions are locked. Connected Xero can still be previewed.</p>}
      {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {busy === 'preview' && <p role="status" className="text-sm">{previewProgress ? `Loading correction preview: ${previewProgress.received} of ${previewProgress.total} records.` : 'Checking document fields.'} No corrections are being applied.</p>}
      {preview && <>
        <p className={MUTED}>{preview.scope.totalSourceCount} source records; {items.length} reviewable. {preview.scope.excludedLegacyCount} before {preview.scope.cutoff} preserved outside this table.</p>
        <div className="flex flex-wrap gap-2" aria-label="Correction preview summary">
          {[['eligible', 'Eligible', 'eligible'], ['alreadyCompliant', 'Already compliant', 'already_compliant'],
            ['legacyPreserved', 'Legacy preserved', 'legacy_preserved'], ['blocked', 'Blocked', 'blocked']].map(([key, label, outcome]) =>
            <Badge key={key} variant="outline">{label}: {preview.summary?.[key] ?? (items.filter((item) => item.outcome === outcome).length + (key === 'legacyPreserved' ? preview.scope.excludedLegacyCount : 0))}</Badge>)}
        </div>
        <p className={`${MUTED} break-all`}>Preview {preview.previewId}{preview.createdAt ? ` · ${new Date(preview.createdAt).toLocaleString('en-HK')}` : ''}</p>
        {items.length > 0 && <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="outline" size="sm" disabled={Boolean(busy) || (!selectedOnly && !selected.size)} onClick={() => { setSelectedOnly((value) => !value); setTablePage(0); }}>{selectedOnly ? 'Show all corrections' : 'Show selected corrections'}</Button>
          <div className="flex flex-wrap items-center gap-2"><p className={MUTED}>{tableItems.length} {selectedOnly ? 'selected records' : 'records loaded'} · Page {tablePage + 1} of {tablePageCount}</p>
            <Button type="button" variant="outline" size="sm" disabled={Boolean(busy) || tablePage === 0} onClick={() => setTablePage((page) => page - 1)}>Previous correction page</Button>
            <Button type="button" variant="outline" size="sm" disabled={Boolean(busy) || tablePage + 1 >= tablePageCount} onClick={() => setTablePage((page) => page + 1)}>Next correction page</Button></div>
        </div>}
        {items.length ? <div className="finance-correction-table-frame">
          <Table className="finance-correction-table" scrollLabel="Document correction preview">
            <colgroup><col /><col /><col /><col /><col /></colgroup>
            <TableHeader><TableRow>{['Select', 'Document', 'STEM / vessel', 'Reason / result', 'Differences / source evidence'].map((label) => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader>
            <TableBody>{visibleItems.map((item) => {
              const outcome = outcomes?.find((value) => value.id === item.id);
              const selectable = documentCorrectionSelectable(preview, item);
              return <TableRow key={item.id} data-state={selected.has(item.id) ? 'selected' : undefined}>
                <TableCell><Checkbox aria-label={`Select correction for ${item.documentNumber || item.salesforceId || item.id}`} checked={selected.has(item.id)}
                  disabled={!selectable || Boolean(busy) || attempted || (limitReached && !selected.has(item.id))}
                  onCheckedChange={(checked) => setSelected((value) => {
                    const next = new Set(value);
                    if (checked === true && selectable && next.size < XERO_DOCUMENT_CORRECTION_BATCH_LIMIT) next.add(item.id);
                    else if (checked !== true) next.delete(item.id);
                    return next;
                  })} /></TableCell>
                <TableCell data-label="Document"><span className="block font-medium">{item.documentNumber || item.salesforceId || item.id}</span>
                  <span className={BLOCK_MUTED}>{KIND_LABELS[item.kind] || 'Document'} · Salesforce {item.salesforceId || 'unavailable'}</span>
                  <span className={BLOCK_MUTED}>Xero {item.xeroInvoiceId || 'unavailable'}</span></TableCell>
                <TableCell data-label="STEM / vessel"><span className="block">{item.stemKey || 'STEM unavailable'}</span><span className={BLOCK_MUTED}>{item.vesselName || 'Vessel unavailable'}</span></TableCell>
                <TableCell data-label="Reason / result"><span className="block font-medium">{documentCorrectionOutcomeLabel(outcome?.outcome || item.outcome)}</span>
                  <p className="mt-1 text-xs">{item.reason || 'Missing reason. Review before applying.'}</p>
                  {item.outcome === 'eligible' && !selectable && <p className="mt-1 text-xs text-amber-900">Verification evidence is incomplete. Prepare a new preview.</p>}
                  {outcome && <p className="mt-1 text-xs" role="status">{outcome.reason || outcome.error || outcome.message || (outcome.outcome === 'applied' ? 'Correction confirmed.' : 'Review this result.')}</p>}
                </TableCell>
                <TableCell data-label="Differences / source evidence">{item.changes?.length ? <details>
                  <summary className={DETAIL_LINK}>View {item.changes.length} {item.changes.length === 1 ? 'difference' : 'differences'}</summary>
                  <dl className="mt-2 space-y-3">{item.changes.map((change, index) => <div key={`${change.field}:${index}`}>
                    <dt className="text-xs font-semibold">{FIELD_LABELS[change.field] || change.field}</dt>
                    {[['Before', change.before], ['After', change.after]].map(([label, value]) => <dd key={label} className="mt-1 text-xs"><span className="font-medium">{label}: </span>{documentCorrectionValue(value)}</dd>)}
                  </div>)}</dl>
                </details> : <span className={MUTED}>{item.linkOnly === true ? 'Verify and link; existing Xero fields remain unchanged.' : 'No field changes proposed.'}</span>}
                  <CorrectionSourceEvidence evidence={item.sourceEvidence} />
                </TableCell>
              </TableRow>;
            })}</TableBody>
          </Table>
        </div> : <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No documents in this preview.</p>}
        <p className="text-sm">{selectedIds.length} selected. Xero rechecks each record before applying.</p>
      </>}
      {attempted && <div role="status" className="rounded-md border p-3 text-sm">
        {busy === 'apply' ? `Applying ${selectedIds.length} selected corrections…` : busy === 'verify' ? 'Verifying original results without resending corrections.' : <>
          {outcomes && ['applied', 'already_compliant', 'legacy_preserved', 'blocked', 'failed', 'uncertain'].map((status) => {
            const count = outcomes.filter((item) => item.outcome === status).length;
            return count ? <span key={status} className="mr-3 inline-block">{documentCorrectionOutcomeLabel(status)}: {count}</span> : null;
          })}
          <p className="mt-1">Review blocked, failed or uncertain results before a new preview. No automatic retry will occur.</p>
        </>}
      </div>}
      {attempted && uncertainIds.length > 0 && <div className="space-y-2">
        <Button type="button" variant="outline" onClick={verifyUncertainResults} disabled={!canPreview || Boolean(busy)}>
          {busy === 'verify' && SPINNER}
          {busy === 'verify' ? 'Verifying uncertain results…' : 'Verify uncertain results'}
        </Button>
        <p className={MUTED}>Read back the original results without resending corrections. Available while writes are locked.</p>
      </div>}
      {allowance && <XeroDailyAllowance snapshot={allowance} />}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={Boolean(busy)}>Close</Button>
        <Button type="button" onClick={applyCorrections} disabled={!enabled || !canPreview || Boolean(busy) || attempted || !selectedIds.length}>
          {busy === 'apply' && SPINNER}
          {busy === 'apply' ? 'Applying corrections…' : 'Apply selected corrections'}
        </Button>
      </div>
    </DialogContent>
  </Dialog>;
}

function CorrectionSourceEvidence({ evidence }) {
  const resolution = { source_buyer: 'This buyer invoice', linked_buyers: 'Linked buyer invoices',
    unique_stem_buyer: 'The only active normal buyer invoice on this STEM' }[evidence?.resolution] || 'Resolution unavailable';
  const buyers = Array.isArray(evidence?.buyers) ? evidence.buyers : [];
  const fallback = Array.isArray(evidence?.fallbackCandidates) ? evidence.fallbackCandidates : null;
  const buyerIds = new Set(buyers.map((buyer) => buyer.id));
  const unresolvedIds = [...new Set((evidence?.links || []).map((link) => link.buyerId).filter((id) => id && !buyerIds.has(id)))];
  return <details className="mt-3">
    <summary className={DETAIL_LINK}>Source evidence</summary>
    {evidence ? <div className="mt-2 space-y-3 text-xs">
      <dl className="space-y-1">
        {[
          ['Date evidence', resolution], ['Original source number', evidence.originalName],
          ['Source due date', `${documentCorrectionValue(evidence.dueDate)} (${evidence.direction === 'supplier' ? 'supplier invoice' : 'buyer invoice'})`],
          ['Vessel', evidence.vesselName], ['STEM reference code', evidence.refCode],
        ].map(([label, value]) => <div key={label}><dt className="inline font-semibold">{label}: </dt><dd className="inline">{documentCorrectionValue(value)}</dd></div>)}
      </dl>
      {unresolvedIds.length > 0 && <p><span className="font-semibold">Linked buyer invoice IDs pending verification: </span>{unresolvedIds.join(', ')}</p>}
      {[
        ['Verified buyer invoice evidence', buyers, 'No verified buyer invoice evidence is available.'],
        ['Buyer invoices considered on this STEM', fallback, 'No buyer invoice candidates were found.'],
      ].map(([title, values, empty]) => values && <div key={title}><p className="font-semibold">{title}</p>{values.length
        ? <ul className="mt-1 space-y-2">{values.map((buyer, index) => <BuyerEvidence key={`${buyer.id}:${index}`} buyer={buyer} />)}</ul>
        : <p className="mt-1">{empty}</p>}</div>)}
    </div> : <p className={`mt-2 ${MUTED}`}>Source evidence is unavailable. Prepare a new preview.</p>}
  </details>;
}

function BuyerEvidence({ buyer }) {
  const eligibility = buyer.proforma === false && buyer.deprecated === false && buyer.inactive === false && buyer.credit === false
    ? 'Active normal invoice' : buyer.proforma === true ? 'Proforma invoice' : buyer.deprecated === true ? 'Deprecated invoice'
      : buyer.inactive === true ? 'Inactive invoice' : buyer.credit === true ? 'Credit note' : 'Eligibility evidence incomplete';
  return <li className="rounded-md border p-2">
    <p className="font-medium">{documentCorrectionValue(buyer.name)}</p>
    {[['Salesforce ID', buyer.id], ['Buyer delivery date', buyer.deliveryDate], ['Buyer invoice date', buyer.invoiceDate]]
      .map(([label, value]) => <p key={label}>{label}: {documentCorrectionValue(value)}</p>)}
    <p>{eligibility}</p>
  </li>;
}
