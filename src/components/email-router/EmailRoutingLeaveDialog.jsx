import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarOff, Loader2, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { emailRouter } from '@/lib/emailRouter';

const HONG_KONG_OFFSET = '+08:00';

function toHongKongInput(value) {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const part = (type) => parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

function fromHongKongInput(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value || ''))) return null;
  const date = new Date(`${value}:00${HONG_KONG_OFFSET}`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatHongKongDate(value) {
  if (!value) return 'Not set';
  return new Intl.DateTimeFormat('en-HK', {
    timeZone: 'Asia/Hong_Kong', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(value));
}

function blankForm(userProfileId = '') {
  const start = new Date(Date.now() + 60 * 60 * 1000);
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 8 * 60 * 60 * 1000);
  return {
    id: null,
    userProfileId,
    startsAt: toHongKongInput(start),
    endsAt: toHongKongInput(end),
    note: '',
    expectedRevision: null,
  };
}

export default function EmailRoutingLeaveDialog({ open, onOpenChange, canManageAll = false }) {
  const [scope, setScope] = useState(canManageAll ? 'all' : 'self');
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const includeAll = scope === 'all';

  useEffect(() => {
    if (!canManageAll && scope !== 'self') setScope('self');
  }, [canManageAll, scope]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await emailRouter.leave({ scope }, { force: true });
      if (response.data?.error) throw new Error(response.data.error);
      setData(response.data);
    } catch (loadError) {
      setData(null);
      setError(loadError?.message || 'Routing leave is unavailable.');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    if (open) load();
    else setForm(null);
  }, [load, open]);

  const users = data?.users || [];
  const periods = useMemo(() => [...(data?.periods || [])].sort((left, right) => new Date(right.startsAt) - new Date(left.startsAt)), [data?.periods]);
  const changeScope = (nextScope) => {
    if (busy || nextScope === scope || (nextScope === 'all' && !canManageAll)) return;
    setForm(null);
    setData(null);
    setScope(nextScope);
  };
  const beginAdd = () => setForm(blankForm(includeAll ? users[0]?.id || '' : ''));
  const beginEdit = (period) => setForm({
    id: period.id,
    userProfileId: period.userProfileId,
    startsAt: toHongKongInput(period.startsAt),
    endsAt: toHongKongInput(period.endsAt),
    note: period.note || '',
    expectedRevision: period.revision,
  });
  const startsAt = fromHongKongInput(form?.startsAt);
  const endsAt = fromHongKongInput(form?.endsAt);
  const formInvalid = !form || (includeAll && !form.userProfileId) || !startsAt || !endsAt || new Date(endsAt) <= new Date(startsAt);

  const save = async (operation) => {
    setBusy(true);
    setError('');
    try {
      const response = await emailRouter.saveLeave({ scope, operation }, { force: true });
      if (response.data?.error) throw new Error(response.data.error);
      setData(response.data);
      setForm(null);
    } catch (saveError) {
      setError(saveError?.message || 'Routing leave could not be saved.');
    } finally {
      setBusy(false);
    }
  };
  const saveForm = () => save({
    type: 'routing_leave_save',
    id: form.id,
    userProfileId: includeAll ? form.userProfileId : undefined,
    startsAt,
    endsAt,
    note: form.note.trim(),
    active: true,
    expectedRevision: form.expectedRevision,
  });
  const cancelPeriod = (period) => {
    if (!window.confirm(`Cancel the routing leave period for ${period.userName}?`)) return;
    save({
      type: 'routing_leave_save',
      id: period.id,
      userProfileId: includeAll ? period.userProfileId : undefined,
      active: false,
      expectedRevision: period.revision,
    });
  };

  return <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
      <DialogHeader>
        <DialogTitle>Routing Leave</DialogTitle>
        <DialogDescription>{canManageAll ? 'Manage your own routing availability or the schedules of active FCOS users.' : 'Manage your routing availability.'} Exact times use Hong Kong time. This is not an HR leave request.</DialogDescription>
      </DialogHeader>
      {canManageAll && <div className="inline-flex w-fit rounded-md border border-border bg-muted/30 p-1" aria-label="Routing leave scope">
        <Button type="button" size="sm" variant={!includeAll ? 'secondary' : 'ghost'} onClick={() => changeScope('self')} disabled={busy}>My leave</Button>
        <Button type="button" size="sm" variant={includeAll ? 'secondary' : 'ghost'} onClick={() => changeScope('all')} disabled={busy}>All users</Button>
      </div>}
      {error && <div className="border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {loading && !data ? <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading routing leave</div> : <div className="space-y-5">
        <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold">Leave periods</p><p className="text-xs text-muted-foreground">Overlapping active periods for one user are rejected.</p></div><Button size="sm" onClick={beginAdd} disabled={busy || (includeAll && !users.length)}><Plus />Add period</Button></div>
        {form && <section className="space-y-4 border-y border-border bg-muted/20 px-3 py-4">
          {includeAll && <div className="space-y-2"><Label>User</Label><Select value={form.userProfileId} onValueChange={(value) => setForm((current) => ({ ...current, userProfileId: value }))} disabled={Boolean(form.id)}><SelectTrigger><SelectValue placeholder="Select an active user" /></SelectTrigger><SelectContent>{users.map((user) => <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>)}</SelectContent></Select></div>}
          <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="routing-leave-start">Start · Hong Kong time</Label><Input id="routing-leave-start" type="datetime-local" value={form.startsAt} onChange={(event) => setForm((current) => ({ ...current, startsAt: event.target.value }))} /></div><div className="space-y-2"><Label htmlFor="routing-leave-end">End · Hong Kong time</Label><Input id="routing-leave-end" type="datetime-local" value={form.endsAt} onChange={(event) => setForm((current) => ({ ...current, endsAt: event.target.value }))} /></div></div>
          <div className="space-y-2"><Label htmlFor="routing-leave-note">Private operational note · optional</Label><Textarea id="routing-leave-note" value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value.slice(0, 500) }))} maxLength={500} /></div>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setForm(null)} disabled={busy}>Cancel</Button><Button onClick={saveForm} disabled={busy || formInvalid}>{busy ? <Loader2 className="animate-spin" /> : <Save />}{busy ? 'Saving' : 'Save period'}</Button></div>
        </section>}
        <div className="divide-y divide-border border-y border-border">{periods.length ? periods.map((period) => {
          const current = new Date(period.startsAt) <= new Date() && new Date(period.endsAt) > new Date();
          const future = new Date(period.startsAt) > new Date();
          return <div key={period.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="flex items-center gap-2 text-sm font-semibold"><CalendarOff className="h-4 w-4 text-muted-foreground" />{includeAll ? period.userName : current ? 'Currently on leave' : future ? 'Scheduled leave' : 'Past leave'}</p><p className="mt-1 text-xs text-muted-foreground">{formatHongKongDate(period.startsAt)} to {formatHongKongDate(period.endsAt)}</p>{period.note && <p className="mt-1 max-w-2xl truncate text-xs text-muted-foreground">{period.note}</p>}</div><div className="flex gap-1"><Button variant="ghost" size="icon" onClick={() => beginEdit(period)} disabled={busy} title="Edit leave period" aria-label="Edit leave period"><Pencil /></Button><Button variant="ghost" size="icon" onClick={() => cancelPeriod(period)} disabled={busy} title="Cancel leave period" aria-label="Cancel leave period"><Trash2 /></Button></div></div>;
        }) : <p className="py-8 text-center text-sm text-muted-foreground">No routing leave periods are recorded.</p>}</div>
      </div>}
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Close</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
