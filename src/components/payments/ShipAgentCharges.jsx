import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  FileText,
  Loader2,
  PackagePlus,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { appClient } from '@/api/appClient';
import StemDetailLink from '@/components/common/StemDetailLink';
import StateBlock from '@/components/common/StateBlock';
import TableShell from '@/components/common/TableShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const VIEWS = [
  { id: 'needs_action', label: 'Needs Action', tone: 'border-amber-300 bg-amber-50 text-amber-900' },
  { id: 'awaiting_delivery', label: 'Awaiting Delivery', tone: 'border-sky-300 bg-sky-50 text-sky-900' },
  { id: 'ready_for_invoice', label: 'Ready for Invoice', tone: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
  { id: 'post_invoice_changes', label: 'Post-Invoice Changes', tone: 'border-rose-300 bg-rose-50 text-rose-900' },
  { id: 'completed', label: 'Completed', tone: 'border-slate-300 bg-slate-50 text-slate-800' },
];

const BUYER_CHARGE_DECISIONS = [
  { value: 'include', label: 'Include buyer charge' },
  { value: 'exclude', label: 'Exclude buyer charge' },
];

const POST_INVOICE_RESOLUTIONS = [
  { value: 'no_adjustment', label: 'No adjustment' },
  { value: 'revised_invoice', label: 'Revised invoice' },
  { value: 'credit_note', label: 'Credit note' },
];

function operationId(prefix) {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const seed = `${prefix}${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.padEnd(32, '0').slice(0, 32);
  return `${seed.slice(0, 8)}-${seed.slice(8, 12)}-4${seed.slice(13, 16)}-8${seed.slice(17, 20)}-${seed.slice(20, 32)}`;
}

function text(value) {
  return String(value ?? '').trim();
}

function valueOf(item, names, fallback = '') {
  for (const name of names) {
    const value = String(name).split('.').reduce((current, key) => current?.[key], item);
    if (value != null && value !== '') return value;
  }
  return fallback;
}

function rowId(item, prefix, index) {
  return text(valueOf(item, ['id', 'Id', 'extraCostId', 'lineItemId'])) || `${prefix}:${index}`;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Hong_Kong',
  }).format(date);
}

function formatMoney(value, currency) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  return `${currency || ''} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
}

function caseStemId(caseRow) {
  return text(valueOf(caseRow, ['stemId', 'stem_id', 'salesforceStemId']));
}

function caseStemName(caseRow) {
  return text(valueOf(caseRow, ['stemName', 'stem_name', 'stemNumber', 'stem_number'])) || caseStemId(caseRow) || 'STEM';
}

function caseStatus(caseRow) {
  const status = text(valueOf(caseRow, ['status', 'caseStatus', 'case_status']));
  return VIEWS.find((view) => view.id === status)?.label || status || 'Needs Action';
}

function normalizeReviewRows(lineItems = [], extraCosts = []) {
  return [
    ...lineItems.map((item, index) => ({ key: `line:${rowId(item, 'line', index)}`, sourceType: 'line_item', sourceId: rowId(item, 'line', index), item, readOnly: true })),
    ...extraCosts.map((item, index) => ({ key: `extra:${rowId(item, 'extra', index)}`, sourceType: 'extra_cost', sourceId: rowId(item, 'extra', index), item, readOnly: false })),
  ];
}

function initialReview(row) {
  const item = row.item || {};
  return {
    reviewed: item.reviewed === true,
    buyerChargeDecision: text(valueOf(item, ['buyerChargeDecision', 'buyer_charge_decision'])),
    referenceOrNote: text(valueOf(item, ['referenceOrNote', 'reference_or_note', 'reviewNote', 'review_note'])),
    evidenceDocumentIds: Array.isArray(item.evidenceDocumentIds || item.evidence_document_ids)
      ? (item.evidenceDocumentIds || item.evidence_document_ids).map(String)
      : [],
  };
}

function initialExtraDraft(item) {
  const pricingType = item.fixed === true || item.Fixed__c === true || valueOf(item, ['pricingType', 'pricing_type']) === 'fixed' || valueOf(item, ['fixedCost', 'fixed_cost', 'fixedPrice', 'fixed_price'], null) != null ? 'fixed' : 'per_unit';
  return {
    description: text(valueOf(item, ['description', 'Description__c', 'name', 'Name'])),
    paymentTerm: text(valueOf(item, ['paymentTerm', 'payment_term', 'Payment_Term__c'])),
    pricingType,
    supplierCost: pricingType === 'fixed'
      ? valueOf(item, ['fixedCost', 'fixed_cost', 'Lumpsum_Cost__c'], '')
      : valueOf(item, ['cost', 'unitCost', 'unit_cost', 'Unit_Cost__c'], ''),
    buyerPrice: pricingType === 'fixed'
      ? valueOf(item, ['fixedPrice', 'fixed_price', 'Lumpsum_Price__c'], '')
      : valueOf(item, ['price', 'unitPrice', 'unit_price', 'Unit_Price__c'], ''),
    quantity: valueOf(item, ['quantity', 'Quantity__c'], ''),
    unitOfMeasure: text(valueOf(item, ['unitOfMeasure', 'unit_of_measure', 'Unit_of_Measure__c'], '1.')),
    cancelled: item.cancelled === true || item.Cancelled__c === true,
  };
}

function initialAddDraft(caseRow) {
  const supplierAccounts = Array.isArray(caseRow?.supplierAccounts) ? caseRow.supplierAccounts : [];
  return {
    localId: operationId('extra'),
    productId: '',
    description: 'STEM Charge',
    paymentTerm: text(valueOf(caseRow, ['supplierPaymentTerm', 'supplier_payment_term', 'paymentTerm', 'payment_term'])),
    pricingType: 'fixed',
    supplierAccountId: supplierAccounts.length === 1 ? supplierAccounts[0].id : '',
    supplierCost: '',
    buyerPrice: '',
    quantity: '',
    unitOfMeasure: '1.',
    reviewed: false,
    buyerChargeDecision: '',
    referenceOrNote: '',
    evidenceDocumentIds: [],
  };
}

