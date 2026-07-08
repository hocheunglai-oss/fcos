import { useEffect, useMemo, useState } from 'react';
import { Check, CircleDollarSign, FileText, Loader2, Mail, Settings } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PageHeader from '@/components/common/PageHeader';
import DraftNotice from '@/components/common/DraftNotice';
import {
  readPaymentReminderSmtpSettings,
  readSmtpSettings,
  savePaymentReminderSmtpSettings,
  saveSmtpSettings,
} from '@/lib/smtpSettings';
import { RATE_PROVIDER_OPTIONS, readExchangeRateSettings, saveExchangeRateSettings } from '@/lib/exchangeRateSettings';
import { DOCUMENT_SOURCE_GROUPS, readDocumentSettings, saveDocumentSettings } from '@/lib/documentSettings';
import { clearDraft, readDraft, sameDraftValue, useDraftAutosave } from '@/lib/draftAutosave';

const SETTINGS_DRAFT_KEY = 'settings:page';
const SETTINGS_TAB_KEY = 'settings:active-tab';
const EMAIL_SENDER_TAB_KEY = 'settings:email-sender-tab';

const SETTINGS_TABS = [
  { id: 'email', label: 'Email Senders', icon: Mail },
  { id: 'exchange', label: 'Exchange Rate', icon: CircleDollarSign },
  { id: 'documents', label: 'STEM Documents', icon: FileText },
];

function validSettingsTab(value) {
  return SETTINGS_TABS.some((tab) => tab.id === value) ? value : 'email';
}

function settingsSnapshot() {
  return {
    smtpSettings: readSmtpSettings(),
    paymentReminderSmtpSettings: readPaymentReminderSmtpSettings(),
    exchangeRateSettings: readExchangeRateSettings(),
    documentSettings: readDocumentSettings(),
  };
}

function SettingsPanel({ title, description, icon: Icon, meta, children }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {Icon && (
            <div className="mt-0.5 rounded-lg bg-muted p-2 text-muted-foreground">
              <Icon className="h-4 w-4" />
            </div>
          )}
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            {description && <p className="mt-1 max-w-3xl text-xs text-muted-foreground">{description}</p>}
          </div>
        </div>
        {meta && <div className="shrink-0 text-xs text-muted-foreground">{meta}</div>}
      </div>
      {children}
    </section>
  );
}

