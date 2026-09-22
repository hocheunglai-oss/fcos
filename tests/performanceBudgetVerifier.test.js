import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { verifyPerformanceBudgets } from '../scripts/lib/performance-budget-verifier.mjs';

const defaultBudgets = {
  client: {
    largestJavaScriptBytes: 1_000,
    largestJavaScriptGzipBytes: 1_000,
    chartChunkBytes: 1_000,
    totalJavaScriptBytes: 1_000,
  },
  server: {
    universalDispatcherLines: 10,
    universalFunctionKilobytes: 10,
    dedicatedFunctionKilobytes: 10,
  },
  requests: {
    workNotificationsDatabase: 1,
    workNotificationsSalesforce: 2,
    emailRouterForegroundFolders: 1,
    emailRouterForegroundPages: 1,
  },
};

async function writeFixture(budgets = defaultBudgets) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fcos-performance-budget-'));
  await Promise.all([
    mkdir(path.join(root, 'config'), { recursive: true }),
    mkdir(path.join(root, 'dist/assets'), { recursive: true }),
    mkdir(path.join(root, 'api/functions'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(root, 'config/performance-budgets.json'), JSON.stringify(budgets)),
    writeFile(path.join(root, 'dist/assets/main.js'), 'export const asset = true;'),
    writeFile(path.join(root, 'api/functions/[name].js'), 'export default function handler() {}\n'),
    writeFile(path.join(root, 'api/work-notifications.js'), 'export default function handler() {}\n'),
    writeFile(path.join(root, 'api/email-router-background-sync.js'), 'export default function handler() {}\n'),
    writeFile(path.join(root, 'api/_workNotifications.js'), "client.rpc('load_work_notification_snapshot');\nlistSpecialTermApprovalQueue();\nlistSpecialTermClauseConsolidations();\n"),
    writeFile(path.join(root, 'api/_emailRouterHandlers.js'), "export async function emailRouterBackgroundSyncHandler() {\n  return { folders: ['inbox'], maxPages: 1 };\n}\n"),
  ]);
  return root;
}

test('frontend performance verification reports unavailable server bundles without claiming a complete release check', async (t) => {
  const root = await writeFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const report = await verifyPerformanceBudgets({ root });
  assert.deepEqual(report.failures, []);
  assert.equal(report.serverArtifacts.available, false);
  assert.match(report.warnings.join('\n'), /Server bundle checks unavailable/);
});

test('strict release performance verification fails when Vercel server bundles are absent', async (t) => {
  const root = await writeFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const report = await verifyPerformanceBudgets({ root, requireServerArtifacts: true });
  assert.match(report.failures.join('\n'), /Server bundle checks unavailable/);
});

test('client and configured request thresholds are enforced from the budget file', async (t) => {
  const clientRoot = await writeFixture({
    ...defaultBudgets,
    client: { ...defaultBudgets.client, largestJavaScriptBytes: 1 },
  });
  const requestRoot = await writeFixture({
    ...defaultBudgets,
    requests: { ...defaultBudgets.requests, workNotificationsDatabase: 0 },
  });
  t.after(() => Promise.all([
    rm(clientRoot, { recursive: true, force: true }),
    rm(requestRoot, { recursive: true, force: true }),
  ]));
  const [clientReport, requestReport] = await Promise.all([
    verifyPerformanceBudgets({ root: clientRoot }),
    verifyPerformanceBudgets({ root: requestRoot }),
  ]);
  assert.match(clientReport.failures.join('\n'), /Largest client chunk/);
  assert.match(requestReport.failures.join('\n'), /notification database snapshot requests/);
});

async function writePdfViewerFixture() {
  const root = await writeFixture({ ...defaultBudgets, onDemandPdfViewer: {
    rendererBytes: 300, workerBytes: 500, totalBytes: 800, totalGzipBytes: 300,
  } });
  const key = 'src/components/special-terms/SpecialTermPdfPages.jsx';
  const manifest = {
    'index.html': { isEntry: true, file: 'assets/main.js', dynamicImports: [key] },
    [key]: { isDynamicEntry: true, file: 'assets/SpecialTermPdfPages-test.js', assets: ['assets/pdf.worker.min-test.mjs'] },
    'node_modules/pdfjs-dist/build/pdf.worker.min.mjs': { file: 'assets/pdf.worker.min-test.mjs' },
  };
  await mkdir(path.join(root, 'dist/.vite'));
  await Promise.all([
    writeFile(path.join(root, 'dist/.vite/manifest.json'), JSON.stringify(manifest)),
    writeFile(path.join(root, 'dist/assets/SpecialTermPdfPages-test.js'), 'r'.repeat(200)),
    writeFile(path.join(root, 'dist/assets/pdf.worker.min-test.mjs'), 'w'.repeat(400)),
  ]);
  return { root, manifest, key };
}

