import { execFileSync, spawnSync } from 'node:child_process';
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
import { appendReminderClosure, assertClosureApproval, isClosureOwner, original, productionEnvironment,
  readStoppedReminder, reminderClosureJournal, verifyJournalBoundary, workflowPath, workflowTitle }
  from './lib/rapid-release/invoice-reminders-qat-closure.mjs';
import { assertPermanentHandover, githubClient, nativeWorkflowPath, vercelProvider } from './lib/rapid-release/providers.mjs';
import { authenticateHostedSalesforce } from './lib/rapid-release/salesforce-hosted-auth.mjs';

const repoPath = '/repos/' + targets().repository;
const policy = FCOS_CONNECTION_POLICY.providers.find(({ id }) => id === 'salesforce');
const { publication } = policy;
const orgs = ['devee', 'qat', 'production'];
const same = (left, right) => digest(left) === digest(right);

async function verifyExecution(env) {
  check(env.GITHUB_ACTIONS === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted' && env.GITHUB_REPOSITORY === targets().repository
    && /^[1-9][0-9]*$/u.test(env.GITHUB_RUN_ID || '') && env.GITHUB_RUN_ATTEMPT === '1' && isSha(env.GITHUB_SHA),
  'REMINDER_CLOSURE_TRUSTED_RUNNER_REQUIRED');
  const github = githubClient({ token: env.FCOS_RAPID_CLOSURE_GITHUB_TOKEN, candidateSha: original.candidate, actions: false });
  const { user, repo } = await github.identity();
  check(isClosureOwner(user) && repo.id === original.repositoryId && repo.permissions?.admin === true && repo.default_branch === 'main',
    'REMINDER_CLOSURE_OWNER_REQUIRED');
  const runPath = `${repoPath}/actions/runs/${env.GITHUB_RUN_ID}`;
  const [run, branch, pointer, enabled, protection, approvals, handoverRecord] = await Promise.all([
    github.read(runPath), github.read(repoPath + '/branches/main'), github.read(repoPath + '/actions/variables/FCOS_RAPID_RELEASE_HANDOVER_ID'),
    github.read(repoPath + '/actions/variables/FCOS_RAPID_RELEASE_ENABLED'),
    github.read(`${repoPath}/environments/${productionEnvironment.name}`), github.read(runPath + '/approvals'),
    github.read(`${repoPath}/deployments/${original.handoverId}`),
  ]);
  check(run.id === Number(env.GITHUB_RUN_ID) && run.status === 'in_progress' && run.run_attempt === 1 && run.event === 'workflow_dispatch'
    && run.head_branch === 'main' && run.head_sha === env.GITHUB_SHA && git(process.cwd(), ['rev-parse', 'HEAD']) === env.GITHUB_SHA
    && branch.protected === true && branch.commit.sha === env.GITHUB_SHA && run.repository?.id === original.repositoryId
    && run.repository.full_name === targets().repository && isClosureOwner(run.actor) && isClosureOwner(run.triggering_actor)
    && nativeWorkflowPath(run) === workflowPath && run.display_title === workflowTitle
    && pointer.value === String(original.handoverId) && enabled.value === 'true'
    && handoverRecord.id === original.handoverId && isClosureOwner(handoverRecord.creator),
  'REMINDER_CLOSURE_EXECUTION_IDENTITY_MISMATCH');
  const rule = protection.protection_rules?.find(item => item.type === 'required_reviewers');
  check(protection.id === productionEnvironment.id && protection.name === productionEnvironment.name
    && protection.can_admins_bypass === false && rule?.reviewers?.some(item => isClosureOwner(item.reviewer)),
  'REMINDER_CLOSURE_PROTECTION_MISMATCH');
  assertClosureApproval(approvals);
  const active = await Promise.all(['queued', 'in_progress', 'waiting', 'requested', 'pending'].map(status =>
    github.read(`${repoPath}/actions/runs?status=${status}&per_page=100`)));
  check(active.every(page => page.total_count === page.workflow_runs?.length && page.total_count < 100
    && page.workflow_runs.every(current => current.id === run.id)), 'REMINDER_CLOSURE_COMPETING_RUN');
  return { github, run, handoverRecord };
}

function readSharedGitHub(env) {
  check(env.FCOS_RAPID_CLOSURE_MIRROR_TOKEN && !/\s/u.test(env.FCOS_RAPID_CLOSURE_MIRROR_TOKEN),
    'REMINDER_CLOSURE_MIRROR_CREDENTIAL_REQUIRED');
  return path => JSON.parse(execFileSync('gh', ['api', '--hostname', 'github.com', path], {
    env: { PATH: env.PATH, HOME: env.HOME, GH_TOKEN: env.FCOS_RAPID_CLOSURE_MIRROR_TOKEN,
      GH_REPO: `github.com/${publication.repository}`, GH_PROMPT_DISABLED: 'true' },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  }));
}