function changeKey(item) {
  return JSON.stringify(item);
}

export default function ShipAgentCharges({ onOpenStem = null, initialStemId = '' }) {
  const openedInitialStemId = useRef('');
  const [view, setView] = useState('needs_action');
  const [cases, setCases] = useState([]);
  const [counts, setCounts] = useState({});
  const [capabilities, setCapabilities] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [selectedStemId, setSelectedStemId] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [reviews, setReviews] = useState({});
  const [extraDrafts, setExtraDrafts] = useState({});
  const [addDrafts, setAddDrafts] = useState([]);
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [gmOpen, setGmOpen] = useState(false);
  const [gmDraft, setGmDraft] = useState({ assigneeProfileId: '', reason: '' });
  const [gmSaving, setGmSaving] = useState(false);
  const [postResolution, setPostResolution] = useState({ resolution: 'no_adjustment', reference: '', note: '' });
  const [postSaving, setPostSaving] = useState(false);
  const [gmActionReason, setGmActionReason] = useState('');

  const loadCases = useCallback(async ({ force = false } = {}) => {
    if (force) setRefreshing(true);
    else setLoading(true);
    setError('');
    if (force) {
      const syncResponse = await appClient.functions.invoke('shipAgentChargesSync', {}, { force: true });
      if (syncResponse.data?.error) {
        setError(syncResponse.data.error);
        setLoading(false);
        setRefreshing(false);
        return;
      }
    }
    const response = await appClient.functions.invoke('shipAgentChargesList', { view, force }, { force });
    if (response.data?.error) {
      setError(response.data.error);
      setCases([]);
    } else {
      setCases(Array.isArray(response.data?.cases) ? response.data.cases : []);
      setCounts(response.data?.counts || {});
      setCapabilities(response.data?.capabilities || {});
    }
    setLoading(false);
    setRefreshing(false);
  }, [view]);

  useEffect(() => {
    loadCases();
  }, [loadCases]);

  const loadDetail = useCallback(async (stemId, { force = false } = {}) => {
    if (!stemId) return;
    setDetailLoading(true);
    setDetailError('');
    setSaveError('');
    const response = await appClient.functions.invoke('shipAgentChargesDetail', { stemId, force }, { force });
    if (response.data?.error) {
      setDetailError(response.data.error);
      setDetail(null);
      setDetailLoading(false);
      return;
    }
    const nextDetail = response.data || {};
    const rows = normalizeReviewRows(nextDetail.lineItems, nextDetail.extraCosts);
    setDetail(nextDetail);
    setReviews(Object.fromEntries(rows.map((row) => [row.key, initialReview(row)])));
    setExtraDrafts(Object.fromEntries((nextDetail.extraCosts || []).map((item, index) => {
      const id = rowId(item, 'extra', index);
      return [id, initialExtraDraft(item)];
    })));
    setAddDrafts([]);
    setGmDraft({ assigneeProfileId: text(valueOf(nextDetail.case, ['assigneeProfileId', 'assignee_profile_id'])), reason: '' });
    setPostResolution({ resolution: 'no_adjustment', reference: '', note: '' });
    setGmActionReason('');
    setDetailLoading(false);
  }, []);

  useEffect(() => {
    const stemId = text(initialStemId);
    if (!stemId || openedInitialStemId.current === stemId) return;
    openedInitialStemId.current = stemId;
    setSelectedStemId(stemId);
    loadDetail(stemId);
  }, [initialStemId, loadDetail]);

  const openDetail = (caseRow) => {
    const stemId = caseStemId(caseRow);
    if (!stemId) return;
    setSelectedStemId(stemId);
    loadDetail(stemId);
  };

  const closeDetail = () => {
    if (saving || gmSaving || postSaving) return;
    setSelectedStemId('');
    setDetail(null);
    setDetailError('');
    setSaveError('');
    setGmOpen(false);
  };

  const effectiveCapabilities = { ...capabilities, ...(detail?.capabilities || {}) };
  const activeCase = detail?.case || {};
  const canEditNormally = effectiveCapabilities.canEdit === true
    || effectiveCapabilities.canConfirm === true
    || activeCase.canEdit === true
    || activeCase.canConfirm === true;
  const canGmOverride = effectiveCapabilities.canGmOverride === true || activeCase.canGmOverride === true;
  const canEdit = canEditNormally || canGmOverride;
  const canResolvePostInvoice = effectiveCapabilities.canResolvePostInvoice === true
    || effectiveCapabilities.canPostInvoiceResolve === true
    || activeCase.canResolvePostInvoice === true;
  const reviewRows = useMemo(() => normalizeReviewRows(detail?.lineItems, detail?.extraCosts), [detail]);
  const products = Array.isArray(detail?.products) ? detail.products : [];
  const salesforceFiles = Array.isArray(detail?.salesforceFiles) ? detail.salesforceFiles : [];
  const assigneeOptions = Array.isArray(detail?.assignees)
    ? detail.assignees
    : Array.isArray(effectiveCapabilities.assigneeOptions)
    ? effectiveCapabilities.assigneeOptions
    : Array.isArray(activeCase.assigneeOptions) ? activeCase.assigneeOptions : [];
  const supplierName = text(valueOf(activeCase, ['shipAgentName', 'ship_agent_name', 'supplierName', 'supplier_name'])) || 'Exact ship-agent supplier';
  const supplierPaymentTerm = text(valueOf(activeCase, ['supplierPaymentTerm', 'supplier_payment_term', 'paymentTerm', 'payment_term'])) || 'Inherited from supplier';
  const supplierAccounts = Array.isArray(activeCase.supplierAccounts) ? activeCase.supplierAccounts : [];

  const updateReview = (key, patch) => {
    setReviews((current) => ({ ...current, [key]: { ...(current[key] || {}), ...patch } }));
  };

  const toggleEvidence = (key, documentId) => {
    setReviews((current) => {
      const review = current[key] || {};
      const documentIds = new Set(review.evidenceDocumentIds || []);
      if (documentIds.has(documentId)) documentIds.delete(documentId);
      else documentIds.add(documentId);
      return { ...current, [key]: { ...review, evidenceDocumentIds: [...documentIds] } };
    });
  };

  const updateExtraDraft = (id, patch) => setExtraDrafts((current) => ({ ...current, [id]: { ...(current[id] || {}), ...patch } }));
  const updateAddDraft = (localId, patch) => setAddDrafts((current) => current.map((draft) => draft.localId === localId ? { ...draft, ...patch } : draft));

  const validationErrors = useMemo(() => {
    const problems = [];
    for (const row of reviewRows) {
      const review = reviews[row.key] || {};
      if (review.reviewed !== true) problems.push(`${itemLabel(row)} has not been marked reviewed.`);
      if (!['include', 'exclude'].includes(review.buyerChargeDecision)) problems.push(`${itemLabel(row)} needs a buyer-charge decision.`);
      if (!text(review.referenceOrNote) && !(review.evidenceDocumentIds || []).length) problems.push(`${itemLabel(row)} needs a reference/note or Salesforce File evidence.`);
    }
    for (const draft of addDrafts) {
      if (!text(draft.productId)) problems.push('Each new STEM Charge needs an active Product.');
      if (!text(draft.supplierAccountId)) problems.push('Each new STEM Charge needs one exact ship-agent supplier Account.');
      if (!text(draft.description)) problems.push('Each new STEM Charge needs a description.');
      if (!text(draft.supplierCost) || !(Number(draft.supplierCost) >= 0)) problems.push('Each new STEM Charge needs a valid supplier cost.');
      if (!text(draft.buyerPrice) || !(Number(draft.buyerPrice) >= 0)) problems.push('Each new STEM Charge needs a valid buyer price.');
      if (draft.pricingType === 'per_unit' && !(Number(draft.quantity) > 0)) problems.push('Each per-unit STEM Charge needs a positive quantity.');
      if (draft.pricingType === 'per_unit' && !text(draft.unitOfMeasure)) problems.push('Each per-unit STEM Charge needs a unit of measure.');
      if (draft.reviewed !== true) problems.push('Each new STEM Charge must be marked reviewed.');
      if (!['include', 'exclude'].includes(draft.buyerChargeDecision)) problems.push('Each new STEM Charge needs a buyer-charge decision.');
      if (!text(draft.referenceOrNote) && !(draft.evidenceDocumentIds || []).length) problems.push('Each new STEM Charge needs a reference/note or Salesforce File evidence.');
    }
    if (canGmOverride && !canEditNormally && text(gmActionReason).length < 5) problems.push('A General Manager override reason of at least 5 characters is required.');
    return problems;
  }, [addDrafts, canEditNormally, canGmOverride, gmActionReason, reviewRows, reviews]);

  const saveConfirmation = async () => {
    if (!canEdit || !selectedStemId) return;
    if (validationErrors.length) {
      setSaveError(validationErrors[0]);
      return;
    }
    const extraCostUpdates = [];
    const cancellations = [];
    (detail?.extraCosts || []).forEach((item, index) => {
      const id = rowId(item, 'extra', index);
      const original = initialExtraDraft(item);
      const draft = extraDrafts[id] || original;
      const expectedLastModifiedDate = valueOf(item, ['lastModifiedDate', 'last_modified_date', 'LastModifiedDate'], null);
      if (draft.cancelled && !original.cancelled) {
        cancellations.push({ extraCostId: id, expectedLastModifiedDate });
        return;
      }
      const currentComparable = { ...draft, cancelled: false };
      const originalComparable = { ...original, cancelled: false };
      if (changeKey(currentComparable) !== changeKey(originalComparable)) {
        extraCostUpdates.push({
          extraCostId: id,
          expectedLastModifiedDate,
          description: draft.description,
          paymentTerm: draft.paymentTerm,
          pricingType: draft.pricingType,
          supplierCost: Number(draft.supplierCost),
          buyerPrice: Number(draft.buyerPrice),
          quantity: draft.pricingType === 'per_unit' ? Number(draft.quantity) : null,
          unitOfMeasure: draft.unitOfMeasure,
        });
      }
    });
    const extraCostAdds = addDrafts.map((draft) => ({
      productId: draft.productId,
      description: draft.description,
      supplierAccountId: draft.supplierAccountId,
      paymentTerm: draft.paymentTerm || supplierPaymentTerm,
      pricingType: draft.pricingType,
      supplierCost: Number(draft.supplierCost),
      buyerPrice: Number(draft.buyerPrice),
      quantity: draft.pricingType === 'per_unit' ? Number(draft.quantity) : null,
      unitOfMeasure: draft.unitOfMeasure,
      reviewLocalId: draft.localId,
    }));
    const serializedReviews = [...reviewRows.map((row) => ({
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      reviewed: true,
      buyerChargeDecision: reviews[row.key].buyerChargeDecision,
      referenceOrNote: text(reviews[row.key].referenceOrNote) || null,
      evidenceDocumentIds: reviews[row.key].evidenceDocumentIds || [],
    })), ...addDrafts.map((draft) => ({
      sourceType: 'new_extra_cost',
      sourceId: draft.localId,
      reviewed: draft.reviewed === true,
      buyerChargeDecision: draft.buyerChargeDecision,
      referenceOrNote: text(draft.referenceOrNote) || null,
      evidenceDocumentIds: draft.evidenceDocumentIds || [],
    }))];
    setSaving(true);
    setSaveError('');
    const response = await appClient.functions.invoke('shipAgentChargesSaveConfirm', {
      stemId: selectedStemId,
      expectedRevision: valueOf(activeCase, ['revision'], null),
      expectedFingerprint: valueOf(activeCase, ['fingerprint', 'currentFingerprint', 'current_fingerprint'], null),
      expectedStemLastModifiedAt: valueOf(activeCase, ['salesforceStemLastModifiedAt', 'salesforce_stem_last_modified_at'], null),
      operationId: operationId('ship_agent_confirm'),
      reviews: serializedReviews,
      extraCostUpdates,
      extraCostAdds,
      cancellations,
      gmOverrideReason: canGmOverride && !canEditNormally ? text(gmActionReason) : null,
    }, { force: true });
    if (response.data?.error) {
      setSaveError(response.data.error);
      setSaving(false);
      return;
    }
    setSaving(false);
    await Promise.all([loadDetail(selectedStemId, { force: true }), loadCases({ force: true })]);
  };

  const saveGmOverride = async () => {
    const reason = text(gmDraft.reason);
    if (!canGmOverride || !text(gmDraft.assigneeProfileId) || reason.length < 5) {
      setSaveError('Select an assignee and enter a specific override reason (at least 5 characters).');
      return;
    }
    setGmSaving(true);
    setSaveError('');
    const response = await appClient.functions.invoke('shipAgentChargesGmOverride', {
      stemId: selectedStemId,
      assigneeProfileId: gmDraft.assigneeProfileId,
      reason,
      expectedRevision: valueOf(activeCase, ['revision'], null),
      expectedFingerprint: valueOf(activeCase, ['fingerprint', 'currentFingerprint', 'current_fingerprint'], null),
      operationId: operationId('ship_agent_gm'),
    }, { force: true });
    if (response.data?.error) {
      setSaveError(response.data.error);
      setGmSaving(false);
      return;
    }
    setGmSaving(false);
    setGmOpen(false);
    await Promise.all([loadDetail(selectedStemId, { force: true }), loadCases({ force: true })]);
  };

  const savePostInvoiceResolution = async () => {
    const reference = text(postResolution.reference);
    if (!canResolvePostInvoice || !reference) {
      setSaveError('A resolution reference is required for every post-invoice change.');
      return;
    }
    setPostSaving(true);
    setSaveError('');
    const response = await appClient.functions.invoke('shipAgentChargesPostInvoiceResolve', {
      stemId: selectedStemId,
      resolution: postResolution.resolution,
      reference,
      note: text(postResolution.note) || null,
      expectedRevision: valueOf(activeCase, ['revision'], null),
      expectedFingerprint: valueOf(activeCase, ['fingerprint', 'currentFingerprint', 'current_fingerprint'], null),
      operationId: operationId('ship_agent_post_invoice'),
      reason: canGmOverride && !canEditNormally ? text(gmActionReason) : null,
    }, { force: true });
    if (response.data?.error) {
      setSaveError(response.data.error);
      setPostSaving(false);
      return;
    }
    setPostSaving(false);
    await Promise.all([loadDetail(selectedStemId, { force: true }), loadCases({ force: true })]);
  };

  return (
    <div className="space-y-5 p-4 lg:p-8">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"><ClipboardCheck className="h-3.5 w-3.5" /> Payment Collections</div>
          <h1 className="mt-1 text-xl font-semibold text-foreground">Ship-Agent Charges</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Review each ship-agent cost after delivery before the final buyer invoice. Salesforce remains the financial record; FCOS preserves the review and invoice gate.</p>
        </div>
        <Button type="button" variant="outline" className="gap-2 self-start" onClick={() => loadCases({ force: true })} disabled={refreshing || loading}>
          <RefreshCw className={cn('h-4 w-4', (refreshing || loading) && 'animate-spin')} /> Refresh Salesforce
        </Button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {VIEWS.map((item) => {
          const selected = item.id === view;
          const count = Number(counts?.[item.id] ?? counts?.[item.id.replaceAll('_', '')] ?? 0);
          return (
            <Button key={item.id} type="button" size="sm" variant={selected ? 'secondary' : 'outline'} className="shrink-0 gap-2" onClick={() => setView(item.id)}>
              {item.label}<Badge variant="outline" className={cn('px-1.5 py-0 text-[10px]', selected && item.tone)}>{Number.isFinite(count) ? count : 0}</Badge>
            </Button>
          );
        })}
      </div>

      {error && <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

      {loading ? <StateBlock icon={Loader2} title="Loading ship-agent charges" description="Checking the latest Salesforce delivery and charge status." /> : !error && !cases.length ? (
        <StateBlock icon={CheckCircle2} title={`No ${VIEWS.find((item) => item.id === view)?.label.toLowerCase() || 'ship-agent charge'} cases`} description="Refresh to retrieve the latest Salesforce data." />
      ) : !error && (
        <>
          <div className="space-y-3 md:hidden">
            {cases.map((caseRow) => <CaseCard key={caseStemId(caseRow)} caseRow={caseRow} onOpen={() => openDetail(caseRow)} onOpenStem={onOpenStem} />)}
          </div>
          <TableShell title="Ship-agent charge cases" meta={`${cases.length.toLocaleString()} cases`} bodyClassName="hidden p-0 md:block">
            <div className="overflow-auto">
              <table className="w-full min-w-[1040px] text-sm">
                <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-3">STEM</th><th className="px-4 py-3">Ship Agent</th><th className="px-4 py-3">Delivery</th><th className="px-4 py-3">Buyer Trader</th><th className="px-4 py-3">Due</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"><span className="sr-only">Open</span></th></tr></thead>
                <tbody className="divide-y divide-border">{cases.map((caseRow) => <CaseRow key={caseStemId(caseRow)} caseRow={caseRow} onOpen={() => openDetail(caseRow)} onOpenStem={onOpenStem} />)}</tbody>
              </table>
            </div>
          </TableShell>
        </>
      )}

      <Dialog open={Boolean(selectedStemId)} onOpenChange={(open) => !open && closeDetail()}>
        <DialogContent className="flex max-h-[94vh] max-w-6xl flex-col overflow-hidden p-0 sm:max-w-6xl">
          <DialogHeader className="border-b border-border px-5 py-4 sm:px-6">
            <div className="flex flex-wrap items-start justify-between gap-3 pr-6">
              <div>
                <DialogTitle>Ship-Agent Charge Review</DialogTitle>
                <DialogDescription>{caseStemName(activeCase)} · {supplierName}</DialogDescription>
              </div>
              {detail && <Badge variant="outline" className={viewTone(valueOf(activeCase, ['status', 'view', 'queueView', 'queue_view']))}>{caseStatus(activeCase)}</Badge>}
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
            {detailLoading ? <StateBlock icon={Loader2} title="Loading live charge detail" description="Reading Salesforce rows and evidence." /> : detailError ? (
              <StateBlock icon={AlertTriangle} title="Unable to load charge detail" description={detailError} action={<Button variant="outline" onClick={() => loadDetail(selectedStemId, { force: true })}>Try again</Button>} />
            ) : detail && (
              <div className="space-y-6">
                <CaseSummary caseRow={activeCase} onOpenStem={onOpenStem} />
                {!canEdit && <ReadOnlyNotice caseRow={activeCase} />}
                {saveError && <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{saveError}</div>}

                <section className="space-y-3">
                  <div><h2 className="text-sm font-semibold">Row-by-row buyer charge review</h2><p className="mt-1 text-xs text-muted-foreground">Every line item and ship-agent extra cost needs a reviewed decision plus either a reference/note or linked Salesforce File evidence. Existing line items are permanently read-only.</p></div>
                  <div className="space-y-3">{reviewRows.map((row) => <ReviewRow key={row.key} row={row} review={reviews[row.key] || initialReview(row)} files={salesforceFiles} disabled={!canEdit} onReviewChange={(patch) => updateReview(row.key, patch)} onEvidenceToggle={(id) => toggleEvidence(row.key, id)} />)}</div>
                </section>

                <section className="space-y-3">
                  <div><h2 className="text-sm font-semibold">Ship-agent extra costs</h2><p className="mt-1 text-xs text-muted-foreground">Only existing ship-agent extra costs may be changed. Cancelling marks Salesforce <code>Cancelled__c</code>; rows are never deleted.</p></div>
                  <div className="space-y-3">{(detail.extraCosts || []).map((item, index) => {
                    const id = rowId(item, 'extra', index);
                    return <ExistingExtraCostEditor key={id} item={item} draft={extraDrafts[id] || initialExtraDraft(item)} disabled={!canEdit} onChange={(patch) => updateExtraDraft(id, patch)} />;
                  })}</div>
                  {canEdit && <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => setAddDrafts((current) => [...current, initialAddDraft(activeCase)])}><PackagePlus className="h-4 w-4" /> Add STEM Charge</Button>}
                  {!!addDrafts.length && <div className="space-y-3">{addDrafts.map((draft) => <NewExtraCostEditor key={draft.localId} draft={draft} products={products} supplierAccounts={supplierAccounts} files={salesforceFiles} defaultPaymentTerm={supplierPaymentTerm} disabled={!canEdit} onChange={(patch) => updateAddDraft(draft.localId, patch)} onRemove={() => setAddDrafts((current) => current.filter((row) => row.localId !== draft.localId))} />)}</div>}
                </section>

                {canGmOverride && !canEditNormally && (
                  <section className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <Label htmlFor="ship-agent-gm-action-reason">General Manager action reason</Label>
                    <Textarea id="ship-agent-gm-action-reason" value={gmActionReason} onChange={(event) => setGmActionReason(event.target.value.slice(0, 1000))} placeholder="Why are you overriding the assigned Buyer Trader for this action?" />
                    <p className="text-xs text-amber-900">At least five characters are required and the reason is written to the redacted audit event.</p>
                  </section>
                )}

                {view === 'post_invoice_changes' || valueOf(activeCase, ['status', 'view', 'queueView', 'queue_view']) === 'post_invoice_changes' ? <PostInvoiceResolution value={postResolution} disabled={!canResolvePostInvoice} saving={postSaving} onChange={(patch) => setPostResolution((current) => ({ ...current, ...patch }))} onSave={savePostInvoiceResolution} /> : null}
              </div>
            )}
          </div>
          {detail && <DialogFooter className="border-t border-border px-5 py-4 sm:px-6"><Button type="button" variant="outline" onClick={closeDetail}>Close</Button>{canGmOverride && <Button type="button" variant="outline" className="gap-2" onClick={() => setGmOpen(true)}><ShieldCheck className="h-4 w-4" /> GM override</Button>}<Button type="button" onClick={saveConfirmation} disabled={!canEdit || saving || detailLoading} className="gap-2">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Confirm charges</Button></DialogFooter>}
        </DialogContent>
      </Dialog>

      <Dialog open={gmOpen} onOpenChange={setGmOpen}>
        <DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>General Manager override</DialogTitle><DialogDescription>Temporarily reassign this case. A reason is mandatory and the action is recorded in the audit trail.</DialogDescription></DialogHeader><div className="space-y-4"><div className="space-y-2"><Label htmlFor="ship-agent-gm-assignee">Temporary assignee</Label><Select value={gmDraft.assigneeProfileId} onValueChange={(assigneeProfileId) => setGmDraft((current) => ({ ...current, assigneeProfileId }))} disabled={gmSaving}><SelectTrigger id="ship-agent-gm-assignee"><SelectValue placeholder="Select active FCOS user" /></SelectTrigger><SelectContent>{assigneeOptions.map((option) => <SelectItem key={valueOf(option, ['id', 'profileId', 'profile_id'])} value={String(valueOf(option, ['id', 'profileId', 'profile_id']))}>{valueOf(option, ['fullName', 'full_name', 'name', 'email'])}</SelectItem>)}</SelectContent></Select></div>{!assigneeOptions.length && <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Active reassignment options are unavailable. Refresh the case before attempting an override.</p>}<div className="space-y-2"><Label htmlFor="ship-agent-gm-reason">Override reason</Label><Textarea id="ship-agent-gm-reason" value={gmDraft.reason} onChange={(event) => setGmDraft((current) => ({ ...current, reason: event.target.value }))} placeholder="Why is temporary reassignment required?" disabled={gmSaving} /></div></div><DialogFooter><Button type="button" variant="outline" onClick={() => setGmOpen(false)} disabled={gmSaving}>Cancel</Button><Button type="button" onClick={saveGmOverride} disabled={gmSaving || !assigneeOptions.length}>{gmSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Apply override</Button></DialogFooter></DialogContent>
      </Dialog>
    </div>
  );
}

function itemLabel(row) {
  return text(valueOf(row.item, ['name', 'Name', 'description', 'Description__c'])) || (row.sourceType === 'line_item' ? 'Line item' : 'Extra cost');
}

function viewTone(value) {
  return VIEWS.find((item) => item.id === value)?.tone || 'border-slate-300 bg-slate-50 text-slate-800';
}

function CaseRow({ caseRow, onOpen, onOpenStem }) {
  const stemId = caseStemId(caseRow);
  return <tr className="bg-card align-middle"><td className="px-4 py-3"><StemDetailLink stemId={stemId} onOpen={onOpenStem}>{caseStemName(caseRow)}</StemDetailLink></td><td className="px-4 py-3">{valueOf(caseRow, ['shipAgentName', 'ship_agent_name', 'supplierName', 'supplier_name'], '—')}</td><td className="px-4 py-3">{formatDate(valueOf(caseRow, ['deliveryDate', 'delivery_date']))}</td><td className="px-4 py-3">{valueOf(caseRow, ['assigneeName', 'assignee_name', 'buyerTraderName', 'buyer_trader_name'], 'Unassigned')}</td><td className="px-4 py-3">{formatDate(valueOf(caseRow, ['dueDate', 'due_date']))}</td><td className="px-4 py-3"><Badge variant="outline" className={viewTone(valueOf(caseRow, ['status', 'view', 'queueView', 'queue_view']))}>{caseStatus(caseRow)}</Badge></td><td className="px-4 py-3 text-right"><Button type="button" size="sm" variant="outline" onClick={onOpen}>Review <ChevronRight className="ml-1 h-3.5 w-3.5" /></Button></td></tr>;
}

function CaseCard({ caseRow, onOpen, onOpenStem }) {
  const stemId = caseStemId(caseRow);
  return <article className="rounded-xl border border-border bg-card p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><StemDetailLink stemId={stemId} onOpen={onOpenStem}>{caseStemName(caseRow)}</StemDetailLink><p className="mt-1 text-sm text-muted-foreground">{valueOf(caseRow, ['shipAgentName', 'ship_agent_name', 'supplierName', 'supplier_name'], 'Ship agent')}</p></div><Badge variant="outline" className={viewTone(valueOf(caseRow, ['status', 'view', 'queueView', 'queue_view']))}>{caseStatus(caseRow)}</Badge></div><dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-xs"><div><dt className="text-muted-foreground">Delivery</dt><dd className="mt-0.5 font-medium">{formatDate(valueOf(caseRow, ['deliveryDate', 'delivery_date']))}</dd></div><div><dt className="text-muted-foreground">Due</dt><dd className="mt-0.5 font-medium">{formatDate(valueOf(caseRow, ['dueDate', 'due_date']))}</dd></div><div className="col-span-2"><dt className="text-muted-foreground">Buyer Trader</dt><dd className="mt-0.5 font-medium">{valueOf(caseRow, ['assigneeName', 'assignee_name', 'buyerTraderName', 'buyer_trader_name'], 'Unassigned')}</dd></div></dl><Button type="button" variant="outline" size="sm" className="mt-4 w-full" onClick={onOpen}>Review case <ChevronRight className="ml-1 h-3.5 w-3.5" /></Button></article>;
}

function CaseSummary({ caseRow, onOpenStem }) {
  const stemId = caseStemId(caseRow);
  return <div className="grid gap-3 rounded-lg border border-border bg-muted/20 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4"><SummaryField label="STEM"><StemDetailLink stemId={stemId} onOpen={onOpenStem}>{caseStemName(caseRow)}</StemDetailLink></SummaryField><SummaryField label="Ship Agent">{valueOf(caseRow, ['shipAgentName', 'ship_agent_name', 'supplierName', 'supplier_name'], '—')}</SummaryField><SummaryField label="Buyer Trader">{valueOf(caseRow, ['assigneeName', 'assignee_name', 'buyerTraderName', 'buyer_trader_name'], 'Unassigned')}</SummaryField><SummaryField label="Delivery / due">{formatDate(valueOf(caseRow, ['deliveryDate', 'delivery_date']))} / {formatDate(valueOf(caseRow, ['dueDate', 'due_date']))}</SummaryField></div>;
}

function SummaryField({ label, children }) { return <div><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 font-medium">{children}</div></div>; }

function ReadOnlyNotice({ caseRow }) { return <div className="flex gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><span>Read-only. This case is assigned to {valueOf(caseRow, ['assigneeName', 'assignee_name', 'buyerTraderName', 'buyer_trader_name'], 'another Buyer Trader')}. Finance and Administrators can view; only the assigned Buyer Trader can confirm, except for a documented General Manager override.</span></div>; }

function ReviewRow({ row, review, files, disabled, onReviewChange, onEvidenceToggle }) {
  const item = row.item || {};
  const id = row.sourceId;
  return <div className="rounded-lg border border-border bg-card p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><span className="font-medium">{itemLabel(row)}</span><Badge variant="outline">{row.readOnly ? 'Line item · read-only' : 'Ship-agent extra cost'}</Badge>{(item.cancelled === true || item.Cancelled__c === true) && <Badge variant="outline" className="border-slate-300 bg-slate-50">Cancelled</Badge>}</div><p className="mt-1 text-xs text-muted-foreground">{text(valueOf(item, ['productName', 'product_name', 'Product__r.Name', 'Product2Id__r.Name'])) || 'No product'} · {formatMoney(valueOf(item, ['lineTotalBuy', 'line_total_buy', 'Line_Total_Buy__c', 'totalCost', 'Total_Cost__c', 'unitCost', 'Unit_Cost__c']), valueOf(item, ['currency', 'CurrencyIsoCode']))}</p></div><label className="flex items-center gap-2 text-sm font-medium"><Checkbox checked={review.reviewed === true} disabled={disabled} onCheckedChange={(checked) => onReviewChange({ reviewed: checked === true })} /> Reviewed</label></div><div className="mt-4 grid gap-3 md:grid-cols-2"><div className="space-y-2"><Label>Buyer-charge decision</Label><Select value={review.buyerChargeDecision || undefined} onValueChange={(buyerChargeDecision) => onReviewChange({ buyerChargeDecision })} disabled={disabled}><SelectTrigger><SelectValue placeholder="Select decision" /></SelectTrigger><SelectContent>{BUYER_CHARGE_DECISIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor={`ship-agent-reference-${id}`}>Reference or review note</Label><Input id={`ship-agent-reference-${id}`} value={review.referenceOrNote || ''} onChange={(event) => onReviewChange({ referenceOrNote: event.target.value })} placeholder="Reference, explanation, or note" disabled={disabled} /></div></div><div className="mt-3"><div className="text-xs font-medium text-muted-foreground">Salesforce File evidence {files.length ? '(optional when note provided)' : '(none available)'}</div>{files.length ? <div className="mt-2 flex flex-wrap gap-2">{files.map((file) => { const fileId = String(valueOf(file, ['contentDocumentId', 'id', 'Id'])); return <label key={fileId} className="flex max-w-full items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs"><Checkbox checked={(review.evidenceDocumentIds || []).includes(fileId)} disabled={disabled} onCheckedChange={() => onEvidenceToggle(fileId)} /><FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /><span className="truncate">{valueOf(file, ['title', 'fileName', 'name', 'Name'], 'Salesforce File')}</span></label>; })}</div> : null}</div></div>;
}

function ExistingExtraCostEditor({ item, draft, disabled, onChange }) {
  const id = rowId(item, 'extra', 0);
  return <div className="rounded-lg border border-border bg-card p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="font-medium">{valueOf(item, ['name', 'Name', 'description', 'Description__c'], 'Ship-agent extra cost')}</div><div className="mt-1 text-xs text-muted-foreground">Existing Salesforce row · {valueOf(item, ['supplierName', 'supplier_name', 'Supplier__r.Name'], 'Exact ship-agent supplier')}</div></div><label className="flex items-center gap-2 text-sm font-medium"><Checkbox checked={draft.cancelled === true} disabled={disabled || draft.cancelled === true} onCheckedChange={(checked) => onChange({ cancelled: checked === true })} /> Cancel row</label></div>{draft.cancelled ? <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">This will set <code>Cancelled__c</code> to true. The existing Salesforce row remains in history.</div> : <><div className="mt-4 space-y-2"><Label htmlFor={`existing-${id}-description`}>Description</Label><Input id={`existing-${id}-description`} value={draft.description || ''} onChange={(event) => onChange({ description: event.target.value })} disabled={disabled} /></div><ExtraCostFields id={`existing-${id}`} value={draft} disabled={disabled} onChange={onChange} /></>}</div>;
}

function NewExtraCostEditor({ draft, products, supplierAccounts, files, defaultPaymentTerm, disabled, onChange, onRemove }) {
  const toggleFile = (fileId) => {
    const ids = new Set(draft.evidenceDocumentIds || []);
    if (ids.has(fileId)) ids.delete(fileId); else ids.add(fileId);
    onChange({ evidenceDocumentIds: [...ids] });
  };
  return <div className="rounded-lg border border-dashed border-primary/40 bg-primary/[0.02] p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="font-medium">New STEM Charge</div><div className="mt-1 text-xs text-muted-foreground">The supplier must be one exact detected ship-agent Account; its payment term is inherited server-side.</div></div><Button type="button" variant="ghost" size="sm" onClick={onRemove} disabled={disabled}><X className="mr-1 h-4 w-4" /> Remove</Button></div><div className="mt-4 grid gap-3 md:grid-cols-3"><div className="space-y-2"><Label>Ship-agent supplier</Label><Select value={draft.supplierAccountId || undefined} onValueChange={(supplierAccountId) => onChange({ supplierAccountId })} disabled={disabled}><SelectTrigger><SelectValue placeholder="Select exact Account" /></SelectTrigger><SelectContent>{supplierAccounts.map((account) => <SelectItem key={account.id} value={String(account.id)}>{account.name || account.id}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Active Product</Label><Select value={draft.productId || undefined} onValueChange={(productId) => onChange({ productId })} disabled={disabled}><SelectTrigger><SelectValue placeholder="Select active product" /></SelectTrigger><SelectContent>{products.map((product) => <SelectItem key={valueOf(product, ['id', 'Id', 'productId'])} value={String(valueOf(product, ['id', 'Id', 'productId']))}>{valueOf(product, ['name', 'Name', 'label'], 'Product')}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor={`new-extra-description-${draft.localId}`}>Description</Label><Input id={`new-extra-description-${draft.localId}`} value={draft.description} onChange={(event) => onChange({ description: event.target.value })} disabled={disabled} /></div></div><ExtraCostFields id={`new-${draft.localId}`} value={{ ...draft, paymentTerm: draft.paymentTerm || defaultPaymentTerm }} disabled={disabled} onChange={onChange} paymentTermReadOnly /><div className="mt-4 grid gap-3 md:grid-cols-3"><label className="flex items-center gap-2 text-sm font-medium"><Checkbox checked={draft.reviewed === true} disabled={disabled} onCheckedChange={(checked) => onChange({ reviewed: checked === true })} /> Reviewed</label><div className="space-y-2"><Label>Buyer-charge decision</Label><Select value={draft.buyerChargeDecision || undefined} onValueChange={(buyerChargeDecision) => onChange({ buyerChargeDecision })} disabled={disabled}><SelectTrigger><SelectValue placeholder="Select decision" /></SelectTrigger><SelectContent>{BUYER_CHARGE_DECISIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor={`new-extra-reference-${draft.localId}`}>Reference or review note</Label><Input id={`new-extra-reference-${draft.localId}`} value={draft.referenceOrNote || ''} onChange={(event) => onChange({ referenceOrNote: event.target.value })} disabled={disabled} /></div></div>{files.length ? <div className="mt-3 flex flex-wrap gap-2">{files.map((file) => { const fileId = String(valueOf(file, ['contentDocumentId', 'id', 'Id'])); return <label key={fileId} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs"><Checkbox checked={(draft.evidenceDocumentIds || []).includes(fileId)} disabled={disabled} onCheckedChange={() => toggleFile(fileId)} /><FileText className="h-3.5 w-3.5" />{valueOf(file, ['title', 'name'], 'Salesforce File')}</label>; })}</div> : null}</div>;
}

