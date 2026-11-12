import { usdFromHkd } from './_companyFxRates.js';
import { xeroPaymentDate } from './_xeroPaymentAssociation.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(message) { throw new Error(`Cash ledger reconciliation: ${message}`); }
function cents(value, label = 'amount') {
  if (value == null || !/^-?\d+(?:\.\d{1,2})?$/.test(String(value))) fail(`${label} must be an explicit two-decimal amount.`);
  const result = Number(value) * 100;
  if (!Number.isSafeInteger(Math.round(result))) fail(`${label} exceeds supported precision.`);
  return Math.round(result);
}
function same(left, right, label) { if (left !== right) fail(`${label} does not match its immutable source.`); }
function moneyEqual(left, right, label) { same(cents(left, label), cents(right, label), label); }
function nativeEvent(row) { return cents(row.Currency__c === 'HKD' ? row.Cash_HKD_Amount__c : row.Cash_USD_Amount__c); }
function nativeAllocation(row) { return cents(row.Currency__c === 'HKD' ? row.Allocated_HKD__c : row.Allocated_Cash_USD__c); }
function operation(row) {
  if (!uuid.test(row.Operation_Id__c || '') || !/^[0-9a-f]{64}$/i.test(row.Request_Fingerprint__c || '')) fail('Operation evidence is incomplete.');
}
function eventEvidence(row) {
  operation(row);
  if (!['USD', 'HKD'].includes(row.Currency__c) || !['Buy', 'Sell'].includes(row.Direction__c) || !['Payment', 'Refund'].includes(row.Kind__c)
    || !row.STEM__c || !row.Party__c || !row.Trade_FX_Side__c || !row.Bank__c || !row.Bank_Evidence__c || !['USD', 'HKD'].includes(row.Bank_Currency__c)
    || xeroPaymentDate(row.Payment_Date__c) !== row.Payment_Date__c) fail('Cash event identity, date, direction or bank evidence is incomplete.');
  if (nativeEvent(row) <= 0 || cents(row.Cash_USD_Amount__c) < 0 || cents(row.Bank_Native_Amount__c) <= 0) fail('Cash event amounts must be positive magnitudes.');
  if (row.Currency__c === row.Bank_Currency__c) same(nativeEvent(row), cents(row.Bank_Native_Amount__c), 'Same-currency bank amount');
  if (row.Currency__c === 'HKD') {
    const effective = Date.parse(row.FX_Effective_At__c);
    const dayEnd = Date.parse(row.Payment_Date__c + 'T00:00:00+08:00') + 86_400_000;
    if (!row.FX_Revision__c || !Number.isFinite(effective) || effective >= dayEnd) fail('Payment-date company-rate evidence is missing or late.');
    moneyEqual(row.Cash_USD_Amount__c, usdFromHkd(row.Cash_HKD_Amount__c, row.FX_Rate__c), 'Company-valued cash');
  } else if (row.Cash_HKD_Amount__c != null || row.FX_Rate__c != null || row.FX_Revision__c != null || row.FX_Effective_At__c != null) fail('USD cash cannot inherit HKD rate evidence.');
}

