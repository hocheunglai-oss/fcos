import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { build } from 'esbuild';

// Execute the actual component, navigation request hook, classifier and batching
// helper without a browser. Only the React host, UI leaves and appClient I/O are
// replaced; component event handlers/effects and asynchronous state flow run.
const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
let compiled;
before(async () => {
  const result = await build({ entryPoints: [path.join(root, 'src/pages/ReviewQueue.jsx')], bundle: true,
    write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', logLevel: 'silent',
    define: { 'import.meta.url': JSON.stringify(import.meta.url) },
    plugins: [{ name: 'local-review-host', setup(builder) {
      builder.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'host' }));
      builder.onResolve({ filter: /^lucide-react$/ }, args => ({ path: args.path, namespace: 'host' }));
      builder.onResolve({ filter: /^@\// }, args => {
        if (args.path.startsWith('@/components/') || args.path === '@/api/appClient') return { path: args.path, namespace: 'host' };
        const base = path.join(root, 'src', args.path.slice(2));
        return { path: [base, `${base}.js`, `${base}.jsx`].find(candidate => existsSync(candidate)) };
      });
      builder.onLoad({ filter: /.*/, namespace: 'host' }, ({ path: name }) => {
        if (name === 'react') return { contents: ['useState', 'useRef', 'useMemo', 'useCallback', 'useEffect']
          .map(hook => `export const ${hook}=(...args)=>globalThis.reviewHost.${hook}(...args);`).join('\n') };
        if (name === 'react/jsx-runtime') return { contents: 'export const jsx=(type,props,key)=>({type,props,key});export const jsxs=jsx;export const Fragment="Fragment";' };
        if (name === '@/api/appClient') return { contents: 'export const appClient={functions:{invoke:(...args)=>globalThis.reviewHost.invoke(...args)}};' };
        const names = name === 'lucide-react'
          ? ['AlertTriangle', 'CheckCircle2', 'ClipboardCheck', 'Download', 'History', 'Loader2', 'RefreshCw', 'Save', 'Search', 'UserCog', 'X']
          : ['Button', 'Input', 'Label', 'Textarea', 'Dialog', 'DialogContent', 'DialogDescription', 'DialogFooter', 'DialogHeader', 'DialogTitle', 'FilterChip'];
        return { contents: `export default ${JSON.stringify(name.split('/').at(-1))};\n`
          + names.map(item => `export const ${item}=${JSON.stringify(item)};`).join('\n') };
      });
    } }],
  });
  compiled = result.outputFiles[0].text;
});

