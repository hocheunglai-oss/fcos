import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';
import { assertAuthorization, digest, git, requireCondition as check, targets, validateManifest } from './lib/rapid-release/contract.mjs';
import { assertFrozenWorkflow, assertPermanentHandover, githubClient, nativeWorkflowPath, vercelProvider } from './lib/rapid-release/providers.mjs';
import { assertNativeHandoverState, nativeCompatibilityReader } from './lib/rapid-release/compatibility.mjs';
import { assertPublicPayload, DeploymentJournal, pendingOperations } from './lib/rapid-release/journal.mjs';
import { failedBootstrapClosure, TRADING_FX_FAILED_BOOTSTRAP } from './lib/rapid-release/trading-fx-failed-bootstrap-closure.mjs';
import { cliSalesforceProvider, loadReviewedSalesforcePlan } from './deploy-salesforce-reviewed-manifest.mjs';
import { verifyReviewedOrgInventory } from './lib/salesforce-reviewed-release.mjs';

const workflow = '.github/workflows/fcos-rapid-bootstrap-failure-recovery.yml';
const candidateSha = '085c7ce8663d16d808771acbbcdc981b9d736b85';
const originalRunId = 43569803059;
const originalManifestHash = '4eee53b351b3b0483b62241bfa64862a412275cc0c02f5b43cbc87d975f25770';
const originalJobId = '0Affu000001ACSLCA4';
const ownerId = 265701760;
const botId = 41898282;
const same = (left, right) => digest(left ?? null) === digest(right ?? null);