const blobSha = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

function verifyCurrentMirror({ env, cwd, mirror }) {
  const read = readSharedGitHub(env);
  const repo = `/repos/${publication.repository}`;
  check(isClosureOwner(read('/user')), 'REMINDER_CLOSURE_SHARED_ACCOUNT_MISMATCH');
  const repository = read(repo);
  check(repository.id === publication.repositoryId && repository.full_name === publication.repository
    && repository.permissions?.pull === true && repository.default_branch === publication.defaultBranch,
  'REMINDER_CLOSURE_SHARED_REPOSITORY_MISMATCH');
  const pullRequest = read(`${repo}/pulls/${original.mirrorPullRequest}`);
  const head = read(`${repo}/git/ref/heads/${mirror.branch.split('/').map(encodeURIComponent).join('/')}`);
  const commit = read(`${repo}/commits/${original.mirrorCommit}`);
  check(pullRequest.number === original.mirrorPullRequest && pullRequest.state === 'open' && pullRequest.draft === true
    && pullRequest.base.repo.id === publication.repositoryId && pullRequest.base.ref === publication.defaultBranch
    && pullRequest.head.repo.id === publication.repositoryId && pullRequest.head.ref === mirror.branch
    && pullRequest.head.sha === original.mirrorCommit && head.ref === `refs/heads/${mirror.branch}`
    && head.object?.type === 'commit' && head.object.sha === original.mirrorCommit && commit.sha === original.mirrorCommit
    && isClosureOwner(commit.author) && isClosureOwner(commit.committer) && isSha(commit.commit?.tree?.sha),
  'REMINDER_CLOSURE_MIRROR_HEAD_CHANGED');
  const tree = read(`${repo}/git/trees/${commit.commit.tree.sha}?recursive=1`);
  const sourceRoot = join(cwd, publication.sourceRoot);
  const inventory = sourceInventory(sourceRoot);
  check(tree.sha === commit.commit.tree.sha && tree.truncated === false && Array.isArray(tree.tree)
    && inventory.sourceTreeHash === original.sourceTreeHash, 'REMINDER_CLOSURE_MIRROR_TREE_MISMATCH');
  const blobs = new Map(tree.tree.filter(entry => entry.type === 'blob' && entry.mode === '100644')
    .map(entry => [entry.path, entry.sha]));
  const manifestBytes = Buffer.from(`${JSON.stringify(expectedManifest(inventory), null, 2)}\n`);
  const targetRoot = publication.targetRoot.replace(/\/$/u, '');
  check(blobs.get(publication.manifestPath) === blobSha(manifestBytes)
    && inventory.files.every(relative => blobs.get(`${targetRoot}/${relative}`) === blobSha(readFileSync(join(sourceRoot, relative)))),
  'REMINDER_CLOSURE_MIRROR_BYTES_CHANGED');
  return { commit: commit.sha, pullRequest: pullRequest.number, tree: tree.sha, sourceTreeHash: inventory.sourceTreeHash };
}

export function assertTerminalQatReport(report, { submittedAt, completedBy }) {
  const rawFailures = report.details?.runTestResult?.failures;
  const failures = Array.isArray(rawFailures) ? rawFailures : rawFailures ? [rawFailures] : [];
  const completed = Date.parse(report.completedDate);
  check(report.id === original.qatValidationId && report.status === 'Failed' && report.done === true && report.checkOnly === true
    && Number(report.numberComponentErrors) === 0 && Number(report.numberTestsTotal) === 100 && Number(report.numberTestErrors) === 1
    && failures.length === 1 && failures[0].name === 'InvoiceControllerTest'
    && failures[0].methodName === 'restrictedSalesSupportCanReadInvoiceBlockerAndCaptureOneReminder'
    && Date.parse(submittedAt) <= completed && completed <= Date.parse(completedBy), 'REMINDER_CLOSURE_QAT_TERMINAL_REPORT_MISMATCH');
  return { jobId: report.id, status: report.status, checkOnly: true, reportSha256: digest(report) };
}

