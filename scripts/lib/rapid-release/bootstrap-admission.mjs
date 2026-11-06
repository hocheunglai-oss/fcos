import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { canonical, digest, isSha, requireCondition as check, targets } from './contract.mjs';
import { bootstrapRequest, BOOTSTRAP_ENVIRONMENT } from './bootstrap.mjs';
import { readEvidenceArchive, assertVerificationEnvironmentReview } from '../release-evidence.mjs';
import { canonicalFcosE2eCandidateUrl } from '../../verify-e2e-candidate.mjs';

const sql = readFileSync(new URL('../../rapid-release/bootstrap-guard.sql', import.meta.url), 'utf8');
const guardBody = sql.match(/as \$\$([\s\S]*?)\$\$/)[1];
const workflowPath = '.github/workflows/authenticated-release.yml';
const workflow = readFileSync(new URL('../../../.github/workflows/authenticated-release.yml', import.meta.url));
const same = (a,b) => canonical(a) === canonical(b), positive = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const admissions = new WeakMap();
export const BOOTSTRAP_ADMISSION_MAX_AGE_MS = 60000;
export const BOOTSTRAP_ADMISSION_SQL = Object.freeze({
  control: 'select to_jsonb(c) as control from fcos_release_coordination.control c where singleton',
  receipts: 'select receipt_id,operation_id,phase,plan_hash,controller_sha,evidence from fcos_release_coordination.rapid_bootstrap_receipts order by receipt_id',
  fn: "select prosrc,prosecdef,proconfig,pg_get_userbyid(proowner) as owner,proacl::text as acl from pg_proc where oid='fcos_release_coordination.rapid_bootstrap_guard()'::regprocedure",
  table: "select relrowsecurity,pg_get_userbyid(relowner) as owner,relacl::text as acl from pg_class where oid='fcos_release_coordination.rapid_bootstrap_receipts'::regclass",
  triggers: "select tgname,tgenabled,pg_get_triggerdef(oid) as definition from pg_trigger where tgrelid in ('fcos_release_coordination.control'::regclass,'fcos_release_coordination.rapid_bootstrap_receipts'::regclass) and tgname like 'rapid_bootstrap_%' order by tgname",
  constraints: "select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='fcos_release_coordination.rapid_bootstrap_receipts'::regclass order by conname",
  tables: "select relname from pg_class where relnamespace='fcos_release_coordination'::regnamespace and relkind in ('r','p') order by relname",
  unresolved: "select o.operation_id from fcos_release_coordination.operations o left join lateral (select state from fcos_release_coordination.operation_events where operation_id=o.operation_id order by event_id desc limit 1) e on true where o.phase in ('production.stage','production.promote','production.rollback') and e.state is distinct from 'complete'",
});
function frozen(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
}
/** SELECT-only. Caller owns the existing native identity-verified transaction and locks.
 * This verifies bootstrap database facts, not browser authority. No BEGIN, DDL or unfreeze.
 * Root integration: use the full native verifier before initial plan/each apply; bind its
 * reference in the handover plan, then recheck this function under the handover lock.
 * Keep controlPreimage.mode=frozen; abort must preserve that exact frozen preimage.
 */
