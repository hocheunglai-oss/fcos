import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const repository = 'hocheunglai-oss/fcos';
const workflow = '.github/workflows/hosted-release-toolchain.yml';
const positive = value => Number.isSafeInteger(value) && value > 0;
const reject = () => { throw new Error('TOOLCHAIN_PUBLICATION_NOT_ADMITTED'); };
const bootstrapWorkflow = '.github/workflows/authenticated-release.yml';
const sha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

// This public binding authenticates the reviewed dispatch context, not a live
// database lease. The original operator must retain and assert that actual lease
// until definitive registry readback; no hosted database credential is accepted.
export function toolchainEpochPublication(env, binding) {
  if (env.FCOS_HOSTED_TOOLCHAIN_EPOCH_PUBLICATION_ENABLED !== 'true') {
    if (!['false', undefined, ''].includes(env.FCOS_HOSTED_TOOLCHAIN_EPOCH_PUBLICATION_ENABLED)) reject();
    return null;
  }
  if (env.FCOS_HOSTED_TOOLCHAIN_SETUP_ENABLED !== 'false') reject();
  let publication;
  try { publication = JSON.parse(env.FCOS_HOSTED_TOOLCHAIN_EPOCH_PUBLICATION); } catch { reject(); }
  if (createHash('sha256').update(env.FCOS_HOSTED_TOOLCHAIN_EPOCH_PUBLICATION).digest('hex') !== env.FCOS_HOSTED_TOOLCHAIN_EPOCH_PUBLICATION_SHA256
    || !exactKeys(publication, ['kind', 'schemaVersion', 'epoch', 'mode', 'activated', 'qualificationAdmitted', 'sourceSha', 'intentSha256', 'bootstrapSha', 'callerWorkflowRef', 'rootReviewSha256', 'scopeSha256', 'lease'])
    || publication.kind !== 'fcos_hosted_toolchain_epoch_publication_v1' || publication.schemaVersion !== 1
    || publication.epoch !== 1 || publication.mode !== 'qualification' || publication.activated !== false || publication.qualificationAdmitted !== false
    || publication.sourceSha !== binding.controllerSha || publication.bootstrapSha !== binding.bootstrapSha
    || publication.callerWorkflowRef !== binding.callerWorkflowRef || publication.intentSha256 !== env.INTENT_SHA256
    || !sha256(publication.intentSha256) || !sha256(publication.rootReviewSha256) || !sha256(publication.scopeSha256)) reject();
  const lease = publication.lease;
  if (!exactKeys(lease, ['epoch', 'objective', 'ownerThreadId', 'operationId', 'bindingSha256', 'leaseId', 'coordinationOnly', 'providerAuthorityGranted', 'uncertainOutcomeRequiresReadback'])
    || lease.epoch !== 'fcos-hosted-admin-epoch1' || lease.objective !== 'production'
    || lease.ownerThreadId !== '01a0f08b-7fcb-7870-9edc-343e16052b62'
    || ![lease.ownerThreadId, lease.operationId].every(value => typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value && !/\s/.test(value))
    || !sha256(lease.bindingSha256) || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(lease.leaseId || '')
    || lease.coordinationOnly !== true || lease.providerAuthorityGranted !== false || lease.uncertainOutcomeRequiresReadback !== true) reject();
  return publication;
}

export function toolchainSourceContext(env) {
  if (env.GITHUB_REPOSITORY !== repository || env.GITHUB_REPOSITORY_ID !== '1278654816'
    || env.GITHUB_REF_PROTECTED !== 'true' || env.GITHUB_RUN_ATTEMPT !== '1') reject();
  let binding;
  try { binding = JSON.parse(env.FCOS_HOSTED_TOOLCHAIN_BOOTSTRAP); } catch { reject(); }
  if (createHash('sha256').update(env.FCOS_HOSTED_TOOLCHAIN_BOOTSTRAP).digest('hex') !== env.FCOS_HOSTED_TOOLCHAIN_BOOTSTRAP_SHA256
    || binding?.schemaVersion !== 1 || binding.repository !== repository || binding.repositoryId !== '1278654816'
    || !/^refs\/heads\/codex\/hosted-qualification-[a-z0-9-]+$/.test(binding.ref || '')
    || !/^[a-f0-9]{40}$/.test(binding.bootstrapSha || '') || !/^[a-f0-9]{40}$/.test(binding.controllerSha || '')
    || binding.callerWorkflowRef !== `${repository}/${bootstrapWorkflow}@${binding.ref}`
    || env.GITHUB_REF !== binding.ref || env.GITHUB_SHA !== binding.bootstrapSha
    || env.GITHUB_WORKFLOW_REF !== binding.callerWorkflowRef || env.SOURCE_SHA !== binding.controllerSha
    || env.ADMITTED_SOURCE_SHA !== binding.controllerSha) reject();
  const publication = toolchainEpochPublication(env, binding);
  if (!publication && env.FCOS_HOSTED_TOOLCHAIN_SETUP_ENABLED !== 'true') reject();
  return { branch: binding.ref.slice('refs/heads/'.length), workflow: bootstrapWorkflow, binding, ...(publication ? { publication } : {}) };
}

