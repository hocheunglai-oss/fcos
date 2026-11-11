import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseDocument } from 'htmlparser2';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';
import { openSalesforcePromotionJournal, salesforcePromotionHash } from './lib/salesforce-promotion-journal.mjs';
import { INVENTORY_BASELINE_MODE, NATIVE_CUSTOM_OBJECT_DEFAULTS, createReviewedSalesforcePlan, inventoryFromFiles, matchesProjectedNativeInventory, parseReviewedPackage, projectedNativeInventoryHash, readReviewedInventory, runReviewedSalesforceRelease, safeProjectFile } from './lib/salesforce-reviewed-release.mjs';
import { proveSalesforceInventoryAbsence } from './lib/salesforce-inventory-absence.mjs';
import { comparePermissionSetDefinition, verifyPermissionSetCatalog } from './lib/salesforce-permission-projection.mjs';

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
  const listing = run('git', ['ls-tree', '-rz', `${commit}^{commit}`, '--', prefix], cwd, { json: false });
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
  const baselines = new Map();
  const inventoryAt = commit => {
    if (!baselines.has(commit)) baselines.set(commit, baselineGitInventory(cwd, commit));
    return baselines.get(commit);
  };
  const baselineInventory = inventoryAt(review.baselineCommit);
  const orgBaselineInventories = review.orgBaselines
    ? Object.fromEntries(Object.entries(review.orgBaselines).map(([key, descriptor]) => [key, inventoryAt(descriptor?.commit)]))
    : undefined;
  const inputs = { review, manifestBytes: readFileSync(manifestAbsolute), bootstrapBytes: bootstrapAbsolute ? readFileSync(bootstrapAbsolute) : null,
    baselineWorkflow, baselineInventory, orgBaselineInventories, finalInventory: readReviewedInventory(sourceRoot), policy };
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

function normalizedMetadataDefinition(xml, document) {
  if (/xml:space|<!DOCTYPE|<!ENTITY/iu.test(xml)) return [xml];
  const { children } = document || parseDocument(xml, { xmlMode: true, decodeEntities: true });
  function definition(nodes) {
    const elementOnly = nodes.some(node => node.type === 'tag')
      && !nodes.some(node => node.type === 'cdata' || (node.type === 'text' && node.data.trim() !== ''));
    return nodes.filter(node => node.type !== 'text' || !elementOnly || node.data.trim())
      .map(node => [node.type, node.name || null, node.data ?? null,
        node.attribs ? Object.entries(node.attribs).sort(([left], [right]) => left.localeCompare(right)) : null,
        node.children ? definition(node.children) : null]);
  }
  // The converter can escape literal apostrophes. Preserve decoded text,
  // element order and leaf/mixed-content whitespace while ignoring indentation.
  return definition(children);
}

function verifyNativeApexProjection({ root, sourceRoot, plan }) {
  const canonicalBody = text => text.replace(/\r\n/gu, '\n').replace(/\n$/u, '');
  for (const component of plan.review.components) {
    for (const name of component.files) {
      const source = readFileSync(safeProjectFile(sourceRoot, name));
      const native = readFileSync(safeProjectFile(root, name));
      if (salesforcePromotionHash(source) !== plan.finalInventory.files[name]?.sha256) {
        throw new Error(`Reviewed Apex source changed before native comparison: ${name}`);
      }
      const normalize = name.endsWith('.cls') ? canonicalBody : normalizedMetadataDefinition;
      if (JSON.stringify(normalize(source.toString('utf8'))) !== JSON.stringify(normalize(native.toString('utf8')))) {
        throw new Error(`Native Apex projection differs from the exact reviewed source: ${name}`);
      }
    }
  }
}

const STANDARD_OBJECT_ACTIONS = ['Accept', 'CancelEdit', 'Clone', 'Delete', 'Edit', 'List', 'New', 'SaveEdit', 'Tab', 'View'];
const STANDARD_OBJECT_ACTION_OVERRIDES = new Set(STANDARD_OBJECT_ACTIONS.flatMap(action =>
  ['', 'Large', 'Small'].map(formFactor => JSON.stringify(formFactor
    ? [['actionName', action], ['formFactor', formFactor], ['type', 'Default']]
    : [['actionName', action], ['type', 'Default']]))));
