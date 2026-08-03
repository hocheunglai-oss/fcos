import React, { useMemo, useState } from "react";
import ReactQuill from "react-quill-new";
import "react-quill-new/dist/quill.snow.css";
import {
  CheckCircle2,
  Copy,
  Eye,
  FileText,
  Mail,
  Send,
  Trash2,
} from "lucide-react";
import { ClearingAccount, Invoice } from "@/hedge/api/entities";
import {
  calcSwapFees,
  calcSwapMtm,
  formatDate,
  formatMoney,
  formatMonth,
  formatQuantity,
  hedgeSettlementPaymentDirection,
  hktThisMonth,
  hktToday,
  monthOptions,
  nextInvoiceNumber,
  resolveTemplate,
  roundMoney,
  settlementSummary,
} from "../lib/domain";
import { useActions } from "../data/ActionsContext";
import {
  Button,
  ConfirmDialog,
  Drawer,
  EmptyState,
  Field,
  IconButton,
  InlineError,
  Metric,
  Modal,
  Money,
  PageHeader,
  Panel,
  ProductBadge,
  SearchInput,
  SectionHeading,
  SegmentedControl,
  Select,
  StatusBadge,
  TableFrame,
} from "../components/ui";
import { SfsReportPanel } from "../components/SfsReportPanel";
import { generateOtcInvoice, saveInvoicePdf, sendInvoiceEmail } from "@/hedge/api/backendFunctions";

const EMAIL_EDITOR_MODULES = {
  toolbar: [
    [{ header: [false, 3, 4] }],
    ["bold", "italic", "underline"],
    [{ list: "ordered" }, { list: "bullet" }],
    ["link"],
    ["clean"],
  ],
};

function pdfBlob(result) {
  const bytes = Uint8Array.from(atob(result?.base64 || ''), (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: result?.mimeType || 'application/pdf' });
}

function buildCounterpartyGroups(swaps, mops, rates, sgoRatio) {
  const grouped = new Map();
  swaps.forEach((swap) => {
    const key = swap.counterparty || "Unassigned";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(swap);
  });
  return [...grouped.entries()].map(([counterparty, records]) => {
    const rows = records.map((swap) => {
      const mtm = calcSwapMtm(swap, mops, sgoRatio)?.value || 0;
      const fees = calcSwapFees(swap, rates);
      const iceCost = fees.brokerFee + fees.sfsCommission + fees.ice + fees.iceClearing + fees.iceSettlement;
      const attributedFeeAmount = counterparty === "FCBS"
        ? fees.cpHandlingFee
        : swap.venue === "ICE"
          ? iceCost
          : fees.cpHandlingFee + fees.fcbsVenueFee;
      const attributedFeeImpact = swap.venue === "ICE" && counterparty !== "FCBS"
        ? -attributedFeeAmount
        : attributedFeeAmount;
      return {
        swap,
        mtm: roundMoney(mtm),
        fees,
        attributedFeeAmount: roundMoney(attributedFeeAmount),
        attributedFeeImpact: roundMoney(attributedFeeImpact),
        net: roundMoney(-mtm + attributedFeeImpact),
      };
    });
    return {
      key: counterparty,
      counterparty,
      records,
      rows,
      mtm: roundMoney(rows.reduce((sum, row) => sum - row.mtm, 0)),
      fees: roundMoney(rows.reduce((sum, row) => sum + row.attributedFeeAmount, 0)),
      net: roundMoney(rows.reduce((sum, row) => sum + row.net, 0)),
    };
  }).sort((left, right) => Math.abs(right.net) - Math.abs(left.net));
}

