import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertInvoiceAppPlacementReadback, readInvoiceAppPlacement } from './lib/salesforce-invoice-app-placement.mjs';
import { parseDocument } from 'htmlparser2';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';
import { openSalesforcePromotionJournal, salesforcePromotionHash } from './lib/salesforce-promotion-journal.mjs';
import { INVENTORY_BASELINE_MODE, NATIVE_CUSTOM_OBJECT_DEFAULTS, createReviewedSalesforcePlan, inventoryFromFiles, matchesProjectedNativeInventory, parseReviewedPackage, projectedNativeInventoryHash, readReviewedInventory, runReviewedSalesforceRelease, safeProjectFile } from './lib/salesforce-reviewed-release.mjs';
import { proveSalesforceInventoryAbsence } from './lib/salesforce-inventory-absence.mjs';
import { assertLegacySalesforceDocumentAdmission } from './lib/salesforce-legacy-document-admission.mjs';
import { comparePermissionSetDefinition, verifyPermissionSetCatalog } from './lib/salesforce-permission-projection.mjs';
import { normalizeTradingFxDeniedProfile, tradingFxProductionInventoryScope, tradingFxSalesSupportPath } from './lib/rapid-release/trading-fx-production-inventory.mjs';
import { supportsTradingFxFormulaWitness, verifyTradingFxFormulaWitnesses } from './lib/salesforce-trading-fx-formula-evidence.mjs';

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

// An unmanaged protected setting is rejected by the pinned Production org.
export function assertSalesforceProductionSettingCompatibility(cwd, plan, policy = POLICY) {
  const root = path.join(cwd, policy.publication.sourceRoot);
  for (const { id, files } of plan.review.components) {
    if (!id.startsWith('CustomObject:')) continue;
    const descriptor = files.find(file => file.endsWith('.object-meta.xml'));
    if (!descriptor) continue;
    const xml = readFileSync(safeProjectFile(root, descriptor), 'utf8');
    const object = parseDocument(xml, { xmlMode: true, decodeEntities: true }).children
      .find(node => node.type === 'tag' && node.name === 'CustomObject');
    const elements = object?.children.filter(node => node.type === 'tag') || [];
    const isSetting = elements.some(node => node.name === 'customSettingsType');
    const isProtected = elements.some(node => ['visibility', 'customSettingsVisibility'].includes(node.name)
      && node.children.map(child => child.data).join('').trim() === 'Protected');
    if (isSetting && isProtected) {
      throw Object.assign(new Error(`Salesforce Production cannot deploy unmanaged Protected custom setting ${id}.`),
        { code: 'SALESFORCE_PRODUCTION_PROTECTED_CUSTOM_SETTING' });
    }
  }
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
  assertLegacySalesforceDocumentAdmission(cwd, plan, policy.publication.sourceRoot);
  for (const [key, descriptor] of Object.entries(plan.invoiceAppPlacement || {})) {
    readInvoiceAppPlacement(descriptor, key, relative => safeProjectFile(cwd, relative));
  }
  return { ...plan, manifestPath, reviewPath, manifestAbsolute, reviewAbsolute, baselineWorkflowAbsolute, bootstrapAbsolute,
    inputDigests: { review: salesforcePromotionHash(readFileSync(reviewAbsolute)), baseline: baselineWorkflowAbsolute ? salesforcePromotionHash(readFileSync(baselineWorkflowAbsolute)) : null } };
}

