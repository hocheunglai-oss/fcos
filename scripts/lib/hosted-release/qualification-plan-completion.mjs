import { fcosConnectionIdentifier } from '../../../config/fcosConnections.js';
import { canonical, digest, fail } from './json-contract.mjs';
import { BOOTSTRAP_SOURCE } from './cutover-bootstrap.mjs';

export const PLAN_COMPLETION = Object.freeze({
  epoch: 1, operationId: 'qualification-plan-completion-epoch1-39672498844-v1',
  previousRecoveryId: 'qualification-schema-recovery-epoch1-39653018028-v1',
  failedRunId: '39672498844', releaseId: 'fcos-qualification-64aa338b-2ef733d1-schema-20261022',
  schemaSha256: '84ef2811eeefb87f8be4ef5219ab031f37fd3fd424a390e4c80b4afba7f13a4d',
  previewSha256: 'ce69bfac777f6886f13326f8a6972ae73d6121f4aa4dda33c26ee313caa0cc59',
  terminalEvidenceSha256: '8493774013ae81498e1ad0adb1150e65726b1c6b7daff20e7cc44d7eec2070d8',
  manifestSha256: 'e73dcbc3a6e4a75646218d6652dccbc7b422409d3faee7d52268cb67681b8e41',
  manifestPreflightSha256: '44431a9c531e75a9b7b1aeef5f36b26f6ffc5ba5eb59a5c4f07a60e5aab946ab',
  prepareLogSha256: '9b42d50ed8234a0977792410897b11c4a3d5522f6b7b6f6d0e970b7f7884879f',
});
const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
export const PLAN_PREVIEW_RUNTIME = freeze({
  flags: Object.fromEntries(['VARIABLE_CHARGE_PAIRED_WORKFLOW_ENABLED', 'FCOS_ENABLE_FCUNO_FEDERATION', 'FCOS_ENABLE_FCUNO_IDENTITY_SYNC', 'FCOS_ENABLE_FCUNO_LEGACY_PASSWORD_LOGIN'].map(k => [k, { state: 'known', value: true }])),
  safety: { readOnly: true, externalActions: Object.fromEntries(['salesforce_write', 'google_drive', 'email_delivery', 'missing_nom_b_reminders', 'outlook_calendar', 'growth_coaching_email', 'bank_execution', 'payment_promotion', 'xero_contact_sync', 'xero_financial_sync'].map(k => [k, false])) },
  auth: { supabase: { state: 'authenticated', target: fcosConnectionIdentifier('supabase', 'Project ref'), mode: 'service_role' },
    salesforce: { state: 'authenticated', target: fcosConnectionIdentifier('salesforce', 'Production Org ID'), mode: 'application' },
    xero: { state: 'authenticated', target: 'aa8c08e2-17fd-4874-b7bc-10ffd82db9d0', mode: 'oauth' } },
});
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const exact = (v, keys) => v && Object.getPrototypeOf(v) === Object.prototype && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const need = (v, code = 'PLAN_COMPLETION_PROOF_INVALID') => { if (!v) fail(code, 'qualification.plan_completion', 'Preserve the consumed intent; separately admitted owner readback is required.'); };
const without = (v, ...keys) => Object.fromEntries(Object.entries(v).filter(([k]) => !keys.includes(k)));
export const planCompletionSubject = p => without(p, 'rootReview', 'independentReview');
export function planCompletionRequest(plan) {
  return { method: 'POST', route: `/repos/${fcosConnectionIdentifier('github', 'Repository')}/actions/workflows/authenticated-release.yml/dispatches`, body: {
    ref: BOOTSTRAP_SOURCE.ref.slice(11), inputs: { bootstrap_phase: 'qualification', candidate_sha: BOOTSTRAP_SOURCE.candidateSha, plan: canonical(plan), xero_recovery_mode: 'disabled' },
  } };
}
/** Integrity/scope checks only. The private authenticated SQL caller inspects
 * actual source evidence and reviews; reviewer strings are not authentication. */
