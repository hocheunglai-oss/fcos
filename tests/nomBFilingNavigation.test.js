import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { NOM_B_FROM_LABEL } from '../shared/missingNomB.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function hookHarness() {
  const states = [];
  const effects = [];
  let cursor = 0;
  const sameDeps = (previous, next) => previous && next && previous.length === next.length && previous.every((value, index) => Object.is(value, next[index]));
  const react = {
    Fragment: 'Fragment', Suspense: 'Suspense',
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    lazy: factory => factory.toString().includes('MissingNomBPanel') ? 'MissingNomBPanel' : 'StemDetailModal',
    useSyncExternalStore: (_subscribe, _getSnapshot, getServerSnapshot) => getServerSnapshot(),
    useState(initial) {
      const index = cursor++;
      if (!states[index]) states[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [states[index].value, next => { states[index].value = typeof next === 'function' ? next(states[index].value) : next; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!states[index]) states[index] = { value: { current: initial } };
      return states[index].value;
    },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!sameDeps(states[index]?.deps, deps)) states[index] = { deps, value: callback };
      return states[index].value;
    },
    useMemo(callback, deps) {
      const index = cursor++;
      if (!sameDeps(states[index]?.deps, deps)) states[index] = { deps, value: callback() };
      return states[index].value;
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!sameDeps(states[index]?.deps, deps)) {
        effects.push({ index, effect, cleanup: states[index]?.cleanup });
        states[index] = { deps };
      }
    },
  };
  return {
    react,
    render(component, props = {}) { cursor = 0; return component(props); },
    async flushEffects() {
      for (const { index, effect, cleanup } of effects.splice(0)) { cleanup?.(); states[index].cleanup = effect(); }
      await new Promise(resolve => setImmediate(resolve));
    },
  };
}

async function compile(path, react, mocks) {
  const source = await read(path);
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JSX);
  const importedNames = parsed.statements.filter(ts.isImportDeclaration).flatMap(statement => {
    const clause = statement.importClause;
    return [clause?.name?.text, ...(clause?.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements.map(item => item.name.text) : [])].filter(Boolean);
  });
  const bindings = Object.fromEntries(importedNames.map(name => [name, mocks[name] ?? react[name] ?? (name === 'NOM_B_FROM_LABEL' ? NOM_B_FROM_LABEL : name)]));
  const withoutImports = source.replace(/^import[\s\S]*?;\r?\n/gmu, '');
  const compiled = ts.transpileModule(withoutImports, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('React', ...Object.keys(bindings), 'exports', compiled)(react, ...Object.values(bindings), exports);
  return exports.default;
}

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object' || !tree.type) return [];
  return [tree, ...nodes(tree.props?.children), ...nodes(tree.props?.actions), ...nodes(tree.props?.action)];
}
const find = (tree, type) => nodes(tree).find(node => node.type === type);

async function pageHarness({ query = '', user = {}, dashboardAccess = true, data = { commitments: [], counts: {} } } = {}) {
  const hooks = hookHarness();
  let params = new URLSearchParams(query);
  const calls = { requests: [], queries: [], navigation: [] };
  const request = async options => { calls.requests.push(options.name); options.apply({ data }); };
  const page = await compile('src/pages/MyCommitments.jsx', hooks.react, {
    useAuth: () => ({ user, hasModuleAccess: module => module === 'dashboard' && dashboardAccess }),
    useNavigate: () => path => calls.navigation.push(path),
    useSearchParams: () => [params, (next, options) => { params = next; calls.queries.push({ query: next.toString(), options }); }],
    useNavigationAwareRequest: () => ({ request }),
    operationalHome: () => '/', setOperationalHome: () => true,
    cn: (...values) => values.filter(Boolean).join(' '), MY_COMMITMENTS_METHODOLOGY: {},
  });
  return { ...hooks, calls, render: () => hooks.render(page), query: () => params.toString() };
}

test('Nom B Filing stays discoverable with no commitments and selects a stable source query without losing other parameters', async () => {
  const page = await pageHarness({ query: 'keep=existing' });
  const tree = page.render();
  const bar = find(tree, 'WorkspaceViewBar');
  assert.deepEqual(bar.props.views.map(view => view.id), ['all', 'nom_b']);
  assert.equal(bar.props.views.find(view => view.id === 'nom_b').label, 'Nom B Filing');
  assert.equal(bar.props.views.find(view => view.id === 'nom_b').count, undefined);
  bar.props.onValueChange('nom_b');
  assert.equal(page.query(), 'keep=existing&source=nom_b');
  assert.deepEqual(page.calls.queries[0].options, { replace: true });
});

