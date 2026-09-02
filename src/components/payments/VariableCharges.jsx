import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Circle,
  CircleDot,
  ChevronRight,
  ClipboardCheck,
  ExternalLink,
  FileText,
  Info,
  Loader2,
  Minus,
  MoreHorizontal,
  PackagePlus,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  X,
} from 'lucide-react';
import { appClient } from '@/api/appClient';
import PageMethodology from '@/components/common/PageMethodology';
import StemDetailLink from '@/components/common/StemDetailLink';
import StateBlock from '@/components/common/StateBlock';
import TableShell from '@/components/common/TableShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { PAYMENT_COLLECTIONS_METHODOLOGIES } from '@/lib/pageMethodologies';
import {
  ANCHORAGE_LOCATION_ELSEWHERE,
  ANCHORAGE_LOCATION_ELSEWHERE_LABEL,
  calculateHongKongAnchorageDues,
} from '@/lib/anchorageDues';
import { LIGHT_DUES_CATEGORY_ALL_OTHER, calculateHongKongLightDues } from '@/lib/lightDues';
import { cn } from '@/lib/utils';
import {
  buyerAmountWithAnchorageDecision,
  buyerDecisionDefaultForItem,
  buyerDecisionLockedForItem,
  buyerDecisionOptionsForItem,
  buyerPriceWithAnchorageDefault,
  canApproveBothVariableChargeLegs,
  isIncludedBasicCallingItem,
  isHongKongAnchorageDuesItem,
  isPortClearanceItem,
  portClearanceApplicationCount,
  statutorySupplierHkdDefault,
  stepPortClearanceApplicationCount,
  supplierInputAmountUsd,
  supplierCostLockedForItem,
  variableChargeQuantityLabel,
} from '@/lib/variableChargeRules';

