import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { handoverDigest, handoverPins, auditHandover, assertHandoverActivation, validateAdministratorApplicationInventory, OLD_RELEASE_VARIABLES, OLD_RELEASE_WORKFLOWS } from './handover.mjs';
import { digest, requireCondition, validateManifest } from './contract.mjs';
import { githubClient, vercelProvider, nativeWorkflowPath } from './providers.mjs';
import { DeploymentJournal, validateChain, pendingOperations } from './journal.mjs';
import { stageRelease } from './engine.mjs';
import { runStagedSmoke } from './smoke.mjs';
import { qualifyDownloadedArtifact } from '../../rapid-release-artifact.mjs';


export async function collectReviewedEventSubscribers({ pages, applicationInventoryReport, now = Date.now() }) {
  const pins = handoverPins(), base = `/repos/${pins.repository}`;
  const report = validateAdministratorApplicationInventory(applicationInventoryReport, { now });
  const [workflows, hooks] = await Promise.all([pages(`${base}/actions/workflows`), pages(`${base}/hooks`)]);
  const inventory = [
    ...workflows.map(item => ({ kind: 'workflow', path: item.path, id: item.id })),
    ...hooks.map(item => ({ kind: 'hook', id: item.id, active: item.active, events: item.events?.slice().sort(), host: new URL(item.config.url).hostname })),
    ...report.entries.map(item => ({ kind: 'installation', ...item })),
  ].sort((a,b) => String(a.kind + (a.id || a.installationId)).localeCompare(String(b.kind + (b.id || b.installationId))));
  return { inventory, evidenceDigest: handoverDigest(inventory), applicationInventory: {
    mode: report.mode, reportDigest: handoverDigest(report), collectedAt: report.collectedAt, evidenceDigest: report.evidenceDigest,
    provenance: 'administrator-observed-native-settings', apiVerified: false } };
}

// Audit every durable rapid chain without completing an older staged release.
// Only this exact setup's qualification chain may advance during the handover.
export async function collectRapidJournalState({ pages, manifest, actorIds }) {
  const records = await pages(`/repos/${handoverPins().repository}/deployments?environment=fcos-release-journal-v1`);
  const groups = new Map(), evidence = [];
  for (const record of records) {
    const p = record.payload;
    requireCondition(p?.kind === 'fcos_rapid_release_event' && actorIds.includes(record.creator?.id), 'HANDOVER_RAPID_JOURNAL_ACTOR_OR_RECORD_INVALID');
    const group = groups.get(p.releaseId) || []; group.push(record); groups.set(p.releaseId, group);
  }
  let unresolvedProduction = 0;
  for (const [id, group] of groups) {
    const chain = validateChain(group, group[0].payload.manifestHash, id);
    if (id === manifest.releaseId && group[0].payload.manifestHash === digest(manifest)) continue;
    unresolvedProduction += pendingOperations(chain).length;
    evidence.push(...chain.map(row => row.payload));
  }
  evidence.sort((a,b) => a.releaseId.localeCompare(b.releaseId) || a.sequence - b.sequence);
  return { digest: handoverDigest(evidence), unresolvedProduction,
    ignoredQualification: { releaseId: manifest.releaseId, manifestHash: digest(manifest) } };
}

export async function readActiveHandover({ get }) {
  const pins = handoverPins(), base = `/repos/${pins.repository}`;
  const [enabled, pointer] = await Promise.all(['FCOS_RAPID_RELEASE_ENABLED','FCOS_RAPID_RELEASE_HANDOVER_ID'].map(name => get(`${base}/actions/variables/${name}`)));
  if (!pointer && enabled?.value !== 'true') return null;
  requireCondition(enabled?.value === 'true' && /^[1-9][0-9]*$/.test(pointer?.value || ''), 'HANDOVER_ACTIVE_POINTER_UNCERTAIN');
  const record = await get(`${base}/deployments/${pointer.value}`), p = record?.payload;
  requireCondition(record?.id === Number(pointer.value) && [pins.account,'github-actions[bot]'].includes(record?.creator?.login)
    && p?.kind === 'fcos_rapid_release_handover' && p.repository === pins.repository && p.projectId === pins.projectId && p.teamId === pins.teamId
    && /^[a-z0-9-]{8,96}$/.test(p.handoverId || '') && /^[a-f0-9]{64}$/.test(p.planHash || '')
    && /^[a-f0-9]{40}$/.test(p.controllerSha || '') && Number.isSafeInteger(p.databaseReceiptId) && p.databaseReceiptId > 0
    && /^[a-f0-9]{64}$/.test(p.nativeCoordinatorReadbackDigest || ''), 'HANDOVER_ACTIVE_RECEIPT_INVALID');
  return { deploymentId: record.id, handoverId: p.handoverId, planHash: p.planHash, controllerSha: p.controllerSha,
    databaseReceiptId: p.databaseReceiptId, nativeCoordinatorReadbackDigest: p.nativeCoordinatorReadbackDigest };
}

