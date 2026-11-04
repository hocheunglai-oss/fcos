import { ReleaseError } from './json-contract.mjs';

const labels = ['RUN_ATTEMPT', 'RUN_EVENT', 'RUN_BRANCH', 'RUN_HEAD_SHA',
  'ACTIVE_NAMED_JOB_UNIQUE', 'JOB_HEAD_SHA', 'JOB_RUN_ID', 'JOBS_SNAPSHOT_COMPLETE',
  'JOB_IDENTITY_PIN', 'WAITING_RUN_IDENTITY', 'VISIBILITY_WINDOW', 'VISIBILITY_CANCELLED', 'VISIBILITY_WAIT'];
const countKeys = ['namedJobs', 'inProgressNamedJobs', 'nullConclusionNamedJobs', 'activeNamedJobs'];
const booleanKeys = ['runAttemptMatches', 'runEventMatches', 'runBranchMatches', 'runHeadMatches',
  'jobHeadPresent', 'jobHeadMatches', 'jobRunIdPresent', 'jobRunIdMatches'];

export function safeCurrentJobIdentity(value) {
  if (!value || !Array.isArray(value.failedPredicates)) return undefined;
  const failedPredicates = labels.filter(label => value.failedPredicates.includes(label));
  if (!failedPredicates.length) return undefined;
  const result = { failedPredicates };
  for (const key of countKeys) { const v = value[key]; if (Number.isSafeInteger(v) && v >= 0 && v <= 1_000_000) result[key] = v; }
  for (const key of booleanKeys) { const v = value[key]; if (typeof v === 'boolean') result[key] = v; }
  return result;
}

// These are the original session predicates. Diagnostics never substitute for
// the strict in-progress, attempt, head and run bindings.
export function assertCurrentHostedJobIdentity({ run, jobs, jobName, env, qualificationSource }) {
  const named = jobs.filter(job => job.name === jobName);
  const matches = named.filter(job => job.status === 'in_progress' && job.conclusion === null);
  const checks = {
    RUN_ATTEMPT: run.run_attempt === 1,
    RUN_EVENT: run.event === 'workflow_dispatch',
    RUN_BRANCH: run.head_branch === (qualificationSource?.ref.slice('refs/heads/'.length) || 'main'),
    RUN_HEAD_SHA: run.head_sha === env.GITHUB_SHA,
    ACTIVE_NAMED_JOB_UNIQUE: matches.length === 1,
    ...(matches.length === 1 ? {
      JOB_HEAD_SHA: matches[0].head_sha === run.head_sha,
      JOB_RUN_ID: matches[0].run_id === Number(env.GITHUB_RUN_ID),
    } : {}),
  };
  if (Object.values(checks).some(value => !value)) {
    const detail = safeCurrentJobIdentity({
      failedPredicates: Object.keys(checks).filter(key => !checks[key]),
      namedJobs: named.length, inProgressNamedJobs: named.filter(job => job.status === 'in_progress').length,
      nullConclusionNamedJobs: named.filter(job => job.conclusion === null).length, activeNamedJobs: matches.length,
      runAttemptMatches: checks.RUN_ATTEMPT, runEventMatches: checks.RUN_EVENT,
      runBranchMatches: checks.RUN_BRANCH, runHeadMatches: checks.RUN_HEAD_SHA,
      ...(matches.length === 1 ? {
        jobHeadPresent: typeof matches[0].head_sha === 'string', jobHeadMatches: checks.JOB_HEAD_SHA,
        jobRunIdPresent: Object.hasOwn(matches[0], 'run_id'), jobRunIdMatches: checks.JOB_RUN_ID,
      } : {}),
    });
    throw new ReleaseError('CURRENT_HOSTED_JOB_IDENTITY', 'admission',
      'Correct the bound inputs before starting a new operation.', { currentJobIdentity: detail });
  }
  return matches[0];
}
