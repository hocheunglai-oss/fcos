import { readFileSync, mkdirSync, openSync, closeSync, writeSync, fsyncSync, lstatSync, constants } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical, digest, isSha, isDigest, requireCondition as check, sourceSnapshot, targets } from './contract.mjs';
import { assertPublicPayload } from './journal.mjs';
import { assertHandoverConnection } from './handover.mjs';
import { fcosConnectionIdentifier } from '../../../config/fcosConnections.js';

export const BOOTSTRAP_BRANCH = 'codex/rapid-controller-install-20261106';
export const BOOTSTRAP_ENVIRONMENT = 'fcos-bootstrap-journal-v1';
const sql = readFileSync(new URL('../../rapid-release/bootstrap-guard.sql', import.meta.url), 'utf8');
const guardBody = sql.match(/as \$\$([\s\S]*?)\$\$/)[1];
const base = () => `/repos/${targets().repository}`;
const phases = ['claimed', 'vercel_intent', 'vercel_observed', 'preview_qualified'];
const controls = ['bootstrap_id','epoch','mode','operation_id','plan_completion_id','recovery_id','singleton','source_upgrade_id'];
const same = (a, b) => canonical(a) === canonical(b);

/** Native adapters perform real GETs; no JSON flag grants authority. See CLI's fixed adapter contract.
 * github: read/pages/write(path,body), inventory() (fresh complete native scope, sanitized).
 * vercel: identity/project/currentProduction/findDeployments/deployment/create (native readbacks).
 * db: one pg session with query; connection: strict pinned direct/session TLS options.
 * sourceReader is injection for offline tests only; the CLI always uses sourceSnapshot.
 */
