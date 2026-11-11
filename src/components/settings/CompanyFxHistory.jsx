import { useCallback, useEffect, useState } from 'react';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export default function CompanyFxHistory() {
  const [rows, setRows] = useState([]);
  const [canSave, setCanSave] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ effectiveDate: '', usdHkdRate: '', reason: '' });
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await appClient.functions.invoke('companyFxHistoryGet', {}, { cache: false });
      if (response.data?.error) throw new Error(response.data.error);
      setRows(response.data?.rows || []); setCanSave(response.data?.canSave === true);
    } catch (failure) { setError(failure.message || 'Unable to load company FX history.'); setCanSave(false); setRows([]); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const save = async event => {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try {
      const response = await appClient.functions.invoke('companyFxHistorySave', form);
      if (response.data?.error) throw new Error(response.data.error);
      setForm({ effectiveDate: '', usdHkdRate: '', reason: '' });
      setNotice('Historical rate recorded.');
      await load();
    } catch (failure) { setError(failure.message || 'Unable to record the historical rate.'); }
    finally { setSaving(false); }
  };
  const formatDate = value => new Date(value).toLocaleString('en-GB', { timeZone: 'Asia/Hong_Kong' });
  return <section className="space-y-4 rounded-lg border p-4" aria-label="Company FX history">
    <div className="flex items-center justify-between gap-3">
      <h3 className="font-semibold">Company USD/HKD rate history</h3>
      <Button type="button" variant="outline" size="sm" onClick={load} disabled={loading || saving}>Refresh</Button>
    </div>
    <p className="text-sm text-slate-600">HKD payments use the approved company rate effective on their payment date in Hong Kong. Recorded rates and payment snapshots are permanent.</p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
    {loading ? <p className="text-sm">Loading rate history…</p> : <div className="max-h-64 overflow-auto">
      {rows.length ? <table className="w-full text-left text-sm">
        <thead><tr><th className="p-2">Effective (Hong Kong)</th><th className="p-2">HKD per USD</th><th className="p-2">Reason</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.rateId} className="border-t">
          <td className="p-2 align-top whitespace-nowrap">{formatDate(row.effectiveAt)}</td>
          <td className="p-2 align-top">{Number(row.usdHkdRate).toFixed(6)}</td>
          <td className="p-2 align-top break-words">{row.reason}</td>
        </tr>)}</tbody>
      </table> : !error && <p className="text-sm text-slate-600">No approved rate history is available.</p>}
    </div>}
    {canSave && <form onSubmit={save} className="space-y-3 border-t pt-4">
      <p className="text-sm font-medium">Record an approved historical rate</p>
      <p className="text-xs text-slate-600">Choose a date before today. The rate takes effect at midnight in Hong Kong. Historical entries are permanent. Use the company rate control above for current rates.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="fx-history-date">Historical date</Label>
          <Input id="fx-history-date" type="date" required value={form.effectiveDate} disabled={saving}
            onChange={event => setForm(current => ({ ...current, effectiveDate: event.target.value }))} /></div>
        <div className="space-y-1"><Label htmlFor="fx-history-rate">HKD per 1 USD</Label>
          <Input id="fx-history-rate" type="number" required min="0.000001" max="100" step="0.000001" value={form.usdHkdRate} disabled={saving}
            onChange={event => setForm(current => ({ ...current, usdHkdRate: event.target.value }))} /></div>
      </div>
      <div className="space-y-1"><Label htmlFor="fx-history-reason">Approval reason</Label>
        <Textarea id="fx-history-reason" required minLength={5} maxLength={1000} value={form.reason} disabled={saving}
          onChange={event => setForm(current => ({ ...current, reason: event.target.value }))} /></div>
      <Button type="submit" disabled={saving || loading}>{saving ? 'Recording…' : 'Record permanent historical rate'}</Button>
    </form>}
  </section>;
}
