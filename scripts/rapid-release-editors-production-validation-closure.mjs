import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FCOS_CONNECTION_POLICY, fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { cliSalesforceProvider, loadReviewedSalesforcePlan } from './deploy-salesforce-reviewed-manifest.mjs';
import { expectedManifest, sourceInventory } from './sync-salesforce-shared-repository.mjs';
import { assertReviewedJobReport, reviewedCheckpointInventory, reviewedJobExpectations, verifyReviewedOrgInventory }
  from './lib/salesforce-reviewed-release.mjs';
import { assertNativeHandoverState, nativeCompatibilityReader } from './lib/rapid-release/compatibility.mjs';
import { digest, git, isDigest, isSha, requireCondition as check, targets } from './lib/rapid-release/contract.mjs';
import { assertEditorsClosureApproval, editorsClosureEnvironment, editorsClosureTitle, editorsClosureWorkflow,
  editorsProductionValidationClosureResult, isEditorsClosureOwner, originalEditorsProductionValidation as original,
  readStoppedEditorsProductionValidation } from './lib/rapid-release/editors-production-validation-closure.mjs';
import { DeploymentJournal } from './lib/rapid-release/journal.mjs';
import { assertPermanentHandover, githubClient, nativeWorkflowPath, vercelProvider } from './lib/rapid-release/providers.mjs';
import { authenticateHostedSalesforce } from './lib/rapid-release/salesforce-hosted-auth.mjs';

const repoPath = '/repos/' + targets().repository;
const policy = FCOS_CONNECTION_POLICY.providers.find(({ id }) => id === 'salesforce');
const { publication } = policy;
const same = (left, right) => digest(left) === digest(right);

async function verifyExecution(env) {
  check(env.GITHUB_ACTIONS === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted'
    && env.GITHUB_REPOSITORY === targets().repository && /^[1-9][0-9]*$/u.test(env.GITHUB_RUN_ID || '')
    && env.GITHUB_RUN_ATTEMPT === '1' && isSha(env.GITHUB_SHA), 'EDITORS_CLOSURE_TRUSTED_RUNNER_REQUIRED');
  const github = githubClient({ token: env.FCOS_RAPID_CLOSURE_GITHUB_TOKEN, candidateSha: original.candidate, actions: false });
  const { user, repo } = await github.identity();
  check(isEditorsClosureOwner(user) && repo.id === original.repositoryId && repo.permissions?.admin === true && repo.default_branch === 'main',
    'EDITORS_CLOSURE_OWNER_REQUIRED');
  const runPath = `${repoPath}/actions/runs/${env.GITHUB_RUN_ID}`;
  const [run, branch, pointer, enabled, history, protection, approvals, handoverRecord] = await Promise.all([
    github.read(runPath), github.read(repoPath + '/branches/main'), github.read(repoPath + '/actions/variables/FCOS_RAPID_RELEASE_HANDOVER_ID'),
    github.read(repoPath + '/actions/variables/FCOS_RAPID_RELEASE_ENABLED'),
    github.read(`${repoPath}/actions/workflows/${editorsClosureWorkflow.split('/').at(-1)}/runs?event=workflow_dispatch&per_page=100`),
    github.read(`${repoPath}/environments/${editorsClosureEnvironment.name}`), github.read(runPath + '/approvals'),
    github.read(`${repoPath}/deployments/${original.handoverId}`),
  ]);
  check(run.id === Number(env.GITHUB_RUN_ID) && run.status === 'in_progress' && run.run_attempt === 1 && run.event === 'workflow_dispatch'
    && run.head_branch === 'main' && run.head_sha === env.GITHUB_SHA && git(process.cwd(), ['rev-parse', 'HEAD']) === env.GITHUB_SHA
    && branch.protected === true && branch.commit.sha === env.GITHUB_SHA && run.repository?.id === original.repositoryId
    && run.repository.full_name === targets().repository && isEditorsClosureOwner(run.actor) && isEditorsClosureOwner(run.triggering_actor)
    && nativeWorkflowPath(run) === editorsClosureWorkflow && run.display_title === editorsClosureTitle
    && pointer.value === String(original.handoverId) && enabled.value === 'true'
    && history.total_count === 1 && history.workflow_runs?.[0]?.id === run.id
    && handoverRecord.id === original.handoverId && isEditorsClosureOwner(handoverRecord.creator),
  'EDITORS_CLOSURE_EXECUTION_IDENTITY_MISMATCH');
  const rule = protection.protection_rules?.find(item => item.type === 'required_reviewers');
  check(protection.id === editorsClosureEnvironment.id && protection.name === editorsClosureEnvironment.name
    && protection.can_admins_bypass === false && rule?.reviewers?.some(item => isEditorsClosureOwner(item.reviewer)),
  'EDITORS_CLOSURE_PROTECTION_MISMATCH');
  assertEditorsClosureApproval(approvals);
  const statuses = await Promise.all(['queued', 'in_progress', 'waiting', 'requested', 'pending'].map(status =>
    github.read(`${repoPath}/actions/runs?status=${status}&per_page=100`)));
  check(statuses.every(page => page.total_count === page.workflow_runs?.length && page.total_count < 100
    && page.workflow_runs.every(current => current.id === run.id)), 'EDITORS_CLOSURE_COMPETING_RUN');
  return { github, run, handoverRecord };
}

