export const DEFAULT_DASHBOARD_AI_MODEL = 'gpt-5-mini-2025-08-07';
export const DASHBOARD_AI_PRICING_AS_OF = '2026-09-23';
export const DASHBOARD_AI_PRICING_SOURCE = 'https://developers.openai.com/api/docs/pricing';

function pricing(inputPerMillion, cachedInputPerMillion, outputPerMillion, cacheWritePerMillion = null) {
  return Object.freeze({
    currency: 'USD',
    unitTokens: 1_000_000,
    serviceTier: 'standard',
    context: 'short',
    inputPerMillion,
    cachedInputPerMillion,
    cacheWritePerMillion,
    outputPerMillion,
    asOf: DASHBOARD_AI_PRICING_AS_OF,
    sourceUrl: DASHBOARD_AI_PRICING_SOURCE,
  });
}

export const DASHBOARD_AI_MODELS = Object.freeze([
  {
    id: 'gpt-4o-mini-2024-07-18',
    label: 'GPT-4o mini',
    description: 'Lowest cost. Suitable for straightforward searches.',
    costTier: 'Lowest',
    pricing: pricing(0.15, 0.075, 0.60),
  },
  {
    id: DEFAULT_DASHBOARD_AI_MODEL,
    label: 'GPT-5 mini',
    description: 'Previous-generation model for existing manual selections.',
    costTier: 'Low',
    pricing: pricing(0.25, 0.025, 2.00),
  },
  {
    id: 'gpt-5.6-luna',
    label: 'GPT-5.6 Luna',
    description: 'Bounded lookups and classification.',
    costTier: 'Low',
    pricing: pricing(0.20, 0.02, 1.20, 0.25),
  },
  {
    id: 'gpt-5.6-terra',
    label: 'GPT-5.6 Terra',
    description: 'Higher accuracy for difficult multi-condition searches.',
    costTier: 'High',
    pricing: pricing(2.00, 0.20, 12.00, 2.50),
  },
  {
    id: 'gpt-5.6-sol',
    label: 'GPT-5.6 Sol',
    description: 'Detailed analysis, multi-condition searches, and reviewed recommendations.',
    costTier: 'High',
    pricing: pricing(4.00, 0.40, 20.00, 5.00),
  },
  {
    id: 'gpt-6-astra',
    label: 'GPT-6 Astra',
    description: 'Complex financial analysis and contractual drafting.',
    costTier: 'Highest',
    pricing: pricing(10.00, 1.00, 50.00, 12.50),
  },
]);
