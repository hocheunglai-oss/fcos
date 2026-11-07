import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';
import { sourceInventory } from './sync-salesforce-shared-repository.mjs';
import { salesforcePromotionHash, assertSuccessfulSalesforceReport } from './lib/salesforce-promotion-journal.mjs';
import { assertProductionAuthorization } from './lib/salesforce-reviewed-release.mjs';
import {
  COMPLETE_SALESFORCE_SCOPE,
  FULL_SALESFORCE_TEST_LEVEL,
  SALESFORCE_RELEASE_MODE,
  archiveSalesforceWorkflowState,
  createSalesforceWorkflowState,
  deploymentResumeDisposition,
  readSalesforceWorkflowState,
  sourceStatePath,
  updateSalesforceEnvironmentState,
  validationResumeDisposition,
  workflowMatchesFrozenSource,
  writeDeveeSourceState,
  writeSalesforceWorkflowState,
} from './salesforce-workflow-state.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const salesforce = FCOS_CONNECTION_POLICY.providers.find((provider) => provider.id === 'salesforce');
const EXPECTED_ORDER = ['devee', 'qat', 'production'];
const STAGES = [
  'devee-validation', 'devee-deployment', 'shared-publication',
  'qat-validation', 'qat-deployment',
  'production-validation', 'production-deployment', 'final-mirror',
];

function optionValue(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return '';
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) throw new Error(`Provide a value after ${name}.`);
  return value;
}

export function parseDeploymentArguments(argv = process.argv.slice(2), environment = process.env) {
  const manifest = optionValue(argv, '--manifest') || environment.FCOS_SALESFORCE_MANIFEST || '';
  const checkOnly = argv.includes('--check-only');
  const explicitComplete = argv.includes('--complete-owned-tree');
  const completeOwnedTree = explicitComplete || !manifest;
  const stopAfter = optionValue(argv, '--stop-after');
  const resume = argv.includes('--resume');
  const waitMinutes = environment.FCOS_SALESFORCE_WAIT_MINUTES || '60';
  if (argv.includes('--schema-cutover') || optionValue(argv, '--schema-bootstrap') || environment.FCOS_SALESFORCE_SCHEMA_BOOTSTRAP) {
    throw new Error('This hotfix workflow is schema-free; schema bootstrap and FX permission assignment are prohibited.');
  }
  if (manifest && explicitComplete) throw new Error('Choose the complete owned source tree or a partial manifest, not both.');
  if (!completeOwnedTree && !checkOnly) throw new Error('Partial Salesforce manifests are validation-only and cannot deploy or authorize complete-source publication.');
  if (stopAfter && !STAGES.includes(stopAfter)) throw new Error(`Unknown stop stage ${stopAfter}.`);
  if (stopAfter && checkOnly) throw new Error('--stop-after is for the durable promotion workflow; check-only never deploys.');
  return { manifest, checkOnly, completeOwnedTree, stopAfter, resume, waitMinutes, releaseMode: SALESFORCE_RELEASE_MODE,
    adapter: optionValue(argv, '--adapter'), authorization: optionValue(argv, '--authorization') };
}

function pathInsideRepository(value, description) {
  const absolute = path.resolve(REPO_ROOT, value);
  const relative = path.relative(REPO_ROOT, absolute).split(path.sep).join('/');
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !existsSync(absolute)) throw new Error(`${description} must be an existing path inside this project.`);
  return { absolute, relative };
}

function resultFailure(parsed) {
  const failures = Array.isArray(parsed?.result?.failures)
    ? parsed.result.failures.map(({ name, message }) => `${name || 'Salesforce'}: ${message || 'failed'}`).join('; ')
    : '';
  return parsed?.message || failures || '';
}

function commandJson(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'], env: options.env || process.env,
  });
  const parsed = (() => { try { return JSON.parse(result.stdout); } catch { return null; } })();
  const reportedFailure = parsed && Object.hasOwn(parsed, 'status') && parsed.status !== 0;
  if (!options.allowFailure && (result.status !== 0 || reportedFailure)) throw new Error(resultFailure(parsed) || result.stderr || result.stdout || `${command} failed safely.`);
  return { exitStatus: result.status, parsed, stderr: result.stderr, stdout: result.stdout };
}
function sf(args, options = {}) { return commandJson('sf', args, options); }