export function readTerminalQatReport({ cwd, commandEnvironment, run = spawnSync }) {
  const qat = fcosSalesforceEnvironment('qat');
  const execution = run('sf', ['project', 'deploy', 'report', '--target-org', qat.alias, '--job-id', original.qatValidationId,
    '--wait', '1', '--json'], { cwd, env: commandEnvironment, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    timeout: 90_000, stdio: ['ignore', 'pipe', 'pipe'] });
  check(!execution.error && [0, 1].includes(execution.status), 'REMINDER_CLOSURE_QAT_REPORT_UNAVAILABLE');
  let response;
  try { response = JSON.parse(execution.stdout); }
  catch { check(false, 'REMINDER_CLOSURE_QAT_REPORT_UNAVAILABLE'); }
  // Salesforce CLI exits nonzero on a reported deploy failure. Only an exact terminal native report can qualify below.
  check(response?.status === execution.status && response.result?.id === original.qatValidationId,
    'REMINDER_CLOSURE_QAT_REPORT_UNAVAILABLE');
  return response.result;
}

async function readSalesforce({ env, cwd, reviewed, checkpoints, goLive }) {
  const directory = mkdtempSync(join(env.RUNNER_TEMP, 'reminder-qat-closure-salesforce-'));
  try {
    const commandEnvironment = authenticateHostedSalesforce({ directory, cwd, env: { ...env, HOME: directory }, requireMirrorCredential: false });
    const provider = cliSalesforceProvider({ cwd, policy, commandEnvironment });
    const inventory = {};
    for (const name of orgs) {
      const environment = fcosSalesforceEnvironment(name);
      check(provider.verifyIdentity(environment).instanceUrl === environment.instanceUrl, 'REMINDER_CLOSURE_SALESFORCE_ORG_MISMATCH');
      if (name !== 'production') {
        const compiled = provider.prepareValidation(environment, reviewed);
        try {
          check(compiled.packageSha256 === original.packageSha256, 'REMINDER_CLOSURE_SALESFORCE_PACKAGE_MISMATCH');
        } finally {
          compiled.cleanup();
        }
      }
      const observed = await verifyReviewedOrgInventory({ provider, environment, plan: reviewed,
        expected: reviewedCheckpointInventory(reviewed, { deployment: { status: name === 'devee' ? 'Succeeded' : 'Pending' } }, name) });
      inventory[name] = { orgId: environment.orgId, sha256: observed.evidenceSha256 };
    }

    const devee = fcosSalesforceEnvironment('devee');
    const validation = provider.report(devee, original.deveeValidationId);
    const deployment = provider.report(devee, original.deveeDeploymentId);
    const validationProof = assertReviewedJobReport(validation, { environment: devee, jobId: original.deveeValidationId,
      ...reviewedJobExpectations(reviewed, devee, 'validation') });
    const deploymentProof = assertReviewedJobReport(deployment, { environment: devee, jobId: original.deveeDeploymentId,
      ...reviewedJobExpectations(reviewed, devee, 'deployment'), quickValidation: { id: original.deveeValidationId, report: validation } });
    check(Date.parse(validationProof.completedAt) <= Date.parse(checkpoints['devee:validation'].created_at)
      && Date.parse(deploymentProof.completedAt) <= Date.parse(checkpoints['devee:deployment'].created_at),
    'REMINDER_CLOSURE_DEVEE_JOB_TIMING_MISMATCH');
    const qatRecord = checkpoints['qat:validation'].payload.data.job;
    const failure = assertTerminalQatReport(readTerminalQatReport({ cwd, commandEnvironment }), {
      submittedAt: qatRecord.submittedAt, completedBy: goLive.completed_at,
    });
    return { inventory, deveeValidationDigest: validationProof.reportSha256, deveeDeploymentDigest: deploymentProof.reportSha256, failure };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function verifyPreimage({ closure, env, handoverRecord }) {
  const cwd = join(process.cwd(), 'original-application');
  check(git(cwd, ['rev-parse', 'HEAD']) === original.candidate && !git(cwd, ['status', '--porcelain']),
    'REMINDER_CLOSURE_APPLICATION_SOURCE_MISMATCH');
  const { manifest, staged, checkpoints, mirror, goLive } = closure;
  const locator = manifest.prerequisites.plan;
  const reviewed = loadReviewedSalesforcePlan({ cwd, policy, manifestPath: locator.salesforceManifestPath,
    reviewPath: locator.salesforceReviewPath });
  check(reviewed.fingerprint === original.fingerprint && reviewed.binding.sourceTreeHash === original.sourceTreeHash
    && !reviewed.review.bootstrap && !reviewed.invoiceAppPlacement, 'REMINDER_CLOSURE_SALESFORCE_SCOPE_MISMATCH');
  const salesforce = await readSalesforce({ env, cwd, reviewed, checkpoints, goLive });
  const mirrorEvidence = verifyCurrentMirror({ env, cwd, mirror });
  const handover = assertPermanentHandover(handoverRecord, manifest, original.ownerId);
  const provider = vercelProvider({ manifest, env });
  await provider.project();
  const [alias, deployment, handoverEvidence] = await Promise.all([
    nativeCompatibilityReader({ provider, env })({ manifest }), provider.rawDeployment(staged.id), assertNativeHandoverState({ handover, env }),
  ]);
  const baseline = { sha: alias.sha, deploymentId: alias.currentDeploymentId, configurationDigest: alias.configurationDigest,
    schemaDigest: alias.schemaDigest };
  check(same(baseline, manifest.previous), 'REMINDER_CLOSURE_PRODUCTION_PREIMAGE_CHANGED');
  check(deployment.id === staged.id && deployment.readyState === 'READY' && deployment.aliasAssigned === false
    && deployment.meta?.githubCommitSha === staged.sha && deployment.meta.fcosRapidBuildId === staged.buildId
    && deployment.meta.fcosRapidArtifactDigest === staged.artifactDigest && deployment.meta.fcosRapidManifestHash === original.manifestHash
    && deployment.meta.fcosRapidOperationId === staged.operationId && `https://${deployment.url}` === staged.url,
  'REMINDER_CLOSURE_STAGED_DEPLOYMENT_CHANGED');
  return { baseline, salesforce, mirror: mirrorEvidence, handoverEvidence, stagedDeploymentId: deployment.id,
    stagedArtifactDigest: staged.artifactDigest, observedAt: new Date().toISOString() };
}

export function verifyFreshEvidence({ stamp, evidence }, expectedStamp, manifest) {
  const observed = Date.parse(evidence?.observedAt);
  check(same(stamp, expectedStamp) && observed <= Date.now() && Date.now() - observed < 180_000
    && same(evidence.baseline, manifest.previous) && evidence.mirror?.commit === original.mirrorCommit
    && evidence.mirror.pullRequest === original.mirrorPullRequest && isSha(evidence.mirror.tree)
    && evidence.mirror.sourceTreeHash === original.sourceTreeHash && evidence.stagedDeploymentId === original.stagedDeploymentId
    && evidence.stagedArtifactDigest === original.stagedArtifactDigest && isDigest(evidence.handoverEvidence?.evidenceDigest)
    && orgs.every(name => evidence.salesforce?.inventory?.[name]?.orgId === fcosSalesforceEnvironment(name).orgId
      && isDigest(evidence.salesforce.inventory[name].sha256))
    && isDigest(evidence.salesforce.deveeValidationDigest) && isDigest(evidence.salesforce.deveeDeploymentDigest)
    && evidence.salesforce.failure?.jobId === original.qatValidationId && evidence.salesforce.failure.status === 'Failed'
    && evidence.salesforce.failure.checkOnly === true && isDigest(evidence.salesforce.failure.reportSha256),
  'REMINDER_CLOSURE_FRESH_PREFLIGHT_REQUIRED');
}

async function main(env) {
  const { github, run, handoverRecord } = await verifyExecution(env);
  const phase = env.FCOS_CLOSURE_PHASE;
  check(['preflight', 'append'].includes(phase), 'REMINDER_CLOSURE_PHASE_REQUIRED');
  const journal = reminderClosureJournal(github);
  const closure = await readStoppedReminder(github, journal, run.id);
  const summary = { originalRunId: original.runId, providerMetadataWrites: 0 };
  if (closure.receipt) return { ...summary, receiptId: closure.receipt.id };
  const stamp = { runId: run.id, attempt: 1, source: env.GITHUB_SHA, journalHead: original.head };
  const stampPath = join(env.RUNNER_TEMP, `invoice-reminders-qat-closure-${run.id}-1.json`);
  if (phase === 'preflight') {
    const evidence = await verifyPreimage({ closure, env, handoverRecord });
    writeFileSync(stampPath, JSON.stringify({ stamp, evidence }), { flag: 'wx', mode: 0o600 });
    return { ...summary, preflightVerified: true };
  }
  const saved = JSON.parse(readFileSync(stampPath, 'utf8'));
  verifyFreshEvidence(saved, stamp, closure.manifest);
  // Only the journal can advance between the validated original history and this compare-and-append.
  const read = async () => {
    const boundary = verifyJournalBoundary(await journal.read(), closure.goLive.completed_at);
    return boundary.receipt && boundary.receipt.payload.data.closureRunId !== run.id
      ? readStoppedReminder(github, journal, run.id) : boundary;
  };
  const receipt = await appendReminderClosure({ read, journal, evidenceDigest: digest(saved.evidence), closureRunId: run.id });
  return { ...summary, receiptId: receipt.id };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.env).then(result => console.log(JSON.stringify(result))).catch(error => {
    const code = /^[A-Z0-9_]+$/u.test(error.message) ? error.message : 'REMINDER_CLOSURE_VERIFICATION_FAILED';
    console.error(code);
    process.exitCode = 1;
  });
}
