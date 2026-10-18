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
const ROOT = '/Users/vincex/Documents/FCOS';
const REPO_ID = 1278654816, ACTOR_ID = 265701760;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/, SHA = /^[a-f0-9]{40}$/, HASH = /^[a-f0-9]{64}$/;
const WRITE_GUARD_SHA = '5818b554b94d92aed796abbc3ea20ce4fdbbd821762ebfef8c6cb635e77b7c7f';
const plain = v => v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
export const exact = (v, keys) => plain(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
export const refusal = code => Object.assign(new Error(code), { code });
export const need = (v, code = 'XERO_COURIER_REFUSED') => { if (!v) throw refusal(code); };
const SAFE_CODES = new Set(['XERO_COURIER_LOCAL_REPOSITORY_MISMATCH','XERO_COURIER_PACKAGE_BUILD_REFUSED','XERO_COURIER_CANONICAL_STATE_REQUIRED','XERO_COURIER_ROOT_ADMISSION_REQUIRED','XERO_COURIER_ORIGINAL_CLAIM_REQUIRED','XERO_COURIER_SOURCE_BYTES_UNPROVEN','XERO_COURIER_OIDC_INVALID','XERO_COURIER_AUTHORITY_EXPIRED','XERO_COURIER_CONSUMED_GET_ONLY','XERO_COURIER_REMOTE_OUTCOME_UNKNOWN','XERO_COURIER_ACK_TIMEOUT_UNKNOWN','XERO_COURIER_NATIVE_COMMAND_UNKNOWN','XERO_COURIER_GITHUB_READ_UNKNOWN','XERO_COURIER_HTTP_OUTCOME_UNKNOWN','XERO_COURIER_CAPTURE_UNKNOWN','XERO_COURIER_RUN_MISMATCH','XERO_COURIER_REQUEST_INVALID','XERO_COURIER_TEMPLATE_INVALID','XERO_COURIER_NONCE_REQUIRED','XERO_COURIER_ACK_MISMATCH','XERO_COURIER_RESULT_MISMATCH']);
export const safeCode = e => { try { return SAFE_CODES.has(e?.code) ? e.code : 'XERO_COURIER_STOPPED_OWNER_READBACK_REQUIRED'; } catch { return 'XERO_COURIER_STOPPED_OWNER_READBACK_REQUIRED'; } };
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
// The actual accepted Python class owns its OS mutex and persistent lease. The
// current historical class statically rejects Features for reconciliation; that
// is an explicit setup dependency, never a reason to use production/old owner.
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
if g['sha256']!='24758c4191afae79fa4b149a166c450ac1cac20951a5f648f3cc3853969aa31d' or hashlib.sha256(source).hexdigest()!=g['sha256'] or not g['localCoordinationGuardAccepted'] or g['independentReviewPending'] or g['providerAuthority']: raise ValueError('guard')
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
export function nativeCourierSourcePins(){return Object.fromEntries(['scripts/lib/hosted-release/xero-recovery-native-relay.mjs','scripts/hosted-xero-recovery-carrier.mjs','.github/workflows/hosted-xero-recovery-carrier.yml','scripts/lib/guarded-provider-write.mjs'].map(p=>[p,bytesHash(regular(fileURLToPath(new URL('../../../'+p,import.meta.url))))]));}
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
    && r.originalHumanAuthorityProvenanceReviewed===true && r.actualDeploymentSourceProvenanceReviewed===true && r.actualSharedCoordinationQuotaReviewed===true
    && (role==='root'?r.reviewerId==='/root':typeof r.reviewerId==='string'&&/^\/root\/[a-z0-9_]+(?:\/[a-z0-9_]+)*$/.test(r.reviewerId)&&r.reviewerId!=='/root/xero_host_actor_auth'&&!r.reviewerId.startsWith('/root/xero_host_actor_auth/')),'XERO_COURIER_ROOT_ADMISSION_REQUIRED');}
  const q=documents.coordinationQuota;need(q?.kind==='fcos_actual_xero_courier_shared_get_quota_v1' && q.accepted===true && q.repository===REPOSITORY && q.nativeGetsPerMinute===20 && q.carrierGetsPerMinute===20 && q.sharedMaximum===45 && q.maximumConcurrentClients===2 && q.actualSharedPreflightReviewed===true,'XERO_COURIER_ROOT_ADMISSION_REQUIRED');
  return a;
}
export async function createNativeXeroRecoveryRelay({ templateJson, binding, stateDirectory, cwd = process.cwd(), capture, now = Date.now, controlRoot = ROOT, wait = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const parsed = parseCourierTemplate(templateJson), { template: t, templateSha256, plan, planSha256 } = parsed;
  need(exact(binding, ['runId','jobId','hostOrigin','deploymentId','rootAdmissionSha256']) && /^[1-9][0-9]{0,19}$/.test(binding.runId)
    && Number.isSafeInteger(binding.jobId) && binding.jobId > 0 && /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(binding.hostOrigin)
    && /^dpl_[A-Za-z0-9]+$/.test(binding.deploymentId) && HASH.test(binding.rootAdmissionSha256));
  need(typeof now === 'function' && typeof wait === 'function');
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
    if (!r || Object.hasOwn(r, 'session_id')) nativeFailure('missing_or_pending_result');
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
  let runtime;
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
          recordIntent: ({ lease: held, phase }) => { const v = { lease: held, state: phase, durable: true }; record(statePath(`${request.step}.${phase}`), { ...v, rawRequestJson: raw, requestSha256: hash(raw), ref, binding, maximumRefPushes: 1, maximumHostPosts: 1, maximumSanitizedAckUploads: 1 }); return completed(v); },
          submit: async () => {
            activeSubmission = request.step;
            await identity();
            const env = { PATH: runtime.env.PATH, HOME: runtime.env.HOME, GH_CONFIG_DIR: runtime.env.GH_CONFIG_DIR, GH_HOST: 'github.com', GH_REPO: REPOSITORY, GH_PROMPT_DISABLED: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'FCOS native recovery', GIT_AUTHOR_EMAIL: 'fcos-native@example.invalid', GIT_COMMITTER_NAME: 'FCOS native recovery', GIT_COMMITTER_EMAIL: 'fcos-native@example.invalid' };
            const git = (args, input) => String(runCommand('/usr/bin/git', args, { cwd, env, encoding: 'utf8', input })).trim();
            need(realpathSync(git(['rev-parse','--path-format=absolute','--git-common-dir']))===realpathSync(join(controlRoot,'.git')) && git(['rev-parse','--show-object-format'])==='sha1','XERO_COURIER_LOCAL_REPOSITORY_MISMATCH');
            const blob = git(['hash-object','-w','--stdin'], raw); need(SHA.test(blob) && blob === gitHash('blob', Buffer.from(raw)));
            const tree = git(['mktree'], `100644 blob ${blob}\trequest.json\n`); need(SHA.test(tree));
            commitSha = git(['commit-tree', tree], 'FCOS exact public recovery request\n'); need(SHA.test(commitSha));
            record(statePath(`${request.step}.publication`), { ref, commitSha, requestSha256: hash(raw), maximumAttempts: 1 });
            // Exactly one create-only remote ref push; never delete/update it.
            need(now() < t.notAfter && !existsSync(statePath('stopped')), 'XERO_COURIER_AUTHORITY_EXPIRED');
            git(['-c','credential.helper=','-c',`credential.https://github.com.helper=!${runtime.command} auth git-credential`,'push',`--force-with-lease=${ref}:`, `https://github.com/${REPOSITORY}.git`, `${commitSha}:${ref}`]);
            const end = Math.min(t.notAfter, now() + 120000);
            while (now() < end) { const ack = await acknowledgement(request, ref, commitSha, chain.checkpoint); if (ack) return completed(ack); await wait(10000); }
            throw refusal('XERO_COURIER_ACK_TIMEOUT_UNKNOWN');
          }, validateProviderResult: value => { try { return plain(JSON.parse(value.output)?.envelope); } catch { return false; } },
          recordOutcome: ({ lease: held, outcome }) => { const v = { lease: held, state: outcome.state, durable: true }; record(statePath(`${request.step}.${outcome.state}`), { ...v, reason: outcome.reason }); return completed(v); } });
        need(result.status === 'submitted_acknowledged', 'XERO_COURIER_REMOTE_OUTCOME_UNKNOWN');
        const ack = JSON.parse(result.providerResult.output);
        record(statePath(`${request.step}.ack`), ack); return { status: 'submitted_acknowledged', result: ack.result, artifactId: ack.artifactId };
      } catch (error) { if (!existsSync(statePath('stopped'))) record(statePath('stopped'), { readbackOnly: true, code: safeCode(error), requestSha256: hash(raw) }); throw refusal(safeCode(error)); }
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
    need(args.length === 4 && ['submit','readback'].includes(args[0]), 'XERO_COURIER_MODE_REQUIRED');
    const input = JSON.parse(regular(resolve(args[1]))), raw = regular(resolve(args[2]), 2048).toString('utf8');
    need(exact(input, ['templateJson','binding'])); const relay = await createNativeXeroRecoveryRelay({ ...input, stateDirectory: resolve(args[3]) });
    return await relay[args[0]](raw);
  } catch (e) { throw refusal(safeCode(e)); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) nativeRelayMain().then(r => process.stdout.write(JSON.stringify(r) + '\n')).catch(e => { process.stderr.write(safeCode(e) + '\n'); process.exitCode = 1; });
