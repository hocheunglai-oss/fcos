import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from '@/components/ui/use-toast';

const callOptions = { force: true, cache: false };
const policyKey = ({ direction, currency }) => `${direction}:${currency}`;
const draftFor = (policy) => ({
  enabled: policy.enabled === true, accountId: policy.accountId || '', taxType: policy.taxType || '', reason: '',
});

function resultData(result) {
  const error = result?.error || result?.data?.error;
  if (error || !result?.data) throw new Error(error?.message || (typeof error === 'string' ? error : 'The response could not be verified.'));
  return result.data;
}

export default function XeroPrepaymentPolicy() {
  const [opened, setOpened] = useState(false);
  return (
    <details className="rounded-xl border border-border bg-card p-5" onToggle={(event) => {
      if (event.currentTarget.open) setOpened(true);
    }}>
      <summary className="cursor-pointer font-semibold">Prepayment posting policies</summary>
      {opened && <PostingPolicies />}
    </details>
  );
}

function PostingPolicies() {
  const [data, setData] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [refreshRequired, setRefreshRequired] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy('load');
    setError('');
    try {
      const next = resultData(await appClient.functions.invoke('xeroPrepaymentPolicyGet', {}, callOptions));
      if (!next.tenantId || !Array.isArray(next.policies) || next.policies.length !== 4
        || !Array.isArray(next.accountOptions) || !Array.isArray(next.taxOptions)) {
        throw new Error('The policy list could not be verified.');
      }
      setData(next);
      setDrafts(Object.fromEntries(next.policies.map((policy) => [policyKey(policy), draftFor(policy)])));
      setRefreshRequired(false);
    } catch (failure) {
      setError(failure.message);
      setRefreshRequired(true);
    } finally {
      inFlight.current = false;
      setBusy('');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function updateDraft(key, change) {
    setDrafts((current) => ({ ...current, [key]: { ...current[key], ...change } }));
  }

  async function save(policy, draft, account) {
    if (inFlight.current || refreshRequired) return;
    const key = policyKey(policy);
    inFlight.current = true;
    setBusy(key);
    setError('');
    try {
      const body = {
        tenantId: data.tenantId, direction: policy.direction, currency: policy.currency, enabled: draft.enabled,
        accountId: draft.enabled ? account.id : null, accountCode: draft.enabled ? account.code : null,
        taxType: draft.enabled ? draft.taxType : null, reason: draft.reason.trim(), expectedRevision: policy.revision,
      };
      const result = resultData(await appClient.functions.invoke('xeroPrepaymentPolicySave', body,
        { ...callOptions, invalidateCache: true }));
      const saved = result.policy;
      if (result.tenantId !== body.tenantId || saved?.tenantId !== body.tenantId || policyKey(saved) !== key
        || saved.revision !== policy.revision + 1 || saved.enabled !== body.enabled
        || saved.accountId !== body.accountId || saved.accountCode !== body.accountCode || saved.taxType !== body.taxType) {
        throw new Error('The saved policy could not be verified.');
      }
      setData((current) => ({ ...current, policies: current.policies.map((row) => policyKey(row) === key ? saved : row) }));
      setDrafts((current) => ({ ...current, [key]: draftFor(saved) }));
      toast({ title: 'Prepayment policy saved' });
    } catch (failure) {
      setError(`${failure.message} Refresh policies before saving again.`);
      setRefreshRequired(true);
    } finally {
      inFlight.current = false;
      setBusy('');
    }
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">Choose the deposit account and zero-tax type Finance has reviewed for each direction and currency.</p>
        <Button type="button" variant="outline" onClick={load} disabled={Boolean(busy)}>
          {busy === 'load' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Refresh policies
        </Button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {busy === 'load' && !data && <p role="status" className="text-sm">Loading posting policies…</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {data?.policies.map((policy) => {
          const key = policyKey(policy);
          const draft = drafts[key] || draftFor(policy);
          const account = data.accountOptions.find((row) => row.id === draft.accountId);
          const validTax = data.taxOptions.some((row) => row.taxType === draft.taxType);
          const disabled = Boolean(busy) || refreshRequired;
          const ready = draft.reason.trim().length >= 5 && (!draft.enabled || (account && validTax));
          const label = `${policy.direction} ${policy.currency}`;
          return (
            <fieldset key={key} disabled={disabled} className="min-w-0 space-y-3 rounded-lg border border-border p-4">
              <legend className="px-1 font-medium">{label}</legend>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">Revision {policy.revision}</span>
                <label className="flex items-center gap-2 text-sm"><Checkbox disabled={disabled} checked={draft.enabled} onCheckedChange={(value) => updateDraft(key, { enabled: value === true })} />Enabled</label>
              </div>
              <label className="block text-sm font-medium">Deposit posting account
                <select value={draft.accountId} onChange={(event) => updateDraft(key, { accountId: event.target.value })} disabled={!draft.enabled}
                  className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60">
                  <option value="">Choose an active non-bank account</option>
                  {data.accountOptions.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium">Zero-tax type
                <select value={draft.taxType} onChange={(event) => updateDraft(key, { taxType: event.target.value })} disabled={!draft.enabled}
                  className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60">
                  <option value="">Choose an active zero-tax type</option>
                  {data.taxOptions.map((row) => <option key={row.taxType} value={row.taxType}>{row.taxType} · {row.name}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium">Finance review reason
                <textarea value={draft.reason} onChange={(event) => updateDraft(key, { reason: event.target.value })}
                  minLength={5} maxLength={1000} rows={2} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
              </label>
              <Button type="button" onClick={() => save(policy, draft, account)} disabled={!ready || disabled}>
                {busy === key && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save reviewed policy
              </Button>
            </fieldset>
          );
        })}
      </div>
    </div>
  );
}
