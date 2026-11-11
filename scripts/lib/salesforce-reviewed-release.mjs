import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { digest as digestCheckpoint } from './rapid-release/contract.mjs';
import { salesforcePromotionHash as hash, assertSuccessfulSalesforceReport } from './salesforce-promotion-journal.mjs';

export const REVIEWED_SALESFORCE_MODE = 'reviewed-manifest-incremental-v1';
export const INVENTORY_BASELINE_MODE = 'read-only-owned-tree-inventory';
export const COMPLETE_DEPLOYMENT_BASELINE_MODE = 'verified-complete-owned-tree-deployment';
export const COMPLETE_TREE_FALLBACK = 'Use salesforce:complete:deploy with separate complete-tree state/proof; do not relabel an incremental job as a complete-tree deployment.';
const ENVIRONMENTS = ['devee', 'qat', 'production'];
const JOB_ID = /^0Af[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/u;
const HASH = /^[a-f0-9]{64}$/u;
const ACTIVE = new Set(['Submitted', 'Queued', 'Pending', 'InProgress', 'Canceling']);
const TERMINAL = new Set(['Failed', 'Canceled', 'Expired']);
const failCoverage = message => { throw new Error(`${message} ${COMPLETE_TREE_FALLBACK}`); };
const sorted = values => [...new Set(values)].sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function matchesSalesforceCheckpoint(record, entry) {
  if (!record || !HASH.test(entry.evidenceDigest || '')) return false;
  if (digestCheckpoint(record) === entry.evidenceDigest) return true;
  const permission = entry.permission;
  return entry.outcome === 'resolved' && record.status === 'Succeeded' && Boolean(permission)
    && entry.operation === `permission:${permission.name}` && typeof permission.prestate === 'boolean'
    && record.recoveredEvidenceDigest === entry.evidenceDigest && record.name === permission.name
    && record.orgId === permission.orgId && record.prestate === permission.prestate
    && record.addedByRelease === !permission.prestate;
}

export function safeProjectFile(cwd, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.split('/').some(part => part === '..' || !part)) throw new Error('Reviewed Salesforce paths must be safe project-relative paths.');
  const absolute = path.resolve(cwd, relative);
  if (path.relative(cwd, absolute).startsWith('..') || path.isAbsolute(relative)) throw new Error('Reviewed Salesforce path escapes the project.');
  let current = cwd;
  for (const part of relative.split('/')) { current = path.join(current, part); if (lstatSync(current).isSymbolicLink()) throw new Error('Reviewed Salesforce inputs cannot be symbolic links.'); }
  return absolute;
}

export function inventoryFromFiles(files) {
  const ordered = Object.entries(files).sort(([a], [b]) => a.localeCompare(b, 'en'));
  // Match the authoritative mirror algorithm's lexical file order, without locale ordering.
  ordered.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const inventory = Object.fromEntries(ordered.map(([name, bytes]) => [name, { sha256: hash(bytes), size: bytes.length }]));
  const treeParts = [];
  for (const [name, bytes] of ordered) treeParts.push(Buffer.from(`${name}\0${bytes.length}\0`), bytes, Buffer.from('\0'));
  return { sourceTreeHash: hash(Buffer.concat(treeParts)), inventoryHash: hash(inventory), files: inventory };
}

export function readReviewedInventory(root, { nativeExport = false, supplementalRoot = null } = {}) {
  const files = Object.create(null);
  function visit(directory, base) {
    for (const name of readdirSync(directory).sort()) {
      const absolute = path.join(directory, name), stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error('Salesforce metadata cannot contain symlinks.');
      if (stat.isDirectory()) visit(absolute, base);
      else {
        const bytes = readFileSync(absolute);
        if (!nativeExport && bytes.includes(Buffer.from('\r\n'))) throw new Error('Salesforce source must use LF line endings.');
        const relative = path.relative(base, absolute).split(path.sep).join('/');
        if (Object.hasOwn(files, relative)) throw new Error('Salesforce inventory contains an overlapping retrieval path.');
        files[relative] = bytes;
      }
    }
  }
  visit(root, root);
  if (supplementalRoot) visit(supplementalRoot, supplementalRoot);
  return inventoryFromFiles(files);
}

const NATIVE_CUSTOM_FIELD_FALSE_FLAGS = new Set(['caseSensitive', 'externalId', 'required', 'trackHistory', 'trackTrending', 'unique']);
export const NATIVE_CUSTOM_OBJECT_DEFAULTS = Object.freeze({
  actionOverrides: 'standard-actions',
  allowInChatterGroups: 'false',
  compactLayoutAssignment: 'SYSTEM',
  enableFeeds: 'false',
  enableLicensing: 'false',
  'nameField.trackHistory': 'false',
  searchLayouts: 'empty',
});

function assertNativeSerializationAllowances(review, components) {
  const specs = [
    { allowances: review.nativeCustomFieldFalseFlags, type: 'CustomField', allowed: NATIVE_CUSTOM_FIELD_FALSE_FLAGS },
    { allowances: review.nativeCustomObjectDefaults, type: 'CustomObject', allowed: new Set(Object.keys(NATIVE_CUSTOM_OBJECT_DEFAULTS)) },
  ];
  for (const { allowances, type, allowed } of specs) {
    if (allowances === undefined) continue;
    const paths = new Set(components.filter(({ id }) => id.startsWith(type + ':')).flatMap(({ files }) => files));
    if (!review.bootstrap || !review.nativeInventories || !allowances || typeof allowances !== 'object'
      || Array.isArray(allowances) || !Object.keys(allowances).length
      || Object.entries(allowances).some(([name, flags]) => !paths.has(name) || !Array.isArray(flags)
        || !flags.length || new Set(flags).size !== flags.length || flags.some(flag => !allowed.has(flag)))) {
      failCoverage(`Native ${type} serialization allowances require exact reviewed bootstrap ${type === 'CustomField' ? 'field' : 'object'} paths and supported flags.`);
    }
  }
}

export function projectedNativeInventoryHash(files, projectionPaths) {
  return hash({ files, projectionPaths });
}

export function matchesProjectedNativeInventory(observed, pinned, projectionPaths) {
  return Boolean(observed) && same(sorted(Object.keys(observed)), sorted([...Object.keys(pinned), ...projectionPaths]))
    && Object.entries(observed).every(([name, pin]) => HASH.test(pin?.sha256 || '') && Number.isSafeInteger(pin.size) && pin.size >= 0
      && (!Object.hasOwn(pinned, name) || same(pin, pinned[name])));
}

