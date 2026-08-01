import { useEffect, useMemo, useState } from 'react';
import { Bot, Database, Save, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { appClient } from '@/api/appClient';
import { useAuth } from '@/lib/AuthContext';
import { useAppSettings } from '@/hedge/hooks/useAppSettings';

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
  const [salesforce, setSalesforce] = useState({ productId: '', recordTypeId: '', iceSupplierId: '', fcbsSupplierId: '', icePaymentTerm: '', fcbsPaymentTerm: '' });
  const [assistant, setAssistant] = useState(null);
  const [assistantError, setAssistantError] = useState('');
  const [saving, setSaving] = useState('');
  const [message, setMessage] = useState('');

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
    setSalesforce({
      productId: settings.salesforceMapping.productId || '',
      recordTypeId: settings.salesforceMapping.recordTypeId || '',
      iceSupplierId: settings.salesforceMapping.venues?.ICE?.supplierId || '',
      fcbsSupplierId: settings.salesforceMapping.venues?.FCBS?.supplierId || '',
      icePaymentTerm: settings.salesforceMapping.venues?.ICE?.paymentTerm || '',
      fcbsPaymentTerm: settings.salesforceMapping.venues?.FCBS?.paymentTerm || '',
    });
  }, [settings.loading]);

  useEffect(() => {
    appClient.functions.invoke('hedgeDeskAssistantSettings', {}, { cache: false }).then(({ data }) => {
      if (data?.error) throw new Error(data.error);
      setAssistant(data);
    }).catch((error) => setAssistantError(error.message));
  }, []);

  const totalUsage = useMemo(() => Object.values(assistant?.usage || {}).reduce((sum, row) => sum + Number(row.estimatedCostUsd || 0), 0), [assistant]);

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

  if (settings.loading) return <p className="text-sm text-muted-foreground">Loading Hedge Desk settings...</p>;

  return (
    <div className="space-y-6">
      {!isAdministrator && <Alert><AlertDescription>Hedge Desk configuration is read-only. Administrators and the General Manager manage these shared settings.</AlertDescription></Alert>}
      {(message || settings.error || assistantError) && <Alert><AlertDescription>{message || settings.error?.message || assistantError}</AlertDescription></Alert>}

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
        <div className="mt-4 space-y-1.5"><Label htmlFor="hedge-email-subject">Subject template</Label><Input id="hedge-email-subject" value={email.email_subject} disabled={!isAdministrator} onChange={(event) => setEmail((current) => ({ ...current, email_subject: event.target.value }))} /></div>
        <div className="mt-4 space-y-1.5"><Label htmlFor="hedge-email-body">Message template</Label><Textarea id="hedge-email-body" rows={8} value={email.email_body} disabled={!isAdministrator} onChange={(event) => setEmail((current) => ({ ...current, email_body: event.target.value }))} /></div>
        {isAdministrator && <Button className="mt-4" disabled={Boolean(saving)} onClick={() => saveKey('email_settings', email, 'Settlement communication defaults saved.')}><Save className="mr-2 h-4 w-4" />Save communication</Button>}
      </Section>

      <Section title="Salesforce mapping" description="FCOS uses its shared Salesforce authentication. These record IDs identify the existing SWAPS product, suppliers, and optional record type." icon={Database}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Object.entries(salesforce).map(([key, value]) => <div key={key} className="space-y-1.5"><Label htmlFor={`hedge-sf-${key}`}>{key.replace(/([a-z])([A-Z])/g, '$1 $2')}</Label><Input id={`hedge-sf-${key}`} value={value} disabled={!isAdministrator} onChange={(event) => setSalesforce((current) => ({ ...current, [key]: event.target.value.trim() }))} /></div>)}
        </div>
        {isAdministrator && <Button className="mt-4" disabled={Boolean(saving)} onClick={() => saveKey('salesforce_mapping', { ...settings.salesforceMapping, productId: salesforce.productId, recordTypeId: salesforce.recordTypeId, venues: { ICE: { supplierId: salesforce.iceSupplierId, paymentTerm: salesforce.icePaymentTerm }, FCBS: { supplierId: salesforce.fcbsSupplierId, paymentTerm: salesforce.fcbsPaymentTerm } } }, 'Salesforce mapping saved.')}><Save className="mr-2 h-4 w-4" />Save Salesforce mapping</Button>}
      </Section>

      <Section title="Trading Assistant" description="A separate administrator-selected model and USD usage total for compact Hedge Desk book summaries." icon={Bot}>
        {assistant ? <div className="grid gap-4 md:grid-cols-[minmax(0,320px)_1fr] md:items-end"><div className="space-y-1.5"><Label>Interpretation model</Label><Select value={assistant.modelId} disabled={!isAdministrator || Boolean(saving)} onValueChange={(value) => setAssistant((current) => ({ ...current, modelId: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{assistant.models.map((model) => <SelectItem key={model.id} value={model.id}>{model.label} · {model.costTier}</SelectItem>)}</SelectContent></Select></div><div className="text-sm"><strong>${totalUsage.toFixed(6)}</strong><span className="ml-2 text-xs text-muted-foreground">estimated total recorded usage</span></div></div> : <p className="text-sm text-muted-foreground">Loading model and usage...</p>}
        {assistant && isAdministrator && <Button className="mt-4" disabled={Boolean(saving)} onClick={async () => { await saveKey('assistant_model', assistant.modelId, 'Trading Assistant model saved.'); const { data } = await appClient.functions.invoke('hedgeDeskAssistantSettings', {}, { cache: false }); if (!data?.error) setAssistant(data); }}><Save className="mr-2 h-4 w-4" />Save model</Button>}
      </Section>
    </div>
  );
}
