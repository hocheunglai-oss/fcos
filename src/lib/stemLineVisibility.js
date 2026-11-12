export function activeStemLineItems(items) {
  return Array.isArray(items) ? items.filter(item => item != null && item.Cancelled__c !== true) : [];
}