const id = index => `a00${String(index).padStart(12, '0')}`;
const rows = (count, prefix = 'STEM') => Array.from({ length: count }, (_, index) => ({
  Id: id(index), Name: `${prefix} ${index}`, Delivery_Date__c: '2026-10-01',
  Total_Invoice_Amount__c: 1000, Total_Invoiced_Amount_From_Suppliers__c: 900, QLIK_Total_Profit__c: -100,
}));
const primary = recentStems => ({ data: { recentStems }, meta: { cacheStatus: 'MISS', cachedAt: '2026-11-03T00:00:00Z' } });
const workflow = (ids, batch = 1) => ({ data: { byStemId: Object.fromEntries(ids.map(stemId => [stemId, {
  status: 'In Progress', department: 'Operations', priority: 'High', ownerName: `Batch ${batch} owner`,
}])), ownerOptions: [{ id: 'shared-owner', name: 'Shared owner' }, { id: `owner-${batch}`, name: `Batch ${batch} owner` }] } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const turn = () => new Promise(resolve => setImmediate(resolve));

function host(invoke) {
  const cells = [], effects = [], timers = new Map();
  let index = 0, nextTimer = 0, dirty = false, tree, Component;
  const changed = (previous, next) => !previous || !next || previous.length !== next.length || previous.some((value, i) => !Object.is(value, next[i]));
  const hooks = {
    invoke,
    useState(initial) {
      const position = index++;
      if (!cells[position]) cells[position] = { value: typeof initial === 'function' ? initial() : initial };
      return [cells[position].value, value => { cells[position].value = typeof value === 'function' ? value(cells[position].value) : value; dirty = true; }];
    },
    useRef(initial) { const position = index++; return (cells[position] ||= { current: initial }); },
    useMemo(callback, deps) {
      const position = index++;
      if (!cells[position] || changed(cells[position].deps, deps)) cells[position] = { value: callback(), deps };
      return cells[position].value;
    },
    useCallback(callback, deps) { return hooks.useMemo(() => callback, deps); },
    useEffect(callback, deps) {
      const position = index++;
      if (!cells[position] || changed(cells[position].deps, deps)) {
        effects.push(() => { cells[position]?.cleanup?.(); cells[position] = { deps, cleanup: callback() }; });
      }
    },
  };
  const module = { exports: {} };
  const window = {}; window.self = window; window.top = window;
  vm.runInNewContext(compiled, { module, exports: module.exports, require, reviewHost: hooks, window, URL,
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout(callback) { const timer = ++nextTimer; timers.set(timer, callback); return timer; },
    clearTimeout(timer) { timers.delete(timer); }, console,
  });
  Component = module.exports.default;
  const render = () => {
    do { dirty = false; index = 0; tree = Component(); while (effects.length) effects.shift()(); } while (dirty);
  };
  const nodes = () => {
    const found = [];
    const visit = value => { if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object' && 'type' in value) { found.push(value); Object.values(value.props || {}).forEach(visit); } };
    visit(tree); return found;
  };
  render();
  return {
    render, nodes,
    async start() { const callbacks = [...timers.values()]; timers.clear(); await Promise.all(callbacks.map(callback => callback())); render(); },
    unmount() { for (const cell of cells) cell?.cleanup?.(); },
    find(type, predicate = () => true) { return nodes().find(node => node.type === type && predicate(node.props)); },
    click(type, predicate) { const node = this.find(type, predicate); assert.ok(node, `actual component control ${type}`); const result = node.props.onClick(); render(); return result; },
  };
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join('');
  if (node && typeof node === 'object') return text(node.props?.children);
  return node === null || node === undefined || typeof node === 'boolean' ? '' : String(node);
}
const refreshing = app => {
  const busy = app.find('div', props => props['data-testid'] === 'review-workflow-readiness').props['aria-busy'];
  assert.equal(busy, app.find('DataStatus').props.state === 'refreshing');
  return busy;
};

test('actual component keeps 3000 scanned rows loading until the final batch and then renders its workflow and all owners', async () => {
  const final = deferred(), calls = [];
  const app = host(async (name, body) => {
    if (name === 'salesforceDashboardFiltered') return primary(rows(3000));
    assert.equal(name, 'exceptionReviewWorkflowList');
    calls.push(body.stemIds);
    if (calls.length === 6) await final.promise;
    return workflow(body.stemIds, calls.length);
  });
  assert.equal(refreshing(app), true, 'initial scheduled scan is busy before its debounce fires');
  const loading = app.start(); await turn(); app.render();
  assert.deepEqual(calls.map(batch => batch.length), [500, 500, 500, 500, 500, 500]);
  assert.equal(refreshing(app), true);
  assert.equal(app.find('StateBlock').props.title, 'Loading exceptions...');
  assert.equal(app.nodes().some(node => node.type === 'StatCard' && node.props.sub === '3,000 STEMs scanned'), false);
  final.resolve(); await loading;
  assert.equal(refreshing(app), false);
  assert.ok(app.nodes().some(node => node.type === 'StatCard' && node.props.sub === '3,000 STEMs scanned'));
  assert.equal(app.nodes().filter(node => node.type === 'tr').length, 3001);
  assert.match(text(app.find('TableShell')), /STEM 2999.*In Progress.*Batch 6 owner/);
  assert.equal(app.nodes().filter(node => node.type === 'option' && /^owner-/.test(node.props.value)).length, 6);
  app.unmount();
});

test('actual component rejects a failed middle batch without publishing primary rows or partial workflow', async () => {
  let calls = 0;
  const app = host(async (name, body) => {
    if (name === 'salesforceDashboardFiltered') return primary(rows(1500));
    calls += 1;
    return calls === 2 ? { data: { error: 'Middle workflow batch failed' } } : workflow(body.stemIds);
  });
  await app.start();
  assert.equal(calls, 2);
  assert.equal(refreshing(app), false);
  assert.equal(app.find('DataStatus').props.meta.cacheStatus, 'UNAVAILABLE');
  assert.ok(app.nodes().some(node => text(node).includes('Middle workflow batch failed')));
  assert.equal(app.nodes().filter(node => node.type === 'tr').length, 0);
  assert.equal(app.nodes().filter(node => node.type === 'option' && /^owner-/.test(node.props.value)).length, 0);
  app.unmount();
});

test('actual filter change cancels the old generation, preserves date filters and publishes only the new complete workflow', async () => {
  const old = deferred(), primaryCalls = [], workflowCalls = [];
  let scan = 0;
  const app = host(async (name, body) => {
    if (name === 'salesforceDashboardFiltered') {
      primaryCalls.push(body); scan += 1;
      return primary(scan === 1 ? rows(1001, 'OLD') : [{ ...rows(1, 'CURRENT')[0], Id: id(4000) }]);
    }
    workflowCalls.push(body.stemIds);
    if (body.stemIds[0] === id(0)) await old.promise;
    return workflow(body.stemIds, scan);
  });
  const original = app.start(); await turn(); app.render();
  const yearButton = app.nodes().find(node => node.type === 'button' && /^20\d\d$/.test(text(node)) && text(node) !== String(new Date().getFullYear()));
  assert.ok(yearButton);
  yearButton.props.onClick(); app.render();
  await app.start();
  old.resolve(); await original; app.render();
  assert.equal(workflowCalls.length, 2, 'no remaining stale batch is sent');
  assert.match(text(app.find('TableShell')), /CURRENT 0/);
  assert.doesNotMatch(text(app.find('TableShell')), /OLD/);
  assert.equal(primaryCalls[1].mode, 'exception_review');
  assert.equal(primaryCalls[1].dateBasis, 'exception_schedule');
  assert.notDeepEqual(primaryCalls[0].dateWindows, primaryCalls[1].dateWindows);
  assert.equal(refreshing(app), false);
  app.unmount();
});

test('actual navigation cache background update supersedes earlier workflow without a partial or stale commit', async () => {
  const stale = deferred();
  let backgroundUpdate, calls = 0;
  const app = host(async (name, body, options) => {
    if (name === 'salesforceDashboardFiltered') { backgroundUpdate = options.onBackgroundUpdate; return primary(rows(501, 'CACHED')); }
    calls += 1;
    if (body.stemIds[0] === id(0)) await stale.promise;
    return workflow(body.stemIds);
  });
  const pending = app.start(); await turn();
  backgroundUpdate(primary([{ ...rows(1, 'BACKGROUND')[0], Id: id(4000) }]));
  await turn(); app.render();
  assert.equal(refreshing(app), false);
  assert.match(text(app.find('TableShell')), /BACKGROUND 0/);
  stale.resolve(); await pending; app.render();
  assert.equal(calls, 2);
  assert.match(text(app.find('TableShell')), /BACKGROUND 0/);
  assert.doesNotMatch(text(app.find('TableShell')), /CACHED/);
  app.unmount();
});

test('actual unmount cancels the remaining workflow batches', async () => {
  const first = deferred(); let calls = 0;
  const app = host(async (name, body) => {
    if (name === 'salesforceDashboardFiltered') return primary(rows(1001));
    calls += 1; await first.promise; return workflow(body.stemIds);
  });
  const pending = app.start(); await turn(); app.unmount(); first.resolve(); await pending;
  assert.equal(calls, 1);
});

test('actual component reads owners for an empty scan and deduplicates workflow IDs without dropping scanned rows', async () => {
  for (const scan of [[], [rows(2)[0], rows(2)[0], rows(2)[1]]]) {
    const calls = [];
    const app = host(async (name, body) => {
      if (name === 'salesforceDashboardFiltered') return primary(scan);
      calls.push(body.stemIds);
      return workflow(body.stemIds);
    });
    await app.start();
    assert.deepEqual(calls.map(batch => [...batch]), scan.length ? [[id(0), id(1)]] : [[]]);
    assert.ok(app.nodes().some(node => node.type === 'StatCard' && node.props.sub === `${scan.length} STEMs scanned`));
    assert.equal(app.nodes().filter(node => node.type === 'option' && node.props.value === 'shared-owner').length, 1);
    assert.equal(refreshing(app), false);
    app.unmount();
  }
});

test('failed refresh preserves the previous complete scan and workflow instead of publishing a partial new generation', async () => {
  let scan = 0, refreshBatch = 0;
  const app = host(async (name, body) => {
    if (name === 'salesforceDashboardFiltered') { scan += 1; return primary(rows(scan === 1 ? 1 : 1001, scan === 1 ? 'VERIFIED' : 'FAILED')); }
    if (scan === 2 && ++refreshBatch === 2) return { data: { error: 'Refresh middle batch failed' } };
    return workflow(body.stemIds, scan);
  });
  await app.start();
  assert.match(text(app.find('TableShell')), /VERIFIED 0.*Batch 1 owner/);
  await app.click('Button', props => text(props.children).trim() === 'Refresh');
  app.render();
  assert.equal(refreshBatch, 2);
  assert.equal(refreshing(app), false);
  assert.equal(app.find('DataStatus').props.meta.cacheStatus, 'UNAVAILABLE');
  assert.match(text(app.find('TableShell')), /VERIFIED 0.*Batch 1 owner/);
  assert.doesNotMatch(text(app.find('TableShell')), /FAILED/);
  assert.equal(app.nodes().filter(node => node.type === 'tr').length, 2);
  app.unmount();
});