function reviewedNativeBootstrapInventories(review, policy, baselineInventory, orgBaselineInventories, finalInventory, components) {
  const reviewed = review.nativeInventories;
  if (review.baselineMode !== INVENTORY_BASELINE_MODE
    || !reviewed || !same(sorted(Object.keys(reviewed)), sorted(ENVIRONMENTS))) {
    failCoverage('Native bootstrap checkpoints require an exact inventory review for every org.');
  }
  const context = review.nativeInventoryContext;
  if (context !== undefined && (!context || typeof context !== 'object' || Array.isArray(context)
    || !same(sorted(Object.keys(context)), sorted(ENVIRONMENTS))
    || Object.values(context).some(paths => !Array.isArray(paths) || new Set(paths).size !== paths.length
      || paths.some(name => typeof name !== 'string' || !/^objects\/[A-Za-z0-9_.$/ -]+\.xml$/u.test(name)
        || name.split('/').some(part => !part || part === '.' || part === '..') || Object.hasOwn(finalInventory.files, name))))) {
    failCoverage('Native bootstrap context must name exact unowned object XML paths for every org.');
  }
  const bootstrapComponents = new Set(review.bootstrap.components);
  const bootstrapFiles = new Set(components.filter(({ id }) => bootstrapComponents.has(id)).flatMap(({ files }) => files));
  const releaseFiles = new Set(components.flatMap(({ files }) => files));
  const validManifest = entry => typeof entry?.path === 'string' && Boolean(entry.path) && HASH.test(entry.sha256 || '');
  const manifestIdentity = entry => [entry.path, entry.sha256];
  const checkpoint = (descriptor, expectedPaths, projectionPaths, projected = false) => {
    const files = descriptor?.files;
    const paths = new Set(expectedPaths);
    const rawPaths = [...paths].filter(name => !projected || !projectionPaths.has(name));
    const projectedPaths = sorted(projectionPaths);
    if (!files || typeof files !== 'object' || Array.isArray(files)
      || !same(sorted(Object.keys(files)), sorted(rawPaths))
      || Object.values(files).some(pin => !HASH.test(pin?.sha256 || '') || !Number.isSafeInteger(pin.size)
        || pin.size < 0 || !same(sorted(Object.keys(pin)), ['sha256', 'size']))) {
      failCoverage('Native bootstrap checkpoint must pin the exact owned paths and bytes.');
    }
    const ordered = Object.fromEntries(Object.keys(files).sort().map(name => [name, { sha256: files[name].sha256, size: files[name].size }]));
    const inventoryHash = projected ? projectedNativeInventoryHash(ordered, projectedPaths) : hash(ordered);
    const retrieval = review.inventoryManifests?.[inventoryHash];
    const present = components.filter(component => component.files.every(name => paths.has(name)));
    if (components.some(component => component.files.some(name => paths.has(name)) && !present.includes(component))) {
      failCoverage('Native bootstrap checkpoint contains a partially present component.');
    }
    if (descriptor.inventoryHash !== inventoryHash || !validManifest(retrieval) || retrieval.apex !== undefined
      || (present.length ? !validManifest(retrieval.metadata) : retrieval.metadata !== undefined)) {
      failCoverage('Native bootstrap checkpoint lacks its exact split retrieval manifest.');
    }
    return { files: ordered, inventoryHash, nativeExport: true, nativeBootstrap: true,
      ...(projected ? { projectedNativeInventory: true } : {}),
      projectionPaths: projectedPaths, absentComponents: sorted(components.filter(component => !present.includes(component)).map(({ id }) => id)) };
  };
  const assertTransition = (before, after, allowedPaths) => {
    const afterPaths = new Set([...Object.keys(after.files), ...(after.projectedNativeInventory ? after.projectionPaths : [])]);
    if (Object.keys(before.files).some(name => !afterPaths.has(name)
      || (!allowedPaths.has(name) && !same(before.files[name], after.files[name])))
      || Object.keys(after.files).some(name => !same(before.files[name], after.files[name]) && !allowedPaths.has(name))
      || !same(manifestIdentity(review.inventoryManifests[before.inventoryHash]),
        manifestIdentity(review.inventoryManifests[after.inventoryHash]))) {
      failCoverage('Native bootstrap checkpoints change files or retrieval scope outside the reviewed transition.');
    }
  };
  return Object.fromEntries(policy.environments.map(({ key, orgId }) => {
    const descriptor = reviewed[key];
    if (descriptor?.orgId !== orgId) failCoverage(`Salesforce ${key} native bootstrap checkpoint has the wrong pinned org.`);
    const gitBaseline = orgBaselineInventories?.[key] || baselineInventory;
    const projected = descriptor.bootstrap?.projected === true;
    if (descriptor.baseline?.projected !== undefined
      || (projected ? descriptor.final?.projected !== true
        : descriptor.bootstrap?.projected !== undefined || descriptor.final?.projected !== undefined)) {
      failCoverage('Native bootstrap projections require an exact raw baseline and matching post-write checkpoint modes.');
    }
    const contextPaths = context?.[key] || [];
    const baselinePaths = [...Object.keys(gitBaseline.files), ...contextPaths];
    const baseline = checkpoint(descriptor.baseline, baselinePaths, []);
    const bootstrap = checkpoint(descriptor.bootstrap, [...baselinePaths, ...bootstrapFiles], bootstrapFiles, projected);
    const final = checkpoint(descriptor.final, [...Object.keys(finalInventory.files), ...contextPaths], releaseFiles, projected);
    assertTransition(baseline, bootstrap, bootstrapFiles);
    assertTransition(bootstrap, final, releaseFiles);
    return [key, { baseline, bootstrap, final }];
  }));
}

function reviewedNativeInventories(review, policy, baselineInventory, finalInventory, components, coveredFiles) {
  if (review.nativeInventories === undefined) return undefined;
  const reviewed = review.nativeInventories;
  if (review.baselineMode !== INVENTORY_BASELINE_MODE || review.bootstrap || review.orgBaselines
    || components.some(({ id }) => !id.startsWith('ApexClass:'))
    || !reviewed || !same(sorted(Object.keys(reviewed)), sorted(ENVIRONMENTS))) {
    failCoverage('Raw native inventory checkpoints require an exact, non-bootstrap Apex class review for every org.');
  }
  const checkpoint = (descriptor, gitInventory, key) => {
    const files = descriptor?.files;
    if (!files || Array.isArray(files) || typeof files !== 'object'
      || Object.entries(files).some(([name, value]) => !/^[A-Za-z0-9_ .$()@+\-/]+$/u.test(name)
        || name.split('/').some(part => !part || part === '.' || part === '..')
        || !HASH.test(value?.sha256 || '') || !Number.isSafeInteger(value?.size) || value.size < 0
        || !same(sorted(Object.keys(value)), ['sha256', 'size']))) {
      failCoverage(`Salesforce ${key} native inventory has an invalid file pin.`);
    }
    const ordered = Object.fromEntries(Object.keys(files).sort().map(name => [name, { sha256: files[name].sha256, size: files[name].size }]));
    const inventoryHash = hash(ordered);
    const manifest = review.inventoryManifests?.[inventoryHash];
    const present = components.filter(({ files }) => files.every(name => Object.hasOwn(ordered, name)));
    const validManifest = entry => typeof entry?.path === 'string' && Boolean(entry.path) && HASH.test(entry.sha256 || '');
    if (descriptor.inventoryHash !== inventoryHash || !validManifest(manifest)
      || (present.length ? !validManifest(manifest.apex) : manifest.apex !== undefined)
      || Object.keys(gitInventory.files).some(name => !Object.hasOwn(ordered, name))) {
      failCoverage(`Salesforce ${key} native inventory lacks exact owned path coverage or its retrieval manifest.`);
    }
    if (components.some(({ files }) => files.some(name => ordered[name]) && files.some(name => !ordered[name]))) {
      failCoverage(`Salesforce ${key} native inventory contains a partially present class.`);
    }
    return { files: ordered, inventoryHash, nativeExport: true,
      absentComponents: sorted(components.filter(({ files }) => files.every(name => !ordered[name])).map(({ id }) => id)) };
  };
  return Object.fromEntries(policy.environments.map(({ key, orgId }) => {
    const { baseline, final, orgId: reviewedId } = reviewed[key] || {};
    if (reviewedId !== orgId) failCoverage(`Salesforce ${key} native inventory has the wrong pinned org.`);
    const before = checkpoint(baseline, baselineInventory, key);
    const after = checkpoint(final, finalInventory, key);
    const beforeManifest = review.inventoryManifests[before.inventoryHash];
    const afterManifest = review.inventoryManifests[after.inventoryHash];
    if (beforeManifest.path !== afterManifest.path || beforeManifest.sha256 !== afterManifest.sha256) {
      failCoverage(`Salesforce ${key} stable native retrieval manifest changes between checkpoints.`);
    }
    if (Object.keys(before.files).some(name => !after.files[name])
      || Object.keys(after.files).some(name => !same(before.files[name], after.files[name]) && !coveredFiles.has(name))) {
      failCoverage(`Salesforce ${key} native checkpoints differ outside the reviewed Apex package.`);
    }
    return [key, { baseline: before, final: { ...after, verifyApexProjection: true } }];
  }));
}

