import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Bug,
  Check,
  Clipboard,
  Download,
  Eye,
  FileText,
  History,
  Lightbulb,
  Loader2,
  MessageSquare,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
  Upload,
  UserRound,
  X,
} from 'lucide-react';
import { appClient } from '@/api/appClient';
import { useNavigationAwareRequest } from '@/hooks/useNavigationAwareRequest';
import PageHeader from '@/components/common/PageHeader';
import PageMethodology from '@/components/common/PageMethodology';
import StateBlock from '@/components/common/StateBlock';
import TableShell from '@/components/common/TableShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/supabaseClient';
import { FCOS_IMPROVEMENTS_METHODOLOGY } from '@/lib/pageMethodologies';
import { cn } from '@/lib/utils';

const DEFAULT_OPTIONS = {
  types: ['bug', 'feature_request'],
  statuses: ['Reported', 'In Progress', 'Ready for Verification', 'Closed', 'Rejected'],
  priorities: ['Low', 'Medium', 'High', 'Urgent'],
  severities: ['Low', 'Medium', 'High', 'Critical'],
  modules: [{ value: 'general', label: 'General / Cross-module' }],
};

const EMPTY_FORM = {
  type: 'bug',
  title: '',
  moduleKey: 'general',
  description: '',
  priority: 'Medium',
  severity: 'Medium',
  actualBehavior: '',
  expectedBehavior: '',
  reproductionSteps: '',
  desiredOutcome: '',
  businessValue: '',
};

function errorText(response, fallback = 'The request could not be completed.') {
  return response?.data?.error || fallback;
}

function typeLabel(value) {
  return value === 'feature_request' ? 'Feature Request' : 'Bug';
}