function readSharedGitHub(env) {
  check(env.FCOS_RAPID_CLOSURE_MIRROR_TOKEN && !/\s/u.test(env.FCOS_RAPID_CLOSURE_MIRROR_TOKEN),
    'EDITORS_CLOSURE_MIRROR_CREDENTIAL_REQUIRED');
  return path => JSON.parse(execFileSync('gh', ['api', '--hostname', 'github.com', path], {
    env: { PATH: env.PATH, HOME: env.HOME, GH_TOKEN: env.FCOS_RAPID_CLOSURE_MIRROR_TOKEN,
      GH_REPO: `github.com/${publication.repository}`, GH_PROMPT_DISABLED: 'true' },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  }));
}

const blobSha = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

export function assertExactEditorsMirrorTree({ tree, sourceRoot }) {
  const inventory = sourceInventory(sourceRoot);
  check(inventory.sourceTreeHash === original.sourceTreeHash && tree?.truncated === false && Array.isArray(tree.tree),
    'EDITORS_CLOSURE_MIRROR_TREE_INCOMPLETE');
  const blobs = new Map(tree.tree.filter(entry => entry.type === 'blob' && entry.mode === '100644').map(entry => [entry.path, entry.sha]));
  const manifestBytes = Buffer.from(`${JSON.stringify(expectedManifest(inventory), null, 2)}\n`);
  const targetRoot = publication.targetRoot.replace(/\/$/u, '');
  check(blobs.get(publication.manifestPath) === blobSha(manifestBytes)
    && inventory.files.every(relative => blobs.get(`${targetRoot}/${relative}`) === blobSha(readFileSync(join(sourceRoot, relative)))),
  'EDITORS_CLOSURE_MIRROR_BYTES_CHANGED');
  return inventory.sourceTreeHash;
}

function verifyCurrentMirror({ env, cwd, mirror }) {
  const read = readSharedGitHub(env);
  const repo = `/repos/${publication.repository}`;
  const account = read('/user');
  const repository = read(repo);
  check(isEditorsClosureOwner(account) && repository.id === publication.repositoryId && repository.full_name === publication.repository
    && repository.permissions?.pull === true && repository.default_branch === publication.defaultBranch,
  'EDITORS_CLOSURE_SHARED_REPOSITORY_IDENTITY_MISMATCH');
  const proof = mirror.receipt.payload.proof;
  const pullRequest = read(`${repo}/pulls/${original.mirrorPullRequest}`);
  const head = read(`${repo}/git/ref/heads/${proof.branch.split('/').map(encodeURIComponent).join('/')}`);
  const commit = read(`${repo}/commits/${original.mirrorCommit}`);
  check(pullRequest.number === original.mirrorPullRequest && pullRequest.state === 'open' && pullRequest.draft === true
    && pullRequest.base.repo.id === publication.repositoryId && pullRequest.base.ref === publication.defaultBranch
    && pullRequest.head.repo.id === publication.repositoryId && pullRequest.head.ref === proof.branch
    && pullRequest.head.sha === original.mirrorCommit && head.ref === `refs/heads/${proof.branch}`
    && head.object?.type === 'commit' && head.object.sha === original.mirrorCommit && commit.sha === original.mirrorCommit
    && isEditorsClosureOwner(commit.author) && isEditorsClosureOwner(commit.committer) && isSha(commit.commit?.tree?.sha),
  'EDITORS_CLOSURE_MIRROR_HEAD_CHANGED');
  const tree = read(`${repo}/git/trees/${commit.commit.tree.sha}?recursive=1`);
  check(tree.sha === commit.commit.tree.sha, 'EDITORS_CLOSURE_MIRROR_TREE_MISMATCH');
  const sourceTreeHash = assertExactEditorsMirrorTree({ tree, sourceRoot: join(cwd, publication.sourceRoot) });
  return { commit: commit.sha, pullRequest: pullRequest.number, tree: tree.sha, sourceTreeHash };
}

