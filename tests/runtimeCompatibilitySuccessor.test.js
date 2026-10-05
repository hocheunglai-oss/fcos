import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, lstatSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { runtimeCompatibilitySuccessorScope, RUNTIME_COMPATIBILITY_SUCCESSOR_MANIFEST_SHA256 } from '../scripts/lib/runtime-compatibility-successor.mjs';

// Exact public fixtures populate a new offline Git object store. Never fall
// back to the checkout's Git store, local task outputs, credentials or network.
const repository = fileURLToPath(new URL('..', import.meta.url));
const fixtureRoot = fileURLToPath(new URL('./fixtures/runtime-compatibility-successor/', import.meta.url));
const FIXTURE_MANIFEST_SHA256 = '8d26d2512a91352a5f47ae05ff7045f07a1d5ff50dde34dbfff5714d6837cc09';
const hash = data => createHash('sha256').update(data).digest('hex');
const manifestBytes = readFileSync(resolve(repository, 'config/runtime-compatibility-successor-source.json'));
const manifest = JSON.parse(manifestBytes);
const fixtureManifestBytes = readFileSync(resolve(fixtureRoot, 'fixture-manifest.json'));
const fixtureManifest = JSON.parse(fixtureManifestBytes);
const expectedArtifacts = [manifest.applicationPatch, manifest.controlPatch, ...manifest.reviewEvidence];

function validateFixtureShape(value) {
  assert.equal(value.schemaVersion, 1, 'Fixture schema differs.');
  assert.equal(value.sourceManifestSha256, RUNTIME_COMPATIBILITY_SUCCESSOR_MANIFEST_SHA256, 'Fixture source manifest differs.');
  assert.equal(value.candidateCommit, manifest.candidateCommit, 'Fixture candidate differs.');
  assert.equal(value.pack.path, 'objects.pack', 'Fixture pack path differs.');
  assert.equal(value.pack.nonThin, true, 'Only a self-contained non-thin pack is permitted.');
  assert.equal(value.pack.count, 265, 'Fixture object count differs.');
  assert.equal(value.objects.length, 265, 'Fixture object membership differs.');
  const objectIds = new Set();
  for (const row of value.objects) {
    assert.ok(['commit', 'tree', 'blob'].includes(row.type), 'Fixture object type differs.');
    assert.match(row.sha, /^[0-9a-f]{40}$/, 'Fixture object ID differs.');
    assert.match(row.sha256, /^[0-9a-f]{64}$/, 'Fixture object hash differs.');
    assert.ok(Number.isSafeInteger(row.byteLength) && row.byteLength > 0, 'Fixture object length differs.');
    assert.ok(!objectIds.has(row.sha), 'Duplicate fixture object ID.');
    objectIds.add(row.sha);
  }
  for (const [type, count] of [['commit', 5], ['tree', 227], ['blob', 33]]) assert.equal(value.objects.filter(row => row.type === type).length, count, 'Fixture object type count differs.');
  assert.equal(value.objects.reduce((size, row) => size + row.byteLength, 0), 4512954, 'Fixture raw byte count differs.');
  const memberPaths = new Set();
  for (const row of value.members) {
    assert.equal(row.type, 'file', 'Fixture members must be regular files.');
    assert.ok(typeof row.path === 'string' && !row.path.startsWith('/') && !/[\\\x00-\x1f\x7f]/.test(row.path)
      && row.path.split('/').every(part => part && part !== '.' && part !== '..'), 'Unsafe fixture member path.');
    assert.ok(!memberPaths.has(row.path), 'Duplicate fixture member.');
    memberPaths.add(row.path);
    const expected = row.path === 'objects.pack' ? value.pack : expectedArtifacts.find(item => item.artifact === row.path);
    assert.ok(expected, 'Unexpected fixture member.');
    assert.equal(row.sha256, expected.sha256, 'Fixture member authority hash differs.');
  }
  assert.deepEqual([...memberPaths].sort(), ['objects.pack', ...expectedArtifacts.map(row => row.artifact)].sort(), 'Exact fixture artifact membership differs.');
  assert.equal(value.publicScopeAudit.selectedBlobCount, 33, 'Public source blob count differs.');
  assert.equal(value.publicScopeAudit.privateFilesInspected, false);
  assert.equal(value.publicScopeAudit.liveProviderRowsIncluded, false);
  assert.equal(value.publicScopeAudit.privateRuntimeOrAuthArtifactsIncluded, false);
  assert.equal(value.publicScopeAudit.credentialPatternFindings, 0);
  for (const row of value.publicScopeAudit.selectedBlobAudit) {
    assert.ok(row.paths.length && row.paths.every(path => !/(?:^|\/)(?:\.env(?:\.|$)|\.fcos-cli|\.aws|storage-state|credentials)/i.test(path)), 'Private fixture blob path.');
    const object = value.objects.find(item => item.sha === row.sha && item.type === 'blob');
    assert.ok(object && object.sha256 === row.sha256 && object.byteLength === row.byteLength, 'Public blob audit identity differs.');
    assert.equal(row.credentialPatternFindings, 0);
  }
}