function formatDateTime(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatSize(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function statusClass(status) {
  if (status === 'Closed') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (status === 'Rejected') return 'border-slate-200 bg-slate-100 text-slate-700';
  if (status === 'Ready for Verification') return 'border-violet-200 bg-violet-50 text-violet-800';
  if (status === 'In Progress') return 'border-blue-200 bg-blue-50 text-blue-800';
  return 'border-amber-200 bg-amber-50 text-amber-900';
}

function statusTransitionFallback(fromStatus, toStatus) {
  if (fromStatus === 'Ready for Verification' && toStatus === 'In Progress') {
    return { status: toStatus, label: 'Return to In Progress', requiresNote: true };
  }
  if (fromStatus === 'Closed' && toStatus === 'In Progress') {
    return { status: toStatus, label: 'Reopen → In Progress', requiresNote: true };
  }
  if (fromStatus === 'Rejected' && toStatus === 'Reported') {
    return { status: toStatus, label: 'Reconsider → Reported', requiresNote: true };
  }
  return { status: toStatus, label: toStatus, requiresNote: toStatus === 'Rejected' };
}

function priorityClass(priority) {
  if (priority === 'Urgent') return 'border-red-200 bg-red-50 text-red-800';
  if (priority === 'High') return 'border-orange-200 bg-orange-50 text-orange-800';
  if (priority === 'Low') return 'border-slate-200 bg-slate-50 text-slate-700';
  return 'border-blue-200 bg-blue-50 text-blue-800';
}

function proposalSummary(proposal, users = []) {
  if (proposal.changeType === 'status') return `${proposal.payload.fromStatus || 'Current status'} → ${proposal.payload.status}`;
  if (proposal.changeType === 'assignment') {
    const user = users.find((item) => item.id === proposal.payload.assigneeUserId);
    return user ? `Assign to ${user.name}` : 'Remove assignment';
  }
  if (proposal.changeType === 'ticket_edit') return 'Update ticket details';
  return proposal.payload.body || '';
}

function ProposalBadge({ state }) {
  if (state === 'approved') return <Badge className="border-emerald-200 bg-emerald-50 text-emerald-800">Approved</Badge>;
  if (state === 'rejected') return <Badge className="border-slate-200 bg-slate-100 text-slate-700">Rejected</Badge>;
  return <Badge className="border-amber-200 bg-amber-50 text-amber-900">Pending Approval</Badge>;
}

function Field({ label, children, required = false, hint }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}{required ? ' *' : ''}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function FcosImprovements() {
  const { request: requestTickets } = useNavigationAwareRequest('collaboration');
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tickets, setTickets] = useState([]);
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [users, setUsers] = useState([]);
  const [generalManager, setGeneralManager] = useState(null);
  const [isGeneralManager, setIsGeneralManager] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState('all');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [detail, setDetail] = useState(null);
  const [detailTab, setDetailTab] = useState('overview');
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [comment, setComment] = useState('');
  const [nextStatus, setNextStatus] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [assigneeId, setAssigneeId] = useState('__none__');
  const [rejectProposal, setRejectProposal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);

  const loadTickets = useCallback(async ({ quiet = false, force = quiet } = {}) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    await requestTickets({
      name: 'improvementsList',
      force,
      apply: (response) => {
        if (response.data?.error) setError(errorText(response));
        else {
          setTickets(response.data.tickets || []);
          setOptions(response.data.options || DEFAULT_OPTIONS);
          setUsers(response.data.activeUsers || []);
          setGeneralManager(response.data.generalManager || null);
          setIsGeneralManager(Boolean(response.data.isGeneralManager));
          setError('');
        }
      },
    });
    if (quiet) setRefreshing(false); else setLoading(false);
  }, [requestTickets]);

  const openTicket = useCallback(async (ticketRef, { updateUrl = true } = {}) => {
    if (!ticketRef) return;
    setDetailLoading(true);
    const response = await appClient.functions.invoke('improvementDetail', { ticketId: ticketRef }, { force: true });
    if (response.data?.error) {
      toast({ variant: 'destructive', title: 'Ticket could not be opened', description: errorText(response) });
    } else {
      setDetail(response.data);
      setUsers(response.data.activeUsers || users);
      setGeneralManager(response.data.generalManager || generalManager);
      setIsGeneralManager(Boolean(response.data.isGeneralManager));
      setAssigneeId(response.data.ticket?.assignee?.id || response.data.generalManager?.id || generalManager?.id || '__none__');
      setNextStatus('');
      setStatusNote('');
      setComment('');
      setDetailTab('overview');
      if (updateUrl) {
        const params = new URLSearchParams(searchParams);
        params.set('ticket', response.data.ticket.id);
        setSearchParams(params, { replace: true });
      }
    }
    setDetailLoading(false);
  }, [generalManager, searchParams, setSearchParams, toast, users]);

  useEffect(() => { loadTickets(); }, [loadTickets]);

  useEffect(() => {
    const ticketRef = searchParams.get('ticket');
    if (ticketRef && !detail && !detailLoading) openTicket(ticketRef, { updateUrl: false });
  }, [detail, detailLoading, openTicket, searchParams]);

  const closeDetail = () => {
    setDetail(null);
    const params = new URLSearchParams(searchParams);
    params.delete('ticket');
    setSearchParams(params, { replace: true });
  };

  const filteredTickets = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return tickets.filter((ticket) => {
      if (view === 'bugs' && ticket.type !== 'bug') return false;
      if (view === 'features' && ticket.type !== 'feature_request') return false;
      if (view === 'pending' && !ticket.pendingApprovalCount) return false;
      if (view === 'closed' && !['Closed', 'Rejected'].includes(ticket.status)) return false;
      if (view !== 'closed' && view !== 'all' && ['Closed', 'Rejected'].includes(ticket.status)) return false;
      if (statusFilter !== 'all' && ticket.status !== statusFilter) return false;
      if (moduleFilter !== 'all' && ticket.moduleKey !== moduleFilter) return false;
      if (priorityFilter !== 'all' && ticket.priority !== priorityFilter) return false;
      if (keyword && ![ticket.key, ticket.title, ticket.description, ticket.reporter?.name, ticket.assignee?.name].some((value) => String(value || '').toLowerCase().includes(keyword))) return false;
      return true;
    });
  }, [moduleFilter, priorityFilter, search, statusFilter, tickets, view]);

  const moduleLabel = useCallback((key) => options.modules?.find((item) => item.value === key)?.label || key, [options.modules]);

  const createTicket = async () => {
    setSaving(true);
    const response = await appClient.functions.invoke('improvementCreate', form, { force: true });
    setSaving(false);
    if (response.data?.error) {
      toast({ variant: 'destructive', title: 'Ticket was not created', description: errorText(response) });
      return;
    }
    setCreateOpen(false);
    setForm(EMPTY_FORM);
    toast({ title: `${response.data.ticket.key} created`, description: 'The ticket is visible to every active FCOS user.' });
    await loadTickets({ quiet: true });
    setDetail(response.data);
    const params = new URLSearchParams(searchParams);
    params.set('ticket', response.data.ticket.id);
    setSearchParams(params, { replace: true });
    window.dispatchEvent(new CustomEvent('fcos:work-notifications-changed'));
  };

  const replaceDetail = (data) => {
    setDetail(data);
    setAssigneeId(data.ticket?.assignee?.id || data.generalManager?.id || generalManager?.id || '__none__');
    loadTickets({ quiet: true });
    window.dispatchEvent(new CustomEvent('fcos:work-notifications-changed'));
  };

  const submitProposal = async (payload, successTitle) => {
    if (!detail?.ticket) return;
    setSaving(true);
    const response = await appClient.functions.invoke('improvementPropose', {
      ticketId: detail.ticket.id,
      expectedRevision: detail.ticket.revision,
      ...payload,
    }, { force: true });
    setSaving(false);
    if (response.data?.error) {
      toast({ variant: 'destructive', title: 'Proposal was not saved', description: errorText(response) });
      return false;
    }
    replaceDetail(response.data);
    toast({ title: successTitle, description: response.data.isGeneralManager ? 'Applied immediately as an approved General Manager change.' : `Pending approval by ${response.data.generalManager?.name || 'the General Manager'}.` });
    return true;
  };

  const addComment = async () => {
    const saved = await submitProposal({ changeType: 'comment', comment }, 'Comment submitted');
    if (saved) setComment('');
  };

  const proposeStatus = async () => {
    const saved = await submitProposal({ changeType: 'status', status: nextStatus, note: statusNote }, 'Status change submitted');
    if (saved) { setNextStatus(''); setStatusNote(''); }
  };

  const proposeAssignment = async () => {
    await submitProposal({ changeType: 'assignment', assigneeUserId: assigneeId === '__none__' ? null : assigneeId }, 'Assignment change submitted');
  };

  const decide = async (proposal, decision, reason = '') => {
    setSaving(true);
    const response = await appClient.functions.invoke('improvementDecision', { proposalId: proposal.id, decision, reason }, { force: true });
    setSaving(false);
    if (response.data?.error) {
      toast({ variant: 'destructive', title: 'Decision was not saved', description: errorText(response) });
      return;
    }
    replaceDetail(response.data);
    setRejectProposal(null);
    setRejectReason('');
    toast({ title: decision === 'approved' ? 'Proposal approved' : 'Proposal rejected' });
  };

  const copyCodexPrompt = async () => {
    if (!detail?.ticket) return;
    const key = detail.ticket.key;
    const prompt = `Open FCOS Improvements ticket ${key}, investigate the reported issue or request in the FCOS repository, and implement the appropriate fix. Start with: npm run improvements:agent -- show ${key}. Add progress or findings with: npm run improvements:agent -- comment ${key} --body "...". Propose workflow status changes through the same helper. Never approve your own proposal; General Manager approval is required in FCOS.`;
    await navigator.clipboard.writeText(prompt);
    toast({ title: 'Codex prompt copied', description: `${key} is included as the permanent reference.` });
  };

  const uploadFiles = async (files) => {
    if (!detail?.ticket || !files?.length || uploading) return;
    setUploading(true);
    const failures = [];
    let latest = null;
    for (const file of Array.from(files)) {
      const prepared = await appClient.functions.invoke('improvementAttachmentPrepare', {
        ticketId: detail.ticket.id,
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
      }, { force: true });
      if (prepared.data?.error) { failures.push(`${file.name}: ${errorText(prepared)}`); continue; }
      const upload = await supabase?.storage?.from(prepared.data.bucket).uploadToSignedUrl(prepared.data.path, prepared.data.token, file, { contentType: prepared.data.contentType });
      if (upload?.error) { failures.push(`${file.name}: ${upload.error.message || 'private upload failed'}`); continue; }
      const completed = await appClient.functions.invoke('improvementAttachmentComplete', { attachmentId: prepared.data.attachmentId }, { force: true });
      if (completed.data?.error) failures.push(`${file.name}: ${errorText(completed)}`); else latest = completed.data;
    }
    if (latest) replaceDetail(latest);
    setUploading(false);
    setDragActive(false);
    if (failures.length) toast({ variant: 'destructive', title: 'Some files were not uploaded', description: failures.slice(0, 2).join(' ') });
    else toast({ title: 'Files uploaded', description: 'Private attachments are available to active FCOS users.' });
  };

  const accessAttachment = async (attachment, download = false) => {
    const previewWindow = download ? null : window.open('', '_blank', 'noopener,noreferrer');
    const response = await appClient.functions.invoke('improvementAttachmentUrl', { attachmentId: attachment.id, download }, { force: true });
    if (response.data?.error) {
      previewWindow?.close();
      toast({ variant: 'destructive', title: 'File could not be opened', description: errorText(response) });
      return;
    }
    if (download) {
      const link = document.createElement('a');
      link.href = response.data.url;
      link.download = response.data.displayFilename;
      link.click();
    } else if (previewWindow) previewWindow.location = response.data.url;
  };

  const deleteAttachment = async (attachment) => {
    if (!window.confirm(`Remove ${attachment.displayFilename}?`)) return;
    const response = await appClient.functions.invoke('improvementAttachmentDelete', { attachmentId: attachment.id }, { force: true });
    if (response.data?.error) toast({ variant: 'destructive', title: 'File was not removed', description: errorText(response) });
    else replaceDetail(response.data);
  };

  const ticket = detail?.ticket;
  const workflowProposals = detail?.proposals?.filter((proposal) => proposal.changeType !== 'comment') || [];
  const pendingProposals = detail?.proposals?.filter((proposal) => proposal.approvalState === 'pending') || [];
  const allowedStatusTransitions = ticket?.allowedStatusTransitions?.length
    ? ticket.allowedStatusTransitions
    : (ticket?.allowedNextStatuses || []).map((status) => statusTransitionFallback(ticket.status, status));
  const selectedStatusTransition = allowedStatusTransitions.find((transition) => transition.status === nextStatus);

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Lightbulb}
        eyebrow="Personal"
        title="FCOS Improvements"
        description="Report bugs, propose features, and follow every approved decision in one shared queue."
        meta={loading ? 'Loading tickets...' : `${filteredTickets.length.toLocaleString()} ticket${filteredTickets.length === 1 ? '' : 's'} shown`}
        actions={(
          <>
            <PageMethodology {...FCOS_IMPROVEMENTS_METHODOLOGY} />
            <Button variant="outline" size="icon" onClick={() => loadTickets({ quiet: true })} disabled={refreshing} aria-label="Refresh tickets" title="Refresh tickets">
              <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
            </Button>
            <Button onClick={() => { setForm(EMPTY_FORM); setCreateOpen(true); }}><Plus className="h-4 w-4" />New ticket</Button>
          </>
        )}
      />

      {error ? (
        <TableShell><StateBlock icon={AlertTriangle} title="FCOS Improvements is unavailable" description={error} action={<Button variant="outline" onClick={() => loadTickets()}>Try again</Button>} /></TableShell>
      ) : (
        <TableShell bodyClassName="p-0">
          <div className="border-b border-border p-4">
            <Tabs value={view} onValueChange={setView}>
              <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-5 lg:w-auto">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="bugs">Bugs</TabsTrigger>
                <TabsTrigger value="features">Features</TabsTrigger>
                <TabsTrigger value="pending">Pending</TabsTrigger>
                <TabsTrigger value="closed">Closed</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <div className="relative xl:col-span-2">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search key, title, reporter, or assignee" className="pl-9" />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger><SelectValue placeholder="All statuses" /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{options.statuses.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>
              <Select value={moduleFilter} onValueChange={setModuleFilter}><SelectTrigger><SelectValue placeholder="All areas" /></SelectTrigger><SelectContent><SelectItem value="all">All areas</SelectItem>{options.modules.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select>
              <Select value={priorityFilter} onValueChange={setPriorityFilter}><SelectTrigger><SelectValue placeholder="All priorities" /></SelectTrigger><SelectContent><SelectItem value="all">All priorities</SelectItem>{options.priorities.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>
            </div>
          </div>

          {loading ? (
            <StateBlock icon={Loader2} title="Loading improvement tickets" description="Retrieving the shared FCOS queue." />
          ) : filteredTickets.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Ticket</TableHead><TableHead>Title</TableHead><TableHead>Area</TableHead><TableHead>Status</TableHead><TableHead>Priority</TableHead><TableHead>Reporter</TableHead><TableHead>Assignee</TableHead><TableHead className="text-right">Updated</TableHead></TableRow></TableHeader>
                <TableBody>
                  {filteredTickets.map((item) => (
                    <TableRow key={item.id} className="cursor-pointer" onClick={() => openTicket(item.id)}>
                      <TableCell><div className="flex items-center gap-2">{item.type === 'bug' ? <Bug className="h-4 w-4 text-rose-600" /> : <Lightbulb className="h-4 w-4 text-amber-600" />}<span className="font-mono text-xs font-semibold">{item.key}</span></div></TableCell>
                      <TableCell className="min-w-[260px]"><div className="font-medium">{item.title}</div>{item.pendingApprovalCount > 0 && <div className="mt-1 text-xs font-medium text-amber-700">{item.pendingApprovalCount} pending approval</div>}</TableCell>
                      <TableCell>{moduleLabel(item.moduleKey)}</TableCell>
                      <TableCell><Badge variant="outline" className={statusClass(item.status)}>{item.status}</Badge></TableCell>
                      <TableCell><Badge variant="outline" className={priorityClass(item.priority)}>{item.priority}</Badge></TableCell>
                      <TableCell>{item.reporter?.name}</TableCell>
                      <TableCell>{item.assignee?.name || <span className="text-muted-foreground">Unassigned</span>}</TableCell>
                      <TableCell className="whitespace-nowrap text-right text-xs text-muted-foreground">{formatDateTime(item.updatedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : <StateBlock icon={Search} title="No tickets match this view" description="Change the filters or create a new ticket." />}
        </TableShell>
      )}

      <Dialog open={createOpen} onOpenChange={(open) => !saving && setCreateOpen(open)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>New FCOS improvement</DialogTitle><DialogDescription>The ticket is immediately visible to every active FCOS user and assigned by default to the current General Manager.</DialogDescription></DialogHeader>
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-1">
            <Button type="button" variant={form.type === 'bug' ? 'secondary' : 'ghost'} onClick={() => setForm((current) => ({ ...current, type: 'bug' }))}><Bug className="h-4 w-4" />Bug</Button>
            <Button type="button" variant={form.type === 'feature_request' ? 'secondary' : 'ghost'} onClick={() => setForm((current) => ({ ...current, type: 'feature_request' }))}><Lightbulb className="h-4 w-4" />Feature Request</Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title" required><Input value={form.title} maxLength={255} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="Concise, searchable summary" /></Field>
            <Field label="FCOS area" required><Select value={form.moduleKey} onValueChange={(value) => setForm((current) => ({ ...current, moduleKey: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{options.modules.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Priority" required><Select value={form.priority} onValueChange={(value) => setForm((current) => ({ ...current, priority: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{options.priorities.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></Field>
            {form.type === 'bug' && <Field label="Severity" required><Select value={form.severity} onValueChange={(value) => setForm((current) => ({ ...current, severity: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{options.severities.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></Field>}
          </div>
          <Field label="Description" required><Textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} rows={4} placeholder="Context, affected workflow, and business impact" /></Field>
          {form.type === 'bug' ? (
            <div className="grid gap-4">
              <Field label="What actually happened" required><Textarea value={form.actualBehavior} onChange={(event) => setForm((current) => ({ ...current, actualBehavior: event.target.value }))} rows={3} /></Field>
              <Field label="What should have happened" required><Textarea value={form.expectedBehavior} onChange={(event) => setForm((current) => ({ ...current, expectedBehavior: event.target.value }))} rows={3} /></Field>
              <Field label="Steps to reproduce" required><Textarea value={form.reproductionSteps} onChange={(event) => setForm((current) => ({ ...current, reproductionSteps: event.target.value }))} rows={4} placeholder={'1. Open ...\n2. Select ...\n3. Observe ...'} /></Field>
            </div>
          ) : (
            <div className="grid gap-4">
              <Field label="Desired outcome" required><Textarea value={form.desiredOutcome} onChange={(event) => setForm((current) => ({ ...current, desiredOutcome: event.target.value }))} rows={4} /></Field>
              <Field label="Business value" required><Textarea value={form.businessValue} onChange={(event) => setForm((current) => ({ ...current, businessValue: event.target.value }))} rows={4} /></Field>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>Cancel</Button><Button onClick={createTicket} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Create ticket</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={Boolean(detail) || detailLoading} onOpenChange={(open) => !open && closeDetail()}>
        <SheetContent className="w-full overflow-hidden p-0 sm:max-w-[min(980px,calc(100vw-2rem))]">
          {detailLoading && !detail ? <StateBlock icon={Loader2} title="Opening ticket" description="Loading the current workflow state." /> : ticket && (
            <div className="flex h-full min-h-0 flex-col">
              <SheetHeader className="border-b border-border px-5 py-4 pr-12">
                <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{typeLabel(ticket.type)}</Badge><Badge variant="outline" className={statusClass(ticket.status)}>{ticket.status}</Badge><Badge variant="outline" className={priorityClass(ticket.priority)}>{ticket.priority}</Badge>{pendingProposals.length > 0 && <Badge className="border-amber-200 bg-amber-50 text-amber-900">{pendingProposals.length} Pending Approval</Badge>}</div>
                <SheetTitle className="mt-2 text-xl">{ticket.key} · {ticket.title}</SheetTitle>
                <SheetDescription>{moduleLabel(ticket.moduleKey)} · reported by {ticket.reporter?.name} · updated {formatDateTime(ticket.updatedAt)}</SheetDescription>
                <div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={copyCodexPrompt}><Clipboard className="h-4 w-4" />Copy Codex prompt</Button></div>
              </SheetHeader>

              <Tabs value={detailTab} onValueChange={setDetailTab} className="flex min-h-0 flex-1 flex-col">
                <div className="border-b border-border px-5"><TabsList className="h-11 bg-transparent p-0"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="discussion">Discussion ({detail.comments?.length || 0})</TabsTrigger><TabsTrigger value="files">Files ({detail.attachments?.length || 0})</TabsTrigger><TabsTrigger value="activity">Activity</TabsTrigger></TabsList></div>
                <ScrollArea className="min-h-0 flex-1">
                  <TabsContent value="overview" className="m-0 space-y-6 p-5">
                    <section><h3 className="text-sm font-semibold">Description</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{ticket.description}</p></section>
                    {ticket.type === 'bug' ? (
                      <div className="grid gap-5 lg:grid-cols-3">
                        <section><h3 className="text-sm font-semibold">Actual behaviour</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{ticket.actualBehavior}</p></section>
                        <section><h3 className="text-sm font-semibold">Expected behaviour</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{ticket.expectedBehavior}</p></section>
                        <section><h3 className="text-sm font-semibold">Steps to reproduce</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{ticket.reproductionSteps}</p></section>
                      </div>
                    ) : (
                      <div className="grid gap-5 lg:grid-cols-2"><section><h3 className="text-sm font-semibold">Desired outcome</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{ticket.desiredOutcome}</p></section><section><h3 className="text-sm font-semibold">Business value</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{ticket.businessValue}</p></section></div>
                    )}

                    {ticket.permissions?.canProposeWorkflow && (
                      <section className="border-t border-border pt-5"><h3 className="text-sm font-semibold">Propose workflow change</h3><p className="mt-1 text-xs text-muted-foreground">{isGeneralManager ? 'Your changes apply immediately as approved.' : `Changes remain pending until ${generalManager?.name || 'the General Manager'} approves them.`}</p><div className="mt-4 grid gap-4 lg:grid-cols-2">
                        <div className="space-y-3"><Field label="Next status"><Select value={nextStatus || undefined} onValueChange={(value) => { setNextStatus(value); setStatusNote(''); }}><SelectTrigger><SelectValue placeholder="Select next status" /></SelectTrigger><SelectContent>{allowedStatusTransitions.map((transition) => <SelectItem key={transition.status} value={transition.status}>{transition.label}</SelectItem>)}</SelectContent></Select></Field>{nextStatus && <Textarea value={statusNote} onChange={(event) => setStatusNote(event.target.value)} rows={2} placeholder={selectedStatusTransition?.requiresNote ? 'Reason required' : 'Optional decision note'} />}<Button onClick={proposeStatus} disabled={!nextStatus || saving || (selectedStatusTransition?.requiresNote && !statusNote.trim())}><ArrowRight className="h-4 w-4" />Submit status change</Button></div>
                        <div className="space-y-3"><Field label="Accountable assignee"><Select value={assigneeId} onValueChange={setAssigneeId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">Unassigned</SelectItem>{users.map((user) => <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>)}</SelectContent></Select></Field><Button variant="outline" onClick={proposeAssignment} disabled={saving || assigneeId === (ticket.assignee?.id || '__none__')}><UserRound className="h-4 w-4" />Submit assignment change</Button></div>
                      </div></section>
                    )}

                    <section className="border-t border-border pt-5"><h3 className="text-sm font-semibold">Workflow proposals</h3><div className="mt-3 space-y-3">{workflowProposals.length ? workflowProposals.map((proposal) => (
                      <div key={proposal.id} className={cn('rounded-lg border p-4', proposal.approvalState === 'pending' ? 'border-amber-200 bg-amber-50/60' : 'border-border')}><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><ProposalBadge state={proposal.approvalState} /><span className="text-xs font-medium uppercase text-muted-foreground">{proposal.changeType.replace('_', ' ')}</span></div><p className="mt-2 text-sm font-medium">{proposalSummary(proposal, users)}</p>{proposal.payload.note && <p className="mt-1 text-sm text-muted-foreground">{proposal.payload.note}</p>}<p className="mt-2 text-xs text-muted-foreground">Proposed by {proposal.proposer.name} · {formatDateTime(proposal.createdAt)}</p>{proposal.reviewReason && <p className="mt-1 text-xs text-muted-foreground">Decision note: {proposal.reviewReason}</p>}</div>{isGeneralManager && proposal.approvalState === 'pending' && <div className="flex gap-2"><Button size="sm" onClick={() => decide(proposal, 'approved')} disabled={saving}><Check className="h-4 w-4" />Approve</Button><Button size="sm" variant="outline" onClick={() => { setRejectProposal(proposal); setRejectReason(''); }} disabled={saving}><X className="h-4 w-4" />Reject</Button></div>}</div></div>
                    )) : <p className="text-sm text-muted-foreground">No workflow changes have been proposed.</p>}</div></section>
                  </TabsContent>

                  <TabsContent value="discussion" className="m-0 space-y-5 p-5">
                    <section><Label htmlFor="improvement-comment">New comment</Label><Textarea id="improvement-comment" value={comment} onChange={(event) => setComment(event.target.value)} rows={4} className="mt-2" placeholder="Share an observation, question, root cause, or verification result." /><div className="mt-3 flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{isGeneralManager ? 'Your comment is approved immediately.' : `Visible now as Pending Approval until ${generalManager?.name || 'the General Manager'} decides.`}</p><Button onClick={addComment} disabled={!comment.trim() || saving}><Send className="h-4 w-4" />Submit comment</Button></div></section>
                    <section className="border-t border-border pt-5"><div className="space-y-4">{detail.comments?.length ? [...detail.comments].reverse().map((proposal) => (
                      <article key={proposal.id} className={cn('rounded-lg border p-4', proposal.approvalState === 'pending' ? 'border-amber-200 bg-amber-50/60' : 'border-border')}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">{proposal.proposer.name}</span><ProposalBadge state={proposal.approvalState} /><span className="text-xs text-muted-foreground">{formatDateTime(proposal.createdAt)}</span></div>{proposal.approvalState === 'rejected' ? <p className="mt-3 text-sm italic text-muted-foreground">Comment rejected. {proposal.reviewReason || ''}</p> : <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{proposal.payload.body}</p>}</div>{isGeneralManager && proposal.approvalState === 'pending' && <div className="flex gap-2"><Button size="sm" onClick={() => decide(proposal, 'approved')} disabled={saving}><Check className="h-4 w-4" />Approve</Button><Button size="sm" variant="outline" onClick={() => { setRejectProposal(proposal); setRejectReason(''); }} disabled={saving}><X className="h-4 w-4" />Reject</Button></div>}</div></article>
                    )) : <StateBlock icon={MessageSquare} title="No comments yet" description="Add the first shared observation or decision request." />}</div></section>
                  </TabsContent>

                  <TabsContent value="files" className="m-0 space-y-5 p-5">
                    <div className={cn('flex min-h-36 flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center transition-colors', dragActive ? 'border-blue-500 bg-blue-50' : 'border-border bg-muted/20')} onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { event.preventDefault(); if (event.currentTarget === event.target) setDragActive(false); }} onDrop={(event) => { event.preventDefault(); uploadFiles(event.dataTransfer.files); }}>
                      {uploading ? <Loader2 className="h-7 w-7 animate-spin text-blue-600" /> : <Upload className="h-7 w-7 text-muted-foreground" />}<p className="mt-3 text-sm font-medium">Drag files here or choose files</p><p className="mt-1 text-xs text-muted-foreground">Private, up to 20 MB. PDF, Office, image, text, CSV, and email files.</p><Button className="mt-3" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploading}>Choose files</Button><input ref={fileInputRef} type="file" multiple className="hidden" onChange={(event) => uploadFiles(event.target.files)} />
                    </div>
                    <div className="divide-y divide-border rounded-lg border border-border">{detail.attachments?.length ? detail.attachments.map((attachment) => (
                      <div key={attachment.id} className="flex items-center gap-3 p-3"><FileText className="h-5 w-5 shrink-0 text-blue-600" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{attachment.displayFilename}</p><p className="text-xs text-muted-foreground">{formatSize(attachment.size)} · {attachment.uploadedBy.name} · {formatDateTime(attachment.completedAt)}</p></div><Button size="icon" variant="ghost" onClick={() => accessAttachment(attachment)} title="Preview"><Eye className="h-4 w-4" /></Button><Button size="icon" variant="ghost" onClick={() => accessAttachment(attachment, true)} title="Download"><Download className="h-4 w-4" /></Button>{ticket.permissions?.canDeleteAttachment && <Button size="icon" variant="ghost" className="text-red-600" onClick={() => deleteAttachment(attachment)} title="Remove"><Trash2 className="h-4 w-4" /></Button>}</div>
                    )) : <StateBlock icon={Paperclip} title="No files attached" description="Add screenshots, documents, or verification evidence." />}</div>
                  </TabsContent>

                  <TabsContent value="activity" className="m-0 p-5"><div className="space-y-4">{detail.events?.length ? detail.events.map((event) => (
                    <div key={event.id} className="flex gap-3"><div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted"><History className="h-4 w-4 text-muted-foreground" /></div><div className="min-w-0"><p className="text-sm font-medium">{event.summary}</p><p className="mt-0.5 text-xs text-muted-foreground">{event.actor?.name} · {formatDateTime(event.createdAt)}</p></div></div>
                  )) : <StateBlock icon={History} title="No activity recorded" />}</div></TabsContent>
                </ScrollArea>
              </Tabs>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={Boolean(rejectProposal)} onOpenChange={(open) => !saving && !open && setRejectProposal(null)}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle>Reject proposed change</DialogTitle><DialogDescription>The proposal remains in history with your decision reason.</DialogDescription></DialogHeader><Field label="Reason" required><Textarea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} rows={4} /></Field><DialogFooter><Button variant="outline" onClick={() => setRejectProposal(null)} disabled={saving}>Cancel</Button><Button variant="destructive" onClick={() => decide(rejectProposal, 'rejected', rejectReason)} disabled={saving || !rejectReason.trim()}>Reject proposal</Button></DialogFooter></DialogContent>
      </Dialog>
    </div>
  );
}
