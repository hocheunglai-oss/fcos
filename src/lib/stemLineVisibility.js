// Salesforce's explicit child cancellation flag controls current line display.
// Invoice/payment history and exported records remain separate source evidence.
export function activeStemLineItems(items) {
  return (Array.isArray(items) ? items : []).filter((item) => item != null && item.Cancelled__c !== true);
}

// A stem-level/shared broker header is not itself a cancelled line. Exclude it
// only when the existing projection explicitly links it to a cancelled child.
export function visibleStemBuyerBrokers(brokers, lineItems) {
  const idKey = (id) => typeof id === 'string' ? id.slice(0, 15) : '';
  const cancelledIds = new Set((Array.isArray(lineItems) ? lineItems : [])
    .filter((item) => item?.Cancelled__c === true && idKey(item.Id)).map((item) => idKey(item.Id)));
  return (Array.isArray(brokers) ? brokers : []).filter((broker) => broker != null
    && !cancelledIds.has(idKey(broker.STEM_Line_Item__c || broker.STEM_Line_Item__r?.Id)));
}
