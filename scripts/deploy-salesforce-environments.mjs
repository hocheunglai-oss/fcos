import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';
import { sourceInventory } from './sync-salesforce-shared-repository.mjs';
import { writeDeveeSourceState } from './salesforce-workflow-state.mjs';
import { openSalesforcePromotionJournal, salesforcePromotionHash, assertSuccessfulSalesforceReport } from './lib/salesforce-promotion-journal.mjs';

const salesforce = FCOS_CONNECTION_POLICY.providers.find(provider => provider.id === 'salesforce');
const EXPECTED_ORDER = ['devee', 'qat', 'production'];
const VARIABLE_CHARGE_DATA_PERMISSION = 'FCOS_Variable_Charges_Integration';
const VARIABLE_CHARGE_API_PERMISSION = 'FCOS_Variable_Charges_API';
const MASTER_CONTRACT_API_PERMISSION = 'FCOS_Master_Contracts_API';
const MASTER_CONTRACT_DATA_PERMISSION = 'FCOS_Master_Contracts_Data';

export function manifestTestClasses(manifestPath) {
  if (!manifestPath) return [];
  const xml = readFileSync(manifestPath, 'utf8');
  const blocks = [...xml.matchAll(/<types>([\s\S]*?)<name>ApexClass<\/name>[\s\S]*?<\/types>/gu)];
  return [...new Set(blocks.flatMap(([, block]) => [...block.matchAll(/<members>([^<]+)<\/members>/gu)].map(([, member]) => member.trim())).filter(member => /Test$/u.test(member)))];
}

export function promotionOptions(argv, env, cwd) {
  const allowedValues = new Set(['--manifest', '--schema-bootstrap']);
  const allowedFlags = new Set(['--check-only', '--schema-cutover']);
  const values = {}, flags = new Set();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (allowedFlags.has(arg) && !flags.has(arg)) flags.add(arg);
    else if (allowedValues.has(arg) && !values[arg] && argv[i + 1] && !argv[i + 1].startsWith('-')) values[arg] = argv[++i];
    else throw new Error('Unknown, duplicate or incomplete Salesforce promotion option.');
  }
  const MANIFEST = values['--manifest'] || env.FCOS_SALESFORCE_MANIFEST || '';
  const checkOnly = flags.has('--check-only');
  const schemaCutover = flags.has('--schema-cutover');
  if (!MANIFEST && !checkOnly) throw new Error('Salesforce promotion requires an explicit reviewed manifest.');
  const localFile = relative => {
    const absolute = path.resolve(cwd, relative), local = path.relative(cwd, absolute);
    if (!local || local.startsWith('..') || path.isAbsolute(local) || !existsSync(absolute)) throw new Error('Salesforce manifest must exist inside this project.');
    return { absolute, relative: local, bytes: readFileSync(absolute) };
  };
  const manifest = MANIFEST ? localFile(MANIFEST) : null;
  const bootstrap = values['--schema-bootstrap'] ? localFile(values['--schema-bootstrap']) : null;
  if (schemaCutover && !bootstrap) throw new Error('A schema cutover requires --schema-bootstrap manifest/<schema>.xml.');
  const manifestHasApex = /<name>Apex(?:Class|Trigger)<\/name>/u.test(manifest?.bytes.toString() || '');
  const explicitTests = (env.FCOS_SALESFORCE_TESTS || '').split(',').map(v => v.trim()).filter(Boolean);
  const tests = explicitTests.length ? explicitTests : manifestTestClasses(manifest?.absolute);
  const TEST_LEVEL = schemaCutover ? 'RunLocalTests' : env.FCOS_SALESFORCE_TEST_LEVEL || (tests.length ? 'RunSpecifiedTests' : manifestHasApex ? 'RunLocalTests' : 'RunRelevantTests');
  if (!['RunLocalTests', 'RunSpecifiedTests', 'RunRelevantTests'].includes(TEST_LEVEL)) throw new Error('FCOS_SALESFORCE_TEST_LEVEL is invalid.');
  if (manifestHasApex && TEST_LEVEL === 'RunSpecifiedTests' && !tests.length) throw new Error('An Apex promotion manifest must include at least one *Test Apex class.');
  const wait = env.FCOS_SALESFORCE_WAIT_MINUTES || '60';
  if (!/^\d+$/.test(wait) || Number(wait) < 1 || Number(wait) > 120) throw new Error('Salesforce wait must be 1 to 120 minutes.');
  return { MANIFEST, manifest, bootstrap, schemaCutover, manifestHasApex, tests, TEST_LEVEL, wait, checkOnly };
}

