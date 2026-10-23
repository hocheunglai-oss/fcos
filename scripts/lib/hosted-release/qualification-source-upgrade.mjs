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
// One diagnostic-only child, not a replacement for any historical candidate pin.
export const SOURCE_UPGRADE_DIAGNOSTIC = Object.freeze({
  candidateSha: '160edcccc3347596ac18bb5c9dcb34ecc26df02b', sourceProfile: 'compat_source_diagnostics_20261023',
  sourceSha256: '9f8b01198784d1e222f96f726207ef9c980f9ab5d2536e7a156ca97b2f307912',
  sourceInputsSha256: 'a6bc646c45bdc92232cebb0f85fbb6a5104222aaf0493fba8ec03ebf79c73c0c',
  moduleSha256: '96ec0600534ad64a81a617960cb7a712aea9355c801c12b07232881e184b69b8',
  lockSha256: '9b3d6eb4824ea8688022b9ba249041e25c44b8cebc5443d59c55d8a2da5da378',
  configurationSha256: '331e9f360dd8fa0f9e1e2cafb8f0d5f50ecf26e2ac76323972e9bb7ff742a866',
  salesforceSourceSha256: '4c2594c9986269e492487448d402334f43db35b06cb9c409377e728482739c64',
  branch: 'codex/hosted-release-consolidation-20261017',
  checkManifestSha256: '08a078ad2ccf8a93322d5f54a3099113f57291f9066bbd0719f1f7a24446fa1c',
  parentOperationId: 'qualification-source-upgrade-epoch1-archive-f0bb486474d3-ec69968da3c3-v1',
  parentProofSha256: '59f5197e182e471363f6a33a28f2f7398a3aa626b337a1bb17fb5a0595ba7b23',
  parentReleaseId: 'fcos-qualification-f0bb486474d3-2ef733d1-archive',
  parentManifestSha256: '748af73c92e40459fc5d46e2cb65edd7676b3593e8d2b53b3bdf010be788a908',
  parentSetupSha256: 'e7da38e499cf8b12ec8d5f3d9a381cc2a18938558308c2877a83763a15a53cf9',
  parentPlanSha256: '625f711a7b6de8d973b8d233910ec352d74463752eaf3181c5b5a9f8e6a2286c',
  parentPolicySha256: 'acaebd6b75b28103a09ed8b52b95445801b5ee578664f7148e9710b92c17e2f1',
  checkerManifestSha256: '12a0e17a8f1b36616f2b16668f42d70bda5741655fe163b2a17d0fd8bec40172',
});
// One controller-only successor of the completed diagnostic admission. The
// privileged SQL admission additionally pins the final reviewed child proof.
export const SOURCE_UPGRADE_CONTROLLER_REPAIR = Object.freeze({
  parentOperationId: 'qualification-source-upgrade-epoch1-diagnostic-b4397085ada3-02da6a03353e-v1',
  parentProofSha256: '5c0890619b5b7c9402c9cf86aca73f9a8c3f4d6d68498318f89af7052112a749',
  parentReleaseId: 'fcos-qualification-b4397085ada3-160edccc-diagnostic',
  parentManifestSha256: 'df46219012b5520f1ffd0fae05a14cc2402a2659b021a60f5546c5587a48a397',
  parentSetupSha256: 'b7fe941c3c63a1d7d7082aaffc1a66b11234ec60a5385476985ef9f07d955ae5',
  parentPlanSha256: '2f545c333bcf837169ce74f66df236d8e4ee51b220e5bbfe177ea650544f12b7',
  parentPolicySha256: 'a6ae94e61696be2715c233e7ac7fd57a26a067b089525f6b6492070d7e098ccb',
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
function baselineDiagnosticChange(reference, previous, now) {
  if (!exact(reference, ['json', 'sha256', 'acceptance']) || !exact(reference.acceptance, ['json', 'sha256'])
    || typeof reference.json !== 'string' || Buffer.byteLength(reference.json) > 49152
    || typeof reference.acceptance.json !== 'string' || Buffer.byteLength(reference.acceptance.json) > 8192
    || digest(reference.json) !== reference.sha256 || digest(reference.acceptance.json) !== reference.acceptance.sha256) return false;
  const value = JSON.parse(reference.json), old = JSON.parse(previous.json), review = JSON.parse(reference.acceptance.json), oldReview = JSON.parse(previous.acceptance.json);
  const selected = SOURCE_UPGRADE_DIAGNOSTIC;
  const scope = { kind: 'previous-runtime-endpoint-absent-typed-v2', candidateSha: selected.candidateSha,
    sourceProfile: selected.sourceProfile, previous: old.previous, desiredRuntimeSha256: digest(old.desiredRuntime), existingUi: false, handoffs: [], rollbackEligible: false };
  return old.schemaVersion === 2 && old.kind === 'fcos_first_runtime_baseline_v2' && old.candidateSha === SOURCE_UPGRADE.candidateSha
    && old.candidateSourceProfile === 'compat_source_config_20261020'
    && equal(value, { ...old, candidateSha: selected.candidateSha, candidateSourceProfile: selected.sourceProfile })
    && review.kind === 'fcos_root_accepted_first_runtime_baseline_v2' && review.accepted === true && review.reviewerId === '/root'
    && Number.isFinite(Date.parse(review.reviewedAt)) && Date.parse(review.reviewedAt) <= now && Date.parse(review.reviewedAt) >= Date.parse(oldReview.reviewedAt)
    && equal(without(review, 'reviewedAt'), { ...without(oldReview, 'reviewedAt'), baselineSha256: reference.sha256,
      firstCutoverException: { ...oldReview.firstCutoverException, scopeSha256: digest(scope) } });
}
/** Exact candidate transition integrity only; actual parent completion, source
 * publication and root review authentication remain private coordinator duties. */
export function diagnosticSourceUpgradeTransition(p, { now = Date.now() } = {}) {
  try {
    const s = SOURCE_UPGRADE_DIAGNOSTIC, old = p.previous, q = qSource(p);
    if (!equal(p.parent, { kind: 'source_upgrade', operationId: s.parentOperationId, proofSha256: s.parentProofSha256,
      releaseId: s.parentReleaseId, manifestHash: s.parentManifestSha256 })
      || digest(old.setup) !== s.parentSetupSha256 || digest(old.plan) !== s.parentPlanSha256 || digest(old.manifest) !== s.parentManifestSha256
      || digest(p.previousPolicy) !== s.parentPolicySha256 || digest(p.previousCheckerManifest) !== s.checkerManifestSha256
      || digest(p.checkerManifest) !== s.checkerManifestSha256 || q.candidateSha !== s.candidateSha
      || p.plan.sourceProfile !== s.sourceProfile || p.plan.branch !== s.branch || p.manifest.controller.checkManifestSha256 !== s.checkManifestSha256
      || !baselineDiagnosticChange(p.setup.firstRuntimeBaseline, old.setup.firstRuntimeBaseline, now)) return false;
    const expectedCandidate = { ...old.manifest.candidate, sha: s.candidateSha, sourceProfile: s.sourceProfile,
      sourceSha256: s.sourceSha256, sourceInputsSha256: s.sourceInputsSha256, branch: s.branch };
    const expectedPrevious = { ...old.manifest.previousProduction, firstRuntime: { ...old.manifest.previousProduction.firstRuntime,
      candidateSha: s.candidateSha, baselineSha256: p.setup.firstRuntimeBaseline.sha256 } };
    return old.manifest.candidate.sha === SOURCE_UPGRADE.candidateSha && expectedCandidate.lockSha256 === s.lockSha256
      && expectedCandidate.configurationSha256 === s.configurationSha256 && expectedCandidate.salesforceSourceSha256 === s.salesforceSourceSha256
      && equal(p.manifest.candidate, expectedCandidate) && equal(p.manifest.previousProduction, expectedPrevious);
  } catch { return false; }
}
/** Integrity only. Publication, genuine reviews, completed parent history and
 * the exact final child proof remain independently authenticated SQL duties. */
export function controllerRepairSourceUpgradeTransition(p) {
  try {
    const s = SOURCE_UPGRADE_CONTROLLER_REPAIR, candidate = SOURCE_UPGRADE_DIAGNOSTIC, old = p.previous, q = qSource(p);
    return equal(p.parent, { kind: 'source_upgrade', operationId: s.parentOperationId, proofSha256: s.parentProofSha256,
      releaseId: s.parentReleaseId, manifestHash: s.parentManifestSha256 })
      && digest(old.setup) === s.parentSetupSha256 && digest(old.plan) === s.parentPlanSha256
      && digest(old.manifest) === s.parentManifestSha256 && digest(p.previousPolicy) === s.parentPolicySha256
      && digest(p.previousCheckerManifest) === candidate.checkerManifestSha256
      && equal(p.checkerManifest, p.previousCheckerManifest)
      && equal(old.manifest.candidate, { sha: candidate.candidateSha, sourceProfile: candidate.sourceProfile,
        sourceSha256: candidate.sourceSha256, sourceInputsSha256: candidate.sourceInputsSha256,
        lockSha256: candidate.lockSha256, configurationSha256: candidate.configurationSha256,
        salesforceSourceSha256: candidate.salesforceSourceSha256, branch: candidate.branch })
      && q.candidateSha === candidate.candidateSha && commit(q.controllerSha) && commit(q.bootstrapSha)
      && q.controllerSha !== old.setup.controllerSha && q.bootstrapSha !== old.setup.qualificationSource.bootstrapSha
      && q.ref !== old.setup.qualificationSource.ref
      && equal(without(p.setup, 'controllerSha', 'qualificationSource'), without(old.setup, 'controllerSha', 'qualificationSource'))
      && equal(without(p.plan, 'releaseId'), without(old.plan, 'releaseId'))
      && equal(without(p.manifest.controller, 'sha'), without(old.manifest.controller, 'sha'))
      && equal(without(p.manifest, 'releaseId', 'setupSha256', 'qualificationSource', 'controller'),
        without(old.manifest, 'releaseId', 'setupSha256', 'qualificationSource', 'controller'));
  } catch { return false; }
}
// Integrity only: the privileged caller must authenticate this admission from
// the same private coordinator. SQL independently checks its actual stored row.
function exactPreviewCheckerChange(p, quarantine) {
  const proof=quarantine?.proof,s=proof?.successor,q=qSource(p);
  return quarantine?.operationId==='fcos-qualification-6a3fbd8f-2ef733d1-source-20261022-preview-create'
    && quarantine.originalOutcome==='unknown' && quarantine.replayAllowed===false && quarantine.active===true
    && quarantine.proofSha256===digest(proof) && proof?.kind==='fcos_exact_preview_uncertainty_quarantine_v1'
    && s?.sourceUpgradeId===p.operationId && s.releaseId===p.plan?.releaseId
    && s.controllerSha===q?.controllerSha && s.callerSha===q.bootstrapSha && s.ref===q.ref
    && s.candidateSha===SOURCE_UPGRADE.candidateSha && s.setupSha256===p.setupSha256
    && s.checkerManifestSha256===digest(p.checkerManifest)
    && p.parent?.releaseId==='fcos-qualification-6a3fbd8f-2ef733d1-source-20261022';
}
function withoutAddedPreviewTransport(value) {
  return {...value,verification:without(value.verification,'vercelSourceTransport')};
}
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
      ref: q.ref.slice('refs/heads/'.length), inputs: { bootstrap_phase: 'qualification', candidate_sha: q.candidateSha, plan: canonical(p.plan), xero_recovery_mode: 'disabled' },
    } } },
  ];
}
/** Integrity and scope only. Authenticated postgres must independently verify
 * actual root/peer material, source publication and provider observations. */