export function createBootstrapPlan({ source, audit, inventoryDigest, previousProductionId, quality,
  operationId = `fcos-bootstrap-${randomUUID()}`, now = Date.now() }) {
  assertQualification(audit.control);
  check(!audit.receipts.length && !audit.unresolvedProduction.length, 'BOOTSTRAP_NEW_PLAN_NOT_AVAILABLE');
  return { schemaVersion: 1, kind: 'fcos_controller_preview_bootstrap', operationId,
    controllerSha: source.sha, sourceDigest: source.sourceDigest, lockDigest: source.lockDigest,
    branch: BOOTSTRAP_BRANCH, pullRequest: 124, repositoryId: 1278654816, inventoryDigest,
    previousProductionId, quality, controlPreimage: audit.control, historyDigest: audit.historyDigest,
    guardSqlDigest: digest(sql), createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 86400000).toISOString() };
}
function assertPlan(plan, write, now = Date.now()) {
  check(plan && same(Object.keys(plan).sort(), ['schemaVersion','kind','operationId','controllerSha','sourceDigest','lockDigest','branch','pullRequest',
    'repositoryId','inventoryDigest','previousProductionId','quality','controlPreimage','historyDigest','guardSqlDigest','createdAt','expiresAt'].sort())
    && plan.schemaVersion === 1 && plan.kind === 'fcos_controller_preview_bootstrap'
    && /^fcos-bootstrap-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(plan.operationId)
    && isSha(plan.controllerSha) && [plan.sourceDigest,plan.lockDigest,plan.inventoryDigest,plan.historyDigest].every(isDigest)
    && plan.branch === BOOTSTRAP_BRANCH && plan.pullRequest === 124 && plan.repositoryId === 1278654816
    && /^dpl_[A-Za-z0-9]+$/.test(plan.previousProductionId || '') && plan.guardSqlDigest === digest(sql), 'BOOTSTRAP_PLAN_INVALID');
  const issued = Date.parse(plan.createdAt), expires = Date.parse(plan.expiresAt);
  check(Number.isFinite(issued) && Number.isFinite(expires) && issued <= now && expires > issued && expires - issued <= 86400000
    && (!write || now < expires), 'BOOTSTRAP_PLAN_EXPIRED');
  assertPublicPayload(plan); assertQualification(plan.controlPreimage);
}
function assertQualification(c) {
  check(c && same(Object.keys(c).sort(), controls) && c.singleton === true && Number(c.epoch) === 1
    && c.mode === 'qualification' && controls.filter(key => key.endsWith('_id')).every(key => c[key] === null), 'BOOTSTRAP_QUALIFICATION_PREIMAGE_REQUIRED');
}
export function bootstrapRequest(plan) {
  assertPlan(plan, false);
  return { name: fcosConnectionIdentifier('vercel', 'Project'), project: targets().projectId,
    gitSource: { type: 'github', repoId: 1278654816, ref: plan.branch, sha: plan.controllerSha, prId: 124 },
    meta: { fcosBootstrapOperation: plan.operationId, fcosBootstrapPlanHash: digest(plan) } };
}
async function transaction(db, connection, write, work) {
  assertHandoverConnection(connection);
  await db.query(`begin isolation level ${write ? 'read committed read write' : 'repeatable read read only'}`);
  try {
    const row = (await db.query("select session_user,current_user,current_database() as database,current_setting('transaction_read_only') as read_only")).rows[0];
    check(row?.session_user === 'postgres' && row.current_user === 'postgres' && row.database === 'postgres'
      && row.read_only === (write ? 'off' : 'on'), 'BOOTSTRAP_DATABASE_IDENTITY_MISMATCH');
    const result = await work(); await db.query('commit'); return result;
  } catch (error) { await db.query('rollback'); throw error; }
}
async function guardFingerprint(db) {
  const fn = (await db.query("select prosrc,prosecdef,proconfig,pg_get_userbyid(proowner) as owner,proacl::text as acl from pg_proc where oid='fcos_release_coordination.rapid_bootstrap_guard()'::regprocedure")).rows[0];
  check(fn?.prosrc === guardBody && fn.prosecdef === true && fn.owner === 'fcos_coordinator_owner'
    && fn.proconfig?.length === 1 && fn.proconfig[0].replace(/\s/g, '') === 'search_path=pg_catalog,fcos_release_coordination', 'BOOTSTRAP_GUARD_SOURCE_CHANGED');
  const table = (await db.query("select relrowsecurity,pg_get_userbyid(relowner) as owner,relacl::text as acl from pg_class where oid='fcos_release_coordination.rapid_bootstrap_receipts'::regclass")).rows[0];
  const triggers = (await db.query("select tgname,tgenabled,pg_get_triggerdef(oid) as definition from pg_trigger where tgrelid in ('fcos_release_coordination.control'::regclass,'fcos_release_coordination.rapid_bootstrap_receipts'::regclass) and tgname like 'rapid_bootstrap_%' order by tgname")).rows;
  const constraints = (await db.query("select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='fcos_release_coordination.rapid_bootstrap_receipts'::regclass order by conname")).rows;
  check(table?.relrowsecurity && table.owner === 'fcos_coordinator_owner' && triggers.length === 3
    && same(triggers.map(row => row.tgname), ['rapid_bootstrap_append_only','rapid_bootstrap_control_guard','rapid_bootstrap_no_truncate'])
    && triggers.every(row => row.tgenabled === 'O' && row.definition.endsWith('EXECUTE FUNCTION fcos_release_coordination.rapid_bootstrap_guard()'))
    && constraints.some(row => row.definition === 'UNIQUE (phase)'), 'BOOTSTRAP_GUARD_CHANGED');
  return digest({ fn, table, triggers, constraints });
}
async function snapshot(db, locked = false) {
  if (locked) await db.query('lock table fcos_release_coordination.control in share row exclusive mode');
  const rows = (await db.query('select to_jsonb(c) as control from fcos_release_coordination.control c where singleton')).rows;
  check(rows.length === 1 && same(Object.keys(rows[0].control).sort(), controls), 'BOOTSTRAP_UNKNOWN_CONTROL_SCHEMA');
  const tables = (await db.query("select relname from pg_class where relnamespace='fcos_release_coordination'::regnamespace and relkind in ('r','p') order by relname")).rows.map(row => row.relname);
  const history = {};
  for (const name of tables.filter(name => !['control','rapid_bootstrap_receipts'].includes(name))) {
    check(/^[a-z0-9_]+$/.test(name), 'BOOTSTRAP_UNSAFE_CATALOG_NAME');
    if (locked) await db.query(`lock table fcos_release_coordination."${name}" in share mode`);
    history[name] = (await db.query(`select count(*)::text as count,encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]'),'UTF8')),'hex') as digest from fcos_release_coordination."${name}" t`)).rows[0];
  }
  const unresolvedProduction = (await db.query("select o.operation_id,o.phase,coalesce(e.state,'missing') as state from fcos_release_coordination.operations o left join lateral (select state from fcos_release_coordination.operation_events where operation_id=o.operation_id order by event_id desc limit 1) e on true where o.phase in ('production.stage','production.promote','production.rollback') and e.state is distinct from 'complete' order by o.operation_id")).rows;
  const installed = tables.includes('rapid_bootstrap_receipts');
  const receipts = installed ? (await db.query('select receipt_id,operation_id,phase,plan_hash,controller_sha,evidence from fcos_release_coordination.rapid_bootstrap_receipts order by receipt_id')).rows : [];
  return { control: rows[0].control, historyDigest: digest(history), unresolvedProduction, receipts,
    guardFingerprint: installed ? await guardFingerprint(db) : null };
}
export function readBootstrapDatabase({ db, connection }) { return transaction(db, connection, false, () => snapshot(db)); }
function assertOwn(state, plan) {
  check(!state.unresolvedProduction.length && state.historyDigest === plan.historyDigest, 'BOOTSTRAP_COORDINATOR_HISTORY_CHANGED');
  const claim = state.receipts.find(row => row.phase === 'claimed');
  check(claim?.operation_id === plan.operationId && claim.plan_hash === digest(plan) && claim.controller_sha === plan.controllerSha
    && same(claim.evidence.controlPreimage, plan.controlPreimage) && claim.evidence.guardSqlDigest === plan.guardSqlDigest
    && claim.evidence.guardFingerprint === state.guardFingerprint && same(state.control, { ...plan.controlPreimage, mode: 'frozen' })
    && state.receipts.every(row => row.operation_id === plan.operationId && row.plan_hash === digest(plan) && row.controller_sha === plan.controllerSha), 'BOOTSTRAP_FOREIGN_OR_CHANGED_FREEZE');
  return claim;
}
export function claimBootstrap({ db, connection, plan }) {
  assertPlan(plan, true);
  return transaction(db, connection, true, async () => {
    let state = await snapshot(db, true);
    if (state.receipts.length) return { claim: assertOwn(state, plan), state };
    check(!state.guardFingerprint && !state.unresolvedProduction.length && state.historyDigest === plan.historyDigest
      && same(state.control, plan.controlPreimage), 'BOOTSTRAP_PREIMAGE_CHANGED');
    assertQualification(state.control);
    await db.query(sql);
    const fingerprint = await guardFingerprint(db);
    const evidence = { controlPreimage: state.control, guardSqlDigest: digest(sql), guardFingerprint: fingerprint,
      historyDigest: state.historyDigest, inventoryDigest: plan.inventoryDigest, sourceDigest: plan.sourceDigest, requestHash: digest(bootstrapRequest(plan)) };
    const claim = (await db.query('insert into fcos_release_coordination.rapid_bootstrap_receipts(operation_id,phase,plan_hash,controller_sha,evidence) values($1,$2,$3,$4,$5::jsonb) returning receipt_id,operation_id,phase,plan_hash,controller_sha,evidence', [plan.operationId,'claimed',digest(plan),plan.controllerSha,JSON.stringify(evidence)])).rows[0];
    await db.query("update fcos_release_coordination.control set mode='frozen' where singleton");
    state = await snapshot(db); assertOwn(state, plan); return { claim, state };
  });
}
async function appendReceipt({ db, connection, plan }, phase, evidence) {
  return transaction(db, connection, true, async () => {
    const state = await snapshot(db, true); assertOwn(state, plan);
    const previous = state.receipts.find(row => row.phase === phase);
    if (previous) { check(same(previous.evidence, evidence), 'BOOTSTRAP_RECEIPT_CONFLICT'); return { row: previous, inserted: false }; }
    check(phases.indexOf(phase) === state.receipts.length, 'BOOTSTRAP_RECEIPT_ORDER');
    const row = (await db.query('insert into fcos_release_coordination.rapid_bootstrap_receipts(operation_id,phase,plan_hash,controller_sha,evidence) values($1,$2,$3,$4,$5::jsonb) returning receipt_id,evidence', [plan.operationId,phase,digest(plan),plan.controllerSha,JSON.stringify(evidence)])).rows[0];
    return { row, inserted: true };
  });
}