export async function promoteSalesforce({ argv = process.argv.slice(2), environment = process.env, cwd = process.cwd(),
  run = spawnSync, policy = salesforce, inventory = () => sourceInventory(path.join(cwd, policy.publication.sourceRoot)),
  writeSourceState = writeDeveeSourceState, now = () => new Date(), afterStage = () => {} } = {}) {
  const options = promotionOptions(argv, environment, cwd);
  const { MANIFEST, manifest, bootstrap, schemaCutover, manifestHasApex, TEST_LEVEL, tests, wait, checkOnly } = options;
  if (policy.environments.map(e => e.key).join(',') !== EXPECTED_ORDER.join(',')) throw new Error('Salesforce promotion order must be DEVEE, QAT, then Production.');
  const authoritativeInventory = inventory();
  for (const relative of authoritativeInventory.files) if (readFileSync(path.join(cwd, policy.publication.sourceRoot, relative)).includes(Buffer.from('\r\n'))) throw new Error('Salesforce source must use LF line endings before deployment and mirror publication.');
  const binding = { sourceTreeHash: authoritativeInventory.sourceTreeHash,
    manifestSha256: manifest ? salesforcePromotionHash(manifest.bytes) : null,
    bootstrapSha256: bootstrap ? salesforcePromotionHash(bootstrap.bytes) : null,
    configurationSha256: salesforcePromotionHash(policy), schemaCutover, testLevel: TEST_LEVEL, tests, checkOnly };
  const journal = openSalesforcePromotionJournal({ directory: path.join(cwd, '.fcos-cli/salesforce-promotions'), binding, now });
  const raw = (program, args) => {
    const result = run(program, args, { cwd, env: environment, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    let parsed;
    try { parsed = JSON.parse(result.stdout); } catch { throw new Error(`${program} returned an invalid response; submitted work must be reconciled before retry.`); }
    if (result.status !== 0 || program === 'sf' && parsed.status !== 0) throw new Error(`${program} failed safely; promotion stopped at the saved stage.`);
    return program === 'sf' ? parsed.result : parsed;
  };
  const sf = args => raw('sf', args);
  function verify(environment) {
    const display = sf(['org', 'display', '--target-org', environment.alias, '--json']);
    const organization = sf(['data', 'query', '--target-org', environment.alias, '--query', 'SELECT Id, IsSandbox FROM Organization LIMIT 1', '--json'])?.records?.[0];
    const usernameMatches = !environment.username || display?.username === environment.username;
    if (!usernameMatches || display?.id !== environment.orgId || display?.connectedStatus !== 'Connected'
      || organization?.Id !== environment.orgId || organization?.IsSandbox !== environment.isSandbox) throw new Error(`${environment.label} Salesforce identity mismatch.`);
    return display;
  }
  function recheckSource() {
    if (inventory().sourceTreeHash !== binding.sourceTreeHash
      || (manifest && salesforcePromotionHash(readFileSync(manifest.absolute)) !== binding.manifestSha256)
      || (bootstrap && salesforcePromotionHash(readFileSync(bootstrap.absolute)) !== binding.bootstrapSha256)
      || salesforcePromotionHash(policy) !== binding.configurationSha256) throw new Error('Salesforce source or configuration changed during promotion; restart from DEVEE for the new binding.');
  }
  function report(environment, jobId, validation = false) {
    verify(environment);
    const result = sf(['project', 'deploy', 'report', '--target-org', environment.alias, '--job-id', jobId, '--wait', wait, '--json']);
    return assertSuccessfulSalesforceReport(result, { validation, jobId, environment });
  }
  function job(environment, operation, command, validation = false) {
    recheckSource(); verify(environment);
    let state = journal.state.stages[environment.key]?.[operation];
    if (state?.status === 'submitting' && !state.jobId) throw new Error(`${environment.label} ${operation} has an uncertain submission; reconcile the job ID before resuming. No duplicate was submitted.`);
    if (state?.jobId) {
      const verified = report(environment, state.jobId, validation);
      if (state.status !== 'succeeded') journal.update(environment.key, operation, { ...verified, status: 'succeeded' });
      return verified;
    }
    journal.update(environment.key, operation, { status: 'submitting' });
    const submitted = sf(command);
    if (!submitted?.id) throw new Error('Salesforce submission returned no job ID; reconcile before retry.');
    journal.update(environment.key, operation, { status: 'submitted', jobId: submitted.id });
    const verified = report(environment, submitted.id, validation);
    journal.update(environment.key, operation, { ...verified, status: 'succeeded' });
    return verified;
  }
  function validate(environment) {
    const sourceArgs = manifest ? ['--manifest', manifest.relative] : ['--source-dir', 'force-app'];
    const command = ['project', 'deploy', 'validate', '--target-org', environment.alias, ...sourceArgs, '--test-level', TEST_LEVEL, '--async', '--json'];
    if (TEST_LEVEL === 'RunSpecifiedTests') for (const test of tests) command.push('--tests', test);
    return job(environment, 'validation', command, true);
  }
  function deploy(environment, validation) {
    // Always consume the verified validation job; metadata-only changes also resume without revalidation.
    const deployed = job(environment, 'deployment', ['project', 'deploy', 'quick', '--target-org', environment.alias, '--job-id', validation.jobId, '--async', '--json']);
    return { ...deployed, deploymentMode: !manifestHasApex && MANIFEST ? 'all-or-none-metadata' : 'validated-quick-deploy' };
  }
  function assignPermission(environment, permissionSetName) {
    recheckSource();
    const display = verify(environment);
    const username = environment.username || display.username;
    if (!username || !/^[A-Za-z0-9@._+\-]+$/.test(username)) throw new Error('Authenticated Salesforce username is invalid.');
    const args = ['data', 'query', '--target-org', environment.alias, '--query', `SELECT Id FROM PermissionSetAssignment WHERE Assignee.Username = '${username}' AND PermissionSet.Name = '${permissionSetName}' LIMIT 1`, '--json'];
    if (!sf(args)?.records?.length) {
      const result = sf(['org', 'assign', 'permset', '--target-org', environment.alias, '--name', permissionSetName, '--json']);
      if (result?.failures?.length || !sf(args)?.records?.length) throw new Error('Salesforce permission assignment could not be verified.');
    }
    journal.update(environment.key, `permission:${permissionSetName}`, { status: 'succeeded', orgId: environment.orgId });
  }
  function mirror(mode) {
    recheckSource();
    const result = raw(process.execPath, ['scripts/sync-salesforce-shared-repository.mjs', mode]);
    if (result.repository !== policy.publication.repository || result.account !== policy.publication.requiredAccount
      || result.sourceTreeHash !== binding.sourceTreeHash || result.sourceEnvironment !== 'devee'
      || result.pullRequest?.isDraft !== true || typeof result.pullRequest?.url !== 'string') throw new Error('Shared Salesforce mirror must match exact DEVEE source and an open draft PR.');
    return result;
  }
  try {
    for (const environment of policy.environments) verify(environment);
    const validations = [], deployments = [];
    let sharedPublication = null;
    // Before any resumed downstream mutation, recheck all successful upstream reports.
    for (const environment of policy.environments) {
      const stage = journal.state.stages[environment.key];
      for (const op of ['bootstrap', 'validation', 'deployment']) if (stage?.[op]?.status === 'succeeded') report(environment, stage[op].jobId, op === 'validation');
    }
    for (const environment of policy.environments) {
      recheckSource();
      if (environment.key !== 'devee' && !checkOnly) {
        const devee = policy.environments[0];
        const upstream = journal.state.stages[devee.key]?.deployment;
        if (upstream?.status !== 'succeeded') throw new Error('Successful DEVEE deployment is required before shared publication.');
        report(devee, upstream.jobId);
        if (!journal.state.stages.shared_mirror?.publication) {
          writeSourceState({ sourceTreeHash: binding.sourceTreeHash, deploymentJobId: upstream.jobId, deploymentScope: manifest.relative });
          sharedPublication = mirror('--publish');
          journal.update('shared_mirror', 'publication', { status: 'succeeded', result: sharedPublication });
        }
        sharedPublication = mirror('--check');
        journal.update('shared_mirror', 'verification', { status: 'succeeded', result: sharedPublication });
      }
      if (schemaCutover && !checkOnly) {
        deployments.push({ ...job(environment, 'bootstrap', ['project', 'deploy', 'start', '--target-org', environment.alias, '--manifest', bootstrap.relative,
          '--test-level', environment.isSandbox ? 'NoTestRun' : 'RunRelevantTests', '--async', '--json']), deploymentMode: 'all-or-none-schema-bootstrap' });
        assignPermission(environment, VARIABLE_CHARGE_DATA_PERMISSION);
        assignPermission(environment, MASTER_CONTRACT_DATA_PERMISSION);
      }
      const validation = validate(environment);
      validations.push({ environment: environment.label, ...validation });
      if (!checkOnly) {
        const deployed = deploy(environment, validation);
        deployments.push({ environment: environment.label, ...deployed });
        for (const permission of [VARIABLE_CHARGE_DATA_PERMISSION, VARIABLE_CHARGE_API_PERMISSION, MASTER_CONTRACT_API_PERMISSION, MASTER_CONTRACT_DATA_PERMISSION]) assignPermission(environment, permission);
      }
      await afterStage(environment.key, journal);
    }
    if (!checkOnly) sharedPublication = mirror('--check'); // mandatory salesforce:mirror:verify completion
    return { mode: checkOnly ? 'validate' : schemaCutover ? 'schema-cutover' : 'validate-then-deploy', source: manifest?.relative || 'force-app',
      sourceTreeHash: binding.sourceTreeHash, journal: journal.file, validations, deployments, sharedPublication };
  } finally { journal.close(); }
}

if (process.argv[1] && realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) promoteSalesforce().then(result => {
  console.log(JSON.stringify(result, null, 2));
}).catch(error => { console.error(error.message); process.exitCode = 1; });
