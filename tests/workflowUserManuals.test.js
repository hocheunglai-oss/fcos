import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { WORKFLOW_USER_MANUALS } from '../src/lib/workflowUserManuals.js';

const REQUIRED_MANUALS = ['disputes', 'unofficialCompensation', 'variableCharges', 'specialTerms', 'accountManagers'];

test('operational workflow manuals are English, structured, and actionable', () => {
  assert.deepEqual(Object.keys(WORKFLOW_USER_MANUALS).sort(), REQUIRED_MANUALS.sort());
  for (const [key, manual] of Object.entries(WORKFLOW_USER_MANUALS)) {
    assert.ok(manual.title, `${key} requires a title`);
    assert.ok(manual.introduction, `${key} requires an introduction`);
    assert.ok(manual.beforeYouStart.length >= 3, `${key} requires start safeguards`);
    assert.ok(manual.workflow.length >= 4, `${key} requires a complete workflow`);
    assert.ok(manual.sections.length >= 4, `${key} requires detailed sections`);
    assert.ok(manual.sections.every((section) => section.steps.length >= 3), `${key} sections require steps`);
    assert.ok(manual.finishedWhen, `${key} requires a completion condition`);
  }
});

test('every requested workspace exposes the shared user-manual trigger', () => {
  const sources = [
    'src/pages/DisputeWorkflow.jsx',
    'src/pages/UnofficialCompensation.jsx',
    'src/components/payments/VariableCharges.jsx',
    'src/pages/SpecialTerms.jsx',
    'src/pages/AccountManagers.jsx',
  ].map((file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
  assert.ok(sources.every((source) => source.includes('WorkflowUserManual')));
  assert.ok(sources.every((source) => source.includes('WORKFLOW_USER_MANUALS')));
});
