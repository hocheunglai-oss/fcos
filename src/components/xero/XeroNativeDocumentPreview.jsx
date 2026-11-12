import { useRef, useState } from 'react';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const candidateStatuses = {
  held: 'Xero review required',
  candidate_matches: 'Existing Xero document matches reviewed lines',
  no_exact_number_match: 'No Xero document found with this number',
};
const supportedCurrencies = ['USD', 'HKD'];
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const SOURCE_ID = /^[a-z0-9]{15}(?:[a-z0-9]{3})?$/i;
const SHA = /^[a-f0-9]{64}$/;
const validOperation = operation => UUID.test(operation?.operationId || '') && SHA.test(operation?.reviewFingerprint || '')
  && SOURCE_ID.test(operation?.sourceId || '') && ['Invoice__c', 'Supplier_Invoice__c'].includes(operation?.sourceObject)
  && typeof operation.documentNumber === 'string' && Boolean(operation.documentNumber.trim());
const rejectedBeforeAdmission = new Set([
  'EXTERNAL_ACTION_GATE_DISABLED', 'FCOS_DEPLOYMENT_READ_ONLY', 'XERO_NATIVE_DOCUMENT_STALE', 'XERO_NATIVE_DOCUMENT_REVIEW_REQUIRED',
  'XERO_NATIVE_DOCUMENT_SCOPE_MISSING', 'XERO_NATIVE_DOCUMENT_TENANT_CHANGED',
]);
const validLines = lines => Array.isArray(lines) && lines.length > 0
  && lines.every(line => Number.isFinite(line?.quantity) && Number.isFinite(line?.unitAmount));
const money = (value, currency) => new Intl.NumberFormat('en-HK', {
  style: 'currency', currency, currencyDisplay: 'code',
}).format(value);
const unitAmount = value => new Intl.NumberFormat('en-HK', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value);
const quantity = value => new Intl.NumberFormat('en-HK', { maximumFractionDigits: 4 }).format(value);

async function invoke(handler, body, mutation = false) {
  const result = await appClient.functions.invoke(handler, body, { force: true, cache: false, invalidateCache: mutation });
  const error = result?.error || result?.data?.error;
  if (error || !result?.data) throw Object.assign(
    new Error(error?.message || (typeof error === 'string' ? error : 'The response could not be verified.')),
    { code: error?.code || result?.data?.code },
  );
  return result.data;
}

function pendingOperations(key) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key));
    return Array.isArray(saved) ? saved.filter(validOperation) : [];
  } catch {
    return [];
  }
}