export function parseReviewedPackage(xml, { inventory = false } = {}) {
  if (typeof xml !== 'string' || /<!|&|<\s*destructiveChanges\b/iu.test(xml)) failCoverage('Unsupported Salesforce package XML.');
  const members = [];
  for (const [, body] of xml.matchAll(/<types>([\s\S]*?)<\/types>/gu)) {
    const names = [...body.matchAll(/<name>([^<]+)<\/name>/gu)].map(([, name]) => name.trim());
    const values = [...body.matchAll(/<members>([^<]+)<\/members>/gu)].map(([, name]) => name.trim());
    if (names.length !== 1 || !values.length) failCoverage('Each reviewed package type must have exact members.');
    for (const member of values) {
      const namedInventoryMember = (names[0] === 'Layout' || (inventory && names[0] === 'Profile'))
        && /^[A-Za-z0-9_.$-]+(?: +[A-Za-z0-9_.$-]+)+$/u.test(member);
      if (!/^[A-Za-z0-9_.$-]+$/u.test(member) && !namedInventoryMember) failCoverage('Wildcards and unsupported Salesforce members are prohibited.');
      members.push(`${names[0]}:${member}`);
    }
  }
  if (!members.length || members.length !== new Set(members).size) failCoverage('The reviewed package must contain unique explicit components.');
  // Reject unparsed types rather than accepting a partial parser's interpretation.
  if ((xml.match(/<types\b/gu) || []).length !== (xml.match(/<types>/gu) || []).length) failCoverage('Unsupported package type syntax.');
  return sorted(members);
}

function componentFiles(id, inventory) {
  const [type, member, extra] = id.split(':');
  if (extra || !member) failCoverage('Invalid reviewed component identifier.');
  const direct = {
    ApexClass: [`classes/${member}.cls`, `classes/${member}.cls-meta.xml`],
    ApexTrigger: [`triggers/${member}.trigger`, `triggers/${member}.trigger-meta.xml`],
    ApexPage: [`pages/${member}.page`, `pages/${member}.page-meta.xml`],
    CustomPermission: [`customPermissions/${member}.customPermission-meta.xml`],
    PermissionSet: [`permissionsets/${member}.permissionset-meta.xml`],
    CustomObject: [`objects/${member}/${member}.object-meta.xml`],
  };
  let result = direct[type];
  if (type === 'QuickAction') {
    if (!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)?$/u.test(member)) failCoverage('QuickAction requires an exact action name and optional object qualifier.');
    result = [`quickActions/${member}.quickAction-meta.xml`];
  }
  if (type === 'Layout') {
    if (!/^[A-Za-z][A-Za-z0-9_]*-[A-Za-z0-9_.$-]+(?: +[A-Za-z0-9_.$-]+)*$/u.test(member)) failCoverage('Layout requires an exact object-qualified layout name.');
    result = [`layouts/${member}.layout-meta.xml`];
  }
  if (type === 'CustomField') {
    const parts = member.split('.');
    if (parts.length !== 2) failCoverage('CustomField members must name Object.Field.');
    result = [`objects/${parts[0]}/fields/${parts[1]}.field-meta.xml`];
  }
  if (type === 'ValidationRule') {
    const rule = /^([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z][A-Za-z0-9_]*)$/u.exec(member);
    if (!rule) failCoverage('ValidationRule members must name Object.Rule.');
    result = [`objects/${rule[1]}/validationRules/${rule[2]}.validationRule-meta.xml`];
  }
  const directory = { LightningComponentBundle: 'lwc', AuraDefinitionBundle: 'aura' }[type];
  if (directory) result = Object.keys(inventory.files).filter(name => name.startsWith(`${directory}/${member}/`));
  if (!result?.length || result.some(name => !inventory.files[name])) failCoverage(`Unsupported or missing Salesforce component ${id}.`);
  return sorted(result);
}

