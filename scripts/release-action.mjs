import { runReleaseCoordinationProof } from './release-coordination-proof.mjs';
import { productionReleaseArguments, runProductionRelease } from './production-release.mjs';
import { runtimeCompatibilityReleaseArguments, runRuntimeCompatibilityRelease } from './runtime-compatibility-release.mjs';

// The action uses protected-main source. Runtime credentials stay in this one
// process; nothing exports an artifact token to GITHUB_ENV or job outputs.
try {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_RUN_ATTEMPT !== '1') throw new Error('Protected original action required.');
  let result;
  if (process.env.INPUT_ROUTE === 'production') result = await runProductionRelease(productionReleaseArguments(['--execute']));
  else if (process.env.INPUT_ROUTE === 'compatibility') result = await runRuntimeCompatibilityRelease(runtimeCompatibilityReleaseArguments(['--execute']));
  else if (process.env.INPUT_ROUTE === 'proof') result = await runReleaseCoordinationProof();
  else throw new Error('Unrecognized protected executor.');
  console.log(JSON.stringify(result));
} catch {
  console.error('Protected coordinated release blocked or uncertain. Preserve the original operation and lease for read-only recovery.');
  process.exitCode = 1;
}
