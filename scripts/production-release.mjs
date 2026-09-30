import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FCOS_CONNECTION_POLICY, fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { collectParitySource, collectPreviewParity, collectRuntimeObservation } from './collect-preview-parity.mjs';
import { createReleaseReadiness, releaseHash, releaseConfigurationRevision } from './lib/release-readiness.mjs';
import { assertProductionProtection, githubReleaseReads, RELEASE_REPOSITORY, PRODUCTION_ENVIRONMENT, PRODUCTION_WORKFLOW } from './lib/release-evidence.mjs';
import { assertVercelProductionAuthority, assertProductionRuntimeReadback, executeProductionRelease, githubReleaseOidc, readVercelTokenMetadata } from './lib/release-production.mjs';
import { canonicalFcosE2eCandidateUrl } from './verify-e2e-candidate.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const teamId = fcosConnectionIdentifier('vercel', 'Team ID'), projectId = fcosConnectionIdentifier('vercel', 'Project ID');
const productionOrigin = new URL(FCOS_CONNECTION_POLICY.attestation.endpoint).origin;

export function productionReleaseArguments(args, env = process.env) {
  const parsed = { mode: 'dry-run', cwd: resolve(env.FCOS_RELEASE_SOURCE_DIRECTORY || ROOT), expectedCommit: env.FCOS_E2E_EXPECTED_COMMIT,
    candidateUrl: env.FCOS_E2E_CANDIDATE_URL };
  if (args.length > 1 || args.some(arg => !['--execute', '--preflight', '--dry-run'].includes(arg))) throw new Error('Production supports one mode only: --dry-run (default), --preflight, or protected --execute.');
  if (args[0]) parsed.mode = args[0].slice(2);
  return parsed;
}

