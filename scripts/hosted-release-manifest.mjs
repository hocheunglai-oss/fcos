import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertAdmittedSetup, prepareReleaseManifest, validateDiscoverySetup } from './lib/hosted-release/manifest.mjs';
import { createPreviousProductionObserver, createSetupDiscoveryCollector } from './lib/hosted-release/live-collector.mjs';
import { digest, fail, releaseTargets, sha } from './lib/hosted-release/contract.mjs';
import { assertHostedController, assertHostedSetup, assertSourceAdmission, collectSourceAdmission } from './lib/hosted-release/admission.mjs';
import { githubClient, validateQualificationRun } from './lib/hosted-release/github.mjs';
import { readManifest, writeJson, workflowOutput } from './lib/hosted-release/session.mjs';

/** Runs before candidate checkout/private provider inputs in the qualification bootstrap. */
export async function validateHostedDispatch({ env = process.env, createGithub = githubClient } = {}) {
  if (!sha(env.FCOS_CANDIDATE_SHA)) fail('CANDIDATE_BINDING');
  const controllerDirectory = resolve(env.FCOS_CONTROLLER_DIRECTORY || 'controller');
  const setup = JSON.parse(env.FCOS_ADMITTED_RELEASE_SETUP || '{}');
  assertAdmittedSetup({ setup, expectedSha256: env.FCOS_ADMITTED_RELEASE_SETUP_SHA256, controllerDirectory, controllerSha: env.FCOS_CONTROLLER_SHA });
  const resumed = env.FCOS_RESUME_MANIFEST ? readManifest(env.FCOS_RESUME_MANIFEST) : null;
  const plan = resumed || (env.FCOS_RELEASE_PLAN ? JSON.parse(env.FCOS_RELEASE_PLAN) : JSON.parse(readFileSync(env.FCOS_RELEASE_PLAN_FILE, 'utf8')));
  const mode = resumed ? resumed.executionMode : plan.executionMode || (plan.stage === 'qualification' ? 'qualification' : 'release');
  if (!['compatibility', 'application', 'qualification'].includes(plan.stage)
    || (plan.stage === 'qualification') !== (mode === 'qualification') || !['release', 'qualification'].includes(mode)) fail('MANIFEST_SCHEMA');
  const manifest = resumed || { stage: plan.stage, executionMode: mode, candidate: { sha: env.FCOS_CANDIDATE_SHA,
    sourceProfile:plan.stage==='compatibility'?'frozen_04ee':plan.stage==='application'?'application_v2':plan.sourceProfile },scope:plan.scope,
    controller: { sha: env.FCOS_CONTROLLER_SHA }, setupSha256: digest(setup), epoch: setup.epoch, targets: releaseTargets(),
    verification: setup.verification, ...(setup.dependencies ? { dependencies: setup.dependencies } : {}),
    ...(plan.stage === 'qualification' && setup.qualificationSource ? { qualificationSource: setup.qualificationSource } : {}) };
  if (manifest.controller.sha !== env.FCOS_CONTROLLER_SHA || manifest.candidate.sha !== env.FCOS_CANDIDATE_SHA) fail('RESUME_MANIFEST_CHANGED');
  assertHostedController({ controllerDirectory, controllerSha: env.FCOS_CONTROLLER_SHA, manifest, env });
  assertHostedSetup({ manifest, env });
  if (manifest.qualificationSource) {
    const github = createGithub({ token: env.FCOS_HOSTED_GITHUB_READ_TOKEN || env.GITHUB_TOKEN, repositoryId: env.GITHUB_REPOSITORY_ID });
    await github.identity();
    const run = await github.read(`/repos/${manifest.targets.repository}/actions/runs/${env.GITHUB_RUN_ID}`);
    await validateQualificationRun({ github, source: manifest.qualificationSource, run, env });
  }
  return { setup, plan, resumed, controllerDirectory };
}