/** Baselines bind a Git tree; native inventory or complete v2 deployment evidence establishes org state. */
export function createReviewedSalesforcePlan({ review, manifestBytes, bootstrapBytes = null, baselineWorkflow, baselineInventory,
  orgBaselineInventories, finalInventory, policy }) {
  if (policy.environments.map(({ key }) => key).join(',') !== ENVIRONMENTS.join(',')) throw new Error('Salesforce order must be DEVEE → shared mirror → QAT → Production.');
  if (review?.schemaVersion !== 1 || review?.releaseMode !== REVIEWED_SALESFORCE_MODE || !HASH.test(review?.sourceTreeHash || '')
    || review.sourceTreeHash !== finalInventory.sourceTreeHash || review.manifestSha256 !== hash(manifestBytes)
    || !/^[a-f0-9]{40}$/u.test(review.baselineCommit || '')) failCoverage('Reviewed manifest/source/baseline binding is invalid.');
  const baselineMode = review.baselineMode || COMPLETE_DEPLOYMENT_BASELINE_MODE;
  if (![INVENTORY_BASELINE_MODE, COMPLETE_DEPLOYMENT_BASELINE_MODE].includes(baselineMode)
    || review.baselineSourceTreeHash !== baselineInventory.sourceTreeHash || review.baselineInventoryHash !== baselineInventory.inventoryHash) failCoverage('Unknown or mismatched baseline Git tree/inventory.');
  if (baselineMode === COMPLETE_DEPLOYMENT_BASELINE_MODE && (baselineWorkflow?.schemaVersion !== 2 || baselineWorkflow?.releaseMode !== 'schema-free-complete-owned-tree'
    || baselineWorkflow.sourceScope !== 'force-app/main/default' || baselineWorkflow.sourceTreeHash !== baselineInventory.sourceTreeHash)) failCoverage('Unknown or unverified complete-tree baseline.');
  if (baselineMode === INVENTORY_BASELINE_MODE && (baselineWorkflow || review.baselineWorkflowPath)) failCoverage('Read-only inventory baselines cannot claim complete-tree deployment proof.');
  const manifest = parseReviewedPackage(manifestBytes.toString('utf8'));
  const components = review.components;
  if (!Array.isArray(components) || !same(sorted(components.map(({ id }) => id)), manifest) || components.length !== manifest.length) failCoverage('Manifest component/dependency coverage is incomplete.');
  const coveredFiles = new Set();
  for (const component of components) {
    if (!same(sorted(component.files || []), componentFiles(component.id, finalInventory)) || !Array.isArray(component.dependsOn)) failCoverage(`Incorrect component file/dependency coverage for ${component.id}.`);
    for (const file of component.files) coveredFiles.add(file);
    for (const dependency of component.dependsOn) if (!manifest.includes(dependency)) failCoverage(`Dependency ${dependency} is absent from the reviewed manifest.`);
  }
  if (review.dependencyReview?.complete !== true || !String(review.dependencyReview.reviewer || '').trim()
    || !String(review.dependencyReview.evidence || '').trim()) failCoverage('An explicit complete dependency review is required.');
  const removed = Object.keys(baselineInventory.files).filter(name => !finalInventory.files[name]);
  if (removed.length || review.destructiveChanges?.length) failCoverage('Destructive metadata changes are unsupported by the incremental route.');
  const changed = Object.keys(finalInventory.files).filter(name => !same(finalInventory.files[name], baselineInventory.files[name]));
  if (!changed.length || changed.some(name => !coveredFiles.has(name))) failCoverage('Changed Salesforce files are missing manifest coverage.');
  const orgBaselines = review.orgBaselines;
  const catalogControls = review.inventoryCatalogControls;
  if (catalogControls !== undefined && (baselineMode !== INVENTORY_BASELINE_MODE || !catalogControls || Array.isArray(catalogControls)
    || typeof catalogControls !== 'object' || Object.entries(catalogControls).some(([key, controls]) =>
      !ENVIRONMENTS.includes(key) || !Array.isArray(controls) || new Set(controls).size !== controls.length || controls.some(id =>
        !/^(?:(?:ApexPage|CustomPermission):[A-Za-z][A-Za-z0-9_]*|QuickAction:[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)?)$/u.test(id)
        || manifest.includes(id))))) failCoverage('Inventory catalog controls must be exact independent metadata members for pinned orgs.');
  if (orgBaselines !== undefined || orgBaselineInventories !== undefined) {
    if (baselineMode !== INVENTORY_BASELINE_MODE || !orgBaselines || !orgBaselineInventories
      || !same(sorted(Object.keys(orgBaselines)), sorted(ENVIRONMENTS))
      || !same(sorted(Object.keys(orgBaselineInventories)), sorted(ENVIRONMENTS))) failCoverage('Exact per-org inventory baselines are required for DEVEE, QAT and Production.');
    for (const { key, orgId } of policy.environments) {
      const descriptor = orgBaselines[key], inventory = orgBaselineInventories[key];
      if (!descriptor || !inventory || descriptor.orgId !== orgId || !/^[a-f0-9]{40}$/u.test(descriptor.commit || '')
        || descriptor.sourceTreeHash !== inventory.sourceTreeHash || descriptor.inventoryHash !== inventory.inventoryHash) {
        failCoverage(`Salesforce ${key} baseline Git tree or pinned org does not match the review.`);
      }
      if (Object.keys(inventory.files).some(name => !finalInventory.files[name])) failCoverage(`Salesforce ${key} baseline would require metadata removal.`);
      if (Object.keys(finalInventory.files).some(name => !same(finalInventory.files[name], inventory.files[name]) && !coveredFiles.has(name))) {
        failCoverage(`Salesforce ${key} baseline differs outside reviewed manifest coverage.`);
      }
      if (components.some(({ files }) => files.some(name => inventory.files[name]) && files.some(name => !inventory.files[name]))) {
        failCoverage(`Salesforce ${key} baseline has a partially present reviewed component.`);
      }
    }
  }
  const testPlan = review.testPlan;
  if (!['RunLocalTests', 'RunSpecifiedTests', 'RunRelevantTests'].includes(testPlan?.level)
    || !Number.isSafeInteger(testPlan.minimumTests) || testPlan.minimumTests < 1
    || !Array.isArray(testPlan.tests) || (testPlan.level === 'RunSpecifiedTests' && !testPlan.tests.length)
    || testPlan.tests.some(name => !/^[A-Za-z][A-Za-z0-9_]*$/u.test(name))) throw new Error('A reviewed positive test execution plan is required.');
  const permissions = review.permissionSets || [];
  if (!Array.isArray(permissions) || permissions.some(name => !manifest.includes(`PermissionSet:${name}`)) || permissions.length !== new Set(permissions).size) throw new Error('Permissions must be explicitly scoped to PermissionSet components in the manifest.');
  const bootstrap = review.bootstrap || null;
  if (bootstrap) {
    if (!bootstrapBytes || hash(bootstrapBytes) !== bootstrap.sha256 || !same(parseReviewedPackage(bootstrapBytes.toString('utf8')), sorted(bootstrap.components || []))
      || bootstrap.components.some(id => !manifest.includes(id) || !/^(CustomObject|CustomField|PermissionSet):/u.test(id))
      || !same(sorted(bootstrap.permissionSets || []), sorted(permissions.filter(name => bootstrap.components.includes(`PermissionSet:${name}`))))) throw new Error('Bootstrap must contain only reviewed schema/permission components from the main manifest.');
    if (testPlan.level !== 'RunLocalTests') throw new Error('A schema bootstrap requires one complete RunLocalTests validation per environment.');
  } else if (bootstrapBytes) throw new Error('Unreviewed bootstrap bytes supplied.');
  assertNativeSerializationAllowances(review, components);
  if (review.nativeInventoryContext !== undefined && (!review.bootstrap || review.nativeInventories === undefined)) {
    failCoverage('Native inventory context requires reviewed bootstrap checkpoints.');
  }
  const nativeInventories = review.bootstrap && review.nativeInventories !== undefined
    ? reviewedNativeBootstrapInventories(review, policy, baselineInventory, orgBaselineInventories, finalInventory, components)
    : reviewedNativeInventories(review, policy, baselineInventory, finalInventory, components, coveredFiles);
  const baselineJobs = baselineMode === COMPLETE_DEPLOYMENT_BASELINE_MODE ? {} : null;
  for (const environment of baselineJobs ? policy.environments : []) {
    const record = baselineWorkflow.environments?.[environment.key];
    if (record?.orgId !== environment.orgId || record?.alias !== environment.alias || record?.isSandbox !== environment.isSandbox
      || record?.username !== (environment.username || null)) failCoverage(`Baseline ${environment.key} identity mismatch.`);
    for (const [operation, checkOnly] of [['validation', true], ['deployment', false]]) {
      const job = record[operation];
      if (!JOB_ID.test(job?.jobId || '') || job.status !== 'Succeeded' || job.checkOnly !== checkOnly || job.testLevel !== 'RunLocalTests'
        || job.sourceTreeHash !== baselineInventory.sourceTreeHash || job.releaseMode !== baselineWorkflow.releaseMode
        || job.deploymentScope !== baselineWorkflow.sourceScope || !Number.isFinite(Date.parse(job.completedAt))) failCoverage(`Baseline ${environment.key} ${operation} is not verified complete-tree evidence.`);
    }
    if (record.deployment.validationJobId !== record.validation.jobId) failCoverage(`Baseline ${environment.key} deployment is not bound to its validation.`);
    baselineJobs[environment.key] = { validationJobId: record.validation.jobId, deploymentJobId: record.deployment.jobId };
  }
  const binding = {
    releaseMode: REVIEWED_SALESFORCE_MODE, manifestSha256: hash(manifestBytes), reviewSha256: hash(review),
    bootstrapSha256: bootstrap ? hash(bootstrapBytes) : null, sourceTreeHash: finalInventory.sourceTreeHash,
    finalInventoryHash: finalInventory.inventoryHash, baselineSourceTreeHash: baselineInventory.sourceTreeHash,
    baselineInventoryHash: baselineInventory.inventoryHash, baselineCommit: review.baselineCommit,
    baselineMode, baselineJobs, configurationSha256: hash(policy), testPlan, permissionSets: permissions,
    orgIds: Object.fromEntries(policy.environments.map(({ key, orgId }) => [key, orgId])),
    ...(orgBaselines ? { orgBaselines } : {}),
  };
  return { fingerprint: hash(binding), binding, review, manifest, changedFiles: changed, finalInventory,
    baselineInventory, orgBaselineInventories, nativeInventories, baselineWorkflow };
}

export function reviewedJobExpectations(plan, environment, operation) {
  const bootstrap = operation === 'bootstrap';
  return {
    validation: operation === 'validation', bootstrap,
    testPlan: bootstrap ? { level: environment.isSandbox ? 'NoTestRun' : 'RunRelevantTests', tests: [], minimumTests: 1 } : plan.binding.testPlan,
    expectedComponents: bootstrap ? plan.review.bootstrap.components : plan.manifest,
  };
}

export function assertReviewedJobReport(report, { environment, jobId, validation = false, testPlan, bootstrap = false, expectedComponents = [], quickValidation }) {
  const proof = assertSuccessfulSalesforceReport(report, { environment, jobId, validation });
  if (!JOB_ID.test(jobId) || Number(report.numberComponentsDeployed) !== Number(report.numberComponentsTotal) || Number(report.numberComponentsTotal) < 1) throw new Error('Salesforce report did not prove all reviewed components deployed.');
  if (expectedComponents.length) {
    const successes = report.details?.componentSuccesses;
    const actual = new Set((Array.isArray(successes) ? successes : successes ? [successes] : []).filter(entry => entry.success === true)
      .map(entry => `${entry.componentType}:${entry.fullName}`));
    if (expectedComponents.some(id => !actual.has(id))) throw new Error('Actual Salesforce report is missing reviewed manifest component coverage.');
  }
  const total = Number(report.numberTestsTotal), completed = Number(report.numberTestsCompleted);
  if (!validation && !bootstrap && total === 0 && completed === 0) {
    if (report.details?.runTestResult?.codeCoverageWarnings?.length) throw new Error('Salesforce coverage warnings require review before promotion.');
    const validationId = quickValidation?.id;
    if (!JOB_ID.test(validationId || '') || validationId === jobId) throw new Error('Zero-test quick deployment requires its exact successful validation.');
    const linked = assertReviewedJobReport(quickValidation.report, {
      environment, jobId: validationId, validation: true, testPlan, expectedComponents,
    });
    if (!(Date.parse(linked.completedAt) <= Date.parse(report.completedDate))) throw new Error('Quick deployment predates its validation.');
    return { ...proof, testPlan, apexTestProof: true, testExecution: 'verified-linked-apex-tests',
      validationJobId: validationId, validationReportSha256: linked.reportSha256,
      reportSha256: hash(report), completedAt: report.completedDate };
  }
  const schemaBootstrap = bootstrap && !validation && expectedComponents.length > 0
    && expectedComponents.every(id => /^(CustomObject|CustomField|PermissionSet):/u.test(id))
    && testPlan.level === (environment.isSandbox ? 'NoTestRun' : 'RunRelevantTests');
  if (bootstrap && !schemaBootstrap) throw new Error('Zero-test bootstrap evidence requires the exact reviewed schema/permission intent and environment test level.');
  if (schemaBootstrap) {
    const successes = report.details?.componentSuccesses;
    if ((Array.isArray(successes) ? successes : [successes]).some(entry => !['CustomObject', 'CustomField', 'PermissionSet', 'Package'].includes(entry?.componentType))) throw new Error('Schema-only bootstrap report contains an unexpected non-schema component.');
    if (!Number.isSafeInteger(total) || total < 0 || completed !== total || (environment.isSandbox && total !== 0)) throw new Error('Schema bootstrap test counts do not match its reviewed test intent.');
  } else {
    if (!['RunLocalTests', 'RunSpecifiedTests', 'RunRelevantTests'].includes(testPlan.level)) throw new Error('NoTestRun is confined to reviewed sandbox schema bootstrap.');
    if (total < testPlan.minimumTests || completed !== total || !Number.isFinite(total)) throw new Error('Salesforce report did not prove the requested positive test execution.');
    if (testPlan.level === 'RunSpecifiedTests') {
      const successes = report.details?.runTestResult?.successes;
      const names = new Set((Array.isArray(successes) ? successes : successes ? [successes] : []).map(entry => entry.name));
      if (testPlan.tests.some(name => !names.has(name))) throw new Error('Specified Salesforce tests are absent from the actual successful report.');
    }
    if (report.details?.runTestResult?.codeCoverageWarnings?.length) throw new Error('Salesforce coverage warnings require review before promotion.');
  }
  return { ...proof, testPlan, apexTestProof: !schemaBootstrap, testExecution: schemaBootstrap ? 'schema-only-bootstrap' : 'verified-positive-apex-tests',
    reportSha256: hash(report), completedAt: report.completedDate || null };
}

