#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { FCOS_CONNECTION_POLICY, fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { cliSalesforceProvider, loadReviewedSalesforcePlan } from './deploy-salesforce-reviewed-manifest.mjs';
import { githubConfigDirectory } from './fcos-connections.mjs';
import { digest, git, requireCondition, targets, validateManifest } from './lib/rapid-release/contract.mjs';
import { verifyReviewedOrgInventory } from './lib/salesforce-reviewed-release.mjs';
import { EDITOR_PREFLIGHT_SOURCE_ENVIRONMENT } from './lib/rapid-release/salesforce-editor-preflight-proof.mjs';
import { createEditorPreflightAttestation, EDITOR_PREFLIGHT_ATTESTATION_ENVIRONMENT, EDITOR_PREFLIGHT_ATTESTATION_TASK,
  hasEditorPreflightLocator, verifyEditorPreflightAttestation } from './lib/rapid-release/salesforce-editor-preflight-transport.mjs';
import { verifySalesforceReviewSource } from './verify-salesforce-review-source.mjs';

const policy = FCOS_CONNECTION_POLICY.providers.find(provider => provider.id === 'salesforce');
const repo = '/repos/' + targets().repository;
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const safeJob = id => typeof id === 'string' && /^0Af[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/u.test(id);

function ownerGitHub(root) {
  const env = { ...process.env, GH_CONFIG_DIR: githubConfigDirectory({ repoRoot: root }), GH_HOST: 'github.com',
    GH_REPO: 'github.com/' + targets().repository, GH_PROMPT_DISABLED: '1' };
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) delete env[key];
  const api = (args, body) => JSON.parse(execFileSync('gh', ['api', ...args], {
    env, input: body && JSON.stringify(body), encoding: 'utf8', timeout: 30_000, maxBuffer: 24 * 1024 * 1024,
    stdio: [body ? 'pipe' : 'ignore', 'pipe', 'ignore'],
  }));
  const github = {
    read: path => api([path]), pages: path => api(['--paginate', '--slurp', path]).flat(),
    write: (path, body) => api([path, '--method', 'POST', '--input', '-'], body),
  };
  const user = github.read('/user'), target = github.read(repo);
  requireCondition(user.id === policy.publication.requiredAccountId && user.login === targets().account
    && target.id === 1278654816 && target.full_name === targets().repository && target.owner?.id === user.id
    && target.permissions?.push === true && !target.archived, 'EDITOR_PREFLIGHT_GITHUB_IDENTITY_MISMATCH');
  return { github, directory: join(dirname(env.GH_CONFIG_DIR), 'editor-preflight-publications') };
}

async function verifyPinnedInputs({ root, candidate, manifest, evidence, github }) {
  verifySalesforceReviewSource({ cwd: candidate, candidateSha: manifest.candidate.sha, manifest, verifierDirectory: root });
  const plan = manifest.prerequisites.plan;
  const reviewed = loadReviewedSalesforcePlan({ cwd: candidate, policy,
    manifestPath: plan.salesforceManifestPath, reviewPath: plan.salesforceReviewPath });
  const frozen = github.read(repo + '/commits/' + manifest.controllerSha);
  const reviewRef = github.read(repo + '/git/ref/heads/codex/fcos-salesforce-review/' + manifest.candidate.sha);
  requireCondition(frozen.sha === manifest.controllerSha && reviewRef.object?.sha === manifest.candidate.sha,
    'EDITOR_PREFLIGHT_PUBLISHED_SOURCE_MISMATCH');
  const live = await fetch(targets().origin + '/app-version.json', { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12_000) });
  requireCondition(live.ok && (await live.json()).commit === manifest.previous.sha, 'EDITOR_PREFLIGHT_BASELINE_CHANGED');
  const native = evidence.nativeEvidence.inventory;
  requireCondition(native.sourceTreeHash === reviewed.binding.sourceTreeHash
    && Object.entries({ ...native.componentFiles, ...native.dependencyFiles })
      .every(([path, file]) => digest(file) === digest(reviewed.finalInventory.files[path] ?? null)),
  'EDITOR_PREFLIGHT_SOURCE_BYTES_MISMATCH');
  const devee = fcosSalesforceEnvironment('devee'), provider = cliSalesforceProvider({ cwd: candidate,
    commandEnvironment: { ...process.env, SF_AUTOUPDATE_DISABLE: 'true', SF_DISABLE_TELEMETRY: 'true' } });
  requireCondition(provider.verifyIdentity(devee).instanceUrl === devee.instanceUrl, 'EDITOR_PREFLIGHT_DEVEE_IDENTITY_MISMATCH');
  const reports = new Map();
  function verifyReport(id, saved) {
    requireCondition(safeJob(id), 'EDITOR_PREFLIGHT_NATIVE_JOB_INVALID');
    if (!reports.has(id)) reports.set(id, provider.report(devee, id));
    requireCondition(saved?.status === 0 && digest(saved.result) === digest(reports.get(id)),
      'EDITOR_PREFLIGHT_NATIVE_JOB_CHANGED');
  }
  verifyReport(evidence.proof.native.validationJobId, evidence.nativeEvidence.validation);
  verifyReport(evidence.proof.native.deploymentJobId, evidence.nativeEvidence.deployment);
  for (const item of evidence.historicalAttestations ?? []) {
    requireCondition(Number.isSafeInteger(item.id) && item.id > 0 && item.environment === EDITOR_PREFLIGHT_SOURCE_ENVIRONMENT,
      'EDITOR_PREFLIGHT_HISTORICAL_RECEIPT_INVALID');
    const original = github.read(repo + '/deployments/' + item.id);
    requireCondition(digest(item) === digest(original), 'EDITOR_PREFLIGHT_HISTORICAL_RECEIPT_CHANGED');
    const saved = evidence.historicalNativeEvidence[item.id];
    verifyReport(original.payload.validationJobId, saved?.validation);
    verifyReport(original.payload.deploymentJobId, saved?.deployment);
  }
  const baseline = reviewed.nativeInventories?.devee?.baseline;
  requireCondition(baseline && evidence.expected.restoration.sourceTreeHash === reviewed.binding.baselineSourceTreeHash
    && evidence.expected.restoration.inventoryHash === baseline.inventoryHash, 'EDITOR_PREFLIGHT_RESTORATION_BASELINE_MISMATCH');
  await verifyReviewedOrgInventory({ provider, environment: devee, plan: reviewed, expected: baseline });
}

