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
const select = (steps, predicate) => {
  const found = steps.filter(predicate); assert.equal(found.length, 1, 'Mutation must target one actual step'); return found[0];
};
test('missing, relaxed, reordered or retargeted quality checks fail closed', () => {
  const changes = [
    steps => steps.splice(4, 1), steps => steps.push({run:'true'}),
    steps => { select(steps, s => s.run === 'npm test').run += ' || true'; },
    steps => { select(steps, s => s.run === 'npm test').if = '${{ always() }}'; },
    steps => { steps[0].if = '${{ always() }}'; },
    steps => { const step = select(steps, s => s.name === 'Verify Missing Nom B database concurrency and recovery'); step.run = step.run.replaceAll('127.0.0.1', 'example.invalid'); },
    steps => { select(steps, s => s.uses === 'actions/checkout@v4').with['persist-credentials'] = true; },
    steps => { select(steps, s => s.uses === 'actions/checkout@v4').with.ref = 'main'; },
    steps => { select(steps, s => s.id === 'start-supabase').env.SUPABASE_INTERNAL_IMAGE_REGISTRY = 'unreviewed'; },
    steps => { select(steps, s => s.run?.includes('npm run verify:migrations')).run += ' || true'; },
    steps => { select(steps, s => s.name === 'Stop temporary Supabase services').if = '${{ always() }}'; },
    steps => { [steps[1],steps[2]] = [steps[2],steps[1]]; },
    steps => { select(steps, s => s.name === 'Verify hosted workflow composition and sealed source').run += ' || true'; },
    steps => { select(steps, s => s.name === 'Verify hosted workflow composition and sealed source').env = { GITHUB_TOKEN:'forbidden-fixture' }; },
  ];
  for (const alter of changes) {
    const changed = structuredClone(source); alter(changed.jobs['code-and-database'].steps);
    assert.throws(() => retainedQualitySteps(changed));
  }
});
test('no retained or additive quality step can be removed, reordered or made non-blocking', () => {
  const count = source.jobs['code-and-database'].steps.length;
  for (let index=0;index<count;index++) {
    const removed=structuredClone(source);removed.jobs['code-and-database'].steps.splice(index,1);
    assert.throws(()=>retainedQualitySteps(removed));
    const relaxed=structuredClone(source);relaxed.jobs['code-and-database'].steps[index]['continue-on-error']=true;
    assert.throws(()=>retainedQualitySteps(relaxed));
    if (index+1<count) {
      const reordered=structuredClone(source), steps=reordered.jobs['code-and-database'].steps;
      [steps[index],steps[index+1]]=[steps[index+1],steps[index]];
      assert.throws(()=>retainedQualitySteps(reordered));
    }
  }
});
