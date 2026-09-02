const TOP_LEVEL_MARKER = /^\s*(?:\d+[.)]|[-\u2013\u2014\u2022])\s+/;
const MATERIAL_TOKEN = /(?:\b(?:usd|eur|hkd|sgd|cny|jpy|gbp)\b|[$€£]|\b\d+(?:[.,]\d+)*(?:\s*(?:calendar|business|working))?\s*(?:days?|hours?|months?|years?|mt|pmt|%)?\b|\b(?:marpol|iso|bimco|china|russia|hong kong|singapore|england|usa|uae)\b)/gi;

export const CLAUSE_BANK_VIEWS = Object.freeze([
  { value: 'work', label: 'Work Queue' },
  { value: 'Active', label: 'Approved Library' },
  { value: 'Retired', label: 'Retired' },
]);

export const CLAUSE_ACTIONS = Object.freeze([
  { value: 'all', label: 'All actions' },
  { value: 'needs_review', label: 'Needs wording review' },
  { value: 'ready_approval', label: 'Ready for approval' },
  { value: 'blocked_assignment', label: 'Blocked by assignment' },
  { value: 'relink_required', label: 'Relink required' },
  { value: 'ready_retire', label: 'Ready to retire' },
]);

export function clauseAction(clause) {
  if (clause?.consolidation?.status === 'Ready to Retire') return 'ready_retire';
  if (clause?.consolidation) return 'relink_required';
  if (clause?.status === 'Draft' && Number(clause?.usageCount || 0) > 0) return 'blocked_assignment';
  if (clause?.draftVersion && (clause.draftVersion.draftSource === 'Legacy Migration' || String(clause?.origin || '').toLowerCase() === 'legacy')) return 'needs_review';
  if (clause?.draftVersion) return 'ready_approval';
  return null;
}

export function clauseActionDetails(clause) {
  const action = clauseAction(clause);
  if (action === 'ready_retire') return { action, label: 'Ready to retire', tone: 'success', reason: 'No unresolved live use remains. A GM or Administrator must complete final retirement after live revalidation.' };
  if (action === 'relink_required') return { action, label: 'Relink required', tone: 'warning', reason: `Affected Special Terms must be relinked to ${clause?.consolidation?.replacementShortName || 'the reviewed replacement'} through approved whole-term revisions.` };
  if (action === 'blocked_assignment') return { action, label: 'Blocked by assignment', tone: 'danger', reason: 'This never-approved clause is referenced by a proposed assignment. Review or remove that term revision before deletion.' };
  if (action === 'needs_review') return { action, label: 'Needs wording review', tone: 'warning', reason: 'Legacy wording and the proposed professional wording require an authorized wording decision.' };
  if (action === 'ready_approval') return { action, label: 'Ready for approval', tone: 'info', reason: 'The Draft version is ready for a General Manager or Administrator decision.' };
  if (clause?.status === 'Active') return { action: null, label: 'Approved library', tone: 'success', reason: 'Available for governed Special Term composition.' };
  if (clause?.status === 'Retired') return { action: null, label: 'Retired history', tone: 'neutral', reason: 'Unavailable for new use; historical assignments remain permanent.' };
  return { action: null, label: clause?.status || 'Unknown', tone: 'neutral', reason: 'Refresh the authoritative Salesforce state before taking action.' };
}

export function clauseMatchesView(clause, view, action = 'all') {
  const matches = view === 'work' ? Boolean(clauseAction(clause)) : clause?.status === view;
  return matches && (action === 'all' || clauseAction(clause) === action);
}

export function clauseDraftQuality({ shortName = '', clauseText = '', revisionReason = '' } = {}) {
  const issues = [];
  const words = String(shortName).trim().split(/\s+/).filter(Boolean);
  const text = String(clauseText).trim();
  if (words.length < 3 || words.length > 7) issues.push({ id: 'short-name', severity: 'error', label: 'Use a short name containing 3–7 words.' });
  if (TOP_LEVEL_MARKER.test(text)) issues.push({ id: 'marker', severity: 'error', label: 'Remove the top-level number or bullet; FCOS generates it.' });
  if (!/\bshall\b/i.test(text) && /\b(?:must|will|agrees? to|required to)\b/i.test(text)) issues.push({ id: 'style', severity: 'warning', label: 'Consider the unified “shall” style for a contractual obligation.' });
  if (!/\b(?:buyer|supplier|seller|fcos|party|parties|owner|charterer|agent)\b/i.test(text)) issues.push({ id: 'party', severity: 'warning', label: 'Confirm that the responsible contractual party is unambiguous.' });
  if (text.length > 900) issues.push({ id: 'length', severity: 'warning', label: 'This clause is long; confirm that it cannot be split without changing meaning.' });
  if (/\b(?:asap|promptly|reasonable time|etc\.)\b/i.test(text)) issues.push({ id: 'ambiguity', severity: 'warning', label: 'Review potentially ambiguous timing or scope language.' });
  if (String(revisionReason).trim().length < 3) issues.push({ id: 'reason', severity: 'error', label: 'Record a concise revision reason.' });
  if (!issues.length) return [{ id: 'ready', severity: 'success', label: 'Draft passes the automated structure and style checks.' }];
  return issues;
}

