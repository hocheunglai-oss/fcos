import { useRef, useState } from 'react';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const labels = { create: 'Deposit', allocate: 'Allocation', reverse: 'Reversal', refund: 'Refund' };
const states = { ready_for_review: 'Ready for review', held: 'Held', processing: 'Processing', unknown: 'Needs verification',
  exception: 'Needs verification', applied: 'Verified', reversed_in_salesforce: 'Reversed before Xero posting' };
const callOptions = { force: true, cache: false };
const definitive = new Set(['XERO_PREPAYMENT_STALE', 'XERO_PREPAYMENT_REVIEW_REQUIRED', 'XERO_PREPAYMENT_DISABLED',
  'XERO_PREPAYMENT_CANCELLED', 'XERO_PREPAYMENT_SCOPE_MISSING']);

async function invoke(name, body, mutation = false) {
  const result = await appClient.functions.invoke(name, body, { ...callOptions, invalidateCache: mutation });
  const error = result?.error || result?.data?.error;
  if (error || !result?.data) {
    throw Object.assign(new Error(error?.message || (typeof error === 'string' ? error : 'The response could not be verified.')),
      { code: error?.code || result?.data?.code });
  }
  return result.data;
}

function amount(value, currency) {
  return new Intl.NumberFormat('en-HK', { style: 'currency', currency, currencyDisplay: 'code' }).format(value);
}

