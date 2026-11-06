import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fcosConnectionIdentifier } from '../../../config/fcosConnections.js';

const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort()) : item);
export const handoverDigest = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
const check = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code }); };
const sha = value => /^[a-f0-9]{40}$/.test(value || ''), digest = value => /^[a-f0-9]{64}$/.test(value || '');
export const handoverPins = () => ({ projectRef: fcosConnectionIdentifier('supabase', 'Project ref'), repository: fcosConnectionIdentifier('github', 'Repository'),
  account: fcosConnectionIdentifier('github', 'Required account'), projectId: fcosConnectionIdentifier('vercel', 'Project ID'), teamId: fcosConnectionIdentifier('vercel', 'Team ID') });
export const OLD_RELEASE_VARIABLES = Object.freeze(['FCOS_PRODUCTION_RELEASE_ENABLED','FCOS_ROUTINE_RELEASE_ENABLED','FCOS_HOSTED_CONTROLLER_ADMITTED','FCOS_HOSTED_TOOLCHAIN_SETUP_ENABLED','FCOS_HOSTED_TOOLCHAIN_EPOCH_PUBLICATION_ENABLED','FCOS_HOSTED_QUALIFICATION_ADMITTED']);
export const OLD_RELEASE_WORKFLOWS = Object.freeze(['production-release.yml','routine-release.yml','hosted-release.yml','hosted-release-controller.yml','authenticated-release.yml','hosted-release-toolchain.yml','runtime-compatibility-release.yml']);
const controlColumns = ['bootstrap_id','epoch','mode','operation_id','plan_completion_id','recovery_id','singleton','source_upgrade_id'];
const guardSql = readFileSync(new URL('../../rapid-release/handover-guard.sql', import.meta.url), 'utf8');

