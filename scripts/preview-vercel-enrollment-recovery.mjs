import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { enrollmentRecoveryPlan, runFixedEnrollmentRecovery } from './lib/preview-vercel-enrollment-recovery.mjs';

// Default invocation performs no authenticated, provider or private I/O.
// Only the fixed native implementation can consume private-action admission.
export async function enrollmentRecoveryMain(args = process.argv.slice(2)) {
  if (!args.length || args.length === 1 && args[0] === '--plan') return enrollmentRecoveryPlan();
  return runFixedEnrollmentRecovery(args);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await enrollmentRecoveryMain())); }
  catch { console.error('Preview enrollment recovery refused; original consumption and lease require root GET-only reconciliation.'); process.exitCode = 1; }
}