function verifyIdentity(environment) {
  const display = sf(['org', 'display', '--target-org', environment.alias, '--json']).parsed?.result;
  const organization = sf(['data', 'query', '--target-org', environment.alias, '--query', 'SELECT Id, IsSandbox FROM Organization LIMIT 1', '--json']).parsed?.result?.records?.[0];
  const usernameMatches = !environment.username || display?.username === environment.username;
  if (!usernameMatches || display?.id !== environment.orgId || display?.connectedStatus !== 'Connected'
    || organization?.Id !== environment.orgId || organization?.IsSandbox !== environment.isSandbox) {
    const expectedUsername = environment.username ? ` and username ${environment.username}` : '';
    throw new Error(`${environment.label} Salesforce identity mismatch. Expected ${environment.orgId}${expectedUsername}.`);
  }
}

function manifestTestClasses(manifestPath) {
  if (!manifestPath) return [];
  const xml = readFileSync(manifestPath, 'utf8');
  const blocks = [...xml.matchAll(/<types>([\s\S]*?)<name>ApexClass<\/name>[\s\S]*?<\/types>/gu)];
  return [...new Set(blocks.flatMap(([, block]) => [...block.matchAll(/<members>([^<]+)<\/members>/gu)].map(([, member]) => member.trim())).filter((member) => /Test$/u.test(member)))];
}

function partialValidation(environment, manifest, waitMinutes) {
  verifyIdentity(environment);
  const xml = readFileSync(manifest.absolute, 'utf8');
  const hasApex = /<name>Apex(?:Class|Trigger)<\/name>/u.test(xml);
  const tests = manifestTestClasses(manifest.absolute);
  const testLevel = tests.length ? 'RunSpecifiedTests' : hasApex ? 'RunLocalTests' : 'RunRelevantTests';
  const args = ['project', 'deploy', 'validate', '--target-org', environment.alias, '--manifest', manifest.relative, '--test-level', testLevel, '--wait', waitMinutes, '--json'];
  if (testLevel === 'RunSpecifiedTests') for (const testClass of tests) args.push('--tests', testClass);
  const result = sf(args).parsed?.result;
  if (result?.status !== 'Succeeded' || !result?.id) throw new Error(`${environment.label} partial validation did not succeed.`);
  return summarizeJob(result, testLevel);
}

function summarizeJob(result, testLevel = FULL_SALESFORCE_TEST_LEVEL) {
  return {
    jobId: result?.id, status: result?.status, checkOnly: result?.checkOnly, testLevel,
    components: `${result?.numberComponentsDeployed || 0}/${result?.numberComponentsTotal || 0}`,
    tests: `${result?.numberTestsCompleted || 0}/${result?.numberTestsTotal || 0}`,
  };
}
function safeStatus(result) { return String(result?.status || 'Unknown'); }
function hasProgress(workflow) {
  return Object.values(workflow?.environments || {}).some((environment) => environment.validation || environment.deployment)
    || Boolean(workflow?.publication || workflow?.finalMirror);
}

export function assertFrozenSource(frozen, currentSourceHash) {
  if (frozen.sourceTreeHash !== currentSourceHash || frozen.releaseMode !== SALESFORCE_RELEASE_MODE) {
    throw new Error('Salesforce source changed after the workflow was frozen. Restart the promotion from DEVEE.');
  }
  return true;
}

export function assertJobReport(result, { checkOnly, environment, jobId }) {
  if (result?.id !== jobId || result?.status !== 'Succeeded' || result?.checkOnly !== checkOnly) {
    throw new Error(`${environment.label} job ${jobId} does not provide the expected successful ${checkOnly ? 'validation' : 'deployment'} proof.`);
  }
  assertSuccessfulSalesforceReport(result, { validation: checkOnly, environment, jobId });
  if (!(Number(result?.numberTestsTotal) > 0) || Number(result?.numberTestsCompleted) !== Number(result?.numberTestsTotal)) {
    throw new Error(`${environment.label} validation did not prove a complete RunLocalTests result.`);
  }
}