export function assertReviewedInputsUnchanged(plan, { cwd = ROOT, policy = POLICY } = {}) {
  for (const [key, descriptor] of Object.entries(plan.invoiceAppPlacement || {})) {
    readInvoiceAppPlacement(descriptor, key, relative => safeProjectFile(cwd, relative));
  }
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
    } else if (value === 'empty-record-action-list') {
      const [entry] = entries;
      const children = entry.children.filter(node => !whitespaceOnly(node));
      if (entries.length !== 1 || Object.keys(entry.attribs).length || children.length !== 1
        || children[0].type !== 'tag' || children[0].name !== 'actionListContext'
        || !plainTextNode(children[0]) || children[0].children[0].data !== 'Record') return false;
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

export function equivalentNativeApexApiVersion(source, native) {
  // Salesforce exports an integer Apex API version with a trailing decimal zero.
  const normalize = xml => xml.replace(/<apiVersion>([1-9][0-9]*)\.0<\/apiVersion>/gu, '<apiVersion>$1</apiVersion>');
  return equivalentNativeSerialization(normalize(source), normalize(native), 'ApexClass', []);
}

function verifyNativeMetadataProjection({ root, sourceRoot, plan, projectionPaths, query }) {
  const permissionSets = [];
  const formulaWitnesses = [];
  const koreaDeskHistory = isKoreaDeskHistoryCheckpoint(plan, projectionPaths);
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
    // A reviewed field can already include the same native false default.
    // The omission allowance is only needed when source and provider bytes differ.
    if (!permission && !objectDefaults && source.equals(native)) continue;
    if (!Buffer.from(source.toString('utf8')).equals(source) || !Buffer.from(native.toString('utf8')).equals(native)) {
      throw new Error(`Native metadata projection differs from the exact reviewed source: ${name}`);
    }
    if (permission) {
      permissionSets.push(comparePermissionSetDefinition({ name: permission[1], source: local, native: observed, normalize: normalizedMetadataDefinition }));
      continue;
    }
    const field = /^objects\/(\w+)\/fields\/(\w+)\.field-meta\.xml$/u.exec(name);
    const formulaName = field && field[1] + '.' + field[2];
    if (koreaDeskHistory && name === koreaDeskHistoryPaths.member
      && !observed.includes('formulaTreatBlanksAs')) {
      // This exact checkbox takes only text and picklist operands. Salesforce
      // omits the numeric blank-handling mode when retrieving it.
      const withoutNumericMode = local.replace(/^[ \t]*<formulaTreatBlanksAs>BlankAsBlank<\/formulaTreatBlanksAs>\n/mu, '');
      if (withoutNumericMode !== local && equivalentNativeSerialization(withoutNumericMode, observed, 'CustomField',
        (falseFlags || []).map(flag => [flag, 'false']))) continue;
    }
    if (koreaDeskHistory && name === koreaDeskHistoryPaths.object
      && equivalentNativeSerialization(local, observed, 'CustomObject',
        [['nameField.trackHistory', 'false'], ['recordTypeTrackHistory', 'false']])) continue;
    if (koreaDeskHistory && /^classes\/(?:Enquiry|Quote)ProgressBarController\.cls-meta\.xml$/u.test(name)
      && equivalentNativeApexApiVersion(local, observed)) continue;
    if (formulaName && supportsTradingFxFormulaWitness(formulaName, salesforcePromotionHash(source))
      && !observed.includes('formulaTreatBlanksAs')
      && local.includes('<formulaTreatBlanksAs>BlankAsBlank</formulaTreatBlanksAs>')) {
      const withoutMode = local.replace(/^[ \t]*<formulaTreatBlanksAs>BlankAsBlank<\/formulaTreatBlanksAs>\n/mu, '');
      const defaults = (falseFlags || []).map(flag => [flag, 'false']);
      if (withoutMode !== local && equivalentNativeSerialization(withoutMode, observed, 'CustomField', defaults)) {
        formulaWitnesses.push(formulaName);
        continue;
      }
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
    if (plan.invoiceAppPlacement && /^flexipages\/FCOS_DEVEE_Invoice_Launcher_(?:Buyer|Supplier)\.flexipage-meta\.xml$/u.test(name)) {
      // Salesforce exports the same UTF-8 declaration using double quotes.
      const normalizeLauncher = xml => normalizedMetadataDefinition(xml
        .replace(/^<\?xml version='1\.0' encoding='UTF-8'\?>/u, '<?xml version="1.0" encoding="UTF-8"?>')
        .replace(/<componentName>c:fcosTradeInvoiceActions<\/componentName>/gu,
          '<componentName>fcosTradeInvoiceActions</componentName>'));
      if (JSON.stringify(normalizeLauncher(local)) === JSON.stringify(normalizeLauncher(observed))) continue;
    }
    if (/^layouts\/[^/]+\.layout-meta\.xml$/u.test(name)
      && equivalentNativeSerialization(local, observed, 'Layout', [['platformActionList', 'empty-record-action-list']])) continue;
    if (name.endsWith('.xml') && JSON.stringify(normalizedMetadataDefinition(local)) === JSON.stringify(normalizedMetadataDefinition(observed))) continue;
    // Metadata API retrieval can omit one terminal newline from source files.
    const nativeSourceFile = name.endsWith('.cls') || name.endsWith('.trigger') || /^pages\/[^/]+\.page$/u.test(name) || /^lwc\/[^/]+\/[^/]+\.(?:js|html|css)$/u.test(name);
    if (nativeSourceFile && local.replace(/\n$/u, '') === observed.replace(/\n$/u, '')) continue;
    throw new Error(`Native metadata projection differs from the exact reviewed source: ${name}`);
  }
  return {
    ...(permissionSets.length ? verifyPermissionSetCatalog(permissionSets, query) : {}),
    ...verifyTradingFxFormulaWitnesses(formulaWitnesses, query),
  };
}

export function assertConvertedPackage(converted, roundTrip, members, files, sourceRoot, apiVersion, operation) {
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
      const mdapiSuffix = ['applications', 'customPermissions', 'flexipages', 'layouts', 'permissionsets', 'quickActions'].includes(directory);
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

const EMPTY_NATIVE_OBJECT = /^\s*(?:<\?xml version="1\.0" encoding="UTF-8"\?>\s*)?<CustomObject xmlns="http:\/\/soap\.sforce\.com\/2006\/04\/metadata"\s*(?:\/>|>\s*<\/CustomObject>)\s*$/u;

const koreaDeskHistoryPaths = Object.freeze({
  object: 'objects/STEM__c/STEM__c.object-meta.xml',
  member: 'objects/STEM__c/fields/Korea_Desk_Member__c.field-meta.xml',
  decision: 'objects/STEM__c/fields/Korea_Desk__c.field-meta.xml',
});
const koreaDeskHistorySource = Object.freeze({
  object: '96448ae17f4ce7422ef8c81b7ee14469c5a071a58b793401a3ee93a3c89362d4',
  member: '9a0e9eacdc2a51643f3c664204e3ee49aecdb92094f830808a8f56ae391c1b9e',
  decision: 'b9e1189e36ba2ea8f74a2a8de9a37d6f69cea30ed9f218cab9fbeeb3d76b2f73',
});
const installedKoreaDeskChoices = Object.freeze({
  member: '26ff7ceba47e4a4a3b7fbeffe6e5d5189b24ebfcb569827548bac95fa604d1b3',
  decision: '1d83d7598172afcbf2918e767e1a9c3397df80148d662d5e6fd9891a34141ef9',
});
export function isKoreaDeskHistoryCheckpoint(plan, projectionPaths, expectedInventory = {}) {
  return Boolean(plan.review.nativeSupplementalContext && plan.review.bootstrap
    && Object.entries(koreaDeskHistoryPaths).every(([kind, name]) => plan.finalInventory.files[name]?.sha256 === koreaDeskHistorySource[kind])
    && (Object.values(koreaDeskHistoryPaths).every(name => projectionPaths.includes(name))
      // A successor can start with the exact previously installed fields.
      || Object.entries(installedKoreaDeskChoices).every(([kind, hash]) => expectedInventory[koreaDeskHistoryPaths[kind]]?.sha256 === hash)));
}

const nativeKoreaDeskRecordTypeValues = `    <picklistValues>
        <picklist>Korea_Desk__c</picklist>
        <values>
            <fullName>No</fullName>
            <default>false</default>
        </values>
        <values>
            <fullName>Yes</fullName>
            <default>false</default>
        </values>
    </picklistValues>
`;

// Apply only to retrieved copies. Every pre-existing definition must recover the
// exact reviewed bytes after removing Salesforce's generated history defaults.
export function normalizeKoreaDeskHistoryReadback(root, pinned) {
  const effects = {};
  for (const [name, pin] of Object.entries(pinned)) {
    const field = /^objects\/STEM__c\/fields\/[A-Za-z][A-Za-z0-9_]*\.field-meta\.xml$/u.test(name);
    const recordType = /^objects\/STEM__c\/recordTypes\/(Historical|Originated)\.recordType-meta\.xml$/u.test(name);
    if ((!field && !recordType) || !existsSync(path.join(root, name))) continue;
    const file = safeProjectFile(root, name);
    const original = readFileSync(file);
    const originalHash = salesforcePromotionHash(original);
    if (originalHash === pin.sha256 && original.length === pin.size) {
      if (recordType) throw new Error(`Native STEM record type lacks the reviewed Korea Desk choices: ${name}`);
      continue;
    }
    const xml = original.toString('utf8');
    if (!original.equals(Buffer.from(xml))) continue;
    const generated = field ? '    <trackHistory>false</trackHistory>\n' : nativeKoreaDeskRecordTypeValues;
    const offset = xml.indexOf(generated);
    if (offset === -1 || xml.indexOf(generated, offset + 1) !== -1) continue;
    const normalized = Buffer.from(xml.slice(0, offset) + xml.slice(offset + generated.length));
    if (normalized.length !== pin.size || salesforcePromotionHash(normalized) !== pin.sha256) continue;
    writeFileSync(file, normalized);
    effects[name] = { sha256: originalHash, size: original.length };
  }
  return effects;
}

// A reviewed STEM object header retrieval includes every installed child. Verify
// those bytes independently, then remove only the pinned context from this
// temporary readback. The primary owned inventory and deployed package stay intact.
export function removeVerifiedStemSupplementalContext(root, reviewed, context) {
  if (context === undefined) return;
  if (!reviewed.some(({ id }) => id === 'CustomObject:STEM__c')) return;
  const expected = new Set(reviewed.flatMap(({ files }) => files));
  const observed = readReviewedInventory(root, { nativeExport: true }).files;
  const stemChildren = Object.keys(observed).filter(name => name.startsWith('objects/STEM__c/')
    && name !== 'objects/STEM__c/STEM__c.object-meta.xml' && !expected.has(name)).sort();
  const pins = Object.keys(context).sort();
  if (JSON.stringify(stemChildren) !== JSON.stringify(pins)) {
    throw new Error('Native STEM supplemental context has unexpected or missing children.');
  }
  for (const name of pins) {
    const actual = observed[name], pinned = context[name];
    if (!actual || actual.sha256 !== pinned.sha256 || actual.size !== pinned.size) {
      throw new Error(`Native STEM supplemental context differs from its pinned bytes: ${name}`);
    }
  }
  for (const name of pins) rmSync(safeProjectFile(root, name));
}

function inspectNativeSupplementalFiles(root, reviewed, { allowObjectShells = false, retainedFields = new Set() } = {}) {
  const expected = new Set(reviewed.flatMap(({ files }) => files));
  const observed = readReviewedInventory(root, { nativeExport: true });
  const extra = Object.keys(observed.files).filter(name => !expected.has(name) && !retainedFields.has(name));
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
    if (!EMPTY_NATIVE_OBJECT.test(source)) throw new Error(`Native metadata retrieval returned an unexpected nonempty object descriptor: ${name}`);
    shells[name] = observed.files[name];
    rmSync(file);
  }
  return shells;
}

export function cliSalesforceProvider({ cwd = ROOT, policy = POLICY, run = localCommand, adapter = {}, adapterPath, commandEnvironment } = {}) {
  const sf = (args, directory = cwd) => run('sf', args, directory, { env: commandEnvironment });
  function preparePackage(plan, { operation, manifestPath, manifestSha256, components, command, invoiceApplication }) {
    const manifest = readFileSync(safeProjectFile(cwd, manifestPath));
    if (salesforcePromotionHash(manifest) !== manifestSha256) throw new Error(`Salesforce ${operation} manifest changed.`);
    const versions = [...manifest.toString('utf8').matchAll(/<version>\s*(\d+\.0)\s*<\/version>/gu)];
    if (versions.length !== 1) throw new Error(`Salesforce ${operation} requires one explicit metadata API version.`);
    const members = new Set(components);
    const files = new Set(plan.review.components.filter(({ id }) => members.has(id)).flatMap(({ files }) => files));
    const appFile = invoiceApplication && `applications/${invoiceApplication.app}.app-meta.xml`;
    const manifestForDeployment = invoiceApplication
      ? manifest.toString('utf8').replace('</Package>', `<types><members>${invoiceApplication.app}</members><name>CustomApplication</name></types>\n</Package>`)
      : manifest;
    if (invoiceApplication) members.add(`CustomApplication:${invoiceApplication.app}`);
    const project = mkdtempSync(path.join(tmpdir(), `fcos-salesforce-${operation}-`));
    const cleanup = () => rmSync(project, { recursive: true, force: true });
    try {
      writeFileSync(path.join(project, 'sfdx-project.json'), JSON.stringify({
        packageDirectories: [{ path: 'force-app', default: true }], namespace: '', sourceApiVersion: versions[0][1],
      }));
      writeFileSync(path.join(project, `${operation}.xml`), manifestForDeployment, { mode: 0o600 });
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
      if (invoiceApplication) {
        const destination = path.join(project, policy.publication.sourceRoot, appFile);
        mkdirSync(path.dirname(destination), { recursive: true });
        writeFileSync(destination, invoiceApplication.bytes, { mode: 0o600 });
        files.add(appFile);
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
          // The pinned CLI wraps metadata directories in zip/. Salesforce expects
          // a root package.xml only when the caller requests single-package mode.
          return sf([...command, '--metadata-dir', converted, '--api-version', apiVersion, '--async', '--json'], project);
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
    readKoreaDeskBuyerAccountXml(environment) {
      this.verifyIdentity(environment);
      const project = mkdtempSync(path.join(tmpdir(), 'fcos-buyer-history-readback-'));
      try {
        copyFileSync(safeProjectFile(cwd, 'sfdx-project.json'), path.join(project, 'sfdx-project.json'));
        mkdirSync(path.join(project, 'force-app'));
        const result = sf(['project', 'retrieve', 'start', '--target-org', environment.alias,
          '--metadata', 'CustomField:STEM__c.Account__c', '--output-dir', 'readback', '--wait', '3', '--json'], project);
        if (result.success !== true || result.status !== 'Succeeded' || result.done !== true || result.messages?.length) {
          throw new Error('Korea Desk Buyer field metadata retrieval did not complete successfully.');
        }
        return readFileSync(safeProjectFile(path.join(project, 'readback'), 'objects/STEM__c/fields/Account__c.field-meta.xml'));
      } finally {
        rmSync(project, { recursive: true, force: true });
      }
    },
    report(environment, jobId) { return sf(['project', 'deploy', 'report', '--target-org', environment.alias, '--job-id', jobId, '--wait', '60', '--json']); },
    prepareValidation(environment, plan) {
      const command = ['project', 'deploy', 'validate', '--target-org', environment.alias, '--test-level', plan.binding.testPlan.level];
      if (plan.binding.testPlan.level === 'RunSpecifiedTests') for (const name of plan.binding.testPlan.tests) command.push('--tests', name);
      const descriptor = environment.key === 'devee' ? undefined : plan.invoiceAppPlacement?.[environment.key];
      const invoiceApplication = descriptor && { app: descriptor.app,
        bytes: readInvoiceAppPlacement(descriptor, environment.key, relative => safeProjectFile(cwd, relative)).after };
      return preparePackage(plan, { operation: 'validation', manifestPath: plan.manifestPath, invoiceApplication,
        manifestSha256: plan.binding.manifestSha256, components: plan.manifest, command });
    },
    validate(environment, plan) {
      const prepared = this.prepareValidation(environment, plan);
      try { return prepared.submit(); }
      finally { prepared.cleanup(); }
    },
    verifyInvoiceAppPlacement(environment, plan, phase) {
      const descriptor = plan.invoiceAppPlacement?.[environment.key];
      if (!descriptor || !['before', 'after'].includes(phase)) throw new Error('Invalid invoice application checkpoint.');
      const expected = readInvoiceAppPlacement(descriptor, environment.key, relative => safeProjectFile(cwd, relative))[phase];
      this.verifyIdentity(environment);
      const project = mkdtempSync(path.join(tmpdir(), 'fcos-salesforce-invoice-placement-'));
      try {
        mkdirSync(path.join(project, 'force-app'));
        copyFileSync(safeProjectFile(cwd, 'sfdx-project.json'), path.join(project, 'sfdx-project.json'));
        const result = sf(['project', 'retrieve', 'start', '--target-org', environment.alias,
          '--metadata', `CustomApplication:${descriptor.app}`, '--wait', '5', '--json'], project);
        if (!/^09S[A-Za-z0-9]{15}$/u.test(result?.id || '') || result.status !== 'Succeeded'
          || result.success !== true || result.done !== true || result.messages?.length) {
          throw new Error('Invoice application readback did not complete without warnings.');
        }
        const actual = readFileSync(safeProjectFile(project,
          `force-app/main/default/applications/${descriptor.app}.app-meta.xml`));
        assertInvoiceAppPlacementReadback(expected, actual);
        return { orgId: environment.orgId, phase,
          evidenceSha256: salesforcePromotionHash({ jobId: result.id, contentSha256: salesforcePromotionHash(actual) }) };
      } finally {
        rmSync(project, { recursive: true, force: true });
      }
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
      nativeBootstrap = false, projectionPaths = [], projectedNativeInventory = false, profileRecovery }) {
      const manifest = plan.review.inventoryManifests?.[expectedInventoryHash];
      if (!manifest) throw new Error('Current Salesforce inventory requires an exact reviewed retrieval manifest.');
      const bytes = readFileSync(safeProjectFile(cwd, manifest.path));
      if (salesforcePromotionHash(bytes) !== manifest.sha256) throw new Error('Salesforce inventory retrieval manifest digest mismatch.');
      const presentComponents = parseReviewedPackage(bytes.toString('utf8'), { inventory: true });
      const stableMembers = new Set(presentComponents);
      const inlineLayouts = plan.review.nativeProjection === 'schema-free-layout';
      const supplementalManifest = nativeBootstrap ? manifest.metadata : manifest.apex;
      const presentReviewed = nativeExport
        ? plan.review.components.filter(({ id }) => !expectedAbsentComponents.includes(id)) : [];
      let supplementalBytes;
      if (nativeExport) {
        const supplementalLabel = nativeBootstrap ? 'metadata' : 'Apex';
        if (inlineLayouts) {
          if (supplementalManifest || presentReviewed.some(({ id }) => !stableMembers.has(id))) {
            throw new Error('Layout inventory must retrieve every reviewed layout together with its profile assignments.');
          }
        } else if (plan.review.components.some(({ id }) => presentComponents.includes(id)) || Boolean(supplementalManifest) !== Boolean(presentReviewed.length)) {
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
        const historyReadback = nativeBootstrap && isKoreaDeskHistoryCheckpoint(plan, projectionPaths, expectedInventory)
          ? {
            stable: normalizeKoreaDeskHistoryReadback(root, expectedInventory),
            supplemental: normalizeKoreaDeskHistoryReadback(supplementalRoot, plan.review.nativeSupplementalContext[environment.key]),
          } : null;
        if (supplementalRoot && nativeBootstrap && plan.review.nativeSupplementalContext !== undefined) {
          removeVerifiedStemSupplementalContext(supplementalRoot, presentReviewed,
            plan.review.nativeSupplementalContext[environment.key]);
        }
        // A reviewed Custom Setting retrieval can also export installed fields
        // excluded from the package. Keep them only as exact stable inventory context.
        const reviewedObjects = new Set(presentReviewed.filter(({ id }) => id.startsWith('CustomObject:')).map(({ id }) => id));
        const retainedFields = new Set(nativeBootstrap ? (plan.review.nativeInventoryContext?.[environment.key] || []).filter(name => {
          const field = /^objects\/([A-Za-z][A-Za-z0-9_]*)\/fields\/([A-Za-z][A-Za-z0-9_]*)\.field-meta\.xml$/u.exec(name);
          return field && reviewedObjects.has('CustomObject:' + field[1])
            && stableMembers.has('CustomField:' + field[1] + '.' + field[2])
            && Object.hasOwn(expectedInventory || {}, name) && existsSync(path.join(root, name));
        }) : []);
        const supplementalObjectShells = supplementalRoot
          ? inspectNativeSupplementalFiles(supplementalRoot, presentReviewed, { allowObjectShells: nativeBootstrap, retainedFields }) : {};
        const stableObjectShells = {};
        for (const { id, files } of presentReviewed) {
          if (!nativeBootstrap || !id.startsWith('CustomObject:')) continue;
          const object = files.find(name => name.endsWith('.object-meta.xml'));
          const folder = object && path.posix.dirname(object) + '/fields/';
          const pinnedStemContext = id === 'CustomObject:STEM__c'
            && plan.review.nativeSupplementalContext?.[environment.key] !== undefined;
          if (!folder || (!pinnedStemContext && ![...retainedFields].some(name => name.startsWith(folder)))
            || !existsSync(path.join(root, object))) continue;
          const file = safeProjectFile(root, object);
          const bytes = readFileSync(file);
          if (!EMPTY_NATIVE_OBJECT.test(bytes.toString('utf8'))) throw new Error('Stable Salesforce field retrieval returned a nonempty reviewed object descriptor.');
          stableObjectShells[object] = { sha256: salesforcePromotionHash(bytes), size: bytes.length };
          rmSync(file);
        }
        const matchingSupplementalPaths = nativeBootstrap
          ? new Set([...presentReviewed.filter(({ id }) => id.startsWith('CustomField:')).flatMap(({ files }) => files),
            ...retainedFields]) : null;
        const observed = readReviewedInventory(root, { nativeExport, supplementalRoot, matchingSupplementalPaths });
        let inventoryFiles = observed.files;
        let rawProfileEvidence;
        if (projectedNativeInventory && tradingFxProductionInventoryScope(environment.key, plan.fingerprint, profileRecovery)) {
          const known = expectedInventory[tradingFxSalesSupportPath];
          const found = observed.files[tradingFxSalesSupportPath];
          if (known && found && found.sha256 !== known.sha256) {
            const normalized = normalizeTradingFxDeniedProfile(readFileSync(safeProjectFile(root, tradingFxSalesSupportPath)), known, profileRecovery);
            if (normalized) {
              rawProfileEvidence = { rawProfileDigest: found.sha256, rawInventoryDigest: observed.inventoryHash };
              inventoryFiles = { ...observed.files, [tradingFxSalesSupportPath]: normalized };
            }
          }
        }
        const observedNativeInventoryHash = rawProfileEvidence ? salesforcePromotionHash(inventoryFiles) : observed.inventoryHash;
        const inventoryMatches = projectedNativeInventory
          ? nativeBootstrap && projectionPaths.length > 0
            && matchesProjectedNativeInventory(inventoryFiles, expectedInventory, projectionPaths, {
              environmentKey: environment.key, fingerprint: plan.fingerprint, profileRecovery,
            })
            && projectedNativeInventoryHash(expectedInventory, projectionPaths) === expectedInventoryHash
          : observed.inventoryHash === expectedInventoryHash;
        if (!inventoryMatches || (expectedSourceTreeHash && observed.sourceTreeHash !== expectedSourceTreeHash)) {
          const error = new Error('Native Salesforce retrieval differs from the exact reviewed inventory.');
          if (tradingFxProductionInventoryScope(environment.key, plan.fingerprint, profileRecovery)) {
            error.code = 'TRADING_FX_FINAL_NATIVE_INVENTORY_CHANGED';
          }
          throw error;
        }
        if (verifyApexProjection) verifyNativeApexProjection({ root: supplementalRoot, sourceRoot: path.join(cwd, policy.publication.sourceRoot), plan });
        const metadataEvidence = nativeBootstrap && projectionPaths.length
          ? verifyNativeMetadataProjection({ root: inlineLayouts ? root : supplementalRoot, sourceRoot: path.join(cwd, policy.publication.sourceRoot),
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
          ...(projectedNativeInventory ? { observedNativeInventoryHash, ...rawProfileEvidence } : {}),
          ...(supplementalJobId ? (nativeBootstrap ? { metadataJobId: supplementalJobId, metadataManifestSha256: supplementalManifest.sha256 }
            : { apexJobId: supplementalJobId, apexManifestSha256: supplementalManifest.sha256 }) : {}),
          ...(nativeBootstrap ? { verifiedProjectionPaths: projectionPaths, supplementalObjectShells, ...(Object.keys(stableObjectShells).length ? { stableObjectShells } : {}), supplementalDuplicates: observed.supplementalDuplicates } : {}),
          ...(historyReadback ? { historyReadback } : {}),
          ...metadataEvidence,
          ...(nativeExport ? { nativeSourceTreeHash: observed.sourceTreeHash, apexProjectionVerified: verifyApexProjection } : {}), ...absence });
        return { orgId: identity.orgId, identity, verifiedAt, sourceTreeHash, inventoryHash: expectedInventoryHash,
          ...(projectedNativeInventory ? { observedNativeInventoryHash, ...rawProfileEvidence } : {}),
          evidenceSha256, observedInventory: inventoryFiles,
          ...(nativeExport ? { nativeSourceTreeHash: observed.sourceTreeHash, apexProjectionVerified: verifyApexProjection } : {}),
          ...(nativeBootstrap ? { verifiedProjectionPaths: projectionPaths, supplementalObjectShells, ...(Object.keys(stableObjectShells).length ? { stableObjectShells } : {}), supplementalDuplicates: observed.supplementalDuplicates } : {}),
          ...metadataEvidence,
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
  assertSalesforceProductionSettingCompatibility(cwd, plan, policy);
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
