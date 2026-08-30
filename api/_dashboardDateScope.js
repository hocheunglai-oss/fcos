import { normalizeExceptionReviewDateWindows } from '../src/lib/exceptionReviewSchedule.js';

export function buildDashboardDateScopeWhere(dateWindows, availableFields = []) {
  const fields = new Set(availableFields || []);
  if (!fields.has('Delivery_Date__c')) {
    throw new Error('Dashboard date filtering is unavailable because Salesforce Delivery Date metadata could not be validated.');
  }

  const windows = normalizeExceptionReviewDateWindows(dateWindows);
  const expectedDeliveryAvailable = fields.has('Expected_Delivery_Date__c');
  return windows
    .map(({ startDate, endDate }) => {
      const delivered = `(Delivery_Date__c >= ${startDate} AND Delivery_Date__c <= ${endDate})`;
      if (!expectedDeliveryAvailable) return delivered;
      const expected = `(Delivery_Date__c = null AND Expected_Delivery_Date__c >= ${startDate} AND Expected_Delivery_Date__c <= ${endDate})`;
      return `(${delivered} OR ${expected})`;
    })
    .join(' OR ');
}
