export function createStemWorkspaceActivity({ requireActiveUser, resolveStemId, userHasAnyModuleAccess }) {
  return async function stemWorkspaceActivity(body, req, accessContext) {
    const context = accessContext || await requireActiveUser(req);
    const stemId = await resolveStemId(body.stemId, context);
    const sources = [];
    const permitted = (modules) => userHasAnyModuleAccess(context.client, context.profile, modules);
    if (await permitted(['buyer_invoices', 'incoming_payments'])) {
      sources.push({ label: 'Collections', run: () => context.client.from('buyer_invoice_collection_events')
        .select('id,event_type,note,created_at,actor_email').eq('stem_id', stemId).order('created_at', { ascending: false }).limit(100) });
      sources.push({ label: 'Variable charges', run: () => context.client.from('variable_charge_events')
        .select('id,event_type,summary,created_at,actor_email,variable_charge_cases!inner(stem_id)').eq('variable_charge_cases.stem_id', stemId).order('created_at', { ascending: false }).limit(100) });
    }
    if (await permitted(['disputes'])) sources.push({ label: 'Disputes', run: () => context.client.from('dispute_beta_events')
      .select('id,event_type,note,created_at,actor_email').eq('stem_id', stemId).order('created_at', { ascending: false }).limit(100) });
    const outcomes = await Promise.allSettled(sources.map((source) => source.run()));
    const events = [], unavailableSources = [], limitedSources = [];
    outcomes.forEach((result, index) => {
      const label = sources[index].label;
      if (result.status !== 'fulfilled' || result.value.error) { unavailableSources.push(label); return; }
      const rows = result.value.data || [];
      if (rows.length === 100) limitedSources.push(label);
      events.push(...rows.map((row) => ({ id: `${label}:${row.id}`, source: label, action: row.event_type,
        note: row.note || row.summary || '', createdAt: row.created_at, actor: row.actor_email })));
    });
    return { stemId, events: events.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))), unavailableSources, limitedSources };
  };
}
