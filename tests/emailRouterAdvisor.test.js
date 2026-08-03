import assert from 'node:assert/strict';
import test from 'node:test';

import { emailRouterAdvisorRecommendationSchema, normaliseEmailRouterAdvisorRecommendation } from '../api/_emailRouterAdvisor.js';

test('Email Router Advisor uses the supported strict Structured Outputs subset', () => {
  const schema = emailRouterAdvisorRecommendationSchema(['destination-1', 'destination-2']);
  assert.equal(schema.type, 'object');
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.selections.items.properties.candidateId.enum, ['destination-1', 'destination-2']);
  assert.deepEqual(schema.properties.selections.items.properties.recipientKind.enum, ['to', 'cc', 'bcc']);
  assert.equal(schema.properties.selections.items.additionalProperties, false);
  assert.equal('uniqueItems' in schema.properties.selections, false);
});

test('Email Router Advisor preselection requires confidence strictly above 60 percent', () => {
  const candidates = [
    { id: 'destination-1', kind: 'destination', label: 'SC', memberCount: 0 },
    { id: 'group-1', kind: 'group', label: 'OPS', memberCount: 3 },
  ];
  const input = {
    selections: [
      { candidateId: 'destination-1', recipientKind: 'to' },
      { candidateId: 'group-1', recipientKind: 'cc' },
    ],
    confidence: 0.6,
    rationale: 'Possible routing.',
    question: 'Who owns this request?',
  };
  assert.deepEqual(normaliseEmailRouterAdvisorRecommendation(input, candidates).selections, []);
  const confident = normaliseEmailRouterAdvisorRecommendation({ ...input, confidence: 0.61 }, candidates);
  assert.deepEqual(confident.selections.map(({ id, recipientKind }) => ({ id, recipientKind })), [
    { id: 'destination-1', recipientKind: 'to' },
    { id: 'group-1', recipientKind: 'cc' },
  ]);
});

test('Email Router Advisor ignores forged, duplicated, and invalid recipient selections', () => {
  const recommendation = normaliseEmailRouterAdvisorRecommendation({
    selections: [
      { candidateId: 'destination-1', recipientKind: 'bcc' },
      { candidateId: 'destination-1', recipientKind: 'to' },
      { candidateId: 'forged', recipientKind: 'cc' },
      { candidateId: 'destination-2', recipientKind: 'reply-to' },
    ],
    confidence: 0.95,
  }, [
    { id: 'destination-1', kind: 'destination', label: 'SC', memberCount: 0 },
    { id: 'destination-2', kind: 'destination', label: 'VL', memberCount: 0 },
  ]);
  assert.deepEqual(recommendation.selections.map(({ id, recipientKind }) => ({ id, recipientKind })), [
    { id: 'destination-1', recipientKind: 'bcc' },
  ]);
});