export function assertHandoverConnection(connection) {
  const pins = handoverPins();
  check(connection?.host === `db.${pins.projectRef}.supabase.co` && connection.port === 5432 && connection.user === 'postgres'
    && connection.database === 'postgres' && connection.ssl?.rejectUnauthorized === true, 'HANDOVER_PINNED_TLS_POSTGRES_REQUIRED');
}
async function transaction(db, readOnly, callback) {
  await db.query(`begin isolation level ${readOnly ? 'repeatable read read only' : 'read committed read write'}`);
  try { const identity = (await db.query('select session_user, current_user, current_database() as database, current_setting(\'transaction_read_only\') as read_only')).rows[0];
    check(identity?.session_user === 'postgres' && identity.current_user === 'postgres' && identity.database === 'postgres'
      && identity.read_only === (readOnly ? 'on' : 'off'), 'HANDOVER_DATABASE_IDENTITY_MISMATCH');
    const result = await callback(); await db.query('commit'); return result;
  } catch (error) { await db.query('rollback'); throw error; }
}
async function snapshot(db, locked = false) {
  if (locked) await db.query('lock table fcos_release_coordination.control in share row exclusive mode');
  const control = (await db.query('select to_jsonb(c) as control from fcos_release_coordination.control c where singleton')).rows[0]?.control;
  check(control && canonical(Object.keys(control).sort()) === canonical(controlColumns), 'HANDOVER_UNKNOWN_CONTROL_SCHEMA');
  const tables = (await db.query("select relname from pg_class where relnamespace='fcos_release_coordination'::regnamespace and relkind in ('r','p') order by relname")).rows.map(row => row.relname);
  const history = {};
  for (const table of tables.filter(name => !['control','rapid_handover_receipts'].includes(name))) {
    check(/^[a-z0-9_]+$/.test(table), 'HANDOVER_UNSAFE_CATALOG_NAME');
    if (locked) await db.query(`lock table fcos_release_coordination."${table}" in share mode`);
    history[table] = (await db.query(`select count(*)::text as count,encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]'),'UTF8')),'hex') as digest from fcos_release_coordination."${table}" t`)).rows[0];
  }
  const unresolved = (await db.query("select o.operation_id,o.phase,coalesce(e.state,'missing') as state from fcos_release_coordination.operations o left join lateral (select state from fcos_release_coordination.operation_events where operation_id=o.operation_id order by event_id desc limit 1) e on true where e.state is distinct from 'complete' order by o.operation_id")).rows;
  const receipts = tables.includes('rapid_handover_receipts') ? (await db.query('select handover_id,phase,plan_hash,evidence from fcos_release_coordination.rapid_handover_receipts order by handover_id,phase')).rows : [];
  const guard = receipts.length || tables.includes('rapid_handover_receipts') ? (await db.query("select encode(sha256(convert_to(pg_get_functiondef('fcos_release_coordination.rapid_handover_control_guard()'::regprocedure),'UTF8')),'hex') as digest, (select count(*)::int from pg_trigger where tgrelid='fcos_release_coordination.control'::regclass and tgname in ('rapid_handover_control_guard','rapid_handover_control_no_truncate') and tgenabled='O') as triggers")).rows[0] : null;
  return { control, historyDigest: handoverDigest(history), history, unresolvedProduction: unresolved.filter(row => /^production\.(stage|promote|rollback)$/.test(row.phase)),
    preservedOtherUnknowns: { count: unresolved.filter(row => !/^production\.(stage|promote|rollback)$/.test(row.phase)).length, digest: handoverDigest(unresolved.filter(row => !/^production\.(stage|promote|rollback)$/.test(row.phase))) }, receipts, guard };
}
async function externalAudit({ github, vercel }) {
  const pins = handoverPins(), identity = await github.identity();
  check(identity.login === pins.account && identity.repository === pins.repository, 'HANDOVER_GITHUB_IDENTITY_MISMATCH');
  const variables = {}, workflows = {};
  for (const name of OLD_RELEASE_VARIABLES) { const row = await github.get(`/repos/${pins.repository}/actions/variables/${name}`); variables[name] = row?.value ?? null; }
  for (const name of OLD_RELEASE_WORKFLOWS) {
    const row = await github.get(`/repos/${pins.repository}/actions/workflows/${name}`);
    const runs = row ? await github.pages(`/repos/${pins.repository}/actions/workflows/${row.id}/runs?per_page=100`) : [];
    workflows[name] = { id: row?.id || null, state: row?.state || 'absent', running: runs.filter(run => !['completed'].includes(run.status)).map(run => run.id) };
  }
  const project = await vercel.project(), production = await vercel.currentProduction();
  check(project.id === pins.projectId && project.accountId === pins.teamId && project.autoAssignCustomDomains === false, 'HANDOVER_VERCEL_TARGET_OR_AUTO_ASSIGNMENT');
  check(typeof github.eventSubscribers === 'function', 'HANDOVER_DEPLOYMENT_SUBSCRIBER_INVENTORY_REQUIRED');
  const subscribers = await github.eventSubscribers();
  check(Array.isArray(subscribers?.inventory) && digest(subscribers.evidenceDigest), 'HANDOVER_DEPLOYMENT_SUBSCRIBER_INVENTORY_REQUIRED');
  return { variables, workflows, subscribersDigest: handoverDigest(subscribers), productionId: production.id, retired: Object.values(variables).every(value => value !== 'true')
    && Object.values(workflows).every(row => row.state === 'absent' || row.state.startsWith('disabled')), noRunning: Object.values(workflows).every(row => row.running.length === 0) };
}
export async function auditHandover({ db, connection, github, vercel }) {
  assertHandoverConnection(connection);
  return { database: await transaction(db, true, () => snapshot(db)), providers: await externalAudit({ github, vercel }) };
}
export function createHandoverPlan({ audit, controllerSha, candidateSha, buildId, artifactDigest, handoverId }) {
  check(sha(controllerSha) && sha(candidateSha) && digest(buildId) && digest(artifactDigest) && /^[a-z0-9-]{8,96}$/.test(handoverId), 'HANDOVER_PLAN_INVALID');
  const c = audit.database.control;
  check(c.mode === 'qualification' && c.singleton === true && Number.isSafeInteger(Number(c.epoch)) && Number(c.epoch) > 0
    && controlColumns.filter(key => key.endsWith('_id')).every(key => c[key] === null) && !audit.database.unresolvedProduction.length && audit.providers.noRunning, 'HANDOVER_QUIESCENT_QUALIFICATION_REQUIRED');
  return { schemaVersion: 1, kind: 'fcos_rapid_handover_plan', handoverId, controllerSha, candidateSha, buildId, artifactDigest,
    pins: handoverPins(), controlPreimage: c, historyDigest: audit.database.historyDigest, oldInventoryDigest: handoverDigest(audit.providers),
    previousProductionId: audit.providers.productionId, subscribersDigest: audit.providers.subscribersDigest, guardSqlDigest: handoverDigest(guardSql), financialAuthority: false };
}
async function nativeReview(github, plan, phase) {
  const pins = handoverPins(), planHash = handoverDigest(plan);
  const execution = await github.execution();
  check(Number.isSafeInteger(execution?.runId) && Number.isSafeInteger(execution?.jobId), 'HANDOVER_NATIVE_EXECUTION_REQUIRED');
  const run = await github.get(`/repos/${pins.repository}/actions/runs/${execution.runId}`);
  const job = await github.get(`/repos/${pins.repository}/actions/jobs/${execution.jobId}`);
  const environment = await github.get(`/repos/${pins.repository}/environments/fcos-production-release`);
  const reviews = await github.get(`/repos/${pins.repository}/actions/runs/${execution.runId}/approvals`);
  const matching = reviews.filter(review => review.state === 'approved' && review.user?.login === pins.account && review.environments?.some(item => item.id === environment.id));
  check(run.head_sha === plan.controllerSha && run.event === 'workflow_dispatch' && run.status === 'in_progress' && run.actor?.login === pins.account
    && run.repository?.full_name === pins.repository && run.path === '.github/workflows/fcos-rapid-handover.yml'
    && job.run_id === execution.runId && job.name === 'handover-apply' && job.status === 'in_progress' && matching.length === 1 && environment.can_admins_bypass === false
    && environment.protection_rules?.some(rule => rule.type === 'required_reviewers' && rule.reviewers.some(item => item.reviewer?.login === pins.account)), 'HANDOVER_PROTECTED_NATIVE_REVIEW_REQUIRED');
  // This trusted adapter verifies exact plan/candidate binding from the native setup job inputs/artifact;
  // it must fetch provider state, never accept an uploaded JSON boolean as approval.
  check(typeof github.verifyNativePlan === 'function', 'HANDOVER_NATIVE_PLAN_BINDING_REQUIRED');
  await github.verifyNativePlan({ plan, planHash, phase, run, job, review: matching[0] });
  return { runId: run.id, jobId: job.id, reviewId: matching[0].id || null, reviewDigest: handoverDigest(matching[0]), planHash };
}
/**
 * Dedicated pg Client (never pooled transactions), direct pinned postgres/TLS connection;
 * github: identity,get (404=>null),pages (all native array pages),execution,verifyNativePlan,
 * qualification (fetch/verify exact approved setup artifact),createDeployment,findDeployment;
 * vercel: project,currentProduction,deployment. No adapter may accept raw receipt booleans as authority.
 * prepare freezes only the RELEASE singleton; abort restores its exact preimage. finalize is permanent.
 * Unknown old records are hashed/preserved, never marked resolved. Lost GH acknowledgement is reconciled
 * by findDeployment(planHash); an existing final DB receipt never permits a second blind GH submission.
 */
