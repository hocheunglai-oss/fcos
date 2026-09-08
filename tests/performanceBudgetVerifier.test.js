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