export async function createHandoverAdapter({ plan, db, connection, env = process.env, applicationInventoryReport } = {}) {
  const pins = handoverPins(), token = env.FCOS_RAPID_HANDOVER_GITHUB_TOKEN;
  const base = `/repos/${pins.repository}`;
  const appReport = validateAdministratorApplicationInventory(plan?.applicationInventoryReport || applicationInventoryReport
    || (env.FCOS_HANDOVER_APP_INVENTORY_REPORT ? JSON.parse(readFileSync(resolve(env.FCOS_HANDOVER_APP_INVENTORY_REPORT), 'utf8')) : null));
  requireCondition(token && env.GITHUB_REPOSITORY === pins.repository, 'HANDOVER_GITHUB_CREDENTIAL_REQUIRED');
  async function request(path, method = 'GET', body) {
    requireCondition(path === '/user' || path === '/users/github-actions%5Bbot%5D' || path.startsWith(`${base}/`) || path === base, 'HANDOVER_GITHUB_TARGET_MISMATCH');
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
      const rows = Array.isArray(response) ? response : response.workflow_runs || response.workflows;
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
  const bot = await request('/users/github-actions%5Bbot%5D');
  requireCondition(bot.login === 'github-actions[bot]' && Number.isSafeInteger(bot.id), 'HANDOVER_JOURNAL_BOT_IDENTITY_REQUIRED');
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
      requireCondition(p.applicationInventoryReport && handoverDigest(validateAdministratorApplicationInventory(p.applicationInventoryReport)) === handoverDigest(appReport), 'HANDOVER_ADMIN_APP_REPORT_BINDING_REQUIRED');
      requireCondition(run.head_branch === repository.default_branch && run.run_attempt === 1 && job.name === 'handover-apply'
        && run.display_title === `FCOS rapid handover ${planHash} ${p.candidateSha}` && env.GITHUB_SHA === p.controllerSha
        && digest(manifest) === env.FCOS_HANDOVER_MANIFEST_HASH && manifest.controllerSha === p.controllerSha
        && manifest.candidate.sha === p.candidateSha && manifest.build.buildId === p.buildId, 'HANDOVER_EXACT_NATIVE_PLAN_REQUIRED');
    },
    rapidJournalAudit: () => collectRapidJournalState({ pages, manifest, actorIds: [operator.id, bot.id] }),
    activeHandover: () => readActiveHandover({ get: path => request(path) }),
    eventSubscribers: () => collectReviewedEventSubscribers({ pages, applicationInventoryReport: appReport }),
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
        && nativeWorkflowPath(buildRun) === '.github/workflows/fcos-rapid-release.yml'
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
      const audit = await auditHandover({ db, connection, github, vercel: nativeVercel });
      const receipt = assertHandoverActivation({ plan, audit, deploymentId: result.deploymentId });
      const native = await request(`${base}/deployments/${result.deploymentId}`);
      requireCondition(native.payload?.planHash === handoverDigest(plan) && native.payload.databaseReceiptId === receipt.databaseReceiptId
        && native.payload.nativeCoordinatorReadbackDigest === receipt.evidenceDigest, 'HANDOVER_ACTIVATION_RECEIPT_MISMATCH');
      for (const [name, value] of [['FCOS_RAPID_RELEASE_HANDOVER_ID', String(result.deploymentId)], ['FCOS_RAPID_RELEASE_ENABLED', 'true']]) {
        const existing = await request(`${base}/actions/variables/${name}`);
        await request(existing ? `${base}/actions/variables/${name}` : `${base}/actions/variables`, existing ? 'PATCH' : 'POST', { name, value });
        requireCondition((await request(`${base}/actions/variables/${name}`))?.value === value, 'HANDOVER_ACTIVATION_READBACK_REQUIRED');
      }
      writeFileSync(resolve('handover-result.json'), `${JSON.stringify(result)}\n`, { mode: 0o600 });
    },
  };
}
