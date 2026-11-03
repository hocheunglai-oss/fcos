const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const fields = ['observedAt', 'dayRemaining', 'minuteRemaining', 'appMinuteRemaining', 'appDayRemaining', 'dayResetAt', 'retryAt', 'rateLimitProblem', 'retryAfterSeconds'];
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
    const shared = await client.from('xero_shared_tenant_control')
      .select('tenant_id,allowance_known,available_calls,observed_at,retry_at,daily_hold,rate_snapshot,revision')
      .eq('tenant_id', tenantId).maybeSingle();
    if (shared.error) throw new Error('shared-control');
    if (shared.data) {
      const row = shared.data;
      const rate = row.rate_snapshot;
      if (row.tenant_id !== tenantId || typeof row.allowance_known !== 'boolean'
        || (row.available_calls != null && (!Number.isSafeInteger(row.available_calls) || row.available_calls < 0))
        || !rate || typeof rate !== 'object' || Array.isArray(rate)
        || (rate.observedAt && (!instant(rate.observedAt) || Date.parse(rate.observedAt) > now))
        || ['dayRemaining','minuteRemaining','appMinuteRemaining','appDayRemaining','retryAfterSeconds'].some(key => rate[key] != null && (!Number.isSafeInteger(rate[key]) || rate[key] < 0))
        || ['retryAt','dayResetAt'].some(key => rate[key] != null && !instant(rate[key]))) throw new Error('shared-snapshot');
      return {
        ...(rate.observedAt ? { rateLimit: Object.fromEntries(fields.filter(key => Object.hasOwn(rate, key)).map(key => [key, rate[key]])) } : {}),
        sharedControl: { allowanceKnown: row.allowance_known, availableCalls: row.available_calls,
          reserve: 200, dailyHold: row.daily_hold === true, retryAt: row.retry_at || null, revision: row.revision },
      };
    }
    // Historical audit is display-only. It cannot authorise a request or seed
    // the shared controller's allowance.
    const result = await client.from('xero_financial_audit_events').select('fingerprints,rate_limit_snapshot')
      .eq('fingerprints->>tenantId', tenantId).not('rate_limit_snapshot->>observedAt', 'is', null)
      .order('rate_limit_snapshot->>observedAt', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
    if (result.error) throw new Error('audit');
    if (!result.data) return {};
    const rate = result.data.rate_limit_snapshot;
    if (result.data.fingerprints?.tenantId !== tenantId || !rate || typeof rate !== 'object' || Array.isArray(rate)
      || !instant(rate.observedAt) || Date.parse(rate.observedAt) > now
      || ['dayRemaining', 'minuteRemaining', 'appMinuteRemaining', 'appDayRemaining', 'retryAfterSeconds'].some(key => rate[key] != null && (!Number.isSafeInteger(rate[key]) || rate[key] < 0))
      || ['retryAt', 'dayResetAt'].some(key => rate[key] != null && !instant(rate[key]))
      || (rate.rateLimitProblem != null && typeof rate.rateLimitProblem !== 'string')) throw new Error('snapshot');
    return { rateLimit: Object.fromEntries(fields.filter(key => Object.hasOwn(rate, key)).map(key => [key, rate[key]])) };
  } catch {
    // A display/read failure must not hide completed financial results or imply
    // that an older value is a fresh provider observation.
    return { allowanceAuditUnavailable: true };
  }
}
