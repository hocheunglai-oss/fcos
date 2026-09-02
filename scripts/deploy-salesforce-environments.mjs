import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';
import { sourceInventory } from './sync-salesforce-shared-repository.mjs';
import { writeDeveeSourceState } from './salesforce-workflow-state.mjs';

const salesforce = FCOS_CONNECTION_POLICY.providers.find((provider) => provider.id === 'salesforce');
const MANIFEST_INDEX = process.argv.indexOf('--manifest');
const MANIFEST = MANIFEST_INDEX >= 0
  ? process.argv[MANIFEST_INDEX + 1]
  : (process.env.FCOS_SALESFORCE_MANIFEST || '');
const CHECK_ONLY = process.argv.includes('--check-only');
const SCHEMA_CUTOVER = process.argv.includes('--schema-cutover');
const SCHEMA_BOOTSTRAP_INDEX = process.argv.indexOf('--schema-bootstrap');
const SCHEMA_BOOTSTRAP = SCHEMA_BOOTSTRAP_INDEX >= 0 ? process.argv[SCHEMA_BOOTSTRAP_INDEX + 1] : '';
const WAIT_MINUTES = process.env.FCOS_SALESFORCE_WAIT_MINUTES || '60';
const EXPECTED_ORDER = ['devee', 'qat', 'production'];
const VARIABLE_CHARGE_DATA_PERMISSION = 'FCOS_Variable_Charges_Integration';
const VARIABLE_CHARGE_API_PERMISSION = 'FCOS_Variable_Charges_API';
const MASTER_CONTRACT_API_PERMISSION = 'FCOS_Master_Contracts_API';
const MASTER_CONTRACT_DATA_PERMISSION = 'FCOS_Master_Contracts_Data';
const HEDGE_INTEGRATION_PERMISSION = 'FCOS_Hedge_Integration';

if (MANIFEST_INDEX >= 0 && (!MANIFEST || MANIFEST.startsWith('-'))) throw new Error('Provide a manifest path after --manifest.');
if (SCHEMA_CUTOVER && (!SCHEMA_BOOTSTRAP || SCHEMA_BOOTSTRAP.startsWith('-'))) {
  throw new Error('A schema cutover requires --schema-bootstrap manifest/<schema>.xml.');
}
if (!MANIFEST && !CHECK_ONLY) throw new Error('Salesforce promotion requires an explicit reviewed manifest. Use --manifest manifest/<change>.xml.');
const sourcePath = MANIFEST ? path.resolve(process.cwd(), MANIFEST) : path.resolve(process.cwd(), 'force-app');
const relativeSource = path.relative(process.cwd(), sourcePath);
if (!relativeSource || relativeSource.startsWith('..') || path.isAbsolute(relativeSource) || !existsSync(sourcePath)) {
  throw new Error(MANIFEST ? 'Salesforce manifest must be an existing file inside this project.' : 'The force-app source directory is missing.');
}
const manifestContent = MANIFEST ? readFileSync(sourcePath, 'utf8') : '';
const manifestHasApex = /<name>Apex(?:Class|Trigger)<\/name>/u.test(manifestContent);

function manifestTestClasses(manifestPath) {
  if (!manifestPath) return [];
  const xml = readFileSync(manifestPath, 'utf8');
  const apexBlocks = [...xml.matchAll(/<types>([\s\S]*?)<name>ApexClass<\/name>[\s\S]*?<\/types>/gu)];
  return [...new Set(apexBlocks.flatMap(([, block]) => (
    [...block.matchAll(/<members>([^<]+)<\/members>/gu)].map(([, member]) => member.trim())
  )).filter((member) => /Test$/u.test(member)))];
}

const EXPLICIT_TEST_CLASSES = (process.env.FCOS_SALESFORCE_TESTS || '').split(',').map((value) => value.trim()).filter(Boolean);
const TEST_CLASSES = EXPLICIT_TEST_CLASSES.length ? EXPLICIT_TEST_CLASSES : manifestTestClasses(MANIFEST ? sourcePath : '');
const TEST_LEVEL = process.env.FCOS_SALESFORCE_TEST_LEVEL
  || (TEST_CLASSES.length ? 'RunSpecifiedTests' : manifestHasApex ? 'RunLocalTests' : 'RunRelevantTests');
if (!['RunLocalTests', 'RunSpecifiedTests', 'RunRelevantTests'].includes(TEST_LEVEL)) {
  throw new Error('FCOS_SALESFORCE_TEST_LEVEL must be RunLocalTests, RunSpecifiedTests, or RunRelevantTests.');
}
if (manifestHasApex && TEST_LEVEL === 'RunSpecifiedTests' && !TEST_CLASSES.length) {
  throw new Error('An Apex promotion manifest must include at least one *Test Apex class or set FCOS_SALESFORCE_TESTS.');
}

