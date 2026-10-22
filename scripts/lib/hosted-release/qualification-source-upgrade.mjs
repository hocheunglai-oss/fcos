import { fcosConnectionIdentifier } from '../../../config/fcosConnections.js';
import { canonical, digest, fail } from './json-contract.mjs';

// Historical evidence pins, not provider credentials or a permanent operation cap.
export const SOURCE_UPGRADE = Object.freeze({
  epoch: 1, candidateSha: '2ef733d17dd12314c72971c2220b2b09903a6bf0',
  catalogSha256: '84ef2811eeefb87f8be4ef5219ab031f37fd3fd424a390e4c80b4afba7f13a4d',
  initialCompletionId: 'qualification-plan-completion-epoch1-39672498844-v1',
  initialCompletionSha256: '19f1a84e420bee5c6e4bd5b1b82b3e6524df5365f596db4c0671a0feb7be10ba',
  initialManifestSha256: 'e73dcbc3a6e4a75646218d6652dccbc7b422409d3faee7d52268cb67681b8e41',
  initialConfigurationSha256: 'f3f95b92a0ec6e512bef2558efd82f4ebca0bfd3d0aeba2c6e2d02e5194dc935',
  initialPolicySha256: '5775ea59999f87e2198c415f1827f5816e458debf4aab69a7c6f9a70af9beb2d',
  initialCheckerManifestSha256: '0e16a88f0ee5417c533c6dcf16bca6586b5a80cd5d5c09440eede6c9ca914d4f',
  preservationSha256: '65e4ba8e5387183da21216a24d25a28eee552977722c7dd5059b6e0b92221d40',
});
const sha = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const commit = v => typeof v === 'string' && /^[a-f0-9]{40}$/.test(v);
const exact = (v, keys) => v && Object.getPrototypeOf(v) === Object.prototype && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const equal = (a, b) => canonical(a) === canonical(b);
const without = (v, ...keys) => Object.fromEntries(Object.entries(v).filter(([k]) => !keys.includes(k)));
const need = (v, code = 'SOURCE_UPGRADE_PROOF_INVALID') => { if (!v) fail(code, 'qualification.source_upgrade', 'Preserve consumed intents; use separately admitted original-owner readback.'); };
const repo = () => fcosConnectionIdentifier('github', 'Repository');
const team = () => fcosConnectionIdentifier('vercel', 'Team ID');
const qSource = p => p.setup.qualificationSource;
export const sourceUpgradeSubject = p => without(p, 'rootReview', 'independentReview');
export function sourceUpgradeActions(p, ready) {
  const host = p.preservation.project, q = qSource(p), route = name => `/repos/${repo()}/actions/variables/${name}`;
  const variable = (id, name, value) => ({ id, request: { method: 'PATCH', route: route(name), body: { name, value } } });
  return [
    { id: 'policy_patch', request: { method: 'PATCH', route: `/v9/projects/${host.id}/env/${p.policyRowId}?teamId=${team()}`, body: { value: canonical(p.policy) } } },
    { id: 'checker_deploy', request: { method: 'POST', route: `/v13/deployments?teamId=${team()}&forceNew=0`, body: {
      name: host.name, project: host.id, files: p.checkerFiles, meta: { fcosSourceUpgrade: p.operationId, fcosCoordinatorBundle: digest(p.checkerManifest) },
    } } },
    variable('url_patch', 'FCOS_HOSTED_COORDINATOR_URL', ready?.coordinatorUrl ?? '$OWNED_READY_COORDINATOR_URL'),
    variable('setup_patch', 'FCOS_ADMITTED_RELEASE_SETUP', canonical(p.setup)),
    variable('setup_hash_patch', 'FCOS_ADMITTED_RELEASE_SETUP_SHA256', p.setupSha256),
    { id: 'dispatch', request: { method: 'POST', route: `/repos/${repo()}/actions/workflows/authenticated-release.yml/dispatches`, body: {
      ref: q.ref.slice('refs/heads/'.length), inputs: { bootstrap_phase: 'qualification', candidate_sha: SOURCE_UPGRADE.candidateSha, plan: canonical(p.plan), xero_recovery_mode: 'disabled' },
    } } },
  ];
}
/** Integrity and scope only. Authenticated postgres must independently verify
 * actual root/peer material, source publication and provider observations. */