function buildInvoicePayload(group, invoiceNumber, invoiceDate, settlementMonth, counterpartyRecord) {
  const counterparty = counterpartyRecord ? {
    short_name: counterpartyRecord.short_name,
    full_name: counterpartyRecord.full_name,
    address_line1: counterpartyRecord.address_line1,
    address_line2: counterpartyRecord.address_line2,
    address_line3: counterpartyRecord.address_line3,
    attention: counterpartyRecord.attention,
  } : { short_name: group.counterparty, full_name: group.counterparty };
  const paymentDirection = hedgeSettlementPaymentDirection(group.net, counterparty);
  const lineItems = group.rows.map(({ swap, mtm, attributedFeeImpact, net }) => ({
    product: swap.product,
    direction: swap.direction,
    quantity: swap.quantity || 0,
    unit: swap.unit || "MT",
    price: swap.trade_type === "SPREAD" ? swap.leg1_price || 0 : swap.price || 0,
    mtmAvg: null,
    mtmValue: -mtm,
    handlingFee: attributedFeeImpact,
    netValue: net,
    venue: swap.venue,
  }));
  return {
    invoiceNumber,
    invoiceDate,
    settlementMonth,
    lineItems,
    totalMtm: group.mtm,
    totalHandling: roundMoney(group.rows.reduce((sum, row) => sum + row.attributedFeeImpact, 0)),
    netAmount: group.net,
    isReceivable: paymentDirection.isReceivable,
    paymentDirection,
    counterparty,
  };
}