const VIEWS = [
  { id: 'my_tasks', label: 'My Tasks', tone: 'border-blue-300 bg-blue-50 text-blue-900' },
  { id: 'waiting', label: 'Waiting', tone: 'border-amber-300 bg-amber-50 text-amber-900' },
  { id: 'ready_for_invoice', label: 'Ready for Invoice', tone: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
  { id: 'completed', label: 'Completed', tone: 'border-slate-300 bg-slate-50 text-slate-800' },
  { id: 'all_cases', label: 'All Cases', tone: 'border-slate-300 bg-slate-50 text-slate-800' },
];

const BUYER_CHARGE_DECISIONS = [
  { value: 'include', label: 'Charge Buyer' },
  { value: 'exclude', label: 'Do Not Charge' },
];

const POST_INVOICE_RESOLUTIONS = [
  { value: 'no_adjustment', label: 'No Adjustment' },
  { value: 'revised_invoice', label: 'Revised Invoice' },
  { value: 'credit_note', label: 'Credit Note' },
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
  if (value == null || value === '') return 'Unavailable';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'Unavailable';
  return `${currency || 'USD'} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sideStatusLabel(side) {
  if (side?.status === 'verified') return 'Approved';
  if (side?.status === 'invalidated') return 'Needs Review';
  return 'Pending';
}

function sideStatusTone(side) {
  if (side?.status === 'verified') return 'border-emerald-300 bg-emerald-50 text-emerald-900';
  if (side?.status === 'invalidated') return 'border-amber-300 bg-amber-50 text-amber-900';
  return 'border-slate-300 bg-slate-50 text-slate-700';
}

function pricingTypeFor(item) {
  return item?.fixed === true || valueOf(item, ['pricingType', 'pricing_type']) === 'fixed'
    || valueOf(item, ['fixedCost', 'fixed_cost', 'fixedPrice', 'fixed_price'], null) != null ? 'fixed' : 'per_unit';
}

function rowFinancials(row, draft, fallbackCurrency = 'USD') {
  const item = row.item || {};
  const pricingType = draft?.pricingType || pricingTypeFor(item);
  const currency = text(valueOf(item, ['currency', 'CurrencyIsoCode'])) || fallbackCurrency || 'USD';
  const quantity = finiteNumber(draft?.quantity ?? valueOf(item, ['quantity', 'Quantity__c']));
  const nativeSupplierRate = finiteNumber(draft?.supplierCost ?? (pricingType === 'fixed'
    ? valueOf(item, ['fixedCost', 'fixed_cost', 'Lumpsum_Cost__c'])
    : valueOf(item, ['cost', 'unitCost', 'unit_cost', 'Unit_Cost__c'])));
  const supplierRate = draft
    ? supplierInputAmountUsd(
      nativeSupplierRate,
      draft.inputCurrency || valueOf(item, ['supplierCurrency.inputCurrency'], 'USD'),
      valueOf(item, ['supplierCurrency.usdHkdRate']),
    )
    : nativeSupplierRate;
  const buyerRate = finiteNumber(draft?.buyerPrice ?? (pricingType === 'fixed'
    ? valueOf(item, ['fixedPrice', 'fixed_price', 'Lumpsum_Price__c'])
    : valueOf(item, ['price', 'unitPrice', 'unit_price', 'Unit_Price__c'])));
  const storedSupplierTotal = finiteNumber(valueOf(item, ['lineCost', 'line_cost', 'totalCost', 'Total_Cost__c']));
  const storedBuyerTotal = finiteNumber(valueOf(item, ['linePrice', 'line_price', 'totalPrice', 'Total_Price__c']));
  const supplierTotal = draft ? (pricingType === 'fixed' ? supplierRate : supplierRate != null && quantity != null ? supplierRate * quantity : null) : storedSupplierTotal;
  const buyerTotal = draft ? (pricingType === 'fixed' ? buyerRate : buyerRate != null && quantity != null ? buyerRate * quantity : null) : storedBuyerTotal;
  return {
    pricingType, currency, quantity, supplierRate, buyerRate, supplierTotal, buyerTotal,
    margin: supplierTotal != null && buyerTotal != null ? buyerTotal - supplierTotal : null,
  };
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
  if (status === 'post_invoice_changes') return 'Invoice Action Required';
  if (status === 'awaiting_delivery') return 'Waiting';
  if (status === 'needs_action') return 'In Review';
  if (status === 'ready_for_invoice') return 'Ready for Invoice';
  if (status === 'completed') return 'Completed';
  return VIEWS.find((view) => view.id === status)?.label || status || 'In Review';
}

function normalizeReviewRows(lineItems = [], extraCosts = []) {
  const compare = (a, b) => {
    const aSequence = finiteNumber(valueOf(a.item, ['bundleSequence', 'bundle_sequence'])) ?? 100;
    const bSequence = finiteNumber(valueOf(b.item, ['bundleSequence', 'bundle_sequence'])) ?? 100;
    return aSequence - bSequence || itemLabel(a).localeCompare(itemLabel(b), 'en', { sensitivity: 'base' }) || a.sourceId.localeCompare(b.sourceId);
  };
  return [
    ...lineItems.map((item, index) => ({ key: `line:${rowId(item, 'line', index)}`, sourceType: 'line_item', sourceId: rowId(item, 'line', index), item, readOnly: true })).sort(compare),
    ...extraCosts.map((item, index) => ({ key: `extra:${rowId(item, 'extra', index)}`, sourceType: 'extra_cost', sourceId: rowId(item, 'extra', index), item, readOnly: false })).sort(compare),
  ];
}

function initialReview(row) {
  const item = row.item || {};
  const anchorageBuyerSuggestion = item?.anchorageVerification?.buyerDefault?.available === true
    ? finiteNumber(item.anchorageVerification.buyerDefault.amountUsd)
    : null;
  const recordedBuyerDecision = text(valueOf(item, ['buyerChargeDecision', 'buyer_charge_decision']));
  return {
    outcome: '',
    reviewed: item.reviewed === true,
    buyerChargeDecision: recordedBuyerDecision
      || (anchorageBuyerSuggestion != null ? 'include' : buyerDecisionDefaultForItem(item)),
    referenceOrNote: text(valueOf(item, ['referenceOrNote', 'reference_or_note', 'reviewNote', 'review_note'])),
    evidenceDocumentIds: Array.isArray(item.evidenceDocumentIds || item.evidence_document_ids)
      ? (item.evidenceDocumentIds || item.evidence_document_ids).map(String)
      : [],
  };
}

function initialExtraDraft(item) {
  const pricingType = item.fixed === true || item.Fixed__c === true || valueOf(item, ['pricingType', 'pricing_type']) === 'fixed' || valueOf(item, ['fixedCost', 'fixed_cost', 'fixedPrice', 'fixed_price'], null) != null ? 'fixed' : 'per_unit';
  const lightDues = item?.hongKongVariableCharges === true && text(valueOf(item, ['productName'])).toUpperCase() === 'LIGHT DUES';
  const portClearance = isPortClearanceItem(item);
  const statutoryDefault = statutorySupplierHkdDefault(item);
  const storedBuyerPrice = buyerPriceWithAnchorageDefault(item, pricingType);
  const anchorageBuyerDefault = item?.anchorageVerification?.buyerDefault;
  const anchorageBuyerSuggestion = anchorageBuyerDefault?.available === true
    && anchorageBuyerDefault?.applyCalculatedDefault === true
    ? finiteNumber(anchorageBuyerDefault.amountUsd)
    : null;
  return {
    description: text(valueOf(item, ['description', 'Description__c', 'name', 'Name'])),
    paymentTerm: text(valueOf(item, ['paymentTerm', 'payment_term', 'Payment_Term__c'])),
    pricingType,
    inputCurrency: text(valueOf(item, ['supplierCurrency.requiredInputCurrency']))
      || (statutoryDefault ? 'HKD' : text(valueOf(item, ['supplierCurrency.inputCurrency'])) || 'USD'),
    requiredInputCurrency: text(valueOf(item, ['supplierCurrency.requiredInputCurrency'])),
    supplierCost: statutoryDefault?.amountHkd ?? valueOf(item, ['supplierCurrency.inputAmount'], null) ?? (pricingType === 'fixed'
      ? valueOf(item, ['fixedCost', 'fixed_cost', 'Lumpsum_Cost__c'], '')
      : valueOf(item, ['cost', 'unitCost', 'unit_cost', 'Unit_Cost__c'], '')),
    buyerPrice: anchorageBuyerSuggestion ?? (lightDues && finiteNumber(storedBuyerPrice) == null ? 0 : storedBuyerPrice),
    quantity: portClearance
      ? portClearanceApplicationCount(valueOf(item, ['quantity', 'Quantity__c'], null))
      : valueOf(item, ['quantity', 'Quantity__c'], ''),
    unitOfMeasure: text(valueOf(item, ['unitOfMeasure', 'unit_of_measure', 'Unit_of_Measure__c'], '1.')),
    cancelled: item.cancelled === true || item.Cancelled__c === true,
    statutorySupplierDefaultPending: Boolean(statutoryDefault),
    statutoryBuyerDefaultPending: anchorageBuyerSuggestion > 0,
  };
}

function initialAddDraft(caseRow, supplierId = '', companyRate = null) {
  const supplierAccounts = Array.isArray(caseRow?.supplierAccounts) ? caseRow.supplierAccounts : [];
  const selectedSupplierId = supplierId || (supplierAccounts.length === 1 ? supplierAccounts[0].id : '');
  const supplierAccount = supplierAccounts.find((row) => text(row.id) === text(selectedSupplierId));
  const requiredInputCurrency = supplierAccount?.isAgent === true
    ? text(supplierAccount.agencyFeeCurrency).toUpperCase()
    : '';
  return {
    localId: operationId('extra'),
    productId: '',
    description: 'STEM Charge',
    paymentTerm: text(valueOf(caseRow, ['supplierPaymentTerm', 'supplier_payment_term', 'paymentTerm', 'payment_term'])),
    pricingType: 'fixed',
    inputCurrency: requiredInputCurrency || 'USD',
    requiredInputCurrency,
    companyRate,
    supplierAccountId: selectedSupplierId,
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
  const [gmDraft, setGmDraft] = useState({ sides: 'both', reason: '' });
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
  const [amendDialog, setAmendDialog] = useState({ open: false, sides: [], label: '', reason: '' });
  const [amendSaving, setAmendSaving] = useState(false);
  const [anchorageDrafts, setAnchorageDrafts] = useState({});
  const [anchorageSaving, setAnchorageSaving] = useState(false);
  const [vesselNrtDraft, setVesselNrtDraft] = useState('');
  const [vesselNrtSaving, setVesselNrtSaving] = useState(false);
  const [lightDuesSaving, setLightDuesSaving] = useState(false);
  const [gmReviewSides, setGmReviewSides] = useState([]);
  const [gmReviewSupplierId, setGmReviewSupplierId] = useState('');
  const [rateSettingsOpen, setRateSettingsOpen] = useState(false);
  const [rateSettingsDraft, setRateSettingsDraft] = useState({ usdHkdRate: '7.84', expectedRevision: 1, reason: '' });
  const [rateSettingsSaving, setRateSettingsSaving] = useState(false);

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
    const rawDetail = response.data || {};
    const hongKongVariableCharges = rawDetail.case?.hongKongVariableCharges === true
      || rawDetail.hongKongVariableCharges === true;
    const reviewStatusBySupplier = new Map((rawDetail.case?.supplierRequirements || []).map((requirement) => [
      text(requirement.supplierId),
      {
        costReviewApproved: requirement.sides?.cost?.status === 'verified' || requirement.status === 'Verified',
        buyerReviewApproved: requirement.sides?.buyerCharge?.status === 'verified' || requirement.buyerChargeStatus === 'Verified',
      },
    ]));
    const withReviewStatus = (item) => ({
      ...item,
      ...(reviewStatusBySupplier.get(text(valueOf(item, ['supplierId', 'supplier_id', 'Supplier__c', 'Original_Supplier__c']))) || {}),
    });
    const nextDetail = {
      ...rawDetail,
      lineItems: (rawDetail.lineItems || []).map((item) => ({ ...withReviewStatus(item), hongKongVariableCharges })),
      extraCosts: (rawDetail.extraCosts || []).map((item) => ({
        ...withReviewStatus(item),
        hongKongVariableCharges,
        anchorageVerification: rawDetail.anchorage?.rows?.find((row) => row.extraCostId === item.id) || null,
        lightDuesVerification: rawDetail.lightDues?.rows?.find((row) => row.extraCostId === item.id) || null,
      })),
    };
    const rows = normalizeReviewRows(nextDetail.lineItems, nextDetail.extraCosts);
    setDetail(nextDetail);
    setReviews(Object.fromEntries(rows.map((row) => [row.key, initialReview(row)])));
    setExtraDrafts(Object.fromEntries((nextDetail.extraCosts || []).map((item, index) => {
      const id = rowId(item, 'extra', index);
      return [id, initialExtraDraft(item)];
    })));
    setAnchorageDrafts(Object.fromEntries((nextDetail.anchorage?.rows || []).map((row) => [row.extraCostId, {
      arrival: row.arrival || '',
      departure: row.departure || '',
      location: row.location || ANCHORAGE_LOCATION_ELSEWHERE,
      allocationHkd: row.allocationHkd ?? '',
      expectedLastModifiedDate: row.lastModifiedDate || '',
    }])));
    setVesselNrtDraft(nextDetail.vessel?.nrt == null ? '' : String(nextDetail.vessel.nrt));
    if (nextDetail.variableChargeSettings) setRateSettingsDraft({
      usdHkdRate: String(nextDetail.variableChargeSettings.usdHkdRate ?? 7.84),
      expectedRevision: Number(nextDetail.variableChargeSettings.revision || 1),
      reason: '',
    });
    setAddDrafts([]);
    setGmDraft({ sides: 'both', reason: '' });
    setGmReviewSides([]);
    setGmReviewSupplierId('');
    setAmendDialog({ open: false, sides: [], label: '', reason: '' });
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
    if (saving || supplierSavingId || gmSaving || postSaving || amendSaving) return;
    setSelectedStemId('');
    setDetail(null);
    setDetailError('');
    setSaveError('');
    setGmOpen(false);
    setAmendDialog({ open: false, sides: [], label: '', reason: '' });
    openedInitialStemId.current = '';
    onTaskClose?.();
    requestAnimationFrame(() => {
      const snapshot = returnScrollRef.current;
      if (snapshot.element) snapshot.element.scrollTop = snapshot.top;
      returnFocusRef.current?.focus?.({ preventScroll: true });
    });
  };

  const effectiveCapabilities = { ...capabilities, ...(detail?.capabilities || {}) };
  const activeCase = detail?.case
    ? { ...detail.case, variableChargeSettings: detail.variableChargeSettings || null }
    : {};
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
  const gmReviewAppliesToActiveSupplier = gmReviewSupplierId === activeSupplierId && text(gmActionReason).length >= 5;
  const canCostSideEdit = activeCostSide?.permissions?.canEdit === true || (activeCostSide?.permissions?.canGmOverride === true && gmReviewAppliesToActiveSupplier && gmReviewSides.includes('cost'));
  const canBuyerSideEdit = activeBuyerSide?.permissions?.canEdit === true || (activeBuyerSide?.permissions?.canGmOverride === true && gmReviewAppliesToActiveSupplier && gmReviewSides.includes('buyer_charge'));
  const allSuppliersVerified = supplierRequirements.length > 0 && supplierRequirements.every((row) => row.status === 'Verified');
  const canBuyerConfirm = allSuppliersVerified && (effectiveCapabilities.canBuyerConfirm === true || canEditNormally || (canGmOverride && text(gmActionReason).length >= 5));
  const canResolvePostInvoice = effectiveCapabilities.canResolvePostInvoice === true
    || effectiveCapabilities.canPostInvoiceResolve === true
    || activeCase.canResolvePostInvoice === true;
  const reviewRows = useMemo(() => normalizeReviewRows(detail?.lineItems, detail?.extraCosts), [detail]);
  const products = Array.isArray(detail?.products) ? detail.products : [];
  const salesforceFiles = Array.isArray(detail?.salesforceFiles) ? detail.salesforceFiles : [];
  const supplierAccounts = Array.isArray(activeCase.supplierAccounts) ? activeCase.supplierAccounts : [];
  const activeSupplierAccount = supplierAccounts.find((row) => text(row.id) === activeSupplierId) || null;
  const supplierPaymentTerm = text(valueOf(activeSupplierAccount, ['paymentTerm', 'payment_term'])) || 'Not set';
  const buyerPaymentTerm = text(valueOf(activeCase, ['buyerPaymentTerm', 'buyer_payment_term', 'paymentTerm', 'payment_term'])) || 'Not set';
  const stemCurrency = text(valueOf(activeCase, ['currency', 'currencyIsoCode', 'CurrencyIsoCode'])) || 'USD';

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
      if (!['correct', 'changed', 'cancelled'].includes(review.outcome)) { setSaveError(`Mark ${itemLabel(row)} as Correct or Edit Cost.`); return; }
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
      const matchingRow = stageRows.find((row) => row.sourceId === id);
      const forceManagedPortReview = isPortClearanceItem(item) && reviews[matchingRow?.key]?.outcome === 'changed';
      if (forceManagedPortReview || draft.statutorySupplierDefaultPending === true || changeKey({ ...draft, cancelled: false }) !== changeKey({ ...original, cancelled: false })) {
        extraCostUpdates.push({
          extraCostId: id, expectedLastModifiedDate, description: draft.description,
          pricingType: draft.pricingType, supplierCost: Number(draft.supplierCost), inputCurrency: draft.inputCurrency || 'USD', expectedFxSettingsRevision: Number(detail?.variableChargeSettings?.revision),
          quantity: draft.pricingType === 'per_unit' ? Number(draft.quantity) : null,
          unitOfMeasure: draft.unitOfMeasure,
        });
      }
    });
    const supplierAdds = addDrafts.filter((draft) => text(draft.supplierAccountId) === supplierId);
    const extraCostAdds = supplierAdds.map((draft) => ({
      productId: draft.productId, description: draft.description, supplierAccountId: supplierId,
      pricingType: draft.pricingType, supplierCost: Number(draft.supplierCost), inputCurrency: draft.inputCurrency || 'USD', expectedFxSettingsRevision: Number(detail?.variableChargeSettings?.revision),
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

  const reopenPairedSides = async () => {
    const supplierId = text(activeSupplierStage?.supplierId);
    const sides = Array.isArray(amendDialog.sides) ? amendDialog.sides : [];
    const reason = text(amendDialog.reason);
    if (!supplierId || !sides.length || amendSaving) return;
    if (reason.length < 5) {
      setSaveError('Enter an amendment reason of at least 5 characters.');
      return;
    }
    setAmendSaving(true);
    setSaveError('');
    const response = await appClient.functions.invoke('variableChargesSideReopen', {
      stemId: selectedStemId,
      supplierId,
      sides,
      expectedStemLastModifiedAt: valueOf(activeCase, ['salesforceStemLastModifiedAt', 'salesforce_stem_last_modified_at'], null),
      expectedRevisions: Object.fromEntries(sides.map((side) => [side, Number(side === 'cost' ? activeCostSide?.revision : activeBuyerSide?.revision)])),
      operationId: operationId('variable_charge_side_reopen'),
      reason,
    }, { force: true });
    if (response.data?.error) setSaveError(response.data.error);
    else {
      setAmendDialog({ open: false, sides: [], label: '', reason: '' });
      await Promise.all([loadDetail(selectedStemId, { force: true }), loadCases()]);
    }
    setAmendSaving(false);
  };

  const confirmPairedSides = async (requirement, sides) => {
    const supplierId = text(requirement?.supplierId);
    if (!supplierId || supplierSavingId || saving) return;
    const stageRows = reviewRows.filter((row) => rowSupplierId(row) === supplierId);
    const costSelected = sides.includes('cost');
    const buyerSelected = sides.includes('buyer_charge');
    const costNote = text(supplierReviewNotes[supplierId]);
    const buyerNote = text(buyerReviewNotes[supplierId]);
    if (costSelected && !costNote) { setSaveError('Add the Supplier Leg Review Note before approval.'); return; }
    if (buyerSelected && !buyerNote) { setSaveError('Add the Buyer Leg Review Note before approval.'); return; }
    for (const row of stageRows) {
      const review = reviews[row.key] || {};
      if (costSelected && !['correct', 'changed', 'cancelled'].includes(review.outcome)) { setSaveError(`${itemLabel(row)} is Pending on the Supplier Leg.`); return; }
      if (costSelected && row.readOnly && review.outcome !== 'correct') { setSaveError(`${itemLabel(row)} is read-only. Correct it in Salesforce, then refresh.`); return; }
      if (costSelected && row.sourceType === 'extra_cost' && review.outcome === 'changed') {
        const original = initialExtraDraft(row.item);
        const draft = extraDrafts[row.sourceId] || original;
        const changed = isPortClearanceItem(row.item) || changeKey({ description: draft.description, pricingType: draft.pricingType, supplierCost: draft.supplierCost, inputCurrency: draft.inputCurrency, quantity: draft.quantity, unitOfMeasure: draft.unitOfMeasure })
          !== changeKey({ description: original.description, pricingType: original.pricingType, supplierCost: original.supplierCost, inputCurrency: original.inputCurrency, quantity: original.quantity, unitOfMeasure: original.unitOfMeasure });
        if (!changed) { setSaveError(`Make the intended cost change for ${itemLabel(row)}, or mark it Correct.`); return; }
        if (!text(draft.description) || finiteNumber(draft.supplierCost) == null || (draft.pricingType === 'per_unit' && (!(finiteNumber(draft.quantity) > 0) || !text(draft.unitOfMeasure)))) {
          setSaveError(`Complete the cost details for ${itemLabel(row)}.`); return;
        }
      }
      if (buyerSelected && !['include', 'exclude'].includes(review.buyerChargeDecision)) { setSaveError(`${itemLabel(row)} is Pending on the Buyer Leg.`); return; }
      if (buyerSelected && row.sourceType === 'extra_cost' && review.buyerChargeDecision === 'include'
        && (isHongKongAnchorageDuesItem(row.item)
          ? !(finiteNumber((extraDrafts[row.sourceId] || initialExtraDraft(row.item)).buyerPrice) > 0)
          : finiteNumber((extraDrafts[row.sourceId] || initialExtraDraft(row.item)).buyerPrice) == null)) {
        setSaveError(isHongKongAnchorageDuesItem(row.item)
          ? 'Enter a positive Anchorage Dues buyer charge when the reviewed supplier charge was incurred.'
          : `Enter the Buyer price for ${itemLabel(row)}.`); return;
      }
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
      const row = stageRows.find((candidate) => candidate.sourceId === id);
      const supplierOutcome = reviews[row?.key]?.outcome;
      if (costSelected && supplierOutcome === 'cancelled' && draft.cancelled && !original.cancelled) {
        cancellations.push({ extraCostId: id, expectedLastModifiedDate });
      } else if (costSelected && ['correct', 'changed'].includes(supplierOutcome)
        && (draft.statutorySupplierDefaultPending === true
          || (supplierOutcome === 'changed' && (isPortClearanceItem(item)
            || changeKey({ description: draft.description, pricingType: draft.pricingType, supplierCost: draft.supplierCost, inputCurrency: draft.inputCurrency, quantity: draft.quantity, unitOfMeasure: draft.unitOfMeasure }) !== changeKey({ description: original.description, pricingType: original.pricingType, supplierCost: original.supplierCost, inputCurrency: original.inputCurrency, quantity: original.quantity, unitOfMeasure: original.unitOfMeasure }))))) {
        costUpdates.push({ extraCostId: id, expectedLastModifiedDate, description: draft.description, pricingType: draft.pricingType, supplierCost: Number(draft.supplierCost), inputCurrency: draft.inputCurrency || 'USD', expectedFxSettingsRevision: Number(detail?.variableChargeSettings?.revision), quantity: draft.pricingType === 'per_unit' ? Number(draft.quantity) : null, unitOfMeasure: draft.unitOfMeasure });
      }
      if (buyerSelected && reviews[row?.key]?.buyerChargeDecision === 'include'
        && (draft.statutoryBuyerDefaultPending === true || String(draft.buyerPrice ?? '') !== String(original.buyerPrice ?? ''))) {
        buyerUpdates.push({ extraCostId: id, expectedLastModifiedDate, pricingType: draft.pricingType, buyerPrice: Number(draft.buyerPrice) });
      }
    });
    const supplierAdds = costSelected ? addDrafts.filter((draft) => text(draft.supplierAccountId) === supplierId) : [];
    if (supplierAdds.some((draft) => !text(draft.productId) || !text(draft.description) || !(Number(draft.supplierCost) >= 0) || (draft.pricingType === 'per_unit' && !(Number(draft.quantity) > 0)))) {
      setSaveError('Complete every new supplier charge before confirmation.');
      return;
    }
    if (buyerSelected && supplierAdds.some((draft) => !['include', 'exclude'].includes(draft.buyerChargeDecision) || (draft.buyerChargeDecision === 'include' && !(Number(draft.buyerPrice) >= 0)))) {
      setSaveError('Resolve every new Buyer Leg charge and enter its price before approval.');
      return;
    }
    const additions = supplierAdds.map((draft) => ({
      reviewLocalId: draft.localId, productId: draft.productId, description: draft.description,
      supplierAccountId: supplierId, pricingType: draft.pricingType,
      supplierCost: Number(draft.supplierCost), inputCurrency: draft.inputCurrency || 'USD', expectedFxSettingsRevision: Number(detail?.variableChargeSettings?.revision), buyerPrice: draft.buyerChargeDecision === 'include' ? Number(draft.buyerPrice) : null,
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
    const sides = gmDraft.sides === 'cost' ? ['cost'] : gmDraft.sides === 'buyer_charge' ? ['buyer_charge'] : ['cost', 'buyer_charge'];
    const openSides = sides.filter((side) => side === 'cost' ? activeCostSide?.status !== 'verified' : activeBuyerSide?.status !== 'verified');
    if (!canGmOverride || reason.length < 5 || !openSides.length) {
      setSaveError(!openSides.length ? 'The selected leg is already approved.' : 'Enter a specific General Manager review reason (at least 5 characters).');
      return;
    }
    setGmSaving(true);
    setSaveError('');
    setGmReviewSides(openSides);
    setGmReviewSupplierId(activeSupplierId);
    setGmActionReason(reason);
    setGmSaving(false);
    setGmOpen(false);
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

  const saveAnchorageDetails = async () => {
    if (!detail?.anchorage || anchorageSaving) return;
    setAnchorageSaving(true);
    setSaveError('');
    const response = await appClient.functions.invoke('variableChargesAnchorageSave', {
      stemId: selectedStemId,
      rows: detail.anchorage.rows.map((row) => ({
        extraCostId: row.extraCostId,
        ...anchorageDrafts[row.extraCostId],
      })),
    }, { force: true });
    if (response.data?.error) setSaveError(response.data.error);
    else await Promise.all([loadDetail(selectedStemId, { force: true }), loadCases()]);
    setAnchorageSaving(false);
  };

  const saveVesselNrt = async () => {
    if (vesselNrtSaving) return;
    setVesselNrtSaving(true);
    setSaveError('');
    const response = await appClient.functions.invoke('variableChargesVesselNrtSave', {
      stemId: selectedStemId,
      nrt: Number(vesselNrtDraft),
      expectedLastModifiedDate: detail?.vessel?.lastModifiedDate,
    }, { force: true });
    if (response.data?.error) setSaveError(response.data.error);
    else await Promise.all([loadDetail(selectedStemId, { force: true }), loadCases()]);
    setVesselNrtSaving(false);
  };

  const saveLightDues = async () => {
    if (!detail?.lightDues || lightDuesSaving) return;
    setLightDuesSaving(true);
    setSaveError('');
    const response = await appClient.functions.invoke('variableChargesLightDuesSave', {
      stemId: selectedStemId,
      rows: detail.lightDues.rows.map((row) => ({
        extraCostId: row.extraCostId,
        expectedLastModifiedDate: row.lastModifiedDate || '',
      })),
    }, { force: true });
    if (response.data?.error) setSaveError(response.data.error);
    else await Promise.all([loadDetail(selectedStemId, { force: true }), loadCases()]);
    setLightDuesSaving(false);
  };

  const saveRateSettings = async () => {
    setRateSettingsSaving(true);
    setSaveError('');
    const response = await appClient.functions.invoke('variableChargesSettingsSave', rateSettingsDraft, { force: true });
    if (response.data?.error) setSaveError(response.data.error);
    else {
      setRateSettingsOpen(false);
      await loadDetail(selectedStemId, { force: true });
    }
    setRateSettingsSaving(false);
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
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <h1 className="truncate text-xl font-semibold text-foreground">{caseStemName(activeCase)}</h1>
        </div>
        <div className="flex items-center gap-2">
          {detail && <Badge variant="outline" className={viewTone(valueOf(activeCase, ['status']))}>{caseStatus(activeCase)}</Badge>}
          <Button type="button" variant="outline" size="sm" onClick={() => loadDetail(selectedStemId, { force: true })} disabled={detailLoading || saving || Boolean(supplierSavingId)}>
            <RefreshCw className={cn('mr-2 h-4 w-4', detailLoading && 'animate-spin')} /> Refresh
          </Button>
        </div>
      </div>

      {detailLoading ? <VariableChargeReviewSkeleton /> : detailError ? (
        <StateBlock icon={AlertTriangle} title="Unable to load this task" description={detailError} action={<Button variant="outline" onClick={() => loadDetail(selectedStemId, { force: true })}>Try again</Button>} />
      ) : detail ? (
        <div className="space-y-5">
          {pairedWorkflow ? <CommonReviewSummary caseRow={activeCase} /> : <><GuidedProgress currentStep={currentStep} progress={workflow.progress} /><SimpleCaseSummary caseRow={activeCase} onOpenStem={onOpenStem} /></>}
          {(detail.vessel?.canSaveNrt || detail.anchorage || detail.lightDues) && <HongKongStatutoryChargesPanel vessel={detail.vessel} nrtDraft={vesselNrtDraft} onNrtChange={setVesselNrtDraft} nrtSaving={vesselNrtSaving} onSaveNrt={saveVesselNrt} anchorage={detail.anchorage} anchorageDrafts={anchorageDrafts} anchorageSaving={anchorageSaving} onAnchorageChange={(id, patch) => setAnchorageDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }))} onSaveAnchorage={saveAnchorageDetails} lightDues={detail.lightDues} lightDuesSaving={lightDuesSaving} onSaveLightDues={saveLightDues} canEdit={canCostSideEdit || canBuyerSideEdit || detail.variableChargeSettings?.canSave === true} canEditRate={detail.variableChargeSettings?.canSave === true} onEditRate={() => setRateSettingsOpen(true)} />}
          {pairedWorkflow && canGmOverride && (activeCostSide?.status !== 'verified' || activeBuyerSide?.status !== 'verified') && <div className="flex flex-wrap justify-end gap-2">{activeCostSide?.status !== 'verified' && <Button type="button" size="sm" variant="outline" onClick={() => { setGmDraft({ sides: 'cost', reason: '' }); setGmOpen(true); }}><ShieldCheck className="mr-2 h-4 w-4" />Review Supplier Leg as GM</Button>}{activeBuyerSide?.status !== 'verified' && <Button type="button" size="sm" variant="outline" onClick={() => { setGmDraft({ sides: 'buyer_charge', reason: '' }); setGmOpen(true); }}><ShieldCheck className="mr-2 h-4 w-4" />Review Buyer Leg as GM</Button>}</div>}
          {pairedWorkflow && detail.supplierDualCurrencySummary && (() => {
            const total = detail.supplierDualCurrencySummary.bySupplier?.find((row) => text(row.supplierId) === activeSupplierId) || detail.supplierDualCurrencySummary;
            const agencyFeeCurrency = text(valueOf(activeSupplierAccount, ['agencyFeeCurrency'])).toUpperCase() || 'USD';
            const totalText = !total.complete
              ? 'Unavailable'
              : agencyFeeCurrency === 'HKD'
                ? `${formatMoney(total.hkd, 'HKD')} (about ${formatMoney(total.usd, 'USD')})`
                : `${formatMoney(total.usd, 'USD')} (${formatMoney(total.hkd, 'HKD')})`;
            return <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm"><span className="font-medium">Selected Supplier Total</span><span className="font-semibold tabular-nums">{totalText}</span><span className="text-xs text-muted-foreground">{total.rateLabel}</span></div>;
          })()}
          {saveError && <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{saveError}</div>}

          {valueOf(activeCase, ['status']) === 'post_invoice_changes' && (
            <PostInvoiceResolution value={postResolution} disabled={!canResolvePostInvoice} saving={postSaving} onChange={(patch) => setPostResolution((current) => ({ ...current, ...patch }))} onSave={savePostInvoiceResolution} />
          )}

          {pairedWorkflow ? (
            <PairedReviewWorkspace
              caseRow={activeCase}
              requirement={activeSupplierStage}
              requirements={supplierRequirements}
              activeSupplierId={activeSupplierId}
              onSupplierChange={setActiveSupplierId}
              rows={activeSupplierRows}
              allRows={reviewRows}
              reviews={reviews}
              extraDrafts={extraDrafts}
              addDrafts={addDrafts.filter((draft) => text(draft.supplierAccountId) === activeSupplierId)}
              products={products}
              files={salesforceFiles}
              financials={financials}
              currency={stemCurrency}
              supplierPaymentTerm={supplierPaymentTerm}
              buyerPaymentTerm={buyerPaymentTerm}
              canCostEdit={canCostSideEdit}
              canBuyerEdit={canBuyerSideEdit}
              reviewingBothAsGeneralManager={gmReviewAppliesToActiveSupplier && gmReviewSides.includes('cost') && gmReviewSides.includes('buyer_charge')}
              canGmOverride={canGmOverride}
              saving={saving}
              supplierSaving={Boolean(supplierSavingId)}
              assignmentSaving={Boolean(sideAssignmentSaving)}
              supplierNote={supplierReviewNotes[activeSupplierId] || ''}
              buyerNote={buyerReviewNotes[activeSupplierId] || ''}
              salesforceInstanceUrl={detail.salesforceInstanceUrl}
              anchorage={null}
              anchorageDrafts={anchorageDrafts}
              anchorageSaving={anchorageSaving}
              canSaveAnchorage={canCostSideEdit || canBuyerSideEdit || detail.variableChargeSettings?.canSave === true}
              onAnchorageChange={(id, patch) => setAnchorageDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }))}
              onSaveAnchorage={saveAnchorageDetails}
              canEditAnchorageRate={detail.variableChargeSettings?.canSave === true}
              onEditAnchorageRate={() => setRateSettingsOpen(true)}
              onReviewChange={updateReview}
              onDraftChange={updateExtraDraft}
              onAddDraftChange={updateAddDraft}
              onAdd={() => setAddDrafts((current) => [...current, initialAddDraft(activeCase, activeSupplierId, detail?.variableChargeSettings?.usdHkdRate)])}
              onRemoveAdd={(localId) => setAddDrafts((current) => current.filter((row) => row.localId !== localId))}
              onSupplierNote={(value) => setSupplierReviewNotes((current) => ({ ...current, [activeSupplierId]: value }))}
              onBuyerNote={(value) => setBuyerReviewNotes((current) => ({ ...current, [activeSupplierId]: value }))}
              onToggleEvidence={(fileId) => activeSupplierRows.forEach((row) => toggleEvidence(row.key, fileId))}
              onAssign={(sides, target) => assignPairedSides(activeSupplierStage, sides, target)}
              onAmend={(sides, label) => setAmendDialog({ open: true, sides, label, reason: '' })}
              amendSaving={amendSaving}
              onApprove={(sides) => confirmPairedSides(activeSupplierStage, sides)}
            />
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

          <AuditDetails caseRow={activeCase} assignmentHistory={detail.assignmentHistory || []} assignmentHistoryUnavailable={detail.assignmentHistoryUnavailable === true} />
        </div>
      ) : null}

      <Dialog open={gmOpen} onOpenChange={setGmOpen}>
        <DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Review as General Manager</DialogTitle><DialogDescription>Assignments stay unchanged. Your reason is recorded when you approve the selected leg.</DialogDescription></DialogHeader><div className="space-y-4"><div className="space-y-2"><Label>Review</Label><Select value={gmDraft.sides} onValueChange={(sides) => setGmDraft((current) => ({ ...current, sides }))} disabled={gmSaving}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cost" disabled={activeCostSide?.status === 'verified'}>Supplier Leg</SelectItem><SelectItem value="buyer_charge" disabled={activeBuyerSide?.status === 'verified'}>Buyer Leg</SelectItem><SelectItem value="both" disabled={activeCostSide?.status === 'verified' || activeBuyerSide?.status === 'verified'}>Both legs</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label htmlFor="variable-charge-gm-reason">Reason</Label><Textarea id="variable-charge-gm-reason" value={gmDraft.reason} onChange={(event) => setGmDraft((current) => ({ ...current, reason: event.target.value }))} disabled={gmSaving} /></div></div><DialogFooter><Button type="button" variant="outline" onClick={() => setGmOpen(false)} disabled={gmSaving}>Cancel</Button><Button type="button" onClick={saveGmOverride} disabled={gmSaving || text(gmDraft.reason).length < 5}>{gmSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Start Review</Button></DialogFooter></DialogContent>
      </Dialog>
      <Dialog open={rateSettingsOpen} onOpenChange={setRateSettingsOpen}>
        <DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Company USD/HKD rate</DialogTitle><DialogDescription>Used for Hong Kong statutory-charge verification and Supplier Leg currency conversions.</DialogDescription></DialogHeader><div className="space-y-4"><div className="space-y-2"><Label htmlFor="anchorage-usd-hkd-rate">USD 1 = HKD</Label><Input id="anchorage-usd-hkd-rate" inputMode="decimal" value={rateSettingsDraft.usdHkdRate} onChange={(event) => setRateSettingsDraft((current) => ({ ...current, usdHkdRate: event.target.value }))} disabled={rateSettingsSaving} /></div><div className="space-y-2"><Label htmlFor="anchorage-rate-reason">Reason</Label><Textarea id="anchorage-rate-reason" value={rateSettingsDraft.reason} onChange={(event) => setRateSettingsDraft((current) => ({ ...current, reason: event.target.value }))} disabled={rateSettingsSaving} /></div></div><DialogFooter><Button type="button" variant="outline" onClick={() => setRateSettingsOpen(false)} disabled={rateSettingsSaving}>Cancel</Button><Button type="button" onClick={saveRateSettings} disabled={rateSettingsSaving}>{rateSettingsSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save rate</Button></DialogFooter></DialogContent>
      </Dialog>
      <Dialog open={amendDialog.open} onOpenChange={(open) => !amendSaving && setAmendDialog((current) => ({ ...current, open }))}>
        <DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>{amendDialog.label || 'Amend approved charges'}</DialogTitle><DialogDescription>The approved leg will return to Needs Review. Make the changes, then approve it again before creating the related invoice.</DialogDescription></DialogHeader><div className="space-y-2"><Label htmlFor="variable-charge-amend-reason">Amendment reason</Label><Textarea id="variable-charge-amend-reason" value={amendDialog.reason} onChange={(event) => setAmendDialog((current) => ({ ...current, reason: event.target.value.slice(0, 1000) }))} disabled={amendSaving} autoFocus /></div><DialogFooter><Button type="button" variant="outline" onClick={() => setAmendDialog({ open: false, sides: [], label: '', reason: '' })} disabled={amendSaving}>Cancel</Button><Button type="button" onClick={reopenPairedSides} disabled={amendSaving || text(amendDialog.reason).length < 5}>{amendSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Continue to Amend</Button></DialogFooter></DialogContent>
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
        <div className="flex items-center gap-2 self-start">
          <Button type="button" variant="outline" className="gap-2" onClick={() => loadCases({ force: true })} disabled={refreshing || loading}>
            <RefreshCw className={cn('h-4 w-4', (refreshing || loading) && 'animate-spin')} /> Refresh Salesforce
          </Button>
        </div>
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
  const productName = text(valueOf(row.item, ['productName']));
  return productName.toUpperCase() === 'PORT CLEARANCE FEE'
    ? 'PORT CLEARANCE EXTENSION'
    : productName || 'Product name unavailable';
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

function VariableChargeReviewSkeleton() {
  return <div className="space-y-4" aria-label="Loading Variable Charges review"><Skeleton className="h-28 w-full rounded-xl" /><Skeleton className="h-16 w-full rounded-xl" /><div className="min-w-0 overflow-hidden rounded-xl border border-border"><div className="grid min-w-[960px] grid-cols-2"><Skeleton className="h-40 rounded-none border-r border-border" /><Skeleton className="h-40 rounded-none" /></div>{[0, 1, 2].map((row) => <div key={row} className="grid min-w-[960px] grid-cols-2 border-t border-border"><Skeleton className="h-44 rounded-none border-r border-border" /><Skeleton className="h-44 rounded-none" /></div>)}</div></div>;
}

function CommonReviewSummary({ caseRow }) {
  const deliveryDate = valueOf(caseRow, ['deliveryDate', 'delivery_date']);
  const cost = caseRow.sideProgress?.supplierCosts || {};
  const buyer = caseRow.sideProgress?.buyerCharges || {};
  const buyerInvoiceReady = caseRow.invoiceReadiness?.buyer?.ready === true;
  const methodology = PAYMENT_COLLECTIONS_METHODOLOGIES['variable-charges'];
  return <section className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">{caseRow?.hongKongVariableCharges === true ? <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">Hong Kong charge rules</Badge> : null}<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><SummaryField label="Vessel">{valueOf(caseRow, ['vesselName'], 'Not set') || 'Not set'}</SummaryField><SummaryField label="Port">{valueOf(caseRow, ['portName'], 'Not set') || 'Not set'}</SummaryField><SummaryField label={<span className="inline-flex items-center gap-1.5">{deliveryDate ? 'Delivery Date' : 'Review Starts'}<PageMethodology {...methodology} triggerIcon={Info} iconOnly triggerLabel="Review timing" className="h-6 w-6 rounded-full border-0 bg-transparent p-0 shadow-none" /></span>}>{formatDate(deliveryDate || valueOf(caseRow, ['actionableOn'])) === '—' ? 'Not set' : formatDate(deliveryDate || valueOf(caseRow, ['actionableOn']))}</SummaryField><SummaryField label="Next Action">{valueOf(caseRow, ['nextAction', 'workflow.nextAction'], 'Not set') || 'Not set'}</SummaryField></div><div className="border-t border-border pt-3 text-sm font-medium text-foreground"><span>Supplier Costs {Number(cost.confirmed || 0)}/{Number(cost.required || 0)}</span><span className="mx-2 text-muted-foreground">·</span><span>Buyer Charges {Number(buyer.confirmed || 0)}/{Number(buyer.required || 0)}</span><span className="mx-2 text-muted-foreground">·</span><span className={buyerInvoiceReady ? 'text-emerald-700' : 'text-slate-600'}>{buyerInvoiceReady ? 'Buyer Invoice Ready' : 'Buyer Invoice Not Ready'}</span></div></section>;
}

function MarginAmount({ value, currency = 'USD', unavailableReason = '' }) {
  const amount = finiteNumber(value);
  if (amount == null) return <div><div className="font-semibold text-muted-foreground">Unavailable</div>{unavailableReason && <div className="mt-0.5 text-xs font-normal text-muted-foreground">{unavailableReason}</div>}</div>;
  return <div className={cn('font-semibold tabular-nums', amount > 0 ? 'text-emerald-700' : amount < 0 ? 'text-rose-700' : 'text-muted-foreground')}>{currency || 'USD'} {amount > 0 ? '+' : ''}{amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>;
}

function LegMetric({ label, children }) {
  return <div><div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-1 text-sm font-medium">{children}</div></div>;
}

function LegOptions({ side, disabled, onAssign }) {
  const canAssign = side?.permissions?.canAssignToBuyer === true;
  const canTakeBack = side?.permissions?.canTakeBack === true;
  if (!canAssign && !canTakeBack) return null;
  return <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" size="icon" variant="ghost" className="h-8 w-8" disabled={disabled} aria-label="Assignment options"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuLabel>Options</DropdownMenuLabel><DropdownMenuSeparator />{canAssign && <DropdownMenuItem onSelect={() => onAssign('buyer_trader')}>Assign to Buyer Trader</DropdownMenuItem>}{canTakeBack && <DropdownMenuItem onSelect={() => onAssign('supplier_trader')}>Take Back</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu>;
}

function LegHeader({ leg, name, nameControl = null, traderLabel, side, paymentTerm, buyer = false, editable = false, assignmentSaving, amendSaving = false, canGmOverride = false, onReviewAsGm, onAssign, onAmend }) {
  const assignee = side?.currentAssignee?.name || 'Needs assignment';
  const canEdit = editable || side?.permissions?.canEdit === true || side?.permissions?.canConfirm === true;
  return <header className={cn('sticky top-0 z-10 min-h-[168px] space-y-4 p-4', buyer ? 'bg-blue-50/95' : 'bg-slate-100/95')}><div className="flex items-start justify-between gap-3"><div className="min-w-0 flex-1"><div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{leg}</div>{nameControl || <div className="mt-1 truncate text-base font-semibold" title={name}>{name || 'Not set'}</div>}</div><div className="flex items-center gap-1">{side?.status === 'verified' && side?.permissions?.canReopen === true && <Button type="button" size="sm" variant="outline" onClick={onAmend} disabled={amendSaving}>{amendSaving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}{buyer ? 'Amend Buyer Charges' : 'Amend Supplier Costs'}</Button>}{canGmOverride && side?.status !== 'verified' && <Button type="button" size="sm" variant="outline" onClick={onReviewAsGm}><ShieldCheck className="mr-1.5 h-3.5 w-3.5" />Review as General Manager</Button>}<LegOptions side={side} disabled={assignmentSaving || amendSaving} onAssign={onAssign} /></div></div><div className="grid grid-cols-3 gap-3"><LegMetric label={traderLabel}>{assignee}</LegMetric><LegMetric label="Status"><Badge variant="outline" className={sideStatusTone(side)}>{sideStatusLabel(side)}</Badge></LegMetric><LegMetric label={buyer ? 'Buyer Payment Term' : 'Supplier Payment Term'}>{paymentTerm || 'Not set'}</LegMetric></div>{!canEdit && side?.status !== 'verified' && <div className="rounded-md border border-slate-200 bg-white/70 px-2.5 py-2 text-xs text-slate-700">View Only · Assigned to {assignee}</div>}{side?.status === 'verified' && side?.amendBlockedReason && <div className="rounded-md border border-slate-200 bg-white/70 px-2.5 py-2 text-xs text-slate-700">{side.amendBlockedReason}</div>}</header>;
}

function selectedDecisionTone(value) {
  if (value === 'correct') return 'border-emerald-800 bg-emerald-700 text-white shadow-sm hover:bg-emerald-800 hover:text-white';
  if (value === 'changed') return 'border-amber-600 bg-amber-400 text-slate-950 shadow-sm hover:bg-amber-500 hover:text-slate-950';
  if (value === 'include') return 'border-blue-800 bg-blue-700 text-white shadow-sm hover:bg-blue-800 hover:text-white';
  if (value === 'exclude') return 'border-slate-700 bg-slate-600 text-white shadow-sm hover:bg-slate-700 hover:text-white';
  return 'border-slate-800 bg-slate-700 text-white shadow-sm hover:bg-slate-800 hover:text-white';
}

function DecisionButtons({ options, selected, disabled, onChange, ariaLabel }) {
  return <div className="inline-flex max-w-full flex-wrap gap-1 rounded-lg border border-slate-300 bg-white p-1" role="group" aria-label={ariaLabel}>{options.map((option) => { const active = selected === option.value; return <Button key={option.value || 'pending'} type="button" size="sm" variant="ghost" aria-pressed={active} className={cn('h-8 border px-2.5 text-xs font-semibold', active ? selectedDecisionTone(option.value) : 'border-transparent bg-transparent text-slate-700 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-950')} disabled={disabled} onClick={() => onChange(option.value)}>{option.label}</Button>; })}</div>;
}

function ApprovedDecision({ ariaLabel }) {
  return <div className="inline-flex h-10 items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 text-xs font-semibold text-emerald-900" role="status" aria-label={ariaLabel}><CheckCircle2 className="h-4 w-4" />Approved</div>;
}

function SalesforceEditNotice({ sourceId, instanceUrl }) {
  const url = instanceUrl && sourceId ? `${String(instanceUrl).replace(/\/$/, '')}/${sourceId}` : '';
  return <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950"><div>Edit this product line in Salesforce, then Refresh.</div>{url && <a className="mt-2 inline-flex items-center gap-1 font-medium text-blue-700 hover:underline" href={url} target="_blank" rel="noreferrer">Open Salesforce <ExternalLink className="h-3.5 w-3.5" /></a>}</div>;
}

function PairedExtraCostFields({ row, draft, disabled, onChange }) {
  const id = `paired-${row.sourceId}`;
  const currencyLocked = Boolean(draft.requiredInputCurrency);
  return <div className="mt-3 space-y-3 rounded-lg border border-amber-200 bg-amber-50/40 p-3"><div className="text-xs font-semibold uppercase tracking-wide text-amber-950">Edit Charge Details</div><div className="space-y-2"><Label htmlFor={`${id}-description`}>Description</Label><Input id={`${id}-description`} value={draft.description || ''} disabled={disabled} onChange={(event) => onChange({ description: event.target.value })} /></div><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Pricing Basis</Label><Select value={draft.pricingType} disabled={disabled} onValueChange={(pricingType) => onChange({ pricingType })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="fixed">Fixed</SelectItem><SelectItem value="per_unit">Per Unit</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>{currencyLocked ? 'Agent Agreed Currency' : 'Input Currency'}</Label><Select value={draft.inputCurrency || 'USD'} disabled={disabled || currencyLocked} onValueChange={(inputCurrency) => onChange({ inputCurrency })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="HKD">HKD</SelectItem><SelectItem value="USD">USD</SelectItem></SelectContent></Select>{currencyLocked && <div className="text-xs text-amber-900">All costs for this agent use the Account’s agreed currency.</div>}</div><div className="space-y-2"><Label htmlFor={`${id}-cost`}>{draft.pricingType === 'fixed' ? 'Supplier Fixed Cost' : 'Supplier Unit Cost'} ({draft.inputCurrency || 'USD'})</Label><Input id={`${id}-cost`} inputMode="decimal" value={draft.supplierCost ?? ''} disabled={disabled} onChange={(event) => onChange({ supplierCost: event.target.value })} /></div>{draft.pricingType === 'per_unit' && <><div className="space-y-2"><Label htmlFor={`${id}-quantity`}>Quantity</Label><Input id={`${id}-quantity`} inputMode="decimal" value={draft.quantity ?? ''} disabled={disabled} onChange={(event) => onChange({ quantity: event.target.value })} /></div><div className="space-y-2"><Label htmlFor={`${id}-uom`}>UOM</Label><Input id={`${id}-uom`} value={draft.unitOfMeasure || ''} disabled={disabled} onChange={(event) => onChange({ unitOfMeasure: event.target.value })} /></div></>}</div></div>;
}

function ManagedPortClearanceFields({ row, draft, disabled, onChange }) {
  const id = `port-clearance-${row.sourceId}`;
  const count = portClearanceApplicationCount(draft.quantity);
  return <div className="mt-3 space-y-3 rounded-lg border border-amber-200 bg-amber-50/40 p-3"><div className="text-xs font-semibold uppercase tracking-wide text-amber-950">Supplier-reported applications</div><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor={`${id}-count`}>Application Count</Label><div className="flex items-center gap-2"><Button type="button" size="icon" variant="outline" className="h-9 w-9 shrink-0" disabled={disabled || count <= 1} aria-label="Decrease Port Clearance Extension applications" onClick={() => onChange({ quantity: stepPortClearanceApplicationCount(count, -1) })}><Minus className="h-4 w-4" /></Button><Input id={`${id}-count`} type="number" min="1" step="1" inputMode="numeric" value={count} disabled={disabled} onChange={(event) => onChange({ quantity: portClearanceApplicationCount(event.target.value) })} /><Button type="button" size="icon" variant="outline" className="h-9 w-9 shrink-0" disabled={disabled} aria-label="Increase Port Clearance Extension applications" onClick={() => onChange({ quantity: stepPortClearanceApplicationCount(count, 1) })}><Plus className="h-4 w-4" /></Button></div><div className="text-xs font-medium text-amber-950">{count} × HKD 58 = {formatMoney(count * 58, 'HKD')}</div></div><AmountDisplay label="Locked Rate" amount={58} currency="HKD" /></div><div className="text-xs text-amber-900">The first application is included in Basic Calling Cost. Each additional supplier-reported application is passed through to the buyer. One application is valid for 72 hours from its start; FCOS does not infer the count from vessel timings.</div></div>;
}

function LockedAgencyFeeFields({ row, instanceUrl }) {
  const supplierId = text(valueOf(row.item, ['supplierId', 'supplier_id', 'Supplier__c']));
  const url = instanceUrl && supplierId ? `${String(instanceUrl).replace(/\/$/, '')}/${supplierId}` : '';
  return <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/40 p-3 text-xs text-amber-950"><div>Agency Fee is copied from the Agreed Agency Fee and Currency on the supplier Account and cannot be changed here.</div>{url && <a className="mt-2 inline-flex items-center gap-1 font-medium text-blue-700 hover:underline" href={url} target="_blank" rel="noreferrer">Open supplier Account <ExternalLink className="h-3.5 w-3.5" /></a>}</div>;
}

function AmountDisplay({ label, amount, currency, unavailableReason }) {
  return <div><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 font-semibold tabular-nums">{amount == null ? 'Unavailable' : formatMoney(amount, currency)}</div>{amount == null && unavailableReason && <div className="mt-1 text-xs text-amber-800">{unavailableReason}</div>}</div>;
}

function hongKongDateTimeLocal(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function hongKongLocalToIso(value) {
  if (!value) return '';
  const date = new Date(`${value}:00+08:00`);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function AnchorageDuesPanel({ evidence, drafts, canEdit, saving, canEditRate, onEditRate, onChange, onSave }) {
  const rows = evidence?.rows || [];
  const calculation = calculateHongKongAnchorageDues({
    nrt: evidence?.vesselNrt,
    periods: rows.map((row) => ({ id: row.extraCostId, supplierId: row.supplierId, ...(drafts[row.extraCostId] || {}) })),
    allocations: rows.map((row) => ({ id: row.extraCostId, amountHkd: drafts[row.extraCostId]?.allocationHkd })),
  });
  const multiple = rows.length > 1;
  return (
    <section className="border-t-2 border-amber-300 bg-amber-50/35 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-amber-950">Hong Kong Anchorage Dues verification</h3>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-amber-900">
            <span>Vessel NRT <strong>{evidence.vesselNrt ?? 'Not set'}</strong></span>
            <span>USD 1 = HKD <strong>{Number(evidence.companyUsdHkdRate).toFixed(4)}</strong></span>
            <span>First 12 aggregate hours free</span>
            <span>Supplier <strong>HKD 0.015 / 0.020 per NRT-hour</strong></span>
            <span>Buyer <strong>USD 0.002 per NRT-hour</strong></span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canEditRate && <Button type="button" size="sm" variant="ghost" onClick={onEditRate}><Settings2 className="mr-2 h-4 w-4" />Edit rate</Button>}
          <Button type="button" size="sm" variant="outline" disabled={!canEdit || saving} onClick={onSave}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save anchorage details</Button>
        </div>
      </div>
      <div className="mt-4 grid gap-3">
        {rows.map((row, index) => {
          const draft = drafts[row.extraCostId] || {};
          return (
            <div key={row.extraCostId} className="grid gap-3 rounded-lg border border-amber-200 bg-white/80 p-3 md:grid-cols-4">
              {multiple && <div className="md:col-span-4 text-sm font-medium text-amber-950">{row.supplierName}</div>}
              <div className="space-y-1.5"><Label htmlFor={`anchorage-arrival-${row.extraCostId}`}>Arrival · Hong Kong time</Label><Input id={`anchorage-arrival-${row.extraCostId}`} type="datetime-local" value={hongKongDateTimeLocal(draft.arrival)} disabled={!canEdit || saving} onChange={(event) => onChange(row.extraCostId, { arrival: hongKongLocalToIso(event.target.value) })} /></div>
              <div className="space-y-1.5"><Label htmlFor={`anchorage-departure-${row.extraCostId}`}>Departure · Hong Kong time</Label><Input id={`anchorage-departure-${row.extraCostId}`} type="datetime-local" value={hongKongDateTimeLocal(draft.departure)} disabled={!canEdit || saving} onChange={(event) => onChange(row.extraCostId, { departure: hongKongLocalToIso(event.target.value) })} /></div>
              <div className="space-y-1.5"><Label>Location</Label><Select value={draft.location || ANCHORAGE_LOCATION_ELSEWHERE} disabled={!canEdit || saving} onValueChange={(location) => onChange(row.extraCostId, { location })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ANCHORAGE_LOCATION_ELSEWHERE}>{ANCHORAGE_LOCATION_ELSEWHERE_LABEL}</SelectItem><SelectItem value="Victoria Port">Victoria Port</SelectItem></SelectContent></Select></div>
              <div className="space-y-1.5"><Label htmlFor={`anchorage-allocation-${row.extraCostId}`}>{multiple ? `Agent allocation ${index + 1} (HKD)` : 'Expected dues (HKD)'}</Label><Input id={`anchorage-allocation-${row.extraCostId}`} inputMode="decimal" value={multiple ? draft.allocationHkd ?? '' : calculation.allocations?.[0]?.amountHkd ?? ''} disabled={!canEdit || saving || !multiple} onChange={(event) => onChange(row.extraCostId, { allocationHkd: event.target.value })} /></div>
              <div className="md:col-span-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-amber-100 pt-2 text-xs text-amber-950">
                {row.savedCalculationVersion && <span>Reviewed basis <strong>NRT {row.appliedNrt ?? 'Unavailable'} · USD 1 = HKD {row.appliedUsdHkdRate ?? 'Unavailable'}</strong></span>}
                <span>Supplier reviewed charge <strong>{row.supplierChargeHkd?.available ? `HKD ${Number(row.supplierChargeHkd.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : 'Unavailable'}</strong></span>
                <span>Supplier USD equivalent <strong>{row.supplierEquivalentUsd == null ? 'Unavailable' : `USD ${Number(row.supplierEquivalentUsd).toLocaleString(undefined, { minimumFractionDigits: 2 })}`}</strong></span>
                <span>Variance <strong>{row.supplierVarianceHkd == null ? 'Unavailable' : `HKD ${Number(row.supplierVarianceHkd).toLocaleString(undefined, { minimumFractionDigits: 2 })}`}</strong></span>
                <span>Buyer default <strong>{row.buyerDefault?.available ? `USD ${Number(row.buyerDefault.amountUsd).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : 'Unavailable'}</strong></span>
                {row.buyerDefault?.adjusted && <span>Buyer adjustment <strong>{row.buyerDefault.differenceUsd >= 0 ? '+' : '−'}USD {Math.abs(Number(row.buyerDefault.differenceUsd)).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong></span>}
              </div>
            </div>
          );
        })}
      </div>
      {calculation.complete ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm">
          <span>Anchorage <strong>{(calculation.totalMinutes / 60).toFixed(2)} hours</strong></span>
          <span>Chargeable <strong>{calculation.locations.map((row) => `${row.chargeableHours}h ${row.location === ANCHORAGE_LOCATION_ELSEWHERE ? ANCHORAGE_LOCATION_ELSEWHERE_LABEL : row.location} at HKD ${Number(row.rateHkdPerNrtHour).toFixed(3)}`).join(' · ') || '0 hours'}</strong></span>
          <span>Supplier statutory total <strong>HKD {calculation.statutoryAmountHkd.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong></span>
          <span>Supplier USD equivalent <strong>{evidence.companyUsdHkdRate > 0 ? `USD ${(calculation.statutoryAmountHkd / evidence.companyUsdHkdRate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Unavailable'}</strong></span>
          <span>Buyer formula <strong>{calculation.nrt.toLocaleString()} × {calculation.buyer?.chargeableHours || 0}h × USD 0.002</strong></span>
          <span>Buyer default <strong>USD {Number(calculation.buyer?.totalUsd || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong></span>
          <Badge variant="outline" className={calculation.allocationComplete ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-amber-300 bg-amber-50 text-amber-900'}>{calculation.allocationComplete ? 'Allocation matched' : `Allocation difference HKD ${calculation.allocationDifferenceHkd.toFixed(2)}`}</Badge>
        </div>
      ) : <div className="mt-4 rounded-lg border border-amber-300 bg-amber-100/60 p-3 text-sm text-amber-950">{calculation.errors?.[0] || 'Complete the anchorage evidence.'}</div>}
    </section>
  );
}

function LightDuesPanel({ evidence, canEdit, saving, onSave }) {
  const rows = evidence?.rows || [];
  return <section className="border-t-2 border-cyan-300 bg-cyan-50/35 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-cyan-950">Hong Kong Light Dues verification</h3><div className="mt-1 text-xs text-cyan-900">Entry date comes from the saved Hong Kong arrival. Vessel category is fixed as All other vessels.</div></div><Button type="button" size="sm" variant="outline" disabled={!canEdit || saving || rows.some((row) => !row.entryDate)} onClick={onSave}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save calculated Light Dues</Button></div><div className="mt-4 grid gap-3">{rows.map((row) => { const calculation = calculateHongKongLightDues({ nrt: evidence.vesselNrt, entryDate: row.entryDate, category: LIGHT_DUES_CATEGORY_ALL_OTHER }); return <div key={row.extraCostId} className="rounded-lg border border-cyan-200 bg-white/80 p-3"><div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-cyan-950"><span>Hong Kong arrival <strong>{row.arrival ? hongKongDateTimeLocal(row.arrival).replace('T', ' ') : 'Save Anchorage arrival first'}</strong></span><span>Vessel category <strong>All other vessels</strong></span><span>Calculated <strong>{calculation.complete ? formatMoney(calculation.amountHkd, 'HKD') : 'Unavailable'}</strong></span><span>USD equivalent <strong>{calculation.complete && evidence.companyUsdHkdRate > 0 ? formatMoney(calculation.amountHkd / evidence.companyUsdHkdRate, 'USD') : 'Unavailable'}</strong></span><span>Supplier charge <strong>{row.supplierChargeUsd == null ? 'Unavailable' : `${formatMoney(row.supplierChargeUsd, 'USD')} · ${formatMoney(row.supplierChargeHkd, 'HKD')}`}</strong></span><span>Variance <strong>{row.supplierVarianceHkd == null ? 'Unavailable' : formatMoney(row.supplierVarianceHkd, 'HKD')}</strong></span><span>Buyer default <strong>USD 0.00</strong></span>{row.savedCalculationVersion && <span>Reviewed basis <strong>NRT {row.appliedNrt} · HKD {row.appliedRateHkd}/100 NRT</strong></span>}</div>{!calculation.complete && <div className="mt-2 rounded-md bg-cyan-100 p-2 text-xs text-cyan-950">{calculation.errors?.[0]}</div>}</div>; })}</div></section>;
}

function HongKongStatutoryChargesPanel({ vessel, nrtDraft, onNrtChange, nrtSaving, onSaveNrt, anchorage, anchorageDrafts, anchorageSaving, onAnchorageChange, onSaveAnchorage, lightDues, lightDuesSaving, onSaveLightDues, canEdit, canEditRate, onEditRate }) {
  return <div className="overflow-x-auto rounded-xl border border-amber-300 bg-card shadow-sm"><div className="min-w-[760px]"><section className="p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Hong Kong statutory charges</h2><p className="mt-1 text-xs text-muted-foreground">Changing the Vessel record may reopen other Anchorage or Light Dues reviews using this Vessel.</p></div>{canEditRate && <Button type="button" size="sm" variant="ghost" onClick={onEditRate}><Settings2 className="mr-2 h-4 w-4" />Company USD/HKD rate</Button>}</div><div className="mt-4 flex flex-wrap items-end gap-3"><div className="w-56 space-y-1.5"><Label htmlFor="variable-charge-vessel-nrt">Vessel NRT</Label><Input id="variable-charge-vessel-nrt" inputMode="numeric" value={nrtDraft} disabled={!canEdit || nrtSaving} onChange={(event) => onNrtChange(event.target.value.replace(/[^0-9]/g, ''))} /></div><Button type="button" variant="outline" disabled={!canEdit || nrtSaving || !(Number(nrtDraft) > 0 && Number.isInteger(Number(nrtDraft)))} onClick={onSaveNrt}>{nrtSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save Vessel NRT</Button><span className="pb-2 text-xs text-muted-foreground">{vessel?.affectedReviewCount || 0} statutory review row(s) on this task may be affected.</span></div></section>{anchorage && <AnchorageDuesPanel evidence={anchorage} drafts={anchorageDrafts} canEdit={canEdit} saving={anchorageSaving} onChange={onAnchorageChange} onSave={onSaveAnchorage} />}{lightDues && <LightDuesPanel evidence={lightDues} canEdit={canEdit} saving={lightDuesSaving} onSave={onSaveLightDues} />}</div></div>;
}

function SupplierDualAmount({ label, row, draft, total = false, companyRate }) {
  const values = rowFinancials(row, draft, 'USD');
  const serverDual = valueOf(row.item, [total ? 'supplierCurrency.total' : 'supplierCurrency.unitOrFixed'], null);
  let usd = total ? values.supplierTotal : values.supplierRate;
  let hkd = finiteNumber(serverDual?.hkdAmount);
  const rate = finiteNumber(valueOf(row.item, ['supplierCurrency.usdHkdRate'], companyRate));
  if (draft && finiteNumber(draft.supplierCost) != null && rate > 0) {
    const native = finiteNumber(draft.supplierCost);
    const unitUsd = draft.inputCurrency === 'HKD' ? native / rate : native;
    usd = total && draft.pricingType === 'per_unit' && finiteNumber(draft.quantity) != null ? unitUsd * Number(draft.quantity) : unitUsd;
    hkd = total && draft.pricingType === 'per_unit' && finiteNumber(draft.quantity) != null
      ? (draft.inputCurrency === 'HKD' ? native : native * rate) * Number(draft.quantity)
      : draft.inputCurrency === 'HKD' ? native : native * rate;
  }
  return <div><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 font-semibold tabular-nums">{usd == null ? 'Unavailable' : formatMoney(usd, 'USD')}</div><div className="text-xs font-medium tabular-nums text-slate-600">{hkd == null ? 'HKD unavailable' : formatMoney(hkd, 'HKD')}</div>{serverDual?.basis === 'current_rate' && <div className="mt-0.5 text-[11px] text-amber-700">Current company rate</div>}</div>;
}

function PairedChargeRow({ row, review, draft, currency, companyRate, canCostEdit, canBuyerEdit, costApproved: costApprovedProp = false, buyerApproved: buyerApprovedProp = false, instanceUrl, onReviewChange, onDraftChange }) {
  const [buyerPriceOpen, setBuyerPriceOpen] = useState(false);
  const costApproved = costApprovedProp || row.item?.costReviewApproved === true;
  const buyerApproved = buyerApprovedProp || row.item?.buyerReviewApproved === true;
  const values = rowFinancials(row, draft, currency);
  const description = text(valueOf(row.item, ['description']));
  const product = itemLabel(row);
  const descriptionVisible = description && description.localeCompare(product, undefined, { sensitivity: 'base' }) !== 0;
  const fixedPricing = values.pricingType === 'fixed';
  const supplierEditing = review.outcome === 'changed' || review.outcome === 'cancelled';
  const anchorageDues = isHongKongAnchorageDuesItem(row.item);
  const portClearance = isPortClearanceItem(row.item);
  const supplierLocked = supplierCostLockedForItem(row.item);
  const buyerLocked = buyerDecisionLockedForItem(row.item);
  const includedInBasicCalling = isIncludedBasicCallingItem(row.item);
  const removable = row.sourceType === 'extra_cost' && row.item?.managedBasicCallingBundle !== true;
  const buyerDecisionOptions = buyerDecisionOptionsForItem(row.item);
  const displayedBuyerRate = buyerAmountWithAnchorageDecision(row.item, review.buyerChargeDecision, values.buyerRate);
  const displayedBuyerTotal = buyerAmountWithAnchorageDecision(row.item, review.buyerChargeDecision, values.buyerTotal);
  const displayedMargin = values.supplierTotal != null && displayedBuyerTotal != null ? displayedBuyerTotal - values.supplierTotal : null;
  const unavailableReason = values.pricingType === 'per_unit' && values.quantity == null ? 'Quantity is unavailable.' : 'The Salesforce total is unavailable.';
  const removeCharge = () => {
    onDraftChange({ cancelled: true });
    onReviewChange({ outcome: 'cancelled' });
  };
  return <article className="border-t border-border"><div className="border-b border-border bg-muted/25 px-4 py-3"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="font-semibold">{product}</h3>{descriptionVisible && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}</div><div className="flex flex-wrap items-start gap-x-5 gap-y-1 text-xs text-muted-foreground">{!fixedPricing && <span>Quantity <strong className="text-foreground">{variableChargeQuantityLabel(row.item, values.quantity, draft?.unitOfMeasure || valueOf(row.item, ['unitOfMeasure']))}</strong></span>}<span>Pricing Basis <strong className="text-foreground">{fixedPricing ? 'Fixed charge' : 'Per Unit'}</strong></span><div><span>Margin</span><MarginAmount value={displayedMargin} currency="USD" unavailableReason={unavailableReason} /></div>{removable && <AlertDialog><AlertDialogTrigger asChild><Button type="button" size="sm" variant="ghost" className="-my-1 h-7 text-rose-700 hover:bg-rose-50 hover:text-rose-800" disabled={!canCostEdit}>Remove</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Remove this extra cost?</AlertDialogTitle><AlertDialogDescription>The row remains in Salesforce history but is cancelled and no longer active.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep</AlertDialogCancel><AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={removeCharge}>Remove Extra Cost</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}</div></div></div><div className="grid grid-cols-2"><section className="min-h-[210px] space-y-3 border-r-2 border-slate-300 bg-slate-50/30 p-4">{costApproved ? <ApprovedDecision ariaLabel={`${product} supplier review approved`} /> : <DecisionButtons ariaLabel={`${product} supplier review`} selected={review.outcome === 'cancelled' ? 'changed' : review.outcome || ''} disabled={!canCostEdit} onChange={(outcome) => { if (outcome === 'changed' && review.outcome === 'cancelled') onDraftChange({ cancelled: false }); onReviewChange({ outcome }); }} options={[{ value: '', label: 'Pending', tone: 'bg-slate-100 text-slate-800' }, { value: 'correct', label: 'Correct', tone: 'bg-emerald-100 text-emerald-900' }, { value: 'changed', label: supplierLocked ? 'Review Setup' : 'Edit Cost', tone: 'bg-amber-100 text-amber-950' }]} />}<SupplierDualAmount label={fixedPricing ? 'Supplier Fixed Cost' : 'Supplier Unit Cost'} row={row} draft={draft} companyRate={companyRate} />{!costApproved && supplierEditing && (row.readOnly ? <SalesforceEditNotice sourceId={row.sourceId} instanceUrl={instanceUrl} /> : portClearance ? <ManagedPortClearanceFields row={row} draft={draft} disabled={!canCostEdit} onChange={onDraftChange} /> : supplierLocked ? <LockedAgencyFeeFields row={row} instanceUrl={instanceUrl} /> : <PairedExtraCostFields row={row} draft={draft} disabled={!canCostEdit} onChange={onDraftChange} />)}</section><section className="min-h-[210px] space-y-3 bg-blue-50/20 p-4">{buyerApproved ? <ApprovedDecision ariaLabel={`${product} buyer review approved`} /> : <DecisionButtons ariaLabel={`${product} buyer review`} selected={review.buyerChargeDecision || ''} disabled={!canBuyerEdit || buyerLocked} onChange={(buyerChargeDecision) => onReviewChange({ buyerChargeDecision })} options={buyerDecisionOptions} />}{anchorageDues && <p className="text-xs text-blue-900">Buyer default: Vessel NRT × rounded chargeable hours after the first 12 aggregate hours × USD 0.002. The Buyer Trader may amend the USD amount.</p>}{includedInBasicCalling && <p className="text-xs text-blue-900">Included in Basic Calling Cost · buyer charge remains USD 0.</p>}{portClearance && <p className="text-xs text-blue-900">The first application is included. Additional supplier-reported applications are passed through at HKD 58 each using the reviewed row rate.</p>}<AmountDisplay label={fixedPricing ? 'Buyer Fixed Charge' : 'Buyer Unit Price'} amount={displayedBuyerRate} currency="USD" unavailableReason={unavailableReason} />{!buyerApproved && review.buyerChargeDecision === 'include' && !buyerLocked && <div><Button type="button" size="sm" variant="outline" disabled={!canBuyerEdit} onClick={() => setBuyerPriceOpen((open) => !open)}>{anchorageDues ? 'Edit Buyer Amount' : 'Edit Buyer Price'}</Button>{buyerPriceOpen && (row.readOnly ? <SalesforceEditNotice sourceId={row.sourceId} instanceUrl={instanceUrl} /> : <div className="mt-3 space-y-2"><Label htmlFor={`paired-buyer-price-${row.sourceId}`}>{anchorageDues ? 'Buyer Anchorage Dues Charge (USD)' : fixedPricing ? 'Buyer Fixed Charge (USD)' : 'Buyer Unit Price (USD)'}</Label><Input id={`paired-buyer-price-${row.sourceId}`} inputMode="decimal" value={draft?.buyerPrice ?? ''} disabled={!canBuyerEdit} onChange={(event) => onDraftChange({ buyerPrice: event.target.value })} /></div>)}</div>}</section></div></article>;
}

function PairedNewChargeRow({ draft, products, canCostEdit, canBuyerEdit, commonOwner, onChange, onRemove }) {
  const pricingType = draft.pricingType || 'fixed';
  const quantity = finiteNumber(draft.quantity);
  const nativeSupplierRate = finiteNumber(draft.supplierCost);
  const supplierRate = draft.inputCurrency === 'HKD' && finiteNumber(draft.companyRate) > 0 ? nativeSupplierRate / Number(draft.companyRate) : nativeSupplierRate;
  const buyerRate = finiteNumber(draft.buyerPrice);
  const supplierTotal = pricingType === 'fixed' ? supplierRate : supplierRate != null && quantity != null ? supplierRate * quantity : null;
  const buyerTotal = pricingType === 'fixed' ? buyerRate : buyerRate != null && quantity != null ? buyerRate * quantity : null;
  const margin = supplierTotal != null && buyerTotal != null ? buyerTotal - supplierTotal : null;
  const currencyLocked = Boolean(draft.requiredInputCurrency);
  return <article className="border-t border-dashed border-blue-300"><div className="flex items-center justify-between border-b border-border bg-blue-50/40 px-4 py-3"><div><div className="font-semibold">New Extra Cost</div><div className="text-xs text-muted-foreground">Supplier and payment term are inherited.</div></div><Button type="button" size="sm" variant="ghost" onClick={onRemove} disabled={!canCostEdit}><X className="mr-1 h-4 w-4" />Remove</Button></div><div className="grid grid-cols-2"><section className="space-y-3 border-r-2 border-slate-300 bg-slate-50/30 p-4"><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Product</Label><Select value={draft.productId || undefined} disabled={!canCostEdit} onValueChange={(productId) => onChange({ productId })}><SelectTrigger><SelectValue placeholder="Select Product" /></SelectTrigger><SelectContent>{products.map((product) => <SelectItem key={valueOf(product, ['id', 'Id'])} value={String(valueOf(product, ['id', 'Id']))}>{valueOf(product, ['name', 'Name'], 'Product')}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Description</Label><Input value={draft.description || ''} disabled={!canCostEdit} onChange={(event) => onChange({ description: event.target.value })} /></div><div className="space-y-2"><Label>Pricing Basis</Label><Select value={pricingType} disabled={!canCostEdit} onValueChange={(value) => onChange({ pricingType: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="fixed">Fixed</SelectItem><SelectItem value="per_unit">Per Unit</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>{currencyLocked ? 'Agent Agreed Currency' : 'Input Currency'}</Label><Select value={draft.inputCurrency || 'USD'} disabled={!canCostEdit || currencyLocked} onValueChange={(inputCurrency) => onChange({ inputCurrency })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="HKD">HKD</SelectItem><SelectItem value="USD">USD</SelectItem></SelectContent></Select>{currencyLocked && <div className="text-xs text-amber-900">All costs for this agent use the Account’s agreed currency.</div>}</div><div className="space-y-2"><Label>{pricingType === 'fixed' ? 'Supplier Fixed Cost' : 'Supplier Unit Cost'} ({draft.inputCurrency || 'USD'})</Label><Input inputMode="decimal" value={draft.supplierCost ?? ''} disabled={!canCostEdit} onChange={(event) => onChange({ supplierCost: event.target.value })} /></div>{pricingType === 'per_unit' && <><div className="space-y-2"><Label>Quantity</Label><Input inputMode="decimal" value={draft.quantity ?? ''} disabled={!canCostEdit} onChange={(event) => onChange({ quantity: event.target.value })} /></div><div className="space-y-2"><Label>UOM</Label><Input value={draft.unitOfMeasure || ''} disabled={!canCostEdit} onChange={(event) => onChange({ unitOfMeasure: event.target.value })} /></div></>}</div></section><section className="space-y-3 bg-blue-50/20 p-4">{commonOwner ? <><DecisionButtons ariaLabel="New charge buyer review" selected={draft.buyerChargeDecision || ''} disabled={!canBuyerEdit} onChange={(buyerChargeDecision) => onChange({ buyerChargeDecision })} options={[{ value: '', label: 'Pending', tone: 'bg-slate-100 text-slate-800' }, { value: 'include', label: 'Charge Buyer', tone: 'bg-blue-100 text-blue-900' }, { value: 'exclude', label: 'Do Not Charge', tone: 'bg-slate-200 text-slate-900' }]} />{draft.buyerChargeDecision === 'include' && <div className="space-y-2"><Label>Buyer {pricingType === 'fixed' ? 'Fixed Charge' : 'Unit Price'} (USD)</Label><Input inputMode="decimal" value={draft.buyerPrice ?? ''} disabled={!canBuyerEdit} onChange={(event) => onChange({ buyerPrice: event.target.value })} /></div>}<div><div className="text-xs text-muted-foreground">Margin</div><MarginAmount value={draft.buyerChargeDecision === 'exclude' && supplierTotal != null ? -supplierTotal : margin} currency="USD" /></div></> : <div className="rounded-md border border-blue-200 bg-white/70 p-3 text-sm text-blue-950">Pending for Buyer Trader after Supplier approval.</div>}</section></div></article>;
}

function PairedReviewWorkspace({ caseRow, requirement, requirements, activeSupplierId, onSupplierChange, rows, allRows, reviews, extraDrafts, addDrafts, products, files, financials: rawFinancials, currency, supplierPaymentTerm, buyerPaymentTerm, canCostEdit, canBuyerEdit, reviewingBothAsGeneralManager = false, saving, supplierSaving, assignmentSaving, amendSaving, supplierNote, buyerNote, salesforceInstanceUrl, anchorage, anchorageDrafts, anchorageSaving, canSaveAnchorage, onAnchorageChange, onSaveAnchorage, onReviewChange, onDraftChange, onAddDraftChange, onAdd, onRemoveAdd, onSupplierNote, onBuyerNote, onToggleEvidence, onAssign, onAmend, onApprove }) {
  if (!requirement) return <StateBlock icon={AlertTriangle} title="Supplier review unavailable" description="Refresh to load the exact supplier work package." />;
  const costSide = requirement.sides?.cost || {};
  const buyerSide = requirement.sides?.buyerCharge || {};
  const commonOwner = Boolean(costSide.currentAssignee?.id && costSide.currentAssignee.id === buyerSide.currentAssignee?.id)
    || reviewingBothAsGeneralManager;
  const bothOpen = costSide.status !== 'verified' && buyerSide.status !== 'verified';
  const adjustFinancials = (summary, affectedRows) => {
    const adjustment = (affectedRows || []).reduce((total, row) => {
      if (row.sourceType !== 'extra_cost') return total;
      const decision = reviews[row.key]?.buyerChargeDecision;
      if (!['include', 'exclude'].includes(decision)) return total;
      const currentTotal = finiteNumber(valueOf(row.item, ['linePrice', 'line_price', 'totalPrice', 'Total_Price__c'])) ?? 0;
      const draft = extraDrafts[row.sourceId] || initialExtraDraft(row.item);
      const reviewedTotal = decision === 'exclude' ? 0 : rowFinancials(row, draft, currency).buyerTotal;
      return reviewedTotal == null ? total : total + reviewedTotal - currentTotal;
    }, 0);
    if (!adjustment || summary?.buyerChargeTotal == null) return summary;
    return {
      ...summary,
      buyerChargeTotal: summary.buyerChargeTotal + adjustment,
      margin: summary.margin == null ? null : summary.margin + adjustment,
    };
  };
  const financials = adjustFinancials(rawFinancials, allRows);
  const costReady = rows.length > 0 && rows.every((row) => {
    const outcome = reviews[row.key]?.outcome;
    if (!['correct', 'changed', 'cancelled'].includes(outcome)) return false;
    if (row.readOnly) return outcome === 'correct';
    if (outcome !== 'changed') return true;
    const draft = extraDrafts[row.sourceId] || initialExtraDraft(row.item);
    const original = initialExtraDraft(row.item);
    const changed = isPortClearanceItem(row.item) || changeKey({ description: draft.description, pricingType: draft.pricingType, supplierCost: draft.supplierCost, inputCurrency: draft.inputCurrency, quantity: draft.quantity, unitOfMeasure: draft.unitOfMeasure })
      !== changeKey({ description: original.description, pricingType: original.pricingType, supplierCost: original.supplierCost, inputCurrency: original.inputCurrency, quantity: original.quantity, unitOfMeasure: original.unitOfMeasure });
    return changed && text(draft.description) && finiteNumber(draft.supplierCost) != null
      && (draft.pricingType !== 'per_unit' || (finiteNumber(draft.quantity) > 0 && text(draft.unitOfMeasure)));
  }) && Boolean(text(supplierNote));
  const buyerReady = rows.length > 0 && rows.every((row) => {
    const decision = reviews[row.key]?.buyerChargeDecision;
    if (!['include', 'exclude'].includes(decision)) return false;
    if (decision !== 'include' || row.sourceType !== 'extra_cost') return true;
    const buyerPrice = finiteNumber((extraDrafts[row.sourceId] || initialExtraDraft(row.item)).buyerPrice);
    return isHongKongAnchorageDuesItem(row.item) ? buyerPrice > 0 : buyerPrice != null;
  }) && Boolean(text(buyerNote));
  const additionsCostReady = addDrafts.every((draft) => text(draft.productId) && text(draft.description) && finiteNumber(draft.supplierCost) != null && (draft.pricingType !== 'per_unit' || (finiteNumber(draft.quantity) > 0 && text(draft.unitOfMeasure))));
  const additionsBuyerReady = addDrafts.every((draft) => ['include', 'exclude'].includes(draft.buyerChargeDecision) && (draft.buyerChargeDecision !== 'include' || finiteNumber(draft.buyerPrice) != null));
  const busy = saving || supplierSaving || assignmentSaving || amendSaving;
  const canApproveBoth = canApproveBothVariableChargeLegs({ commonOwner, reviewingBothAsGeneralManager, bothOpen, canCostEdit, canBuyerEdit });
  const supplierName = requirement.supplierName || 'Not set';
  const supplierControl = requirements.length > 1 ? <Select value={activeSupplierId} onValueChange={onSupplierChange}><SelectTrigger className="mt-1 bg-white font-semibold"><SelectValue /></SelectTrigger><SelectContent>{requirements.map((row) => <SelectItem key={row.supplierId} value={String(row.supplierId)}>{row.supplierName || 'Supplier unavailable'} · Cost {sideStatusLabel(row.sides?.cost)} · Buyer {sideStatusLabel(row.sides?.buyerCharge)}</SelectItem>)}</SelectContent></Select> : null;
  return <section className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"><div className="text-sm font-medium">Total Margin</div><MarginAmount value={financials.margin} currency={financials.currency || currency} unavailableReason={financials.blockingReason} /></div><div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm [scrollbar-gutter:stable]"><div className="min-w-[960px]"><div className="grid grid-cols-2"><div className="border-r-2 border-slate-300"><LegHeader leg="Supplier Leg" name={supplierName} nameControl={supplierControl} traderLabel="Supplier Trader" side={costSide} paymentTerm={supplierPaymentTerm} editable={canCostEdit} assignmentSaving={assignmentSaving} amendSaving={amendSaving} onAmend={() => onAmend(['cost'], 'Amend Supplier Costs')} onAssign={(target) => onAssign(['cost'], target)} /></div><div><LegHeader leg="Buyer Leg" name={caseRow.buyerAccountName || 'Not set'} traderLabel="Buyer Trader" side={buyerSide} paymentTerm={buyerPaymentTerm} buyer editable={canBuyerEdit} assignmentSaving={assignmentSaving} amendSaving={amendSaving} onAmend={() => onAmend(['buyer_charge'], 'Amend Buyer Charges')} onAssign={(target) => onAssign(['buyer_charge'], target)} /></div></div><div className="grid grid-cols-2 border-t border-slate-300"><div className="border-r-2 border-slate-300 bg-slate-50/60 px-4 py-2"><Button type="button" variant="outline" size="sm" onClick={onAdd} disabled={!canCostEdit || costSide.status === 'verified' || busy} title={!canCostEdit ? 'Only the current Supplier Leg reviewer can add an extra cost.' : costSide.status === 'verified' ? 'Approved Supplier costs must be reopened before adding an extra cost.' : undefined}><PackagePlus className="mr-2 h-4 w-4" />Add Extra Cost</Button></div><div className="bg-blue-50/20" /></div>{anchorage && <AnchorageDuesPanel evidence={anchorage} drafts={anchorageDrafts} canEdit={canSaveAnchorage} saving={anchorageSaving} onChange={onAnchorageChange} onSave={onSaveAnchorage} />}{rows.length ? rows.map((row) => <PairedChargeRow key={row.key} row={row} review={reviews[row.key] || initialReview(row)} draft={row.sourceType === 'extra_cost' ? extraDrafts[row.sourceId] || initialExtraDraft(row.item) : null} currency={currency} companyRate={caseRow?.variableChargeSettings?.usdHkdRate} canCostEdit={canCostEdit && costSide.status !== 'verified'} canBuyerEdit={canBuyerEdit && buyerSide.status !== 'verified'} instanceUrl={salesforceInstanceUrl} onReviewChange={(patch) => onReviewChange(row.key, patch)} onDraftChange={(patch) => onDraftChange(row.sourceId, patch)} />) : <div className="border-t border-border px-4 py-10 text-center text-sm text-muted-foreground">No active charges for this supplier</div>}{addDrafts.map((draft) => <PairedNewChargeRow key={draft.localId} draft={draft} products={products} currency={currency} canCostEdit={canCostEdit && costSide.status !== 'verified'} canBuyerEdit={canBuyerEdit && buyerSide.status !== 'verified'} commonOwner={commonOwner} onChange={(patch) => onAddDraftChange(draft.localId, patch)} onRemove={() => onRemoveAdd(draft.localId)} />)}<div className="grid grid-cols-2 border-t-2 border-slate-300"><footer className="space-y-3 border-r-2 border-slate-300 bg-slate-50/30 p-4"><div className="space-y-2"><Label htmlFor={`supplier-review-note-${activeSupplierId}`}>Review Note</Label><Textarea id={`supplier-review-note-${activeSupplierId}`} value={supplierNote} onChange={(event) => onSupplierNote(event.target.value.slice(0, 1000))} disabled={!canCostEdit || costSide.status === 'verified' || busy} /></div>{files.length > 0 && <OptionalEvidence files={files} selectedIds={rows[0] ? reviews[rows[0].key]?.evidenceDocumentIds || [] : []} disabled={!canCostEdit || costSide.status === 'verified' || busy} onToggle={onToggleEvidence} />}{!canApproveBoth && <div className="flex justify-end"><Button type="button" onClick={() => onApprove(['cost'])} disabled={!canCostEdit || costSide.status === 'verified' || busy || !costReady || !additionsCostReady || !rows.length}>{supplierSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Approve Supplier Costs</Button></div>}</footer><footer className="space-y-3 bg-blue-50/20 p-4"><div className="space-y-2"><Label htmlFor={`buyer-review-note-${activeSupplierId}`}>Review Note</Label><Textarea id={`buyer-review-note-${activeSupplierId}`} value={buyerNote} onChange={(event) => onBuyerNote(event.target.value.slice(0, 1000))} disabled={!canBuyerEdit || buyerSide.status === 'verified' || busy} /></div>{!canApproveBoth && <div className="flex justify-end"><Button type="button" onClick={() => onApprove(['buyer_charge'])} disabled={!canBuyerEdit || buyerSide.status === 'verified' || busy || !buyerReady || !rows.length}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Approve Buyer Charges</Button></div>}</footer></div>{canApproveBoth && <div className="flex justify-center border-t border-border bg-background p-4"><Button type="button" onClick={() => onApprove(['cost', 'buyer_charge'])} disabled={busy || !costReady || !buyerReady || !additionsCostReady || !additionsBuyerReady || !rows.length}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Approve Both</Button></div>}</div></div></section>;
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

function ReadOnlyNotice({ caseRow, responsiblePerson }) { return <div className="flex gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><span>View only. This step belongs to {responsiblePerson || valueOf(caseRow, ['responsiblePerson', 'workflow.responsiblePerson'], 'another user')}.</span></div>; }

function SupplierChargeDecision({ row, review, draft, disabled, onOutcome, onDraftChange }) {
  const cost = valueOf(row.item, ['lineCost', 'line_cost', 'totalCost', 'Total_Cost__c', 'fixedCost', 'unitCost']);
  const needsChange = review.outcome === 'changed' || review.outcome === 'cancelled';
  return <article className={cn('rounded-lg border p-4', review.outcome === 'correct' ? 'border-emerald-200 bg-emerald-50/40' : needsChange ? 'border-amber-300 bg-amber-50/40' : 'border-border')}><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="font-medium">{itemLabel(row)}</div><div className="mt-1 text-sm text-muted-foreground">Current supplier cost · {formatMoney(cost, valueOf(row.item, ['currency']))}</div></div><div className="flex rounded-lg border border-border bg-background p-1"><Button type="button" size="sm" variant={review.outcome === 'correct' ? 'default' : 'ghost'} className={cn(review.outcome === 'correct' && 'bg-emerald-600 hover:bg-emerald-700')} disabled={disabled} onClick={() => onOutcome('correct')}><CheckCircle2 className="mr-1.5 h-4 w-4" />Correct</Button><Button type="button" size="sm" variant={needsChange ? 'default' : 'ghost'} className={cn(needsChange && 'bg-amber-600 hover:bg-amber-700')} disabled={disabled} onClick={() => onOutcome('changed')}>Edit Cost</Button></div></div>{needsChange && (row.readOnly ? <div className="mt-3 rounded-md border border-amber-200 bg-white p-3 text-sm text-amber-900">This product line is read-only here. Correct it in Salesforce, then refresh this task.</div> : <ExistingExtraCostEditor item={row.item} draft={draft} disabled={disabled} supplierStage onChange={(patch) => { onDraftChange(patch); if (patch.cancelled === true) onOutcome('cancelled'); else if (review.outcome === 'cancelled') onOutcome('changed'); }} />)}</article>;
}

function BuyerChargeDecision({ row, review, draft, disabled, onDecision, onDraftChange }) {
  const supplierCost = valueOf(row.item, ['lineCost', 'line_cost', 'totalCost', 'Total_Cost__c', 'fixedCost', 'unitCost']);
  const buyerCharge = valueOf(row.item, ['linePrice', 'line_price', 'totalPrice', 'Total_Price__c', 'fixedPrice', 'unitPrice']);
  return <article className="rounded-lg border border-border p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="font-medium">{itemLabel(row)}</div><div className="mt-1 text-sm text-muted-foreground">Supplier {formatMoney(supplierCost)} · Buyer {formatMoney(buyerCharge)}</div></div><div className="flex rounded-lg border border-border bg-background p-1">{BUYER_CHARGE_DECISIONS.map((option) => <Button key={option.value} type="button" size="sm" variant={review.buyerChargeDecision === option.value ? 'default' : 'ghost'} disabled={disabled} onClick={() => onDecision(option.value)}>{option.label}</Button>)}</div></div>{row.sourceType === 'extra_cost' && review.buyerChargeDecision === 'include' && draft ? <div className="mt-3 max-w-sm space-y-2"><Label htmlFor={`buyer-price-${row.sourceId}`}>{draft.pricingType === 'fixed' ? 'Buyer charge' : 'Buyer price / unit'}</Label><Input id={`buyer-price-${row.sourceId}`} inputMode="decimal" value={draft.buyerPrice ?? ''} onChange={(event) => onDraftChange({ buyerPrice: event.target.value })} disabled={disabled} /></div> : null}</article>;
}

function FinancialSummary({ summary }) {
  return <div className="grid gap-3 sm:grid-cols-3"><SummaryAmount label="Supplier-cost total" value={summary.supplierCostTotal} complete={summary.costsComplete} /><SummaryAmount label="Buyer-charge total" value={summary.buyerChargeTotal} complete={summary.chargesComplete} /><SummaryAmount label="Margin" value={summary.margin} complete={summary.costsComplete && summary.chargesComplete} /></div>;
}

function SummaryAmount({ label, value, complete }) { return <div className="rounded-lg border border-border bg-muted/20 p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 text-lg font-semibold tabular-nums">{complete ? formatMoney(value) : 'Unavailable'}</div><div className="mt-1 text-[11px] text-muted-foreground">STEM currency</div></div>; }

function OptionalEvidence({ files, selectedIds, disabled, onToggle }) {
  return <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-sm font-medium">Supporting Files (Optional) ({files.length})</summary><div className="mt-3 flex flex-wrap gap-2">{files.map((file) => { const fileId = String(valueOf(file, ['contentDocumentId', 'id', 'Id'])); return <label key={fileId} className="flex max-w-full items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs"><Checkbox checked={selectedIds.includes(fileId)} disabled={disabled} onCheckedChange={() => onToggle(fileId)} /><FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /><span className="truncate">{valueOf(file, ['title', 'fileName', 'name', 'Name'], 'Salesforce File')}</span></label>; })}</div></details>;
}

function AuditDetails({ caseRow, assignmentHistory, assignmentHistoryUnavailable, canGmOverride, onOpenGm }) {
  const productBearing = caseRow.hasProductLineItems === true;
  const updated = valueOf(caseRow, ['salesforceStemLastModifiedAt']);
  return <details className="rounded-xl border border-border bg-card"><summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Audit Details</summary><div className="space-y-4 border-t border-border p-4 text-sm"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><SummaryField label="Review Timing Basis">{actionBasisLabel(caseRow)}{valueOf(caseRow, ['actionBasisDate']) ? ` · ${formatDate(valueOf(caseRow, ['actionBasisDate']))}` : ''}</SummaryField>{productBearing && <SummaryField label="Workflow Due Date">{formatDate(valueOf(caseRow, ['dueDate'])) === '—' ? 'Not set' : formatDate(valueOf(caseRow, ['dueDate']))}</SummaryField>}<SummaryField label="Salesforce Updated">{updated ? formatDate(updated) : 'Not set'}</SummaryField><SummaryField label="Workflow Revision">{valueOf(caseRow, ['revision'], 0)}</SummaryField></div><div><div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Assignment History</div>{assignmentHistoryUnavailable ? <div className="mt-2 text-sm text-amber-800">Assignment history is temporarily unavailable.</div> : assignmentHistory.length ? <ul className="mt-2 divide-y divide-border rounded-lg border border-border">{assignmentHistory.map((entry, index) => <li key={`${entry.occurredAt || 'event'}:${index}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"><span>{entry.side}{entry.supplierName ? ` · ${entry.supplierName}` : ''} · {entry.action}</span><span className="text-xs text-muted-foreground">{entry.occurredAt ? formatDate(entry.occurredAt) : 'Not set'}</span></li>)}</ul> : <div className="mt-2 text-sm text-muted-foreground">No assignment changes.</div>}</div>{canGmOverride && onOpenGm && <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3"><div className="font-medium text-amber-950">General Manager Override</div><Button type="button" size="sm" variant="outline" onClick={onOpenGm}><ShieldCheck className="mr-2 h-4 w-4" />Open Override</Button></div>}</div></details>;
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
  return <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-6"><div className="space-y-2"><Label htmlFor={`${id}-term`}>Payment term</Label><Input id={`${id}-term`} value={value.paymentTerm || ''} onChange={(event) => onChange({ paymentTerm: event.target.value })} disabled={disabled || paymentTermReadOnly || buyerStage} /></div><div className="space-y-2"><Label>Pricing</Label><Select value={value.pricingType} onValueChange={(pricingType) => onChange({ pricingType })} disabled={disabled || buyerStage}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="fixed">Fixed</SelectItem><SelectItem value="per_unit">Per unit</SelectItem></SelectContent></Select></div>{supplierStage && <div className="space-y-2"><Label>Input Currency</Label><Select value={value.inputCurrency || 'USD'} onValueChange={(inputCurrency) => onChange({ inputCurrency })} disabled={disabled || buyerStage}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="HKD">HKD</SelectItem><SelectItem value="USD">USD</SelectItem></SelectContent></Select></div>}<div className="space-y-2"><Label htmlFor={`${id}-supplier-cost`}>{value.pricingType === 'fixed' ? 'Fixed supplier cost' : 'Supplier cost / unit'} ({value.inputCurrency || 'USD'})</Label><Input id={`${id}-supplier-cost`} inputMode="decimal" value={value.supplierCost ?? ''} onChange={(event) => onChange({ supplierCost: event.target.value })} disabled={disabled || buyerStage} /></div>{!supplierStage && <div className="space-y-2"><Label htmlFor={`${id}-buyer-price`}>{value.pricingType === 'fixed' ? 'Fixed buyer price' : 'Buyer price / unit'} (USD)</Label><Input id={`${id}-buyer-price`} inputMode="decimal" value={value.buyerPrice ?? ''} onChange={(event) => onChange({ buyerPrice: event.target.value })} disabled={disabled} /></div>}{value.pricingType === 'per_unit' && <><div className="space-y-2"><Label htmlFor={`${id}-quantity`}>Quantity</Label><Input id={`${id}-quantity`} inputMode="decimal" value={value.quantity ?? ''} onChange={(event) => onChange({ quantity: event.target.value })} disabled={disabled || buyerStage} /></div><div className="space-y-2"><Label htmlFor={`${id}-uom`}>Unit of measure</Label><Input id={`${id}-uom`} value={value.unitOfMeasure || ''} onChange={(event) => onChange({ unitOfMeasure: event.target.value })} disabled={disabled || buyerStage} /></div></>}</div>;
}

function PostInvoiceResolution({ value, disabled, saving, onChange, onSave }) { return <section className="space-y-3 rounded-lg border border-rose-300 bg-rose-50 p-4"><h2 className="text-sm font-semibold text-rose-950">Invoice already issued—action required</h2><div className="grid gap-3 md:grid-cols-2"><div className="space-y-2"><Label>Resolution</Label><Select value={value.resolution} onValueChange={(resolution) => onChange({ resolution })} disabled={disabled || saving}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{POST_INVOICE_RESOLUTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor="post-invoice-reference">Reference</Label><Input id="post-invoice-reference" value={value.reference} onChange={(event) => onChange({ reference: event.target.value })} disabled={disabled || saving} /></div></div><div className="space-y-2"><Label htmlFor="post-invoice-note">Resolution Note</Label><Textarea id="post-invoice-note" value={value.note} onChange={(event) => onChange({ note: event.target.value })} disabled={disabled || saving} /></div><Button type="button" variant="outline" onClick={onSave} disabled={disabled || saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save Resolution</Button></section>; }
