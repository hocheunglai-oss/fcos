import { writeFileSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DefaultArtifactClient } from '@actions/artifact';
import { githubReleaseReads, assertReleaseGitHubAccount, RELEASE_REPOSITORY } from './release-evidence.mjs';
import { githubReleaseOidc } from './release-production.mjs';
import { assertReleaseReceiptBinding } from './release-readiness.mjs';
import { decodePreviewCoordinationArchive } from './preview-email-coordination-archive.mjs';
import { RELEASE_COORDINATION_ROUTES, RELEASE_COORDINATION_FILE, releaseCoordinationArtifact, releaseCoordinationVariable,
  validateReleaseCoordinationBinding, releaseCoordinationDeadline, releaseCoordinationEvidenceDeadline, verifyReleaseCoordinationGrant, coordinationDigest, coordinationEqual, releaseCoordinationFailure } from './release-coordination.mjs';
import { releaseCoordinationRows, assertReleaseCoordinationTrust, assertReleaseCoordinationIntent } from './release-coordination-trust.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url)), base = `repos/${RELEASE_REPOSITORY}`;
const capabilities = new WeakMap();
let started = false;
const need = value => { if (!value) releaseCoordinationFailure(); };
const fixedReads = hosted => githubReleaseReads({ command: hosted ? '/usr/bin/gh' : '/Users/vincex/.local/gh/current/bin/gh', env: {
  PATH: '/usr/bin:/bin', HOME: process.env.HOME, GH_HOST: 'github.com', GH_REPO: RELEASE_REPOSITORY,
  ...(hosted ? { GH_TOKEN: process.env.GH_TOKEN } : { GH_CONFIG_DIR: '/Users/vincex/Documents/FCOS/.fcos-cli/github' }),
} }, { cwd: ROOT });
export function collectReleaseCoordinationPublic(reads, runId, routeName) {
  const route = RELEASE_COORDINATION_ROUTES[routeName]; need(route && Number.isSafeInteger(runId) && runId > 0);
  const repository = reads.json(base), branch = reads.json(`${base}/branches/${encodeURIComponent(repository.default_branch)}`);
  return { repository, branch, protection: reads.json(`${base}/branches/${encodeURIComponent(repository.default_branch)}/protection`),
    environment: reads.json(`${base}/environments/${route.environment}`), variables: reads.json(`${base}/environments/${route.environment}/variables?per_page=100`),
    run: reads.json(`${base}/actions/runs/${runId}`), jobs: reads.json(`${base}/actions/runs/${runId}/attempts/1/jobs?per_page=100`),
    approvals: reads.json(`${base}/actions/runs/${runId}/approvals`) };
}
function artifacts(reads, b) { return releaseCoordinationRows(reads.json(`${base}/actions/runs/${b.runId}/artifacts?per_page=100`), 'artifacts'); }
export function readReleaseCoordinationArtifact(reads, b, phase) {
  const rows = artifacts(reads, b).filter(r => r.name === releaseCoordinationArtifact(b, phase));
  need(rows.length === 1); const artifact = rows[0];
  need(Number.isSafeInteger(artifact.id) && artifact.id > 0 && artifact.expired === false && artifact.workflow_run?.id === b.runId
    && artifact.workflow_run.head_sha === b.harnessSha && Date.parse(artifact.created_at) >= b.jobStartedAt - 1000
    && Date.parse(artifact.created_at) >= b.intentAt - 1000 && Date.parse(artifact.created_at) <= Date.now() + 30000);
  const archive = reads.archive(`${base}/actions/artifacts/${artifact.id}/zip`);
  need(artifact.digest === `sha256:${coordinationDigest(archive)}`);
  return { artifactId: artifact.id, archiveSha256: coordinationDigest(archive), payload: decodePreviewCoordinationArchive(archive) };
}
async function upload(reads, b, phase, payload) {
  need(!artifacts(reads, b).some(r => r.name === releaseCoordinationArtifact(b, phase)));
  const directory = mkdtempSync(join(tmpdir(), 'fcos-release-coordination-'));
  const stdout = process.stdout.write, stderr = process.stderr.write; let result;
  try {
    const path = join(directory, RELEASE_COORDINATION_FILE); writeFileSync(path, `${JSON.stringify(payload)}\n`, { mode: 0o600, flag: 'wx', flush: true });
    process.stdout.write = () => true; process.stderr.write = () => true;
    // One create-only SDK invocation. Its internal service retries are not a new action authorization.
    result = await new DefaultArtifactClient().uploadArtifact(releaseCoordinationArtifact(b, phase), [path], directory, { retentionDays: 30, compressionLevel: 0 });
  } catch { releaseCoordinationFailure(); }
  finally { process.stdout.write = stdout; process.stderr.write = stderr; rmSync(directory, { recursive: true, force: true }); }
  const actual = readReleaseCoordinationArtifact(reads, b, phase);
  need(result?.id === actual.artifactId && result.digest === actual.archiveSha256 && coordinationEqual(actual.payload, payload));
  return actual;
}
function hosted(routeName) {
  const env = process.env, route = RELEASE_COORDINATION_ROUTES[routeName], workspace = resolve(env.GITHUB_WORKSPACE || '/');
  need(route && env.GITHUB_ACTIONS === 'true' && env.GITHUB_REPOSITORY === RELEASE_REPOSITORY && env.GITHUB_RUN_ATTEMPT === '1'
    && env.GITHUB_JOB === route.job && realpathSync(ROOT) === join(workspace, 'trusted') && env.GH_TOKEN
    && realpathSync(env.FCOS_RELEASE_SOURCE_DIRECTORY || '/') === join(workspace, 'candidate'));
  return Number(env.GITHUB_RUN_ID);
}
async function recheck(context, readiness) {
  const { binding: b, reads, text } = context; need(hosted(b.route) === b.runId);
  assertReleaseReceiptBinding(readiness, b.candidate);
  need(coordinationEqual(readiness.candidate, b.candidate) && coordinationEqual(readiness.previousProduction, b.previousProduction)
    && coordinationDigest(readiness) === b.readinessSha256 && releaseCoordinationEvidenceDeadline(readiness) === b.evidenceExpiresAt);
  const actual = collectReleaseCoordinationPublic(reads, b.runId, b.route), trusted = assertReleaseCoordinationTrust({ ...actual, binding: b });
  const claims = await githubReleaseOidc({ env: process.env });
  need(claims.repository_id === String(b.repositoryId) && claims.repository === RELEASE_REPOSITORY && claims.run_id === String(b.runId)
    && claims.run_attempt === '1' && claims.workflow_sha === b.harnessSha && claims.sha === b.harnessSha
    && claims.ref === `refs/heads/${actual.repository.default_branch}` && claims.event_name === 'workflow_dispatch'
    && claims.sub === `repo:${RELEASE_REPOSITORY}:environment:${trusted.route.environment}`
    && claims.workflow_ref === `${RELEASE_REPOSITORY}/${trusted.route.workflow}@refs/heads/${actual.repository.default_branch}`);
  if (text) need(trusted.variable(releaseCoordinationVariable(b)) === text);
  if (text) verifyReleaseCoordinationGrant(text, b);
  for (const phase of ['intent', 'consumed']) if (context[phase]) {
    need(coordinationEqual(readReleaseCoordinationArtifact(reads, b, phase), context[phase]));
  }
  // Network reads never renew the original grant or evidence clock.
  validateReleaseCoordinationBinding(b); releaseCoordinationEvidenceDeadline(readiness);
  if (text) verifyReleaseCoordinationGrant(text, b);
  return trusted;
}
/** Fixed protected constructor. No caller transport, key, clock or accepted flag. */
export async function collectHostedReleaseCoordination({ route, readiness }) {
  need(!started); started = true;
  const runId = hosted(route), reads = fixedReads(true); assertReleaseGitHubAccount(reads);
  assertReleaseReceiptBinding(readiness, readiness?.candidate);
  const actual = collectReleaseCoordinationPublic(reads, runId, route), jobs = releaseCoordinationRows(actual.jobs, 'jobs'); need(jobs.length === 1);
  const binding = validateReleaseCoordinationBinding({ schemaVersion: 1, route, repositoryId: actual.repository.id, environmentId: actual.environment.id,
    runId, runAttempt: 1, jobId: jobs[0].id, harnessSha: actual.branch.commit.sha, operationId: `fcos-release-${runId}`,
    dispatchedAt: Date.parse(actual.run.run_started_at), jobStartedAt: Date.parse(jobs[0].started_at), intentAt: Date.now(), readinessAt: Date.parse(readiness.capturedAt),
    evidenceExpiresAt: releaseCoordinationEvidenceDeadline(readiness), candidate: readiness.candidate, previousProduction: readiness.previousProduction, readinessSha256: coordinationDigest(readiness) });
  const context = { binding, reads }; await recheck(context, readiness);
  const intent = await upload(reads, binding, 'intent', { kind: 'fcos_production_coordination_intent', binding });
  context.intent = intent;
  // The root coordinator can prepare/issue while the same approved protected job waits.
  // Expiry always comes from the original run and evidence; waiting never renews it.
  const deadline = releaseCoordinationDeadline(binding);
  let text;
  while (Date.now() < deadline) {
    const rows = releaseCoordinationRows(reads.json(`${base}/environments/${RELEASE_COORDINATION_ROUTES[route].environment}/variables?per_page=100`), 'variables');
    text = rows.find(r => r.name === releaseCoordinationVariable(binding))?.value;
    if (text !== undefined) break;
    await new Promise(done => setTimeout(done, 10000));
  }
  need(typeof text === 'string'); context.text = text;
  const verified = verifyReleaseCoordinationGrant(text, binding);
  need(verified.grant.intentArtifactId === intent.artifactId && verified.grant.intentArchiveSha256 === intent.archiveSha256);
  await recheck(context, readiness);
  const claim = await upload(reads, binding, 'consumed', { kind: 'fcos_production_coordination_consumption', binding,
    grantSha256: verified.envelopeSha256, consumptionSha256: verified.grant.consumptionSha256, leaseId: verified.grant.lease.leaseId,
    possibleSubmission: true, replayForbidden: true });
  context.consumed = claim;
  await recheck(context, readiness);
  const capability = Object.freeze({ kind: 'fcos_collected_production_coordination', leaseId: verified.grant.lease.leaseId,
    grantSha256: verified.envelopeSha256, expiresAt: verified.grant.expiresAt, artifactId: claim.artifactId, archiveSha256: claim.archiveSha256 });
  capabilities.set(capability, { ...context, readiness, phase: 'claimed' }); return capability;
}
export function releaseCoordinationVerified(capability, readiness) {
  const c = capabilities.get(capability);
  try { return !!c && validateReleaseCoordinationBinding(c.binding) && coordinationDigest(readiness) === c.binding.readinessSha256; } catch { return false; }
}
export async function consumeReleaseCoordination(capability, readiness, phase) {
  const c = capabilities.get(capability); need(c && releaseCoordinationVerified(capability, readiness));
  need(phase === 'stage' && c.phase === 'claimed' || phase === 'promote' && c.phase === 'staged');
  c.phase = `${phase}_checking`; // Consume before the first await; concurrent calls and failed rechecks never retry.
  await recheck(c, readiness); c.phase = phase === 'stage' ? 'staged' : 'promoted';
  return { ...capability, coordinationOnly: true, providerAuthorityGranted: false };
}
/** Local collector is read-only; the issuer adds source/action admission before calling it. */
export function collectLocalReleaseCoordination(runId, route) {
  need(process.platform === 'darwin' && Number.isSafeInteger(runId) && runId > 0 && RELEASE_COORDINATION_ROUTES[route]);
  const reads = fixedReads(false); assertReleaseGitHubAccount(reads);
  const actual = collectReleaseCoordinationPublic(reads, runId, route);
  need(actual.repository.permissions?.admin === true);
  const rows = releaseCoordinationRows(reads.json(`${base}/actions/runs/${runId}/artifacts?per_page=100`), 'artifacts');
  const named = rows.filter(r => r.name === `fcos-release-coordination-intent-${runId}`); need(named.length === 1);
  const archive = reads.archive(`${base}/actions/artifacts/${named[0].id}/zip`); need(named[0].digest === `sha256:${coordinationDigest(archive)}`);
  const payload = decodePreviewCoordinationArchive(archive), b = validateReleaseCoordinationBinding(payload?.binding);
  need(b.runId === runId && b.route === route); assertReleaseCoordinationIntent(payload, b);
  const original = readReleaseCoordinationArtifact(reads, b, 'intent'), trusted = assertReleaseCoordinationTrust({ ...actual, binding: b });
  need(original.artifactId === named[0].id && original.archiveSha256 === coordinationDigest(archive)
    && trusted.variable(releaseCoordinationVariable(b)) === undefined && !rows.some(r => r.name === releaseCoordinationArtifact(b, 'consumed')));
  return { binding: b, intentArtifactId: original.artifactId, intentArchiveSha256: original.archiveSha256, reviewerId: trusted.reviewerId };
}
