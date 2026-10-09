import { createHash } from 'node:crypto';
import { runtimeCompatibilityScope } from './runtime-compatibility.mjs';

// A new reviewed source requires a new version of this manifest and validator.
// Caller-supplied approval flags cannot extend this exact local source scope.
export const RUNTIME_COMPATIBILITY_SUCCESSOR_MANIFEST_SHA256 = '867ebce63c4b34d0a73bbcbe0749a620f912e8a13c6484da269fda3850a9f432';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const objectId = (type, bytes) => createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');
const equal = (actual, expected, message) => {
  if (actual !== expected) throw new Error(message);
};
const bytes = value => {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array) && typeof value !== 'string') throw new Error('Immutable bytes are required.');
  return Buffer.from(value);
};
const text = value => {
  const data = bytes(value), result = data.toString('utf8');
  if (!Buffer.from(result).equals(data) || result.includes('\r') || !result.endsWith('\n')) throw new Error('Exact LF text with a final newline is required.');
  return result;
};

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error('Independent dispatch transformation baseline differs.');
  return source.replace(before, after);
}

function originalDispatch(source) {
  let result = replaceOnce(source,
    "import { ciModuleAccess, isReadOnlyCiProfile, isReadOnlyMarketAction, requireReadOnlyCiOperation } from '../_readOnlyCiAccess.js';\n",
    "import { ciModuleAccess, isReadOnlyCiProfile, isReadOnlyMarketAction, requireReadOnlyCiOperation } from '../_readOnlyCiAccess.js';\nimport { isReadOnlyHedgeDeskAction } from '../_hedgeDeskReadOnly.js';\n");
  result = replaceOnce(result, "  requireDeploymentMutationAllowed(policy.mutation && name !== 'hedgeMarkets');",
    "  // Mixed handlers classify the authenticated request body at dispatch.\n  requireDeploymentMutationAllowed(policy.mutation && !['hedgeMarkets', 'hedgeDeskEntity'].includes(name));");
  return replaceOnce(result,
    "        requireDeploymentMutationAllowed(handlerPolicy?.mutation && (name !== 'hedgeMarkets' || !isReadOnlyMarketAction(body)));",
    "        requireDeploymentMutationAllowed(handlerPolicy?.mutation && (\n          name === 'hedgeMarkets' ? !isReadOnlyMarketAction(body)\n            : name === 'hedgeDeskEntity' ? !isReadOnlyHedgeDeskAction(body)\n              : true\n        ));");
}

function applicationDispatch(source) {
  let result = replaceOnce(source, "import { requireDeploymentMutationAllowed } from '../_deploymentReadOnly.js';",
    "import { deploymentCapabilities, requireDeploymentMutationAllowed } from '../_deploymentReadOnly.js';");
  result = replaceOnce(result, '  const readOnlyCi = isReadOnlyCiProfile(profile);',
    '  const readOnlyCi = isReadOnlyCiProfile(profile);\n  const deployment = deploymentCapabilities(process.env, { readOnlyProfile: readOnlyCi });');
  result = replaceOnce(result, '  if (!readOnlyCi) schedulePortalOutboxRetry(client);',
    '  if (deployment.mutationsAllowed) schedulePortalOutboxRetry(client);');
  return replaceOnce(result, '    capabilities: capabilityValues,',
    '    capabilities: capabilityValues,\n    deploymentCapabilities: deployment,');
}

