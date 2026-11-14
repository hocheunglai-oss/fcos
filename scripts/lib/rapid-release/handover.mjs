import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fcosConnectionIdentifier } from '../../../config/fcosConnections.js';
import { assertPinnedDatabaseIdentity, isNativeDelegatedConnection } from './database-connection.mjs';
import { assertNativeBootstrapAdmission, verifyLockedBootstrap } from './bootstrap-admission.mjs';
import { verifyLockedBootstrapSuccessor } from './bootstrap-successor.mjs';
import { digest as releaseDigest } from './contract.mjs';
import { isNativeReadonlyConnection, assertReadonlyDatabaseIdentity, installReadonlyHandoverPolicy } from './readonly-database.mjs';
import { lockStagingTransition } from './staging-ownership.mjs';

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


// Human-observed native configuration, explicitly reviewed as part of the exact
// protected handover plan. This is never labelled as API-verified app inventory.
export function validateAdministratorApplicationInventory(report, { now = Date.now() } = {}) {
  const pins = handoverPins(), exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
  check(exact(report, ['schemaVersion','mode','account','repository','collectedAt','scope','source','evidenceDigest','entries'])
    && report.schemaVersion === 1 && report.mode === 'administrator-reviewed-native' && report.account === pins.account
    && report.repository === pins.repository && report.scope === 'all_repository_installations'
    && report.source === 'github_repository_settings_and_configure_pages' && digest(report.evidenceDigest), 'HANDOVER_COMPLETE_ADMIN_APP_REPORT_REQUIRED');
  const collected = Date.parse(report.collectedAt);
  check(Number.isFinite(now) && Number.isFinite(collected) && new Date(collected).toISOString() === report.collectedAt
    && now >= collected && now - collected <= 86400000, 'HANDOVER_ADMIN_APP_REPORT_EXPIRED');
  check(Array.isArray(report.entries) && report.entries.length > 0 && report.entries.length <= 1000, 'HANDOVER_COMPLETE_ADMIN_APP_REPORT_REQUIRED');
  const seen = new Set(), label = value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,80}$/.test(value);
  const entries = report.entries.map(entry => {
    check(exact(entry, ['installationId','appId','name','events','permissions','repositoryScope','configurationState','disposition','evidenceDigest'])
      && Number.isSafeInteger(entry.installationId) && entry.installationId > 0 && !seen.has(entry.installationId)
      && Number.isSafeInteger(entry.appId) && entry.appId > 0 && typeof entry.name === 'string' && /^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,99}$/.test(entry.name || '')
      && ['current','suspended'].includes(entry.configurationState) && ['read-only','reviewed-nonconflicting','retired'].includes(entry.disposition)
      && digest(entry.evidenceDigest), 'HANDOVER_ADMIN_APP_CONFIGURATION_UNVERIFIED');
    check(entry.disposition === 'retired' ? entry.configurationState === 'suspended' : entry.configurationState === 'current', 'HANDOVER_ADMIN_APP_CONFIGURATION_UNVERIFIED');
    seen.add(entry.installationId);
    check(Array.isArray(entry.events) && entry.events.every(label) && new Set(entry.events).size === entry.events.length
      && entry.permissions && Object.getPrototypeOf(entry.permissions) === Object.prototype && Object.keys(entry.permissions).length > 0
      && Object.entries(entry.permissions).every(([name,value]) => label(name) && ['read','write'].includes(value))
      && exact(entry.repositoryScope, ['selection','repository']) && ['all','selected'].includes(entry.repositoryScope.selection)
      && entry.repositoryScope.repository === pins.repository, 'HANDOVER_ADMIN_APP_CONFIGURATION_UNVERIFIED');
    check(entry.disposition !== 'read-only' || Object.values(entry.permissions).every(value => value === 'read'), 'HANDOVER_ADMIN_APP_DISPOSITION_CONFLICT');
    return { ...entry, events: [...entry.events].sort(), permissions: Object.fromEntries(Object.entries(entry.permissions).sort()), repositoryScope: { ...entry.repositoryScope } };
  }).sort((a,b) => a.installationId - b.installationId);
  return { ...report, entries };
}

