import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ACCOUNT_MANAGERS_USER_MANUAL,
  DISPUTE_WORKFLOW_USER_MANUAL,
  SPECIAL_TERMS_USER_MANUAL,
  UNOFFICIAL_COMPENSATION_USER_MANUAL,
  VARIABLE_CHARGES_USER_MANUAL,
} from '../src/lib/pageUserManuals.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const MANUALS = [
  DISPUTE_WORKFLOW_USER_MANUAL,
  UNOFFICIAL_COMPENSATION_USER_MANUAL,
  VARIABLE_CHARGES_USER_MANUAL,
  SPECIAL_TERMS_USER_MANUAL,
  ACCOUNT_MANAGERS_USER_MANUAL,
];

test('the five requested user manuals are task based and English only', () => {
  assert.equal(MANUALS.length, 5);
  for (const manual of MANUALS) {
    assert.ok(manual.title);
    assert.ok(manual.description);
    assert.ok(manual.startHere.length >= 3, `${manual.title} should have a short starting sequence`);
    assert.ok(manual.tasks.length >= 4, `${manual.title} should cover its common tasks`);
    assert.ok(manual.reminders.length >= 3, `${manual.title} should include safety reminders`);
    for (const task of manual.tasks) {
      assert.ok(task.title);
      assert.ok(task.summary);
      assert.ok(task.steps.length >= 3, `${manual.title}: ${task.title} should have actionable steps`);
    }
    assert.doesNotMatch(JSON.stringify(manual), /[\u3400-\u9fff]/, `${manual.title} should remain English only`);
  }
});

test('the shared user manual is responsive and performs no page-data request', () => {
  const component = read('src/components/common/PageUserManual.jsx');
  assert.match(component, /triggerLabel = 'User Manual'/);
  assert.match(component, /max-h-\[85vh\]/);
  assert.match(component, /max-w-3xl/);
  assert.match(component, /overflow-y-auto/);
  assert.match(component, /<details/);
  assert.match(component, /Start here/);
  assert.match(component, /Common tasks/);
  assert.doesNotMatch(component, /appClient|fetch\(|functions\.invoke/);
});

test('the requested workspaces expose the shared user manual', () => {
  for (const page of [
    'src/pages/DisputeWorkflow.jsx',
    'src/pages/UnofficialCompensation.jsx',
    'src/pages/PaymentCollections.jsx',
    'src/pages/SpecialTerms.jsx',
    'src/pages/SpecialTermEditor.jsx',
    'src/pages/AccountManagers.jsx',
    'src/components/account-managers/BuyerPicReferences.jsx',
  ]) {
    assert.match(read(page), /PageUserManual/, `${page} should expose the shared User Manual control`);
  }

  assert.match(read('src/pages/PaymentCollections.jsx'), /activeTab === 'variable-charges' \? <PageUserManual/);
  assert.match(read('src/pages/AccountManagers.jsx'), /userManual=\{ACCOUNT_MANAGERS_USER_MANUAL\}/);
  assert.match(read('src/components/account-managers/BuyerPicReferences.jsx'), /<PageUserManual \{\.\.\.userManual\} \/>/);
});
