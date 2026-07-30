import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DASHBOARD_AI_MODELS,
  DEFAULT_DASHBOARD_AI_MODEL,
  buildSelectedDashboardDateWhere,
  compileDashboardAiWhere,
  dashboardAiModel,
  interpretDashboardAiSearch,
  isAllowedDashboardAiModel,
  normalizeDashboardAiPrompt,
  parseDashboardAiInterpretation,
} from '../api/_dashboardAi.js';

const field = (name, extra = {}) => ({
  name,
  filterable: true,
  ...extra,
});

const schema = {
  stem: {
    fields: [
      field('Name'),
      field('KeyStem__c'),
      field('Delivery_Date__c'),
      field('Expected_Delivery_Date__c'),
      field('Buyer_Name__c'),
      field('Account__c', { relationshipName: 'Account__r' }),
      field('Port__c', { relationshipName: 'Port__r' }),
      field('Vessel__c'),
      field('Dispute_Status__c'),
      field('Status__c'),
      field('Type__c'),
      field('Total_Invoice_Amount__c'),
      field('Total_Invoiced_Amount_From_Suppliers__c'),
      field('Costs_Total__c'),
      field('Gross_Profit__c'),
      field('Gross_Margin_Percentage__c'),
      field('Total_Volume__c'),
    ],
  },
  account: {
    fields: [
      field('Name'),
      field('Group_Name__c'),
      field('ParentId', { relationshipName: 'Parent' }),
    ],
  },
  lineItem: {
    fields: [
      field('STEM__c', { relationshipName: 'STEM__r' }),
      field('Cancelled__c'),
      field('Supplier_Name__c'),
      field('Product__c', { relationshipName: 'Product__r' }),
      field('Product_Name__c'),
    ],
  },
  extraCost: {
    fields: [
      field('STEM__c', { relationshipName: 'STEM__r' }),
      field('Cancelled__c'),
      field('Supplier_Name__c'),
      field('Name'),
      field('Description__c'),
      field('Product2Id__c', { relationshipName: 'Product2Id__r' }),
    ],
  },
  product: {
    fields: [
      field('Name'),
      field('Family'),
    ],
  },
  port: {
    fields: [
      field('Name'),
      field('Country__c'),
    ],
  },
};

function readyInterpretation(overrides = {}) {
  return {
    version: 1,
    status: 'ready',
    interpretation: 'Extra cost contains SWAPS.',
    chips: ['Extra cost contains SWAPS'],
    includeCancelled: false,
    dateScope: {
      mode: 'selected_period',
      start: null,
      end: null,
      label: 'Selected Dashboard period',
    },
    groups: [{
      conditions: [{
        field: 'extra_cost',
        operator: 'contains',
        value: 'SWAPS',
        valueTo: null,
      }],
    }],
    clarification: {
      question: null,
      options: [],
    },
    ...overrides,
  };
}

test('uses GPT-5 mini as the allowed default while keeping the model list server-controlled', () => {
  assert.equal(DEFAULT_DASHBOARD_AI_MODEL, 'gpt-5-mini-2025-08-07');
  assert.equal(dashboardAiModel(DEFAULT_DASHBOARD_AI_MODEL).recommended, true);
  assert.equal(isAllowedDashboardAiModel(DEFAULT_DASHBOARD_AI_MODEL), true);
  assert.equal(isAllowedDashboardAiModel('gpt-5-mini; DROP TABLE'), false);
  assert.ok(DASHBOARD_AI_MODELS.every((model) => model.id && model.label && model.costTier));
});

test('normalizes bounded prompts and rejects empty or oversized input', () => {
  assert.equal(normalizeDashboardAiPrompt('  show   SWAPS  '), 'show SWAPS');
  assert.throws(() => normalizeDashboardAiPrompt('x'), /at least 3/);
  assert.throws(() => normalizeDashboardAiPrompt('x'.repeat(501)), /500 characters/);
});

