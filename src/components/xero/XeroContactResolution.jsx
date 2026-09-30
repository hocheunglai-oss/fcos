import { useState } from 'react';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { xeroPortalUiCopy } from '@/lib/xeroPortalUiCopy';
import { confirmedContactIdentitySave } from '@/lib/xeroContactResolutionResult';

export default function XeroContactResolution({ row, tenantId, language, onClose, onSaved }) {
  const copy = xeroPortalUiCopy(language).contacts.identity;
  const decision = row?.identityDecision || null;
  const [choice, setChoice] = useState(decision?.decision === 'verified_xero_only' ? 'revoked' : 'verified_xero_only');
  const [note, setNote] = useState('');
  const [reference, setReference] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const valid = Boolean(tenantId && row?.xeroContactId && row?.identityFingerprint
    && note.trim().length >= 15 && note.length <= 2000 && reference.trim().length >= 1 && reference.length <= 500 && reviewed && !uncertain);

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    setError('');
    try {
      const request = {
        tenantId, contactId: row.xeroContactId, decision: choice,
        expectedRevision: decision?.revision ?? 0, expectedFingerprint: row.identityFingerprint,
        evidenceNote: note.trim(), evidenceReference: reference.trim(), reviewed: true,
      };
      const result = await appClient.functions.invoke('xeroContactIdentitySave', request, { force: true, invalidateCache: true });
      if (result.data?.error && result.meta?.cacheLayer !== 'network') { setError(result.data.error); return; }
      if (!confirmedContactIdentitySave(result.data, request)) { setUncertain(true); setError(copy.uncertain); return; }
      await onSaved();
    } catch { setUncertain(true); setError(copy.uncertain); }
    finally { setBusy(false); }
  }

  return <Dialog open={Boolean(row)} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
      <DialogHeader><DialogTitle>{copy.title}: {row?.xeroContactName}</DialogTitle><DialogDescription>{copy.description}</DialogDescription></DialogHeader>
      <div className="space-y-3 text-sm">
        <div className="rounded-lg border border-border p-3">
          <div className="font-semibold">{copy.current}</div>
          <div>{decision ? (decision.decision === 'verified_xero_only' ? copy.verified : copy.revoked) : copy.none}</div>
          {decision && <div className="mt-1 text-xs text-muted-foreground">{copy.revision}: {decision.revision} · {copy.actor}: {decision.actor_email || '—'} · {copy.updated}: {decision.updated_at || '—'}</div>}
          {decision?.evidence_note && <div className="mt-1 break-words">{decision.evidence_note}</div>}
          {decision?.evidence_reference && <div className="mt-1 break-words text-xs">{copy.reference}: {decision.evidence_reference}</div>}
        </div>
        <label className="block font-medium" htmlFor="xero-identity-decision">{copy.decision}</label>
        <select id="xero-identity-decision" className="h-9 w-full rounded-md border border-input bg-background px-3" value={choice} onChange={(event) => setChoice(event.target.value)}>
          <option value="verified_xero_only">{copy.verify}</option><option value="revoked">{copy.revoke}</option>
        </select>
        <label className="block font-medium" htmlFor="xero-identity-reference">{copy.reference}</label>
        <Input id="xero-identity-reference" maxLength={500} value={reference} onChange={(event) => setReference(event.target.value)} />
        <label className="block font-medium" htmlFor="xero-identity-note">{copy.note}</label>
        <Textarea id="xero-identity-note" maxLength={2000} rows={4} value={note} onChange={(event) => setNote(event.target.value)} />
        <p className="text-xs text-muted-foreground">{copy.noteRequirement}</p>
        <label className="flex items-center gap-2"><Checkbox checked={reviewed} onCheckedChange={(checked) => setReviewed(checked === true)} />{copy.reviewed}</label>
        {error && <p role="alert" className="text-red-700">{error}</p>}
      </div>
      <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={onClose} disabled={busy}>{copy.cancel}</Button><Button onClick={save} disabled={!valid || busy}>{choice === 'revoked' ? copy.revoke : copy.verify}</Button></div>
    </DialogContent>
  </Dialog>;
}