// Apply only the pinned ordinary unified text patch, with exact hunk positions
// and context. No fuzzy application, binary patches, renames or mode changes.
function verifyPatch(patch, paths, before, after, readFile) {
  const lines = text(patch).slice(0, -1).split('\n'), seen = [];
  let cursor = 0;
  while (cursor < lines.length) {
    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(lines[cursor++]);
    if (!header || header[1] !== header[2] || !paths.includes(header[1]) || seen.includes(header[1])) throw new Error('Exact patch paths are required.');
    const path = header[1], oldEntry = before.get(path), newEntry = after.get(path);
    seen.push(path);
    if (!oldEntry) equal(lines[cursor++], 'new file mode 100644', 'Exact new-file patch mode is required.');
    if (!/^index [0-9a-f]+\.\.[0-9a-f]+(?: 100644)?$/.test(lines[cursor++])) throw new Error('Exact text patch index is required.');
    equal(lines[cursor++], oldEntry ? `--- a/${path}` : '--- /dev/null', 'Exact patch before path is required.');
    equal(lines[cursor++], `+++ b/${path}`, 'Exact patch after path is required.');
    const original = oldEntry ? text(readFile(oldEntry.sha)).slice(0, -1).split('\n') : [];
    const rebuilt = [];
    let oldPosition = 0, hunks = 0;
    while (cursor < lines.length && !lines[cursor].startsWith('diff --git ')) {
      const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@.*$/.exec(lines[cursor++]);
      if (!hunk) throw new Error('Exact text patch hunk is required.');
      hunks += 1;
      const oldCount = Number(hunk[2] ?? 1), newCount = Number(hunk[4] ?? 1);
      const start = Number(hunk[1]) - (oldCount ? 1 : 0);
      if (start < oldPosition || start > original.length) throw new Error('Patch hunk position differs.');
      rebuilt.push(...original.slice(oldPosition, start));
      oldPosition = start;
      equal(rebuilt.length, Number(hunk[3]) - (newCount ? 1 : 0), 'Patch new hunk position differs.');
      let removed = 0, added = 0;
      while (cursor < lines.length && !lines[cursor].startsWith('@@ ') && !lines[cursor].startsWith('diff --git ')) {
        const line = lines[cursor++], prefix = line[0], content = line.slice(1);
        if (![' ', '-', '+'].includes(prefix)) throw new Error('Unsupported patch content.');
        if (prefix !== '+') {
          equal(original[oldPosition++], content, 'Patch context or removal differs.');
          removed += 1;
        }
        if (prefix !== '-') {
          rebuilt.push(content);
          added += 1;
        }
      }
      equal(removed, oldCount, 'Patch old hunk count differs.');
      equal(added, newCount, 'Patch new hunk count differs.');
    }
    if (!hunks) throw new Error('Patch must have exact text hunks.');
    rebuilt.push(...original.slice(oldPosition));
    equal(`${rebuilt.join('\n')}\n`, text(readFile(newEntry.sha)), 'Approved patch does not reconstruct the immutable after source.');
  }
  equal(JSON.stringify(seen.sort()), JSON.stringify([...paths].sort()), 'Complete approved patch paths are required.');
}

/** Pure local scope check. readObject(type, oid) and readEvidence(artifact) must
 * return bytes; every Git object is authenticated independently. No filesystem,
 * network, environment, approval booleans or provider state are read here.
 * This function is deliberately not installed in any release call site.
 */