const plainTextNode = node => !Object.keys(node.attribs).length && node.children.length === 1
  && node.children[0].type === 'text';
const whitespaceOnly = node => node.type === 'text' && !node.data.trim();

function matchesStandardActionOverrides(entries) {
  if (!entries.length) return true;
  const actual = new Set();
  for (const entry of entries) {
    const children = entry.children.filter(node => !whitespaceOnly(node));
    if (Object.keys(entry.attribs).length || children.some(node => node.type !== 'tag' || !plainTextNode(node))) return false;
    actual.add(JSON.stringify(children.map(node => [node.name, node.children[0].data])));
  }
  return entries.length === STANDARD_OBJECT_ACTION_OVERRIDES.size && actual.size === entries.length
    && [...actual].every(row => STANDARD_OBJECT_ACTION_OVERRIDES.has(row));
}

export function equivalentNativeSerialization(source, native, type, defaults) {
  if (/xml:space|<!DOCTYPE|<!ENTITY/iu.test(source + native)) return false;
  const sourceDocument = parseDocument(source, { xmlMode: true, decodeEntities: true });
  const nativeDocument = parseDocument(native, { xmlMode: true, decodeEntities: true });
  const roots = [sourceDocument, nativeDocument].map(document => document.children.filter(node => node.type === 'tag'));
  if (roots.some(list => list.length !== 1 || list[0].name !== type
    || list[0].attribs.xmlns !== 'http://soap.sforce.com/2006/04/metadata')) return false;
  const [[localRoot], [nativeRoot]] = roots;
  const matching = (node, name) => node.children.filter(child => child.type === 'tag' && child.name === name);
  for (const [path, value] of defaults) {
    const [rootName, childName] = path.split('.');
    const localParents = childName ? matching(localRoot, rootName) : [localRoot];
    const nativeParents = childName ? matching(nativeRoot, rootName) : [nativeRoot];
    if (localParents.length !== 1 || nativeParents.length !== 1) return false;
    const leaf = childName || rootName;
    if (matching(localParents[0], leaf).length) return false;
    const entries = matching(nativeParents[0], leaf);
    if (!entries.length) continue;
    if (value === 'standard-actions') {
      if (!matchesStandardActionOverrides(entries)) return false;
    } else {
      const [entry] = entries;
      if (entries.length !== 1) return false;
      if (value === 'empty') {
        if (Object.keys(entry.attribs).length || entry.children.some(node => !whitespaceOnly(node))) return false;
      } else if (!plainTextNode(entry) || entry.children[0].data !== value) return false;
    }
    const removable = new Set(entries);
    nativeParents[0].children = nativeParents[0].children.filter(child => !removable.has(child));
  }
  return JSON.stringify(normalizedMetadataDefinition(source, sourceDocument))
    === JSON.stringify(normalizedMetadataDefinition(native, nativeDocument));
}

