import { execFileSync } from 'node:child_process';
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FCOS_CONNECTION_POLICY, fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { loadReviewedSalesforcePlan } from './deploy-salesforce-reviewed-manifest.mjs';
import { githubConfigDirectory } from './fcos-connections.mjs';
import { assertAuthorization, canonical, digest, git, isDigest, requireCondition, sourceSnapshot, targets, validateManifest } from './lib/rapid-release/contract.mjs';
import { assertPublicPayload, DeploymentJournal } from './lib/rapid-release/journal.mjs';
import { LOCAL_MIRROR_ENVIRONMENT, readLocalMirrorDeployments, readLocalMirrorStage, recordLocalMirrorDeployment } from './lib/rapid-release/local-mirror-handoff.mjs';
import { assertFrozenWorkflow, assertPermanentHandover, nativeWorkflowPath } from './lib/rapid-release/providers.mjs';
import { assertEditorDesktopReview, createDeveeDesktopReceipt, DEVEE_DESKTOP_RECEIPT_KIND, DEVEE_DESKTOP_WORKFLOW,
  editorDesktopCaseSetDigest, requireDeveeDesktopApprovalRecord, verifyDeveeDesktopReceipt, verifyDeveeDesktopRequest }
  from './lib/rapid-release/salesforce-devee-desktop-checkpoint.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const base = '/repos/' + targets().repository;
const salesforce = FCOS_CONNECTION_POLICY.providers.find(provider => provider.id === 'salesforce');
const ownerId = salesforce.publication.requiredAccountId;
const botId = 41898282;
const repoId = 1278654816;
const deveeOrgId = fcosSalesforceEnvironment('devee').orgId;
const positive = id => Number.isSafeInteger(id) && id > 0;
const salesforceJobId = /^0Af[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/u;
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));