export function admitToolchainRun({ runs, runId, intentSha256, sourceContext }) {
  if (!sourceContext?.binding || sourceContext.workflow !== bootstrapWorkflow
    || !Array.isArray(runs) || !positive(runId) || !/^[a-f0-9]{64}$/.test(intentSha256 || '')
    || runs.some(run => !positive(run.id) || !positive(run.run_number))
    || new Set(runs.map(run => run.id)).size !== runs.length
    || new Set(runs.map(run => run.run_number)).size !== runs.length) reject();
  const current = runs.find(run => run.id === runId);
  if (!current || current.run_attempt !== 1 || current.event !== 'workflow_dispatch' || current.status !== 'in_progress'
    || current.conclusion !== null || current.head_branch !== sourceContext.branch || !/^[a-f0-9]{40}$/.test(current.head_sha || '')
    || ![sourceContext.workflow, `${sourceContext.workflow}@${sourceContext.branch}`].includes(current.path)
    || current.repository?.id !== 1278654816 || current.repository.full_name !== repository
    || current.head_repository?.id !== 1278654816 || current.head_repository.full_name !== repository
    || [current.actor, current.triggering_actor].some(actor => actor?.id !== 265701760 || actor.login !== 'hocheunglai-oss')
    || current.display_title !== `FCOS toolchain ${intentSha256}`) reject();
  if (sourceContext.binding) {
    const expected = `${repository}/${workflow}@${sourceContext.binding.controllerSha}`;
    const matches = current.referenced_workflows?.filter(row => row.path === expected && row.sha === sourceContext.binding.controllerSha);
    if (current.head_sha !== sourceContext.binding.bootstrapSha || matches?.length !== 1) reject();
  }
  // Missing/deleted/eventually unlisted earlier runs cannot prove an unused intent.
  const earlier = runs.filter(run => run.run_number < current.run_number);
  if (earlier.length !== current.run_number - 1 || earlier.some(run => run.display_title === current.display_title)) reject();
  return { admitted: true, runId, intentSha256, runNumber: current.run_number };
}

export async function toolchainAdmission({ env = process.env, fetchImpl = fetch } = {}) {
  const sourceContext = toolchainSourceContext(env);
  if (!env.GITHUB_TOKEN) reject();
  const prefix = `https://api.github.com/repos/${repository}`;
  const read = async suffix => {
    const response = await fetchImpl(`${prefix}${suffix}`, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' } });
    if (!response.ok || response.redirected) reject();
    return response.json();
  };
  const identity = await read(''), branch = await read(`/branches/${encodeURIComponent(sourceContext.branch)}`);
  if (identity.id !== 1278654816 || identity.full_name !== repository || identity.default_branch !== 'main' || identity.archived
    || branch.name !== sourceContext.branch || branch.protected !== true
    || sourceContext.binding && branch.commit?.sha !== sourceContext.binding.bootstrapSha) reject();
  const actual = sourceContext.binding ? await read(`/actions/runs/${env.GITHUB_RUN_ID}`) : null;
  const runs = []; let total;
  for (let page = 1; page <= 10; page++) {
    const result = await read(`/actions/workflows/${sourceContext.workflow.split('/').at(-1)}/runs?per_page=100&page=${page}`);
    if (!Number.isSafeInteger(result.total_count) || result.total_count < 1 || result.total_count > 1000
      || total !== undefined && result.total_count !== total || !Array.isArray(result.workflow_runs) || result.workflow_runs.length > 100) reject();
    total = result.total_count; runs.push(...result.workflow_runs);
    if (runs.length === total) {
      if (actual) {
        const index = runs.findIndex(run => run.id === Number(env.GITHUB_RUN_ID));
        if (index < 0 || ['id', 'run_number', 'run_attempt', 'head_sha', 'head_branch', 'display_title'].some(key => runs[index][key] !== actual[key])) reject();
        runs[index] = actual;
      }
      return admitToolchainRun({ runs, runId: Number(env.GITHUB_RUN_ID), intentSha256: env.INTENT_SHA256, sourceContext });
    }
    if (!result.workflow_runs.length || runs.length > total) reject();
  }
  reject();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) toolchainAdmission().then(result => {
  console.log(JSON.stringify(result));
}).catch(() => { console.error('TOOLCHAIN_PUBLICATION_NOT_ADMITTED'); process.exitCode = 1; });