export async function auditBootstrap({ github, vercel, db, connection, sourceReader = sourceSnapshot, cwd }) {
  const source = await sourceReader(cwd), repoPath = base();
  const user = await github.read('/user'); check(user.login === targets().account && Number.isSafeInteger(user.id), 'BOOTSTRAP_GITHUB_ACCOUNT_MISMATCH');
  const repo = await github.read(repoPath);
  check(repo.id === 1278654816 && repo.full_name === targets().repository && repo.permissions?.admin === true && !repo.archived, 'BOOTSTRAP_REPOSITORY_MISMATCH');
  const pr = await github.read(`${repoPath}/pulls/124`), ref = await github.read(`${repoPath}/git/ref/heads/${encodeURIComponent(BOOTSTRAP_BRANCH)}`);
  check(pr.number === 124 && pr.state === 'open' && pr.base?.repo?.id === repo.id && pr.base.ref === repo.default_branch && pr.head?.repo?.id === repo.id && pr.head.ref === BOOTSTRAP_BRANCH
    && pr.head.sha === source.sha && ref.object?.sha === source.sha, 'BOOTSTRAP_EXACT_PR_REQUIRED');
  const checks = await github.read(`${repoPath}/commits/${source.sha}/check-runs?check_name=code-and-database&filter=latest&per_page=100`);
  const candidates = checks.check_runs?.filter(row => row.name === 'code-and-database' && row.head_sha === source.sha && row.app?.id === 15368
    && Number.isSafeInteger(row.id)).sort((a,b) => b.id - a.id) || [];
  check(checks.total_count <= 100 && candidates[0]?.status === 'completed' && candidates[0].conclusion === 'success', 'BOOTSTRAP_NATIVE_QUALITY_REQUIRED');
  const match = candidates[0].details_url?.match(new RegExp(`^https://github.com/${targets().repository}/actions/runs/([1-9][0-9]*)/job/([1-9][0-9]*)$`));
  check(match, 'BOOTSTRAP_NATIVE_QUALITY_REQUIRED');
  const run = await github.read(`${repoPath}/actions/runs/${match[1]}`), job = await github.read(`${repoPath}/actions/jobs/${match[2]}`);
  check(run.id === Number(match[1]) && job.id === Number(match[2]) && run.head_sha === source.sha && run.event === 'pull_request' && run.repository?.id === repo.id && run.head_repository?.id === repo.id
    && String(run.path).split('@')[0] === '.github/workflows/quality.yml' && job.run_id === run.id && job.head_sha === source.sha
    && job.name === 'code-and-database' && job.status === 'completed' && job.conclusion === 'success', 'BOOTSTRAP_NATIVE_QUALITY_REQUIRED');
  const identity = await vercel.identity(), project = await vercel.project(), production = await vercel.currentProduction();
  check(identity.user?.username === targets().vercelAccount && identity.team?.id === targets().teamId && identity.team.slug === targets().team
    && project.id === targets().projectId && project.accountId === targets().teamId && project.autoAssignCustomDomains === false
    && project.link?.type === 'github' && Number(project.link.repoId) === repo.id, 'BOOTSTRAP_VERCEL_IDENTITY_MISMATCH');
  check(production.alias === new URL(targets().origin).hostname && production.projectId === project.id && production.teamId === targets().teamId
    && /^dpl_[A-Za-z0-9]+$/.test(production.id || ''), 'BOOTSTRAP_LIVE_ALIAS_UNVERIFIED');
  const inventory = await github.inventory();
  check(inventory && typeof inventory === 'object' && Array.isArray(inventory.installations) && inventory.installations.length > 0
    && Array.isArray(inventory.hooks) && Array.isArray(inventory.workflows) && inventory.workflows.length > 0
    && inventory.repositoryId === repo.id && canonical(inventory).length <= 262144, 'BOOTSTRAP_NATIVE_INVENTORY_REQUIRED');
  return { source, inventoryDigest: digest(inventory), previousProductionId: production.id,
    quality: { checkRunId: candidates[0].id, runId: run.id, jobId: job.id }, database: await readBootstrapDatabase({ db, connection }), actorId: user.id };
}

