import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FCOS_CONNECTION_POLICY, fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { cliSalesforceProvider, loadReviewedSalesforcePlan } from './deploy-salesforce-reviewed-manifest.mjs';
import { githubConfigDirectory } from './fcos-connections.mjs';
import { executeSharedMirror } from './sync-salesforce-shared-repository.mjs';
import { reviewedDeveePublicationProof } from './sync-salesforce-reviewed-repository.mjs';
import { verifySalesforceReviewSource } from './verify-salesforce-review-source.mjs';
import { assertReviewedMirror } from './lib/salesforce-reviewed-release.mjs';
import { assertAuthorization, digest, isSha, requireCondition, targets, validateManifest } from './lib/rapid-release/contract.mjs';
import { assertBuildReceipt, assertSmokeProof } from './lib/rapid-release/engine.mjs';
import { DeploymentJournal, pendingOperations } from './lib/rapid-release/journal.mjs';
import { readLocalMirrorDeployments, verifyLocalMirrorReceipt } from './lib/rapid-release/local-mirror-handoff.mjs';
import { assertFrozenWorkflow, nativeWorkflowPath } from './lib/rapid-release/providers.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const policy = FCOS_CONNECTION_POLICY.providers.find(provider => provider.id === 'salesforce');
const repositoryId = 1278654816;
const ownerId = policy.publication.requiredAccountId;
const botId = 41898282;
const environmentId = 23178773471;
const environmentName = 'fcos-production-release';
const promotionOrder = 'devee-mirror-qat-production';
const workflow = '.github/workflows/fcos-rapid-release.yml';
const allow = (value, code) => requireCondition(value, 'REVIEWED_SOURCE_ANCHOR_' + code);
const owner = actor => actor?.id === ownerId && actor.login === targets().account;
const data = row => row.payload.data;
const sequence = row => row.payload.sequence;

export function assertStandardReviewedSourceManifest(manifest, candidate) {
  const hash = validateManifest(manifest);
  allow(isSha(candidate) && manifest.candidate.sha === candidate && manifest.selection.salesforce === true
    && manifest.selection.database === false && manifest.prerequisites?.adapter === 'salesforce-reviewed-manifest'
    && manifest.prerequisites.plan?.mirrorPublication === 'local-collaborator'
    && !manifest.prerequisites.plan.deferSchemaDependentSmoke, 'MANIFEST_SCOPE_MISMATCH');
  return hash;
}

