import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseDocument } from 'htmlparser2';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';
import { openSalesforcePromotionJournal, salesforcePromotionHash } from './lib/salesforce-promotion-journal.mjs';
import { INVENTORY_BASELINE_MODE, createReviewedSalesforcePlan, inventoryFromFiles, parseReviewedPackage, readReviewedInventory, runReviewedSalesforceRelease, safeProjectFile } from './lib/salesforce-reviewed-release.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POLICY = FCOS_CONNECTION_POLICY.providers.find(({ id }) => id === 'salesforce');

export function reviewedSalesforceOptions(argv) {
  const [mode, ...args] = argv;
  if (!['prepare', 'apply'].includes(mode)) throw new Error('Usage: deploy-salesforce-reviewed-manifest.mjs prepare|apply --manifest manifest/package.xml --review review.json --adapter adapter.mjs [--authorization authorization.json].');
  const options = { mode };
  const names = new Set(['--manifest', '--review', '--adapter', '--authorization', '--replace-validation', '--reconcile']);
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (!names.has(name) || options[name] || !args[index + 1] || args[index + 1].startsWith('-')) throw new Error('Unknown, duplicate, or incomplete reviewed Salesforce option.');
    options[name] = args[++index];
  }
  for (const name of ['--manifest', '--review', '--adapter']) if (!options[name]) throw new Error(`${name} is required. No complete-tree or unowned write fallback is implicit.`);
  if (mode === 'prepare' && options['--authorization']) throw new Error('Prepare does not accept Production mutation authorization. Use apply for authorized Production changes.');
  const replacements = options['--replace-validation']?.split(',') || [];
  if (replacements.some(key => !['devee', 'qat', 'production'].includes(key)) || replacements.length !== new Set(replacements).size) throw new Error('Validation replacement must name unique current environments.');
  return { ...options, replaceValidation: replacements };
}

