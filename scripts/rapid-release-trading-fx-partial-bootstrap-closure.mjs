import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';
import { digest, git, requireCondition as check, targets } from './lib/rapid-release/contract.mjs';
import { assertPermanentHandover, githubClient, nativeWorkflowPath, vercelProvider } from './lib/rapid-release/providers.mjs';
import { assertNativeHandoverState, nativeCompatibilityReader } from './lib/rapid-release/compatibility.mjs';
import { DeploymentJournal } from './lib/rapid-release/journal.mjs';
import {
  buildTradingFxProductionBootstrapClosure, readTradingFxProductionBootstrapClosureState,
  readTradingFxProductionBootstrapClosure, TRADING_FX_PRODUCTION_BOOTSTRAP_PREIMAGE_DIGEST,
} from './lib/rapid-release/trading-fx-production-bootstrap-checkpoint.mjs';
import { verifyTradingFxSalesSupportReadGrants } from './lib/rapid-release/trading-fx-sales-support-transport.mjs';
import { cliSalesforceProvider, loadReviewedSalesforcePlan } from './deploy-salesforce-reviewed-manifest.mjs';
import { assertReviewedJobReport, reviewedJobExpectations, verifyReviewedOrgInventory } from './lib/salesforce-reviewed-release.mjs';

const workflow = '.github/workflows/fcos-rapid-trading-fx-partial-bootstrap-closure.yml';
const candidateSha = 'b495d1bde6d06834c32212982c4597e20e6c7fe0';
const ownerId = 265701760;

