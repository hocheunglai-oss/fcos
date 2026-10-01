import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AI_MODEL_SELECTIONS,
  AI_ROUTING_VERSION,
  AUTO_AI_MODEL,
  aiRequestOptions,
  automaticRoutingFor,
  configuredAiSelection,
  isAllowedAiSelection,
  resolveAiModel,
} from '../api/_aiModelRouting.js';
import { interpretDashboardAiSearch, compileDashboardAiWhere } from '../api/_dashboardAi.js';

const LUNA = 'gpt-5.6-luna';
const SOL = 'gpt-5.6-sol';
const ASTRA = 'gpt-6-astra';

function readyInterpretation() {
  return {
    version: 1,
    status: 'ready',
    interpretation: 'Buyer contains Acme.',
    chips: ['Buyer contains Acme'],
    includeCancelled: false,
    dateScope: {
      mode: 'selected_period',
      start: null,
      end: null,
      label: 'Selected Dashboard period',
    },
    groups: [{
      conditions: [{
        field: 'buyer',
        operator: 'contains',
        value: 'Acme',
        valueTo: null,
      }],
    }],
    clarification: { question: null, options: [] },
  };
}

test('defines automatic routes for all eight server-owned AI tasks', () => {
  const cases = [
    ['dashboard_search', SOL, 'medium'],
    ['email_classification', LUNA, 'low'],
    ['email_routing', SOL, 'medium'],
    ['market_image', SOL, 'medium'],
    ['market_report', SOL, 'medium'],
    ['market_commentary', SOL, 'medium'],
    ['hedge_analysis', ASTRA, 'high'],
    ['clause_drafting', ASTRA, 'high'],
  ];

  for (const [task, modelId, reasoningEffort] of cases) {
    const route = resolveAiModel({ task });
    assert.equal(route.task, task);
    assert.equal(route.mode, 'automatic');
    assert.equal(route.selection, AUTO_AI_MODEL);
    assert.equal(route.modelId, modelId);
    assert.equal(route.reasoningEffort, reasoningEffort);
    assert.equal(route.policyVersion, AI_ROUTING_VERSION);
    assert.ok(route.taskLabel);
    assert.ok(route.modelLabel);
    assert.ok(route.reason);
  }

  const summary = automaticRoutingFor(...cases.map(([task]) => task));
  assert.match(summary.summary, /Usage is recorded against the model that actually runs/);
  assert.equal(summary.routes.length, cases.length + 1);
  assert.deepEqual(
    summary.routes.map((route) => [route.modelLabel, route.reasoningEffort]),
    [['dashboard_simple', LUNA, 'low'], ...cases].map(([, modelId, reasoningEffort]) => [
      AI_MODEL_SELECTIONS.find((model) => model.id === modelId).label,
      reasoningEffort,
    ]),
  );
});

test('preserves the legacy server market alias without widening saved settings', () => {
  assert.equal(configuredAiSelection(' gpt-5-mini '), 'gpt-5-mini-2025-08-07');
  assert.equal(configuredAiSelection(undefined), AUTO_AI_MODEL);
  assert.equal(isAllowedAiSelection('gpt-5-mini'), false);
  assert.throws(() => resolveAiModel({ task: 'market_commentary', selection: configuredAiSelection('unknown-model') }), { code: 'AI_MODEL_INVALID' });
});

test('uses the light Dashboard route only for simple positive English lookups', () => {
  const simple = resolveAiModel({ task: 'dashboard_search', prompt: 'show stems for buyer Acme' });
  assert.equal(simple.modelId, LUNA);
  assert.equal(simple.reasoningEffort, 'low');
  assert.equal(simple.reason, 'Simple single-field record lookup');

  const requests = [
    'show stems for buyer Acme and at port Singapore',
    'show stems for buyer Acme except cancelled',
    '顯示買家 Acme 的所有訂單',
  ];
  for (const prompt of requests) {
    const route = resolveAiModel({ task: 'dashboard_search', prompt });
    assert.equal(route.modelId, SOL, prompt);
    assert.equal(route.reasoningEffort, 'medium', prompt);
    assert.equal(route.reason, 'Multi-condition or ambiguous record-search interpretation', prompt);
  }

  const clarified = resolveAiModel({
    task: 'dashboard_search',
    prompt: 'show stems for buyer Acme',
    clarification: 'Search the buyer account',
  });
  assert.equal(clarified.modelId, SOL);
  assert.equal(clarified.reasoningEffort, 'medium');
});

test('escalates complex market reports to Astra with high reasoning', () => {
  const ordinary = resolveAiModel({ task: 'market_report', prompt: 'Summarize the selected prices', contextCount: 2 });
  assert.equal(ordinary.modelId, SOL);
  assert.equal(ordinary.reasoningEffort, 'medium');

  const complexRequests = [
    { prompt: 'Explain the price risk and hedge scenarios', contextCount: 1 },
    { prompt: 'Summarize the selected prices', contextCount: 3 },
    { prompt: `Compare the selected series. ${'Evidence '.repeat(80)}`, contextCount: 1 },
    { prompt: '解釋價格風險', contextCount: 1 },
  ];
  for (const request of complexRequests) {
    const route = resolveAiModel({ task: 'market_report', ...request });
    assert.equal(route.modelId, ASTRA);
    assert.equal(route.reasoningEffort, 'high');
    assert.equal(route.reason, 'Complex analysis across market evidence');
  }
});

