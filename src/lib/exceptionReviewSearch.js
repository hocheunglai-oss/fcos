const normalizeSearchValue = (value) => String(value ?? '').toLowerCase();

export function matchesExceptionReviewSearch(row, search) {
  const query = String(search || '').trim().toLowerCase();
  if (!query) return true;

  const port = row?.['Port__r'] || {};
  const schedule = row?._Exception_Schedule || {};
  return [
    row?.Name,
    row?.KeyStem__c,
    row?.Buyer_Name__c,
    row?.Buyer__c,
    row?.ETA_Start_Date__c,
    row?.ETA_End_Date__c,
    row?.ETB_Start_Date__c,
    row?.ETB_End_Date__c,
    row?.ETA_ETB__c,
    row?.CreatedDate,
    row?.Delivery_Date__c,
    row?._Port_Name,
    row?._Port_Country,
    schedule.type,
    schedule.startDate,
    schedule.endDate,
    schedule.displayLabel,
    port.Name,
    port.Country__c,
  ].some((value) => normalizeSearchValue(value).includes(query));
}
