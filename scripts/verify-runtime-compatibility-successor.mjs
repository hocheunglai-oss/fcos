import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { collectBuildProvenance } from './lib/build-provenance.mjs';
import { runtimeCompatibilitySuccessorScope, RUNTIME_COMPATIBILITY_SUCCESSOR_MANIFEST_SHA256 } from './lib/runtime-compatibility-successor.mjs';
import { verifyCompatibilityObservationSources, OBSERVATION_DECLARATIONS, LEGACY_XERO_MAPPING_READ_BINDING } from './lib/runtime-compatibility-observation.mjs';

// This route prepares source evidence only. The historical release contract,
// activation pins, signer, parity and executor remain separate and unchanged.
export const EXACT_COMPATIBILITY_SUCCESSOR = '04ee3425aac7a49089eda781eb3c976aea1f6785';
const ORIGINAL = 'ff8859b287009e20462c5c0cceff89ae12f13010';
const BASE = 'f3472492ff4d0b0c70248a3c8e5c0012981a94b3';
const TREE = '4c8258c4f677878532b5d52e1f9b52fb4a767d18';
const SOURCE_DIGEST = 'b4d9709f53e031e19920d1630c1730a2aa9f349fe8bb035de3c05b4627a8f52e';
const LOCK_HASH = '9b3d6eb4824ea8688022b9ba249041e25c44b8cebc5443d59c55d8a2da5da378';
const SOURCE_HELPER_HASH = 'f457df04f59a6f5808b9f9c63a968d9c5ee787da3c9670124df9be4728800aad';
const ORIGINAL_VALIDATOR_HASH = 'ebc1f32f20f063e766e416d4e3a7e1f61c457fecaa3535f37b2cb4c1173b6d97';
const OBSERVATION_HELPER_HASH = '4ab88ed4c94afb171b588928cf9e5f0b55746cde0373102d70eb4984eb9ed8a9';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');
const same = (actual, expected, message) => { if (actual !== expected) throw new Error(message); };

function regularSource(file) {
  const parts = file.split('/');
  if (file.startsWith('/') || /[\\\x00-\x1f\x7f]/.test(file) || parts.some(part => !part || part === '.' || part === '..')) throw new Error('Only exact relative public evidence paths are permitted.');
  for (let index = 1; index <= parts.length; index++) {
    const info = lstatSync(join(ROOT, ...parts.slice(0, index)));
    if (info.isSymbolicLink() || (index === parts.length ? !info.isFile() : !info.isDirectory())) throw new Error('Reviewed source and public evidence must use regular paths.');
  }
  return readFileSync(join(ROOT, file));
}