export async function prepareHostedManifest({ env = process.env, validateDispatchOnly = false, createGithub = githubClient,
  prepareManifest = prepareReleaseManifest,createPreviousObserver=createPreviousProductionObserver } = {}) {
  const { setup, plan, resumed, controllerDirectory } = await validateHostedDispatch({ env, createGithub });
  if (validateDispatchOnly) return { status: 'passed', phase: 'dispatch.admission', executionMode: plan.stage === 'qualification' ? 'qualification' : 'release' };
  const candidateDirectory = resolve(env.FCOS_CANDIDATE_DIRECTORY || 'candidate');
  if (resumed) {
    assertSourceAdmission({ manifest: resumed, controllerDirectory, candidateDirectory });
    writeJson(env.FCOS_RELEASE_OUTPUT || 'release-manifest.json', resumed);
    workflowOutput({ manifest: JSON.stringify(resumed) }, env);
    return resumed;
  }
  const manifest = await prepareManifest({ plan, setup, controllerDirectory, candidateDirectory,
    controllerSha: env.FCOS_CONTROLLER_SHA, candidateSha: env.FCOS_CANDIDATE_SHA,
    observePreviousProduction: async context => createPreviousObserver({context,setup,env}).observePreviousProduction() });
  writeJson(env.FCOS_RELEASE_OUTPUT || 'release-manifest.json', manifest);
  workflowOutput({ manifest: JSON.stringify(manifest) }, env);
  return manifest;
}

const discoveryCode = (error, phase) => {
  const known = new Set(['DISCOVERY_SETUP_INVALID','DISCOVERY_LEGACY_BINDING_INVALID','DISCOVERY_CONTEXT_INVALID',
    'DISCOVERY_CREDENTIAL_BOUNDARY','DISCOVERY_SOURCE_CHANGED','DISCOVERY_GITHUB_CONTEXT','DISCOVERY_BOOTSTRAP_CHANGED',
    'DISCOVERY_JOB_CONTEXT','DISCOVERY_JOB_PUBLICATION_TIMEOUT','DISCOVERY_PRODUCTION_BINDING','DISCOVERY_PRODUCTION_MOVED','DISCOVERY_PUBLIC_VERSION',
    'DISCOVERY_LEGACY_VERSION','DISCOVERY_RUNTIME_IDENTITY','DISCOVERY_RUNTIME_TARGET','DISCOVERY_RUNTIME_PROTECTION',
    'DISCOVERY_RUNTIME_UNOBSERVED','DISCOVERY_SETUP_EXPIRED','DISCOVERY_INPUT_INVALID','SETUP_BINDING_CHANGED','CONTROLLER_CHECKOUT_CHANGED',
    'QUALIFICATION_SOURCE_INVALID','VERCEL_READ_CREDENTIAL_BINDING','VERCEL_READ_OAUTH_PROOF_REQUIRED',
    'VERCEL_READ_WRITE_CREDENTIAL_FORBIDDEN','VERCEL_READ_CREDENTIAL_REQUIRED','VERCEL_READ_CREDENTIAL_SUBSTITUTED',
    'VERCEL_READ_CONFIGURATION_CHANGED','VERCEL_READ_UNAVAILABLE','VERCEL_READ_ROUTE_FORBIDDEN',
    'SCHEMA_OBSERVER_SETUP_REQUIRED','SCHEMA_OBSERVER_TARGET','SCHEMA_OBSERVER_PRIVILEGES','SCHEMA_OBSERVATION_UNAVAILABLE',
    'FIRST_RUNTIME_BASELINE_INVALID','FIRST_RUNTIME_BASELINE_NOT_ADMITTED','FIRST_RUNTIME_BASELINE_REVIEW_REQUIRED','FIRST_RUNTIME_BASELINE_CHANGED',
    'FIRST_RUNTIME_BASELINE_INCOMPLETE','FIRST_RUNTIME_SOURCE_CHANGED','FIRST_RUNTIME_SCOPE_CHANGED','FIRST_RUNTIME_SOURCE_CAPABILITY']);
  return known.has(error?.code) ? error.code : `DISCOVERY_${phase.toUpperCase()}_FAILED`;
};

