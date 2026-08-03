import assert from 'node:assert/strict';
import test from 'node:test';

import { emailRouterAdvisorRecommendationSchema } from '../api/_emailRouterAdvisor.js';

test('Email Router Advisor uses the supported strict Structured Outputs subset', () => {
  const schema = emailRouterAdvisorRecommendationSchema(['destination-1', 'destination-2']);
  assert.equal(schema.type, 'object');
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.destinationIds.items.enum, ['destination-1', 'destination-2']);
  assert.equal('uniqueItems' in schema.properties.destinationIds, false);
});
