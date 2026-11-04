import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { parseAst } from 'rollup/parseAst';
import { poolChartErrors, poolChartTypeErrorMessages } from '../config/build/pool-chart-errors.mjs';

const message = 'Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.';
const literal = JSON.stringify(message);
const source = `function first(){throw new TypeError(${literal})} function second(){throw new TypeError(${literal})}`;
const chart = { modules: { '/project/node_modules/recharts/es6/chart/generateCategoricalChart.js': {} } };

test('pooling preserves the exact thrown constructor and message for each handler', () => {
  const transformed = poolChartTypeErrorMessages(source, parseAst);
  assert.ok(transformed && Buffer.byteLength(transformed) < Buffer.byteLength(source));
  for (const code of [source, transformed]) {
    const context = vm.createContext({});
    vm.runInContext(code, context);
    for (const handler of ['first', 'second']) {
      assert.throws(() => vm.runInContext(`${handler}()`, context), error =>
        error.name === 'TypeError' && error.message === message);
    }
  }
});

test('pooled identifiers cannot collide with nested bindings', () => {
  const input = `${source};function nested(__fcE0){return __fcE0}`;
  const transformed = poolChartTypeErrorMessages(input, parseAst);
  assert.match(transformed, /^const __fcE1=/);
  assert.equal(vm.runInNewContext(`${transformed};nested(42)`), 42);
});

test('unrelated errors, single occurrences and string consumers stay unchanged', () => {
  for (const input of [source.replaceAll('TypeError', 'Error'), source.split(' function second')[0], `const value=${literal};`]) {
    assert.equal(poolChartTypeErrorMessages(input, parseAst), null);
  }
});

test('the actual post-minification hook targets only the chart and preserves source maps', () => {
  const hook = poolChartErrors().renderChunk;
  assert.equal(hook.order, 'post');
  const context = { parse: parseAst };
  assert.equal(hook.handler.call(context, source, chart, { sourcemap: true }), null);
  assert.equal(hook.handler.call(context, source, { modules: { '/project/other.js': {} } }, {}), null);
  const output = hook.handler.call(context, source, chart, {});
  assert.ok(output.code.includes('__fcE0'));
  assert.equal(output.map, null);
  assert.doesNotThrow(() => parseAst(output.code));
});
