import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { actionLabel, formatAddresses } from '@/lib/emailRouter';

const ACTION_COPY = {
  reply: { title: 'Reply', description: 'Reply to the original sender from the connected Email Router mailbox.' },
  delete: { title: 'Delete message', description: 'Request deletion of this message. This may not be reversible.' },
  undo: { title: 'Undo mail action', description: 'Request a reversal of the selected action.' },
  retry: { title: 'Review uncertain send', description: 'Retry only after checking Sent Items and confirming the earlier submission was not sent.' },
};

export default function EmailActionDialog({ open, onOpenChange, action, message, submitting, onSubmit }) {
  const [stage, setStage] = useState('form');
  const [body, setBody] = useState('');
  const copy = ACTION_COPY[action] || ACTION_COPY.reply;
  const needsBody = action === 'reply';

  useEffect(() => {
    if (!open) return;
    setStage('form');
    setBody('');
  }, [action, message?.id, open]);

  const changeOpen = (nextOpen) => {
    if (submitting) return;
    if (!nextOpen && body.trim() && !window.confirm('Discard the unsaved mail action?')) return;
    onOpenChange(nextOpen);
  };
  const submit = () => onSubmit({ action, body: body.trim() });

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{stage === 'confirm' ? `Confirm ${actionLabel(action).toLowerCase()}` : copy.title}</DialogTitle><DialogDescription>{stage === 'confirm' ? 'Review this mailbox action before continuing.' : copy.description}</DialogDescription></DialogHeader>
        {stage === 'form' ? (
          <div className="space-y-4">
            {needsBody && <div className="space-y-2"><Label htmlFor="email-router-body">Message</Label><Textarea id="email-router-body" value={body} onChange={(event) => setBody(event.target.value.slice(0, 20_000))} placeholder="Write your reply" rows={7} /></div>}
            {action === 'delete' && <div className="flex gap-3 border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><p>Deletion can be permanent depending on mailbox policy.</p></div>}
            {action === 'retry' && <div className="flex gap-3 border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><p>FCOS will check Sent Items again first. Continue only after confirming that the earlier message was not sent. This action may deliver a message.</p></div>}
          </div>
        ) : (
          <div className="space-y-3 border border-border bg-muted/30 p-4 text-sm">
            <div className="flex items-center gap-2 font-medium"><ArrowRight className="h-4 w-4 text-primary" />{actionLabel(action)}: {message?.subject || '(No subject)'}</div>
            {action === 'reply' && <p className="text-muted-foreground">Replying to: {formatAddresses(message?.from)}</p>}
            {needsBody && body && <p className="whitespace-pre-wrap border-t border-border pt-3 text-muted-foreground">{body}</p>}
          </div>
        )}
        <DialogFooter>{stage === 'confirm' ? <><Button variant="outline" onClick={() => setStage('form')} disabled={submitting}>Back</Button><Button onClick={submit} disabled={submitting}>{submitting ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}{submitting ? 'Submitting...' : `Confirm ${actionLabel(action)}`}</Button></> : <><Button variant="outline" onClick={() => changeOpen(false)} disabled={submitting}>Cancel</Button><Button onClick={() => setStage('confirm')} disabled={submitting}>{action === 'undo' ? <Undo2 /> : <ArrowRight />}Continue</Button></>}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
