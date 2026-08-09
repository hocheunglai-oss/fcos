import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Download, ExternalLink, Loader2, Pencil, Plus, RefreshCw, Search, ShieldCheck, Trash2, X } from 'lucide-react';
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
import ClauseBankPanel from '@/components/special-terms/ClauseBankPanel';
import ClauseComposer from '@/components/special-terms/ClauseComposer';
import MigrationReviewPanel from '@/components/special-terms/MigrationReviewPanel';
import MigrationInventoryPanel from '@/components/special-terms/MigrationInventoryPanel';
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
import { richTextToCopyText, richTextToPlain, specialTermFilenameKey } from '@/lib/specialTermsText';
import { specialTermIssues, specialTermRuleIssues } from '@/lib/workflowValidation';

const EMPTY_TERM = { id: null, name: '', termsText: '', clauseStructureStatus: 'Active', addToConfirmation: true, addToNomination: false, confirmationRemark: '', nominationRemark: '', expectedLastModifiedAt: null };
const EMPTY_RULE = { id: null, specialTermId: '', audience: 'Buyer', account: null, port: null, product: null, country: '__any__', expectedLastModifiedAt: null };
const QUILL_MODULES = { toolbar: [[{ header: [false, 3, 4] }], ['bold', 'italic', 'underline'], [{ list: 'ordered' }, { list: 'bullet' }], ['link'], ['clean']] };
const SPECIAL_TERMS_PDF_DOWNLOADS_ENABLED = false;

function operationId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function displayDateTime(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Hong_Kong' }).format(date);
}

async function writeClipboardText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Clipboard access is unavailable.');
}

