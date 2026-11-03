import { buildTraderSeries, buildTraderWorkspace, normalizeTraderPreferences, traderBaseline, traderComparisonBaseline, traderError } from './_marketTraderWorkspaceModel.js';
import { hktToday } from '../src/hedge/lib/domain.js';

async function allRows(factory) {
  const rows = []; let lastId = null;
  for (;;) {
    let query = factory().order('id', { ascending: true }).limit(1000);
    if (lastId) query = query.gt('id', lastId);
    const result = await query;
    if (result.error) throw traderError('Verified market history could not be loaded. Retry to refresh.', 502, 'MARKET_TRADER_LOAD_FAILED');
    const page = result.data || []; rows.push(...page);
    if (page.length < 1000) return rows;
    if (!page.at(-1)?.id || page.at(-1).id === lastId) throw traderError('Market history pagination did not advance.', 502);
    lastId = page.at(-1).id;
  }
}
export async function loadTraderMarketData(client, { endDate = hktToday() } = {}) {
  const start = new Date(`${endDate}T00:00:00Z`); start.setUTCDate(start.getUTCDate() - 89); const startDate = start.toISOString().slice(0, 10);
  const [definitions, observations, imports, conflicts] = await Promise.all([
    allRows(() => client.from('market_intelligence_series').select('id,active,market_family,port_key,port_label,product_key,product_label,alias_label,source_symbol,source_type,currency_code,unit,value_kind,assessment_session,basis_metadata').eq('active', true)),
    allRows(() => client.from('market_price_observations').select('id,series_id,import_id,price_date,price,quality_status,source_hash,source_page,contract_month,observation_unit,assessment_session,basis_metadata').eq('quality_status', 'verified').gte('price_date', startDate).lte('price_date', endDate)),
    allRows(() => client.from('market_report_imports').select('id,status,report_date,source_hash,source_document_type').eq('status', 'completed').gte('report_date', startDate).lte('report_date', endDate)),
    allRows(() => client.from('market_observation_evidence').select('id,series_id,price_date').eq('disposition', 'quarantined').gte('price_date', startDate).lte('price_date', endDate)),
  ]);
  return buildTraderSeries({ definitions, observations, imports, conflicts, endDate });
}

export function createMarketTraderWorkspace({ requireActiveUser, userHasAnyModuleAccess, loadSeries = loadTraderMarketData, now = () => new Date() }) {
  async function contextFor(req, accessContext) {
    const context = accessContext || await requireActiveUser(req);
    if (!await userHasAnyModuleAccess(context.client, context.profile, ['markets'])) throw traderError('Markets access is required.', 403, 'MARKET_TRADER_ACCESS_DENIED');
    return context;
  }
  async function load(context) {
    const [result, series] = await Promise.all([
      context.client.from('market_trader_workspaces').select('state,revision').eq('user_id', context.profile.id).maybeSingle(),
      loadSeries(context.client),
    ]);
    if (result.error) throw traderError('Your saved Markets workspace could not be loaded. Retry to refresh.', 502, 'MARKET_TRADER_LOAD_FAILED');
    return { state: result.data?.state || {}, revision: Number(result.data?.revision || 0), series };
  }
  const validVisit = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(value);
  async function read(body = {}, req = null, accessContext = null) {
    const context = await contextFor(req, accessContext);
    return buildTraderWorkspace({ ...await load(context), visitId: validVisit(body.visitId) ? body.visitId : '', now: now() });
  }
  async function save(body = {}, req = null, accessContext = null) {
    const context = await contextFor(req, accessContext);
    const data = await load(context); const at = now(); const state = structuredClone(data.state);
    const visitId = validVisit(body.visitId) ? body.visitId : '';
    // Replay of the same view is safe, including React StrictMode and retries.
    if (body.action === 'visit' && visitId && state.visit?.id === visitId) return buildTraderWorkspace({ ...data, visitId, now: at });
    if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) throw traderError('A workspace revision is required. Reload before saving.');
    if (body.expectedRevision !== data.revision) throw traderError('Your Markets workspace changed in another session. Reload before saving.', 409, 'MARKET_TRADER_REVISION_CONFLICT');
    switch (body.action) {
      case 'preferences': {
        const preferences = normalizeTraderPreferences(body.preferences, data.series, state.preferences);
        state.alertState = Object.fromEntries(preferences.subscriptions.filter((rule) => JSON.stringify(rule) === JSON.stringify(state.preferences?.subscriptions?.find((old) => old.id === rule.id))).map((rule) => [rule.id, state.alertState?.[rule.id] || {}]));
        state.preferences = preferences;
        break;
      }
      case 'visit':
        if (!visitId) throw traderError('A valid visit identifier is required.');
        if (!data.series.some((row) => row.latest)) return buildTraderWorkspace({ ...data, visitId, now: at });
        state.visit = { id: visitId, at: at.toISOString(), previousAt: state.visit?.at || null, previous: state.visit?.current || {}, current: traderBaseline(data.series), previousComparisons: state.visit?.currentComparisons || {}, currentComparisons: traderComparisonBaseline(state.preferences, data.series) };
        break;
      case 'acknowledge':
      case 'snooze': {
        const alert = buildTraderWorkspace({ ...data, visitId, now: at }).alerts.find((row) => row.id === body.subscriptionId);
        if (!alert) throw traderError('This alert is no longer active. Refresh Markets.');
        const current = Object.hasOwn(state.alertState || {}, alert.id) ? state.alertState[alert.id] : {};
        if (alert.eventKey !== body.eventKey) throw traderError('The alert changed. Refresh before acting on it.', 409);
        if (body.action === 'acknowledge') {
          current.acknowledgedEventKey = alert.eventKey;
        } else {
          if (![1, 8, 24].includes(body.hours)) throw traderError('Snooze alerts for 1, 8 or 24 hours.');
          current.snoozedEventKey = alert.eventKey;
          current.snoozedUntil = new Date(at.getTime() + body.hours * 3600000).toISOString();
        }
        state.alertState = { ...state.alertState, [alert.id]: current };
        break;
      }
      default: throw traderError('Choose a supported personal Markets action.');
    }
    const result = await context.client.rpc('save_market_trader_workspace', { p_user_id: context.profile.id, p_actor_user_id: context.profile.id, p_state: state, p_expected_revision: data.revision });
    if (result.error) {
      if (result.error.code === '40001') throw traderError('Your Markets workspace changed in another session. Reload before saving.', 409, 'MARKET_TRADER_REVISION_CONFLICT');
      throw traderError('Your Markets changes could not be saved. Reload to check their status before retrying.', 502, 'MARKET_TRADER_SAVE_FAILED');
    }
    const saved = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!saved?.state || !Number.isSafeInteger(Number(saved.revision))) throw traderError('Your Markets save returned an incomplete result. Reload to check its status.', 502, 'MARKET_TRADER_SAVE_FAILED');
    return buildTraderWorkspace({ state: saved.state, revision: saved.revision, series: data.series, visitId, now: at });
  }
  return { marketTraderWorkspace: read, marketTraderWorkspaceSave: save };
}
