import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Download,
  FileSpreadsheet,
  FileText,
  History,
  RefreshCw,
  Send,
  ShieldCheck,
} from "lucide-react";
import { getSfsMonthReport, getSfsReportFile, sendSfsMonthReport } from "@/hedge/api/backendFunctions";
import {
  Button,
  EmptyState,
  InlineError,
  Metric,
  Modal,
  Money,
  Panel,
  ProductBadge,
  SectionHeading,
  StatusBadge,
  TableFrame,
} from "./ui";
import {
  PLATTS_PUBLICATION_SOURCE,
  formatDate,
  formatDateTime,
  formatMoney,
  formatMonth,
  formatQuantity,
} from "../lib/domain";

function reportTone(status, complete) {
  if (status === "sent") return "positive";
  if (status === "failed") return "negative";
  if (["pending_approval", "ready", "sending"].includes(status)) return "warning";
  if (!complete) return "warning";
  return "neutral";
}

function reportStatus(latest, complete, historical) {
  if (latest?.status === "sent") return `Emailed R${latest.revision}`;
  if (latest?.status === "superseded") return `Superseded R${latest.revision}`;
  if (latest?.status === "pending_approval") return `R${latest.revision} awaiting approval`;
  if (latest?.status === "ready") return `R${latest.revision} ready`;
  if (latest?.status === "sending") return `Sending R${latest.revision}`;
  if (latest?.status === "failed") return `R${latest.revision} failed`;
  if (!complete) return "Provisional";
  return historical ? "Reconstructed" : "Ready for automation";
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const METHODOLOGY_STEPS = [
  "The report includes only swap legs executed through ICE, treated as cleared through SFS, whose contract month matches the selected month.",
  "Calendar-spread legs are reported in their respective contract months. Trade fees are divided between different-month legs and total to the full trade fee when both legs share a month.",
  "BUY realised P&L is final monthly MOPS less trade price; SELL realised P&L is trade price less final monthly MOPS. The result is multiplied by normalized quantity.",
  "SGO quantities entered in metric tonnes are converted to barrels using the configured SGO conversion. WMA and balance-month pricing bases retain their saved effective dates.",
  "Net realised P&L deducts SFS commission, ICE exchange, ICE clearing, and ICE settlement fees only. Broker commission, physical trades, third-party settlement, and clearing cash are excluded.",
  "A report is final only when every scheduled Platts publication date has an actual, complete S380, S0.5, and SGO record. Later input changes create a revision that requires approval.",
  "Finalization fails closed unless the selected year has an approved Platts publication calendar and every included swap leg has valid quantity, price, direction, and balance-date inputs.",
];

export function SfsReportPanel({ month, onDelivered, canSend = false }) {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [methodologyOpen, setMethodologyOpen] = useState(false);
  const [sendReviewOpen, setSendReviewOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setState(await getSfsMonthReport({ month }));
    } catch (nextError) {
      setError(nextError);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  const report = state?.preview;
  const completeness = report?.completeness;
  const latest = state?.latest;
  const currentRevision = useMemo(() => state?.currentRevision || null, [state]);
  const uncertainDelivery = currentRevision?.status === "sending" && Boolean(currentRevision.delivery?.last_error);
  const sendTarget = currentRevision && (["pending_approval", "ready", "failed"].includes(currentRevision.status) || uncertainDelivery)
    ? currentRevision
    : null;
  const deliveryAllowed = Boolean(canSend && report?.final && (!currentRevision || sendTarget));
  const sendLabel = uncertainDelivery
    ? `Confirm resend R${sendTarget.revision}`
    : sendTarget?.status === "failed"
    ? `Retry R${sendTarget.revision}`
    : sendTarget?.revision
      ? `Approve and send R${sendTarget.revision}`
      : state?.history?.length
        ? `Review and send R${Number(state.history[0].revision) + 1}`
        : "Review and send R1";

  const download = async (format, closeId = null) => {
    setBusy(true);
    setError(null);
    try {
      const result = await getSfsReportFile({ month, closeId, format });
      const bytes = Uint8Array.from(atob(result.base64 || ''), (character) => character.charCodeAt(0));
      triggerDownload(new Blob([bytes], { type: result.mimeType || 'application/octet-stream' }), result.filename || `SFS_Realised_PnL_${month}.${format}`);
    } catch (nextError) {
      setError(nextError);
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendSfsMonthReport({ month, closeId: sendTarget?.id || null, confirmUncertainResend: uncertainDelivery });
      setSendReviewOpen(false);
      await load();
      onDelivered?.();
    } catch (nextError) {
      setError(nextError);
      setSendReviewOpen(false);
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (loading && !state) {
    return (
      <Panel>
        <EmptyState
          title="Loading SFS report"
          description={`Reconciling ${formatMonth(month)} MOPS, swap legs, and SFS fees.`}
          icon={RefreshCw}
        />
      </Panel>
    );
  }

  if (!report) {
    return (
      <Panel>
        {error
          ? <InlineError error={error} action={<Button icon={RefreshCw} onClick={load}>Retry</Button>} />
          : <EmptyState title="SFS report unavailable" description="The report inputs could not be loaded." />}
      </Panel>
    );
  }

  const coverage = completeness.total ? (completeness.actual / completeness.total) * 100 : 0;
  const status = reportStatus(latest, report.final, state.historical);
  const lastSentAt = state.latestOfficial?.sent_at || null;

  return (
    <div className="app-sfs-report">
      {error && <InlineError error={error} action={<Button size="sm" onClick={() => setError(null)}>Dismiss</Button>} />}

      <div className="app-sfs-report__control-bar">
        <div>
          <StatusBadge tone={reportTone(latest?.status, completeness.complete)}>{status}</StatusBadge>
          <span>Recipient <strong>{state.recipient}</strong></span>
          {lastSentAt && <span>Last sent <strong>{formatDateTime(lastSentAt)} HKT</strong></span>}
        </div>
        <div className="app-button-group">
          <Button icon={BookOpen} onClick={() => setMethodologyOpen(true)}>Methodology</Button>
          <Button icon={History} onClick={() => setHistoryOpen(true)} disabled={!state.history?.length}>History</Button>
          <Button icon={RefreshCw} onClick={load} disabled={loading || busy}>{loading ? "Refreshing..." : "Refresh"}</Button>
          <Button icon={FileText} onClick={() => download("pdf", currentRevision?.id || null)} disabled={busy}>PDF</Button>
          <Button icon={FileSpreadsheet} onClick={() => download("csv", currentRevision?.id || null)} disabled={busy}>CSV</Button>
          {deliveryAllowed && <Button variant="primary" icon={Send} onClick={() => setSendReviewOpen(true)} disabled={busy}>{sendLabel}</Button>}
        </div>
      </div>

      <div className="app-metric-grid app-metric-grid--5">
        <Metric label="Gross realised P&L" value={formatMoney(report.totals.grossPnl, { signed: true, digits: 2 })} detail={`${report.lines.length} SFS-cleared swap legs`} tone={report.totals.grossPnl >= 0 ? "green" : "red"} />
        <Metric label="SFS commission" value={formatMoney(-report.totals.sfsCommission, { digits: 2 })} detail="Broker commission excluded" tone="violet" />
        <Metric label="ICE fees" value={formatMoney(-(report.totals.iceExchange + report.totals.iceClearing + report.totals.iceSettlement), { digits: 2 })} detail="Exchange, clearing, settlement" tone="amber" />
        <Metric label="Net realised P&L" value={formatMoney(report.totals.netPnl, { signed: true, digits: 2 })} detail={completeness.complete ? "Final MOPS basis" : "Provisional MOPS basis"} tone={report.totals.netPnl >= 0 ? "green" : "red"} />
        <Metric label="MOPS completeness" value={`${completeness.actual}/${completeness.total}`} detail={completeness.complete ? "All actual publications entered" : `${completeness.missingDates.length + completeness.incompleteDates.length} dates require attention`} tone={completeness.complete ? "teal" : "orange"} progress={coverage} />
      </div>

      {state.hasUnrecordedChanges && (
        <div className="app-sfs-report__notice">
          <ShieldCheck size={18} aria-hidden="true" />
          <div><strong>Report inputs changed</strong><span>The current calculation differs from the latest stored revision. Review and approve the new revision before it is emailed.</span></div>
        </div>
      )}

      {report.validationErrors?.length > 0 && (
        <div className="app-sfs-report__notice">
          <ShieldCheck size={18} aria-hidden="true" />
          <div><strong>Report cannot be finalized</strong><span>{report.validationErrors.join(" ")}</span></div>
        </div>
      )}

      {!completeness.calendarSupported && (
        <div className="app-sfs-report__notice">
          <ShieldCheck size={18} aria-hidden="true" />
          <div><strong>Publication calendar not approved</strong><span>The {month.slice(0, 4)} Platts holiday calendar must be reviewed before this report can be finalized.</span></div>
        </div>
      )}

      <Panel>
        <SectionHeading
          title="Contract-month realised P&L"
          description={`${formatMonth(month)} ICE swap legs cleared through SFS. Values do not post to the clearing ledger.`}
        />
        <div className="app-table-frame app-table-frame--flush">
          {report.lines.length ? (
            <table className="app-table app-table--sfs">
              <thead>
                <tr><th>Trade</th><th>Product</th><th>Side</th><th>Quantity</th><th>Trade price</th><th>Final MOPS</th><th>Gross P&L</th><th>SFS</th><th>Exchange</th><th>Clearing</th><th>Settlement</th><th>Net P&L</th></tr>
              </thead>
              <tbody>{report.lines.map((line) => (
                <tr key={line.id}>
                  <td><strong>{formatDate(line.tradeDate)}</strong><small>{line.swapId}{line.leg ? ` · Leg ${line.leg}` : ""}</small></td>
                  <td><ProductBadge product={line.product} /></td>
                  <td><strong>{line.direction}</strong><small>{line.pricingBasis}</small></td>
                  <td>{formatQuantity(line.quantity, line.unit)}{line.normalizedQuantity !== line.quantity && <small>{line.normalizedQuantity.toLocaleString()} BBL normalized</small>}</td>
                  <td>${line.tradePrice.toFixed(3)}</td>
                  <td>{line.settlementMops == null ? "-" : `$${line.settlementMops.toFixed(3)}`}</td>
                  <td><Money value={line.grossPnl} digits={2} /></td>
                  <td><Money value={-line.fees.sfsCommission} digits={2} /></td>
                  <td><Money value={-line.fees.iceExchange} digits={2} /></td>
                  <td><Money value={-line.fees.iceClearing} digits={2} /></td>
                  <td><Money value={-line.fees.iceSettlement} digits={2} /></td>
                  <td><Money value={line.netPnl} digits={2} strong /></td>
                </tr>
              ))}</tbody>
            </table>
          ) : <EmptyState title="No SFS swap legs for this contract month" description="Only ICE venue swap legs whose contract month matches the selected month appear here." />}
        </div>
      </Panel>

      <Panel>
        <SectionHeading title="MOPS finality and source" description="Every scheduled publication must contain actual prices for S380, S0.5, and SGO." />
        <div className="app-sfs-report__source">
          <div>
            <strong>{report.source.name}</strong>
            <a href={PLATTS_PUBLICATION_SOURCE.url} target="_blank" rel="noreferrer">{PLATTS_PUBLICATION_SOURCE.label}</a>
          </div>
          <div>
            <span><small>Scheduled</small><strong>{completeness.total}</strong></span>
            <span><small>Complete actual</small><strong>{completeness.actual}</strong></span>
            <span><small>Estimated</small><strong>{completeness.estimated}</strong></span>
            <span><small>Missing or incomplete</small><strong>{completeness.missingDates.length + completeness.incompleteDates.length}</strong></span>
          </div>
        </div>
      </Panel>

      <Modal
        open={sendReviewOpen}
        onClose={() => setSendReviewOpen(false)}
        title={sendLabel}
        description={`${formatMonth(month)} · ${state.recipient}`}
        size="sm"
        footer={<><Button onClick={() => setSendReviewOpen(false)} disabled={busy}>Cancel</Button><Button variant="primary" icon={Send} onClick={send} disabled={busy}>{busy ? "Sending..." : sendLabel}</Button></>}
      >
        <div className="app-sfs-report__approval">
          <span><small>Gross realised P&L</small><Money value={report.totals.grossPnl} digits={2} strong /></span>
          <span><small>Total SFS and ICE fees</small><Money value={-report.totals.totalFees} digits={2} strong /></span>
          <span><small>Net realised P&L</small><Money value={report.totals.netPnl} digits={2} strong /></span>
          <p>{uncertainDelivery ? "Microsoft Graph may already have accepted this report. Confirm the resend only after checking the sender mailbox and recipient." : "Approval creates an immutable report revision and emails its PDF and CSV files. A successfully delivered revision cannot be sent again."}</p>
        </div>
      </Modal>

      <Modal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title="SFS report delivery history"
        description={formatMonth(month)}
        size="lg"
      >
        <TableFrame>
          <table className="app-table app-table--compact">
            <thead><tr><th>Revision</th><th>Status</th><th>Finalized</th><th>Approved by</th><th>Recipient</th><th>Delivery</th><th>Files</th></tr></thead>
            <tbody>{(state.history || []).map((row) => (
              <tr key={row.id}>
                <td><strong>R{row.revision}</strong></td>
                <td><StatusBadge tone={reportTone(row.status, true)}>{String(row.status).replaceAll("_", " ")}</StatusBadge></td>
                <td>{formatDateTime(row.finalized_at)} HKT<small>{row.finalized_by}</small></td>
                <td>{row.approved_by || "-"}</td>
                <td>{row.delivery?.recipient || state.recipient}</td>
                <td>{row.delivery?.sent_at ? `${formatDateTime(row.delivery.sent_at)} HKT` : row.delivery?.last_error || "Not sent"}<small>{row.delivery?.graph_request_id ? `Ref ${row.delivery.graph_request_id}` : ""}</small></td>
                <td><div className="app-row-actions"><Button size="sm" icon={Download} onClick={() => download("pdf", row.id)} disabled={busy}>PDF</Button><Button size="sm" icon={Download} onClick={() => download("csv", row.id)} disabled={busy}>CSV</Button></div></td>
              </tr>
            ))}</tbody>
          </table>
        </TableFrame>
      </Modal>

      <Modal
        open={methodologyOpen}
        onClose={() => setMethodologyOpen(false)}
        title="SFS realised P&L methodology"
        description="Contract-month recognition, MOPS finality, fee treatment, and revision controls."
        size="lg"
      >
        <div className="app-methodology">
          <p>This report is an accounting snapshot of realised SFS-cleared swap performance for one contract month. It is independent from counterparty settlement and clearing cash.</p>
          <ol>{METHODOLOGY_STEPS.map((step) => <li key={step}>{step}</li>)}</ol>
          <div className="app-methodology__sources">
            <h3>Source</h3>
            <a href={PLATTS_PUBLICATION_SOURCE.url} target="_blank" rel="noreferrer"><span>{PLATTS_PUBLICATION_SOURCE.label}</span></a>
          </div>
        </div>
      </Modal>
    </div>
  );
}
