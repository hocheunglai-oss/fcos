import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Circle,
  CircleDot,
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
  { id: 'my_tasks', label: 'My Tasks', tone: 'border-blue-300 bg-blue-50 text-blue-900' },
  { id: 'waiting', label: 'Waiting', tone: 'border-amber-300 bg-amber-50 text-amber-900' },
  { id: 'ready_for_invoice', label: 'Ready for Invoice', tone: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
  { id: 'completed', label: 'Completed', tone: 'border-slate-300 bg-slate-50 text-slate-800' },
  { id: 'all_cases', label: 'All Cases', tone: 'border-slate-300 bg-slate-50 text-slate-800' },
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
  if (value == null || value === '') return '—';
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

function caseStemReference(caseRow) {
  const reference = text(valueOf(caseRow, ['stemReference', 'stem_reference', 'stemNumber', 'stem_number']));
  return reference && reference !== caseStemName(caseRow) ? reference : '';
}

function actionBasisLabel(caseRow) {
  const basis = text(valueOf(caseRow, ['actionBasis', 'action_basis']));
  if (basis === 'delivery_date') return 'Delivery date';
  if (basis === 'latest_schedule_date') return 'Latest ETA / ETB / ETCD / ETD';
  if (basis === 'enquiry_created_date') return 'Enquiry created date';
  return 'Action basis';
}

function StemIdentity({ caseRow, onOpenStem }) {
  const stemId = caseStemId(caseRow);
  const reference = caseStemReference(caseRow);
  return <div className="min-w-0"><StemDetailLink stemId={stemId} onOpen={onOpenStem}>{caseStemName(caseRow)}</StemDetailLink>{reference && <div className="mt-0.5 text-xs text-muted-foreground">Reference {reference}</div>}</div>;
}

function caseStatus(caseRow) {
  const status = text(valueOf(caseRow, ['status', 'caseStatus', 'case_status']));
  if (status === 'post_invoice_changes') return 'Invoice already issued—action required';
  if (status === 'awaiting_delivery') return 'Waiting';
  if (status === 'needs_action') return 'In review';
  if (status === 'ready_for_invoice') return 'Ready for Invoice';
  if (status === 'completed') return 'Completed';
  return VIEWS.find((view) => view.id === status)?.label || status || 'In review';
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
    outcome: '',
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

function initialAddDraft(caseRow, supplierId = '') {
  const supplierAccounts = Array.isArray(caseRow?.supplierAccounts) ? caseRow.supplierAccounts : [];
  return {
    localId: operationId('extra'),
    productId: '',
    description: 'STEM Charge',
    paymentTerm: text(valueOf(caseRow, ['supplierPaymentTerm', 'supplier_payment_term', 'paymentTerm', 'payment_term'])),
    pricingType: 'fixed',
    supplierAccountId: supplierId || (supplierAccounts.length === 1 ? supplierAccounts[0].id : ''),
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

function scrollContainerFor(element) {
  let current = element?.parentElement;
  while (current) {
    const overflowY = globalThis.getComputedStyle?.(current)?.overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return current;
    current = current.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

export default function VariableCharges({ onOpenStem = null, initialStemId = '', onTaskOpen = null, onTaskClose = null }) {
  const openedInitialStemId = useRef('');
  const returnFocusRef = useRef(null);
  const returnScrollRef = useRef({ element: null, top: 0 });
  const [view, setView] = useState('my_tasks');
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
  const [activeSupplierId, setActiveSupplierId] = useState('');
  const [supplierSavingId, setSupplierSavingId] = useState('');
  const [supplierReviewNotes, setSupplierReviewNotes] = useState({});
  const [buyerReviewNote, setBuyerReviewNote] = useState('');
  const [buyerReviewNotes, setBuyerReviewNotes] = useState({});
  const [showAllBuyerRows, setShowAllBuyerRows] = useState(false);
  const [sideAssignmentSaving, setSideAssignmentSaving] = useState('');

  const loadCases = useCallback(async ({ force = false } = {}) => {
    if (force) setRefreshing(true);
    else setLoading(true);
    setError('');
    if (force) {
      const syncResponse = await appClient.functions.invoke('variableChargesSync', {}, { force: true });
      if (syncResponse.data?.error) {
        setError(syncResponse.data.error);
        setLoading(false);
        setRefreshing(false);
        return;
      }
    }
    const response = await appClient.functions.invoke('variableChargesList', { view, force }, { force });
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
    const response = await appClient.functions.invoke('variableChargesDetail', { stemId, force }, { force });
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
    setSupplierReviewNotes({});
    setBuyerReviewNote('');
    setBuyerReviewNotes({});
    setShowAllBuyerRows(false);
    const requirements = Array.isArray(nextDetail.case?.supplierRequirements) ? nextDetail.case.supplierRequirements : [];
    setActiveSupplierId(text(requirements.find((row) => row.sides?.cost?.permissions?.canConfirm || row.sides?.buyerCharge?.permissions?.canConfirm || row.canVerify)?.supplierId || requirements[0]?.supplierId));
    setDetailLoading(false);
  }, []);

  useEffect(() => {
    const stemId = text(initialStemId);
    if (!stemId) {
      if (openedInitialStemId.current && selectedStemId && !saving && !supplierSavingId && !gmSaving && !postSaving) {
        openedInitialStemId.current = '';
        setSelectedStemId('');
        setDetail(null);
        setDetailError('');
        setSaveError('');
        requestAnimationFrame(() => {
          const snapshot = returnScrollRef.current;
          if (snapshot.element) snapshot.element.scrollTop = snapshot.top;
          returnFocusRef.current?.focus?.({ preventScroll: true });
        });
      }
      return;
    }
    if (openedInitialStemId.current === stemId) return;
    openedInitialStemId.current = stemId;
    setSelectedStemId(stemId);
    loadDetail(stemId);
  }, [gmSaving, initialStemId, loadDetail, postSaving, saving, selectedStemId, supplierSavingId]);

  const openDetail = (caseRow, event) => {
    const stemId = caseStemId(caseRow);
    if (!stemId) return;
    returnFocusRef.current = event?.currentTarget || document.activeElement;
    const scrollElement = scrollContainerFor(returnFocusRef.current);
    returnScrollRef.current = { element: scrollElement, top: scrollElement?.scrollTop || 0 };
    setSelectedStemId(stemId);
    loadDetail(stemId);
    onTaskOpen?.(stemId);
  };

  const closeDetail = () => {
    if (saving || supplierSavingId || gmSaving || postSaving) return;
    setSelectedStemId('');
    setDetail(null);
    setDetailError('');
    setSaveError('');
    setGmOpen(false);
    openedInitialStemId.current = '';
    onTaskClose?.();
    requestAnimationFrame(() => {
      const snapshot = returnScrollRef.current;
      if (snapshot.element) snapshot.element.scrollTop = snapshot.top;
      returnFocusRef.current?.focus?.({ preventScroll: true });
    });
  };

  const effectiveCapabilities = { ...capabilities, ...(detail?.capabilities || {}) };
  const activeCase = detail?.case || {};
  const canEditNormally = effectiveCapabilities.canEdit === true
    || effectiveCapabilities.canConfirm === true
    || activeCase.canEdit === true
    || activeCase.canConfirm === true;
  const canGmOverride = effectiveCapabilities.canGmOverride === true || activeCase.canGmOverride === true;
  const supplierRequirements = Array.isArray(activeCase.supplierRequirements) ? activeCase.supplierRequirements : [];
  const activeSupplierStage = supplierRequirements.find((row) => text(row.supplierId) === activeSupplierId) || null;
  const pairedWorkflow = detail?.pairedWorkflowEnabled === true || activeCase.pairedWorkflowEnabled === true;
  const activeCostSide = activeSupplierStage?.sides?.cost || null;
  const activeBuyerSide = activeSupplierStage?.sides?.buyerCharge || null;
  const canSupplierEdit = activeSupplierStage?.canVerify === true || (canGmOverride && text(gmActionReason).length >= 5);
  const canCostSideEdit = activeCostSide?.permissions?.canEdit === true || (activeCostSide?.permissions?.canGmOverride === true && text(gmActionReason).length >= 5);
  const canBuyerSideEdit = activeBuyerSide?.permissions?.canEdit === true || (activeBuyerSide?.permissions?.canGmOverride === true && text(gmActionReason).length >= 5);
  const allSuppliersVerified = supplierRequirements.length > 0 && supplierRequirements.every((row) => row.status === 'Verified');
  const canBuyerConfirm = allSuppliersVerified && (effectiveCapabilities.canBuyerConfirm === true || canEditNormally || (canGmOverride && text(gmActionReason).length >= 5));
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
  const supplierPaymentTerm = text(valueOf(activeCase, ['supplierPaymentTerm', 'supplier_payment_term', 'paymentTerm', 'payment_term'])) || 'Inherited from supplier';
  const supplierAccounts = Array.isArray(activeCase.supplierAccounts) ? activeCase.supplierAccounts : [];

  const rowSupplierId = (row) => text(valueOf(row?.item || row, ['supplierId', 'supplier_id', 'Original_Supplier__c', 'Supplier__c']));

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
      if (!['include', 'exclude'].includes(review.buyerChargeDecision)) problems.push(`${itemLabel(row)} needs a buyer-charge decision.`);
    }
    for (const draft of addDrafts) {
      if (!text(draft.productId)) problems.push('Each new STEM Charge needs an active Product.');
      if (!text(draft.supplierAccountId)) problems.push('Each new STEM Charge needs one exact variable-charge supplier Account.');
      if (!text(draft.description)) problems.push('Each new STEM Charge needs a description.');
      if (!text(draft.supplierCost) || !(Number(draft.supplierCost) >= 0)) problems.push('Each new STEM Charge needs a valid supplier cost.');
      if (!text(draft.buyerPrice) || !(Number(draft.buyerPrice) >= 0)) problems.push('Each new STEM Charge needs a valid buyer price.');
      if (draft.pricingType === 'per_unit' && !(Number(draft.quantity) > 0)) problems.push('Each per-unit STEM Charge needs a positive quantity.');
      if (draft.pricingType === 'per_unit' && !text(draft.unitOfMeasure)) problems.push('Each per-unit STEM Charge needs a unit of measure.');
    }
    if (!text(buyerReviewNote)) problems.push('Add one case note before approving the buyer charges.');
    if (canGmOverride && !canEditNormally && text(gmActionReason).length < 5) problems.push('A General Manager override reason of at least 5 characters is required.');
    return problems;
  }, [addDrafts, buyerReviewNote, canEditNormally, canGmOverride, gmActionReason, reviewRows, reviews]);

  const verifySupplierStage = async (requirement) => {
    const supplierId = text(requirement?.supplierId);
    if (!supplierId || supplierSavingId) return;
    const stageRows = reviewRows.filter((row) => rowSupplierId(row) === supplierId);
    const supplierReviewNote = text(supplierReviewNotes[supplierId]);
    if (!supplierReviewNote) { setSaveError('Add one supplier reference or note before confirming the costs.'); return; }
    for (const row of stageRows) {
      const review = reviews[row.key] || {};
      if (!['correct', 'changed', 'cancelled'].includes(review.outcome)) { setSaveError(`Mark ${itemLabel(row)} as Correct or Needs change.`); return; }
      if (row.readOnly && review.outcome !== 'correct') { setSaveError(`${itemLabel(row)} is a read-only product line. Correct it in Salesforce, then refresh this task.`); return; }
    }
    const extraCostUpdates = [];
    const cancellations = [];
    (detail?.extraCosts || []).forEach((item, index) => {
      if (text(valueOf(item, ['supplierId', 'supplier_id', 'Supplier__c'])) !== supplierId) return;
      const id = rowId(item, 'extra', index);
      const original = initialExtraDraft(item);
      const draft = extraDrafts[id] || original;
      const expectedLastModifiedDate = valueOf(item, ['lastModifiedDate', 'last_modified_date', 'LastModifiedDate'], null);
      if (draft.cancelled && !original.cancelled) { cancellations.push({ extraCostId: id, expectedLastModifiedDate }); return; }
      if (changeKey({ ...draft, cancelled: false }) !== changeKey({ ...original, cancelled: false })) {
        extraCostUpdates.push({
          extraCostId: id, expectedLastModifiedDate, description: draft.description,
          pricingType: draft.pricingType, supplierCost: Number(draft.supplierCost),
          quantity: draft.pricingType === 'per_unit' ? Number(draft.quantity) : null,
          unitOfMeasure: draft.unitOfMeasure,
        });
      }
    });
    const supplierAdds = addDrafts.filter((draft) => text(draft.supplierAccountId) === supplierId);
    const extraCostAdds = supplierAdds.map((draft) => ({
      productId: draft.productId, description: draft.description, supplierAccountId: supplierId,
      pricingType: draft.pricingType, supplierCost: Number(draft.supplierCost),
      quantity: draft.pricingType === 'per_unit' ? Number(draft.quantity) : null,
      unitOfMeasure: draft.unitOfMeasure,
    }));
    if (supplierAdds.some((draft) => !text(draft.productId) || !text(draft.description) || !(Number(draft.supplierCost) >= 0) || (draft.pricingType === 'per_unit' && !(Number(draft.quantity) > 0)))) {
      setSaveError('Complete the Product, description, supplier cost, quantity, and UOM for every new supplier charge.');
      return;
    }
    setSupplierSavingId(supplierId);
    setSaveError('');
    const response = await appClient.functions.invoke('variableChargesSupplierVerify', {
      stemId: selectedStemId,
      supplierId,
      expectedStemLastModifiedAt: valueOf(activeCase, ['salesforceStemLastModifiedAt', 'salesforce_stem_last_modified_at'], null),
      expectedStageLastModifiedAt: requirement.lastModifiedAt || null,
      operationId: operationId('variable_charge_supplier_verify'),
      supplierReviewNote,
      rowOutcomes: stageRows.map((row) => ({
        sourceId: row.sourceId,
        outcome: reviews[row.key]?.outcome,
        evidenceDocumentIds: reviews[row.key]?.evidenceDocumentIds || [],
      })),
      extraCostUpdates, extraCostAdds, cancellations,
      gmOverrideReason: requirement.canVerify === true ? null : text(gmActionReason),
    }, { force: true });
    if (response.data?.error) {
      setSaveError(response.data.error);
      setSupplierSavingId('');
      return;
    }
    const stage = response.data?.supplierStage || {};
    const supplierWasVerified = requirement.status === 'Verified';
    setDetail((current) => current ? {
      ...current,
      case: {
        ...current.case,
        supplierRequirements: (current.case?.supplierRequirements || []).map((row) => text(row.supplierId) === supplierId ? {
          ...row, status: stage.supplierStatus || 'Verified', revision: stage.revision ?? row.revision,
          verifiedAt: new Date().toISOString(), lastModifiedAt: stage.lastModifiedAt || row.lastModifiedAt,
          reviewedSourceFingerprint: stage.fingerprint || row.reviewedSourceFingerprint,
        } : row),
      },
    } : current);
    setCases((current) => current.map((row) => caseStemId(row) === selectedStemId ? {
      ...row,
      supplierStageProgress: {
        required: Number(row.supplierStageProgress?.required || supplierRequirements.length),
        verified: Math.min(
          Number(row.supplierStageProgress?.required || supplierRequirements.length),
          Number(row.supplierStageProgress?.verified || 0) + (supplierWasVerified ? 0 : 1),
        ),
      },
    } : row));
    setAddDrafts((current) => current.filter((draft) => text(draft.supplierAccountId) !== supplierId));
    await Promise.all([loadDetail(selectedStemId, { force: true }), loadCases()]);
    setSupplierSavingId('');
  };

  const assignPairedSides = async (requirement, sides, target) => {
    const supplierId = text(requirement?.supplierId);
    if (!supplierId || sideAssignmentSaving) return;
    const sideKey = `${supplierId}:${sides.join('+')}:${target}`;
    setSideAssignmentSaving(sideKey);
    setSaveError('');
    const response = await appClient.functions.invoke('variableChargesSideAssign', {
      stemId: selectedStemId,
      supplierId,
      sides,
      target,
      expectedRevisions: Object.fromEntries(sides.map((side) => [side, Number(side === 'cost' ? requirement.sides?.cost?.revision : requirement.sides?.buyerCharge?.revision)])),
      operationId: operationId('variable_charge_side_assign'),
      gmOverrideReason: text(gmActionReason) || null,
    }, { force: true });
    if (response.data?.error) setSaveError(response.data.error);
    else await Promise.all([loadDetail(selectedStemId, { force: true }), loadCases()]);
    setSideAssignmentSaving('');
  };

  const confirmPairedSides = async (requirement, sides) => {
    const supplierId = text(requirement?.supplierId);
    if (!supplierId || supplierSavingId || saving) return;
    const stageRows = reviewRows.filter((row) => rowSupplierId(row) === supplierId);
    const costSelected = sides.includes('cost');
    const buyerSelected = sides.includes('buyer_charge');
    const costNote = text(supplierReviewNotes[supplierId]);
    const buyerNote = text(buyerReviewNotes[supplierId]);
    if (costSelected && !costNote) { setSaveError('Add a supplier cost note before confirmation.'); return; }
    if (buyerSelected && !buyerNote) { setSaveError('Add a buyer-charge note before confirmation.'); return; }
    for (const row of stageRows) {
      const review = reviews[row.key] || {};
      if (costSelected && !['correct', 'changed', 'cancelled'].includes(review.outcome)) { setSaveError(`Review the cost side of ${itemLabel(row)}.`); return; }
      if (costSelected && row.readOnly && review.outcome !== 'correct') { setSaveError(`${itemLabel(row)} is read-only. Correct it in Salesforce, then refresh.`); return; }
      if (buyerSelected && !['include', 'exclude'].includes(review.buyerChargeDecision)) { setSaveError(`Choose Include or Exclude for ${itemLabel(row)}.`); return; }
    }
    const costUpdates = [];
    const buyerUpdates = [];
    const cancellations = [];
    (detail?.extraCosts || []).forEach((item, index) => {
      if (text(valueOf(item, ['supplierId', 'supplier_id', 'Supplier__c'])) !== supplierId) return;
      const id = rowId(item, 'extra', index);
      const original = initialExtraDraft(item);
      const draft = extraDrafts[id] || original;
      const expectedLastModifiedDate = valueOf(item, ['lastModifiedDate', 'last_modified_date', 'LastModifiedDate'], null);
      if (costSelected && draft.cancelled && !original.cancelled) {
        cancellations.push({ extraCostId: id, expectedLastModifiedDate });
      } else if (costSelected && changeKey({ description: draft.description, pricingType: draft.pricingType, supplierCost: draft.supplierCost, quantity: draft.quantity, unitOfMeasure: draft.unitOfMeasure }) !== changeKey({ description: original.description, pricingType: original.pricingType, supplierCost: original.supplierCost, quantity: original.quantity, unitOfMeasure: original.unitOfMeasure })) {
        costUpdates.push({ extraCostId: id, expectedLastModifiedDate, description: draft.description, pricingType: draft.pricingType, supplierCost: Number(draft.supplierCost), quantity: draft.pricingType === 'per_unit' ? Number(draft.quantity) : null, unitOfMeasure: draft.unitOfMeasure });
      }
      if (buyerSelected && String(draft.buyerPrice ?? '') !== String(original.buyerPrice ?? '')) {
        buyerUpdates.push({ extraCostId: id, expectedLastModifiedDate, pricingType: draft.pricingType, buyerPrice: Number(draft.buyerPrice) });
      }
    });
    const supplierAdds = costSelected ? addDrafts.filter((draft) => text(draft.supplierAccountId) === supplierId) : [];
    if (supplierAdds.some((draft) => !text(draft.productId) || !text(draft.description) || !(Number(draft.supplierCost) >= 0) || (draft.pricingType === 'per_unit' && !(Number(draft.quantity) > 0)))) {
      setSaveError('Complete every new supplier charge before confirmation.');
      return;
    }
    if (buyerSelected && supplierAdds.some((draft) => !['include', 'exclude'].includes(draft.buyerChargeDecision) || (draft.buyerChargeDecision === 'include' && !(Number(draft.buyerPrice) >= 0)))) {
      setSaveError('Choose the buyer decision and price for every new paired charge.');
      return;
    }
    const additions = supplierAdds.map((draft) => ({
      reviewLocalId: draft.localId, productId: draft.productId, description: draft.description,
      supplierAccountId: supplierId, pricingType: draft.pricingType,
      supplierCost: Number(draft.supplierCost), buyerPrice: draft.buyerChargeDecision === 'include' ? Number(draft.buyerPrice) : null,
      quantity: draft.pricingType === 'per_unit' ? Number(draft.quantity) : null,
      unitOfMeasure: draft.unitOfMeasure,
      buyerChargeDecision: draft.buyerChargeDecision,
      referenceOrNote: buyerNote,
      evidenceDocumentIds: draft.evidenceDocumentIds || [],
    }));
    setSupplierSavingId(supplierId);
    setSaving(buyerSelected);
    setSaveError('');
    const response = await appClient.functions.invoke('variableChargesSideConfirm', {
      stemId: selectedStemId,
      supplierId,
      sides,
      expectedStemLastModifiedAt: valueOf(activeCase, ['salesforceStemLastModifiedAt', 'salesforce_stem_last_modified_at'], null),
      expectedRevisions: {
        ...(costSelected ? { cost: Number(requirement.sides?.cost?.revision) } : {}),
        ...(buyerSelected ? { buyer_charge: Number(requirement.sides?.buyerCharge?.revision) } : {}),
      },
      expectedFingerprints: {
        ...(costSelected ? { cost: requirement.sides?.cost?.fingerprint } : {}),
        ...(buyerSelected ? { buyer_charge: requirement.sides?.buyerCharge?.fingerprint } : {}),
      },
      operationId: operationId('variable_charge_side_confirm'),
      cost: costSelected ? {
        supplierReviewNote: costNote,
        rowOutcomes: stageRows.map((row) => ({ sourceId: row.sourceId, outcome: reviews[row.key]?.outcome, evidenceDocumentIds: reviews[row.key]?.evidenceDocumentIds || [] })),
        extraCostUpdates: costUpdates, extraCostAdds: additions, cancellations,
      } : undefined,
      buyerCharge: buyerSelected ? {
        buyerReviewNote: buyerNote,
        rowChargeDecisions: stageRows.map((row) => ({ sourceId: row.sourceId, decision: reviews[row.key]?.buyerChargeDecision, evidenceDocumentIds: reviews[row.key]?.evidenceDocumentIds || [] })),
        extraCostUpdates: buyerUpdates, extraCostAdds: additions, cancellations: [],
      } : undefined,
      gmOverrideReason: text(gmActionReason) || null,
    }, { force: true });
    if (response.data?.error) setSaveError(response.data.error);
    else {
      setAddDrafts((current) => current.filter((draft) => text(draft.supplierAccountId) !== supplierId));
      await Promise.all([loadDetail(selectedStemId, { force: true }), loadCases()]);
    }
    setSaving(false);
    setSupplierSavingId('');
  };

  const saveConfirmation = async () => {
    if (!canBuyerConfirm || !selectedStemId) return;
    if (validationErrors.length) {
      setSaveError(validationErrors[0]);
      return;
    }
    const extraCostUpdates = [];
    (detail?.extraCosts || []).forEach((item, index) => {
      const id = rowId(item, 'extra', index);
      const original = initialExtraDraft(item);
      const draft = extraDrafts[id] || original;
      const expectedLastModifiedDate = valueOf(item, ['lastModifiedDate', 'last_modified_date', 'LastModifiedDate'], null);
      if (String(draft.buyerPrice ?? '') !== String(original.buyerPrice ?? '')) {
        extraCostUpdates.push({
          extraCostId: id,
          expectedLastModifiedDate,
          pricingType: draft.pricingType,
          buyerPrice: Number(draft.buyerPrice),
        });
      }
    });
    const rowChargeDecisions = reviewRows.map((row) => ({
      sourceId: row.sourceId,
      decision: reviews[row.key].buyerChargeDecision,
      evidenceDocumentIds: reviews[row.key].evidenceDocumentIds || [],
    }));
    setSaving(true);
    setSaveError('');
    const response = await appClient.functions.invoke('variableChargesBuyerConfirm', {
      stemId: selectedStemId,
      expectedRevision: valueOf(activeCase, ['revision'], null),
      expectedFingerprint: valueOf(activeCase, ['fingerprint', 'currentFingerprint', 'current_fingerprint'], null),
      expectedStemLastModifiedAt: valueOf(activeCase, ['salesforceStemLastModifiedAt', 'salesforce_stem_last_modified_at'], null),
      operationId: operationId('variable_charge_confirm'),
      buyerReviewNote: text(buyerReviewNote),
      rowChargeDecisions,
      extraCostUpdates,
      extraCostAdds: [],
      cancellations: [],
      gmOverrideReason: canGmOverride && !canEditNormally ? text(gmActionReason) : null,
    }, { force: true });
    if (response.data?.error) {
      setSaveError(response.data.error);
      setSaving(false);
      return;
    }
    setSaving(false);
    await Promise.all([loadDetail(selectedStemId, { force: true }), loadCases()]);
  };

  const saveGmOverride = async () => {
    const reason = text(gmDraft.reason);
    if (!canGmOverride || !text(gmDraft.assigneeProfileId) || reason.length < 5) {
      setSaveError('Select an assignee and enter a specific override reason (at least 5 characters).');
      return;
    }
    setGmSaving(true);
    setSaveError('');
    const response = await appClient.functions.invoke('variableChargesGmOverride', {
      stemId: selectedStemId,
      assigneeProfileId: gmDraft.assigneeProfileId,
      reason,
      expectedRevision: valueOf(activeCase, ['revision'], null),
      expectedFingerprint: valueOf(activeCase, ['fingerprint', 'currentFingerprint', 'current_fingerprint'], null),
      operationId: operationId('variable_charge_gm'),
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
    const response = await appClient.functions.invoke('variableChargesPostInvoiceResolve', {
      stemId: selectedStemId,
      resolution: postResolution.resolution,
      reference,
      note: text(postResolution.note) || null,
      expectedRevision: valueOf(activeCase, ['revision'], null),
      expectedFingerprint: valueOf(activeCase, ['fingerprint', 'currentFingerprint', 'current_fingerprint'], null),
      operationId: operationId('variable_charge_post_invoice'),
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

  const workflow = activeCase.workflow || {};
  const currentStep = text(activeCase.currentStep || workflow.currentStep);
  const financials = activeCase.financialSummary || {};
  const activeSupplierRows = reviewRows.filter((row) => rowSupplierId(row) === activeSupplierId);
  const unresolvedBuyerRows = reviewRows.filter((row) => !['include', 'exclude'].includes(reviews[row.key]?.buyerChargeDecision));
  const visibleBuyerRows = showAllBuyerRows ? reviewRows : unresolvedBuyerRows;

  const variableChargeTask = selectedStemId ? (
    <div className="space-y-5 p-4 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Button type="button" variant="ghost" size="sm" className="-ml-2 mb-2 gap-2" onClick={closeDetail} disabled={saving || Boolean(supplierSavingId) || gmSaving || postSaving}>
            <ArrowLeft className="h-4 w-4" /> Back to Variable Charges
          </Button>
          <h1 className="truncate text-xl font-semibold text-foreground">{caseStemName(activeCase)}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{valueOf(activeCase, ['nextAction', 'workflow.nextAction'], 'Review final charges')}</p>
        </div>
        <div className="flex items-center gap-2">
          {detail && <Badge variant="outline" className={viewTone(valueOf(activeCase, ['status']))}>{caseStatus(activeCase)}</Badge>}
          <Button type="button" variant="outline" size="sm" onClick={() => loadDetail(selectedStemId, { force: true })} disabled={detailLoading || saving || Boolean(supplierSavingId)}>
            <RefreshCw className={cn('mr-2 h-4 w-4', detailLoading && 'animate-spin')} /> Refresh
          </Button>
        </div>
      </div>

      {detailLoading ? <StateBlock icon={Loader2} title="Loading this task" description="Checking the latest Salesforce charges and approvals." /> : detailError ? (
        <StateBlock icon={AlertTriangle} title="Unable to load this task" description={detailError} action={<Button variant="outline" onClick={() => loadDetail(selectedStemId, { force: true })}>Try again</Button>} />
      ) : detail ? (
        <div className="space-y-5">
          {pairedWorkflow
            ? <IndependentSideProgress sideProgress={activeCase.sideProgress} buyerReady={activeCase.invoiceReadiness?.buyer?.ready === true} />
            : <GuidedProgress currentStep={currentStep} progress={workflow.progress} />}
          <SimpleCaseSummary caseRow={activeCase} onOpenStem={onOpenStem} />
          {saveError && <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{saveError}</div>}

          {valueOf(activeCase, ['status']) === 'post_invoice_changes' && (
            <PostInvoiceResolution value={postResolution} disabled={!canResolvePostInvoice} saving={postSaving} onChange={(patch) => setPostResolution((current) => ({ ...current, ...patch }))} onSave={savePostInvoiceResolution} />
          )}

          {pairedWorkflow ? (
            <>
              <PairedSupplierProgress requirements={supplierRequirements} activeSupplierId={activeSupplierId} onSelect={setActiveSupplierId} />
              {activeSupplierStage && currentStep !== 'invoice_attention' && (
                <section className="space-y-5 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><h2 className="text-base font-semibold">{activeSupplierStage.supplierName || 'Supplier'}</h2><p className="mt-1 text-sm text-muted-foreground">Review the shared charge once, then complete either side in any order.</p></div>
                    <div className="flex flex-wrap gap-2">
                      {activeCostSide?.permissions?.canAssignToBuyer && <Button type="button" size="sm" variant="outline" disabled={Boolean(sideAssignmentSaving)} onClick={() => assignPairedSides(activeSupplierStage, ['cost'], 'buyer_trader')}>Assign cost to Buyer Trader</Button>}
                      {activeBuyerSide?.permissions?.canAssignToBuyer && <Button type="button" size="sm" variant="outline" disabled={Boolean(sideAssignmentSaving)} onClick={() => assignPairedSides(activeSupplierStage, ['buyer_charge'], 'buyer_trader')}>Assign buyer side to Buyer Trader</Button>}
                      {activeCostSide?.permissions?.canAssignToBuyer && activeBuyerSide?.permissions?.canAssignToBuyer && <Button type="button" size="sm" variant="outline" disabled={Boolean(sideAssignmentSaving)} onClick={() => assignPairedSides(activeSupplierStage, ['cost', 'buyer_charge'], 'buyer_trader')}>Assign both</Button>}
                      {activeCostSide?.permissions?.canTakeBack && <Button type="button" size="sm" variant="ghost" disabled={Boolean(sideAssignmentSaving)} onClick={() => assignPairedSides(activeSupplierStage, ['cost'], 'supplier_trader')}>Take cost back</Button>}
                      {activeBuyerSide?.permissions?.canTakeBack && <Button type="button" size="sm" variant="ghost" disabled={Boolean(sideAssignmentSaving)} onClick={() => assignPairedSides(activeSupplierStage, ['buyer_charge'], 'supplier_trader')}>Take buyer side back</Button>}
                    </div>
                  </div>
                  <FinancialSummary summary={financials.bySupplier?.find((row) => text(row.supplierId) === activeSupplierId) || financials} />
                  <div className="space-y-3">
                    {activeSupplierRows.map((row) => {
                      const review = reviews[row.key] || initialReview(row);
                      const draft = row.sourceType === 'extra_cost' ? extraDrafts[row.sourceId] || initialExtraDraft(row.item) : null;
                      return <div key={row.key} className="rounded-xl border border-border bg-muted/10 p-3"><div className="mb-3 border-b border-border pb-3"><div className="font-semibold">{itemLabel(row)}</div><div className="mt-1 text-xs text-muted-foreground">Shared identity · {valueOf(row.item, ['description', 'productName'], 'Charge')} · Qty {valueOf(row.item, ['quantity'], '—')} {valueOf(row.item, ['unitOfMeasure'], '')}</div></div><div className="grid gap-3 lg:grid-cols-2"><SupplierChargeDecision row={row} review={review} draft={draft} disabled={!canCostSideEdit || Boolean(supplierSavingId)} onOutcome={(outcome) => { updateReview(row.key, { outcome }); if (row.sourceType === 'extra_cost' && outcome === 'correct') updateExtraDraft(row.sourceId, initialExtraDraft(row.item)); if (row.sourceType === 'extra_cost' && outcome === 'cancelled') updateExtraDraft(row.sourceId, { cancelled: true }); if (row.sourceType === 'extra_cost' && outcome === 'changed') updateExtraDraft(row.sourceId, { cancelled: false }); }} onDraftChange={(patch) => updateExtraDraft(row.sourceId, patch)} /><BuyerChargeDecision row={row} review={review} draft={draft} disabled={!canBuyerSideEdit || saving} onDecision={(buyerChargeDecision) => updateReview(row.key, { buyerChargeDecision })} onDraftChange={(patch) => updateExtraDraft(row.sourceId, patch)} /></div></div>;
                    })}
                  </div>
                  {canCostSideEdit && activeCostSide?.status !== 'verified' && <div className="space-y-3"><Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => setAddDrafts((current) => [...current, initialAddDraft(activeCase, activeSupplierId)])}><PackagePlus className="h-4 w-4" /> Add supplier charge</Button>{addDrafts.filter((draft) => text(draft.supplierAccountId) === activeSupplierId).map((draft) => <NewExtraCostEditor key={draft.localId} draft={draft} products={products} supplierAccounts={supplierAccounts.filter((row) => text(row.id) === activeSupplierId)} files={salesforceFiles} defaultPaymentTerm={supplierPaymentTerm} supplierStage={!canBuyerSideEdit} disabled={!canCostSideEdit} onChange={(patch) => updateAddDraft(draft.localId, patch)} onRemove={() => setAddDrafts((current) => current.filter((row) => row.localId !== draft.localId))} />)}</div>}
                  <div className="grid gap-4 lg:grid-cols-2">
                    <SideReviewPanel title="Supplier costs" side={activeCostSide} note={supplierReviewNotes[activeSupplierId] || ''} onNote={(value) => setSupplierReviewNotes((current) => ({ ...current, [activeSupplierId]: value }))} disabled={!canCostSideEdit || Boolean(supplierSavingId)} />
                    <SideReviewPanel title="Buyer charges" side={activeBuyerSide} note={buyerReviewNotes[activeSupplierId] || ''} onNote={(value) => setBuyerReviewNotes((current) => ({ ...current, [activeSupplierId]: value }))} disabled={!canBuyerSideEdit || saving} />
                  </div>
                  {salesforceFiles.length ? <OptionalEvidence files={salesforceFiles} selectedIds={activeSupplierRows[0] ? reviews[activeSupplierRows[0].key]?.evidenceDocumentIds || [] : []} disabled={Boolean(supplierSavingId) || saving} onToggle={(fileId) => activeSupplierRows.forEach((row) => toggleEvidence(row.key, fileId))} /> : null}
                  <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
                    {canCostSideEdit && activeCostSide?.status !== 'verified' && <Button type="button" variant="outline" disabled={Boolean(supplierSavingId)} onClick={() => confirmPairedSides(activeSupplierStage, ['cost'])}>Confirm cost side</Button>}
                    {canBuyerSideEdit && activeBuyerSide?.status !== 'verified' && <Button type="button" variant="outline" disabled={saving || Boolean(supplierSavingId)} onClick={() => confirmPairedSides(activeSupplierStage, ['buyer_charge'])}>Confirm buyer side</Button>}
                    {canCostSideEdit && canBuyerSideEdit && activeCostSide?.status !== 'verified' && activeBuyerSide?.status !== 'verified' && (activeCostSide.currentAssignee?.id === activeBuyerSide.currentAssignee?.id || canGmOverride) && <Button type="button" disabled={saving || Boolean(supplierSavingId)} onClick={() => confirmPairedSides(activeSupplierStage, ['cost', 'buyer_charge'])}>{saving || supplierSavingId === activeSupplierId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}Confirm both sides</Button>}
                  </div>
                </section>
              )}
            </>
          ) : (
            <>
          <SupplierProgress requirements={supplierRequirements} activeSupplierId={activeSupplierId} onSelect={setActiveSupplierId} canGmOverride={canGmOverride} />

          {activeSupplierStage && activeSupplierStage.status !== 'Verified' && currentStep !== 'invoice_attention' && (
            <section className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">Confirm {activeSupplierStage.supplierName || 'supplier'} costs</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Mark each charge as correct. Open only the rows that need a correction.</p>
                </div>
                <Badge variant="outline">Supplier Trader · {activeSupplierStage.assignedSupplierTrader?.name || 'Needs assignment'}</Badge>
              </div>
              {!canSupplierEdit && <ReadOnlyNotice caseRow={activeCase} responsiblePerson={activeSupplierStage.assignedSupplierTrader?.name} />}
              <div className="space-y-3">
                {activeSupplierRows.map((row) => {
                  const review = reviews[row.key] || initialReview(row);
                  const extraId = row.sourceType === 'extra_cost' ? row.sourceId : '';
                  const draft = extraId ? extraDrafts[extraId] || initialExtraDraft(row.item) : null;
                  return <SupplierChargeDecision key={row.key} row={row} review={review} draft={draft} disabled={!canSupplierEdit || Boolean(supplierSavingId)} onOutcome={(outcome) => {
                    updateReview(row.key, { outcome });
                    if (extraId && outcome === 'correct') updateExtraDraft(extraId, initialExtraDraft(row.item));
                    if (extraId && outcome === 'cancelled') updateExtraDraft(extraId, { cancelled: true });
                    if (extraId && outcome === 'changed') updateExtraDraft(extraId, { cancelled: false });
                  }} onDraftChange={(patch) => updateExtraDraft(extraId, patch)} />;
                })}
              </div>
              {canSupplierEdit && <div className="space-y-3"><Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => setAddDrafts((current) => [...current, initialAddDraft(activeCase, activeSupplierId)])}><PackagePlus className="h-4 w-4" /> Add supplier charge</Button>{addDrafts.filter((draft) => text(draft.supplierAccountId) === activeSupplierId).map((draft) => <NewExtraCostEditor key={draft.localId} draft={draft} products={products} supplierAccounts={supplierAccounts.filter((row) => text(row.id) === activeSupplierId)} files={[]} defaultPaymentTerm={supplierPaymentTerm} supplierStage disabled={!canSupplierEdit} onChange={(patch) => updateAddDraft(draft.localId, patch)} onRemove={() => setAddDrafts((current) => current.filter((row) => row.localId !== draft.localId))} />)}</div>}
              <div className="space-y-2">
                <Label htmlFor={`supplier-review-note-${activeSupplierId}`}>Supplier reference or note</Label>
                <Textarea id={`supplier-review-note-${activeSupplierId}`} value={supplierReviewNotes[activeSupplierId] || ''} onChange={(event) => setSupplierReviewNotes((current) => ({ ...current, [activeSupplierId]: event.target.value.slice(0, 1000) }))} placeholder="Invoice reference, supplier confirmation, or short review note" disabled={!canSupplierEdit || Boolean(supplierSavingId)} />
                <p className="text-xs text-muted-foreground">One note covers all charges for this supplier. Salesforce Files remain optional.</p>
              </div>
              {salesforceFiles.length ? <OptionalEvidence files={salesforceFiles} selectedIds={activeSupplierRows[0] ? reviews[activeSupplierRows[0].key]?.evidenceDocumentIds || [] : []} disabled={!canSupplierEdit || Boolean(supplierSavingId)} onToggle={(fileId) => activeSupplierRows.forEach((row) => toggleEvidence(row.key, fileId))} /> : null}
              <div className="flex justify-end border-t border-border pt-4">
                <Button type="button" onClick={() => verifySupplierStage(activeSupplierStage)} disabled={!canSupplierEdit || Boolean(supplierSavingId)}>
                  {supplierSavingId === activeSupplierId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />} Confirm {activeSupplierStage.supplierName || 'supplier'} costs
                </Button>
              </div>
            </section>
          )}

          {allSuppliersVerified && currentStep === 'buyer_charges' && (
            <section className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
              <div><h2 className="text-base font-semibold">Approve buyer charges</h2><p className="mt-1 text-sm text-muted-foreground">Check the totals, decide which charges go to the buyer, and add one case note.</p></div>
              <FinancialSummary summary={financials} />
              {!canBuyerConfirm && <ReadOnlyNotice caseRow={activeCase} responsiblePerson={activeCase.assignedBuyerTrader?.name} />}
              <div className="space-y-3">
                {visibleBuyerRows.map((row) => <BuyerChargeDecision key={row.key} row={row} review={reviews[row.key] || initialReview(row)} draft={row.sourceType === 'extra_cost' ? extraDrafts[row.sourceId] || initialExtraDraft(row.item) : null} disabled={!canBuyerConfirm || saving} onDecision={(buyerChargeDecision) => updateReview(row.key, { buyerChargeDecision })} onDraftChange={(patch) => updateExtraDraft(row.sourceId, patch)} />)}
                {!visibleBuyerRows.length && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">Every charge has a buyer decision.</div>}
                {reviewRows.length !== unresolvedBuyerRows.length && <Button type="button" variant="ghost" size="sm" onClick={() => setShowAllBuyerRows((value) => !value)}>{showAllBuyerRows ? 'Hide decided rows' : `Show ${reviewRows.length - unresolvedBuyerRows.length} decided rows`}</Button>}
              </div>
              <div className="space-y-2"><Label htmlFor="buyer-review-note">Case note</Label><Textarea id="buyer-review-note" value={buyerReviewNote} onChange={(event) => setBuyerReviewNote(event.target.value.slice(0, 1000))} placeholder="Short reason for the buyer-charge decisions" disabled={!canBuyerConfirm || saving} /></div>
              <div className="flex justify-end border-t border-border pt-4"><Button type="button" onClick={saveConfirmation} disabled={!canBuyerConfirm || saving || Boolean(supplierSavingId)}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />} Approve buyer charges</Button></div>
            </section>
          )}
            </>
          )}

          {valueOf(activeCase, ['status']) === 'ready_for_invoice' && <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /><div><div className="font-semibold">Buyer invoice ready</div><div className="mt-1 text-sm">Every required buyer-charge side is confirmed. Any outstanding supplier-cost work remains visible above.</div></div></div>}

          <AuditDetails caseRow={activeCase} files={salesforceFiles} canGmOverride={canGmOverride} canEditNormally={canEditNormally} gmActionReason={gmActionReason} onGmActionReason={setGmActionReason} onOpenGm={pairedWorkflow ? null : () => setGmOpen(true)} />
        </div>
      ) : null}

      <Dialog open={gmOpen} onOpenChange={setGmOpen}>
        <DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>General Manager override</DialogTitle><DialogDescription>Temporarily reassign this task. A reason is mandatory and recorded in the audit trail.</DialogDescription></DialogHeader><div className="space-y-4"><div className="space-y-2"><Label htmlFor="variable-charge-gm-assignee">Temporary assignee</Label><Select value={gmDraft.assigneeProfileId} onValueChange={(assigneeProfileId) => setGmDraft((current) => ({ ...current, assigneeProfileId }))} disabled={gmSaving}><SelectTrigger id="variable-charge-gm-assignee"><SelectValue placeholder="Select active FCOS user" /></SelectTrigger><SelectContent>{assigneeOptions.map((option) => <SelectItem key={valueOf(option, ['id', 'profileId', 'profile_id'])} value={String(valueOf(option, ['id', 'profileId', 'profile_id']))}>{valueOf(option, ['fullName', 'full_name', 'name', 'email'])}</SelectItem>)}</SelectContent></Select></div>{!assigneeOptions.length && <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Active reassignment options are unavailable. Refresh the task before attempting an override.</p>}<div className="space-y-2"><Label htmlFor="variable-charge-gm-reason">Override reason</Label><Textarea id="variable-charge-gm-reason" value={gmDraft.reason} onChange={(event) => setGmDraft((current) => ({ ...current, reason: event.target.value }))} placeholder="Why is temporary reassignment required?" disabled={gmSaving} /></div></div><DialogFooter><Button type="button" variant="outline" onClick={() => setGmOpen(false)} disabled={gmSaving}>Cancel</Button><Button type="button" onClick={saveGmOverride} disabled={gmSaving || !assigneeOptions.length}>{gmSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Apply override</Button></DialogFooter></DialogContent>
      </Dialog>
    </div>
  ) : null;

  if (variableChargeTask) return variableChargeTask;

  return (
    <div className="space-y-5 p-4 lg:p-8">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"><ClipboardCheck className="h-3.5 w-3.5" /> Payment Collections</div>
          <h1 className="mt-1 text-xl font-semibold text-foreground">Variable Charges</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">See what needs your attention, what is waiting, and what is ready for invoice creation.</p>
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

      {loading ? <StateBlock icon={Loader2} title="Loading variable charges" description="Checking the latest Salesforce delivery, schedule, and charge status." /> : !error && !cases.length ? (
        <StateBlock icon={CheckCircle2} title={`No ${VIEWS.find((item) => item.id === view)?.label.toLowerCase() || 'variable charge'} cases`} description="Refresh to retrieve the latest Salesforce data." />
      ) : !error && (
        <>
          <div className="space-y-3 md:hidden">
            {cases.map((caseRow) => <CaseCard key={caseStemId(caseRow)} caseRow={caseRow} onOpen={(event) => openDetail(caseRow, event)} onOpenStem={onOpenStem} />)}
          </div>
          <TableShell title="Variable Charges tasks" meta={`${cases.length.toLocaleString()} cases`} bodyClassName="hidden p-0 md:block">
            <div className="overflow-auto">
              <table className="w-full min-w-[1040px] text-sm">
                <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-3">STEM</th><th className="px-4 py-3">Supplier</th><th className="px-4 py-3">Progress</th><th className="px-4 py-3">Responsible</th><th className="px-4 py-3">Due / available</th><th className="px-4 py-3">Next action</th><th className="px-4 py-3"><span className="sr-only">Open</span></th></tr></thead>
                <tbody className="divide-y divide-border">{cases.map((caseRow) => <CaseRow key={caseStemId(caseRow)} caseRow={caseRow} onOpen={(event) => openDetail(caseRow, event)} onOpenStem={onOpenStem} />)}</tbody>
              </table>
            </div>
          </TableShell>
        </>
      )}

    </div>
  );
}

function itemLabel(row) {
  return text(valueOf(row.item, ['productName'])) || 'Product name unavailable';
}

function viewTone(value) {
  if (value === 'post_invoice_changes') return 'border-rose-300 bg-rose-50 text-rose-900';
  if (value === 'needs_action') return 'border-blue-300 bg-blue-50 text-blue-900';
  if (value === 'awaiting_delivery') return 'border-amber-300 bg-amber-50 text-amber-900';
  return VIEWS.find((item) => item.id === value)?.tone || 'border-slate-300 bg-slate-50 text-slate-800';
}

function CaseRow({ caseRow, onOpen, onOpenStem }) {
  const status = valueOf(caseRow, ['status']);
  return <tr className={cn('bg-card align-middle', status === 'post_invoice_changes' && 'bg-rose-50/60')}><td className="px-4 py-3"><StemIdentity caseRow={caseRow} onOpenStem={onOpenStem} /></td><td className="px-4 py-3">{valueOf(caseRow, ['variableChargeSupplierName', 'variable_charge_supplier_name'], '—')}</td><td className="px-4 py-3"><CaseProgress caseRow={caseRow} status={status} /></td><td className="px-4 py-3">{valueOf(caseRow, ['responsiblePerson', 'workflow.responsiblePerson'], 'Needs assignment')}</td><td className="px-4 py-3">{queueDate(caseRow)}</td><td className={cn('px-4 py-3 font-medium', status === 'post_invoice_changes' && 'text-rose-800')}>{valueOf(caseRow, ['nextAction', 'workflow.nextAction'], caseStatus(caseRow))}</td><td className="px-4 py-3 text-right"><Button type="button" size="sm" variant="outline" onClick={onOpen}>{valueOf(caseRow, ['isMyTask', 'workflow.isMyTask']) === true ? 'Start' : 'Open'} <ChevronRight className="ml-1 h-3.5 w-3.5" /></Button></td></tr>;
}

function CaseCard({ caseRow, onOpen, onOpenStem }) {
  const status = valueOf(caseRow, ['status']);
  return <article className={cn('rounded-xl border border-border bg-card p-4 shadow-sm', status === 'post_invoice_changes' && 'border-rose-300 bg-rose-50/60')}><div className="flex items-start justify-between gap-3"><div><StemIdentity caseRow={caseRow} onOpenStem={onOpenStem} /><p className="mt-1 text-sm text-muted-foreground">{valueOf(caseRow, ['variableChargeSupplierName', 'variable_charge_supplier_name'], 'Variable Charges supplier')}</p></div><CaseProgress caseRow={caseRow} status={status} /></div><dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-xs"><div><dt className="text-muted-foreground">Responsible</dt><dd className="mt-0.5 font-medium">{valueOf(caseRow, ['responsiblePerson', 'workflow.responsiblePerson'], 'Needs assignment')}</dd></div><div><dt className="text-muted-foreground">Due / available</dt><dd className="mt-0.5 font-medium">{queueDate(caseRow)}</dd></div><div className="col-span-2"><dt className="text-muted-foreground">Next action</dt><dd className={cn('mt-0.5 font-medium', status === 'post_invoice_changes' && 'text-rose-800')}>{valueOf(caseRow, ['nextAction', 'workflow.nextAction'], caseStatus(caseRow))}</dd></div></dl><Button type="button" variant="outline" size="sm" className="mt-4 w-full" onClick={onOpen}>{valueOf(caseRow, ['isMyTask', 'workflow.isMyTask']) === true ? 'Start task' : 'Open task'} <ChevronRight className="ml-1 h-3.5 w-3.5" /></Button></article>;
}

function CaseProgress({ caseRow, status }) {
  if (caseRow?.pairedWorkflowEnabled !== true) return <Badge variant="outline" className={viewTone(status)}>{currentStepLabel(valueOf(caseRow, ['currentStep', 'workflow.currentStep']))}</Badge>;
  const costs = caseRow.sideProgress?.supplierCosts || {};
  const buyer = caseRow.sideProgress?.buyerCharges || {};
  return <div className="space-y-1 text-xs"><div><span className="font-medium">Costs</span> {Number(costs.confirmed || 0)}/{Number(costs.required || 0)}</div><div><span className="font-medium">Buyer</span> {Number(buyer.confirmed || 0)}/{Number(buyer.required || 0)}</div></div>;
}

function currentStepLabel(value) {
  if (value === 'supplier_costs') return 'Supplier costs';
  if (value === 'buyer_charges') return 'Buyer charges';
  if (value === 'paired_charges') return 'Costs & buyer charges';
  if (value === 'ready_for_invoices') return 'Ready for invoices';
  if (value === 'invoice_attention') return 'Invoice action required';
  return 'Waiting';
}

function queueDate(caseRow) {
  const due = valueOf(caseRow, ['dueDate', 'due_date']);
  if (due) return formatDate(due);
  return formatDate(valueOf(caseRow, ['actionableOn', 'actionable_on']));
}

function IndependentSideProgress({ sideProgress = {}, buyerReady = false }) {
  const cost = sideProgress?.supplierCosts || {};
  const buyer = sideProgress?.buyerCharges || {};
  const items = [
    { id: 'cost', label: 'Supplier costs', confirmed: Number(cost.confirmed || 0), required: Number(cost.required || 0), ready: Number(cost.required || 0) > 0 && Number(cost.confirmed || 0) === Number(cost.required || 0) },
    { id: 'buyer', label: 'Buyer charges', confirmed: Number(buyer.confirmed || 0), required: Number(buyer.required || 0), ready: Number(buyer.required || 0) > 0 && Number(buyer.confirmed || 0) === Number(buyer.required || 0) },
    { id: 'invoice', label: 'Buyer invoice', confirmed: buyerReady ? 1 : 0, required: 1, ready: buyerReady },
  ];
  return <ol className="grid gap-2 rounded-xl border border-border bg-card p-3 sm:grid-cols-3">{items.map((item) => <li key={item.id} className={cn('flex items-center gap-3 rounded-lg px-3 py-2 text-sm', !item.ready && item.id !== 'invoice' && 'bg-blue-50 text-blue-950')}><span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full border', item.ready ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-blue-300 bg-white text-blue-700')}>{item.ready ? <CheckCircle2 className="h-4 w-4" /> : <CircleDot className="h-4 w-4" />}</span><span><span className="block font-semibold">{item.label}</span><span className="text-xs text-muted-foreground">{item.confirmed} of {item.required} confirmed</span></span></li>)}</ol>;
}

function GuidedProgress({ currentStep, progress = {} }) {
  const steps = [
    { id: 'supplier_costs', label: 'Supplier costs', state: progress.supplierCosts },
    { id: 'buyer_charges', label: 'Buyer charges', state: progress.buyerCharges },
    { id: 'ready_for_invoices', label: 'Ready for invoices', state: progress.readyForInvoices },
  ];
  return <ol className="grid gap-2 rounded-xl border border-border bg-card p-3 sm:grid-cols-3">{steps.map((step, index) => { const complete = step.state === 'complete'; const active = step.id === currentStep || step.state === 'current'; return <li key={step.id} className={cn('flex items-center gap-3 rounded-lg px-3 py-2 text-sm', active && 'bg-blue-50 text-blue-950')}><span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold', complete ? 'border-emerald-600 bg-emerald-600 text-white' : active ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 text-slate-500')}>{complete ? <CheckCircle2 className="h-4 w-4" /> : index + 1}</span><span className={cn(active || complete ? 'font-semibold' : 'text-muted-foreground')}>{step.label}</span></li>; })}</ol>;
}

function SimpleCaseSummary({ caseRow, onOpenStem }) {
  return <div className="grid gap-3 rounded-xl border border-border bg-muted/20 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4"><SummaryField label="STEM"><StemIdentity caseRow={caseRow} onOpenStem={onOpenStem} /></SummaryField><SummaryField label="Supplier">{valueOf(caseRow, ['variableChargeSupplierName', 'variable_charge_supplier_name'], '—')}</SummaryField><SummaryField label="Buyer Trader">{valueOf(caseRow, ['assignedBuyerTrader.name', 'buyerTraderName'], 'Needs assignment')}</SummaryField><SummaryField label="Due / available">{queueDate(caseRow)}</SummaryField></div>;
}

function SummaryField({ label, children }) { return <div><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 font-medium">{children}</div></div>; }

function SupplierProgress({ requirements, activeSupplierId, onSelect, canGmOverride }) {
  if (!requirements.length) return null;
  return <section className="rounded-xl border border-border bg-card p-4"><div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">Supplier costs</h2><span className="text-xs text-muted-foreground">{requirements.filter((row) => row.status === 'Verified').length} of {requirements.length} confirmed</span></div><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{requirements.map((row) => { const active = text(row.supplierId) === activeSupplierId; const status = row.status === 'Verified' ? 'Confirmed' : row.status === 'Invalidated' ? 'Needs review again' : row.assignmentStatus === 'resolved' ? 'To confirm' : 'Needs assignment'; const selectable = row.canVerify === true || canGmOverride; return <button key={row.supplierId} type="button" disabled={!selectable} onClick={() => onSelect(text(row.supplierId))} className={cn('rounded-lg border p-3 text-left transition-colors', active && selectable ? 'border-blue-400 bg-blue-50' : 'border-border', !selectable && 'cursor-default')}><div className="flex items-start justify-between gap-2"><span className="font-medium">{row.supplierName || 'Supplier unavailable'}</span>{row.status === 'Verified' ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : active ? <CircleDot className="h-4 w-4 shrink-0 text-blue-600" /> : <Circle className="h-4 w-4 shrink-0 text-slate-400" />}</div><div className="mt-1 text-xs text-muted-foreground">{status} · {row.assignedSupplierTrader?.name || 'No Supplier Trader'}</div></button>; })}</div></section>;
}

function PairedSupplierProgress({ requirements, activeSupplierId, onSelect }) {
  if (!requirements.length) return null;
  return <section className="rounded-xl border border-border bg-card p-4"><div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">Suppliers</h2><span className="text-xs text-muted-foreground">Choose a supplier work package</span></div><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{requirements.map((row) => {
    const active = text(row.supplierId) === activeSupplierId;
    const cost = row.sides?.cost || {};
    const buyer = row.sides?.buyerCharge || {};
    return <button key={row.supplierId} type="button" onClick={() => onSelect(text(row.supplierId))} className={cn('rounded-lg border p-3 text-left transition-colors', active ? 'border-blue-400 bg-blue-50' : 'border-border hover:border-slate-300')}><div className="flex items-start justify-between gap-2"><span className="font-medium">{row.supplierName || 'Supplier unavailable'}</span>{cost.status === 'verified' && buyer.status === 'verified' ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <CircleDot className="h-4 w-4 shrink-0 text-blue-600" />}</div><div className="mt-2 grid grid-cols-2 gap-2 text-xs"><SideStatusCompact label="Costs" side={cost} /><SideStatusCompact label="Buyer" side={buyer} /></div></button>;
  })}</div></section>;
}

function SideStatusCompact({ label, side }) {
  const status = side?.status === 'verified' ? 'Confirmed' : side?.status === 'invalidated' ? 'Review again' : 'Pending';
  return <div className="rounded-md bg-background/80 p-2"><div className="font-medium">{label} · {status}</div><div className="mt-0.5 truncate text-muted-foreground">{side?.currentAssignee?.name || 'Unassigned'}</div></div>;
}

function SideReviewPanel({ title, side, note, onNote, disabled }) {
  const status = side?.status === 'verified' ? 'Confirmed' : side?.status === 'invalidated' ? 'Needs review again' : 'Pending';
  return <div className={cn('space-y-3 rounded-lg border p-4', side?.status === 'verified' ? 'border-emerald-200 bg-emerald-50/40' : 'border-border')}><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-semibold">{title}</h3><p className="mt-1 text-xs text-muted-foreground">Assignee · {side?.currentAssignee?.name || 'Needs assignment'}</p></div><Badge variant="outline">{status}</Badge></div>{side?.status !== 'verified' ? <div className="space-y-2"><Label>{title} note</Label><Textarea value={note} onChange={(event) => onNote(event.target.value.slice(0, 1000))} placeholder={`Required note for ${title.toLowerCase()}`} disabled={disabled} /></div> : <p className="text-xs text-emerald-800">Confirmed {side?.confirmationTime ? formatDate(side.confirmationTime) : ''}</p>}</div>;
}

function ReadOnlyNotice({ caseRow, responsiblePerson }) { return <div className="flex gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><span>View only. This step belongs to {responsiblePerson || valueOf(caseRow, ['responsiblePerson', 'workflow.responsiblePerson'], 'another user')}.</span></div>; }

function SupplierChargeDecision({ row, review, draft, disabled, onOutcome, onDraftChange }) {
  const cost = valueOf(row.item, ['lineCost', 'line_cost', 'totalCost', 'Total_Cost__c', 'fixedCost', 'unitCost']);
  const needsChange = review.outcome === 'changed' || review.outcome === 'cancelled';
  return <article className={cn('rounded-lg border p-4', review.outcome === 'correct' ? 'border-emerald-200 bg-emerald-50/40' : needsChange ? 'border-amber-300 bg-amber-50/40' : 'border-border')}><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="font-medium">{itemLabel(row)}</div><div className="mt-1 text-sm text-muted-foreground">Current supplier cost · {formatMoney(cost, valueOf(row.item, ['currency']))}</div></div><div className="flex rounded-lg border border-border bg-background p-1"><Button type="button" size="sm" variant={review.outcome === 'correct' ? 'default' : 'ghost'} className={cn(review.outcome === 'correct' && 'bg-emerald-600 hover:bg-emerald-700')} disabled={disabled} onClick={() => onOutcome('correct')}><CheckCircle2 className="mr-1.5 h-4 w-4" />Correct</Button><Button type="button" size="sm" variant={needsChange ? 'default' : 'ghost'} className={cn(needsChange && 'bg-amber-600 hover:bg-amber-700')} disabled={disabled} onClick={() => onOutcome('changed')}>Needs change</Button></div></div>{needsChange && (row.readOnly ? <div className="mt-3 rounded-md border border-amber-200 bg-white p-3 text-sm text-amber-900">This product line is read-only here. Correct it in Salesforce, then refresh this task.</div> : <ExistingExtraCostEditor item={row.item} draft={draft} disabled={disabled} supplierStage onChange={(patch) => { onDraftChange(patch); if (patch.cancelled === true) onOutcome('cancelled'); else if (review.outcome === 'cancelled') onOutcome('changed'); }} />)}</article>;
}

function BuyerChargeDecision({ row, review, draft, disabled, onDecision, onDraftChange }) {
  const supplierCost = valueOf(row.item, ['lineCost', 'line_cost', 'totalCost', 'Total_Cost__c', 'fixedCost', 'unitCost']);
  const buyerCharge = valueOf(row.item, ['linePrice', 'line_price', 'totalPrice', 'Total_Price__c', 'fixedPrice', 'unitPrice']);
  return <article className="rounded-lg border border-border p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="font-medium">{itemLabel(row)}</div><div className="mt-1 text-sm text-muted-foreground">Supplier {formatMoney(supplierCost)} · Buyer {formatMoney(buyerCharge)}</div></div><div className="flex rounded-lg border border-border bg-background p-1">{BUYER_CHARGE_DECISIONS.map((option) => <Button key={option.value} type="button" size="sm" variant={review.buyerChargeDecision === option.value ? 'default' : 'ghost'} disabled={disabled} onClick={() => onDecision(option.value)}>{option.value === 'include' ? 'Include' : 'Exclude'}</Button>)}</div></div>{row.sourceType === 'extra_cost' && review.buyerChargeDecision === 'include' && draft ? <div className="mt-3 max-w-sm space-y-2"><Label htmlFor={`buyer-price-${row.sourceId}`}>{draft.pricingType === 'fixed' ? 'Buyer charge' : 'Buyer price / unit'}</Label><Input id={`buyer-price-${row.sourceId}`} inputMode="decimal" value={draft.buyerPrice ?? ''} onChange={(event) => onDraftChange({ buyerPrice: event.target.value })} disabled={disabled} /></div> : null}</article>;
}

function FinancialSummary({ summary }) {
  return <div className="grid gap-3 sm:grid-cols-3"><SummaryAmount label="Supplier-cost total" value={summary.supplierCostTotal} complete={summary.costsComplete} /><SummaryAmount label="Buyer-charge total" value={summary.buyerChargeTotal} complete={summary.chargesComplete} /><SummaryAmount label="Margin" value={summary.margin} complete={summary.costsComplete && summary.chargesComplete} /></div>;
}

function SummaryAmount({ label, value, complete }) { return <div className="rounded-lg border border-border bg-muted/20 p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 text-lg font-semibold tabular-nums">{complete ? formatMoney(value) : 'Unavailable'}</div><div className="mt-1 text-[11px] text-muted-foreground">STEM currency</div></div>; }

function OptionalEvidence({ files, selectedIds, disabled, onToggle }) {
  return <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-sm font-medium">Optional Salesforce Files ({files.length})</summary><div className="mt-3 flex flex-wrap gap-2">{files.map((file) => { const fileId = String(valueOf(file, ['contentDocumentId', 'id', 'Id'])); return <label key={fileId} className="flex max-w-full items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs"><Checkbox checked={selectedIds.includes(fileId)} disabled={disabled} onCheckedChange={() => onToggle(fileId)} /><FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /><span className="truncate">{valueOf(file, ['title', 'fileName', 'name', 'Name'], 'Salesforce File')}</span></label>; })}</div></details>;
}

function AuditDetails({ caseRow, files, canGmOverride, canEditNormally, gmActionReason, onGmActionReason, onOpenGm }) {
  return <details className="rounded-xl border border-border bg-card"><summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Audit details</summary><div className="space-y-4 border-t border-border p-4 text-sm"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><SummaryField label="Available from">{formatDate(valueOf(caseRow, ['actionableOn']))}</SummaryField><SummaryField label="Based on">{actionBasisLabel(caseRow)}</SummaryField><SummaryField label="Revision">{valueOf(caseRow, ['revision'], 0)}</SummaryField><SummaryField label="Linked files">{files.length}</SummaryField></div>{valueOf(caseRow, ['assignmentMessage']) && <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900">{valueOf(caseRow, ['assignmentMessage'])}</p>}{canGmOverride && <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3"><div className="font-medium text-amber-950">General Manager controls</div>{!canEditNormally && <div className="space-y-2"><Label htmlFor="variable-charge-gm-action-reason">Action reason</Label><Textarea id="variable-charge-gm-action-reason" value={gmActionReason} onChange={(event) => onGmActionReason(event.target.value.slice(0, 1000))} placeholder="Why are you acting for the assigned trader?" /></div>}{onOpenGm && <Button type="button" size="sm" variant="outline" onClick={onOpenGm}><ShieldCheck className="mr-2 h-4 w-4" />Temporary reassignment</Button>}</div>}</div></details>;
}

function ExistingExtraCostEditor({ item, draft, supplierStage = false, buyerStage = false, disabled, onChange }) {
  const id = rowId(item, 'extra', 0);
  return <div className="mt-3 rounded-lg border border-amber-200 bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="font-medium">Correction</div><label className="flex items-center gap-2 text-sm font-medium"><Checkbox checked={draft.cancelled === true} disabled={disabled || buyerStage} onCheckedChange={(checked) => onChange({ cancelled: checked === true })} />Cancel this charge</label></div>{draft.cancelled ? <div className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-900">The charge will remain in Salesforce history but will no longer be active.</div> : <><div className="mt-4 space-y-2"><Label htmlFor={`existing-${id}-description`}>Description</Label><Input id={`existing-${id}-description`} value={draft.description || ''} onChange={(event) => onChange({ description: event.target.value })} disabled={disabled || buyerStage} /></div><ExtraCostFields id={`existing-${id}`} value={draft} disabled={disabled} supplierStage={supplierStage} buyerStage={buyerStage} onChange={onChange} /></>}</div>;
}

function NewExtraCostEditor({ draft, products, supplierAccounts, files, defaultPaymentTerm, supplierStage = false, disabled, onChange, onRemove }) {
  const toggleFile = (fileId) => {
    const ids = new Set(draft.evidenceDocumentIds || []);
    if (ids.has(fileId)) ids.delete(fileId); else ids.add(fileId);
    onChange({ evidenceDocumentIds: [...ids] });
  };
  return <div className="rounded-lg border border-dashed border-primary/40 bg-primary/[0.02] p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="font-medium">New supplier charge</div><div className="mt-1 text-xs text-muted-foreground">The payment term is inherited automatically.</div></div><Button type="button" variant="ghost" size="sm" onClick={onRemove} disabled={disabled}><X className="mr-1 h-4 w-4" /> Remove</Button></div><div className="mt-4 grid gap-3 md:grid-cols-3"><div className="space-y-2"><Label>Supplier</Label><Select value={draft.supplierAccountId || undefined} onValueChange={(supplierAccountId) => onChange({ supplierAccountId })} disabled={disabled || supplierStage}><SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger><SelectContent>{supplierAccounts.map((account) => <SelectItem key={account.id} value={String(account.id)}>{account.name || account.id}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Product</Label><Select value={draft.productId || undefined} onValueChange={(productId) => onChange({ productId })} disabled={disabled}><SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger><SelectContent>{products.map((product) => <SelectItem key={valueOf(product, ['id', 'Id', 'productId'])} value={String(valueOf(product, ['id', 'Id', 'productId']))}>{valueOf(product, ['name', 'Name', 'label'], 'Product')}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor={`new-extra-description-${draft.localId}`}>Description</Label><Input id={`new-extra-description-${draft.localId}`} value={draft.description} onChange={(event) => onChange({ description: event.target.value })} disabled={disabled} /></div></div><ExtraCostFields id={`new-${draft.localId}`} value={{ ...draft, paymentTerm: draft.paymentTerm || defaultPaymentTerm }} disabled={disabled} supplierStage={supplierStage} onChange={onChange} paymentTermReadOnly />{!supplierStage && <div className="mt-4 grid gap-3 md:grid-cols-3"><label className="flex items-center gap-2 text-sm font-medium"><Checkbox checked={draft.reviewed === true} disabled={disabled} onCheckedChange={(checked) => onChange({ reviewed: checked === true })} /> Reviewed</label><div className="space-y-2"><Label>Buyer-charge decision</Label><Select value={draft.buyerChargeDecision || undefined} onValueChange={(buyerChargeDecision) => onChange({ buyerChargeDecision })} disabled={disabled}><SelectTrigger><SelectValue placeholder="Select decision" /></SelectTrigger><SelectContent>{BUYER_CHARGE_DECISIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor={`new-extra-reference-${draft.localId}`}>Reference or review note</Label><Input id={`new-extra-reference-${draft.localId}`} value={draft.referenceOrNote || ''} onChange={(event) => onChange({ referenceOrNote: event.target.value })} disabled={disabled} /></div></div>}{files.length ? <div className="mt-3 flex flex-wrap gap-2">{files.map((file) => { const fileId = String(valueOf(file, ['contentDocumentId', 'id', 'Id'])); return <label key={fileId} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs"><Checkbox checked={(draft.evidenceDocumentIds || []).includes(fileId)} disabled={disabled} onCheckedChange={() => toggleFile(fileId)} /><FileText className="h-3.5 w-3.5" />{valueOf(file, ['title', 'name'], 'Salesforce File')}</label>; })}</div> : null}</div>;
}