export function SettlementView({ data, settings, readOnly = false, canClose = false }) {
  const actions = useActions();
  const months = useMemo(() => monthOptions(data.swaps, data.physicals, data.mops), [data.mops, data.physicals, data.swaps]);
  const [month, setMonth] = useState(() => months.find((value) => value <= hktThisMonth()) || hktThisMonth());
  const [tab, setTab] = useState("sfs");
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [invoiceStatus, setInvoiceStatus] = useState("all");
  const [invoiceDrawer, setInvoiceDrawer] = useState(null);
  const [invoiceForm, setInvoiceForm] = useState({ number: "", date: hktToday() });
  const [pdfPreview, setPdfPreview] = useState(null);
  const [emailDrawer, setEmailDrawer] = useState(null);
  const [emailForm, setEmailForm] = useState({ to: "", cc: "", bcc: "", subject: "", body: "" });
  const [emailView, setEmailView] = useState("preview");
  const [emailIdempotencyKey, setEmailIdempotencyKey] = useState("");
  const [confirmUncertainResend, setConfirmUncertainResend] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  React.useEffect(() => {
    if (!months.includes(month)) setMonth(months[0] || hktThisMonth());
  }, [month, months]);

  const summary = useMemo(() => settlementSummary(data.swaps, data.mops, settings.rates, month, settings.general.sgo_bbl_per_mt), [data.mops, data.swaps, month, settings.general.sgo_bbl_per_mt, settings.rates]);
  const groups = useMemo(() => buildCounterpartyGroups(summary.monthSwaps, data.mops, settings.rates, settings.general.sgo_bbl_per_mt), [data.mops, settings.general.sgo_bbl_per_mt, settings.rates, summary.monthSwaps]);
  const closed = settings.closedMonths.includes(month);
  const filteredInvoices = useMemo(() => data.invoices
    .filter((invoice) => invoiceStatus === "all" || invoice.status === invoiceStatus)
    .filter((invoice) => `${invoice.invoice_number || ""} ${invoice.counterparty || ""} ${invoice.settlement_month || ""} ${invoice.invoice_type || ""}`.toLowerCase().includes(invoiceSearch.toLowerCase()))
    .sort((left, right) => String(right.invoice_number || "").localeCompare(String(left.invoice_number || ""))), [data.invoices, invoiceSearch, invoiceStatus]);
  const counterpartyMap = useMemo(() => new Map(data.counterparties.map((record) => [record.short_name, record])), [data.counterparties]);
  const paymentDirectionFor = (netAmount, counterparty) => hedgeSettlementPaymentDirection(
    netAmount,
    counterpartyMap.get(counterparty) || counterparty,
  );

  const toggleClosed = async () => {
    const next = closed ? settings.closedMonths.filter((value) => value !== month) : [...settings.closedMonths, month];
    setBusy(true);
    setError(null);
    try {
      if (!closed && summary.isFinal) {
        const expectedSettlementFee = roundMoney(summary.monthSwaps.reduce((sum, swap) => sum + calcSwapFees(swap, settings.rates).iceSettlement, 0));
        const postedSettlementFee = roundMoney(data.clearing
          .filter((row) => String(row.date || "").startsWith(month) && String(row.notes || "").toLowerCase().includes("ice settlement fee"))
          .reduce((sum, row) => sum + Math.abs(Number(row.amount) || 0), 0));
        const missingSettlementFee = roundMoney(Math.max(0, expectedSettlementFee - postedSettlementFee));
        if (missingSettlementFee > 0) {
          const publicationDates = data.mops
            .filter((row) => String(row.price_date || "").startsWith(month) && !row.is_estimate)
            .map((row) => row.price_date)
            .sort();
          const [year, monthNumber] = month.split("-").map(Number);
          const monthEnd = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
          await actions.create({
            entity: ClearingAccount,
            entityName: "ClearingAccount",
            payload: {
              date: publicationDates.at(-1) || monthEnd,
              type: "Trade Fee",
              amount: missingSettlementFee,
              status: "confirmed",
              notes: `ICE settlement fee ${month} | ${summary.monthSwaps.filter((swap) => swap.venue === "ICE").length} ICE pricing-month trades (auto)`,
            },
            label: `ICE settlement fee ${formatMonth(month)}`,
          });
        }
      }
      await settings.update("closed_months", next);
      actions.notify({ message: `${formatMonth(month)} marked ${closed ? "in progress" : "settled"}` });
    } catch (nextError) {
      setError(nextError);
    } finally {
      setBusy(false);
    }
  };

  const openInvoice = (group) => {
    setInvoiceDrawer(group);
    setInvoiceForm({ number: nextInvoiceNumber(data.invoices, settings.general.invoice_prefix), date: hktToday() });
    setError(null);
  };

  const previewInvoice = async () => {
    if (!invoiceDrawer || !invoiceForm.number || !invoiceForm.date) {
      setError(new Error("Invoice number and date are required."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = buildInvoicePayload(invoiceDrawer, invoiceForm.number, invoiceForm.date, month, counterpartyMap.get(invoiceDrawer.counterparty));
      const result = await generateOtcInvoice(payload);
      const blob = pdfBlob(result);
      setPdfPreview({
        url: URL.createObjectURL(blob),
        blob,
        payload,
        group: invoiceDrawer,
        invoiceNumber: invoiceForm.number,
        existing: null,
      });
      setInvoiceDrawer(null);
    } catch (nextError) {
      setError(nextError);
    } finally {
      setBusy(false);
    }
  };

  const closePreview = () => {
    if (pdfPreview?.url?.startsWith("blob:")) URL.revokeObjectURL(pdfPreview.url);
    setPdfPreview(null);
  };

  const saveInvoice = async () => {
    if (!pdfPreview || pdfPreview.existing) return;
    setBusy(true);
    setError(null);
    try {
      const group = pdfPreview.group;
      const payload = pdfPreview.payload;
      const invoice = await actions.create({
        entity: Invoice,
        entityName: "Invoice",
        payload: {
          invoice_number: payload.invoiceNumber,
          invoice_type: payload.paymentDirection.invoiceType,
          issue_date: payload.invoiceDate,
          settlement_month: payload.settlementMonth,
          counterparty: group.counterparty,
          section: "Trader",
          line_items: payload.lineItems,
          subtotal: payload.netAmount,
          status: "Draft",
          swap_ids: group.records.map((record) => record.id),
          pdf_payload: payload,
        },
        label: `${payload.invoiceNumber} ${group.counterparty}`,
      });
      try {
        await saveInvoicePdf({ action: "save_invoice_pdf", invoiceId: invoice.id, pdfBase64: pdfPreview.payload ? (await generateOtcInvoice(pdfPreview.payload)).base64 : null });
      } catch {}
      closePreview();
      await data.reload({ silent: true });
      setTab("invoices");
    } catch (nextError) {
      setError(nextError);
    } finally {
      setBusy(false);
    }
  };

  const previewExisting = async (invoice) => {
    setBusy(true);
    setError(null);
    try {
      const issued = ["Sent", "Settled"].includes(invoice.status);
      if (issued && invoice.pdf_data_url?.startsWith("supabase://hedge-documents/")) {
        const result = await saveInvoicePdf({ action: "get_invoice_pdf", storagePath: invoice.pdf_data_url });
        if (!result?.url) throw new Error("Private invoice PDF could not be opened.");
        setPdfPreview({ url: result.url, invoiceNumber: invoice.invoice_number, payload: invoice.pdf_payload, existing: invoice });
      } else if (issued && invoice.pdf_data_url && /^(https?:|data:application\/pdf|blob:)/.test(invoice.pdf_data_url)) {
        setPdfPreview({ url: invoice.pdf_data_url, invoiceNumber: invoice.invoice_number, payload: invoice.pdf_payload, existing: invoice });
      } else {
        const counterpartyRecord = counterpartyMap.get(invoice.counterparty);
        const storedPayload = invoice.pdf_payload || {};
        const payload = {
          ...storedPayload,
          invoiceNumber: invoice.invoice_number,
          invoiceDate: invoice.issue_date,
          settlementMonth: invoice.settlement_month,
          lineItems: storedPayload.lineItems || invoice.line_items || [],
          totalMtm: storedPayload.totalMtm || 0,
          totalHandling: storedPayload.totalHandling || 0,
          netAmount: invoice.subtotal,
          counterparty: counterpartyRecord ? {
            ...storedPayload.counterparty,
            short_name: counterpartyRecord.short_name,
            full_name: counterpartyRecord.full_name,
            address_line1: counterpartyRecord.address_line1,
            address_line2: counterpartyRecord.address_line2,
            address_line3: counterpartyRecord.address_line3,
            attention: counterpartyRecord.attention,
          } : storedPayload.counterparty || { short_name: invoice.counterparty, full_name: invoice.counterparty },
        };
        const result = await generateOtcInvoice(payload);
        setPdfPreview({ url: URL.createObjectURL(pdfBlob(result)), invoiceNumber: invoice.invoice_number, payload, existing: invoice });
      }
    } catch (nextError) {
      setError(nextError);
    } finally {
      setBusy(false);
    }
  };

  const openEmail = (invoice) => {
    const counterparty = counterpartyMap.get(invoice.counterparty);
    const paymentDirection = paymentDirectionFor(invoice.subtotal, invoice.counterparty);
    const issue = invoice.issue_date || hktToday();
    const due = new Date(`${issue}T00:00:00`);
    due.setDate(due.getDate() + 30);
    const variables = {
      invoiceNumber: invoice.invoice_number,
      invoiceType: invoice.invoice_type,
      settlementMonth: invoice.settlement_month,
      counterparty: counterparty?.full_name || invoice.counterparty,
      attn: counterparty?.attention || "",
      netAmount: Math.abs(invoice.subtotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      direction: invoice.invoice_type === "Debit Note" ? "Receivable from" : "Payable to",
      payer: paymentDirection.payer.shortName,
      payee: paymentDirection.payee.shortName,
      beneficiary: paymentDirection.beneficiary.fullName,
      issueDate: formatDate(issue),
      dueDate: due.toLocaleDateString("en-GB"),
    };
    setEmailDrawer({ ...invoice, paymentDirection });
    setEmailView("preview");
    setConfirmUncertainResend(false);
    setEmailIdempotencyKey(`hedge-settlement:${invoice.id}:revision:${Number(invoice.revision || 0)}`);
    setEmailForm({
      to: counterparty?.emails || settings.email.email_to || "",
      cc: settings.email.email_cc || "",
      bcc: settings.email.email_bcc || "",
      subject: resolveTemplate(settings.email.email_subject, variables),
      body: resolveTemplate(settings.email.email_body, variables, { escapeHtml: true }),
    });
    setError(null);
  };

  const sendEmail = async () => {
    if (!emailDrawer || !emailForm.to.trim()) {
      setError(new Error("At least one recipient email address is required."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sendInvoiceEmail({
        ...emailForm,
        idempotencyKey: emailIdempotencyKey,
        invoiceId: emailDrawer.id,
        invoiceNumber: emailDrawer.invoice_number,
        confirmUncertainResend,
      });
      await data.reload({ silent: true });
      setEmailDrawer(null);
    } catch (nextError) {
      setError(nextError);
      if (/may already have been delivered|uncertain resend/i.test(nextError?.message || "")) setConfirmUncertainResend(true);
    } finally {
      setBusy(false);
    }
  };

  const updateInvoiceStatus = async (invoice, status) => {
    await actions.update({ entity: Invoice, entityName: "Invoice", id: invoice.id, payload: { status }, before: invoice, label: `${invoice.invoice_number} status ${status}` });
  };

  const removeInvoice = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    setError(null);
    try {
      await actions.remove({ entity: Invoice, entityName: "Invoice", record: deleteTarget, label: deleteTarget.invoice_number || "Invoice", undoable: false });
      setDeleteTarget(null);
    } catch (nextError) {
      setError(nextError);
    } finally {
      setBusy(false);
    }
  };

  const renderOverview = () => (
    <>
      <div className="app-metric-grid app-metric-grid--5">
        <Metric label="Swap MTM" value={formatMoney(summary.mtm, { signed: true, digits: 2 })} detail={`${summary.monthSwaps.length} pricing-month hedges`} tone={summary.mtm >= 0 ? "green" : "red"} />
        <Metric label="FCBS handling" value={formatMoney(-summary.fcbs, { digits: 2 })} detail="Venue services" tone="orange" />
        <Metric label="Broker commission" value={formatMoney(-summary.broker, { digits: 2 })} detail={`${summary.brokerSwaps.length} trade-month hedges`} tone="violet" />
        <Metric label="ICE and SFS fees" value={formatMoney(-(summary.ice + summary.sfs), { digits: 2 })} detail={summary.isFinal ? "Includes settlement fees" : "Settlement fees pending"} tone="amber" />
        <Metric label="Net settlement" value={formatMoney(summary.net, { signed: true, digits: 2 })} detail={closed ? "Month settled" : "Month in progress"} tone={summary.net >= 0 ? "green" : "red"} />
      </div>
      <Panel>
        <SectionHeading title="Swap-by-swap settlement" description="Pricing-month MTM and attributed charges for the selected month." />
        <div className="app-table-frame app-table-frame--flush">
          {summary.monthSwaps.length ? (
            <table className="app-table app-table--compact">
              <thead><tr><th>Trade</th><th>Product</th><th>Direction</th><th>Quantity</th><th>Price</th><th>Counterparty</th><th>MTM</th><th>Fees</th><th>Net</th></tr></thead>
              <tbody>{summary.monthSwaps.map((swap) => {
                const mtm = calcSwapMtm(swap, data.mops, settings.general.sgo_bbl_per_mt)?.value || 0;
                const fees = calcSwapFees(swap, settings.rates);
                const charges = fees.broker + fees.sfsCommission + fees.ice + fees.iceClearing + (summary.isFinal ? fees.iceSettlement : 0) + fees.fcbsVenueFee;
                return <tr key={swap.id}><td>{formatDate(swap.trade_date)}</td><td><ProductBadge product={swap.product} /></td><td><strong>{swap.trade_type === "SPREAD" ? "SPREAD" : swap.direction}</strong></td><td>{formatQuantity(swap.quantity, swap.unit)}</td><td>{swap.trade_type === "SPREAD" ? `$${swap.leg1_price} / $${swap.leg2_price}` : `$${swap.price}`}</td><td>{swap.counterparty || "-"}</td><td><Money value={mtm} digits={2} /></td><td><Money value={-charges} digits={2} /></td><td><Money value={mtm - charges} digits={2} strong /></td></tr>;
              })}</tbody>
            </table>
          ) : <EmptyState title="No hedges settle in this month" description="Choose another month or add a hedge with this pricing month." />}
        </div>
      </Panel>
    </>
  );

  const renderCounterparties = () => (
    <div className="app-settlement-groups">
      {groups.length ? groups.map((group) => {
        const paymentDirection = paymentDirectionFor(group.net, group.counterparty);
        return (
          <Panel key={group.key} className="app-counterparty-settlement">
            <div className="app-counterparty-settlement__header">
              <div><h2>{group.counterparty}</h2><p>{group.records.length} hedges</p></div>
              <div className="app-counterparty-settlement__net"><strong>{formatMoney(paymentDirection.amount, { digits: 2 })}</strong>{!readOnly && <Button size="sm" icon={FileText} onClick={() => openInvoice(group)}>Generate {paymentDirection.invoiceType.toLowerCase()}</Button>}</div>
            </div>
            <div className={`app-payment-direction app-payment-direction--${paymentDirection.isReceivable ? "receivable" : "payable"}`}>
              <span>Payment direction</span>
              <strong>{paymentDirection.label}</strong>
              <small>Beneficiary: {paymentDirection.beneficiary.fullName}</small>
            </div>
            <div className="app-table-frame app-table-frame--flush">
              <table className="app-table app-table--compact"><thead><tr><th>Trade</th><th>Product</th><th>Venue</th><th>Quantity</th><th>MTM from CP</th><th>Fee impact</th><th>Net to FCBHK</th></tr></thead><tbody>{group.rows.map(({ swap, mtm, attributedFeeImpact, net }) => (
                <tr key={swap.id}><td>{formatDate(swap.trade_date)}</td><td><ProductBadge product={swap.product} /></td><td>{swap.venue}</td><td>{formatQuantity(swap.quantity, swap.unit)}</td><td><Money value={-mtm} digits={2} /></td><td><Money value={attributedFeeImpact} digits={2} /></td><td><Money value={net} digits={2} strong /></td></tr>
              ))}</tbody></table>
            </div>
          </Panel>
        );
      }) : <EmptyState title="No counterparty settlement" description="There are no counterparty hedges for the selected month." />}
    </div>
  );

  const renderFees = () => (
    <div className="app-settlement-fees">
      <Panel>
        <SectionHeading title="Broker and ICE charges" description="Broker groups use trade month; ICE and SFS charges use the pricing month." />
        <div className="app-table-frame app-table-frame--flush">
          <table className="app-table app-table--compact"><thead><tr><th>Trade</th><th>Broker</th><th>Product</th><th>Quantity</th><th>Broker</th><th>SFS</th><th>Exchange</th><th>Clearing</th><th>Settlement</th><th>Total</th></tr></thead><tbody>{[...new Map([...summary.brokerSwaps, ...summary.monthSwaps].map((swap) => [swap.id, swap])).values()].map((swap) => {
            const fees = calcSwapFees(swap, settings.rates);
            const total = fees.broker + fees.sfsCommission + fees.ice + fees.iceClearing + (summary.isFinal ? fees.iceSettlement : 0);
            return <tr key={swap.id}><td>{formatDate(swap.trade_date)}</td><td>{swap.broker || "-"}</td><td><ProductBadge product={swap.product} /></td><td>{formatQuantity(swap.quantity, swap.unit)}</td><td><Money value={-fees.broker} digits={2} /></td><td><Money value={-fees.sfsCommission} digits={2} /></td><td><Money value={-fees.ice} digits={2} /></td><td><Money value={-fees.iceClearing} digits={2} /></td><td>{summary.isFinal ? <Money value={-fees.iceSettlement} digits={2} /> : "Pending"}</td><td><Money value={-total} digits={2} strong /></td></tr>;
          })}</tbody></table>
        </div>
      </Panel>
    </div>
  );

  const renderInvoices = () => (
    <>
      <div className="app-toolbar">
        <SearchInput value={invoiceSearch} onChange={setInvoiceSearch} placeholder="Search invoice, month, counterparty..." />
        <Select value={invoiceStatus} onChange={(event) => setInvoiceStatus(event.target.value)} className="app-toolbar__select"><option value="all">All statuses</option><option value="Draft">Draft</option><option value="Sent">Sent</option><option value="Settled">Settled</option></Select>
      </div>
      <TableFrame>
        {filteredInvoices.length ? <table className="app-table"><thead><tr><th>Invoice</th><th>Type</th><th>Month</th><th>Payment direction</th><th>Amount</th><th>Status</th><th>Email</th><th aria-label="Actions" /></tr></thead><tbody>{filteredInvoices.map((invoice) => {
          const paymentDirection = paymentDirectionFor(invoice.subtotal, invoice.counterparty);
          return (
            <tr key={invoice.id}>
              <td><strong className="app-text-teal">{invoice.invoice_number || "-"}</strong><small>{formatDate(invoice.issue_date)}</small></td>
              <td><StatusBadge tone={paymentDirection.isReceivable ? "positive" : "negative"}>{paymentDirection.invoiceType}</StatusBadge></td>
              <td>{formatMonth(invoice.settlement_month)}</td>
              <td><strong>{paymentDirection.label}</strong><small>Beneficiary: {paymentDirection.beneficiary.shortName}</small></td>
              <td><strong>{formatMoney(paymentDirection.amount, { digits: 2 })}</strong></td>
              <td>{readOnly ? <StatusBadge>{invoice.status || "Draft"}</StatusBadge> : <Select value={invoice.status || "Draft"} onChange={(event) => updateInvoiceStatus(invoice, event.target.value)}><option>Draft</option><option>Sent</option><option>Settled</option></Select>}</td>
              <td>{invoice.email_sent_at ? <StatusBadge tone="positive">Sent {new Date(invoice.email_sent_at).toLocaleDateString("en-GB")}</StatusBadge> : <StatusBadge tone="neutral">Not sent</StatusBadge>}</td>
              <td><div className="app-row-actions"><IconButton label="Copy invoice number" icon={Copy} variant="quiet" onClick={() => navigator.clipboard.writeText(invoice.invoice_number || "")} /><IconButton label="Preview invoice" icon={Eye} variant="quiet" onClick={() => previewExisting(invoice)} />{!readOnly && <><IconButton label="Send invoice email" icon={Mail} variant="quiet" disabled={!counterpartyMap.get(invoice.counterparty)?.emails && !settings.email.email_to} onClick={() => openEmail(invoice)} /><IconButton label="Delete invoice" icon={Trash2} variant="danger" onClick={() => setDeleteTarget(invoice)} /></>}</div></td>
            </tr>
          );
        })}</tbody></table> : <EmptyState title="No invoices match" description="Generate an invoice from the Counterparties view or adjust the filters." />}
      </TableFrame>
    </>
  );

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Month close"
        title="Settlement"
        description="Review monthly P&L, allocate broker and exchange charges, prepare invoices, and close the month."
        status={<StatusBadge tone={closed ? "positive" : "warning"}>{closed ? "Settled" : "In progress"}</StatusBadge>}
        actions={<><Select value={month} onChange={(event) => setMonth(event.target.value)}>{months.map((value) => <option key={value} value={value}>{formatMonth(value)}</option>)}</Select>{canClose && <Button variant={closed ? "secondary" : "positive"} icon={CheckCircle2} onClick={toggleClosed} disabled={busy}>{closed ? "Reopen month" : "Mark settled"}</Button>}</>}
      />
      {error && <InlineError error={error} action={<Button size="sm" onClick={() => setError(null)}>Dismiss</Button>} />}
      <SegmentedControl value={tab} onChange={setTab} label="Settlement view" options={[{ value: "sfs", label: "SFS realised P&L" }, { value: "overview", label: "Overview" }, { value: "counterparties", label: "Counterparties", count: groups.length }, { value: "fees", label: "Broker and ICE" }, { value: "invoices", label: "FCBHK Invoices", count: data.invoices.length }]} />
      <div className="app-settlement-content">{tab === "sfs" && <SfsReportPanel month={month} canSend={canClose} onDelivered={() => data.reload({ silent: true })} />}{tab === "overview" && renderOverview()}{tab === "counterparties" && renderCounterparties()}{tab === "fees" && renderFees()}{tab === "invoices" && renderInvoices()}</div>

      <Drawer open={Boolean(invoiceDrawer)} onClose={() => setInvoiceDrawer(null)} title={invoiceDrawer ? `Generate ${paymentDirectionFor(invoiceDrawer.net, invoiceDrawer.counterparty).invoiceType.toLowerCase()} - ${invoiceDrawer.counterparty}` : "Generate settlement document"} description={invoiceDrawer ? `${formatMonth(month)} settlement | ${paymentDirectionFor(invoiceDrawer.net, invoiceDrawer.counterparty).label}` : ""} width="medium" footer={<><Button onClick={() => setInvoiceDrawer(null)} disabled={busy}>Cancel</Button><Button variant="primary" icon={Eye} onClick={previewInvoice} disabled={busy}>{busy ? "Generating..." : "Preview PDF"}</Button></>}>
        {error && <InlineError error={error} />}
        <section className="app-form-section"><div className="app-form-grid app-form-grid--2"><Field label="Invoice number" required><input className="app-input" value={invoiceForm.number} onChange={(event) => setInvoiceForm((current) => ({ ...current, number: event.target.value }))} /></Field><Field label="Invoice date" required><input className="app-input" type="date" value={invoiceForm.date} onChange={(event) => setInvoiceForm((current) => ({ ...current, date: event.target.value }))} /></Field></div></section>
        {invoiceDrawer && (() => {
          const paymentDirection = paymentDirectionFor(invoiceDrawer.net, invoiceDrawer.counterparty);
          return <><div className={`app-payment-direction app-payment-direction--${paymentDirection.isReceivable ? "receivable" : "payable"}`}><span>Payment direction</span><strong>{paymentDirection.label}</strong><small>Beneficiary: {paymentDirection.beneficiary.fullName}</small></div><div className="app-invoice-summary"><span><small>Payer</small><strong>{paymentDirection.payer.shortName}</strong></span><span><small>Beneficiary</small><strong>{paymentDirection.beneficiary.shortName}</strong></span><span><small>Amount</small><strong>{formatMoney(paymentDirection.amount, { digits: 2 })}</strong></span></div></>;
        })()}
      </Drawer>

      <Modal open={Boolean(pdfPreview)} onClose={closePreview} title="Invoice PDF preview" description={pdfPreview?.invoiceNumber} size="xl" footer={<>{!pdfPreview?.existing && <Button variant="primary" icon={FileText} onClick={saveInvoice} disabled={busy}>{busy ? "Saving..." : "Save invoice"}</Button>}</>}>
        {pdfPreview && <iframe className="app-pdf-frame" src={pdfPreview.url} title={`Invoice ${pdfPreview.invoiceNumber}`} />}
      </Modal>

      <Drawer open={Boolean(emailDrawer)} onClose={() => setEmailDrawer(null)} title={`Send ${emailDrawer?.invoice_number || "invoice"}`} description={confirmUncertainResend ? "Microsoft Graph may already have accepted the earlier attempt. Check the sender mailbox and recipient before confirming a resend." : "Review the message and attached settlement PDF before sending."} width="wide" footer={<><Button onClick={() => setEmailDrawer(null)} disabled={busy}>Cancel</Button><Button variant="primary" icon={Send} onClick={sendEmail} disabled={busy || !emailForm.to.trim()}>{busy ? "Sending..." : confirmUncertainResend ? "Confirm resend" : "Send email"}</Button></>}>
        {error && <InlineError error={error} />}
        {emailDrawer?.paymentDirection && <div className={`app-payment-direction app-payment-direction--${emailDrawer.paymentDirection.isReceivable ? "receivable" : "payable"}`}><span>Payment direction</span><strong>{emailDrawer.paymentDirection.label}</strong><small>Beneficiary: {emailDrawer.paymentDirection.beneficiary.fullName}</small></div>}
        <SegmentedControl value={emailView} onChange={setEmailView} label="Settlement email view" options={[{ value: "preview", label: "Preview" }, { value: "edit", label: "Edit message" }]} />
        {emailView === "edit" ? (
          <section className="app-form-section app-email-composer">
            <div className="app-form-grid app-form-grid--2">
              <Field label="To" required className="app-field--span-2"><input className="app-input" value={emailForm.to} onChange={(event) => setEmailForm((current) => ({ ...current, to: event.target.value }))} /></Field>
              <Field label="CC"><input className="app-input" value={emailForm.cc} onChange={(event) => setEmailForm((current) => ({ ...current, cc: event.target.value }))} /></Field>
              <Field label="BCC"><input className="app-input" value={emailForm.bcc} onChange={(event) => setEmailForm((current) => ({ ...current, bcc: event.target.value }))} /></Field>
              <Field label="Subject" className="app-field--span-2"><input className="app-input" value={emailForm.subject} onChange={(event) => setEmailForm((current) => ({ ...current, subject: event.target.value }))} /></Field>
              <Field label="Message" className="app-field--span-2"><ReactQuill theme="snow" value={emailForm.body} modules={EMAIL_EDITOR_MODULES} onChange={(body) => setEmailForm((current) => ({ ...current, body }))} /></Field>
            </div>
          </section>
        ) : (
          <section className="app-email-preview" aria-label="Settlement email preview">
            <dl>
              <div><dt>To</dt><dd>{emailForm.to || "Not set"}</dd></div>
              {emailForm.cc && <div><dt>CC</dt><dd>{emailForm.cc}</dd></div>}
              {emailForm.bcc && <div><dt>BCC</dt><dd>{emailForm.bcc}</dd></div>}
              <div><dt>Subject</dt><dd>{emailForm.subject || "No subject"}</dd></div>
            </dl>
            <div className="app-email-preview__body"><ReactQuill theme="bubble" readOnly value={emailForm.body} modules={{ toolbar: false }} /></div>
            <div className="app-email-preview__attachment"><FileText size={16} aria-hidden="true" /><span>{emailDrawer?.invoice_number || "Settlement invoice"}.pdf</span><small>Generated automatically</small></div>
          </section>
        )}
      </Drawer>

      <ConfirmDialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} onConfirm={removeInvoice} busy={busy} title="Delete invoice?" description={deleteTarget ? `${deleteTarget.invoice_number || "Invoice"}. Stored invoice PDFs will also be permanently deleted.` : ""} />
    </div>
  );
}