export function assertHandoverConnection(connection) {
  if (isNativeReadonlyConnection(connection)) return;
  if (isNativeDelegatedConnection(connection)) return;
  const direct = connection?.host === fcosConnectionIdentifier('supabase', 'Database direct host') && connection.user === 'postgres';
  const session = connection?.host === fcosConnectionIdentifier('supabase', 'Database session host')
    && connection.user === fcosConnectionIdentifier('supabase', 'Database session user');
  // Session pooling preserves the transaction/session guarantees used below.
  // The shared host alone is insufficient: the username must pin this project.
  check((direct || session) && connection.port === 5432
    && connection.database === 'postgres' && connection.ssl?.rejectUnauthorized === true, 'HANDOVER_PINNED_TLS_POSTGRES_REQUIRED');
}
export function assertHandoverDatabaseIdentity(identity, connection, { readOnly = true, context = 'handover' } = {}) {
  assertHandoverConnection(connection);
  if (isNativeReadonlyConnection(connection)) return assertReadonlyDatabaseIdentity(identity, connection, { readOnly });
  if (isNativeDelegatedConnection(connection)) return assertPinnedDatabaseIdentity(identity, connection, { readOnly });
  const codes = { handover: 'HANDOVER_DATABASE_IDENTITY_MISMATCH', bootstrap: 'BOOTSTRAP_DATABASE_IDENTITY_MISMATCH',
    compatibility: 'NATIVE_COMPATIBILITY_DATABASE_IDENTITY_MISMATCH' };
  check(typeof readOnly === 'boolean' && Object.hasOwn(codes, context)
    && identity?.session_user === 'postgres' && identity.current_user === 'postgres' && identity.database === 'postgres'
    && identity.read_only === (readOnly ? 'on' : 'off'), codes[context] || 'HANDOVER_DATABASE_IDENTITY_MISMATCH');
  return identity;
}
async function transaction(db, connection, readOnly, callback) {
  assertHandoverConnection(connection);
  await db.query(`begin isolation level ${readOnly ? 'repeatable read read only' : 'read committed read write'}`);
  try { const identity = (await db.query('select session_user, current_user, current_database() as database, current_setting(\'transaction_read_only\') as read_only')).rows[0];
    assertHandoverDatabaseIdentity(identity, connection, { readOnly });
    const result = await callback(); await db.query('commit'); return result;
  } catch (error) { await db.query('rollback'); throw error; }
}
/** Run actual pg reads with the same pinned native/session identity checks as handover. */
export function withHandoverReadOnlyTransaction({ db, connection }, work) {
  check(typeof work === 'function', 'HANDOVER_NATIVE_DATABASE_READER_REQUIRED');
  return transaction(db, connection, true, () => work(db));
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
  if (locked && tables.includes('rapid_handover_receipts')) await db.query('lock table fcos_release_coordination.rapid_handover_receipts in share row exclusive mode');
  const receipts = tables.includes('rapid_handover_receipts') ? (await db.query('select receipt_id,handover_id,phase,plan_hash,evidence from fcos_release_coordination.rapid_handover_receipts order by receipt_id')).rows : [];
  const guard = receipts.length || tables.includes('rapid_handover_receipts') ? (await db.query("select encode(sha256(convert_to(pg_get_functiondef('fcos_release_coordination.rapid_handover_control_guard()'::regprocedure),'UTF8')),'hex') as digest, (select count(*)::int from pg_trigger where tgrelid='fcos_release_coordination.control'::regclass and tgname in ('rapid_handover_control_guard','rapid_handover_control_no_truncate') and tgenabled='O') as triggers")).rows[0] : null;
  return { control, historyDigest: handoverDigest(history), history, unresolvedProduction: unresolved.filter(row => /^production\.(stage|promote|rollback)$/.test(row.phase)),
    preservedOtherUnknowns: { count: unresolved.filter(row => !/^production\.(stage|promote|rollback)$/.test(row.phase)).length, digest: handoverDigest(unresolved.filter(row => !/^production\.(stage|promote|rollback)$/.test(row.phase))) }, receipts, guard };
}
export { transaction as handoverTransaction, snapshot as readHandoverSnapshot };

function openHandovers(receipts, ownId = null) {
  return receipts.filter(row => row.phase === 'prepared' && row.handover_id !== ownId
    && !receipts.some(closed => closed.handover_id === row.handover_id && ['aborted','finalized'].includes(closed.phase)));
}
function parentMatches(active, receipt) {
  return Boolean(active && receipt && active.handoverId === receipt.handover_id && active.planHash === receipt.plan_hash
    && Number(active.databaseReceiptId) === Number(receipt.receipt_id) && active.controllerSha === receipt.evidence.controllerSha
    && active.nativeCoordinatorReadbackDigest === handoverDigest(receipt.evidence));
}
function assertParentState(state, external, plan = null) {
  const receipts = state.receipts || [], ownId = plan?.handoverId;
  check(!openHandovers(receipts, ownId).length, 'HANDOVER_OTHER_PREPARATION_UNRESOLVED');
  const ownFinal = receipts.find(row => row.handover_id === ownId && row.phase === 'finalized');
  const latest = receipts.filter(row => row.phase === 'finalized').at(-1) || null;
  if (ownFinal) check(latest?.handover_id === ownId, 'HANDOVER_PARENT_CHANGED');
  const parent = receipts.filter(row => row.phase === 'finalized' && row.handover_id !== ownId).at(-1) || null;
  const active = external.activeHandover || null;
  if (!plan) {
    check(!parent || parentMatches(active, parent), 'HANDOVER_ACTIVE_PARENT_UNCERTAIN');
    check(parent || !active, 'HANDOVER_ACTIVE_PARENT_UNCERTAIN');
    return active;
  }
  if (plan.supersedes) {
    check(parentMatches(plan.supersedes, parent), 'HANDOVER_PARENT_CHANGED');
    check(parentMatches(active, parent) && canonical(active) === canonical(plan.supersedes)
      || ownFinal && parentMatches(active, ownFinal), 'HANDOVER_ACTIVE_PARENT_UNCERTAIN');
  } else check(!parent && (!active || ownFinal && parentMatches(active, ownFinal)), 'HANDOVER_PARENT_CHANGED');
  return plan.supersedes || null;
}
export function assertHandoverActivation({ plan, audit, deploymentId }) {
  const latest = audit.database.receipts.filter(row => row.phase === 'finalized').at(-1);
  check(latest?.handover_id === plan.handoverId && latest.plan_hash === handoverDigest(plan)
    && !openHandovers(audit.database.receipts).length && !audit.database.unresolvedProduction.length
    && audit.providers.rapidJournal?.unresolvedProduction === 0 && canonical(audit.providers.rapidJournal) === canonical(plan.rapidJournal)
    && audit.database.control.mode === 'frozen' && audit.database.historyDigest === plan.historyDigest
    && audit.database.guard?.digest === latest.evidence.guardDigest && audit.database.guard.triggers === 2
    && audit.providers.retired && audit.providers.noRunning && audit.providers.productionId === plan.previousProductionId
    && audit.providers.subscribersDigest === plan.subscribersDigest, 'HANDOVER_ACTIVATION_STATE_CHANGED');
  assertParentState(audit.database, audit.providers, plan);
  const active = audit.providers.activeHandover;
  check(!active || active.deploymentId !== deploymentId || parentMatches(active, latest), 'HANDOVER_ACTIVATION_STATE_CHANGED');
  return { databaseReceiptId: Number(latest.receipt_id), evidenceDigest: handoverDigest(latest.evidence) };
}