function syncDirectory(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function loadIntent(file, expected) {
  let fd;
  try { fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  try {
    const info = fstatSync(fd);
    requireCondition(info.isFile() && info.size <= 32_768 && (info.mode & 0o077) === 0
      && info.uid === process.getuid(), 'DEVEE_DESKTOP_OPERATOR_INTENT_UNSAFE');
    requireCondition(readFileSync(fd, 'utf8') === expected, 'DEVEE_DESKTOP_OPERATOR_INTENT_CHANGED');
    return true;
  } finally { closeSync(fd); }
}

function claimIntent(directory, file, bytes) {
  mkdirSync(directory, { mode: 0o700, recursive: true });
  const info = lstatSync(directory);
  requireCondition(info.isDirectory() && info.uid === process.getuid() && (info.mode & 0o077) === 0,
    'DEVEE_DESKTOP_OPERATOR_INTENT_UNSAFE');
  let fd;
  try { fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    requireCondition(loadIntent(file, bytes), 'DEVEE_DESKTOP_OPERATOR_INTENT_CHANGED');
    return false;
  }
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  syncDirectory(directory);
  syncDirectory(dirname(directory));
  return true;
}

function requireRun(run, request, manifest) {
  requireCondition(run?.id === request.runId && run.run_attempt === request.runAttempt && run.repository?.id === repoId
    && run.repository?.full_name === targets().repository && run.actor?.id === ownerId && run.actor?.login === targets().account
    && run.head_branch === 'main' && run.head_sha === request.dispatcherSha && run.event === 'workflow_dispatch'
    && nativeWorkflowPath(run) === DEVEE_DESKTOP_WORKFLOW
    && ['release', 'resume'].some(mode => run.display_title === `FCOS rapid ${mode} ${request.manifestHash} ${manifest.candidate.sha}`),
  'DEVEE_DESKTOP_OPERATOR_RUN_MISMATCH');
}

async function requireActiveApproval({ github, runPath, run, request, requestDeployment, manifest, chain, now }) {
  const [environment, reviews, jobs, enabled, pointer] = await Promise.all([
    github.read(base + '/environments/fcos-production-release'), github.read(runPath + '/approvals'),
    github.read(runPath + '/attempts/' + request.runAttempt + '/jobs?per_page=100'),
    github.read(base + '/actions/variables/FCOS_RAPID_RELEASE_ENABLED'), github.read(base + '/actions/variables/FCOS_RAPID_RELEASE_HANDOVER_ID'),
  ]);
  requireCondition(run.status === 'in_progress'
    && environment.name === 'fcos-production-release' && positive(environment.id) && environment.can_admins_bypass === false
    && environment.protection_rules?.some(rule => rule.type === 'required_reviewers'
      && rule.reviewers?.some(row => row.reviewer?.id === ownerId && row.reviewer.login === targets().account))
    && Array.isArray(reviews) && reviews.some(row => row.state === 'approved' && row.user?.id === ownerId && row.user.login === targets().account
      && row.environments?.some(item => item.id === environment.id && item.name === environment.name))
    && enabled.value === 'true' && /^[1-9][0-9]*$/u.test(pointer.value) && positive(Number(pointer.value)),
  'DEVEE_DESKTOP_OPERATOR_NATIVE_APPROVAL_REQUIRED');
  const handover = await github.read(base + '/deployments/' + pointer.value);
  requireCondition(handover.id === Number(pointer.value) && handover.creator?.id === ownerId, 'DEVEE_DESKTOP_OPERATOR_HANDOVER_MISMATCH');
  const permanent = assertPermanentHandover(handover, manifest, ownerId);
  const frozenHandover = await github.read(`${base}/contents/${permanent.nativeReview.workflowPath}?ref=${manifest.controllerSha}`);
  requireCondition(frozenHandover.type === 'file' && frozenHandover.sha === permanent.nativeReview.workflowBlobSha,
    'DEVEE_DESKTOP_OPERATOR_HANDOVER_MISMATCH');
  const stage = chain.find(row => row.payload.event === 'stage.result');
  const staged = readLocalMirrorStage(stage, { manifest, handover: permanent, workflowActorId: botId });
  const saved = requireDeveeDesktopApprovalRecord({ chain, request, requestDeployment, jobs });
  assertAuthorization(saved.payload.data, manifest, staged, now());
}

export async function publishDeveeDesktopEvidence({ github, manifest, reviewed, report, runId, runAttempt, requestId,
  intentDirectory, readbackOnly = false, now = Date.now }) {
  const manifestHash = validateManifest(manifest);
  const plan = manifest.prerequisites?.plan;
  assertEditorDesktopReview(reviewed.review, reviewed.manifest, reviewed.nativeInventories);
  requireCondition(positive(runId) && runAttempt === 1 && positive(requestId) && typeof intentDirectory === 'string' && isAbsolute(intentDirectory)
    && github.candidateSha === manifest.candidate.sha && manifest.selection.salesforce && !manifest.selection.database
    && manifest.prerequisites.adapter === 'salesforce-reviewed-manifest' && plan.mirrorPublication === 'local-collaborator'
    && reviewed.review.nativeDeveeDesktop?.caseSetDigest === editorDesktopCaseSetDigest
    && plan.deveeDesktopCaseSetDigest === editorDesktopCaseSetDigest && plan.salesforceFingerprint === reviewed.fingerprint
    && plan.salesforceSourceTreeHash === reviewed.binding.sourceTreeHash && reviewed.binding.orgIds.devee === deveeOrgId,
  'DEVEE_DESKTOP_OPERATOR_REVIEW_SCOPE_INVALID');
  assertPublicPayload(report);
  const [owner, repository] = await Promise.all([github.read('/user'), github.read(base)]);
  requireCondition(owner?.id === ownerId && owner.login === targets().account && repository?.id === repoId
    && repository.full_name === targets().repository && repository.owner?.id === ownerId && repository.default_branch === 'main'
    && repository.permissions?.admin === true && !repository.archived, 'DEVEE_DESKTOP_OPERATOR_IDENTITY_MISMATCH');
  const runPath = base + '/actions/runs/' + runId;
  const journal = new DeploymentJournal({ github, releaseId: manifest.releaseId, manifestHash, actorIds: [botId, ownerId] });
  const [requestDeployment, run, chain] = await Promise.all([
    github.read(base + '/deployments/' + requestId), github.read(runPath + '/attempts/' + runAttempt), journal.read(),
  ]);
  const request = requestDeployment?.payload;
  requireCondition(requestDeployment?.id === requestId && request?.runId === runId && request.runAttempt === runAttempt
    && request.releaseId === manifest.releaseId && request.manifestHash === manifestHash && request.candidateSha === manifest.candidate.sha
    && request.controllerSha === manifest.controllerSha && request.repositoryId === repoId && request.orgId === deveeOrgId
    && request.workflowPath === DEVEE_DESKTOP_WORKFLOW && request.caseSetDigest === editorDesktopCaseSetDigest
    && request.fingerprint === reviewed.fingerprint && request.sourceTreeHash === reviewed.binding.sourceTreeHash
    && request.inventoryHash === reviewed.nativeInventories.devee.final.inventoryHash
    && [request.inventoryHash, request.installedInventoryHash, request.inventoryReceiptDigest].every(isDigest),
  'DEVEE_DESKTOP_OPERATOR_REQUEST_MISMATCH');
  requireRun(run, request, manifest);
  const workflow = await assertFrozenWorkflow({ github, controllerSha: manifest.controllerSha, dispatcherSha: run.head_sha });
  requireCondition(request.workflowBlobSha === workflow.blobSha, 'DEVEE_DESKTOP_OPERATOR_WORKFLOW_MISMATCH');
  const event = chain.find(row => row.creator?.id === botId && row.payload.event === 'prerequisites.intent');
  const checkpoints = chain.filter(row => row.creator?.id === botId && row.payload.event === 'salesforce.checkpoint'
    && row.payload.data.fingerprint === request.fingerprint && row.payload.data.stage === 'devee'
    && Date.parse(row.created_at) <= Date.parse(requestDeployment.created_at));
  const validation = checkpoints.findLast(row => row.payload.data.operation === 'validation');
  const deployment = checkpoints.findLast(row => row.payload.data.operation === 'deployment');
  const valid = validation?.payload.data, deployed = deployment?.payload.data;
  const prerequisite = { planDigest: digest(manifest.prerequisites), candidateSha: request.candidateSha };
  requireCondition(event?.payload.data.operationId === manifest.releaseId + '-prerequisites'
    && event.payload.data.requestHash === digest(prerequisite) && digest(event.payload.data.request ?? null) === digest(prerequisite)
    && valid?.outcome === 'resolved' && valid.job?.id === request.validationJobId && valid.job.validationId === null
    && deployed?.outcome === 'resolved' && deployed.job?.id === request.deploymentJobId && deployed.job.validationId === request.validationJobId
    && [request.validationJobId, request.deploymentJobId].every(id => salesforceJobId.test(id))
    && request.validationJobId !== request.deploymentJobId && event.payload.sequence < validation.payload.sequence
    && validation.payload.sequence < deployment.payload.sequence && Date.parse(report.startedAt) >= Date.parse(requestDeployment.created_at)
    && Date.parse(report.verifiedAt) <= now(), 'DEVEE_DESKTOP_OPERATOR_ORIGINAL_JOB_OR_REPORT_REQUIRED');
  const payload = createDeveeDesktopReceipt({ request, requestId, report });
  requireCondition(canonical(payload.proof) === canonical(report), 'DEVEE_DESKTOP_OPERATOR_REPORT_SCOPE_INVALID');
  const body = { ref: request.candidateSha, task: 'fcos-local-mirror-handoff', auto_merge: false, required_contexts: [],
    environment: LOCAL_MIRROR_ENVIRONMENT, production_environment: false, transient_environment: false, payload };
  const endpoint = base + '/deployments';
  const file = join(intentDirectory, repoId + '-' + requestId + '.json');
  const bytes = canonical({ schemaVersion: 1, kind: 'fcos_devee_desktop_operator_intent', endpoint, body }) + '\n';
  const existingIntent = loadIntent(file, bytes);

  const recover = async () => {
    const rows = await readLocalMirrorDeployments(github, request.candidateSha);
    const matching = rows.filter(row => row.creator?.id === ownerId && row.payload?.kind === DEVEE_DESKTOP_RECEIPT_KIND
      && row.payload.requestId === requestId);
    requireCondition(matching.length <= 1, 'DEVEE_DESKTOP_OPERATOR_RECEIPT_DUPLICATE');
    if (!matching.length) return;
    const row = matching[0];
    requireCondition(Date.parse(row.created_at) <= now() && digest(row.payload) === digest(payload),
      'DEVEE_DESKTOP_OPERATOR_RECEIPT_CHANGED');
    // A historical receipt is useful readback only, including after the request has expired.
    return verifyDeveeDesktopReceipt({ request, requestDeployment, receiptDeployment: row, environment: LOCAL_MIRROR_ENVIRONMENT,
      now: Date.parse(row.created_at) });
  };
  const recovered = await recover();
  if (recovered) return { mode: 'readback', runId, runAttempt, ...recovered };
  requireCondition(!readbackOnly && !existingIntent, 'DEVEE_DESKTOP_OPERATOR_RECEIPT_ACK_UNCERTAIN');
  verifyDeveeDesktopRequest({ request, requestDeployment, environment: LOCAL_MIRROR_ENVIRONMENT, now: now() });
  await requireActiveApproval({ github, runPath, run, request, requestDeployment, manifest, chain, now });
  await journal.assertNoUnresolvedOtherRelease();
  if (!claimIntent(intentDirectory, file, bytes)) {
    const receipt = await recover();
    requireCondition(receipt, 'DEVEE_DESKTOP_OPERATOR_RECEIPT_ACK_UNCERTAIN');
    return { mode: 'readback', runId, runAttempt, ...receipt };
  }
  const current = await github.read(runPath);
  requireRun(current, request, manifest);
  requireCondition(current.status === 'in_progress', 'DEVEE_DESKTOP_OPERATOR_NATIVE_APPROVAL_REQUIRED');
  let submitted = false, preSubmissionError;
  const writer = { ...github, write(path, value) {
    try {
      requireCondition(path === endpoint && canonical(value) === canonical(body), 'DEVEE_DESKTOP_OPERATOR_WRITE_SCOPE_INVALID');
      verifyDeveeDesktopRequest({ request, requestDeployment, environment: LOCAL_MIRROR_ENVIRONMENT, now: now() });
      requireCondition(now() >= Math.ceil(Date.parse(report.verifiedAt) / 1000) * 1000, 'DEVEE_DESKTOP_OPERATOR_RECEIPT_TIME_INVALID');
    } catch (error) {
      preSubmissionError = error;
      throw error;
    }
    submitted = true;
    return github.write(path, value);
  } };
  try {
    await recordLocalMirrorDeployment({ github: writer, candidateSha: request.candidateSha, actorId: ownerId, payload });
  } catch {
    // Leave the create-once local intent in place. Only a matching native readback can resolve it.
  }
  const receipt = await recover();
  if (!receipt && preSubmissionError) throw preSubmissionError;
  requireCondition(receipt, 'DEVEE_DESKTOP_OPERATOR_RECEIPT_ACK_UNCERTAIN');
  return { mode: submitted ? 'recorded' : 'readback', runId, runAttempt, ...receipt };
}

function operatorGitHub(candidateSha) {
  const env = { ...process.env, GH_CONFIG_DIR: githubConfigDirectory({ repoRoot: root }), GH_HOST: 'github.com',
    GH_REPO: 'github.com/' + targets().repository, GH_PROMPT_DISABLED: '1' };
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) delete env[name];
  const api = (args, body) => JSON.parse(execFileSync('gh', ['api', ...args], {
    env, input: body && JSON.stringify(body), encoding: 'utf8', timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024, stdio: [body ? 'pipe' : 'ignore', 'pipe', 'ignore'],
  }));
  return { candidateSha, read: path => api([path]), pages: path => api(['--paginate', '--slurp', path]).flat(),
    write: (path, body) => api([path, '--method', 'POST', '--input', '-'], body) };
}

function assertFrozenOperatorSource(controllerSha) {
  const head = git(root, ['rev-parse', 'HEAD']);
  requireCondition(!git(root, ['status', '--porcelain', '--untracked-files=normal']), 'DEVEE_DESKTOP_OPERATOR_CONTROLLER_MISMATCH');
  if (head === controllerSha) return;
  // The local-only operator may be installed as a direct child of the frozen controller.
  const operatorPaths = ['scripts/rapid-release-devee-desktop.mjs', 'tests/rapidReleaseDeveeDesktopOperator.test.js'];
  requireCondition(git(root, ['rev-list', '--parents', '-n', '1', head]) === head + ' ' + controllerSha
    && git(root, ['diff', '--name-only', controllerSha, head]) === operatorPaths.join('\n'),
  'DEVEE_DESKTOP_OPERATOR_CONTROLLER_MISMATCH');
}

async function main() {
  const [manifestFile, candidateDirectory, run, attempt, request, reportFile, flag, ...extra] = process.argv.slice(2);
  requireCondition(manifestFile && candidateDirectory && reportFile && [run, attempt, request].every(value => /^[1-9][0-9]*$/u.test(value || ''))
    && (flag === undefined || flag === '--readback') && !extra.length, 'USAGE_MANIFEST_CANDIDATE_RUN_ATTEMPT_REQUEST_REPORT_OPTIONAL_READBACK');
  requireCondition(process.env.GITHUB_ACTIONS !== 'true', 'DEVEE_DESKTOP_OPERATOR_LOCAL_HOST_REQUIRED');
  const manifest = readJson(manifestFile), report = readJson(reportFile);
  validateManifest(manifest);
  const plan = manifest.prerequisites?.plan;
  assertFrozenOperatorSource(manifest.controllerSha);
  const cwd = resolve(candidateDirectory);
  const { sha, sourceDigest, lockDigest } = sourceSnapshot(cwd);
  requireCondition(canonical({ sha, sourceDigest, lockDigest }) === canonical(manifest.candidate), 'DEVEE_DESKTOP_OPERATOR_CANDIDATE_MISMATCH');
  const reviewed = loadReviewedSalesforcePlan({ cwd, policy: salesforce, manifestPath: plan?.salesforceManifestPath, reviewPath: plan?.salesforceReviewPath });
  const intentDirectory = join(dirname(githubConfigDirectory({ repoRoot: root })), 'rapid-devee-desktop-receipts');
  const result = await publishDeveeDesktopEvidence({ github: operatorGitHub(sha), manifest, reviewed, report, runId: Number(run),
    runAttempt: Number(attempt), requestId: Number(request), intentDirectory, readbackOnly: flag === '--readback' });
  process.stdout.write(JSON.stringify(result) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  const message = /^[A-Z][A-Z0-9_]+$/u.test(error.message) ? error.message : 'DEVEE_DESKTOP_OPERATOR_STOPPED';
  process.stderr.write(message + '\n');
  process.exitCode = 1;
});
