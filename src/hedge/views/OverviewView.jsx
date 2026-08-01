import React, { useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  CircleDollarSign,
  Clock3,
  Download,
  Gauge,
  History,
  Plus,
  RefreshCcw,
  ShieldAlert,
  Trash2,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import { ClearingAccount } from "@/hedge/api/entities";
import {
  buildClearingLedger,
  buildExposureRows,
  buyingPower,
  downloadCsv,
  formatDate,
  formatMoney,
  formatMonth,
  formatQuantity,
  hktThisMonth,
  hktToday,
  latestMops,
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
  Select,
  StatusBadge,
  TableFrame,
} from "../components/ui";

const CLEARING_TYPES = [
  "Deposit",
  "Withdrawal",
  "Variation Margin Debit",
  "Variation Margin Credit",
  "SFS Fee",
  "ICE Exchange Fee",
  "ICE Clearing Fee",
  "ICE Settlement Fee",
  "Bank Charges",
  "Adjustment",
];

function activityLabel(log) {
  const action = log.action === "create" ? "Created" : log.action === "delete" ? "Deleted" : "Updated";
  return `${action} ${log.label || log.entity || "record"}`;
}

export function OverviewView({ data, settings, onNavigate, readOnly = false }) {
  const actions = useActions();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [ledgerCategory, setLedgerCategory] = useState("all");
  const [ledgerMonth, setLedgerMonth] = useState("all");
  const [ledgerStatus, setLedgerStatus] = useState("all");
  const [clearingForm, setClearingForm] = useState({ date: hktToday(), type: "Deposit", amount: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const buying = useMemo(() => buyingPower({
    clearing: data.clearing,
    swaps: data.swaps,
    mops: data.mops,
    margins: settings.iceMargins,
    usableRatio: settings.general.ice_usable_ratio,
    sgoRatio: settings.general.sgo_bbl_per_mt,
  }), [data.clearing, data.mops, data.swaps, settings.general.ice_usable_ratio, settings.general.sgo_bbl_per_mt, settings.iceMargins]);
  const exposures = useMemo(() => buildExposureRows(
    data.physicals,
    data.swaps,
    data.mops,
    settings.general.sgo_bbl_per_mt,
    settings.forwardSpreads,
  ), [data.mops, data.physicals, data.swaps, settings.forwardSpreads, settings.general.sgo_bbl_per_mt]);
  const portfolioPnl = exposures.reduce((sum, row) => sum + row.combinedPnl, 0);
  const latest = latestMops(data.mops);
  const ledger = useMemo(() => buildClearingLedger(data.clearing), [data.clearing]);
  const ledgerNewest = useMemo(() => [...ledger].reverse(), [ledger]);
  const pendingClearing = ledger.filter((row) => row.status === "pending");
  const ledgerCategories = useMemo(() => [...new Set(ledger.map((row) => row.category))].sort(), [ledger]);
  const ledgerMonths = useMemo(() => [...new Set(ledger.map((row) => String(row.date || "").slice(0, 7)).filter(Boolean))].sort().reverse(), [ledger]);
  const filteredLedger = useMemo(() => {
    const query = ledgerSearch.trim().toLowerCase();
    return ledgerNewest.filter((row) => {
      if (ledgerCategory !== "all" && row.category !== ledgerCategory) return false;
      if (ledgerMonth !== "all" && !String(row.date || "").startsWith(ledgerMonth)) return false;
      const status = row.status === "pending" ? "pending" : "confirmed";
      if (ledgerStatus !== "all" && status !== ledgerStatus) return false;
      return !query || `${row.category} ${row.type || ""} ${row.notes || ""} ${row.date || ""}`.toLowerCase().includes(query);
    });
  }, [ledgerCategory, ledgerMonth, ledgerNewest, ledgerSearch, ledgerStatus]);
  const ledgerCredits = filteredLedger.reduce((sum, row) => sum + Math.max(0, row.signedAmount), 0);
  const ledgerDebits = filteredLedger.reduce((sum, row) => sum + Math.abs(Math.min(0, row.signedAmount)), 0);
  const openPhysicals = data.physicals.filter((row) => !row.is_closed).length;
  const currentSwaps = data.swaps.filter((row) => !row.is_expired).length;
  const unhedged = exposures.filter((row) => Math.abs(row.netExposure) >= Math.max(10, row.physicalQty * 0.1));
  const staleMops = !latest?.price_date || (new Date(`${hktToday()}T00:00:00`) - new Date(`${latest.price_date}T00:00:00`)) / 86400000 >= 3;
  const settlementOpen = !settings.closedMonths.includes(hktThisMonth());
  const recentClearing = ledgerNewest.slice(0, 8);
  const recentActivity = data.auditLogs.slice(0, 7);

  const submitClearing = async () => {
    const amount = Number(clearingForm.amount);
    if (!clearingForm.date || !Number.isFinite(amount) || (clearingForm.type !== "Adjustment" && amount <= 0)) {
      setError(new Error("Choose a date and enter a valid amount greater than zero."));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...clearingForm,
        amount,
        notes: clearingForm.notes.trim(),
        status: "confirmed",
      };
      await actions.create({ entity: ClearingAccount, entityName: "ClearingAccount", payload, label: `${payload.type} ${formatMoney(amount, { digits: 2 })} (${payload.date})` });
      setDrawerOpen(false);
      setClearingForm({ date: hktToday(), type: "Deposit", amount: "", notes: "" });
    } catch (nextError) {
      setError(nextError);
    } finally {
      setSaving(false);
    }
  };

  const approveClearing = async (record) => {
    setSaving(true);
    try {
      await actions.update({ entity: ClearingAccount, entityName: "ClearingAccount", id: record.id, payload: { status: "confirmed", date: record.date || hktToday() }, before: record, label: `Approved ${record.type} ${formatMoney(record.amount, { digits: 2 })}` });
    } finally {
      setSaving(false);
    }
  };

  const removeClearing = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await actions.remove({ entity: ClearingAccount, entityName: "ClearingAccount", record: deleteTarget, label: `${deleteTarget.type} ${formatMoney(deleteTarget.amount, { digits: 2 })}` });
      setDeleteTarget(null);
    } finally {
      setSaving(false);
    }
  };

  const exportClearing = () => downloadCsv(
    `clearing_ledger_${hktToday()}.csv`,
    ["Date", "Category", "Type", "Notes", "Amount", "Running balance", "Status"],
    filteredLedger.map((row) => [row.date, row.category, row.type, row.notes, row.signedAmount, row.runningBalance, row.status === "pending" ? "Pending" : "Confirmed"]),
  );

  return (
    <div className="app-page">
      <PageHeader
        eyebrow={`Hong Kong desk | ${formatDate(hktToday())}`}
        title="Position control"
        description="A live view of hedge coverage, buying power, market readiness, and the work that needs attention today."
        status={<StatusBadge tone="positive">Live data</StatusBadge>}
        actions={!readOnly ? <Button variant="primary" icon={Plus} onClick={() => setDrawerOpen(true)}>Clearing entry</Button> : null}
      />

      <div className="app-metric-grid app-metric-grid--4">
        <Metric label="Account equity" value={formatMoney(buying.equity, { digits: 0 })} detail={`${formatMoney(buying.cash, { digits: 0 })} cash | ${formatMoney(buying.unrealizedMtm, { signed: true, digits: 0 })} MTM`} icon={WalletCards} tone="teal" />
        <Metric label="Used initial margin" value={formatMoney(buying.used, { digits: 0 })} detail={`${buying.utilization.toFixed(1)}% of usable equity`} progress={buying.utilization} icon={Gauge} tone={buying.utilization >= 85 ? "red" : buying.utilization >= 70 ? "amber" : "green"} />
        <Metric label="Remaining buying power" value={formatMoney(buying.remaining, { digits: 0 })} detail={`${Math.max(0, 100 - buying.utilization).toFixed(1)}% capacity remaining`} icon={ShieldAlert} tone={buying.remaining < 0 ? "red" : "default"} />
        <Metric label="Portfolio P&L" value={formatMoney(portfolioPnl, { signed: true, digits: 0 })} detail={`${openPhysicals} open physicals | ${currentSwaps} active hedges`} icon={TrendingUp} tone={portfolioPnl >= 0 ? "green" : "red"} />
      </div>

      <div className="app-overview-grid">
        <Panel className="app-overview-exposure">
          <SectionHeading title="Exposure by counterparty" description="Physical cargo versus live paper hedges, ranked by open quantity." actions={<Button size="sm" onClick={() => onNavigate("/hedges")}>Manage hedges</Button>} />
          {exposures.length ? (
            <div className="app-table-frame app-table-frame--flush">
              <table className="app-table app-table--compact">
                <thead><tr><th>Counterparty</th><th>Product</th><th>Physical</th><th>Hedged</th><th>Coverage</th><th>Net exposure</th><th>Combined P&amp;L</th></tr></thead>
                <tbody>
                  {exposures.slice(0, 12).map((row) => {
                    const over = row.hedgeRatio != null && row.hedgeRatio > 105;
                    const under = row.hedgeRatio == null || row.hedgeRatio < 90;
                    return (
                      <tr key={row.key}>
                        <td><strong>{row.counterparty}</strong></td>
                        <td><ProductBadge product={row.product} /></td>
                        <td>{formatQuantity(row.physicalQty, row.unit)}</td>
                        <td>{formatQuantity(row.hedgeQty, row.unit)}</td>
                        <td><StatusBadge tone={over || under ? "warning" : "positive"}>{row.hedgeRatio == null ? "No cargo" : `${Math.round(row.hedgeRatio)}%`}</StatusBadge></td>
                        <td><strong className={Math.abs(row.netExposure) > 0 ? row.netExposure > 0 ? "app-text-warning" : "app-text-violet" : ""}>{formatQuantity(row.netExposure, row.unit)}</strong></td>
                        <td><Money value={row.combinedPnl} strong /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <EmptyState title="No position exposure" description="Create a physical trade or hedge to populate the desk view." />}
        </Panel>

        <Panel className="app-attention-panel">
          <SectionHeading title="Attention queue" description="Items that may block trading or month close." />
          <div className="app-attention-list">
            {unhedged.slice(0, 3).map((row) => (
              <button type="button" key={row.key} onClick={() => onNavigate("/hedges")}>
                <span className="app-attention-list__icon is-warning"><AlertCircle size={17} /></span>
                <span><strong>{row.counterparty} {row.product} coverage</strong><small>{formatQuantity(row.netExposure, row.unit)} net exposure</small></span>
                <ArrowRight size={16} />
              </button>
            ))}
            {pendingClearing.map((row) => (
              <button type="button" key={row.id} onClick={() => approveClearing(row)}>
                <span className="app-attention-list__icon is-red"><Clock3 size={17} /></span>
                <span><strong>Clearing entry awaiting approval</strong><small>{formatMoney(row.signedAmount, { digits: 2 })} | {formatDate(row.date)}</small></span>
                <Check size={16} />
              </button>
            ))}
            {staleMops && (
              <button type="button" onClick={() => onNavigate("/markets")}>
                <span className="app-attention-list__icon is-warning"><RefreshCcw size={17} /></span>
                <span><strong>MOPS publication may be stale</strong><small>Latest record {latest ? formatDate(latest.price_date) : "not available"}</small></span>
                <ArrowRight size={16} />
              </button>
            )}
            {settlementOpen && (
              <button type="button" onClick={() => onNavigate("/settlement")}>
                <span className="app-attention-list__icon is-teal"><CircleDollarSign size={17} /></span>
                <span><strong>{formatMonth(hktThisMonth())} settlement is open</strong><small>Review fees, counterparties, and invoices</small></span>
                <ArrowRight size={16} />
              </button>
            )}
            {!unhedged.length && !pendingClearing.length && !staleMops && !settlementOpen && <div className="app-attention-clear"><Check size={20} /><strong>No urgent desk items</strong><span>Positions and controls are within their current thresholds.</span></div>}
          </div>
        </Panel>
      </div>

      <div className="app-overview-lower">
        <Panel>
          <SectionHeading
            title="Clearing account"
            description={`${formatMoney(buying.cash, { digits: 2 })} confirmed cash balance | latest ${Math.min(8, ledger.length)} of ${ledger.length} entries`}
            actions={<div className="app-row-actions"><Button size="sm" icon={History} onClick={() => setLedgerOpen(true)}>View all</Button>{!readOnly && <Button size="sm" icon={Plus} onClick={() => setDrawerOpen(true)}>Add entry</Button>}</div>}
          />
          <div className="app-table-frame app-table-frame--flush">
            <table className="app-table app-table--compact">
              <thead><tr><th>Date</th><th>Category</th><th>Notes</th><th>Amount</th><th>Status</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {recentClearing.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDate(row.date)}</td>
                    <td><strong>{row.category}</strong></td>
                    <td className="app-table__wrap">{row.notes || "-"}</td>
                    <td><Money value={row.signedAmount} digits={2} /></td>
                    <td>{row.status === "pending" ? <StatusBadge tone="warning">Pending</StatusBadge> : <StatusBadge tone="positive">Confirmed</StatusBadge>}</td>
                    <td><div className="app-row-actions">{!readOnly && <>{row.status === "pending" && <IconButton label="Approve clearing entry" icon={Check} variant="positive" onClick={() => approveClearing(row)} />}<IconButton label="Delete clearing entry" icon={Trash2} variant="danger" onClick={() => setDeleteTarget(row)} /></>}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel>
          <SectionHeading title="Recent activity" description="Latest audited changes across live records." actions={<Button size="sm" onClick={() => onNavigate("/audit")}>View audit</Button>} />
          <div className="app-activity-list">
            {recentActivity.length ? recentActivity.map((log) => (
              <div key={log.id}>
                <span className={`app-activity-list__dot is-${log.action || "update"}`} />
                <span><strong>{activityLabel(log)}</strong><small>{new Date(log.created_date).toLocaleString("en-GB", { timeZone: "Asia/Hong_Kong", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</small></span>
              </div>
            )) : <EmptyState title="No audit activity" />}
          </div>
        </Panel>
      </div>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="New clearing entry"
        description="Record clearing cash movements and operating costs. Broker commissions and trader settlements remain in Settlement."
        width="medium"
        footer={<><Button onClick={() => setDrawerOpen(false)} disabled={saving}>Cancel</Button><Button variant="primary" onClick={submitClearing} disabled={saving}>{saving ? "Saving..." : "Add entry"}</Button></>}
      >
        {error && <InlineError error={error} />}
        <section className="app-form-section">
          <div className="app-form-grid app-form-grid--2">
            <Field label="Date" required><input className="app-input" type="date" value={clearingForm.date} onChange={(event) => setClearingForm((current) => ({ ...current, date: event.target.value }))} /></Field>
            <Field label="Type" required><Select value={clearingForm.type} onChange={(event) => setClearingForm((current) => ({ ...current, type: event.target.value }))}>{CLEARING_TYPES.map((value) => <option key={value}>{value}</option>)}</Select></Field>
            <Field label="Amount (USD)" required className="app-field--span-2"><input className="app-input" type="number" step="any" value={clearingForm.amount} onChange={(event) => setClearingForm((current) => ({ ...current, amount: event.target.value }))} /></Field>
            <Field label="Notes" className="app-field--span-2"><textarea className="app-input app-textarea" rows="4" value={clearingForm.notes} onChange={(event) => setClearingForm((current) => ({ ...current, notes: event.target.value }))} /></Field>
          </div>
        </section>
      </Drawer>

      <Modal
        open={ledgerOpen}
        onClose={() => setLedgerOpen(false)}
        title="Clearing account ledger"
        description={`${ledger.length} clearing cash entries. Broker commissions and trader settlements are excluded.`}
        size="xl"
      >
        <div className="app-metric-grid app-metric-grid--3">
          <Metric label="Filtered entries" value={filteredLedger.length.toLocaleString()} detail={`${ledger.length} total clearing records`} tone="teal" />
          <Metric label="Deposits and credits" value={formatMoney(ledgerCredits, { digits: 2 })} detail="Within current filters" tone="green" />
          <Metric label="Costs and debits" value={formatMoney(-ledgerDebits, { digits: 2 })} detail="Within current filters" tone="red" />
        </div>
        <div className="app-toolbar">
          <SearchInput value={ledgerSearch} onChange={setLedgerSearch} placeholder="Search category or notes..." />
          <Select value={ledgerCategory} onChange={(event) => setLedgerCategory(event.target.value)} className="app-toolbar__select"><option value="all">All categories</option>{ledgerCategories.map((value) => <option key={value} value={value}>{value}</option>)}</Select>
          <Select value={ledgerMonth} onChange={(event) => setLedgerMonth(event.target.value)} className="app-toolbar__select"><option value="all">All months</option>{ledgerMonths.map((value) => <option key={value} value={value}>{formatMonth(value)}</option>)}</Select>
          <Select value={ledgerStatus} onChange={(event) => setLedgerStatus(event.target.value)} className="app-toolbar__select"><option value="all">All statuses</option><option value="confirmed">Confirmed</option><option value="pending">Pending</option></Select>
          <IconButton label="Export filtered clearing ledger" icon={Download} onClick={exportClearing} />
        </div>
        <TableFrame>
          {filteredLedger.length ? (
            <table className="app-table app-table--compact">
              <thead><tr><th>Date</th><th>Category</th><th>Notes</th><th>Amount</th><th>Running balance</th><th>Status</th><th aria-label="Actions" /></tr></thead>
              <tbody>{filteredLedger.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.date)}</td>
                  <td><strong>{row.category}</strong><small>{row.type !== row.category ? row.type : ""}</small></td>
                  <td className="app-table__wrap">{row.notes || "-"}</td>
                  <td><Money value={row.signedAmount} digits={2} /></td>
                  <td><Money value={row.runningBalance} digits={2} strong /></td>
                  <td>{row.status === "pending" ? <StatusBadge tone="warning">Pending</StatusBadge> : <StatusBadge tone="positive">Confirmed</StatusBadge>}</td>
                  <td><div className="app-row-actions">{!readOnly && <>{row.status === "pending" && <IconButton label="Approve clearing entry" icon={Check} variant="positive" onClick={() => approveClearing(row)} />}<IconButton label="Delete clearing entry" icon={Trash2} variant="danger" onClick={() => setDeleteTarget(row)} /></>}</div></td>
                </tr>
              ))}</tbody>
            </table>
          ) : <EmptyState title="No clearing entries match" description="Adjust the ledger filters to see other records." />}
        </TableFrame>
      </Modal>

      <ConfirmDialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} onConfirm={removeClearing} busy={saving} title="Delete clearing entry?" description={deleteTarget ? `${deleteTarget.type} on ${formatDate(deleteTarget.date)}` : ""} />
    </div>
  );
}
