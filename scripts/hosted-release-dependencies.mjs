import { readFileSync, realpathSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectFinancialPreservation, dependencyHash, importAcceptedNomB } from './lib/hosted-release/dependencies.mjs';
import { loadDependencySetup, measureHostedNomBInputs } from './lib/hosted-release/dependency-publisher.mjs';

const permittedCredentials = new Set(['GITHUB_TOKEN','FCOS_HOSTED_GITHUB_READ_TOKEN','FCOS_HOSTED_SALESFORCE_READ_TOKEN']);
function requireProducerEnvironment(env) {
  if (Object.entries(env).some(([key, value]) => value && (key.startsWith('ACTIONS_ID_TOKEN_REQUEST_')
    || /(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY|CREDENTIAL)/.test(key) && !permittedCredentials.has(key)))) {
    const error = new Error('DEPENDENCY_PRODUCER_CREDENTIAL_FORBIDDEN'); error.code = error.message; throw error;
  }
}
const waiting = (checkId, missing) => ({ status: 'waiting_dependency', checkId, missing });
const safeError = checkId => ({ status: 'failed', checkId, code: `${checkId.toUpperCase()}_DEPENDENCY_REVALIDATION_REQUIRED` });

/** Raw producer only: trusted controller files perform bounded reads, candidate
 * files are data, and this process has no coordinator/OIDC/provider-write authority.
 */
export async function hostedDependencies({ env = process.env, sessionFactory, readManifest, readFile = readFileSync,
  measure = measureHostedNomBInputs, preserve = collectFinancialPreservation, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  requireProducerEnvironment(env);
  const phase = env.FCOS_VERIFICATION_PHASE || 'before';
  if (!['before','after'].includes(phase)) throw new Error('DEPENDENCY_PHASE_INVALID');
  const parse = readManifest || (await import('./lib/hosted-release/session.mjs')).readManifest;
  const manifest = parse(env.FCOS_RELEASE_MANIFEST), candidateDirectory = resolve(env.FCOS_CANDIDATE_DIRECTORY || 'candidate');
  const controllerDirectory = resolve(env.FCOS_CONTROLLER_DIRECTORY || 'controller');
  const session = await (sessionFactory || (await import('./lib/hosted-release/session.mjs')).hostedSession)({ manifest, candidateDirectory, controllerDirectory,
    env, jobName: `release / dependencies / ${phase}`, requireOidc: false });
  if (session.coordinator) throw new Error('DEPENDENCY_PRODUCER_AUTHORITY_FORBIDDEN');
  const startedAt = new Date(now()).toISOString(), checks = [];
  let setup;
  try { setup = loadDependencySetup({ manifest, env, readFile }); }
  catch (error) {
    if (error.code !== 'DEPENDENCY_SETUP_PENDING') throw error;
    setup = { nomBMissing: ['manifest_pinned_dependency_setup_files_pending'], preservationMissing: ['manifest_pinned_dependency_setup_files_pending'] };
  }
  let nomBMeasurement;
  if (setup.nomBMissing) checks.push(waiting('nom_b', setup.nomBMissing));
  else {
    try {
      const measured = await measure({ manifest, ...setup.nomB, admission: session.admission, candidateDirectory, controllerDirectory,
        setupDirectory: env.FCOS_HOSTED_DEPENDENCY_SETUP_DIRECTORY, env, fetchImpl, now });
      if (measured?.status === 'waiting_dependency') checks.push(waiting('nom_b', measured.missing));
      else {
        nomBMeasurement = measured.receipt;
        checks.push(await importAcceptedNomB({ manifest, ...setup.nomB, measureInputs: async () => measured, now }));
      }
    } catch { checks.push(safeError('nom_b')); }
  }
  if (setup.preservationMissing) checks.push(waiting('preservation', setup.preservationMissing));
  else {
    try { checks.push(await preserve({ manifest, ...setup.preservation, env, now })); }
    catch { checks.push(safeError('preservation')); }
  }
  return { schemaVersion: 2, kind: 'fcos_hosted_dependencies_raw', phase,
    status: checks.some(row => row.status === 'failed') ? 'failed' : checks.some(row => row.status === 'waiting_dependency') ? 'waiting_dependency' : 'passed',
    manifestHash: dependencyHash(manifest), candidateSha: manifest.candidate.sha, controllerSha: manifest.controller.sha,
    startedAt, completedAt: new Date(now()).toISOString(), checks, ...(nomBMeasurement ? { nomBMeasurement } : {}) };
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  hostedDependencies().then(report => {
    const file = resolve(process.env.FCOS_RELEASE_OUTPUT || 'dependencies.json'); mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify({ status: report.status, missing: report.checks.filter(row => row.status === 'waiting_dependency').flatMap(row => row.missing) }));
    // Partial successful raw evidence is independently published; readiness remains closed.
  }).catch(error => { console.error(JSON.stringify({ status: 'failed', code: /^[A-Z_]+$/.test(error.code || '') ? error.code : 'DEPENDENCY_ENTRYPOINT_FAILED' })); process.exitCode = 1; });
}
