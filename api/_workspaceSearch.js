const STEM_MODULES = ['dashboard', 'review', 'disputes', 'buyer_invoices', 'incoming_payments', 'cashflow_forecast', 'pnl', 'brokers', 'hedge_desk'];
const sources = [
  { object: 'Invoice__c', kind: 'Buyer invoice', modules: ['buyer_invoices', 'incoming_payments'] },
  { object: 'Supplier_Invoice__c', kind: 'Supplier invoice', modules: ['incoming_payments', 'cashflow_forecast', 'pnl'] },
  { object: 'Payment__c', kind: 'Payment', modules: ['incoming_payments', 'buyer_invoices', 'cashflow_forecast', 'brokers'] },
];

export function searchLiteral(query) {
  return String(query).replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('%', '\\%').replaceAll('_', '\\_');
}

// All related records are restricted through their authoritative STEM lookup.
// Unsupported schemas are reported unavailable, never queried without scope.
export function createWorkspaceSearch({ requireActiveUser, userHasAnyModuleAccess, salesforceObjectFields,
  interofficeStemAccessCondition, queryRows, loadDashboardCounterpartySearch }) {
  return async function workspaceSearch(body = {}, req = null, accessContext = null) {
    const context = accessContext || await requireActiveUser(req);
    const query = String(body.query || '').trim().slice(0, 80);
    if (query.length < 2) return { results: [], counterparties: [], unavailableSources: [] };
    const permitted = (modules) => userHasAnyModuleAccess(context.client, context.profile, modules);
    const results = [];
    const unavailableSources = [];
    let counterparties = [];
    const literal = searchLiteral(query);
    const limit = Math.min(12, Math.max(1, Math.floor(Number(body.limit) || 8)));
    const jobs = [];
    if (await permitted(['dashboard'])) jobs.push({ label: 'Accounts and GROUPs', run: async () => {
      const data = await loadDashboardCounterpartySearch({ body: { query, limit }, accessContext: context, force: false });
      counterparties = data.results || [];
    } });
    if (await permitted(STEM_MODULES)) {
      const fields = (await salesforceObjectFields({ objectName: 'stem__c' })).fields || [];
      const scope = await interofficeStemAccessCondition(context, fields);
      jobs.push({ label: 'STEMs and vessels', run: async () => {
        const names = new Set(fields.map((field) => field.name));
        const vessel = fields.find((field) => field.name === 'Vessel__c' && field.relationshipName);
        const vesselName = vessel ? `${vessel.relationshipName}.Name` : null;
        const searchable = ['Name', 'KeyStem__c'].filter((name) => names.has(name));
        if (vesselName) searchable.push(vesselName);
        if (!searchable.length) throw new Error('Search metadata unavailable');
        const select = [...new Set(['Id', 'Name', ...searchable])];
        const rows = await queryRows(`SELECT ${select.join(', ')} FROM stem__c WHERE (${searchable.map((name) => `${name} LIKE '%${literal}%'`).join(' OR ')})${scope ? ` AND (${scope})` : ''} ORDER BY LastModifiedDate DESC LIMIT ${limit}`, { limit });
        results.push(...rows.map((row) => ({ id: row.Id, stemId: row.Id, kind: 'STEM', label: row.Name || row.KeyStem__c, detail: vessel ? row[vessel.relationshipName]?.Name || '' : '' })));
      } });
      for (const source of sources) {
        if (!await permitted(source.modules)) continue;
        jobs.push({ label: source.kind, run: async () => {
          const described = (await salesforceObjectFields({ objectName: source.object })).fields || [];
          const lookup = described.find((field) => field.name === 'STEM__c' && (field.referenceTo || []).some((target) => target.toLowerCase() === 'stem__c'));
          if (!lookup) throw new Error('STEM scope unavailable');
          const names = new Set(described.map((field) => field.name));
          const searchable = ['Name', 'Reference__c', 'Invoice_Number__c', 'Document_Number__c'].filter((name) => names.has(name));
          if (!searchable.length) throw new Error('Search metadata unavailable');
          const rows = await queryRows(`SELECT Id, ${lookup.name}, ${searchable.join(', ')} FROM ${source.object} WHERE (${searchable.map((name) => `${name} LIKE '%${literal}%'`).join(' OR ')}) AND ${lookup.name} IN (SELECT Id FROM stem__c${scope ? ` WHERE ${scope}` : ''}) ORDER BY LastModifiedDate DESC LIMIT ${limit}`, { limit });
          results.push(...rows.map((row) => ({ id: row.Id, stemId: row[lookup.name], kind: source.kind, label: row.Name || searchable.map((name) => row[name]).find(Boolean), detail: searchable.filter((name) => name !== 'Name').map((name) => row[name]).filter(Boolean).join(' · ') })));
        } });
      }
      if (await permitted(['disputes'])) jobs.push({ label: 'Disputes', run: async () => {
        const reference = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(query);
        let request = context.client.from('dispute_beta_cases').select('id,stem_id,stem_name,workflow_status');
        request = reference ? request.eq('id', query) : request.ilike('stem_name', `%${query.replace(/[\\%_]/g, '\\$&')}%`);
        const { data, error } = await request.order('updated_at', { ascending: false }).limit(limit);
        if (error) throw error;
        const candidates = (data || []).filter((row) => /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(row.stem_id));
        if (!candidates.length) return;
        const scoped = await queryRows(`SELECT Id FROM stem__c WHERE Id IN (${[...new Set(candidates.map((row) => `'${row.stem_id}'`))].join(', ')})${scope ? ` AND (${scope})` : ''} LIMIT ${limit}`, { limit });
        const allowed = new Set(scoped.map((row) => row.Id));
        results.push(...candidates.filter((row) => allowed.has(row.stem_id)).map((row) => ({ id: row.id, stemId: row.stem_id,
          kind: 'Dispute', label: row.stem_name || row.stem_id, detail: row.workflow_status,
          link: `/disputes?stem=${encodeURIComponent(row.stem_id)}` })));
      } });
    }
    const outcomes = await Promise.allSettled(jobs.map((job) => job.run()));
    outcomes.forEach((outcome, index) => { if (outcome.status === 'rejected') unavailableSources.push(jobs[index].label); });
    results.sort((a, b) => a.kind.localeCompare(b.kind) || String(a.label).localeCompare(String(b.label)));
    return { results, counterparties, unavailableSources, retrievedAt: new Date().toISOString(), source: 'Salesforce and FCOS', limitPerSource: limit };
  };
}
