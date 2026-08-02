import { useEffect, useRef, useState } from 'react';
import { Database, ExternalLink, GripVertical, Save, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/lib/AuthContext';
import { useAppSettings } from '@/hedge/hooks/useAppSettings';
import { getHedgeSalesforceMapping } from '@/hedge/api/backendFunctions';

const SETTLEMENT_VARIABLES = [
  ['Invoice number', '{invoiceNumber}'],
  ['Invoice type', '{invoiceType}'],
  ['Settlement month', '{settlementMonth}'],
  ['Counterparty', '{counterparty}'],
  ['Attention', '{attn}'],
  ['Net amount', '{netAmount}'],
  ['Payment direction', '{direction}'],
  ['Issue date', '{issueDate}'],
  ['Due date', '{dueDate}'],
].map(([label, token]) => ({ label, token }));

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

const PREVIEW_VALUES = {
  invoiceNumber: 'FCBHK_INV_OTC-2026-0088',
  invoiceType: 'Settlement invoice',
  settlementMonth: 'July 2026',
  counterparty: 'Sample Counterparty',
  attn: 'Accounts Department',
  netAmount: '125,000.00',
  direction: 'payable to',
  issueDate: '02 Aug 2026',
  dueDate: '09 Aug 2026',
};

function renderPreview(value) {
  return String(value || '').replace(/\{([^{}]+)\}/g, (match, key) => PREVIEW_VALUES[key] || match);
}

function numericDraft(value) {
  return Object.fromEntries(Object.entries(value || {}).map(([key, item]) => [key, String(item ?? '')]));
}

function parseNumericDraft(value) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, Number(item || 0)]));
}

function listText(value) {
  return (Array.isArray(value) ? value : []).join(', ');
}

function parseList(value) {
  return [...new Set(String(value || '').split(/[\n,]/).map((item) => item.trim()).filter(Boolean))];
}

function Section({ title, description, icon: Icon, children }) {
  return (
    <section className="border-t border-border pt-5 first:border-t-0 first:pt-0">
      <div className="mb-4 flex items-start gap-3">
        <div className="rounded-md bg-muted p-2 text-muted-foreground"><Icon className="h-4 w-4" /></div>
        <div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-xs text-muted-foreground">{description}</p></div>
      </div>
      {children}
    </section>
  );
}