export function selectedMirrorProof(result, frozen) {
  const pullRequest = result?.pullRequest;
  if (result?.sourceTreeHash !== frozen.sourceTreeHash || result?.releaseMode !== frozen.releaseMode
    || result?.sourceEnvironment !== 'devee'
    || !/^0Af[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/u.test(String(result?.sourceDeploymentJobId || ''))
    || result?.repository !== salesforce.publication.repository || result?.account !== salesforce.publication.requiredAccount
    || pullRequest?.state !== 'OPEN' || pullRequest?.isDraft !== true
    || !Number.isInteger(pullRequest?.number) || pullRequest.number <= 0
    || pullRequest?.baseRefName !== salesforce.publication.defaultBranch
    || pullRequest?.headRefName !== result?.branch || pullRequest?.headRefOid !== result?.commit
    || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(String(result?.commit || ''))) {
    throw new Error('Shared Salesforce proof must be an open draft PR at the exact byte-equal source-tree commit.');
  }
  return {
    releaseMode: result.releaseMode, sourceTreeHash: result.sourceTreeHash,
    sourceDeploymentJobId: result.sourceDeploymentJobId,
    repository: result.repository, branch: result.branch, commit: result.commit,
    pullRequest: {
      number: pullRequest.number, url: pullRequest.url, state: 'OPEN', isDraft: true,
      baseRefName: pullRequest.baseRefName, headRefName: pullRequest.headRefName, headRefOid: pullRequest.headRefOid,
    },
    verifiedAt: new Date().toISOString(),
  };
}

export function acceptRefreshedMirrorWorkflow(refreshedWorkflow, frozen, proof) {
  if (!workflowMatchesFrozenSource(refreshedWorkflow, frozen)
    || refreshedWorkflow.environments.devee.deployment?.jobId !== proof.sourceDeploymentJobId) {
    throw new Error('The refreshed mirror proof no longer matches the frozen DEVEE workflow.');
  }
  return refreshedWorkflow;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseDeploymentArguments(argv);
  if (salesforce.environments.map(({ key }) => key).join(',') !== EXPECTED_ORDER.join(',')) throw new Error('Salesforce promotion order must be DEVEE, QAT, then Production.');
  if (!options.completeOwnedTree) {
    const manifest = pathInsideRepository(options.manifest, 'Salesforce manifest');
    const validations = salesforce.environments.map((environment) => ({ environment: environment.label, orgId: environment.orgId, ...partialValidation(environment, manifest, options.waitMinutes) }));
    process.stdout.write(`${JSON.stringify({ mode: 'partial-validation-only', source: manifest.relative, validations }, null, 2)}\n`);
    return;
  }

  const source = pathInsideRepository(COMPLETE_SALESFORCE_SCOPE, 'Authoritative Salesforce source');
  const initialInventory = sourceInventory(source.absolute);
  const frozen = { sourceTreeHash: initialInventory.sourceTreeHash, releaseMode: SALESFORCE_RELEASE_MODE };
  const binding = { ...frozen, sourceScope: COMPLETE_SALESFORCE_SCOPE, manifestSha256: null,
    configurationSha256: salesforcePromotionHash(salesforce),
    orgIds: Object.fromEntries(salesforce.environments.map(({ key, orgId }) => [key, orgId])),
    testPlan: { level: FULL_SALESFORCE_TEST_LEVEL, tests: [], minimumTests: 1 } };
  const releasePlan = { binding, fingerprint: salesforcePromotionHash(binding) };
  let adapter;
  if (options.adapter) {
    const module = await import(pathToFileURL(pathInsideRepository(options.adapter, 'Release ownership adapter').absolute).href);
    if (typeof module.createSalesforceAdapter !== 'function') throw new Error('The release adapter must export createSalesforceAdapter.');
    adapter = await module.createSalesforceAdapter({ cwd: REPO_ROOT, plan: releasePlan, policy: salesforce });
  }
  const checkpoint = async (environment, operation, record) => {
    if (typeof adapter?.journal?.checkpoint !== 'function') throw new Error('Complete-tree writes require an external durable release journal adapter.');
    await adapter.journal.checkpoint({ fingerprint: releasePlan.fingerprint, stage: environment.key, operation, record });
  };
  const writeGate = async (environment, operation) => {
    if (typeof adapter?.ownership?.assert !== 'function') throw new Error('Complete-tree writes require external release ownership; a local workflow is not global serialization.');
    if (environment.key === 'production' && operation !== 'validation') {
      if (!options.authorization) throw new Error('Complete-tree Production deployment requires exact unexpired source/org authorization.');
      const authorization = JSON.parse(readFileSync(pathInsideRepository(options.authorization, 'Production authorization').absolute, 'utf8'));
      assertProductionAuthorization(authorization, releasePlan);
    }
    const receipt = await adapter.ownership.assert({ fingerprint: releasePlan.fingerprint, stage: environment.key, orgId: environment.orgId, operation });
    if (!receipt?.receiptId || receipt.fingerprint !== releasePlan.fingerprint || receipt.stage !== environment.key
      || receipt.orgId !== environment.orgId || receipt.operation !== operation || !(Date.parse(receipt.expiresAt) > Date.now())) throw new Error('Complete-tree release ownership receipt is absent, expired, or mismatched.');
    return { receiptId: receipt.receiptId, receiptExpiresAt: receipt.expiresAt };
  };
  const crlfFiles = initialInventory.files.filter((relativePath) => readFileSync(path.join(source.absolute, relativePath)).includes(Buffer.from('\r\n')));
  if (crlfFiles.length) throw new Error(`Salesforce source must use LF line endings before deployment and mirror publication (${crlfFiles.length} file(s) use CRLF).`);

  const hadState = existsSync(sourceStatePath());
  let existing;
  try { existing = readSalesforceWorkflowState({ allowMissing: true }); }
  catch (error) {
    if (!String(error?.message || '').includes('malformed')) throw error;
    existing = null;
  }
  const matches = workflowMatchesFrozenSource(existing, frozen);
  if (matches && hasProgress(existing) && !options.resume) throw new Error('A promotion workflow already exists for this exact source. Rerun with --resume to reuse its job IDs.');
  if (options.checkOnly && !matches) throw new Error('Read-only complete-source validation requires an existing matching workflow; it cannot create a publication proof.');
  let workflow = matches ? existing : createSalesforceWorkflowState({ ...frozen, sourceScope: COMPLETE_SALESFORCE_SCOPE });
  if (!matches) {
    if (hadState) archiveSalesforceWorkflowState();
    workflow = writeSalesforceWorkflowState(workflow);
  }

  const persistEnvironment = (environment, changes) => {
    workflow = updateSalesforceEnvironmentState(workflow, environment.key, changes);
    workflow = writeSalesforceWorkflowState(workflow);
  };
  const persistWorkflow = (changes) => { workflow = writeSalesforceWorkflowState({ ...workflow, ...changes }); };
  const recheckFrozen = () => assertFrozenSource(frozen, sourceInventory(source.absolute).sourceTreeHash);
  const report = (environment, jobId, waitMinutes = '') => {
    verifyIdentity(environment);
    const args = ['project', 'deploy', 'report', '--target-org', environment.alias, '--job-id', jobId, '--json'];
    if (waitMinutes) args.push('--wait', waitMinutes);
    return sf(args, { allowFailure: Boolean(waitMinutes) });
  };

  const finishValidation = async (environment, jobId) => {
    recheckFrozen();
    const attempt = report(environment, jobId, options.waitMinutes);
    const result = attempt.parsed?.result;
    const status = safeStatus(result);
    if (status === 'Succeeded') { assertJobReport(result, { checkOnly: true, environment, jobId }); recheckFrozen(); }
    persistEnvironment(environment, {
      validation: {
        ...workflow.environments[environment.key].validation, ...summarizeJob(result), jobId, status,
        checkOnly: true, testLevel: FULL_SALESFORCE_TEST_LEVEL, sourceTreeHash: frozen.sourceTreeHash,
        releaseMode: SALESFORCE_RELEASE_MODE, deploymentScope: COMPLETE_SALESFORCE_SCOPE,
        completedAt: workflow.environments[environment.key].validation?.completedAt || (status === 'Succeeded' ? new Date().toISOString() : null),
        verifiedAt: new Date().toISOString(),
      },
    });
    await checkpoint(environment, 'validation', workflow.environments[environment.key].validation);
    if (attempt.exitStatus !== 0 || attempt.parsed?.status !== 0 || status !== 'Succeeded') throw new Error(resultFailure(attempt.parsed) || `${environment.label} complete-source validation did not succeed.`);
  };

  const ensureValidation = async (environment) => {
    const state = workflow.environments[environment.key];
    const disposition = validationResumeDisposition(state.validation, frozen);
    if (disposition === 'reuse') {
      recheckFrozen();
      assertJobReport(report(environment, state.validation.jobId).parsed?.result, { checkOnly: true, environment, jobId: state.validation.jobId });
      persistEnvironment(environment, { validation: { ...state.validation, verifiedAt: new Date().toISOString() } });
      await checkpoint(environment, 'validation', workflow.environments[environment.key].validation);
      return;
    }
    if (disposition === 'resume') return finishValidation(environment, state.validation.jobId);
    recheckFrozen();
    verifyIdentity(environment);
    const gate = await writeGate(environment, 'validation');
    const intent = { status: 'submitting', jobId: null, checkOnly: true, testLevel: FULL_SALESFORCE_TEST_LEVEL,
      sourceTreeHash: frozen.sourceTreeHash, releaseMode: SALESFORCE_RELEASE_MODE, deploymentScope: COMPLETE_SALESFORCE_SCOPE,
      submittedAt: new Date().toISOString(), completedAt: null, ...gate };
    persistEnvironment(environment, { validation: intent });
    await checkpoint(environment, 'validation', intent);
    recheckFrozen();
    if (!(Date.parse(gate.receiptExpiresAt) > Date.now())) throw new Error('Release ownership expired before validation submission; reconcile saved intent.');
    const submission = sf(['project', 'deploy', 'validate', '--target-org', environment.alias, '--source-dir', COMPLETE_SALESFORCE_SCOPE, '--test-level', FULL_SALESFORCE_TEST_LEVEL, '--async', '--json']).parsed?.result;
    if (!submission?.id) throw new Error(`${environment.label} validation did not return a reusable job ID.`);
    persistEnvironment(environment, {
      validation: {
        jobId: submission.id, status: safeStatus(submission) === 'Unknown' ? 'Submitted' : safeStatus(submission),
        checkOnly: true, testLevel: FULL_SALESFORCE_TEST_LEVEL, sourceTreeHash: frozen.sourceTreeHash,
        releaseMode: SALESFORCE_RELEASE_MODE, deploymentScope: COMPLETE_SALESFORCE_SCOPE,
        submittedAt: intent.submittedAt, completedAt: null, ...gate,
      },
    });
    await checkpoint(environment, 'validation', workflow.environments[environment.key].validation);
    recheckFrozen();
    await finishValidation(environment, submission.id);
  };

  const finishDeployment = async (environment, jobId) => {
    recheckFrozen();
    const attempt = report(environment, jobId, options.waitMinutes);
    const result = attempt.parsed?.result;
    const status = safeStatus(result);
    if (status === 'Succeeded') { assertJobReport(result, { checkOnly: false, environment, jobId }); recheckFrozen(); }
    const completedAt = workflow.environments[environment.key].deployment?.completedAt || (status === 'Succeeded' ? new Date().toISOString() : null);
    persistEnvironment(environment, {
      deployment: {
        ...workflow.environments[environment.key].deployment, ...summarizeJob(result), jobId, status,
        checkOnly: false, validationJobId: workflow.environments[environment.key].validation.jobId,
        testLevel: FULL_SALESFORCE_TEST_LEVEL, sourceTreeHash: frozen.sourceTreeHash,
        releaseMode: SALESFORCE_RELEASE_MODE, deploymentScope: COMPLETE_SALESFORCE_SCOPE,
        completedAt, verifiedAt: completedAt,
      },
    });
    await checkpoint(environment, 'deployment', workflow.environments[environment.key].deployment);
    if (attempt.exitStatus !== 0 || attempt.parsed?.status !== 0 || status !== 'Succeeded') throw new Error(resultFailure(attempt.parsed) || `${environment.label} complete-source quick deployment did not succeed.`);
    if (environment.key === 'devee') {
      writeDeveeSourceState({
        sourceTreeHash: frozen.sourceTreeHash, validationJobId: workflow.environments.devee.validation.jobId,
        deploymentJobId: jobId, deploymentScope: COMPLETE_SALESFORCE_SCOPE,
        deployedAt: completedAt, verifiedAt: completedAt,
      });
      workflow = readSalesforceWorkflowState();
    }
  };

  const ensureDeployment = async (environment) => {
    const state = workflow.environments[environment.key];
    const disposition = deploymentResumeDisposition(state.deployment, frozen);
    if (disposition === 'reuse') {
      recheckFrozen();
      assertJobReport(report(environment, state.deployment.jobId).parsed?.result, { checkOnly: false, environment, jobId: state.deployment.jobId });
      persistEnvironment(environment, { deployment: { ...state.deployment, verifiedAt: new Date().toISOString() } });
      await checkpoint(environment, 'deployment', workflow.environments[environment.key].deployment);
      return;
    }
    if (disposition === 'resume') return finishDeployment(environment, state.deployment.jobId);
    recheckFrozen();
    verifyIdentity(environment);
    const validationJobId = state.validation?.jobId;
    if (state.validation?.status !== 'Succeeded' || !validationJobId) throw new Error(`${environment.label} has no successful reusable validation.`);
    const gate = await writeGate(environment, 'deployment');
    const intent = { status: 'submitting', jobId: null, validationJobId, checkOnly: false, testLevel: FULL_SALESFORCE_TEST_LEVEL,
      sourceTreeHash: frozen.sourceTreeHash, releaseMode: SALESFORCE_RELEASE_MODE, deploymentScope: COMPLETE_SALESFORCE_SCOPE,
      submittedAt: new Date().toISOString(), completedAt: null, ...gate };
    persistEnvironment(environment, { deployment: intent });
    await checkpoint(environment, 'deployment', intent);
    recheckFrozen();
    if (!(Date.parse(gate.receiptExpiresAt) > Date.now())) throw new Error('Release ownership expired before quick deployment; reconcile saved intent.');
    if (environment.key === 'production') {
      const authorization = JSON.parse(readFileSync(pathInsideRepository(options.authorization, 'Production authorization').absolute, 'utf8'));
      assertProductionAuthorization(authorization, releasePlan);
    }
    const submission = sf(['project', 'deploy', 'quick', '--target-org', environment.alias, '--job-id', validationJobId, '--async', '--json']).parsed?.result;
    if (!submission?.id) throw new Error(`${environment.label} quick deployment did not return a resumable job ID.`);
    persistEnvironment(environment, {
      deployment: {
        jobId: submission.id, validationJobId,
        status: safeStatus(submission) === 'Unknown' ? 'Submitted' : safeStatus(submission), checkOnly: false,
        testLevel: FULL_SALESFORCE_TEST_LEVEL, sourceTreeHash: frozen.sourceTreeHash,
        releaseMode: SALESFORCE_RELEASE_MODE, deploymentScope: COMPLETE_SALESFORCE_SCOPE,
        submittedAt: intent.submittedAt, completedAt: null, ...gate,
      },
    });
    await checkpoint(environment, 'deployment', workflow.environments[environment.key].deployment);
    recheckFrozen();
    await finishDeployment(environment, submission.id);
  };

  const mirror = async (mode) => {
    recheckFrozen();
    if (mode === 'publish') {
      const gate = await writeGate(salesforce.environments[0], 'shared-publication');
      await checkpoint(salesforce.environments[0], 'shared-publication', { status: 'submitting', ...gate });
    }
    const result = commandJson(process.execPath, ['scripts/sync-salesforce-shared-repository.mjs', `--${mode}`]);
    recheckFrozen();
    const proof = selectedMirrorProof(result.parsed, frozen);
    workflow = acceptRefreshedMirrorWorkflow(readSalesforceWorkflowState(), frozen, proof);
    return proof;
  };
  const ensurePublication = async () => { const proof = await mirror(workflow.publication ? 'check' : 'publish'); persistWorkflow({ publication: proof }); return proof; };
  const finalMirror = async () => { const proof = await mirror('check'); persistWorkflow({ finalMirror: proof }); return proof; };
  const stop = (stage) => options.stopAfter === stage;
  const output = (mode, stoppedAfter = null) => process.stdout.write(`${JSON.stringify({
    mode, stoppedAfter, releaseMode: SALESFORCE_RELEASE_MODE, source: COMPLETE_SALESFORCE_SCOPE,
    sourceTreeHash: frozen.sourceTreeHash, environments: workflow.environments,
    publication: workflow.publication, finalMirror: workflow.finalMirror,
  }, null, 2)}\n`);

  if (options.checkOnly) {
    for (const environment of salesforce.environments) { verifyIdentity(environment); await ensureValidation(environment); }
    output('complete-source-validation-only');
    return;
  }

  const [devee, qat, production] = salesforce.environments;
  await ensureValidation(devee);
  if (stop('devee-validation')) return output('promotion-stopped', 'devee-validation');
  await ensureDeployment(devee);
  if (stop('devee-deployment')) return output('promotion-stopped', 'devee-deployment');
  await ensurePublication();
  if (stop('shared-publication')) return output('promotion-stopped', 'shared-publication');
  await ensureValidation(qat);
  if (stop('qat-validation')) return output('promotion-stopped', 'qat-validation');
  await ensureDeployment(qat);
  if (stop('qat-deployment')) return output('promotion-stopped', 'qat-deployment');
  // Re-read the immutable shared draft before the first Production operation.
  await ensurePublication();
  await ensureValidation(production);
  if (stop('production-validation')) return output('promotion-stopped', 'production-validation');
  await ensureDeployment(production);
  if (stop('production-deployment')) return output('promotion-stopped', 'production-deployment');
  await finalMirror();
  output('complete-source-promoted', stop('final-mirror') ? 'final-mirror' : null);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