function verifyNativeMetadataProjection({ root, sourceRoot, plan, projectionPaths, query }) {
  const permissionSets = [];
  for (const name of projectionPaths) {
    const source = readFileSync(safeProjectFile(sourceRoot, name));
    const native = readFileSync(safeProjectFile(root, name));
    if (salesforcePromotionHash(source) !== plan.finalInventory.files[name]?.sha256) {
      throw new Error(`Reviewed Salesforce source changed before native comparison: ${name}`);
    }
    const normalizeLineEndings = bytes => bytes.toString('utf8').replace(/\r\n/gu, '\n');
    const local = normalizeLineEndings(source);
    const observed = normalizeLineEndings(native);
    const permission = /^permissionsets\/([A-Za-z][A-Za-z0-9_]*)\.permissionset-meta\.xml$/u.exec(name);
    const falseFlags = plan.review.nativeCustomFieldFalseFlags?.[name];
    const objectDefaults = plan.review.nativeCustomObjectDefaults?.[name];
    if (!permission && !falseFlags && !objectDefaults && source.equals(native)) continue;
    if (!Buffer.from(source.toString('utf8')).equals(source) || !Buffer.from(native.toString('utf8')).equals(native)) {
      throw new Error(`Native metadata projection differs from the exact reviewed source: ${name}`);
    }
    if (permission) {
      permissionSets.push(comparePermissionSetDefinition({ name: permission[1], source: local, native: observed, normalize: normalizedMetadataDefinition }));
      continue;
    }
    if (falseFlags) {
      if (equivalentNativeSerialization(local, observed, 'CustomField', falseFlags.map(flag => [flag, 'false']))) continue;
      throw new Error(`Native CustomField serialization differs from the exact reviewed source: ${name}`);
    }
    if (objectDefaults) {
      const defaults = objectDefaults.map(flag => [flag, NATIVE_CUSTOM_OBJECT_DEFAULTS[flag]]);
      if (equivalentNativeSerialization(local, observed, 'CustomObject', defaults)) continue;
      throw new Error(`Native CustomObject serialization differs from the exact reviewed source: ${name}`);
    }
    if (local === observed) continue;
    if (name.endsWith('.xml') && JSON.stringify(normalizedMetadataDefinition(local)) === JSON.stringify(normalizedMetadataDefinition(observed))) continue;
    if ((name.endsWith('.cls') || name.endsWith('.trigger')) && local.replace(/\n$/u, '') === observed.replace(/\n$/u, '')) continue;
    throw new Error(`Native metadata projection differs from the exact reviewed source: ${name}`);
  }
  return permissionSets.length ? verifyPermissionSetCatalog(permissionSets, query) : null;
}

function assertConvertedPackage(converted, roundTrip, members, files, sourceRoot, apiVersion, operation) {
  const packageBytes = readFileSync(safeProjectFile(converted, 'package.xml'), 'utf8');
  const actualMembers = parseReviewedPackage(packageBytes);
  const versions = [...packageBytes.matchAll(/<version>\s*(\d+\.0)\s*<\/version>/gu)];
  if (JSON.stringify(actualMembers) !== JSON.stringify([...members].sort())
    || versions.length !== 1 || versions[0][1] !== apiVersion) {
    throw new Error(`Converted Salesforce ${operation} manifest differs from the reviewed package.`);
  }
  const expectedPackageFiles = new Set(['package.xml']);
  const allowedShells = new Set();
  for (const file of files) {
    const [directory, object] = file.split('/');
    if (directory === 'objects') {
      expectedPackageFiles.add(`objects/${object}.object`);
      if (!members.has(`CustomObject:${object}`)) allowedShells.add(`objects/${object}/${object}.object-meta.xml`);
    } else {
      const mdapiSuffix = ['customPermissions', 'layouts', 'permissionsets', 'quickActions'].includes(directory);
      expectedPackageFiles.add(mdapiSuffix ? file.replace(/-meta\.xml$/u, '') : file);
    }
  }
  const actualPackageFiles = Object.keys(readReviewedInventory(converted).files);
  if (JSON.stringify(actualPackageFiles.sort()) !== JSON.stringify([...expectedPackageFiles].sort())) {
    throw new Error(`Converted Salesforce ${operation} contains unexpected or missing package files.`);
  }
  const embedded = [];
  for (const file of actualPackageFiles.filter(name => name.startsWith('objects/'))) {
    const object = file.slice('objects/'.length, -'.object'.length);
    const xml = readFileSync(safeProjectFile(converted, file), 'utf8');
    const roots = parseDocument(xml, { xmlMode: true, decodeEntities: true }).children.filter(node => node.type === 'tag');
    if (roots.length !== 1 || roots[0].name !== 'CustomObject') throw new Error(`Converted Salesforce ${operation} object metadata is invalid: ${file}`);
    for (const child of roots[0].children.filter(node => node.type === 'tag')) {
      if (child.name === 'fields' || child.name === 'validationRules') {
        const fullName = child.children.find(node => node.type === 'tag' && node.name === 'fullName');
        const name = fullName?.children.map(node => node.data).join('');
        embedded.push(`${child.name === 'fields' ? 'CustomField' : 'ValidationRule'}:${object}.${name}`);
      } else if (!members.has(`CustomObject:${object}`)) {
        throw new Error(`Converted Salesforce ${operation} expanded outside reviewed source: ${file}`);
      }
    }
  }
  const expectedEmbedded = [...members].filter(id => /^(?:CustomField|ValidationRule):/u.test(id)).sort();
  if (JSON.stringify(embedded.sort()) !== JSON.stringify(expectedEmbedded)) {
    throw new Error(`Converted Salesforce ${operation} object components differ from the reviewed package.`);
  }
  const roundTripFiles = Object.keys(readReviewedInventory(roundTrip).files);
  for (const file of roundTripFiles) {
    if (files.has(file)) continue;
    const shell = allowedShells.has(file) && readFileSync(safeProjectFile(roundTrip, file), 'utf8')
      .replace(/^<\?xml[^?]*\?>\s*/u, '').trim();
    if (!shell || !/^<CustomObject xmlns="http:\/\/soap\.sforce\.com\/2006\/04\/metadata"(?:\s*\/>|>\s*<\/CustomObject>)$/u.test(shell)) {
      throw new Error(`Converted Salesforce ${operation} expanded outside reviewed source: ${file}`);
    }
  }
  if ([...files].some(file => !roundTripFiles.includes(file))) throw new Error(`Converted Salesforce ${operation} is missing reviewed source.`);
  for (const file of files) {
    const source = readFileSync(safeProjectFile(sourceRoot, file));
    const restored = readFileSync(safeProjectFile(roundTrip, file));
    if (!source.equals(restored) && (!file.endsWith('-meta.xml')
      || JSON.stringify(normalizedMetadataDefinition(source.toString('utf8'))) !== JSON.stringify(normalizedMetadataDefinition(restored.toString('utf8'))))) {
      throw new Error(`Converted Salesforce ${operation} definition differs from reviewed source: ${file}`);
    }
  }
}

