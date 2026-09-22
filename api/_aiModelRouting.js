import { DASHBOARD_AI_MODELS } from '../shared/aiModelCatalog.js';

export const AUTO_AI_MODEL = 'auto';
export const AI_ROUTING_VERSION = '2026-09-23.1';
const models = new Map(DASHBOARD_AI_MODELS.map((model) => [model.id, model]));
const LUNA = 'gpt-5.6-luna';
const SOL = 'gpt-5.6-sol';
const ASTRA = 'gpt-6-astra';

export const AI_MODEL_SELECTIONS = Object.freeze([
  { id: AUTO_AI_MODEL, label: 'Automatic by task', automatic: true, recommended: true,
    description: 'FCOS chooses the model and reasoning effort for each task. Complex financial and contractual work uses the strongest route.' },
  ...DASHBOARD_AI_MODELS,
]);

const tasks = Object.freeze({
  dashboard_search: { label: 'Dashboard search', modelId: SOL, effort: 'low', reason: 'Validated record-search interpretation' },
  email_classification: { label: 'Email category classification', modelId: LUNA, effort: 'low', reason: 'Bounded classification into approved categories' },
  email_routing: { label: 'Email routing recommendations', modelId: SOL, effort: 'medium', reason: 'Recipient and filing recommendations require judgment' },
  market_image: { label: 'Market image extraction', modelId: SOL, effort: 'medium', reason: 'Exact prices, units, and dates require careful extraction' },
  market_report: { label: 'Market report analysis', modelId: SOL, effort: 'medium', reason: 'Evidence-backed analysis of selected series' },
  market_commentary: { label: 'Market commentary', modelId: SOL, effort: 'medium', reason: 'Source-grounded market drivers and risks' },
  hedge_analysis: { label: 'Trading and exposure analysis', modelId: ASTRA, effort: 'high', reason: 'Financial exposure analysis requires the strongest route' },
  clause_drafting: { label: 'Special Terms drafting', modelId: ASTRA, effort: 'high', reason: 'Contractual qualifiers require the strongest route' },
});

export function isAllowedAiSelection(value) {
  return value === AUTO_AI_MODEL || models.has(value);
}

// Preserve the original market environment alias while keeping request and
// saved-setting validation restricted to the published selection catalog.
export function configuredAiSelection(value) {
  const selection = String(value || AUTO_AI_MODEL).trim();
  return selection === 'gpt-5-mini' ? 'gpt-5-mini-2025-08-07' : selection;
}

// Only server-owned tasks and bounded request features choose a route. A prompt
// cannot name a model, weaken permissions, or change the allowed tools.
export function resolveAiModel({ task, selection = AUTO_AI_MODEL, prompt = '', contextCount = 0, clarification = '' } = {}) {
  const policy = tasks[task];
  if (!policy) throw Object.assign(new Error('Unknown AI task.'), { statusCode: 400, code: 'AI_TASK_INVALID' });
  if (!isAllowedAiSelection(selection)) throw Object.assign(new Error('The configured AI model is not supported.'), { statusCode: 503, code: 'AI_MODEL_INVALID' });
  let { modelId, effort: reasoningEffort, reason } = policy;
  const text = String(prompt).slice(0, 12000);
  if (task === 'dashboard_search') {
    // Be conservative: only short, positive, single-field English lookups use
    // the light route. Ambiguous, non-English, numeric, and compound requests
    // retain Sol, regardless of prompt instructions to use a cheaper model.
    const simple = !clarification && text.length <= 100 && /^(show|find|list)\s+(?:all\s+)?stems?\s+(?:for buyer|for vessel|at port|in country)\s+[a-z][a-z .'-]{1,50}$/i.test(text)
      && !/\b(and|or|not|except|exclude|before|after|between|above|below|without)\b/i.test(text);
    if (simple) { modelId = LUNA; reasoningEffort = 'low'; reason = 'Simple single-field record lookup'; }
    else { reasoningEffort = 'medium'; reason = 'Multi-condition or ambiguous record-search interpretation'; }
  }
  if ((task === 'market_report' && (contextCount > 2 || text.length > 600 || /\b(risk|hedg\w*|scenario|forecast|sensitivity|correlat\w*|why)\b|風險|风险|預測|预测|為何|为何/i.test(text)))
    || (task === 'market_commentary' && contextCount > 12)) {
    modelId = ASTRA; reasoningEffort = 'high'; reason = 'Complex analysis across market evidence';
  }
  if (selection !== AUTO_AI_MODEL) {
    modelId = selection;
    reason = 'Manual model override';
  }
  if (modelId.startsWith('gpt-4')) reasoningEffort = null;
  return Object.freeze({ task, taskLabel: policy.label, mode: selection === AUTO_AI_MODEL ? 'automatic' : 'manual',
    selection, modelId, modelLabel: models.get(modelId).label, reasoningEffort, reason, policyVersion: AI_ROUTING_VERSION });
}

export function aiRequestOptions(route, outputTokens = 1500) {
  // Reasoning consumes the same output budget as the visible answer.
  const reserve = route.reasoningEffort === 'high' ? 8000 : route.reasoningEffort === 'medium' ? 4000 : route.reasoningEffort ? 2000 : 0;
  return { ...(route.reasoningEffort ? { reasoning: { effort: route.reasoningEffort } } : {}), max_output_tokens: outputTokens + reserve };
}

export function automaticRoutingFor(...taskNames) {
  return {
    summary: 'Automatic selection uses the task and its complexity. Usage is recorded against the model that actually runs.',
    routes: taskNames.flatMap((task) => {
      const route = resolveAiModel({ task });
      if (task === 'dashboard_search') return [
        { label: 'Simple buyer, vessel, port or country lookup', modelLabel: models.get(LUNA).label, reasoningEffort: 'low' },
        { label: 'Compound, numeric or ambiguous search', modelLabel: models.get(SOL).label, reasoningEffort: 'medium' },
      ];
      return [{ label: route.taskLabel, modelLabel: route.modelLabel, reasoningEffort: route.reasoningEffort }];
    }),
  };
}