export async function verifyLockedBootstrap({ db, bootstrapPlan: plan, controllerSha, reference }) {
  check(plan?.controllerSha === controllerSha && isSha(controllerSha) && plan.guardSqlDigest === digest(sql), 'BOOTSTRAP_ADMISSION_SOURCE_MISMATCH');
  const requestHash = digest(bootstrapRequest(plan)), q = async key => (await db.query(BOOTSTRAP_ADMISSION_SQL[key])).rows;
  const controlRows = await q('control'), receipts = await q('receipts'), fn = (await q('fn'))[0], table = (await q('table'))[0];
  const triggers = await q('triggers'), constraints = await q('constraints');
  check(fn?.prosrc === guardBody && fn.prosecdef === true && fn.owner === 'fcos_coordinator_owner'
    && fn.proconfig?.length === 1 && fn.proconfig[0].replace(/\s/g,'') === 'search_path=pg_catalog,fcos_release_coordination'
    && table?.relrowsecurity === true && table.owner === 'fcos_coordinator_owner'
    && same(triggers.map(row => row.tgname), ['rapid_bootstrap_append_only','rapid_bootstrap_control_guard','rapid_bootstrap_no_truncate'])
    && triggers.every(row => row.tgenabled === 'O' && row.definition.endsWith('EXECUTE FUNCTION fcos_release_coordination.rapid_bootstrap_guard()'))
    && constraints.some(row => row.definition === 'UNIQUE (phase)'), 'BOOTSTRAP_ADMISSION_GUARD_CHANGED');
  const guardFingerprint = digest({ fn, table, triggers, constraints });
  check(controlRows.length === 1 && same(controlRows[0].control, { ...plan.controlPreimage, mode: 'frozen' })
    && same(receipts.map(row => row.phase), ['claimed','vercel_intent','vercel_observed','preview_qualified'])
    && receipts.every((row,index) => positive(row.receipt_id) && (!index || Number(row.receipt_id) > Number(receipts[index-1].receipt_id))
      && row.operation_id === plan.operationId && row.plan_hash === digest(plan) && row.controller_sha === controllerSha), 'BOOTSTRAP_ADMISSION_RECEIPTS_INVALID');
  const [claim,intent,observed,qualified] = receipts;
  const history = {};
  for (const { relname: name } of await q('tables')) {
    // Only the two explicitly audited successor receipt tables are outside the
    // original history. Every old table/unknown remains counted and hashed.
    if (['control','rapid_bootstrap_receipts','rapid_handover_receipts'].includes(name)) continue;
    check(/^[a-z0-9_]+$/.test(name), 'BOOTSTRAP_ADMISSION_CATALOG_NAME');
    history[name] = (await db.query(`select count(*)::text as count,encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]'),'UTF8')),'hex') as digest from fcos_release_coordination."${name}" t`)).rows[0];
  }
  check(digest(history) === plan.historyDigest && !(await q('unresolved')).length
    && same(claim.evidence.controlPreimage,plan.controlPreimage) && claim.evidence.guardFingerprint === guardFingerprint
    && claim.evidence.guardSqlDigest === plan.guardSqlDigest && claim.evidence.historyDigest === plan.historyDigest
    && claim.evidence.inventoryDigest === plan.inventoryDigest && claim.evidence.sourceDigest === plan.sourceDigest
    && claim.evidence.requestHash === requestHash && intent.evidence.requestHash === requestHash && observed.evidence.requestHash === requestHash
    && same(Object.keys(intent.evidence),['requestHash']) && same(Object.keys(observed.evidence).sort(),['deploymentId','requestHash'])
    && same(Object.keys(qualified.evidence).sort(),['deploymentId','githubPreviewDeploymentId','githubPreviewStatusId'])
    && observed.evidence.deploymentId === qualified.evidence.deploymentId && /^dpl_[A-Za-z0-9]+$/.test(observed.evidence.deploymentId || '')
    && positive(qualified.evidence.githubPreviewDeploymentId) && positive(qualified.evidence.githubPreviewStatusId), 'BOOTSTRAP_ADMISSION_HISTORY_OR_PHASE_CHANGED');
  const bootstrap = { operationId:plan.operationId,planHash:digest(plan),controllerSha,sourceDigest:plan.sourceDigest,lockDigest:plan.lockDigest,
    guardSqlDigest:plan.guardSqlDigest,guardFingerprint,historyDigest:plan.historyDigest,claimReceiptId:Number(claim.receipt_id),
    qualificationReceiptId:Number(qualified.receipt_id),...qualified.evidence };
  if (reference) check(same(reference.bootstrap,bootstrap), 'BOOTSTRAP_ADMISSION_REFERENCE_MISMATCH');
  return { controlPreimage:controlRows[0].control,bootstrap,nativeStateDigest:digest({ control:controlRows[0].control,receipts,guardFingerprint,history }) };
}
function nativeFile(row) {
  check(row?.type === 'file' && row.encoding === 'base64' && isSha(row.sha), 'BOOTSTRAP_ADMISSION_NATIVE_SOURCE_REQUIRED');
  const body = Buffer.from(row.content,'base64');
  check(body.length <= 262144 && createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex') === row.sha, 'BOOTSTRAP_ADMISSION_NATIVE_SOURCE_REQUIRED');
  return body;
}
async function browserProof({ github, read, repo, plan, preview, authenticationRunId }) {
  const base = `/repos/${targets().repository}`;
  check(positive(authenticationRunId) && typeof github.archive === 'function', 'BOOTSTRAP_AUTHENTICATED_PRODUCER_REQUIRED');
  const run = await read(`${base}/actions/runs/${authenticationRunId}`);
  const branch = await read(`${base}/branches/${encodeURIComponent(repo.default_branch)}`);
  check(run.id === Number(authenticationRunId) && run.repository?.id === repo.id && run.head_repository?.id === repo.id && run.head_branch === repo.default_branch
    && run.event === 'workflow_dispatch' && run.status === 'completed' && run.conclusion === 'success' && isSha(run.head_sha)
    && String(run.path).split('@')[0] === workflowPath && branch.protected === true && branch.name === repo.default_branch
    && digest(nativeFile(await read(`${base}/contents/${workflowPath}?ref=${run.head_sha}`))) === digest(workflow), 'BOOTSTRAP_AUTHENTICATED_PRODUCER_REQUIRED');
  const environment = await read(`${base}/environments/fcos-ci-readonly`), reviews = await read(`${base}/actions/runs/${run.id}/approvals`);
  assertVerificationEnvironmentReview({ environment,approvals:reviews,run,kind:'restricted_browser' });
  const review = reviews.find(row => row.environments?.some(item => item.id === environment.id && item.name === environment.name));
  const jobs = await read(`${base}/actions/runs/${run.id}/jobs?per_page=100`);
  check(jobs.total_count === 2 && jobs.jobs?.length === 2, 'BOOTSTRAP_AUTHENTICATED_JOB_REQUIRED');
  const gate = jobs.jobs.find(row => row.name === 'require-default-branch-dispatch'), job = jobs.jobs.find(row => row.name === 'authenticated-candidate');
  check([gate,job].every(row => positive(row?.id) && row.run_id === run.id && row.head_sha === run.head_sha && row.status === 'completed' && row.conclusion === 'success')
    && Date.parse(job.started_at) >= Date.parse(gate.completed_at), 'BOOTSTRAP_AUTHENTICATED_JOB_REQUIRED');
  const artifacts = await read(`${base}/actions/runs/${run.id}/artifacts?per_page=100`);
  const matches = artifacts.artifacts?.filter(row => row.name === `fcos-ci-evidence-${plan.controllerSha}`) || [], artifact = matches[0];
  check(artifacts.total_count <= 100 && artifacts.total_count === artifacts.artifacts?.length && matches.length === 1 && positive(artifact.id)
    && artifact.expired === false && artifact.workflow_run?.id === run.id && artifact.workflow_run.head_sha === run.head_sha
    && Date.parse(artifact.created_at) >= Date.parse(job.started_at) && Date.parse(artifact.created_at) <= Date.parse(job.completed_at), 'BOOTSTRAP_AUTHENTICATED_ARTIFACT_REQUIRED');
  const archive = await github.archive(`${base}/actions/artifacts/${artifact.id}/zip`);
  check(Buffer.isBuffer(archive) && archive.length > 0 && archive.length <= 2097152 && artifact.digest === `sha256:${digest(archive)}`, 'BOOTSTRAP_AUTHENTICATED_ARTIFACT_DIGEST');
  const payload = readEvidenceArchive(archive,'fcos-ci-evidence.json');
  check(same(Object.keys(payload).sort(),['candidateSha','candidateUrl','harnessSha']) && payload.candidateSha === plan.controllerSha
    && payload.candidateUrl === `https://${preview.url}` && payload.harnessSha === run.head_sha, 'BOOTSTRAP_AUTHENTICATED_ARTIFACT_BINDING');
  return { runId:run.id,jobId:job.id,harnessSha:run.head_sha,reviewDigest:digest(review),artifactId:artifact.id,artifactDigest:artifact.digest };
}
/** readDatabase(work) must execute work(db) in a genuine, target/identity-verified
 * read-only pg transaction; use root's native credential/session verifier.
 * Native adapters: read/get JSON, pages complete arrays, archive raw artifact bytes.
 * Browser authority is independently obtained here, never added to bootstrap phases.
 */
export async function verifyBootstrapAdmission({ bootstrapPlan:plan,controllerSha,github,vercel,authenticationRunId,readDatabase }) {
  check(typeof readDatabase === 'function', 'BOOTSTRAP_ADMISSION_NATIVE_DATABASE_READER_REQUIRED');
  const read = (github.read || github.get)?.bind(github), base = `/repos/${targets().repository}`;
  check(typeof read === 'function', 'BOOTSTRAP_ADMISSION_NATIVE_GITHUB_REQUIRED');
  const databaseRead = async () => {
    let actual, invoked = false;
    const returned = await readDatabase(async db => { check(!invoked,'BOOTSTRAP_ADMISSION_NATIVE_DATABASE_READER_REQUIRED'); invoked=true;
      actual=await verifyLockedBootstrap({db,bootstrapPlan:plan,controllerSha}); return actual; });
    check(invoked && actual && returned===actual,'BOOTSTRAP_ADMISSION_NATIVE_DATABASE_READER_REQUIRED'); return actual;
  };
  const initial = await databaseRead();
  const repo = await read(base);
  check(repo.id === 1278654816 && repo.full_name === targets().repository && repo.owner?.login === targets().account && positive(repo.owner.id)
    && digest(nativeFile(await read(`${base}/contents/scripts/rapid-release/bootstrap-guard.sql?ref=${controllerSha}`))) === plan.guardSqlDigest, 'BOOTSTRAP_ADMISSION_NATIVE_SOURCE_REQUIRED');
  const quality = plan.quality, checkRun = await read(`${base}/check-runs/${quality?.checkRunId}`);
  const qualityRun = await read(`${base}/actions/runs/${quality?.runId}`), qualityJob = await read(`${base}/actions/jobs/${quality?.jobId}`);
  check(checkRun.id===quality.checkRunId && checkRun.app?.id===15368 && checkRun.head_sha===controllerSha && checkRun.status==='completed' && checkRun.conclusion==='success'
    && checkRun.details_url===`https://github.com/${targets().repository}/actions/runs/${quality.runId}/job/${quality.jobId}`
    && qualityRun.id===quality.runId && qualityRun.head_sha===controllerSha && qualityRun.repository?.id===repo.id && qualityRun.head_repository?.id===repo.id
    && qualityRun.event==='pull_request' && String(qualityRun.path).split('@')[0]==='.github/workflows/quality.yml'
    && qualityJob.id===quality.jobId && qualityJob.run_id===qualityRun.id && qualityJob.head_sha===controllerSha && qualityJob.name==='code-and-database'
    && qualityJob.status==='completed' && qualityJob.conclusion==='success','BOOTSTRAP_ADMISSION_NATIVE_QUALITY_REQUIRED');
  const b = initial.bootstrap, requestHash = digest(bootstrapRequest(plan));
  const events = new Map([
    ['bootstrap.intent',{sourceDigest:plan.sourceDigest,requestHash}], ['bootstrap.claimed',{receiptId:b.claimReceiptId,guardFingerprint:b.guardFingerprint,historyDigest:b.historyDigest}],
    ['vercel.intent',{requestHash}], ['vercel.observed',{deploymentId:b.deploymentId,requestHash}],
    ['preview.qualified',{deploymentId:b.deploymentId,githubPreviewDeploymentId:b.githubPreviewDeploymentId,githubPreviewStatusId:b.githubPreviewStatusId}],
  ]);
  const found = new Set();
  for (const row of await github.pages(`${base}/deployments?environment=${BOOTSTRAP_ENVIRONMENT}&sha=${controllerSha}&per_page=100`)) {
    const p = row.payload; if (p?.operationId !== plan.operationId) continue;
    const { recordHash,...body } = p;
    check(row.environment === BOOTSTRAP_ENVIRONMENT && row.sha === controllerSha && row.creator?.login === targets().account && row.creator.id === repo.owner.id
      && p.kind === 'fcos_bootstrap_event' && p.schemaVersion === 1 && p.controllerSha === controllerSha && p.planHash === digest(plan)
      && digest(body) === recordHash && events.has(p.event) && same(p.data,events.get(p.event)), 'BOOTSTRAP_ADMISSION_NATIVE_JOURNAL_REQUIRED');
    found.add(p.event);
  }
  check(found.size === events.size, 'BOOTSTRAP_ADMISSION_NATIVE_JOURNAL_REQUIRED');
  const preview = await vercel.deployment(b.deploymentId), production = await vercel.currentProduction(), project = await vercel.project();
  check(canonicalFcosE2eCandidateUrl(`https://${preview.url}`)===`https://${preview.url}`,'BOOTSTRAP_ADMISSION_PREVIEW_OR_ALIAS_CHANGED');
  check(project.id === targets().projectId && project.accountId === targets().teamId && project.autoAssignCustomDomains === false
    && preview.id === b.deploymentId && preview.target === null && preview.readyState === 'READY' && preview.ownerId === targets().teamId && preview.projectId === targets().projectId
    && preview.gitSource?.sha === controllerSha && Number(preview.gitSource.repoId) === 1278654816 && preview.meta?.githubCommitSha === controllerSha
    && preview.meta.fcosBootstrapOperation === plan.operationId && preview.meta.fcosBootstrapPlanHash === digest(plan)
    && production.id === plan.previousProductionId && production.alias === new URL(targets().origin).hostname
    && production.projectId === targets().projectId && production.teamId === targets().teamId, 'BOOTSTRAP_ADMISSION_PREVIEW_OR_ALIAS_CHANGED');
  const deployment = await read(`${base}/deployments/${b.githubPreviewDeploymentId}`), statuses = await github.pages(`${base}/deployments/${b.githubPreviewDeploymentId}/statuses?per_page=100`);
  const status = statuses.find(row => row.id === b.githubPreviewStatusId && row.creator?.login === 'vercel[bot]');
  check(deployment.id === b.githubPreviewDeploymentId && deployment.sha === controllerSha && deployment.environment === 'Preview' && deployment.creator?.login === 'vercel[bot]'
    && status?.state === 'success' && status.environment_url === `https://${preview.url}`
    && !statuses.some(row => row.id > status.id && row.creator?.login === 'vercel[bot]' && ['error','failure'].includes(row.state)), 'BOOTSTRAP_ADMISSION_GENUINE_PREVIEW_REQUIRED');
  const authentication = await browserProof({ github,read,repo,plan,preview,authenticationRunId });
  const finalProduction=await vercel.currentProduction();
  check(finalProduction.id===production.id && finalProduction.alias===production.alias && finalProduction.projectId===production.projectId
    && finalProduction.teamId===production.teamId,'BOOTSTRAP_ADMISSION_PREVIEW_OR_ALIAS_CHANGED');
  const final = await databaseRead();
  check(final.nativeStateDigest === initial.nativeStateDigest, 'BOOTSTRAP_ADMISSION_DATABASE_CHANGED');
  const reference = frozen({schemaVersion:1,kind:'fcos_initial_bootstrap_reference',bootstrap:final.bootstrap,authentication});
  const verifiedAt=Date.now(), admission = frozen({controlPreimage:final.controlPreimage,reference,verifiedAt});
  admissions.set(admission,{referenceDigest:digest(reference),controllerSha,verifiedAt}); return admission;
}
export function assertNativeBootstrapAdmission(admission,{controllerSha,reference,now=Date.now()}={}) {
  const native = admissions.get(admission);
  check(native && native.controllerSha === controllerSha && native.referenceDigest === digest(admission.reference)
    && (!reference || same(reference,admission.reference)) && now >= native.verifiedAt && now-native.verifiedAt <= BOOTSTRAP_ADMISSION_MAX_AGE_MS,
  'BOOTSTRAP_ADMISSION_NATIVE_CAPABILITY_REQUIRED');
  return admission.reference;
}