async function externalAudit({ github, vercel }) {
  const pins = handoverPins(), identity = await github.identity();
  check(identity.login === pins.account && identity.repository === pins.repository, 'HANDOVER_GITHUB_IDENTITY_MISMATCH');
  check(typeof github.eventSubscribers === 'function', 'HANDOVER_DEPLOYMENT_SUBSCRIBER_INVENTORY_REQUIRED');
  check(typeof github.rapidJournalAudit === 'function', 'HANDOVER_RAPID_JOURNAL_AUDIT_REQUIRED');
  check(typeof github.activeHandover === 'function', 'HANDOVER_ACTIVE_PARENT_AUDIT_REQUIRED');

  const base = `/repos/${pins.repository}/actions`;
  const variableReads = OLD_RELEASE_VARIABLES.map(name => async () => {
    const row = await github.get(`${base}/variables/${name}`);
    return [name, row?.value ?? null];
  });
  const workflowReads = OLD_RELEASE_WORKFLOWS.map(name => async () => {
    const row = await github.get(`${base}/workflows/${name}`);
    const runs = row ? await github.pages(`${base}/workflows/${row.id}/runs?per_page=100`) : [];
    return [name, { id: row?.id || null, state: row?.state || 'absent', running: runs.filter(run => run.status !== 'completed').map(run => run.id) }];
  });
  const providerReads = [
    async () => {
      const project = await vercel.project();
      check(project.id === pins.projectId && project.accountId === pins.teamId && project.autoAssignCustomDomains === false, 'HANDOVER_VERCEL_TARGET_OR_AUTO_ASSIGNMENT');
      return vercel.currentProduction();
    },
    () => github.eventSubscribers(),
    () => github.rapidJournalAudit(),
    () => github.activeHandover(),
  ];
  const reads = [...variableReads, ...workflowReads, ...providerReads];
  // Bound concurrent reads and drain each group before propagating a failure.
  // A later phase must never start while part of an unsuccessful audit is live.
  const results = [];
  const concurrency = 4;
  for (let start = 0; start < reads.length; start += concurrency) {
    const group = await Promise.allSettled(reads.slice(start, start + concurrency).map(read => Promise.resolve().then(read)));
    const failed = group.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    results.push(...group.map(result => result.value));
  }
  const workflowStart = variableReads.length;
  const providerStart = workflowStart + workflowReads.length;
  const variables = Object.fromEntries(results.slice(0, workflowStart));
  const workflows = Object.fromEntries(results.slice(workflowStart, providerStart));
  const [production, subscribers, rapidJournal, activeHandover] = results.slice(providerStart);
  check(digest(rapidJournal?.digest) && Number.isSafeInteger(rapidJournal.unresolvedProduction) && rapidJournal.unresolvedProduction >= 0, 'HANDOVER_RAPID_JOURNAL_AUDIT_REQUIRED');
  check(Array.isArray(subscribers?.inventory) && digest(subscribers.evidenceDigest), 'HANDOVER_DEPLOYMENT_SUBSCRIBER_INVENTORY_REQUIRED');
  return { variables, workflows, rapidJournal, activeHandover, subscribersDigest: handoverDigest(subscribers),
    ...(subscribers.applicationInventory ? { applicationInventoryReportDigest: subscribers.applicationInventory.reportDigest } : {}), productionId: production.id, retired: Object.values(variables).every(value => value !== 'true')
    && Object.values(workflows).every(row => row.state === 'absent' || row.state.startsWith('disabled')), noRunning: Object.values(workflows).every(row => row.running.length === 0) };
}
// Native preflight before issuing a database credential. This never substitutes
// for the fresh audit inside a leased/locked operation.
export { externalAudit as auditHandoverProviders };
export async function preflightHandoverProviders({ plan, github, vercel }) {
  const scoped = Object.assign(Object.create(github), { activeHandover: () => github.activeHandover({ pendingPlan: plan }) });
  const audit = await externalAudit({ github: scoped, vercel });
  check(audit.noRunning && audit.productionId === plan.previousProductionId, 'HANDOVER_OLD_WRITER_RUNNING_OR_PRODUCTION_MOVED');
  check(audit.rapidJournal.unresolvedProduction === 0, 'HANDOVER_RAPID_OPERATION_OR_JOURNAL_CHANGED');
  return audit;
}
export async function auditHandover({ db, connection, github, vercel }) {
  assertHandoverConnection(connection);
  return { database: await transaction(db, connection, true, () => snapshot(db)), providers: await externalAudit({ github, vercel }) };
}
export function createHandoverPlan({ audit, controllerSha, candidateSha, buildId, artifactDigest, handoverId, applicationInventoryReport, bootstrapAdmission, bootstrapPlan, now = Date.now() }) {
  check(sha(controllerSha) && sha(candidateSha) && digest(buildId) && digest(artifactDigest) && /^[a-z0-9-]{8,96}$/.test(handoverId), 'HANDOVER_PLAN_INVALID');
  const report = applicationInventoryReport ? validateAdministratorApplicationInventory(applicationInventoryReport, { now }) : null;
  check(!audit.providers.applicationInventoryReportDigest || report && handoverDigest(report) === audit.providers.applicationInventoryReportDigest, 'HANDOVER_ADMIN_APP_REPORT_BINDING_REQUIRED');
  check(!report || handoverDigest(report) === audit.providers.applicationInventoryReportDigest, 'HANDOVER_ADMIN_APP_REPORT_BINDING_REQUIRED');
  check(audit.providers.rapidJournal?.unresolvedProduction === 0, 'HANDOVER_RAPID_OPERATION_UNRESOLVED');
  const supersedes = assertParentState(audit.database, audit.providers);
  let bootstrap;
  if (bootstrapAdmission || bootstrapPlan) {
    check(!supersedes, 'HANDOVER_BOOTSTRAP_INITIAL_ONLY');
    const reference = assertNativeBootstrapAdmission(bootstrapAdmission, { controllerSha, now });
    check(bootstrapPlan?.controllerSha === reference.bootstrap.controllerSha && releaseDigest(bootstrapPlan) === reference.bootstrap.planHash
      && (reference.schemaVersion === 1 ? bootstrapPlan.controllerSha === controllerSha
        : reference.kind === 'fcos_initial_bootstrap_successor_reference' && reference.successor?.plan.controllerSha === controllerSha
          && reference.successor.plan.rootPlanHash === releaseDigest(bootstrapPlan))
      && canonical(audit.database.control) === canonical(bootstrapAdmission.controlPreimage), 'HANDOVER_BOOTSTRAP_PREIMAGE_MISMATCH');
    bootstrap = { plan: bootstrapPlan, reference };
  }
  check(!(audit.database.receipts || []).some(row => row.handover_id === handoverId), 'HANDOVER_ID_ALREADY_USED');
  const c = audit.database.control;
  check(c.mode === (supersedes || bootstrap ? 'frozen' : 'qualification') && (!supersedes || controllerSha !== supersedes.controllerSha) && c.singleton === true && Number.isSafeInteger(Number(c.epoch)) && Number(c.epoch) > 0
    && controlColumns.filter(key => key.endsWith('_id')).every(key => c[key] === null) && !audit.database.unresolvedProduction.length && audit.providers.noRunning, 'HANDOVER_QUIESCENT_QUALIFICATION_REQUIRED');
  return { schemaVersion: 1, kind: 'fcos_rapid_handover_plan', handoverId, controllerSha, candidateSha, buildId, artifactDigest,
    pins: handoverPins(), ...(supersedes ? { supersedes } : {}), ...(bootstrap ? { bootstrap } : {}), rapidJournal: audit.providers.rapidJournal, controlPreimage: c, historyDigest: audit.database.historyDigest, oldInventoryDigest: handoverDigest(audit.providers),
    ...(report ? { applicationInventoryReport: report } : {}),
    previousProductionId: audit.providers.productionId, subscribersDigest: audit.providers.subscribersDigest, guardSqlDigest: handoverDigest(guardSql), financialAuthority: false };
}
async function freshBootstrapAdmission(github, plan) {
  if (!plan.bootstrap) return;
  check(!plan.supersedes && typeof github.bootstrapAdmission === 'function', 'HANDOVER_BOOTSTRAP_NATIVE_ADMISSION_REQUIRED');
  const admission = await github.bootstrapAdmission({ plan });
  assertNativeBootstrapAdmission(admission, { controllerSha: plan.controllerSha, reference: plan.bootstrap.reference });
  check(canonical(admission.controlPreimage) === canonical(plan.controlPreimage), 'HANDOVER_BOOTSTRAP_PREIMAGE_MISMATCH');
  return admission;
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
  check(sha(run.head_sha) && run.event === 'workflow_dispatch' && run.status === 'in_progress' && run.actor?.login === pins.account
    && run.repository?.full_name === pins.repository && String(run.path || '').split('@')[0] === '.github/workflows/fcos-rapid-handover.yml'
    && job.run_id === execution.runId && job.name === 'handover-apply' && job.status === 'in_progress' && matching.length === 1 && Number.isSafeInteger(matching[0]?.user?.id) && environment.can_admins_bypass === false
    && environment.protection_rules?.some(rule => rule.type === 'required_reviewers' && rule.reviewers.some(item => item.reviewer?.login === pins.account)), 'HANDOVER_PROTECTED_NATIVE_REVIEW_REQUIRED');
  const workflowPath = '.github/workflows/fcos-rapid-handover.yml';
  const file = ref => github.get(`/repos/${pins.repository}/contents/${workflowPath}?ref=${ref}`);
  const [frozen,current] = run.head_sha === plan.controllerSha ? await file(plan.controllerSha).then(value => [value,value]) : await Promise.all([file(plan.controllerSha),file(run.head_sha)]);
  check(frozen?.type === 'file' && current?.type === 'file' && sha(frozen.sha) && frozen.sha === current.sha, 'HANDOVER_FROZEN_WORKFLOW_CHANGED');
  // This trusted adapter verifies exact plan/candidate binding from the native setup job inputs/artifact;
  // it must fetch provider state, never accept an uploaded JSON boolean as approval.
  check(typeof github.verifyNativePlan === 'function', 'HANDOVER_NATIVE_PLAN_BINDING_REQUIRED');
  await github.verifyNativePlan({ plan, planHash, phase, run, job, review: matching[0] });
  return { runId: run.id, jobId: job.id, reviewId: matching[0].id || null, reviewDigest: handoverDigest(matching[0]), planHash,
    reviewer: matching[0].user.login, reviewerId: matching[0].user.id, state: matching[0].state,
    environment: environment.name || 'fcos-production-release', environmentId: environment.id,
    protectionDigest: handoverDigest({ id:environment.id, rules:environment.protection_rules, canAdminsBypass:environment.can_admins_bypass }),
    dispatcherSha: run.head_sha, workflowPath, workflowBlobSha: frozen.sha, observedAt: new Date().toISOString() };
}
/**
 * Dedicated pg Client (never pooled transactions), direct pinned postgres/TLS connection;
 * github: identity,get (404=>null),pages (all native array pages),execution,verifyNativePlan,
 * qualification (fetch/verify exact approved setup artifact),createDeployment,findDeployment;
 * vercel: project,currentProduction,deployment. No adapter may accept raw receipt booleans as authority.
 * Initial prepare freezes only the RELEASE singleton; abort restores its preimage.
 * A native bootstrap preimage is already permanently frozen and never unfrozen on abort.
 * Successors leave that permanent fence unchanged and append independently reviewed receipts.
 * Unknown old records are hashed/preserved, never marked resolved. Lost GH acknowledgement is reconciled
 * by findDeployment(planHash); an existing final DB receipt never permits a second blind GH submission.
 */