function ExtraCostFields({ id, value, disabled, supplierStage = false, buyerStage = false, onChange, paymentTermReadOnly = false }) {
  return <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-6"><div className="space-y-2"><Label htmlFor={`${id}-term`}>Payment term</Label><Input id={`${id}-term`} value={value.paymentTerm || ''} onChange={(event) => onChange({ paymentTerm: event.target.value })} disabled={disabled || paymentTermReadOnly || buyerStage} /></div><div className="space-y-2"><Label>Pricing</Label><Select value={value.pricingType} onValueChange={(pricingType) => onChange({ pricingType })} disabled={disabled || buyerStage}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="fixed">Fixed</SelectItem><SelectItem value="per_unit">Per unit</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label htmlFor={`${id}-supplier-cost`}>{value.pricingType === 'fixed' ? 'Fixed supplier cost' : 'Supplier cost / unit'}</Label><Input id={`${id}-supplier-cost`} inputMode="decimal" value={value.supplierCost ?? ''} onChange={(event) => onChange({ supplierCost: event.target.value })} disabled={disabled || buyerStage} /></div>{!supplierStage && <div className="space-y-2"><Label htmlFor={`${id}-buyer-price`}>{value.pricingType === 'fixed' ? 'Fixed buyer price' : 'Buyer price / unit'}</Label><Input id={`${id}-buyer-price`} inputMode="decimal" value={value.buyerPrice ?? ''} onChange={(event) => onChange({ buyerPrice: event.target.value })} disabled={disabled} /></div>}{value.pricingType === 'per_unit' && <><div className="space-y-2"><Label htmlFor={`${id}-quantity`}>Quantity</Label><Input id={`${id}-quantity`} inputMode="decimal" value={value.quantity ?? ''} onChange={(event) => onChange({ quantity: event.target.value })} disabled={disabled || buyerStage} /></div><div className="space-y-2"><Label htmlFor={`${id}-uom`}>Unit of measure</Label><Input id={`${id}-uom`} value={value.unitOfMeasure || ''} onChange={(event) => onChange({ unitOfMeasure: event.target.value })} disabled={disabled || buyerStage} /></div></>}</div>;
}