/** Validate complete immutable cash history; applications are not additional bank transactions. */
export function validateTradeCashLedger({ events = [], allocations = [], payments = [], invoices = [] } = {}) {
  const eventById = new Map(events.map(row => [row.Id, row]));
  const allocationById = new Map(allocations.map(row => [row.Id, row]));
  const paymentById = new Map(payments.map(row => [row.Id, row]));
  const invoiceById = new Map(invoices.map(row => [row.Id, row]));
  if (eventById.size !== events.length || allocationById.size !== allocations.length || paymentById.size !== payments.length || invoiceById.size !== invoices.length) fail('Duplicate evidence identities.');
  const balances = new Map(); const paymentEvidence = new Map(); const reversed = new Set();
  for (const event of events) {
    eventEvidence(event);
    if (event.Kind__c === 'Payment') {
      if (event.Original_Cash_Event__c || event.Original_Carrying_USD__c != null || event.Original_Bank_Allocation__c != null || cents(event.Settlement_FX_USD__c) !== 0) fail('An original cash event cannot contain refund carrying evidence.');
      balances.set(event.Id, { native: nativeEvent(event), usd: cents(event.Cash_USD_Amount__c), bank: cents(event.Bank_Native_Amount__c) });
    }
  }
  for (const refund of events.filter(row => row.Kind__c === 'Refund')) {
    const original = eventById.get(refund.Original_Cash_Event__c);
    if (!original || original.Kind__c !== 'Payment') fail('A refund requires its original cash event.');
    for (const field of ['STEM__c', 'Party__c', 'Direction__c', 'Currency__c', 'Trade_FX_Side__c']) same(refund[field], original[field], `Refund ${field}`);
    const carrying = cents(refund.Original_Carrying_USD__c); const bank = cents(refund.Original_Bank_Allocation__c);
    if (carrying < 0 || bank < 0) fail('Refund original-basis allocations cannot be negative.');
    same(cents(refund.Settlement_FX_USD__c), refund.Direction__c === 'Buy' ? cents(refund.Cash_USD_Amount__c) - carrying : carrying - cents(refund.Cash_USD_Amount__c), 'Refund settlement FX');
    const balance = balances.get(original.Id); balance.native -= nativeEvent(refund); balance.usd -= carrying; balance.bank -= bank;
  }
  for (const allocation of allocations) {
    operation(allocation);
    const event = eventById.get(allocation.Cash_Event__c); const payment = paymentById.get(allocation.Payment__c);
    if (!event || event.Kind__c !== 'Payment' || !payment || paymentEvidence.has(payment.Id)) fail('Each application requires one original cash event and one unique payment bridge.');
    const invoiceId = event.Direction__c === 'Buy' ? allocation.Supplier_Invoice__c : allocation.Buyer_Invoice__c;
    const invoice = invoiceById.get(invoiceId);
    if (!invoice || invoice.Proforma__c || invoice.Original_Invoice__c || invoice.Original_Supplier_Invoice__c
      || (event.Direction__c === 'Buy' ? allocation.Buyer_Invoice__c : allocation.Supplier_Invoice__c)) fail('Applications must identify an exact positive final invoice.');
    same(invoice.STEM__c, event.STEM__c, 'Invoice STEM'); same(invoice.Document_Currency__c, event.Currency__c, 'Invoice currency');
    if (event.Direction__c === 'Buy') same(invoice.Supplier__c, event.Party__c, 'Invoice supplier');
    else same(invoice.STEM__r?.Account__c, event.Party__c, 'Invoice buyer');
    same(allocation.Currency__c, event.Currency__c, 'Application currency');
    const native = nativeAllocation(allocation); const cash = cents(allocation.Allocated_Cash_USD__c); const carrying = cents(allocation.Invoice_Carrying_USD__c); const bank = cents(allocation.Bank_Native_Allocation__c);
    if (allocation.Kind__c === 'Applied') {
      if (native <= 0 || cash < 0 || carrying < 0 || bank < 0 || allocation.Reverses_Allocation__c) fail('An application must use positive balances.');
    } else if (allocation.Kind__c === 'Reversal') {
      const original = allocationById.get(allocation.Reverses_Allocation__c);
      if (!original || original.Kind__c !== 'Applied' || reversed.has(original.Id)) fail('A reversal must identify one unreversed application.');
      for (const field of ['Cash_Event__c', 'Buyer_Invoice__c', 'Supplier_Invoice__c', 'Currency__c']) same(allocation[field] ?? null, original[field] ?? null, `Reversal ${field}`);
      for (const field of ['Allocated_Cash_USD__c', 'Invoice_Carrying_USD__c', 'Bank_Native_Allocation__c', 'Settlement_FX_USD__c']) same(cents(allocation[field]), -cents(original[field]), `Reversal ${field}`);
      same(native, -nativeAllocation(original), 'Reversal native amount'); reversed.add(original.Id);
    } else fail('Unknown application kind.');
    if (event.Currency__c === 'USD' && allocation.Allocated_HKD__c != null) fail('USD applications cannot contain HKD amounts.');
    same(cents(allocation.Settlement_FX_USD__c), event.Direction__c === 'Buy' ? carrying - cash : cash - carrying, 'Application settlement FX');
    same(payment.Cash_Event__c, event.Id, 'Payment cash event'); same(payment.STEM__c, event.STEM__c, 'Payment STEM');
    same(payment.Account__c, event.Party__c, 'Payment counterparty');
    same(payment.RecordType?.DeveloperName, event.Direction__c === 'Buy' ? 'Payable' : 'Receivable', 'Payment direction');
    for (const [paymentField, eventField] of [['Bank__c','Bank__c'], ['Bank_Currency__c','Bank_Currency__c'], ['Bank_FX_Evidence__c','Bank_Evidence__c']])
      same(payment[paymentField], event[eventField], paymentField);
    same(cents(payment.Bank_Native_Amount__c), Math.abs(bank), 'Payment bank amount');

    same(payment.Buyer_Invoice__c ?? null, allocation.Buyer_Invoice__c ?? null, 'Payment buyer invoice');
    same(payment.Supplier_Invoice__c ?? null, allocation.Supplier_Invoice__c ?? null, 'Payment supplier invoice');
    same(payment.Payment_Currency__c, event.Currency__c, 'Payment currency');
    same(cents(event.Currency__c === 'HKD' ? payment.Payment_HKD_Amount__c : payment.Amount__c), native, 'Payment native amount');
    for (const [paymentField, eventField] of [['Payment_FX_Rate__c', 'FX_Rate__c'], ['Payment_FX_Revision__c', 'FX_Revision__c'], ['Payment_FX_Effective_At__c', 'FX_Effective_At__c'], ['Date__c', 'Payment_Date__c']]) same(payment[paymentField] ?? null, event[eventField] ?? null, paymentField);
    same(cents(payment.Amount__c), cash, 'Payment cash basis'); same(cents(payment.Invoice_Carrying_USD__c), carrying, 'Payment invoice carrying');
    same(cents(payment.Settlement_FX_USD__c), cents(allocation.Settlement_FX_USD__c), 'Payment settlement FX');
    same(payment.Payment_Operation_Id__c, allocation.Operation_Id__c, 'Payment operation'); same(payment.Payment_Request_Fingerprint__c, allocation.Request_Fingerprint__c, 'Payment request fingerprint');
    const balance = balances.get(event.Id); balance.native -= native; balance.usd -= cash; balance.bank -= bank;
    paymentEvidence.set(payment.Id, { event, allocation, reversal: allocation.Kind__c === 'Reversal' });
  }
  for (const payment of payments) if (payment.Cash_Event__c && !paymentEvidence.has(payment.Id)) fail('A payment bridge is missing its immutable application.');
  for (const balance of balances.values()) if (balance.native < 0 || balance.usd < 0 || balance.bank < 0 || (balance.native === 0 && (balance.usd !== 0 || balance.bank !== 0))) fail('Applications and refunds exceed original cash or leave an unexplained rounding balance.');
  return { paymentEvidence, balances };
}