function SmtpAccountCard({ title, description, settings, onChange, enableLabel }) {
  const patch = (updates) => onChange((prev) => ({ ...prev, ...updates }));

  return (
    <div className="rounded-xl border border-border bg-background/50 p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="mt-0.5 rounded-lg bg-muted p-2 text-muted-foreground">
          <Mail className="h-4 w-4" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            For Microsoft 365, if From Email differs from Email Username, the username mailbox must have Send As permission for that From Email.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <label className="flex items-center gap-2 text-sm font-medium text-foreground md:col-span-4">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) => patch({ enabled: event.target.checked })}
          />
          {enableLabel}
        </label>
        <div className="space-y-1.5 md:col-span-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sender Name</Label>
          <Input
            value={settings.fromName || ''}
            onChange={(event) => patch({ fromName: event.target.value })}
            placeholder="Fratelli Cosulich"
          />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">From Email</Label>
          <Input
            value={settings.fromEmail || ''}
            onChange={(event) => patch({ fromEmail: event.target.value })}
            placeholder="collections@cosulich.com.hk"
          />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">SMTP Host</Label>
          <Input
            value={settings.host}
            onChange={(event) => patch({ host: event.target.value })}
            placeholder="smtp.office365.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Port</Label>
          <Input
            type="number"
            value={settings.port}
            onChange={(event) => patch({ port: event.target.value })}
            placeholder="587"
          />
        </div>
        <label className="flex items-end gap-2 pb-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={settings.secure}
            onChange={(event) => patch({ secure: event.target.checked })}
          />
          SSL/TLS immediately
        </label>
        <div className="space-y-1.5 md:col-span-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email Username</Label>
          <Input
            value={settings.user}
            onChange={(event) => patch({ user: event.target.value })}
            placeholder="email@cosulich.com.hk"
          />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Password / App Password</Label>
          <Input
            type="password"
            value={settings.password}
            onChange={(event) => patch({ password: event.target.value })}
            placeholder="Saved when you click Save All Settings"
          />
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [smtpSettings, setSmtpSettings] = useState(readSmtpSettings);
  const [paymentReminderSmtpSettings, setPaymentReminderSmtpSettings] = useState(readPaymentReminderSmtpSettings);
  const [exchangeRateSettings, setExchangeRateSettings] = useState(readExchangeRateSettings);
  const [documentSettings, setDocumentSettings] = useState(readDocumentSettings);
  const [baseSettings, setBaseSettings] = useState(settingsSnapshot);
  const [draftRestoredAt, setDraftRestoredAt] = useState(null);
  const [activeTab, setActiveTab] = useState(() => validSettingsTab(localStorage.getItem(SETTINGS_TAB_KEY)));
  const [activeEmailSenderTab, setActiveEmailSenderTab] = useState(() => localStorage.getItem(EMAIL_SENDER_TAB_KEY) || 'internal');

  useEffect(() => {
    const base = settingsSnapshot();
    const draft = readDraft(SETTINGS_DRAFT_KEY);
    const next = draft?.data && !sameDraftValue(draft.data, base)
      ? { ...base, ...draft.data }
      : base;
    setSmtpSettings(next.smtpSettings || base.smtpSettings);
    setPaymentReminderSmtpSettings(next.paymentReminderSmtpSettings || base.paymentReminderSmtpSettings);
    setExchangeRateSettings(next.exchangeRateSettings || base.exchangeRateSettings);
    setDocumentSettings(next.documentSettings || base.documentSettings);
    setBaseSettings(base);
    setDraftRestoredAt(draft?.data && !sameDraftValue(next, base) ? draft.updatedAt : null);
  }, []);

  const settingsDraftValue = useMemo(() => ({
    smtpSettings,
    paymentReminderSmtpSettings,
    exchangeRateSettings,
    documentSettings,
  }), [documentSettings, exchangeRateSettings, paymentReminderSmtpSettings, smtpSettings]);
  const settingsDirty = Boolean(baseSettings && !sameDraftValue(settingsDraftValue, baseSettings));
  useDraftAutosave(SETTINGS_DRAFT_KEY, settingsDraftValue, {
    enabled: true,
    dirty: settingsDirty,
    message: 'Autosaved Settings draft. Save or discard it before leaving.',
  });

  const changeTab = (tab) => {
    const next = validSettingsTab(tab);
    setActiveTab(next);
    localStorage.setItem(SETTINGS_TAB_KEY, next);
  };

  const changeEmailSenderTab = (tab) => {
    setActiveEmailSenderTab(tab);
    localStorage.setItem(EMAIL_SENDER_TAB_KEY, tab);
  };

  const saveAll = async () => {
    setSaving(true);
    saveSmtpSettings(smtpSettings);
    savePaymentReminderSmtpSettings(paymentReminderSmtpSettings);
    saveExchangeRateSettings(exchangeRateSettings);
    saveDocumentSettings(documentSettings);
    const savedValue = {
      smtpSettings,
      paymentReminderSmtpSettings,
      exchangeRateSettings,
      documentSettings,
    };
    setBaseSettings(savedValue);
    clearDraft(SETTINGS_DRAFT_KEY);
    setDraftRestoredAt(null);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const discardSettingsDraft = () => {
    clearDraft(SETTINGS_DRAFT_KEY);
    if (baseSettings) {
      setSmtpSettings(baseSettings.smtpSettings || readSmtpSettings());
      setPaymentReminderSmtpSettings(baseSettings.paymentReminderSmtpSettings || readPaymentReminderSmtpSettings());
      setExchangeRateSettings(baseSettings.exchangeRateSettings || readExchangeRateSettings());
      setDocumentSettings(baseSettings.documentSettings || readDocumentSettings());
    }
    setDraftRestoredAt(null);
  };

  const toggleDocumentSourceGroup = (group) => {
    setDocumentSettings((prev) => {
      const current = new Set(prev.relevantSourceGroups || []);
      if (current.has(group)) current.delete(group);
      else current.add(group);
      return { ...prev, relevantSourceGroups: [...current] };
    });
  };

  return (
    <div className="mx-auto max-w-6xl p-6 lg:p-8">
      <PageHeader
        icon={Settings}
        eyebrow="Admin"
        title="Settings"
        description="Configure email senders, exchange rates, and STEM document behavior."
        actions={(
          <Button onClick={saveAll} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : null}
            {saved ? 'Saved!' : 'Save All Settings'}
          </Button>
        )}
      />

      <DraftNotice restoredAt={draftRestoredAt} label="Settings draft restored" onDiscard={discardSettingsDraft} className="mb-6" />

      <Tabs value={activeTab} onValueChange={changeTab} className="space-y-4">
        <div className="rounded-2xl border border-border bg-card/70 p-2">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
            {SETTINGS_TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className="h-9 gap-2 px-3 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        <TabsContent value="email" className="mt-0">
          <SettingsPanel
            icon={Mail}
            title="Email Senders"
            description="Manage sender accounts for internal AR reports and customer-facing payment reminders."
          >
            <Tabs value={activeEmailSenderTab} onValueChange={changeEmailSenderTab} className="space-y-4">
              <TabsList className="grid h-auto w-full grid-cols-1 gap-1 bg-muted/50 p-1 sm:w-fit sm:grid-cols-2">
                <TabsTrigger value="internal" className="gap-2 px-4 data-[state=active]:bg-background">
                  <Mail className="h-3.5 w-3.5" />
                  Internal
                </TabsTrigger>
                <TabsTrigger value="external-payment-reminder" className="gap-2 px-4 data-[state=active]:bg-background">
                  <Mail className="h-3.5 w-3.5" />
                  External Payment Reminder
                </TabsTrigger>
              </TabsList>

              <TabsContent value="internal" className="mt-0">
                <SmtpAccountCard
                  title="Internal"
                  description="Used by internal reports and late payment interest request emails. The password is saved in this browser's app settings."
                  settings={smtpSettings}
                  onChange={setSmtpSettings}
                  enableLabel="Use this SMTP account for Internal emails"
                />
              </TabsContent>

              <TabsContent value="external-payment-reminder" className="mt-0">
                <SmtpAccountCard
                  title="External Payment Reminder"
                  description="Used only by customer-facing payment reminder emails. Keep this separate from the internal report sender."
                  settings={paymentReminderSmtpSettings}
                  onChange={setPaymentReminderSmtpSettings}
                  enableLabel="Use this SMTP account for External Payment Reminder emails"
                />
              </TabsContent>
            </Tabs>
          </SettingsPanel>
        </TabsContent>

        <TabsContent value="exchange" className="mt-0">
          <SettingsPanel
            icon={CircleDollarSign}
            title="Exchange Rate API"
            description="Used by Broker's Commission to convert USD payable and receivable summaries into CNY."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">USD/CNY Mid-Rate Source</Label>
                <Select
                  value={exchangeRateSettings.provider}
                  onValueChange={(provider) => setExchangeRateSettings((prev) => ({ ...prev, provider }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RATE_PROVIDER_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-lg border border-border bg-background/50 p-3 text-xs text-muted-foreground">
                <div><span className="font-semibold text-foreground">Source:</span> Frankfurter API</div>
                <div><span className="font-semibold text-foreground">Rate treatment:</span> API rate is mid-rate</div>
                <div><span className="font-semibold text-foreground">Bank buy rate:</span> mid-rate less 0.2%</div>
                <div><span className="font-semibold text-foreground">Date rule:</span> latest available rate on or before quarter end</div>
                <div><span className="font-semibold text-foreground">Auth:</span> no API key</div>
              </div>
            </div>
          </SettingsPanel>
        </TabsContent>

        <TabsContent value="documents" className="mt-0">
          <SettingsPanel
            icon={FileText}
            title="STEM Documents"
            description="Choose which discovered Salesforce document sources are relevant for Stem Detail and dispute document browsing."
          >
            <label className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
              <input
                type="checkbox"
                checked={documentSettings.showOnlyRelevant}
                onChange={(event) => setDocumentSettings((prev) => ({ ...prev, showOnlyRelevant: event.target.checked }))}
              />
              Show only relevant document sources by default
            </label>

            <div className="grid gap-2 sm:grid-cols-2">
              {DOCUMENT_SOURCE_GROUPS.map((group) => {
                const checked = documentSettings.relevantSourceGroups?.includes(group);
                return (
                  <label key={group} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/50 px-3 py-2 text-sm">
                    <span className="font-medium text-foreground">{group}</span>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleDocumentSourceGroup(group)}
                    />
                  </label>
                );
              })}
            </div>
          </SettingsPanel>
        </TabsContent>
      </Tabs>

      <div className="mt-4 flex justify-end rounded-xl border border-border bg-card/70 p-3">
        <Button onClick={saveAll} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : null}
          {saved ? 'Saved!' : 'Save All Settings'}
        </Button>
      </div>
    </div>
  );
}
