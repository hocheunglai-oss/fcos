import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { successorAttestationPlan, runFixedSuccessorAttestation } from './lib/preview-vercel-successor-attestation.mjs';

// Only the fixed native implementation can obtain publication admission.
// Default invocation performs no authenticated, provider or private I/O.
export async function successorAttestationMain(args = process.argv.slice(2)) {
  if (!args.length || args.length === 1 && args[0] === '--plan') return successorAttestationPlan();
  return runFixedSuccessorAttestation(args);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await successorAttestationMain())); }
  catch {
    console.error('Exact successor attestation unavailable or uncertain; retain original nonce and canonical lease for GET-only recovery.');
    process.exitCode = 1;
  }
}
