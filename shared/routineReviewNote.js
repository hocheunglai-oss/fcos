export const ROUTINE_COST_NOTE = 'Reviewed current supplier costs without changes.';
export const ROUTINE_BUYER_NOTE = 'Reviewed current buyer charges without changes.';

export function routineReviewNote(body, side, sourceIds) {
  if (!sourceIds?.length || ['extraCostUpdates', 'extraCostAdds', 'cancellations'].some((key) => (body?.[key] || []).length)) return '';
  const choices = side === 'cost' ? body?.rowOutcomes : body?.rowChargeDecisions;
  if (!Array.isArray(choices) || choices.length !== sourceIds.length) return '';
  const byId = new Map(choices.map((row) => [row.sourceId || row.id, side === 'cost' ? row.outcome : row.decision || row.buyerChargeDecision]));
  if (!sourceIds.every((id) => byId.get(id) === (side === 'cost' ? 'correct' : 'include'))) return '';
  return side === 'cost' ? ROUTINE_COST_NOTE : ROUTINE_BUYER_NOTE;
}