export default function XeroPrepaymentActions({ tenantId }) {
  const [stemKey, setStemKey] = useState('');
  const [queue, setQueue] = useState(null);
  const [selected, setSelected] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [contactId, setContactId] = useState('');
  const [review, setReview] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inFlight = useRef(false);

  function clearReview() {
    setSelected(null);
    setContactId('');
    setContacts([]);
    setReview(null);
    setConfirmed(false);
  }

  async function run(label, task, onFailure) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(label);
    setError('');
    setNotice('');
    try {
      await task();
    } catch (failure) {
      setError(failure.message);
      onFailure?.(failure);
    } finally {
      inFlight.current = false;
      setBusy('');
    }
  }

  function loadQueue(event) {
    event.preventDefault();
    void run('Loading STEM', async () => {
      clearReview();
      setQueue(null);
      const input = stemKey.trim();
      const scope = /^[a-z0-9]{15}(?:[a-z0-9]{3})?$/i.test(input) ? { stemId: input } : { stemKey: input };
      const result = await invoke('xeroPrepaymentQueue', { tenantId, ...scope });
      if (result.tenantId !== tenantId || !result.stemId || !Array.isArray(result.rows)) throw new Error('The STEM queue could not be verified.');
      setQueue(result);
    });
  }

  async function loadReview(row, selectedContact) {
    setReview(null);
    setConfirmed(false);
    const selection = { tenantId, stemId: queue.stemId, sourceId: row.sourceId, action: row.action,
      ...(selectedContact ? { contactId: selectedContact } : {}) };
    const result = await invoke('xeroPrepaymentPreview', selection);
    if (result.tenantId !== tenantId || result.sourceId !== row.sourceId || result.action !== row.action
      || !/^[a-f0-9]{64}$/.test(result.reviewFingerprint || '')) throw new Error('The prepayment review does not match this selection.');
    setReview({ selection, result });
  }

  function select(row) {
    void run('Loading review', async () => {
      clearReview();
      setSelected(row);
      if (row.action !== 'create') {
        await loadReview(row);
        return;
      }
      const response = await invoke('xeroPrepaymentContacts', { tenantId, stemId: queue.stemId, sourceId: row.sourceId });
      if (response.tenantId !== tenantId || response.sourceId !== row.sourceId || !Array.isArray(response.contacts)) {
        throw new Error('The contact choices do not match this deposit.');
      }
      setContacts(response.contacts);
      if (response.contacts.length === 1) setContactId(response.contacts[0].id);
    });
  }

  function finish(original, result) {
    if (result.operationId !== original.operationId || !['applied', 'cancelled_before_send'].includes(result.status)) {
      throw new Error('The original operation receipt could not be verified.');
    }
    setPending(null);
    clearReview();
    setQueue((current) => current && ({ ...current, rows: current.rows.map((row) => row.sourceId === original.sourceId && row.action === original.action
      ? { ...row, status: result.status === 'applied' ? 'applied' : 'ready_for_review',
        recovery: result.status === 'applied' ? { operationId: original.operationId, reviewFingerprint: original.reviewFingerprint } : null }
      : row) }));
    setNotice(result.status === 'applied' ? 'Xero operation verified.' : 'The unsent operation was cancelled. A fresh review is available.');
  }

  function submit() {
    if (!review?.result.writeEnabled || !confirmed || pending) return;
    void run('Submitting original operation', async () => {
      const original = { ...review.selection, operationId: crypto.randomUUID(), reviewFingerprint: review.result.reviewFingerprint };
      setPending(original);
      setConfirmed(false);
      finish(original, await invoke('xeroPrepaymentApply', { ...original, reviewed: true }, true));
    }, (failure) => {
      clearReview();
      if (definitive.has(failure.code)) setPending(null);
    });
  }

  function recover(original) {
    void run('Verifying original operation', async () => {
      const { operationId, reviewFingerprint } = original;
      finish(original, await invoke('xeroPrepaymentReconcile', { tenantId, operationId, reviewFingerprint, reviewed: true }, true));
    });
  }

  return (
    <details className="rounded-xl border border-border bg-card p-5">
      <summary className="cursor-pointer font-semibold">Trade cash and prepayments</summary>
      <div className="mt-4 space-y-4">
        <form className="flex items-end gap-2" onSubmit={loadQueue}>
          <label className="text-sm font-medium">STEM reference
            <Input className="mt-1" value={stemKey} onChange={(event) => { setStemKey(event.target.value); setQueue(null); clearReview(); }} maxLength={40} disabled={Boolean(busy) || Boolean(pending)} />
          </label>
          <Button type="submit" variant="outline" disabled={!stemKey.trim() || Boolean(busy) || Boolean(pending)}>Load prepayments</Button>
        </form>
        {busy && <p role="status" className="text-sm">{busy}…</p>}
        {notice && <p role="status" className="text-sm">{notice}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {pending && !busy && <div className="flex items-center gap-3">
          <p className="text-sm">Verify the original operation before continuing.</p>
          <Button type="button" variant="outline" onClick={() => recover(pending)}>Verify original operation</Button>
        </div>}
        {queue && !queue.writeEnabled && <p className="text-sm text-muted-foreground">New Xero posting is disabled. Existing operations can still be verified.</p>}
        {queue && (queue.rows.length ? <Table>
          <TableHeader><TableRow>{['Cash record', 'Party', 'Action', 'Date', 'Amount', 'Status', ''].map((title) => <TableHead key={title}>{title}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{queue.rows.map((row) => <TableRow key={`${row.action}:${row.sourceId}`}>
            <TableCell>{row.name}</TableCell><TableCell>{row.partyName || '—'}</TableCell><TableCell>{labels[row.action]}</TableCell>
            <TableCell>{row.date || '—'}</TableCell><TableCell>{amount(row.nativeAmount, row.currency)}</TableCell>
            <TableCell>{states[row.status] || row.status}</TableCell><TableCell>
              {row.recovery ? <Button type="button" variant="outline" disabled={Boolean(busy) || Boolean(pending)}
                onClick={() => recover({ ...row.recovery, sourceId: row.sourceId, action: row.action })}>Verify receipt</Button>
                : row.status === 'ready_for_review' && <Button type="button" variant="outline" disabled={Boolean(busy) || Boolean(pending)} onClick={() => select(row)}>Review</Button>}
            </TableCell>
          </TableRow>)}</TableBody>
        </Table> : <p className="text-sm text-muted-foreground">No cash events for this STEM.</p>)}
        {selected?.action === 'create' && !review && !pending && !busy && (contacts.length
          ? <div className="flex items-end gap-2">
            <label className="text-sm font-medium">Xero contact
              <select className="ml-2 rounded border bg-background p-2" value={contactId} onChange={(event) => setContactId(event.target.value)}>
                <option value="">Select an exact contact</option>
                {contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}{contact.accountNumber ? ` · ${contact.accountNumber}` : ''}</option>)}
              </select>
            </label>
            <Button type="button" variant="outline" disabled={!contactId} onClick={() => run('Loading review', () => loadReview(selected, contactId))}>Load exact review</Button>
          </div> : !error && <p className="text-sm">No active Xero contact matches this deposit party.</p>)}
        {review && <section aria-label="Exact prepayment review" className="space-y-3 rounded-lg border p-4">
          <h3 className="font-semibold">{labels[review.result.action]} review</h3>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            {[
              ['Native amount', amount(review.result.nativeAmount, review.result.currency)], ['Accounting value', amount(review.result.accountingUsd, 'USD')],
              ['Accounting date', review.result.postingDate], ['Xero contact', review.result.contactName], ['Bank', review.result.bankName],
              ['Posting policy', `${review.result.depositAccountCode} · ${review.result.taxType} · revision ${review.result.policyRevision}`],
              ['Cash remaining', amount(review.result.cashRemainingNative, review.result.currency)],
              ['Prepayment remaining', review.result.prepaymentRemainingNative == null ? null : amount(review.result.prepaymentRemainingNative, review.result.currency)],
              ['Invoice', review.result.invoiceName], ['Invoice due', review.result.invoiceAmountDue == null ? null : amount(review.result.invoiceAmountDue, review.result.currency)],
            ].filter(([, value]) => value != null).map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd>{value}</dd></div>)}
          </dl>
          {review.result.writeEnabled && <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={confirmed} disabled={Boolean(busy) || Boolean(pending)}
              onCheckedChange={(value) => setConfirmed(value === true)} />I approve this exact Xero operation</label>
            <Button type="button" disabled={!confirmed || Boolean(busy) || Boolean(pending)} onClick={submit}>Submit reviewed operation</Button>
          </div>}
        </section>}
      </div>
    </details>
  );
}
