import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2, Pencil, Plus, RefreshCw, Search, ShieldCheck, Trash2, X } from 'lucide-react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { appClient } from '@/api/appClient';
import { useNavigationAwareRequest } from '@/hooks/useNavigationAwareRequest';
import PageHeader from '@/components/common/PageHeader';
import PageMethodology from '@/components/common/PageMethodology';
import StateBlock from '@/components/common/StateBlock';
import DataStatus from '@/components/common/DataStatus';
import WorkspaceViewBar from '@/components/common/WorkspaceViewBar';
import WorkflowValidationSummary from '@/components/common/WorkflowValidationSummary';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { SPECIAL_TERMS_METHODOLOGY } from '@/lib/pageMethodologies';
import { specialTermIssues, specialTermRuleIssues } from '@/lib/workflowValidation';

const EMPTY_TERM = { id: null, name: '', termsText: '', addToConfirmation: true, addToNomination: false, confirmationRemark: '', nominationRemark: '', expectedLastModifiedAt: null };
const EMPTY_RULE = { id: null, specialTermId: '', audience: 'Buyer', account: null, port: null, product: null, country: '__any__', expectedLastModifiedAt: null };
const QUILL_MODULES = { toolbar: [[{ header: [false, 3, 4] }], ['bold', 'italic', 'underline'], [{ list: 'ordered' }, { list: 'bullet' }], ['link'], ['clean']] };

function operationId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function displayDateTime(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Hong_Kong' }).format(date);
}

function richTextToPlain(value) {
  if (!value) return '';
  if (typeof DOMParser === 'undefined') return String(value);
  const document = new DOMParser().parseFromString(String(value), 'text/html');
  return String(document.body.textContent || '').replace(/\s+/g, ' ').trim();
}

function salesforceUrl(instanceUrl, id) {
  return instanceUrl && id ? `${instanceUrl}/${id}` : null;
}

function conditionSummary(rule) {
  return [
    rule.accountName ? `${rule.accountName}${rule.accountClKey ? ` · ${rule.accountClKey}` : ''}` : null,
    rule.portName ? `${rule.portName}${rule.portCountry ? ` · ${rule.portCountry}` : ''}` : null,
    rule.productName || null,
    rule.country || null,
  ].filter(Boolean);
}