test('direct Nom B source mounts only the expanded filing panel and does not load ordinary commitments', async () => {
  const page = await pageHarness({ query: 'source=nom_b' });
  const tree = page.render();
  await page.flushEffects();
  assert.deepEqual(page.calls.requests, []);
  const panel = find(tree, 'MissingNomBPanel');
  assert.equal(panel.props.documentFiling, true);
  assert.equal(panel.props.defaultExpanded, true);
  assert.equal(panel.props.title, 'Nom B Filing');
  assert.equal(find(tree, 'WorkspaceViewBar').props.value, 'nom_b');
  assert.equal(nodes(tree).some(node => node.props?.title === 'Loading commitments'), false);
  assert.equal(nodes(tree).some(node => node.props?.className === 'grid gap-3 sm:grid-cols-2 xl:grid-cols-5'), false);
  assert.equal(find(tree, 'PageHeader').props.actions.props.children.some(child => child?.type === 'Button' && child.props.children.includes('Refresh')), false);
});

test('Open STEM keeps filing in My Commitments and wires the existing detail modal close action', async () => {
  const page = await pageHarness({ query: 'source=nom_b' });
  let tree = page.render();
  find(tree, 'MissingNomBPanel').props.onOpenStem('a0H123456789012AAA');
  tree = page.render();
  const modal = find(tree, 'StemDetailModal');
  assert.equal(modal.props.stemId, 'a0H123456789012AAA');
  assert.equal(modal.props.open, true);
  assert.deepEqual(page.calls.navigation, []);
  modal.props.onClose();
  assert.equal(find(page.render(), 'StemDetailModal'), undefined);
  const modalSource = await read('src/components/dashboard/StemDetailModal.jsx');
  assert.match(modalSource, /to=\{`\/stems\/\$\{encodeURIComponent\(stemId\)\}`\}/u);
});

test('leaving Nom B restores ordinary source lists, counts, item navigation and unknown-source fallback', async () => {
  const data = { counts: { needs_action: 1 }, commitments: [
    { id: 'task', source: 'collaboration', urgency: 'needs_action', title: 'Project task', link: '/projects-tasks' },
    { id: 'incident', source: 'system_error', urgency: 'overdue', title: 'System incident', link: '/my-commitments?source=system_error' },
  ] };
  const page = await pageHarness({ query: 'source=nom_b&keep=existing', data });
  find(page.render(), 'WorkspaceViewBar').props.onValueChange('collaboration');
  page.render();
  await page.flushEffects();
  let tree = page.render();
  assert.deepEqual(page.calls.requests, ['workCommitmentsList']);
  assert.equal(find(tree, 'MissingNomBPanel'), undefined);
  assert.equal(find(tree, 'WorkspaceViewBar').props.value, 'collaboration');
  const item = nodes(tree).find(node => node.type === 'button');
  item.props.onClick();
  assert.deepEqual(page.calls.navigation, ['/projects-tasks']);
  find(tree, 'WorkspaceViewBar').props.onValueChange('all');
  assert.equal(page.query(), 'keep=existing');
  tree = page.render();
  assert.equal(find(tree, 'WorkspaceViewBar').props.views.find(view => view.id === 'all').count, 2);
  const unknown = await pageHarness({ query: 'source=unknown', data });
  assert.equal(find(unknown.render(), 'WorkspaceViewBar').props.value, 'all');
});

test('CI and users without dashboard permission never mount Nom B, even through its direct query', async () => {
  for (const permissions of [{ user: { read_only_ci: true } }, { dashboardAccess: false }]) {
    const page = await pageHarness({ query: 'source=nom_b', ...permissions });
    const tree = page.render();
    await page.flushEffects();
    assert.equal(find(tree, 'MissingNomBPanel'), undefined);
    assert.equal(find(tree, 'WorkspaceViewBar').props.views.some(view => view.id === 'nom_b'), false);
    assert.equal(find(tree, 'StateBlock').props.title, 'Nom B Filing is unavailable');
    assert.deepEqual(page.calls.requests, []);
  }
});