async function main(env) {
  const base = '/repos/' + targets().repository;
  check(env.GITHUB_ACTIONS === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted' && env.GITHUB_REPOSITORY === targets().repository,
    'BOOTSTRAP_CLOSURE_TRUSTED_RUNNER_REQUIRED');
  const github = githubClient({ token: env.FCOS_RAPID_CLOSURE_GITHUB_TOKEN, candidateSha, actions: false });
  const { user, repo } = await github.identity();
  check(user.id === ownerId && user.login === targets().account && repo.id === 1278654816 && repo.permissions.admin,
    'BOOTSTRAP_CLOSURE_OWNER_REQUIRED');
  const [native, branch, pointer, history, state] = await Promise.all([
    github.read(base + '/actions/runs/' + env.GITHUB_RUN_ID),
    github.read(base + '/branches/main'),
    github.read(base + '/actions/variables/FCOS_RAPID_RELEASE_HANDOVER_ID'),
    github.read(base + '/actions/workflows/' + workflow.split('/').at(-1) + '/runs?event=workflow_dispatch&per_page=100'),
    readTradingFxProductionBootstrapClosureState({ github }),
  ]);
  check(native.status === 'in_progress' && nativeWorkflowPath(native) === workflow
    && native.actor?.id === ownerId && native.triggering_actor?.id === ownerId
    && native.event === 'workflow_dispatch' && native.repository.id === repo.id && native.head_branch === repo.default_branch
    && native.head_sha === env.GITHUB_SHA && branch.protected && branch.commit.sha === env.GITHUB_SHA
    && String(native.run_attempt) === env.GITHUB_RUN_ATTEMPT && git(process.cwd(), ['rev-parse', 'HEAD']) === env.GITHUB_SHA
    && pointer.value === '7791036696' && history.total_count === 1 && history.workflow_runs?.[0]?.id === native.id,
  'BOOTSTRAP_CLOSURE_EXECUTION_IDENTITY_MISMATCH');

  const { checkpoint, receipt: existing } = state;
  if (existing) return { originalRunId: checkpoint.runId, receiptId: existing.id, closedPartialOutcome: true, providerBusinessWrites: 0 };
  const stampPath = join(env.RUNNER_TEMP, 'fcos-trading-fx-bootstrap-preflight-' + native.id + '-' + native.run_attempt + '.json');
  const stamp = { nativeRunId: native.id, nativeAttempt: native.run_attempt, source: env.GITHUB_SHA,
    manifestHash: checkpoint.manifestHash, journalHead: checkpoint.lastRecordHash };
  if (env.FCOS_CLOSURE_PHASE === 'append') {
    const { verifiedAt, ...record } = JSON.parse(readFileSync(stampPath, 'utf8'));
    check(digest(record) === digest(stamp) && Number.isFinite(Date.parse(verifiedAt))
      && Date.now() - Date.parse(verifiedAt) < 180000 && Date.now() >= Date.parse(verifiedAt),
    'BOOTSTRAP_CLOSURE_PREFLIGHT_REQUIRED');
    return appendClosure({ github, checkpoint });
  }
  check(env.FCOS_CLOSURE_PHASE === 'preflight', 'BOOTSTRAP_CLOSURE_PHASE_REQUIRED');
  for (let attempt = 1; attempt < native.run_attempt; attempt++) {
    const previous = await github.read(base + '/actions/runs/' + native.id + '/attempts/' + attempt + '/jobs?per_page=100');
    const job = previous.jobs?.find(job => job.name === 'close-partial-bootstrap' && job.run_attempt === attempt);
    const step = job?.steps?.find(item => item.name === 'Append terminal partial outcome');
    check(job?.status === 'completed' && step?.conclusion === 'skipped', 'BOOTSTRAP_CLOSURE_ACKNOWLEDGEMENT_UNCERTAIN');
  }

  const manifest = checkpoint.prior;
  const handover = assertPermanentHandover(await github.read(base + '/deployments/' + pointer.value), manifest, ownerId);
  const vercel = vercelProvider({ manifest, env });
  const [baseline] = await Promise.all([
    nativeCompatibilityReader({ provider: vercel, env })({ manifest }),
    assertNativeHandoverState({ handover, env }),
  ]);
  check(digest(manifest.previous) === digest({ sha: baseline.sha, deploymentId: baseline.currentDeploymentId,
    configurationDigest: baseline.configurationDigest, schemaDigest: baseline.schemaDigest }), 'BOOTSTRAP_CLOSURE_PRODUCTION_CHANGED');

  const policy = FCOS_CONNECTION_POLICY.providers.find(provider => provider.id === 'salesforce');
  const production = policy.environments.find(environment => environment.key === 'production');
  const directory = mkdtempSync(join(tmpdir(), 'fcos-failed-bootstrap-'));
  try {
    const key = join(directory, 'production.pem');
    check(env.FCOS_RAPID_SALESFORCE_PRODUCTION_PRIVATE_KEY && env.FCOS_RAPID_SALESFORCE_PRODUCTION_CLIENT_ID,
      'BOOTSTRAP_CLOSURE_SALESFORCE_CREDENTIAL_REQUIRED');
    writeFileSync(key, env.FCOS_RAPID_SALESFORCE_PRODUCTION_PRIVATE_KEY, { flag: 'wx', mode: 0o600 });
    chmodSync(directory, 0o700);
    const sfEnv = { PATH: env.PATH, HOME: directory, SF_DISABLE_AUTOUPDATE: 'true', SF_DISABLE_TELEMETRY: 'true', SF_USE_GENERIC_UNIX_KEYCHAIN: 'true' };
    const sf = (...args) => {
      const buffer = execFileSync('sf', [...args, '--json'], { env: sfEnv, stdio: ['ignore','pipe','pipe'], timeout: 90000 });
      try {
        const response = JSON.parse(buffer);
        check(response.status === 0, 'BOOTSTRAP_CLOSURE_SALESFORCE_READ_FAILED');
        return response.result;
      } finally { buffer.fill(0); }
    };
    const login = sf('org', 'login', 'jwt', '--username', production.username, '--client-id',
      env.FCOS_RAPID_SALESFORCE_PRODUCTION_CLIENT_ID, '--jwt-key-file', key, '--instance-url', production.instanceUrl, '--alias', production.alias);
    check(login.orgId === production.orgId && login.username === production.username && login.instanceUrl === production.instanceUrl,
      'BOOTSTRAP_CLOSURE_SALESFORCE_IDENTITY_MISMATCH');
    const cwd = join(process.cwd(), 'original-application');
    check(git(cwd, ['rev-parse', 'HEAD']) === candidateSha && !git(cwd, ['status', '--porcelain']), 'BOOTSTRAP_CLOSURE_SOURCE_CHANGED');
    const input = manifest.prerequisites.plan;
    const reviewed = loadReviewedSalesforcePlan({ cwd, policy, manifestPath: input.salesforceManifestPath, reviewPath: input.salesforceReviewPath });
    check(reviewed.fingerprint === input.salesforceFingerprint, 'BOOTSTRAP_CLOSURE_SALESFORCE_SCOPE_CHANGED');
    const provider = cliSalesforceProvider({ cwd, policy, commandEnvironment: sfEnv });
    const identity = provider.verifyIdentity(production);
    check(identity.id === production.orgId, 'BOOTSTRAP_CLOSURE_SALESFORCE_IDENTITY_MISMATCH');
    const original = checkpoint.salesforceOperations.at(-1).job;
    const packageReadback = await provider.prepareBootstrap(production, reviewed);
    try {
      check(packageReadback.packageSha256 === original.packageSha256, 'BOOTSTRAP_CLOSURE_PACKAGE_CHANGED');
    } finally { await packageReadback.cleanup(); }
    const report = await provider.report(production, original.id);
    assertReviewedJobReport(report, { environment: production, jobId: original.id,
      ...reviewedJobExpectations(reviewed, production, 'bootstrap') });
    await verifyReviewedOrgInventory({ provider, environment: production, plan: reviewed,
      expected: reviewed.nativeInventories.production.bootstrap, profileRecovery: 'before-correction' });
    await verifyTradingFxSalesSupportReadGrants({ cwd, commandEnvironment: sfEnv, read: true });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }

  writeFileSync(stampPath, JSON.stringify({ ...stamp, verifiedAt: new Date().toISOString() }), { mode: 0o600, flag: 'wx' });
  return { originalRunId: checkpoint.runId, preflightVerified: true, providerBusinessWrites: 0 };
}