function LookupField({ label, kind, value, onChange, placeholder }) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (value) setQuery('');
  }, [value]);

  useEffect(() => {
    if (value || query.trim().length < 2) {
      setOptions([]);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      const response = await appClient.functions.invoke('specialTermsOptions', { kind, query: query.trim() }, { cache: false });
      if (cancelled) return;
      if (response.data?.error) {
        setError(response.data.error);
        setOptions([]);
      } else {
        setOptions(response.data?.options || []);
      }
      setLoading(false);
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [kind, query, value]);

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {value ? (
        <div className="flex min-h-10 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm">
          <span className="min-w-0"><strong className="block truncate font-medium">{value.label}</strong>{value.secondary && <small className="block truncate text-muted-foreground">{value.secondary}</small>}</span>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => onChange(null)} title={`Clear ${label}`}><X className="h-4 w-4" /></Button>
        </div>
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} className="pl-9" />
          {(loading || error || options.length > 0) && (
            <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg">
              {loading && <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Searching...</div>}
              {error && <div className="px-3 py-2 text-xs text-destructive">{error}</div>}
              {!loading && options.map((option) => (
                <button key={option.id} type="button" className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => onChange(option)}>
                  <strong className="block font-medium">{option.label}</strong>
                  {option.secondary && <small className="text-muted-foreground">{option.secondary}</small>}
                </button>
              ))}
              {!loading && !error && query.trim().length >= 2 && options.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">No matching records.</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SpecialTerms() {
  const { request: requestSpecialTerms } = useNavigationAwareRequest('reference');
  const [workspace, setWorkspace] = useState(null);
  const [activeTab, setActiveTab] = useState('terms');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [termForm, setTermForm] = useState(null);
  const [ruleForm, setRuleForm] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [responseMeta, setResponseMeta] = useState(null);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError('');
    await requestSpecialTerms({
      name: 'specialTermsWorkspace',
      payload: { force },
      force,
      cacheKey: 'specialTermsWorkspace',
      apply: (response) => {
        setResponseMeta(response.data?.error ? { ...response.meta, cacheStatus: 'UNAVAILABLE' } : response.meta);
        if (response.data?.error) {
          setError(response.data.error);
          setWorkspace(null);
        } else {
          setError('');
          setWorkspace(response.data || null);
        }
      },
    });
    setLoading(false);
  }, [requestSpecialTerms]);

  useEffect(() => { load(); }, [load]);

  const rulesByTerm = useMemo(() => {
    const result = new Map();
    for (const rule of workspace?.rules || []) {
      if (!result.has(rule.specialTermId)) result.set(rule.specialTermId, []);
      result.get(rule.specialTermId).push(rule);
    }
    return result;
  }, [workspace?.rules]);

  const filteredTerms = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return workspace?.terms || [];
    return (workspace?.terms || []).filter((term) => [term.name, term.termsText, richTextToPlain(term.confirmationRemark), richTextToPlain(term.nominationRemark)].some((value) => String(value || '').toLowerCase().includes(query)));
  }, [search, workspace?.terms]);

  const filteredRules = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return workspace?.rules || [];
    return (workspace?.rules || []).filter((rule) => [rule.name, rule.specialTermName, rule.audience, ...conditionSummary(rule)].some((value) => String(value || '').toLowerCase().includes(query)));
  }, [search, workspace?.rules]);

  const termValidationIssues = useMemo(() => termForm ? specialTermIssues(termForm) : [], [termForm]);
  const ruleValidationIssues = useMemo(() => ruleForm ? specialTermRuleIssues(ruleForm) : [], [ruleForm]);

  const openTerm = (term = null) => {
    setSaveAttempted(false);
    setTermForm(term ? { ...EMPTY_TERM, ...term, expectedLastModifiedAt: term.lastModifiedAt } : { ...EMPTY_TERM });
  };
  const openRule = (rule = null) => {
    setSaveAttempted(false);
    setRuleForm(rule ? {
    ...EMPTY_RULE,
    ...rule,
    country: rule.country || '__any__',
    account: rule.accountId ? { id: rule.accountId, label: rule.accountName, secondary: rule.accountClKey || 'No CL Key' } : null,
    port: rule.portId ? { id: rule.portId, label: rule.portName, secondary: rule.portCountry || '' } : null,
    product: rule.productId ? { id: rule.productId, label: rule.productName, secondary: '' } : null,
    expectedLastModifiedAt: rule.lastModifiedAt,
    } : { ...EMPTY_RULE, specialTermId: workspace?.terms?.[0]?.id || '' });
  };

  const saveTerm = async () => {
    setSaveAttempted(true);
    if (termValidationIssues.length) return;
    setBusy(true);
    setError('');
    const response = await appClient.functions.invoke('specialTermsSave', { ...termForm, operationId: operationId() }, { cache: false });
    if (response.data?.error) setError(response.data.error);
    else {
      setTermForm(null);
      setMessage(termForm.id ? 'Special Term updated in Salesforce.' : 'Special Term created in Salesforce.');
      await load(true);
    }
    setBusy(false);
  };

  const saveRule = async () => {
    setSaveAttempted(true);
    if (ruleValidationIssues.length) return;
    setBusy(true);
    setError('');
    const response = await appClient.functions.invoke('specialTermRuleSave', {
      id: ruleForm.id,
      specialTermId: ruleForm.specialTermId,
      audience: ruleForm.audience,
      accountId: ruleForm.account?.id || null,
      portId: ruleForm.port?.id || null,
      productId: ruleForm.product?.id || null,
      country: ruleForm.country === '__any__' ? null : ruleForm.country,
      expectedLastModifiedAt: ruleForm.expectedLastModifiedAt,
      operationId: operationId(),
    }, { cache: false });
    if (response.data?.error) setError(response.data.error);
    else {
      setRuleForm(null);
      setMessage(ruleForm.id ? 'Special Term rule updated in Salesforce.' : 'Special Term rule created in Salesforce.');
      await load(true);
    }
    setBusy(false);
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    setError('');
    const functionName = deleteTarget.type === 'term' ? 'specialTermsDelete' : 'specialTermRuleDelete';
    const response = await appClient.functions.invoke(functionName, { id: deleteTarget.row.id, expectedLastModifiedAt: deleteTarget.row.lastModifiedAt, auditReason: deleteReason, confirmationName: deleteConfirmation, operationId: operationId() }, { cache: false });
    if (response.data?.error) setError(response.data.error);
    else {
      setDeleteTarget(null);
      setDeleteReason('');
      setDeleteConfirmation('');
      setMessage(deleteTarget.type === 'term' ? 'Special Term and its linked rules removed from Salesforce.' : 'Special Term rule removed from Salesforce.');
      await load(true);
    }
    setBusy(false);
  };

  return (
    <div className="space-y-5 p-4 md:p-6">
      <PageHeader
        title="Special Terms"
        description="Manage Salesforce term wording and the buyer or supplier rules that apply it."
        actions={(
          <div className="flex flex-wrap gap-2">
            <PageMethodology {...SPECIAL_TERMS_METHODOLOGY} />
            <Button variant="outline" onClick={() => load(true)} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</Button>
            {workspace?.canManage && <Button onClick={() => activeTab === 'terms' ? openTerm() : openRule()}><Plus className="mr-2 h-4 w-4" />{activeTab === 'terms' ? 'Add Special Term' : 'Add Rule'}</Button>}
          </div>
        )}
      />

      {message && <Alert><ShieldCheck className="h-4 w-4" /><AlertDescription>{message}</AlertDescription></Alert>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      <WorkspaceViewBar
        views={[
          { id: 'terms', label: 'Terms', count: workspace?.terms?.length || 0 },
          { id: 'rules', label: 'Rules', count: workspace?.rules?.length || 0 },
        ]}
        value={activeTab}
        onValueChange={setActiveTab}
        status={loading ? <DataStatus meta={responseMeta} state="refreshing" label="Salesforce" /> : <DataStatus meta={responseMeta} label="Salesforce" />}
        trailing={<div className="relative w-full sm:w-80"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={activeTab === 'terms' ? 'Search term wording' : 'Search rule or condition'} className="pl-9" /></div>}
      />

      {loading && !workspace ? <StateBlock title="Loading Special Terms" description="Reading authoritative Salesforce definitions and rules." icon={Loader2} /> : null}

      {!loading && workspace && activeTab === 'terms' && (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <Table className="min-w-[980px]">
            <TableHeader><TableRow><TableHead>Special Term</TableHead><TableHead>Terms Text</TableHead><TableHead>Confirmation</TableHead><TableHead>Nomination</TableHead><TableHead>Rules</TableHead><TableHead>Last Modified</TableHead><TableHead className="w-24" /></TableRow></TableHeader>
            <TableBody>{filteredTerms.map((term) => {
              const termRules = rulesByTerm.get(term.id) || [];
              return <TableRow key={term.id}><TableCell className="font-medium"><a href={salesforceUrl(workspace.instanceUrl, term.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">{term.name}<ExternalLink className="h-3 w-3" /></a></TableCell><TableCell className="max-w-md"><p className="line-clamp-3 whitespace-pre-wrap text-sm">{term.termsText || 'Not set'}</p></TableCell><TableCell><Badge variant={term.addToConfirmation ? 'default' : 'outline'}>{term.addToConfirmation ? 'Attach PDF' : 'Not attached'}</Badge>{richTextToPlain(term.confirmationRemark) && <p className="mt-1 max-w-48 truncate text-xs text-muted-foreground">{richTextToPlain(term.confirmationRemark)}</p>}</TableCell><TableCell><Badge variant={term.addToNomination ? 'default' : 'outline'}>{term.addToNomination ? 'Attach PDF' : 'Not attached'}</Badge>{richTextToPlain(term.nominationRemark) && <p className="mt-1 max-w-48 truncate text-xs text-muted-foreground">{richTextToPlain(term.nominationRemark)}</p>}</TableCell><TableCell>{termRules.length}</TableCell><TableCell className="text-xs text-muted-foreground">{displayDateTime(term.lastModifiedAt)}</TableCell><TableCell>{workspace.canManage && <div className="flex justify-end gap-1"><Button variant="ghost" size="icon" onClick={() => openTerm(term)} title="Edit Special Term"><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="icon" className="text-destructive" onClick={() => { setDeleteTarget({ type: 'term', row: term, ruleCount: termRules.length }); setDeleteReason(''); setDeleteConfirmation(''); }} title="Remove Special Term"><Trash2 className="h-4 w-4" /></Button></div>}</TableCell></TableRow>;
            })}</TableBody>
          </Table>
          {!filteredTerms.length && <div className="p-10 text-center text-sm text-muted-foreground">No matching Special Terms.</div>}
        </div>
      )}

      {!loading && workspace && activeTab === 'rules' && (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <Table className="min-w-[1050px]">
            <TableHeader><TableRow><TableHead>Rule</TableHead><TableHead>Special Term</TableHead><TableHead>Audience</TableHead><TableHead>Conditions</TableHead><TableHead>Priority</TableHead><TableHead>Last Modified</TableHead><TableHead className="w-24" /></TableRow></TableHeader>
            <TableBody>{filteredRules.map((rule) => <TableRow key={rule.id}><TableCell><a href={salesforceUrl(workspace.instanceUrl, rule.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">{rule.name}<ExternalLink className="h-3 w-3" /></a></TableCell><TableCell>{rule.specialTermName}</TableCell><TableCell><Badge variant="outline">{rule.audience || 'Not set'}</Badge></TableCell><TableCell><div className="flex max-w-xl flex-wrap gap-1.5">{conditionSummary(rule).map((condition) => <Badge key={condition} variant="secondary">{condition}</Badge>)}</div></TableCell><TableCell>{rule.priority ?? 'Pending Salesforce'}</TableCell><TableCell className="text-xs text-muted-foreground">{displayDateTime(rule.lastModifiedAt)}</TableCell><TableCell>{workspace.canManage && <div className="flex justify-end gap-1"><Button variant="ghost" size="icon" onClick={() => openRule(rule)} title="Edit Rule"><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="icon" className="text-destructive" onClick={() => { setDeleteTarget({ type: 'rule', row: rule }); setDeleteReason(''); }} title="Remove Rule"><Trash2 className="h-4 w-4" /></Button></div>}</TableCell></TableRow>)}</TableBody>
          </Table>
          {!filteredRules.length && <div className="p-10 text-center text-sm text-muted-foreground">No matching Special Term rules.</div>}
        </div>
      )}

      <Dialog open={Boolean(termForm)} onOpenChange={(open) => !open && !busy && setTermForm(null)}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
          <DialogHeader><DialogTitle>{termForm?.id ? 'Edit Special Term' : 'Add Special Term'}</DialogTitle><DialogDescription>Salesforce remains authoritative. Rich-text remarks are used in confirmation and nomination documents.</DialogDescription></DialogHeader>
          {termForm && <div className="space-y-5"><div className="space-y-1.5"><Label>Name</Label><Input value={termForm.name} maxLength={80} onChange={(event) => setTermForm((current) => ({ ...current, name: event.target.value }))} /></div><div className="space-y-1.5"><Label>Terms Text</Label><Textarea rows={6} value={termForm.termsText} onChange={(event) => setTermForm((current) => ({ ...current, termsText: event.target.value }))} /></div><div className="grid gap-4 md:grid-cols-2"><section className="space-y-3 rounded-lg border border-border p-3"><label className="flex items-center gap-2 text-sm font-medium"><Checkbox checked={termForm.addToConfirmation} onCheckedChange={(checked) => setTermForm((current) => ({ ...current, addToConfirmation: checked === true }))} />Attach PDF to Confirmation</label><div className="space-y-1.5"><Label>Confirmation special remark</Label><div className="[&_.ql-container]:min-h-36 [&_.ql-editor]:min-h-36"><ReactQuill theme="snow" modules={QUILL_MODULES} value={termForm.confirmationRemark} onChange={(confirmationRemark) => setTermForm((current) => ({ ...current, confirmationRemark }))} /></div></div></section><section className="space-y-3 rounded-lg border border-border p-3"><label className="flex items-center gap-2 text-sm font-medium"><Checkbox checked={termForm.addToNomination} onCheckedChange={(checked) => setTermForm((current) => ({ ...current, addToNomination: checked === true }))} />Attach PDF to Nomination</label><div className="space-y-1.5"><Label>Nomination special remark</Label><div className="[&_.ql-container]:min-h-36 [&_.ql-editor]:min-h-36"><ReactQuill theme="snow" modules={QUILL_MODULES} value={termForm.nominationRemark} onChange={(nominationRemark) => setTermForm((current) => ({ ...current, nominationRemark }))} /></div></div></section></div><WorkflowValidationSummary issues={saveAttempted ? termValidationIssues : []} /></div>}
          <DialogFooter><Button variant="outline" onClick={() => setTermForm(null)} disabled={busy}>Cancel</Button><Button onClick={saveTerm} disabled={busy}>{busy ? 'Saving...' : 'Save to Salesforce'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(ruleForm)} onOpenChange={(open) => !open && !busy && setRuleForm(null)}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>{ruleForm?.id ? 'Edit Special Term Rule' : 'Add Special Term Rule'}</DialogTitle><DialogDescription>Set the dimensions Salesforce will evaluate. Salesforce calculates priority after saving.</DialogDescription></DialogHeader>
          {ruleForm && <div className="grid gap-4 md:grid-cols-2"><div className="space-y-1.5"><Label>Special Term</Label><Select value={ruleForm.specialTermId} onValueChange={(specialTermId) => setRuleForm((current) => ({ ...current, specialTermId }))}><SelectTrigger><SelectValue placeholder="Select a term" /></SelectTrigger><SelectContent>{(workspace?.terms || []).map((term) => <SelectItem key={term.id} value={term.id}>{term.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1.5"><Label>Audience</Label><Select value={ruleForm.audience} onValueChange={(audience) => setRuleForm((current) => ({ ...current, audience }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(workspace?.audienceOptions || []).map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div><LookupField label="Account" kind="account" value={ruleForm.account} onChange={(account) => setRuleForm((current) => ({ ...current, account }))} placeholder="Search Account name or CL Key" /><LookupField label="Port" kind="port" value={ruleForm.port} onChange={(port) => setRuleForm((current) => ({ ...current, port }))} placeholder="Search port name" /><LookupField label="Product" kind="product" value={ruleForm.product} onChange={(product) => setRuleForm((current) => ({ ...current, product }))} placeholder="Search active product" /><div className="space-y-1.5"><Label>Country</Label><Select value={ruleForm.country} onValueChange={(country) => setRuleForm((current) => ({ ...current, country }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__any__">Any country</SelectItem>{(workspace?.countryOptions || []).map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div><p className="md:col-span-2 text-xs text-muted-foreground">Leave dimensions empty when they should not restrict this rule. At least one Account, Port, Product, or Country is required.</p><div className="md:col-span-2"><WorkflowValidationSummary issues={saveAttempted ? ruleValidationIssues : []} /></div></div>}
          <DialogFooter><Button variant="outline" onClick={() => setRuleForm(null)} disabled={busy}>Cancel</Button><Button onClick={saveRule} disabled={busy}>{busy ? 'Saving...' : 'Save to Salesforce'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && !busy && setDeleteTarget(null)}>
        <DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{deleteTarget?.type === 'term' ? 'Remove Special Term?' : 'Remove Special Term Rule?'}</DialogTitle><DialogDescription>{deleteTarget?.type === 'term' ? `${deleteTarget?.row?.name || 'This term'} and ${deleteTarget?.ruleCount || 0} linked rule(s) will be removed from Salesforce atomically.` : `${deleteTarget?.row?.name || 'This rule'} will be removed from Salesforce.`}</DialogDescription></DialogHeader><div className="space-y-4">{deleteTarget?.type === 'term' && <div className="space-y-1.5"><Label>Type {deleteTarget.row.name} to confirm</Label><Input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoComplete="off" /></div>}<div className="space-y-1.5"><Label>Deletion reason</Label><Textarea value={deleteReason} maxLength={500} onChange={(event) => setDeleteReason(event.target.value)} placeholder="Required for the audit trail" /></div></div><DialogFooter><Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={busy}>Cancel</Button><Button variant="destructive" onClick={remove} disabled={busy || deleteReason.trim().length < 3 || (deleteTarget?.type === 'term' && deleteConfirmation !== deleteTarget.row.name)}><Trash2 className="mr-2 h-4 w-4" />{busy ? 'Removing...' : 'Remove from Salesforce'}</Button></DialogFooter></DialogContent>
      </Dialog>
    </div>
  );
}