export async function loadTradeCashLedger(stemIds, query, { direction = 'Sell', includeReviewIdentity = false } = {}) {
  if (direction != null && !['Buy', 'Sell'].includes(direction)) fail('Invalid ledger direction.');
  if (!stemIds.length) return { events: [], allocations: [] };
  if (stemIds.some(id => !/^[a-z0-9]{15}(?:[a-z0-9]{3})?$/i.test(id))) fail('Invalid business STEM.');
  const ids = [...new Set(stemIds)];
  const events = [];
  const allocations = [];
  const reviewFields = includeReviewIdentity
    ? ',Party__r.Name,Party__r.Company_Code__c,Party__r.Inactive_Suspended__c,Trade_FX_Side__r.Currency__c' : '';
  const complete = (result) => !result?.error && Array.isArray(result?.records)
    && Number.isSafeInteger(result.totalSize) && result.totalSize === result.records.length
    && result.done !== false && !result.nextRecordsUrl;
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const scope = batch.map(id => `'${id}'`).join(',');
    const [eventResult, allocationResult] = await Promise.all([
      query(`SELECT Id,Name,CreatedDate,STEM__c,Party__c,Direction__c,Currency__c,Kind__c,Cash_HKD_Amount__c,Cash_USD_Amount__c,
        FX_Rate__c,FX_Revision__c,FX_Effective_At__c,Payment_Date__c,Bank__c,Bank_Currency__c,Bank_Native_Amount__c,Bank_Evidence__c,Trade_FX_Side__c,
        Reference__c,Buyer_Proforma__c,Supplier_Proforma__c,Original_Cash_Event__c,Original_Carrying_USD__c,Original_Bank_Allocation__c,Settlement_FX_USD__c,Operation_Id__c,Request_Fingerprint__c${reviewFields}
        FROM Trade_Cash_Event__c WHERE STEM__c IN (${scope}) ${direction ? `AND Direction__c='${direction}'` : ''} ORDER BY CreatedDate,Id`, { clean: true, limit: 100000 }),
      query(`SELECT Id,Name,CreatedDate,Allocation_Date__c,Cash_Event__c,Buyer_Invoice__c,Supplier_Invoice__c,Payment__c,Currency__c,Kind__c,Reverses_Allocation__c,
        Allocated_HKD__c,Allocated_Cash_USD__c,Invoice_Carrying_USD__c,Bank_Native_Allocation__c,Settlement_FX_USD__c,Operation_Id__c,Request_Fingerprint__c
        FROM Trade_Cash_Allocation__c WHERE Cash_Event__r.STEM__c IN (${scope}) ${direction ? `AND Cash_Event__r.Direction__c='${direction}'` : ''} ORDER BY CreatedDate,Id`, { clean: true, limit: 100000 }),
    ]);
    if (!complete(eventResult) || !complete(allocationResult)) fail('Cash history is incomplete.');
    const eventIds = new Set(eventResult.records.map(row => row.Id));
    const stemKeys = new Set(batch.map((id) => id.slice(0, 15)));
    if (eventIds.size !== eventResult.records.length || eventResult.records.some(row =>
      !row.Id || (typeof row.STEM__c !== 'string' || !stemKeys.has(row.STEM__c.slice(0, 15))) || (direction && row.Direction__c !== direction))
      || allocationResult.records.some(row => !row.Id || !eventIds.has(row.Cash_Event__c))) fail('Cash history scope is incomplete or inconsistent.');
    events.push(...eventResult.records);
    allocations.push(...allocationResult.records);
  }
  if (new Set(events.map(row => row.Id)).size !== events.length
    || new Set(allocations.map(row => row.Id)).size !== allocations.length) fail('Cash history contains duplicate identities.');
  return { events, allocations };
}
