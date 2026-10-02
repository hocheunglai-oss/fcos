const count = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0;

export function summarizeWorkflowMetrics(rows) {
  const summary = { requests: 0, completed: 0, failed: 0, uncertain: 0, conflict: 0 };
  for (const row of rows) {
    for (const key of Object.keys(summary)) summary[key] += count(row[key]);
  }
  return {
    ...summary,
    completedPercent: summary.requests ? Math.round(summary.completed / summary.requests * 1000) / 10 : null,
  };
}