async function main(env) {
  const base = '/repos/' + targets().repository;
  check(env.GITHUB_ACTIONS === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted' && env.GITHUB_REPOSITORY === targets().repository,
    'BOOTSTRAP_CLOSURE_TRUSTED_RUNNER_REQUIRED');
  const github = githubClient({ token: env.FCOS_RAPID_CLOSURE_GITHUB_TOKEN, candidateSha, actions: false });
  const { user, repo } = await github.identity();
  check(user.id === ownerId && user.login === targets().account && repo.id === 1278654816 && repo.permissions.admin,
    'BOOTSTRAP_CLOSURE_OWNER_REQUIRED');
  const [native, original, main, pointer] = await Promise.all([
    github.read(base + '/actions/runs/' + env.GITHUB_RUN_ID), github.read(base + '/actions/runs/' + originalRunId),
    github.read(base + '/branches/main'), github.read(base + '/actions/variables/FCOS_RAPID_RELEASE_HANDOVER_ID'),
  ]);
  check(native.status === 'in_progress' && nativeWorkflowPath(native) === workflow && native.actor?.id === ownerId
    && native.event === 'workflow_dispatch' && native.repository.id === repo.id && native.head_branch === repo.default_branch
    && native.head_sha === env.GITHUB_SHA && main.protected && main.commit.sha === env.GITHUB_SHA
    && native.run_attempt === 1 && git(process.cwd(), ['rev-parse', 'HEAD']) === env.GITHUB_SHA && pointer.value === '7784165619',
  'BOOTSTRAP_CLOSURE_EXECUTION_IDENTITY_MISMATCH');
  const recoveryHistory = await github.read(base + '/actions/workflows/' + workflow.split('/').at(-1) + '/runs?event=workflow_dispatch&per_page=100');
  check(recoveryHistory.total_count === 1 && recoveryHistory.workflow_runs?.length === 1
    && recoveryHistory.workflow_runs[0].id === native.id, 'BOOTSTRAP_CLOSURE_ORIGINAL_DISPATCH_READBACK_REQUIRED');
  const originalEndpoint = base + '/actions/runs/' + originalRunId;
  check(original.repository.id === repo.id && original.actor?.id === ownerId && original.event === 'workflow_dispatch'
    && original.status === 'completed' && original.conclusion === 'failure' && original.run_attempt === 1
    && nativeWorkflowPath(original) === '.github/workflows/fcos-rapid-release.yml'
    && original.display_title === 'FCOS rapid resume ' + originalManifestHash + ' ' + candidateSha,
  'BOOTSTRAP_CLOSURE_ORIGINAL_RUN_MISMATCH');
  const [jobs, reviews, deploymentRows] = await Promise.all([
    github.read(originalEndpoint + '/attempts/1/jobs?per_page=100'), github.read(originalEndpoint + '/approvals'),
    github.pages(base + '/deployments?environment=fcos-release-journal-v1&sha=' + candidateSha + '&per_page=100'),
  ]);
  check(jobs.jobs.filter(job => job.name === 'go-live' && job.status === 'completed' && job.conclusion === 'failure').length === 1
    && reviews.some(review => review.state === 'approved' && review.user?.id === ownerId
      && review.environments.some(environment => environment.name === 'fcos-production-release')),
  'BOOTSTRAP_CLOSURE_ORIGINAL_APPROVAL_REQUIRED');
  const prepared = deploymentRows.filter(row => row.creator.id === botId && row.payload.manifestHash === originalManifestHash
    && row.payload.event === 'release.prepared');
  check(prepared.length === 1, 'BOOTSTRAP_CLOSURE_ORIGINAL_RELEASE_REQUIRED');
  const manifest = prepared[0].payload.data.manifest;
  check(validateManifest(manifest) === originalManifestHash && manifest.candidate.sha === candidateSha, 'BOOTSTRAP_CLOSURE_MANIFEST_CHANGED');
  const journal = new DeploymentJournal({ github, releaseId: manifest.releaseId, manifestHash: originalManifestHash, actorIds: [ownerId, botId] });
  const chain = await journal.read();
  const existing = chain.filter(row => row.payload.data?.outcome === TRADING_FX_FAILED_BOOTSTRAP
    || row.payload.data?.terminalOutcome === 'failed_rolled_back');
  check(existing.length <= 2 && existing.every(row => row.creator.id === ownerId)
    && (existing.length === 0 || chain.at(-existing.length).id === existing[0].id),
  'BOOTSTRAP_CLOSURE_EXISTING_RECORD_CHANGED');
  const historical = existing.length ? chain.slice(0, -existing.length) : chain;
  const approval = historical.find(row => row.id === 7784776482 && row.creator.id === botId && row.payload.event === 'approval.accepted');
  const staged = historical.find(row => row.creator.id === botId && row.payload.event === 'stage.result')?.payload.data.result;
  check(approval && staged, 'BOOTSTRAP_CLOSURE_ORIGINAL_APPROVAL_REQUIRED');
  assertAuthorization(approval.payload.data, manifest, staged, Date.parse(approval.created_at));
  const handover = assertPermanentHandover(await github.read(base + '/deployments/' + pointer.value), manifest, ownerId);
  const vercel = vercelProvider({ manifest, env });
  const [baseline] = await Promise.all([
    nativeCompatibilityReader({ provider: vercel, env })({ manifest }),
    assertNativeHandoverState({ handover, env }), assertFrozenWorkflow({ github, controllerSha: manifest.controllerSha, dispatcherSha: original.head_sha }),
  ]);
  check(same(manifest.previous, { sha: baseline.sha, deploymentId: baseline.currentDeploymentId,
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
    const report = provider.report(production, originalJobId);
    const expected = reviewed.nativeInventories.production.baseline;
    const inventory = await verifyReviewedOrgInventory({ provider, environment: production, plan: reviewed, expected });
    const fresh = failedBootstrapClosure({ chain: historical, manifest, runId: originalRunId, report, inventory,
      expectedInventoryHash: expected.inventoryHash, orgId: production.orgId, mirrorReceipt: 7784895642, databaseClosure: 7773043936 });
    if (existing.length) {
      check(existing[0].payload.event === 'prerequisites.result'
        && Object.keys(fresh.result).every(key => key === 'evidenceDigest' || existing[0].payload.data[key] === fresh.result[key]),
      'BOOTSTRAP_CLOSURE_EXISTING_RECORD_CHANGED');
      check(existing.length < 2 || existing[1].payload.event === 'salesforce.checkpoint'
        && existing[1].payload.data.evidenceDigest === existing[0].payload.data.evidenceDigest
        && same(existing[1].payload.data.job, fresh.checkpoint.job), 'BOOTSTRAP_CLOSURE_EXISTING_RECORD_CHANGED');
    }
    return { github, journal, historical, existing, fresh, candidateSha, base };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

export async function appendBootstrapClosure({ github, journal, historical, existing, fresh, candidateSha, base }) {
  const lookup = async payload => {
    const rows = await github.pages(base + '/deployments?environment=fcos-release-journal-v1&sha=' + candidateSha + '&per_page=100');
    const matches = rows.filter(row => row.payload?.recordHash === payload.recordHash);
    check(matches.length <= 1 && matches.every(row => row.creator?.id === ownerId && row.sha === candidateSha && same(row.payload, payload)),
      'BOOTSTRAP_CLOSURE_NATIVE_DUPLICATE');
    return matches[0];
  };
  let previous = historical.at(-1).payload.recordHash;
  const ids = [];
  const pairs = [['prerequisites.result', fresh.result], ['salesforce.checkpoint', fresh.checkpoint]];
  for (const [index, [event, data]] of pairs.entries()) {
    const found = existing[index];
    if (found) {
      check((await lookup(found.payload))?.id === found.id, 'BOOTSTRAP_CLOSURE_EXISTING_RECORD_CHANGED');
      previous = found.payload.recordHash;
      ids.push(found.id);
      continue;
    }
    // Retain the exact evidence from a previously persisted terminal intent.
    const nextData = index === 1 && existing.length === 1
      ? { ...data, evidence: existing[0].payload.data.terminalEvidence, evidenceDigest: existing[0].payload.data.evidenceDigest }
      : index === 0 ? { ...data, terminalEvidence: fresh.checkpoint.evidence } : data;
    check(index === 0 || same(nextData.evidence, fresh.checkpoint.evidence) || (
      digest(nextData.evidence) === nextData.evidenceDigest && same(nextData.evidence.job, fresh.checkpoint.job)
      && nextData.evidence.orgId === fresh.checkpoint.evidence.orgId
      && nextData.evidence.inventoryHash === fresh.checkpoint.evidence.inventoryHash
      && nextData.evidence.terminalStatus === 'Failed' && nextData.evidence.rollbackOnError === true
    ), 'BOOTSTRAP_CLOSURE_PREVIOUS_EVIDENCE_CHANGED');
    const content = { ...historical.at(-1).payload, recordHash: undefined, event, data: nextData,
      previousHash: previous, sequence: historical.length + index };
    const payload = { ...content, recordHash: digest(content) };
    assertPublicPayload(payload);
    const pending = await journal.read();
    check(pending.at(-1).payload.recordHash === previous, 'BOOTSTRAP_CLOSURE_JOURNAL_ADVANCED');
    // This dispatch is admitted once. Resolve an uncertain submission by native readback.
    try { await journal.append(event, nextData, { expectedPreviousHash: previous }); }
    catch { /* Read the exact original provider operation after a missed acknowledgement. */ }
    const saved = await lookup(payload);
    check(saved, 'BOOTSTRAP_CLOSURE_ACKNOWLEDGEMENT_UNCERTAIN');
    previous = saved.payload.recordHash;
    ids.push(saved.id);
  }
  const final = await journal.read();
  check(final.at(-1).payload.recordHash === previous && pendingOperations(final).length === 0, 'BOOTSTRAP_CLOSURE_INCOMPLETE');
  return { originalRunId, closed: true, receiptIds: ids, providerBusinessWrites: 0 };
}

if (process.argv[1]?.endsWith('/rapid-release-bootstrap-failure-recovery.mjs') || process.argv[1] === 'scripts/rapid-release-bootstrap-failure-recovery.mjs') {
  main(process.env).then(appendBootstrapClosure).then(result => console.log(JSON.stringify(result))).catch(error => {
    const code = /^BOOTSTRAP_CLOSURE_[A-Z_]+$/u.test(error.code || error.message) ? error.code || error.message : 'BOOTSTRAP_CLOSURE_READBACK_REQUIRED';
    console.error(code); process.exitCode = 1;
  });
}