function readFixtureMembers(value, read = path => readFileSync(resolve(fixtureRoot, path))) {
  const members = new Map();
  for (const row of value.members) {
    const data = read(row.path);
    assert.equal(data.length, row.byteLength, 'Fixture member length differs.');
    assert.equal(hash(data), row.sha256, 'Fixture member content hash differs.');
    members.set(row.path, data);
  }
  return members;
}

function verifyFixtureManifestBytes(data) {
  assert.equal(hash(data), FIXTURE_MANIFEST_SHA256, 'Pinned portable fixture manifest differs.');
  const value = JSON.parse(data);
  validateFixtureShape(value);
  return value;
}

function validateFixtureLayout() {
  const files = new Set(['fixture-manifest.json', ...fixtureManifest.members.map(row => row.path)]);
  const directories = new Set();
  for (const path of files) {
    const parts = path.split('/');
    for (let index = 1; index < parts.length; index++) directories.add(parts.slice(0, index).join('/'));
  }
  assert.ok(lstatSync(fixtureRoot).isDirectory(), 'Fixture root must be a regular directory.');
  const walk = (relative = '') => {
    for (const row of readdirSync(join(fixtureRoot, relative), { withFileTypes: true })) {
      const path = relative ? `${relative}/${row.name}` : row.name;
      if (row.isDirectory()) { assert.ok(directories.has(path), 'Unexpected fixture directory.'); walk(path); }
      else assert.ok(row.isFile() && files.has(path), 'Unrecognized file or symlink in public fixtures.');
    }
  };
  walk();
}

