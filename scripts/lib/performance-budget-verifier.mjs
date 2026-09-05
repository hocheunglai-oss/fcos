import { gzipSync } from 'node:zlib';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function directoryKilobytes(target) {
  let bytes = 0;
  for (const entry of await readdir(target, { withFileTypes: true })) {
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) bytes += (await directoryKilobytes(child)) * 1024;
    else if (entry.isFile()) bytes += (await stat(child)).size;
  }
  return Math.ceil(bytes / 1024);
}

function countMatches(source, expression) {
  return (source.match(expression) || []).length;
}

function numberFromSource(source, expression) {
  const match = source.match(expression);
  return match ? Number(match[1]) : null;
}

function folderCountFromSource(source) {
  const match = source.match(/folders\s*:\s*\[([^\]]*)\]/);
  return match ? countMatches(match[1], /['"][^'"]+['"]/g) : null;
}

export async function verifyPerformanceBudgets({
  root = process.cwd(),
  requireServerArtifacts = process.env.FCOS_REQUIRE_SERVER_BUNDLES === '1',
} = {}) {
  const budgets = JSON.parse(await readFile(path.join(root, 'config/performance-budgets.json'), 'utf8'));
  const failures = [];
  const warnings = [];
  const sourceAssurances = [];
  const serverArtifacts = { available: true, unavailable: [] };
  const assertBudget = (condition, message) => {
    if (!condition) failures.push(message);
  };
  const recordSourceAssurance = (name, actual, limit) => {
    sourceAssurances.push({ name, actual, limit });
    assertBudget(actual != null && actual <= limit, `Static source assurance ${name} is ${actual ?? 'unavailable'} (budget ${limit}).`);
  };

  const assetDirectory = path.join(root, 'dist/assets');
  assertBudget(await exists(assetDirectory), 'dist/assets is missing; run the production build before performance verification.');
  if (await exists(assetDirectory)) {
    const files = await readdir(assetDirectory);
    const javascript = [];
    for (const filename of files.filter((name) => name.endsWith('.js'))) {
      const content = await readFile(path.join(assetDirectory, filename));
      javascript.push({ filename, bytes: content.length, gzipBytes: gzipSync(content).length });
    }
    const largest = javascript.toSorted((left, right) => right.bytes - left.bytes)[0];
    const largestGzip = javascript.toSorted((left, right) => right.gzipBytes - left.gzipBytes)[0];
    const chart = javascript.find((item) => item.filename.startsWith('generateCategoricalChart-'));
    const total = javascript.reduce((sum, item) => sum + item.bytes, 0);
    assertBudget(largest?.bytes <= budgets.client.largestJavaScriptBytes, `Largest client chunk ${largest?.filename} is ${largest?.bytes} bytes (budget ${budgets.client.largestJavaScriptBytes}).`);
    assertBudget(largestGzip?.gzipBytes <= budgets.client.largestJavaScriptGzipBytes, `Largest compressed client chunk ${largestGzip?.filename} is ${largestGzip?.gzipBytes} bytes (budget ${budgets.client.largestJavaScriptGzipBytes}).`);
    assertBudget(!chart || chart.bytes <= budgets.client.chartChunkBytes, `Chart chunk ${chart?.filename} is ${chart?.bytes} bytes (budget ${budgets.client.chartChunkBytes}).`);
    assertBudget(total <= budgets.client.totalJavaScriptBytes, `Total client JavaScript is ${total} bytes (budget ${budgets.client.totalJavaScriptBytes}).`);
  }

  const dispatcher = await readFile(path.join(root, 'api/functions/[name].js'), 'utf8');
  const dispatcherLines = dispatcher.split(/\r?\n/).length;
  recordSourceAssurance('universal dispatcher lines', dispatcherLines, budgets.server.universalDispatcherLines);

  const dedicatedSources = await Promise.all([
    'api/work-notifications.js',
    'api/email-router-background-sync.js',
  ].map((filename) => readFile(path.join(root, filename), 'utf8')));
  for (const [index, source] of dedicatedSources.entries()) {
    assertBudget(!source.includes("functions/[name].js"), `Dedicated function ${index + 1} imports the universal dispatcher.`);
  }

  const notificationSource = await readFile(path.join(root, 'api/_workNotifications.js'), 'utf8');
  recordSourceAssurance(
    'notification database snapshot requests',
    countMatches(notificationSource, /client\.rpc\('load_work_notification_snapshot'/g),
    budgets.requests.workNotificationsDatabase,
  );
  recordSourceAssurance(
    'notification Salesforce requests',
    countMatches(notificationSource, /listSpecialTermApprovalQueue\(/g) + countMatches(notificationSource, /listSpecialTermClauseConsolidations\(/g),
    budgets.requests.workNotificationsSalesforce,
  );

  const emailRouterHandler = await readFile(path.join(root, 'api/_emailRouterHandlers.js'), 'utf8');
  const backgroundHandler = emailRouterHandler.match(/export async function emailRouterBackgroundSyncHandler[\s\S]*?\n}\n/)?.[0] || '';
  recordSourceAssurance(
    'foreground Email Router folders',
    folderCountFromSource(backgroundHandler),
    budgets.requests.emailRouterForegroundFolders,
  );
  recordSourceAssurance(
    'foreground Email Router pages',
    numberFromSource(backgroundHandler, /maxPages\s*:\s*(\d+)/),
    budgets.requests.emailRouterForegroundPages,
  );

  const functionRoot = path.join(root, '.vercel/output/functions/api');
  const expectedFunctions = [
    { name: 'functions/[name].func', budget: budgets.server.universalFunctionKilobytes, label: 'Universal Vercel function' },
    { name: 'work-notifications.func', budget: budgets.server.dedicatedFunctionKilobytes, label: 'work-notifications.func' },
    { name: 'email-router-background-sync.func', budget: budgets.server.dedicatedFunctionKilobytes, label: 'email-router-background-sync.func' },
  ];
  for (const expected of expectedFunctions) {
    const target = path.join(functionRoot, expected.name);
    if (!(await exists(target))) {
      serverArtifacts.available = false;
      serverArtifacts.unavailable.push(target);
      continue;
    }
    const size = await directoryKilobytes(target);
    assertBudget(size <= expected.budget, `${expected.label} is ${size} KB (budget ${expected.budget} KB).`);
  }
  if (!serverArtifacts.available) {
    const message = `Server bundle checks unavailable for ${serverArtifacts.unavailable.map((target) => path.relative(root, target)).join(', ')}; run \`vercel build\` to generate .vercel/output before strict release verification.`;
    if (requireServerArtifacts) failures.push(message);
    else warnings.push(message);
  }

  return { budgets, failures, warnings, sourceAssurances, dispatcherLines, serverArtifacts };
}