export async function applyHandover({ phase, plan, db, connection, github, vercel }) {
  assertHandoverConnection(connection);
  check(['prepare','abort','finalize'].includes(phase) && plan?.schemaVersion === 1 && plan.kind === 'fcos_rapid_handover_plan'
    && sha(plan.controllerSha) && sha(plan.candidateSha) && digest(plan.buildId) && digest(plan.artifactDigest)
    && !(plan.supersedes && plan.bootstrap) && plan.controlPreimage?.mode === (plan.supersedes || plan.bootstrap ? 'frozen' : 'qualification') && controlColumns.filter(key => key.endsWith('_id')).every(key => plan.controlPreimage[key] === null)
    && canonical(plan.pins) === canonical(handoverPins()) && plan.financialAuthority === false && plan.guardSqlDigest === handoverDigest(guardSql), 'HANDOVER_PLAN_TARGET_MISMATCH');
  if (plan.applicationInventoryReport) validateAdministratorApplicationInventory(plan.applicationInventoryReport);
  const bootstrapAdmission = await freshBootstrapAdmission(github, plan);
  const planHash = handoverDigest(plan), review = await nativeReview(github, plan, phase), external = await externalAudit({ github, vercel });
  check(!external.applicationInventoryReportDigest || plan.applicationInventoryReport
    && handoverDigest(validateAdministratorApplicationInventory(plan.applicationInventoryReport)) === external.applicationInventoryReportDigest, 'HANDOVER_ADMIN_APP_REPORT_BINDING_REQUIRED');
  check(external.rapidJournal.unresolvedProduction === 0 && canonical(external.rapidJournal) === canonical(plan.rapidJournal), 'HANDOVER_RAPID_OPERATION_OR_JOURNAL_CHANGED');
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
  const result = await transaction(db, connection, false, async () => {
    await lockStagingTransition(db);
    const currentJournal = await github.rapidJournalAudit();
    check(currentJournal.unresolvedProduction === 0 && canonical(currentJournal) === canonical(plan.rapidJournal),
      'HANDOVER_RAPID_OPERATION_OR_JOURNAL_CHANGED');
    let state = await snapshot(db, true);
    if (plan.bootstrap) {
      assertNativeBootstrapAdmission(bootstrapAdmission, { controllerSha: plan.controllerSha, reference: plan.bootstrap.reference });
      if (plan.bootstrap.reference.schemaVersion === 2) {
        await verifyLockedBootstrapSuccessor({ db, github, bootstrapPlan: plan.bootstrap.plan, controllerSha: plan.controllerSha, reference: plan.bootstrap.reference });
      } else {
        await verifyLockedBootstrap({ db, bootstrapPlan: plan.bootstrap.plan, controllerSha: plan.controllerSha, reference: plan.bootstrap.reference });
      }
    }
    check(!state.unresolvedProduction.length && state.historyDigest === plan.historyDigest, 'HANDOVER_NATIVE_HISTORY_OR_PRODUCTION_UNCERTAINTY_CHANGED');
    assertParentState(state, external, plan);
    const own = state.receipts.filter(row => row.handover_id === plan.handoverId);
    check(own.every(row => row.plan_hash === planHash), 'HANDOVER_RECEIPT_PLAN_CONFLICT');
    const prepared = own.find(row => row.phase === 'prepared'), finalized = own.find(row => row.phase === 'finalized');
    if (phase === 'prepare') {
      if (prepared && !own.some(row => row.phase === 'aborted') && !finalized) {
        check(state.control.mode === 'frozen' && state.guard?.digest === prepared.evidence.guardDigest && state.guard.triggers === 2, 'HANDOVER_PREPARATION_OR_GUARD_CHANGED');
        return { resumedPreparation: true, evidence: prepared.evidence };
      }
      check(!finalized && (plan.supersedes || !state.receipts.some(row => row.phase === 'finalized'))
        && canonical(state.control) === canonical(plan.controlPreimage), 'HANDOVER_PREIMAGE_CHANGED');
      check(handoverDigest(external) === plan.oldInventoryDigest, 'HANDOVER_OLD_INVENTORY_CHANGED');
      if (!state.guard) { await db.query(guardSql); await installReadonlyHandoverPolicy(db); state = await snapshot(db, true); }
      check(state.guard?.triggers === 2, 'HANDOVER_GUARD_NOT_INSTALLED');
    } else check(prepared && !own.some(row => row.phase === 'aborted') && state.control.mode === 'frozen'
      && canonical({ ...state.control, mode: plan.controlPreimage.mode }) === canonical(plan.controlPreimage)
      && state.guard?.triggers === 2 && state.guard.digest === prepared.evidence.guardDigest, 'HANDOVER_PREPARATION_OR_GUARD_CHANGED');
    if (finalized) { check(phase === 'finalize', 'HANDOVER_FINALIZED_PERMANENT'); return { resumedFinal: true, evidence: finalized.evidence, receiptId: Number(finalized.receipt_id) }; }
    const evidence = { review, controllerSha: plan.controllerSha, candidateSha: plan.candidateSha, buildId: plan.buildId, artifactDigest: plan.artifactDigest, supersedes: plan.supersedes || null, historyDigest: state.historyDigest, otherUnknowns: state.preservedOtherUnknowns,
      controlPreimage: plan.controlPreimage, ...(plan.bootstrap ? { bootstrap: plan.bootstrap.reference } : {}), guardDigest: state.guard.digest, externalDigest: handoverDigest(external), qualificationDigest: qualification ? handoverDigest(qualification) : null };
    const inserted = await db.query('insert into fcos_release_coordination.rapid_handover_receipts(handover_id,phase,plan_hash,evidence) values($1,$2,$3,$4::jsonb) returning receipt_id', [plan.handoverId, phase === 'prepare' ? 'prepared' : phase === 'abort' ? 'aborted' : 'finalized', planHash, JSON.stringify(evidence)]);
    if (phase !== 'finalize' && !plan.supersedes && !plan.bootstrap) await db.query('update fcos_release_coordination.control set mode=$1 where singleton', [phase === 'prepare' ? 'frozen' : plan.controlPreimage.mode]);
    const postimage = (await snapshot(db, true)).control;
    check(canonical(postimage) === canonical({ ...plan.controlPreimage, mode: phase === 'abort' ? plan.controlPreimage.mode : 'frozen' }), 'HANDOVER_NATIVE_POSTIMAGE_FAILED');
    return { resumedFinal: false, evidence, receiptId: Number(inserted.rows[0].receipt_id) };
  });
  if (phase !== 'finalize') return { phase, planHash, state: plan.bootstrap ? 'frozen' : phase === 'prepare' ? 'frozen-reversible' : 'restored', nativeReview: review };
  const existing = await github.findDeployment({ planHash, kind: 'fcos_rapid_release_handover' });
  if (existing) {
    check(existing.creator?.login === handoverPins().account
      && existing.payload?.kind === 'fcos_rapid_release_handover' && existing.payload.planHash === planHash
      && canonical(existing.payload.plan) === canonical(plan)
      && existing.payload.controllerSha === plan.controllerSha && existing.payload.candidateSha === plan.candidateSha
      && existing.payload.buildId === plan.buildId && existing.payload.artifactDigest === plan.artifactDigest
      && existing.payload.handoverId === plan.handoverId && existing.payload.databaseReceiptId === result.receiptId
      && canonical(existing.payload.supersedes) === canonical(plan.supersedes || null)
      && existing.payload.nativeCoordinatorReadbackDigest === handoverDigest(result.evidence),
    'HANDOVER_EXISTING_RECEIPT_BINDING_INVALID');
    return { phase, planHash, deploymentId: existing.id, reused: true };
  }
  check(!result.resumedFinal, 'HANDOVER_GITHUB_OUTCOME_RECONCILIATION_REQUIRED');
  const payload = { kind: 'fcos_rapid_release_handover', attestationContract: 'fcos-owner-recorded-handover/v1',
    qualificationPublisher: { account: plan.pins.account, method: 'protected_controller_api' }, plan, handoverId: plan.handoverId, databaseReceiptId: result.receiptId, supersedes: plan.supersedes || null, controllerSha: plan.controllerSha, candidateSha: plan.candidateSha,
    repository: plan.pins.repository, projectId: plan.pins.projectId, teamId: plan.pins.teamId, planHash,
    unresolvedProductionOperations: 0, oldWritersRetired: true, hostedQualificationPassed: true, eventSubscribersReviewed: true,
    inventoryDigest: result.evidence.externalDigest, nativeCoordinatorReadbackDigest: handoverDigest(result.evidence),
    finalApprovalEnvironment: 'fcos-production-release', nativeReview: review, qualificationRunId: qualification.runId,
    qualificationDeploymentId: qualification.deploymentId, buildId: plan.buildId, artifactDigest: plan.artifactDigest,
    qualificationDigest: result.evidence.qualificationDigest };
  // No implicit retry: the committed DB finalized receipt becomes the durable uncertain outcome marker.
  const created = await github.createDeployment({ ref: plan.controllerSha, auto_merge: false, required_contexts: [], environment: 'fcos-rapid-handover', production_environment: false, transient_environment: false, payload });
  const observed = await github.findDeployment({ planHash, kind: payload.kind });
  check(observed?.id === created?.id && observed.creator?.login === plan.pins.account && canonical(observed.payload) === canonical(payload), 'HANDOVER_GITHUB_OUTCOME_RECONCILIATION_REQUIRED');
  return { phase, planHash, deploymentId: observed.id };
}