export function runtimeCompatibilitySuccessorScope({ candidateCommit, manifestBytes, applicationPatch, controlPatch, readObject, readEvidence }) {
  const manifestBuffer = bytes(manifestBytes);
  equal(digest(manifestBuffer), RUNTIME_COMPATIBILITY_SUCCESSOR_MANIFEST_SHA256, 'Pinned successor manifest differs.');
  const manifest = JSON.parse(manifestBuffer.toString('utf8'));
  equal(candidateCommit, manifest.candidateCommit, 'Only the exact reviewed clean compatibility successor is permitted.');
  if (typeof readObject !== 'function' || typeof readEvidence !== 'function') throw new Error('Immutable object and pinned review evidence readers are required.');
  const objectCache = new Map(), treeCache = new Map();
  const object = (type, oid) => {
    const key = `${type}:${oid}`;
    if (!objectCache.has(key)) {
      const body = bytes(readObject(type, oid));
      equal(objectId(type, body), oid, `Immutable ${type} object identity differs: ${oid}.`);
      objectCache.set(key, body);
    }
    return objectCache.get(key);
  };
  const commit = record => {
    const header = object('commit', record.sha).toString('utf8').split('\n\n', 1)[0].split('\n');
    const trees = header.filter(line => line.startsWith('tree ')).map(line => line.slice(5));
    const parents = header.filter(line => line.startsWith('parent ')).map(line => line.slice(7));
    equal(JSON.stringify(trees), JSON.stringify([record.tree]), 'Exact commit tree differs.');
    equal(JSON.stringify(parents), JSON.stringify(record.parents), 'Exact commit parents differ.');
  };
  const tree = root => {
    if (treeCache.has(root)) return treeCache.get(root);
    const entries = new Map();
    const visit = (oid, prefix = '') => {
      const body = object('tree', oid);
      let position = 0;
      while (position < body.length) {
        const space = body.indexOf(32, position), nul = body.indexOf(0, space + 1);
        if (space < position || nul < space || nul + 21 > body.length) throw new Error('Malformed immutable tree.');
        const mode = body.subarray(position, space).toString('ascii');
        const nameBytes = body.subarray(space + 1, nul), name = nameBytes.toString('utf8');
        if (!Buffer.from(name).equals(nameBytes) || !name || name === '.' || name === '..' || /[\x00-\x1f\x7f/]/.test(name)) throw new Error('Regular immutable tree paths are required.');
        const sha = body.subarray(nul + 1, nul + 21).toString('hex'), path = `${prefix}${name}`;
        position = nul + 21;
        if (mode === '40000') visit(sha, `${path}/`);
        else {
          if (!['100644', '100755'].includes(mode) || entries.has(path)) throw new Error('Regular immutable tree modes and unique paths are required.');
          entries.set(path, { mode, type: 'blob', sha, path });
        }
      }
    };
    visit(root);
    treeCache.set(root, entries);
    return entries;
  };
  for (const record of manifest.commits) commit(record);
  const [baseRecord, originalRecord, appRecord, controlRecord] = manifest.commits;
  const base = tree(baseRecord.tree), original = tree(originalRecord.tree), application = tree(appRecord.tree), controls = tree(controlRecord.tree);
  const file = oid => object('blob', oid);
  // The immutable original module remains the separately imported validator.
  const validator = manifest.originalValidator;
  equal(digest(file(validator.blob)), validator.sha256, 'Original validator source differs.');
  const harnessHeader = object('commit', validator.trustedHarnessCommit).toString('utf8').split('\n\n', 1)[0];
  const harnessTree = /^tree ([0-9a-f]{40})$/m.exec(harnessHeader)?.[1];
  equal(tree(harnessTree).get(validator.path)?.sha, validator.blob, 'Original validator harness binding differs.');
  const historical = runtimeCompatibilityScope({ baseCommit: baseRecord.sha, candidateCommit: originalRecord.sha,
    baseTree: [...base.values()], candidateTree: [...original.values()], readBlob: oid => file(oid).toString('utf8') });
  if (!historical.scopeVerified || historical.readOnlyGuards.length !== 5) throw new Error('Complete original historical guard scope is required.');
  const verifyStage = (before, after, expected) => {
    const changed = [...new Set([...before.keys(), ...after.keys()])].filter(path => {
      const a = before.get(path), b = after.get(path);
      return a?.sha !== b?.sha || a?.mode !== b?.mode;
    }).sort();
    equal(JSON.stringify(changed), JSON.stringify([...expected].sort()), 'Exact stage paths and all unrelated tree entries must be preserved.');
    for (const path of changed) {
      if (after.get(path)?.mode !== '100644' || before.has(path) && before.get(path).mode !== '100644') throw new Error('Exact approved stage file modes are required.');
    }
  };
  const applicationPaths = manifest.applicationFiles.map(row => row.file);
  verifyStage(original, application, applicationPaths);
  for (const row of manifest.applicationFiles) {
    equal(original.get(row.file)?.sha || null, row.beforeBlob, 'Exact application before blob differs.');
    equal(application.get(row.file)?.sha, row.afterBlob, 'Exact application after blob differs.');
    if (row.beforeBlob) equal(digest(file(row.beforeBlob)), row.beforeSha256, 'Exact application before source differs.');
    equal(digest(file(row.afterBlob)), row.afterSha256, 'Exact application after source differs.');
  }
  equal(digest(bytes(applicationPatch)), manifest.applicationPatch.sha256, 'Approved application patch bytes differ.');
  verifyPatch(applicationPatch, applicationPaths, original, application, file);
  const dispatch = 'api/functions/[name].js';
  equal(text(file(original.get(dispatch).sha)), originalDispatch(text(file(base.get(dispatch).sha))), 'Original dispatch guard transformation differs.');
  equal(text(file(application.get(dispatch).sha)), applicationDispatch(text(file(original.get(dispatch).sha))), 'Approved auth transformation must independently preserve original dispatch guards.');
  verifyStage(application, controls, ['AGENTS.md']);
  for (const row of manifest.controls) {
    equal(application.get(row.file)?.sha, row.beforeBlob, 'Exact control before blob differs.');
    equal(controls.get(row.file)?.sha, row.afterBlob, 'Exact control after blob differs.');
    equal(digest(file(row.beforeBlob)), row.beforeSha256, 'Exact control before source differs.');
    equal(digest(file(row.afterBlob)), row.canonicalSha256, 'Exact canonical control source differs.');
  }
  equal(digest(bytes(controlPatch)), manifest.controlPatch.sha256, 'Approved canonical control patch bytes differ.');
  verifyPatch(controlPatch, ['AGENTS.md'], application, controls, file);
  equal(digest(file(controls.get('package-lock.json').sha)), manifest.packageLockSha256, 'Exact dependency lock differs.');
  for (const review of manifest.reviewEvidence) equal(digest(bytes(readEvidence(review.artifact))), review.sha256, 'Pinned actual scope approval or source review evidence differs.');
  return { schemaVersion: 1, receiptKind: 'fcos_exact_runtime_compatibility_successor_source_scope', candidateCommit,
    candidateTree: controlRecord.tree, manifestSha256: RUNTIME_COMPATIBILITY_SUCCESSOR_MANIFEST_SHA256,
    stages: [historical, { stage: 2, baseCommit: originalRecord.sha, candidateCommit: appRecord.sha, paths: applicationPaths,
      patchSha256: manifest.applicationPatch.sha256, independentDispatchTransformationVerified: true },
    { stage: 3, baseCommit: appRecord.sha, candidateCommit: controlRecord.sha, paths: ['AGENTS.md'], patchSha256: manifest.controlPatch.sha256 }],
    preservation: { ...historical.preservation, existingUi: false, unrelatedProductionSource: true, originalGuardDispatch: true, canonicalControls: true },
    sourceVerified: true, installedAdmission: false, liveProof: false, productionAuthorized: false, credentialAuthority: false,
    limitation: manifest.unchangedOriginalReleaseRequirements };
}
