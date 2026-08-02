import React, { useMemo, useState } from "react";
import {
  CloudUpload,
  Copy,
  Download,
  Edit3,
  Plus,
  Trash2,
} from "lucide-react";
import { ClearingAccount, SwapHedge } from "@/hedge/api/entities";
import { previewHedgeSalesforce, pushHedgeToSalesforce } from "@/hedge/api/backendFunctions";
import {
  BROKER_EXCHANGE,
  calcSwapFees,
  calcSwapMtm,
  downloadCsv,
  estimateSwapInitialMargin,
  formatDate,
  formatMoney,
  formatMonth,
  formatQuantity,
  hktThisMonth,
  hktToday,
  isSwapLive,
  paperHedgeExpiryStatus,
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
  Money,
  PageHeader,
  ProductBadge,
  SearchInput,
  SegmentedControl,
  Select,
  StatusBadge,
  TableFrame,
} from "../components/ui";

const BLANK_SWAP = {
  trade_date: hktToday(),
  trade_type: "STANDARD",
  product: "",
  direction: "BUY",
  swap_month: hktThisMonth(),
  quantity: "",
  unit: "MT",
  price: "",
  venue: "ICE",
  broker: "",
  counterparty: "",
  pricing_basis: "WMA",
  bal_start_date: "",
  leg1_month: hktThisMonth(),
  leg1_price: "",
  leg1_basis: "WMA",
  leg1_bal_date: "",
  leg2_month: hktThisMonth(),
  leg2_price: "",
  leg2_basis: "WMA",
  leg2_bal_date: "",
  physical_trade_ids: [],
  notes: "",
  round_trip: false,
};

function normalizeSwap(form, settings) {
  const spread = form.trade_type === "SPREAD";
  const payload = {
    ...form,
    quantity: Number(form.quantity) || 0,
    price: spread ? 0 : Number(form.price) || 0,
    leg1_price: spread ? Number(form.leg1_price) || 0 : 0,
    leg2_price: spread ? Number(form.leg2_price) || 0 : 0,
    swap_month: spread ? form.leg1_month || form.leg2_month || "" : form.swap_month,
    pricing_basis: spread ? "WMA" : form.pricing_basis || "WMA",
    physical_trade_ids: form.physical_trade_ids || [],
    round_trip: Boolean(form.round_trip),
  };
  payload.initial_margin = BROKER_EXCHANGE.includes(payload.broker)
    ? estimateSwapInitialMargin(payload, settings.iceMargins, settings.general.sgo_bbl_per_mt)
    : 0;
  return payload;
}

function SwapLeg({ number, form, setField }) {
  const prefix = `leg${number}`;
  return (
    <section className={`app-form-section app-form-section--leg-${number}`}>
      <div className="app-form-section__title">Leg {number} - {number === 1 ? "Buy" : "Sell"}</div>
      <div className="app-form-grid app-form-grid--2">
        <Field label="Month" required><input className="app-input" type="month" value={form[`${prefix}_month`] || ""} onChange={(event) => setField(`${prefix}_month`, event.target.value)} /></Field>
        <Field label="Price (USD)" required><input className="app-input" type="number" step="any" value={form[`${prefix}_price`] ?? ""} onChange={(event) => setField(`${prefix}_price`, event.target.value)} /></Field>
        <Field label="Pricing basis" className="app-field--span-2"><Select value={form[`${prefix}_basis`] || "WMA"} onChange={(event) => setField(`${prefix}_basis`, event.target.value)}><option value="WMA">Full month WMA</option><option value="BAL_TODAY">Balance from today</option><option value="BAL_TOMORROW">Balance from tomorrow</option></Select></Field>
        {form[`${prefix}_basis`] !== "WMA" && <Field label="Balance start" className="app-field--span-2"><input className="app-input" type="date" value={form[`${prefix}_bal_date`] || ""} onChange={(event) => setField(`${prefix}_bal_date`, event.target.value)} /></Field>}
      </div>
    </section>
  );
}