test('on-demand PDF rendering has an explicit budget including its MJS worker', async (t) => {
  const { root } = await writePdfViewerFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const report = await verifyPerformanceBudgets({ root });
  assert.deepEqual(report.failures, []);
  assert.equal(report.clientAssets.onDemandPdfViewer.bytes, 600);
  assert.equal(report.clientAssets.ordinaryBytes, 'export const asset = true;'.length);
});

test('a symlink-resolved node_modules manifest path keeps the PDF worker in its explicit budget', async (t) => {
  const { root, manifest } = await writePdfViewerFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const worker = manifest['node_modules/pdfjs-dist/build/pdf.worker.min.mjs'];
  delete manifest['node_modules/pdfjs-dist/build/pdf.worker.min.mjs'];
  manifest['../shared-dependencies/node_modules/pdfjs-dist/build/pdf.worker.min.mjs'] = {
    ...worker,
    src: '../shared-dependencies/node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
  };
  await writeFile(path.join(root, 'dist/.vite/manifest.json'), JSON.stringify(manifest));
  const report = await verifyPerformanceBudgets({ root });
  assert.deepEqual(report.failures, []);
  assert.equal(report.clientAssets.onDemandPdfViewer.bytes, 600);
  assert.equal(report.clientAssets.ordinaryBytes, 'export const asset = true;'.length);
});

test('a statically imported PDF viewer cannot use the optional budget', async (t) => {
  const { root, manifest, key } = await writePdfViewerFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  manifest['index.html'].imports = [key];
  await writeFile(path.join(root, 'dist/.vite/manifest.json'), JSON.stringify(manifest));
  const report = await verifyPerformanceBudgets({ root });
  assert.match(report.failures.join('\n'), /no static importer/);
  assert.equal(report.clientAssets.onDemandPdfViewer, null);
  assert.ok(report.clientAssets.ordinaryBytes > 600);
});

test('missing manifest or worker cannot silently exempt PDF assets', async (t) => {
  for (const missing of ['dist/.vite/manifest.json', 'dist/assets/pdf.worker.min-test.mjs']) {
    const { root } = await writePdfViewerFixture();
    t.after(() => rm(root, { recursive: true, force: true }));
    await rm(path.join(root, missing));
    const report = await verifyPerformanceBudgets({ root });
    assert.ok(report.failures.some((message) => /PDF viewer/.test(message)));
    assert.equal(report.clientAssets.onDemandPdfViewer, null);
  }
});

test('renderer and worker must each remain within their explicit limits', async (t) => {
  const { root } = await writePdfViewerFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all([
    writeFile(path.join(root, 'dist/assets/SpecialTermPdfPages-test.js'), 'r'.repeat(301)),
    writeFile(path.join(root, 'dist/assets/pdf.worker.min-test.mjs'), 'w'.repeat(501)),
  ]);
  const report = await verifyPerformanceBudgets({ root });
  assert.match(report.failures.join('\n'), /PDF renderer is 301/);
  assert.match(report.failures.join('\n'), /PDF worker is 501/);
  assert.match(report.failures.join('\n'), /On-demand PDF viewer is 802/);
});

test('unrelated MJS and similarly named extra workers retain the ordinary app budget', async (t) => {
  const { root } = await writePdfViewerFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all([
    writeFile(path.join(root, 'dist/assets/extra.mjs'), 'x'.repeat(600)),
    writeFile(path.join(root, 'dist/assets/pdf.worker.min-unreferenced.mjs'), 'w'.repeat(600)),
  ]);
  const report = await verifyPerformanceBudgets({ root });
  assert.match(report.failures.join('\n'), /Total client JavaScript/);
  assert.equal(report.clientAssets.onDemandPdfViewer.bytes, 600);
  assert.ok(report.clientAssets.ordinaryBytes > 1200);
});

test('the optional PDF viewer must also satisfy its combined compressed budget', async (t) => {
  const { root } = await writePdfViewerFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'config/performance-budgets.json'), JSON.stringify({
    ...defaultBudgets,
    onDemandPdfViewer: { rendererBytes: 300, workerBytes: 500, totalBytes: 800, totalGzipBytes: 1 },
  }));
  const report = await verifyPerformanceBudgets({ root });
  assert.match(report.failures.join('\n'), /Compressed on-demand PDF viewer/);
});

