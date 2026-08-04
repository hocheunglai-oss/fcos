import React, { useMemo, useState } from "react";
import { Building2, Edit3, Mail, MapPin, Plus, Trash2 } from "lucide-react";
import { Counterparty } from "@/hedge/api/entities";
import { useActions } from "../data/ActionsContext";
import {
  Button,
  ConfirmDialog,
  Drawer,
  EmptyState,
  Field,
  IconButton,
  InlineError,
  PageHeader,
  SearchInput,
  StatusBadge,
  TableFrame,
} from "../components/ui";

const BLANK_COUNTERPARTY = {
  short_name: "",
  full_name: "",
  attention: "",
  address_line1: "",
  address_line2: "",
  address_line3: "",
  emails: "",
  notes: "",
};

export function CounterpartiesView({ data, settings, readOnly = false }) {
  const actions = useActions();
  const [search, setSearch] = useState("");
  const [drawer, setDrawer] = useState(null);
  const [form, setForm] = useState(BLANK_COUNTERPARTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const rows = useMemo(() => [...data.counterparties]
    .filter((record) => `${record.short_name || ""} ${record.full_name || ""} ${record.emails || ""} ${record.address_line1 || ""} ${record.notes || ""}`.toLowerCase().includes(search.toLowerCase()))
    .sort((left, right) => String(left.short_name || "").localeCompare(String(right.short_name || ""))), [data.counterparties, search]);

  const openCreate = () => {
    setForm(BLANK_COUNTERPARTY);
    setError(null);
    setDrawer({ mode: "create" });
  };
  const openEdit = (record) => {
    setForm({ ...BLANK_COUNTERPARTY, ...record });
    setError(null);
    setDrawer({ mode: "edit", record });
  };
  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!form.short_name.trim()) {
      setError(new Error("A short name is required."));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        short_name: form.short_name.trim().toUpperCase(),
        full_name: form.full_name || "",
        attention: form.attention || "",
        address_line1: form.address_line1 || "",
        address_line2: form.address_line2 || "",
        address_line3: form.address_line3 || "",
        emails: form.emails || "",
        notes: form.notes || "",
      };
      if (drawer?.mode === "edit") {
        await actions.update({ entity: Counterparty, entityName: "Counterparty", id: drawer.record.id, payload, before: drawer.record, label: payload.short_name });
      } else {
        await actions.create({ entity: Counterparty, entityName: "Counterparty", payload, label: payload.short_name });
        if (!settings.lists.counterparts.includes(payload.short_name)) {
          await settings.update("lists", { ...settings.lists, counterparts: [...settings.lists.counterparts, payload.short_name] });
        }
      }
      setDrawer(null);
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
      await actions.remove({ entity: Counterparty, entityName: "Counterparty", record: deleteTarget, label: deleteTarget.short_name || "Counterparty" });
      setDeleteTarget(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="app-page">
      <PageHeader eyebrow="Directory" title="Counterparties" description="Maintain legal identities, invoice recipients, and addresses used in settlement documents." actions={!readOnly ? <Button variant="primary" icon={Plus} onClick={openCreate}>New counterparty</Button> : null} />
      <div className="app-toolbar"><SearchInput value={search} onChange={setSearch} placeholder="Search name, email, address..." /><span className="app-toolbar__summary">{rows.length} counterparties</span></div>
      <TableFrame>
        {rows.length ? <table className="app-table app-table--counterparties"><thead><tr><th>Counterparty</th><th>Legal name</th><th>Invoice contact</th><th>Address</th><th aria-label="Actions" /></tr></thead><tbody>{rows.map((record) => (
          <tr key={record.id}>
            <td><div className="app-party-name"><span>{String(record.short_name || "?").slice(0, 2)}</span><strong>{record.short_name}</strong></div></td>
            <td><strong>{record.full_name || "Not provided"}</strong><small>{record.attention ? `Attn: ${record.attention}` : "No attention line"}</small></td>
            <td>{record.emails ? <><span className="app-inline-icon"><Mail size={14} />{record.emails}</span><StatusBadge tone="positive">Ready</StatusBadge></> : <StatusBadge tone="warning">Missing email</StatusBadge>}</td>
            <td><span className="app-inline-icon"><MapPin size={14} />{[record.address_line1, record.address_line2, record.address_line3].filter(Boolean).join(", ") || "Not provided"}</span></td>
            <td><div className="app-row-actions">{!readOnly && <><IconButton label="Edit counterparty" icon={Edit3} variant="quiet" onClick={() => openEdit(record)} /><IconButton label="Delete counterparty" icon={Trash2} variant="danger" onClick={() => setDeleteTarget(record)} /></>}</div></td>
          </tr>
        ))}</tbody></table> : <EmptyState icon={Building2} title="No counterparties match" description="Adjust the search or create a new counterparty record." action={<Button variant="primary" icon={Plus} onClick={openCreate}>New counterparty</Button>} />}
      </TableFrame>

      <Drawer open={Boolean(drawer)} onClose={() => setDrawer(null)} title={drawer?.mode === "edit" ? `Edit ${drawer.record.short_name}` : "New counterparty"} description="These details populate invoice documents and recipient lists." footer={<><Button onClick={() => setDrawer(null)} disabled={saving}>Cancel</Button><Button variant="primary" onClick={save} disabled={saving}>{saving ? "Saving..." : drawer?.mode === "edit" ? "Save changes" : "Create counterparty"}</Button></>}>
        {error && <InlineError error={error} />}
        <section className="app-form-section"><div className="app-form-section__title">Identity</div><div className="app-form-grid app-form-grid--2"><Field label="Short name" required><input className="app-input" value={form.short_name || ""} onChange={(event) => setField("short_name", event.target.value)} /></Field><Field label="Attention"><input className="app-input" value={form.attention || ""} onChange={(event) => setField("attention", event.target.value)} /></Field><Field label="Full legal name" className="app-field--span-2"><input className="app-input" value={form.full_name || ""} onChange={(event) => setField("full_name", event.target.value)} /></Field></div></section>
        <section className="app-form-section"><div className="app-form-section__title">Invoice delivery</div><div className="app-form-grid app-form-grid--2"><Field label="Invoice email addresses" hint="Comma-separated" className="app-field--span-2"><input className="app-input" value={form.emails || ""} onChange={(event) => setField("emails", event.target.value)} /></Field><Field label="Address line 1" className="app-field--span-2"><input className="app-input" value={form.address_line1 || ""} onChange={(event) => setField("address_line1", event.target.value)} /></Field><Field label="Address line 2"><input className="app-input" value={form.address_line2 || ""} onChange={(event) => setField("address_line2", event.target.value)} /></Field><Field label="Address line 3"><input className="app-input" value={form.address_line3 || ""} onChange={(event) => setField("address_line3", event.target.value)} /></Field></div></section>
        <section className="app-form-section"><div className="app-form-section__title">Notes</div><Field label="Internal notes"><textarea className="app-input app-textarea" rows="4" value={form.notes || ""} onChange={(event) => setField("notes", event.target.value)} /></Field></section>
      </Drawer>
      <ConfirmDialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} onConfirm={remove} busy={saving} title="Delete counterparty?" description={deleteTarget?.short_name || ""} />
    </div>
  );
}