async function readSalesforce({ env, cwd, reviewed, checkpoints }) {
  const directory = mkdtempSync(join(env.RUNNER_TEMP, 'editors-production-closure-salesforce-'));
  try {
    const commandEnvironment = authenticateHostedSalesforce({ directory, cwd, env: { ...env, HOME: directory }, requireMirrorCredential: false });
    const provider = cliSalesforceProvider({ cwd, policy, commandEnvironment });
    const compiled = provider.prepareValidation(fcosSalesforceEnvironment('devee'), reviewed);
    try {
      check(compiled.packageSha256 === original.packageSha256, 'EDITORS_CLOSURE_SALESFORCE_PACKAGE_MISMATCH');
    } finally {
      compiled.cleanup();
    }
    const evidence = {};
    for (const name of ['devee', 'qat', 'production']) {
      const environment = fcosSalesforceEnvironment(name);
      check(provider.verifyIdentity(environment).instanceUrl === environment.instanceUrl, 'EDITORS_CLOSURE_SALESFORCE_ORG_MISMATCH');
      const verified = {};
      const reports = {};
      for (const operation of (name === 'production' ? ['validation'] : ['validation', 'deployment'])) {
        const checkpoint = checkpoints[`${name}:${operation}`].payload.data;
        const reference = checkpoint.job;
        const report = provider.report(environment, reference.id);
        const proof = assertReviewedJobReport(report, { environment, jobId: reference.id,
          ...reviewedJobExpectations(reviewed, environment, operation),
          ...(operation === 'deployment' ? { quickValidation: { id: reference.validationId, report: reports.validation } } : {}) });
        reports[operation] = report;
        verified[operation] = { jobId: reference.id, reportSha256: proof.reportSha256 };
      }
      const inventory = await verifyReviewedOrgInventory({ provider, environment, plan: reviewed,
        expected: reviewedCheckpointInventory(reviewed, { deployment: { status: name === 'production' ? 'Pending' : 'Succeeded' } }, name) });
      evidence[name] = { orgId: environment.orgId, inventory: inventory.evidenceSha256, reports: verified };
    }
    return evidence;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function verifyPreimage({ closure, env, handoverRecord }) {
  const cwd = join(process.cwd(), 'original-application');
  check(git(cwd, ['rev-parse', 'HEAD']) === original.candidate && !git(cwd, ['status', '--porcelain']),
    'EDITORS_CLOSURE_APPLICATION_SOURCE_MISMATCH');
  const { manifest, staged, checkpoints, mirror } = closure;
  const locator = manifest.prerequisites.plan;
  const reviewed = loadReviewedSalesforcePlan({ cwd, policy, manifestPath: locator.salesforceManifestPath,
    reviewPath: locator.salesforceReviewPath });
  check(reviewed.fingerprint === original.fingerprint && reviewed.binding.sourceTreeHash === original.sourceTreeHash
    && !reviewed.review.bootstrap && !reviewed.invoiceAppPlacement, 'EDITORS_CLOSURE_SALESFORCE_SCOPE_MISMATCH');
  const salesforce = await readSalesforce({ env, cwd, reviewed, checkpoints });
  const mirrorEvidence = verifyCurrentMirror({ env, cwd, mirror });
  const handover = assertPermanentHandover(handoverRecord, manifest, original.actorId);
  const provider = vercelProvider({ manifest, env });
  await provider.project();
  const [alias, deployment, handoverEvidence] = await Promise.all([
    nativeCompatibilityReader({ provider, env })({ manifest }), provider.rawDeployment(staged.id), assertNativeHandoverState({ handover, env }),
  ]);
  const baseline = { sha: alias.sha, deploymentId: alias.currentDeploymentId, configurationDigest: alias.configurationDigest,
    schemaDigest: alias.schemaDigest };
  check(same(baseline, manifest.previous), 'EDITORS_CLOSURE_PRODUCTION_PREIMAGE_CHANGED');
  check(deployment.id === staged.id && deployment.readyState === 'READY' && deployment.aliasAssigned === false
    && deployment.meta?.githubCommitSha === staged.sha && deployment.meta.fcosRapidBuildId === staged.buildId
    && deployment.meta.fcosRapidArtifactDigest === staged.artifactDigest && deployment.meta.fcosRapidManifestHash === original.manifestHash
    && deployment.meta.fcosRapidOperationId === staged.operationId && `https://${deployment.url}` === staged.url,
  'EDITORS_CLOSURE_STAGED_DEPLOYMENT_CHANGED');
  return { baseline, salesforce, mirror: mirrorEvidence, handoverEvidence, stagedDeploymentId: deployment.id,
    stagedArtifactDigest: staged.artifactDigest, observedAt: new Date().toISOString() };
}

async function main(env) {
  const { github, run, handoverRecord } = await verifyExecution(env);
  const phase = env.FCOS_CLOSURE_PHASE;
  check(['preflight', 'append'].includes(phase), 'EDITORS_CLOSURE_PHASE_REQUIRED');
  const readClosure = () => readStoppedEditorsProductionValidation({ github, currentClosureRunId: run.id });
  const closure = await readClosure();
  const summary = { originalRunId: original.originalRunId, continuationRunId: original.continuationRunId, providerMetadataWrites: 0 };
  if (closure.receipt) return { ...summary, receiptId: closure.receipt.id };
  const stampPath = join(env.RUNNER_TEMP, `editors-production-validation-closure-${run.id}-1.json`);
  const stamp = { runId: run.id, attempt: 1, source: env.GITHUB_SHA, journalHead: original.oldHead };
  if (phase === 'preflight') {
    const evidence = await verifyPreimage({ closure, env, handoverRecord });
    writeFileSync(stampPath, JSON.stringify({ stamp, evidence }), { flag: 'wx', mode: 0o600 });
    return { ...summary, preflightVerified: true };
  }
  const { stamp: savedStamp, evidence } = JSON.parse(readFileSync(stampPath, 'utf8'));
  const observed = Date.parse(evidence?.observedAt);
  check(same(savedStamp, stamp) && observed <= Date.now() && Date.now() - observed < 180_000
    && same(evidence.baseline, closure.manifest.previous)
    && evidence.mirror?.commit === original.mirrorCommit && evidence.mirror.pullRequest === original.mirrorPullRequest
    && isSha(evidence.mirror.tree) && evidence.mirror.sourceTreeHash === original.sourceTreeHash
    && evidence.stagedDeploymentId === original.stagedDeploymentId && evidence.stagedArtifactDigest === original.stagedArtifactDigest
    && isDigest(evidence.handoverEvidence?.evidenceDigest)
    && ['devee', 'qat', 'production'].every(name => evidence.salesforce?.[name]?.orgId === fcosSalesforceEnvironment(name).orgId
      && isDigest(evidence.salesforce[name].inventory))
    && Object.entries(closure.checkpoints).filter(([key]) => key !== 'shared_mirror:publication').every(([key, row]) => {
      const [name, operation] = key.split(':');
      const report = evidence.salesforce[name].reports?.[operation];
      return report?.jobId === row.payload.data.job.id && isDigest(report.reportSha256);
    }), 'EDITORS_CLOSURE_PREFLIGHT_REQUIRED');
  const result = editorsProductionValidationClosureResult({ evidenceDigest: digest(evidence), closureRunId: run.id });
  const journal = new DeploymentJournal({ github, releaseId: original.releaseId, manifestHash: original.manifestHash,
    actorIds: [original.actorId, original.workflowActorId] });
  try {
    await journal.append('prerequisites.result', result, { expectedPreviousHash: original.oldHead });
  } catch {
    // Resolve the original append by native readback without another provider submission.
  }
  const { receipt } = await readClosure();
  check(receipt && same(receipt.payload.data, result), 'EDITORS_CLOSURE_APPEND_OUTCOME_UNCERTAIN');
  return { ...summary, receiptId: receipt.id };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.env).then(result => console.log(JSON.stringify(result))).catch(error => {
    const code = error?.code || error?.message;
    console.error(/^(?:EDITORS_CLOSURE|JOURNAL|GITHUB|SALESFORCE|LOCAL_MIRROR|NATIVE|DISPATCHER|PERMANENT)_[A-Z_]+$/u.test(code)
      ? code : 'EDITORS_CLOSURE_READBACK_FAILED');
    process.exitCode = 1;
  });
}