/** Separate admission: no admitted release setup, active epoch, expected contracts or manifest. */
export async function validateHostedDiscoveryDispatch({ env = process.env, createGithub = githubClient,
  now = Date.now, wait = milliseconds => new Promise(resolveWait => setTimeout(resolveWait,milliseconds)), validateDispatchOnly = false } = {}) {
  let setup;
  try {
    if (typeof env.FCOS_ADMITTED_DISCOVERY_SETUP !== 'string' || Buffer.byteLength(env.FCOS_ADMITTED_DISCOVERY_SETUP) > 49152) fail('DISCOVERY_INPUT_INVALID');
    setup = JSON.parse(env.FCOS_ADMITTED_DISCOVERY_SETUP);
  } catch { fail('DISCOVERY_INPUT_INVALID'); }
  validateDiscoverySetup(setup, { controllerSha: env.FCOS_CONTROLLER_SHA, candidateSha: env.FCOS_CANDIDATE_SHA, now: now() });
  const source = setup.qualificationSource, repository = setup.targets.repository, actor = repository.split('/')[0];
  if (env.FCOS_HOSTED_SETUP_DISCOVERY_ADMITTED !== 'true' || env.FCOS_SETUP_DISCOVERY_BOOTSTRAP !== 'true'
    || env.FCOS_HOSTED_ENVIRONMENT !== setup.environment || env.GITHUB_JOB !== 'setup_discovery'
    || env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== repository || env.GITHUB_REPOSITORY_ID !== '1278654816'
    || env.GITHUB_REF !== source.ref || env.GITHUB_REF_PROTECTED !== 'true' || env.GITHUB_SHA !== source.bootstrapSha
    || env.GITHUB_WORKFLOW_REF !== source.callerWorkflowRef || env.GITHUB_WORKFLOW_SHA !== source.bootstrapSha
    || env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_RUN_ATTEMPT !== '1'
    || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID || '') || env.GITHUB_ACTOR !== actor
    || !/^[1-9][0-9]*$/.test(env.GITHUB_ACTOR_ID || '')) fail('DISCOVERY_CONTEXT_INVALID');
  const forbidden = ['ACTIONS_ID_TOKEN_REQUEST_TOKEN','ACTIONS_ID_TOKEN_REQUEST_URL','FCOS_HOSTED_CREDENTIAL_CLASS',
    'FCOS_RELEASE_PLAN','FCOS_RELEASE_PLAN_FILE','FCOS_RESUME_MANIFEST','FCOS_ADMITTED_RELEASE_SETUP',
    'FCOS_HOSTED_VERCEL_TOKEN','VERCEL_TOKEN','VERCEL_OIDC_TOKEN','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SECRET_KEY',
    'SUPABASE_ACCESS_TOKEN','SF_ACCESS_TOKEN','FCOS_HOSTED_PRESERVATION_DATABASE_URL','FCOS_HOSTED_COORDINATOR_URL',
    'FCOS_HOSTED_NORMAL_EMAIL','FCOS_HOSTED_NORMAL_PASSWORD','FCOS_HOSTED_RESTRICTED_EMAIL','FCOS_HOSTED_RESTRICTED_PASSWORD'];
  if (forbidden.some(key => env[key]) || Object.entries(env).some(([key,value]) => value
    && /(?:SALESFORCE|COORDINATOR|PRIVATE_KEY|CLIENT_SECRET)/.test(key))) fail('DISCOVERY_CREDENTIAL_BOUNDARY');
  const controllerDirectory = resolve(env.FCOS_CONTROLLER_DIRECTORY || 'controller');
  assertAdmittedSetup({ setup, expectedSha256: env.FCOS_ADMITTED_DISCOVERY_SETUP_SHA256, controllerDirectory, controllerSha: env.FCOS_CONTROLLER_SHA });
  if (execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:controllerDirectory,encoding:'utf8'}).trim()) fail('CONTROLLER_CHECKOUT_CHANGED');
  const github = createGithub({ token: env.FCOS_HOSTED_GITHUB_READ_TOKEN || env.GITHUB_TOKEN, repositoryId: env.GITHUB_REPOSITORY_ID });
  await github.identity();
  const branchName = source.ref.slice('refs/heads/'.length), prefix = `/repos/${repository}`;
  // Bound independent metadata concurrency even on a publication-lag retry.
  const readPairs = async (paths,options) => {
    const values = [];
    for (let index = 0; index < paths.length; index += 2)
      values.push(...await Promise.all(paths.slice(index,index+2).map(path => github.read(path,options))));
    return values;
  };
  const runPath = `${prefix}/actions/runs/${env.GITHUB_RUN_ID}`, jobsPath = `${runPath}/attempts/1/jobs?per_page=100`;
  const initial = await readPairs([runPath,`${prefix}/branches/${encodeURIComponent(branchName)}`,
    `${prefix}/branches/${encodeURIComponent(branchName)}/protection`,
    `${prefix}/contents/.github/workflows/authenticated-release.yml?ref=${source.bootstrapSha}`,jobsPath]);
  let [run, , , , jobs] = initial;
  const [, branch, protection, workflow] = initial;
  if (branch?.name !== branchName || branch.protected !== true || branch.commit?.sha !== source.bootstrapSha
    || protection?.enforce_admins?.enabled !== true || protection.allow_force_pushes?.enabled !== false || protection.allow_deletions?.enabled !== false) fail('DISCOVERY_GITHUB_CONTEXT');
  const pendingStates = ['queued','waiting','pending','requested'];
  const assertRun = value => {
    if (value?.repository?.full_name !== repository || String(value.repository.id) !== env.GITHUB_REPOSITORY_ID
      || value.head_repository?.full_name !== repository || String(value.id) !== env.GITHUB_RUN_ID || value.head_branch !== branchName
      || value.head_sha !== source.bootstrapSha || !['.github/workflows/authenticated-release.yml',`.github/workflows/authenticated-release.yml@${branchName}`].includes(value.path)
      || value.event !== 'workflow_dispatch' || value.run_attempt !== 1 || !['in_progress',...pendingStates].includes(value.status) || value.conclusion !== null
      || value.actor?.login !== actor || String(value.actor.id) !== env.GITHUB_ACTOR_ID
      || value.triggering_actor?.login !== actor || String(value.triggering_actor.id) !== env.GITHUB_ACTOR_ID) fail('DISCOVERY_GITHUB_CONTEXT');
  };
  assertRun(run);
  const template = readFileSync(join(controllerDirectory,'.github/qualification/hosted-release-bootstrap.yml'),'utf8');
  const expectedWorkflow = template.replaceAll('__FCOS_CONTROLLER_SHA__',setup.controllerSha);
  if (workflow?.type !== 'file' || workflow.path !== '.github/workflows/authenticated-release.yml' || workflow.encoding !== 'base64'
    || typeof workflow.content !== 'string' || workflow.content.length > 196608
    || Buffer.from(workflow.content,'base64').toString('utf8') !== expectedWorkflow) fail('DISCOVERY_BOOTSTRAP_CHANGED');
  const activeStep = validateDispatchOnly ? 'Admit discovery before candidate checkout' : 'Discover public setup baseline';
  const pollStarted = now(), publicationDeadline = pollStarted + 20000;
  let knownJobId, knownStartedAt, polls = 0;
  const activeJob = () => {
    assertRun(run); // Terminal, foreign or changed runs never enter the wait path.
    if (!Number.isSafeInteger(jobs?.total_count) || !Array.isArray(jobs.jobs) || jobs.total_count !== jobs.jobs.length
      || jobs.total_count > 100 || jobs.total_count < 0) fail('DISCOVERY_JOB_CONTEXT');
    for (const value of jobs.jobs) if (value.run_id !== Number(env.GITHUB_RUN_ID) || value.head_sha !== source.bootstrapSha
      || value.run_attempt !== 1) fail('DISCOVERY_JOB_CONTEXT');
    const matches = jobs.jobs.filter(value => value.name === 'Setup discovery');
    if (matches.length > 1) fail('DISCOVERY_JOB_CONTEXT');
    if (!matches.length) return null; // A complete page may precede publication of this job.
    const job = matches[0];
    if (!Number.isSafeInteger(job.id) || job.id < 1 || knownJobId !== undefined && job.id !== knownJobId
      || !['in_progress',...pendingStates].includes(job.status) || job.conclusion !== null) fail('DISCOVERY_JOB_CONTEXT');
    knownJobId = job.id;
    if (job.started_at != null) {
      if (!Number.isFinite(Date.parse(job.started_at)) || now() - Date.parse(job.started_at) >= 900000
        || Date.parse(job.started_at) > now() + 30000 || knownStartedAt !== undefined && job.started_at !== knownStartedAt) fail('DISCOVERY_JOB_CONTEXT');
      knownStartedAt = job.started_at; // Original provider time is pinned once, never renewed by polling.
    }
    if (job.steps !== undefined && !Array.isArray(job.steps)) fail('DISCOVERY_JOB_CONTEXT');
    const steps = job.steps || [], matchesStep = steps.filter(step => step.name === activeStep);
    if (matchesStep.length > 1 || steps.some(step => step.conclusion != null && !['success','skipped'].includes(step.conclusion))) fail('DISCOVERY_JOB_CONTEXT');
    if (!matchesStep.length) return null;
    const step = matchesStep[0];
    if (!['in_progress',...pendingStates].includes(step.status) || step.conclusion != null) fail('DISCOVERY_JOB_CONTEXT');
    if (job.status !== 'in_progress' || run.status !== 'in_progress' || step.status !== 'in_progress'
      || step.conclusion !== null || knownStartedAt === undefined) return null;
    if (steps.filter(value => value.status === 'in_progress').length !== 1) fail('DISCOVERY_JOB_CONTEXT');
    return job;
  };
  while (true) {
    if (now() >= setup.notAfter) fail('DISCOVERY_SETUP_EXPIRED');
    if (knownStartedAt !== undefined && now() >= Date.parse(knownStartedAt) + 900000) fail('DISCOVERY_JOB_CONTEXT');
    const job = activeJob();
    if (polls && now() >= publicationDeadline) fail('DISCOVERY_JOB_PUBLICATION_TIMEOUT');
    if (job) return { setup, controllerDirectory, jobId: job.id, jobStartedAt: knownStartedAt, publicationWaitMs: now()-pollStarted };
    const remaining = Math.min(publicationDeadline-now(),setup.notAfter-now(),
      knownStartedAt === undefined ? Infinity : Date.parse(knownStartedAt)+900000-now());
    if (remaining <= 0 || polls >= 10) fail('DISCOVERY_JOB_PUBLICATION_TIMEOUT');
    await wait(Math.min(2000,remaining));
    if (now() >= setup.notAfter) fail('DISCOVERY_SETUP_EXPIRED');
    if (knownStartedAt !== undefined && now() >= Date.parse(knownStartedAt)+900000) fail('DISCOVERY_JOB_CONTEXT');
    if (now() >= publicationDeadline) fail('DISCOVERY_JOB_PUBLICATION_TIMEOUT');
    const requestDeadline = Math.min(publicationDeadline,setup.notAfter,
      knownStartedAt === undefined ? Infinity : Date.parse(knownStartedAt)+900000);
    const timeoutMs = Math.floor(requestDeadline-now());
    if (timeoutMs < 1) fail('DISCOVERY_JOB_PUBLICATION_TIMEOUT');
    try { [run,jobs] = await readPairs([runPath,jobsPath],{timeoutMs}); }
    catch (error) {
      if (now() >= setup.notAfter) fail('DISCOVERY_SETUP_EXPIRED');
      if (knownStartedAt !== undefined && now() >= Date.parse(knownStartedAt)+900000) fail('DISCOVERY_JOB_CONTEXT');
      if (now() >= publicationDeadline) fail('DISCOVERY_JOB_PUBLICATION_TIMEOUT');
      throw error; // An ordinary transport failure is never a publication retry.
    }
    polls++;
  }

}

