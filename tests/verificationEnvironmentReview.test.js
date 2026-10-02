import assert from 'node:assert/strict';
import test from 'node:test';
import { assertVerificationEnvironmentReview, collectVerificationEnvironmentReview } from '../scripts/lib/release-evidence.mjs';

function fixture(kind = 'restricted_browser') {
  const user = { id: 4, login: 'hocheunglai-oss' };
  const name = kind === 'restricted_browser' ? 'fcos-ci-readonly' : 'fcos-normal-role-verification';
  const environment = { id: 5, name, can_admins_bypass: false,
    deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
    protection_rules: [{ type: 'required_reviewers', prevent_self_review: false, reviewers: [{ type: 'User', reviewer: user }] }] };
  return { kind, environment, run: { id: 99, run_attempt: 1, actor: user, triggering_actor: user },
    approvals: [{ state: 'approved', user, environments: [{ id: 5, name }] }] };
}

test('verification requires independently recorded exact human review and non-bypassable environment protections', () => {
  for (const kind of ['restricted_browser', 'normal_role']) {
    assert.equal(assertVerificationEnvironmentReview(fixture(kind)), true);
    for (const change of [
      value => { value.environment.protection_rules = []; }, value => { value.environment.can_admins_bypass = true; },
      value => { value.environment.deployment_branch_policy = { protected_branches: false, custom_branch_policies: true }; },
      value => { value.environment.protection_rules[0].reviewers[0].type = 'Team'; },
      value => { value.environment.protection_rules[0].reviewers[0].reviewer.id = 0; },
      value => { value.environment.name = 'other'; }, value => { value.approvals = []; },
      value => { value.approvals[0].state = 'rejected'; }, value => { value.approvals[0].environments[0].id = 6; },
      value => { value.run.run_attempt = 2; }, value => { value.run.triggering_actor = { id: 6, login: 'other' }; },
    ]) { const changed = structuredClone(fixture(kind)); change(changed); assert.throws(() => assertVerificationEnvironmentReview(changed)); }
  }
});

test('collector obtains setup and review from two fixed pinned-repository GETs; local approval flags are insufficient', () => {
  const value = fixture(), paths = [];
  const reads = { json: path => { paths.push(path); return path.includes('/environments/') ? value.environment : value.approvals; } };
  assert.equal(collectVerificationEnvironmentReview({ reads, run: value.run, kind: value.kind }), true);
  assert.deepEqual(paths, ['repos/hocheunglai-oss/fcos/environments/fcos-ci-readonly', 'repos/hocheunglai-oss/fcos/actions/runs/99/approvals']);
  assert.throws(() => assertVerificationEnvironmentReview({ ...fixture(), approvals: { pass: true, approved: true } }));
  assert.throws(() => collectVerificationEnvironmentReview({ reads, run: { id: 0 }, kind: value.kind }));
});