export function validateSourceUpgradeProof(p, { now = Date.now(), previewQuarantine } = {}) {
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
  const diagnosticChange = diagnosticSourceUpgradeTransition(p, { now });
  const controllerRepair = controllerRepairSourceUpgradeTransition(p);
  const selectedCandidate = diagnosticChange || controllerRepair ? SOURCE_UPGRADE_DIAGNOSTIC.candidateSha : SOURCE_UPGRADE.candidateSha;
  const checkerChange=exactPreviewCheckerChange(p,previewQuarantine);
  const transportChange=checkerChange && p.setup.verification?.vercelSourceTransport==='fcos_source_api_archive_v1'
    && p.manifest.verification?.vercelSourceTransport==='fcos_source_api_archive_v1'
    && !Object.hasOwn(old.setup.verification||{},'vercelSourceTransport')
    && !Object.hasOwn(old.manifest.verification||{},'vercelSourceTransport');
  need(p.parent.releaseId === old.plan.releaseId && p.parent.releaseId === old.manifest.releaseId && p.parent.manifestHash === digest(old.manifest)
    && old.manifest.setupSha256 === digest(old.setup) && equal(old.manifest.qualificationSource, old.setup.qualificationSource)
    && old.manifest.controller.sha === old.setup.controllerSha
    && old.manifest.candidate.sha === (controllerRepair ? SOURCE_UPGRADE_DIAGNOSTIC.candidateSha : SOURCE_UPGRADE.candidateSha)
    && equal(old.manifest.runtime, old.plan.runtime) && equal(old.manifest.scope, old.plan.scope)
    && p.previousConfiguration.setupSha256 === digest(old.setup) && p.previousConfiguration.policySha256 === digest(p.previousPolicy));
  need(exact(q, ['ref', 'bootstrapSha', 'callerWorkflowRef', 'controllerSha', 'candidateSha'])
    && /^refs\/heads\/codex\/[A-Za-z0-9][A-Za-z0-9._/-]{0,170}$/.test(q.ref) && !/\.\.|\/\/|\/$|\.lock$/.test(q.ref)
    && q.ref !== old.setup.qualificationSource.ref && commit(q.bootstrapSha) && commit(q.controllerSha)
    && q.controllerSha !== old.setup.controllerSha && q.candidateSha === selectedCandidate
    && q.callerWorkflowRef === `${repo()}/.github/workflows/authenticated-release.yml@${q.ref}`
    && p.setup.controllerSha === q.controllerSha && p.setup.epoch === 1 && p.setupSha256 === digest(p.setup)
    && equal(without(diagnosticChange ? { ...p.setup, firstRuntimeBaseline: old.setup.firstRuntimeBaseline }
      : transportChange ? withoutAddedPreviewTransport(p.setup) : p.setup, 'controllerSha', 'qualificationSource'), without(old.setup, 'controllerSha', 'qualificationSource')));
  need(p.planSha256 === digest(p.plan) && /^[A-Za-z0-9._:-]{1,200}$/.test(p.plan.releaseId) && p.plan.releaseId !== old.plan.releaseId
    && equal(without(diagnosticChange ? { ...p.plan, sourceProfile: old.plan.sourceProfile, branch: old.plan.branch } : p.plan, 'releaseId'), without(old.plan, 'releaseId')) && p.plan.stage === 'qualification' && p.plan.executionMode === 'qualification'
    && p.plan.scope.financialAuthority === false && p.plan.migration.mode === 'none' && p.plan.migration.expectedSchemaSha256 === SOURCE_UPGRADE.catalogSha256);
  need(p.manifestSha256 === digest(p.manifest) && p.manifest.releaseId === p.plan.releaseId && p.manifest.setupSha256 === p.setupSha256
    && equal(p.manifest.qualificationSource, q) && p.manifest.controller.sha === q.controllerSha
    && equal(without(diagnosticChange ? { ...p.manifest.controller, checkManifestSha256: old.manifest.controller.checkManifestSha256 } : p.manifest.controller, 'sha'), without(old.manifest.controller, 'sha'))
    && equal(without(diagnosticChange ? { ...p.manifest, candidate: old.manifest.candidate, previousProduction: old.manifest.previousProduction }
      : transportChange ? withoutAddedPreviewTransport(p.manifest) : p.manifest, 'releaseId', 'setupSha256', 'qualificationSource', 'controller'), without(old.manifest, 'releaseId', 'setupSha256', 'qualificationSource', 'controller'))
    && p.manifest.candidate.sha === selectedCandidate);
  const admission = { ...p.previousPolicy.qualificationAdmission, ref: q.ref, bootstrapSha: q.bootstrapSha, callerWorkflowSha: q.bootstrapSha,
    callerWorkflowRef: q.callerWorkflowRef, ...(diagnosticChange ? { candidateSha: q.candidateSha } : {}), jobWorkflowSha: q.controllerSha,
    jobWorkflowRef: `${repo()}/.github/workflows/hosted-release-controller.yml@${q.controllerSha}`, setupSha256: p.setupSha256 };
  need(equal(p.policy, { ...p.previousPolicy, qualificationAdmission: admission }) && p.previousPolicy.repository === repo()
    && /^[1-9][0-9]*$/.test(p.previousPolicy.repositoryId));
  need(Array.isArray(p.checkerManifest) && p.checkerManifest.length === 17 && Array.isArray(p.previousCheckerManifest)
    && p.previousCheckerManifest.length === 17 && Array.isArray(p.checkerFiles) && p.checkerFiles.length === 17);
  for (let i = 0; i < 17; i++) {
    const row = p.checkerManifest[i], prior = p.previousCheckerManifest[i], file = p.checkerFiles[i];
    need(exact(row, ['path', 'sha256', 'byteLength']) && sha(row.sha256) && Number.isSafeInteger(row.byteLength) && row.byteLength > 0
      && row.path === prior.path && (i === 0 || p.checkerManifest[i - 1].path < row.path)
      && (row.path === 'supabase/functions/release-coordinator/approval.mjs' || equal(row, prior)
        || checkerChange && ['supabase/functions/release-coordinator/auth.mjs','supabase/functions/release-coordinator/core.mjs'].includes(row.path))
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
export function sourceUpgradeSql(command, p, { actionId, evidence, ready, closure, previewQuarantine } = {}) {
  validateSourceUpgradeProof(p,{previewQuarantine});
  const names = { admit: ['admit_qualification_source_upgrade', [p]], snapshot: ['qualification_source_upgrade_snapshot', [p.operationId, digest(p)]],
    intent: ['qualification_source_upgrade_intent', [p.operationId, actionId, digest(p), ready ?? null]],
    record: ['record_qualification_source_upgrade', [p.operationId, actionId, digest(p), evidence]],
    'finish-configuration': ['finish_qualification_source_upgrade_configuration', [p.operationId, digest(p), closure]],
    'finish-dispatch': ['finish_qualification_source_upgrade_dispatch', [p.operationId, digest(p), closure]] };
  need(Object.hasOwn(names, command), 'SOURCE_UPGRADE_COMMAND_REFUSED'); const [fn, parameters] = names[command];
  return { projectRef: fcosConnectionIdentifier('supabase', 'Project ref'), query: `select fcos_release_coordination.${fn}(${parameters.map((_, i) => '$' + (i + 1)).join(',')}) as result`, parameters };
}
