import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = 'hocheunglai-oss/fcos';
const workflow = '.github/workflows/hosted-release-toolchain.yml';
const positive = value => Number.isSafeInteger(value) && value > 0;
const reject = () => { throw new Error('TOOLCHAIN_PUBLICATION_NOT_ADMITTED'); };

export function admitToolchainRun({ runs, runId, intentSha256 }) {
  if (!Array.isArray(runs) || !positive(runId) || !/^[a-f0-9]{64}$/.test(intentSha256 || '')
    || runs.some(run => !positive(run.id) || !positive(run.run_number))
    || new Set(runs.map(run => run.id)).size !== runs.length
    || new Set(runs.map(run => run.run_number)).size !== runs.length) reject();
  const current = runs.find(run => run.id === runId);
  if (!current || current.run_attempt !== 1 || current.event !== 'workflow_dispatch' || current.status !== 'in_progress'
    || current.conclusion !== null || current.head_branch !== 'main' || !/^[a-f0-9]{40}$/.test(current.head_sha || '')
    || ![workflow, `${workflow}@main`].includes(current.path)
    || current.repository?.id !== 1278654816 || current.repository.full_name !== repository
    || current.head_repository?.id !== 1278654816 || current.head_repository.full_name !== repository
    || [current.actor, current.triggering_actor].some(actor => actor?.id !== 265701760 || actor.login !== 'hocheunglai-oss')
    || current.display_title !== `FCOS toolchain ${intentSha256}`) reject();
  // Missing/deleted/eventually unlisted earlier runs cannot prove an unused intent.
  const earlier = runs.filter(run => run.run_number < current.run_number);
  if (earlier.length !== current.run_number - 1 || earlier.some(run => run.display_title === current.display_title)) reject();
  return { admitted: true, runId, intentSha256, runNumber: current.run_number };
}

export async function toolchainAdmission({ env = process.env, fetchImpl = fetch } = {}) {
  if (env.GITHUB_REPOSITORY !== repository || env.GITHUB_REPOSITORY_ID !== '1278654816' || env.GITHUB_REF !== 'refs/heads/main'
    || env.GITHUB_REF_PROTECTED !== 'true' || env.GITHUB_RUN_ATTEMPT !== '1' || !env.GITHUB_TOKEN) reject();
  const prefix = `https://api.github.com/repos/${repository}`;
  const read = async suffix => {
    const response = await fetchImpl(`${prefix}${suffix}`, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' } });
    if (!response.ok || response.redirected) reject();
    return response.json();
  };
  const identity = await read(''), branch = await read('/branches/main');
  if (identity.id !== 1278654816 || identity.full_name !== repository || identity.default_branch !== 'main' || identity.archived
    || branch.name !== 'main' || branch.protected !== true) reject();
  const runs = []; let total;
  for (let page = 1; page <= 10; page++) {
    const result = await read(`/actions/workflows/hosted-release-toolchain.yml/runs?per_page=100&page=${page}`);
    if (!Number.isSafeInteger(result.total_count) || result.total_count < 1 || result.total_count > 1000
      || total !== undefined && result.total_count !== total || !Array.isArray(result.workflow_runs) || result.workflow_runs.length > 100) reject();
    total = result.total_count; runs.push(...result.workflow_runs);
    if (runs.length === total) return admitToolchainRun({ runs, runId: Number(env.GITHUB_RUN_ID), intentSha256: env.INTENT_SHA256 });
    if (!result.workflow_runs.length || runs.length > total) reject();
  }
  reject();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) toolchainAdmission().then(result => {
  console.log(JSON.stringify(result));
}).catch(() => { console.error('TOOLCHAIN_PUBLICATION_NOT_ADMITTED'); process.exitCode = 1; });
