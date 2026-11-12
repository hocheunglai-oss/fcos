import { useRef, useState } from 'react';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';

const definitiveRejections = new Set([
  'XERO_CREDIT_ALLOCATION_DISABLED', 'XERO_CREDIT_ALLOCATION_STALE', 'XERO_CREDIT_ALLOCATION_CANCELLED',
  'XERO_CREDIT_ALLOCATION_REVIEW_REQUIRED', 'XERO_CREDIT_ALLOCATION_SCOPE_MISSING',
]);
const fingerprint = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const sourceId = /^[a-z0-9]{15}(?:[a-z0-9]{3})?$/i;

async function invoke(handler, body, mutation = false) {
  const result = await appClient.functions.invoke(handler, body, { force: true, cache: false, invalidateCache: mutation });
  const error = result?.error || result?.data?.error;
  if (error || !result?.data) {
    throw Object.assign(new Error(error?.message || (typeof error === 'string' ? error : 'The response could not be verified.')),
      { code: error?.code || result?.data?.code });
  }
  return result.data;
}

function savedOperation(key) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key));
    return uuid.test(saved?.operationId || '') && fingerprint.test(saved?.reviewFingerprint || '') ? { operationId: saved.operationId, reviewFingerprint: saved.reviewFingerprint } : null;
  } catch {
    return null;
  }
}

function amount(value, currency) {
  return new Intl.NumberFormat('en-HK', { style: 'currency', currency, currencyDisplay: 'code' }).format(value);
}

