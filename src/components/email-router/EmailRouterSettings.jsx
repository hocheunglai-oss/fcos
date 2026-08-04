import { useCallback, useEffect, useMemo, useState } from 'react';
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';
import {
  AlertTriangle,
  CalendarClock,
  CalendarOff,
  Contact,
  GripVertical,
  Loader2,
  MailSearch,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react';
import { appClient } from '@/api/appClient';
import StateBlock from '@/components/common/StateBlock';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import EmailRecipientPicker from './EmailRecipientPicker';
import EmailRoutingLeaveDialog from './EmailRoutingLeaveDialog';

function keyFromName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120);
}

function routingLabel(value) {
  return String(value || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
}

function entryKey(entityType, id) {
  return `${entityType}:${id}`;
}

function blankEditor(type) {
  if (type === 'destination') return { type, id: null, displayName: '', emailAddress: '', nickname: '', included: true, active: true, expectedRevision: null };
  if (type === 'group') return { type, id: null, displayName: '', groupKey: '', included: true, active: true, destinationIds: [], expectedRevision: null };
  if (type === 'preset_version') return { type, id: null, presetId: '', versionLabel: '', matchMode: 'all', priority: 0, active: true, conditionUserIds: [], destinations: [], expectedRevision: null };
  if (type === 'preset_override') return { type, id: null, presetId: '', versionId: '', startsAt: '', endsAt: '', reason: '', active: true, expectedRevision: null };
  return { type: 'preset', id: null, displayName: '', description: '', active: true, sortOrder: 0, destinations: [], baselineVersionId: null, baselineExpectedRevision: null, expectedRevision: null };
}

function hongKongDateTimeInput(value) {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const part = (type) => parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

function hongKongInputToIso(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value || ''))) return null;
  const result = new Date(`${value}:00+08:00`);
  return Number.isNaN(result.getTime()) ? null : result.toISOString();
}

function presetStorageSelections(selections) {
  const positions = { to: 0, cc: 0, bcc: 0 };
  return (Array.isArray(selections) ? selections : []).map((selection) => {
    positions[selection.kind] += 1;
    return {
      destinationId: selection.destinationId || null,
      groupId: selection.groupId || null,
      recipientKind: selection.kind,
      position: positions[selection.kind],
    };
  });
}

function presetPickerSelections(selections) {
  return (Array.isArray(selections) ? selections : []).map((selection) => ({
    destinationId: selection.destinationId || null,
    groupId: selection.groupId || null,
    kind: selection.recipientKind || selection.kind,
  }));
}

function sortedDirectory(configuration) {
  return [
    ...(configuration?.destinations || []).filter((item) => item.active).map((item) => ({ entityType: 'destination', id: item.id, sortOrder: item.sortOrder, item })),
    ...(configuration?.groups || []).filter((item) => item.active).map((item) => ({ entityType: 'group', id: item.id, sortOrder: item.sortOrder, item })),
  ].sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0)
    || left.item.displayName.localeCompare(right.item.displayName));
}