export function verifyCompletedReviewedJournal({ records, requests, manifest, reviewed, run }) {
  const event = name => {
    const found = records.filter(row => row.payload.event === name);
    allow(found.length === 1, 'REQUIRED_EVENT_MISMATCH');
    return found[0];
  };
  allow(pendingOperations(records).length === 0 && !records.some(row => row.payload.event.startsWith('rollback.')), 'UNRESOLVED_OPERATIONS');
  allow(digest(data(event('release.prepared')).manifest) === digest(manifest), 'PREPARED_MANIFEST_MISMATCH');
  assertBuildReceipt(data(event('build.passed')), manifest);
  const stage = data(event('stage.result'));
  const staged = stage.result;
  allow(stage.outcome === 'applied' && staged.sha === manifest.candidate.sha
    && staged.artifactDigest === data(event('build.passed')).artifactDigest, 'STAGED_ARTIFACT_MISMATCH');
  assertSmokeProof(data(event('smoke.passed')), manifest, staged);
  const approval = data(event('approval.accepted'));
  const promote = event('promote.intent');
  allow(approval.runId === run.id, 'APPROVAL_RUN_MISMATCH');
  assertAuthorization(approval, manifest, staged, Date.parse(promote.created_at));
  const prerequisites = event('prerequisites.passed');
  const checked = data(prerequisites).salesforce;
  allow(data(prerequisites).passed === true && checked?.order === promotionOrder && checked.mirrorVerified === true
    && checked.sourceTreeHash === reviewed.binding.sourceTreeHash, 'SALESFORCE_ORDER_MISMATCH');
  assertSmokeProof(data(event('prerequisites.smoke_passed')), manifest, staged);
  allow(data(event('prerequisites.smoke_passed')).prerequisiteDigest === digest(data(prerequisites)), 'PREREQUISITE_SMOKE_MISMATCH');
  const promotion = event('promote.result'), observed = event('live.passed'), completion = event('release.complete');
  allow(data(promotion).outcome === 'applied' && data(promotion).result.id === staged.id
    && data(promotion).result.buildId === staged.buildId && data(observed).passed === true
    && data(observed).deploymentId === staged.id && data(observed).buildId === staged.buildId
    && data(observed).observationMs >= 300000 && data(observed).businessWrites === 0
    && data(completion).deploymentId === staged.id
    && [prerequisites, promote, promotion, observed, completion].every((row, index, rows) =>
      index === 0 || sequence(row) > sequence(rows[index - 1])), 'LIVE_EVIDENCE_MISMATCH');

  const completed = records.filter(row => row.payload.event === 'salesforce.checkpoint'
    && data(row).fingerprint === reviewed.fingerprint && data(row).outcome === 'resolved');
  const job = (stageName, operation) => {
    const found = completed.filter(row => data(row).stage === stageName && data(row).operation === operation);
    allow(found.length === 1 && data(found[0]).job?.id, 'SALESFORCE_JOB_MISMATCH');
    return found[0];
  };
  const validation = job('devee', 'validation'), deployment = job('devee', 'deployment');
  const qat = job('qat', 'deployment'), production = job('production', 'deployment');
  allow(data(deployment).job.validationId === data(validation).job.id, 'DEVEE_VALIDATION_LINK_MISMATCH');
  const publications = completed.filter(row => data(row).stage === 'shared_mirror' && data(row).operation === 'publication');
  allow(publications.length && sequence(validation) < sequence(deployment) && sequence(deployment) < sequence(publications[0])
    && sequence(publications[0]) < sequence(qat) && sequence(qat) < sequence(production)
    && sequence(production) < sequence(prerequisites), 'SALESFORCE_CHECKPOINT_ORDER_MISMATCH');
  const mirror = data(publications.at(-1)).mirror;
  allow(mirror && publications.every(row => digest(data(row).mirror) === digest(mirror)), 'MIRROR_HEAD_MISMATCH');
  const initial = records.filter(row => row.payload.event === 'salesforce.checkpoint'
    && data(row).fingerprint === reviewed.fingerprint && data(row).stage === 'shared_mirror'
    && data(row).operation === 'publication' && data(row).outcome === 'pending');
  allow(initial.length === 1 && sequence(deployment) < sequence(initial[0])
    && sequence(initial[0]) < sequence(publications[0]), 'MIRROR_INTENT_MISMATCH');
  const byRequest = new Map(requests.filter(row => row.creator?.id === botId && row.payload?.kind === 'fcos_local_mirror_request'
    && row.payload.runId === run.id && Number.isSafeInteger(row.payload.runAttempt) && row.payload.runAttempt > 0
    && row.payload.runAttempt <= run.run_attempt
    && row.payload.manifestHash === digest(manifest)).map(row => [row.id, row]));
  const pairs = requests.filter(row => row.creator?.id === ownerId && row.payload?.kind === 'fcos_local_mirror_receipt'
    && byRequest.has(row.payload.requestId)).map(receipt => [byRequest.get(receipt.payload.requestId), receipt]);
  allow(new Set(pairs.map(([request]) => request.id)).size === pairs.length, 'MIRROR_RECEIPT_AMBIGUOUS');
  let previous = initial[0];
  const verifiedRequests = [];
  for (const [index, checkpoint] of publications.entries()) {
    const modes = index === 0 ? ['publish', 'recover'] : ['check'];
    const matches = pairs.filter(([request, receipt]) => modes.includes(request.payload.mode)
      && request.payload.controllerSha === manifest.controllerSha
      && request.payload.deploymentJobId === data(deployment).job.id && request.payload.validationJobId === data(validation).job.id
      && request.payload.deveeOrgId === fcosSalesforceEnvironment('devee').orgId
      && request.payload.intentHash === data(previous).evidenceDigest
      && Date.parse(request.created_at) >= Date.parse(previous.created_at)
      && Date.parse(receipt.created_at) <= Date.parse(checkpoint.created_at));
    allow(matches.length === 1, 'MIRROR_RECEIPT_REQUIRED');
    const [[request, receipt]] = matches;
    const proof = verifyLocalMirrorReceipt({ request: request.payload, requestDeployment: request, receiptDeployment: receipt,
      reviewed, workflowActorId: botId, publisherId: ownerId, now: Date.parse(receipt.created_at) });
    allow(proof.commit === mirror.commit && proof.pullRequest.number === mirror.pullRequest, 'MIRROR_RECEIPT_CHANGED');
    verifiedRequests.push(request);
    previous = checkpoint;
  }
  allow(publications.length >= 3 && Date.parse(verifiedRequests.at(-1).created_at) >= Date.parse(production.created_at),
    'FINAL_MIRROR_CHECK_REQUIRED');
  return { validationId: data(validation).job.id, deploymentId: data(deployment).job.id, mirror };
}

function readGitHub(candidateSha) {
  const env = { ...process.env, GH_CONFIG_DIR: githubConfigDirectory({ repoRoot: root }), GH_HOST: 'github.com',
    GH_REPO: 'github.com/' + targets().repository, GH_PROMPT_DISABLED: '1' };
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) delete env[name];
  const api = args => JSON.parse(execFileSync('gh', ['api', ...args], { env, encoding: 'utf8', timeout: 30000,
    maxBuffer: 24 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }));
  return { candidateSha, read: path => api([path]), pages: path => api(['--paginate', '--slurp', path]).flat() };
}