const authoritativeInventory = sourceInventory();
const crlfFiles = authoritativeInventory.files.filter((relativePath) => (
  readFileSync(path.resolve(process.cwd(), salesforce.publication.sourceRoot, relativePath)).includes(Buffer.from('\r\n'))
));
if (crlfFiles.length) {
  throw new Error(`Salesforce source must use LF line endings before deployment and mirror publication (${crlfFiles.length} file(s) use CRLF).`);
}

function sf(args) {
  const result = spawnSync('sf', args, { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const parsed = (() => { try { return JSON.parse(result.stdout); } catch { return null; } })();
  const resultFailures = Array.isArray(parsed?.result?.failures)
    ? parsed.result.failures.map(({ name, message }) => `${name || 'Salesforce'}: ${message || 'failed'}`).join('; ')
    : '';
  if (result.status !== 0 || parsed?.status !== 0) {
    throw new Error(parsed?.message || resultFailures || result.stderr || result.stdout || 'Salesforce CLI command failed.');
  }
  return parsed;
}

function verify(environment) {
  const display = sf(['org', 'display', '--target-org', environment.alias, '--json']).result;
  const organization = sf(['data', 'query', '--target-org', environment.alias, '--query', 'SELECT Id, IsSandbox FROM Organization LIMIT 1', '--json']).result?.records?.[0];
  const usernameMatches = !environment.username || display?.username === environment.username;
  if (!usernameMatches || display?.id !== environment.orgId || display?.connectedStatus !== 'Connected' || organization?.Id !== environment.orgId || organization?.IsSandbox !== environment.isSandbox) {
    const expectedUsername = environment.username ? ` and username ${environment.username}` : '';
    throw new Error(`${environment.label} Salesforce identity mismatch. Expected ${environment.orgId}${expectedUsername}.`);
  }
}

function assignPermission(environment, permissionSetName) {
  verify(environment);
  const username = environment.username || sf(['org', 'display', '--target-org', environment.alias, '--json']).result?.username;
  if (!username) throw new Error(`${environment.label} authenticated username is unavailable.`);
  const existing = sf([
    'data', 'query', '--target-org', environment.alias,
    '--query', `SELECT Id FROM PermissionSetAssignment WHERE Assignee.Username = '${username}' AND PermissionSet.Name = '${permissionSetName}' LIMIT 1`,
    '--json',
  ]).result?.records || [];
  if (existing.length) return;
  const result = sf([
    'org', 'assign', 'permset', '--target-org', environment.alias,
    '--name', permissionSetName, '--json',
  ]).result;
  const failures = Array.isArray(result?.failures) ? result.failures : [];
  if (failures.length) throw new Error(`${environment.label} permission assignment failed safely.`);
}

for (const environment of salesforce.environments) verify(environment);

if (salesforce.environments.map(({ key }) => key).join(',') !== EXPECTED_ORDER.join(',')) {
  throw new Error('Salesforce promotion order must be DEVEE, QAT, then Production.');
}

function validate(environment) {
  verify(environment);
  const sourceArgs = MANIFEST ? ['--manifest', relativeSource] : ['--source-dir', relativeSource];
  const command = ['project', 'deploy', 'validate', '--target-org', environment.alias, ...sourceArgs, '--wait', WAIT_MINUTES, '--json'];
  command.push('--test-level', TEST_LEVEL);
  if (TEST_LEVEL === 'RunSpecifiedTests') {
    for (const testClass of TEST_CLASSES) command.push('--tests', testClass);
  }
  const result = sf(command).result;
  if (result?.status !== 'Succeeded' || !result?.id) throw new Error(`${environment.label} validation did not succeed.`);
  return { environment, jobId: result.id, status: result.status, components: `${result?.numberComponentsDeployed || 0}/${result?.numberComponentsTotal || 0}`, tests: `${result?.numberTestsCompleted || 0}/${result?.numberTestsTotal || 0}` };
}

function deploy(validation) {
  verify(validation.environment);
  const result = !manifestHasApex && MANIFEST
    ? sf([
        'project', 'deploy', 'start', '--target-org', validation.environment.alias,
        '--manifest', relativeSource, '--test-level', 'RunRelevantTests',
        '--wait', WAIT_MINUTES, '--json',
      ]).result
    : sf([
        'project', 'deploy', 'quick', '--target-org', validation.environment.alias,
        '--job-id', validation.jobId, '--wait', WAIT_MINUTES, '--json',
      ]).result;
  if (result?.status !== 'Succeeded') throw new Error(`${validation.environment.label} deployment did not succeed; later promotion stages were not started.`);
  return {
    environment: validation.environment.label,
    orgId: validation.environment.orgId,
    jobId: result?.id || validation.jobId,
    status: result.status,
    components: `${result?.numberComponentsDeployed || 0}/${result?.numberComponentsTotal || 0}`,
    tests: `${result?.numberTestsCompleted || 0}/${result?.numberTestsTotal || 0}`,
    deploymentMode: !manifestHasApex && MANIFEST ? 'all-or-none-metadata' : 'validated-quick-deploy',
  };
}

function deploySchemaBootstrap(environment) {
  verify(environment);
  const bootstrapPath = path.resolve(process.cwd(), SCHEMA_BOOTSTRAP);
  const relativeBootstrap = path.relative(process.cwd(), bootstrapPath);
  if (!relativeBootstrap || relativeBootstrap.startsWith('..') || path.isAbsolute(relativeBootstrap) || !existsSync(bootstrapPath)) {
    throw new Error('The schema-bootstrap manifest must be an existing file inside this project.');
  }
  const command = [
    'project', 'deploy', 'start', '--target-org', environment.alias,
    '--manifest', relativeBootstrap, '--wait', WAIT_MINUTES, '--json',
    '--test-level', environment.isSandbox ? 'NoTestRun' : 'RunRelevantTests',
  ];
  const result = sf(command).result;
  if (result?.status !== 'Succeeded' || !result?.id) {
    throw new Error(`${environment.label} schema-bootstrap deployment did not succeed; later promotion stages were not started.`);
  }
  return {
    environment: environment.label,
    orgId: environment.orgId,
    jobId: result.id,
    status: result.status,
    components: `${result?.numberComponentsDeployed || 0}/${result?.numberComponentsTotal || 0}`,
    tests: `${result?.numberTestsCompleted || 0}/${result?.numberTestsTotal || 0}`,
    deploymentMode: 'all-or-none-schema-bootstrap',
  };
}

const validations = [];
const deployments = [];
let sharedPublication = null;
if (CHECK_ONLY) {
  for (const environment of salesforce.environments) validations.push(validate(environment));
} else {
  const devee = salesforce.environments[0];
  const deveeValidation = validate(devee);
  validations.push(deveeValidation);
  const deveeDeployment = deploy(deveeValidation);
  deployments.push(deveeDeployment);
  assignPermission(devee, VARIABLE_CHARGE_DATA_PERMISSION);
  assignPermission(devee, VARIABLE_CHARGE_API_PERMISSION);
  assignPermission(devee, MASTER_CONTRACT_API_PERMISSION);
  assignPermission(devee, MASTER_CONTRACT_DATA_PERMISSION);
  assignPermission(devee, HEDGE_INTEGRATION_PERMISSION);
  const inventory = sourceInventory();
  writeDeveeSourceState({
    sourceTreeHash: inventory.sourceTreeHash,
    deploymentJobId: deveeDeployment.jobId,
    deploymentScope: relativeSource,
  });

  const publication = spawnSync(process.execPath, ['scripts/sync-salesforce-shared-repository.mjs', '--publish'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (publication.status !== 0) throw new Error(publication.stderr || publication.stdout || 'Shared Salesforce publication failed.');
  try {
    sharedPublication = JSON.parse(publication.stdout);
  } catch {
    throw new Error('Shared Salesforce publication returned an invalid response.');
  }

  for (const environment of salesforce.environments.slice(1)) {
    if (SCHEMA_CUTOVER) {
      deployments.push(deploySchemaBootstrap(environment));
      assignPermission(environment, VARIABLE_CHARGE_DATA_PERMISSION);
      assignPermission(environment, MASTER_CONTRACT_DATA_PERMISSION);
      assignPermission(environment, HEDGE_INTEGRATION_PERMISSION);
    }
    const validation = validate(environment);
    validations.push(validation);
    deployments.push(deploy(validation));
    assignPermission(environment, VARIABLE_CHARGE_API_PERMISSION);
    assignPermission(environment, MASTER_CONTRACT_API_PERMISSION);
    assignPermission(environment, MASTER_CONTRACT_DATA_PERMISSION);
    assignPermission(environment, HEDGE_INTEGRATION_PERMISSION);
  }
}

console.log(JSON.stringify({
  mode: CHECK_ONLY ? 'validate' : SCHEMA_CUTOVER ? 'validate-devee-then-schema-cutover' : 'validate-then-deploy',
  source: relativeSource,
  validations: validations.map(({ environment, ...result }) => ({ environment: environment.label, orgId: environment.orgId, ...result })),
  deployments,
  sharedPublication,
}, null, 2));
