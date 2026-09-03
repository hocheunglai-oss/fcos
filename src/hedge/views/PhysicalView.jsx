import React, { useMemo, useState } from "react";
import {
  CloudUpload,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { PhysicalTrade } from "@/hedge/api/entities";
import StemDetailLink from "@/components/common/StemDetailLink";
import StemDetailModal from "@/components/dashboard/StemDetailModal";
import {
  applyPhysicalHedgeSalesforce,
  getPhysicalHedgeSalesforceStatus,
  previewPhysicalHedgeSalesforce,
} from "@/hedge/api/backendFunctions";
import {
  calcPhysicalPnl,
  downloadCsv,
  formatDate,
  formatMoney,
  formatMonth,
  formatQuantity,
  hktThisMonth,
  hktToday,
  isInternalHedgeCounterparty,
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

const SALESFORCE_STATUS = {
  checking: { label: "Checking", tone: "neutral" },
  no_stem: { label: "No STEM", tone: "neutral" },
  no_linked_hedge: { label: "No linked hedge", tone: "neutral" },
  waiting_final: { label: "Waiting for final result", tone: "warning" },
  ready_to_add: { label: "Ready to add", tone: "warning" },
  added: { label: "Added", tone: "positive" },
  update_required: { label: "Update required", tone: "warning" },
  removed: { label: "Removed in Salesforce", tone: "negative" },
  changed_salesforce: { label: "Changed in Salesforce", tone: "negative" },
  locked_by_invoice: { label: "Locked by invoice", tone: "neutral" },
  conflict: { label: "Conflict", tone: "negative" },
};

function salesforceStatusMeta(value) {
  return SALESFORCE_STATUS[value] || SALESFORCE_STATUS.checking;
}

function salesforceReviewLabel(status) {
  if (status === "ready_to_add") return "Add to Salesforce";
  if (status === "update_required") return "Review update";
  if (status === "removed") return "Recreate";
  if (["changed_salesforce", "conflict"].includes(status)) return "Review conflict";
  if (status === "added") return "View Salesforce result";
  return "Review Salesforce hedge result";
}

function salesforceConfirmLabel(preview, saving) {
  if (saving) return "Saving...";
  if (preview?.state === "ready_to_add") return "Confirm add";
  if (preview?.state === "removed") return "Confirm recreate";
  if (preview?.venues?.some((row) => row.state === "conflict")) return "Confirm adoption";
  if (preview?.venues?.some((row) => row.state === "changed_salesforce")) return "Confirm restore";
  return "Confirm update";
}

const BLANK_PHYSICAL = {
  trade_date: hktToday(),
  product: "",
  counterparty: "",
  qty_min: "",
  qty_max: "",
  unit: "MT",
  vessel_name: "",
  delivery_date_from: "",
  delivery_date_to: "",
  sell_price_type: "MOPS WMA",
  sell_price: "",
  sell_premium: "",
  sell_pricing_month: hktThisMonth(),
  sell_pricing_basis: "WMA",
  sell_bal_date: "",
  buy_price_type: "MOPS WMA",
  buy_price: "",
  buy_premium: "",
  buy_pricing_month: hktThisMonth(),
  buy_pricing_basis: "WMA",
  buy_bal_date: "",
  notes: "",
  stem_number: "",
  sf_record_id: "",
  is_closed: false,
};

function physicalStatus(record) {
  return record.is_closed ? "closed" : "open";
}

function normalizePhysical(form) {
  const minimum = Number(form.qty_min) || 0;
  return {
    ...form,
    qty_min: minimum,
    qty_max: form.qty_max === "" || form.qty_max == null ? minimum : Number(form.qty_max) || minimum,
    sell_price: form.sell_price === "" ? null : Number(form.sell_price),
    sell_premium: form.sell_premium === "" ? null : Number(form.sell_premium),
    buy_price: form.buy_price === "" ? null : Number(form.buy_price),
    buy_premium: form.buy_premium === "" ? null : Number(form.buy_premium),
    is_closed: Boolean(form.is_closed),
  };
}

function PricingLeg({ side, form, setField }) {
  const prefix = side.toLowerCase();
  const type = form[`${prefix}_price_type`];
  return (
    <section className={`app-form-section app-form-section--${prefix}`}>
      <div className="app-form-section__title">{side} leg</div>
      <div className="app-form-grid app-form-grid--2">
        <Field label="Price type">
          <Select value={type} onChange={(event) => setField(`${prefix}_price_type`, event.target.value)}>
            <option value="MOPS WMA">MOPS WMA</option>
            <option value="Fixed">Fixed</option>
          </Select>
        </Field>
        <Field label={type === "Fixed" ? "Fixed price (USD)" : "Premium / discount (USD)"}>
          <input
            className="app-input"
            type="number"
            step="any"
            value={form[type === "Fixed" ? `${prefix}_price` : `${prefix}_premium`] ?? ""}
            onChange={(event) => setField(type === "Fixed" ? `${prefix}_price` : `${prefix}_premium`, event.target.value)}
          />
        </Field>
        <Field label="Pricing month">
          <input className="app-input" type="month" value={form[`${prefix}_pricing_month`] || ""} onChange={(event) => setField(`${prefix}_pricing_month`, event.target.value)} />
        </Field>
        <Field label="Pricing basis">
          <Select value={form[`${prefix}_pricing_basis`] || "WMA"} onChange={(event) => setField(`${prefix}_pricing_basis`, event.target.value)}>
            <option value="WMA">Full month WMA</option>
            <option value="BAL_TODAY">Balance from today</option>
            <option value="BAL_TOMORROW">Balance from tomorrow</option>
          </Select>
        </Field>
        {form[`${prefix}_pricing_basis`] !== "WMA" && (
          <Field label="Balance start date" className="app-field--span-2">
            <input className="app-input" type="date" value={form[`${prefix}_bal_date`] || ""} onChange={(event) => setField(`${prefix}_bal_date`, event.target.value)} />
          </Field>
        )}
      </div>
    </section>
  );
}

export function PhysicalView({ data, settings, quickCreateSignal = 0, readOnly = false }) {
  const actions = useActions();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("open");
  const [month, setMonth] = useState("all");
  const [drawer, setDrawer] = useState(null);
  const [form, setForm] = useState(BLANK_PHYSICAL);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [salesforceStatuses, setSalesforceStatuses] = useState({});
  const [salesforceLoading, setSalesforceLoading] = useState(false);
  const [salesforceError, setSalesforceError] = useState(null);
  const [salesforceDrawer, setSalesforceDrawer] = useState(null);
  const [selectedStemId, setSelectedStemId] = useState(null);

  const loadSalesforceStatuses = React.useCallback(async () => {
    const physicalTradeIds = data.physicals.map((record) => record.id).filter(Boolean);
    if (!physicalTradeIds.length) {
      setSalesforceStatuses({});
      return;
    }
    setSalesforceLoading(true);
    setSalesforceError(null);
    try {
      const response = await getPhysicalHedgeSalesforceStatus({ physicalTradeIds, persist: true });
      setSalesforceStatuses(Object.fromEntries((response.rows || []).map((row) => [row.physicalTradeId, row])));
    } catch (error) {
      setSalesforceError(error);
    } finally {
      setSalesforceLoading(false);
    }
  }, [data.physicals]);

  React.useEffect(() => {
    loadSalesforceStatuses().catch(() => {});
  }, [loadSalesforceStatuses]);

  React.useEffect(() => {
    if (quickCreateSignal) {
      setForm({ ...BLANK_PHYSICAL, trade_date: hktToday(), sell_pricing_month: hktThisMonth(), buy_pricing_month: hktThisMonth() });
      setDrawer({ mode: "create" });
    }
  }, [quickCreateSignal]);

  const months = useMemo(() => [...new Set(data.physicals.map((record) => String(record.trade_date || record.sell_pricing_month || "").slice(0, 7)).filter(Boolean))].sort().reverse(), [data.physicals]);
  const counterpartyOptions = useMemo(() => {
    const records = new Map();
    for (const record of data.counterparties || []) {
      const value = String(record.short_name || "").trim().toUpperCase();
      if (value) records.set(value, record);
    }
    for (const candidate of settings.lists.counterparts || []) {
      const value = String(candidate || "").trim().toUpperCase();
      if (value && !records.has(value)) records.set(value, { short_name: value });
    }
    return [...records.entries()].map(([value, record]) => ({
      value,
      label: isInternalHedgeCounterparty(record) ? `${value} — Internal hedge` : value,
    })).sort((left, right) => left.value.localeCompare(right.value));
  }, [data.counterparties, settings.lists.counterparts]);
  const rows = useMemo(() => data.physicals
    .filter((record) => status === "all" || physicalStatus(record) === status)
    .filter((record) => month === "all" || [record.trade_date, record.sell_pricing_month, record.buy_pricing_month].some((value) => String(value || "").startsWith(month)))
    .filter((record) => {
      const value = `${record.product || ""} ${record.counterparty || ""} ${record.vessel_name || ""} ${record.stem_number || ""} ${salesforceStatuses[record.id]?.salesforceStemName || ""} ${record.notes || ""}`.toLowerCase();
      return value.includes(search.toLowerCase());
    })
    .sort((left, right) => String(right.trade_date || "").localeCompare(String(left.trade_date || ""))), [data.physicals, month, salesforceStatuses, search, status]);

  const openCreate = () => {
    setForm({ ...BLANK_PHYSICAL, trade_date: hktToday(), sell_pricing_month: hktThisMonth(), buy_pricing_month: hktThisMonth() });
    setFormError(null);
    setDrawer({ mode: "create" });
  };
  const openEdit = (record) => {
    setForm({ ...BLANK_PHYSICAL, ...record });
    setFormError(null);
    setDrawer({ mode: "edit", record });
  };
  const duplicate = (record) => {
    const { id, created_date, updated_date, sf_record_id, ...copy } = record;
    setForm({ ...BLANK_PHYSICAL, ...copy, trade_date: hktToday(), sf_record_id: "" });
    setFormError(null);
    setDrawer({ mode: "create", source: record });
  };
  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!form.trade_date || !form.product || !form.qty_min) {
      setFormError(new Error("Trade date, product, and quantity are required."));
      return;
    }
    if (isInternalHedgeCounterparty(form.counterparty) && !String(form.stem_number || "").trim()) {
      setFormError(new Error("An FCBHK internal physical trade requires a STEM number."));
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload = normalizePhysical(form);
      const label = `${payload.counterparty || "Physical"} ${payload.vessel_name || "trade"} ${payload.product} ${payload.qty_min}${payload.unit}`.trim();
      if (drawer?.mode === "edit") {
        await actions.update({ entity: PhysicalTrade, entityName: "PhysicalTrade", id: drawer.record.id, payload, before: drawer.record, label });
      } else {
        await actions.create({ entity: PhysicalTrade, entityName: "PhysicalTrade", payload, label });
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
      await actions.remove({
        entity: PhysicalTrade,
        entityName: "PhysicalTrade",
        record: deleteTarget,
        label: `${deleteTarget.product || "Physical"} ${deleteTarget.counterparty || "trade"} ${deleteTarget.trade_date || ""}`.trim(),
      });
      setDeleteTarget(null);
    } finally {
      setSaving(false);
    }
  };

  const openSalesforceReview = async (record) => {
    setSalesforceDrawer({ record, loading: true, preview: null, error: null, saving: false, result: null, reason: "" });
    try {
      const preview = await previewPhysicalHedgeSalesforce({ physicalTradeId: record.id, expectedRevision: record.revision });
      setSalesforceDrawer((current) => current?.record.id === record.id ? { ...current, loading: false, preview } : current);
    } catch (error) {
      setSalesforceDrawer((current) => current?.record.id === record.id ? { ...current, loading: false, error } : current);
    }
  };

  const confirmSalesforceResult = async () => {
    const current = salesforceDrawer;
    if (!current?.preview || current.saving) return;
    const hasConflict = current.preview.venues.some((row) => row.state === "conflict");
    const hasChanged = current.preview.venues.some((row) => row.state === "changed_salesforce");
    const action = hasConflict ? "adopt" : hasChanged ? "restore" : "apply";
    setSalesforceDrawer((value) => ({ ...value, saving: true, error: null, result: null }));
    try {
      const result = await applyPhysicalHedgeSalesforce({
        physicalTradeId: current.record.id,
        expectedRevision: current.record.revision,
        previewFingerprint: current.preview.previewFingerprint,
        action,
        reason: current.reason,
        idempotencyKey: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${current.record.id}`,
      });
      const preview = await previewPhysicalHedgeSalesforce({ physicalTradeId: current.record.id, expectedRevision: current.record.revision });
      setSalesforceDrawer((value) => ({ ...value, saving: false, result, preview }));
      await loadSalesforceStatuses();
    } catch (error) {
      setSalesforceDrawer((value) => ({ ...value, saving: false, error }));
    }
  };

  const exportRows = () => downloadCsv(
    `physical_trades_${hktToday()}.csv`,
    ["Trade date", "Product", "Counterparty", "Qty min", "Qty max", "Unit", "Vessel", "Delivery from", "Delivery to", "Sell type", "Sell price", "Sell premium", "Buy type", "Buy price", "Buy premium", "STEM Name", "STEM Reference", "Salesforce hedge result", "Proposed Salesforce cost", "Current Salesforce cost", "Closed"],
    rows.map((record) => {
      const result = salesforceStatuses[record.id];
      return [record.trade_date, record.product, record.counterparty, record.qty_min, record.qty_max, record.unit, record.vessel_name, record.delivery_date_from, record.delivery_date_to, record.sell_price_type, record.sell_price, record.sell_premium, record.buy_price_type, record.buy_price, record.buy_premium, result?.salesforceStemName || "", record.stem_number, salesforceStatusMeta(result?.state).label, result?.proposedSalesforceCost ?? "", result?.currentSalesforceCost ?? "", record.is_closed ? "Yes" : "No"];
    }),
  );

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Trade capture"
        title="Physical trades"
        description="Manage cargo exposure, pricing legs, delivery windows, linked paper hedges, and Salesforce stems."
        actions={!readOnly ? <Button variant="primary" icon={Plus} onClick={openCreate}>New physical</Button> : null}
      />

      <div className="app-toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="Search vessel, counterparty, stem..." />
        <SegmentedControl
          value={status}
          onChange={setStatus}
          label="Physical trade status"
          options={[
            { value: "open", label: "Open", count: data.physicals.filter((record) => physicalStatus(record) === "open").length },
            { value: "closed", label: "Closed", count: data.physicals.filter((record) => physicalStatus(record) === "closed").length },
            { value: "all", label: "All" },
          ]}
        />
        <Select value={month} onChange={(event) => setMonth(event.target.value)} className="app-toolbar__select">
          <option value="all">All months</option>
          {months.map((value) => <option key={value} value={value}>{formatMonth(value)}</option>)}
        </Select>
        <IconButton label="Export filtered physical trades" icon={Download} onClick={exportRows} />
        <IconButton label="Refresh Salesforce hedge results" icon={RefreshCw} onClick={loadSalesforceStatuses} disabled={salesforceLoading} />
      </div>

      {salesforceError && <InlineError error={salesforceError} action={<Button onClick={loadSalesforceStatuses}>Try again</Button>} />}

      <TableFrame>
        {rows.length ? (
          <table className="app-table app-table--physical">
            <thead>
              <tr>
                <th>Status</th><th>Trade</th><th>STEM</th><th>Product</th><th>Counterparty</th><th>Quantity</th><th>Vessel / delivery</th><th>Pricing</th><th>P&amp;L</th><th>Salesforce hedge result</th><th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((record) => {
                const pnl = calcPhysicalPnl(record, data.mops, settings.general.sgo_bbl_per_mt, data.marketValuation)?.value;
                const closed = physicalStatus(record) === "closed";
                const hedgeResult = salesforceStatuses[record.id] || { state: "checking", venues: [] };
                const hedgeResultMeta = salesforceStatusMeta(hedgeResult.state);
                return (
                  <tr key={record.id}>
                    <td><StatusBadge tone={closed ? "neutral" : "positive"}>{closed ? "Closed" : "Open"}</StatusBadge></td>
                    <td><strong>{formatDate(record.trade_date)}</strong></td>
                    <td>
                      <StemDetailLink stemId={hedgeResult.salesforceStemId} onOpen={setSelectedStemId}>{hedgeResult.salesforceStemName || record.stem_number || "No STEM"}</StemDetailLink>
                      {hedgeResult.salesforceStemName && record.stem_number && hedgeResult.salesforceStemName !== record.stem_number && <small>{record.stem_number}</small>}
                    </td>
                    <td><ProductBadge product={record.product} /></td>
                    <td><strong>{record.counterparty || "Unassigned"}</strong></td>
                    <td><strong>{formatQuantity(record.qty_min, record.unit)}</strong>{record.qty_max && Number(record.qty_max) !== Number(record.qty_min) && <small>to {formatQuantity(record.qty_max, record.unit)}</small>}</td>
                    <td><strong>{record.vessel_name || "No vessel"}</strong><small>{record.delivery_date_from ? `${formatDate(record.delivery_date_from)}${record.delivery_date_to ? ` to ${formatDate(record.delivery_date_to)}` : ""}` : "No delivery window"}</small></td>
                    <td><strong>{formatMonth(record.sell_pricing_month || record.buy_pricing_month)}</strong><small>{record.sell_price_type || "-"} / {record.buy_price_type || "-"}</small></td>
                    <td><Money value={pnl} strong /></td>
                    <td>
                      <StatusBadge tone={hedgeResultMeta.tone}>{hedgeResultMeta.label}</StatusBadge>
                      {hedgeResult.proposedSalesforceCost != null && <strong>{formatMoney(hedgeResult.proposedSalesforceCost, { signed: true, digits: 2 })}</strong>}
                      {hedgeResult.currentSalesforceCost != null && <small>Current {formatMoney(hedgeResult.currentSalesforceCost, { signed: true, digits: 2 })}</small>}
                      {hedgeResult.difference != null && Math.abs(hedgeResult.difference) >= 0.005 && <small>Difference {formatMoney(hedgeResult.difference, { signed: true, digits: 2 })}</small>}
                    </td>
                    <td>
                      <div className="app-row-actions">
                        {!readOnly && <IconButton label={salesforceReviewLabel(hedgeResult.state)} icon={hedgeResult.state === "added" ? ExternalLink : CloudUpload} variant={hedgeResult.state === "removed" || hedgeResult.state === "conflict" ? "danger" : "quiet"} onClick={() => openSalesforceReview(record)} disabled={salesforceLoading} />}
                        {!readOnly && <><IconButton label="Duplicate physical trade" icon={Copy} variant="quiet" onClick={() => duplicate(record)} /><IconButton label="Edit physical trade" icon={Edit3} variant="quiet" onClick={() => openEdit(record)} /><IconButton label="Delete physical trade" icon={Trash2} variant="danger" onClick={() => setDeleteTarget(record)} /></>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <EmptyState title="No physical trades match" description="Adjust the filters or create a new physical trade." action={<Button variant="primary" icon={Plus} onClick={openCreate}>New physical</Button>} />
        )}
      </TableFrame>

      <Drawer
        open={Boolean(drawer)}
        onClose={() => setDrawer(null)}
        title={drawer?.mode === "edit" ? "Edit physical trade" : "New physical trade"}
        description="Capture the cargo first, then define each pricing leg."
        footer={<><Button onClick={() => setDrawer(null)} disabled={saving}>Cancel</Button><Button variant="primary" onClick={save} disabled={saving}>{saving ? "Saving..." : drawer?.mode === "edit" ? "Save changes" : "Create trade"}</Button></>}
      >
        {formError && <InlineError error={formError} />}
        <section className="app-form-section">
          <div className="app-form-section__title">Trade details</div>
          <div className="app-form-grid app-form-grid--2">
            <Field label="Trade date" required><input className="app-input" type="date" value={form.trade_date || ""} onChange={(event) => setField("trade_date", event.target.value)} /></Field>
            <Field label="Product" required><Select value={form.product || ""} onChange={(event) => { setField("product", event.target.value); if (event.target.value === "SGO") setField("unit", "BBL"); }}><option value="">Select product</option>{settings.lists.products.map((value) => <option key={value}>{value}</option>)}</Select></Field>
            <Field label="Counterparty" hint={isInternalHedgeCounterparty(form.counterparty) ? "FCBHK is an internal hedge allocation and requires a STEM number." : undefined}><Select value={form.counterparty || ""} onChange={(event) => setField("counterparty", event.target.value)}><option value="">Unassigned</option>{counterpartyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></Field>
            <Field label="Vessel name"><input className="app-input" value={form.vessel_name || ""} onChange={(event) => setField("vessel_name", event.target.value)} /></Field>
            <Field label="Minimum quantity" required><input className="app-input" type="number" step="any" value={form.qty_min ?? ""} onChange={(event) => setField("qty_min", event.target.value)} /></Field>
            <Field label="Maximum quantity" hint="Defaults to minimum"><input className="app-input" type="number" step="any" value={form.qty_max ?? ""} onChange={(event) => setField("qty_max", event.target.value)} /></Field>
            <Field label="Unit"><Select value={form.unit || "MT"} onChange={(event) => setField("unit", event.target.value)}><option value="MT">MT</option><option value="BBL">BBL</option></Select></Field>
            <Field label="Stem number"><input className="app-input" placeholder="HK2626360T" value={form.stem_number || ""} onChange={(event) => setField("stem_number", event.target.value)} /></Field>
            <Field label="Delivery from"><input className="app-input" type="date" value={form.delivery_date_from || ""} onChange={(event) => setField("delivery_date_from", event.target.value)} /></Field>
            <Field label="Delivery to"><input className="app-input" type="date" value={form.delivery_date_to || ""} onChange={(event) => setField("delivery_date_to", event.target.value)} /></Field>
          </div>
        </section>
        <div className="app-form-split"><PricingLeg side="Sell" form={form} setField={setField} /><PricingLeg side="Buy" form={form} setField={setField} /></div>
        <section className="app-form-section">
          <div className="app-form-section__title">Control</div>
          <Field label="Notes"><textarea className="app-input app-textarea" rows="4" value={form.notes || ""} onChange={(event) => setField("notes", event.target.value)} /></Field>
          <label className="app-check"><input type="checkbox" checked={Boolean(form.is_closed)} onChange={(event) => setField("is_closed", event.target.checked)} /><span>Mark this physical trade as closed</span></label>
        </section>
      </Drawer>

      <Drawer
        open={Boolean(salesforceDrawer)}
        onClose={() => !salesforceDrawer?.saving && setSalesforceDrawer(null)}
        title="Salesforce hedge result"
        description={salesforceDrawer?.record ? `${salesforceDrawer.preview?.salesforceStemName || salesforceDrawer.record.stem_number || "No STEM"} · ${salesforceDrawer.record.product || "No product"}` : undefined}
        width="xl"
        footer={<>
          <Button onClick={() => setSalesforceDrawer(null)} disabled={salesforceDrawer?.saving}>Close</Button>
          {!readOnly && salesforceDrawer?.preview?.venues?.length > 0 && salesforceDrawer.preview.venues.some((row) => row.state !== "added") && (
            <Button
              variant="primary"
              icon={CloudUpload}
              onClick={confirmSalesforceResult}
              disabled={salesforceDrawer?.saving || salesforceDrawer?.preview?.venues?.some((row) => row.cannotApply || ["waiting_final", "locked_by_invoice"].includes(row.state) || (row.state === "conflict" && !row.salesforceRecordId))}
            >
              {salesforceConfirmLabel(salesforceDrawer.preview, salesforceDrawer?.saving)}
            </Button>
          )}
        </>}
      >
        {salesforceDrawer?.loading && <p className="app-muted-copy">Calculating the final hedge result and checking Salesforce...</p>}
        {salesforceDrawer?.error && <InlineError error={salesforceDrawer.error} />}
        {salesforceDrawer?.result && <div className="app-callout app-callout--positive">Salesforce updated {salesforceDrawer.result.results?.length || 0} hedge-result row(s).</div>}
        {salesforceDrawer?.preview && <div className="app-stack">
          <section className="app-form-section">
            <div className="app-form-section__title">Physical Trade result</div>
            <div className="app-kpi-grid app-kpi-grid--4">
              <div className="app-kpi"><span>Final gross hedge P&amp;L</span><strong>{formatMoney(salesforceDrawer.preview.proposedGrossPnl, { signed: true, digits: 2 })}</strong></div>
              <div className="app-kpi"><span>FCBS direct costs included</span><strong>{formatMoney(salesforceDrawer.preview.includedDirectCosts, { signed: false, digits: 2 })}</strong></div>
              <div className="app-kpi"><span>Net hedge result</span><strong>{formatMoney(salesforceDrawer.preview.proposedNetPnl, { signed: true, digits: 2 })}</strong></div>
              <div className="app-kpi"><span>Proposed Salesforce cost</span><strong>{formatMoney(salesforceDrawer.preview.proposedSalesforceCost, { signed: true, digits: 2 })}</strong></div>
            </div>
            <p className="app-muted-copy">FCBS rows include the direct FCBS venue charge because FCBS bills it to us. ICE broker, exchange, clearing and settlement fees remain separate. A net hedge gain becomes a negative STEM cost; a net hedge loss becomes a positive STEM cost.</p>
          </section>
          {salesforceDrawer.preview.issues.length > 0 && <section className="app-callout app-callout--warning"><strong>Review required</strong><ul>{salesforceDrawer.preview.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></section>}
          <section className="app-form-section">
            <div className="app-form-section__title">Venue rows</div>
            <TableFrame>
              <table className="app-table app-table--compact">
                <thead><tr><th>Venue / Supplier</th><th>Linked Paper Hedges</th><th>Gross P&amp;L</th><th>Direct costs</th><th>Net result</th><th>Proposed cost</th><th>Current cost</th><th>Difference</th><th>Salesforce UOM</th><th>Status</th></tr></thead>
                <tbody>{salesforceDrawer.preview.venues.map((row) => {
                  const meta = salesforceStatusMeta(row.state);
                  return <tr key={row.venue}>
                    <td>
                      <strong>{row.venue}</strong>
                      <small>{row.supplierName}</small>
                      {row.supplierCorrectionRequired && <small className="text-rose-700">Current: {row.currentSupplierName || "Not set"} · will update</small>}
                    </td>
                    <td><strong>{row.contributions.length}</strong><small>{row.contributions.map((item) => `${item.allocationPercentage.toFixed(4)}%`).join(" · ")}</small></td>
                    <td>{formatMoney(row.grossPnl, { signed: true, digits: 2 })}</td>
                    <td>{row.venue === "FCBS" ? <><strong>{formatMoney(row.directCosts, { digits: 2 })}</strong><small>Billed directly by FCBS</small></> : "—"}</td>
                    <td>{formatMoney(row.netPnl, { signed: true, digits: 2 })}</td>
                    <td>{formatMoney(row.salesforceCost, { signed: true, digits: 2 })}</td>
                    <td>{row.currentSalesforceCost == null ? "—" : formatMoney(row.currentSalesforceCost, { signed: true, digits: 2 })}</td>
                    <td>{row.currentSalesforceCost == null ? "—" : formatMoney(row.salesforceCost - row.currentSalesforceCost, { signed: true, digits: 2 })}</td>
                    <td><strong>{row.proposedUnitOfMeasure || "1"}</strong>{row.currentUnitOfMeasure && row.currentUnitOfMeasure !== row.proposedUnitOfMeasure && <small>Current {row.currentUnitOfMeasure}</small>}</td>
                    <td><StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>{row.salesforceUrl && <a className="app-source-link" href={row.salesforceUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open Salesforce</a>}</td>
                  </tr>;
                })}</tbody>
              </table>
            </TableFrame>
          </section>
          {salesforceDrawer.preview.venues.some((row) => ["conflict", "changed_salesforce"].includes(row.state)) && <section className="app-form-section"><Field label="Reason" required hint="Required when adopting or restoring a Salesforce row."><textarea className="app-input app-textarea" rows="3" value={salesforceDrawer.reason || ""} onChange={(event) => setSalesforceDrawer((current) => ({ ...current, reason: event.target.value }))} /></Field></section>}
        </div>}
      </Drawer>

      <StemDetailModal stemId={selectedStemId} open={Boolean(selectedStemId)} onClose={() => setSelectedStemId(null)} />

      <ConfirmDialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} onConfirm={remove} busy={saving} title="Delete physical trade?" description={deleteTarget ? `${deleteTarget.product || "Physical"} for ${deleteTarget.counterparty || "unassigned counterparty"} on ${formatDate(deleteTarget.trade_date)}` : ""} />
    </div>
  );
}