function gitReader(cwd) {
  const git = args => {
    try {
      return execFileSync('git', ['--no-replace-objects', ...args], { cwd, timeout: 30000,
        maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' } });
    } catch { throw new Error('Exact immutable successor Git source is unavailable.'); }
  };
  same(realpathSync(cwd), realpathSync(git(['rev-parse', '--show-toplevel']).toString('utf8').trim()), 'Successor source verifier requires the canonical repository root.');
  const repository = fcosConnectionIdentifier('github', 'Repository');
  if (![ `https://github.com/${repository}.git`, `https://github.com/${repository}`, `git@github.com:${repository}.git` ].includes(git(['remote', 'get-url', 'origin']).toString('utf8').trim())) throw new Error('Successor source repository identity mismatch.');
  return git;
}

/** Independently verify the historical pair first. The new helper is outside
 * the unchanged read-only interpreter; every other observed source is exact.
 * No candidate JavaScript is imported or evaluated by this source adapter. */
function successorObservationSources(cwd, git, manifest) {
  const historical = verifyCompatibilityObservationSources({ cwd, baseSha: BASE, candidateSha: ORIGINAL });
  same(historical.helperRevision, OBSERVATION_HELPER_HASH, 'Historical observation helper differs.');
  const deployment = 'api/_deploymentReadOnly.js';
  const before = git(['show', `${ORIGINAL}:${deployment}`]).toString('utf8');
  const after = git(['show', `${EXACT_COMPATIBILITY_SUCCESSOR}:${deployment}`]).toString('utf8');
  const approved = manifest.applicationFiles.find(row => row.file === deployment);
  same(digest(after), approved.afterSha256, 'Approved successor deployment source differs.');
  const record = OBSERVATION_DECLARATIONS.find(row => row.file === deployment);
  const start = record.ranges[0].start, oldEnd = record.ranges[0].end;
  const newEnd = "\n/** Deployment permission is separate from a user's financial or module permissions. */";
  if ([before, after].some(source => source.split(start).length !== 2)
    || before.split(oldEnd).length !== 2 || after.split(newEnd).length !== 2) throw new Error('Exact deployment interpreter boundaries are required.');
  const originalDeclaration = before.slice(before.indexOf(start), before.indexOf(oldEnd, before.indexOf(start)));
  const successorDeclaration = after.slice(after.indexOf(start), after.indexOf(newEnd, after.indexOf(start)));
  same(digest(originalDeclaration), record.declarationSha256, 'Historical deployment interpreter differs.');
  same(successorDeclaration, originalDeclaration, 'Successor changed the deployment interpreter.');
  const files = [...new Set([...OBSERVATION_DECLARATIONS.map(row => row.file), 'api/_handlerPolicyRegistry.js', ...LEGACY_XERO_MAPPING_READ_BINDING.map(row => row.file)])].filter(file => file !== deployment).sort();
  const unchanged = files.map(file => {
    const original = git(['show', `${ORIGINAL}:${file}`]);
    const successor = git(['show', `${EXACT_COMPATIBILITY_SUCCESSOR}:${file}`]);
    if (!successor.equals(original)) throw new Error('Successor changed an immutable provider or saved-read interpreter.');
    return [file, digest(successor)];
  });
  return { sourceVerified: true, historical, candidateSha: EXACT_COMPATIBILITY_SUCCESSOR,
    deploymentSourceSha256: digest(after), deploymentDeclarationSha256: digest(successorDeclaration),
    unchangedSourceHashes: unchanged, liveProof: false, credentialAuthority: false };
}

export function verifyRuntimeCompatibilitySuccessorSource({ cwd, candidateCommit }) {
  same(candidateCommit, EXACT_COMPATIBILITY_SUCCESSOR, 'Only the exact clean compatibility successor has this source route.');
  same(digest(regularSource('scripts/lib/runtime-compatibility-successor.mjs')), SOURCE_HELPER_HASH, 'Reviewed successor helper differs.');
  same(digest(regularSource('scripts/lib/runtime-compatibility.mjs')), ORIGINAL_VALIDATOR_HASH, 'Original compatibility validator differs.');
  same(digest(regularSource('scripts/lib/runtime-compatibility-observation.mjs')), OBSERVATION_HELPER_HASH, 'Historical observation helper differs.');
  const manifestBytes = regularSource('config/runtime-compatibility-successor-source.json');
  same(digest(manifestBytes), RUNTIME_COMPATIBILITY_SUCCESSOR_MANIFEST_SHA256, 'Pinned source manifest differs.');
  const manifest = JSON.parse(manifestBytes.toString('utf8')), git = gitReader(cwd);
  const evidence = artifact => regularSource(`tests/fixtures/runtime-compatibility-successor/${artifact}`);
  const scope = runtimeCompatibilitySuccessorScope({ candidateCommit, manifestBytes,
    applicationPatch: evidence(manifest.applicationPatch.artifact), controlPatch: evidence(manifest.controlPatch.artifact),
    readObject: (type, oid) => {
      if (!['commit', 'tree', 'blob'].includes(type) || !/^[0-9a-f]{40}$/.test(oid)) throw new Error('Only immutable typed Git objects are permitted.');
      return git(['cat-file', type, oid]);
    }, readEvidence: evidence });
  same(scope.candidateTree, TREE, 'Pinned successor Git tree differs.');
  const observationSources = successorObservationSources(cwd, git, manifest);
  const rows = git(['ls-tree', '-rz', '--full-tree', candidateCommit]).toString('utf8').split('\0').filter(Boolean).map(line => {
    const separator = line.indexOf('\t'), [mode, type, sha] = line.slice(0, separator).split(' ');
    return { mode, type, sha, path: line.slice(separator + 1) };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { schemaVersion: 1, receiptKind: 'fcos_exact_compatibility_successor_source_preparation',
    candidateSha: candidateCommit, candidateGitTree: TREE, candidateCanonicalTreeSha256: digest(JSON.stringify(rows)),
    candidateCanonicalTreeAlgorithm: 'sha256:ordered-git-blob-tree-v1', scope, observationSources,
    sourceVerified: true, installedAdmission: false, liveProof: false, previewAuthorized: false,
    productionAuthorized: false, credentialAuthority: false, mutations: 0 };
}

export function compatibilitySuccessorPreparationPlan() {
  return { schemaVersion: 1, receiptKind: 'fcos_exact_compatibility_successor_admission_preparation',
    candidateSha: EXACT_COMPATIBILITY_SUCCESSOR, existingUi: false, sourceVerified: false,
    installedAdmission: false, liveProof: false, previewAuthorized: false, productionAuthorized: false,
    credentialAuthority: false, ready: false, mutations: 0,
    blockers: ['EXACT_SUCCESSOR_ADMISSION_NOT_INSTALLED', 'EXACT_SUCCESSOR_PREVIEW_BRANCH_RECORDS_UNOBSERVED',
      'EXACT_SUCCESSOR_SIGNER_AND_PARITY_CONTRACT_DEFERRED', 'EXACT_SUCCESSOR_LIVE_RELEASE_GATES_UNOBSERVED'],
    limitation: 'This source preparation cannot activate a build, normal-user session, provider credential, compatibility exception or Production executor. All original live gates remain mandatory; final successor admission waits for the actual compatibility rollout and observed Production baseline.' };
}

export function collectCompatibilitySuccessorPreparation({ candidateCwd, trustedCwd }) {
  same(realpathSync(join(trustedCwd, 'scripts/verify-runtime-compatibility-successor.mjs')), realpathSync(fileURLToPath(import.meta.url)), 'Active source adapter must belong to the clean trusted checkout.');
  const source = collectBuildProvenance({ cwd: candidateCwd, env: {}, requireClean: true });
  const harness = collectBuildProvenance({ cwd: trustedCwd, env: {}, requireClean: true });
  if (source.commit !== EXACT_COMPATIBILITY_SUCCESSOR || source.releaseEligible !== true || harness.releaseEligible !== true) throw new Error('Clean exact source and trusted harness are required.');
  same(source.sourceDigest, SOURCE_DIGEST, 'Exact successor deployment source digest differs.');
  same(digest(readFileSync(join(candidateCwd, 'package-lock.json'))), LOCK_HASH, 'Exact successor dependency lock differs.');
  const proof = verifyRuntimeCompatibilitySuccessorSource({ cwd: candidateCwd, candidateCommit: source.commit });
  return { ...compatibilitySuccessorPreparationPlan(), sourceVerified: true, source, harnessSha: harness.commit,
    sourceProof: proof, sourcePreparationOnly: true };
}

export function rejectCompatibilitySuccessorAdmission() {
  throw Object.assign(new Error('Exact successor source preparation does not install build, credential or release admission.'),
    { code: 'EXACT_SUCCESSOR_ADMISSION_NOT_INSTALLED' });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw new Error('Usage: verify-runtime-compatibility-successor.mjs <source-repository> <exact-successor-sha>.');
    console.log(JSON.stringify(verifyRuntimeCompatibilitySuccessorSource({ cwd: resolve(process.argv[2]), candidateCommit: process.argv[3] }), null, 2));
  } catch { console.error('Exact successor source preparation failed; no credentials or provider actions were used.'); process.exitCode = 1; }
}