const discoveryDisposition = now => ({ schemaVersion: 1, kind: 'fcos_hosted_setup_discovery_result', capturedAt: new Date(now()).toISOString(),
  status: 'incomplete', readOnly: true, qualificationAccepted: false, rollbackAccepted: false, admittedSetup: false,
  observations: {}, failures: [] });

/** Always writes a sanitized public disposition; never emits a release manifest/output. */
export async function discoverHostedSetup({ env = process.env, validateDispatchOnly = false, createGithub = githubClient,
  collectSource = collectSourceAdmission, createCollector = createSetupDiscoveryCollector, now = Date.now, wait } = {}) {
  const report = discoveryDisposition(now);
  let phase = 'admission';
  try {
    const { setup, controllerDirectory, jobId, jobStartedAt, publicationWaitMs } = await validateHostedDiscoveryDispatch({ env, createGithub, now, wait, validateDispatchOnly });
    report.binding = { setupSha256: digest(setup), controllerSha: setup.controllerSha, candidateSha: setup.candidateSha,
      qualificationSource: setup.qualificationSource, targets: setup.targets, runId: env.GITHUB_RUN_ID, jobId,
      originalSetupIssuedAt: setup.issuedAt, originalSetupNotAfter: setup.notAfter, jobStartedAt, publicationWaitMs };
    if (validateDispatchOnly) report.status = 'admitted_discovery_only';
    else {
      phase = 'source';
      const candidateDirectory = resolve(env.FCOS_CANDIDATE_DIRECTORY || 'candidate');
      const source = collectSource({ controllerDirectory, candidateDirectory, controllerSha: setup.controllerSha,
        candidateSha: setup.candidateSha, sourceProfile: setup.sourceProfile });
      if (source.candidate?.sha !== setup.candidateSha || source.controller?.sha !== setup.controllerSha
        || source.candidate?.sourceProfile !== setup.sourceProfile) fail('DISCOVERY_SOURCE_CHANGED');
      report.source = { candidate: source.candidate, controller: source.controller };
      phase = 'collector';
      if (now() >= setup.notAfter) fail('DISCOVERY_SETUP_EXPIRED');
      if (now() >= Date.parse(jobStartedAt)+900000) fail('DISCOVERY_JOB_CONTEXT');
      const collector = createCollector({ setup, env, now,controllerDirectory });
      const observe = async (name, read) => {
        try {
          if (now() >= setup.notAfter) fail('DISCOVERY_SETUP_EXPIRED');
          const result = await read();
          if (now() >= setup.notAfter) fail('DISCOVERY_SETUP_EXPIRED');
          report.observations[name] = { status: result?.kind==='first_runtime_endpoint_absent'?'endpoint_absent':'observed', result };
        }
        catch (error) { report.failures.push({ phase: name, code: discoveryCode(error,name) }); report.observations[name] = { status: 'failed' }; }
      };
      await Promise.all([observe('production',collector.production),observe('schema',collector.schema)]);
      if (report.observations.production.status === 'observed') await observe('runtime',() => collector.runtime(report.observations.production.result));
      else report.observations.runtime = { status: 'not_observed', reason: 'production_binding_failed' };
      if (!report.failures.length) report.status = report.observations.runtime?.result?.baselineRequired?'baseline_required':'observed';
    }
  } catch (error) { report.failures.push({ phase, code: discoveryCode(error,phase) }); }
  writeJson(env.FCOS_DISCOVERY_OUTPUT || 'setup-discovery.json', report);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), dispatchOnly = args.includes('--validate-dispatch-only'), discovery = args.includes('--discover-setup');
  const run = discovery ? discoverHostedSetup : prepareHostedManifest;
  if (args.some(arg => !['--validate-dispatch-only','--discover-setup'].includes(arg))) {
    if (discovery) {
      const report = discoveryDisposition(Date.now);
      report.failures.push({ phase: 'arguments', code: 'DISCOVERY_ARGUMENT_INVALID' });
      writeJson(process.env.FCOS_DISCOVERY_OUTPUT || 'setup-discovery.json', report);
      console.log(JSON.stringify({ status: report.status, phase: 'setup.discovery' }));
    } else console.error(JSON.stringify({ status: 'intervention_required', code: 'MANIFEST_ARGUMENT_INVALID' }));
    process.exitCode = 1;
  } else run({ validateDispatchOnly: dispatchOnly }).then(result => {
    if (discovery) { console.log(JSON.stringify({ status: result.status, phase: 'setup.discovery' })); if (result.failures.length) process.exitCode = 1; }
    else if (dispatchOnly) console.log(JSON.stringify(result));
  }).catch(error => {
    console.error(JSON.stringify({ status: 'intervention_required', code: error.code || 'MANIFEST_PREPARATION_FAILED' })); process.exitCode = 1;
  });
}
