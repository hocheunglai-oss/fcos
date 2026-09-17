import { buildQuantityCoverageRows, DEFAULT_GENERAL, isCoverageSwap } from '../src/hedge/lib/domain.js';

function bookError(message, statusCode = 502) {
  return Object.assign(new Error(message), { statusCode, code: statusCode === 403 ? 'MARKET_BOOK_ACCESS_DENIED' : 'MARKET_BOOK_LOAD_FAILED' });
}

async function readAllRows(client, table, columns) {
  const rows = [];
  let lastId = null;
  for (;;) {
    let query = client.from(table).select(columns).order('id', { ascending: true }).limit(1000);
    if (lastId) query = query.gt('id', lastId);
    const result = await query;
    if (result.error) throw bookError('Book quantities could not be loaded. Retry to refresh your accessible book.');
    const page = result.data || [];
    rows.push(...page);
    if (page.length < 1000) return rows;
    const nextId = page.at(-1)?.id;
    if (!nextId || nextId === lastId) throw bookError('Book pagination did not advance.');
    lastId = nextId;
  }
}

// Both module checks happen before any book read. Never call the full Hedge Desk
// snapshot here: its expiry reconciliation mutates records during a read.
export function createMarketBookContext({ requireActiveUser, userHasAnyModuleAccess }) {
  return async (_body = {}, req = null, accessContext = null) => {
    const context = accessContext || await requireActiveUser(req);
    const permissions = await Promise.all(['markets', 'hedge_desk'].map((moduleId) => (
      userHasAnyModuleAccess(context.client, context.profile, [moduleId])
    )));
    if (!permissions.every(Boolean)) throw bookError('Markets and Hedge Desk access are required to view book coverage.', 403);
    const [physicals, swaps, settings] = await Promise.all([
      readAllRows(context.client, 'hedge_physical_trades', 'id,counterparty,product,qty_min,qty_max,unit,is_closed'),
      readAllRows(context.client, 'hedge_swap_hedges', 'id,counterparty,product,quantity,unit,direction,is_expired'),
      context.client.from('hedge_settings').select('value').eq('key', 'general').maybeSingle(),
    ]);
    if (settings.error) throw bookError('Book unit settings could not be loaded.');
    const ratio = Number(settings.data?.value?.sgo_bbl_per_mt ?? DEFAULT_GENERAL.sgo_bbl_per_mt);
    if (!Number.isFinite(ratio) || ratio <= 0) throw bookError('The configured gasoil unit conversion is invalid.');
    return {
      generatedAt: new Date().toISOString(),
      rows: buildQuantityCoverageRows(physicals, swaps, ratio),
      totals: { openPhysicalCount: physicals.filter((row) => !row.is_closed).length, liveHedgeCount: swaps.filter(isCoverageSwap).length },
      warnings: [],
      methodology: 'Current open physical midpoint quantities and live counterparty hedges, netting opposing hedge directions. Gasoil is in BBL; fuel oil is in MT. Quantity coverage is not a measure of price risk or hedge effectiveness.',
    };
  };
}
