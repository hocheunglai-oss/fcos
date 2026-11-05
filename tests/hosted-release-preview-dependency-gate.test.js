import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import yaml from 'js-yaml';
import {dependencyWorkflowStatus} from '../scripts/hosted-release-dependencies.mjs';

const workflow = yaml.load(readFileSync(new URL('../.github/workflows/hosted-release-controller.yml', import.meta.url), 'utf8'));
// Evaluate only this trusted repository expression in isolated local tests. The
// supported operators have the same semantics for these closed status strings.
const expression = workflow.jobs.preview.if.replace(/^\$\{\{\s*/, '').replace(/\s*\}\}$/, '');
const gate = new Function('needs', 'always', 'cancelled', `return (${expression});`);
const state = (required = 'true', status = 'passed', result = 'success') => ({
  prepare: {result: 'success', outputs: {terminal: 'false', dependencies_required: required}},
  reconcile: {result: 'success'}, dependencies_before: {result, outputs: {dependency_status: status}},
});

test('Preview admission consumes the validated dependency outcome, including green-job failures', () => {
  assert.ok(workflow.jobs.preview.needs.includes('dependencies_before'));
  assert.equal(workflow.jobs.dependencies_before.outputs.dependency_status, '${{ steps.run.outputs.dependency_status }}');
  assert.equal(workflow.jobs.dependencies_before.steps.find(step => step.run === 'node controller/scripts/hosted-release-dependencies.mjs').id, 'run');
  assert.equal(gate(state(), () => true, () => false), true);
  for (const status of ['failed', 'waiting_dependency', '', 'unknown']) assert.equal(gate(state('true', status), () => true, () => false), false);
  const missing = state(); delete missing.dependencies_before.outputs.dependency_status; assert.equal(gate(missing, () => true, () => false), false);
  for (const result of ['failure', 'cancelled', 'skipped']) assert.equal(gate(state('true', 'passed', result), () => true, () => false), false);
});

test('Validated cached dependencies can resume, while absent inputs and failed ownership prerequisites stay closed', () => {
  assert.equal(gate(state('false', '', 'skipped'), () => true, () => false), true);
  for (const mutate of [s => {s.prepare.outputs.terminal = 'true';}, s => {s.prepare.result = 'failure';},
    s => {s.reconcile.result = 'failure';}, s => {delete s.prepare.outputs.dependencies_required;}]) {
    const value = state(); mutate(value); assert.equal(gate(value, () => true, () => false), false);
  }
  assert.equal(gate(state(), () => true, () => true), false);
});

test('Partial, contradictory and malformed dependency reports never produce a passed admission output', () => {
  const report = (a, b, status) => ({status, checks: [{checkId: 'nom_b', status: a}, {checkId: 'preservation', status: b}]});
  assert.equal(dependencyWorkflowStatus(report('passed', 'passed', 'passed')), 'passed');
  assert.equal(dependencyWorkflowStatus(report('failed', 'passed', 'failed')), 'failed');
  assert.equal(dependencyWorkflowStatus(report('waiting_dependency', 'passed', 'waiting_dependency')), 'waiting_dependency');
  for (const value of [report('failed', 'passed', 'passed'), {status: 'passed', checks: []},
    {status: 'passed', checks: [{checkId: 'nom_b', status: 'passed'}, {checkId: 'nom_b', status: 'passed'}]},
    report('unknown', 'passed', 'passed')]) assert.equal(dependencyWorkflowStatus(value), 'failed');
});