async function assertCurrentVersion(manifest) {
  const response = await fetch(targets().origin + '/app-version.json', { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
  allow(response.ok, 'LIVE_READBACK_FAILED');
  const version = await response.json();
  allow(version.commit === manifest.candidate.sha && version.buildId === manifest.build.buildId, 'LIVE_BUILD_CHANGED');
}

async function main() {
  const [directory, candidate, manifestFile, id, ...noMore] = process.argv.slice(2);
  const runId = Number(id);
  allow(directory && manifestFile && Number.isSafeInteger(runId) && runId > 0 && !noMore.length, 'USAGE_CANDIDATE_SHA_MANIFEST_RUN');
  const cwd = resolve(directory), manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  const hash = assertStandardReviewedSourceManifest(manifest, candidate);
  const verifySource = () => verifySalesforceReviewSource({ cwd, candidateSha: candidate, manifest, verifierDirectory: root });
  verifySource();
  const plan = manifest.prerequisites.plan;
  const reviewed = loadReviewedSalesforcePlan({ cwd, manifestPath: plan.salesforceManifestPath, reviewPath: plan.salesforceReviewPath });
  const github = readGitHub(candidate), repoPath = '/repos/' + targets().repository;
  const viewer = github.read('/user'), repo = github.read(repoPath);
  allow(owner(viewer) && repo.id === repositoryId && owner(repo.owner) && repo.full_name === targets().repository
    && repo.permissions?.push === true && repo.default_branch === 'main' && !repo.archived, 'GITHUB_IDENTITY_MISMATCH');
  const path = repoPath + '/actions/runs/' + runId, run = github.read(path);
  allow(run.id === runId && run.status === 'completed' && run.conclusion === 'success' && owner(run.actor)
    && owner(run.triggering_actor) && run.repository.id === repo.id && run.head_branch === 'main'
    && nativeWorkflowPath(run) === workflow && run.event === 'workflow_dispatch'
    && [`FCOS rapid release ${hash} ${candidate}`, `FCOS rapid resume ${hash} ${candidate}`].includes(run.display_title),
  'NATIVE_RUN_MISMATCH');
  const jobs = github.read(path + '/attempts/' + run.run_attempt + '/jobs?per_page=100').jobs;
  allow(jobs.filter(job => job.name === 'go-live' && job.run_id === runId && job.run_attempt === run.run_attempt
    && job.status === 'completed' && job.conclusion === 'success').length === 1, 'NATIVE_GO_LIVE_MISMATCH');
  const protection = github.read(repoPath + '/environments/' + environmentName), reviews = github.read(path + '/approvals');
  allow(protection.id === environmentId && protection.name === environmentName && protection.can_admins_bypass === false
    && protection.protection_rules?.some(rule => rule.type === 'required_reviewers'
      && rule.reviewers?.some(row => owner(row.reviewer)))
    && reviews.filter(row => row.state === 'approved' && owner(row.user)
      && row.environments?.some(item => item.id === environmentId && item.name === environmentName)).length === 1, 'NATIVE_APPROVAL_MISMATCH');
  const journal = new DeploymentJournal({ github, actorIds: [botId], releaseId: manifest.releaseId, manifestHash: hash });
  const [records, requests] = await Promise.all([journal.read(), readLocalMirrorDeployments(github, candidate),
    assertFrozenWorkflow({ github, controllerSha: manifest.controllerSha, dispatcherSha: run.head_sha }),
    assertCurrentVersion(manifest)]);
  const { deploymentId, validationId, mirror } = verifyCompletedReviewedJournal({ records, requests, manifest, reviewed, run });
  const devee = fcosSalesforceEnvironment('devee');
  const provider = cliSalesforceProvider({ cwd, policy, commandEnvironment: process.env });
  const job = jobId => ({ jobId, status: 'Succeeded', fingerprint: reviewed.fingerprint, orgId: devee.orgId });
  const native = await reviewedDeveePublicationProof({ plan: reviewed,
    state: { fingerprint: reviewed.fingerprint, binding: reviewed.binding, stages: { devee: {
      validation: job(validationId), deployment: { ...job(deploymentId), validationJobId: validationId },
    } } }, policy, provider, assertUnchanged: verifySource });
  const report = executeSharedMirror({ mode: 'check', metadataRoot: join(cwd, policy.publication.sourceRoot), expectedHead: mirror,
    proofResolver(inventory) {
      verifySource();
      allow(inventory.sourceTreeHash === reviewed.binding.sourceTreeHash, 'CURRENT_SOURCE_TREE_CHANGED');
      return native;
    } });
  assertReviewedMirror(report, reviewed, policy, deploymentId);
  allow(report.commit === mirror.commit && report.pullRequest.number === mirror.pullRequest, 'CURRENT_MIRROR_CHANGED');
  await assertCurrentVersion(manifest);
  verifySource();
  console.log(JSON.stringify({ runId, candidate, sourceTreeHash: reviewed.binding.sourceTreeHash, deploymentId, mirror }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(/^[A-Z][A-Z0-9_]+$/u.test(error?.message) ? error.message : 'REVIEWED_SOURCE_ANCHOR_VERIFICATION_FAILED');
  process.exitCode = 1;
});
