import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectPreviewParity } from './collect-preview-parity.mjs';
import { createReleaseReadiness } from './lib/release-readiness.mjs';

export async function collectReleaseReadiness(options = {}) {
  const parity = await collectPreviewParity(options);
  return createReleaseReadiness({ source: parity.source, candidate: parity.candidate, production: parity.production, parity,
    evidence: parity.trustedEvidence, quality: parity.quality, lockHash: parity.binding.lockHash,
    configurationRevision: parity.binding.configurationRevision });
}

export function readinessArguments(args, env = process.env) {
  const options = { candidateUrl: env.FCOS_E2E_CANDIDATE_URL, expectedCommit: env.FCOS_E2E_EXPECTED_COMMIT };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === '--json' || key === '--read-only') continue;
    if (!['--candidate', '--commit'].includes(key) || seen.has(key) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Use --candidate <immutable-origin> --commit <exact-SHA>; unknown or duplicate arguments are rejected.');
    seen.add(key);
    options[key === '--candidate' ? 'candidateUrl' : 'expectedCommit'] = args[++index];
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  collectReleaseReadiness(readinessArguments(process.argv.slice(2))).then(receipt => {
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    if (!receipt.ready) process.exitCode = 1;
  }).catch(() => { console.error('Release readiness collection failed. A clean exact-commit checkout and verified read-only provider access are required.'); process.exitCode = 1; });
}
