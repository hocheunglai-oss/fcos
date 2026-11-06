import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { nativeCompatibilityReader } from './compatibility.mjs';
import { DeploymentJournal } from './journal.mjs';
import { assertAuthorization, digest, requireCondition, targets } from './contract.mjs';

export const nativeWorkflowPath = run => String(run?.path || '').split('@')[0];
export function assertNativeQualityProducer(run, jobs, manifest) {
  requireCondition(run.head_sha === manifest.controllerSha && run.event === 'workflow_dispatch' && run.status === 'completed'
    && nativeWorkflowPath(run) === '.github/workflows/fcos-rapid-release.yml' && run.actor?.login === targets().account
    && new RegExp(`^FCOS rapid (qualify|release|resume) ${digest(manifest)} ${manifest.candidate.sha}$`).test(run.display_title || '')
    && jobs.jobs?.some(job => job.name === 'quality' && job.conclusion === 'success'), 'PRIOR_NATIVE_QUALITY_REQUIRED');
}

export function githubClient({ token, candidateSha, requiredContexts = [], fetchImpl = fetch, actions = process.env.GITHUB_ACTIONS === 'true' } = {}) {
  requireCondition(typeof token === 'string' && token.length > 10 && !/\s/.test(token), 'GITHUB_CREDENTIAL_REQUIRED');
  async function request(path, body) {
    requireCondition(path.startsWith(`/repos/${targets().repository}/`) || path === `/repos/${targets().repository}` || path === '/user'
      || path === '/users/github-actions%5Bbot%5D', 'GITHUB_TARGET_MISMATCH');
    const response = await fetchImpl(`https://api.github.com${path}`, { method: body ? 'POST' : 'GET', redirect: 'error',
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
    requireCondition(response.ok && !response.redirected, 'GITHUB_REQUEST_REFUSED'); return response.json();
  }
  return { candidateSha, requiredContexts, read: path => request(path), write: (path, body) => request(path, body),
    async identity() {
      const [user, repo] = await Promise.all([request(actions ? '/users/github-actions%5Bbot%5D' : '/user'), request(`/repos/${targets().repository}`)]);
      requireCondition(repo.full_name === targets().repository && !repo.archived && (actions || repo.permissions?.push === true)
        && [targets().account, 'github-actions[bot]'].includes(user.login), 'GITHUB_IDENTITY_MISMATCH'); return { user, repo };
    },
    async pages(path) {
      const result = []; let page = 1;
      while (page <= 100) {
        const rows = await request(`${path}${path.includes('?') ? '&' : '?'}page=${page}`);
        requireCondition(Array.isArray(rows), 'GITHUB_PAGE_INVALID'); result.push(...rows);
        if (rows.length < 100) return result; page += 1;
      }
      throw Error('GITHUB_PAGINATION_INCOMPLETE');
    },
  };
}
export async function verifyExecution({ github, manifest, env = process.env, phase }) {
  requireCondition(env.GITHUB_ACTIONS === 'true' && /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID || '')
    && env.GITHUB_REPOSITORY === targets().repository && env.GITHUB_SHA === manifest.controllerSha, 'TRUSTED_ACTIONS_EXECUTION_REQUIRED');
  const { user, repo } = await github.identity();
  const run = await github.read(`/repos/${targets().repository}/actions/runs/${env.GITHUB_RUN_ID}`);
  requireCondition(run.head_sha === manifest.controllerSha && run.repository?.full_name === targets().repository
    && run.event === 'workflow_dispatch' && nativeWorkflowPath(run) === '.github/workflows/fcos-rapid-release.yml'
    && run.status === 'in_progress' && run.head_branch === repo.default_branch && run.actor?.login === targets().account
    && Number.isSafeInteger(run.run_attempt) && run.run_attempt >= 1
    && new RegExp(`^FCOS rapid (release|resume) ${digest(manifest)} ${manifest.candidate.sha}$`).test(run.display_title || ''), 'WORKFLOW_IDENTITY_MISMATCH');
  const enabled = await github.read(`/repos/${targets().repository}/actions/variables/FCOS_RAPID_RELEASE_ENABLED`);
  requireCondition(enabled.value === 'true', 'RAPID_RELEASE_NOT_ACTIVATED');
  const setup = await github.read(`/repos/${targets().repository}/actions/variables/FCOS_RAPID_RELEASE_HANDOVER_ID`);
  const handover = await github.read(`/repos/${targets().repository}/deployments/${setup.value}`);
  const p = handover.payload;
  requireCondition([targets().account, 'github-actions[bot]'].includes(handover.creator?.login) && p?.kind === 'fcos_rapid_release_handover'
    && p.controllerSha === manifest.controllerSha && p.repository === targets().repository
    && p.projectId === targets().projectId && p.teamId === targets().teamId && p.unresolvedProductionOperations === 0
    && p.oldWritersRetired === true && p.hostedQualificationPassed === true && p.eventSubscribersReviewed === true
    && /^[a-f0-9]{64}$/.test(p.inventoryDigest || '') && /^[a-f0-9]{64}$/.test(p.nativeCoordinatorReadbackDigest || '')
    && p.finalApprovalEnvironment === 'fcos-production-release', 'QUALIFIED_HANDOVER_REQUIRED');
  const setupRun = await github.read(`/repos/${targets().repository}/actions/runs/${p.nativeReview?.runId}`);
  const setupJobs = await github.read(`/repos/${targets().repository}/actions/runs/${setupRun.id}/jobs?per_page=100`);
  const setupReviews = await github.read(`/repos/${targets().repository}/actions/runs/${setupRun.id}/approvals`);
  requireCondition(setupRun.head_sha === manifest.controllerSha && nativeWorkflowPath(setupRun) === '.github/workflows/fcos-rapid-handover.yml'
    && setupRun.event === 'workflow_dispatch' && setupRun.actor?.login === targets().account && setupRun.conclusion === 'success'
    && setupRun.run_attempt === 1 && setupRun.display_title === `FCOS rapid handover ${p.planHash} ${p.candidateSha}`
    && setupJobs.jobs?.some(job => job.id === p.nativeReview.jobId && job.name === 'handover-apply' && job.conclusion === 'success')
    && setupReviews.some(review => review.state === 'approved' && review.user?.login === targets().account
      && digest(review) === p.nativeReview.reviewDigest), 'NATIVE_HANDOVER_QUALIFICATION_REQUIRED');
  return { user, repo, run, phase };
}
export async function nativeApproval({ github, manifest, staged, env = process.env }) {
  const { run } = await verifyExecution({ github, manifest, env, phase: 'promote' });
  const environment = await github.read(`/repos/${targets().repository}/environments/fcos-production-release`);
  const rule = environment.protection_rules?.find(item => item.type === 'required_reviewers');
  requireCondition(rule?.reviewers?.some(item => item.reviewer?.login === targets().account) && environment.can_admins_bypass === false, 'PRODUCTION_REVIEW_PROTECTION_REQUIRED');
  const reviews = await github.read(`/repos/${targets().repository}/actions/runs/${env.GITHUB_RUN_ID}/approvals`);
  const matches = reviews.filter(review => review.state === 'approved' && review.user?.login === targets().account
    && review.environments?.some(item => item.id === environment.id && item.name === environment.name));
  requireCondition(matches.length >= 1, 'NATIVE_PRODUCTION_REVIEW_REQUIRED');
  const jobs = await github.read(`/repos/${targets().repository}/actions/runs/${env.GITHUB_RUN_ID}/jobs?per_page=100`);
  const job = jobs.jobs?.find(item => item.name === 'go-live' && item.status === 'in_progress');
  requireCondition(job?.started_at, 'APPROVED_EXECUTION_JOB_REQUIRED');
  const identity = await github.identity();
  const journal = new DeploymentJournal({ github, actorIds: [identity.user.id, run.actor.id], releaseId: manifest.releaseId, manifestHash: digest(manifest) });
  const saved = (await journal.read()).find(record => record.payload.event === 'approval.accepted')?.payload.data;
  if (saved?.runId === run.id) return assertAuthorization(saved, manifest, staged);
  requireCondition(run.run_attempt === 1, 'FRESH_NATIVE_APPROVAL_REQUIRED');
  const receipt = { manifestHash: digest(manifest), candidateSha: manifest.candidate.sha, buildId: manifest.build.buildId,
    deploymentId: staged.id, previousDeploymentId: manifest.previous.deploymentId, environment: environment.name,
    reviewer: targets().account, nativeReviewVerified: true, runId: Number(env.GITHUB_RUN_ID), approvedAt: run.created_at };
  return assertAuthorization(receipt, manifest, staged);
}
export function vercelProvider({ manifest, github, env = process.env, execute = execFileSync, fetchImpl = fetch, outputDirectory, ownershipVerifier, handoverPlanHash, compatibilityReader } = {}) {
  const pins = targets();
  let admitted = null;
  const assertAdmitted = phase => requireCondition(admitted?.phase === phase && admitted.manifestHash === digest(manifest)
    && Date.now() - admitted.observedAt < 30000, 'FRESH_PROVIDER_WRITE_ADMISSION_REQUIRED');
  requireCondition(env.VERCEL_TOKEN && env.VERCEL_ORG_ID === pins.teamId && env.VERCEL_PROJECT_ID === pins.projectId, 'VERCEL_TARGET_CREDENTIAL_REQUIRED');
  const run = args => execute('vercel', [...args, '--scope', pins.team, '--no-color'], {
    env: { PATH: env.PATH, HOME: env.HOME, CI: '1', VERCEL_TOKEN: env.VERCEL_TOKEN, VERCEL_ORG_ID: pins.teamId, VERCEL_PROJECT_ID: pins.projectId },
    encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const get = path => {
    requireCondition(path.startsWith('/v') && !path.includes('://'), 'VERCEL_ROUTE_INVALID');
    return JSON.parse(run(['api', `${path}${path.includes('?') ? '&' : '?'}teamId=${pins.teamId}`, '--method', 'GET', '--raw']));
  };
  const inspect = id => {
    requireCondition(/^dpl_[A-Za-z0-9]+$/.test(id), 'DEPLOYMENT_ID_INVALID');
    const d = get(`/v13/deployments/${id}`);
    requireCondition(d.projectId === pins.projectId && d.ownerId === pins.teamId && d.target === 'production', 'DEPLOYMENT_TARGET_MISMATCH');
    return { id: d.id, url: `https://${d.url}`, state: d.readyState, target: d.target,
      sha: d.meta?.githubCommitSha, buildId: d.meta?.fcosRapidBuildId, artifactDigest: d.meta?.fcosRapidArtifactDigest,
      operationId: d.meta?.fcosRapidOperationId, manifestHash: d.meta?.fcosRapidManifestHash };
  };
  async function identity() {
    requireCondition(run(['--version']).replace(/^Vercel CLI /, '') === '54.20.1' && run(['whoami']) === pins.vercelAccount, 'VERCEL_ACCOUNT_OR_VERSION_MISMATCH');
    const p = get(`/v9/projects/${pins.projectId}`);
    requireCondition(p.id === pins.projectId && p.accountId === pins.teamId && p.autoAssignCustomDomains === false, 'VERCEL_PROJECT_OR_AUTO_ASSIGNMENT_MISMATCH');
    return p;
  }
  const provider = {
    async project() { return identity(); },
    async nativeConfiguration() {
      const project = await identity();
      const rows = get(`/v10/projects/${pins.projectId}/env?decrypt=false`).envs;
      requireCondition(Array.isArray(rows), 'NATIVE_CONFIGURATION_READBACK_REQUIRED');
      return { projectId: project.id, accountId: project.accountId, nodeVersion: project.nodeVersion,
        framework: project.framework, rootDirectory: project.rootDirectory, buildCommand: project.buildCommand,
        installCommand: project.installCommand, outputDirectory: project.outputDirectory,
        environment: rows.filter(row => row.target?.includes('production')).map(row => ({ id: row.id, key: row.key,
          updatedAt: row.updatedAt, type: row.type, target: row.target.slice().sort() })).sort((a,b) => a.id.localeCompare(b.id)) };
    },
    async rawDeployment(id) {
      inspect(id);
      const deployment = get(`/v13/deployments/${id}`);
      const alias = await provider.currentProduction();
      return { ...deployment, aliasAssigned: alias.id === id };
    },
    async assertOwnership({ phase }) {
      if (ownershipVerifier) await ownershipVerifier({ phase, manifest, manifestHash: digest(manifest) });
      else await verifyExecution({ github, manifest, env, phase });
      await identity(); admitted = { phase, manifestHash: digest(manifest), observedAt: Date.now() };
    },
    async stage({ build, operationId, manifestHash }) {
      assertAdmitted('stage');
      requireCondition(outputDirectory, 'PREBUILT_DIRECTORY_REQUIRED');
      const link = JSON.parse(readFileSync(join(outputDirectory, '.vercel/project.json'), 'utf8'));
      requireCondition(link.projectId === pins.projectId && link.orgId === pins.teamId, 'PREBUILT_PROJECT_LINK_MISMATCH');
      const url = run(['deploy', '--prebuilt', '--prod', '--skip-domain', '--yes', '--no-wait', '--cwd', outputDirectory,
        '--meta', `githubCommitSha=${manifest.candidate.sha}`, '--meta', `fcosRapidBuildId=${build.buildId}`,
        '--meta', `fcosRapidArtifactDigest=${build.artifactDigest}`, '--meta', `fcosRapidOperationId=${operationId}`, '--meta', `fcosRapidManifestHash=${manifestHash}`,
        ...(handoverPlanHash ? ['--meta', `fcosHandoverPlanHash=${handoverPlanHash}`] : [])]);
      requireCondition(/^https:\/\/[a-z0-9.-]+\.vercel\.app$/.test(url), 'DEPLOYMENT_ACK_UNCERTAIN');
      const list = get(`/v6/deployments?projectId=${pins.projectId}&limit=100`);
      const matches = list.deployments?.filter(d => d.meta?.fcosRapidOperationId === operationId && d.meta?.fcosRapidManifestHash === manifestHash) || [];
      requireCondition(matches.length === 1, 'DEPLOYMENT_ACK_UNCERTAIN'); return inspect(matches[0].uid || matches[0].id);
    },
    async discover({ phase, operationId, manifestHash, request }) {
      if (phase !== 'stage') {
        const d = await provider.currentProduction();
        return d.id === request.deploymentId ? { outcome: 'applied', result: d } : { outcome: 'unknown' };
      }
      const matches = []; let until;
      for (let page = 0; page < 20; page += 1) {
        const list = get(`/v6/deployments?projectId=${pins.projectId}&limit=100${until ? `&until=${until}` : ''}`);
        requireCondition(Array.isArray(list.deployments), 'DEPLOYMENT_LIST_INVALID');
        matches.push(...list.deployments.filter(d => d.meta?.fcosRapidOperationId === operationId && d.meta?.fcosRapidManifestHash === manifestHash));
        if (!list.pagination?.next) break; until = list.pagination.next;
        requireCondition(page < 19, 'DEPLOYMENT_DISCOVERY_INCOMPLETE');
      }
      if (matches.length !== 1) return { outcome: 'unknown' };
      const d = inspect(matches[0].uid || matches[0].id);
      requireCondition(d.buildId === request.buildId && d.sha === request.candidateSha, 'DISCOVERED_BUILD_MISMATCH'); return { outcome: 'applied', result: d };
    },
    async ready(id) {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const d = inspect(id); if (['READY', 'ERROR', 'CANCELED'].includes(d.state)) return d;
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      throw Error('DEPLOYMENT_READY_DEADLINE');
    },
    async currentProduction() {
      const a = get(`/v4/aliases/${new URL(pins.origin).hostname}?projectId=${pins.projectId}`);
      requireCondition(a.projectId === pins.projectId && a.alias === new URL(pins.origin).hostname && !a.redirect, 'PRODUCTION_ALIAS_MISMATCH');
      return inspect(a.deploymentId);
    },
    async verifyApproval(receipt, context) {
      const actual = await nativeApproval({ github, manifest, staged: context.staged, env });
      requireCondition(actual.runId === receipt.runId && actual.manifestHash === receipt.manifestHash, 'APPROVAL_CHANGED');
    },
    async promote({ staged }) {
      assertAdmitted('promote'); requireCondition(staged.sha === manifest.candidate.sha && staged.buildId === manifest.build.buildId, 'PROMOTION_SOURCE_MISMATCH');
      run(['promote', staged.id, '--yes']);
      const result = await provider.currentProduction(); requireCondition(result.id === staged.id, 'PROMOTION_ACK_UNCERTAIN'); return result;
    },
    async rollback({ previous }) {
      assertAdmitted('rollback'); requireCondition(previous.deploymentId === manifest.previous.deploymentId, 'ROLLBACK_TARGET_MISMATCH');
      run(['rollback', previous.deploymentId, '--yes']);
      const result = await provider.currentProduction(); requireCondition(result.id === previous.deploymentId, 'ROLLBACK_ACK_UNCERTAIN'); return result;
    },
    async rollbackCompatibility({ previous }) {
      // A fresh verifier must supply independently collected current schema/configuration digests, never a caller's manifest assertion.
      const readCompatibility = compatibilityReader || nativeCompatibilityReader({ provider, env });
      let proof;
      try { proof = await readCompatibility({ manifest, previous }); }
      catch { return { compatible: false, deploymentId: previous.deploymentId }; }
      const old = inspect(previous.deploymentId);
      return { compatible: proof.deploymentId === old.id && old.state === 'READY'
        && proof.schemaDigest === previous.schemaDigest && proof.configurationDigest === previous.configurationDigest
        && proof.currentDeploymentId === (await provider.currentProduction()).id
        && Date.parse(proof.observedAt) <= Date.now() && Date.now() - Date.parse(proof.observedAt) < 60000, deploymentId: old.id, proofDigest: digest(proof) };
    },
    async verifyRollback({ previous }) {
      requireCondition((await provider.currentProduction()).id === previous.deploymentId, 'ROLLBACK_ALIAS_READBACK_FAILED');
      const response = await fetchImpl(`${pins.origin}/app-version.json`, { redirect: 'error', signal: AbortSignal.timeout(15000) });
      requireCondition(response.ok && (await response.json()).commit === previous.sha, 'ROLLBACK_SOURCE_READBACK_FAILED');
    },
  };
  return provider;
}