export default function XeroNativeDocumentPreview({ tenantId, actorId, reviewEnabled = true, verificationOnly = false }) {
  const storageKey = `fcos:xero-native-document:${tenantId}:${actorId}`;
  const [sourceObject, setSourceObject] = useState('Invoice__c');
  const [documentNumber, setDocumentNumber] = useState('');
  const [review, setReview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(() => verificationOnly ? [] : pendingOperations(storageKey));
  const [recovery, setRecovery] = useState(null);
  const inFlight = useRef(false);

  function clearReview() {
    setReview(null);
    setConfirmed(false);
    setError('');
    setNotice('');
  }

  function storePending(operations) {
    setPending(operations);
    try {
      if (operations.length) sessionStorage.setItem(storageKey, JSON.stringify(operations));
      else sessionStorage.removeItem(storageKey);
    } catch {
      // The service journal provides recovery even when browser storage is unavailable.
    }
  }

  async function run(label, task) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(label);
    setError('');
    setNotice('');
    try {
      await task();
    } catch (failure) {
      setError(failure.message);
    } finally {
      inFlight.current = false;
      setBusy('');
    }
  }

  function preview(event) {
    event.preventDefault();
    const selectedNumber = documentNumber.trim();
    if (!selectedNumber) return;
    void run('Loading issued document', async () => {
      clearReview();
      const { nativeDocument: observed } = await invoke('xeroFinancialSyncPreview', {
        nativeDocument: { tenantId, sourceObject, documentNumber: selectedNumber },
      });
      if (!observed || observed.tenantId !== tenantId || observed.sourceObject !== sourceObject
          || observed.documentNumber !== selectedNumber || observed.status !== 'source_reviewed'
          || !supportedCurrencies.includes(observed.currency) || !Number.isFinite(observed.signedTotal)
          || !Number.isFinite(observed.accountingUsd) || !validLines(observed.lines)
          || (observed.draftPreview?.status === 'draft_preview' && (!SOURCE_ID.test(observed.documentId || '')
            || !SHA.test(observed.draftPreview.reviewFingerprint || '') || !validLines(observed.draftPreview.lines)))
          || (observed.xeroReview && (!Object.hasOwn(candidateStatuses, observed.xeroReview.status)
            || !Array.isArray(observed.xeroReview.candidates) || !Array.isArray(observed.xeroReview.blockers)))) {
        throw new Error('The source review does not match this document.');
      }
      setReview(observed);
    });
  }

  const available = [...new Map([...pending, ...(recovery?.rows || [])].map(row => [row.operationId, row])).values()];
  const existing = review && available.some(row => row.sourceObject === review.sourceObject
    && row.sourceId.slice(0, 15) === review.documentId?.slice(0, 15));
  const draft = review?.draftPreview?.status === 'draft_preview' ? review.draftPreview : null;

  async function complete(handler, original, remaining) {
    const { sourceId, sourceObject, operationId, reviewFingerprint } = original;
    const result = await invoke(handler, { tenantId, sourceId, sourceObject, operationId, reviewFingerprint, reviewed: true }, true);
    if (result.operationId !== operationId || !['confirmed', 'cancelled_before_send'].includes(result.status)
        || (result.status === 'confirmed' && (!UUID.test(result.xeroId || '') || !UUID.test(result.mappingId || '')))) {
      throw new Error('The original draft receipt could not be verified.');
    }
    storePending(remaining);
    setRecovery(queue => queue && ({ ...queue, rows: queue.rows.filter(row => row.operationId !== operationId) }));
    setNotice(result.status === 'confirmed' ? 'Xero draft verified.' : 'The unsent draft was cancelled. Load a fresh review to continue.');
  }

  function submit() {
    if (!actorId || !confirmed || !draft?.writeEnabled || existing) return;
    void run('Submitting reviewed draft', async () => {
      const original = { operationId: crypto.randomUUID(), reviewFingerprint: draft.reviewFingerprint,
        sourceId: review.documentId, sourceObject: review.sourceObject, documentNumber: review.documentNumber };
      storePending([...pending, original]);
      clearReview();
      try {
        await complete('xeroNativeDocumentApply', original, pending);
      } catch (failure) {
        if (rejectedBeforeAdmission.has(failure.code)) storePending(pending);
        throw failure;
      }
    });
  }

  function findPending() {
    void run('Finding pending drafts', async () => {
      const result = await invoke('xeroNativeDocumentRecoveryQueue', { tenantId });
      if (result.tenantId !== tenantId || !Array.isArray(result.rows) || !result.rows.every(validOperation)
          || typeof result.hasMore !== 'boolean') throw new Error('The pending draft list could not be verified.');
      setRecovery(result);
    });
  }

  function reconcile(original) {
    void run('Verifying original draft', async () => {
      clearReview();
      await complete('xeroNativeDocumentReconcile', original, pending.filter(row => row.operationId !== original.operationId));
    });
  }

  if (verificationOnly) return (
    <section aria-label="Trading FX document review" className="rounded-xl border border-border bg-card p-5">
      <h3 className="font-semibold">Trading FX document review</h3>
      <p className="mt-2 text-sm text-muted-foreground">Draft actions are unavailable in this verification environment.</p>
    </section>
  );

  return (
    <details className="rounded-xl border border-border bg-card p-5">
      <summary className="cursor-pointer font-semibold">Review Trading FX document</summary>
      <div className="mt-4 space-y-4">
        {reviewEnabled && <form className="flex items-end gap-3" onSubmit={preview}>
          <label className="text-sm font-medium">Document type
            <select className="mt-1 block h-10 rounded-md border bg-background px-3" value={sourceObject} disabled={Boolean(busy)}
              onChange={event => { setSourceObject(event.target.value); clearReview(); }}>
              <option value="Invoice__c">Buyer invoice or credit</option>
              <option value="Supplier_Invoice__c">Supplier bill or credit</option>
            </select>
          </label>
          <label className="text-sm font-medium">Salesforce document number
            <Input className="mt-1" value={documentNumber} disabled={Boolean(busy)} maxLength={80}
              onChange={event => { setDocumentNumber(event.target.value); clearReview(); }} />
          </label>
          <Button type="submit" variant="outline" disabled={busy || !documentNumber.trim()}>Review document</Button>
        </form>}
        {busy && <p role="status" className="text-sm">{busy}…</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {notice && <p role="status" className="text-sm">{notice}</p>}
        {actorId && <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={findPending}>Find pending drafts</Button>}
        {(available.length > 0 || recovery) && <section aria-label="Pending Trading FX drafts" className="space-y-2">
          {available.map(operation => <div key={operation.operationId} className="flex items-center gap-3">
            <span className="text-sm">{operation.documentNumber}</span>
            <Button type="button" variant="outline" disabled={Boolean(busy)}
              onClick={() => reconcile(operation)}>Verify original draft for {operation.documentNumber}</Button>
          </div>)}
          {!available.length && !recovery?.hasMore && <p className="text-sm">No pending drafts.</p>}
          {recovery?.hasMore && <p className="text-sm">More drafts are pending. Refresh the list after verifying the displayed drafts.</p>}
        </section>}
        {review && <section aria-label="Trading FX source review" className="space-y-3">
          <dl className="grid grid-cols-3 gap-3 text-sm">
            {[
              ['Document', review.documentNumber], ['Issue date', review.invoiceDate], ['Due date', review.dueDate],
              ['Issued amount', money(review.signedTotal, review.currency)],
              ['Accounting value', money(review.accountingUsd, 'USD')],
              ['Rounding adjustment', review.roundingAdjustmentCents ? money(review.roundingAdjustmentCents / 100, review.currency) : null],
            ].filter(([, value]) => value != null).map(([label, value]) => (
              <div key={label}><dt className="text-muted-foreground">{label}</dt><dd>{value}</dd></div>
            ))}
          </dl>
          {review.xeroReview && <section aria-label="Xero document search" className="space-y-2 text-sm">
            <p className="font-medium">{candidateStatuses[review.xeroReview.status]}</p>
            {review.xeroReview.contact && <p>{review.xeroReview.ownershipVerified ? 'Verified Account contact' : 'Xero contact candidate'} · {review.xeroReview.contact.name}</p>}
            {review.xeroReview.candidates.map(candidate => <p key={candidate.id}>{candidate.number} · {candidate.status}</p>)}
            {review.xeroReview.blockers.map((blocker, index) => <p key={index} className="text-destructive">{blocker}</p>)}
          </section>}
          {review.draftPreview?.status === 'held' && <p className="text-sm text-destructive">{review.draftPreview.message}</p>}
          {draft && <h4 className="text-sm font-semibold">Xero draft lines</h4>}
          <Table>
            <TableHeader><TableRow>
              {['Description', 'Quantity', `Unit amount (${review.currency})`, 'Xero account', 'Tax'].map(label => <TableHead key={label}>{label}</TableHead>)}
            </TableRow></TableHeader>
            <TableBody>
              {(draft?.lines || review.lines).map((line, index) => <TableRow key={index}>
                <TableCell>{line.description}</TableCell><TableCell>{quantity(line.quantity)}</TableCell>
                <TableCell>{unitAmount(line.unitAmount)}</TableCell><TableCell>{line.accountCode}</TableCell><TableCell>{line.taxType}</TableCell>
              </TableRow>)}
            </TableBody>
          </Table>
          {draft && existing && <p className="text-sm">Verify the original draft before submitting this document.</p>}
          {draft && !draft.writeEnabled && <p className="text-sm">Xero draft submission is disabled for this connection.</p>}
          {actorId && draft?.writeEnabled && !existing && <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={confirmed} onCheckedChange={value => setConfirmed(value === true)} disabled={Boolean(busy)} />
              I reviewed these Xero draft lines
            </label>
            <Button type="button" onClick={submit} disabled={!confirmed || Boolean(busy)}>Create Xero draft</Button>
          </div>}
        </section>}
      </div>
    </details>
  );
}