test('ordinary commitment entry does not mount Nom B or request its evidence', async () => {
  const page = await pageHarness();
  const tree = page.render();
  await page.flushEffects();
  assert.equal(find(tree, 'MissingNomBPanel'), undefined);
  assert.deepEqual(page.calls.requests, ['workCommitmentsList']);
  const dashboard = await read('src/pages/DashboardSettings.jsx');
  assert.doesNotMatch(dashboard, /MissingNomBPanel|dashboardNomBRead/u);
  assert.doesNotMatch(dashboard, /navigate\('\/missing-nom-b'\)|>Missing Nom B<\/Button>/u);
});

test('the reminder destination redirects into personal filing under Dashboard access instead of a separate page', async () => {
  const source = await read('src/App.jsx');
  assert.doesNotMatch(source, /import\('@\/pages\/MissingNomB'\)/u);
  const parsed = ts.createSourceFile('src/App.jsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JSX);
  let reminderRoute;
  const findRoute = node => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(parsed) === 'Route') {
      const path = node.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(parsed) === 'path');
      if (path?.initializer?.text === '/missing-nom-b') reminderRoute = node;
    }
    ts.forEachChild(node, findRoute);
  };
  findRoute(parsed);
  assert.ok(reminderRoute, 'Existing reminder links must remain resolvable.');
  assert.match(reminderRoute.getText(parsed), /ModuleGate moduleId="dashboard"/u);
  assert.match(reminderRoute.getText(parsed), /Navigate to="\/my-commitments\?source=nom_b" replace/u);
});

test('sign-in preserves the Nom B reminder destination through federated return', async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const saved = new Map([['fcos:fcuno-return-to', '/missing-nom-b']]);
  globalThis.window = { location: { origin: 'https://fcos.example.invalid' }, sessionStorage: {
    getItem: key => saved.get(key) ?? null,
    removeItem: key => saved.delete(key),
  } };
  globalThis.document = { title: '' };
  try {
    const hooks = hookHarness();
    const login = await compile('src/pages/Login.jsx', hooks.react, {
      useLocation: () => ({ search: '?federated=1', hash: '', state: null }),
      useAuth: () => ({ isAuthenticated: true, authMode: 'supabase' }),
      operationalHome: () => '/',
    });
    const result = hooks.render(login);
    assert.equal(find(result, 'Navigate').props.to, '/missing-nom-b');
    assert.equal(find(result, 'Navigate').props.replace, true);
    await hooks.flushEffects();
    assert.equal(saved.has('fcos:fcuno-return-to'), false);
  } finally {
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
  }
});

test('the existing panel remains collapsed by default and expanded at filing entry while preserving its read and policy controls', async () => {
  for (const defaultExpanded of [undefined, true]) {
    const hooks = hookHarness();
    const requests = [];
    const panel = await compile('src/components/dashboard/MissingNomBPanel.jsx', hooks.react, {
      appClient: { functions: { invoke: async (name, body) => { requests.push({ name, body }); return { data: { counts: { missing: 0 }, rows: [] } }; } } },
      nomBError: response => response.data, nomBNumber: number => Number(number).toLocaleString(),
    });
    const tree = hooks.render(panel, defaultExpanded === undefined ? {} : { defaultExpanded, title: 'Nom B Filing' });
    assert.equal(nodes(tree).some(node => node.props?.id === 'missing-nom-b-list'), defaultExpanded === true);
    await hooks.flushEffects();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].name, 'dashboardNomBRead');
    assert.equal(requests[0].body.scope, 'mine');
    assert.equal(requests[0].body.view, 'missing');
  }
});

test('document filing is embedded only in the desktop personal Missing tab', async () => {
  for (const desktop of [false, true]) {
    const hooks = hookHarness();
    const panel = await compile('src/components/dashboard/MissingNomBPanel.jsx', hooks.react, {
      useSyncExternalStore: () => desktop,
      appClient: { functions: { invoke: async () => ({ data: { counts: { missing: 0 }, rows: [] } }) } },
      nomBError: response => response.data, nomBNumber: number => Number(number).toLocaleString(),
    });
    const tree = hooks.render(panel, { documentFiling: true, defaultExpanded: true, title: 'Nom B Filing' });
    assert.equal(nodes(tree).some(node => node.type === 'p' && node.props.children.join('').startsWith('File missing Nom B on your active Buyer Confirmations with delivery from 1 September 2026')), desktop);
    assert.equal(Boolean(find(tree, 'MissingNomBFilingTable')), desktop);
    assert.equal(nodes(tree).some(node => node.type === 'span' && node.props?.['aria-label']?.startsWith('My missing Nom B count:')), !desktop);
  }
});
