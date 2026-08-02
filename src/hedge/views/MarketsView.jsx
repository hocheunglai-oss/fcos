import React, { useMemo, useState } from "react";
import {
  Bot,
  CalendarDays,
  Edit3,
  ExternalLink,
  Plus,
  Save,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { MopsPrice } from "@/hedge/api/entities";
import { parseMopsPrice } from "@/hedge/api/backendFunctions";
import {
  PLATTS_PUBLICATION_SOURCE,
  calcMopsAverage,
  formatDate,
  formatDateTime,
  formatMonth,
  formatMoney,
  forwardCurveState,
  hktThisMonth,
  hktToday,
  isPlattsDay,
  latestMops,
  mopsMonthFinality,
  tradingDaysInMonth,
} from "../lib/domain";
import { useActions } from "../data/ActionsContext";
import {
  Button,
  ConfirmDialog,
  Drawer,
  Field,
  IconButton,
  InlineError,
  Metric,
  PageHeader,
  Panel,
  SectionHeading,
  SegmentedControl,
  Select,
  StatusBadge,
  TableFrame,
} from "../components/ui";

const BLANK_PRICE = {
  price_date: "",
  s380: "",
  s05: "",
  sgo: "",
  source: "Manual",
  raw_input: "",
  is_estimate: false,
};

const MONTH_OPTIONS = [
  ["01", "January"], ["02", "February"], ["03", "March"], ["04", "April"],
  ["05", "May"], ["06", "June"], ["07", "July"], ["08", "August"],
  ["09", "September"], ["10", "October"], ["11", "November"], ["12", "December"],
];

const MOPS_PRODUCTS = [
  { field: "s380", label: "S380", unit: "USD/MT" },
  { field: "s05", label: "S0.5", unit: "USD/MT" },
  { field: "sgo", label: "SGO", unit: "USD/BBL" },
];

function parsedForwardSuggestion(result) {
  if (!result?.forward_estimate) return null;
  return {
    month: result.forward_estimate.month,
    prices: result.forward_estimate.prices || {},
    adjustments: Object.fromEntries(["s380", "s05", "sgo"].map((field) => [
      field,
      result.forward_estimate.adjustments?.[field] == null ? "" : String(result.forward_estimate.adjustments[field]),
    ])),
    apply: true,
  };
}

function publicationStatus(row, today = hktToday()) {
  if (row.record) return row.record.is_estimate
    ? { label: "Estimate", tone: "warning", className: "is-estimate" }
    : { label: "Actual", tone: "positive", className: "is-actual" };
  if (!row.scheduled) return { label: "Off-calendar", tone: "neutral", className: "is-off-calendar" };
  if (row.date > today) return { label: "Upcoming", tone: "neutral", className: "is-upcoming" };
  if (row.date === today) return { label: "Due today", tone: "warning", className: "is-due" };
  return { label: "Missing", tone: "negative", className: "is-missing" };
}

function changeSince(records, field) {
  const actual = [...records].filter((row) => !row.is_estimate && row[field] != null).sort((a, b) => String(b.price_date).localeCompare(String(a.price_date)));
  if (actual.length < 2) return null;
  return Number(actual[0][field]) - Number(actual[1][field]);
}

function MopsTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="app-chart-tooltip">
      <strong>{formatDate(label)}</strong>
      {payload.map((item) => <span key={item.dataKey} style={{ color: item.color }}>{item.name}: {formatMoney(item.value, { digits: 2 })}</span>)}
    </div>
  );
}

