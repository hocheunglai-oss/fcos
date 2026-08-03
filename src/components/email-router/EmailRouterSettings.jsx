import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Loader2, MailSearch, Pencil, Plus, RefreshCw, Save, Trash2, Users } from 'lucide-react';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import StateBlock from '@/components/common/StateBlock';

function keyFromName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120);
}

function blankEditor(type) {
  if (type === 'group') return { type, id: null, displayName: '', groupKey: '', active: true, destinationIds: [], expectedRevision: null };
  return { type: 'preset', id: null, displayName: '', presetKey: '', description: '', active: true, sortOrder: 0, destinations: [], expectedRevision: null };
}

function move(items, index, delta) {
  const target = index + delta;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next.map((item, position) => ({ ...item, position: position + 1 }));
}

export default function EmailRouterSettings() {
  const [configuration, setConfiguration] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState(null);
  const [routingDraft, setRoutingDraft] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const response = await appClient.functions.invoke('emailRouterSettings', {}, { force: true });
    if (response.data?.error) {
      setConfiguration(null);
      setError(response.data.error);
    } else setConfiguration(response.data);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    setRoutingDraft(Object.fromEntries((configuration?.destinations || []).map((item) => [item.id, {
      nickname: item.nickname || '',
      included: item.included === true,
    }])));
  }, [configuration]);

  const routingUsers = useMemo(() => (configuration?.destinations || []).filter((item) => item.active), [configuration]);
  const destinations = useMemo(() => routingUsers.filter((item) => item.included), [routingUsers]);
  const groups = configuration?.groups || [];
  const presets = configuration?.presets || [];

  const changedRoutingUsers = useMemo(() => routingUsers.filter((item) => {
    const draft = routingDraft[item.id];
    return draft && (draft.nickname !== item.nickname || draft.included !== item.included);
  }), [routingDraft, routingUsers]);
  const routingValidationError = useMemo(() => {
    const nicknames = routingUsers.map((item) => routingDraft[item.id]?.nickname || '');
    if (nicknames.some((nickname) => !/^[A-Z0-9]{1,12}$/.test(nickname))) return 'Nicknames must contain 1 to 12 uppercase letters or numbers.';
    if (new Set(nicknames).size !== nicknames.length) return 'Every active FCOS user requires a unique nickname.';
    return '';
  }, [routingDraft, routingUsers]);

  const editGroup = (item = null) => setEditor(item ? { type: 'group', id: item.id, displayName: item.displayName, groupKey: item.key, active: item.active, destinationIds: item.destinationIds || [], expectedRevision: item.revision } : blankEditor('group'));
  const editPreset = (item = null) => setEditor(item ? { type: 'preset', id: item.id, displayName: item.displayName, presetKey: item.key, description: item.description, active: item.active, sortOrder: item.sortOrder, destinations: item.destinations || [], expectedRevision: item.revision } : blankEditor('preset'));

  const save = async () => {
    if (!editor) return;
    setBusy(true);
    setError('');
    const type = `${editor.type}_save`;
    const response = await appClient.functions.invoke('emailRouterSettingsSave', { operation: { ...editor, type } });
    if (response.data?.error) setError(response.data.error);
    else {
      setConfiguration(response.data);
      setEditor(null);
    }
    setBusy(false);
  };

  const saveRoutingUsers = async () => {
    if (!changedRoutingUsers.length || routingValidationError) return;
    setBusy(true);
    setError('');
    const response = await appClient.functions.invoke('emailRouterSettingsSave', {
      operation: {
        type: 'routing_users_save',
        items: changedRoutingUsers.map((item) => ({
          id: item.id,
          nickname: routingDraft[item.id].nickname,
          included: routingDraft[item.id].included,
          expectedRevision: item.revision,
        })),
      },
    });
    if (response.data?.error) setError(response.data.error);
    else setConfiguration(response.data);
    setBusy(false);
  };

  const synchronize = async () => {
    setBusy(true);
    setError('');
    for (const folder of ['inbox', 'sentitems', 'archive']) {
      const response = await appClient.functions.invoke('emailRouterDelta', { folder, maxPages: 10 });
      if (response.data?.error) {
        setError(response.data.error);
        setBusy(false);
        return;
      }
    }
    await load();
    setBusy(false);
  };

  const setName = (value) => setEditor((current) => ({ ...current, displayName: value, ...(current.id ? {} : current.type === 'group' ? { groupKey: keyFromName(value) } : current.type === 'preset' ? { presetKey: keyFromName(value) } : {}) }));
  const toggleGroupMember = (id) => setEditor((current) => ({ ...current, destinationIds: current.destinationIds.includes(id) ? current.destinationIds.filter((value) => value !== id) : [...current.destinationIds, id] }));
  const addPresetDestination = () => setEditor((current) => ({ ...current, destinations: [...current.destinations, { destinationId: destinations[0]?.id || null, groupId: null, recipientKind: 'to', position: current.destinations.length + 1 }] }));
  const updatePresetDestination = (index, patch) => setEditor((current) => ({ ...current, destinations: current.destinations.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }));

  return <section className="rounded-lg border border-border bg-card p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-sm font-semibold"><MailSearch className="h-4 w-4" />Email Router</h2><p className="mt-1 max-w-3xl text-xs text-muted-foreground">Manage the native routing directory, groups, presets, mailbox synchronization, and operational warnings.</p></div><Button variant="outline" size="icon" onClick={load} disabled={loading || busy} title="Refresh Email Router settings" aria-label="Refresh Email Router settings"><RefreshCw className={loading ? 'animate-spin' : ''} /></Button></div>
    {error && <div className="mt-4 flex items-start gap-2 border-y border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
    {loading && !configuration ? <StateBlock icon={Loader2} title="Loading Email Router configuration" description="Reading the protected Graph connection and native routing directory." /> : configuration ? <div className="mt-5 space-y-7">
      <section><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Mailbox connection</h3><p className="mt-1 text-xs text-muted-foreground">Assigned through the Graph mailbox registry. Workflow requests cannot replace this sender.</p></div><Button size="sm" variant="outline" onClick={synchronize} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}Synchronize now</Button></div><div className="mt-3 grid gap-px overflow-hidden border-y border-border bg-border sm:grid-cols-3"><div className="bg-background p-3"><p className="text-xs text-muted-foreground">Mailbox</p><p className="mt-1 text-sm font-medium">{configuration.mailbox?.label}</p></div><div className="bg-background p-3"><p className="text-xs text-muted-foreground">Microsoft 365 address</p><p className="mt-1 break-all text-sm font-medium">{configuration.mailbox?.emailAddress}</p></div><div className="bg-background p-3"><p className="text-xs text-muted-foreground">Subscriptions</p><p className="mt-1 text-sm font-medium">{configuration.subscriptions?.length || 0} registered</p></div></div></section>
      <section><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Routing directory</h3><p className="mt-1 text-xs text-muted-foreground">Only active FCOS users are eligible. Redirect labels use the nickname shown here.</p></div>{changedRoutingUsers.length > 0 && <Button size="sm" onClick={saveRoutingUsers} disabled={busy || Boolean(routingValidationError)}>{busy ? <Loader2 className="animate-spin" /> : <Save />}Save directory</Button>}</div>{routingValidationError && <p className="mt-3 text-xs font-medium text-red-600">{routingValidationError}</p>}<div className="mt-3 overflow-x-auto border-y border-border"><table className="w-full min-w-[680px] text-left text-xs"><thead className="bg-muted/40 text-muted-foreground"><tr><th className="w-24 px-3 py-2 font-semibold">Include</th><th className="w-40 px-3 py-2 font-semibold">Nickname</th><th className="px-3 py-2 font-semibold">FCOS user</th><th className="px-3 py-2 font-semibold">Email</th></tr></thead><tbody className="divide-y divide-border">{routingUsers.map((item) => <tr key={item.id}><td className="px-3 py-3"><Checkbox checked={routingDraft[item.id]?.included === true} onCheckedChange={(checked) => setRoutingDraft((current) => ({ ...current, [item.id]: { ...current[item.id], included: checked === true } }))} aria-label={`Include ${item.displayName} in Email Router`} /></td><td className="px-3 py-2"><Input value={routingDraft[item.id]?.nickname || ''} onChange={(event) => setRoutingDraft((current) => ({ ...current, [item.id]: { ...current[item.id], nickname: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) } }))} className="h-8 w-28 font-semibold" aria-label={`Nickname for ${item.displayName}`} /></td><td className="px-3 py-3 font-medium">{item.displayName}</td><td className="px-3 py-3 text-muted-foreground">{item.emailAddress}</td></tr>)}</tbody></table></div></section>
      <section><div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Groups</h3><p className="mt-1 text-xs text-muted-foreground">Reusable teams made from current routing destinations.</p></div><Button size="sm" onClick={() => editGroup()}><Plus />Add group</Button></div><div className="mt-3 divide-y divide-border border-y border-border">{groups.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 py-3"><div><p className="text-sm font-medium">{item.displayName}</p><p className="text-xs text-muted-foreground">{item.destinationIds.length} destinations · {item.active ? 'Active' : 'Inactive'}</p></div><Button variant="ghost" size="icon" onClick={() => editGroup(item)} title="Edit group" aria-label={`Edit ${item.displayName}`}><Pencil /></Button></div>)}</div></section>
      <section><div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Routing presets</h3><p className="mt-1 text-xs text-muted-foreground">Ordered To, Cc, and Bcc selections for Redirect and Forward.</p></div><Button size="sm" onClick={() => editPreset()}><Plus />Add preset</Button></div><div className="mt-3 divide-y divide-border border-y border-border">{presets.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 py-3"><div><p className="text-sm font-medium">{item.displayName}</p><p className="text-xs text-muted-foreground">{item.destinations.length} selections · {item.active ? 'Active' : 'Inactive'}</p></div><Button variant="ghost" size="icon" onClick={() => editPreset(item)} title="Edit preset" aria-label={`Edit ${item.displayName}`}><Pencil /></Button></div>)}</div></section>
      {(configuration.alerts?.length || configuration.actionCounts?.uncertain) ? <section className="border-y border-amber-200 bg-amber-50 px-3 py-3"><h3 className="text-sm font-semibold text-amber-950">Operational review</h3><p className="mt-1 text-xs text-amber-900">{configuration.actionCounts?.uncertain || 0} uncertain mail actions and {configuration.alerts?.length || 0} active mailbox alerts require review.</p></section> : null}
    </div> : null}

    <Dialog open={Boolean(editor)} onOpenChange={(open) => !open && !busy && setEditor(null)}><DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{editor?.id ? 'Edit' : 'Add'} {editor?.type === 'group' ? 'group' : 'routing preset'}</DialogTitle><DialogDescription>Changes apply to future routing selections and are revision protected.</DialogDescription></DialogHeader>{editor && <div className="space-y-4">
      <div className="space-y-2"><Label htmlFor="email-router-config-name">Name</Label><Input id="email-router-config-name" value={editor.displayName} onChange={(event) => setName(event.target.value)} maxLength={255} /></div>
      {editor.type === 'group' && <><div className="space-y-2"><Label htmlFor="email-router-config-key">Group key</Label><Input id="email-router-config-key" value={editor.groupKey} onChange={(event) => setEditor((current) => ({ ...current, groupKey: keyFromName(event.target.value) }))} /></div><div><Label>Members</Label><div className="mt-2 max-h-64 divide-y divide-border overflow-y-auto border-y border-border">{destinations.map((item) => <label key={item.id} className="flex items-center gap-3 py-2 text-sm"><Checkbox checked={editor.destinationIds.includes(item.id)} onCheckedChange={() => toggleGroupMember(item.id)} /><span className="min-w-0"><span className="block truncate font-semibold">{item.nickname}</span><span className="block truncate text-xs text-muted-foreground">{item.displayName}</span></span></label>)}</div></div></>}
      {editor.type === 'preset' && <><div className="space-y-2"><Label htmlFor="email-router-config-key">Preset key</Label><Input id="email-router-config-key" value={editor.presetKey} onChange={(event) => setEditor((current) => ({ ...current, presetKey: keyFromName(event.target.value) }))} /></div><div className="space-y-2"><Label htmlFor="email-router-config-description">Description</Label><Textarea id="email-router-config-description" value={editor.description} onChange={(event) => setEditor((current) => ({ ...current, description: event.target.value.slice(0, 1000) }))} /></div><div><div className="flex items-center justify-between gap-3"><Label>Ordered recipients</Label><Button size="sm" variant="outline" onClick={addPresetDestination} disabled={!destinations.length}><Plus />Add</Button></div><div className="mt-2 space-y-2">{editor.destinations.map((item, index) => <div key={`${index}-${item.destinationId || item.groupId}`} className="grid gap-2 border-y border-border py-2 sm:grid-cols-[90px_1fr_auto]"><Select value={item.recipientKind} onValueChange={(value) => updatePresetDestination(index, { recipientKind: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="to">To</SelectItem><SelectItem value="cc">Cc</SelectItem><SelectItem value="bcc">Bcc</SelectItem></SelectContent></Select><Select value={item.destinationId ? `d:${item.destinationId}` : `g:${item.groupId}`} onValueChange={(value) => updatePresetDestination(index, value.startsWith('d:') ? { destinationId: value.slice(2), groupId: null } : { destinationId: null, groupId: value.slice(2) })}><SelectTrigger><SelectValue placeholder="Select destination" /></SelectTrigger><SelectContent>{destinations.map((option) => <SelectItem key={`d:${option.id}`} value={`d:${option.id}`}>{option.nickname}</SelectItem>)}{groups.filter((option) => option.active).map((option) => <SelectItem key={`g:${option.id}`} value={`g:${option.id}`}><Users className="mr-2 inline h-3.5 w-3.5" />{option.displayName}</SelectItem>)}</SelectContent></Select><div className="flex"><Button variant="ghost" size="icon" onClick={() => setEditor((current) => ({ ...current, destinations: move(current.destinations, index, -1) }))} disabled={index === 0} title="Move up" aria-label="Move up"><ArrowUp /></Button><Button variant="ghost" size="icon" onClick={() => setEditor((current) => ({ ...current, destinations: move(current.destinations, index, 1) }))} disabled={index === editor.destinations.length - 1} title="Move down" aria-label="Move down"><ArrowDown /></Button><Button variant="ghost" size="icon" onClick={() => setEditor((current) => ({ ...current, destinations: current.destinations.filter((_, itemIndex) => itemIndex !== index).map((entry, position) => ({ ...entry, position: position + 1 })) }))} title="Remove" aria-label="Remove"><Trash2 /></Button></div></div>)}</div></div></>}
    </div>}<DialogFooter><Button variant="outline" onClick={() => setEditor(null)} disabled={busy}>Cancel</Button><Button onClick={save} disabled={busy || !editor?.displayName?.trim()}>{busy ? <Loader2 className="animate-spin" /> : <Save />}{busy ? 'Saving' : 'Save'}</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}
