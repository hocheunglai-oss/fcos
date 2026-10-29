import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const bytes = readFileSync(new URL('../fixtures/release-workflows/quality-approved-additions.json', import.meta.url));
assert.equal(createHash('sha256').update(bytes).digest('hex'), 'de0e48b530c90ebfad7fa6914915b48c170e23683201d83f516ab9289802abd4', 'Reviewed additive quality-step fixture changed');
const rules = JSON.parse(bytes);
export function retainedQualitySteps(workflow, { fixture72 = false } = {}) {
  const raw = workflow.jobs['code-and-database'].steps;
  assert.equal(raw.length, rules.rawSteps, 'Unknown or missing approved quality step');
  assert.deepEqual(raw[0], rules.sharedReceiptStep.expected);
  const normalized = raw.slice(1).map((step, i) => {
    const copy = structuredClone(step);
    if (i === 31) assert.equal(copy.if, rules.exactConditions.cleanup);
    else { assert.equal(copy.if, rules.exactConditions.ordinaryLegacyAndAdditions); delete copy.if; }
    return copy;
  });
  for (const row of rules.normalizedAdditions) assert.deepEqual(normalized[row.normalizedIndex], row.step, 'Changed approved additional check');
  for (const row of rules.exactAcceptedTransforms.slice(0, 2)) {
    assert.deepEqual(normalized[row.indexBeforeProjection], row.from);
    normalized[row.indexBeforeProjection] = structuredClone(row.to);
  }
  const result = rules.retainedNormalizedIndices.map(i => normalized[i]);
  const python = rules.exactAcceptedTransforms[2];
  assert.deepEqual(result[python.baselineIndex], python.from);
  if (fixture72) result[python.baselineIndex] = structuredClone(python.to);
  // Full object equality against an immutable baseline, not a permissive filter.
  const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
    : Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
    : `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  assert.equal(createHash('sha256').update(canonical(result)).digest('hex'), (fixture72 ? rules.baseline72 : rules.baselineB02).canonicalStepsSha256);
  return result;
}
