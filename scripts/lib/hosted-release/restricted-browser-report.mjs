// Retain actionable test locations, never Playwright errors, titles, URLs or state.
const files = new Set(['workspace-smoke.spec.js', 'dashboard.spec.js', 'api-denials.spec.js']);
const reasons = new Set(['REPORT_UNREADABLE', 'CHILD_UNCONFIRMED', 'TESTS_FAILED', 'COVERAGE_MISSING']);
const statuses = new Set(['failed', 'timedOut', 'interrupted', 'skipped', 'unknown']);
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 10000;
const plain = value => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.values(Object.getOwnPropertyDescriptors(value)).every(d => Object.hasOwn(d, 'value'));

export function restrictedBrowserReportDiagnostic(report, exitCode) {
  const stats = Object.fromEntries(['expected', 'unexpected', 'skipped', 'flaky'].map(key =>
    [key, count(report?.stats?.[key]) ? report.stats[key] : null]));
  const failedTests = [];
  let visited = 0;
  const rows = value => Array.isArray(value) ? value : [];
  const visit = (suite, inheritedFile, depth = 0) => {
    if (!plain(suite) || depth > 20 || ++visited > 2000) return;
    const file = (typeof suite.file === 'string' ? suite.file : inheritedFile || '').split(/[\\/]/).at(-1);
    for (const spec of rows(suite.specs)) for (const test of rows(spec?.tests)) {
      for (const result of rows(test?.results)) {
        if (!plain(result) || result.status === 'passed' || failedTests.length >= 32 || !files.has(file)) continue;
        const line = Number.isSafeInteger(spec.line) && spec.line > 0 && spec.line < 100000 ? spec.line : null;
        const entry = { file, line, status: statuses.has(result.status) ? result.status : 'unknown' };
        if (!failedTests.some(x => x.file === file && x.line === line && x.status === entry.status)) failedTests.push(entry);
      }
    }
    for (const child of rows(suite.suites)) visit(child, file, depth + 1);
  };
  if (report && Array.isArray(report.suites)) for (const suite of report.suites) visit(suite);
  const reason = !report ? 'REPORT_UNREADABLE' : !Number.isInteger(exitCode) ? 'CHILD_UNCONFIRMED'
    : exitCode !== 0 || stats.unexpected !== 0 || stats.skipped !== 0 || stats.flaky !== 0 ? 'TESTS_FAILED' : 'COVERAGE_MISSING';
  return { reason, exitCode: Number.isInteger(exitCode) && exitCode >= 0 && exitCode <= 255 ? exitCode : null, stats, failedTests };
}

export function safeRestrictedBrowserDiagnostic(value) {
  if (!plain(value) || Object.keys(value).sort().join(',') !== 'exitCode,failedTests,reason,stats'
    || !reasons.has(value.reason) || !(value.exitCode === null || Number.isInteger(value.exitCode) && value.exitCode >= 0 && value.exitCode <= 255)
    || !plain(value.stats) || Object.keys(value.stats).sort().join(',') !== 'expected,flaky,skipped,unexpected'
    || !Object.values(value.stats).every(x => x === null || count(x))
    || !Array.isArray(value.failedTests) || value.failedTests.length > 32) return undefined;
  const failedTests = [];
  for (const row of value.failedTests) {
    if (!plain(row) || Object.keys(row).sort().join(',') !== 'file,line,status' || !files.has(row.file)
      || !(row.line === null || Number.isSafeInteger(row.line) && row.line > 0 && row.line < 100000)
      || !statuses.has(row.status)) return undefined;
    failedTests.push({ file: row.file, line: row.line, status: row.status });
  }
  return { reason: value.reason, exitCode: value.exitCode, stats: { ...value.stats }, failedTests };
}