export async function verifyReviewedJobPair({ provider, environment, validationJobId, deploymentJobId, testPlan, expectedComponents }) {
  const validationReport = await provider.report(environment, validationJobId);
  assertReviewedJobReport(validationReport, { environment, jobId: validationJobId, validation: true, testPlan, expectedComponents });
  return assertReviewedJobReport(await provider.report(environment, deploymentJobId), {
    environment, jobId: deploymentJobId, testPlan, expectedComponents,
    quickValidation: { id: validationJobId, report: validationReport },
  });
}

export async function verifyReviewedOrgInventory({ provider, environment, plan, expected, now = () => new Date() }) {
  if (typeof provider.verifyInventory !== 'function') throw new Error('Current Salesforce org inventory verification is required; a historical successful deployment is not current baseline proof.');
  const receipt = await provider.verifyInventory(environment, { plan, expectedInventory: expected.files,
    expectedSourceTreeHash: expected.sourceTreeHash || null, expectedInventoryHash: expected.inventoryHash,
    expectedAbsentComponents: expected.absentComponents || [],
    ...(expected.nativeExport ? { nativeExport: true, verifyApexProjection: expected.verifyApexProjection === true } : {}),
    ...(expected.nativeBootstrap ? { nativeBootstrap: true, projectionPaths: expected.projectionPaths,
      ...(expected.projectedNativeInventory ? { projectedNativeInventory: true } : {}) } : {}) });
  const verifiedAt = Date.parse(receipt?.verifiedAt);
  if (receipt?.orgId !== environment.orgId || receipt?.sourceTreeHash !== (expected.sourceTreeHash || null)
    || receipt?.inventoryHash !== expected.inventoryHash || !HASH.test(receipt?.evidenceSha256 || '')
    || !(verifiedAt >= now().getTime() - 300000 && verifiedAt <= now().getTime() + 30000)) throw new Error('Current Salesforce org inventory receipt is absent, stale, or differs from the verified baseline/derived tree.');
  if (plan.binding.baselineMode === INVENTORY_BASELINE_MODE) {
    const identity = receipt.identity, files = receipt.observedInventory;
    const observed = files && typeof files === 'object' && !Array.isArray(files) ? Object.fromEntries(Object.entries(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([name, value]) => [name, { sha256: value?.sha256, size: value?.size }])) : null;
    const method = expected.nativeExport ? 'metadata-api-reviewed-native-byte-inventory' : 'metadata-api-owned-tree-inventory';
    const permissionSets = (expected.projectionPaths || []).flatMap(name => {
      const permission = /^permissionsets\/([A-Za-z][A-Za-z0-9_]*)\.permissionset-meta\.xml$/u.exec(name);
      return permission ? [permission[1]] : [];
    }).sort();
    const inventoryMatches = expected.projectedNativeInventory
      ? matchesProjectedNativeInventory(observed, expected.files, expected.projectionPaths)
        && receipt.observedNativeInventoryHash === hash(observed)
      : Boolean(observed) && same(observed, expected.files) && hash(observed) === expected.inventoryHash;
    if (receipt.verificationMethod !== method || receipt.scope !== 'force-app/main/default'
      || (expected.nativeExport && !HASH.test(receipt.nativeSourceTreeHash || ''))
      || (expected.verifyApexProjection && receipt.apexProjectionVerified !== true)
      || (expected.nativeBootstrap && !same(receipt.verifiedProjectionPaths, expected.projectionPaths))
      || identity?.alias !== environment.alias || identity?.orgId !== environment.orgId || identity?.isSandbox !== environment.isSandbox
      || identity?.connectedStatus !== 'Connected' || !String(identity?.username || '').trim() || (environment.username && identity.username !== environment.username)
      || !inventoryMatches) throw new Error('Inventory baseline requires current native owned-tree file evidence and the pinned org identity; hashes or caller booleans alone are insufficient.');
    if (permissionSets.length && (!same(receipt.permissionSets, permissionSets) || !HASH.test(receipt.permissionGrantEvidenceSha256 || ''))) {
      throw new Error('Current Salesforce inventory lacks exact native PermissionSet grant evidence.');
    }
    if (expected.absentComponents?.length && (!same(receipt.absentComponents, expected.absentComponents)
      || receipt.absenceVerificationMethod !== 'native-metadata-catalog' || !HASH.test(receipt.absenceEvidenceSha256 || ''))) {
      throw new Error('Current Salesforce inventory lacks native evidence for the exact absent reviewed components.');
    }
  }
  return receipt;
}

