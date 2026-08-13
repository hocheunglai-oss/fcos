import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';

const salesforce = FCOS_CONNECTION_POLICY.providers.find((provider) => provider.id === 'salesforce');
const MANIFEST_INDEX = process.argv.indexOf('--manifest');
const MANIFEST = MANIFEST_INDEX >= 0
  ? process.argv[MANIFEST_INDEX + 1]
  : (process.env.FCOS_SALESFORCE_MANIFEST || 'manifest/special-term-clause-bank.xml');
const CHECK_ONLY = process.argv.includes('--check-only');
const WAIT_MINUTES = process.env.FCOS_SALESFORCE_WAIT_MINUTES || '60';
const TEST_CLASSES = (process.env.FCOS_SALESFORCE_TESTS || 'SpecialTermClauseCompilerTest,SpecialTermTriggerHandlerTest,SpecialTermRevisionServiceTest').split(',').map((value) => value.trim()).filter(Boolean);

if (!MANIFEST || MANIFEST.startsWith('-')) throw new Error('Provide a manifest path after --manifest.');
const manifestPath = path.resolve(process.cwd(), MANIFEST);
const relativeManifest = path.relative(process.cwd(), manifestPath);
if (!relativeManifest || relativeManifest.startsWith('..') || path.isAbsolute(relativeManifest) || !existsSync(manifestPath)) {
  throw new Error('Salesforce manifest must be an existing file inside this project.');
}

function sf(args) {
  const result = spawnSync('sf', args, { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const parsed = (() => { try { return JSON.parse(result.stdout); } catch { return null; } })();
  if (result.status !== 0 || parsed?.status !== 0) throw new Error(parsed?.message || result.stderr || result.stdout || 'Salesforce CLI command failed.');
  return parsed;
}

function verify(environment) {
  const display = sf(['org', 'display', '--target-org', environment.alias, '--json']).result;
  const organization = sf(['data', 'query', '--target-org', environment.alias, '--query', 'SELECT Id, IsSandbox FROM Organization LIMIT 1', '--json']).result?.records?.[0];
  if (display?.id !== environment.orgId || display?.connectedStatus !== 'Connected' || organization?.Id !== environment.orgId || organization?.IsSandbox !== environment.isSandbox) {
    throw new Error(`${environment.label} Salesforce identity mismatch. Expected ${environment.orgId}.`);
  }
}

for (const environment of salesforce.environments) verify(environment);

const validations = [];
for (const environment of salesforce.environments) {
  verify(environment);
  const command = ['project', 'deploy', 'validate', '--target-org', environment.alias, '--manifest', relativeManifest, '--wait', WAIT_MINUTES, '--json'];
  command.push('--test-level', TEST_CLASSES.length ? 'RunSpecifiedTests' : 'RunLocalTests');
  for (const testClass of TEST_CLASSES) command.push('--tests', testClass);
  const result = sf(command).result;
  validations.push({ environment, jobId: result?.id, status: result?.status, components: `${result?.numberComponentsDeployed || 0}/${result?.numberComponentsTotal || 0}`, tests: `${result?.numberTestsCompleted || 0}/${result?.numberTestsTotal || 0}` });
}

const deployments = [];
if (!CHECK_ONLY) {
  for (const validation of validations) {
    verify(validation.environment);
    const result = sf(['project', 'deploy', 'quick', '--target-org', validation.environment.alias, '--job-id', validation.jobId, '--wait', WAIT_MINUTES, '--json']).result;
    deployments.push({ environment: validation.environment.label, orgId: validation.environment.orgId, jobId: result?.id || validation.jobId, status: result?.status, components: `${result?.numberComponentsDeployed || 0}/${result?.numberComponentsTotal || 0}`, tests: `${result?.numberTestsCompleted || 0}/${result?.numberTestsTotal || 0}` });
  }
}

console.log(JSON.stringify({
  mode: CHECK_ONLY ? 'validate' : 'validate-then-deploy',
  manifest: relativeManifest,
  validations: validations.map(({ environment, ...result }) => ({ environment: environment.label, orgId: environment.orgId, ...result })),
  deployments,
}, null, 2));
