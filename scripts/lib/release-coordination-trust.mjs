import { assertProtectedDefault, RELEASE_REPOSITORY } from './release-evidence.mjs';
import { fcosConnectionIdentifier } from '../../config/fcosConnections.js';
import { RELEASE_COORDINATION_ENABLE, RELEASE_COORDINATION_ROUTES, validateReleaseCoordinationBinding, coordinationEqual, releaseCoordinationFailure } from './release-coordination.mjs';

const need = value => { if (!value) releaseCoordinationFailure(); };
export function releaseCoordinationRows(response, key) {
  need(response && Array.isArray(response[key]) && Number.isSafeInteger(response.total_count) && response.total_count === response[key].length && response.total_count <= 100
    && new Set(response[key].map(r => key === 'artifacts' || key === 'jobs' ? r.id : r.name)).size === response[key].length);
  return response[key];
}
/** Actual API data only at both fixed collectors. Never substitutes for runtime OIDC. */
export function assertReleaseCoordinationTrust({ binding, repository, branch, protection, environment, variables, run, jobs, approvals, now = Date.now() }) {
  const b = validateReleaseCoordinationBinding(binding, now), route = RELEASE_COORDINATION_ROUTES[b.route];
  const trusted = assertProtectedDefault(repository, branch, protection), operator = fcosConnectionIdentifier('github', 'Required account');
  need(repository.id === b.repositoryId && trusted.sha === b.harnessSha && environment.id === b.environmentId && environment.name === route.environment
    && environment.can_admins_bypass === false && environment.deployment_branch_policy?.protected_branches === true && environment.deployment_branch_policy?.custom_branch_policies === false);
  const rule = environment.protection_rules?.filter(r => r.type === 'required_reviewers');
  need(rule?.length === 1 && rule[0].prevent_self_review === false && rule[0].reviewers?.length === 1
    && rule[0].reviewers[0].type === 'User' && rule[0].reviewers[0].reviewer?.login === operator);
  const actor = rule[0].reviewers[0].reviewer; need(Number.isSafeInteger(actor.id) && actor.id > 0);
  const rows = releaseCoordinationRows(variables, 'variables'), variable = name => rows.find(r => r.name === name)?.value;
  const pins = b.route === 'production' ? {
    FCOS_PRODUCTION_RELEASE_ENABLED: 'true', FCOS_REVIEWED_RELEASE_SHA: b.candidate.sha,
    FCOS_REVIEWED_SOURCE_SHA256: b.candidate.sourceDigest, FCOS_REVIEWED_CONFIGURATION_SHA256: b.candidate.configurationRevision,
  } : {
    FCOS_RUNTIME_COMPATIBILITY_RELEASE_ENABLED: 'true', FCOS_COMPATIBILITY_REVIEWED_SHA: b.candidate.sha,
    FCOS_COMPATIBILITY_REVIEWED_HARNESS_SHA: b.harnessSha, FCOS_COMPATIBILITY_REVIEWED_SOURCE_SHA256: b.candidate.sourceDigest,
    FCOS_COMPATIBILITY_REVIEWED_LOCK_SHA256: b.candidate.lockHash, FCOS_COMPATIBILITY_REVIEWED_CONTROL_SHA256: b.candidate.configurationRevision,
  };
  need(variable(RELEASE_COORDINATION_ENABLE) === 'true' && Object.entries(pins).every(([k, v]) => variable(k) === v));
  need(run.id === b.runId && run.run_attempt === 1 && run.status === 'in_progress' && run.conclusion === null && run.event === 'workflow_dispatch'
    && run.repository?.id === b.repositoryId && run.repository.full_name === RELEASE_REPOSITORY
    && run.head_repository?.id === b.repositoryId && run.head_repository.full_name === RELEASE_REPOSITORY
    && run.head_sha === b.harnessSha && run.head_branch === trusted.branch && [route.workflow, `${route.workflow}@${trusted.branch}`].includes(run.path)
    && Date.parse(run.run_started_at) === b.dispatchedAt
    && [run.actor, run.triggering_actor].every(r => r?.id === actor.id && r.login === operator));
  const jobRows = releaseCoordinationRows(jobs, 'jobs');
  need(jobRows.length === 1 && jobRows[0].id === b.jobId && jobRows[0].run_id === b.runId && jobRows[0].run_attempt === 1
    && jobRows[0].name === (b.route === 'production' ? `Approve release ${b.candidate.sha}` : 'preflight')
    && jobRows[0].head_sha === b.harnessSha && jobRows[0].status === 'in_progress' && jobRows[0].conclusion === null
    && Date.parse(jobRows[0].started_at) === b.jobStartedAt);
  const reviews = Array.isArray(approvals) ? approvals.filter(r => r.environments?.some(e => e.id === b.environmentId && e.name === route.environment)) : [];
  need(reviews.length === 1 && reviews[0].state === 'approved' && reviews[0].user?.id === actor.id && reviews[0].user.login === operator);
  return { route, variable, job: jobRows[0], reviewerId: actor.id };
}
export function assertReleaseCoordinationIntent(payload, expected, now = Date.now()) {
  need(payload?.kind === 'fcos_production_coordination_intent' && Object.keys(payload).length === 2
    && coordinationEqual(validateReleaseCoordinationBinding(payload.binding, now), validateReleaseCoordinationBinding(expected, now)));
  return payload.binding;
}