export function validatePlanCompletionProof(p, { previousProof, now = Date.now() } = {}) {
  need(exact(p, ['schemaVersion', 'kind', 'epoch', 'operationId', 'previousRecoveryId', 'previousRecoveryProofSha256', 'previousPlanSha256', 'setupSha256', 'plan', 'planSha256', 'terminalFailure', 'manifestPreflight', 'ownerReadbackSha256', 'request', 'rootReview', 'independentReview'])
    && p.schemaVersion === 1 && p.kind === 'fcos_qualification_plan_completion_v1' && p.epoch === 1 && p.operationId === PLAN_COMPLETION.operationId
    && p.previousRecoveryId === PLAN_COMPLETION.previousRecoveryId && ['previousRecoveryProofSha256', 'previousPlanSha256', 'setupSha256', 'planSha256', 'ownerReadbackSha256'].every(k => hash(p[k]))
    && p.planSha256 === digest(p.plan) && digest(PLAN_PREVIEW_RUNTIME) === PLAN_COMPLETION.previewSha256
    && digest(p.plan?.runtime?.expectedPreview) === PLAN_COMPLETION.previewSha256
    && p.plan.releaseId === PLAN_COMPLETION.releaseId && p.plan.stage === 'qualification' && p.plan.executionMode === 'qualification'
    && p.plan.scope?.financialAuthority === false && p.plan.migration?.mode === 'none' && p.plan.migration.expectedSchemaSha256 === PLAN_COMPLETION.schemaSha256
    && canonical(p.request) === canonical(planCompletionRequest(p.plan)));
  if (previousProof) {
    need(previousProof.kind === 'fcos_qualification_schema_recovery_v1' && previousProof.recoveryId === p.previousRecoveryId && previousProof.epoch === 1
      && digest(previousProof) === p.previousRecoveryProofSha256 && previousProof.planSha256 === p.previousPlanSha256 && previousProof.setupSha256 === p.setupSha256
      && previousProof.plan.runtime.expectedPreview === null && canonical(without(p.plan, 'runtime')) === canonical(without(previousProof.plan, 'runtime'))
      && canonical(without(p.plan.runtime, 'expectedPreview')) === canonical(without(previousProof.plan.runtime, 'expectedPreview')));
  }
  const f = p.terminalFailure;
  need(exact(f, ['runId', 'runAttempt', 'status', 'conclusion', 'failedStep', 'code', 'beforeRegistration', 'providerEvidenceSha256', 'prepareLogSha256'])
    && f.runId === PLAN_COMPLETION.failedRunId && f.runAttempt === '1' && f.status === 'completed' && f.conclusion === 'failure'
    && f.failedStep === 'Prepare actual qualification manifest' && f.code === 'RUNTIME_EXPECTATIONS' && f.beforeRegistration === true
    && f.providerEvidenceSha256 === PLAN_COMPLETION.terminalEvidenceSha256 && f.prepareLogSha256 === PLAN_COMPLETION.prepareLogSha256);
  const m = p.manifestPreflight;
  need(exact(m, ['accepted', 'complete', 'controllerSha', 'candidateSha', 'setupSha256', 'previousPlanSha256', 'planSha256', 'manifestSha256', 'sourceEvidenceSha256'])
    && m.accepted === true && m.complete === true && m.controllerSha === BOOTSTRAP_SOURCE.controllerSha && m.candidateSha === BOOTSTRAP_SOURCE.candidateSha
    && m.setupSha256 === p.setupSha256 && m.previousPlanSha256 === p.previousPlanSha256 && m.planSha256 === p.planSha256
    && m.manifestSha256 === PLAN_COMPLETION.manifestSha256 && m.sourceEvidenceSha256 === PLAN_COMPLETION.manifestPreflightSha256, 'PLAN_COMPLETION_COMPLETE_PREFLIGHT_REQUIRED');
  for (const [key, role, reviewerId] of [['rootReview', 'root', '/root'], ['independentReview', 'independent', '/root/canonical_publication_review']]) {
    const r = p[key];
    need(exact(r, ['kind', 'role', 'reviewerId', 'accepted', 'subjectSha256', 'sourceEvidenceSha256', 'reviewedAt']) && r.kind === 'fcos_qualification_plan_completion_review_v1'
      && r.role === role && r.reviewerId === reviewerId && r.accepted === true && r.subjectSha256 === digest(planCompletionSubject(p)) && hash(r.sourceEvidenceSha256)
      && typeof r.reviewedAt === 'string' && Number.isFinite(Date.parse(r.reviewedAt)) && Date.parse(r.reviewedAt) <= now + 30000, 'PLAN_COMPLETION_REVIEW_REQUIRED');
  }
  return p;
}
export function planCompletionSql(command, p, { evidence, previousProof } = {}) {
  validatePlanCompletionProof(p, { previousProof });
  const id = p.operationId, h = digest(p), commands = {
    admit: ['admit_qualification_plan_completion($1::jsonb)', [p]],
    snapshot: ['qualification_plan_completion_snapshot($1::text,$2::text)', [id, h]],
    intent: ['qualification_plan_completion_intent($1::text,$2::text)', [id, h]],
    record: ['record_qualification_plan_completion($1::text,$2::text,$3::jsonb)', [id, h, evidence]],
    finish: ['finish_qualification_plan_completion($1::text,$2::text)', [id, h]],
  };
  need(Object.hasOwn(commands, command), 'PLAN_COMPLETION_COMMAND_INVALID');
  const [call, parameters] = commands[command];
  return { projectRef: fcosConnectionIdentifier('supabase', 'Project ref'), query: `select fcos_release_coordination.${call} as result`, parameters };
}
