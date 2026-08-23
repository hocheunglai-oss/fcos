import { useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, Banknote, Eye, Loader2, Mail, Pencil, RefreshCw, Save, Search, Send, Settings2, WalletCards, X } from 'lucide-react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { appClient } from '@/api/appClient';
import { useNavigationAwareRequest } from '@/hooks/useNavigationAwareRequest';
import PageHeader from '@/components/common/PageHeader';
import ReorderableDataTable from '@/components/common/ReorderableDataTable';
import StemDetailLink from '@/components/common/StemDetailLink';
import StateBlock from '@/components/common/StateBlock';
import DataStatus from '@/components/common/DataStatus';
import TableShell from '@/components/common/TableShell';
import StatCard from '@/components/dashboard/StatCard';
import StemDetailModal from '@/components/dashboard/StemDetailModal';
import PaymentCollectionThresholdsDialog from '@/components/payments/PaymentCollectionThresholdsDialog';
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
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { readPageState, writePageState } from '@/lib/pageStateCache';
import { cn } from '@/lib/utils';

const PAGE_STATE_KEY = 'incoming-payments';
const RECEIVABLE_PAYMENTS_TABLE_TOKEN = '{{receivablePaymentsTable}}';
const BUYER_CIA_TABLE_TOKEN = '{{buyerCiaInvoicesTable}}';
const INTEREST_CALCULATION_TABLE_TOKEN = '{{interestCalculationTable}}';
const STEM_LINK_TOKEN = '{{stemLink}}';
const INTEREST_STEM_LINK_TOKEN_PATTERN = /\{\{\s*stemLink\s*\}\}/i;
const QUILL_MODULES = {
  toolbar: [
    [{ header: [false, 3, 4] }],
    ['bold', 'italic', 'underline'],
    [{ color: [] }, { background: [] }],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['link'],
    ['clean'],
  ],
};
const DEFAULT_EMAIL_SETTINGS = {
  to: '',
  cc: '',
  bcc: '',
  subject: '',
  intro: '',
  includeReceivablePayments: true,
  includeBuyerCiaInvoices: true,
};

const DEFAULT_INTEREST_EMAIL_SETTINGS = {
  to: '',
  cc: '',
  bcc: '',
  subject: '',
  body: '',
};

const EMAIL_TABLE_TOKENS = [
  { label: 'Incoming Total', token: '{{incomingTotal}}' },
  { label: 'Buyer Payments', token: '{{buyerPaymentTotal}}' },
  { label: 'Supplier Refunds', token: '{{supplierRefundTotal}}' },
  { label: 'Incoming Records', token: '{{receivablePaymentCount}}' },
  { label: 'Needs Review', token: '{{needsReviewCount}}' },
  { label: 'Late Payment Interest Invoice', token: '{{requestLatePaymentInterestInvoiceLink}}' },
  { label: 'Receivable Payments Table', token: RECEIVABLE_PAYMENTS_TABLE_TOKEN },
  { label: 'Buyer CIA Invoices Table', token: BUYER_CIA_TABLE_TOKEN },
];

const INTEREST_EMAIL_TOKENS = [
  { label: 'Requested By', token: '{{requestedBy}}' },
  { label: 'Requester Email', token: '{{requesterEmail}}' },
  { label: 'Buyer', token: '{{buyerName}}' },
  { label: 'Group', token: '{{buyerGroupName}}' },
  { label: 'STEM', token: '{{stemName}}' },
  { label: 'Link to STEM', token: STEM_LINK_TOKEN },
  { label: 'Payment', token: '{{paymentName}}' },
  { label: 'Received Date', token: '{{receivedDate}}' },
  { label: 'Inserted Date', token: '{{insertedDate}}' },
  { label: 'Delay Days', token: '{{delayDays}}' },
  { label: 'Payment Amount', token: '{{paymentAmount}}' },
  { label: 'Receivable Balance', token: '{{receivableBalance}}' },
  { label: 'Interest Rate', token: '{{interestRate}}' },
  { label: 'Interest Total', token: '{{interestTotal}}' },
  { label: 'Calculation Table', token: INTEREST_CALCULATION_TABLE_TOKEN },
];

const paymentStatusClass = {
  'Buyer Payment': 'border-blue-200 bg-blue-50 text-blue-700',
  'Supplier Refund': 'border-emerald-200 bg-emerald-50 text-emerald-700',
  'Bank Charge': 'border-amber-200 bg-amber-50 text-amber-800',
  Unmatched: 'border-amber-200 bg-amber-50 text-amber-800',
};

