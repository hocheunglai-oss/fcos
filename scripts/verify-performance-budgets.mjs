import { verifyPerformanceBudgets } from './lib/performance-budget-verifier.mjs';

const report = await verifyPerformanceBudgets();
for (const warning of report.warnings) process.stdout.write(`[performance budget] ${warning}\n`);
for (const assurance of report.sourceAssurances) {
  process.stdout.write(`[performance budget] Static source assurance ${assurance.name}: ${assurance.actual}/${assurance.limit}.\n`);
}
if (report.failures.length) {
  for (const failure of report.failures) process.stderr.write(`[performance budget] ${failure}\n`);
  process.exit(1);
}

const serverStatus = report.serverArtifacts.available ? 'server bundle checks complete' : 'server bundle checks unavailable (frontend-only result)';
process.stdout.write(`Performance budgets passed (${report.dispatcherLines} dispatcher lines; ${serverStatus}).\n`);