function ExtraCostFields({ id, value, disabled, onChange, paymentTermReadOnly = false }) {
  return <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-6"><div className="space-y-2"><Label htmlFor={`${id}-term`}>Payment term</Label><Input id={`${id}-term`} value={value.paymentTerm || ''} onChange={(event) => onChange({ paymentTerm: event.target.value })} disabled={disabled || paymentTermReadOnly} /></div><div className="space-y-2"><Label>Pricing</Label><Select value={value.pricingType} onValueChange={(pricingType) => onChange({ pricingType })} disabled={disabled}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="fixed">Fixed</SelectItem><SelectItem value="per_unit">Per unit</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label htmlFor={`${id}-supplier-cost`}>{value.pricingType === 'fixed' ? 'Fixed supplier cost' : 'Supplier cost / unit'}</Label><Input id={`${id}-supplier-cost`} inputMode="decimal" value={value.supplierCost ?? ''} onChange={(event) => onChange({ supplierCost: event.target.value })} disabled={disabled} /></div><div className="space-y-2"><Label htmlFor={`${id}-buyer-price`}>{value.pricingType === 'fixed' ? 'Fixed buyer price' : 'Buyer price / unit'}</Label><Input id={`${id}-buyer-price`} inputMode="decimal" value={value.buyerPrice ?? ''} onChange={(event) => onChange({ buyerPrice: event.target.value })} disabled={disabled} /></div>{value.pricingType === 'per_unit' && <><div className="space-y-2"><Label htmlFor={`${id}-quantity`}>Quantity</Label><Input id={`${id}-quantity`} inputMode="decimal" value={value.quantity ?? ''} onChange={(event) => onChange({ quantity: event.target.value })} disabled={disabled} /></div><div className="space-y-2"><Label htmlFor={`${id}-uom`}>Unit of measure</Label><Input id={`${id}-uom`} value={value.unitOfMeasure || ''} onChange={(event) => onChange({ unitOfMeasure: event.target.value })} disabled={disabled} /></div></>}</div>;
}

