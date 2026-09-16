export function workflowRequestOutcome(status, data = {}) {
  if (['uncertain', 'partial', 'processing'].includes(data?.status || data?.run?.status)) return 'uncertain';
  if (status === 409) return 'conflict';
  if (status === 403) return 'denied';
  if (status >= 500) return 'failed';
  if (status >= 400) return 'invalid';
  if (data?.error) return 'failed';
  return 'completed';
}

export async function recordWorkflowMetric(client, { handler, status, data, durationMs }) {
  const { error } = await client.rpc('record_workflow_metric', {
    p_handler: handler, p_outcome: workflowRequestOutcome(status, data),
    p_duration_ms: Math.max(0, Math.min(1800000, Math.round(durationMs || 0))),
  });
  if (error) throw error;
}

export function createWorkflowMetricsReader({ requireActiveUser, requireAdministratorContext }) {
  return async function workflowMetricsRead(_body, req, accessContext) {
    const context = accessContext || await requireActiveUser(req);
    requireAdministratorContext(context);
    const since = new Date(Date.now() + 8 * 3600000 - 6 * 86400000).toISOString().slice(0, 10);
    const { data, error } = await context.client.from('workflow_daily_metrics')
      .select('event_day,handler,outcome,request_count,duration_ms').gte('event_day', since)
      .order('event_day', { ascending: false }).order('handler').limit(5001);
    if (error) throw error;
    const grouped = new Map();
    for (const row of (data || []).slice(0, 5000)) {
      const aggregate = grouped.get(row.handler) || { handler: row.handler, requests: 0, durationMs: 0, completed: 0, conflict: 0, denied: 0, invalid: 0, failed: 0, uncertain: 0 };
      aggregate.requests += Number(row.request_count);
      aggregate.durationMs += Number(row.duration_ms);
      aggregate[row.outcome] += Number(row.request_count);
      grouped.set(row.handler, aggregate);
    }
    return { since, truncated: data?.length > 5000, rows: [...grouped.values()].map((row) => ({ ...row, averageMs: Math.round(row.durationMs / row.requests) })).sort((a, b) => b.requests - a.requests) };
  };
}
