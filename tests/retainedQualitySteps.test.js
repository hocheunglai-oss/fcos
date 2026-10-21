import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { retainedQualitySteps } from './helpers/retainedQualitySteps.mjs';
const source = load(readFileSync(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8'));
test('approved additions preserve exact frozen quality checks', () => {
  assert.equal(retainedQualitySteps(source).length, 18);
  assert.equal(retainedQualitySteps(source, { fixture72: true }).length, 18);
});
test('missing, relaxed, reordered or retargeted quality checks fail closed', () => {
  for (const alter of [s => s.splice(4, 1), s => s.push({run:'true'}), s => s[10].run += ' || true',
    s => s[10].if = '${{ always() }}', s => s[0].if = '${{ always() }}',
    s => s[21].run = s[21].run.replace('127.0.0.1', 'example.invalid'),
    s => s[1].with['persist-credentials'] = true, s => s[1].with.ref = 'main',
    s => s[19].env.SUPABASE_INTERNAL_IMAGE_REGISTRY = 'unreviewed',
    s => s[20].run += ' || true', s => s[32].if = '${{ always() }}',
    s => { [s[2],s[3]] = [s[3],s[2]]; }]) {
    const changed = structuredClone(source); alter(changed.jobs['code-and-database'].steps);
    assert.throws(() => retainedQualitySteps(changed));
  }
});