function PostInvoiceResolution({ value, disabled, saving, onChange, onSave }) { return <section className="space-y-3 rounded-lg border border-rose-200 bg-rose-50/50 p-4"><div><h2 className="text-sm font-semibold text-rose-950">Urgent post-invoice change</h2><p className="mt-1 text-xs text-rose-900">Resolve as no adjustment, revised invoice, or credit note. A reference is mandatory.</p></div><div className="grid gap-3 md:grid-cols-2"><div className="space-y-2"><Label>Resolution</Label><Select value={value.resolution} onValueChange={(resolution) => onChange({ resolution })} disabled={disabled || saving}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{POST_INVOICE_RESOLUTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor="post-invoice-reference">Reference</Label><Input id="post-invoice-reference" value={value.reference} onChange={(event) => onChange({ reference: event.target.value })} placeholder="Invoice, credit note, or approval reference" disabled={disabled || saving} /></div></div><div className="space-y-2"><Label htmlFor="post-invoice-note">Resolution note</Label><Textarea id="post-invoice-note" value={value.note} onChange={(event) => onChange({ note: event.target.value })} placeholder="Optional context" disabled={disabled || saving} /></div><Button type="button" variant="outline" onClick={onSave} disabled={disabled || saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save resolution</Button>{disabled && <p className="text-xs text-rose-900">Only the currently authorized resolver may record this outcome.</p>}</section>; }