export function HedgesView({ data, settings, quickCreateSignal = 0, readOnly = false }) {
  const actions = useActions();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("live");
  const [month, setMonth] = useState("all");
  const [drawer, setDrawer] = useState(null);
  const [form, setForm] = useState(BLANK_SWAP);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [salesforceDrawer, setSalesforceDrawer] = useState(null);

  React.useEffect(() => {
    if (quickCreateSignal) {
      setForm({ ...BLANK_SWAP, trade_date: hktToday(), swap_month: hktThisMonth(), leg1_month: hktThisMonth(), leg2_month: hktThisMonth() });
      setDrawer({ mode: "create" });
    }
  }, [quickCreateSignal]);

  const months = useMemo(() => [...new Set(data.swaps.map((record) => record.swap_month || record.leg1_month).filter(Boolean))].sort().reverse(), [data.swaps]);
  const rows = useMemo(() => data.swaps
    .filter((record) => status === "all" || (status === "live" ? isSwapLive(record) : !isSwapLive(record)))
    .filter((record) => month === "all" || [record.swap_month, record.leg1_month, record.leg2_month].includes(month))
    .filter((record) => `${record.product || ""} ${record.direction || ""} ${record.trade_type || ""} ${record.venue || ""} ${record.broker || ""} ${record.counterparty || ""} ${record.notes || ""}`.toLowerCase().includes(search.toLowerCase()))
    .sort((left, right) => String(right.trade_date || "").localeCompare(String(left.trade_date || ""))), [data.swaps, month, search, status]);

  const openCreate = () => {
    setForm({ ...BLANK_SWAP, trade_date: hktToday(), swap_month: hktThisMonth(), leg1_month: hktThisMonth(), leg2_month: hktThisMonth() });
    setFormError(null);
    setDrawer({ mode: "create" });
  };
  const openEdit = (record) => {
    setForm({ ...BLANK_SWAP, ...record, physical_trade_ids: record.physical_trade_ids || [] });
    setFormError(null);
    setDrawer({ mode: "edit", record });
  };
  const duplicate = (record) => {
    const { id, created_date, updated_date, ...copy } = record;
    setForm({ ...BLANK_SWAP, ...copy, trade_date: hktToday() });
    setFormError(null);
    setDrawer({ mode: "create", source: record });
  };
  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!form.trade_date || !form.product || !form.quantity || !form.venue) {
      setFormError(new Error("Trade date, product, quantity, and venue are required."));
      return;
    }
    if (form.venue === "ICE" && !form.broker && !form.counterparty) {
      setFormError(new Error("ICE hedges require a broker or counterparty."));
      return;
    }
    if (form.trade_type === "SPREAD" && (!form.leg1_month || !form.leg2_month || !form.leg1_price || !form.leg2_price)) {
      setFormError(new Error("Both spread legs require a month and price."));
      return;
    }
    if (form.trade_type !== "SPREAD" && (!form.swap_month || !form.price)) {
      setFormError(new Error("A standard hedge requires a swap month and price."));
      return;
    }
    const missingBalanceDate = form.trade_type === "SPREAD"
      ? [1, 2].some((leg) => form[`leg${leg}_basis`] !== "WMA" && !form[`leg${leg}_bal_date`])
      : form.pricing_basis !== "WMA" && !form.bal_start_date;
    if (missingBalanceDate) {
      setFormError(new Error("A balance start date is required for balance-month pricing."));
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload = normalizeSwap(form, settings);
      const label = `${payload.product} ${payload.quantity}${payload.unit} ${payload.trade_type === "SPREAD" ? "spread" : payload.direction} ${payload.swap_month} [${payload.venue}]`;
      if (drawer?.mode === "edit") {
        await actions.update({ entity: SwapHedge, entityName: "SwapHedge", id: drawer.record.id, payload, before: drawer.record, label });
      } else {
        await actions.create({ entity: SwapHedge, entityName: "SwapHedge", payload, label });
        if (payload.venue === "ICE" && payload.quantity > 0) {
          const fees = calcSwapFees(payload, settings.rates);
          const amount = Math.round((fees.sfsCommission + fees.ice + fees.iceClearing) * 100) / 100;
          if (amount > 0) {
            const tradeDescription = `${payload.product} ${payload.quantity}${payload.unit} ${payload.trade_type === "SPREAD" ? `SPREAD ${payload.leg1_month}/${payload.leg2_month}` : `${payload.direction} ${payload.swap_month}`}`;
            await actions.create({
              entity: ClearingAccount,
              entityName: "ClearingAccount",
              payload: {
                date: payload.trade_date || hktToday(),
                type: "Trade Fee",
                amount,
                status: "confirmed",
                notes: `ICE trade costs - ${tradeDescription} | SFS $${fees.sfsCommission.toFixed(2)} | Exchange $${fees.ice.toFixed(2)} | Clearing $${fees.iceClearing.toFixed(2)} (auto)`,
              },
              label: `ICE trade costs ${tradeDescription}`,
            });
          }
        }
      }
      setDrawer(null);
    } catch (error) {
      setFormError(error);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await actions.remove({ entity: SwapHedge, entityName: "SwapHedge", record: deleteTarget, label: `${deleteTarget.product} ${deleteTarget.direction || deleteTarget.trade_type} ${deleteTarget.swap_month || ""}` });
      setDeleteTarget(null);
    } finally {
      setSaving(false);
    }
  };

  const loadSalesforcePreview = async (record) => {
    setSalesforceDrawer({ record, loading: true, preview: null, error: null, syncing: false, result: null });
    try {
      const preview = await previewHedgeSalesforce({ swapId: record.id, expectedRevision: record.revision });
      setSalesforceDrawer((current) => current?.record.id === record.id ? { ...current, loading: false, preview } : current);
    } catch (error) {
      setSalesforceDrawer((current) => current?.record.id === record.id ? { ...current, loading: false, error } : current);
    }
  };

  const syncSalesforce = async () => {
    const current = salesforceDrawer;
    if (!current?.preview?.ready || current.syncing) return;
    setSalesforceDrawer((value) => ({ ...value, syncing: true, error: null, result: null }));
    try {
      const result = await pushHedgeToSalesforce({
        swapId: current.record.id,
        expectedRevision: current.record.revision,
        previewFingerprint: current.preview.previewFingerprint,
        idempotencyKey: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${current.record.id}`,
      });
      const preview = await previewHedgeSalesforce({ swapId: current.record.id, expectedRevision: current.record.revision });
      setSalesforceDrawer((value) => ({ ...value, syncing: false, result, preview }));
    } catch (error) {
      setSalesforceDrawer((value) => ({ ...value, syncing: false, error }));
    }
  };

  const exportRows = () => downloadCsv(
    `hedges_${hktToday()}.csv`,
    ["Trade date", "Type", "Product", "Direction", "Month", "Quantity", "Unit", "Price", "Venue", "Broker", "Counterparty", "Initial margin", "Expired"],
    rows.map((record) => [record.trade_date, record.trade_type, record.product, record.direction, record.swap_month, record.quantity, record.unit, record.price, record.venue, record.broker, record.counterparty, record.initial_margin, record.is_expired ? "Yes" : "No"]),
  );

  const togglePhysical = (id) => setForm((current) => ({
    ...current,
    physical_trade_ids: (current.physical_trade_ids || []).includes(id)
      ? current.physical_trade_ids.filter((value) => value !== id)
      : [...(current.physical_trade_ids || []), id],
  }));

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Paper risk"
        title="Hedges"
        description="Capture standard swaps and spreads, link them to cargoes, and monitor margin, fees, and mark-to-market."
        actions={!readOnly ? <Button variant="primary" icon={Plus} onClick={openCreate}>New hedge</Button> : null}
      />

      <div className="app-toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="Search product, venue, party..." />
        <SegmentedControl
          value={status}
          onChange={setStatus}
          label="Hedge status"
          options={[
            { value: "live", label: "Live", count: data.swaps.filter(isSwapLive).length },
            { value: "expired", label: "Expired", count: data.swaps.filter((record) => !isSwapLive(record)).length },
            { value: "all", label: "All" },
          ]}
        />
        <Select value={month} onChange={(event) => setMonth(event.target.value)} className="app-toolbar__select"><option value="all">All months</option>{months.map((value) => <option key={value} value={value}>{formatMonth(value)}</option>)}</Select>
        <IconButton label="Export filtered hedges" icon={Download} onClick={exportRows} />
      </div>

      <TableFrame>
        {rows.length ? (
          <table className="app-table app-table--hedges">
            <thead><tr><th>Status</th><th>Trade</th><th>Product</th><th>Direction / month</th><th>Quantity</th><th>Price / market</th><th>Venue / party</th><th>Margin / fees</th><th>Net P&amp;L</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {rows.map((record) => {
                const live = isSwapLive(record);
                const expiry = paperHedgeExpiryStatus(record, data.mops, new Date(), data.mopsMonthVerifications || []);
                const pendingMonth = expiry.months.find((item) => !item.ready);
                const mtm = calcSwapMtm(record, data.mops, settings.general.sgo_bbl_per_mt);
                const fees = calcSwapFees(record, settings.rates);
                const totalFees = fees.total + (!live ? fees.iceSettlement : 0);
                return (
                  <tr key={record.id}>
                    <td><StatusBadge tone={live ? "positive" : "neutral"}>{live ? "Live" : "Expired"}</StatusBadge><small>{live ? pendingMonth ? pendingMonth.complete !== pendingMonth.total ? `${pendingMonth.complete}/${pendingMonth.total} MOPS complete` : pendingMonth.verification && !pendingMonth.verification.is_current ? "Monthly verification stale" : "Monthly average verification pending" : "Awaiting final MOPS" : "Final monthly average verified"}</small></td>
                    <td><strong>{formatDate(record.trade_date)}</strong><small>{record.trade_type === "SPREAD" ? "Calendar spread" : "Outright swap"}</small></td>
                    <td><ProductBadge product={record.product} /></td>
                    <td><strong className={record.trade_type === "SPREAD" ? "app-text-violet" : record.direction === "BUY" ? "app-text-positive" : "app-text-negative"}>{record.trade_type === "SPREAD" ? "SPREAD" : record.direction}</strong><small>{record.trade_type === "SPREAD" ? `${formatMonth(record.leg1_month)} / ${formatMonth(record.leg2_month)}` : formatMonth(record.swap_month)}</small></td>
                    <td><strong>{formatQuantity(record.quantity, record.unit)}</strong>{record.round_trip && <small>Round trip</small>}</td>
                    <td><strong>{record.trade_type === "SPREAD" ? `$${record.leg1_price} / $${record.leg2_price}` : `$${record.price}`}</strong><small>{mtm?.isSpread ? "Two-leg MTM" : mtm?.mtmAvg != null ? `Market $${mtm.mtmAvg.toFixed(3)}` : "Market pending"}</small></td>
                    <td><strong>{record.venue || "-"}{record.broker ? ` / ${record.broker}` : ""}</strong><small>{record.counterparty || "No counterparty"}</small></td>
                    <td><strong>{formatMoney(record.initial_margin || estimateSwapInitialMargin(record, settings.iceMargins, settings.general.sgo_bbl_per_mt), { digits: 0 })}</strong><small>Fees {formatMoney(-totalFees, { digits: 2 })}</small></td>
                    <td><Money value={mtm ? mtm.value - totalFees : null} strong /></td>
                    <td><div className="app-row-actions">{!readOnly && <>{!live && <IconButton label="Preview Salesforce allocation" icon={CloudUpload} variant="quiet" onClick={() => loadSalesforcePreview(record)} />}<IconButton label="Duplicate hedge" icon={Copy} variant="quiet" onClick={() => duplicate(record)} /><IconButton label="Edit hedge" icon={Edit3} variant="quiet" onClick={() => openEdit(record)} /><IconButton label="Delete hedge" icon={Trash2} variant="danger" onClick={() => setDeleteTarget(record)} /></>}</div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <EmptyState title="No hedges match" description="Adjust the filters or create a new paper hedge." action={<Button variant="primary" icon={Plus} onClick={openCreate}>New hedge</Button>} />}
      </TableFrame>

      <Drawer
        open={Boolean(drawer)}
        onClose={() => setDrawer(null)}
        title={drawer?.mode === "edit" ? "Edit hedge" : "New hedge"}
        description="Use an outright for one month or a spread for paired buy and sell legs."
        footer={<><Button onClick={() => setDrawer(null)} disabled={saving}>Cancel</Button><Button variant="primary" onClick={save} disabled={saving}>{saving ? "Saving..." : drawer?.mode === "edit" ? "Save changes" : "Create hedge"}</Button></>}
      >
        {formError && <InlineError error={formError} />}
        <SegmentedControl value={form.trade_type || "STANDARD"} onChange={(value) => setField("trade_type", value)} label="Hedge type" options={[{ value: "STANDARD", label: "Outright" }, { value: "SPREAD", label: "Spread" }]} />
        <section className="app-form-section">
          <div className="app-form-section__title">Trade details</div>
          <div className="app-form-grid app-form-grid--2">
            <Field label="Trade date" required><input className="app-input" type="date" value={form.trade_date || ""} onChange={(event) => setField("trade_date", event.target.value)} /></Field>
            <Field label="Product" required><Select value={form.product || ""} onChange={(event) => { setField("product", event.target.value); if (event.target.value === "SGO") setField("unit", "BBL"); }}><option value="">Select product</option>{settings.lists.products.map((value) => <option key={value}>{value}</option>)}</Select></Field>
            <Field label="Quantity" required><input className="app-input" type="number" step="any" value={form.quantity ?? ""} onChange={(event) => setField("quantity", event.target.value)} /></Field>
            <Field label="Unit"><Select value={form.unit || "MT"} onChange={(event) => setField("unit", event.target.value)}><option value="MT">MT</option><option value="BBL">BBL</option></Select></Field>
            <Field label="Venue" required><Select value={form.venue || ""} onChange={(event) => setField("venue", event.target.value)}>{settings.lists.venues.map((value) => <option key={value}>{value}</option>)}</Select></Field>
            <Field label="Broker"><Select value={form.broker || ""} onChange={(event) => setField("broker", event.target.value)}><option value="">No broker</option>{settings.lists.brokers.map((value) => <option key={value}>{value}</option>)}</Select></Field>
            <Field label="Counterparty" className="app-field--span-2"><Select value={form.counterparty || ""} onChange={(event) => setField("counterparty", event.target.value)}><option value="">No counterparty</option>{settings.lists.counterparts.map((value) => <option key={value}>{value}</option>)}</Select></Field>
          </div>
        </section>
        {form.trade_type === "SPREAD" ? (
          <div className="app-form-split"><SwapLeg number={1} form={form} setField={setField} /><SwapLeg number={2} form={form} setField={setField} /></div>
        ) : (
          <section className="app-form-section">
            <div className="app-form-section__title">Outright pricing</div>
            <div className="app-form-grid app-form-grid--2">
              <Field label="Direction"><Select value={form.direction || "BUY"} onChange={(event) => setField("direction", event.target.value)}><option value="BUY">Buy</option><option value="SELL">Sell</option></Select></Field>
              <Field label="Swap month" required><input className="app-input" type="month" value={form.swap_month || ""} onChange={(event) => setField("swap_month", event.target.value)} /></Field>
              <Field label="Price (USD)" required><input className="app-input" type="number" step="any" value={form.price ?? ""} onChange={(event) => setField("price", event.target.value)} /></Field>
              <Field label="Pricing basis"><Select value={form.pricing_basis || "WMA"} onChange={(event) => setField("pricing_basis", event.target.value)}><option value="WMA">Full month WMA</option><option value="BAL_TODAY">Balance from today</option><option value="BAL_TOMORROW">Balance from tomorrow</option></Select></Field>
              {form.pricing_basis !== "WMA" && <Field label="Balance start" className="app-field--span-2"><input className="app-input" type="date" value={form.bal_start_date || ""} onChange={(event) => setField("bal_start_date", event.target.value)} /></Field>}
            </div>
          </section>
        )}
        <section className="app-form-section">
          <div className="app-form-section__title">Linked physical trades</div>
          <div className="app-link-list">
            {data.physicals.filter((record) => !record.is_closed && (!form.product || record.product === form.product)).length ? data.physicals.filter((record) => !record.is_closed && (!form.product || record.product === form.product)).map((record) => (
              <label key={record.id} className="app-link-option"><input type="checkbox" checked={(form.physical_trade_ids || []).includes(record.id)} onChange={() => togglePhysical(record.id)} /><span><strong>{record.vessel_name || record.counterparty || "Physical trade"}</strong><small>{record.product} {formatQuantity(record.qty_min, record.unit)} | {formatDate(record.trade_date)}</small></span></label>
            )) : <span className="app-muted-copy">No open physical trades match this product.</span>}
          </div>
        </section>
        <section className="app-form-section">
          <div className="app-form-section__title">Control</div>
          <Field label="Notes"><textarea className="app-input app-textarea" rows="4" value={form.notes || ""} onChange={(event) => setField("notes", event.target.value)} /></Field>
          <label className="app-check"><input type="checkbox" checked={Boolean(form.round_trip)} onChange={(event) => setField("round_trip", event.target.checked)} /><span>Round trip fees</span></label>
          <div className="app-callout app-callout--neutral">Expiry is automatic. FCOS waits until every contract month reaches its final Platts trading day, every scheduled MOPS row is complete, and manual verification text has been saved for the final monthly average.</div>
        </section>
      </Drawer>

      <Drawer
        open={Boolean(salesforceDrawer)}
        onClose={() => !salesforceDrawer?.syncing && setSalesforceDrawer(null)}
        title="Salesforce hedge allocation"
        description="Review final paper-hedge P&L and its one-per-STEM allocations before the all-or-none Salesforce transaction."
        footer={<><Button onClick={() => setSalesforceDrawer(null)} disabled={salesforceDrawer?.syncing}>Close</Button>{!readOnly && <Button variant="primary" icon={CloudUpload} onClick={syncSalesforce} disabled={!salesforceDrawer?.preview?.ready || salesforceDrawer?.syncing}>{salesforceDrawer?.syncing ? "Synchronizing..." : "Synchronize all allocations"}</Button>}</>}
      >
        {salesforceDrawer?.loading && <p className="app-muted-copy">Calculating final MOPS and validating live Salesforce records...</p>}
        {salesforceDrawer?.error && <InlineError error={salesforceDrawer.error} />}
        {salesforceDrawer?.result && <div className="app-callout app-callout--positive">Salesforce synchronized {salesforceDrawer.result.results?.length || 0} allocation(s) in one transaction.</div>}
        {salesforceDrawer?.preview && <div className="app-stack">
          <section className="app-form-section">
            <div className="app-form-section__title">Final calculation</div>
            <div className="app-kpi-grid app-kpi-grid--4">
              <div className="app-kpi"><span>Gross P&amp;L</span><strong>{formatMoney(salesforceDrawer.preview.financials.grossPnl, { signed: true, digits: 2 })}</strong></div>
              <div className="app-kpi"><span>Fees</span><strong>{formatMoney(-salesforceDrawer.preview.financials.fees, { signed: true, digits: 2 })}</strong></div>
              <div className="app-kpi"><span>Net P&amp;L</span><strong>{formatMoney(salesforceDrawer.preview.financials.netPnl, { signed: true, digits: 2 })}</strong></div>
              <div className="app-kpi"><span>Salesforce cost</span><strong>{formatMoney(salesforceDrawer.preview.financials.salesforceCost, { signed: true, digits: 2 })}</strong></div>
            </div>
            <p className="app-muted-copy">Contract month(s): {salesforceDrawer.preview.financials.contractMonths.join(', ') || 'Not set'}. A gain becomes a negative STEM cost; a loss becomes a positive STEM cost.</p>
          </section>
          {salesforceDrawer.preview.issues.length > 0 && <section className="app-callout app-callout--warning"><strong>Synchronization blocked</strong><ul>{salesforceDrawer.preview.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></section>}
          <section className="app-form-section">
            <div className="app-form-section__title">STEM allocations</div>
            <TableFrame>
              <table className="app-table app-table--compact">
                <thead><tr><th>STEM</th><th>Supplier</th><th>Allocation</th><th>Gross P&amp;L</th><th>Fees</th><th>Net P&amp;L</th><th>Salesforce cost</th><th>Action</th></tr></thead>
                <tbody>{salesforceDrawer.preview.allocations.map((allocation) => <tr key={allocation.salesforceStemId}><td><strong>{allocation.stemKey}</strong></td><td><strong>{allocation.supplierName}</strong>{allocation.supplierClKey && <small>{allocation.supplierClKey}</small>}</td><td>{allocation.allocationPercentage.toFixed(4)}%</td><td>{formatMoney(allocation.grossPnl, { signed: true, digits: 2 })}</td><td>{formatMoney(-allocation.feeAmount, { signed: true, digits: 2 })}</td><td>{formatMoney(allocation.netPnl, { signed: true, digits: 2 })}</td><td>{formatMoney(allocation.salesforceCost, { signed: true, digits: 2 })}</td><td><StatusBadge tone={allocation.reviewIssue ? "negative" : allocation.action === "create" ? "warning" : "positive"}>{allocation.reviewIssue ? "Review" : allocation.action === "create" ? "Create" : "Update"}</StatusBadge>{allocation.existingPaymentTerm && <small>Keep {allocation.existingPaymentTerm}</small>}</td></tr>)}</tbody>
              </table>
            </TableFrame>
          </section>
        </div>}
      </Drawer>

      <ConfirmDialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} onConfirm={remove} busy={saving} title="Delete hedge?" description={deleteTarget ? `${deleteTarget.product} ${deleteTarget.direction || deleteTarget.trade_type} ${formatMonth(deleteTarget.swap_month || deleteTarget.leg1_month)}` : ""} />
    </div>
  );
}