const temporaryObjectDirectories = new Set();
function isolatedGitObjects(pack, value) {
  const directory = mkdtempSync(join(tmpdir(), 'fcos-successor-objects-'));
  temporaryObjectDirectories.add(directory);
  const environment = { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
  const git = (args, input) => execFileSync('git', ['--git-dir', directory, ...args], { env: environment, input, maxBuffer: 20 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    execFileSync('git', ['-c', 'init.templateDir=', 'init', '--bare', '--quiet', directory], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(pack.subarray(0, 4).toString(), 'PACK');
    assert.equal(pack.readUInt32BE(4), 2);
    assert.equal(pack.readUInt32BE(8), value.pack.count, 'Packed object count differs.');
    git(['index-pack', '--stdin'], pack);
    const listing = git(['cat-file', '--batch-all-objects', '--batch-check=%(objectname) %(objecttype) %(objectsize)']).toString().trim().split('\n');
    const expected = value.objects.map(row => `${row.sha} ${row.type} ${row.byteLength}`).sort();
    assert.deepEqual(listing.sort(), expected, 'Actual isolated object membership, type or size differs.');
    const batch = git(['cat-file', '--batch'], `${value.objects.map(row => row.sha).join('\n')}\n`);
    const result = new Map();
    let offset = 0;
    for (const row of value.objects) {
      const end = batch.indexOf(10, offset);
      assert.equal(batch.subarray(offset, end).toString(), `${row.sha} ${row.type} ${row.byteLength}`, 'Object batch identity differs.');
      const body = batch.subarray(end + 1, end + 1 + row.byteLength);
      assert.equal(hash(body), row.sha256, 'Fixture raw object content hash differs.');
      assert.equal(batch[end + 1 + row.byteLength], 10);
      result.set(`${row.type}:${row.sha}`, Buffer.from(body));
      offset = end + row.byteLength + 2;
    }
    assert.equal(offset, batch.length, 'Extra fixture object bytes.');
    return { directory, objects: result };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    temporaryObjectDirectories.delete(directory);
    throw error;
  }
}

verifyFixtureManifestBytes(fixtureManifestBytes);
assert.equal(hash(manifestBytes), fixtureManifest.sourceManifestSha256);
validateFixtureShape(fixtureManifest);
validateFixtureLayout();
const fixtureMembers = readFixtureMembers(fixtureManifest);
const isolated = isolatedGitObjects(fixtureMembers.get('objects.pack'), fixtureManifest);
after(() => {
  for (const directory of temporaryObjectDirectories) rmSync(directory, { recursive: true, force: true });
  temporaryObjectDirectories.clear();
});
const readObject = (type, sha) => {
  const data = isolated.objects.get(`${type}:${sha}`);
  if (!data) throw new Error('Required immutable object absent from isolated fixture store.');
  return Buffer.from(data);
};
const evidence = new Map(manifest.reviewEvidence.map(row => [row.artifact, fixtureMembers.get(row.artifact)]));
function fixture() {
  return { candidateCommit: manifest.candidateCommit, manifestBytes: Buffer.from(manifestBytes),
    applicationPatch: Buffer.from(fixtureMembers.get(manifest.applicationPatch.artifact)),
    controlPatch: Buffer.from(fixtureMembers.get(manifest.controlPatch.artifact)), readObject,
    readEvidence: artifact => Buffer.from(evidence.get(artifact)) };
}
function alteredObject(input, type, sha, transform) {
  const original = input.readObject;
  input.readObject = (requestedType, requestedSha) => requestedType === type && requestedSha === sha
    ? transform(original(type, sha)) : original(requestedType, requestedSha);
}
const appCommit = manifest.commits.find(row => row.role === 'application');
const cleanCommit = manifest.commits.find(row => row.role === 'canonicalControl');
const originalCommit = manifest.commits.find(row => row.role === 'originalCompatibility');

test('exact three-stage immutable compatibility successor has local source authority only', () => {
  const proof = runtimeCompatibilitySuccessorScope(fixture());
  assert.equal(proof.candidateCommit, '04ee3425aac7a49089eda781eb3c976aea1f6785');
  assert.equal(proof.candidateTree, cleanCommit.tree);
  assert.equal(proof.manifestSha256, RUNTIME_COMPATIBILITY_SUCCESSOR_MANIFEST_SHA256);
  assert.equal(proof.stages.length, 3);
  assert.equal(proof.stages[0].baseCommit, 'f3472492ff4d0b0c70248a3c8e5c0012981a94b3');
  assert.equal(proof.stages[0].candidateCommit, originalCommit.sha);
  assert.equal(proof.stages[0].scopeVerified, true);
  assert.equal(proof.stages[0].candidateTreeHash, '4493c413dec871255d8aa32ee554a625e268dcc0d972b34c15b87b5b5fdd66f5');
  assert.equal(proof.stages[0].readOnlyGuards.length, 5);
  assert.equal(proof.stages[0].preservation.existingUi, true);
  assert.equal(proof.stages[1].independentDispatchTransformationVerified, true);
  assert.deepEqual(proof.stages[1].paths, manifest.applicationFiles.map(row => row.file));
  assert.deepEqual(proof.stages[2].paths, ['AGENTS.md']);
  assert.equal(proof.preservation.existingUi, false);
  for (const key of ['databaseSchema', 'salesforceMetadata', 'financialLogic', 'dependencies', 'existingConnectionPolicy', 'externalActionGates', 'originalGuardDispatch', 'canonicalControls', 'unrelatedProductionSource']) assert.equal(proof.preservation[key], true, key);
  assert.equal(proof.sourceVerified, true);
  for (const key of ['installedAdmission', 'liveProof', 'productionAuthorized', 'credentialAuthority']) assert.equal(proof[key], false, key);
  assert.match(proof.limitation, /all fifteen required live module gates remain mandatory/);
});

for (const candidate of [originalCommit.sha, appCommit.sha, manifest.deferredFinalCommit, 'f4576a8c918acef686f084c505b1715de11deeb8', 'f'.repeat(40)]) {
  test(`rejects alternate or historical candidate identity ${candidate}`, () => {
    const input = fixture();
    input.candidateCommit = candidate;
    input.approved = true;
    input.scopeVerified = true;
    assert.throws(() => runtimeCompatibilitySuccessorScope(input), /Only the exact reviewed clean compatibility successor/);
  });
}

for (const field of ['candidateCommit', 'approvedScopeAnswer', 'existingUi', 'installedAdmission', 'liveProof', 'applicationFiles', 'reviewEvidence']) {
  test(`rejects tampered manifest field ${field} regardless of approval flags`, () => {
    const input = fixture(), changed = structuredClone(manifest);
    changed[field] = field === 'applicationFiles' || field === 'reviewEvidence' ? [] : true;
    input.manifestBytes = JSON.stringify(changed);
    input.approved = true;
    assert.throws(() => runtimeCompatibilitySuccessorScope(input), /Pinned successor manifest differs/);
  });
}

test('rejects changed approved patch bytes and omitted approved hunks', () => {
  for (const field of ['applicationPatch', 'controlPatch']) {
    const input = fixture();
    input[field] = Buffer.concat([input[field], Buffer.from('\n')]);
    assert.throws(() => runtimeCompatibilitySuccessorScope(input), /patch bytes differ/);
  }
});

test('rejects changed or substituted historical scope approval and review bytes', () => {
  for (const row of manifest.reviewEvidence) {
    const input = fixture(), original = input.readEvidence;
    input.readEvidence = artifact => artifact === row.artifact ? Buffer.from('{"approved":true}\n') : original(artifact);
    assert.throws(() => runtimeCompatibilitySuccessorScope(input), /Pinned actual scope approval or source review evidence differs/);
  }
});

test('rejects changed parent, tree binding, or extra merge parent in commit bytes', () => {
  for (const replacement of [`parent ${originalCommit.sha}`, `tree ${originalCommit.tree}`, `parent ${appCommit.sha}\nparent ${originalCommit.sha}`]) {
    const input = fixture();
    alteredObject(input, 'commit', cleanCommit.sha, raw => Buffer.from(raw.toString().replace(/^parent .+$/m, replacement)));
    assert.throws(() => runtimeCompatibilitySuccessorScope(input), /Immutable commit object identity differs/);
  }
});

for (const scope of ['extra-ui.jsx', 'financial.js', 'schema.sql', 'package.json', '.codex-control.json']) {
  test(`rejects extra ${scope} tree scope even with caller approval`, () => {
    const input = fixture();
    const blob = manifest.applicationFiles[0].afterBlob;
    alteredObject(input, 'tree', cleanCommit.tree, raw => Buffer.concat([raw, Buffer.from(`100644 ${scope}\0`), Buffer.from(blob, 'hex')]));
    input.approved = true;
    assert.throws(() => runtimeCompatibilitySuccessorScope(input), /Immutable tree object identity differs/);
  });
}

test('rejects executable, symlink, deleted and replaced dependency tree entries', () => {
  for (const replacement of ['100755 package-lock.json\0', '120000 package-lock.json\0', '100644 removed-lock.json\0']) {
    const input = fixture();
    alteredObject(input, 'tree', cleanCommit.tree, raw => Buffer.from(raw.toString('latin1').replace('100644 package-lock.json\0', replacement), 'latin1'));
    assert.throws(() => runtimeCompatibilitySuccessorScope(input), /Immutable tree object identity differs/);
  }
});

test('rejects altered original guard, approved after source, or canonical control source bytes', () => {
  const targets = [
    ['original dispatch', manifest.applicationFiles.find(row => row.file === 'api/functions/[name].js').beforeBlob],
    ...manifest.applicationFiles.map(row => [row.file, row.afterBlob]),
    ...manifest.controls.map(row => [row.file, row.afterBlob]),
    ['original validator', manifest.originalValidator.blob],
  ];
  for (const [label, sha] of targets) {
    const input = fixture();
    alteredObject(input, 'blob', sha, raw => Buffer.concat([raw, Buffer.from('// unauthorized source edit\n')]));
    assert.throws(() => runtimeCompatibilitySuccessorScope(input), /Immutable blob object identity differs/, label);
  }
});

test('rejects unavailable readers, objects and evidence instead of retaining prior success', () => {
  for (const field of ['readObject', 'readEvidence']) {
    const input = fixture();
    input[field] = undefined;
    assert.throws(() => runtimeCompatibilitySuccessorScope(input), /readers are required/);
  }
  const input = fixture();
  runtimeCompatibilitySuccessorScope(input);
  input.readObject = () => { throw new Error('object unavailable'); };
  assert.throws(() => runtimeCompatibilitySuccessorScope(input), /object unavailable/);
  input.readObject = readObject;
  input.readEvidence = () => undefined;
  assert.throws(() => runtimeCompatibilitySuccessorScope(input), /Immutable bytes are required/);
});

test('original validator and source manifest remain byte-identical to the reviewed bindings', () => {
  const actual = readFileSync(resolve(repository, manifest.originalValidator.path));
  assert.equal(createHash('sha256').update(actual).digest('hex'), manifest.originalValidator.sha256);
  assert.ok(actual.equals(readObject('blob', manifest.originalValidator.blob)));
  assert.equal(hash(manifestBytes), RUNTIME_COMPATIBILITY_SUCCESSOR_MANIFEST_SHA256);
});

test('portable fixtures populate only the exact isolated offline object store', () => {
  assert.equal(isolated.objects.size, 265);
  assert.notEqual(isolated.directory, repository);
  assert.equal(fixtureMembers.get('objects.pack').length, 489133);
  assert.equal(hash(fixtureMembers.get('objects.pack')), 'ea9cd50f5e6874c15739f288a57ce17103ffa20302b6d218790334f809949f11');
  assert.throws(() => readObject('commit', 'f'.repeat(40)), /absent from isolated fixture store/);
  assert.equal(manifest.reviewEvidence.length, 7);
});

test('portable fixture manifest tampering cannot grant public or source authority', () => {
  const altered = structuredClone(fixtureManifest);
  altered.pack.count += 1;
  altered.productionAuthorized = true;
  assert.throws(() => verifyFixtureManifestBytes(Buffer.from(JSON.stringify(altered))), /Pinned portable fixture manifest differs/);
});

test('portable fixture object counts, types, IDs, lengths and duplicates fail closed', () => {
  const changes = [
    value => { value.objects.pop(); },
    value => { value.pack.count += 1; },
    value => { value.objects[0].type = 'tag'; },
    value => { value.objects[0].sha = '../object'; },
    value => { value.objects[1].sha = value.objects[0].sha; },
    value => { value.objects[0].byteLength += 1; },
    value => { value.pack.nonThin = false; },
  ];
  for (const change of changes) {
    const value = structuredClone(fixtureManifest);
    change(value);
    assert.throws(() => validateFixtureShape(value));
  }
});

test('portable artifact paths, membership, regular-file types and authority hashes fail closed', () => {
  const changes = [
    value => { value.members[0].path = '../objects.pack'; },
    value => { value.members[0].path = '/objects.pack'; },
    value => { value.members[0].path = 'unexpected.pack'; },
    value => { value.members[0].type = 'symlink'; },
    value => { value.members[1].path = value.members[0].path; },
    value => { value.members.pop(); },
    value => { value.members[1].sha256 = 'f'.repeat(64); },
    value => { value.publicScopeAudit.selectedBlobAudit[0].paths = ['.env.local']; },
  ];
  for (const change of changes) {
    const value = structuredClone(fixtureManifest);
    change(value);
    assert.throws(() => validateFixtureShape(value));
  }
});

test('every public patch, review and pack body is checked before Git import', () => {
  for (const row of fixtureManifest.members) {
    assert.throws(() => readFixtureMembers(fixtureManifest, path => {
      const body = fixtureMembers.get(path);
      if (path !== row.path) return body;
      const changed = Buffer.from(body);
      changed[changed.length - 1] ^= 1;
      return changed;
    }), /Fixture member content hash differs/);
  }
});

test('actual pack object count, membership, type and size are independently checked', () => {
  const pack = Buffer.from(fixtureMembers.get('objects.pack'));
  pack.writeUInt32BE(266, 8);
  assert.throws(() => isolatedGitObjects(pack, fixtureManifest), /Packed object count differs/);
  for (const field of ['sha', 'type', 'byteLength']) {
    const value = structuredClone(fixtureManifest);
    value.objects[0][field] = field === 'sha' ? 'f'.repeat(40)
      : field === 'type' ? value.objects[0].type === 'tree' ? 'blob' : 'tree' : value.objects[0].byteLength + 1;
    assert.throws(() => isolatedGitObjects(fixtureMembers.get('objects.pack'), value), /Actual isolated object membership, type or size differs/);
  }
});

test('isolated raw object hash tampering fails after an otherwise valid pack import', () => {
  const value = structuredClone(fixtureManifest);
  value.objects[0].sha256 = 'f'.repeat(64);
  assert.throws(() => isolatedGitObjects(fixtureMembers.get('objects.pack'), value), /Fixture raw object content hash differs/);
});

test('selected source fixture bodies contain no audited credential literals or private data paths', () => {
  const patterns = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
    /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/, /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\b/,
    /\b(?:password|accessToken|refreshToken|clientSecret|apiKey|privateKey|secretKey|serviceRoleKey)\s*[:=]\s*['"][^'"\r\n]{8,}['"]/i,
    /https?:\/\/[^\/\s:@]+:[^@\/\s]+@/];
  assert.equal(fixtureManifest.publicScopeAudit.selectedBlobAudit.length, 33);
  for (const row of fixtureManifest.publicScopeAudit.selectedBlobAudit) {
    const body = readObject('blob', row.sha);
    assert.equal(hash(body), row.sha256);
    assert.ok(row.paths.every(path => !/(?:^|\/)(?:\.env(?:\.|$)|\.fcos-cli|\.aws|storage-state|credentials)/i.test(path)));
    for (const pattern of patterns) assert.equal(pattern.test(body.toString('utf8')), false, `Credential-pattern review required for ${row.sha}`);
  }
});