function inspectNativeSupplementalFiles(root, reviewed, { allowObjectShells = false } = {}) {
  const expected = new Set(reviewed.flatMap(({ files }) => files));
  const observed = readReviewedInventory(root, { nativeExport: true });
  const extra = Object.keys(observed.files).filter(name => !expected.has(name));
  const possibleShells = new Set(allowObjectShells ? reviewed.flatMap(({ id }) => {
    const child = /^(?:CustomField|ValidationRule):([A-Za-z][A-Za-z0-9_]*)\.[A-Za-z][A-Za-z0-9_]*$/u.exec(id);
    return child ? [`objects/${child[1]}/${child[1]}.object-meta.xml`] : [];
  }) : []);
  if ([...expected].some(name => !Object.hasOwn(observed.files, name))
    || extra.some(name => !possibleShells.has(name))) {
    throw new Error(`Native ${allowObjectShells ? 'metadata' : 'Apex'} retrieval returned an unexpected path set.`);
  }
  const shells = {};
  for (const name of extra) {
    const file = safeProjectFile(root, name);
    const source = readFileSync(file, 'utf8');
    const valid = /^\s*(?:<\?xml version="1\.0" encoding="UTF-8"\?>\s*)?<CustomObject xmlns="http:\/\/soap\.sforce\.com\/2006\/04\/metadata"\s*(?:\/>|>\s*<\/CustomObject>)\s*$/u;
    if (!valid.test(source)) throw new Error(`Native metadata retrieval returned an unexpected nonempty object descriptor: ${name}`);
    shells[name] = observed.files[name];
    rmSync(file);
  }
  return shells;
}

