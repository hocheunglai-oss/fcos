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

export function classifyBuyerPaymentEvidence({
  paymentDate,
  etaStartDate,
  etaEndDate,
  isPartial = false,
} = {}) {
  const receivedDate = dateToken(paymentDate);
  const earliestEta = earliestEtaDate(etaStartDate, etaEndDate);
  const isPartialCia = Boolean(isPartial && receivedDate && earliestEta && receivedDate < earliestEta);

  return {
    code: isPartial ? (isPartialCia ? 'partial_cia' : 'partial_payment') : 'buyer_payment',
    label: isPartial ? (isPartialCia ? 'Partial CIA' : 'Partial Payment') : 'Buyer payment',
    receivedDate,
    earliestEtaDate: earliestEta,
    receivedBeforeEarliestEta: isPartialCia,
  };
}