function todayHongKong() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function fmtMoney(value, currency = 'USD') {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  const prefix = currency === 'USD' || !currency ? '$' : `${currency} `;
  return `${prefix}${number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(value) {
  if (!value) return '-';
  try { return format(new Date(value), 'dd MMM yyyy'); } catch { return String(value); }
}

function dateOnlyHongKong(value) {
  if (!value) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Hong_Kong',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(value));
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
  } catch {
    return '';
  }
}

function insertedDateText(row) {
  if (!row?.paymentDate || !row?.createdDate) return '';
  return dateOnlyHongKong(row.paymentDate) !== dateOnlyHongKong(row.createdDate)
    ? `Inserted on ${fmtDate(row.createdDate)}`
    : '';
}

function lowerText(value) {
  return String(value || '').toLowerCase();
}

function PaymentStatusBadge({ row }) {
  return (
    <Badge variant="outline" className={cn('whitespace-nowrap', paymentStatusClass[row.type] || paymentStatusClass.Unmatched)}>
      {row.type || '-'}
    </Badge>
  );
}

function defaultPageState() {
  return {
    dateFrom: todayHongKong(),
    dateTo: todayHongKong(),
    search: '',
    data: null,
    thresholdDrafts: [],
  };
}

function readUrlFilterPatch() {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  const patch = {};
  if (params.has('dateFrom')) patch.dateFrom = params.get('dateFrom') || todayHongKong();
  if (params.has('dateTo')) patch.dateTo = params.get('dateTo') || patch.dateFrom || todayHongKong();
  if (params.has('search')) patch.search = params.get('search') || '';
  if (params.has('keyword')) patch.search = params.get('keyword') || '';
  return patch;
}

function readUrlStemId() {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('stemId') || params.get('stem') || null;
}

function initialPageState() {
  const cached = readPageState(PAGE_STATE_KEY, defaultPageState);
  const filterPatch = readUrlFilterPatch();
  if (!Object.keys(filterPatch).length) return cached;
  return { ...cached, ...filterPatch, data: null };
}

function escapeInterestHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function hasHtmlMarkup(value) {
  return /<\/?[a-z][\s\S]*>/i.test(String(value || ''));
}

function sanitizeRichHtml(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '');
}

function richTemplateValue(value, fallback = '') {
  const raw = String(value || fallback || '');
  if (!raw) return '';
  if (hasHtmlMarkup(raw)) return sanitizeRichHtml(raw);
  return raw
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, index) => {
      const html = escapeInterestHtml(block).replaceAll('\n', '<br>');
      return index === 0 ? `<h2>${html}</h2>` : `<p>${html}</p>`;
    })
    .join('');
}

function insertTokenIntoQuill(editor, token, uniqueTokens = []) {
  if (!editor || !token) return;
  let index = editor.getSelection(true)?.index ?? editor.getLength();
  uniqueTokens.forEach((uniqueToken) => {
    const text = editor.getText();
    const escaped = uniqueToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = [...text.matchAll(new RegExp(escaped, 'gi'))];
    for (const match of matches.reverse()) {
      editor.deleteText(match.index, match[0].length);
      if (match.index < index) index -= match[0].length;
    }
  });
  editor.insertText(Math.max(0, index), token);
  editor.setSelection(Math.max(0, index) + token.length, 0);
}

function renderInterestTemplate(value, context) {
  return String(value || '').replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(context, key) ? context[key] : match
  ));
}

function interestContentHtml(content) {
  if (hasHtmlMarkup(content)) return sanitizeRichHtml(content);
  const blocks = String(content || '').split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  return blocks.map((block, index) => {
    const html = escapeInterestHtml(block).replaceAll('\n', '<br>');
    if (index === 0) return `<h2 style="margin:0 0 8px;font-size:18px;color:#111827">${html}</h2>`;
    return `<p style="margin:0 0 14px;color:#4b5563">${html}</p>`;
  }).join('');
}

function replaceInterestToken(source, pattern, replacement) {
  return String(source || '')
    .replace(new RegExp(`<p\\b[^>]*>\\s*${pattern.source}\\s*<\\/p>`, 'i'), replacement)
    .replace(pattern, replacement);
}

function interestStemLinkHtml(url) {
  return `<p style="margin:0 0 14px"><a href="${escapeInterestHtml(url)}" style="display:inline-block;border-radius:8px;background:#1f2937;color:#ffffff;text-decoration:none;font-weight:700;padding:9px 13px">Link to STEM</a></p>`;
}

function sampleInterestCalculationHtml() {
  return `
    <div style="margin-top:16px">
      <h3 style="margin:0 0 8px;font-size:15px;color:#111827">Late Payment Interest Calculation</h3>
      <p style="margin:0 0 8px;color:#667085">Formula: Outstanding Balance x Monthly Interest Rate x Overdue Days / 30.</p>
      <table style="border-collapse:collapse;width:100%;max-width:860px;font-size:12px;margin-bottom:12px">
        <tbody>
          <tr><th style="text-align:left;color:#667085;padding:5px 8px;width:210px">Buyer invoice amount</th><td style="padding:5px 8px;font-weight:700">$51,101.00</td></tr>
          <tr><th style="text-align:left;color:#667085;padding:5px 8px">Buyer invoice due date</th><td style="padding:5px 8px">07 Feb 2026</td></tr>
          <tr><th style="text-align:left;color:#667085;padding:5px 8px">Account interest rate</th><td style="padding:5px 8px">2.00% per month</td></tr>
          <tr><th style="text-align:left;color:#667085;padding:5px 8px">Calculated interest total</th><td style="padding:5px 8px;font-size:15px;font-weight:800;color:#1f2937">$374.74</td></tr>
        </tbody>
      </table>
      <table style="border-collapse:collapse;width:100%;max-width:960px;font-size:12px">
        <thead><tr style="background:#f8fafc;color:#667085;text-transform:uppercase;font-size:11px"><th style="text-align:left;padding:7px 8px">Period</th><th style="text-align:right;padding:7px 8px">Balance</th><th style="text-align:right;padding:7px 8px">Days</th><th style="text-align:left;padding:7px 8px">Formula</th><th style="text-align:right;padding:7px 8px">Interest</th></tr></thead>
        <tbody>
          <tr>
            <td style="border-bottom:1px solid #e5e7eb;padding:7px 8px;white-space:nowrap">07 Feb 2026 to 18 Feb 2026</td>
            <td style="border-bottom:1px solid #e5e7eb;padding:7px 8px;text-align:right;white-space:nowrap">$51,101.00</td>
            <td style="border-bottom:1px solid #e5e7eb;padding:7px 8px;text-align:right;white-space:nowrap">11</td>
            <td style="border-bottom:1px solid #e5e7eb;padding:7px 8px">$51,101.00 x 2.00% per month x 11 / 30</td>
            <td style="border-bottom:1px solid #e5e7eb;padding:7px 8px;text-align:right;font-weight:700;white-space:nowrap">$374.74</td>
          </tr>
        </tbody>
      </table>
    </div>`;
}

function buildInterestPreview(settings) {
  const sampleStemUrl = typeof window === 'undefined'
    ? 'https://fcos.fcuno.com/incoming-payments?stemId=sample'
    : `${window.location.origin}/incoming-payments?stemId=sample`;
  const context = {
    requestedBy: 'Vincent Lee',
    requesterEmail: 'vincent@cosulich.com.hk',
    buyerName: 'KAIYUAN CO LTD',
    buyerGroupName: 'KAIYUAN CO LTD',
    stemName: 'HK2524501T - UDE NOAH - YOSU',
    paymentName: 'Buyer payment - HK2524501T',
    receivedDate: '18 Feb 2026',
    insertedDate: '18 Feb 2026',
    delayDays: '11 Days',
    paymentAmount: '$51,101.00',
    receivableBalance: '$8,714.39',
    interestRate: '2.00% per month',
    interestRateField: 'Late Payment Interest Rate',
    interestTotal: '$374.74',
  };
  const to = renderInterestTemplate(settings.to ?? DEFAULT_INTEREST_EMAIL_SETTINGS.to, context);
  const cc = renderInterestTemplate(settings.cc ?? DEFAULT_INTEREST_EMAIL_SETTINGS.cc, context);
  const bcc = renderInterestTemplate(settings.bcc ?? DEFAULT_INTEREST_EMAIL_SETTINGS.bcc, context);
  const subject = renderInterestTemplate(settings.subject || DEFAULT_INTEREST_EMAIL_SETTINGS.subject, context);
  const body = renderInterestTemplate(settings.body || DEFAULT_INTEREST_EMAIL_SETTINGS.body, context);
  const tokenPattern = /\{\{\s*interestCalculationTable\s*\}\}/i;
  const tokenParagraphPattern = /<p\b[^>]*>\s*\{\{\s*interestCalculationTable\s*\}\}\s*<\/p>/i;
  const htmlContent = replaceInterestToken(
    interestContentHtml(body),
    INTEREST_STEM_LINK_TOKEN_PATTERN,
    interestStemLinkHtml(sampleStemUrl),
  )
    .replace(tokenParagraphPattern, sampleInterestCalculationHtml())
    .replace(tokenPattern, sampleInterestCalculationHtml());
  const html = `<div style="font-family:Inter,Arial,sans-serif;color:#1f2937;line-height:1.45">${htmlContent}</div>`;
  return { to, cc, bcc, subject, html };
}

function CompactTableEmptyState({ icon: Icon, title, description }) {
  return (
    <div className="flex min-h-12 items-center gap-3 rounded-lg border border-dashed border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
      {Icon && <Icon className="h-4 w-4 opacity-60" />}
      <div className="min-w-0">
        <p className="font-medium text-foreground">{title}</p>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
    </div>
  );
}

export default function IncomingPayments({ reconciliationItems = [], embedded = false }) {
  const { request: requestPayments } = useNavigationAwareRequest('collaboration');
  const { toast } = useToast();
  const { isAdministrator, hasCapability } = useAuth();
  const canManageFinancialReportSettings = hasCapability('financial_report_settings_manage');
  const [pageState, setPageState] = useState(initialPageState);
  const { dateFrom, dateTo, search, data, thresholdDrafts = [] } = pageState;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [responseMeta, setResponseMeta] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [selectedStemId, setSelectedStemId] = useState(readUrlStemId);
  const [emailOpen, setEmailOpen] = useState(false);
  const [savedEmailSettings, setSavedEmailSettings] = useState(DEFAULT_EMAIL_SETTINGS);
  const [emailSettings, setEmailSettings] = useState(() => savedEmailSettings);
  const [emailSettingsRevision, setEmailSettingsRevision] = useState(0);
  const [emailTemplateEditing, setEmailTemplateEditing] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailAction, setEmailAction] = useState('');
  const [emailPreview, setEmailPreview] = useState(null);
  const [emailError, setEmailError] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [interestTemplateOpen, setInterestTemplateOpen] = useState(false);
  const [savedInterestEmailSettings, setSavedInterestEmailSettings] = useState(DEFAULT_INTEREST_EMAIL_SETTINGS);
  const [interestEmailSettings, setInterestEmailSettings] = useState(() => savedInterestEmailSettings);
  const [interestSettingsRevision, setInterestSettingsRevision] = useState(0);
  const [interestTemplateEditing, setInterestTemplateEditing] = useState(false);
  const [interestPreview, setInterestPreview] = useState(null);
  const [interestTemplateMessage, setInterestTemplateMessage] = useState('');
  const [interestActiveField, setInterestActiveField] = useState('body');
  const [interestRequestLoading, setInterestRequestLoading] = useState({});
  const emailContentEditorRef = useRef(null);
  const interestToRef = useRef(null);
  const interestCcRef = useRef(null);
  const interestBccRef = useRef(null);
  const interestSubjectRef = useRef(null);
  const interestContentEditorRef = useRef(null);

  const updatePageState = (patch) => {
    setPageState((prev) => ({
      ...prev,
      ...(typeof patch === 'function' ? patch(prev) : patch),
    }));
  };

  const setDateFrom = (value) => updatePageState({ dateFrom: value });
  const setDateTo = (value) => updatePageState({ dateTo: value });
  const setSearch = (value) => updatePageState({ search: value });
  const setThresholdDrafts = (value) => updatePageState({ thresholdDrafts: value });

  useEffect(() => {
    writePageState(PAGE_STATE_KEY, pageState);
  }, [pageState]);

  const load = async (options = {}) => {
    setLoading(true);
    setError('');
    await requestPayments({
      name: 'incomingPaymentsList',
      payload: { dateFrom, dateTo, limit: 5000 },
      force: options.force,
      apply: (res) => {
        setResponseMeta(res.data?.error ? { ...res.meta, cacheStatus: 'UNAVAILABLE' } : res.meta);
        if (res.data?.error) setError(res.data.error);
        else {
          setError('');
          updatePageState({
            data: res.data,
            thresholdDrafts: (res.data?.settings?.thresholds || []).map((item) => ({
              currencyIsoCode: item.currencyIsoCode,
              threshold: String(item.threshold),
              revision: Number(item.revision || 0),
            })),
          });
        }
      },
    });
    setLoading(false);
  };

  useEffect(() => {
    if (!data) load();
  }, []);

  const reconciliationByStem = useMemo(() => new Map(
    reconciliationItems
      .filter((entry) => entry?.item?.stemId)
      .map((entry) => [entry.item.stemId, entry]),
  ), [reconciliationItems]);
  const rows = useMemo(() => (data?.rows || []).map((row) => {
    const live = reconciliationByStem.get(row.stemId);
    if (!live) return row;
    return {
      ...row,
      receivableBalance: live.item.verifiedReceivableBalance ?? row.receivableBalance,
      collection: live.item,
      collectionEvents: live.event ? [live.event, ...(row.collectionEvents || [])] : row.collectionEvents,
    };
  }), [data?.rows, reconciliationByStem]);
  const buyerCiaRows = data?.buyerCiaInvoices || [];
  const availableBalanceRows = data?.availableBalances || [];
  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => [
      row.partyName,
      row.stemName,
      row.keyStem,
      row.buyerName,
      row.buyerGroupName,
      row.supplierName,
      row.supplierInvoiceName,
    ].some((value) => lowerText(value).includes(query)));
  }, [rows, search]);
  const visibleBuyerCiaRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return buyerCiaRows;
    return buyerCiaRows.filter((row) => [
      row.buyerName,
      row.buyerGroupName,
      row.buyerTrader,
      row.stemName,
      row.keyStem,
    ].some((value) => lowerText(value).includes(query)));
  }, [buyerCiaRows, search]);

  const summary = data?.summary || {};
  const thresholdCount = data?.settings?.thresholds?.length || 0;
  const lastMeta = data?.dateFrom && data?.dateTo ? `${fmtDate(data.dateFrom)} to ${fmtDate(data.dateTo)}` : null;

  const markInterestInvoiceRequested = (paymentId, notification) => {
    updatePageState((prev) => ({
      data: prev.data ? {
        ...prev.data,
        rows: (prev.data.rows || []).map((row) => (
          (row.paymentId || row.id) === paymentId
            ? {
                ...row,
                interestInvoiceNotificationSent: true,
                interestInvoiceNotification: notification || row.interestInvoiceNotification || null,
              }
            : row
        )),
      } : prev.data,
    }));
  };

  const sendInterestInvoiceRequest = async (row, { force = false } = {}) => {
    const paymentId = row.paymentId || row.id;
    if (!paymentId) return;
    let forceResend = force;
    if (row.interestInvoiceNotificationSent && !forceResend) {
      const proceed = window.confirm('A late payment interest invoice request has already been sent for this payment. Send another request?');
      if (!proceed) return;
      forceResend = true;
    }
    setInterestRequestLoading((prev) => ({ ...prev, [paymentId]: true }));
    try {
      const res = await appClient.functions.invoke('incomingPaymentInterestInvoiceRequest', {
        paymentId,
        paymentName: row.paymentName || row.paymentDisplayName || row.salesforcePaymentName,
        stemId: row.stemId,
        stemName: row.stemName,
        buyerName: row.buyerName || row.partyName,
        partyName: row.partyName,
        buyerGroupName: row.buyerGroupName,
        paymentDate: row.paymentDate,
        createdDate: row.createdDate,
        delayDays: row.delayDays,
        amount: row.amount,
        invoiceAmount: row.invoiceAmount,
        currency: row.currency,
        receivableBalance: row.receivableBalance,
        force: forceResend,
      });
      if (res.data?.error) {
        toast({ title: 'Interest invoice request failed', description: res.data.error, variant: 'destructive' });
        return;
      }
      markInterestInvoiceRequested(paymentId, res.data?.notification || null);
      toast({
        title: res.data?.resent ? 'Interest invoice request sent again' : 'Interest invoice request sent',
        description: res.data?.trackingWarning || 'The approved recipients have been notified through the assigned Microsoft Graph mailbox.',
      });
    } catch (error) {
      toast({
        title: 'Interest invoice request failed',
        description: error?.message || 'Unexpected error while sending the notification.',
        variant: 'destructive',
      });
    } finally {
      setInterestRequestLoading((prev) => {
        const next = { ...prev };
        delete next[paymentId];
        return next;
      });
    }
  };

  const receivableColumns = useMemo(() => [
    {
      id: 'receivedDate',
      header: 'Received Date',
      headerClassName: 'whitespace-nowrap',
      cellClassName: 'whitespace-nowrap text-sm',
      cell: (row) => {
        const inserted = insertedDateText(row);
        return (
          <div>
            <div>{fmtDate(row.paymentDate)}</div>
            {inserted && <div className="text-xs font-semibold text-amber-700">{inserted}</div>}
          </div>
        );
      },
    },
    {
      id: 'paymentTerms',
      header: 'Terms',
      headerClassName: 'w-[80px] whitespace-nowrap text-right',
      cellClassName: 'w-[80px] max-w-[80px] whitespace-normal text-right text-xs leading-tight',
      cell: (row) => row.type === 'Buyer Payment' ? row.paymentTerms || '-' : 'N/A',
    },
    {
      id: 'delay',
      header: 'Delay',
      headerClassName: 'w-[70px] whitespace-nowrap text-right',
      cellClassName: 'w-[70px] whitespace-nowrap text-right text-sm tabular-nums',
      cell: (row) => row.type === 'Buyer Payment' ? (row.delayDays == null ? '-' : row.delayDays) : 'N/A',
    },
    {
      id: 'from',
      header: 'From',
      cellClassName: 'max-w-[220px] text-sm',
      cell: (row) => (
        <div className="space-y-1">
          <div className="font-medium text-foreground">{row.partyName || '-'}</div>
          {row.type !== 'Buyer Payment' && <PaymentStatusBadge row={row} />}
          {row.type === 'Buyer Payment' && row.status && !['Partially paid', 'Fully paid'].includes(row.status) && (
            <div className="text-xs font-semibold text-amber-700">{row.status}</div>
          )}
        </div>
      ),
    },
    { id: 'group', header: 'Group', cellClassName: 'min-w-[160px] text-sm', cell: (row) => row.buyerGroupName || '-' },
    {
      id: 'stem',
      header: 'STEM',
      cellClassName: 'min-w-[240px] text-sm',
      cell: (row) => <StemDetailLink stemId={row.stemId} onOpen={setSelectedStemId}>{row.stemName || '-'}</StemDetailLink>,
    },
    {
      id: 'amount',
      header: 'Amount',
      headerClassName: 'text-right',
      cellClassName: 'whitespace-nowrap text-right font-medium',
      cell: (row) => (
        <div>
          <div>{fmtMoney(row.amount, row.currency)}</div>
          {(row.bankCharges || []).map((charge) => (
            <div key={charge.id || charge.paymentId} className="text-xs font-semibold text-amber-700">
              Bank Charge {fmtMoney(charge.amount, charge.currency || row.currency)}
            </div>
          ))}
        </div>
      ),
    },
    {
      id: 'receivable',
      header: 'Receivable',
      headerClassName: 'text-right',
      cellClassName: 'whitespace-nowrap text-right',
      cell: (row) => (
        <span className={cn(Number(row.receivableBalance) < 0 && 'font-semibold text-violet-700')}>
          {row.receivableBalance == null ? '-' : fmtMoney(row.receivableBalance, row.currency)}
        </span>
      ),
    },
    {
      id: 'collection',
      header: 'Collection',
      cellClassName: 'min-w-[170px] text-sm',
      cell: (row) => row.stemId ? (
        <a
          href={`/payment-collections?tab=collections&collectionStemId=${encodeURIComponent(row.stemId)}`}
          onClick={(event) => event.stopPropagation()}
          className="block rounded-md px-2 py-1 hover:bg-muted"
        >
          <span className="font-medium text-primary">{row.collection?.status || 'To Contact'}</span>
          <span className="block text-xs text-muted-foreground">{row.collection?.ownerName || 'Unassigned'}{row.collection?.nextFollowUpDate ? ` · ${fmtDate(row.collection.nextFollowUpDate)}` : ''}</span>
          {row.collection?.adviceReceivedDate && (
            <span className="block text-xs font-medium text-cyan-700">
              Advice {fmtDate(row.collection.adviceReceivedDate)}{row.collection.adviceAmount != null ? ` · ${fmtMoney(row.collection.adviceAmount, row.currency)}` : ''}
            </span>
          )}
        </a>
      ) : '-',
    },
    {
      id: 'interestInvoice',
      header: 'Interest Invoice',
      headerClassName: 'text-right whitespace-nowrap',
      cellClassName: 'text-right whitespace-nowrap',
      cell: (row) => {
        const paymentId = row.paymentId || row.id;
        const eligible = row.type === 'Buyer Payment' && Number(row.delayDays) > 3;
        if (!eligible) return <span className="text-muted-foreground">N/A</span>;
        const sent = Boolean(row.interestInvoiceNotificationSent);
        const loadingRequest = Boolean(interestRequestLoading[paymentId]);
        const sentLabel = row.interestInvoiceNotification?.sentAt ? `Requested ${fmtDate(row.interestInvoiceNotification.sentAt)}` : 'Requested';
        return (
          <Button
            variant={sent ? 'secondary' : 'outline'}
            size="sm"
            disabled={loadingRequest}
            title={sentLabel}
            className={cn(sent && 'bg-slate-700 text-white hover:bg-slate-800')}
            onClick={(event) => {
              event.stopPropagation();
              sendInterestInvoiceRequest(row);
            }}
          >
            {loadingRequest ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
            {sent ? 'Request Again' : 'Request'}
          </Button>
        );
      },
    },
  ], [interestRequestLoading, sendInterestInvoiceRequest]);

  const ciaColumns = useMemo(() => [
    { id: 'buyer', header: 'Buyer', cellClassName: 'min-w-[220px] text-sm font-medium', cell: (row) => row.buyerName || '-' },
    { id: 'group', header: 'Group', cellClassName: 'min-w-[180px] text-sm', cell: (row) => row.buyerGroupName || '-' },
    { id: 'buyerTrader', header: 'Buyer Trader', cellClassName: 'min-w-[160px] text-sm', cell: (row) => row.buyerTrader || '-' },
    {
      id: 'stem',
      header: 'STEM',
      cellClassName: 'min-w-[240px] text-sm',
      cell: (row) => <StemDetailLink stemId={row.stemId} onOpen={setSelectedStemId}>{row.stemName || '-'}</StemDetailLink>,
    },
    {
      id: 'calculatedAmount',
      header: 'Calculated Amount',
      headerClassName: 'text-right',
      cellClassName: 'whitespace-nowrap text-right font-medium',
      cell: (row) => fmtMoney(row.calculatedAmount),
    },
    {
      id: 'receivableBalance',
      header: 'Receivable Balance',
      headerClassName: 'text-right',
      cellClassName: 'whitespace-nowrap text-right',
      cell: (row) => fmtMoney(row.receivableBalance),
    },
    {
      id: 'deliveryDate',
      header: 'Delivery Date',
      headerClassName: 'whitespace-nowrap',
      cellClassName: 'whitespace-nowrap text-sm',
      cell: (row) => fmtDate(row.deliveryDate),
    },
  ], []);

  const availableBalanceColumns = useMemo(() => [
    { id: 'group', header: 'Buyer Group', cellClassName: 'min-w-[220px] font-medium', cell: (group) => group.buyerGroupName },
    { id: 'buyers', header: 'Buyers', cellClassName: 'min-w-[220px] text-sm text-muted-foreground', cell: (group) => group.buyerNames?.join(', ') || '-' },
    {
      id: 'stems',
      header: 'Overpaid STEMs',
      cellClassName: 'min-w-[320px] text-xs',
      cell: (group) => (
        <>
          {(group.stems || []).map((stem) => (
            <div key={stem.stemId} className="py-0.5">
              <StemDetailLink stemId={stem.stemId} onOpen={setSelectedStemId}>{stem.stemName}</StemDetailLink>
              <span className="ml-2 text-muted-foreground">{fmtMoney(stem.availableBalance)}</span>
            </div>
          ))}
        </>
      ),
    },
    {
      id: 'balance',
      header: 'Available Balance',
      headerClassName: 'text-right',
      cellClassName: 'whitespace-nowrap text-right font-semibold text-violet-700',
      cell: (group) => fmtMoney(group.totalAvailableBalance),
    },
  ], []);

  const saveSettings = async () => {
    if (!canManageFinancialReportSettings) {
      toast({ title: 'Access required', description: 'Finance, Administrators, and the General Manager can change payment thresholds.' });
      return;
    }
    const normalized = thresholdDrafts.map((item) => ({
      currencyIsoCode: String(item.currencyIsoCode || '').trim().toUpperCase(),
      threshold: Number(item.threshold),
      expectedRevision: Number(item.revision || 0),
    }));
    if (normalized.some((item) => !/^[A-Z]{3}$/.test(item.currencyIsoCode) || !Number.isFinite(item.threshold) || item.threshold < 0)) {
      toast({ title: 'Thresholds are incomplete', description: 'Each row needs a three-letter currency code and a non-negative threshold.', variant: 'destructive' });
      return;
    }
    if (new Set(normalized.map((item) => item.currencyIsoCode)).size !== normalized.length) {
      toast({ title: 'Duplicate currency', description: 'Each currency can appear only once.', variant: 'destructive' });
      return;
    }
    setSavingSettings(true);
    const changed = normalized.filter((item) => {
      const current = data?.settings?.byCurrency?.[item.currencyIsoCode];
      return !current || Number(current.threshold) !== item.threshold;
    });
    if (!changed.length) {
      setSavingSettings(false);
      setSettingsOpen(false);
      return;
    }
    const res = await appClient.functions.invoke('incomingPaymentSettingsSave', { thresholds: changed }, { invalidateCache: true });
    setSavingSettings(false);
    if (res.data?.error) {
      toast({ title: 'Save failed', description: res.data.error, variant: 'destructive' });
      return;
    }
    toast({ title: 'Payment thresholds saved', description: 'Collection reconciliation will use the configured threshold for each currency.' });
    setSettingsOpen(false);
    appClient.functions.clearCache();
    load({ force: true });
  };

  const updateEmailSetting = (field, value) => {
    setEmailSettings((prev) => ({ ...prev, [field]: value }));
  };

  const startEmailTemplateEdit = () => {
    setSavedEmailSettings(emailSettings);
    setEmailTemplateEditing(true);
    setEmailMessage('');
    setEmailError('');
  };

  const saveEmailTemplate = async () => {
    setEmailBusy(true);
    const res = await appClient.functions.invoke('incomingPaymentEmailSettingsSave', {
      settings: emailSettings,
      expectedRevision: emailSettingsRevision,
    }, { invalidateCache: true });
    setEmailBusy(false);
    if (res.data?.error) {
      setEmailError(res.data.error);
      toast({ title: 'Template save failed', description: res.data.error, variant: 'destructive' });
      return;
    }
    const saved = { ...DEFAULT_EMAIL_SETTINGS, ...(res.data?.settings || emailSettings) };
    setEmailSettings(saved);
    setSavedEmailSettings(saved);
    const savedRevision = Number(res.data?.revision || emailSettingsRevision + 1);
    setEmailSettingsRevision(savedRevision);
    setEmailTemplateEditing(false);
    toast({ title: 'Incoming Payment email template saved' });
    await runEmailReport(true, savedRevision);
  };

  const cancelEmailTemplateChanges = () => {
    setEmailSettings(savedEmailSettings);
    setEmailTemplateEditing(false);
    setEmailMessage('');
    setEmailError('');
  };

  const insertEmailToken = (token) => {
    if (!emailTemplateEditing) return;
    const editor = emailContentEditorRef.current?.getEditor?.();
    if (!editor) {
      updateEmailSetting('intro', `${emailSettings.intro || ''}<p>${token}</p>`);
      return;
    }
    const uniqueTokens = [RECEIVABLE_PAYMENTS_TABLE_TOKEN, BUYER_CIA_TABLE_TOKEN].includes(token) ? [token] : [];
    insertTokenIntoQuill(editor, token, uniqueTokens);
  };

  const openEmailReport = async () => {
    setEmailTemplateEditing(false);
    setEmailOpen(true);
    setEmailPreview(null);
    setEmailError('');
    setEmailMessage('Loading the approved recipients and current report...');
    setEmailBusy(true);
    setEmailAction('preview');
    try {
      const [settingsResult, previewResult] = await Promise.all([
        appClient.functions.invoke('incomingPaymentEmailSettingsGet', {}, { force: true }),
        appClient.functions.invoke('incomingPaymentEmailReport', {
          dateFrom,
          dateTo,
          search,
          preview: true,
        }),
      ]);
      const settingsError = settingsResult.data?.error;
      const previewError = previewResult.data?.error;
      if (settingsError || previewError) {
        setEmailError(settingsError || previewError);
        setEmailMessage('');
        return;
      }
      const settingsRevision = Number(settingsResult.data?.revision || 0);
      const previewRevision = Number(previewResult.data?.settingsRevision || 0);
      if (settingsRevision < 1 || previewRevision !== settingsRevision) {
        setEmailError('The approved report settings changed while this review was loading. Close and reopen the report.');
        setEmailMessage('');
        return;
      }
      const saved = { ...DEFAULT_EMAIL_SETTINGS, ...(settingsResult.data?.settings || {}) };
      setSavedEmailSettings(saved);
      setEmailSettings(saved);
      setEmailSettingsRevision(settingsRevision);
      setEmailPreview(previewResult.data?.email || null);
      setEmailMessage(`Ready to send: ${previewResult.data?.report?.receivableRows ?? 0} receivable payments and ${previewResult.data?.report?.buyerCiaRows ?? 0} Buyer CIA invoices.`);
    } catch (loadError) {
      setEmailError(loadError?.message || 'The Incoming Payment report review could not be loaded.');
      setEmailMessage('');
    } finally {
      setEmailBusy(false);
      setEmailAction('');
    }
  };

  const updateInterestEmailSetting = (field, value) => {
    setInterestEmailSettings((prev) => ({ ...prev, [field]: value }));
  };

  const openInterestTemplate = async () => {
    setInterestTemplateEditing(false);
    setInterestPreview(null);
    setInterestTemplateMessage('Loading approved recipients and template...');
    setInterestTemplateOpen(true);
    const res = await appClient.functions.invoke('incomingPaymentInterestSettingsGet', {}, { force: true });
    if (res.data?.error) {
      setInterestTemplateMessage(res.data.error);
      return;
    }
    const saved = {
      ...DEFAULT_INTEREST_EMAIL_SETTINGS,
      ...(res.data?.settings || {}),
      body: richTemplateValue(res.data?.settings?.body || ''),
    };
    setSavedInterestEmailSettings(saved);
    setInterestEmailSettings(saved);
    setInterestSettingsRevision(Number(res.data?.revision || 0));
    setInterestPreview(buildInterestPreview(saved));
    setInterestTemplateMessage('');
  };

  const closeInterestTemplate = () => {
    if (interestTemplateEditing && JSON.stringify(interestEmailSettings) !== JSON.stringify(savedInterestEmailSettings)) {
      const discard = window.confirm('Discard unsaved late payment interest email template changes?');
      if (!discard) return;
      setInterestEmailSettings(savedInterestEmailSettings);
      setInterestTemplateEditing(false);
    }
    setInterestTemplateOpen(false);
  };

  const startInterestTemplateEdit = () => {
    setSavedInterestEmailSettings(interestEmailSettings);
    setInterestTemplateEditing(true);
    setInterestTemplateMessage('');
  };

  const saveInterestTemplate = async () => {
    const res = await appClient.functions.invoke('incomingPaymentInterestSettingsSave', {
      settings: interestEmailSettings,
      expectedRevision: interestSettingsRevision,
    }, { invalidateCache: true });
    if (res.data?.error) {
      setInterestTemplateMessage(res.data.error);
      toast({ title: 'Template save failed', description: res.data.error, variant: 'destructive' });
      return;
    }
    const saved = { ...interestEmailSettings };
    setSavedInterestEmailSettings(saved);
    setInterestSettingsRevision(Number(res.data?.revision || interestSettingsRevision + 1));
    setInterestTemplateEditing(false);
    setInterestTemplateMessage('Late payment interest request template saved.');
    toast({ title: 'Late payment interest template saved' });
  };

  const cancelInterestTemplateChanges = () => {
    setInterestEmailSettings(savedInterestEmailSettings);
    setInterestTemplateEditing(false);
    setInterestTemplateMessage('');
    setInterestPreview(buildInterestPreview(savedInterestEmailSettings));
  };

  const insertInterestTextToken = (field, token) => {
    const refs = {
      to: interestToRef,
      cc: interestCcRef,
      bcc: interestBccRef,
      subject: interestSubjectRef,
    };
    const target = refs[field]?.current;
    const current = interestEmailSettings[field] || '';
    const start = target?.selectionStart ?? current.length;
    const end = target?.selectionEnd ?? start;
    const next = `${current.slice(0, start)}${token}${current.slice(end)}`;
    updateInterestEmailSetting(field, next);
    window.requestAnimationFrame(() => {
      target?.focus();
      target?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const insertInterestBodyToken = (token) => {
    if (!interestTemplateEditing) return;
    const editor = interestContentEditorRef.current?.getEditor?.();
    if (!editor) {
      updateInterestEmailSetting('body', `${interestEmailSettings.body || ''}<p>${token}</p>`);
      return;
    }
    const uniqueTokens = [INTEREST_CALCULATION_TABLE_TOKEN, STEM_LINK_TOKEN].includes(token) ? [token] : [];
    insertTokenIntoQuill(editor, token, uniqueTokens);
  };

  const insertInterestToken = (token) => {
    if (!interestTemplateEditing) return;
    if (interestActiveField === 'body') insertInterestBodyToken(token);
    else insertInterestTextToken(interestActiveField, token);
  };

  const dropInterestToken = (field, event) => {
    if (!interestTemplateEditing) return;
    event.preventDefault();
    const token = event.dataTransfer.getData('text/plain');
    if (!token) return;
    setInterestActiveField(field);
    if (field === 'body') insertInterestBodyToken(token);
    else insertInterestTextToken(field, token);
  };

  const previewInterestTemplate = () => {
    setInterestPreview(buildInterestPreview(interestEmailSettings));
    setInterestTemplateMessage('Preview generated with a sample buyer payment record.');
  };

  const closeEmailReport = () => {
    if (emailTemplateEditing && JSON.stringify(emailSettings) !== JSON.stringify(savedEmailSettings)) {
      const discard = window.confirm('Discard unsaved Incoming Payment email template changes?');
      if (!discard) return;
      cancelEmailTemplateChanges();
    }
    setEmailOpen(false);
  };

  const runEmailReport = async (preview = true, reviewedSettingsRevision = emailSettingsRevision) => {
    if (!preview && !String(emailSettings.to || '').trim()) {
      const message = 'Enter at least one To recipient before sending.';
      setEmailError(message);
      toast({ title: 'Email send failed', description: message, variant: 'destructive' });
      return;
    }
    setEmailBusy(true);
    setEmailAction(preview ? 'preview' : 'send');
    setEmailError('');
    setEmailMessage('');
    try {
      const res = await appClient.functions.invoke('incomingPaymentEmailReport', {
        dateFrom,
        dateTo,
        search,
        preview,
        expectedSettingsRevision: reviewedSettingsRevision,
      });
      if (res.data?.error) {
        setEmailError(res.data.error);
        toast({
          title: preview ? 'Email preview failed' : 'Email send failed',
          description: res.data.error,
          variant: 'destructive',
        });
      } else if (preview) {
        if (Number(res.data?.settingsRevision || 0) !== Number(reviewedSettingsRevision || 0)) {
          const message = 'The approved recipients or template changed after this report was opened. Close and reopen it before sending.';
          setEmailPreview(null);
          setEmailError(message);
          return;
        }
        setEmailPreview(res.data.email || null);
        setEmailMessage(`Preview ready: ${res.data.report?.receivableRows ?? 0} receivable payments and ${res.data.report?.buyerCiaRows ?? 0} Buyer CIA invoices.`);
      } else {
        setEmailPreview(res.data.email || null);
        toast({ title: 'Incoming Payment report sent', description: `Sent to ${res.data.to?.join(', ') || emailSettings.to}.` });
        setEmailOpen(false);
      }
    } catch (error) {
      const message = error?.message || 'Unexpected error while sending Incoming Payment report.';
      setEmailError(message);
      toast({
        title: preview ? 'Email preview failed' : 'Email send failed',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setEmailBusy(false);
      setEmailAction('');
    }
  };

  return (
    <div className="min-h-screen bg-background px-4 py-5 md:px-6">
      <PageHeader
        icon={Banknote}
        eyebrow="Salesforce payments"
        title="Incoming Payment"
        sticky={!embedded}
        description="Manage receivable buyer payments, supplier refunds, currency-specific settlement thresholds, and buyer-group overpayment balances from Salesforce payment records."
        meta={lastMeta ? `Payment created date range: ${lastMeta}. ${thresholdCount} configured currency threshold${thresholdCount === 1 ? '' : 's'}; all others use <0.005.` : null}
        actions={(
          <>
            <DataStatus meta={responseMeta} state={loading ? 'refreshing' : undefined} label="Salesforce" />
            <Button variant="outline" onClick={() => setSettingsOpen(true)}>
              <Settings2 className="mr-2 h-4 w-4" />
              Global Settings
            </Button>
            <Button variant="outline" onClick={openEmailReport}>
              <Mail className="mr-2 h-4 w-4" />
              Internal Report
            </Button>
            <Button variant="outline" onClick={openInterestTemplate}>
              <Pencil className="mr-2 h-4 w-4" />
              Interest Request Template
            </Button>
            <Button onClick={() => load({ force: true })} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh
            </Button>
          </>
        )}
      />

      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Incoming Total"
          value={fmtMoney(summary.totalIncomingAmount)}
          sub={`Buyer Payments ${fmtMoney(summary.buyerPaymentTotal)} · Supplier Refunds ${fmtMoney(summary.supplierRefundTotal)} · ${summary.incomingRows || 0} records`}
          icon={Banknote}
          color="green"
        />
        <StatCard label="Needs Review" value={String(summary.unmatchedCount || 0)} sub="Unmatched or incomplete payments" icon={AlertTriangle} color="amber" />
      </div>

      <TableShell
        title="Buyer CIA Invoices"
        meta={`${visibleBuyerCiaRows.length.toLocaleString()} visible of ${buyerCiaRows.length.toLocaleString()} unpaid CIA buyer invoice stems`}
        className="mb-4"
      >
        {visibleBuyerCiaRows.length > 0 ? (
          <div className={cn(visibleBuyerCiaRows.length > 5 ? 'max-h-[360px] overflow-auto' : 'overflow-visible')}>
            <ReorderableDataTable
              tableKey="incoming-payment-cia-invoices"
              columns={ciaColumns}
              rows={visibleBuyerCiaRows}
              rowKey={(row) => row.stemId}
              isReorderEnabled={isAdministrator}
              rowClassName="hover:bg-muted/40"
            />
          </div>
        ) : (
          <CompactTableEmptyState
            icon={Search}
            title="No unpaid CIA buyer invoices"
            description="No open buyer invoice STEMs with CIA payment terms were found."
          />
        )}
      </TableShell>

      <TableShell
        title="Payment Filters"
        meta="Filters use Payment__c CreatedDate on a Hong Kong date basis. Received Date remains the payment value date."
        bodyClassName="p-4"
        className="mb-4"
      >
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_2fr_auto] md:items-end">
          <div>
            <Label className="text-xs text-muted-foreground">Created From</Label>
            <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Created To</Label>
            <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Keyword</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search STEM, buyer, group, or supplier" />
            </div>
          </div>
          <Button variant="outline" onClick={() => load({ force: true })} disabled={loading}>
            Apply
          </Button>
        </div>
      </TableShell>

      {data?.schemaWarnings?.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {data.schemaWarnings.map((warning) => <p key={warning}>{warning}</p>)}
        </div>
      )}

      {error && (
        <StateBlock
          icon={AlertTriangle}
          title="Unable to load incoming payments"
          description={error}
          action={<Button variant="outline" onClick={() => load({ force: true })}>Try Again</Button>}
        />
      )}

      {!error && (
        <>
          <TableShell
            title="Receivable Payments"
            meta={`${visibleRows.length.toLocaleString()} visible of ${rows.length.toLocaleString()} records`}
            className="mb-4"
          >
            <div className="max-h-[52vh] overflow-auto">
              <ReorderableDataTable
                tableKey="incoming-payment-receivable-payments"
                columns={receivableColumns}
                rows={visibleRows}
                rowKey={(row) => row.id}
                loading={loading}
                loadingTitle="Loading receivable payments"
                emptyIcon={Search}
                emptyTitle="No payments found"
                emptyDescription="Adjust the filters or refresh the Salesforce data."
                isReorderEnabled={isAdministrator}
                rowClassName="hover:bg-muted/40"
              />
            </div>
          </TableShell>

          <TableShell
            title="Available Buyer Balances"
            meta="Overpaid STEMs are grouped by buyer group. Allocation is limited to the same buyer group."
          >
            {availableBalanceRows.length > 0 ? (
              <div className={cn(availableBalanceRows.length > 5 ? 'max-h-[360px] overflow-auto' : 'overflow-visible')}>
                <ReorderableDataTable
                  tableKey="incoming-payment-available-balances"
                  columns={availableBalanceColumns}
                  rows={availableBalanceRows}
                  rowKey={(group) => group.buyerGroupName}
                  isReorderEnabled={isAdministrator}
                  rowClassName="hover:bg-muted/40"
                />
              </div>
            ) : (
              <CompactTableEmptyState
                icon={WalletCards}
                title="No available buyer balances"
                description="No linked STEM has Receivable_Balance__c below zero in this payment range."
              />
            )}
          </TableShell>
        </>
      )}

      <PaymentCollectionThresholdsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        drafts={thresholdDrafts}
        onDraftsChange={setThresholdDrafts}
        canManage={canManageFinancialReportSettings}
        saving={savingSettings}
        onSave={saveSettings}
      />

      <Dialog open={emailOpen} onOpenChange={(open) => (open ? setEmailOpen(true) : closeEmailReport())}>
        <DialogContent className="max-h-[94vh] w-[96vw] max-w-[1500px] gap-0 overflow-hidden p-0 text-slate-950">
          <DialogHeader className="border-b border-slate-200 px-5 py-4 text-left">
            <div className="flex flex-wrap items-start justify-between gap-4 pr-8">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Incoming Payment</p>
                <DialogTitle className="mt-1 text-xl font-semibold text-slate-950">Incoming Payments Internal Report</DialogTitle>
                <DialogDescription className="mt-1 text-sm text-slate-500">
                  Uses the current payment-created date range and keyword filter.
                </DialogDescription>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <div><span className="font-semibold text-slate-900">Created:</span> {fmtDate(dateFrom)} to {fmtDate(dateTo)}</div>
                <div className="mt-1"><span className="font-semibold text-slate-900">Keyword:</span> {search || '-'}</div>
              </div>
            </div>
          </DialogHeader>

          <div className="max-h-[calc(94vh-152px)] overflow-auto px-5 py-4">
            <div className="space-y-4">
              <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Receivable payments</div>
                      <div className="mt-1 text-lg font-semibold text-slate-950">{visibleRows.length.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Buyer CIA invoices</div>
                      <div className="mt-1 text-lg font-semibold text-slate-950">{visibleBuyerCiaRows.length.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Incoming total</div>
                      <div className="mt-1 text-lg font-semibold text-slate-950">{fmtMoney(summary.totalIncomingAmount)}</div>
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  <div><span className="font-semibold text-slate-900">To:</span> {emailSettings.to || '-'}</div>
                  <div className="mt-1"><span className="font-semibold text-slate-900">CC:</span> {emailSettings.cc || '-'}</div>
                  <div className="mt-1"><span className="font-semibold text-slate-900">BCC:</span> {emailSettings.bcc || '-'}</div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-950">Review and send</h3>
                  <p className="text-xs text-slate-500">One review surface. FCOS rebuilds the report from live data immediately before delivery.</p>
                </div>
                <div
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium',
                    emailBusy && emailAction === 'preview'
                      ? 'border-blue-200 bg-blue-50 text-blue-700'
                      : emailPreview
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 bg-slate-50 text-slate-600',
                  )}
                  role="status"
                >
                  {emailBusy && emailAction === 'preview' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                  {emailBusy && emailAction === 'preview' ? 'Preparing live review' : emailPreview ? 'Live review ready' : 'Review unavailable'}
                </div>
              </div>

              {emailError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {emailError}
                </div>
              )}

              <div className="space-y-3">
                  <div>
                    <h3 className="text-base font-semibold text-slate-950">Review report</h3>
                    <p className="text-xs text-slate-500">The email will use the same filters currently applied on this page.</p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Created from</div>
                      <div className="mt-1 text-sm font-semibold text-slate-950">{fmtDate(dateFrom)}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Created to</div>
                      <div className="mt-1 text-sm font-semibold text-slate-950">{fmtDate(dateTo)}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Keyword</div>
                      <div className="mt-1 truncate text-sm font-semibold text-slate-950">{search || '-'}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Settlement policy</div>
                      <div className="mt-1 text-sm font-semibold text-slate-950">{thresholdCount.toLocaleString()} configured · fallback &lt;0.005</div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="text-sm font-semibold text-slate-950">Report tables</div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                        <div className="text-sm font-medium text-slate-900">Receivable Payments</div>
                        <div className="mt-1 text-xs text-slate-500">{visibleRows.length.toLocaleString()} rows matched by current filters.</div>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                        <div className="text-sm font-medium text-slate-900">Buyer CIA Invoices</div>
                        <div className="mt-1 text-xs text-slate-500">{visibleBuyerCiaRows.length.toLocaleString()} rows matched by current filters.</div>
                      </div>
                    </div>
                  </div>
              </div>

              <div className="space-y-3">
                  <div>
                    <h3 className="text-base font-semibold text-slate-950">Review recipients</h3>
                    <p className="text-xs text-slate-500">Only the addresses shown here will be used for this send.</p>
                  </div>
                  <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 md:grid-cols-2">
                    <div className="space-y-1.5 md:col-span-2">
                      <Label className="text-xs text-slate-500">To</Label>
                      <Input value={emailSettings.to} onChange={(event) => updateEmailSetting('to', event.target.value)} disabled={!emailTemplateEditing} placeholder="email@example.com" className={cn(!String(emailSettings.to || '').trim() && 'border-red-300 focus-visible:ring-red-400')} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-500">CC</Label>
                      <Input value={emailSettings.cc} onChange={(event) => updateEmailSetting('cc', event.target.value)} disabled={!emailTemplateEditing} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-500">BCC</Label>
                      <Input value={emailSettings.bcc} onChange={(event) => updateEmailSetting('bcc', event.target.value)} disabled={!emailTemplateEditing} />
                    </div>
                  </div>
              </div>

              <div className="space-y-3">
                  <div>
                    <h3 className="text-base font-semibold text-slate-950">Email preview</h3>
                    <p className="text-xs text-slate-500">Edit the saved template when needed, then preview and send.</p>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-[minmax(0,520px)_minmax(0,1fr)]">
                    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
                      {emailTemplateEditing && (
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <div className="flex flex-wrap gap-2">
                            {EMAIL_TABLE_TOKENS.map((item) => (
                              <button
                                key={item.token}
                                type="button"
                                draggable
                                onClick={() => insertEmailToken(item.token)}
                                onDragStart={(event) => {
                                  event.dataTransfer.setData('text/plain', item.token);
                                  event.dataTransfer.effectAllowed = 'copy';
                                }}
                                className="cursor-grab rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                                title="Drag into the template or click to insert"
                              >
                                {item.label}
                              </button>
                            ))}
                          </div>
                          <p className="mt-2 text-xs text-slate-500">Drag table tokens into the content to move the generated tables.</p>
                        </div>
                      )}
                      <div className="space-y-1.5">
                        <Label className="text-xs text-slate-500">Subject</Label>
                        <Input value={emailSettings.subject} onChange={(event) => updateEmailSetting('subject', event.target.value)} disabled={!emailTemplateEditing} />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-slate-500">Email content</Label>
                        <div
                          className={cn(
                            'rounded-md border border-slate-200 bg-white [&_.ql-container]:min-h-[360px] [&_.ql-container]:border-0 [&_.ql-toolbar]:border-0 [&_.ql-toolbar]:border-b [&_.ql-toolbar]:border-slate-200',
                            !emailTemplateEditing && 'opacity-85',
                          )}
                          onDragOver={(event) => emailTemplateEditing && event.preventDefault()}
                          onDrop={(event) => {
                            if (!emailTemplateEditing) return;
                            event.preventDefault();
                            const token = event.dataTransfer.getData('text/plain');
                            if (token) insertEmailToken(token);
                          }}
                        >
                          <ReactQuill
                            ref={emailContentEditorRef}
                            theme="snow"
                            modules={QUILL_MODULES}
                            value={emailSettings.intro}
                            readOnly={!emailTemplateEditing}
                            onChange={(value) => updateEmailSetting('intro', value)}
                          />
                        </div>
                        <p className="text-xs text-slate-500">
                          Table tokens: <span className="font-mono">{RECEIVABLE_PAYMENTS_TABLE_TOKEN}</span> and <span className="font-mono">{BUYER_CIA_TABLE_TOKEN}</span>
                        </p>
                      </div>
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-white">
                      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-3 py-2">
                        <div>
                          <div className="text-sm font-semibold text-slate-950">Preview</div>
                          <div className="mt-1 grid gap-1 text-xs text-slate-500">
                            <div><span className="font-semibold text-slate-900">To:</span> {emailSettings.to || '-'}</div>
                            <div><span className="font-semibold text-slate-900">CC:</span> {emailSettings.cc || '-'}</div>
                            <div><span className="font-semibold text-slate-900">BCC:</span> {emailSettings.bcc || '-'}</div>
                            <div><span className="font-semibold text-slate-900">Subject:</span> {emailPreview?.subject || emailSettings.subject || '-'}</div>
                          </div>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => runEmailReport(true)} disabled={emailBusy || emailTemplateEditing}>
                          {emailAction === 'preview' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
                          {emailAction === 'preview' ? 'Refreshing' : 'Refresh Preview'}
                        </Button>
                      </div>
                      <div className="max-h-[58vh] overflow-auto p-4">
                        {emailPreview?.html ? (
                          <div
                            className="rounded-lg border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-900"
                            dangerouslySetInnerHTML={{ __html: emailPreview.html }}
                          />
                        ) : (
                          <div className="flex h-[360px] items-center justify-center rounded-lg border border-dashed border-slate-200 text-sm text-slate-500">
                            Generate a preview before sending.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {emailMessage && !emailError && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                      {emailMessage}
                    </div>
                  )}
              </div>
            </div>
          </div>

          <DialogFooter className="border-t border-slate-200 bg-slate-50 px-5 py-3">
            <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-h-9 flex-1">
                {emailError && (
                  <div className="inline-flex max-w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {emailError}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {!emailTemplateEditing ? (
                    canManageFinancialReportSettings && (
                    <Button type="button" variant="outline" onClick={startEmailTemplateEdit} disabled={emailBusy}>
                      <Pencil className="mr-2 h-4 w-4" />
                      Edit Recipients & Template
                    </Button>
                    )
                  ) : (
                    <>
                      <Button type="button" variant="outline" onClick={cancelEmailTemplateChanges} disabled={emailBusy}>
                        <X className="mr-2 h-4 w-4" />
                        Cancel
                      </Button>
                      <Button type="button" variant="outline" onClick={saveEmailTemplate} disabled={emailBusy || JSON.stringify(emailSettings) === JSON.stringify(savedEmailSettings)}>
                        <Save className="mr-2 h-4 w-4" />
                        Save Template
                      </Button>
                    </>
                  )}
                <Button type="button" variant="outline" onClick={closeEmailReport} disabled={emailBusy}>Close</Button>
                <Button type="button" onClick={() => runEmailReport(false)} disabled={emailBusy || emailTemplateEditing || !emailPreview || emailSettingsRevision < 1 || !String(emailSettings.to || '').trim()}>
                    {emailAction === 'send' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                    {emailAction === 'send' ? 'Sending' : 'Send Internal Report'}
                </Button>
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={interestTemplateOpen} onOpenChange={(open) => (open ? setInterestTemplateOpen(true) : closeInterestTemplate())}>
        <DialogContent className="max-h-[92vh] w-[96vw] max-w-[1400px] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Late Payment Interest Request Email</DialogTitle>
            <DialogDescription>
              Template used by the row-level Request button. Delivery uses the Internal sender in Settings.
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[70vh] gap-4 overflow-hidden pr-1 lg:grid-cols-[430px_minmax(0,1fr)]">
            <div className="space-y-3 overflow-auto pr-1">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-xs text-muted-foreground">To</Label>
                  <Input
                    ref={interestToRef}
                    value={interestEmailSettings.to}
                    onFocus={() => setInterestActiveField('to')}
                    onDragOver={(event) => interestTemplateEditing && event.preventDefault()}
                    onDrop={(event) => dropInterestToken('to', event)}
                    onChange={(event) => updateInterestEmailSetting('to', event.target.value)}
                    disabled={!interestTemplateEditing}
                    placeholder="Approved Finance recipient"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Cc</Label>
                  <Input
                    ref={interestCcRef}
                    value={interestEmailSettings.cc}
                    onFocus={() => setInterestActiveField('cc')}
                    onDragOver={(event) => interestTemplateEditing && event.preventDefault()}
                    onDrop={(event) => dropInterestToken('cc', event)}
                    onChange={(event) => updateInterestEmailSetting('cc', event.target.value)}
                    disabled={!interestTemplateEditing}
                    placeholder="{{requesterEmail}}"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Bcc</Label>
                  <Input
                    ref={interestBccRef}
                    value={interestEmailSettings.bcc}
                    onFocus={() => setInterestActiveField('bcc')}
                    onDragOver={(event) => interestTemplateEditing && event.preventDefault()}
                    onDrop={(event) => dropInterestToken('bcc', event)}
                    onChange={(event) => updateInterestEmailSetting('bcc', event.target.value)}
                    disabled={!interestTemplateEditing}
                  />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-xs text-muted-foreground">Subject</Label>
                  <Input
                    ref={interestSubjectRef}
                    value={interestEmailSettings.subject}
                    onFocus={() => setInterestActiveField('subject')}
                    onDragOver={(event) => interestTemplateEditing && event.preventDefault()}
                    onDrop={(event) => dropInterestToken('subject', event)}
                    onChange={(event) => updateInterestEmailSetting('subject', event.target.value)}
                    disabled={!interestTemplateEditing}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex flex-wrap gap-2">
                  {INTEREST_EMAIL_TOKENS.map((item) => (
                    <button
                      key={item.token}
                      type="button"
                      draggable={interestTemplateEditing}
                      disabled={!interestTemplateEditing}
                      onClick={() => insertInterestToken(item.token)}
                      onDragStart={(event) => {
                        event.dataTransfer.setData('text/plain', item.token);
                        event.dataTransfer.effectAllowed = 'copy';
                      }}
                      className={cn(
                        'rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-foreground transition-colors',
                        interestTemplateEditing ? 'cursor-grab hover:bg-muted/70' : 'cursor-not-allowed opacity-50',
                      )}
                      title={interestTemplateEditing ? 'Drag into the template or click to insert' : 'Click Edit Template to modify'}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <div
                  className={cn(
                    'rounded-md border border-border bg-background [&_.ql-container]:min-h-80 [&_.ql-container]:border-0 [&_.ql-toolbar]:border-0 [&_.ql-toolbar]:border-b [&_.ql-toolbar]:border-border',
                    !interestTemplateEditing && 'opacity-85',
                  )}
                  onFocus={() => setInterestActiveField('body')}
                  onDragOver={(event) => interestTemplateEditing && event.preventDefault()}
                  onDrop={(event) => dropInterestToken('body', event)}
                >
                  <ReactQuill
                    ref={interestContentEditorRef}
                    theme="snow"
                    modules={QUILL_MODULES}
                    value={interestEmailSettings.body}
                    readOnly={!interestTemplateEditing}
                    onChange={(value) => updateInterestEmailSetting('body', value)}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Place <span className="font-mono">{INTEREST_CALCULATION_TABLE_TOKEN}</span> where the calculation table should appear.
                </p>
              </div>
              {interestTemplateMessage && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                  {interestTemplateMessage}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border bg-background">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <div>
                  <div className="text-sm font-semibold text-foreground">Preview</div>
                  <div className="space-y-0.5 text-xs text-muted-foreground">
                    {interestPreview?.subject ? (
                      <>
                        <div>To: {interestPreview.to || '-'}</div>
                        <div>Cc: {interestPreview.cc || '-'}</div>
                        {interestPreview.bcc ? <div>Bcc: {interestPreview.bcc}</div> : null}
                        <div>Subject: {interestPreview.subject}</div>
                      </>
                    ) : 'Generate a preview with the sample payment record.'}
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={previewInterestTemplate}>
                  <Eye className="mr-2 h-4 w-4" />
                  Preview
                </Button>
              </div>
              <div className="h-[520px] overflow-auto p-4">
                {interestPreview?.html ? (
                  <div
                    className="prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: interestPreview.html }}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    No preview generated yet.
                  </div>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeInterestTemplate}>Close</Button>
            {!interestTemplateEditing ? (
              canManageFinancialReportSettings && (
                <Button variant="outline" onClick={startInterestTemplateEdit}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit Template
                </Button>
              )
            ) : (
              <>
                <Button variant="outline" onClick={cancelInterestTemplateChanges}>
                  <X className="mr-2 h-4 w-4" />
                  Cancel Changes
                </Button>
                <Button variant="outline" onClick={saveInterestTemplate} disabled={JSON.stringify(interestEmailSettings) === JSON.stringify(savedInterestEmailSettings)}>
                  <Save className="mr-2 h-4 w-4" />
                  Save Template
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <StemDetailModal
        stemId={selectedStemId}
        open={!!selectedStemId}
        onClose={() => setSelectedStemId(null)}
        onUpdated={() => load({ force: true })}
      />
    </div>
  );
}
