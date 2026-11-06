import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { handoverDigest, handoverPins, OLD_RELEASE_VARIABLES, OLD_RELEASE_WORKFLOWS } from './handover.mjs';
import { digest, requireCondition, validateManifest } from './contract.mjs';
import { githubClient, vercelProvider } from './providers.mjs';
import { DeploymentJournal } from './journal.mjs';
import { stageRelease } from './engine.mjs';
import { runStagedSmoke } from './smoke.mjs';
import { qualifyDownloadedArtifact } from '../../rapid-release-artifact.mjs';

export async function createHandoverAdapter({ plan, env = process.env } = {}) {
  const pins = handoverPins(), token = env.FCOS_RAPID_HANDOVER_GITHUB_TOKEN;
  const base = `/repos/${pins.repository}`;
  requireCondition(token && env.GITHUB_REPOSITORY === pins.repository, 'HANDOVER_GITHUB_CREDENTIAL_REQUIRED');
  async function request(path, method = 'GET', body) {
    requireCondition(path === '/user' || path === '/user/installations' || /^\/user\/installations\/[1-9][0-9]*\/repositories(?:\?|$)/.test(path) || path.startsWith(`${base}/`) || path === base, 'HANDOVER_GITHUB_TARGET_MISMATCH');
    const response = await fetch(`https://api.github.com${path}`, { method, redirect: 'error',
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
    if (method === 'GET' && response.status === 404 && /\/actions\/(variables|workflows)\//.test(path)) return null;
    requireCondition(response.ok, 'HANDOVER_GITHUB_REQUEST_REFUSED');
    return response.status === 204 ? null : response.json();
  }
  const pages = async path => {
    const all = [];
    for (let page = 1; page <= 100; page++) {
      const response = await request(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      const rows = Array.isArray(response) ? response : response.workflow_runs || response.workflows || response.installations || response.repositories;
      requireCondition(Array.isArray(rows), 'HANDOVER_NATIVE_PAGE_INVALID'); all.push(...rows);
      if (rows.length < 100) return all;
    }
    throw Error('HANDOVER_NATIVE_PAGINATION_INCOMPLETE');
  };
  const manifestPath = resolve(env.FCOS_HANDOVER_ARTIFACT_DIRECTORY || 'artifact', 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); validateManifest(manifest);
  const client = githubClient({ token, candidateSha: manifest.candidate.sha, actions: false });
  const operator = await request('/user');
  requireCondition(operator.login === pins.account, 'HANDOVER_GITHUB_IDENTITY_MISMATCH');
  let stagedQualification;
  const github = {
    get: path => request(path), pages,
    async identity() {
      const repository = await request(base);
      requireCondition(repository.full_name === pins.repository && repository.permissions?.admin === true, 'HANDOVER_ADMIN_TARGET_REQUIRED');
      return { login: operator.login, repository: repository.full_name };
    },
    async execution() {
      requireCondition(env.GITHUB_ACTIONS === 'true' && /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID || ''), 'HANDOVER_NATIVE_EXECUTION_REQUIRED');
      const jobs = await request(`${base}/actions/runs/${env.GITHUB_RUN_ID}/jobs?per_page=100`);
      const matches = jobs.jobs?.filter(job => job.name === 'handover-apply' && job.status === 'in_progress') || [];
      requireCondition(matches.length === 1, 'HANDOVER_NATIVE_JOB_REQUIRED');
      return { runId: Number(env.GITHUB_RUN_ID), jobId: matches[0].id };
    },
    async verifyNativePlan({ plan: p, planHash, run, job }) {
      const repository = await request(base);
      requireCondition(run.head_branch === repository.default_branch && run.run_attempt === 1 && job.name === 'handover-apply'
        && run.display_title === `FCOS rapid handover ${planHash} ${p.candidateSha}` && env.GITHUB_SHA === p.controllerSha
        && digest(manifest) === env.FCOS_HANDOVER_MANIFEST_HASH && manifest.controllerSha === p.controllerSha
        && manifest.candidate.sha === p.candidateSha && manifest.build.buildId === p.buildId, 'HANDOVER_EXACT_NATIVE_PLAN_REQUIRED');
    },
    async eventSubscribers() {
      const workflows = await pages(`${base}/actions/workflows`), hooks = await pages(`${base}/hooks`);
      // Admin scope is required: absence of hook/application visibility is a dependency, not empty inventory.
      const visibleInstallations = await pages('/user/installations');
      const installations = [];
      for (const item of visibleInstallations) {
        if (item.account?.login !== pins.account) continue;
        const repositories = await pages(`/user/installations/${item.id}/repositories`);
        if (repositories.some(repository => repository.full_name === pins.repository)) installations.push(item);
      }
      const inventory = [
        ...workflows.map(item => ({ kind: 'workflow', path: item.path, id: item.id })),
        ...hooks.map(item => ({ kind: 'hook', id: item.id, active: item.active, events: item.events?.slice().sort(), host: new URL(item.config.url).hostname })),
        ...installations.map(item => ({ kind: 'installation', id: item.id, appId: item.app_id, events: item.events?.slice().sort(), permissions: item.permissions })),
      ].sort((a, b) => String(a.kind + a.id).localeCompare(String(b.kind + b.id)));
      return { inventory, evidenceDigest: handoverDigest(inventory) };
    },
    qualification: async () => { requireCondition(stagedQualification, 'HANDOVER_QUALIFICATION_NOT_RUN'); return stagedQualification; },
    async findDeployment({ planHash, kind }) {
      const records = await pages(`${base}/deployments?environment=fcos-rapid-handover`);
      const matches = records.filter(item => item.payload?.kind === kind && item.payload.planHash === planHash);
      requireCondition(matches.length <= 1, 'HANDOVER_RECEIPT_AMBIGUOUS'); return matches[0] || null;
    },
    createDeployment: body => request(`${base}/deployments`, 'POST', body),
  };
  const provider = vercelProvider({ manifest, github: client, env, outputDirectory: resolve(env.FCOS_HANDOVER_ARTIFACT_DIRECTORY || 'artifact', 'candidate') });
  // Read-only native methods exposed to the handover audit. No setup callback can promote a domain.
  const nativeVercel = {
    project: () => provider.project(), currentProduction: () => provider.currentProduction(),
    deployment: id => provider.rawDeployment(id),
  };
  return { github, vercel: nativeVercel,
    async qualifyStage({ plan: p, planHash, nativeReview, ownershipVerifier }) {
      const directory = resolve(env.FCOS_HANDOVER_ARTIFACT_DIRECTORY || 'artifact'); qualifyDownloadedArtifact(directory);
      const build = JSON.parse(readFileSync(resolve(directory, 'build.json'), 'utf8'));
      requireCondition(build.artifactDigest === p.artifactDigest && build.buildId === p.buildId, 'HANDOVER_QUALIFIED_ARTIFACT_MISMATCH');
      const buildRun = await request(`${base}/actions/runs/${env.FCOS_HANDOVER_BUILD_RUN_ID}`);
      const buildJobs = await request(`${base}/actions/runs/${buildRun.id}/jobs?per_page=100`);
      requireCondition(buildRun.conclusion === 'success' && buildRun.head_sha === p.controllerSha && buildRun.run_attempt === 1
        && buildRun.path === '.github/workflows/fcos-rapid-release.yml'
        && buildJobs.jobs?.some(job => job.name === 'quality' && job.conclusion === 'success'), 'HANDOVER_NATIVE_BUILD_QUALIFICATION_REQUIRED');
      const stagedProvider = vercelProvider({ manifest, github: client, env, outputDirectory: resolve(directory, 'candidate'),
        ownershipVerifier, handoverPlanHash: planHash });
      const journal = new DeploymentJournal({ github: client, releaseId: manifest.releaseId, manifestHash: digest(manifest), actorIds: [operator.id] });
      await stageRelease({ manifest, journal, provider: stagedProvider, build, smoke: values => runStagedSmoke({ ...values, env }) });
      const events = (await journal.read()).map(row => row.payload), browser = events.filter(row => row.event === 'smoke.passed').at(-1)?.data;
      requireCondition(browser?.normalRole === true, 'HANDOVER_NORMAL_ROLE_QUALIFICATION_REQUIRED');
      stagedQualification = { runId: nativeReview.runId, planHash, controllerSha: p.controllerSha, candidateSha: p.candidateSha,
        buildId: p.buildId, artifactDigest: p.artifactDigest, deploymentId: browser.deploymentId, browser };
      return stagedQualification;
    },
    async retireOldWriters() {
      for (const name of OLD_RELEASE_VARIABLES) {
        const existing = await request(`${base}/actions/variables/${name}`);
        if (existing) await request(`${base}/actions/variables/${name}`, 'PATCH', { name, value: 'false' });
      }
      for (const name of OLD_RELEASE_WORKFLOWS) {
        const workflow = await request(`${base}/actions/workflows/${name}`);
        if (workflow && !workflow.state.startsWith('disabled')) await request(`${base}/actions/workflows/${workflow.id}/disable`, 'PUT');
      }
    },
    async activate(result) {
      requireCondition(result.phase === 'finalize' && Number.isSafeInteger(result.deploymentId), 'HANDOVER_FINAL_RECEIPT_REQUIRED');
      for (const [name, value] of [['FCOS_RAPID_RELEASE_HANDOVER_ID', String(result.deploymentId)], ['FCOS_RAPID_RELEASE_ENABLED', 'true']]) {
        const existing = await request(`${base}/actions/variables/${name}`);
        await request(existing ? `${base}/actions/variables/${name}` : `${base}/actions/variables`, existing ? 'PATCH' : 'POST', { name, value });
        requireCondition((await request(`${base}/actions/variables/${name}`))?.value === value, 'HANDOVER_ACTIVATION_READBACK_REQUIRED');
      }
      writeFileSync(resolve('handover-result.json'), `${JSON.stringify(result)}\n`, { mode: 0o600 });
    },
  };
}