export function cliSalesforceProvider({ cwd = ROOT, policy = POLICY, run = localCommand, adapter = {}, adapterPath, commandEnvironment } = {}) {
  const sf = (args, directory = cwd) => run('sf', args, directory, { env: commandEnvironment });
  function preparePackage(plan, { operation, manifestPath, manifestSha256, components, command }) {
    const manifest = readFileSync(safeProjectFile(cwd, manifestPath));
    if (salesforcePromotionHash(manifest) !== manifestSha256) throw new Error(`Salesforce ${operation} manifest changed.`);
    const versions = [...manifest.toString('utf8').matchAll(/<version>\s*(\d+\.0)\s*<\/version>/gu)];
    if (versions.length !== 1) throw new Error(`Salesforce ${operation} requires one explicit metadata API version.`);
    const members = new Set(components);
    const files = new Set(plan.review.components.filter(({ id }) => members.has(id)).flatMap(({ files }) => files));
    const project = mkdtempSync(path.join(tmpdir(), `fcos-salesforce-${operation}-`));
    const cleanup = () => rmSync(project, { recursive: true, force: true });
    try {
      writeFileSync(path.join(project, 'sfdx-project.json'), JSON.stringify({
        packageDirectories: [{ path: 'force-app', default: true }], namespace: '', sourceApiVersion: versions[0][1],
      }));
      writeFileSync(path.join(project, `${operation}.xml`), manifest, { mode: 0o600 });
      // A source-format manifest can otherwise pull in unreviewed parent and child metadata.
      for (const name of files) {
        const relative = `${policy.publication.sourceRoot}/${name}`;
        const bytes = readFileSync(safeProjectFile(cwd, relative));
        if (salesforcePromotionHash(bytes) !== plan.finalInventory.files[name]?.sha256) {
          throw new Error(`Salesforce ${operation} source changed: ${name}`);
        }
        const destination = path.join(project, relative);
        mkdirSync(path.dirname(destination), { recursive: true });
        writeFileSync(destination, bytes, { mode: 0o600 });
      }
      const converted = path.join(project, 'converted');
      const roundTrip = path.join(project, 'round-trip');
      const apiVersion = versions[0][1];
      sf(['project', 'convert', 'source', '--manifest', `${operation}.xml`, '--output-dir', converted,
        '--api-version', apiVersion, '--json'], project);
      sf(['project', 'convert', 'mdapi', '--root-dir', converted, '--output-dir', roundTrip, '--json'], project);
      assertConvertedPackage(converted, path.join(roundTrip, 'main/default'), members, files,
        path.join(project, policy.publication.sourceRoot), apiVersion, operation);
      const packageSha256 = readReviewedInventory(converted).sourceTreeHash;
      return {
        packageSha256,
        submit() {
          if (readReviewedInventory(converted).sourceTreeHash !== packageSha256) {
            throw new Error(`Verified Salesforce ${operation} package changed before submission.`);
          }
          return sf([...command, '--metadata-dir', converted, '--single-package', '--api-version', apiVersion, '--async', '--json'], project);
        },
        cleanup,
      };
    } catch (error) {
      cleanup();
      throw error;
    }
  }
  return {
    verifyIdentity(environment) {
      const display = sf(['org', 'display', '--target-org', environment.alias, '--json']);
      const org = sf(['data', 'query', '--target-org', environment.alias, '--query', 'SELECT Id, IsSandbox FROM Organization LIMIT 1', '--json'])?.records?.[0];
      if (display?.id !== environment.orgId || display?.connectedStatus !== 'Connected' || (environment.username && display?.username !== environment.username)
        || org?.Id !== environment.orgId || org?.IsSandbox !== environment.isSandbox) throw new Error(`${environment.label} Salesforce identity mismatch.`);
      return display;
    },
    report(environment, jobId) { return sf(['project', 'deploy', 'report', '--target-org', environment.alias, '--job-id', jobId, '--wait', '60', '--json']); },
    prepareValidation(environment, plan) {
      const command = ['project', 'deploy', 'validate', '--target-org', environment.alias, '--test-level', plan.binding.testPlan.level];
      if (plan.binding.testPlan.level === 'RunSpecifiedTests') for (const name of plan.binding.testPlan.tests) command.push('--tests', name);
      return preparePackage(plan, { operation: 'validation', manifestPath: plan.manifestPath,
        manifestSha256: plan.binding.manifestSha256, components: plan.manifest, command });
    },
    validate(environment, plan) {
      const prepared = this.prepareValidation(environment, plan);
      try { return prepared.submit(); }
      finally { prepared.cleanup(); }
    },
    deploy(environment, validationJobId) { return sf(['project', 'deploy', 'quick', '--target-org', environment.alias, '--job-id', validationJobId, '--async', '--json']); },
    prepareBootstrap(environment, plan) {
      const bootstrap = plan.review.bootstrap;
      return preparePackage(plan, { operation: 'bootstrap', manifestPath: bootstrap.manifestPath,
        manifestSha256: plan.binding.bootstrapSha256, components: bootstrap.components,
        command: ['project', 'deploy', 'start', '--target-org', environment.alias,
          '--test-level', environment.isSandbox ? 'NoTestRun' : 'RunRelevantTests'] });
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
    verifyInventory: adapter.verifySalesforceInventory || function (environment, { plan, expectedInventory, expectedInventoryHash, expectedSourceTreeHash,
      expectedAbsentComponents = [], nativeExport = false, verifyApexProjection = false,
      nativeBootstrap = false, projectionPaths = [], projectedNativeInventory = false }) {
      const manifest = plan.review.inventoryManifests?.[expectedInventoryHash];
      if (!manifest) throw new Error('Current Salesforce inventory requires an exact reviewed retrieval manifest.');
      const bytes = readFileSync(safeProjectFile(cwd, manifest.path));
      if (salesforcePromotionHash(bytes) !== manifest.sha256) throw new Error('Salesforce inventory retrieval manifest digest mismatch.');
      const presentComponents = parseReviewedPackage(bytes.toString('utf8'), { inventory: true });
      const supplementalManifest = nativeBootstrap ? manifest.metadata : manifest.apex;
      const presentReviewed = nativeExport
        ? plan.review.components.filter(({ id }) => !expectedAbsentComponents.includes(id)) : [];
      let supplementalBytes;
      if (nativeExport) {
        const supplementalLabel = nativeBootstrap ? 'metadata' : 'Apex';
        if (plan.review.components.some(({ id }) => presentComponents.includes(id)) || Boolean(supplementalManifest) !== Boolean(presentReviewed.length)) {
          throw new Error(`Stable native retrieval must keep the reviewed ${supplementalLabel} package separate.`);
        }
        if (supplementalManifest) {
          supplementalBytes = readFileSync(safeProjectFile(cwd, supplementalManifest.path));
          const members = parseReviewedPackage(supplementalBytes.toString('utf8'));
          if (salesforcePromotionHash(supplementalBytes) !== supplementalManifest.sha256
            || JSON.stringify(members) !== JSON.stringify(presentReviewed.map(({ id }) => id).sort())) {
            throw new Error(`Native ${supplementalLabel} retrieval manifest does not match the reviewed checkpoint.`);
          }
          presentComponents.push(...members);
        }
      }

      const before = this.verifyIdentity(environment);
      const project = mkdtempSync(path.join(tmpdir(), 'fcos-salesforce-inventory-'));
      try {
        copyFileSync(safeProjectFile(cwd, 'sfdx-project.json'), path.join(project, 'sfdx-project.json'));
        mkdirSync(path.join(project, 'force-app'));
        const retrieve = (xml, name, directory) => {
          mkdirSync(path.join(project, directory));
          const manifestPath = path.join(project, name);
          writeFileSync(manifestPath, xml, { mode: 0o600 });
          const result = sf(['project', 'retrieve', 'start', '--target-org', environment.alias,
            '--manifest', manifestPath, '--output-dir', directory, '--wait', '5', '--json'], project);
          if (result?.success !== true || result.done !== true || result.status !== 'Succeeded'
            || !/^09S[A-Za-z0-9]{15}$/u.test(result.id || '') || result.messages?.length) {
            throw new Error('Salesforce inventory retrieval did not complete successfully without warnings.');
          }
          return result.id;
        };
        const jobId = retrieve(bytes, 'inventory.xml', 'retrieved');
        const supplementalName = nativeBootstrap ? 'metadata' : 'apex';
        const supplementalJobId = supplementalBytes ? retrieve(supplementalBytes, `${supplementalName}.xml`, supplementalName) : null;
        const root = path.join(project, 'retrieved');
        const supplementalRoot = supplementalJobId ? path.join(project, supplementalName) : null;
        const supplementalObjectShells = supplementalRoot
          ? inspectNativeSupplementalFiles(supplementalRoot, presentReviewed, { allowObjectShells: nativeBootstrap }) : {};
        const matchingSupplementalPaths = nativeBootstrap
          ? new Set(presentReviewed.filter(({ id }) => id.startsWith('CustomField:')).flatMap(({ files }) => files)) : null;
        const observed = readReviewedInventory(root, { nativeExport, supplementalRoot, matchingSupplementalPaths });
        const inventoryMatches = projectedNativeInventory
          ? nativeBootstrap && projectionPaths.length > 0
            && matchesProjectedNativeInventory(observed.files, expectedInventory, projectionPaths)
            && projectedNativeInventoryHash(expectedInventory, projectionPaths) === expectedInventoryHash
          : observed.inventoryHash === expectedInventoryHash;
        if (!inventoryMatches || (expectedSourceTreeHash && observed.sourceTreeHash !== expectedSourceTreeHash)) {
          throw new Error('Native Salesforce retrieval differs from the exact reviewed inventory.');
        }
        if (verifyApexProjection) verifyNativeApexProjection({ root: supplementalRoot, sourceRoot: path.join(cwd, policy.publication.sourceRoot), plan });
        const permissionEvidence = nativeBootstrap && projectionPaths.length
          ? verifyNativeMetadataProjection({ root: supplementalRoot, sourceRoot: path.join(cwd, policy.publication.sourceRoot),
            plan, projectionPaths, query: soql => sf(['data', 'query', '--target-org', environment.alias, '--api-version', '67.0',
              '--query', soql, '--json'], project) }) : null;
        const absence = expectedAbsentComponents.length ? proveSalesforceInventoryAbsence({ expectedAbsentComponents,
          presentComponents: [...presentComponents, ...(plan.review.inventoryCatalogControls?.[environment.key] || [])],
          listMetadata: type => sf(['org', 'list', 'metadata', '--target-org', environment.alias, '--metadata-type', type, '--json'], project),
          query: (soql, tooling) => sf(['data', 'query', ...(tooling ? ['--use-tooling-api'] : []),
            '--target-org', environment.alias, '--query', soql, '--json'], project) }) : null;
        const after = this.verifyIdentity(environment);
        if (!before.username || before.username !== after.username) throw new Error('Salesforce inventory identity changed during retrieval.');
        const identity = { alias: environment.alias, orgId: after.id, isSandbox: environment.isSandbox,
          username: after.username, connectedStatus: after.connectedStatus };
        const verifiedAt = new Date().toISOString();
        const sourceTreeHash = expectedSourceTreeHash ? observed.sourceTreeHash : null;
        const evidenceSha256 = salesforcePromotionHash({ jobId, manifestSha256: manifest.sha256,
          identity, verifiedAt, inventoryHash: expectedInventoryHash, sourceTreeHash,
          ...(projectedNativeInventory ? { observedNativeInventoryHash: observed.inventoryHash } : {}),
          ...(supplementalJobId ? (nativeBootstrap ? { metadataJobId: supplementalJobId, metadataManifestSha256: supplementalManifest.sha256 }
            : { apexJobId: supplementalJobId, apexManifestSha256: supplementalManifest.sha256 }) : {}),
          ...(nativeBootstrap ? { verifiedProjectionPaths: projectionPaths, supplementalObjectShells, supplementalDuplicates: observed.supplementalDuplicates } : {}),
          ...permissionEvidence,
          ...(nativeExport ? { nativeSourceTreeHash: observed.sourceTreeHash, apexProjectionVerified: verifyApexProjection } : {}), ...absence });
        return { orgId: identity.orgId, identity, verifiedAt, sourceTreeHash, inventoryHash: expectedInventoryHash,
          ...(projectedNativeInventory ? { observedNativeInventoryHash: observed.inventoryHash } : {}),
          evidenceSha256, observedInventory: observed.files,
          ...(nativeExport ? { nativeSourceTreeHash: observed.sourceTreeHash, apexProjectionVerified: verifyApexProjection } : {}),
          ...(nativeBootstrap ? { verifiedProjectionPaths: projectionPaths, supplementalObjectShells, supplementalDuplicates: observed.supplementalDuplicates } : {}),
          ...permissionEvidence,
          verificationMethod: nativeExport ? 'metadata-api-reviewed-native-byte-inventory' : 'metadata-api-owned-tree-inventory',
          scope: 'force-app/main/default', ...absence };
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
