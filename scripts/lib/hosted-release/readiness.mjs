// This module deliberately has only Node built-in imports. The read-only PR job
// loads these exact bytes from the administrator-admitted controller Git object.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export const READINESS_JOB = 'release / merge-readiness';
export const READINESS_FILE = 'hosted-readiness.json';
const workflow = '.github/workflows/hosted-release-controller.yml';
const caller = '.github/workflows/hosted-release.yml';
const normalModules = ['dashboard','markets','review','disputes','buyer_invoices','unofficial_compensation','incoming_payments','cashflow_forecast','brokers','master_contracts','special_terms','hedge_desk','xero_portal','email_router','settings'];
const liveChecks = ['preview_binding','server_bundles','server_performance','restricted_browser','normal_role','fcuno_contract','runtime_parity','live_schema','nom_b','preservation'];
const positive = value => Number.isSafeInteger(value) && value > 0;
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const time = value => typeof value === 'string' ? Date.parse(value) : NaN;
function need(value, code = 'HOSTED_READINESS_INVALID') { if (!value) throw Object.assign(new Error(code), { code }); }
export function readinessCanonical(value) {
  if (value === null || ['string','boolean'].includes(typeof value) || typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(readinessCanonical).join(',')}]`;
  need(value && Object.getPrototypeOf(value) === Object.prototype);
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${readinessCanonical(value[key])}`).join(',')}}`;
}
export const readinessDigest = value => createHash('sha256').update(Buffer.isBuffer(value) || typeof value === 'string' ? value : readinessCanonical(value)).digest('hex');
export const readinessArtifactName = candidateSha => { need(sha(candidateSha)); return `fcos-hosted-readiness-${candidateSha}`; };

/** The switch is installed by the cutover administrator after actual activation.
 * FCOS_HOSTED_CONTROLLER_ADMITTED alone is intentionally insufficient. */
export function admittedReadiness({ enabled, setupJson, setupSha256, activationJson, repository, repositoryId }) {
  if (enabled !== 'true') return null;
  need(typeof setupJson === 'string' && setupJson.length <= 131072 && typeof activationJson === 'string' && activationJson.length <= 4096, 'HOSTED_READINESS_SETUP');
  let setup, activation;
  try { setup = JSON.parse(setupJson); activation = JSON.parse(activationJson); } catch { need(false, 'HOSTED_READINESS_SETUP'); }
  need(setup?.schemaVersion === 2 && sha(setup.controllerSha) && positive(setup.epoch) && hash(setup.targetsSha256)
    && hash(setupSha256) && readinessDigest(setup) === setupSha256 && activation?.schemaVersion === 1 && activation.mode === 'active'
    && activation.controllerSha === setup.controllerSha && activation.epoch === setup.epoch && activation.setupSha256 === setupSha256
    && hash(activation.activationReceiptSha256) && /^[^/]+\/[^/]+$/.test(repository) && positive(Number(repositoryId)), 'HOSTED_READINESS_SETUP');
  return { setup, setupSha256, activation, repository, repositoryId: Number(repositoryId) };
}

export function readReadinessArchive(bytes, filename) {
  need(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 4 * 1024 * 1024 && /^[a-z-]+\.json$/.test(filename));
  const directory = mkdtempSync(join(tmpdir(), 'fcos-hosted-readiness-'));
  try {
    const file = join(directory, 'artifact.zip'); writeFileSync(file, bytes, { mode: 0o600, flag: 'wx' });
    const options = { encoding: 'utf8', timeout: 5000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore','pipe','pipe'] };
    const entries = execFileSync('unzip', ['-Z1',file], options).trim().split('\n');
    need(entries.length === 1 && entries[0] === filename);
    return JSON.parse(execFileSync('unzip', ['-p',file,filename], options));
  } catch { need(false); } finally { rmSync(directory, { recursive: true, force: true }); }
}

function validateRun(run, admission, repository) {
  const reusable = run?.referenced_workflows?.filter(row => row.path === `${admission.repository}/${workflow}@${admission.setup.controllerSha}`);
  need(positive(run?.id) && run.run_attempt === 1 && run.event === 'workflow_dispatch' && run.head_branch === 'main' && sha(run.head_sha)
    && [caller,`${caller}@main`].includes(run.path) && run.repository?.id === admission.repositoryId && run.repository.full_name === admission.repository
    && run.head_repository?.id === admission.repositoryId && run.head_repository.full_name === admission.repository
    && reusable?.length === 1 && reusable[0].sha === admission.setup.controllerSha
    && [run.actor,run.triggering_actor].every(actor => actor?.id === repository.owner.id && actor.login === repository.owner.login));
}
function validateJob(job, run, expectedName) {
  need(positive(job?.id) && job.name === expectedName && job.run_id === run.id && job.run_attempt === 1 && job.head_sha === run.head_sha
    && job.status === 'completed' && job.conclusion === 'success' && Number.isFinite(time(job.started_at))
    && Number.isFinite(time(job.completed_at)) && time(job.completed_at) >= time(job.started_at));
  const steps = job.steps?.filter(step => step.name === 'Run admitted checks');
  need(steps?.length === 1 && steps[0].status === 'completed' && steps[0].conclusion === 'success');
}
function validateArtifact(artifact, run, job, bytes) {
  need(positive(artifact?.id) && artifact.expired === false && artifact.workflow_run?.id === run.id && artifact.workflow_run?.head_sha === run.head_sha
    && artifact.digest === `sha256:${readinessDigest(bytes)}` && Number.isFinite(time(artifact.created_at))
    && time(artifact.created_at) >= time(job.started_at) && time(artifact.created_at) <= time(job.completed_at) + 30000);
}
function completeRows(value, key) {
  need(Array.isArray(value?.[key]) && value.total_count === value[key].length && value.total_count <= 100
    && new Set(value[key].map(row => row.id)).size === value[key].length);
  return value[key];
}

export function validateReadinessBinding({ receipt, admission, candidateSha, now = Date.now() }) {
  const manifest = receipt?.manifest, checks = receipt?.checks;
  need(receipt?.schemaVersion === 1 && receipt.kind === 'fcos_hosted_preview_readiness' && receipt.mode === 'active'
    && receipt.epoch === admission.setup.epoch && receipt.setupSha256 === admission.setupSha256
    && receipt.activationReceiptSha256 === admission.activation.activationReceiptSha256
    && manifest?.schemaVersion === 2 && manifest.contract === 'fcos-hosted-release/v2' && manifest.executionMode === 'release'
    && ['compatibility','application'].includes(manifest.stage) && manifest.epoch === receipt.epoch && manifest.setupSha256 === receipt.setupSha256
    && manifest.targets?.repository === admission.repository && readinessDigest(manifest.targets) === admission.setup.targetsSha256
    && manifest.controller?.sha === admission.setup.controllerSha && manifest.controller.workflow === workflow
    && manifest.candidate?.sha === candidateSha && sha(candidateSha) && hash(manifest.candidate.sourceSha256)
    && receipt.manifestHash === readinessDigest(manifest) && Array.isArray(manifest.requiredChecks)
    && new Set(manifest.requiredChecks).size === manifest.requiredChecks.length && manifest.requiredChecks.length <= 400
    && liveChecks.every(id => manifest.requiredChecks.includes(id)) && checks && Number.isFinite(time(receipt.readyAt)) && time(receipt.readyAt) <= now + 30000);
  need(readinessCanonical(manifest.verification) === readinessCanonical(admission.setup.verification)
    && readinessCanonical(manifest.dependencies || null) === readinessCanonical(admission.setup.dependencies || null));
  for (const id of manifest.requiredChecks) {
    const proof = checks[id], captured = time(proof?.capturedAt);
    need(proof?.schemaVersion === 2 && proof.checkId === id && proof.status === 'passed' && ['volatile','deterministic'].includes(proof.kind)
      && proof.manifestHash === receipt.manifestHash && proof.candidateSha === candidateSha && proof.controllerSha === admission.setup.controllerSha
      && hash(proof.inputsSha256) && hash(proof.artifactSha256) && proof.publisher?.trust === 'hosted_controller'
      && positive(Number(proof.publisher.runId)) && positive(Number(proof.publisher.jobId)) && Number.isFinite(captured) && captured <= now + 30000);
    if (proof.kind === 'volatile') need(positive(proof.maxAgeSeconds) && proof.maxAgeSeconds <= 1800 && now - captured <= proof.maxAgeSeconds * 1000, 'HOSTED_READINESS_EXPIRED');
  }
  const preview = receipt.preview;
  let url; try { url = new URL(preview?.url); } catch { need(false); }
  need(/^dpl_[A-Za-z0-9]+$/.test(preview?.id || '') && preview.sha === candidateSha && preview.state === 'READY' && preview.target === 'preview'
    && preview.projectId === manifest.targets.vercelProject && preview.teamId === manifest.targets.vercelTeam && url.protocol === 'https:'
    && url.hostname.endsWith('.vercel.app') && !url.username && !url.password && !url.port && url.pathname === '/' && !url.search && !url.hash);
  return manifest;
}

/** Re-read the original browser producer jobs and immutable archives, including
 * cached proofs from a previous admitted run. Never refresh their capture time. */
export async function verifyReadinessBrowsers({ receipt, admission, repository, read, now = Date.now() }) {
  const manifest = validateReadinessBinding({ receipt, admission, candidateSha: receipt.manifest?.candidate?.sha, now });
  const prefix = `/repos/${admission.repository}`, cache = new Map();
  const get = path => { if (!cache.has(path)) cache.set(path, read(path)); return cache.get(path); };
  await Promise.all(['restricted','normal_role'].map(async mode => {
    const id = mode === 'restricted' ? 'restricted_browser' : 'normal_role', proof = receipt.checks[id];
    need(proof.kind === 'volatile' && positive(Number(proof.publisher.artifactId)));
    const run = await get(`${prefix}/actions/runs/${proof.publisher.runId}`); validateRun(run, admission, repository);
    const [jobData, artifactData, environment] = await Promise.all([
      get(`${prefix}/actions/runs/${run.id}/attempts/1/jobs?per_page=100`), get(`${prefix}/actions/runs/${run.id}/artifacts?per_page=100`),
      get(`${prefix}/environments/${mode === 'restricted' ? 'fcos-hosted-restricted-verification' : 'fcos-hosted-normal-verification'}`),
    ]);
    need(environment?.name === (mode === 'restricted' ? 'fcos-hosted-restricted-verification' : 'fcos-hosted-normal-verification')
      && positive(environment.id) && environment.can_admins_bypass === false && environment.deployment_branch_policy?.protected_branches === true
      && environment.deployment_branch_policy.custom_branch_policies === false
      && environment.protection_rules?.filter(rule => rule.type === 'required_reviewers').length === 0);
    const jobs = completeRows(jobData, 'jobs'), artifacts = completeRows(artifactData, 'artifacts');
    const artifact = artifacts.find(row => row.id === Number(proof.publisher.artifactId));
    const phase = ['before','after'].find(value => artifact?.name === `fcos-${manifest.releaseId}-${value}-${mode}`);
    need(phase && artifacts.filter(row => row.name === artifact.name).length === 1);
    const matches = jobs.filter(row => row.name === `release / browser / ${phase} / ${mode}`), job = matches[0];
    need(matches.length === 1 && job?.id === Number(proof.publisher.jobId)); validateJob(job, run, matches[0].name);
    const bytes = await read(`${prefix}/actions/artifacts/${artifact.id}/zip`, { bytes: true }); validateArtifact(artifact, run, job, bytes);
    need(readinessDigest(bytes) === proof.artifactSha256);
    const report = readReadinessArchive(bytes, mode === 'restricted' ? 'restricted.json' : 'normal-role.json');
    need(report?.schemaVersion === 2 && report.kind === 'fcos_hosted_browser_raw' && report.status === 'passed' && report.checkId === id
      && report.manifestHash === receipt.manifestHash && report.candidateSha === manifest.candidate.sha && report.controllerSha === manifest.controller.sha
      && report.sourceSha256 === manifest.candidate.sourceSha256 && report.deploymentId === receipt.preview.id && report.candidateUrl === receipt.preview.url
      && report.inputsSha256 === proof.inputsSha256 && report.completedAt === proof.capturedAt && report.capturedAt === proof.capturedAt
      && time(report.capturedAt) >= time(job.started_at) && time(report.capturedAt) <= time(artifact.created_at) + 30000
      && time(report.capturedAt) <= time(job.completed_at) + 30000 && readinessCanonical(report.result) === readinessCanonical(proof.result)
      && report.result?.identity === mode && report.result.actualData === true && report.result.unexpectedWrites === 0
      && Array.isArray(report.result.modules) && readinessCanonical([...report.result.modules].sort()) === readinessCanonical([...(mode === 'restricted' ? ['dashboard','markets','api_denials'] : normalModules)].sort()));
  }));
  return true;
}

/** A passed record in a partially failed group remains reusable, but its
 * original immutable archive and exact observer-produced raw record must match. */
export async function verifyReadinessDeterministic({ receipt, admission, repository, read }) {
  const prefix = `/repos/${admission.repository}`, cache = new Map();
  const get = (path, options) => { if (!cache.has(path)) cache.set(path, read(path, options)); return cache.get(path); };
  await Promise.all(Object.entries(receipt.checks).filter(([id, proof]) => receipt.manifest.requiredChecks.includes(id)
    && proof.kind === 'deterministic' && id !== 'nom_b').map(async ([id, proof]) => {
    const binding = proof.result?.binding;
    need(positive(Number(proof.publisher.artifactId)) && proof.result?.rawCheck?.status === 'passed' && binding
      && readinessDigest(binding) === proof.inputsSha256 && readinessCanonical(binding) === readinessCanonical(proof.result.rawCheck.binding)
      && binding.candidateSha === receipt.manifest.candidate.sha && binding.controllerSha === receipt.manifest.controller.sha
      && binding.sourceProfile === receipt.manifest.candidate.sourceProfile && binding.sourceInputsSha256 === receipt.manifest.candidate.sourceInputsSha256
      && binding.lockSha256 === receipt.manifest.candidate.lockSha256 && binding.configurationSha256 === receipt.manifest.candidate.configurationSha256
      && binding.manifestSha256 === receipt.manifest.controller.checkManifestSha256
      && binding.buildConfigurationSha256 === readinessDigest(receipt.manifest.verification)
      && readinessCanonical(binding.runtime) === readinessCanonical(admission.setup.verification.runtime));
    const run = await get(`${prefix}/actions/runs/${proof.publisher.runId}`); validateRun(run, admission, repository);
    const [jobData, artifactData] = await Promise.all([get(`${prefix}/actions/runs/${run.id}/attempts/1/jobs?per_page=100`),
      get(`${prefix}/actions/runs/${run.id}/artifacts?per_page=100`)]);
    const jobs = completeRows(jobData, 'jobs'), artifacts = completeRows(artifactData, 'artifacts');
    const artifact = artifacts.find(row => row.id === Number(proof.publisher.artifactId));
    const group = ['code','database','fixtures'].find(value => artifact?.name === `fcos-${receipt.manifest.releaseId}-${value}`);
    need(group && artifacts.filter(row => row.name === artifact.name).length === 1);
    const matches = jobs.filter(row => row.name === `release / checks / ${group}`), job = matches[0];
    need(matches.length === 1 && job?.id === Number(proof.publisher.jobId)); validateJob(job, run, matches[0].name);
    const bytes = await get(`${prefix}/actions/artifacts/${artifact.id}/zip`, { bytes: true });
    need(Buffer.isBuffer(bytes)); validateArtifact(artifact, run, job, bytes); need(readinessDigest(bytes) === proof.artifactSha256);
    const report = readReadinessArchive(bytes, `${group}.json`), raw = report?.checks?.filter(row => row.checkId === id);
    need(report?.schemaVersion === 2 && report.kind === 'fcos_hosted_release_checks' && ['passed','failed','waiting_dependency'].includes(report.status)
      && report.candidateSha === receipt.manifest.candidate.sha && report.controllerSha === receipt.manifest.controller.sha
      && readinessCanonical(report.runtime) === readinessCanonical(admission.setup.verification.runtime)
      && raw?.length === 1 && readinessCanonical(raw[0]) === readinessCanonical(proof.result.rawCheck)
      && raw[0].completedAt === proof.capturedAt && raw[0].status === 'passed'
      && time(raw[0].completedAt) >= time(job.started_at) && time(raw[0].completedAt) <= time(job.completed_at) + 30000
      && Array.isArray(raw[0].commands) && raw[0].commands.length > 0 && raw[0].commands.every(command => command.exitCode === 0));
  }));
  return true;
}

export async function consumeHostedReadiness({ admission, candidateSha, read, now = Date.now }) {
  if (!admission) return { status: 'disabled', accepted: false };
  need(sha(candidateSha));
  const clock = typeof now === 'function' ? now : () => now;
  const prefix = `/repos/${admission.repository}`;
  const [repository, branch, listed] = await Promise.all([read(prefix),read(`${prefix}/branches/main`),
    read(`${prefix}/actions/artifacts?name=${readinessArtifactName(candidateSha)}&per_page=20`)]);
  need(repository?.id === admission.repositoryId && repository.full_name === admission.repository && repository.default_branch === 'main'
    && positive(repository.owner?.id) && repository.owner.login === admission.repository.split('/')[0] && repository.archived !== true
    && branch?.name === 'main' && branch.protected === true && sha(branch.commit?.sha));
  need(Array.isArray(listed?.artifacts) && listed.artifacts.length <= 20 && new Set(listed.artifacts.map(row => row.id)).size === listed.artifacts.length);
  let invalid = false;
  for (const artifact of listed.artifacts) {
    if (artifact.name !== readinessArtifactName(candidateSha) || artifact.expired !== false || !positive(artifact.workflow_run?.id)) continue;
    try {
      const run = await read(`${prefix}/actions/runs/${artifact.workflow_run.id}`); validateRun(run, admission, repository);
      const jobs = completeRows(await read(`${prefix}/actions/runs/${run.id}/attempts/1/jobs?per_page=100`), 'jobs');
      const matches = jobs.filter(row => row.name === READINESS_JOB);
      if (matches.length === 1 && matches[0].status !== 'completed') continue;
      need(matches.length === 1); const job = matches[0]; validateJob(job, run, READINESS_JOB);
      const bytes = await read(`${prefix}/actions/artifacts/${artifact.id}/zip`, { bytes: true }); validateArtifact(artifact, run, job, bytes);
      const receipt = readReadinessArchive(bytes, READINESS_FILE); validateReadinessBinding({ receipt, admission, candidateSha, now: clock() });
      await Promise.all([verifyReadinessBrowsers({ receipt, admission, repository, read, now: clock() }), verifyReadinessDeterministic({ receipt, admission, repository, read })]);
      // Download latency and rate limiting do not extend the original proof TTL.
      validateReadinessBinding({ receipt, admission, candidateSha, now: clock() });
      return { status: 'passed', accepted: true, runId: run.id, artifactId: artifact.id, artifactSha256: readinessDigest(bytes), manifestHash: receipt.manifestHash };
    } catch { invalid = true; }
  }
  return { status: 'waiting_dependency', accepted: false, code: invalid ? 'HOSTED_READINESS_INVALID' : 'HOSTED_READINESS_PENDING' };
}

/** Reserve capacity for bootstrap reads, with at most two in-flight GETs.
 * Complete archives and immutable run identity are retained across list polls. */
export function createReadinessReader({ read, now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const cache = new Map(), queue = [], starts = []; let running = 0, pumping = false;
  const pump = async () => {
    if (pumping) return; pumping = true;
    try {
      while (queue.length && running < 2) {
        while (starts.length && now() - starts[0] >= 60000) starts.shift();
        if (starts.length >= 40) { await wait(Math.max(1, 60000 - (now() - starts[0]))); continue; }
        const task = queue.shift(); starts.push(now()); running++;
        Promise.resolve().then(() => read(task.path, task.options)).then(task.resolve, task.reject).finally(() => { running--; void pump(); });
      }
    } finally { pumping = false; }
  };
  return (path, options = {}) => {
    const immutable = options.bytes === true || /\/actions\/runs\/[1-9][0-9]*$/.test(path);
    const key = `${options.bytes ? 'bytes:' : ''}${path}`;
    if (immutable && cache.has(key)) return cache.get(key);
    const result = new Promise((resolve, reject) => { queue.push({ path, options, resolve, reject }); void pump(); });
    if (immutable) { cache.set(key, result); result.catch(() => cache.delete(key)); }
    return result;
  };
}

export async function waitForHostedReadiness({ admission, candidateSha, read, now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 121 }) {
  need(Number.isSafeInteger(attempts) && attempts >= 1 && attempts <= 121);
  if (!admission) return { status: 'disabled', accepted: false };
  const start = now(); let result;
  const boundedRead = createReadinessReader({ read, now, wait });
  for (let attempt = 0; attempt < attempts; attempt++) {
    result = await consumeHostedReadiness({ admission, candidateSha, read: boundedRead, now });
    if (result.accepted) return result;
    if (attempt + 1 === attempts || now() - start >= 3600000) return { ...result, code: 'HOSTED_READINESS_TIMEOUT', dependencyCode: result.code };
    await wait(30000);
  }
  return result;
}