export default function EmailRouterSettings() {
  const [configuration, setConfiguration] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState(null);
  const [routingDraft, setRoutingDraft] = useState({});
  const [directoryOrder, setDirectoryOrder] = useState([]);
  const [leaveOpen, setLeaveOpen] = useState(false);

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
    if (!configuration) return;
    const rows = sortedDirectory(configuration);
    setDirectoryOrder(rows.map((row) => entryKey(row.entityType, row.id)));
    setRoutingDraft(Object.fromEntries(rows.map((row) => [entryKey(row.entityType, row.id), {
      nickname: row.entityType === 'destination' ? row.item.nickname || '' : '',
      included: row.item.included === true,
    }])));
  }, [configuration]);

  const destinations = useMemo(() => (configuration?.destinations || []).filter((item) => item.active), [configuration]);
  const groups = useMemo(() => (configuration?.groups || []).filter((item) => item.active), [configuration]);
  const presets = configuration?.presets || [];
  const routingUsers = configuration?.routingUsers || [];
  const entryByKey = useMemo(() => new Map([
    ...destinations.map((item) => [entryKey('destination', item.id), { entityType: 'destination', id: item.id, item }]),
    ...groups.map((item) => [entryKey('group', item.id), { entityType: 'group', id: item.id, item }]),
  ]), [destinations, groups]);
  const directoryRows = useMemo(() => directoryOrder.map((key) => entryByKey.get(key)).filter(Boolean), [directoryOrder, entryByKey]);
  const includedDestinations = useMemo(() => destinations.filter((item) => routingDraft[entryKey('destination', item.id)]?.included === true), [destinations, routingDraft]);
  const includedGroups = useMemo(() => groups.filter((item) => routingDraft[entryKey('group', item.id)]?.included === true), [groups, routingDraft]);
  const presetDirectory = useMemo(() => [
    ...includedDestinations.map((item) => ({ id: item.id, kind: 'destination', label: routingDraft[entryKey('destination', item.id)]?.nickname || item.nickname })),
    ...includedGroups.map((item) => ({ id: item.id, kind: 'group', label: item.displayName, memberCount: item.destinationIds?.length || 0 })),
  ], [includedDestinations, includedGroups, routingDraft]);

  const baselineOrder = useMemo(() => sortedDirectory(configuration).map((row) => entryKey(row.entityType, row.id)), [configuration]);
  const directoryChanged = useMemo(() => {
    if (directoryOrder.join('|') !== baselineOrder.join('|')) return true;
    return directoryRows.some((row) => {
      const draft = routingDraft[entryKey(row.entityType, row.id)];
      return draft && (draft.included !== row.item.included || (row.entityType === 'destination' && draft.nickname !== row.item.nickname));
    });
  }, [baselineOrder, directoryOrder, directoryRows, routingDraft]);

  const routingValidationError = useMemo(() => {
    const nicknames = destinations.map((item) => routingDraft[entryKey('destination', item.id)]?.nickname || '');
    if (nicknames.some((nickname) => !/^[A-Za-z0-9]{1,12}$/.test(nickname))) return 'Routing labels must contain 1 to 12 letters or numbers.';
    if (new Set(nicknames).size !== nicknames.length) return 'Every person requires a case-sensitive unique routing label.';
    const includedDestinationIds = new Set(includedDestinations.map((item) => item.id));
    if (includedGroups.some((group) => !(group.destinationIds || []).some((id) => includedDestinationIds.has(id)))) return 'Every included group requires at least one included person.';
    const includedGroupIds = new Set(includedGroups.map((item) => item.id));
    const invalidPreset = presets.some((preset) => preset.active && (preset.versions || []).some((version) => version.active && (version.destinations || []).some((selection) =>
      selection.destinationId ? !includedDestinationIds.has(selection.destinationId) : !includedGroupIds.has(selection.groupId))));
    if (invalidPreset) return 'An active routing preset uses a person or group you are excluding. Update that preset first.';
    return '';
  }, [destinations, includedDestinations, includedGroups, presets, routingDraft]);

  const editDestination = (item = null) => setEditor(item ? {
    type: 'destination',
    id: item.id,
    displayName: item.displayName,
    emailAddress: item.emailAddress,
    nickname: routingDraft[entryKey('destination', item.id)]?.nickname || item.nickname,
    included: routingDraft[entryKey('destination', item.id)]?.included ?? item.included,
    active: item.active,
    expectedRevision: item.revision,
  } : blankEditor('destination'));

  const editGroup = (item = null) => setEditor(item ? {
    type: 'group',
    id: item.id,
    displayName: item.displayName,
    groupKey: item.key,
    included: routingDraft[entryKey('group', item.id)]?.included ?? item.included,
    active: item.active,
    destinationIds: (item.destinationIds || []).filter((id) => includedDestinations.some((destination) => destination.id === id)),
    expectedRevision: item.revision,
  } : blankEditor('group'));

  const editPreset = (item = null) => setEditor(item ? {
    type: 'preset',
    id: item.id,
    displayName: item.displayName,
    description: item.description,
    active: item.active,
    sortOrder: item.sortOrder,
    destinations: item.destinations || [],
    baselineVersionId: item.standardVersion?.id || null,
    baselineExpectedRevision: item.standardVersion?.revision || null,
    expectedRevision: item.revision,
  } : blankEditor('preset'));

  const editPresetVersion = (preset, version = null) => setEditor(version ? {
    type: 'preset_version',
    id: version.id,
    presetId: preset.id,
    versionLabel: version.label,
    matchMode: version.matchMode || 'all',
    priority: version.priority || 0,
    active: version.active,
    conditionUserIds: version.conditionUserIds || [],
    destinations: version.destinations || [],
    expectedRevision: version.revision,
  } : { ...blankEditor('preset_version'), presetId: preset.id });

  const editPresetOverride = (preset, override = null) => {
    const now = new Date(Date.now() + 60 * 60 * 1000);
    now.setMinutes(0, 0, 0);
    const end = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    setEditor(override ? {
      type: 'preset_override',
      id: override.id,
      presetId: preset.id,
      versionId: override.versionId,
      startsAt: hongKongDateTimeInput(override.startsAt),
      endsAt: hongKongDateTimeInput(override.endsAt),
      reason: override.reason,
      active: override.active,
      expectedRevision: override.revision,
    } : { ...blankEditor('preset_override'), presetId: preset.id, versionId: preset.standardVersion?.id || '', startsAt: hongKongDateTimeInput(now), endsAt: hongKongDateTimeInput(end) });
  };

  const saveEditor = async (activeOverride = null) => {
    if (!editor) return;
    setBusy(true);
    setError('');
    const source = activeOverride == null ? editor : { ...editor, active: activeOverride };
    const operation = source.type === 'preset_override' ? {
      ...source,
      startsAt: hongKongInputToIso(editor.startsAt),
      endsAt: hongKongInputToIso(editor.endsAt),
      type: 'preset_override_save',
    } : { ...source, type: `${source.type}_save` };
    const response = await appClient.functions.invoke('emailRouterSettingsSave', { operation });
    if (response.data?.error) setError(response.data.error);
    else {
      setConfiguration(response.data);
      setEditor(null);
    }
    setBusy(false);
  };

  const saveDirectory = async () => {
    if (!directoryChanged || routingValidationError) return;
    setBusy(true);
    setError('');
    const response = await appClient.functions.invoke('emailRouterSettingsSave', {
      operation: {
        type: 'routing_directory_save',
        items: directoryRows.map((row) => {
          const draft = routingDraft[entryKey(row.entityType, row.id)];
          return {
            entityType: row.entityType,
            id: row.id,
            nickname: row.entityType === 'destination' ? draft.nickname : undefined,
            included: draft.included,
            expectedRevision: row.item.revision,
          };
        }),
      },
    });
    if (response.data?.error) setError(response.data.error);
    else setConfiguration(response.data);
    setBusy(false);
  };

  const removeEntry = async (row) => {
    const usedByPreset = presets.some((preset) => preset.active && (preset.versions || []).some((version) => version.active && (version.destinations || []).some((selection) =>
      row.entityType === 'destination' ? selection.destinationId === row.id : selection.groupId === row.id)));
    if (usedByPreset) {
      setError(`${row.item.displayName} is used by an active routing preset. Update that preset before removing this entry.`);
      return;
    }
    if (!window.confirm(`Remove ${row.item.displayName} from the routing directory? Historical mail actions will be retained.`)) return;
    setBusy(true);
    setError('');
    const operation = row.entityType === 'destination'
      ? {
          type: 'destination_save',
          id: row.id,
          displayName: row.item.displayName,
          emailAddress: row.item.emailAddress,
          nickname: routingDraft[entryKey('destination', row.id)]?.nickname || row.item.nickname,
          included: false,
          active: false,
          expectedRevision: row.item.revision,
        }
      : {
          type: 'group_save',
          id: row.id,
          displayName: row.item.displayName,
          groupKey: row.item.key,
          destinationIds: [],
          included: false,
          active: false,
          expectedRevision: row.item.revision,
        };
    const response = await appClient.functions.invoke('emailRouterSettingsSave', { operation });
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

  const onDirectoryDragEnd = ({ source, destination }) => {
    if (!destination || destination.index === source.index) return;
    setDirectoryOrder((current) => {
      const next = [...current];
      const [moved] = next.splice(source.index, 1);
      next.splice(destination.index, 0, moved);
      return next;
    });
  };

  const setName = (value) => setEditor((current) => ({
    ...current,
    displayName: value,
    ...(current.id ? {} : current.type === 'group' ? { groupKey: keyFromName(value) } : {}),
  }));
  const toggleGroupMember = (id) => setEditor((current) => ({ ...current, destinationIds: current.destinationIds.includes(id) ? current.destinationIds.filter((value) => value !== id) : [...current.destinationIds, id] }));
  const presetSelectionAvailable = useCallback((item) => item.destinationId
    ? includedDestinations.some((destination) => destination.id === item.destinationId)
    : includedGroups.some((group) => group.id === item.groupId), [includedDestinations, includedGroups]);
  const presetValidationError = useMemo(() => {
    if (!['preset', 'preset_version'].includes(editor?.type)) return '';
    if (!editor.destinations.length) return 'Add at least one recipient to the routing preset.';
    if (editor.destinations.some((item) => !presetSelectionAvailable(item))) return 'Remove or replace unavailable recipients before saving.';
    const recipientKeys = editor.destinations.map((item) => item.destinationId ? `destination:${item.destinationId}` : `group:${item.groupId}`);
    if (new Set(recipientKeys).size !== recipientKeys.length) return 'Each person or group can appear only once in a routing preset.';
    if (editor.type === 'preset') {
      const normalizedName = editor.displayName.trim().toLocaleLowerCase();
      if (presets.some((preset) => preset.id !== editor.id && preset.displayName.trim().toLocaleLowerCase() === normalizedName)) return 'Routing preset names must be unique.';
    } else {
      if (!editor.versionLabel.trim() || editor.versionLabel.trim().toLocaleLowerCase() === 'standard') return 'Enter a version label other than Standard.';
      if (!editor.conditionUserIds.length) return 'Select at least one active FCOS user for the leave rule.';
      const family = presets.find((preset) => preset.id === editor.presetId);
      if ((family?.versions || []).some((version) => version.id !== editor.id && version.label.trim().toLocaleLowerCase() === editor.versionLabel.trim().toLocaleLowerCase())) return 'Version labels must be unique within the routing preset.';
    }
    return '';
  }, [editor, presetSelectionAvailable, presets]);
  const overrideStartsAt = editor?.type === 'preset_override' ? hongKongInputToIso(editor.startsAt) : null;
  const overrideEndsAt = editor?.type === 'preset_override' ? hongKongInputToIso(editor.endsAt) : null;
  const editorInvalid = !editor
    || (['destination', 'group', 'preset'].includes(editor.type) && !editor.displayName?.trim())
    || (editor.type === 'destination' && (!/^[A-Za-z0-9]{1,12}$/.test(editor.nickname) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editor.emailAddress)))
    || (editor.type === 'group' && editor.included && !editor.destinationIds.length)
    || (editor.type === 'preset_override' && (!editor.versionId || !overrideStartsAt || !overrideEndsAt || new Date(overrideEndsAt) <= new Date(overrideStartsAt) || editor.reason.trim().length < 3))
    || Boolean(presetValidationError);
  const refreshConfiguration = () => {
    if (directoryChanged && !window.confirm('Discard the unsaved routing directory changes?')) return;
    load();
  };

  return <section className="rounded-lg border border-border bg-card p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="flex items-center gap-2 text-sm font-semibold"><MailSearch className="h-4 w-4" />Email Router</h2><p className="mt-1 max-w-3xl text-xs text-muted-foreground">Manage the native routing directory, groups, presets, mailbox synchronization, and operational warnings.</p></div>
      <Button variant="outline" size="icon" onClick={refreshConfiguration} disabled={loading || busy} title="Refresh Email Router settings" aria-label="Refresh Email Router settings"><RefreshCw className={loading ? 'animate-spin' : ''} /></Button>
    </div>
    {error && <div className="mt-4 flex items-start gap-2 border-y border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
    {loading && !configuration ? <StateBlock icon={Loader2} title="Loading Email Router configuration" description="Reading the protected Graph connection and native routing directory." /> : configuration ? <div className="mt-5 space-y-7">
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Mailbox connection</h3><p className="mt-1 text-xs text-muted-foreground">Assigned through the Graph mailbox registry. Workflow requests cannot replace this sender.</p></div><Button size="sm" variant="outline" onClick={synchronize} disabled={busy || directoryChanged} title={directoryChanged ? 'Save the routing directory first' : 'Synchronize mailbox now'}>{busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}Synchronize now</Button></div>
        <div className="mt-3 grid gap-px overflow-hidden border-y border-border bg-border sm:grid-cols-3"><div className="bg-background p-3"><p className="text-xs text-muted-foreground">Mailbox</p><p className="mt-1 text-sm font-medium">{configuration.mailbox?.label}</p></div><div className="bg-background p-3"><p className="text-xs text-muted-foreground">Microsoft 365 address</p><p className="mt-1 break-all text-sm font-medium">{configuration.mailbox?.emailAddress}</p></div><div className="bg-background p-3"><p className="text-xs text-muted-foreground">Subscriptions</p><p className="mt-1 text-sm font-medium">{configuration.subscriptions?.length || 0} registered</p></div></div>
      </section>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h3 className="text-sm font-semibold">Routing directory</h3><p className="mt-1 text-xs text-muted-foreground">Drag people and groups into the order shown during Redirect and Forward. External contacts are marked separately from FCOS users.</p></div>
          <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => editDestination()} disabled={directoryChanged} title={directoryChanged ? 'Save the routing directory first' : 'Add an external contact'}><Contact />Add external contact</Button><Button size="sm" variant="outline" onClick={() => editGroup()} disabled={directoryChanged} title={directoryChanged ? 'Save the routing directory first' : 'Add a routing group'}><Users />Add group</Button>{directoryChanged && <Button size="sm" onClick={saveDirectory} disabled={busy || Boolean(routingValidationError)}>{busy ? <Loader2 className="animate-spin" /> : <Save />}Save directory</Button>}</div>
        </div>
        {routingValidationError && <p className="mt-3 text-xs font-medium text-red-600">{routingValidationError}</p>}
        <div className="mt-3 overflow-hidden border-y border-border">
          <div className="hidden grid-cols-[2.5rem_5rem_9rem_minmax(10rem,1fr)_minmax(12rem,1fr)_5rem] bg-muted/40 px-2 py-2 text-xs font-semibold text-muted-foreground sm:grid"><span /><span>Include</span><span>Label</span><span>Name</span><span>Email / members</span><span /></div>
          <DragDropContext onDragEnd={onDirectoryDragEnd}>
            <Droppable droppableId="email-router-directory">
              {(dropProvided) => <div ref={dropProvided.innerRef} {...dropProvided.droppableProps} className="divide-y divide-border">
                {directoryRows.map((row, index) => {
                  const key = entryKey(row.entityType, row.id);
                  const draft = routingDraft[key] || {};
                  const isGroup = row.entityType === 'group';
                  const isExternal = row.item.kind === 'provider_directory';
                  return <Draggable key={key} draggableId={key} index={index} isDragDisabled={busy}>
                    {(dragProvided, dragSnapshot) => <div ref={dragProvided.innerRef} {...dragProvided.draggableProps} className={`grid gap-2 bg-background px-2 py-3 text-sm sm:grid-cols-[2.5rem_5rem_9rem_minmax(10rem,1fr)_minmax(12rem,1fr)_5rem] sm:items-center ${dragSnapshot.isDragging ? 'shadow-lg ring-1 ring-primary' : ''}`}>
                      <button type="button" {...dragProvided.dragHandleProps} className="inline-flex h-8 w-8 items-center justify-center text-muted-foreground hover:text-foreground" aria-label={`Reorder ${row.item.displayName}`} title={`Drag to reorder ${row.item.displayName}`}><GripVertical className="h-4 w-4" /></button>
                      <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground sm:hidden">Include</span><Checkbox checked={draft.included === true} onCheckedChange={(checked) => setRoutingDraft((current) => ({ ...current, [key]: { ...current[key], included: checked === true } }))} aria-label={`Include ${row.item.displayName} in Email Router`} /></div>
                      {isGroup ? <div className="flex items-center gap-2 font-semibold"><Users className="h-4 w-4 text-muted-foreground" /><span className="truncate">Group</span></div> : <Input value={draft.nickname || ''} onChange={(event) => setRoutingDraft((current) => ({ ...current, [key]: { ...current[key], nickname: routingLabel(event.target.value) } }))} className="h-8 w-28 font-semibold" aria-label={`Routing label for ${row.item.displayName}`} />}
                      <div className="min-w-0"><p className="truncate font-medium">{row.item.displayName}</p><p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">{isGroup ? <><Users className="h-3.5 w-3.5" />Routing group</> : isExternal ? <><Contact className="h-3.5 w-3.5" />External contact</> : <><UserRound className="h-3.5 w-3.5" />FCOS user</>}</p></div>
                      <p className="min-w-0 truncate text-xs text-muted-foreground">{isGroup ? `${row.item.destinationIds.length} ${row.item.destinationIds.length === 1 ? 'member' : 'members'}` : row.item.emailAddress}</p>
                      <div className="flex justify-end">{(isGroup || isExternal) && <><Button variant="ghost" size="icon" onClick={() => isGroup ? editGroup(row.item) : editDestination(row.item)} disabled={directoryChanged} title={directoryChanged ? 'Save the routing directory first' : `Edit ${row.item.displayName}`} aria-label={`Edit ${row.item.displayName}`}><Pencil /></Button><Button variant="ghost" size="icon" onClick={() => removeEntry(row)} disabled={busy || directoryChanged} title={directoryChanged ? 'Save the routing directory first' : `Remove ${row.item.displayName}`} aria-label={`Remove ${row.item.displayName}`}><Trash2 /></Button></>}</div>
                    </div>}
                  </Draggable>;
                })}
                {dropProvided.placeholder}
              </div>}
            </Droppable>
          </DragDropContext>
        </div>
      </section>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Routing presets and leave</h3><p className="mt-1 text-xs text-muted-foreground">Each preset has a Standard route and optional leave-specific versions. Scheduled overrides take priority.</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setLeaveOpen(true)}><CalendarOff />Company routing leave</Button><Button size="sm" onClick={() => editPreset()} disabled={directoryChanged} title={directoryChanged ? 'Save the routing directory first' : 'Add a routing preset'}><Plus />Add preset</Button></div></div>
        <div className="mt-3 divide-y divide-border border-y border-border">{presets.map((item) => <div key={item.id} className="py-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold">{item.displayName}</p><p className="mt-0.5 text-xs text-muted-foreground">{item.versions?.length || 0} versions · {item.active ? 'Active' : 'Inactive'}</p></div><div className="flex gap-1"><Button variant="outline" size="sm" onClick={() => editPresetVersion(item)} disabled={directoryChanged}><Plus />Version</Button><Button variant="outline" size="sm" onClick={() => editPresetOverride(item)} disabled={directoryChanged}><CalendarClock />Override</Button><Button variant="ghost" size="icon" onClick={() => editPreset(item)} disabled={directoryChanged} title="Edit preset and Standard route" aria-label={`Edit ${item.displayName}`}><Pencil /></Button></div></div>
          <div className="mt-3 divide-y divide-border border-t border-border">{(item.versions || []).map((version) => <div key={version.id} className="flex items-center justify-between gap-3 py-2 pl-3"><div><p className="text-sm font-medium">{version.label}{version.kind === 'baseline' ? ' · Baseline' : ''}</p><p className="text-xs text-muted-foreground">{version.destinations.length} selections{version.kind === 'conditional' ? ` · ${version.matchMode === 'all' ? 'All' : 'Any'} of ${version.conditionUserIds.length} users · Priority ${version.priority}` : ''}</p></div>{version.kind === 'conditional' && <Button variant="ghost" size="icon" onClick={() => editPresetVersion(item, version)} disabled={directoryChanged} title={`Edit ${version.label}`} aria-label={`Edit ${version.label}`}><Pencil /></Button>}</div>)}</div>
          {(item.overrides || []).length > 0 && <div className="mt-2 space-y-1 border-l-2 border-amber-300 pl-3">{item.overrides.map((override) => <button key={override.id} type="button" className="block w-full text-left text-xs text-amber-900 hover:underline" onClick={() => editPresetOverride(item, override)}>Override: {hongKongDateTimeInput(override.startsAt).replace('T', ' ')} to {hongKongDateTimeInput(override.endsAt).replace('T', ' ')} · {override.reason}</button>)}</div>}
        </div>)}</div>
      </section>
      {(configuration.alerts?.length || configuration.actionCounts?.uncertain) ? <section className="border-y border-amber-200 bg-amber-50 px-3 py-3"><h3 className="text-sm font-semibold text-amber-950">Operational review</h3><p className="mt-1 text-xs text-amber-900">{configuration.actionCounts?.uncertain || 0} uncertain mail actions and {configuration.alerts?.length || 0} active mailbox alerts require review.</p></section> : null}
    </div> : null}

    <EmailRoutingLeaveDialog open={leaveOpen} onOpenChange={(open) => { setLeaveOpen(open); if (!open) load(); }} scope="all" />
    <Dialog open={Boolean(editor)} onOpenChange={(open) => !open && !busy && setEditor(null)}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader><DialogTitle>{editor?.id ? 'Edit' : 'Add'} {editor?.type === 'destination' ? 'external contact' : editor?.type === 'group' ? 'group' : editor?.type === 'preset_version' ? 'routing version' : editor?.type === 'preset_override' ? 'scheduled override' : 'routing preset'}</DialogTitle><DialogDescription>Changes apply to future routing selections and are revision protected.</DialogDescription></DialogHeader>
        {editor && <div className="space-y-4">
          {['destination', 'group', 'preset'].includes(editor.type) && <div className="space-y-2"><Label htmlFor="email-router-config-name">{editor.type === 'preset' ? 'Preset name' : 'Name'}</Label><Input id="email-router-config-name" value={editor.displayName} onChange={(event) => setName(event.target.value)} maxLength={255} /></div>}
          {editor.type === 'destination' && <><div className="space-y-2"><Label htmlFor="email-router-contact-email">Email address</Label><Input id="email-router-contact-email" type="email" value={editor.emailAddress} onChange={(event) => setEditor((current) => ({ ...current, emailAddress: event.target.value.trim().toLowerCase() }))} maxLength={320} /></div><div className="space-y-2"><Label htmlFor="email-router-contact-label">Routing label</Label><Input id="email-router-contact-label" value={editor.nickname} onChange={(event) => setEditor((current) => ({ ...current, nickname: routingLabel(event.target.value) }))} maxLength={12} /><p className="text-xs text-muted-foreground">The case-sensitive short label shown on Redirect and Forward buttons.</p></div></>}
          {editor.type === 'group' && <><div className="space-y-2"><Label htmlFor="email-router-config-key">Group key</Label><Input id="email-router-config-key" value={editor.groupKey} onChange={(event) => setEditor((current) => ({ ...current, groupKey: keyFromName(event.target.value) }))} /></div><div><Label>Members</Label><div className="mt-2 max-h-64 divide-y divide-border overflow-y-auto border-y border-border">{includedDestinations.map((item) => <label key={item.id} className="flex items-center gap-3 py-2 text-sm"><Checkbox checked={editor.destinationIds.includes(item.id)} onCheckedChange={() => toggleGroupMember(item.id)} /><span className="min-w-0"><span className="block truncate font-semibold">{routingDraft[entryKey('destination', item.id)]?.nickname}</span><span className="block truncate text-xs text-muted-foreground">{item.displayName} · {item.emailAddress}</span></span></label>)}</div></div></>}
          {editor.type === 'preset' && <>
            <div className="space-y-2"><Label htmlFor="email-router-config-description">Description</Label><Textarea id="email-router-config-description" value={editor.description} onChange={(event) => setEditor((current) => ({ ...current, description: event.target.value.slice(0, 1000) }))} /></div>
            <div className="space-y-2">
              <Label>Ordered recipients</Label>
              <p className="text-xs text-muted-foreground">Select each person or group under To, Cc, or Bcc. The numbered labels show the recipient order.</p>
              {presetValidationError && <p className="flex items-center gap-2 text-xs font-medium text-amber-700"><AlertTriangle className="h-3.5 w-3.5" />{presetValidationError}</p>}
              <EmailRecipientPicker
                directory={presetDirectory}
                selections={presetPickerSelections(editor.destinations)}
                onChange={(next) => setEditor((current) => ({ ...current, destinations: presetStorageSelections(next) }))}
                allowManual={false}
              />
            </div>
          </>}
          {editor.type === 'preset_version' && <>
            <div className="grid gap-4 sm:grid-cols-[1fr_10rem_8rem]"><div className="space-y-2"><Label htmlFor="email-router-version-label">Version label</Label><Input id="email-router-version-label" value={editor.versionLabel} onChange={(event) => setEditor((current) => ({ ...current, versionLabel: event.target.value.slice(0, 120) }))} maxLength={120} placeholder="SC Leave" /></div><div className="space-y-2"><Label>Match rule</Label><Select value={editor.matchMode} onValueChange={(value) => setEditor((current) => ({ ...current, matchMode: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All listed</SelectItem><SelectItem value="any">Any listed</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label htmlFor="email-router-version-priority">Priority</Label><Input id="email-router-version-priority" type="number" min="0" max="100000" value={editor.priority} onChange={(event) => setEditor((current) => ({ ...current, priority: Math.max(0, Number(event.target.value) || 0) }))} /></div></div>
            <div><Label>People whose leave activates this version</Label><div className="mt-2 max-h-56 divide-y divide-border overflow-y-auto border-y border-border">{routingUsers.map((user) => <label key={user.id} className="flex items-center gap-3 py-2 text-sm"><Checkbox checked={editor.conditionUserIds.includes(user.id)} onCheckedChange={() => setEditor((current) => ({ ...current, conditionUserIds: current.conditionUserIds.includes(user.id) ? current.conditionUserIds.filter((id) => id !== user.id) : [...current.conditionUserIds, user.id] }))} /><span><span className="font-medium">{user.name}</span><span className="ml-2 text-xs text-muted-foreground">{user.nickname}</span></span></label>)}</div></div>
            <div className="space-y-2"><Label>Ordered recipients for this version</Label><p className="text-xs text-muted-foreground">These recipients replace the Standard route while the rule matches.</p>{presetValidationError && <p className="flex items-center gap-2 text-xs font-medium text-amber-700"><AlertTriangle className="h-3.5 w-3.5" />{presetValidationError}</p>}<EmailRecipientPicker directory={presetDirectory} selections={presetPickerSelections(editor.destinations)} onChange={(next) => setEditor((current) => ({ ...current, destinations: presetStorageSelections(next) }))} allowManual={false} /></div>
          </>}
          {editor.type === 'preset_override' && <>
            <div className="space-y-2"><Label>Routing version</Label><Select value={editor.versionId} onValueChange={(value) => setEditor((current) => ({ ...current, versionId: value }))}><SelectTrigger><SelectValue placeholder="Select a version" /></SelectTrigger><SelectContent>{(presets.find((preset) => preset.id === editor.presetId)?.versions || []).filter((version) => version.active).map((version) => <SelectItem key={version.id} value={version.id}>{version.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="email-router-override-start">Start · Hong Kong time</Label><Input id="email-router-override-start" type="datetime-local" value={editor.startsAt} onChange={(event) => setEditor((current) => ({ ...current, startsAt: event.target.value }))} /></div><div className="space-y-2"><Label htmlFor="email-router-override-end">End · Hong Kong time</Label><Input id="email-router-override-end" type="datetime-local" value={editor.endsAt} onChange={(event) => setEditor((current) => ({ ...current, endsAt: event.target.value }))} /></div></div>
            <div className="space-y-2"><Label htmlFor="email-router-override-reason">Reason</Label><Textarea id="email-router-override-reason" value={editor.reason} onChange={(event) => setEditor((current) => ({ ...current, reason: event.target.value.slice(0, 500) }))} maxLength={500} placeholder="Temporary coverage arrangement" /></div>
          </>}
        </div>}
        <DialogFooter className="gap-2">{editor?.id && ['preset_version', 'preset_override'].includes(editor.type) && <Button variant="destructive" onClick={() => saveEditor(false)} disabled={busy}>{editor.type === 'preset_override' ? 'Cancel override' : 'Remove version'}</Button>}<Button variant="outline" onClick={() => setEditor(null)} disabled={busy}>Cancel</Button><Button onClick={() => saveEditor()} disabled={busy || editorInvalid}>{busy ? <Loader2 className="animate-spin" /> : <Save />}{busy ? 'Saving' : 'Save'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