export async function applyHandover({ phase, plan, db, connection, github, vercel }) {
  assertHandoverConnection(connection);
  check(['prepare','abort','finalize'].includes(phase) && plan?.schemaVersion === 1 && plan.kind === 'fcos_rapid_handover_plan'
    && sha(plan.controllerSha) && sha(plan.candidateSha) && digest(plan.buildId) && digest(plan.artifactDigest)
    && plan.controlPreimage?.mode === 'qualification' && controlColumns.filter(key => key.endsWith('_id')).every(key => plan.controlPreimage[key] === null)
    && canonical(plan.pins) === canonical(handoverPins()) && plan.financialAuthority === false && plan.guardSqlDigest === handoverDigest(guardSql), 'HANDOVER_PLAN_TARGET_MISMATCH');
  const planHash = handoverDigest(plan), review = await nativeReview(github, plan, phase), external = await externalAudit({ github, vercel });
  check(external.noRunning && external.productionId === plan.previousProductionId, 'HANDOVER_OLD_WRITER_RUNNING_OR_PRODUCTION_MOVED');
  let qualification = null;
  if (phase === 'finalize') {
    check(external.retired, 'HANDOVER_OLD_WRITERS_NOT_RETIRED');
    check(external.subscribersDigest === plan.subscribersDigest, 'HANDOVER_DEPLOYMENT_SUBSCRIBERS_CHANGED');
    qualification = await github.qualification({ plan, planHash, review });
    const staged = await vercel.deployment(qualification.deploymentId);
    check(qualification.runId === review.runId && qualification.planHash === planHash && qualification.controllerSha === plan.controllerSha
      && qualification.candidateSha === plan.candidateSha && qualification.buildId === plan.buildId && qualification.artifactDigest === plan.artifactDigest
      && qualification.browser?.passed === true && qualification.browser.login === true && qualification.browser.restrictedAccess === true
      && qualification.browser.normalRole === true && qualification.browser.businessWrites === 0
      && qualification.browser.deploymentId === qualification.deploymentId && qualification.browser.buildId === plan.buildId
      && staged.id === qualification.deploymentId && staged.readyState === 'READY' && staged.target === 'production'
      && staged.projectId === plan.pins.projectId && staged.ownerId === plan.pins.teamId && staged.aliasAssigned === false
      && staged.meta?.githubCommitSha === plan.candidateSha && staged.meta?.fcosRapidBuildId === plan.buildId
      && staged.meta?.fcosRapidArtifactDigest === plan.artifactDigest && staged.meta?.fcosHandoverPlanHash === planHash, 'HANDOVER_REAL_STAGED_QUALIFICATION_REQUIRED');
  }
  const result = await transaction(db, false, async () => {
    let state = await snapshot(db, true);
    check(!state.unresolvedProduction.length && state.historyDigest === plan.historyDigest, 'HANDOVER_NATIVE_HISTORY_OR_PRODUCTION_UNCERTAINTY_CHANGED');
    const own = state.receipts.filter(row => row.handover_id === plan.handoverId);
    check(own.every(row => row.plan_hash === planHash), 'HANDOVER_RECEIPT_PLAN_CONFLICT');
    const prepared = own.find(row => row.phase === 'prepared'), finalized = own.find(row => row.phase === 'finalized');
    if (phase === 'prepare') {
      if (prepared && !own.some(row => row.phase === 'aborted') && !finalized) {
        check(state.control.mode === 'frozen' && state.guard?.digest === prepared.evidence.guardDigest && state.guard.triggers === 2, 'HANDOVER_PREPARATION_OR_GUARD_CHANGED');
        return { resumedPreparation: true, evidence: prepared.evidence };
      }
      check(!state.receipts.some(row => row.phase === 'finalized') && canonical(state.control) === canonical(plan.controlPreimage), 'HANDOVER_PREIMAGE_CHANGED');
      check(handoverDigest(external) === plan.oldInventoryDigest, 'HANDOVER_OLD_INVENTORY_CHANGED');
      if (!state.guard) { await db.query(guardSql); state = await snapshot(db, true); }
      check(state.guard?.triggers === 2, 'HANDOVER_GUARD_NOT_INSTALLED');
    } else check(prepared && !own.some(row => row.phase === 'aborted') && state.control.mode === 'frozen'
      && canonical({ ...state.control, mode: plan.controlPreimage.mode }) === canonical(plan.controlPreimage)
      && state.guard?.triggers === 2 && state.guard.digest === prepared.evidence.guardDigest, 'HANDOVER_PREPARATION_OR_GUARD_CHANGED');
    if (finalized) { check(phase === 'finalize', 'HANDOVER_FINALIZED_PERMANENT'); return { resumedFinal: true, evidence: finalized.evidence }; }
    const evidence = { review, historyDigest: state.historyDigest, otherUnknowns: state.preservedOtherUnknowns,
      controlPreimage: plan.controlPreimage, guardDigest: state.guard.digest, externalDigest: handoverDigest(external), qualificationDigest: qualification ? handoverDigest(qualification) : null };
    await db.query('insert into fcos_release_coordination.rapid_handover_receipts(handover_id,phase,plan_hash,evidence) values($1,$2,$3,$4::jsonb)', [plan.handoverId, phase === 'prepare' ? 'prepared' : phase === 'abort' ? 'aborted' : 'finalized', planHash, JSON.stringify(evidence)]);
    if (phase !== 'finalize') await db.query('update fcos_release_coordination.control set mode=$1 where singleton', [phase === 'prepare' ? 'frozen' : plan.controlPreimage.mode]);
    const postimage = (await snapshot(db, true)).control;
    check(canonical(postimage) === canonical({ ...plan.controlPreimage, mode: phase === 'abort' ? plan.controlPreimage.mode : 'frozen' }), 'HANDOVER_NATIVE_POSTIMAGE_FAILED');
    return { resumedFinal: false, evidence };
  });
  if (phase !== 'finalize') return { phase, planHash, state: phase === 'prepare' ? 'frozen-reversible' : 'restored', nativeReview: review };
  const existing = await github.findDeployment({ planHash, kind: 'fcos_rapid_release_handover' });
  if (existing) {
    check([handoverPins().account, 'github-actions[bot]'].includes(existing.creator?.login)
      && existing.payload?.kind === 'fcos_rapid_release_handover' && existing.payload.planHash === planHash
      && existing.payload.controllerSha === plan.controllerSha && existing.payload.candidateSha === plan.candidateSha
      && existing.payload.buildId === plan.buildId && existing.payload.artifactDigest === plan.artifactDigest,
    'HANDOVER_EXISTING_RECEIPT_BINDING_INVALID');
    return { phase, planHash, deploymentId: existing.id, reused: true };
  }
  check(!result.resumedFinal, 'HANDOVER_GITHUB_OUTCOME_RECONCILIATION_REQUIRED');
  const payload = { kind: 'fcos_rapid_release_handover', controllerSha: plan.controllerSha, candidateSha: plan.candidateSha,
    repository: plan.pins.repository, projectId: plan.pins.projectId, teamId: plan.pins.teamId, planHash,
    unresolvedProductionOperations: 0, oldWritersRetired: true, hostedQualificationPassed: true, eventSubscribersReviewed: true,
    inventoryDigest: result.evidence.externalDigest, nativeCoordinatorReadbackDigest: handoverDigest(result.evidence),
    finalApprovalEnvironment: 'fcos-production-release', nativeReview: review, qualificationRunId: qualification.runId,
    qualificationDeploymentId: qualification.deploymentId, buildId: plan.buildId, artifactDigest: plan.artifactDigest,
    qualificationDigest: result.evidence.qualificationDigest };
  // No implicit retry: the committed DB finalized receipt becomes the durable uncertain outcome marker.
  const created = await github.createDeployment({ ref: plan.controllerSha, auto_merge: false, required_contexts: [], environment: 'fcos-rapid-handover', production_environment: false, transient_environment: false, payload });
  const observed = await github.findDeployment({ planHash, kind: payload.kind });
  check(observed?.id === created?.id && canonical(observed.payload) === canonical(payload), 'HANDOVER_GITHUB_OUTCOME_RECONCILIATION_REQUIRED');
  return { phase, planHash, deploymentId: observed.id };
}

