import { setTimeout as sleep } from 'node:timers/promises';
import { ReleaseError } from './json-contract.mjs';
import { assertCurrentHostedJobIdentity, safeCurrentJobIdentity } from './current-job-identity.mjs';
import { awaitGitHubRead } from './github.mjs';

const refuse = predicate => { throw new ReleaseError('CURRENT_HOSTED_JOB_IDENTITY', 'admission',
  'Correct the bound inputs before starting a new operation.', {
    currentJobIdentity: safeCurrentJobIdentity({ failedPredicates: [predicate] }),
  }); };

// Future acquisition only. A previously refused session is never resumed here.
// Each successful snapshot is one complete page, never opaque pagination.
export async function acquireCurrentHostedJob({ github, repository, run, jobName, env, qualificationSource,
  qualificationRunVerified = false, deadlineEpochMs = Infinity, signal, now = Date.now, delay = sleep }) {
  const start = now();
  if (!Number.isFinite(start) || deadlineEpochMs !== Infinity && !Number.isFinite(deadlineEpochMs)) refuse('VISIBILITY_WINDOW');
  const deadline = Math.min(start + 10000, deadlineEpochMs);
  if (deadline <= start) refuse('VISIBILITY_WINDOW');
  const windowSignal = AbortSignal.any([AbortSignal.timeout(Math.ceil(deadline - start)), ...(signal ? [signal] : [])]);
  const gate = () => {
    if (signal?.aborted) refuse('VISIBILITY_CANCELLED');
    if (windowSignal.aborted || !Number.isFinite(now()) || now() >= deadline) refuse('VISIBILITY_WINDOW');
  };
  const path = `/repos/${repository}/actions/runs/${env.GITHUB_RUN_ID}/attempts/1/jobs?per_page=100&page=1`;
  const read = async () => {
    gate();
    const snapshot = await github.read(path, { timeoutMs: Math.max(1, Math.floor(deadline - now())), signal: windowSignal });
    gate();
    if (!snapshot || !Number.isSafeInteger(snapshot.total_count) || snapshot.total_count < 0 || snapshot.total_count > 100
      || ['error', 'unknown', 'uncertain', 'pending', 'timedOut', 'refused', 'isError'].some(key => snapshot[key] != null && snapshot[key] !== false)
      || snapshot.completed === false || !Array.isArray(snapshot.jobs) || snapshot.jobs.length !== snapshot.total_count
      || snapshot.jobs.some(job => !job || typeof job !== 'object' || !Number.isSafeInteger(job.id) || job.id <= 0 || typeof job.name !== 'string')) refuse('JOBS_SNAPSHOT_COMPLETE');
    return snapshot.jobs;
  };
  const waitingContext = () => {
    const owner = repository.split('/')[0];
    return qualificationRunVerified === true && qualificationSource && run.run_attempt === 1 && run.event === 'workflow_dispatch'
      && run.head_branch === qualificationSource.ref.slice('refs/heads/'.length) && run.head_sha === env.GITHUB_SHA
      && run.head_sha === qualificationSource.bootstrapSha && String(run.id) === env.GITHUB_RUN_ID
      && run.repository?.full_name === repository && String(run.repository?.id) === env.GITHUB_REPOSITORY_ID
      && run.head_repository?.full_name === repository && ['queued', 'in_progress'].includes(run.status) && run.conclusion === null
      && env.GITHUB_ACTOR === owner && /^[1-9][0-9]*$/.test(env.GITHUB_ACTOR_ID || '')
      && run.actor?.login === owner && String(run.actor?.id) === env.GITHUB_ACTOR_ID
      && run.triggering_actor?.login === owner && String(run.triggering_actor?.id) === env.GITHUB_ACTOR_ID;
  };
  let jobs = await read(), pinnedId;
  for (let additional = 0; ; additional++) {
    if (pinnedId !== undefined && !waitingContext()) refuse('WAITING_RUN_IDENTITY');
    const named = jobs.filter(job => job?.name === jobName);
    if (named.length !== 1) refuse('ACTIVE_NAMED_JOB_UNIQUE');
    const job = named[0];
    if (!Number.isSafeInteger(job.id) || job.id <= 0 || pinnedId !== undefined && job.id !== pinnedId) refuse('JOB_IDENTITY_PIN');
    if (job.status === 'in_progress') return assertCurrentHostedJobIdentity({ run, jobs, jobName, env, qualificationSource });
    // All other states are terminal/refused. Only this exact fully identified
    // queued/null job can consume the two additional visibility reads.
    if (job.status !== 'queued' || job.conclusion !== null || additional === 2) {
      return assertCurrentHostedJobIdentity({ run, jobs, jobName, env, qualificationSource });
    }
    if (!waitingContext()) refuse('WAITING_RUN_IDENTITY');
    if (job.head_sha !== run.head_sha || job.run_id !== Number(env.GITHUB_RUN_ID)) refuse('WAITING_RUN_IDENTITY');
    pinnedId ??= job.id;
    const milliseconds = [1000, 3000][additional];
    gate();
    if (now() + milliseconds >= deadline) refuse('VISIBILITY_WINDOW');
    try { await awaitGitHubRead(delay(milliseconds, undefined, { signal: windowSignal }), windowSignal); }
    catch { gate(); refuse('VISIBILITY_WAIT'); }
    gate();
    if (!waitingContext()) refuse('WAITING_RUN_IDENTITY');
    jobs = await read();
  }
}