export default function HedgeSettingsPanel() {
  const settings = useAppSettings();
  const { isAdministrator } = useAuth();
  const [general, setGeneral] = useState({});
  const [rates, setRates] = useState({});
  const [lists, setLists] = useState({ products: '', brokers: '', venues: '', counterparts: '' });
  const [email, setEmail] = useState({ email_to: '', email_cc: '', email_bcc: '', email_subject: '', email_body: '' });
  const [salesforce, setSalesforce] = useState(null);
  const [salesforceError, setSalesforceError] = useState('');
  const [saving, setSaving] = useState('');
  const [message, setMessage] = useState('');
  const [activeTemplateField, setActiveTemplateField] = useState('body');
  const subjectRef = useRef(null);
  const bodyEditorRef = useRef(null);

  useEffect(() => {
    if (settings.loading) return;
    setGeneral(numericDraft({ sgo_bbl_per_mt: settings.general.sgo_bbl_per_mt, ice_usable_ratio: settings.general.ice_usable_ratio }));
    setRates(numericDraft(settings.rates));
    setLists({ products: listText(settings.lists.products), brokers: listText(settings.lists.brokers), venues: listText(settings.lists.venues), counterparts: listText(settings.lists.counterparts) });
    setEmail({
      email_to: settings.email.email_to || '',
      email_cc: settings.email.email_cc || '',
      email_bcc: settings.email.email_bcc || '',
      email_subject: settings.email.email_subject || '',
      email_body: settings.email.email_body || '',
    });
  }, [settings.loading]);

  useEffect(() => {
    let cancelled = false;
    getHedgeSalesforceMapping().then((value) => {
      if (!cancelled) setSalesforce(value);
    }).catch((error) => {
      if (!cancelled) setSalesforceError(error.message || 'Salesforce mapping could not be validated.');
    });
    return () => { cancelled = true; };
  }, []);

  const saveKey = async (key, value, success) => {
    setSaving(key);
    setMessage('');
    try {
      await settings.update(key, value);
      setMessage(success);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving('');
    }
  };

  const insertSubjectVariable = (token) => {
    const input = subjectRef.current;
    const start = input?.selectionStart ?? email.email_subject.length;
    const end = input?.selectionEnd ?? start;
    setEmail((current) => ({ ...current, email_subject: `${current.email_subject.slice(0, start)}${token}${current.email_subject.slice(end)}` }));
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const insertBodyVariable = (token) => {
    const editor = bodyEditorRef.current?.getEditor();
    if (!editor) return;
    const selection = editor.getSelection(true);
    const index = selection?.index ?? Math.max(0, editor.getLength() - 1);
    editor.insertText(index, token, 'user');
    editor.setSelection(index + token.length, 0, 'silent');
  };

  const droppedToken = (event) => event.dataTransfer.getData('application/x-template-variable') || event.dataTransfer.getData('text/plain');

  if (settings.loading) return <p className="text-sm text-muted-foreground">Loading Hedge Desk settings...</p>;

  return (
    <div className="space-y-6">
      {!isAdministrator && <Alert><AlertDescription>Hedge Desk configuration is read-only. Administrators and the General Manager manage these shared settings.</AlertDescription></Alert>}
      {(message || settings.error) && <Alert><AlertDescription>{message || settings.error?.message}</AlertDescription></Alert>}

      <Section title="Valuation controls" description="Shared conversion, margin, fee, and controlled-list inputs used by every Hedge Desk user." icon={SlidersHorizontal}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Object.entries(general).map(([key, value]) => <div key={key} className="space-y-1.5"><Label htmlFor={`hedge-general-${key}`}>{key.replaceAll('_', ' ')}</Label><Input id={`hedge-general-${key}`} value={value} disabled={!isAdministrator} onChange={(event) => setGeneral((current) => ({ ...current, [key]: event.target.value }))} /></div>)}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Object.entries(rates).map(([key, value]) => <div key={key} className="space-y-1.5"><Label htmlFor={`hedge-rate-${key}`}>{key.replaceAll('_', ' ')}</Label><Input id={`hedge-rate-${key}`} type="number" step="any" value={value} disabled={!isAdministrator} onChange={(event) => setRates((current) => ({ ...current, [key]: event.target.value }))} /></div>)}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {Object.entries(lists).map(([key, value]) => <div key={key} className="space-y-1.5"><Label htmlFor={`hedge-list-${key}`}>{key}</Label><Input id={`hedge-list-${key}`} value={value} disabled={!isAdministrator} onChange={(event) => setLists((current) => ({ ...current, [key]: event.target.value }))} /></div>)}
        </div>
        {isAdministrator && <div className="mt-4 flex gap-2"><Button disabled={Boolean(saving)} onClick={() => saveKey('general', { ...settings.general, ...parseNumericDraft(general), company_name: settings.general.company_name, invoice_prefix: settings.general.invoice_prefix }, 'General controls saved.')}><Save className="mr-2 h-4 w-4" />Save general</Button><Button variant="outline" disabled={Boolean(saving)} onClick={() => saveKey('rates', parseNumericDraft(rates), 'Fee rates saved.')}><Save className="mr-2 h-4 w-4" />Save rates</Button><Button variant="outline" disabled={Boolean(saving)} onClick={() => saveKey('lists', Object.fromEntries(Object.entries(lists).map(([key, value]) => [key, parseList(value)])), 'Controlled lists saved.')}><Save className="mr-2 h-4 w-4" />Save lists</Button></div>}
      </Section>

      <Section title="Settlement communication" description="Default recipients and templates only. The sender mailbox is assigned under Email Senders and cannot be overridden here." icon={Database}>
        <div className="grid gap-4 md:grid-cols-3">
          {['email_to', 'email_cc', 'email_bcc'].map((key) => <div key={key} className="space-y-1.5"><Label htmlFor={`hedge-email-${key}`}>{key.replace('email_', '').toUpperCase()}</Label><Input id={`hedge-email-${key}`} value={email[key]} disabled={!isAdministrator} onChange={(event) => setEmail((current) => ({ ...current, [key]: event.target.value }))} /></div>)}
        </div>
        <div className="mt-4 space-y-2">
          <Label>Template variables</Label>
          <p className="text-xs text-muted-foreground">Drag a variable into the subject or message, or click it to insert it into the message.</p>
          <div className="flex flex-wrap gap-2">
            {SETTLEMENT_VARIABLES.map((variable) => (
              <button
                key={variable.token}
                type="button"
                draggable={isAdministrator}
                disabled={!isAdministrator}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-default disabled:opacity-60"
                onClick={() => activeTemplateField === 'subject' ? insertSubjectVariable(variable.token) : insertBodyVariable(variable.token)}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'copy';
                  event.dataTransfer.setData('text/plain', variable.token);
                  event.dataTransfer.setData('application/x-template-variable', variable.token);
                }}
                title={`Insert ${variable.label}`}
              >
                <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
                {variable.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 space-y-1.5">
          <Label htmlFor="hedge-email-subject">Subject template</Label>
          <Input
            ref={subjectRef}
            id="hedge-email-subject"
            value={email.email_subject}
            disabled={!isAdministrator}
            onChange={(event) => setEmail((current) => ({ ...current, email_subject: event.target.value }))}
            onFocus={() => setActiveTemplateField('subject')}
            onDragOver={(event) => { if (isAdministrator) event.preventDefault(); }}
            onDrop={(event) => { if (!isAdministrator) return; event.preventDefault(); insertSubjectVariable(droppedToken(event)); }}
          />
        </div>
        <div className="mt-4 space-y-1.5">
          <Label>Message template</Label>
          <div
            className="rounded-md bg-background [&_.ql-container]:min-h-52 [&_.ql-editor]:min-h-52"
            onDragOver={(event) => { if (isAdministrator) event.preventDefault(); }}
            onDrop={(event) => { if (!isAdministrator) return; event.preventDefault(); insertBodyVariable(droppedToken(event)); }}
          >
            <ReactQuill ref={bodyEditorRef} theme="snow" value={email.email_body} readOnly={!isAdministrator} modules={QUILL_MODULES} onFocus={() => setActiveTemplateField('body')} onChange={(email_body) => setEmail((current) => ({ ...current, email_body }))} />
          </div>
        </div>
        <div className="mt-4 rounded-md border border-border bg-muted/20 p-4">
          <Label>Rendered preview</Label>
          <p className="mt-2 border-b border-border pb-3 text-sm font-semibold">{renderPreview(email.email_subject) || 'No subject'}</p>
          <div className="mt-3 [&_.ql-container]:border-0 [&_.ql-editor]:min-h-24 [&_.ql-editor]:p-0"><ReactQuill theme="bubble" readOnly value={renderPreview(email.email_body)} modules={{ toolbar: false }} /></div>
        </div>
        {isAdministrator && <Button className="mt-4" disabled={Boolean(saving)} onClick={() => saveKey('email_settings', email, 'Settlement communication defaults saved.')}><Save className="mr-2 h-4 w-4" />Save communication</Button>}
      </Section>

      <Section title="Salesforce mapping" description="FCOS validates the approved Product, record type, and supplier Accounts against live Salesforce metadata. Raw record IDs are not editable." icon={Database}>
        {salesforceError && <Alert><AlertDescription>{salesforceError}</AlertDescription></Alert>}
        {!salesforce && !salesforceError && <p className="text-sm text-muted-foreground">Validating Salesforce mapping...</p>}
        {salesforce && <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            {[{ label: 'Product', value: salesforce.product.name, id: salesforce.product.id }, { label: 'Record type', value: salesforce.recordType.name, id: salesforce.recordType.id }].map((item) => <a key={item.label} href={`${salesforce.instanceUrl}/${item.id}`} target="_blank" rel="noreferrer" className="rounded-md border border-border bg-background p-3 hover:bg-muted/40"><span className="text-xs font-medium text-muted-foreground">{item.label}</span><strong className="mt-1 flex items-center gap-2 text-sm"><ShieldCheck className="h-4 w-4 text-emerald-600" />{item.value}<ExternalLink className="h-3.5 w-3.5 text-muted-foreground" /></strong></a>)}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {Object.entries(salesforce.venues || {}).map(([venue, route]) => <a key={venue} href={`${salesforce.instanceUrl}/${route.supplier.id}`} target="_blank" rel="noreferrer" className="rounded-md border border-border bg-background p-3 hover:bg-muted/40"><span className="text-xs font-medium text-muted-foreground">{venue} supplier</span><strong className="mt-1 flex items-center gap-2 text-sm"><ShieldCheck className="h-4 w-4 text-emerald-600" />{route.supplier.name}<ExternalLink className="h-3.5 w-3.5 text-muted-foreground" /></strong><small className="mt-1 block text-muted-foreground">{route.supplier.clKey || 'No CL Key'} · new records use {route.newRecordPaymentTerm}; existing payment terms are preserved</small></a>)}
          </div>
          <p className="text-xs text-muted-foreground">Mapping revision {salesforce.mappingRevision}. Changes require a validated deployment rather than browser-entered Salesforce IDs.</p>
        </div>}
      </Section>
    </div>
  );
}