/** One protected setup job: reversible freeze → stage only → retire/read back old writers → finalize. */
export async function performHandover({ plan, github, coordinator, qualifyStage, retireOldWriters, vercel }) {
  check(typeof qualifyStage === 'function' && typeof retireOldWriters === 'function', 'HANDOVER_NATIVE_SETUP_CALLBACKS_REQUIRED');
  const input = { plan, github, vercel, db: coordinator?.db, connection: coordinator?.connection };
  await applyHandover({ ...input, phase: 'prepare' });
  const planHash = handoverDigest(plan);
  const ownershipVerifier = async ({ phase }) => {
    check(phase === 'stage', 'HANDOVER_SETUP_CANNOT_PROMOTE_OR_ROLLBACK');
    const review = await nativeReview(github, plan, 'qualify');
    const fresh = await auditHandover(input), own = fresh.database.receipts.find(row => row.handover_id === plan.handoverId && row.phase === 'prepared' && row.plan_hash === planHash);
    check(own && !fresh.database.receipts.some(row => row.handover_id === plan.handoverId && ['aborted','finalized'].includes(row.phase))
      && fresh.database.control.mode === 'frozen' && fresh.database.guard?.digest === own.evidence.guardDigest
      && !fresh.database.unresolvedProduction.length && fresh.database.historyDigest === plan.historyDigest
      && fresh.providers.noRunning && fresh.providers.productionId === plan.previousProductionId, 'HANDOVER_FRESH_FROZEN_OWNERSHIP_REQUIRED');
    return review;
  };
  const review = await ownershipVerifier({ phase: 'stage' });
  const qualification = await qualifyStage({ plan, planHash, nativeReview: review, ownershipVerifier });
  // The callback is trusted controller code operating the real staged build/browser, not a file reader.
  await retireOldWriters({ plan, planHash, nativeReview: review });
  return applyHandover({ ...input, phase: 'finalize', github: Object.assign(Object.create(github), { qualification: async () => qualification }) });
}