function triggerDownload(result) {
  const url = URL.createObjectURL(result.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = result.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
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
  const [termDetail, setTermDetail] = useState(null);
  const [termLoading, setTermLoading] = useState(false);
  const [ruleForm, setRuleForm] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [responseMeta, setResponseMeta] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [selectedTermIds, setSelectedTermIds] = useState([]);
  const [exportProgress, setExportProgress] = useState(null);
  const [failedTermIds, setFailedTermIds] = useState([]);
  const [copiedRemarks, setCopiedRemarks] = useState({});
  const copyTimers = useRef(new Map());

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

  useEffect(() => () => {
    for (const timer of copyTimers.current.values()) window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const available = new Set((workspace?.terms || []).map((term) => term.id));
    setSelectedTermIds((current) => current.filter((id) => available.has(id)));
    setFailedTermIds((current) => current.filter((id) => available.has(id)));
  }, [workspace?.terms]);

  const downloadTerms = async (terms) => {
    if (!SPECIAL_TERMS_PDF_DOWNLOADS_ENABLED) return;
    if (!terms.length || exporting) return;
    setExporting(true);
    setError('');
    setFailedTermIds([]);
    if (terms.length > 1) setMessage('Your browser may ask permission to download multiple files.');
    const downloaded = [];
    const failed = [];
    const duplicateNames = new Map();
    for (let index = 0; index < terms.length; index += 1) {
      const term = terms[index];
      setExportProgress({ current: index + 1, total: terms.length, name: term.name });
      const nameKey = specialTermFilenameKey(term.name);
      const duplicateIndex = duplicateNames.get(nameKey) || 0;
      duplicateNames.set(nameKey, duplicateIndex + 1);
      try {
        const result = await appClient.functions.download('specialTermsPdfExport', {
          termId: term.id,
          duplicateIndex,
        });
        triggerDownload(result);
        downloaded.push(term.id);
      } catch (downloadError) {
        failed.push({ id: term.id, name: term.name, message: downloadError.message || 'Download failed.' });
      }
      if (terms.length > 1) await new Promise((resolve) => window.setTimeout(resolve, 180));
    }
    setSelectedTermIds((current) => current.filter((id) => !downloaded.includes(id)));
    setFailedTermIds(failed.map((item) => item.id));
    if (failed.length) {
      setError(`${failed.length} Special Term PDF${failed.length === 1 ? '' : 's'} could not be downloaded. The failed selection remains available to retry.`);
      setMessage(downloaded.length ? `${downloaded.length} Special Term PDF${downloaded.length === 1 ? '' : 's'} downloaded.` : '');
    } else {
      setMessage(`${downloaded.length} Special Term PDF${downloaded.length === 1 ? '' : 's'} downloaded.`);
    }
    setExportProgress(null);
    setExporting(false);
  };

  const copyRemark = async (value, key, label) => {
    const copyText = richTextToCopyText(value);
    if (!copyText) return;
    setError('');
    try {
      await writeClipboardText(copyText);
      setCopiedRemarks((current) => ({ ...current, [key]: true }));
      setMessage(`${label} remark copied.`);
      const existing = copyTimers.current.get(key);
      if (existing) window.clearTimeout(existing);
      copyTimers.current.set(key, window.setTimeout(() => {
        setCopiedRemarks((current) => ({ ...current, [key]: false }));
        copyTimers.current.delete(key);
      }, 2_000));
    } catch (copyError) {
      setError(copyError.message || 'The remark could not be copied.');
    }
  };

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
    return (workspace?.terms || []).filter((term) => [term.name, richTextToPlain(term.termsText), richTextToPlain(term.confirmationRemark), richTextToPlain(term.nominationRemark)].some((value) => String(value || '').toLowerCase().includes(query)));
  }, [search, workspace?.terms]);

  const filteredRules = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return workspace?.rules || [];
    return (workspace?.rules || []).filter((rule) => [rule.name, rule.specialTermName, rule.audience, ...conditionSummary(rule)].some((value) => String(value || '').toLowerCase().includes(query)));
  }, [search, workspace?.rules]);

  const selectedTermSet = useMemo(() => new Set(selectedTermIds), [selectedTermIds]);
  const selectedTerms = useMemo(
    () => (workspace?.terms || []).filter((term) => selectedTermSet.has(term.id)),
    [selectedTermSet, workspace?.terms],
  );
  const allFilteredSelected = filteredTerms.length > 0 && filteredTerms.every((term) => selectedTermSet.has(term.id));
  const someFilteredSelected = filteredTerms.some((term) => selectedTermSet.has(term.id));

  const toggleTerm = (termId, checked) => {
    setSelectedTermIds((current) => checked
      ? [...new Set([...current, termId])]
      : current.filter((id) => id !== termId));
    setFailedTermIds((current) => current.filter((id) => id !== termId));
  };

  const toggleFilteredTerms = (checked) => {
    const filteredIds = new Set(filteredTerms.map((term) => term.id));
    setSelectedTermIds((current) => checked
      ? [...new Set([...current, ...filteredIds])]
      : current.filter((id) => !filteredIds.has(id)));
    setFailedTermIds((current) => current.filter((id) => !filteredIds.has(id)));
  };

  const clearTermSelection = () => {
    setSelectedTermIds([]);
    setFailedTermIds([]);
  };

  const termValidationIssues = useMemo(() => termForm ? specialTermIssues(termForm) : [], [termForm]);
  const ruleValidationIssues = useMemo(() => ruleForm ? specialTermRuleIssues(ruleForm) : [], [ruleForm]);

  const openTerm = async (term = null) => {
    setSaveAttempted(false);
    setError('');
    if (!term) {
      const form = { ...EMPTY_TERM };
      setTermForm(form);
      setTermDetail({ term: form, activeAssignments: [], proposedAssignments: [] });
      return;
    }
    setTermLoading(true);
    const response = await appClient.functions.invoke('specialTermDetail', { termId: term.id }, { cache: false });
    if (response.data?.error) setError(response.data.error);
    else {
      const detail = response.data;
      setTermDetail(detail);
      setTermForm({ ...EMPTY_TERM, ...detail.term, expectedLastModifiedAt: detail.term.lastModifiedAt });
    }
    setTermLoading(false);
  };

  const refreshOpenTerm = async (termId, successMessage = '') => {
    const response = await appClient.functions.invoke('specialTermDetail', { termId, force: true }, { cache: false });
    if (response.data?.error) {
      setError(response.data.error);
      return;
    }
    const detail = response.data;
    setTermDetail(detail);
    setTermForm((current) => ({ ...EMPTY_TERM, ...detail.term, expectedLastModifiedAt: detail.term.lastModifiedAt, name: current?.name || detail.term.name }));
    if (successMessage) setMessage(successMessage);
    await load(true);
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
    const structured = termForm.id && termForm.clauseStructureStatus === 'Active';
    const functionName = structured ? 'specialTermCompositionSave' : 'specialTermsSave';
    const payload = structured ? {
      ...termForm,
      termId: termForm.id,
      versionIds: (termDetail?.activeAssignments || []).map((assignment) => assignment.clauseVersionId),
      operationId: operationId(),
    } : { ...termForm, operationId: operationId() };
    const response = await appClient.functions.invoke(functionName, payload, { cache: false });
    if (response.data?.error) setError(response.data.error);
    else {
      setTermForm(null);
      setTermDetail(null);
      setMessage(termForm.id ? structured ? 'Numbered Special Term composition updated in Salesforce.' : 'Special Term metadata updated in Salesforce.' : 'Special Term created in Salesforce. Reopen it to add approved clauses.');
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
            {workspace?.canManage && ['terms', 'rules'].includes(activeTab) ? <Button onClick={() => activeTab === 'terms' ? openTerm() : openRule()}><Plus className="mr-2 h-4 w-4" />{activeTab === 'terms' ? 'Add Special Term' : 'Add Rule'}</Button> : null}
          </div>
        )}
      />

      {message && <Alert><ShieldCheck className="h-4 w-4" /><AlertDescription>{message}</AlertDescription></Alert>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      <WorkspaceViewBar
        views={[
          { id: 'terms', label: 'Terms', count: workspace?.terms?.length || 0 },
          { id: 'rules', label: 'Rules', count: workspace?.rules?.length || 0 },
          { id: 'clauses', label: 'Clause Bank' },
          ...(workspace?.canApproveClauses ? [{ id: 'migration', label: 'Migration Inventory' }] : []),
        ]}
        value={activeTab}
        onValueChange={setActiveTab}
        status={loading ? <DataStatus meta={responseMeta} state="refreshing" label="Salesforce" /> : <DataStatus meta={responseMeta} label="Salesforce" />}
        trailing={['terms', 'rules'].includes(activeTab) ? <div className="relative w-full sm:w-80"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={activeTab === 'terms' ? 'Search term wording' : 'Search rule or condition'} className="pl-9" /></div> : null}
      />

      {SPECIAL_TERMS_PDF_DOWNLOADS_ENABLED && activeTab === 'terms' && selectedTerms.length > 0 && (
        <div className="flex flex-col gap-3 rounded-lg border border-primary/25 bg-primary/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{selectedTerms.length} Special Term{selectedTerms.length === 1 ? '' : 's'} selected</p>
            <p className="truncate text-xs text-muted-foreground" aria-live="polite">
              {exportProgress ? `Downloading ${exportProgress.current} of ${exportProgress.total}: ${exportProgress.name}` : selectedTerms.length > 1 ? 'Your browser may ask permission to download multiple files.' : 'The PDF will use the current Salesforce wording.'}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" onClick={clearTermSelection} disabled={exporting}>Clear</Button>
            <Button onClick={() => downloadTerms(selectedTerms)} disabled={exporting}>
              {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              {exporting ? `Downloading ${exportProgress?.current || 1} of ${exportProgress?.total || selectedTerms.length}` : failedTermIds.length ? 'Retry failed' : 'Download selected'}
            </Button>
          </div>
        </div>
      )}

      {loading && !workspace ? <StateBlock title="Loading Special Terms" description="Reading authoritative Salesforce definitions and rules." icon={Loader2} /> : null}

      {!loading && workspace && activeTab === 'terms' && (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <Table className="min-w-[1080px]">
            <TableHeader>
              <TableRow>
                {SPECIAL_TERMS_PDF_DOWNLOADS_ENABLED && <TableHead className="w-11">
                  <Checkbox
                    checked={allFilteredSelected ? true : someFilteredSelected ? 'indeterminate' : false}
                    onCheckedChange={(checked) => toggleFilteredTerms(checked === true)}
                    aria-label="Select all filtered Special Terms"
                    title="Select all filtered Special Terms"
                  />
                </TableHead>}
                <TableHead>Special Term</TableHead>
                <TableHead>Numbered Clauses</TableHead>
                <TableHead>Confirmation</TableHead>
                <TableHead>Nomination</TableHead>
                <TableHead>Rules</TableHead>
                <TableHead>Last Modified</TableHead>
                <TableHead className="w-36" />
              </TableRow>
            </TableHeader>
            <TableBody>{filteredTerms.map((term) => {
              const termRules = rulesByTerm.get(term.id) || [];
              const confirmationText = richTextToPlain(term.confirmationRemark);
              const nominationText = richTextToPlain(term.nominationRemark);
              const confirmationCopyKey = `confirmation:${term.id}`;
              const nominationCopyKey = `nomination:${term.id}`;
              return (
                <TableRow key={term.id} data-state={SPECIAL_TERMS_PDF_DOWNLOADS_ENABLED && selectedTermSet.has(term.id) ? 'selected' : undefined}>
                  {SPECIAL_TERMS_PDF_DOWNLOADS_ENABLED && <TableCell>
                    <Checkbox
                      checked={selectedTermSet.has(term.id)}
                      onCheckedChange={(checked) => toggleTerm(term.id, checked === true)}
                      aria-label={`Select ${term.name}`}
                      title={`Select ${term.name}`}
                    />
                  </TableCell>}
                  <TableCell className="font-medium">
                    <a href={salesforceUrl(workspace.instanceUrl, term.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                      {term.name}<ExternalLink className="h-3 w-3" />
                    </a>
                  </TableCell>
                  <TableCell className="max-w-md">
                    <div className="mb-1 flex flex-wrap items-center gap-1.5"><Badge variant={term.clauseStructureStatus === 'Active' ? 'default' : 'outline'}>{term.clauseStructureStatus}</Badge><span className="text-xs text-muted-foreground">{term.activeClauseCount || 0} active · {term.proposedClauseCount || 0} proposed</span>{term.upgradeCount ? <Badge className="bg-amber-600">{term.upgradeCount} upgrade{term.upgradeCount === 1 ? '' : 's'}</Badge> : null}</div>
                    <p className="line-clamp-3 whitespace-pre-wrap text-sm">{richTextToCopyText(term.termsText) || 'No clauses'}</p>
                  </TableCell>
                  <TableCell>
                    <Badge variant={term.addToConfirmation ? 'default' : 'outline'}>{term.addToConfirmation ? 'Attach PDF' : 'Not attached'}</Badge>
                    <div className="mt-1 flex max-w-56 items-center gap-1">
                      <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{confirmationText || 'No remark'}</p>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        disabled={!confirmationText}
                        onClick={() => copyRemark(term.confirmationRemark, confirmationCopyKey, 'Confirmation')}
                        title="Copy Confirmation special remark"
                        aria-label={`Copy Confirmation special remark for ${term.name}`}
                      >
                        {copiedRemarks[confirmationCopyKey] ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={term.addToNomination ? 'default' : 'outline'}>{term.addToNomination ? 'Attach PDF' : 'Not attached'}</Badge>
                    <div className="mt-1 flex max-w-56 items-center gap-1">
                      <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{nominationText || 'No remark'}</p>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        disabled={!nominationText}
                        onClick={() => copyRemark(term.nominationRemark, nominationCopyKey, 'Nomination')}
                        title="Copy Nomination special remark"
                        aria-label={`Copy Nomination special remark for ${term.name}`}
                      >
                        {copiedRemarks[nominationCopyKey] ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>{termRules.length}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{displayDateTime(term.lastModifiedAt)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {SPECIAL_TERMS_PDF_DOWNLOADS_ENABLED && <Button variant="ghost" size="icon" onClick={() => downloadTerms([term])} disabled={exporting} title="Download Special Term PDF" aria-label={`Download ${term.name} PDF`}><Download className="h-4 w-4" /></Button>}
                      {workspace.canManage && <Button variant="ghost" size="icon" onClick={() => openTerm(term)} title="Edit Special Term"><Pencil className="h-4 w-4" /></Button>}
                      {workspace.canManage && <Button variant="ghost" size="icon" className="text-destructive" onClick={() => { setDeleteTarget({ type: 'term', row: term, ruleCount: termRules.length }); setDeleteReason(''); setDeleteConfirmation(''); }} title="Remove Special Term"><Trash2 className="h-4 w-4" /></Button>}
                    </div>
                  </TableCell>
                </TableRow>
              );
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

      {!loading && workspace && activeTab === 'clauses' ? (
        <ClauseBankPanel
          canManage={workspace.canManage}
          canApprove={workspace.canApproveClauses}
          categoryOptions={workspace.clauseCategoryOptions || []}
          onChanged={() => load(true)}
        />
      ) : null}

      {!loading && workspace && activeTab === 'migration' && workspace.canApproveClauses ? <MigrationInventoryPanel /> : null}

      <Dialog open={Boolean(termForm)} onOpenChange={(open) => { if (!open && !busy) { setTermForm(null); setTermDetail(null); } }}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
          <DialogHeader><DialogTitle>{termForm?.id ? 'Edit Special Term' : 'Add Special Term'}</DialogTitle><DialogDescription>Salesforce remains authoritative. Terms Text is compiled from ordered approved clauses; Confirmation and Nomination remarks remain independent rich text.</DialogDescription></DialogHeader>
          {termForm && (
            <div className="space-y-5">
              <div className="space-y-1.5"><Label>Name</Label><Input value={termForm.name} maxLength={80} onChange={(event) => setTermForm((current) => ({ ...current, name: event.target.value }))} /></div>
              {termForm.clauseStructureStatus === 'Active' ? <div className="space-y-2"><div><Label>Numbered clauses</Label><p className="text-xs text-muted-foreground">Use each plus button to insert an approved bank clause. Row numbers are derived automatically.</p></div>{termForm.id ? <ClauseComposer assignments={termDetail?.activeAssignments || []} onChange={(activeAssignments) => setTermDetail((current) => ({ ...current, activeAssignments }))} disabled={!workspace?.canManage} /> : <Alert><AlertDescription>Save the Special Term first, then reopen it to add approved clauses.</AlertDescription></Alert>}</div> : <div className="space-y-2"><Label>Current live Terms Text</Label><pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-4 text-sm leading-relaxed">{richTextToCopyText(termForm.termsText) || 'No Terms Text'}</pre><p className="text-xs text-muted-foreground">Legacy wording is read-only in FCOS and remains live until the reviewed numbered structure is activated.</p></div>}
              {termForm.id ? <MigrationReviewPanel detail={termDetail} categoryOptions={workspace?.clauseCategoryOptions || []} canApprove={workspace?.canApproveClauses} onError={setError} onChanged={(successMessage) => refreshOpenTerm(termForm.id, successMessage)} /> : null}
              <div className="grid gap-4 md:grid-cols-2">
                <section className="space-y-3 rounded-lg border border-border p-3">
                  <label className="flex items-center gap-2 text-sm font-medium"><Checkbox checked={termForm.addToConfirmation} onCheckedChange={(checked) => setTermForm((current) => ({ ...current, addToConfirmation: checked === true }))} />Attach PDF to Confirmation</label>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label>Confirmation special remark</Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={!richTextToCopyText(termForm.confirmationRemark)}
                        onClick={() => copyRemark(termForm.confirmationRemark, 'form:confirmation', 'Confirmation')}
                        title="Copy Confirmation special remark"
                        aria-label="Copy Confirmation special remark"
                      >
                        {copiedRemarks['form:confirmation'] ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                    <div className="[&_.ql-container]:min-h-36 [&_.ql-editor]:min-h-36"><ReactQuill theme="snow" modules={QUILL_MODULES} value={termForm.confirmationRemark} onChange={(confirmationRemark) => setTermForm((current) => ({ ...current, confirmationRemark }))} /></div>
                  </div>
                </section>
                <section className="space-y-3 rounded-lg border border-border p-3">
                  <label className="flex items-center gap-2 text-sm font-medium"><Checkbox checked={termForm.addToNomination} onCheckedChange={(checked) => setTermForm((current) => ({ ...current, addToNomination: checked === true }))} />Attach PDF to Nomination</label>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label>Nomination special remark</Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={!richTextToCopyText(termForm.nominationRemark)}
                        onClick={() => copyRemark(termForm.nominationRemark, 'form:nomination', 'Nomination')}
                        title="Copy Nomination special remark"
                        aria-label="Copy Nomination special remark"
                      >
                        {copiedRemarks['form:nomination'] ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                    <div className="[&_.ql-container]:min-h-36 [&_.ql-editor]:min-h-36"><ReactQuill theme="snow" modules={QUILL_MODULES} value={termForm.nominationRemark} onChange={(nominationRemark) => setTermForm((current) => ({ ...current, nominationRemark }))} /></div>
                  </div>
                </section>
              </div>
              <WorkflowValidationSummary issues={saveAttempted ? termValidationIssues : []} />
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => { setTermForm(null); setTermDetail(null); }} disabled={busy}>Cancel</Button><Button onClick={saveTerm} disabled={busy || termLoading}>{busy ? 'Saving...' : 'Save to Salesforce'}</Button></DialogFooter>
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
