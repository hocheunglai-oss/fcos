// Native one-request courier. Import is credential/provider inert.
import { createHash } from 'node:crypto';
import { constants, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runGuardedProviderWrite } from '../guarded-provider-write.mjs';
import { parseXeroRecoveryStepPlan, recoveryStepCanonicalJson as canonical, recoveryStepSha256 as hash,
  validateXeroRecoveryStepResult, nextXeroRecoveryStep, XERO_RECOVERY_STEPS } from './xero-recovery-step-protocol.mjs';
import { decodeRuntimeMaterialArchive, RUNTIME_MATERIAL_FILENAME } from '../runtime-compatibility-material-transport.mjs';
import { fcosConnectionIdentifier } from '../../../config/fcosConnections.js';
export { canonical, hash, RUNTIME_MATERIAL_FILENAME };
export const REPOSITORY = fcosConnectionIdentifier('github', 'Repository');
export const FEATURES_OWNER = '01a0f08b-7fcb-7870-9edc-343e16052b62';
export const ORIGINAL_WARM_TEMPLATE_VARIABLE = 'FCOS_XERO_ORIGINAL_CARRIER_TEMPLATE_BASE64';
const ROOT = '/Users/vincex/Documents/FCOS';
const REPO_ID = 1278654816, ACTOR_ID = 265701760;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/, SHA = /^[a-f0-9]{40}$/, HASH = /^[a-f0-9]{64}$/;
const WRITE_GUARD_SHA = '5818b554b94d92aed796abbc3ea20ce4fdbbd821762ebfef8c6cb635e77b7c7f';
const plain = v => v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
export const exact = (v, keys) => plain(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
export const refusal = code => Object.assign(new Error(code), { code });
export const need = (v, code = 'XERO_COURIER_REFUSED') => { if (!v) throw refusal(code); };
const SAFE_CODES = new Set(['XERO_COURIER_RESPONSE_REFUSED','XERO_COURIER_PUBLICATION_INVALID','XERO_COURIER_PUBLICATION_UNKNOWN','XERO_COURIER_READBACK_ADMISSION_REQUIRED','XERO_COURIER_READBACK_RESULT_INVALID','XERO_COURIER_READBACK_DISPATCH_UNKNOWN','XERO_COURIER_LOCAL_REPOSITORY_MISMATCH','XERO_COURIER_PACKAGE_BUILD_REFUSED','XERO_COURIER_CANONICAL_STATE_REQUIRED','XERO_COURIER_ROOT_ADMISSION_REQUIRED','XERO_COURIER_ORIGINAL_CLAIM_REQUIRED','XERO_COURIER_SOURCE_BYTES_UNPROVEN','XERO_COURIER_OIDC_INVALID','XERO_COURIER_AUTHORITY_EXPIRED','XERO_COURIER_CONSUMED_GET_ONLY','XERO_COURIER_REMOTE_OUTCOME_UNKNOWN','XERO_COURIER_ACK_TIMEOUT_UNKNOWN','XERO_COURIER_NATIVE_COMMAND_UNKNOWN','XERO_COURIER_GITHUB_READ_UNKNOWN','XERO_COURIER_HTTP_OUTCOME_UNKNOWN','XERO_COURIER_CAPTURE_UNKNOWN','XERO_COURIER_RUN_MISMATCH','XERO_COURIER_REQUEST_INVALID','XERO_COURIER_TEMPLATE_INVALID','XERO_COURIER_NONCE_REQUIRED','XERO_COURIER_ACK_MISMATCH','XERO_COURIER_RESULT_MISMATCH']);
export const safeCode = e => { try { const code=e?.code;return SAFE_CODES.has(code) ? code : 'XERO_COURIER_STOPPED_OWNER_READBACK_REQUIRED'; } catch { return 'XERO_COURIER_STOPPED_OWNER_READBACK_REQUIRED'; } };
export const bytesHash = value => createHash('sha256').update(value).digest('hex');
const gitHash = (kind, b) => createHash('sha1').update(`${kind} ${b.length}\0`).update(b).digest('hex');
export function parseCourierTemplate(text) {
  need(typeof text === 'string' && Buffer.byteLength(text) <= 65536);
  const t = JSON.parse(text);
  need(exact(t, ['schemaVersion','kind','planJson','controllerSha','caller','hostConfiguration','readCredential','readAcceptance','login','issuedAt','notAfter','artifactCaptureAuthoritySha256'])
    && t.schemaVersion === 1 && t.kind === 'fcos_xero_recovery_carrier_template_v1' && SHA.test(t.controllerSha)
    && HASH.test(t.artifactCaptureAuthoritySha256), 'XERO_COURIER_TEMPLATE_INVALID');
  const { plan, planSha256 } = parseXeroRecoveryStepPlan(t.planJson), c = t.caller;
  need(exact(c, ['ref','sha','workflowRef','workflowSha','jobWorkflowRef','jobWorkflowSha','jobName','environment','subject'])
    && /^refs\/heads\/[A-Za-z0-9][A-Za-z0-9_./-]{0,150}$/.test(c.ref) && !c.ref.includes('..') && SHA.test(c.sha) && c.sha === c.workflowSha
    && c.jobWorkflowSha === t.controllerSha && c.jobWorkflowRef === `${REPOSITORY}/.github/workflows/hosted-xero-recovery-carrier.yml@${t.controllerSha}`
    && c.workflowRef === `${REPOSITORY}/.github/workflows/authenticated-release.yml@${c.ref}`
    && c.jobName === 'xero-recovery-carrier' && c.environment === 'fcos-hosted-verification'
    && c.subject === `repo:${REPOSITORY}:environment:${c.environment}`, 'XERO_COURIER_CALLER_INVALID');
  need(Number.isSafeInteger(t.issuedAt) && Number.isSafeInteger(t.notAfter) && t.issuedAt >= plan.binding.issuedAt
    && t.notAfter > t.issuedAt && t.notAfter <= plan.binding.notAfter && t.notAfter - t.issuedAt <= 900000
    && exact(t.login, ['origin','publicAuth']) && plain(t.hostConfiguration), 'XERO_COURIER_TEMPLATE_INVALID');
  return { template: JSON.parse(JSON.stringify(t)), templateSha256: bytesHash(text), plan, planSha256 };
}
export function courierPrefix(t, runId) {
  const { plan } = parseCourierTemplate(typeof t === 'string' ? t : JSON.stringify(t));
  need(/^[1-9][0-9]{0,19}$/.test(String(runId)) && Number.isSafeInteger(Number(runId)));
  return `refs/heads/codex/fcos-xero-${plan.binding.operationId.slice(0, 16)}-${runId}`;
}
export function parseCourierRequest(raw, t) {
  const { plan, planSha256 } = parseCourierTemplate(JSON.stringify(t));
  need(typeof raw === 'string' && Buffer.byteLength(raw) <= 2048);
  const r = JSON.parse(raw);
  need(exact(r, ['schemaVersion','operationId','planSha256','step','submissionId','previousResultSha256']) && canonical(r) === raw
    && r.schemaVersion === 1 && r.operationId === plan.binding.operationId && r.planSha256 === planSha256
    && XERO_RECOVERY_STEPS.includes(r.step) && UUID.test(r.submissionId)
    && (r.step === 'preflight' ? r.previousResultSha256 === null : HASH.test(r.previousResultSha256)), 'XERO_COURIER_REQUEST_INVALID');
  return r;
}
export function courierRequestRef(t, runId, raw) { const r = parseCourierRequest(raw, t); return `${courierPrefix(t, runId)}/request-${r.step}-${r.submissionId}`; }
/** Deterministic public publisher receipt. GitHub fills creator; commit author
 * text and this public hash are not publisher/financial authority. The native
 * operator writes this status only after a completed guarded exact-ref push. */
export function courierPublicationStatus({templateJson,runId,ref,commitSha,raw,kind}) {
  const {template:t,templateSha256,plan,planSha256}=parseCourierTemplate(templateJson);
  need(typeof raw==='string'&&Buffer.byteLength(raw)<=2048&&SHA.test(commitSha)&&['locator','request'].includes(kind),'XERO_COURIER_PUBLICATION_INVALID');
  const prefix=courierPrefix(t,runId);
  if(kind==='request')need(ref===courierRequestRef(t,runId,raw),'XERO_COURIER_PUBLICATION_INVALID');
  else {const v=JSON.parse(raw);need(ref===`${prefix}/locator`&&exact(v,['schemaVersion','kind','deploymentId','url'])&&v.schemaVersion===1&&v.kind==='fcos_xero_host_locator_v1'
    &&/^dpl_[A-Za-z0-9]+$/.test(v.deploymentId)&&/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(v.url),'XERO_COURIER_PUBLICATION_INVALID');}
  const binding={schemaVersion:1,kind:'fcos_native_xero_courier_publication_v1',repository:REPOSITORY,repositoryId:REPO_ID,publisherId:ACTOR_ID,publisherLogin:'hocheunglai-oss',
    templateSha256,planSha256,operationId:plan.binding.operationId,runId:String(runId),publicationKind:kind,ref,commitSha,rawPayloadSha256:hash(raw)};
  const bindingSha256=hash(canonical(binding)),body={state:'success',context:`fcos/xero-courier/v1/${bindingSha256}`,description:`${kind} ${binding.rawPayloadSha256}`,
    target_url:`https://github.com/${REPOSITORY}/actions/runs/${runId}#fcos-xero-${bindingSha256}`};
  return {binding,bindingSha256,body,route:`repos/${REPOSITORY}/statuses/${commitSha}`,readRoute:`repos/${REPOSITORY}/commits/${commitSha}/statuses?per_page=100`,issuedAt:t.issuedAt,notAfter:t.notAfter};
}
export function assertCourierPublicationStatus(value,expected,now=Date.now()) {
  const b=expected.body,created=Date.parse(value?.created_at),updated=Date.parse(value?.updated_at);
  need(value&&Number.isSafeInteger(value.id)&&value.id>0&&value.url===`https://api.github.com/${expected.route}`
    &&value.creator?.id===ACTOR_ID&&value.creator.login==='hocheunglai-oss'&&['state','context','description','target_url'].every(k=>value[k]===b[k])
    &&Number.isFinite(created)&&Number.isFinite(updated)&&created>=expected.issuedAt-1000&&created<expected.notAfter&&created<=now+30000&&updated>=created&&updated<=now+30000,
  'XERO_COURIER_PUBLICATION_INVALID');
  return {id:value.id,url:value.url,creator:{id:ACTOR_ID,login:'hocheunglai-oss'},context:b.context,createdAt:value.created_at,bindingSha256:expected.bindingSha256};
}
function nativeGithubCreatedStatus(output,expected,now) {
  need(typeof output==='string'&&Buffer.byteLength(output)<=65536&&/^HTTP\/[0-9.]+ 201(?: |\r?\n)/.test(output),'XERO_COURIER_PUBLICATION_UNKNOWN');
  const separator=output.match(/\r?\n\r?\n/);need(separator,'XERO_COURIER_PUBLICATION_UNKNOWN');
  return assertCourierPublicationStatus(JSON.parse(output.slice(separator.index+separator[0].length)),expected,now);
}
export const courierArtifactName = (runId, submissionId) => { need(/^[1-9][0-9]{0,19}$/.test(String(runId)) && UUID.test(submissionId)); return `fcos-xero-ack-${runId}-${submissionId}`; };
export async function assertCourierRun(read, t, runId, { allowCompleted = false } = {}) {
  const repository = await read(`repos/${REPOSITORY}`), run = await read(`repos/${REPOSITORY}/actions/runs/${runId}`);
  need(Number.isSafeInteger(Number(runId)) && repository.id === REPO_ID && repository.full_name === REPOSITORY && run.id === Number(runId) && run.run_attempt === 1
    && run.repository?.id === REPO_ID && run.head_repository?.id === REPO_ID && run.actor?.id === ACTOR_ID && run.actor.login === 'hocheunglai-oss'
    && run.event === 'workflow_dispatch' && run.head_sha === t.caller.sha && `refs/heads/${run.head_branch}` === t.caller.ref
    && [t.caller.workflowRef.split(`${REPOSITORY}/`)[1].split('@')[0], t.caller.workflowRef.split(`${REPOSITORY}/`)[1]].includes(run.path)
    && (run.status === 'in_progress' || allowCompleted && run.status === 'completed'), 'XERO_COURIER_RUN_MISMATCH');
  const jobs = await read(`repos/${REPOSITORY}/actions/runs/${runId}/attempts/1/jobs?per_page=100`);
  need(Array.isArray(jobs.jobs) && jobs.total_count === jobs.jobs.length && jobs.jobs.length <= 100, 'XERO_COURIER_JOBS_INCOMPLETE');
  const selected = jobs.jobs.filter(j => j.name === t.caller.jobName || j.name.endsWith(` / ${t.caller.jobName}`));
  need(selected.length === 1 && Number.isSafeInteger(selected[0].id) && selected[0].run_id === Number(runId)
    && Array.isArray(selected[0].labels) && !selected[0].labels.includes('self-hosted') && selected[0].labels.includes('ubuntu-24.04')
    && (selected[0].status === 'in_progress' || allowCompleted && selected[0].status === 'completed'), 'XERO_COURIER_JOB_MISMATCH');
  return { run, job: selected[0] };
}
export async function readCourierGitFile(read, ref, filename, limit) {
  need(/^refs\/heads\/codex\/fcos-xero-[a-f0-9]{16}-[1-9][0-9]{0,19}\/(?:locator|request-[A-Za-z]+-[a-f0-9-]{36})$/.test(ref));
  need(['request.json','locator.json'].includes(filename));
  const record = await read(`repos/${REPOSITORY}/git/ref/${ref.slice(5)}`, true);
  if (record === null) return null;
  need(record.ref === ref && record.object?.type === 'commit' && SHA.test(record.object.sha), 'XERO_COURIER_REF_MISMATCH');
  const commit = await read(`repos/${REPOSITORY}/git/commits/${record.object.sha}`);
  need(commit.sha === record.object.sha && Array.isArray(commit.parents) && commit.parents.length === 0 && SHA.test(commit.tree?.sha), 'XERO_COURIER_COMMIT_MISMATCH');
  const tree = await read(`repos/${REPOSITORY}/git/trees/${commit.tree.sha}`);
  need(tree.sha === commit.tree.sha && tree.truncated === false && tree.tree?.length === 1 && tree.tree[0].path === filename && tree.tree[0].mode === '100644'
    && tree.tree[0].type === 'blob' && SHA.test(tree.tree[0].sha), 'XERO_COURIER_TREE_MISMATCH');
  const blob = await read(`repos/${REPOSITORY}/git/blobs/${tree.tree[0].sha}`);
  need(blob.sha === tree.tree[0].sha && blob.encoding === 'base64' && typeof blob.content === 'string');
  const data = Buffer.from(blob.content.replace(/\n/g, ''), 'base64');
  need(data.length <= limit && blob.size === data.length && gitHash('blob', data) === blob.sha && Buffer.from(data.toString('utf8')).equals(data), 'XERO_COURIER_BLOB_MISMATCH');
  return { ref, commitSha: commit.sha, raw: data.toString('utf8') };
}
export function assertCourierAck(value, { templateSha256, runId, jobId, request, requestRef, commitSha, hostOrigin, deploymentId, plan, planSha256, checkpoint = {}, now = Date.now() }) {
  need(exact(value, ['schemaVersion','kind','templateSha256','runId','jobId','requestRef','commitSha','requestSha256','hostOrigin','deploymentId','httpStatus','resultJson','resultSha256','receivedAt'])
    && value.schemaVersion === 1 && value.kind === 'fcos_xero_recovery_actual_http_ack_v1' && value.templateSha256 === templateSha256
    && value.runId === String(runId) && value.jobId === jobId && value.requestRef === requestRef && value.commitSha === commitSha
    && value.requestSha256 === hash(canonical(request)) && value.hostOrigin === hostOrigin && value.deploymentId === deploymentId
    && value.httpStatus === 200 && typeof value.resultJson === 'string' && Buffer.byteLength(value.resultJson) <= 16384
    && value.resultSha256 === bytesHash(value.resultJson) && Number.isSafeInteger(value.receivedAt) && value.receivedAt <= now + 30000,
  'XERO_COURIER_ACK_MISMATCH');
  const result = JSON.parse(value.resultJson);
  need(exact(result, ['kind','operationId','planSha256','requestSha256','step','submissionId','state','nextStep','resultSha256','result','executionAuthorityGranted','qualificationAccepted']) && result.kind === 'fcos_xero_recovery_step_result_v1' && result.operationId === plan.binding.operationId && result.planSha256 === planSha256
    && result.requestSha256 === value.requestSha256 && result.step === request.step && result.submissionId === request.submissionId
    && result.executionAuthorityGranted === false && result.qualificationAccepted === false && result.state !== 'submitted_unknown', 'XERO_COURIER_RESULT_MISMATCH');
  validateXeroRecoveryStepResult(request.step, result.result, plan.binding, checkpoint, value.receivedAt);
  const next = nextXeroRecoveryStep(request.step, { ...checkpoint, [request.step]: result.result });
  need(result.resultSha256 === hash(canonical(result.result)) && result.nextStep === next && result.state === (next === null ? 'complete' : 'ready'), 'XERO_COURIER_RESULT_MISMATCH');
  return result;
}
function regular(path, maximum = 1024 * 1024) {
  for (let at = resolve(path); ; at = dirname(at)) { need(!lstatSync(at).isSymbolicLink(), 'XERO_COURIER_SYMLINK_REFUSED'); if (at === dirname(at)) break; }
  const s = lstatSync(path); need(s.isFile() && s.nlink === 1 && s.uid === process.getuid() && s.size <= maximum); return readFileSync(path);
}
function privateDir(path) { if (!existsSync(path)) mkdirSync(path, { mode: 0o700 }); for (let at = resolve(path); ; at = dirname(at)) { need(!lstatSync(at).isSymbolicLink(), 'XERO_COURIER_SYMLINK_REFUSED'); if (at === dirname(at)) break; } const s = lstatSync(path); need(s.isDirectory() && !s.isSymbolicLink() && !(s.mode & 0o077) && s.uid === process.getuid()); }
function record(path, value) {
  privateDir(dirname(path)); const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, JSON.stringify(value) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
  const d = openSync(dirname(path), constants.O_RDONLY); try { fsyncSync(d); } finally { closeSync(d); }
}
const completed = value => ({ exit_code: 0, output: JSON.stringify(value) });
export function originalWarmVariable(value, templateJson, now = Date.now()) {
  need(value?.name === ORIGINAL_WARM_TEMPLATE_VARIABLE && value.value === Buffer.from(templateJson).toString('base64')
    && Buffer.byteLength(value.value) <= 49152 && ['created_at','updated_at'].every(k => typeof value[k] === 'string' && Number.isFinite(Date.parse(value[k])) && Date.parse(value[k]) <= now + 30000), 'XERO_COURIER_ROOT_ADMISSION_REQUIRED');
  return { repository: REPOSITORY, repositoryId: REPO_ID, scope: 'repository', name: value.name,
    createdAt: value.created_at, updatedAt: value.updated_at, valueSha256: bytesHash(value.value) };
}
// A separate Production ORCHESTRATION claim admits exactly one GitHub dispatch.
// It cannot assert, adopt or authorize the later reconciliation/financial claim.
const WARM_PYTHON = String.raw`import json,sys,hashlib,types,os,stat
from pathlib import Path
v=json.load(sys.stdin)
def raw(p):
 p=Path(p)
 if any(x.is_symlink() for x in [p,*p.parents]): raise ValueError('path')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as f:
  s=os.fstat(f.fileno())
  if not stat.S_ISREG(s.st_mode) or s.st_nlink!=1: raise ValueError('file')
  return f.read()
c=json.loads(raw(v['workflow']))['unifiedCoordinator'];g=c['writeLeaseHelper'];source=raw(g['path'])
if g['sha256']!='8ed4eda312b62c3b02c3a0a768ddd024a2a819af5f0f1194da47ef2a2d62fd38' or hashlib.sha256(source).hexdigest()!=g['sha256'] or not g['localCoordinationGuardAccepted'] or g['independentReviewPending'] or g['providerAuthority']: raise ValueError('guard')
for key in ['rootAcceptance','independentRevisionReview','independentFinalScopeAddendum']:
 if hashlib.sha256(raw(g[key]['path'])).hexdigest()!=g[key]['sha256']: raise ValueError('review')
m=types.ModuleType('actual_guard');m.__file__=g['path'];exec(compile(source,g['path'],'exec'),m.__dict__)
expected=v['expected'];item=c['objectives']['production']
if expected['ownerThreadId']!=v['features'] or expected['objective']!='production' or expected['epoch']!=c['epoch'] or not expected['operationId'].startswith('xero-warm-dispatch-'): raise ValueError('scope')
if m.OWNERS.get('production')!=v['features'] or c['ownerThreadId']!=v['features'] or item['ownerThreadId']!=v['features']: raise ValueError('owner')
if c['status']!='active' or item['status']!='active' or item['retired']: raise ValueError('inactive')
base=Path(c['writeLeasePath']).parent
if Path(g['path']).parent.parent!=base or Path(c['writeLeasePath'])!=base/'live-provider-write-lease.json': raise ValueError('lease_path')
if v['mode']=='claim': lease=m.WriteLease(v['workflow'],base).claim('production',v['features'],expected['operationId'],expected['bindingSha256'])
else:
 lease=json.loads(raw(c['writeLeasePath']))
 if lease!=v['lease']: raise ValueError('assert')
print(json.dumps(lease))
`;
/** Starts a template-only warm run. No request ref, host URL, owner login or
 * financial call occurs here. Root separately observes the exact actual run and
 * closes this orchestration lease; the later real financial claim is unchanged.
 * Public variable GET then dispatch is not a GitHub atomic snapshot/CAS. */
export async function createNativeXeroRecoveryWarmDispatcher({ templateJson, cwd = process.cwd(), controlRoot = ROOT, capture, nativeRuntime, now = Date.now, wait = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const parsed = parseCourierTemplate(templateJson), { template: t, templateSha256, plan, planSha256 } = parsed;
  need(nativeRuntime === undefined || typeof capture === 'function');
  const directory = canonicalCourierStateDirectory(plan.binding.operationId, controlRoot), admissionPath = join(directory, 'root-original-warm-admission.json');
  const a = JSON.parse(regular(admissionPath, 65536)), nav = JSON.parse(regular(join(controlRoot, '.fcos-cli/release-state.json'))), board = JSON.parse(regular(nav.workboardPath)), workflow = board.checkpointPaths.workflow;
  const epoch = JSON.parse(regular(workflow)).unifiedCoordinator.epoch;
  const scope = { currentExecutorThreadId: FEATURES_OWNER, historicalOwnerThreadId: plan.binding.ownerThreadId, epoch, templateSha256, planSha256,
    caller: t.caller, controllerSha: t.controllerSha, actorId: plan.binding.actorId, originalApprovalSha256: plan.binding.approvalSha256,
    sourcePins: nativeCourierSourcePins(), variable: a.scope?.variable, workflowId: a.scope?.workflowId,
    capability: { maximumGithubDispatchPosts: 1, maximumRequestPublications: 0, maximumHostPosts: 0, maximumOwnerLogins: 0, financialAuthorityGranted: false },
    evidence: a.scope?.evidence, dispatchId: a.scope?.dispatchId, issuedAt: a.scope?.issuedAt, notAfter: a.scope?.notAfter };
  need(exact(a, ['schemaVersion','kind','accepted','reviewerId','scope','scopeSha256','rootReview','independentReview']) && a.schemaVersion === 1 && a.kind === 'fcos_root_admitted_original_xero_warm_dispatch_v1'
    && a.accepted === true && a.reviewerId === '/root' && canonical(a.scope) === canonical(scope) && a.scopeSha256 === hash(canonical(scope))
    && UUID.test(scope.dispatchId) && Number.isSafeInteger(scope.workflowId) && scope.workflowId > 0 && Number.isSafeInteger(scope.issuedAt) && Number.isSafeInteger(scope.notAfter)
    && scope.issuedAt >= t.issuedAt && scope.notAfter <= t.notAfter && scope.notAfter > scope.issuedAt && scope.notAfter - scope.issuedAt <= 900000
    && exact(scope.evidence, ['publicTemplateInstallation','originalAuthority','artifactCaptureAuthority','coordinationQuota']), 'XERO_COURIER_ROOT_ADMISSION_REQUIRED');
  const documents = {};
  for (const [key, ref] of Object.entries({ ...scope.evidence, rootReview: a.rootReview, independentReview: a.independentReview })) {
    need(exact(ref, ['path','sha256']) && HASH.test(ref.sha256)); const bytes = regular(ref.path, 262144);
    need(bytesHash(bytes) === ref.sha256, 'XERO_COURIER_ROOT_ADMISSION_REQUIRED'); documents[key] = JSON.parse(bytes);
  }
  for (const [key, role] of [['rootReview','root'],['independentReview','independent']]) {
    const r = documents[key]; need(r.kind === 'fcos_actual_original_xero_warm_dispatch_review_v1' && r.accepted === true && r.role === role && r.scopeSha256 === a.scopeSha256
      && r.actualPublicTemplateInstallationReviewed === true && r.actualProtectedCallerSourceReviewed === true && r.originalAuthorityAndCaptureProvenanceReviewed === true && r.actualSharedCoordinationQuotaReviewed === true && r.financialAuthorityGranted === false
      && Number.isFinite(Date.parse(r.reviewedAt)) && Date.parse(r.reviewedAt) >= scope.issuedAt - 30000 && Date.parse(r.reviewedAt) <= now() + 30000
      && (role === 'root' ? r.reviewerId === '/root' : /^\/root\/[a-z0-9_]+(?:\/[a-z0-9_]+)*$/.test(r.reviewerId || '') && r.reviewerId !== '/root/xero_host_actor_auth' && !r.reviewerId.startsWith('/root/xero_host_actor_auth/')), 'XERO_COURIER_ROOT_ADMISSION_REQUIRED');
  }
  const installation = documents.publicTemplateInstallation, quota = documents.coordinationQuota;
  need(installation.kind === 'fcos_root_actual_original_carrier_public_template_installation_v1' && installation.accepted === true && installation.reviewerId === '/root' && installation.templateSha256 === templateSha256
    && canonical(installation.variable) === canonical(scope.variable) && installation.actualNativeReceiptProvenanceReviewed === true
    && quota.kind === 'fcos_actual_xero_courier_shared_get_quota_v1' && quota.accepted === true && quota.repository === REPOSITORY && quota.nativeGetsPerMinute === 20 && quota.carrierGetsPerMinute === 20 && quota.sharedMaximum === 45 && quota.maximumConcurrentClients === 2 && quota.actualSharedPreflightReviewed === true, 'XERO_COURIER_ROOT_ADMISSION_REQUIRED');
  privateDir(directory); need(bytesHash(regular(fileURLToPath(new URL('../guarded-provider-write.mjs', import.meta.url)))) === WRITE_GUARD_SHA);
  const path = name => join(directory, `${plan.binding.operationId}.original-warm.${name}.json`), expected = { epoch, objective: 'production', ownerThreadId: FEATURES_OWNER, operationId: `xero-warm-dispatch-${plan.binding.operationId}`, bindingSha256: a.scopeSha256 };
  let runtime = nativeRuntime, submitting = false;
  const run = (command, args, options = {}) => {
    let result; try { result = capture ? capture(command, args, options) : spawnSync(command, args, { timeout: 30000, maxBuffer: 262144, stdio: ['pipe','pipe','pipe'], ...options }); } catch { result = { error: true }; }
    const kind = !result || Object.hasOwn(result, 'session_id') || Object.hasOwn(result, 'sessionId') ? 'missing_or_pending_result' : result.error ? 'tool_error' : result.signal ? 'tool_signal' : result.status !== 0 ? 'tool_nonzero_exit' : typeof result.stdout !== 'string' ? 'tool_missing_output' : null;
    if (kind) { if (submitting && !existsSync(path('tool-error'))) record(path('tool-error'), { kind, code: 'XERO_COURIER_NATIVE_COMMAND_UNKNOWN', outcome: 'unknown', ownerReadbackRequired: true }); throw refusal('XERO_COURIER_NATIVE_COMMAND_UNKNOWN'); } return result.stdout;
  };
  const lease = (mode, held) => ({ exit_code: 0, output: run('/usr/bin/python3', ['-I','-c',WARM_PYTHON], { input: JSON.stringify({ mode, workflow, expected, features: FEATURES_OWNER, ...(held ? { lease: held } : {}) }), encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } }) });
  const { providerRuntime } = await import('../../fcos-connections.mjs'), reserveGet = createCourierReadBudget({ now, wait });
  const gh = (args, input) => { runtime ||= providerRuntime('github'); need(runtime.credentialAvailable); return run(runtime.command, args, { cwd, input, encoding: 'utf8', env: { PATH: runtime.env.PATH, HOME: runtime.env.HOME, GH_CONFIG_DIR: runtime.env.GH_CONFIG_DIR, GH_HOST: 'github.com', GH_REPO: REPOSITORY, GH_PROMPT_DISABLED: '1' } }); };
  const read = async route => { await reserveGet(); return JSON.parse(gh(['api',route,'--method','GET'])); };
  const active = () => need(now() >= scope.issuedAt && now() < scope.notAfter, 'XERO_COURIER_AUTHORITY_EXPIRED');
  async function identity() {
    const u = await read('user'), repository = await read(`repos/${REPOSITORY}`); need(u.id === ACTOR_ID && u.login === 'hocheunglai-oss' && repository.id === REPO_ID && repository.full_name === REPOSITORY && repository.permissions?.push === true, 'XERO_COURIER_RUN_MISMATCH');
    const branch = await read(`repos/${REPOSITORY}/branches/${encodeURIComponent(t.caller.ref.slice(11))}`); need(branch.name === t.caller.ref.slice(11) && branch.protected === true && branch.commit?.sha === t.caller.sha, 'XERO_COURIER_RUN_MISMATCH');
    const workflowRecord = await read(`repos/${REPOSITORY}/actions/workflows/authenticated-release.yml`); need(workflowRecord.id === scope.workflowId && workflowRecord.path === '.github/workflows/authenticated-release.yml' && workflowRecord.state === 'active', 'XERO_COURIER_RUN_MISMATCH');
    const source = await read(`repos/${REPOSITORY}/contents/.github/workflows/authenticated-release.yml?ref=${t.caller.sha}`), expectedBytes = regular(fileURLToPath(new URL('../../../.github/qualification/hosted-release-bootstrap.yml', import.meta.url))).toString('utf8').replaceAll('__FCOS_CONTROLLER_SHA__', t.controllerSha), actual = Buffer.from(source.content || '', 'base64');
    need(source.encoding === 'base64' && source.size === actual.length && source.sha === gitHash('blob', actual) && actual.equals(Buffer.from(expectedBytes)), 'XERO_COURIER_ROOT_ADMISSION_REQUIRED');
    const v = originalWarmVariable(await read(`repos/${REPOSITORY}/actions/variables/${ORIGINAL_WARM_TEMPLATE_VARIABLE}`), templateJson, now()); need(canonical(v) === canonical(scope.variable), 'XERO_COURIER_ROOT_ADMISSION_REQUIRED');
  }
  return Object.freeze({
    async dispatch() {
      try {
      need(!existsSync(path('attempt')), 'XERO_COURIER_CONSUMED_GET_ONLY'); active(); record(path('attempt'), { scopeSha256: a.scopeSha256, dispatchId: scope.dispatchId, at: now(), maximumAttempts: 1, financialAuthorityGranted: false });
      const outcome = await runGuardedProviderWrite({ expected, claim: () => lease('claim'), assertLease: ({ lease: held }) => lease('assert', held),
        recordIntent: ({ lease: held, phase }) => { const value = { lease: held, state: phase, durable: true }; record(path(phase), { ...value, scopeSha256: a.scopeSha256, maximumDispatchPosts: 1, financialAuthorityGranted: false }); return completed(value); },
        submit: async () => { submitting = true; active(); await identity(); active(); const body = { ref: t.caller.ref.slice(11), inputs: { xero_recovery_mode: 'original-warm', xero_original_warm_dispatch_id: scope.dispatchId } };
          const output = gh(['api',`repos/${REPOSITORY}/actions/workflows/authenticated-release.yml/dispatches`,'--method','POST','--include','--input','-'], JSON.stringify(body));
          need(/^HTTP\/[0-9.]+ 204(?: |\r?\n)/.test(output) && !/^HTTP\/[0-9.]+ (?!204)[0-9]{3}/m.test(output), 'XERO_COURIER_REMOTE_OUTCOME_UNKNOWN');
          record(path('provider-ack'), { scopeSha256: a.scopeSha256, dispatchId: scope.dispatchId, httpStatus: 204, nativeCompleted: true, nativeOutputSha256: bytesHash(output), requestSha256: hash(JSON.stringify(body)) });
          return completed({ dispatchAccepted: true, dispatchId: scope.dispatchId, providerCompletionProven: false }); },
        validateProviderResult: r => { try { return JSON.parse(r.output).dispatchAccepted === true; } catch { return false; } },
        recordOutcome: ({ lease: held, outcome: o }) => { const value = { lease: held, state: o.state, durable: true }; record(path(o.state), { ...value, scopeSha256: a.scopeSha256, reason: o.reason }); return completed(value); } });
      need(outcome.status === 'submitted_acknowledged', 'XERO_COURIER_REMOTE_OUTCOME_UNKNOWN'); record(path('ack'), { dispatchId: scope.dispatchId, scopeSha256: a.scopeSha256, at: now(), dispatchAccepted: true, runObserved: false, financialAuthorityGranted: false, lease: outcome.lease,
        attemptSha256: bytesHash(regular(path('attempt'))), providerAckSha256: bytesHash(regular(path('provider-ack'))) });
      return { status: 'original_warm_dispatched_run_pending', dispatchId: scope.dispatchId, financialAuthorityGranted: false, retryable: false };
      } catch (error) { throw refusal(safeCode(error)); }
    },
    async observeRun(runId) {
      try {
      need(typeof runId === 'string' && /^[1-9][0-9]{0,19}$/.test(runId) && Number.isSafeInteger(Number(runId)) && existsSync(path('ack')), 'XERO_COURIER_ORIGINAL_CLAIM_REQUIRED');
      const attempt = JSON.parse(regular(path('attempt'))), ack = JSON.parse(regular(path('ack'))), provider = JSON.parse(regular(path('provider-ack')));
      need(attempt.scopeSha256 === a.scopeSha256 && attempt.dispatchId === scope.dispatchId && Number.isSafeInteger(attempt.at) && ack.scopeSha256 === a.scopeSha256 && ack.dispatchId === scope.dispatchId
        && ack.dispatchAccepted === true && ack.attemptSha256 === bytesHash(regular(path('attempt'))) && ack.providerAckSha256 === bytesHash(regular(path('provider-ack')))
        && provider.scopeSha256 === a.scopeSha256 && provider.dispatchId === scope.dispatchId && provider.httpStatus === 204 && provider.nativeCompleted === true && HASH.test(provider.nativeOutputSha256)
        && provider.requestSha256 === hash(JSON.stringify({ref:t.caller.ref.slice(11),inputs:{xero_recovery_mode:'original-warm',xero_original_warm_dispatch_id:scope.dispatchId}}))
        && Object.entries(expected).every(([k,v]) => ack.lease?.[k] === v) && UUID.test(ack.lease?.leaseId) && ack.lease.coordinationOnly === true && ack.lease.providerAuthorityGranted === false
        && ack.lease.uncertainOutcomeRequiresReadback === true && !existsSync(path('uncertain')), 'XERO_COURIER_ORIGINAL_CLAIM_REQUIRED');
      for (const phase of ['prepared','submitting','submitted']) { const receipt = JSON.parse(regular(path(phase))); need(receipt.state === phase && receipt.durable === true && receipt.scopeSha256 === a.scopeSha256 && canonical(receipt.lease) === canonical(ack.lease), 'XERO_COURIER_ORIGINAL_CLAIM_REQUIRED'); }
      await identity(); const actual = await assertCourierRun(read, t, runId, { allowCompleted: true });
      need(actual.run.display_title === `FCOS original Xero carrier ${scope.dispatchId}` && Date.parse(actual.run.created_at) >= attempt.at - 1000 && Date.parse(actual.run.created_at) <= now() + 30000, 'XERO_COURIER_RUN_MISMATCH');
      return { status: 'actual_original_warm_run_observed', dispatchId: scope.dispatchId, runId, jobId: actual.job.id, templateSha256, planSha256, orchestrationLeaseResolved: false, financialAuthorityGranted: false };
      } catch (error) { throw refusal(safeCode(error)); }
    }
  });
}
// Actual accepted Features successor owns the SAME OS mutex and persistent
// lease. Historical source/owner/unknown intents remain immutable. Canonical
// active objective and current acceptance are still required; no production or
// historical-owner fallback can supply financial authority.
const PYTHON = String.raw`import json,sys,hashlib,types,os,stat
from pathlib import Path
v=json.load(sys.stdin)
def raw(p):
 p=Path(p)
 if any(x.is_symlink() for x in [p,*p.parents]): raise ValueError('path')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as f:
  s=os.fstat(f.fileno())
  if not stat.S_ISREG(s.st_mode) or s.st_nlink!=1: raise ValueError('file')
  return f.read()
c=json.loads(raw(v['workflow']))['unifiedCoordinator'];g=c['writeLeaseHelper'];source=raw(g['path'])
if g['sha256']!='8ed4eda312b62c3b02c3a0a768ddd024a2a819af5f0f1194da47ef2a2d62fd38' or hashlib.sha256(source).hexdigest()!=g['sha256'] or not g['localCoordinationGuardAccepted'] or g['independentReviewPending'] or g['providerAuthority']: raise ValueError('guard')
for key in ['rootAcceptance','independentRevisionReview','independentFinalScopeAddendum']:
 if hashlib.sha256(raw(g[key]['path'])).hexdigest()!=g[key]['sha256']: raise ValueError('review')
m=types.ModuleType('actual_guard');m.__file__=g['path'];exec(compile(source,g['path'],'exec'),m.__dict__)
item=c['objectives']['reconciliation'];expected=v['expected']
if expected['ownerThreadId']!=v['features'] or expected['objective']!='reconciliation' or expected['epoch']!=c['epoch']: raise ValueError('scope')
if m.OWNERS.get('reconciliation')!=v['features']: raise ValueError('features_not_admitted')
if c['ownerThreadId']!=v['features'] or c['reconciliationExecutionOwnerThreadId']!=v['features'] or item['ownerThreadId']!=v['features']: raise ValueError('owner')
if c['status']!='active' or item['status']!='active' or item['retired']: raise ValueError('inactive')
base=Path(c['writeLeasePath']).parent
if Path(g['path']).parent.parent!=base or Path(c['writeLeasePath'])!=base/'live-provider-write-lease.json': raise ValueError('lease_path')
if v['mode']=='claim':
 lease=m.WriteLease(v['workflow'],base).claim('reconciliation',v['features'],expected['operationId'],expected['bindingSha256'])
else:
 lease=json.loads(raw(c['writeLeasePath']))
 if lease!=v['lease']: raise ValueError('assert')
print(json.dumps(lease))
`;

// One native + one warm carrier allocate at most 20 GET/min each, leaving five
// of the shared 45/min coordination envelope unused. Actual shared quota still
// requires current root-reviewed preflight; a local limiter is not that proof.
export function createCourierReadBudget({now=Date.now,wait=ms=>new Promise(r=>setTimeout(r,ms)),signal,limit=20}={}) {
  need(Number.isInteger(limit) && limit>0 && limit<=20);const reads=[];let last=0;
  return async()=>{while(true){need(!signal?.aborted,'XERO_COURIER_AUTHORITY_EXPIRED');const at=now();need(Number.isSafeInteger(at)&&at>=last);last=at;
    while(reads.length && reads[0]<=at-60000)reads.shift();if(reads.length<limit){reads.push(at);return;}
    await wait(Math.max(1,reads[0]+60000-at));}};
}
export const canonicalCourierStateDirectory=(operationId,controlRoot=ROOT)=>{need(HASH.test(operationId));return join(controlRoot,'.fcos-cli/outputs/hosted-xero-recovery-courier',operationId);};
export function nativeCourierSourcePins(){return Object.fromEntries(['scripts/lib/hosted-release/xero-recovery-native-relay.mjs','scripts/hosted-xero-recovery-carrier.mjs','.github/workflows/hosted-xero-recovery-carrier.yml','.github/qualification/hosted-release-bootstrap.yml','scripts/lib/hosted-release/xero-recovery-source-inventory.mjs','scripts/lib/guarded-provider-write.mjs'].map(p=>[p,bytesHash(regular(fileURLToPath(new URL('../../../'+p,import.meta.url))))]));}
export function assertNativeCourierAdmission({template:t,templateSha256,plan,planSha256,binding,stateDirectory,controlRoot=ROOT,coordinatorEpoch}) {
  const fixed=canonicalCourierStateDirectory(plan.binding.operationId,controlRoot);need(stateDirectory===fixed,'XERO_COURIER_CANONICAL_STATE_REQUIRED');
  need(existsSync(join(fixed,'root-native-admission.json')),'XERO_COURIER_ROOT_ADMISSION_REQUIRED');const raw=regular(join(fixed,'root-native-admission.json'),65536);need(bytesHash(raw)===binding.rootAdmissionSha256,'XERO_COURIER_ROOT_ADMISSION_REQUIRED');const a=JSON.parse(raw);
  const target={epoch:coordinatorEpoch,featuresOwnerThreadId:FEATURES_OWNER,artifactCaptureAuthoritySha256:t.artifactCaptureAuthoritySha256,runId:binding.runId,jobId:binding.jobId,hostOrigin:binding.hostOrigin,deploymentId:binding.deploymentId,ownerThreadId:plan.binding.ownerThreadId,actorId:plan.binding.actorId,
    approvalSha256:plan.binding.approvalSha256,sourceSha256:plan.binding.sourceSha256,controllerSha:t.controllerSha};
  need(exact(a,['schemaVersion','kind','reviewerId','accepted','templateSha256','planSha256','target','sourcePins','evidence','scopeSha256']) && a.schemaVersion===1 && a.kind==='fcos_root_admitted_native_xero_courier_v1'
    && a.reviewerId==='/root' && a.accepted===true && a.templateSha256===templateSha256 && a.planSha256===planSha256 && canonical(a.target)===canonical(target)
    && canonical(a.sourcePins)===canonical(nativeCourierSourcePins()) && a.sourcePins['scripts/lib/guarded-provider-write.mjs']===WRITE_GUARD_SHA
    && exact(a.evidence,['originalAuthority','artifactCaptureAuthority','hostDeploymentSourceReceipt','coordinationQuota','rootReview','independentReview']),'XERO_COURIER_ROOT_ADMISSION_REQUIRED');
  const documents={};for(const [key,ref] of Object.entries(a.evidence)){need(exact(ref,['path','sha256'])&&typeof ref.path==='string'&&HASH.test(ref.sha256));const bytes=regular(ref.path,262144);need(bytesHash(bytes)===ref.sha256,'XERO_COURIER_ROOT_ADMISSION_REQUIRED');documents[key]=JSON.parse(bytes);}
  const scope={templateSha256,planSha256,target,sourcePins:a.sourcePins,evidence:{originalAuthority:a.evidence.originalAuthority,artifactCaptureAuthority:a.evidence.artifactCaptureAuthority,hostDeploymentSourceReceipt:a.evidence.hostDeploymentSourceReceipt,coordinationQuota:a.evidence.coordinationQuota}};
  need(a.scopeSha256===hash(canonical(scope)),'XERO_COURIER_ROOT_ADMISSION_REQUIRED');
  for(const [key,role] of [['rootReview','root'],['independentReview','independent']]){const r=documents[key];need(r?.kind==='fcos_actual_native_xero_courier_action_review_v1' && r.accepted===true && r.role===role && r.scopeSha256===a.scopeSha256
    && r.originalHumanAuthorityProvenanceReviewed===true && r.actualDeploymentSourceProvenanceReviewed===true && r.actualSharedCoordinationQuotaReviewed===true && r.actualPublisherStatusScopeAndConsumersReviewed===true
    && (role==='root'?r.reviewerId==='/root':typeof r.reviewerId==='string'&&/^\/root\/[a-z0-9_]+(?:\/[a-z0-9_]+)*$/.test(r.reviewerId)&&r.reviewerId!=='/root/xero_host_actor_auth'&&!r.reviewerId.startsWith('/root/xero_host_actor_auth/')),'XERO_COURIER_ROOT_ADMISSION_REQUIRED');}
  const q=documents.coordinationQuota;need(q?.kind==='fcos_actual_xero_courier_shared_get_quota_v1' && q.accepted===true && q.repository===REPOSITORY && q.nativeGetsPerMinute===20 && q.carrierGetsPerMinute===20 && q.sharedMaximum===45 && q.maximumConcurrentClients===2 && q.actualSharedPreflightReviewed===true,'XERO_COURIER_ROOT_ADMISSION_REQUIRED');
  return a;
}
// Readback is an explicitly admitted orchestration write followed by separately
// requested GETs. It never resolves the original unknown claim or issues a
// financial host POST. The one GitHub dispatch POST is separately guarded.
export const ownerReadbackArtifactName = (originalRunId, readerRunId, operationId) => {
  need([originalRunId,readerRunId].every(v=>/^[1-9][0-9]{0,19}$/.test(v)) && originalRunId!==readerRunId && HASH.test(operationId));
  return `fcos-xero-readback-${originalRunId}-${readerRunId}-${operationId.slice(0,16)}`;
};
export function parseOwnerReadbackCarrier(text, parsed) {
  need(typeof text==='string' && Buffer.byteLength(text)<=4096,'XERO_COURIER_READBACK_ADMISSION_REQUIRED');const r=JSON.parse(text),b=r.originalBinding;
  need(exact(r,['schemaVersion','kind','templateSha256','planSha256','originalBinding','requestSha256','originalClaimSha256','originalStoppedSha256','originalUncertainSha256','admissionScopeSha256','dispatchId','issuedAt','notAfter'])
    && r.schemaVersion===1 && r.kind==='fcos_xero_owner_readback_carrier_v1' && r.templateSha256===parsed.templateSha256 && r.planSha256===parsed.planSha256
    && exact(b,['runId','jobId','hostOrigin','deploymentId','rootAdmissionSha256']) && /^[1-9][0-9]{0,19}$/.test(b.runId) && Number.isSafeInteger(b.jobId) && b.jobId>0
    && /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(b.hostOrigin) && /^dpl_[A-Za-z0-9]+$/.test(b.deploymentId) && HASH.test(b.rootAdmissionSha256)
    && ['requestSha256','originalClaimSha256','originalStoppedSha256','originalUncertainSha256','admissionScopeSha256'].every(k=>HASH.test(r[k])) && UUID.test(r.dispatchId)
    && Number.isSafeInteger(r.issuedAt) && Number.isSafeInteger(r.notAfter) && r.issuedAt>=parsed.template.issuedAt && r.notAfter>r.issuedAt && r.notAfter-r.issuedAt<=900000,
  'XERO_COURIER_READBACK_ADMISSION_REQUIRED');return r;
}
export function validateOwnerReadbackResult(value, {plan,planSha256,now=Date.now()}) {
  need(exact(value,['kind','operationId','planSha256','state','nextStep','currentStep','submissionId','lastResultSha256','checkpoint','executionAuthorityGranted','qualificationAccepted'])
    && value.kind==='fcos_xero_recovery_step_readback_v1' && value.operationId===plan.binding.operationId && value.planSha256===planSha256
    && ['ready','complete','submitted_unknown'].includes(value.state) && XERO_RECOVERY_STEPS.includes(value.currentStep) && UUID.test(value.submissionId)
    && (value.lastResultSha256===null||HASH.test(value.lastResultSha256)) && (value.state==='ready'?XERO_RECOVERY_STEPS.includes(value.nextStep):value.nextStep===null)
    && value.executionAuthorityGranted===false && value.qualificationAccepted===false && plain(value.checkpoint) && Object.keys(value.checkpoint).every(k=>XERO_RECOVERY_STEPS.includes(k)), 'XERO_COURIER_READBACK_RESULT_INVALID');
  let next='preflight',last=null,lastStep=null;
  for(const step of XERO_RECOVERY_STEPS)if(Object.hasOwn(value.checkpoint,step)){const v=value.checkpoint[step];need(plain(v)&&step===next,'XERO_COURIER_READBACK_RESULT_INVALID');
    const at=step==='preflight'?Date.parse(v.observedAt):['sessionVerify','probeGrant'].includes(step)?Date.parse(v.expiresAt)-1:step==='probeAdmission'?Date.parse(v.deadlineAt)-1:now;
    validateXeroRecoveryStepResult(step,v,plan.binding,value.checkpoint,at);last=hash(canonical(v));lastStep=step;next=nextXeroRecoveryStep(step,value.checkpoint);}
  need(value.lastResultSha256===last && (value.state==='submitted_unknown'?value.currentStep===next:value.currentStep===lastStep)
    &&(value.state==='complete'?next===null:value.state==='ready'?next!==null&&value.nextStep===next:next!==null),'XERO_COURIER_READBACK_RESULT_INVALID');
  need(Buffer.byteLength(JSON.stringify(value))<=16384,'XERO_COURIER_READBACK_RESULT_INVALID');return value;
}
export function assertOwnerReadbackAck(value,{parsed,readback,readerRunId,readerJobId,now=Date.now()}) {
  need(exact(value,['schemaVersion','kind','templateSha256','planSha256','admissionScopeSha256','dispatchId','originalRunId','readerRunId','readerJobId','hostOrigin','deploymentId','httpStatus','resultJson','resultSha256','receivedAt'])
    &&value.schemaVersion===1&&value.kind==='fcos_xero_owner_readback_actual_http_ack_v1'&&value.templateSha256===parsed.templateSha256&&value.planSha256===parsed.planSha256
    &&value.admissionScopeSha256===readback.admissionScopeSha256&&value.dispatchId===readback.dispatchId&&value.originalRunId===readback.originalBinding.runId
    &&value.readerRunId===readerRunId&&value.readerRunId!==value.originalRunId&&value.readerJobId===readerJobId&&value.hostOrigin===readback.originalBinding.hostOrigin&&value.deploymentId===readback.originalBinding.deploymentId
    &&value.httpStatus===200&&typeof value.resultJson==='string'&&Buffer.byteLength(value.resultJson)<=16384&&value.resultSha256===bytesHash(value.resultJson)
    &&Number.isSafeInteger(value.receivedAt)&&value.receivedAt>=readback.issuedAt&&value.receivedAt<readback.notAfter&&value.receivedAt<=now+30000,'XERO_COURIER_READBACK_RESULT_INVALID');
  return validateOwnerReadbackResult(JSON.parse(value.resultJson),{...parsed,now:value.receivedAt});
}
export async function createNativeXeroRecoveryRelay({ templateJson, binding, stateDirectory, cwd = process.cwd(), capture, nativeRuntime, now = Date.now, controlRoot = ROOT, wait = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const parsed = parseCourierTemplate(templateJson), { template: t, templateSha256, plan, planSha256 } = parsed;
  need(exact(binding, ['runId','jobId','hostOrigin','deploymentId','rootAdmissionSha256']) && /^[1-9][0-9]{0,19}$/.test(binding.runId)
    && Number.isSafeInteger(binding.jobId) && binding.jobId > 0 && /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(binding.hostOrigin)
    && /^dpl_[A-Za-z0-9]+$/.test(binding.deploymentId) && HASH.test(binding.rootAdmissionSha256));
  need(typeof now === 'function' && typeof wait === 'function' && (nativeRuntime===undefined || typeof capture==='function'));
  const derived=canonicalCourierStateDirectory(plan.binding.operationId,controlRoot);need(stateDirectory===undefined||stateDirectory===derived,'XERO_COURIER_CANONICAL_STATE_REQUIRED');stateDirectory=derived;
  const nav = JSON.parse(regular(join(controlRoot, '.fcos-cli/release-state.json'))), board = JSON.parse(regular(nav.workboardPath)), workflow = board.checkpointPaths.workflow;
  const state = JSON.parse(regular(workflow)).unifiedCoordinator;
  assertNativeCourierAdmission({...parsed,binding,stateDirectory,controlRoot,coordinatorEpoch:state.epoch});privateDir(stateDirectory);const reserveGet=createCourierReadBudget({now,wait});
  const op = plan.binding.operationId, statePath = name => join(stateDirectory, `${op}.${name}.json`);
  const expected = { epoch: '', objective: 'reconciliation', ownerThreadId: FEATURES_OWNER, operationId: `xero-recovery-${op}`,
    bindingSha256: hash(canonical({ templateSha256, binding })) };
  let activeSubmission = null;
  const nativeFailure = kind => { if (activeSubmission && !existsSync(statePath(`${activeSubmission}.tool-error`))) record(statePath(`${activeSubmission}.tool-error`), { kind, code: 'XERO_COURIER_NATIVE_COMMAND_UNKNOWN', outcome: 'unknown', ownerReadbackRequired: true }); throw refusal('XERO_COURIER_NATIVE_COMMAND_UNKNOWN'); };
  const runCommand = (command, args, options = {}) => {
    let r; try { r = capture ? capture(command, args, options) : spawnSync(command, args, { timeout: 30000, maxBuffer: 131072, stdio: ['pipe','pipe','pipe'], ...options }); } catch { nativeFailure('tool_exception'); }
    if (!r || Object.hasOwn(r, 'session_id') || Object.hasOwn(r, 'sessionId')) nativeFailure('missing_or_pending_result');
    if (r.signal != null) nativeFailure('tool_signal');
    if (r.error) nativeFailure('tool_error');
    if (r.status !== 0) nativeFailure('tool_nonzero_exit');
    if (typeof r.stdout !== 'string' && !Buffer.isBuffer(r.stdout)) nativeFailure('tool_missing_output');
    return r.stdout;
  };
  expected.epoch = state.epoch;
  need(bytesHash(regular(fileURLToPath(new URL('../guarded-provider-write.mjs', import.meta.url)))) === WRITE_GUARD_SHA, 'XERO_COURIER_WRITE_GUARD_CHANGED');
  const lease = (mode, held) => {
    const actual = runCommand('/usr/bin/python3', ['-I','-c', PYTHON], { input: JSON.stringify({ mode, workflow, expected, features: FEATURES_OWNER, ...(held ? { lease: held } : {}) }), encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
    return { exit_code: 0, output: String(actual) };
  };
  const { providerRuntime } = await import('../../fcos-connections.mjs');
  // Trusted command fixture only. CLI entrypoint cannot supply runtime overrides.
  let runtime=nativeRuntime;
  const gh = (args, input, binary = false) => {
    runtime ||= providerRuntime('github'); need(runtime.credentialAvailable, 'XERO_COURIER_GITHUB_REQUIRED');
    return runCommand(runtime.command, args, { input, cwd, ...(binary ? {} : { encoding: 'utf8' }), env: { PATH: runtime.env.PATH, HOME: runtime.env.HOME, GH_CONFIG_DIR: runtime.env.GH_CONFIG_DIR, GH_HOST: 'github.com', GH_REPO: REPOSITORY, GH_PROMPT_DISABLED: '1' } });
  };
  const read = async route => { await reserveGet();try { return JSON.parse(gh(['api', route, '--method', 'GET'])); } catch { throw refusal('XERO_COURIER_GITHUB_READ_UNKNOWN'); } };
  const identity = async () => { const u = await read('user'); need(u.login === 'hocheunglai-oss' && u.id === ACTOR_ID, 'XERO_COURIER_GITHUB_ACTOR_MISMATCH'); return assertCourierRun(read, t, binding.runId, { allowCompleted: true }); };
  async function acknowledgement(request, ref, commitSha, checkpoint) {
    const list = await read(`repos/${REPOSITORY}/actions/runs/${binding.runId}/artifacts?per_page=100`);
    need(Array.isArray(list.artifacts) && list.total_count === list.artifacts.length && list.artifacts.length <= 100, 'XERO_COURIER_ARTIFACTS_INCOMPLETE');
    const matches = list.artifacts.filter(a => a.name === courierArtifactName(binding.runId, request.submissionId));
    need(matches.length <= 1, 'XERO_COURIER_ARTIFACT_AMBIGUOUS'); if (!matches.length) return null;
    const actual=await identity();need(actual.job.id===binding.jobId,'XERO_COURIER_JOB_MISMATCH');
    const a = matches[0]; need(Number.isSafeInteger(a.id) && a.expired === false && a.workflow_run?.id === Number(binding.runId)
      && a.workflow_run.head_sha === t.caller.sha && a.workflow_run.repository_id === REPO_ID && a.workflow_run.head_repository_id === REPO_ID
      && /^sha256:[a-f0-9]{64}$/.test(a.digest) && a.size_in_bytes > 0 && a.size_in_bytes <= 131072
      && Date.parse(a.created_at) >= Date.parse(actual.job.started_at) && Date.parse(a.created_at) <= now() + 30000, 'XERO_COURIER_ARTIFACT_MISMATCH');
    await reserveGet();const archive = gh(['api', `repos/${REPOSITORY}/actions/artifacts/${a.id}/zip`, '--method','GET'], undefined, true);
    need(Buffer.isBuffer(archive) && archive.length === a.size_in_bytes && `sha256:${bytesHash(archive)}` === a.digest, 'XERO_COURIER_ARCHIVE_MISMATCH');
    const envelope = decodeRuntimeMaterialArchive(archive), result = assertCourierAck(envelope, { templateSha256, ...binding, request, requestRef: ref, commitSha, plan, planSha256, checkpoint, now: now() });
    return { envelope, result, artifactId: a.id, archiveSha256: a.digest.slice(7) };
  }
  const lineage = () => {
    const checkpoint = {}; let previous = null, nextStep = 'preflight';
    for (const step of XERO_RECOVERY_STEPS) if (existsSync(statePath(`${step}.ack`))) {
      const ack=JSON.parse(regular(statePath(`${step}.ack`))),intent=JSON.parse(regular(statePath(`${step}.prepared`))),publication=JSON.parse(regular(statePath(`${step}.publication`))),request=parseCourierRequest(intent.rawRequestJson,t);
      need(request.step===nextStep && request.previousResultSha256===previous && publication.requestSha256===hash(intent.rawRequestJson),'XERO_COURIER_NATIVE_LINEAGE_CHANGED');
      const checked=assertCourierAck(ack.envelope,{templateSha256,...binding,request,requestRef:publication.ref,commitSha:publication.commitSha,plan,planSha256,checkpoint,now:ack.envelope.receivedAt});need(canonical(checked)===canonical(ack.result),'XERO_COURIER_NATIVE_LINEAGE_CHANGED');
      checkpoint[step] = ack.result.result; previous = ack.result.resultSha256; nextStep = ack.result.nextStep;
    }
    return { checkpoint, previous, nextStep };
  };
  return Object.freeze({
    async submit(raw) {
      const request = parseCourierRequest(raw, t), ref = courierRequestRef(t, binding.runId, raw), chain = lineage();
      need((request.step!=='preflight'||!existsSync(statePath('claim-attempt'))) && !existsSync(statePath('stopped')) && !existsSync(statePath(`${request.step}.prepared`)) && request.step === chain.nextStep && request.previousResultSha256 === chain.previous, 'XERO_COURIER_CONSUMED_GET_ONLY');
      need(now() >= t.issuedAt && now() < t.notAfter, 'XERO_COURIER_AUTHORITY_EXPIRED');
      // Before credential access, fail closed on the actual accepted guard/owner.
      let commitSha;
      try {
        const result = await runGuardedProviderWrite({ expected, claim: async () => {
          if(request.step==='preflight'){need(!existsSync(statePath('claim-attempt')),'XERO_COURIER_CONSUMED_GET_ONLY');record(statePath('claim-attempt'),{binding,templateSha256,planSha256,originalIntentConsumedGetOnly:true});
            const receipt=lease('claim'),held=JSON.parse(receipt.output);record(statePath('held-lease'),{lease:held,binding,templateSha256,planSha256});return receipt;}
          need(chain.previous!==null && existsSync(statePath('held-lease')),'XERO_COURIER_ORIGINAL_CLAIM_REQUIRED');const held=JSON.parse(regular(statePath('held-lease')));need(canonical(held.binding)===canonical(binding)&&held.templateSha256===templateSha256&&held.planSha256===planSha256,'XERO_COURIER_ORIGINAL_CLAIM_REQUIRED');return lease('assert',held.lease);
        },
          assertLease: ({ lease: held }) => lease('assert', held),
          recordIntent: ({ lease: held, phase }) => { const v = { lease: held, state: phase, durable: true }; record(statePath(`${request.step}.${phase}`), { ...v, rawRequestJson: raw, requestSha256: hash(raw), ref, binding, maximumRefPushes: 1, maximumPublisherStatusPosts: 1, maximumHostPosts: 1, maximumSanitizedAckUploads: 1 }); return completed(v); },
          submit: async ({lease:held}) => {
            activeSubmission = request.step;
            await identity();
            const env = { PATH: runtime.env.PATH, HOME: runtime.env.HOME, GH_CONFIG_DIR: runtime.env.GH_CONFIG_DIR, GH_HOST: 'github.com', GH_REPO: REPOSITORY, GH_PROMPT_DISABLED: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'FCOS native recovery', GIT_AUTHOR_EMAIL: 'fcos-native@example.invalid', GIT_COMMITTER_NAME: 'FCOS native recovery', GIT_COMMITTER_EMAIL: 'fcos-native@example.invalid' };
            const git = (args, input) => String(runCommand('/usr/bin/git', args, { cwd, env, encoding: 'utf8', input })).trim();
            need(realpathSync(git(['rev-parse','--path-format=absolute','--git-common-dir']))===realpathSync(join(controlRoot,'.git')) && git(['rev-parse','--show-object-format'])==='sha1','XERO_COURIER_LOCAL_REPOSITORY_MISMATCH');
            const blob = git(['hash-object','-w','--stdin'], raw); need(SHA.test(blob) && blob === gitHash('blob', Buffer.from(raw)));
            const tree = git(['mktree'], `100644 blob ${blob}\trequest.json\n`); need(SHA.test(tree));
            commitSha = git(['commit-tree', tree], 'FCOS exact public recovery request\n'); need(SHA.test(commitSha));
            record(statePath(`${request.step}.publication`), { ref, commitSha, requestSha256: hash(raw), maximumAttempts: 1 });
            // Each consequential GitHub write has its OWN actual guard/intent,
            // asserting the original held financial lease; no second claim or
            // matching-lease adoption. The OUTER step guard below still requires
            // the actual HTTP artifact; publication ACKs cannot complete a step.
            const publication=courierPublicationStatus({templateJson,runId:binding.runId,ref,commitSha,raw,kind:'request'});
            const active=()=>need(now()>=t.issuedAt&&now()<t.notAfter&&!existsSync(statePath('stopped')),'XERO_COURIER_AUTHORITY_EXPIRED');
            const guardedPublication=async(phase,submit,validate)=>{
              const outcome=await runGuardedProviderWrite({expected,claim:()=>lease('assert',held),assertLease:()=>lease('assert',held),
                recordIntent:({lease:actual,phase:state})=>{const v={lease:actual,state,durable:true};record(statePath(`${request.step}.publication-${phase}.${state}`),{...v,publication:publication.binding,bindingSha256:publication.bindingSha256,maximumProviderWrites:1});return completed(v);},
                submit:async()=>{active();return submit();},validateProviderResult:validate,
                recordOutcome:({lease:actual,outcome:o})=>{const v={lease:actual,state:o.state,durable:true};record(statePath(`${request.step}.publication-${phase}.${o.state}`),{...v,reason:o.reason,bindingSha256:publication.bindingSha256});return completed(v);}});
              need(outcome.status==='submitted_acknowledged','XERO_COURIER_PUBLICATION_UNKNOWN');return outcome;
            };
            await guardedPublication('ref',()=>{git(['-c','credential.helper=','-c',`credential.https://github.com.helper=!${runtime.command} auth git-credential`,'push',`--force-with-lease=${ref}:`, `https://github.com/${REPOSITORY}.git`, `${commitSha}:${ref}`]);return completed({ref,commitSha,nativeRefPushCompleted:true});},
              value=>{try{const v=JSON.parse(value.output);return v.nativeRefPushCompleted===true&&v.ref===ref&&v.commitSha===commitSha;}catch{return false;}});
            // A missing/uncertain push returns above BEFORE this additional POST.
            // GitHub's authenticated creator is server metadata, never submitted.
            await guardedPublication('status',()=>{const output=gh(['api',publication.route,'--method','POST','--include','--input','-'],JSON.stringify(publication.body)),receipt=nativeGithubCreatedStatus(output,publication,now());
              record(statePath(`${request.step}.publication-status.provider-ack`),{...receipt,nativeCompleted:true,httpStatus:201,nativeOutputSha256:bytesHash(output)});return completed(receipt);},
              value=>{try{return JSON.parse(value.output).bindingSha256===publication.bindingSha256;}catch{return false;}});
            active();const end = Math.min(t.notAfter, now() + 120000);
            while (now() < end) { const ack = await acknowledgement(request, ref, commitSha, chain.checkpoint); if (ack) return completed(ack); await wait(10000); }
            throw refusal('XERO_COURIER_ACK_TIMEOUT_UNKNOWN');
          }, validateProviderResult: value => { try { return plain(JSON.parse(value.output)?.envelope); } catch { return false; } },
          recordOutcome: ({ lease: held, outcome }) => { const v = { lease: held, state: outcome.state, durable: true }; record(statePath(`${request.step}.${outcome.state}`), { ...v, reason: outcome.reason }); return completed(v); } });
        need(result.status === 'submitted_acknowledged', 'XERO_COURIER_REMOTE_OUTCOME_UNKNOWN');
        const ack = JSON.parse(result.providerResult.output);
        record(statePath(`${request.step}.ack`), ack); return { status: 'submitted_acknowledged', result: ack.result, artifactId: ack.artifactId };
      } catch (error) { if (!existsSync(statePath('stopped'))) record(statePath('stopped'), { readbackOnly: true, code: safeCode(error), requestSha256: hash(raw) }); throw refusal(safeCode(error)); }
    },
    async dispatchOwnerReadback(raw, admissionPath) {
      try {
      const request=parseCourierRequest(raw,t),fixed=join(stateDirectory,'root-owner-readback-admission.json');
      need(admissionPath===fixed&&!existsSync(statePath('owner-readback.attempt')),'XERO_COURIER_READBACK_ADMISSION_REQUIRED');
      const heldBytes=regular(statePath('held-lease')),held=JSON.parse(heldBytes),stoppedBytes=regular(statePath('stopped')),stopped=JSON.parse(stoppedBytes),uncertainBytes=regular(statePath(`${request.step}.uncertain`)),uncertain=JSON.parse(uncertainBytes),intent=JSON.parse(regular(statePath(`${request.step}.submitting`)));
      need(canonical(held.binding)===canonical(binding)&&held.templateSha256===templateSha256&&held.planSha256===planSha256&&stopped.readbackOnly===true&&stopped.requestSha256===hash(raw)
        &&uncertain.state==='uncertain'&&uncertain.durable===true&&canonical(uncertain.lease)===canonical(held.lease)&&intent.rawRequestJson===raw&&canonical(intent.lease)===canonical(held.lease),'XERO_COURIER_ORIGINAL_CLAIM_REQUIRED');
      const a=JSON.parse(regular(fixed,65536)),scope={currentExecutorThreadId:FEATURES_OWNER,historicalOwnerThreadId:plan.binding.ownerThreadId,capability:{maximumDispatchPosts:1,maximumHostGets:1,maximumHostPosts:0,maximumSanitizedAckUploads:1,originalOutcomeMayResolve:false},templateSha256,planSha256,binding,requestSha256:hash(raw),originalClaimSha256:bytesHash(heldBytes),originalStoppedSha256:bytesHash(stoppedBytes),originalUncertainSha256:bytesHash(uncertainBytes),sourcePins:nativeCourierSourcePins(),dispatchId:a.dispatchId,issuedAt:a.issuedAt,notAfter:a.notAfter};
      need(exact(a,['schemaVersion','kind','accepted','reviewerId','scope','scopeSha256','rootReview','independentReview','dispatchId','issuedAt','notAfter'])&&a.schemaVersion===1&&a.kind==='fcos_root_admitted_xero_owner_readback_dispatch_v1'&&a.accepted===true&&a.reviewerId==='/root'
        &&canonical(a.scope)===canonical(scope)&&a.scopeSha256===hash(canonical(scope)),'XERO_COURIER_READBACK_ADMISSION_REQUIRED');
      for(const [key,role]of [['rootReview','root'],['independentReview','independent']]){const ref=a[key];need(exact(ref,['path','sha256'])&&HASH.test(ref.sha256));const bytes=regular(ref.path,262144),r=JSON.parse(bytes);
        need(bytesHash(bytes)===ref.sha256&&r.kind==='fcos_actual_xero_owner_readback_dispatch_review_v1'&&r.accepted===true&&r.role===role&&r.scopeSha256===a.scopeSha256
          &&r.actualOriginalSuccessfulClaimReviewed===true&&r.actualStoppedUnknownOutcomeReviewed===true&&r.actualOriginalAuthorityAndReadbackScopeReviewed===true&&r.actualSharedCoordinationQuotaReviewed===true
          &&typeof r.reviewedAt==='string'&&Number.isFinite(Date.parse(r.reviewedAt))&&Date.parse(r.reviewedAt)>=a.issuedAt-30000&&Date.parse(r.reviewedAt)<=now()+30000&&now()-Date.parse(r.reviewedAt)<=300000
          &&(role==='root'?r.reviewerId==='/root':typeof r.reviewerId==='string'&&/^\/root\/[a-z0-9_]+(?:\/[a-z0-9_]+)*$/.test(r.reviewerId)&&r.reviewerId!=='/root/xero_host_actor_auth'&&!r.reviewerId.startsWith('/root/xero_host_actor_auth/')),'XERO_COURIER_READBACK_ADMISSION_REQUIRED');}
      const publicReadback={schemaVersion:1,kind:'fcos_xero_owner_readback_carrier_v1',templateSha256,planSha256,originalBinding:binding,requestSha256:scope.requestSha256,originalClaimSha256:scope.originalClaimSha256,originalStoppedSha256:scope.originalStoppedSha256,originalUncertainSha256:scope.originalUncertainSha256,admissionScopeSha256:a.scopeSha256,dispatchId:a.dispatchId,issuedAt:a.issuedAt,notAfter:a.notAfter};
      parseOwnerReadbackCarrier(JSON.stringify(publicReadback),parsed);need(now()>=a.issuedAt&&now()<a.notAfter,'XERO_COURIER_AUTHORITY_EXPIRED');
      // Native records prove original success/unknown only after real root and
      // independent provenance review. Matching lease alone is never adopted.
      record(statePath('owner-readback.attempt'),{scopeSha256:a.scopeSha256,readback:publicReadback,dispatchConsumed:true});
      activeSubmission='owner-readback';
      const outcome=await runGuardedProviderWrite({expected,claim:()=>lease('assert',held.lease),assertLease:({lease:current})=>lease('assert',current),
        recordIntent:({lease:current,phase})=>{const v={lease:current,state:phase,durable:true};record(statePath(`owner-readback.${phase}`),{...v,scopeSha256:a.scopeSha256,readback:publicReadback,maximumDispatchPosts:1,maximumHostGets:1,maximumHostPosts:0});return completed(v);},
        submit:async()=>{need(now()<a.notAfter,'XERO_COURIER_AUTHORITY_EXPIRED');const actual=await identity();need(actual.job.id===binding.jobId&&actual.run.status==='completed'&&actual.job.status==='completed','XERO_COURIER_RUN_MISMATCH');
          const currentRef=await read(`repos/${REPOSITORY}/git/ref/${t.caller.ref.slice(5)}`);need(currentRef.ref===t.caller.ref&&currentRef.object?.type==='commit'&&currentRef.object.sha===t.caller.sha,'XERO_COURIER_RUN_MISMATCH');
          const inputs={xero_recovery_mode:'owner-readback',xero_recovery_template_base64:Buffer.from(templateJson).toString('base64'),xero_recovery_readback_base64:Buffer.from(JSON.stringify(publicReadback)).toString('base64')};need(Buffer.byteLength(JSON.stringify(inputs))<=60000);
          need(now()<a.notAfter,'XERO_COURIER_AUTHORITY_EXPIRED');const output=String(gh(['api',`repos/${REPOSITORY}/actions/workflows/authenticated-release.yml/dispatches`,'--method','POST','--include','--input','-'],JSON.stringify({ref:t.caller.ref.slice(11),inputs})));
          need(/^HTTP\/[0-9.]+ 204(?: |\r?\n)/.test(output)&&!/^HTTP\/[0-9.]+ (?!204)[0-9]{3}/m.test(output),'XERO_COURIER_READBACK_DISPATCH_UNKNOWN');return completed({dispatchAccepted:true,scopeSha256:a.scopeSha256,providerCompletionProven:false});},
        validateProviderResult:r=>{try{return JSON.parse(r.output).dispatchAccepted===true;}catch{return false;}},recordOutcome:({lease:current,outcome:o})=>{const v={lease:current,state:o.state,durable:true};record(statePath(`owner-readback.${o.state}`),{...v,reason:o.reason});return completed(v);}});
      need(outcome.status==='submitted_acknowledged','XERO_COURIER_READBACK_DISPATCH_UNKNOWN');return{status:'owner_readback_dispatched_result_pending',dispatchId:a.dispatchId,originalOutcomeResolved:false,retryable:false};
      }catch(error){throw refusal(safeCode(error));}
    },
    async ownerReadbackResult(raw,readerRunId,readerJobId) {
      try {
      const request=parseCourierRequest(raw,t),attempt=JSON.parse(regular(statePath('owner-readback.attempt'))),r=parseOwnerReadbackCarrier(JSON.stringify(attempt.readback),parsed);
      need(request&&r.requestSha256===hash(raw)&&existsSync(statePath('owner-readback.submitting'))&&typeof readerRunId==='string'&&/^[1-9][0-9]{0,19}$/.test(readerRunId)&&Number.isSafeInteger(Number(readerRunId))&&readerRunId!==binding.runId&&Number.isSafeInteger(readerJobId)&&readerJobId>0,'XERO_COURIER_ORIGINAL_CLAIM_REQUIRED');
      const u=await read('user');need(u.id===ACTOR_ID&&u.login==='hocheunglai-oss');const actual=await assertCourierRun(read,t,readerRunId,{allowCompleted:true});need(actual.job.id===readerJobId,'XERO_COURIER_RUN_MISMATCH');
      const list=await read(`repos/${REPOSITORY}/actions/runs/${readerRunId}/artifacts?per_page=100`);need(Array.isArray(list.artifacts)&&list.total_count===list.artifacts.length&&list.artifacts.length<=100);
      const matches=list.artifacts.filter(v=>v.name===ownerReadbackArtifactName(binding.runId,readerRunId,op));need(matches.length<=1);if(!matches.length)return{status:'unknown_owner_readback_required',originalOutcomeResolved:false,retryable:false};
      const a=matches[0];need(Number.isSafeInteger(a.id)&&a.expired===false&&a.workflow_run?.id===Number(readerRunId)&&a.workflow_run.head_sha===t.caller.sha&&a.workflow_run.repository_id===REPO_ID&&a.workflow_run.head_repository_id===REPO_ID&&/^sha256:[a-f0-9]{64}$/.test(a.digest)&&a.size_in_bytes>0&&a.size_in_bytes<=131072
        &&Date.parse(a.created_at)>=Date.parse(actual.job.started_at)&&Date.parse(a.created_at)<=now()+30000,'XERO_COURIER_READBACK_RESULT_INVALID');await reserveGet();const archive=gh(['api',`repos/${REPOSITORY}/actions/artifacts/${a.id}/zip`,'--method','GET'],undefined,true);
      need(Buffer.isBuffer(archive)&&archive.length===a.size_in_bytes&&`sha256:${bytesHash(archive)}`===a.digest,'XERO_COURIER_READBACK_RESULT_INVALID');const envelope=decodeRuntimeMaterialArchive(archive),result=assertOwnerReadbackAck(envelope,{parsed,readback:r,readerRunId,readerJobId,now:now()});
      return{status:result.state==='submitted_unknown'?'unknown_owner_readback_required':'durable_owner_readback_observed_no_replay',result,originalOutcomeResolved:false,retryable:false};
      }catch(error){throw refusal(safeCode(error));}
    },
    async readback(raw) {
      const r = parseCourierRequest(raw, t); need(existsSync(statePath(`${r.step}.publication`)), 'XERO_COURIER_ORIGINAL_PUBLICATION_REQUIRED');
      const p = JSON.parse(regular(statePath(`${r.step}.publication`))); need(p.requestSha256 === hash(raw));
      await identity();const ack = await acknowledgement(r, p.ref, p.commitSha, lineage().checkpoint);
      return ack ? { status: 'original_actual_ack_observed_no_replay', ...ack } : { status: 'unknown_owner_readback_required', retryable: false };
    }
  });
}
export async function nativeRelayMain(args = process.argv.slice(2)) {
  try {
    if ((args.length === 2 && args[0] === 'original-warm-dispatch') || (args.length === 3 && args[0] === 'original-warm-run')) {
      const warm = await createNativeXeroRecoveryWarmDispatcher({ templateJson: regular(resolve(args[1]), 65536).toString('utf8') });
      return args[0] === 'original-warm-dispatch' ? await warm.dispatch() : await warm.observeRun(args[2]);
    }
    need((args.length===4&&['submit','readback'].includes(args[0]))||(args.length===5&&args[0]==='owner-readback-dispatch')||(args.length===6&&args[0]==='owner-readback-result'),'XERO_COURIER_MODE_REQUIRED');
    const input = JSON.parse(regular(resolve(args[1]))), raw = regular(resolve(args[2]), 2048).toString('utf8');
    need(exact(input, ['templateJson','binding'])); const relay = await createNativeXeroRecoveryRelay({ ...input, stateDirectory: resolve(args[3]) });
    if(args[0]==='owner-readback-dispatch')return await relay.dispatchOwnerReadback(raw,resolve(args[4]));
    if(args[0]==='owner-readback-result')return await relay.ownerReadbackResult(raw,args[4],Number(args[5]));
    return await relay[args[0]](raw);
  } catch (e) { throw refusal(safeCode(e)); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) nativeRelayMain().then(r => process.stdout.write(JSON.stringify(r) + '\n')).catch(e => { process.stderr.write(safeCode(e) + '\n'); process.exitCode = 1; });