export function MarketsView({ data, settings, quickCreateSignal = 0, readOnly = false, priceEntity = MopsPrice, methodologyAction = null }) {
  const actions = useActions();
  const [range, setRange] = useState("3m");
  const [drawer, setDrawer] = useState(null);
  const [form, setForm] = useState(BLANK_PRICE);
  const [rawText, setRawText] = useState("");
  const [indicationText, setIndicationText] = useState("");
  const [forwardIndicationText, setForwardIndicationText] = useState("");
  const [saving, setSaving] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [forwardSuggestion, setForwardSuggestion] = useState(null);
  const [spreadDraft, setSpreadDraft] = useState(() => ({ ...settings.forwardSpreads }));
  const [filterYear, setFilterYear] = useState(() => hktThisMonth().slice(0, 4));
  const [filterMonth, setFilterMonth] = useState(() => hktThisMonth().slice(5, 7));

  React.useEffect(() => setSpreadDraft({ ...settings.forwardSpreads }), [settings.forwardSpreads]);
  React.useEffect(() => {
    if (quickCreateSignal) {
      setForm({ ...BLANK_PRICE, price_date: hktToday() });
      setRawText("");
      setIndicationText("");
      setForwardIndicationText("");
      setForwardSuggestion(null);
      setDrawer({ mode: "create" });
    }
  }, [quickCreateSignal]);

  const latest = latestMops(data.mops);
  const selectedMonth = `${filterYear}-${filterMonth}`;
  const availableYears = useMemo(() => [...new Set([
    hktThisMonth().slice(0, 4),
    ...data.mops.map((row) => String(row.price_date || "").slice(0, 4)).filter((value) => /^\d{4}$/.test(value)),
  ])].sort((left, right) => right.localeCompare(left)), [data.mops]);
  const monthAverages = useMemo(() => Object.fromEntries(MOPS_PRODUCTS.map((product) => [
    product.field,
    calcMopsAverage(selectedMonth, data.mops, product.field),
  ])), [data.mops, selectedMonth]);
  const ledgerRows = useMemo(() => {
    const scheduledDates = tradingDaysInMonth(selectedMonth);
    const scheduledSet = new Set(scheduledDates);
    const monthRecords = data.mops.filter((row) => String(row.price_date || "").startsWith(selectedMonth));
    const byDate = new Map();
    monthRecords.forEach((record) => {
      const existing = byDate.get(record.price_date);
      if (!existing || (existing.is_estimate && !record.is_estimate)) byDate.set(record.price_date, record);
    });
    return [...new Set([...scheduledDates, ...monthRecords.map((row) => row.price_date)])]
      .filter(Boolean)
      .sort((left, right) => right.localeCompare(left))
      .map((date) => ({ date, record: byDate.get(date) || null, scheduled: scheduledSet.has(date) }));
  }, [data.mops, selectedMonth]);
  const publicationProgress = useMemo(() => {
    const scheduled = tradingDaysInMonth(selectedMonth);
    const actual = new Set(data.mops.filter((row) => !row.is_estimate && String(row.price_date || "").startsWith(selectedMonth)).map((row) => row.price_date));
    const estimated = new Set(data.mops.filter((row) => row.is_estimate && String(row.price_date || "").startsWith(selectedMonth)).map((row) => row.price_date));
    return {
      total: scheduled.length,
      actual: scheduled.filter((date) => actual.has(date)).length,
      estimated: scheduled.filter((date) => !actual.has(date) && estimated.has(date)).length,
      verified: scheduled.filter((date) => data.mops.some((row) => row.price_date === date && !row.is_estimate && row.verification_status === "verified")).length,
    };
  }, [data.mops, selectedMonth]);
  const monthFinality = useMemo(() => mopsMonthFinality(selectedMonth, data.mops), [data.mops, selectedMonth]);
  const curve = useMemo(() => forwardCurveState(settings.forwardSpreads), [settings.forwardSpreads]);
  const chartData = useMemo(() => {
    const now = new Date(`${hktToday()}T00:00:00`);
    const cutoff = new Date(now);
    if (range === "1m") cutoff.setMonth(cutoff.getMonth() - 1);
    if (range === "3m") cutoff.setMonth(cutoff.getMonth() - 3);
    if (range === "6m") cutoff.setMonth(cutoff.getMonth() - 6);
    if (range === "1y") cutoff.setFullYear(cutoff.getFullYear() - 1);
    const cutoffString = range === "all" ? "0000-00-00" : cutoff.toISOString().slice(0, 10);
    return [...data.mops]
      .filter((row) => row.price_date >= cutoffString)
      .sort((a, b) => String(a.price_date).localeCompare(String(b.price_date)))
      .map((row) => ({ ...row, sgoMt: row.sgo == null ? null : Number(row.sgo) * settings.general.sgo_bbl_per_mt }));
  }, [data.mops, range, settings.general.sgo_bbl_per_mt]);

  const openCreate = () => {
    setForm({ ...BLANK_PRICE, price_date: hktToday() });
    setRawText("");
    setIndicationText("");
    setForwardIndicationText("");
    setForwardSuggestion(null);
    setError(null);
    setDrawer({ mode: "create" });
  };
  const openEdit = (record) => {
    setForm({ ...BLANK_PRICE, ...record, s380: record.s380 ?? "", s05: record.s05 ?? "", sgo: record.sgo ?? "" });
    setRawText(record.raw_input || "");
    setIndicationText("");
    setForwardIndicationText("");
    setForwardSuggestion(null);
    setError(null);
    setDrawer({ mode: "edit", record });
  };
  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const closeDrawer = () => {
    setDrawer(null);
    setForwardSuggestion(null);
    setIndicationText("");
    setForwardIndicationText("");
  };

  const applyParsedValues = (result, { source, isEstimate, rawInput }) => {
    setForm((current) => ({
      ...current,
      price_date: result.price_date || current.price_date,
      s380: result.s380 == null ? current.s380 : String(result.s380),
      s05: result.s05 == null ? current.s05 : String(result.s05),
      sgo: result.sgo == null ? current.sgo : String(result.sgo),
      source,
      is_estimate: isEstimate,
      raw_input: rawInput,
    }));
    setForwardSuggestion(parsedForwardSuggestion(result));
  };

  const parseRaw = async () => {
    if (!rawText.trim()) return;
    setParsing(true);
    setError(null);
    try {
      const rawResult = await parseMopsPrice({ raw_input: rawText });
      const result = rawResult?.data ?? rawResult;
      if (!result?.price_date) throw new Error("No date or product prices could be extracted.");
      applyParsedValues(result, { source: "S&P Global", isEstimate: false, rawInput: rawText });
      setIndicationText("");
      setForwardIndicationText("");
    } catch (nextError) {
      setError(nextError);
    } finally {
      setParsing(false);
    }
  };

  const parseIndication = async () => {
    if (!indicationText.trim()) return;
    const today = hktToday();
    if (!isPlattsDay(today)) {
      setError(new Error("Today is not a Platts publishing day, so a daily MOPS estimate cannot be saved."));
      return;
    }
    const normalizedInput = `${today}\nMOPS\n${indicationText.trim()}${forwardIndicationText.trim() ? `\nMOC\n${forwardIndicationText.trim()}` : ""}`;
    setParsing(true);
    setError(null);
    try {
      const rawResult = await parseMopsPrice({ raw_input: normalizedInput });
      const result = rawResult?.data ?? rawResult;
      if (result?.s380 == null && result?.s05 == null && result?.sgo == null) {
        throw new Error("No product indication levels could be extracted.");
      }
      applyParsedValues(result, { source: "Estimate", isEstimate: true, rawInput: normalizedInput });
      setRawText("");
    } catch (nextError) {
      setError(nextError);
    } finally {
      setParsing(false);
    }
  };

  const save = async () => {
    if (!form.price_date || (!form.s380 && !form.s05 && !form.sgo)) {
      setError(new Error("A price date and at least one product price are required."));
      return;
    }
    if (!isPlattsDay(form.price_date)) {
      setError(new Error("MOPS prices can only be entered for a Platts publishing day."));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...form,
        raw_input: form.raw_input || rawText,
        s380: form.s380 === "" ? null : Number(form.s380),
        s05: form.s05 === "" ? null : Number(form.s05),
        sgo: form.sgo === "" ? null : Number(form.sgo),
        is_estimate: Boolean(form.is_estimate),
      };
      const label = `MOPS ${payload.price_date}${payload.is_estimate ? " estimate" : ""}`;
      if (drawer?.mode === "edit") await actions.update({ entity: priceEntity, entityName: "MopsPrice", id: drawer.record.id, payload, before: drawer.record, label });
      else await actions.create({ entity: priceEntity, entityName: "MopsPrice", payload, label });

      if (forwardSuggestion?.apply) {
        const parsedAdjustments = Object.fromEntries(Object.entries(forwardSuggestion.adjustments || {})
          .filter(([, value]) => value !== "" && Number.isFinite(Number(value)))
          .map(([field, value]) => [field, String(Number(value))]));
        if (Object.keys(parsedAdjustments).length) {
          const nextSpreads = { ...settings.forwardSpreads, ...parsedAdjustments };
          try {
            await settings.update("fwd_spreads", nextSpreads);
            setSpreadDraft(nextSpreads);
          } catch (forwardError) {
            actions.notify({ message: `MOPS price saved, but forward adjustments failed: ${forwardError.message || forwardError}` });
          }
        }
      }
      closeDrawer();
    } catch (nextError) {
      setError(nextError);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await actions.remove({ entity: priceEntity, entityName: "MopsPrice", record: deleteTarget, label: `MOPS ${deleteTarget.price_date}` });
      setDeleteTarget(null);
    } finally {
      setSaving(false);
    }
  };

  const saveSpreads = async () => {
    setSaving(true);
    setError(null);
    try {
      await settings.update("fwd_spreads", spreadDraft);
      actions.notify({ message: "Forward spreads saved" });
    } catch (nextError) {
      setError(nextError);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Market data"
        title="MOPS market"
        description="Track published Singapore prices, maintain forward adjustments, and control estimated versus actual entries."
        actions={<>{methodologyAction}{!readOnly ? <Button variant="primary" icon={Plus} onClick={openCreate}>Add price</Button> : null}</>}
      />

      <div className="app-metric-grid app-metric-grid--4">
        {[
          { field: "s380", label: "S380", value: latest?.s380, tone: "orange" },
          { field: "s05", label: "S0.5", value: latest?.s05, tone: "teal" },
          { field: "sgo", label: "SGO", value: latest?.sgo, tone: "violet" },
        ].map((item) => {
          const change = changeSince(data.mops, item.field);
          return <Metric key={item.field} label={`${item.label} latest`} value={formatMoney(item.value, { digits: 2 })} detail={change == null ? "No prior actual" : `${change >= 0 ? "+" : ""}${change.toFixed(2)} vs prior`} tone={item.tone} icon={change != null && change < 0 ? TrendingDown : TrendingUp} />;
        })}
        <Metric label="Published through" value={latest ? formatDate(latest.price_date) : "No data"} detail={latest?.is_estimate ? "Latest is an estimate" : "Latest is actual"} tone={latest?.is_estimate ? "amber" : "green"} />
      </div>

      <div className="app-market-grid">
        <Panel className="app-chart-panel">
          <div className="app-panel-header">
            <div><h2>Price history</h2><p>SGO is converted to USD/MT for a comparable scale.</p></div>
            <SegmentedControl value={range} onChange={setRange} label="Chart range" options={[{ value: "1m", label: "1M" }, { value: "3m", label: "3M" }, { value: "6m", label: "6M" }, { value: "1y", label: "1Y" }, { value: "all", label: "All" }]} />
          </div>
          <div className="app-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 4 }}>
                <CartesianGrid stroke="#e8ecef" vertical={false} />
                <XAxis dataKey="price_date" tickFormatter={(value) => value.slice(5)} tick={{ fill: "#738091", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={26} />
                <YAxis tick={{ fill: "#738091", fontSize: 11 }} axisLine={false} tickLine={false} width={48} />
                <Tooltip content={<MopsTooltip />} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                <Line type="monotone" dataKey="s380" name="S380" stroke="#d6532f" strokeWidth={2} dot={false} connectNulls />
                <Line type="monotone" dataKey="s05" name="S0.5" stroke="#087f8c" strokeWidth={2} dot={false} connectNulls />
                <Line type="monotone" dataKey="sgoMt" name="SGO x7.45" stroke="#7152a5" strokeWidth={2} dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel className="app-forward-panel">
          <div className="app-panel-header app-forward-panel__header">
            <div>
              <h2>Forward adjustment</h2>
              <p>{settings.forwardSpreadsUpdatedAt ? `Last updated ${formatDateTime(settings.forwardSpreadsUpdatedAt)} HKT` : "Adjustment update time not recorded"}</p>
            </div>
            <div className="app-forward-curve">
              <StatusBadge tone={curve.tone}>{curve.label}</StatusBadge>
              <small>{curve.detail}</small>
            </div>
          </div>
          <div className="app-forward-list">
            {[{ key: "s380", label: "S380", value: latest?.s380 }, { key: "s05", label: "S0.5", value: latest?.s05 }, { key: "sgo", label: "SGO", value: latest?.sgo }].map((item) => {
              const spread = spreadDraft[item.key] === "" || spreadDraft[item.key] == null ? 0 : Number(spreadDraft[item.key]);
              const curveLabel = spread > 0 ? "Contango" : spread < 0 ? "Backwardation" : "Flat";
              return (
                <label key={item.key}>
                  <span><strong>{item.label}</strong><small>{curveLabel} | Forward {formatMoney(item.value == null ? null : Number(item.value) + spread, { digits: 2 })}</small></span>
                  <input className="app-input" type="number" step="any" value={spreadDraft[item.key] ?? ""} placeholder="0" disabled={readOnly} onChange={(event) => setSpreadDraft((current) => ({ ...current, [item.key]: event.target.value }))} />
                </label>
              );
            })}
          </div>
          {!readOnly && <Button icon={Save} variant="primary" onClick={saveSpreads} disabled={saving}>Save adjustments</Button>}
        </Panel>
      </div>

      <SectionHeading
        title="Monthly publication ledger"
        description="Recorded prices and expected Singapore Platts publication dates for the selected period."
        actions={(
          <div className="app-market-period-actions">
            <a className="app-source-link" href={PLATTS_PUBLICATION_SOURCE.url} target="_blank" rel="noreferrer">
              <ExternalLink size={14} aria-hidden="true" />
              <span>Calendar source</span>
            </a>
            <Select aria-label="Publication year" value={filterYear} onChange={(event) => setFilterYear(event.target.value)}>
              {availableYears.map((year) => <option key={year} value={year}>{`Year ${year}`}</option>)}
            </Select>
            <Select aria-label="Publication month" value={filterMonth} onChange={(event) => setFilterMonth(event.target.value)}>
              {MONTH_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </div>
        )}
      />

      <Panel className="app-mops-average-panel">
        <div className="app-mops-average-panel__header">
          <div>
            <div className="app-mops-average-panel__title">Estimated monthly average | {formatMonth(selectedMonth)}</div>
            <p>Latest available price is carried through every remaining publication day.</p>
          </div>
          <div className="app-mops-publication-progress">
            <CalendarDays size={17} aria-hidden="true" />
            <span><strong>{publicationProgress.actual}</strong> actual</span>
            <span><strong>{publicationProgress.verified}</strong> verified</span>
            <span><strong>{publicationProgress.estimated}</strong> estimated</span>
            <span><strong>{publicationProgress.total}</strong> scheduled</span>
          </div>
        </div>
        <div className="app-mops-average-values">
          {MOPS_PRODUCTS.map((product) => {
            const result = monthAverages[product.field];
            return (
              <div key={product.field}>
                <span>{product.label}</span>
                <strong>{formatMoney(result?.avg, { digits: 3 })}</strong>
                <small>{result ? `${result.actualDays} published | ${result.estimatedDays} estimated | ${result.carryDays} carried` : "No price available for projection"}</small>
              </div>
            );
          })}
        </div>
        <div className={`app-mops-finality ${monthFinality.ready ? "is-ready" : "is-pending"}`}>
          <StatusBadge tone={monthFinality.ready ? "positive" : "warning"}>{monthFinality.ready ? "Final and verified" : "Not final"}</StatusBadge>
          <span>{monthFinality.ready
            ? `All ${monthFinality.total} publication days are verified. Paper hedges for this month expire automatically.`
            : !monthFinality.calendarSupported
              ? "The approved Platts publication calendar is unavailable for this year."
              : !monthFinality.reachedLastTradingDay
                ? `Final trading day: ${formatDate(monthFinality.lastTradingDay)}. FCOS will not expire paper hedges before then.`
                : `${monthFinality.verified} of ${monthFinality.total} publication days are complete and source-verified.`}</span>
        </div>
      </Panel>

      <TableFrame>
        <table className="app-table app-table--mops">
          <thead><tr><th>Publication date</th><th>S380 (USD/MT)</th><th>S0.5 (USD/MT)</th><th>SGO (USD/BBL)</th><th>Data source</th><th>Status</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {ledgerRows.map((row) => {
              const status = publicationStatus(row);
              const record = row.record;
              return (
                <tr key={row.date} className={`app-mops-ledger-row ${status.className}`}>
                  <td><strong>{formatDate(row.date)}</strong><small>{row.scheduled ? "Platts publication day" : "Recorded outside calendar"}</small></td>
                  <td>{formatMoney(record?.s380, { digits: 2 })}</td>
                  <td>{formatMoney(record?.s05, { digits: 2 })}</td>
                  <td>{formatMoney(record?.sgo, { digits: 2 })}</td>
                  <td>
                    {record ? <><strong>{record.source || "Manual"}</strong><small>Saved price record</small></> : (
                      <><a className="app-table-source" href={PLATTS_PUBLICATION_SOURCE.url} target="_blank" rel="noreferrer">S&amp;P Global Platts</a><small>Publication calendar</small></>
                    )}
                  </td>
                  <td><StatusBadge tone={status.tone}>{status.label}</StatusBadge>{record && !record.is_estimate ? <small>{record.verification_status === "verified" ? `Source verified ${formatDateTime(record.verified_at)} HKT` : "Source message not verified"}</small> : null}</td>
                  <td>{record && !readOnly ? <div className="app-row-actions"><IconButton label="Edit price" icon={Edit3} variant="quiet" onClick={() => openEdit(record)} /><IconButton label="Delete price" icon={Trash2} variant="danger" onClick={() => setDeleteTarget(record)} /></div> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableFrame>

      <Drawer
        open={Boolean(drawer)}
        onClose={closeDrawer}
        title={drawer?.mode === "edit" ? "Edit MOPS price" : "Add MOPS price"}
        description="Capture a published assessment, estimate from market indications, or enter values directly."
        width="medium"
        footer={<><Button onClick={closeDrawer} disabled={saving}>Cancel</Button><Button variant="primary" onClick={save} disabled={saving}>{saving ? "Saving..." : drawer?.mode === "edit" ? "Save changes" : "Add entry"}</Button></>}
      >
        {error && <InlineError error={error} />}
        <section className="app-form-section">
          <div className="app-form-section__title">Published bulletin capture</div>
          <Field label="Third-party MOPS message" hint="Paste the original dated message; FCOS compares its date and all three prices with the saved row">
            <textarea className="app-input app-textarea" rows="5" value={rawText} onChange={(event) => setRawText(event.target.value)} placeholder="07-Apr-2026 S380: 421.50 S0.5: 492.25 SGO: 73.45" />
          </Field>
          <Button icon={Bot} onClick={parseRaw} disabled={parsing || !rawText.trim()}>{parsing ? "Parsing..." : "Parse values"}</Button>
          <div className="app-callout app-callout--neutral">An actual MOPS row is verified only when the pasted third-party message contains the same date, S380, S0.5, and SGO values. Manual rows without evidence remain unverified and cannot finalize the month.</div>
        </section>
        {drawer?.mode === "create" && (
          <section className="app-form-section app-form-section--indication">
            <div className="app-form-section__title">Market indication estimate</div>
            <div className="app-form-grid app-form-grid--2">
              <Field label="Today's indication" hint="Spot product levels used to estimate today's MOPS">
                <textarea
                  className="app-input app-textarea"
                  rows="5"
                  value={indicationText}
                  onChange={(event) => setIndicationText(event.target.value)}
                  placeholder={"380: 535.00\n0.5%: 710.00\n10ppm gas: 147.00"}
                />
              </Field>
              <Field label="Forward indication" hint="Optional nearest future-month MOC levels">
                <textarea
                  className="app-input app-textarea"
                  rows="5"
                  value={forwardIndicationText}
                  onChange={(event) => setForwardIndicationText(event.target.value)}
                  placeholder={"Aug 380: 522.00\nAug 0.5%: 670.00\nAug gas: 141.23"}
                />
              </Field>
            </div>
            <Button icon={Sparkles} onClick={parseIndication} disabled={parsing || !indicationText.trim()}>{parsing ? "Estimating..." : "Estimate today's MOPS"}</Button>
          </section>
        )}
        <section className="app-form-section">
          <div className="app-form-section__title">Price details</div>
          <div className="app-form-grid app-form-grid--2">
            <Field label="Price date" required><input className="app-input" type="date" value={form.price_date || ""} onChange={(event) => setField("price_date", event.target.value)} /></Field>
            <Field label="Source"><Select value={form.source || "Manual"} onChange={(event) => setField("source", event.target.value)}><option>Manual</option><option>S&amp;P Global</option><option>Estimate</option></Select></Field>
            <Field label="S380 (USD/MT)"><input className="app-input" type="number" step="any" value={form.s380 ?? ""} onChange={(event) => setField("s380", event.target.value)} /></Field>
            <Field label="S0.5 (USD/MT)"><input className="app-input" type="number" step="any" value={form.s05 ?? ""} onChange={(event) => setField("s05", event.target.value)} /></Field>
            <Field label="SGO (USD/BBL)" className="app-field--span-2"><input className="app-input" type="number" step="any" value={form.sgo ?? ""} onChange={(event) => setField("sgo", event.target.value)} /></Field>
          </div>
          <label className="app-check"><input type="checkbox" checked={Boolean(form.is_estimate)} onChange={(event) => setField("is_estimate", event.target.checked)} /><span>Mark this record as an estimate</span></label>
        </section>
        {forwardSuggestion && (
          <section className="app-form-section">
            <div className="app-form-section__title">{formatMonth(forwardSuggestion.month)} forward adjustment</div>
            <div className="app-form-grid app-form-grid--3">
              {[
                { field: "s380", label: "S380 adjustment", unit: "USD/MT" },
                { field: "s05", label: "S0.5 adjustment", unit: "USD/MT" },
                { field: "sgo", label: "SGO adjustment", unit: "USD/BBL" },
              ].map((item) => (
                <Field
                  key={item.field}
                  label={item.label}
                  hint={forwardSuggestion.prices?.[item.field] == null ? "No MOC price" : `MOC outright ${formatMoney(forwardSuggestion.prices[item.field], { digits: 2 })} ${item.unit}`}
                >
                  <input
                    className="app-input"
                    type="number"
                    step="any"
                    value={forwardSuggestion.adjustments?.[item.field] ?? ""}
                    onChange={(event) => setForwardSuggestion((current) => ({
                      ...current,
                      adjustments: { ...current.adjustments, [item.field]: event.target.value },
                    }))}
                    disabled={forwardSuggestion.prices?.[item.field] == null}
                  />
                </Field>
              ))}
            </div>
            <label className="app-check">
              <input
                type="checkbox"
                checked={Boolean(forwardSuggestion.apply)}
                onChange={(event) => setForwardSuggestion((current) => ({ ...current, apply: event.target.checked }))}
              />
              <span>Update the shared forward adjustment when this MOPS entry is saved</span>
            </label>
          </section>
        )}
      </Drawer>

      <ConfirmDialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} onConfirm={remove} busy={saving} title="Delete MOPS price?" description={deleteTarget ? formatDate(deleteTarget.price_date) : ""} />
    </div>
  );
}