export function materialHighlights(value) {
  const source = String(value || '');
  const matches = [];
  for (const match of source.matchAll(MATERIAL_TOKEN)) matches.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
  return matches;
}

export function specialTermReadiness(term, ruleCount = 0) {
  const projections = [
    { key: 'termsText', label: 'Terms Text', status: term?.clauseStructureStatus || 'Legacy', active: Number(term?.activeClauseCount || 0), proposed: Number(term?.proposedClauseCount || 0), upgrades: Number(term?.upgradeCount || 0) },
    { key: 'confirmation', label: 'Confirmation', status: term?.confirmationClauseStatus || 'Legacy', active: Number(term?.confirmationActiveClauseCount || 0), proposed: Number(term?.confirmationProposedClauseCount || 0), upgrades: Number(term?.confirmationUpgradeCount || 0) },
    { key: 'nomination', label: 'Nomination', status: term?.nominationClauseStatus || 'Legacy', active: Number(term?.nominationActiveClauseCount || 0), proposed: Number(term?.nominationProposedClauseCount || 0), upgrades: Number(term?.nominationUpgradeCount || 0) },
  ];
  const relinks = Number(term?.relinkRequiredCount || 0);
  const revisionStatus = term?.revisionStatus || (projections.every((projection) => projection.status === 'Active') ? 'Approved' : 'Legacy');
  let state = 'ready';
  let label = 'Approved and ready';
  let reason = 'All contractual projections are active under one approved whole-term revision.';
  if (relinks) {
    state = 'relink'; label = 'Relink required'; reason = `${relinks} clause ${relinks === 1 ? 'reference requires' : 'references require'} a governed replacement.`;
  } else if (['In Review', 'Ready for Approval'].includes(revisionStatus)) {
    state = 'approval'; label = 'Ready for approval'; reason = 'The complete revision is waiting for an authorized approval decision.';
  } else if (['Draft', 'Changes Requested'].includes(revisionStatus) || projections.some((projection) => projection.proposed > 0)) {
    state = 'draft'; label = 'Draft in progress'; reason = 'Complete and submit all three projections and the rule snapshot together.';
  } else if (revisionStatus === 'Legacy' || projections.some((projection) => projection.status === 'Legacy')) {
    state = 'legacy'; label = 'Migration required'; reason = 'Live legacy wording remains effective until a complete structured revision is approved.';
  } else if (revisionStatus === 'Retired') {
    state = 'retired'; label = 'Retired'; reason = 'Historical wording is retained and unavailable for new use.';
  }
  return { state, label, reason, revisionStatus, projections, ruleCount, relinks };
}

export function exportReadiness(term) {
  const readiness = specialTermReadiness(term);
  if (readiness.state === 'ready') return { state: 'verified', label: 'Structured document ready', reason: 'The export service revalidates assignment compilation against live Salesforce Terms Text.' };
  if (readiness.state === 'legacy') return { state: 'legacy', label: 'Legacy exact-text export', reason: 'The exact live Salesforce wording is exported without silent restructuring.' };
  return { state: 'review', label: 'Live export revalidated on download', reason: 'Draft or relink work does not alter the live document. Export fails closed if Salesforce compilation is inconsistent.' };
}

export function loadClauseBankPreferences(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem('fcos-special-terms-clause-bank-v2') || '{}');
    return {
      view: ['work', 'Active', 'Retired'].includes(parsed.view) ? parsed.view : 'work',
      action: CLAUSE_ACTIONS.some((option) => option.value === parsed.action) ? parsed.action : 'all',
      category: String(parsed.category || 'all'),
      origin: ['all', 'Legacy', 'Manual', 'AI Assisted'].includes(parsed.origin) ? parsed.origin : 'all',
      usage: ['all', 'used', 'unused'].includes(parsed.usage) ? parsed.usage : 'all',
      mine: parsed.mine === true,
      duplicatesOnly: parsed.duplicatesOnly === true,
    };
  } catch {
    return { view: 'work', action: 'all', category: 'all', origin: 'all', usage: 'all', mine: false, duplicatesOnly: false };
  }
}

export function saveClauseBankPreferences(value, storage = globalThis.localStorage) {
  try { storage?.setItem('fcos-special-terms-clause-bank-v2', JSON.stringify(value)); } catch { /* Browser storage is optional. */ }
}
