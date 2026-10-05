// A successful leg save retires only that leg's edits. Other suppliers and
// the unsubmitted buyer/cost leg survive the authoritative refresh.
export function acknowledgeVariableChargeSide(value, rows, supplierId, sides) {
  const cost = sides.includes('cost');
  const buyer = sides.includes('buyer_charge');
  for (const row of rows) {
    const review = value.reviews?.[row.key];
    if (review) {
      if (cost) delete review.outcome;
      if (buyer) delete review.buyerChargeDecision;
      if (cost && buyer) delete value.reviews[row.key];
    }
    const extra = value.extraDrafts?.[row.sourceId];
    if (extra) {
      if (cost) for (const field of Object.keys(extra)) {
        if (!['buyerPrice', 'statutoryBuyerDefaultPending'].includes(field)) delete extra[field];
      }
      if (buyer) { delete extra.buyerPrice; delete extra.statutoryBuyerDefaultPending; }
    }
  }
  if (cost) {
    delete value.supplierReviewNotes?.[supplierId];
    value.addDrafts = (value.addDrafts || []).filter((item) => item.supplierAccountId !== supplierId);
  }
  if (buyer) delete value.buyerReviewNotes?.[supplierId];
  return value;
}
