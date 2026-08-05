import {
  exceptionScheduleDaysSinceEnd,
  isExceptionPotentialDelay,
  normalizeExceptionSchedule,
} from './exceptionReviewSchedule.js';

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function classifyExceptionReviewStem(row, { today = new Date() } = {}) {
  const buyer = finiteNumber(row?.Total_Invoice_Amount__c);
  const supplier = finiteNumber(row?.Total_Invoiced_Amount_From_Suppliers__c);
  const buyerBroker = finiteNumber(row?.__buyerCommCalc) || 0;
  const supplierBroker = finiteNumber(row?.__suppCommPerUnitCalc) || 0;
  const authoritativeProfit = finiteNumber(row?.__netPnlCalc) ?? finiteNumber(row?.QLIK_Total_Profit__c);
  const grossProfit = authoritativeProfit ?? (
    buyer != null && supplier != null
      ? buyer - supplier - buyerBroker - supplierBroker
      : null
  );
  const reasons = [];
  const exceptionSchedule = row?._Exception_Schedule || normalizeExceptionSchedule(row);

  if (isExceptionPotentialDelay({ ...row, _Exception_Schedule: exceptionSchedule }, today)) {
    reasons.push({ key: 'potential-delay', label: 'Potential Delay', severity: 'high' });
  }
  if (buyer == null || buyer === 0) {
    reasons.push({ key: 'missing-buyer', label: 'Missing buyer invoice', severity: 'high' });
  }
  if (supplier == null || supplier === 0) {
    reasons.push({ key: 'missing-supplier', label: 'Missing supplier invoice', severity: 'high' });
  }
  if (grossProfit != null && grossProfit < 0) {
    reasons.push({ key: 'negative-gross', label: 'Negative gross profit', severity: 'high' });
  }

  return {
    ...row,
    reviewReasons: reasons,
    reviewSeverity: reasons.some((reason) => reason.severity === 'high') ? 'high' : reasons.length ? 'medium' : 'clear',
    grossProfit,
    _Exception_Schedule: exceptionSchedule,
    scheduleDelayDays: exceptionScheduleDaysSinceEnd(exceptionSchedule, today),
    effectiveDate: row?.Delivery_Date__c || exceptionSchedule.endDate,
    usesScheduleDate: !row?.Delivery_Date__c,
  };
}
