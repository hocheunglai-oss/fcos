import { fcosConnectionIdentifier } from '../../config/fcosConnections.js';

export const ROUTINE_RELEASE_WORKFLOW = '.github/workflows/routine-release.yml';
export const ROUTINE_RELEASE_ENABLE = 'FCOS_ROUTINE_RELEASE_ENABLED';
const repository = fcosConnectionIdentifier('github', 'Repository');
const operator = fcosConnectionIdentifier('github', 'Required account');
const positive = value => Number.isSafeInteger(value) && value > 0;
const time = value => typeof value === 'string' ? Date.parse(value) : NaN;
const fresh = (value, now) => Number.isFinite(time(value)) && time(value) <= now + 30000 && now - time(value) <= 1800000;
const fail = () => { throw new Error('Coordinated release requires exact successful first-attempt verification jobs and current protected-main identity.'); };
export const routineReleasePath = (path, branch) => [ROUTINE_RELEASE_WORKFLOW, `${ROUTINE_RELEASE_WORKFLOW}@${branch}`].includes(path);

export function assertRoutineReleaseJobs({ run, jobs, branch, repository: targetRepository, now = Date.now() }) {
  if (!run || !positive(run.id) || run.repository?.full_name !== repository || run.head_repository?.full_name !== repository
    || targetRepository?.full_name !== repository || !positive(targetRepository.id) || run.repository.id !== targetRepository.id || run.head_repository.id !== targetRepository.id || run.head_branch !== branch?.name
    || branch.protected !== true || !/^[a-f0-9]{40}$/.test(branch.commit?.sha || '') || run.head_sha !== branch.commit.sha
    || !routineReleasePath(run.path, branch.name) || run.event !== 'workflow_dispatch' || run.run_attempt !== 1
    || run.actor?.login !== operator || !positive(run.actor.id) || run.triggering_actor?.login !== operator
    || run.triggering_actor.id !== run.actor.id || !fresh(run.run_started_at, now)
    || run.status !== 'completed' || run.conclusion !== 'success'
    || jobs?.total_count !== 3 || !Array.isArray(jobs.jobs) || jobs.jobs.length !== 3
    || new Set(jobs.jobs.map(job => job.id)).size !== 3) fail();
  const selected = {};
  for (const name of ['require-default-branch-dispatch', 'authenticated-candidate', 'normal-role']) {
    const matches = jobs.jobs.filter(job => job.name === name), job = matches[0];
    if (matches.length !== 1 || !positive(job?.id) || job.run_id !== run.id || job.run_attempt !== 1 || job.head_sha !== run.head_sha) fail();
    if (!Number.isFinite(time(job.started_at)) || time(job.started_at) < time(run.run_started_at) || time(job.started_at) > now + 30000) fail();
    if (job.status !== 'completed' || job.conclusion !== 'success' || !fresh(job.completed_at, now)
      || time(job.completed_at) < time(job.started_at)) fail();
    selected[name] = job;
  }
  for (const name of ['authenticated-candidate', 'normal-role']) {
    if (time(selected[name].started_at) < time(selected['require-default-branch-dispatch'].completed_at)) fail();
  }
  return selected;
}

export function assertRoutineArtifactTime({ artifact, job, capturedAt, now = Date.now() }) {
  if (!fresh(artifact?.created_at, now) || time(artifact.created_at) < time(job?.started_at)
    || time(artifact.created_at) > time(job?.completed_at)
    || capturedAt !== undefined && (!fresh(capturedAt, now) || time(capturedAt) < time(job.started_at) || time(capturedAt) > time(artifact.created_at))) fail();
  return job.completed_at;
}

// A failed authenticated-browser consumption job does not undo successful code,
// database or dependency tests. Reuse only those exact completed jobs; release
// readiness independently still requires real protected authentication evidence.
export function assertReusableQualityJobs({ run, jobs, artifact, payload, repository: targetRepository, now = Date.now() }) {
  if (targetRepository?.full_name !== repository || !positive(targetRepository.id) || run?.repository?.full_name !== repository
    || run.repository.id !== targetRepository.id || run.head_repository?.full_name !== repository || run.head_repository.id !== targetRepository.id
    || run.status !== 'completed' || run.conclusion !== 'failure' || run.event !== 'pull_request' || run.run_attempt !== 1
    || !positive(run.id) || !fresh(run.updated_at, now) || !Number.isFinite(time(run.run_started_at))
    || !Array.isArray(jobs?.jobs) || jobs.total_count !== 3 || jobs.jobs.length !== 3
    || new Set(jobs.jobs.map(job => job.id)).size !== 3) throw new Error('Exact reusable quality jobs are unavailable.');
  const selected = {};
  for (const name of ['code-and-database', 'dependency-review', 'authenticated-browser']) {
    const matches = jobs.jobs.filter(job => job.name === name), job = matches[0];
    if (matches.length !== 1 || !positive(job?.id) || job.run_id !== run.id || job.run_attempt !== 1 || job.head_sha !== run.head_sha
      || job.status !== 'completed' || job.conclusion !== (name === 'authenticated-browser' ? 'failure' : 'success')
      || !Number.isFinite(time(job.started_at)) || time(job.started_at) < time(run.run_started_at)
      || time(job.completed_at) < time(job.started_at) || !fresh(job.completed_at, now)) throw new Error('Exact reusable quality jobs are unavailable.');
    selected[name] = job;
  }
  const job = selected['code-and-database'];
  if (!fresh(artifact?.created_at, now) || time(artifact.created_at) < time(job.started_at) || time(artifact.created_at) > time(job.completed_at)
    || !fresh(payload?.capturedAt, now) || time(payload.capturedAt) < time(job.started_at)
    || time(payload.capturedAt) > time(artifact.created_at)) throw new Error('Original quality artifact time is unavailable.');
  return true;
}
