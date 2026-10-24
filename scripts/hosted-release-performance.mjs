import { verifyPerformanceBudgets } from './lib/performance-budget-verifier.mjs';
const report = await verifyPerformanceBudgets({ root: process.argv[2], requireServerArtifacts: true });
if (!report.serverArtifacts.available || report.failures.length) {
  console.error('Strict server/client performance verification failed.'); process.exitCode = 1;
} else console.log('Strict server/client performance verification passed.');