function localCommand(program, args, cwd, { json = true, env = process.env, binary = false, input } = {}) {
  const result = spawnSync(program, args, { cwd, env, encoding: binary ? undefined : 'utf8', input, maxBuffer: 64 * 1024 * 1024, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
  let parsed;
  if (json) try { parsed = JSON.parse(result.stdout); } catch { throw new Error(`${program} returned invalid JSON; reconcile any saved submission before retry.`); }
  if (result.status !== 0 || (program === 'sf' && parsed?.status !== 0)) throw new Error(`${program} failed; saved work must be read back before retry.`);
  return json ? (program === 'sf' ? parsed.result : parsed) : result.stdout;
}

export function baselineGitInventory(cwd, commit, run = localCommand) {
  if (!/^[a-f0-9]{40}$/u.test(commit || '')) throw new Error('Baseline must be an exact Git commit.');
  const prefix = 'force-app/main/default/';
  const listing = run('git', ['ls-tree', '-rz', commit, '--', prefix], cwd, { json: false });
  const entries = listing.split('\0').filter(Boolean).map(line => {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/u.exec(line);
    if (!match || !match[3].startsWith(prefix)) throw new Error('Baseline metadata contains unsupported file types.');
    return { sha: match[2], name: match[3] };
  });
  if (!entries.length) throw new Error('Baseline metadata inventory is unavailable. Use the explicit complete-tree route.');
  // Two Git calls for the entire tree, preserving arbitrary binary bytes.
  const objects = run('git', ['cat-file', '--batch'], cwd, { json: false, binary: true, input: `${entries.map(({ sha }) => sha).join('\n')}\n` });
  const files = {};
  let offset = 0;
  for (const { sha, name } of entries) {
    const newline = objects.indexOf(10, offset), header = objects.subarray(offset, newline).toString();
    const match = /^([a-f0-9]{40}) blob (\d+)$/u.exec(header);
    if (!match || match[1] !== sha) throw new Error('Baseline Git object readback mismatch.');
    const length = Number(match[2]), start = newline + 1, end = start + length;
    if (end >= objects.length || objects[end] !== 10) throw new Error('Baseline Git object was truncated.');
    files[name.slice(prefix.length)] = objects.subarray(start, end);
    offset = end + 1;
  }
  return inventoryFromFiles(files);
}

export function loadReviewedSalesforcePlan({ cwd = ROOT, manifestPath, reviewPath, policy = POLICY }) {
  const reviewAbsolute = safeProjectFile(cwd, reviewPath), manifestAbsolute = safeProjectFile(cwd, manifestPath);
  const review = JSON.parse(readFileSync(reviewAbsolute, 'utf8'));
  const baselineWorkflowAbsolute = review.baselineMode === INVENTORY_BASELINE_MODE ? null : safeProjectFile(cwd, review.baselineWorkflowPath);
  const baselineWorkflow = baselineWorkflowAbsolute ? JSON.parse(readFileSync(baselineWorkflowAbsolute, 'utf8')) : null;
  const sourceRoot = path.join(cwd, policy.publication.sourceRoot);
  const bootstrapAbsolute = review.bootstrap ? safeProjectFile(cwd, review.bootstrap.manifestPath) : null;
  const inputs = { review, manifestBytes: readFileSync(manifestAbsolute), bootstrapBytes: bootstrapAbsolute ? readFileSync(bootstrapAbsolute) : null,
    baselineWorkflow, baselineInventory: baselineGitInventory(cwd, review.baselineCommit), finalInventory: readReviewedInventory(sourceRoot), policy };
  const plan = createReviewedSalesforcePlan(inputs);
  return { ...plan, manifestPath, reviewPath, manifestAbsolute, reviewAbsolute, baselineWorkflowAbsolute, bootstrapAbsolute,
    inputDigests: { review: salesforcePromotionHash(readFileSync(reviewAbsolute)), baseline: baselineWorkflowAbsolute ? salesforcePromotionHash(readFileSync(baselineWorkflowAbsolute)) : null } };
}

export function assertReviewedInputsUnchanged(plan, { cwd = ROOT, policy = POLICY } = {}) {
  if (readReviewedInventory(path.join(cwd, policy.publication.sourceRoot)).sourceTreeHash !== plan.binding.sourceTreeHash
    || salesforcePromotionHash(readFileSync(plan.manifestAbsolute)) !== plan.binding.manifestSha256
    || salesforcePromotionHash(readFileSync(plan.reviewAbsolute)) !== plan.inputDigests.review
    || (plan.baselineWorkflowAbsolute && salesforcePromotionHash(readFileSync(plan.baselineWorkflowAbsolute)) !== plan.inputDigests.baseline)
    || (plan.bootstrapAbsolute && salesforcePromotionHash(readFileSync(plan.bootstrapAbsolute)) !== plan.binding.bootstrapSha256)
    || salesforcePromotionHash(policy) !== plan.binding.configurationSha256) throw new Error('Salesforce source, manifest, review, baseline, or connection policy changed; restart prepare from DEVEE.');
}

function normalizedBootstrapDefinition(xml) {
  if (xml.includes('xml:space')) return [xml];
  const { children } = parseDocument(xml, { xmlMode: true, decodeEntities: false });
  function significantText(nodes) {
    const elementOnly = nodes.some(node => node.type === 'tag')
      && !nodes.some(node => node.type === 'text' && node.data.trim() !== '');
    return nodes.flatMap(node => {
      if (node.children) return significantText(node.children);
      return node.type === 'text' && !elementOnly ? [node.data] : [];
    });
  }
  // Check the raw markup as well as leaf and mixed-content whitespace. Only
  // whitespace between structural elements may vary during conversion.
  return [xml.trim().replace(/>\s+</gu, '><'), significantText(children)];
}

function assertBootstrapPackage(converted, roundTrip, members, files, sourceRoot, apiVersion) {
  const packageBytes = readFileSync(safeProjectFile(converted, 'package.xml'), 'utf8');
  const actualMembers = parseReviewedPackage(packageBytes);
  const versions = [...packageBytes.matchAll(/<version>\s*(\d+\.0)\s*<\/version>/gu)];
  if (JSON.stringify(actualMembers) !== JSON.stringify([...members].sort())
    || versions.length !== 1 || versions[0][1] !== apiVersion) {
    throw new Error('Converted Salesforce bootstrap manifest differs from the reviewed package.');
  }
  const expectedPackageFiles = new Set(['package.xml']);
  const allowedShells = new Set();
  for (const id of members) {
    const [type, name] = id.split(':');
    if (type === 'PermissionSet') expectedPackageFiles.add(`permissionsets/${name}.permissionset`);
    else {
      const object = name.split('.')[0];
      expectedPackageFiles.add(`objects/${object}.object`);
      if (!members.has(`CustomObject:${object}`)) allowedShells.add(`objects/${object}/${object}.object-meta.xml`);
    }
  }
  const actualPackageFiles = Object.keys(readReviewedInventory(converted).files);
  if (JSON.stringify(actualPackageFiles.sort()) !== JSON.stringify([...expectedPackageFiles].sort())) {
    throw new Error('Converted Salesforce bootstrap contains unexpected or missing package files.');
  }
  const roundTripFiles = Object.keys(readReviewedInventory(roundTrip).files);
  for (const file of roundTripFiles) {
    if (files.has(file)) continue;
    const shell = allowedShells.has(file) && readFileSync(safeProjectFile(roundTrip, file), 'utf8')
      .replace(/^<\?xml[^?]*\?>\s*/u, '').trim();
    if (!shell || !/^<CustomObject xmlns="http:\/\/soap\.sforce\.com\/2006\/04\/metadata"(?:\s*\/>|>\s*<\/CustomObject>)$/u.test(shell)) {
      throw new Error(`Converted Salesforce bootstrap expanded outside reviewed source: ${file}`);
    }
  }
  if ([...files].some(file => !roundTripFiles.includes(file))) throw new Error('Converted Salesforce bootstrap is missing reviewed source.');
  for (const file of files) {
    const source = readFileSync(safeProjectFile(sourceRoot, file), 'utf8');
    const restored = readFileSync(safeProjectFile(roundTrip, file), 'utf8');
    if (source !== restored && JSON.stringify(normalizedBootstrapDefinition(source)) !== JSON.stringify(normalizedBootstrapDefinition(restored))) {
      throw new Error(`Converted Salesforce bootstrap definition differs from reviewed source: ${file}`);
    }
  }
}

export function cliSalesforceProvider({ cwd = ROOT, policy = POLICY, run = localCommand, adapter = {}, adapterPath, commandEnvironment } = {}) {
  const sf = (args, directory = cwd) => run('sf', args, directory, { env: commandEnvironment });
  return {
    verifyIdentity(environment) {
      const display = sf(['org', 'display', '--target-org', environment.alias, '--json']);
      const org = sf(['data', 'query', '--target-org', environment.alias, '--query', 'SELECT Id, IsSandbox FROM Organization LIMIT 1', '--json'])?.records?.[0];
      if (display?.id !== environment.orgId || display?.connectedStatus !== 'Connected' || (environment.username && display?.username !== environment.username)
        || org?.Id !== environment.orgId || org?.IsSandbox !== environment.isSandbox) throw new Error(`${environment.label} Salesforce identity mismatch.`);
      return display;
    },
    report(environment, jobId) { return sf(['project', 'deploy', 'report', '--target-org', environment.alias, '--job-id', jobId, '--wait', '60', '--json']); },
    validate(environment, plan) {
      const args = ['project', 'deploy', 'validate', '--target-org', environment.alias, '--manifest', plan.manifestPath, '--test-level', plan.binding.testPlan.level, '--async', '--json'];
      if (plan.binding.testPlan.level === 'RunSpecifiedTests') for (const name of plan.binding.testPlan.tests) args.push('--tests', name);
      return sf(args);
    },
    deploy(environment, validationJobId) { return sf(['project', 'deploy', 'quick', '--target-org', environment.alias, '--job-id', validationJobId, '--async', '--json']); },
    prepareBootstrap(environment, plan) {
      const bootstrap = plan.review.bootstrap;
      const manifest = readFileSync(safeProjectFile(cwd, bootstrap.manifestPath));
      if (salesforcePromotionHash(manifest) !== plan.binding.bootstrapSha256) throw new Error('Salesforce bootstrap manifest changed.');
      const versions = [...manifest.toString('utf8').matchAll(/<version>\s*(\d+\.0)\s*<\/version>/gu)];
      if (versions.length !== 1) throw new Error('Salesforce bootstrap requires one explicit metadata API version.');
      const members = new Set(bootstrap.components);
      const files = new Set(plan.review.components.filter(({ id }) => members.has(id)).flatMap(({ files }) => files));
      const project = mkdtempSync(path.join(tmpdir(), 'fcos-salesforce-bootstrap-'));
      const cleanup = () => rmSync(project, { recursive: true, force: true });
      try {
        writeFileSync(path.join(project, 'sfdx-project.json'), JSON.stringify({
          packageDirectories: [{ path: 'force-app', default: true }], namespace: '', sourceApiVersion: versions[0][1],
        }));
        writeFileSync(path.join(project, 'bootstrap.xml'), manifest, { mode: 0o600 });
        // A source-format manifest can otherwise pull in unreviewed parent and child metadata.
        for (const name of files) {
          const relative = `${policy.publication.sourceRoot}/${name}`;
          const bytes = readFileSync(safeProjectFile(cwd, relative));
          if (salesforcePromotionHash(bytes) !== plan.finalInventory.files[name]?.sha256) {
            throw new Error(`Salesforce bootstrap source changed: ${name}`);
          }
          const destination = path.join(project, relative);
          mkdirSync(path.dirname(destination), { recursive: true });
          writeFileSync(destination, bytes, { mode: 0o600 });
        }
        const converted = path.join(project, 'converted');
        const roundTrip = path.join(project, 'round-trip');
        const apiVersion = versions[0][1];
        sf(['project', 'convert', 'source', '--manifest', 'bootstrap.xml', '--output-dir', converted,
          '--api-version', apiVersion, '--json'], project);
        sf(['project', 'convert', 'mdapi', '--root-dir', converted, '--output-dir', roundTrip, '--json'], project);
        assertBootstrapPackage(converted, path.join(roundTrip, 'main/default'), members, files,
          path.join(project, policy.publication.sourceRoot), apiVersion);
        return {
          submit: () => sf(['project', 'deploy', 'start', '--target-org', environment.alias, '--metadata-dir', converted, '--single-package', '--api-version', apiVersion,
            '--test-level', environment.isSandbox ? 'NoTestRun' : 'RunRelevantTests', '--async', '--json'], project),
          cleanup,
        };
      } catch (error) {
        cleanup();
        throw error;
      }
    },
    permissionAssigned(environment, name) {
      const username = environment.username || this.verifyIdentity(environment).username;
      if (!/^[A-Za-z0-9@._+\-]+$/u.test(username || '') || !/^[A-Za-z][A-Za-z0-9_]*$/u.test(name)) throw new Error('Invalid permission assignment identity.');
      return Boolean(sf(['data', 'query', '--target-org', environment.alias, '--query', `SELECT Id FROM PermissionSetAssignment WHERE Assignee.Username = '${username}' AND PermissionSet.Name = '${name}' LIMIT 1`, '--json'])?.records?.length);
    },
    assignPermission(environment, name) {
      const result = sf(['org', 'assign', 'permset', '--target-org', environment.alias, '--name', name, '--json']);
      if (result?.failures?.length) throw new Error('Salesforce permission assignment failed.');
      return result;
    },
    mirror(action, { plan, journalFile }) {
      return run(process.execPath, ['scripts/sync-salesforce-reviewed-repository.mjs', `--${action}`, '--manifest', plan.manifestPath, '--review', plan.reviewPath, '--state', path.relative(cwd, journalFile), '--adapter', adapterPath], cwd);
    },
    // Job adoption must be implemented by the release owner's provider-specific readback.
    reconcile: adapter.reconcileSalesforceJob,
    verifyInventory: adapter.verifySalesforceInventory || function (environment, { plan, expectedInventoryHash, expectedSourceTreeHash }) {
      const manifest = plan.review.inventoryManifests?.[expectedInventoryHash];
      if (!manifest) throw new Error('Current Salesforce inventory requires an exact reviewed retrieval manifest.');
      const bytes = readFileSync(safeProjectFile(cwd, manifest.path));
      if (salesforcePromotionHash(bytes) !== manifest.sha256) throw new Error('Salesforce inventory retrieval manifest digest mismatch.');
      parseReviewedPackage(bytes.toString('utf8'), { inventory: true });

      const before = this.verifyIdentity(environment);
      const project = mkdtempSync(path.join(tmpdir(), 'fcos-salesforce-inventory-'));
      try {
        copyFileSync(safeProjectFile(cwd, 'sfdx-project.json'), path.join(project, 'sfdx-project.json'));
        mkdirSync(path.join(project, 'force-app'));
        mkdirSync(path.join(project, 'retrieved'));
        const manifestPath = path.join(project, 'inventory.xml');
        writeFileSync(manifestPath, bytes, { mode: 0o600 });
        const result = sf(['project', 'retrieve', 'start', '--target-org', environment.alias,
          '--manifest', manifestPath, '--output-dir', 'retrieved', '--wait', '5', '--json'], project);
        if (result?.success !== true || result.done !== true || result.status !== 'Succeeded'
          || !/^09S[A-Za-z0-9]{15}$/u.test(result.id || '') || result.messages?.length) {
          throw new Error('Salesforce inventory retrieval did not complete successfully without warnings.');
        }
        const after = this.verifyIdentity(environment);
        if (!before.username || before.username !== after.username) throw new Error('Salesforce inventory identity changed during retrieval.');
        const observed = readReviewedInventory(path.join(project, 'retrieved'));
        if (observed.inventoryHash !== expectedInventoryHash
          || (expectedSourceTreeHash && observed.sourceTreeHash !== expectedSourceTreeHash)) {
          throw new Error('Native Salesforce retrieval differs from the exact reviewed inventory.');
        }
        const identity = { alias: environment.alias, orgId: after.id, isSandbox: environment.isSandbox,
          username: after.username, connectedStatus: after.connectedStatus };
        const verifiedAt = new Date().toISOString();
        const sourceTreeHash = expectedSourceTreeHash ? observed.sourceTreeHash : null;
        const evidenceSha256 = salesforcePromotionHash({ jobId: result.id, manifestSha256: manifest.sha256,
          identity, verifiedAt, inventoryHash: observed.inventoryHash, sourceTreeHash });
        return { orgId: identity.orgId, identity, verifiedAt, sourceTreeHash, inventoryHash: observed.inventoryHash,
          evidenceSha256, observedInventory: observed.files, verificationMethod: 'metadata-api-owned-tree-inventory',
          scope: 'force-app/main/default' };
      } finally {
        rmSync(project, { recursive: true, force: true });
      }
    },
  };
}

export async function main(argv = process.argv.slice(2), { cwd = ROOT, policy = POLICY } = {}) {
  const options = reviewedSalesforceOptions(argv);
  const plan = loadReviewedSalesforcePlan({ cwd, policy, manifestPath: options['--manifest'], reviewPath: options['--review'] });
  const module = await import(pathToFileURL(safeProjectFile(cwd, options['--adapter'])).href);
  if (typeof module.createSalesforceAdapter !== 'function') throw new Error('The release adapter must export createSalesforceAdapter({cwd,plan,policy}).');
  const adapter = await module.createSalesforceAdapter({ cwd, plan, policy });
  const authorization = options['--authorization'] ? JSON.parse(readFileSync(safeProjectFile(cwd, options['--authorization']), 'utf8')) : null;
  const reconcile = options['--reconcile'] ? JSON.parse(readFileSync(safeProjectFile(cwd, options['--reconcile']), 'utf8')) : {};
  const journal = openSalesforcePromotionJournal({ directory: path.join(cwd, '.fcos-cli/salesforce-reviewed-promotions'), binding: plan.binding });
  try {
    return await runReviewedSalesforceRelease({ plan, mode: options.mode, policy, journal,
      provider: cliSalesforceProvider({ cwd, policy, adapter, adapterPath: options['--adapter'] }), ownership: adapter.ownership, externalJournal: adapter.journal,
      authorization, replaceValidation: options.replaceValidation, reconcile, assertUnchanged: () => assertReviewedInputsUnchanged(plan, { cwd, policy }) });
  } finally { journal.close(); }
}

if (process.argv[1] && existsSync(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(result => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
