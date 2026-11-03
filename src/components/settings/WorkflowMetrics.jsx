import { useEffect, useState } from 'react';
import { appClient } from '@/api/appClient';
import { useAuth } from '@/lib/AuthContext';

export default function WorkflowMetrics() {
  const { isAdministrator } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!isAdministrator) return;
    let active = true;
    appClient.functions.invoke('workflowMetricsRead', {}).then((result) => {
      if (!active) return;
      if (result.data?.error) setError(result.data.error);
      else setData(result.data);
    }).catch(() => { if (active) setError('Workflow measurements are temporarily unavailable.'); });
    return () => { active = false; };
  }, [isAdministrator]);
  if (!isAdministrator) return null;
  return <section className="mt-5 rounded-xl border bg-card p-4">
    <h2 className="font-semibold">Workflow friction · Last seven days</h2>
    <p className="mt-1 text-xs text-muted-foreground">Counts and response times for requested saves and actions. Completion means the API returned success; external settlement or delivery still requires its own evidence. No form values or document contents are collected.</p>
    {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : !data ? <p className="mt-3 text-sm">Loading measurements…</p> : !data.rows?.length ? <p className="mt-3 text-sm text-muted-foreground">No measurements recorded yet.</p> : <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs">
      <thead><tr>{['Workflow', 'Requests', 'Completed', 'Source conflicts', 'Permission denied', 'Invalid input', 'Failed', 'Uncertain', 'Average'].map((label) => <th className="p-2" key={label}>{label}</th>)}</tr></thead>
      <tbody>{data.rows.map((row) => <tr className="border-t" key={row.handler}><th className="p-2 font-medium">{row.handler.replace(/([a-z])([A-Z])/g, '$1 $2')}</th>{['requests', 'completed', 'conflict', 'denied', 'invalid', 'failed', 'uncertain'].map((key) => <td className="p-2 tabular-nums" key={key}>{row[key]}</td>)}<td className="p-2">{(row.averageMs / 1000).toFixed(1)}s</td></tr>)}</tbody>
    </table>{data.truncated && <p className="text-amber-800">This view reached its retrieval limit; totals shown are partial.</p>}</div>}
  </section>;
}