function fsynced(path, record) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
  try { const info = lstatSync(path); check(info.isFile() && info.nlink === 1 && (info.mode & 0o077) === 0, 'BOOTSTRAP_PRIVATE_LOCAL_JOURNAL_REQUIRED');
    const bytes = Buffer.from(`${JSON.stringify(record)}\n`); let offset = 0;
    while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
    fsyncSync(fd);
  } finally { closeSync(fd); }
  const directory = openSync(dirname(path), constants.O_RDONLY); try { fsyncSync(directory); } finally { closeSync(directory); }
}
/** Local durable intent precedes every custom GitHub journal submission. Lost ACKs are GET-only. */
export class BootstrapJournal {
  constructor({ path, github, plan, actorId }) { Object.assign(this, { path, github, plan, actorId }); }
  async append(event, data) {
    assertPublicPayload(data);
    const payload = { schemaVersion: 1, kind: 'fcos_bootstrap_event', operationId: this.plan.operationId,
      planHash: digest(this.plan), controllerSha: this.plan.controllerSha, event, data };
    const recordHash = digest(payload), record = { ...payload, recordHash };
    const local = (() => { try { return readFileSync(this.path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } })();
    const hadIntent = local.some(row => row.recordHash === recordHash);
    if (!hadIntent) fsynced(this.path, record);
    const find = async () => (await this.github.pages(`${base()}/deployments?environment=${BOOTSTRAP_ENVIRONMENT}&sha=${this.plan.controllerSha}&per_page=100`))
      .filter(row => row.payload?.recordHash === recordHash).map(row => {
        check(row.creator?.id === this.actorId && row.creator.login === targets().account && row.environment === BOOTSTRAP_ENVIRONMENT
          && row.sha === this.plan.controllerSha && same(row.payload, record), 'BOOTSTRAP_JOURNAL_NATIVE_MISMATCH'); return row;
      });
    let rows = await find(); if (rows.length) return rows[0];
    check(!hadIntent, 'BOOTSTRAP_JOURNAL_ACK_UNCERTAIN');
    try { await this.github.write(`${base()}/deployments`, { ref: this.plan.controllerSha, task: 'fcos-bootstrap-journal', auto_merge: false,
      required_contexts: [], environment: BOOTSTRAP_ENVIRONMENT, production_environment: false, transient_environment: false, payload: record }); } catch { /* Original submission is reconciled by GET only. */ }
    rows = await find(); check(rows.length > 0, 'BOOTSTRAP_JOURNAL_ACK_UNCERTAIN'); return rows[0];
  }
}
function assertDeployment(row, plan) {
  check(row?.id && row.projectId === targets().projectId && row.ownerId === targets().teamId && row.target === null
    && row.name === fcosConnectionIdentifier('vercel', 'Project') && row.meta?.githubCommitSha === plan.controllerSha && row.meta.githubCommitRef === plan.branch
    && row.meta.fcosBootstrapOperation === plan.operationId && row.meta.fcosBootstrapPlanHash === digest(plan)
    && row.gitSource?.sha === plan.controllerSha && Number(row.gitSource.repoId) === 1278654816
    && new RegExp(`^${fcosConnectionIdentifier('vercel', 'Project')}-[a-z0-9]{9}-${targets().team}\\.vercel\\.app$`).test(row.url || ''), 'BOOTSTRAP_DEPLOYMENT_MISMATCH');
  return row;
}
async function botProof(github, deployment, plan) {
  const native = (await github.pages(`${base()}/deployments?sha=${plan.controllerSha}&environment=Preview&per_page=100`))
    .filter(row => row.sha === plan.controllerSha && row.environment === 'Preview' && row.creator?.login === 'vercel[bot]');
  check(native.length > 0, 'BOOTSTRAP_GENUINE_BOT_PREVIEW_MISSING');
  for (const row of native.sort((a,b) => b.id - a.id)) {
    const statuses = (await github.pages(`${base()}/deployments/${row.id}/statuses?per_page=100`)).filter(status => status.creator?.login === 'vercel[bot]').sort((a,b) => b.id - a.id);
    if (statuses[0]?.state === 'success' && statuses[0].environment_url === `https://${deployment.url}`)
      return { githubPreviewDeploymentId: row.id, githubPreviewStatusId: statuses[0].id };
  }
  throw Object.assign(Error('BOOTSTRAP_GENUINE_BOT_PREVIEW_MISSING'), { code: 'BOOTSTRAP_GENUINE_BOT_PREVIEW_MISSING' });
}
export async function runBootstrap(input) {
  const { plan, github, vercel, db, connection, journal, readbackOnly = false } = input;
  assertPlan(plan, !readbackOnly);
  const fresh = await auditBootstrap(input);
  check(fresh.source.sha === plan.controllerSha && fresh.source.sourceDigest === plan.sourceDigest && fresh.source.lockDigest === plan.lockDigest
    && fresh.inventoryDigest === plan.inventoryDigest && fresh.previousProductionId === plan.previousProductionId && same(fresh.quality, plan.quality), 'BOOTSTRAP_SOURCE_OR_NATIVE_STATE_CHANGED');
  let state = fresh.database, claim;
  if (readbackOnly) claim = assertOwn(state, plan);
  else {
    if (state.receipts.length) assertOwn(state, plan);
    else {
      assertQualification(state.control);
      check(!state.guardFingerprint && !state.unresolvedProduction.length && state.historyDigest === plan.historyDigest
        && same(state.control, plan.controlPreimage), 'BOOTSTRAP_PREIMAGE_CHANGED');
    }
    check(journal && typeof journal.append === 'function', 'BOOTSTRAP_DURABLE_JOURNAL_REQUIRED');
    await journal.append('bootstrap.intent', { sourceDigest: plan.sourceDigest, requestHash: digest(bootstrapRequest(plan)) });
    ({ state, claim } = await claimBootstrap({ db, connection, plan }));
    await journal.append('bootstrap.claimed', { receiptId: Number(claim.receipt_id), guardFingerprint: state.guardFingerprint, historyDigest: state.historyDigest });
  }
  const request = bootstrapRequest(plan), requestHash = digest(request);
  let intent = state.receipts.find(row => row.phase === 'vercel_intent');
  if (!intent && !readbackOnly) {
    await journal.append('vercel.intent', { requestHash });
    const result = await appendReceipt(input, 'vercel_intent', { requestHash });
    if (result.inserted) {
      // A committed submission ticket is never reissued, including a crash before POST.
      assertPlan(plan, true);
      const source = await (input.sourceReader || sourceSnapshot)(input.cwd);
      check(source.sha === plan.controllerSha && source.sourceDigest === plan.sourceDigest && source.lockDigest === plan.lockDigest, 'BOOTSTRAP_SOURCE_CHANGED_BEFORE_POST');
      const owned = await readBootstrapDatabase(input); assertOwn(owned, plan);
      const alias = await vercel.currentProduction();
      check(alias.id === plan.previousProductionId && alias.alias === new URL(targets().origin).hostname
        && alias.projectId === targets().projectId && alias.teamId === targets().teamId, 'BOOTSTRAP_LIVE_ALIAS_CHANGED');
      const prior = await vercel.findDeployments({ operationId: plan.operationId, controllerSha: plan.controllerSha, since: plan.createdAt });
      check(prior.length === 0, 'BOOTSTRAP_UNEXPECTED_PRIOR_SUBMISSION');
      try { await vercel.create(request); } catch { /* GET original operation; never resubmit. */ }
    }
    intent = result.row;
  }
  check(intent?.evidence.requestHash === requestHash, 'BOOTSTRAP_ORIGINAL_OPERATION_REQUIRED');
  const found = await vercel.findDeployments({ operationId: plan.operationId, controllerSha: plan.controllerSha, since: plan.createdAt });
  check(found.length === 1, 'BOOTSTRAP_ORIGINAL_SUBMISSION_UNCERTAIN');
  const deployment = assertDeployment(await vercel.deployment(found[0].id), plan);
  const live = await vercel.currentProduction();
  check(live.id === plan.previousProductionId && live.alias === new URL(targets().origin).hostname
    && live.projectId === targets().projectId && live.teamId === targets().teamId, 'BOOTSTRAP_LIVE_ALIAS_CHANGED');
  check(deployment.readyState === 'READY', 'BOOTSTRAP_PREVIEW_NOT_READY');
  if (!readbackOnly) { await journal.append('vercel.observed', { deploymentId: deployment.id, requestHash }); await appendReceipt(input, 'vercel_observed', { deploymentId: deployment.id, requestHash }); }
  const proof = await botProof(github, deployment, plan);
  let qualification;
  if (!readbackOnly) { await journal.append('preview.qualified', { deploymentId: deployment.id, ...proof }); qualification = (await appendReceipt(input, 'preview_qualified', { deploymentId: deployment.id, ...proof })).row; }
  return { state: readbackOnly ? 'original_preview_readback' : 'preview_ready_for_authenticated_release', operationId: plan.operationId,
    planHash: digest(plan), controllerSha: plan.controllerSha, deploymentId: deployment.id, ...proof,
    claimReceiptId: Number(claim.receipt_id), qualificationReceiptId: qualification ? Number(qualification.receipt_id) : null,
    guardFingerprint: state.guardFingerprint, historyDigest: state.historyDigest };
}