function command(binary, args, { cwd, env, binaryOutput = false, timeout = 30000 } = {}) {
  try { return execFileSync(binary, args, { cwd, env, timeout, maxBuffer: 8 * 1024 * 1024,
    ...(binaryOutput ? {} : { encoding: 'utf8' }), stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch { throw new Error('Pinned release command failed; credential-bearing diagnostics suppressed.'); }
}

export async function runProductionRelease({ mode = 'dry-run', cwd = ROOT, expectedCommit, candidateUrl, env = process.env } = {}) {
  if (mode === 'dry-run') return { schemaVersion: 1, mode, productionAuthorized: false, operations: [
    'Verify protected default workflow, dedicated environment, independent human approval and signed Actions identity.',
    'Recollect exact-commit Preview parity, quality source and trusted workflow artifacts.',
    'Build source with Production settings using deploy --prod --skip-domain.',
    'Verify READY, source digest, runtime provider targets and read-only health.',
    'Assign domains to that staged Production deployment and verify public readback.',
  ], blockers: ['PRODUCTION_ACTIVATION_REQUIRES_SEPARATE_REVIEW'], mutations: 0 };
  if (!['preflight', 'execute'].includes(mode) || !/^[0-9a-f]{40}$/.test(expectedCommit || '')) throw new Error('An exact reviewed candidate SHA is required.');
  canonicalFcosE2eCandidateUrl(candidateUrl);
  const source = collectParitySource(cwd), lockHash = releaseHash(readFileSync(join(cwd, 'package-lock.json'))), configurationRevision = releaseConfigurationRevision(cwd);
  if (source.candidateHead !== expectedCommit) throw new Error('Reviewed release checkout differs from the requested exact candidate.');
  const claims = await githubReleaseOidc({ env });
  const ghEnv = { PATH: env.PATH, HOME: env.HOME, GH_HOST: 'github.com', GH_TOKEN: env.GH_TOKEN || env.GITHUB_TOKEN, GH_REPO: RELEASE_REPOSITORY };
  const reads = githubReleaseReads({ command: 'gh', env: ghEnv }, { cwd });
  const repository = reads.json(`repos/${RELEASE_REPOSITORY}`);
  const branch = reads.json(`repos/${RELEASE_REPOSITORY}/branches/${encodeURIComponent(repository.default_branch)}`);
  const protection = reads.json(`repos/${RELEASE_REPOSITORY}/branches/${encodeURIComponent(repository.default_branch)}/protection`);
  if (claims.repository !== RELEASE_REPOSITORY || claims.repository_id !== String(repository.id)
    || claims.workflow_ref !== `${RELEASE_REPOSITORY}/${PRODUCTION_WORKFLOW}@refs/heads/${repository.default_branch}`
    || claims.workflow_sha !== branch.commit?.sha || claims.sha !== branch.commit?.sha || claims.ref !== `refs/heads/${repository.default_branch}`) throw new Error('Release operations must execute from the current protected default-branch workflow.');
  const context = () => ({ repository, branch, protection,
    environment: reads.json(`repos/${RELEASE_REPOSITORY}/environments/${PRODUCTION_ENVIRONMENT}`),
    variables: reads.json(`repos/${RELEASE_REPOSITORY}/environments/${PRODUCTION_ENVIRONMENT}/variables?per_page=100`),
    secrets: reads.json(`repos/${RELEASE_REPOSITORY}/environments/${PRODUCTION_ENVIRONMENT}/secrets?per_page=100`),
    expectedCommit, sourceDigest: source.hashes.application, configurationRevision });
  if (mode === 'preflight') {
    assertProductionProtection({ ...context(), approvalRequired: false });
    return { schemaVersion: 1, mode, candidateSha: expectedCommit, sourceDigest: source.hashes.application, lockHash,
      configurationRevision, workflowSha: branch.commit.sha, environment: PRODUCTION_ENVIRONMENT, protectionsVerified: true,
      productionAuthorized: false, mutations: 0 };
  }
  if (reads.json('user').login !== fcosConnectionIdentifier('github', 'Required account')) throw new Error('Dedicated release GitHub token must belong to the required account.');
  const vercelEnv = { PATH: env.PATH, HOME: env.HOME, CI: '1', NO_COLOR: '1', VERCEL_TOKEN: env.VERCEL_TOKEN,
    VERCEL_ORG_ID: teamId, VERCEL_PROJECT_ID: projectId };
  if (!vercelEnv.VERCEL_TOKEN) throw new Error('Dedicated Production Vercel credential is unavailable.');
  const vercelRuntime = { command: 'vercel', env: vercelEnv, injectedArgs: ['--scope', fcosConnectionIdentifier('vercel', 'Team'), '--cwd', cwd, '--no-color'] };
  const cli = args => command('vercel', [...args, ...vercelRuntime.injectedArgs], { cwd, env: vercelEnv });
  const cliVersion = cli(['--version']).trim().replace(/^Vercel CLI /i, '');
  if (cliVersion !== '54.20.1') throw new Error('The reviewed pinned Vercel CLI is required.');
  const api = path => JSON.parse(cli(['api', `${path}${path.includes('?') ? '&' : '?'}teamId=${teamId}`, '--method', 'GET', '--raw']));
  const project = () => api(`/v9/projects/${projectId}`);
  const deploymentConfiguration = JSON.parse(readFileSync(join(cwd, 'vercel.json'), 'utf8'));
  let vercelProof;
  const authority = async () => {
    // Re-read every authority input at each consequential boundary.
    const updatedContext = context();
    const refreshedRepository = reads.json(`repos/${RELEASE_REPOSITORY}`);
    updatedContext.repository = refreshedRepository;
    updatedContext.branch = reads.json(`repos/${RELEASE_REPOSITORY}/branches/${encodeURIComponent(refreshedRepository.default_branch)}`);
    updatedContext.protection = reads.json(`repos/${RELEASE_REPOSITORY}/branches/${encodeURIComponent(refreshedRepository.default_branch)}/protection`);
    const runId = Number(claims.run_id);
    const approved = assertProductionProtection({ ...updatedContext, run: reads.json(`repos/${RELEASE_REPOSITORY}/actions/runs/${runId}`),
      approvals: reads.json(`repos/${RELEASE_REPOSITORY}/actions/runs/${runId}/approvals`), oidcClaims: await githubReleaseOidc({ env }) });
    const pinnedToken = updatedContext.variables.variables?.find(row => row.name === 'FCOS_RELEASE_VERCEL_TOKEN_ID')?.value;
    const user = api('/v2/user').user;
    if (user?.username !== fcosConnectionIdentifier('vercel', 'Account')) throw new Error('Production Vercel account mismatch.');
    const team = api(`/v2/teams/${teamId}`);
    if (team?.id !== teamId || team?.slug !== fcosConnectionIdentifier('vercel', 'Team')) throw new Error('Production Vercel team mismatch.');
    const projectDetails = project();
    vercelProof = assertVercelProductionAuthority({ user, team, project: projectDetails,
      token: await readVercelTokenMetadata({ cliRead: api, token: env.VERCEL_TOKEN }), reviewedTokenId: pinnedToken, deploymentConfiguration,
      hooks: projectDetails.link?.deployHooks });
    if (collectParitySource(cwd).hashes.application !== source.hashes.application || releaseConfigurationRevision(cwd) !== configurationRevision) throw new Error('Source or release configuration changed after human review.');
    return approved;
  };
  await authority();
  const connections = { verifyProvider: async provider => provider === 'vercel' ? { ...vercelProof,
    cliVersion, cliVersionStatus: 'approved', observationMode: 'live', freshness: 'current', observedAt: new Date().toISOString() } : {
    identityVerified: true, targetPin: 'verified', permissions: ['repository.read'] },
  providerRuntime: provider => provider === 'vercel' ? vercelRuntime : { command: 'gh', env: ghEnv, injectedArgs: [] } };
  const parity = await collectPreviewParity({ candidateUrl, expectedCommit, cwd, connections, protectionBypass: env.FCOS_E2E_VERCEL_BYPASS,
    productionRuntimeToken: env.FCOS_RELEASE_RUNTIME_TOKEN, candidateRuntimeToken: env.FCOS_RELEASE_PREVIEW_RUNTIME_TOKEN });
  const readiness = createReleaseReadiness({ source, candidate: parity.candidate, production: parity.production, parity, evidence: parity.trustedEvidence,
    quality: parity.quality, lockHash, configurationRevision });
  if (!readiness.ready) throw new Error(`Release remains blocked (${readiness.blockers.length} independently collected blockers).`);
  const directory = resolve(env.RUNNER_TEMP || '');
  if (!env.RUNNER_TEMP || directory === cwd || directory === '/') throw new Error('A private runner journal directory is required.');
  const journalPath = join(directory, `fcos-production-release-${claims.run_id}.jsonl`);
  if (existsSync(journalPath)) throw new Error('Release journal already exists. Inspect prior outcomes; this command cannot blindly resume or repeat a mutation.');
  const journal = async (entry, { first = false } = {}) => {
    const text = `${JSON.stringify(entry)}\n`;
    if (first) writeFileSync(journalPath, text, { mode: 0o600, flag: 'wx', flush: true });
    else appendFileSync(journalPath, text, { mode: 0o600, flush: true });
  };
  const parseDeployment = record => ({ id: record.id, url: `https://${record.url}`, sha: record.meta?.githubCommitSha,
    target: record.target, state: record.readyState,
    createdAt: record.createdAt, operationId: record.meta?.fcosReleaseOperation });
  const currentProduction = async () => parseDeployment(api(`/v13/deployments/${project().targets?.production?.id}`));
  const verifyDeployment = async reference => {
    const raw = api(`/v13/deployments/${reference}`);
    if (raw.projectId !== projectId || raw.teamId && raw.teamId !== teamId || raw.target !== 'production') throw new Error('Staged deployment belongs to another target.');
    return parseDeployment(raw);
  };
  const probe = async (deployment, report, { publicDomain = false } = {}) => {
    const url = canonicalFcosE2eCandidateUrl(deployment.url);
    const origin = publicDomain ? productionOrigin : url;
    const response = await fetch(`${origin}/app-version.json`, { redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok || response.redirected) throw new Error('Production artifact readback failed.');
    const version = await response.json();
    if (version.commit !== report.candidate.sha || version.provenance?.sourceDigest !== report.candidate.sourceDigest
      || version.provenance?.releaseEligible !== true || version.deploymentId !== deployment.id) throw new Error('Production artifact readback differs from the reviewed source or staged deployment.');
    const runtime = await collectRuntimeObservation({ url, deployment, sourceDigest: report.candidate.sourceDigest, token: env.FCOS_RELEASE_RUNTIME_TOKEN });
    assertProductionRuntimeReadback(runtime, parity);
  };
  mkdirSync(join(cwd, '.vercel'), { recursive: true, mode: 0o700 });
  writeFileSync(join(cwd, '.vercel/project.json'), `${JSON.stringify({ projectId, orgId: teamId, projectName: fcosConnectionIdentifier('vercel', 'Project') })}\n`, { mode: 0o600, flag: 'wx' });
  return executeProductionRelease({ readiness, authority, journal, currentProduction, probe,
    deploy: async args => { const output = cli(args).trim(); const url = canonicalFcosE2eCandidateUrl(output); return verifyDeployment(new URL(url).hostname); },
    discover: async operationId => {
      const list = api(`/v6/deployments?projectId=${projectId}&limit=20`).deployments || [];
      const matches = list.filter(row => row.meta?.fcosReleaseOperation === operationId && row.meta?.githubCommitSha === expectedCommit);
      if (matches.length !== 1) return null;
      return verifyDeployment(matches[0].uid || matches[0].id);
    },
    waitReady: async deployment => {
      const deadline = Date.now() + 15 * 60 * 1000;
      while (Date.now() < deadline) {
        const checked = await verifyDeployment(deployment.id);
        if (checked.state === 'READY') return checked;
        if (['ERROR', 'CANCELED'].includes(checked.state)) throw new Error('Staged Production build failed; no domain assignment was performed.');
        await new Promise(res => setTimeout(res, 10000));
      }
      throw new Error('Staged Production readiness is unresolved; inspect its existing deployment before resuming.');
    },
    promote: async deployment => cli(['promote', deployment.id, '--yes']),
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runProductionRelease(productionReleaseArguments(process.argv.slice(2))).then(result => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch(() => { console.error('Production release blocked. Check protected workflow configuration, independently collected readiness and private runner journal; diagnostics containing credentials are suppressed.'); process.exitCode = 1; });
}