function lookup(github, manifest, payload) {
  const path = repo + '/deployments?per_page=100&environment=' + EDITOR_PREFLIGHT_ATTESTATION_ENVIRONMENT
    + '&sha=' + manifest.candidate.sha;
  const proofDigest = digest(payload);
  const matching = github.pages(path).filter(record => digest(record.payload ?? null) === proofDigest);
  requireCondition(matching.length <= 1, 'EDITOR_PREFLIGHT_DUPLICATE_PUBLICATION');
  const [record] = matching;
  if (!record) return null;
  const plan = { ...manifest.prerequisites.plan, editorPreflightReceiptId: record.id, editorPreflightReceiptDigest: proofDigest };
  verifyEditorPreflightAttestation({ manifest: { ...manifest, prerequisites: { ...manifest.prerequisites, plan } }, record });
  return { editorPreflightReceiptId: record.id, editorPreflightReceiptDigest: proofDigest };
}

async function main() {
  const [mode, manifestFile, candidatePath, evidenceFile, ...extra] = process.argv.slice(2);
  requireCondition(['check', 'publish'].includes(mode) && manifestFile && candidatePath && evidenceFile && !extra.length
    && process.env.GITHUB_ACTIONS !== 'true', 'USAGE_EDITOR_PREFLIGHT_MODE_MANIFEST_CANDIDATE_EVIDENCE');
  const root = process.cwd(), candidate = resolve(candidatePath), manifest = read(manifestFile), evidence = read(evidenceFile);
  validateManifest(manifest);
  requireCondition(!hasEditorPreflightLocator(manifest.prerequisites?.plan)
    && git(root, ['rev-parse', 'HEAD']) === manifest.controllerSha
    && !git(root, ['status', '--porcelain', '--untracked-files=normal']), 'EDITOR_PREFLIGHT_FROZEN_CONTROLLER_REQUIRED');
  const payload = createEditorPreflightAttestation({ manifest, proofInput: evidence });
  const { github, directory } = ownerGitHub(root);
  const proofDigest = digest(payload);
  const prior = lookup(github, manifest, payload);
  if (prior) return prior;
  const intent = join(directory, proofDigest + '.intent.json');
  requireCondition(!existsSync(intent), 'EDITOR_PREFLIGHT_PUBLICATION_UNCERTAIN');
  await verifyPinnedInputs({ root, candidate, manifest, evidence, github });
  if (mode === 'check') return { verified: true, editorPreflightReceiptDigest: proofDigest, providerWrites: 0 };
  createEditorPreflightAttestation({ manifest, proofInput: evidence });
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(intent, JSON.stringify({ candidateSha: manifest.candidate.sha, proofDigest, recordedAt: new Date().toISOString() }) + '\n',
      { flag: 'wx', mode: 0o600, flush: true });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const recovered = lookup(github, manifest, payload);
    requireCondition(recovered, 'EDITOR_PREFLIGHT_PUBLICATION_UNCERTAIN');
    return recovered;
  }
  try {
    github.write(repo + '/deployments', { ref: manifest.candidate.sha, task: EDITOR_PREFLIGHT_ATTESTATION_TASK,
      auto_merge: false, required_contexts: [], environment: EDITOR_PREFLIGHT_ATTESTATION_ENVIRONMENT,
      production_environment: false, transient_environment: false, payload });
  } catch { /* An uncertain acknowledgement can only be reconciled by native readback. */ }
  const result = lookup(github, manifest, payload);
  requireCondition(result, 'EDITOR_PREFLIGHT_PUBLICATION_UNCERTAIN');
  return result;
}

main().then(result => console.log(JSON.stringify(result))).catch(error => {
  console.error(/^[A-Z0-9_]+$/u.test(error.code ?? '') ? error.code : 'EDITOR_PREFLIGHT_STOPPED_CHECK_NATIVE_STATE');
  process.exitCode = 1;
});
