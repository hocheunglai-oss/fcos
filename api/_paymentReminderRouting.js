function uniqueValues(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = String(value || '').trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function uniqueEmails(...values) {
  return uniqueValues(values.flat(Infinity).flatMap((value) => (
    typeof value === 'string' ? value.split(/[,\n;]/) : []
  )));
}

function salesforceIdKey(value) {
  const text = String(value || '').trim();
  return text ? text.slice(0, 15) : '';
}

export function paymentReminderBusinessGroupIdentity(row = {}, routing = {}) {
  const stemId = String(row.stemId || row.id || '').trim();
  const buyerAccountId = salesforceIdKey(row.buyerAccountId);
  const brokerAccountIds = uniqueValues((row.buyerBrokerDetails || [])
    .map((detail) => salesforceIdKey(detail?.brokerId || detail?.id)))
    .sort();
  const hasUnresolvedBroker = !brokerAccountIds.length && Boolean(String(row.buyerBrokerNames || '').trim());

  return {
    buyerAccountId: buyerAccountId || `unresolved:${stemId}`,
    buyerBrokerAccountIds: hasUnresolvedBroker ? [`unresolved:${stemId}`] : brokerAccountIds,
    mode: routing.mode || row.buyerBrokerRoutingMode || 'buyer_only',
  };
}

export function paymentReminderBusinessGroupKey(row = {}, routing = {}) {
  return JSON.stringify(paymentReminderBusinessGroupIdentity(row, routing));
}

export function groupPaymentReminderRows(rows = [], routeForRow) {
  const groups = new Map();
  for (const row of rows) {
    const routing = routeForRow(row);
    const key = paymentReminderBusinessGroupKey(row, routing);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        mode: routing.mode,
        to: [],
        cc: [],
        bcc: [],
        primaryRecipientName: routing.primaryRecipientName,
        warnings: [],
        rows: [],
      });
    }
    const group = groups.get(key);
    group.to = uniqueEmails(group.to, routing.to || []);
    group.cc = uniqueEmails(group.cc, routing.cc || []);
    group.bcc = uniqueEmails(group.bcc, routing.bcc || []);
    group.rows.push(row);
    group.warnings.push(...(routing.warnings || []));
  }

  return [...groups.values()].map((group) => ({
    ...group,
    warnings: uniqueValues(group.warnings),
  }));
}