/** Read an already committed final outcome. Absence of its GitHub acknowledgement
 * is uncertainty, never permission to publish again. The original protected
 * qualification/review remains in the native receipt; the current protected job
 * must independently authorize the exact plan before activation can continue.
 */
export async function readFinalizedHandover({ plan, db, connection, github, vercel }) {
  check(plan?.kind === 'fcos_rapid_handover_plan' && canonical(plan.pins) === canonical(handoverPins())
    && sha(plan.controllerSha) && plan.financialAuthority === false, 'HANDOVER_PLAN_TARGET_MISMATCH');
  const planHash = handoverDigest(plan);
  const exists = await transaction(db, connection, true, async () => {
    if (!(await db.query("select to_regclass('fcos_release_coordination.rapid_handover_receipts')::text as name")).rows[0].name) return false;
    return (await db.query("select receipt_id from fcos_release_coordination.rapid_handover_receipts where handover_id=$1 and phase='finalized'", [plan.handoverId])).rows.length > 0;
  });
  if (!exists) return null;
  if (plan.applicationInventoryReport) validateAdministratorApplicationInventory(plan.applicationInventoryReport);
  const admission = await freshBootstrapAdmission(github, plan);
  await nativeReview(github, plan, 'activate');
  const external = await externalAudit({ github: Object.assign(Object.create(github), {
    activeHandover: () => github.activeHandover({ pendingPlan: plan }),
  }), vercel });
  const native = await github.findDeployment({ planHash, kind: 'fcos_rapid_release_handover' });
  check(native && Number.isSafeInteger(native.id), 'HANDOVER_GITHUB_OUTCOME_RECONCILIATION_REQUIRED');
  const result = await transaction(db, connection, false, async () => {
    const state = await snapshot(db, true);
    if (plan.bootstrap) {
      assertNativeBootstrapAdmission(admission, { controllerSha: plan.controllerSha, reference: plan.bootstrap.reference });
      if (plan.bootstrap.reference.schemaVersion === 2) await verifyLockedBootstrapSuccessor({ db, github, bootstrapPlan: plan.bootstrap.plan, controllerSha: plan.controllerSha, reference: plan.bootstrap.reference });
      else await verifyLockedBootstrap({ db, bootstrapPlan: plan.bootstrap.plan, controllerSha: plan.controllerSha, reference: plan.bootstrap.reference });
    }
    const receipt = assertHandoverActivation({ plan, audit: { database: state, providers: external }, deploymentId: native.id });
    const finalized = state.receipts.find(row => Number(row.receipt_id) === receipt.databaseReceiptId), p = native.payload;
    check(native.creator?.login === plan.pins.account && native.sha === plan.controllerSha && native.environment === 'fcos-rapid-handover'
      && p?.kind === 'fcos_rapid_release_handover' && p.attestationContract === 'fcos-owner-recorded-handover/v1'
      && canonical(p.plan) === canonical(plan) && p.planHash === planHash && p.handoverId === plan.handoverId
      && p.controllerSha === plan.controllerSha && p.candidateSha === plan.candidateSha && p.buildId === plan.buildId && p.artifactDigest === plan.artifactDigest
      && p.repository === plan.pins.repository && p.projectId === plan.pins.projectId && p.teamId === plan.pins.teamId
      && p.databaseReceiptId === receipt.databaseReceiptId && p.nativeCoordinatorReadbackDigest === receipt.evidenceDigest
      && canonical(p.nativeReview) === canonical(finalized.evidence.review) && p.qualificationRunId === finalized.evidence.review.runId
      && p.qualificationDigest === finalized.evidence.qualificationDigest && digest(p.qualificationDigest)
      && p.qualificationPublisher?.account === plan.pins.account && p.qualificationPublisher.method === 'protected_controller_api'
      && p.finalApprovalEnvironment === 'fcos-production-release' && p.unresolvedProductionOperations === 0
      && p.oldWritersRetired === true && p.hostedQualificationPassed === true && p.eventSubscribersReviewed === true,
    'HANDOVER_EXISTING_RECEIPT_BINDING_INVALID');
    return { phase: 'finalize', planHash, deploymentId: native.id, reused: true };
  });
  const staged = await vercel.deployment(native.payload.qualificationDeploymentId);
  check(staged?.id === native.payload.qualificationDeploymentId && staged.readyState === 'READY' && staged.target === 'production'
    && staged.projectId === plan.pins.projectId && staged.ownerId === plan.pins.teamId && staged.aliasAssigned === false
    && staged.meta?.githubCommitSha === plan.candidateSha && staged.meta.fcosRapidBuildId === plan.buildId
    && staged.meta.fcosRapidArtifactDigest === plan.artifactDigest && staged.meta.fcosHandoverPlanHash === planHash,
  'HANDOVER_REAL_STAGED_QUALIFICATION_REQUIRED');
  return result;
}

