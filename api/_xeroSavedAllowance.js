const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const fields = ['observedAt', 'dayRemaining', 'minuteRemaining', 'appMinuteRemaining', 'dayResetAt', 'retryAt', 'rateLimitProblem', 'retryAfterSeconds'];
const instant = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

// Read only persisted observations for the currently connected organisation.
// This does not refresh credentials, spend Xero allowance, or rewrite a preview.
export async function readSavedXeroAllowance(client, { now = Date.now() } = {}) {
  try {
    const connection = await client.from('xero_contact_sync_connections').select('tenant_id').eq('id', 'primary').maybeSingle();
    if (connection.error) throw new Error('connection');
    if (!connection.data) return {};
    const tenantId = connection.data.tenant_id;
    if (!uuid.test(tenantId || '')) throw new Error('tenant');
    const result = await client.from('xero_financial_audit_events').select('fingerprints,rate_limit_snapshot')
      .eq('fingerprints->>tenantId', tenantId).not('rate_limit_snapshot->>observedAt', 'is', null)
      .order('rate_limit_snapshot->>observedAt', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
    if (result.error) throw new Error('audit');
    if (!result.data) return {};
    const rate = result.data.rate_limit_snapshot;
    if (result.data.fingerprints?.tenantId !== tenantId || !rate || typeof rate !== 'object' || Array.isArray(rate)
      || !instant(rate.observedAt) || Date.parse(rate.observedAt) > now
      || ['dayRemaining', 'minuteRemaining', 'appMinuteRemaining', 'retryAfterSeconds'].some(key => rate[key] != null && (!Number.isSafeInteger(rate[key]) || rate[key] < 0))
      || ['retryAt', 'dayResetAt'].some(key => rate[key] != null && !instant(rate[key]))
      || (rate.rateLimitProblem != null && typeof rate.rateLimitProblem !== 'string')) throw new Error('snapshot');
    return { rateLimit: Object.fromEntries(fields.filter(key => Object.hasOwn(rate, key)).map(key => [key, rate[key]])) };
  } catch {
    // A display/read failure must not hide completed financial results or imply
    // that an older value is a fresh provider observation.
    return { allowanceAuditUnavailable: true };
  }
}