export function validateSourceUpgradeProof(p, { now = Date.now() } = {}) {
  need(exact(p, ['schemaVersion', 'kind', 'epoch', 'operationId', 'parent', 'previous', 'previousRegistrationSha256', 'previousConfiguration',
    'previousCheckerManifest', 'previousPolicy', 'setup', 'setupSha256', 'plan', 'planSha256', 'manifest', 'manifestSha256',
    'checkerManifest', 'checkerFiles', 'policyRowId', 'policy', 'preservation', 'sourcePreflight', 'ownerReadbackSha256', 'actions', 'rootReview', 'independentReview']));
  need(p.schemaVersion === 1 && p.kind === 'fcos_qualification_source_upgrade_v1' && p.epoch === SOURCE_UPGRADE.epoch
    && /^[A-Za-z0-9._:-]{1,200}$/.test(p.operationId) && exact(p.parent, ['kind', 'operationId', 'proofSha256', 'releaseId', 'manifestHash'])
    && ['plan_completion', 'source_upgrade'].includes(p.parent.kind) && sha(p.parent.proofSha256) && sha(p.parent.manifestHash)
    && exact(p.previous, ['setup', 'plan', 'manifest']) && sha(p.previousRegistrationSha256) && sha(p.ownerReadbackSha256));
  need(digest(p.preservation) === SOURCE_UPGRADE.preservationSha256 && p.preservation.team.id === team()
    && p.previousConfiguration.projectId === p.preservation.project.id && p.previousConfiguration.teamId === team()
    && p.policyRowId === '5Rl6tmYklkODNosl');
  if (p.parent.kind === 'plan_completion') need(p.parent.operationId === SOURCE_UPGRADE.initialCompletionId
    && p.parent.proofSha256 === SOURCE_UPGRADE.initialCompletionSha256 && p.parent.manifestHash === SOURCE_UPGRADE.initialManifestSha256
    && digest(p.previousConfiguration) === SOURCE_UPGRADE.initialConfigurationSha256
    && digest(p.previousCheckerManifest) === SOURCE_UPGRADE.initialCheckerManifestSha256
    && digest(p.previousPolicy) === SOURCE_UPGRADE.initialPolicySha256);
  const q = qSource(p), old = p.previous;
  need(p.parent.releaseId === old.plan.releaseId && p.parent.releaseId === old.manifest.releaseId && p.parent.manifestHash === digest(old.manifest)
    && old.manifest.setupSha256 === digest(old.setup) && equal(old.manifest.qualificationSource, old.setup.qualificationSource)
    && old.manifest.controller.sha === old.setup.controllerSha && old.manifest.candidate.sha === SOURCE_UPGRADE.candidateSha
    && equal(old.manifest.runtime, old.plan.runtime) && equal(old.manifest.scope, old.plan.scope)
    && p.previousConfiguration.setupSha256 === digest(old.setup) && p.previousConfiguration.policySha256 === digest(p.previousPolicy));
  need(exact(q, ['ref', 'bootstrapSha', 'callerWorkflowRef', 'controllerSha', 'candidateSha'])
    && /^refs\/heads\/codex\/[A-Za-z0-9][A-Za-z0-9._/-]{0,170}$/.test(q.ref) && !/\.\.|\/\/|\/$|\.lock$/.test(q.ref)
    && q.ref !== old.setup.qualificationSource.ref && commit(q.bootstrapSha) && commit(q.controllerSha)
    && q.controllerSha !== old.setup.controllerSha && q.candidateSha === SOURCE_UPGRADE.candidateSha
    && q.callerWorkflowRef === `${repo()}/.github/workflows/authenticated-release.yml@${q.ref}`
    && p.setup.controllerSha === q.controllerSha && p.setup.epoch === 1 && p.setupSha256 === digest(p.setup)
    && equal(without(p.setup, 'controllerSha', 'qualificationSource'), without(old.setup, 'controllerSha', 'qualificationSource')));
  need(p.planSha256 === digest(p.plan) && /^[A-Za-z0-9._:-]{1,200}$/.test(p.plan.releaseId) && p.plan.releaseId !== old.plan.releaseId
    && equal(without(p.plan, 'releaseId'), without(old.plan, 'releaseId')) && p.plan.stage === 'qualification' && p.plan.executionMode === 'qualification'
    && p.plan.scope.financialAuthority === false && p.plan.migration.mode === 'none' && p.plan.migration.expectedSchemaSha256 === SOURCE_UPGRADE.catalogSha256);
  need(p.manifestSha256 === digest(p.manifest) && p.manifest.releaseId === p.plan.releaseId && p.manifest.setupSha256 === p.setupSha256
    && equal(p.manifest.qualificationSource, q) && p.manifest.controller.sha === q.controllerSha
    && equal(without(p.manifest.controller, 'sha'), without(old.manifest.controller, 'sha'))
    && equal(without(p.manifest, 'releaseId', 'setupSha256', 'qualificationSource', 'controller'), without(old.manifest, 'releaseId', 'setupSha256', 'qualificationSource', 'controller'))
    && p.manifest.candidate.sha === SOURCE_UPGRADE.candidateSha);
  const admission = { ...p.previousPolicy.qualificationAdmission, ref: q.ref, bootstrapSha: q.bootstrapSha, callerWorkflowSha: q.bootstrapSha,
    callerWorkflowRef: q.callerWorkflowRef, jobWorkflowSha: q.controllerSha,
    jobWorkflowRef: `${repo()}/.github/workflows/hosted-release-controller.yml@${q.controllerSha}`, setupSha256: p.setupSha256 };
  need(equal(p.policy, { ...p.previousPolicy, qualificationAdmission: admission }) && p.previousPolicy.repository === repo()
    && /^[1-9][0-9]*$/.test(p.previousPolicy.repositoryId));
  need(Array.isArray(p.checkerManifest) && p.checkerManifest.length === 17 && Array.isArray(p.previousCheckerManifest)
    && p.previousCheckerManifest.length === 17 && Array.isArray(p.checkerFiles) && p.checkerFiles.length === 17);
  for (let i = 0; i < 17; i++) {
    const row = p.checkerManifest[i], prior = p.previousCheckerManifest[i], file = p.checkerFiles[i];
    need(exact(row, ['path', 'sha256', 'byteLength']) && sha(row.sha256) && Number.isSafeInteger(row.byteLength) && row.byteLength > 0
      && row.path === prior.path && (i === 0 || p.checkerManifest[i - 1].path < row.path)
      && (row.path === 'supabase/functions/release-coordinator/approval.mjs' || equal(row, prior))
      && exact(file, ['file', 'encoding', 'data']) && file.file === row.path && file.encoding === 'base64'
      && typeof file.data === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(file.data));
    const bytes = Buffer.from(file.data, 'base64'); need(bytes.toString('base64') === file.data && bytes.length === row.byteLength && digest(bytes) === row.sha256);
  }
  const f = p.sourcePreflight;
  need(exact(f, ['accepted', 'complete', 'controllerSha', 'callerSha', 'setupSha256', 'planSha256', 'manifestSha256', 'sourceEvidenceSha256'])
    && f.accepted === true && f.complete === true && f.controllerSha === q.controllerSha && f.callerSha === q.bootstrapSha
    && f.setupSha256 === p.setupSha256 && f.planSha256 === p.planSha256 && f.manifestSha256 === p.manifestSha256 && sha(f.sourceEvidenceSha256)
    && equal(p.actions, sourceUpgradeActions(p)));
  for (const [role, reviewerId] of [['root', '/root'], ['independent', '/root/coordinator_config_native']]) {
    const r = p[role === 'root' ? 'rootReview' : 'independentReview'];
    need(exact(r, ['kind', 'role', 'reviewerId', 'accepted', 'subjectSha256', 'sourceEvidenceSha256', 'reviewedAt'])
      && r.kind === 'fcos_qualification_source_upgrade_review_v1' && r.role === role && r.reviewerId === reviewerId && r.accepted === true
      && r.subjectSha256 === digest(sourceUpgradeSubject(p)) && sha(r.sourceEvidenceSha256)
      && Number.isFinite(Date.parse(r.reviewedAt)) && Date.parse(r.reviewedAt) <= now);
  }
  return p;
}
export function sourceUpgradeSql(command, p, { actionId, evidence, ready, closure } = {}) {
  validateSourceUpgradeProof(p);
  const names = { admit: ['admit_qualification_source_upgrade', [p]], snapshot: ['qualification_source_upgrade_snapshot', [p.operationId, digest(p)]],
    intent: ['qualification_source_upgrade_intent', [p.operationId, actionId, digest(p), ready ?? null]],
    record: ['record_qualification_source_upgrade', [p.operationId, actionId, digest(p), evidence]],
    'finish-configuration': ['finish_qualification_source_upgrade_configuration', [p.operationId, digest(p), closure]],
    'finish-dispatch': ['finish_qualification_source_upgrade_dispatch', [p.operationId, digest(p), closure]] };
  need(Object.hasOwn(names, command), 'SOURCE_UPGRADE_COMMAND_REFUSED'); const [fn, parameters] = names[command];
  return { projectRef: fcosConnectionIdentifier('supabase', 'Project ref'), query: `select fcos_release_coordination.${fn}(${parameters.map((_, i) => '$' + (i + 1)).join(',')}) as result`, parameters };
}
