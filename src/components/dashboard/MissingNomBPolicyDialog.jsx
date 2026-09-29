import { useEffect, useRef, useState } from 'react';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import MissingNomBAudit, { nomBError, nomBText, NomBReceivable } from './MissingNomBEvidence';

export default function MissingNomBPolicyDialog({ row, canManage, initialDraft, onDraftChange, onClose, onSaved, onRefresh }) {
  const [mode, setMode] = useState(initialDraft?.mode || row.policy?.mode || 'automatic');
  const [reasonCode, setReasonCode] = useState(initialDraft?.reasonCode || row.policy?.reasonCode || 'payment_received');
  const [reasonText, setReasonText] = useState(initialDraft?.reasonText ?? row.policy?.reasonText ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onDraftChange?.({ mode, reasonCode, reasonText }); }, [mode, reasonCode, reasonText, onDraftChange]);
  const requiresText = mode === 'require' || (mode === 'waive' && reasonCode === 'other');
  const trimmedText = reasonText.trim();
  const invalid = mode !== 'automatic' && (trimmedText.length > 1000 || (requiresText && !trimmedText));
  const save = async (event) => {
    event.preventDefault();
    if (!canManage || invalid || saving || conflict) return;
    setSaving(true); setError('');
    try {
      const result = nomBError(await appClient.functions.invoke('dashboardNomBPolicySave', {
        stemId: row.stemId, mode, reasonCode: mode === 'waive' ? reasonCode : null,
        reasonText: mode === 'automatic' ? '' : trimmedText, expectedRevision: row.policy?.revision ?? 0,
      }, { cache: false, invalidateCache: false, invalidateNames: ['dashboardNomBRead', 'dashboardNomBAuditRead'] }));
      if (mounted.current) onSaved(result.policy);
    } catch (failure) {
      if (!mounted.current) return;
      if (failure.code === 'NOM_B_REVISION_CONFLICT') { setConflict(true); setError('This policy changed. Your text is retained. Refresh the list, then close and reopen this STEM to review the current policy before saving.'); }
      else setError(failure.message || 'The policy could not be saved. Your text is retained.');
    } finally { if (mounted.current) setSaving(false); }
  };
  const refreshList = async () => { setRefreshing(true); try { await onRefresh(); } finally { if (mounted.current) setRefreshing(false); } };
  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}><DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto p-4 sm:p-6">
    <DialogHeader><DialogTitle>Nom B policy · {row.stemReference || row.stemId}</DialogTitle><DialogDescription>{row.vessel || 'Vessel unavailable'} · {row.buyer || 'Buyer unavailable'}. Changes affect this STEM only.</DialogDescription></DialogHeader>
    <div className="text-sm"><p><span className="font-medium">Current policy:</span> {nomBText(row.policy?.mode || 'automatic')}</p>{row.policy?.reasonCode ? <p className="mt-1">{nomBText(row.policy.reasonCode)}</p> : null}{row.policy?.reasonText ? <p className="mt-1 whitespace-pre-wrap break-words">{row.policy.reasonText}</p> : null}{row.reason ? <p className="mt-2 text-muted-foreground">{row.reason}</p> : null}</div>
    {canManage ? <form onSubmit={save} className="space-y-4">
      <fieldset disabled={saving} className="space-y-4">
        <label className="block text-sm font-medium">Nom B requirement<select aria-label="Nom B requirement" value={mode} onChange={(event) => setMode(event.target.value)} className="mt-1 block min-h-10 w-full rounded-md border border-input bg-background px-3"><option value="automatic">Automatic</option><option value="waive">Waive Nom B</option><option value="require">Require Nom B</option></select></label>
        {mode === 'waive' ? <label className="block text-sm font-medium">Waiver reason<select aria-label="Waiver reason" value={reasonCode} onChange={(event) => setReasonCode(event.target.value)} className="mt-1 block min-h-10 w-full rounded-md border border-input bg-background px-3"><option value="payment_received">Payment Received</option><option value="management_exception">Management Exception</option><option value="other">Other</option></select></label> : null}
        {mode !== 'automatic' ? <label className="block text-sm font-medium">{requiresText ? 'Explanation (required)' : 'Additional notes (optional)'}<textarea aria-label={requiresText ? "Explanation (required)" : "Additional notes (optional)"} value={reasonText} onChange={(event) => setReasonText(event.target.value)} maxLength={1000} required={requiresText} rows={3} className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 font-normal" aria-describedby="nom-b-reason-help" /><span id="nom-b-reason-help" className="mt-1 block text-xs font-normal text-muted-foreground">{requiresText ? 'Enter 1–1,000 characters after trimming spaces.' : 'Up to 1,000 characters.'} {trimmedText.length}/1,000</span></label> : <p className="text-xs text-muted-foreground">Return to the server’s automatic Nom B requirement and receivable checks.</p>}
      </fieldset>
      {error ? <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"><p>{error}</p>{conflict ? <Button type="button" variant="outline" size="sm" className="mt-2" disabled={refreshing} onClick={refreshList}>{refreshing ? 'Refreshing…' : 'Refresh list'}</Button> : null}</div> : null}
      <DialogFooter className="gap-2"><Button type="button" variant="outline" disabled={saving} onClick={onClose}>Close</Button><Button type="submit" disabled={invalid || saving || conflict}>{saving ? 'Saving…' : 'Save policy'}</Button></DialogFooter>
    </form> : <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">Read-only. A General Manager or administrator can change this policy.</p>}
    <NomBReceivable row={row} /><MissingNomBAudit stemId={row.stemId} />
    {!canManage ? <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Close</Button></DialogFooter> : null}
  </DialogContent></Dialog>;
}