test('compiles the SWAPS example against all supported extra-cost identity fields', () => {
  const where = compileDashboardAiWhere(readyInterpretation(), schema, {
    selectedYears: [2026],
    selectedMonths: [7],
  });

  assert.match(where, /Delivery_Date__c >= 2026-07-01/);
  assert.match(where, /Expected_Delivery_Date__c >= 2026-07-01/);
  assert.match(where, /Id IN \(SELECT STEM__c FROM STEM_Extra_Cost__c/);
  assert.match(where, /Cancelled__c = false/);
  assert.match(where, /Name LIKE '%SWAPS%'/);
  assert.match(where, /Description__c LIKE '%SWAPS%'/);
  assert.match(where, /Product2Id__r\.Name LIKE '%SWAPS%'/);
});

test('includes cancelled child records only when explicitly interpreted', () => {
  const where = compileDashboardAiWhere(readyInterpretation({ includeCancelled: true }), schema, {
    selectedYears: [2026],
    selectedMonths: [7],
  });
  assert.doesNotMatch(where, /Cancelled__c = false/);
});

test('compiles negative child searches as absence of a positive matching child', () => {
  const interpretation = readyInterpretation({
    groups: [{
      conditions: [{
        field: 'extra_cost',
        operator: 'not_contains',
        value: 'SWAPS',
        valueTo: null,
      }],
    }],
  });
  const where = compileDashboardAiWhere(interpretation, schema, {
    selectedYears: [2026],
    selectedMonths: [7],
  });
  assert.match(where, /Id NOT IN \(SELECT STEM__c FROM STEM_Extra_Cost__c/);
  assert.match(where, /Name LIKE '%SWAPS%'/);
  assert.doesNotMatch(where, /NOT \(Name LIKE/);
});

test('all-time scope removes the selected Dashboard period without removing record conditions', () => {
  const interpretation = readyInterpretation({
    dateScope: {
      mode: 'all_time',
      start: null,
      end: null,
      label: 'All history',
    },
  });
  const where = compileDashboardAiWhere(interpretation, schema, {
    selectedYears: [2026],
    selectedMonths: [7],
  });
  assert.doesNotMatch(where, /Delivery_Date__c/);
  assert.match(where, /STEM_Extra_Cost__c/);
});

test('builds multiple selected months as an OR date scope', () => {
  const where = buildSelectedDashboardDateWhere([2025, 2026], [1, 12]);
  assert.match(where, /2025-01-01/);
  assert.match(where, /2025-12-01/);
  assert.match(where, /2026-01-01/);
  assert.match(where, /2026-12-01/);
  assert.match(where, / OR /);
});

test('escapes user values instead of accepting AI-generated query fragments', () => {
  const interpretation = readyInterpretation({
    groups: [{
      conditions: [{
        field: 'extra_cost',
        operator: 'contains',
        value: "SWAPS' OR Name LIKE '%",
        valueTo: null,
      }],
    }],
  });
  const where = compileDashboardAiWhere(interpretation, schema, {
    selectedYears: [2026],
    selectedMonths: [7],
  });
  assert.doesNotMatch(where, /SWAPS' OR Name/);
  assert.match(where, /SWAPS\\' OR Name/);
});

test('fails closed when a requested Salesforce schema relationship is unavailable', () => {
  const missingProductLookup = {
    ...schema,
    extraCost: {
      fields: schema.extraCost.fields.filter((item) => item.name !== 'Product2Id__c'),
    },
  };
  assert.throws(
    () => compileDashboardAiWhere(readyInterpretation(), missingProductLookup, {
      selectedYears: [2026],
      selectedMonths: [7],
    }),
    /extra-cost product lookup/,
  );
});

test('validates clarification output before Salesforce can be queried', () => {
  const clarification = parseDashboardAiInterpretation({
    ...readyInterpretation(),
    status: 'needs_clarification',
    groups: [],
    interpretation: 'Supplier could mean line-item supplier or buyer.',
    clarification: {
      question: 'Which party should be searched?',
      options: ['Supplier', 'Buyer'],
    },
  });
  assert.equal(clarification.status, 'needs_clarification');

  assert.throws(() => parseDashboardAiInterpretation({
    ...clarification,
    clarification: { question: null, options: [] },
  }), /usable clarification/);
});

test('calls Responses API with structured output and sends no Salesforce record payload', async () => {
  const output = readyInterpretation();
  let requestBody;
  const fetchImpl = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          output: [{
            type: 'message',
            content: [{ type: 'output_text', text: JSON.stringify(output) }],
          }],
        };
      },
    };
  };

  const interpreted = await interpretDashboardAiSearch({
    prompt: 'show me all stems which has extra cost namely SWAPS',
    modelId: DEFAULT_DASHBOARD_AI_MODEL,
    selectedPeriodLabel: '2026 · Jul',
    today: '2026-07-31',
    safetyIdentifier: 'safe-user-hash',
    apiKey: 'sk-test-key',
    fetchImpl,
  });

  assert.equal(interpreted.status, 'ready');
  assert.equal(requestBody.model, DEFAULT_DASHBOARD_AI_MODEL);
  assert.equal(requestBody.store, false);
  assert.deepEqual(requestBody.reasoning, { effort: 'minimal' });
  assert.equal(requestBody.text.format.type, 'json_schema');
  assert.equal(requestBody.text.format.strict, true);
  assert.equal(requestBody.safety_identifier, 'safe-user-hash');
  assert.match(JSON.stringify(requestBody.input), /extra cost namely SWAPS/);
  assert.match(requestBody.input[0].content[0].text, /all history controls only dateScope\.mode=all_time/i);
  assert.match(requestBody.input[0].content[0].text, /Generic words such as stem, stems, record, and records identify the dataset/);
  assert.doesNotMatch(JSON.stringify(requestBody), /0012x|Salesforce record payload|Total_Invoice_Amount__c/);
});

test('rejects malformed structured output and upstream unavailability', async () => {
  await assert.rejects(() => interpretDashboardAiSearch({
    prompt: 'show SWAPS records',
    apiKey: 'sk-test-key',
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { output_text: '{"status":"ready"}' };
      },
    }),
  }), /interpretation was invalid/);

  await assert.rejects(() => interpretDashboardAiSearch({
    prompt: 'show SWAPS records',
    apiKey: 'sk-test-key',
    fetchImpl: async () => ({ ok: false }),
  }), /temporarily unavailable/);
});
