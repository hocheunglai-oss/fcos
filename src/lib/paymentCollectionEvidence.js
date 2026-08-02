function dateToken(value) {
  if (!value) return null;
  const direct = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) return direct[1];
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export function earliestEtaDate(etaStartDate, etaEndDate) {
  const dates = [dateToken(etaStartDate), dateToken(etaEndDate)].filter(Boolean).sort();
  return dates[0] || null;
}

export function ciaComparisonBoundary({ etaStartDate, etaEndDate, deliveryDate } = {}) {
  const earliestEta = earliestEtaDate(etaStartDate, etaEndDate);
  const actualDelivery = dateToken(deliveryDate);
  const qualifyingDates = [earliestEta, actualDelivery].filter(Boolean).sort();
  return {
    earliestEtaDate: earliestEta,
    actualDeliveryDate: actualDelivery,
    // "On or before ETA or delivery" is equivalent to using the later available boundary.
    ciaBoundaryDate: qualifyingDates.at(-1) || null,
  };
}

export function classifyBuyerPaymentEvidence({
  paymentDate,
  etaStartDate,
  etaEndDate,
  deliveryDate,
  isFull = false,
} = {}) {
  const receivedDate = dateToken(paymentDate);
  const boundary = ciaComparisonBoundary({ etaStartDate, etaEndDate, deliveryDate });
  const isCia = Boolean(receivedDate && boundary.ciaBoundaryDate && receivedDate <= boundary.ciaBoundaryDate);
  const paymentKind = isFull ? 'full' : 'partial';

  return {
    code: `${paymentKind}_${isCia ? 'cia' : 'payment'}`,
    label: `${isFull ? 'Full' : 'Partial'} ${isCia ? 'CIA' : 'Payment'}`,
    receivedDate,
    ...boundary,
    isCia,
    paymentKind,
  };
}

export function summarizeBuyerPaymentEvidence({
  payments = [],
  etaStartDate,
  etaEndDate,
  deliveryDate,
  isFullyPaid = false,
} = {}) {
  const orderedPayments = [...payments]
    .filter((payment) => Number(payment?.amount) > 0 && dateToken(payment?.paymentDate))
    .sort((left, right) => (
      String(dateToken(left.paymentDate)).localeCompare(String(dateToken(right.paymentDate)))
      || String(left.paymentId || '').localeCompare(String(right.paymentId || ''))
    ));

  const classifiedPayments = orderedPayments.map((payment, index) => {
    const evidence = classifyBuyerPaymentEvidence({
      paymentDate: payment.paymentDate,
      etaStartDate,
      etaEndDate,
      deliveryDate,
      isFull: isFullyPaid && index === orderedPayments.length - 1,
    });
    return { ...payment, evidence };
  });

  const totals = classifiedPayments.reduce((result, payment) => {
    const amount = Number(payment.amount || 0);
    result.totalReceivedAmount += amount;
    if (payment.evidence.isCia) {
      result.ciaReceivedAmount += amount;
      result.ciaPaymentCount += 1;
    } else {
      result.otherReceivedAmount += amount;
      result.otherPaymentCount += 1;
    }
    return result;
  }, {
    totalReceivedAmount: 0,
    ciaReceivedAmount: 0,
    otherReceivedAmount: 0,
    ciaPaymentCount: 0,
    otherPaymentCount: 0,
  });

  const latest = classifiedPayments.at(-1) || null;
  return {
    ...totals,
    paymentCount: classifiedPayments.length,
    payments: classifiedPayments,
    latestPayment: latest ? Object.fromEntries(Object.entries(latest).filter(([key]) => key !== 'evidence')) : null,
    latestEvidence: latest?.evidence || null,
    ...ciaComparisonBoundary({ etaStartDate, etaEndDate, deliveryDate }),
  };
}