async function appendClosure({ github, checkpoint }) {
  const journal = new DeploymentJournal({ github, releaseId: checkpoint.prior.releaseId, manifestHash: checkpoint.manifestHash,
    actorIds: [ownerId, 41898282] });
  const { result, expectedPreviousHash } = buildTradingFxProductionBootstrapClosure({
    checkpoint, productionPreimageEvidenceDigest: TRADING_FX_PRODUCTION_BOOTSTRAP_PREIMAGE_DIGEST,
  });
  let receipt;
  try { receipt = await journal.append('prerequisites.result', result, { expectedPreviousHash }); }
  catch {
    // Resolve the original append only. An uncertain write never submits again.
    const head = (await journal.read()).at(-1);
    check(head?.payload.event === 'prerequisites.result' && digest(head.payload.data) === digest(result)
      && head.payload.previousHash === expectedPreviousHash, 'BOOTSTRAP_CLOSURE_ACKNOWLEDGEMENT_UNCERTAIN');
    receipt = head;
  }
  await readTradingFxProductionBootstrapClosure({ github, receiptId: receipt.id });
  return { originalRunId: checkpoint.runId, receiptId: receipt.id, closedPartialOutcome: true, providerBusinessWrites: 0 };
}

main(process.env).then(result => console.log(JSON.stringify(result))).catch(error => {
  const code = error?.code || error?.message;
  console.error(/^(?:BOOTSTRAP_CLOSURE|TRADING_FX)_[A-Z_]+$/u.test(code) ? code : 'BOOTSTRAP_CLOSURE_READBACK_REQUIRED');
  process.exitCode = 1;
});