function PostInvoiceResolution({ value, disabled, saving, onChange, onSave }) { return <section className="space-y-3 rounded-lg border border-rose-200 bg-rose-50/50 p-4"><div><h2 className="text-sm font-semibold text-rose-950">Urgent post-invoice change</h2><p className="mt-1 text-xs text-rose-900">Resolve as no adjustment, revised invoice, or credit note. A reference is mandatory.</p></div><div className="grid gap-3 md:grid-cols-2"><div className="space-y-2"><Label>Resolution</Label><Select value={value.resolution} onValueChange={(resolution) => onChange({ resolution })} disabled={disabled || saving}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{POST_INVOICE_RESOLUTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor="post-invoice-reference">Reference</Label><Input id="post-invoice-reference" value={value.reference} onChange={(event) => onChange({ reference: event.target.value })} placeholder="Invoice, credit note, or approval reference" disabled={disabled || saving} /></div></div><div className="space-y-2"><Label htmlFor="post-invoice-note">Resolution note</Label><Textarea id="post-invoice-note" value={value.note} onChange={(event) => onChange({ note: event.target.value })} placeholder="Optional context" disabled={disabled || saving} /></div><Button type="button" variant="outline" onClick={onSave} disabled={disabled || saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save resolution</Button>{disabled && <p className="text-xs text-rose-900">Only the currently authorized resolver may record this outcome.</p>}</section>; }