async function writeXlsWriterFixture() {
  const root = await writeFixture({ ...defaultBudgets, onDemandXlsWriter: {
    largestAssetBytes: 500, totalBytes: 700, totalGzipBytes: 300,
  } });
  const key = 'src/lib/dashboardStemWorkbook.js';
  const dependencyKey = '_xlsx-core-test.js';
  const manifest = {
    'index.html': { isEntry: true, file: 'assets/main.js', dynamicImports: [key] },
    [key]: { isDynamicEntry: true, file: 'assets/dashboardStemWorkbook-test.js', imports: [dependencyKey] },
    [dependencyKey]: { file: 'assets/xlsx-core-test.js' },
  };
  await mkdir(path.join(root, 'dist/.vite'));
  await Promise.all([
    writeFile(path.join(root, 'dist/.vite/manifest.json'), JSON.stringify(manifest)),
    writeFile(path.join(root, 'dist/assets/dashboardStemWorkbook-test.js'), 'w'.repeat(200)),
    writeFile(path.join(root, 'dist/assets/xlsx-core-test.js'), 'x'.repeat(400)),
  ]);
  return { root, manifest, key, dependencyKey };
}

test('on-demand XLS writer budgets its complete exclusive static import closure', async (t) => {
  const { root } = await writeXlsWriterFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const report = await verifyPerformanceBudgets({ root });
  assert.deepEqual(report.failures, []);
  assert.deepEqual(report.clientAssets.onDemandXlsWriter.assets.toSorted(), [
    'dashboardStemWorkbook-test.js',
    'xlsx-core-test.js',
  ]);
  assert.equal(report.clientAssets.onDemandXlsWriter.bytes, 600);
  assert.equal(report.clientAssets.onDemandXlsWriter.largestBytes, 400);
  assert.equal(report.clientAssets.ordinaryBytes, 'export const asset = true;'.length);
});

test('an eagerly reachable XLS writer cannot use the on-demand budget', async (t) => {
  const { root, manifest, key } = await writeXlsWriterFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  manifest['index.html'].imports = [key];
  await writeFile(path.join(root, 'dist/.vite/manifest.json'), JSON.stringify(manifest));
  const report = await verifyPerformanceBudgets({ root });
  assert.match(report.failures.join('\n'), /no eager reachability/);
  assert.equal(report.clientAssets.onDemandXlsWriter, null);
  assert.ok(report.clientAssets.ordinaryBytes > 600);
});

test('a statically shared XLS dependency cannot be excluded from the ordinary budget', async (t) => {
  const { root, manifest, dependencyKey } = await writeXlsWriterFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  manifest['other-feature.js'] = { isDynamicEntry: true, file: 'assets/other-feature.js', imports: [dependencyKey] };
  await Promise.all([
    writeFile(path.join(root, 'dist/.vite/manifest.json'), JSON.stringify(manifest)),
    writeFile(path.join(root, 'dist/assets/other-feature.js'), 'o'.repeat(100)),
  ]);
  const report = await verifyPerformanceBudgets({ root });
  assert.match(report.failures.join('\n'), /must not be statically shared/);
  assert.equal(report.clientAssets.onDemandXlsWriter, null);
  assert.ok(report.clientAssets.ordinaryBytes > 700);
});

test('missing XLS manifest, entry, dependency, and emitted assets fail closed', async (t) => {
  for (const missing of ['manifest-file', 'entry', 'manifest-node', 'emitted-asset']) {
    const { root, manifest, key, dependencyKey } = await writeXlsWriterFixture();
    t.after(() => rm(root, { recursive: true, force: true }));
    if (missing === 'manifest-file') {
      await rm(path.join(root, 'dist/.vite/manifest.json'));
    } else if (missing === 'entry') {
      delete manifest[key];
      await writeFile(path.join(root, 'dist/.vite/manifest.json'), JSON.stringify(manifest));
    } else if (missing === 'manifest-node') {
      delete manifest[dependencyKey];
      await writeFile(path.join(root, 'dist/.vite/manifest.json'), JSON.stringify(manifest));
    } else {
      await rm(path.join(root, 'dist/assets/xlsx-core-test.js'));
    }
    const report = await verifyPerformanceBudgets({ root });
    assert.ok(report.failures.some((message) => /XLS writer/.test(message)));
    assert.equal(report.clientAssets.onDemandXlsWriter, null);
  }
});

test('on-demand XLS writer enforces largest, total, and compressed limits', async (t) => {
  const { root } = await writeXlsWriterFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'config/performance-budgets.json'), JSON.stringify({
    ...defaultBudgets,
    onDemandXlsWriter: { largestAssetBytes: 399, totalBytes: 599, totalGzipBytes: 1 },
  }));
  const report = await verifyPerformanceBudgets({ root });
  assert.match(report.failures.join('\n'), /Largest on-demand XLS writer asset .* is 400/);
  assert.match(report.failures.join('\n'), /On-demand XLS writer is 600/);
  assert.match(report.failures.join('\n'), /Compressed on-demand XLS writer/);
});