export function reviewedCheckpointInventory(plan, stage = {}, environmentKey) {
  const native = plan.nativeInventories?.[environmentKey];
  if (native) {
    if (stage.deployment?.status === 'Succeeded') return native.final;
    if (stage.bootstrap?.status === 'Succeeded' && native.bootstrap) return native.bootstrap;
    return native.baseline;
  }
  if (stage.deployment?.status === 'Succeeded') return plan.finalInventory;
  const baseline = plan.orgBaselineInventories ? plan.orgBaselineInventories[environmentKey] : plan.baselineInventory;
  if (!baseline) throw new Error('Salesforce inventory checkpoint requires the pinned org baseline.');
  let checkpoint = baseline;
  if (plan.review.bootstrap && stage.bootstrap?.status === 'Succeeded') {
    const files = plan.review.components.filter(({ id }) => plan.review.bootstrap.components.includes(id)).flatMap(({ files }) => files);
    const inventory = Object.fromEntries(Object.entries({ ...baseline.files,
      ...Object.fromEntries(files.map(name => [name, plan.finalInventory.files[name]])) }).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
    checkpoint = { files: inventory, inventoryHash: hash(inventory) };
  }
  if (!plan.orgBaselineInventories) return checkpoint;
  const absentComponents = plan.review.components.filter(({ files }) => files.every(name => !checkpoint.files[name])).map(({ id }) => id);
  return { ...checkpoint, absentComponents: sorted(absentComponents) };
}

export function assertProductionAuthorization(authorization, plan, now = new Date()) {
  if (authorization?.productionMutation !== true || authorization.fingerprint !== plan.fingerprint
    || authorization.manifestSha256 !== plan.binding.manifestSha256 || authorization.sourceTreeHash !== plan.binding.sourceTreeHash
    || !same(authorization.orgIds, plan.binding.orgIds) || !String(authorization.authorizedBy || '').trim()
    || !String(authorization.evidence || '').trim() || !(Date.parse(authorization.expiresAt) > now.getTime())) throw new Error('Production mutation requires unexpired exact fingerprint/manifest/source/org authorization.');
  return hash(authorization);
}

function assertMirror(result, plan, policy, deploymentJobId) {
  const pr = result?.pullRequest;
  if (result?.releaseMode !== REVIEWED_SALESFORCE_MODE || result?.sourceTreeHash !== plan.binding.sourceTreeHash
    || result?.sourceEnvironment !== 'devee' || result?.sourceDeploymentJobId !== deploymentJobId
    || result?.repository !== policy.publication.repository || result?.account !== policy.publication.requiredAccount
    || pr?.state !== 'OPEN' || pr?.isDraft !== true || !Number.isSafeInteger(pr?.number) || pr.number < 1
    || pr.baseRefName !== policy.publication.defaultBranch || pr.headRefName !== result.branch
    || pr.headRefOid !== result.commit || !/^[a-f0-9]{40}$/u.test(result.commit || '')) throw new Error('Shared mirror must be byte-verified at the exact open draft PR head for the derived DEVEE source proof.');
  return result;
}

/**
 * Provider interface is intentionally injected for offline qualification. Each write requires
 * ownership.assert({fingerprint,stage,orgId,operation}) -> an unexpired concrete receipt;
 * journal.checkpoint({fingerprint,stage,operation,record}) is awaited after the fsynced local
 * journal and before submission. Local locks serialize this host only, never other machines.
 * An uncertain submission is reconciled by an owner-supplied job ID, never blind resubmission.
 */
export async function runReviewedSalesforceRelease({ plan, mode, policy, journal, provider, ownership, externalJournal,
  authorization = null, now = () => new Date(), assertUnchanged, replaceValidation = [], reconcile = {} }) {
  if (!['prepare', 'apply'].includes(mode)) throw new Error('Choose prepare or apply.');
  if (journal.state.fingerprint !== plan.fingerprint || !same(journal.state.binding, plan.binding)) throw new Error('Reviewed workflow fingerprint changed; prepare a new release from DEVEE.');
  if (typeof ownership?.assert !== 'function' || typeof externalJournal?.checkpoint !== 'function') throw new Error('Salesforce writes require external release ownership and a durable checkpoint adapter; a local lock is not global serialization.');
  const timestamp = () => now().toISOString();
  const checkpoint = (stage, operation, record) => externalJournal.checkpoint({ fingerprint: plan.fingerprint, stage, operation, record });
  const persist = async (stage, operation, record) => {
    const saved = journal.update(stage, operation, record);
    await checkpoint(stage, operation, saved);
    return saved;
  };
  const get = (stage, operation) => journal.state.stages[stage]?.[operation];
  const unchanged = async () => { await assertUnchanged(); };
  const writeGate = async (environment, operation) => {
    await unchanged(); await provider.verifyIdentity(environment);
    const authHash = environment.key === 'production' && operation !== 'validation' ? assertProductionAuthorization(authorization, plan, now()) : null;
    const receipt = await ownership.assert({ fingerprint: plan.fingerprint, stage: environment.key, orgId: environment.orgId, operation });
    if (!receipt?.receiptId || receipt.fingerprint !== plan.fingerprint || receipt.orgId !== environment.orgId
      || receipt.stage !== environment.key || receipt.operation !== operation || !(Date.parse(receipt.expiresAt) > now().getTime())) throw new Error('External Salesforce release ownership receipt is absent, expired, or mismatched.');
    return { receiptId: receipt.receiptId, receiptExpiresAt: receipt.expiresAt, authorizationSha256: authHash };
  };
  const validatedReports = new Map();
  const reportJob = async (environment, operation, record) => {
    await unchanged(); await provider.verifyIdentity(environment);
    const report = await provider.report(environment, record.jobId);
    const status = String(report?.status || 'Unknown');
    if (status !== 'Succeeded') {
      await persist(environment.key, operation, { ...record, status, verifiedAt: timestamp(), actualReportSha256: hash(report) });
      throw new Error(`${environment.label} ${operation} is ${status}; saved job must be reconciled before progression.`);
    }
    let quickValidation;
    if (operation === 'deployment' && Number(report.numberTestsTotal) === 0) {
      const validation = get(environment.key, 'validation');
      if (!validation || validation.jobId !== record.validationJobId || validation.status !== 'Succeeded'
        || validation.fingerprint !== plan.fingerprint || validation.orgId !== environment.orgId) {
        throw new Error('Quick deployment lacks its bound successful validation checkpoint.');
      }
      quickValidation = { id: validation.jobId,
        report: validatedReports.get(`${environment.orgId}:${validation.jobId}`) || await provider.report(environment, validation.jobId) };
    }
    const proof = assertReviewedJobReport(report, {
      environment, jobId: record.jobId, ...reviewedJobExpectations(plan, environment, operation), quickValidation,
    });
    if (operation === 'validation') validatedReports.set(`${environment.orgId}:${record.jobId}`, report);
    await unchanged();
    return persist(environment.key, operation, { ...record, ...proof, status: 'Succeeded',
      completedAt: record.completedAt || proof.completedAt || timestamp(), verifiedAt: timestamp() });
  };
  async function verifyRecoveredJob(environment, operation, jobId, { submittedAt, validationJobId, packageSha256 }) {
    if (typeof provider.reconcile !== 'function') throw new Error('A recovered job requires provider source/test-plan readback before adoption.');
    const adoption = await provider.reconcile(environment, jobId, { plan, operation, submittedAt, validationJobId, packageSha256 });
    const verifiedAt = Date.parse(adoption?.verifiedAt);
    if (adoption?.fingerprint !== plan.fingerprint || adoption?.orgId !== environment.orgId || adoption?.jobId !== jobId
      || adoption?.operation !== operation || adoption?.sourceTreeHash !== plan.binding.sourceTreeHash || adoption?.manifestSha256 !== plan.binding.manifestSha256
      || !HASH.test(adoption?.evidenceSha256 || '') || !(verifiedAt >= now().getTime() - 300000 && verifiedAt <= now().getTime() + 30000)) {
      throw new Error('Recovered Salesforce job readback does not bind the reviewed source, org, operation, and manifest.');
    }
  }
  const recoveredPermissions = new Set();
  if (typeof externalJournal.readCheckpoints === 'function') {
    const missing = [];
    const missingPermissions = [];
    let missingMirror, savedPreparation;
    for (const entry of await externalJournal.readCheckpoints()) {
      if (entry.fingerprint !== plan.fingerprint) throw new Error('Durable Salesforce checkpoint does not match the reviewed fingerprint.');
      if (entry.stage === 'production' && entry.operation === 'preparation' && entry.outcome === 'evidence') {
        savedPreparation = entry;
      }
      if (!['pending', 'resolved'].includes(entry.outcome)) continue;
      const local = get(entry.stage, entry.operation);
      if (local && digestCheckpoint(local) === entry.evidenceDigest) continue;
      if (!local && entry.stage === 'shared_mirror' && entry.operation === 'publication'
        && entry.outcome === 'resolved' && /^[a-f0-9]{40}$/u.test(entry.mirror?.commit || '')
        && Number.isSafeInteger(entry.mirror.pullRequest) && entry.mirror.pullRequest > 0) {
        missingMirror = entry.mirror;
        continue;
      }
      const environment = policy.environments.find(item => item.key === entry.stage);
      const permission = entry.permission;
      if (environment && entry.outcome === 'resolved' && permission
        && entry.operation === `permission:${permission.name}` && plan.binding.permissionSets.includes(permission.name)
        && permission.orgId === environment.orgId && typeof permission.prestate === 'boolean'
        && HASH.test(entry.evidenceDigest || '') && (!local || matchesSalesforceCheckpoint(local, entry))) {
        missingPermissions.push({ entry, environment, permission, local });
        continue;
      }
      const locator = entry.job;
      if (local || !environment || typeof provider.reconcile !== 'function'
        || !['validation', 'deployment', 'bootstrap'].includes(entry.operation) || !JOB_ID.test(locator?.id || '')
        || (locator.packageSha256 !== undefined && (entry.operation === 'deployment' || !HASH.test(locator.packageSha256)))
        || !Number.isFinite(Date.parse(locator.submittedAt))
        || (entry.operation === 'deployment' ? !JOB_ID.test(locator.validationId || '') : locator.validationId !== null)) {
        throw new Error('Durable Salesforce operation differs from local state; reconcile the original checkpoint before continuing.');
      }
      missing.push({ entry, environment, locator });
    }
    for (const { entry, environment, permission, local } of missingPermissions) {
      await unchanged();
      await provider.verifyIdentity(environment);
      if (await provider.permissionAssigned(environment, permission.name) !== true) {
        throw new Error('A previously verified permission assignment drifted.');
      }
      await unchanged();
      if (!local) {
        const { name, orgId, prestate } = permission;
        journal.update(entry.stage, entry.operation, { name, orgId, prestate, status: 'Succeeded',
          addedByRelease: !prestate, recoveredEvidenceDigest: entry.evidenceDigest, verifiedAt: timestamp() });
      }
      // The original resolved checkpoint remains the durable receipt for this assignment.
      recoveredPermissions.add(`${entry.stage}:${entry.operation}`);
    }
    for (const { entry, environment, locator } of missing) {
      const record = { fingerprint: plan.fingerprint, orgId: environment.orgId, jobId: locator.id,
        validationJobId: locator.validationId, submittedAt: locator.submittedAt, reconciledAt: timestamp(),
        ...(locator.packageSha256 ? { packageSha256: locator.packageSha256 } : {}) };
      await unchanged();
      await provider.verifyIdentity(environment);
      await verifyRecoveredJob(environment, entry.operation, record.jobId, record);
      await reportJob(environment, entry.operation, record);
    }
    if (missingMirror) await mirror(missingMirror);
    if (mode === 'apply' && !get('production', 'preparation')
      && get('devee', 'deployment')?.status === 'Succeeded' && get('qat', 'deployment')?.status === 'Succeeded'
      && get('shared_mirror', 'publication')?.status === 'Succeeded') {
      const validationJobId = savedPreparation?.preparation?.validationJobId;
      const ready = JOB_ID.test(validationJobId || '') && get('production', 'validation')?.jobId === validationJobId
        && get('production', 'validation')?.status === 'Succeeded'
        && (!plan.review.bootstrap || get('production', 'bootstrap')?.status === 'Succeeded');
      const deferred = { status: 'awaiting-authorized-bootstrap', fingerprint: plan.fingerprint,
        bootstrapSha256: plan.binding.bootstrapSha256 };
      const originalRecordedAt = savedPreparation?.preparation?.recordedAt;
      const awaiting = plan.review.bootstrap && savedPreparation?.preparation?.status === deferred.status
        && savedPreparation.preparation.bootstrapSha256 === deferred.bootstrapSha256
        && Number.isFinite(Date.parse(originalRecordedAt))
        && new Date(originalRecordedAt).toISOString() === originalRecordedAt
        && savedPreparation.evidenceDigest === digestCheckpoint({ ...deferred, recordedAt: originalRecordedAt });
      if (ready || awaiting) {
        assertProductionAuthorization(authorization, plan, now());
        if (ready) await persist('production', 'preparation', { status: 'ready', fingerprint: plan.fingerprint, validationJobId });
        else journal.update('production', 'preparation', { ...deferred, originalRecordedAt, recoveredEvidenceDigest: savedPreparation.evidenceDigest });
      }
    }
  }
  const preparation = get('production', 'preparation');
  if (mode === 'apply' && (preparation?.fingerprint !== plan.fingerprint || !['ready', 'awaiting-authorized-bootstrap'].includes(preparation?.status))) {
    throw new Error('Apply requires a successful prepare checkpoint for this exact unchanged reviewed fingerprint.');
  }
  async function job(environment, operation, submit, { validationJobId = null, prepare } = {}) {
    await unchanged();
    let record = get(environment.key, operation);
    if (record?.status === 'submitting' && !record.jobId) {
      const recoveredId = reconcile[`${environment.key}.${operation}`];
      if (!JOB_ID.test(recoveredId || '')) throw new Error(`${environment.label} ${operation} has an uncertain submission without an ID; owner readback/reconciliation is required. No duplicate was submitted.`);
      await verifyRecoveredJob(environment, operation, recoveredId, { ...record, validationJobId });
      record = await persist(environment.key, operation, { ...record, jobId: recoveredId, status: 'Submitted', reconciledAt: timestamp() });
    }
    if (record?.jobId) {
      if (record.fingerprint !== plan.fingerprint || record.orgId !== environment.orgId || record.validationJobId !== validationJobId) throw new Error('Saved Salesforce job binding changed.');
      const replacement = operation === 'validation' && replaceValidation.includes(environment.key);
      if (replacement) {
        if (get(environment.key, 'deployment')) throw new Error('Cannot replace a validation after deployment submission.');
        const downstream = policy.environments.slice(policy.environments.indexOf(environment) + 1);
        if (downstream.some(next => Object.values(journal.state.stages[next.key] || {}).some(saved => saved?.jobId))) throw new Error('Validation replacement is permitted only at the current unfinished stage.');
        await provider.verifyIdentity(environment);
        const actual = await provider.report(environment, record.jobId);
        const expiredSuccess = actual.status === 'Succeeded' && Date.parse(actual.completedDate) + 10 * 86400000 <= now().getTime();
        if (!TERMINAL.has(actual.status) && !expiredSuccess) throw new Error('Replacement requires a confirmed failed/canceled/expired current-stage validation.');
        await persist(environment.key, operation, { ...record, status: expiredSuccess ? 'Expired' : actual.status, verifiedAt: timestamp(), actualReportSha256: hash(actual) });
      } else return reportJob(environment, operation, record);
    }
    const prepared = await prepare?.();
    try {
      if (prepared?.packageSha256 !== undefined && !HASH.test(prepared.packageSha256)) throw new Error('Invalid reviewed Salesforce package digest.');
      const gate = await writeGate(environment, operation);
      const previous = get(environment.key, operation);
      const attempts = previous ? [...(previous.attempts || []), { ...previous, attempts: undefined }] : [];
      record = await persist(environment.key, operation, { fingerprint: plan.fingerprint, orgId: environment.orgId,
        status: 'submitting', jobId: null, validationJobId, submittedAt: timestamp(), attempts, ...gate,
        ...(prepared?.packageSha256 ? { packageSha256: prepared.packageSha256 } : {}) });
      await unchanged();
      if (!(Date.parse(gate.receiptExpiresAt) > now().getTime())) throw new Error('Salesforce ownership expired while saving intent; reconcile the saved intent before retry.');
      if (environment.key === 'production' && operation !== 'validation') assertProductionAuthorization(authorization, plan, now());
      // Persist intent before calling the provider. A thrown/invalid response stays uncertain.
      const submitted = await (prepared ? prepared.submit() : submit());
      if (!JOB_ID.test(submitted?.id || '')) throw new Error('Salesforce submission returned no reusable job ID; owner readback/reconciliation is required.');
      record = await persist(environment.key, operation, { ...record, jobId: submitted.id, status: ACTIVE.has(submitted.status) ? submitted.status : 'Submitted' });
    } finally {
      await prepared?.cleanup();
    }
    return reportJob(environment, operation, record);
  }
  const runValidation = environment => job(environment, 'validation', () => provider.validate(environment, plan), {
    prepare: provider.prepareValidation ? () => provider.prepareValidation(environment, plan) : undefined,
  });
  async function permissions(environment, names) {
    for (const name of names) {
      const operation = `permission:${name}`;
      let record = get(environment.key, operation);
      await unchanged(); await provider.verifyIdentity(environment);
      const assigned = await provider.permissionAssigned(environment, name);
      if (record?.status === 'Succeeded') {
        if (!assigned) throw new Error('A previously verified permission assignment drifted.');
        if (!recoveredPermissions.has(`${environment.key}:${operation}`)) await checkpoint(environment.key, operation, record);
        continue;
      }
      if (!assigned && record?.status === 'submitting') {
        throw new Error('Permission assignment remains uncertain; reconcile the original submission before retry.');
      }
      if (!record) record = await persist(environment.key, operation, { name, prestate: assigned, status: 'observed', orgId: environment.orgId });
      if (!assigned) {
        const gate = await writeGate(environment, operation);
        record = await persist(environment.key, operation, { ...record, status: 'submitting', ...gate });
        await unchanged();
        if (!(Date.parse(gate.receiptExpiresAt) > now().getTime())) throw new Error('Salesforce ownership expired before permission assignment.');
        if (environment.key === 'production') assertProductionAuthorization(authorization, plan, now());
        await provider.assignPermission(environment, name);
        if (!await provider.permissionAssigned(environment, name)) throw new Error('Permission assignment outcome is uncertain; reconcile before progression.');
      }
      await persist(environment.key, operation, { ...record, status: 'Succeeded', addedByRelease: !record.prestate, verifiedAt: timestamp() });
    }
  }
  async function mirror(original = null) {
    await unchanged();
    const deployment = get('devee', 'deployment');
    if (deployment?.status !== 'Succeeded') throw new Error('Verified DEVEE deployment is required before the complete derived source mirror.');
    let saved = get('shared_mirror', 'publication');
    const action = saved || original ? 'check' : 'publish';
    if (action === 'publish') {
      const gate = await writeGate(policy.environments[0], 'shared-publication');
      saved = await persist('shared_mirror', 'publication', { status: 'submitting', ...gate });
      if (!(Date.parse(saved.receiptExpiresAt) > now().getTime())) throw new Error('Salesforce mirror ownership expired while saving intent; reconcile the saved intent before retry.');
    }
    const result = assertMirror(await provider.mirror(action, { plan, journalFile: journal.file, deveeDeployment: deployment }), plan, policy, deployment.jobId);
    if (original && (result.commit !== original.commit || result.pullRequest.number !== original.pullRequest)) {
      throw new Error('Shared mirror readback differs from the original durable publication.');
    }
    await unchanged();
    await persist('shared_mirror', 'publication', { ...saved, status: 'Succeeded', result, verifiedAt: timestamp() });
    return result;
  }
  try {
    // Complete deployment evidence remains distinct. Inventory baselines never reread historical jobs.
    for (const environment of policy.environments) {
      await provider.verifyIdentity(environment);
      const baseline = plan.binding.baselineJobs?.[environment.key];
      if (!baseline) continue;
      const testPlan = { level: 'RunLocalTests', tests: [], minimumTests: 1 };
      await verifyReviewedJobPair({ provider, environment, ...baseline, testPlan });
    }
    if (plan.binding.baselineMode === INVENTORY_BASELINE_MODE) {
      // Verify EVERY org's actual current checkpoint before the first metadata/permission write.
      for (const environment of policy.environments) {
        const saved = journal.state.stages[environment.key] || {};
        for (const operation of ['bootstrap', 'deployment']) if (saved[operation] && saved[operation].status !== 'Succeeded') {
          await job(environment, operation, () => { throw new Error('Inventory preflight cannot submit an unresolved operation.'); },
            { validationJobId: operation === 'deployment' ? saved.validation?.jobId || null : null });
        }
        const expected = reviewedCheckpointInventory(plan, journal.state.stages[environment.key], environment.key);
        const receipt = await verifyReviewedOrgInventory({ provider, environment, plan, expected, now });
        await persist(environment.key, 'inventory-checkpoint', { baselineMode: INVENTORY_BASELINE_MODE, orgId: environment.orgId,
          inventoryHash: receipt.inventoryHash, sourceTreeHash: receipt.sourceTreeHash, verifiedAt: receipt.verifiedAt,
          evidenceSha256: receipt.evidenceSha256, ...(expected.nativeExport ? { nativeSourceTreeHash: receipt.nativeSourceTreeHash,
            verificationMethod: receipt.verificationMethod, apexProjectionVerified: receipt.apexProjectionVerified,
            ...(expected.nativeBootstrap ? { verifiedProjectionPaths: receipt.verifiedProjectionPaths } : {}),
            ...(expected.projectedNativeInventory ? { observedNativeInventoryHash: receipt.observedNativeInventoryHash } : {}) } : {}) });
      }
    }
    for (const environment of policy.environments) {
      if (environment.key !== 'devee') await mirror();
      const stage = journal.state.stages[environment.key] || {};
      const baseline = reviewedCheckpointInventory(plan, {}, environment.key);
      // Successful upstream jobs are reattested, preserving original completedAt and IDs.
      if (stage.deployment) {
        if (!stage.validation) throw new Error('Deployment lacks its saved successful validation.');
        const validation = await runValidation(environment);
        await job(environment, 'deployment', () => provider.deploy(environment, validation.jobId, plan), { validationJobId: validation.jobId });
        await verifyReviewedOrgInventory({ provider, environment, plan,
          expected: reviewedCheckpointInventory(plan, { deployment: { status: 'Succeeded' } }, environment.key), now });
        await permissions(environment, plan.binding.permissionSets);
        continue;
      }
      if (environment.key === 'production' && mode === 'prepare' && plan.review.bootstrap && stage.bootstrap?.status !== 'Succeeded') {
        await verifyReviewedOrgInventory({ provider, environment, plan, expected: baseline, now });
        await persist('production', 'preparation', { status: 'awaiting-authorized-bootstrap', fingerprint: plan.fingerprint,
          bootstrapSha256: plan.binding.bootstrapSha256 });
        return { mode: 'prepared', productionValidation: 'deferred-until-authorized-bootstrap', fingerprint: plan.fingerprint, journal: journal.file };
      }
      let predeploymentInventory = baseline;
      if (plan.review.bootstrap) {
        if (!stage.bootstrap) await verifyReviewedOrgInventory({ provider, environment, plan, expected: baseline, now });
        await job(environment, 'bootstrap', () => provider.bootstrap(environment, plan), {
          prepare: provider.prepareBootstrap ? () => provider.prepareBootstrap(environment, plan) : undefined,
        });
        predeploymentInventory = reviewedCheckpointInventory(plan, journal.state.stages[environment.key], environment.key);
        await verifyReviewedOrgInventory({ provider, environment, plan, expected: predeploymentInventory, now });
        await permissions(environment, plan.review.bootstrap.permissionSets || []);
      } else await verifyReviewedOrgInventory({ provider, environment, plan, expected: baseline, now });
      const validation = await runValidation(environment);
      if (environment.key === 'production' && mode === 'prepare') {
        await persist('production', 'preparation', { status: 'ready', fingerprint: plan.fingerprint, validationJobId: validation.jobId });
        return { mode: 'prepared', productionValidation: 'Succeeded', fingerprint: plan.fingerprint, journal: journal.file };
      }
      // Validation may run for hours; refresh unchanged metadata before consuming its job.
      await verifyReviewedOrgInventory({ provider, environment, plan, expected: predeploymentInventory, now });
      await job(environment, 'deployment', () => provider.deploy(environment, validation.jobId, plan), { validationJobId: validation.jobId });
      await verifyReviewedOrgInventory({ provider, environment, plan,
        expected: reviewedCheckpointInventory(plan, { deployment: { status: 'Succeeded' } }, environment.key), now });
      await permissions(environment, plan.binding.permissionSets);
    }
    await mirror();
    return { mode: 'applied', fingerprint: plan.fingerprint, journal: journal.file };
  } catch (error) {
    // This is a reviewable restoration checkpoint, not a destructive automatic rollback.
    const restoration = [...policy.environments].reverse().filter(environment => get(environment.key, 'deployment') || get(environment.key, 'bootstrap'))
      .map(environment => ({ environment: environment.key, orgId: environment.orgId, baseline: plan.binding.baselineJobs?.[environment.key]
        || plan.binding.orgBaselines?.[environment.key]
        || { mode: INVENTORY_BASELINE_MODE, commit: plan.binding.baselineCommit, sourceTreeHash: plan.binding.baselineSourceTreeHash, inventoryHash: plan.binding.baselineInventoryHash },
        metadata: 'Stop promotion; review all-or-none restoration of the known baseline through the required DEVEE/shared/QAT/Production controls.',
        permissions: plan.binding.permissionSets.filter(name => get(environment.key, `permission:${name}`)?.prestate === false) }));
    try { await persist('production', 'restoration-checkpoint', { status: 'review-required', fingerprint: plan.fingerprint, reverseOrder: restoration }); }
    catch { /* The already-fsynced local state remains authoritative if external journaling failed. */ }
    throw error;
  }
}
