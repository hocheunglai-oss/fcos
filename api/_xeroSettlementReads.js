import { readStoredXeroConnection } from './_xeroContactSync.js';
import { assertXeroFinancialDailyReserve, xeroFinancialAccountingFetch, xeroFinancialRateSnapshot } from './_xeroFinancialSync.js';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);

export function boundedSettlementReads({ client, tenantId, env, maxXeroReads, fail,
  readConnection = readStoredXeroConnection, accountingFetch = xeroFinancialAccountingFetch, now = Date.now }) {
  if (!Number.isSafeInteger(maxXeroReads) || maxXeroReads < 0 || !client || !uuid(tenantId)
      || (env.XERO_TENANT_ID && env.XERO_TENANT_ID !== tenantId)) {
    fail('Settlement verification requires an exact tenant and a bounded accounting read budget.', 400);
  }
  let connection;
  let rate = {};
  const reads = new Map();
  const assertCurrent = () => {
    if (!connection?.accessToken || connection.tenantId !== tenantId || !(Date.parse(connection.expiresAt) > now() + 90_000)) {
      fail('An unexpired saved Xero connection is required for settlement verification.');
    }
  };
  const getConnection = async () => {
    if (!connection) connection = await readConnection(client);
    assertCurrent();
    return connection;
  };
  const read = async (current, path, request) => {
    assertCurrent();
    const record = /^\/(CreditNotes|Invoices|Payments|Prepayments|BankTransactions)\/([a-f0-9-]+)(?:\?unitdp=4)?$/i.exec(path);
    const changeProbe = /^\/(Invoices|CreditNotes|Payments|Contacts)\?page=1&pageSize=1$/.test(path)
      && Number.isFinite(Date.parse(request.headers?.['If-Modified-Since']));
    if (current !== connection || request.method !== 'GET' || request.body != null || request.rawBody != null
        || (path !== '/Organisations' && !uuid(record?.[2]) && !changeProbe)) fail('Settlement verification accepts read-only accounting requests.');
    const key = changeProbe ? `${path}:${request.headers['If-Modified-Since']}` : path;
    if (reads.has(key)) return reads.get(key);
    assertXeroFinancialDailyReserve(rate, env);
    if (reads.size >= maxXeroReads) fail('The settlement accounting read budget was exhausted.');
    const response = accountingFetch(connection, path, { ...request, retryOnRateLimit: false, transientRetryLimit: 0, onResponse: (value) => {
      rate = xeroFinancialRateSnapshot(value?.headers, rate);
      request.onResponse?.(value);
      assertXeroFinancialDailyReserve(rate, env);
    } });
    reads.set(key, response);
    return response;
  };
  return { getConnection, read, count: () => reads.size };
}