export default function XeroCreditAllocationActions({ tenantId, actorId }) {
  const storageKey = `fcos:xero-credit-allocation:${tenantId}:${actorId}`;
  const [sourceObject, setSourceObject] = useState('Invoice__c');
  const [creditNumber, setCreditNumber] = useState('');
  const [review, setReview] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(() => savedOperation(storageKey));
  const [recoveryQueue, setRecoveryQueue] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inFlight = useRef(false);

  function remember(operation) {
    setPending(operation);
    try {
      if (operation) sessionStorage.setItem(storageKey, JSON.stringify(operation));
      else sessionStorage.removeItem(storageKey);
    } catch {
      // Current-tab recovery is still available when browser storage is unavailable.
    }
  }

  function clearReview() {
    setReview(null);
    setConfirmed(false);
    setNotice('');
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

  function loadReview(event) {
    event.preventDefault();
    if (pending) return;
    void run('Loading credit review', async () => {
      clearReview();
      const result = await invoke('xeroCreditAllocationPreview', { tenantId, sourceObject, creditNumber: creditNumber.trim() });
      if (result.tenantId !== tenantId || result.sourceObject !== sourceObject || !sourceId.test(result.creditId || '')
          || !['eligible', 'blocked', 'reconciled'].includes(result.status)
          || (result.status === 'eligible' && !fingerprint.test(result.reviewFingerprint || ''))) {
        throw new Error('The review does not match this credit selection.');
      }
      setReview(result);
    });
  }

  function finish(original, result) {
    if (result.operationId !== original.operationId || !['applied', 'cancelled_before_send'].includes(result.status)) {
      throw new Error('The original operation receipt could not be verified.');
    }
    remember(null);
    setRecoveryQueue(queue => queue && ({ ...queue, rows: queue.rows.filter(row => row.operationId !== original.operationId) }));
    clearReview();
    setNotice(result.status === 'applied' ? 'Xero credit allocation verified.' : 'The unsent allocation was cancelled. Load a fresh review to continue.');
  }

  function submit() {
    if (!confirmed || pending || review?.status !== 'eligible' || !review.writeEnabled) return;
    void run('Submitting reviewed allocation', async () => {
      const original = { operationId: crypto.randomUUID(), reviewFingerprint: review.reviewFingerprint };
      remember(original);
      setConfirmed(false);
      finish(original, await invoke('xeroCreditAllocationApply', {
        tenantId, sourceObject, creditId: review.creditId, ...original, reviewed: true,
      }, true));
    }, failure => {
      clearReview();
      if (definitiveRejections.has(failure.code)) remember(null);
    });
  }

  function loadRecoveryQueue() {
    void run('Finding pending allocations', async () => {
      const result = await invoke('xeroCreditAllocationRecoveryQueue', { tenantId });
      if (result.tenantId !== tenantId || !Array.isArray(result.rows) || result.rows.some(row =>
        !uuid.test(row.operationId || '') || !fingerprint.test(row.reviewFingerprint || ''))) {
        throw new Error('The pending allocation list could not be verified.');
      }
      setRecoveryQueue(result);
    });
  }

  function recover({ operationId, reviewFingerprint }) {
    const original = { operationId, reviewFingerprint };
    void run('Verifying original allocation', async () => {
      remember(original);
      clearReview();
      finish(original, await invoke('xeroCreditAllocationReconcile', { tenantId, ...original, reviewed: true }, true));
    });
  }

  const disabled = Boolean(busy || pending);
  return (
    <details className="rounded-xl border border-border bg-card p-5">
      <summary className="cursor-pointer font-semibold">Allocate a full credit</summary>
      <div className="mt-4 space-y-4">
        <form className="flex items-end gap-3" onSubmit={loadReview}>
          <label className="text-sm font-medium">Credit type
            <select className="mt-1 block h-10 rounded-md border bg-background px-3" value={sourceObject} disabled={disabled}
              onChange={event => { setSourceObject(event.target.value); clearReview(); }}>
              <option value="Invoice__c">Buyer credit</option>
              <option value="Supplier_Invoice__c">Supplier credit</option>
            </select>
          </label>
          <label className="text-sm font-medium">Salesforce credit number
            <Input className="mt-1" value={creditNumber} disabled={disabled} maxLength={80}
              onChange={event => { setCreditNumber(event.target.value); clearReview(); }} />
          </label>
          <Button type="submit" variant="outline" disabled={disabled || !creditNumber.trim()}>Review credit</Button>
        </form>
        {busy && <p role="status" className="text-sm">{busy}…</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {notice && <p role="status" className="text-sm">{notice}</p>}
        {pending && !busy && <Button type="button" variant="outline" onClick={() => recover(pending)}>Verify original allocation</Button>}
        {!pending && <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={loadRecoveryQueue}>
          Find pending allocations
        </Button>}
        {!pending && recoveryQueue && <section aria-label="Pending credit allocations" className="space-y-2">
          {recoveryQueue.rows.map(row => <div key={row.operationId} className="flex items-center gap-3 text-sm">
            <span>{row.creditNumber}</span>
            <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => recover(row)}>Verify {row.creditNumber}</Button>
          </div>)}
          {!recoveryQueue.rows.length && !recoveryQueue.hasMore && <p className="text-sm">No pending allocations.</p>}
          {recoveryQueue.hasMore && <p className="text-sm">More allocations are available. Refresh this list after verifying the displayed items.</p>}
        </section>}
        {review && <section aria-label="Credit allocation review" className="space-y-3 rounded-lg border p-4">
          <dl className="grid grid-cols-3 gap-3 text-sm">
            {[
              ['Credit', review.creditNumber], ['Original invoice', review.originalNumber],
              ['Allocation date', review.allocationDate],
              ['Allocation', review.amount == null ? null : amount(review.amount, review.currency)],
              ['Accounting value', review.accountingUsd == null ? null : amount(review.accountingUsd, 'USD')],
              ['Credit remaining', review.residualCredit == null ? null : amount(review.residualCredit, review.currency)],
            ].filter(([, value]) => value != null).map(([label, value]) => <div key={label}>
              <dt className="text-muted-foreground">{label}</dt><dd>{value}</dd>
            </div>)}
          </dl>
          {review.status === 'blocked' && <ul className="list-disc space-y-1 pl-5 text-sm text-destructive">
            {(review.blockers || []).map((blocker, index) => <li key={index}>{blocker}</li>)}
          </ul>}
          {review.status === 'reconciled' && <p className="text-sm">The original invoice is settled.</p>}
          {review.status === 'eligible' && (review.writeEnabled ? <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={confirmed} disabled={disabled}
              onCheckedChange={value => setConfirmed(value === true)} />I approve this exact credit allocation</label>
            <Button type="button" disabled={disabled || !confirmed} onClick={submit}>Apply reviewed credit</Button>
          </div> : <p className="text-sm text-muted-foreground">New Xero credit allocations are disabled.</p>)}
        </section>}
      </div>
    </details>
  );
}