/** One protected setup job. withCoordinator(phase, work) owns a fresh native
 * context for the entire short work callback and closes it in finally. No
 * database context or transaction is retained across stage/browser waits.
 * A fixed coordinator remains supported for callers owning its native lifetime.
 */
export async function performHandover({ plan, github, coordinator, qualifyStage, retireOldWriters, vercel }) {
  check(typeof qualifyStage === 'function' && typeof retireOldWriters === 'function', 'HANDOVER_NATIVE_SETUP_CALLBACKS_REQUIRED');
  const input = { plan, github, vercel, db: coordinator?.db, connection: coordinator?.connection };
  const scoped = (phase, work) => typeof coordinator?.withCoordinator === 'function'
    ? coordinator.withCoordinator(phase, context => work({ ...context, plan })) : work(input);
  const initial = await scoped('prepare', async context => await readFinalizedHandover(context)
    || applyHandover({ ...context, phase: 'prepare' }));
  if (initial.phase === 'finalize') return initial;
  const planHash = handoverDigest(plan);
  const ownershipVerifier = async ({ phase }) => {
    check(phase === 'stage', 'HANDOVER_SETUP_CANNOT_PROMOTE_OR_ROLLBACK');
    return scoped('stage', async context => {
    await freshBootstrapAdmission(context.github, plan);
    const review = await nativeReview(context.github, plan, 'qualify');
    const fresh = await auditHandover(context), own = fresh.database.receipts.find(row => row.handover_id === plan.handoverId && row.phase === 'prepared' && row.plan_hash === planHash);
    check(own && !fresh.database.receipts.some(row => row.handover_id === plan.handoverId && ['aborted','finalized'].includes(row.phase))
      && fresh.database.control.mode === 'frozen' && fresh.database.guard?.digest === own.evidence.guardDigest
      && !fresh.database.unresolvedProduction.length && fresh.database.historyDigest === plan.historyDigest
      && fresh.providers.noRunning && fresh.providers.productionId === plan.previousProductionId, 'HANDOVER_FRESH_FROZEN_OWNERSHIP_REQUIRED');
    assertParentState(fresh.database, fresh.providers, plan);
    check(fresh.providers.rapidJournal.unresolvedProduction === 0 && canonical(fresh.providers.rapidJournal) === canonical(plan.rapidJournal), 'HANDOVER_RAPID_OPERATION_OR_JOURNAL_CHANGED');
    return review;
    });
  };
  const review = await ownershipVerifier({ phase: 'stage' });
  const qualification = await qualifyStage({ plan, planHash, nativeReview: review, ownershipVerifier });
  // The callback is trusted controller code operating the real staged build/browser, not a file reader.
  await retireOldWriters({ plan, planHash, nativeReview: review });
  return scoped('finalize', context => applyHandover({ ...context, phase: 'finalize', github: Object.assign(Object.create(context.github), { qualification: async () => qualification }) }));
}