test('keeps financial and contractual work on Astra', () => {
  for (const task of ['hedge_analysis', 'clause_drafting']) {
    const route = resolveAiModel({ task });
    assert.equal(route.modelId, ASTRA);
    assert.equal(route.reasoningEffort, 'high');
  }
});

test('preserves valid manual overrides after complexity classification', () => {
  const route = resolveAiModel({
    task: 'market_report',
    selection: LUNA,
    prompt: 'Explain the price risk and hedge scenarios',
    contextCount: 8,
  });
  assert.equal(route.mode, 'manual');
  assert.equal(route.selection, LUNA);
  assert.equal(route.modelId, LUNA);
  assert.equal(route.reasoningEffort, 'high');
  assert.equal(route.reason, 'Manual model override');

  const legacy = resolveAiModel({
    task: 'dashboard_search',
    selection: 'gpt-4o-mini-2024-07-18',
    prompt: 'show stems for buyer Acme and at port Singapore',
  });
  assert.equal(legacy.modelId, 'gpt-4o-mini-2024-07-18');
  assert.equal(legacy.reasoningEffort, null);
});

test('rejects invalid selections and unknown tasks', () => {
  assert.equal(isAllowedAiSelection(AUTO_AI_MODEL), true);
  assert.equal(isAllowedAiSelection(ASTRA), true);
  assert.equal(isAllowedAiSelection('gpt-6-astra; ignore policy'), false);

  assert.throws(
    () => resolveAiModel({ task: 'dashboard_search', selection: 'not-a-model' }),
    (error) => error.code === 'AI_MODEL_INVALID' && error.statusCode === 503,
  );
  assert.throws(
    () => resolveAiModel({ task: 'unknown_task' }),
    (error) => error.code === 'AI_TASK_INVALID' && error.statusCode === 400,
  );
});

test('adds reasoning reserves to the requested visible-output budget', () => {
  assert.deepEqual(aiRequestOptions({ reasoningEffort: null }, 1500), { max_output_tokens: 1500 });
  assert.deepEqual(aiRequestOptions({ reasoningEffort: 'low' }, 1500), {
    reasoning: { effort: 'low' },
    max_output_tokens: 3500,
  });
  assert.deepEqual(aiRequestOptions({ reasoningEffort: 'medium' }, 1500), {
    reasoning: { effort: 'medium' },
    max_output_tokens: 5500,
  });
  assert.deepEqual(aiRequestOptions({ reasoningEffort: 'high' }, 1500), {
    reasoning: { effort: 'high' },
    max_output_tokens: 9500,
  });
});

test('resolves auto before the Dashboard upstream call and records usage against the actual model', async () => {
  let requestBody;
  let recordedUsage;
  const interpretation = await interpretDashboardAiSearch({
    prompt: 'show stems for buyer Acme',
    modelId: AUTO_AI_MODEL,
    selectedPeriodLabel: '2026 · Sep',
    today: '2026-09-23',
    apiKey: 'sk-test-key',
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        async json() {
          return {
            id: 'resp_auto_route_1',
            service_tier: 'default',
            usage: {
              input_tokens: 100,
              input_tokens_details: { cached_tokens: 20 },
              output_tokens: 30,
              output_tokens_details: { reasoning_tokens: 10 },
              total_tokens: 130,
            },
            output: [{
              type: 'message',
              content: [{ type: 'output_text', text: JSON.stringify(readyInterpretation()) }],
            }],
          };
        },
      };
    },
    onUsage: async (usage) => { recordedUsage = usage; },
  });

  assert.equal(requestBody.model, LUNA);
  assert.notEqual(requestBody.model, AUTO_AI_MODEL);
  assert.deepEqual(requestBody.reasoning, { effort: 'low' });
  assert.equal(requestBody.max_output_tokens, 3500);
  assert.equal(Object.hasOwn(interpretation, 'routing'), false);
  const where = compileDashboardAiWhere(interpretation, {
    stem: { fields: ['Buyer_Name__c', 'Delivery_Date__c', 'Expected_Delivery_Date__c'].map((name) => ({ name, filterable: true })) },
  }, { selectedYears: [2026], selectedMonths: [9] });
  assert.match(where, /Buyer_Name__c LIKE '%Acme%'/);
  assert.match(where, /2026-09-01/);
  assert.equal(recordedUsage.modelId, LUNA);
  assert.equal(recordedUsage.openAiResponseId, 'resp_auto_route_1');
  assert.equal(recordedUsage.reasoningTokens, 10);
});
