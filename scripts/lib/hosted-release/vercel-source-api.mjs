import { execFileSync } from 'node:child_process';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createGzip } from 'node:zlib';
import tarStream from 'tar-stream';
import { fcosConnectionIdentifier } from '../../../config/fcosConnections.js';
import { collectBuildProvenance, deploymentSourceFilter, isCredentialPath } from '../build-provenance.mjs';
import { canonicalFcosE2eCandidateUrl } from '../../verify-e2e-candidate.mjs';
import { assertSelectionSource, selectionBuildGuard } from './configuration-selection.mjs';
import { canonical, digest, fail, ReleaseError, validateManifest } from './contract.mjs';

export const SOURCE_API_TRANSPORT = 'fcos_source_api_archive_v1';
export const SOURCE_API_MAX_BODY_BYTES = 16 * 1024 * 1024;
// Source bound is within the documented 100 MB Hobby CLI source-upload limit.
// It is separate from the local JSON request budget above.
export const SOURCE_API_MAX_SOURCE_BYTES = 100_000_000;
const MAX_ACK_BYTES = 128 * 1024;
const settingsKeys = ['framework', 'buildCommand', 'devCommand', 'installCommand', 'outputDirectory', 'rootDirectory', 'nodeVersion'];
const configurationKeys = new Set(['$schema', 'version', 'name', 'installCommand', 'buildCommand', 'devCommand', 'outputDirectory',
  'framework', 'regions', 'crons', 'rewrites', 'redirects', 'headers', 'cleanUrls', 'trailingSlash', 'git', 'functions', 'images']);
const preparedBindings = new WeakMap();
const submitted = new WeakSet();
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  env: { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }, stdio: ['ignore', 'pipe', 'ignore'] }).trimEnd();
function validSourcePath(file) {
  return typeof file === 'string' && file && !file.includes('\\') && !/[\x00-\x1f\x7f]/.test(file) && !file.startsWith('/')
    && !file.split('/').some(part => !part || part === '.' || part === '..') && !isCredentialPath(file);
}

function assertSource(manifest, directory) {
  try {
    if (resolve(directory) !== realpathSync(directory)) fail('SOURCE_API_PHYSICAL_SOURCE_REQUIRED');
    assertSelectionSource(directory, manifest);
    const source = collectBuildProvenance({ cwd: directory, env: {}, requireClean: true });
    if (source.commit !== manifest.candidate.sha || source.sourceDigest !== manifest.candidate.sourceSha256
      || digest(readFileSync(join(directory, 'package-lock.json'))) !== manifest.candidate.lockSha256) fail('SOURCE_API_SOURCE_CHANGED');
    return source;
  } catch { fail('SOURCE_API_SOURCE_CHANGED', 'vercel.source_api.prepare'); }
}

function assertProject(project, manifest) {
  const expected = manifest.verification?.projectSettings;
  if (!expected || settingsKeys.some(key => !Object.hasOwn(expected, key)
    || canonical(project?.[key] ?? null) !== canonical(expected[key] ?? null))) fail('SOURCE_API_PROJECT_CONFIGURATION');
  if (project.id !== manifest.targets.vercelProject || project.accountId !== manifest.targets.vercelTeam
    || project.name !== fcosConnectionIdentifier('vercel', 'Project') || project.autoAssignCustomDomains !== false
    || project.autoExposeSystemEnvs !== true || project.link?.type !== 'github'
    || `${project.link.org}/${project.link.repo}` !== manifest.targets.repository
    || !Array.isArray(project.link.deployHooks) || project.link.deployHooks.length) fail('SOURCE_API_PROJECT_IDENTITY');
  return Object.fromEntries(settingsKeys.map(key => [key, expected[key]]));
}

function sourceFiles(directory) {
  const included = deploymentSourceFilter(directory), files = [], inventory = [];
  const sourceHash = createHash('sha256'); sourceHash.update('fcos-vercel-source-v1\0');
  let sourceBytes = 0;
  const entries = git(directory, ['ls-tree', '-r', '-z', 'HEAD']).split('\0').filter(Boolean).map(entry => {
    const separator = entry.indexOf('\t'), [mode, type, oid] = entry.slice(0, separator).split(' ');
    return { file: entry.slice(separator + 1), mode, type, oid };
  }).sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
  for (const entry of entries) {
    const { file, type, mode } = entry;
    // Reject tracked private names before opening any contents, even if ignored.
    if (!validSourcePath(file)) fail('SOURCE_API_PRIVATE_OR_INVALID_PATH');
    if (type !== 'blob' || !['100644', '100755'].includes(mode)) fail('SOURCE_API_REGULAR_FILES_REQUIRED');
    if (!included(file)) continue;
    const parts = file.split('/');
    for (let index = 1; index < parts.length; index++) {
      const info = lstatSync(join(directory, ...parts.slice(0, index)));
      if (!info.isDirectory() || info.isSymbolicLink()) fail('SOURCE_API_REGULAR_FILES_REQUIRED');
    }
    const absolute = join(directory, file), info = lstatSync(absolute);
    if (!info.isFile() || info.isSymbolicLink()) fail('SOURCE_API_REGULAR_FILES_REQUIRED');
    const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes;
    try {
      const actual = fstatSync(fd);
      if (!actual.isFile() || actual.ino !== info.ino || actual.dev !== info.dev) fail('SOURCE_API_SOURCE_CHANGED');
      bytes = readFileSync(fd);
      if ((actual.mode & 0o111 ? '100755' : '100644') !== mode
        || createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== entry.oid) fail('SOURCE_API_SOURCE_CHANGED');
    } finally { closeSync(fd); }
    sourceBytes += bytes.length;
    if (sourceBytes > SOURCE_API_MAX_SOURCE_BYTES) fail('SOURCE_API_SOURCE_TOO_LARGE');
    const numericMode = mode === '100755' ? 0o100755 : 0o100644;
    files.push({ file, bytes, mode: numericMode });
    inventory.push({ file, mode, bytes: bytes.length, sha256: digest(bytes) });
    sourceHash.update(`${file}\0${mode === '100755' ? 'executable' : 'regular'}\0${bytes.length}\0`); sourceHash.update(bytes); sourceHash.update('\0');
  }
  if (!files.length) fail('SOURCE_API_SOURCE_EMPTY');
  return { files, inventory, sourceBytes, sourceDigest: sourceHash.digest('hex') };
}

/** Credential-free, deterministic equivalent of the pinned CLI's tar-fs + gzip
 * source archive. The CLI uses tar-stream underneath and the same generated part
 * name/mode; fixed ownership/time removes host metadata without altering source.
 * No extraction or repository code execution occurs here. */
export async function createVercelSourceArchive(entries) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 15000) fail('SOURCE_API_ARCHIVE_ENTRIES');
  const sorted = [...entries].sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0), seen = new Set();
  let sourceBytes = 0;
  for (const entry of sorted) {
    if (!validSourcePath(entry.file) || seen.has(entry.file) || ![0o100644, 0o100755].includes(entry.mode)
      || !Buffer.isBuffer(entry.bytes)) fail('SOURCE_API_ARCHIVE_ENTRIES');
    seen.add(entry.file); sourceBytes += entry.bytes.length;
    if (sourceBytes > SOURCE_API_MAX_SOURCE_BYTES) fail('SOURCE_API_SOURCE_TOO_LARGE');
  }
  const pack = tarStream.pack(), gzip = createGzip({ level: 6 });
  pack.pipe(gzip);
  try {
    const write = async () => {
      for (const entry of sorted) await new Promise((accept, reject) => pack.entry({ name: entry.file, type: 'file',
        mode: entry.mode & 0o777, size: entry.bytes.length, uid: 0, gid: 0, uname: '', gname: '', mtime: new Date(0) }, entry.bytes,
      error => error ? reject(error) : accept()));
      pack.finalize();
    };
    const read = async () => {
      const chunks = []; let size = 0;
      for await (const chunk of gzip) {
        size += chunk.length;
        if (size > SOURCE_API_MAX_BODY_BYTES) fail('SOURCE_API_PAYLOAD_TOO_LARGE');
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    };
    const [, bytes] = await Promise.all([write(), read()]);
    return { file: '.vercel/source.tgz.part1', mode: 438, bytes, sourceBytes, entryCount: sorted.length, sha256: digest(bytes) };
  } catch (error) {
    pack.destroy(); gzip.destroy();
    if (error instanceof ReleaseError) throw error;
    fail('SOURCE_API_ARCHIVE_INVALID');
  }
}

function sourceConfiguration(files, manifest) {
  const configFile = files.find(file => file.file === 'vercel.json');
  if (!configFile) fail('SOURCE_API_CONFIGURATION_OVERRIDE');
  const config = JSON.parse(configFile.bytes.toString('utf8'));
  // The admitted project keeps its existing npm install default. This reviewed
  // source requires npm ci for this deployment; assertSelectionSource already
  // enforces that exact entrypoint, npm build and Node 24 before packaging.
  // Keep hashing/comparing the observed project defaults, and never send the
  // override through projectSettings (which can persist project-wide changes).
  const changedSetting = key => Object.hasOwn(config, key)
    && canonical(config[key]) !== canonical(manifest.verification.projectSettings[key])
    && !(key === 'installCommand' && config[key] === 'npm ci' && manifest.verification.projectSettings[key] === 'npm install');
  if (!config || Object.getPrototypeOf(config) !== Object.prototype || Object.keys(config).some(key => !configurationKeys.has(key))
    || config.name !== undefined && config.name !== fcosConnectionIdentifier('vercel', 'Project')
    || config.version !== undefined && config.version !== 2
    || settingsKeys.some(changedSetting)) fail('SOURCE_API_CONFIGURATION_OVERRIDE');
  return config;
}

/** Read-only preparation, before a durable intent. No uploads, settings changes or authority.
 * Production remains unavailable until its staging/alias-hold behavior is separately qualified. */
export async function prepareVercelSourceApiRequest({ manifest, candidateDirectory, observedProject,
  operationId = `${manifest?.releaseId}-preview-create`, phase = 'preview.create' } = {}) {
  validateManifest(manifest);
  if (manifest.verification?.vercelSourceTransport !== SOURCE_API_TRANSPORT) fail('SOURCE_API_TRANSPORT_NOT_ADMITTED');
  const originalManifestHash = digest(manifest);
  if (phase !== 'preview.create') fail('SOURCE_API_PRODUCTION_NOT_IMPLEMENTED');
  if (operationId !== `${manifest.releaseId}-preview-create`) fail('SOURCE_API_OPERATION_BINDING');
  const directory = resolve(candidateDirectory), configuration = assertProject(observedProject, manifest);
  assertSource(manifest, directory);
  const { files, inventory, sourceBytes, sourceDigest } = sourceFiles(directory), guard = selectionBuildGuard(manifest);
  if (sourceDigest !== manifest.candidate.sourceSha256
    || digest(files.find(file => file.file === 'package-lock.json')?.bytes || '') !== manifest.candidate.lockSha256) fail('SOURCE_API_SOURCE_CHANGED');
  const nowConfig = sourceConfiguration(files, manifest);
  const archive = await createVercelSourceArchive(files);
  if (digest(manifest) !== originalManifestHash) fail('SOURCE_API_MANIFEST_CHANGED');
  const meta = { githubCommitSha: manifest.candidate.sha, githubCommitRef: 'HEAD', fcosHostedOperation: operationId,
    fcosHostedManifest: digest(manifest), fcosVerificationSha256: digest(manifest.verification),
    fcosSourceSha256: manifest.candidate.sourceSha256, fcosConfigurationSelectionSha256: digest(guard.nodeOptions),
    fcosSourceTransport: SOURCE_API_TRANSPORT, fcosSourceArchiveSha256: archive.sha256,
    fcosSourceInventorySha256: digest(inventory), fcosSourceConfigurationSha256: digest(configuration) };
  // This is the official 54.20.1 source-deploy wire shape. Preview omits target;
  // that client removes 'preview' before POST. Do not pass projectSettings: the
  // provider persists those for subsequent deployments. Existing settings were compared above.
  const payload = { ...nowConfig, version: 2, name: fcosConnectionIdentifier('vercel', 'Project'), project: manifest.targets.vercelProject,
    source: 'cli', files: [{ file: archive.file, data: archive.bytes.toString('base64'), encoding: 'base64', mode: archive.mode }], meta,
    gitMetadata: { remoteUrl: `https://github.com/${manifest.targets.repository}.git`, commitRef: 'HEAD', commitSha: manifest.candidate.sha, dirty: false },
    env: { FCOS_BUILD_COMMIT_SHA: manifest.candidate.sha, FCOS_ENABLE_READ_ONLY_CI: 'true' },
    build: { env: { ...manifest.verification.publicBuildEnvironment, FCOS_BUILD_COMMIT_SHA: manifest.candidate.sha,
      FCOS_EXPECTED_SOURCE_SHA256: manifest.candidate.sourceSha256, NODE_OPTIONS: guard.nodeOptions } } };
  const body = canonical(payload), bodyBytes = Buffer.byteLength(body);
  if (bodyBytes > SOURCE_API_MAX_BODY_BYTES) fail('SOURCE_API_PAYLOAD_TOO_LARGE');
  // Catch changes during inventory capture, including assume-unchanged bytes.
  assertSource(manifest, directory);
  const intent = { kind: SOURCE_API_TRANSPORT, candidate: structuredClone(manifest.candidate), target: 'preview',
    bodySha256: digest(body), inventorySha256: digest(inventory), configurationSha256: digest(configuration), archiveSha256: archive.sha256 };
  const receipt = { schemaVersion: 1, kind: SOURCE_API_TRANSPORT, phase, operationId, requestHash: digest(intent),
    manifestHash: digest(manifest), controllerSha: manifest.controller.sha, candidateSha: manifest.candidate.sha,
    sourceSha256: manifest.candidate.sourceSha256, projectId: manifest.targets.vercelProject, teamId: manifest.targets.vercelTeam,
    target: 'preview', providerSourceLabel: 'cli', transport: 'rest_api', sourceBuildReadyProven: false,
    bodySha256: digest(body), inventorySha256: digest(inventory), configurationSha256: digest(configuration),
    bodyBytes, sourceBytes, fileCount: files.length,
    archive: { format: 'vercel_source_tgz_parts_v1', compressor: 'node_gzip_level6', packer: 'tar-stream@3.2.2', parts: 1,
      compressedBytes: archive.bytes.length, sha256: archive.sha256, entryCount: files.length } };
  const prepared = freeze({ schemaVersion: 1, kind: SOURCE_API_TRANSPORT, method: 'POST',
    url: `https://api.vercel.com/v13/deployments?teamId=${manifest.targets.vercelTeam}`, body, intent, receipt });
  preparedBindings.set(prepared, { directory, manifestHash: digest(manifest), requestHash: digest(intent), bodySha256: digest(body) });
  return prepared;
}

async function boundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw Error('ACK_INVALID');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_ACK_BYTES) { await reader.cancel(); throw Error('ACK_INVALID'); }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { reader.releaseLock(); }
}

/** Call only inside the existing controller's freshly claimed submit callback.
 * This wrapper grants no approval/claim. A consumed or uncertain request must use
 * the separate owner readback path. No create call, HTTP error or timeout is retried. */
export async function executeVercelSourceApiRequest({ prepared, manifest, context, token,
  assertWriteContext, fetchImpl = fetch, timeoutMs = 20000 } = {}) {
  validateManifest(manifest);
  if (manifest.verification?.vercelSourceTransport !== SOURCE_API_TRANSPORT) fail('SOURCE_API_TRANSPORT_NOT_ADMITTED');
  const binding = preparedBindings.get(prepared);
  if (!binding || submitted.has(prepared) || digest(manifest) !== binding.manifestHash
    || digest(prepared.body) !== binding.bodySha256 || digest(prepared.intent) !== binding.requestHash
    || context?.operationId !== prepared.receipt.operationId || canonical(context?.request) !== canonical(prepared.intent)
    || typeof assertWriteContext !== 'function' || typeof fetchImpl !== 'function'
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20000
    || typeof token !== 'string' || !token.length || token.length > 8192 || /\s|[\x00-\x1f\x7f]/.test(token)) fail('SOURCE_API_SUBMISSION_CONTEXT');
  assertSource(manifest, binding.directory);
  let guardResult;
  try { guardResult = assertWriteContext({ manifest, context, prepared }); }
  catch { fail('SOURCE_API_WRITER_CONTEXT'); }
  if (guardResult !== undefined && guardResult !== true) fail('SOURCE_API_SYNCHRONOUS_CONTEXT_REQUIRED');
  if (digest(manifest) !== binding.manifestHash || context.operationId !== prepared.receipt.operationId
    || digest(context.request) !== binding.requestHash) fail('SOURCE_API_SUBMISSION_CONTEXT');
  submitted.add(prepared);
  const abort = new AbortController(); let timer, status = null, reason = 'TRANSPORT_ERROR';
  try {
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { reason = 'TIMEOUT'; abort.abort(); reject(Error('TIMEOUT')); }, timeoutMs); });
    const submit = (async () => {
      const response = await fetchImpl(prepared.url, { method: 'POST', redirect: 'error', signal: abort.signal,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' }, body: prepared.body });
      status = Number.isSafeInteger(response?.status) && response.status >= 100 && response.status <= 599 ? response.status : null;
      if (response?.redirected || response?.url && response.url !== prepared.url || status >= 300 && status < 400) { reason = 'REDIRECT'; throw Error('REDIRECT'); }
      if (!response?.ok || status === null) { reason = 'HTTP_ERROR'; throw Error('HTTP_ERROR'); }
      reason = 'ACK_INVALID';
      const ack = await boundedJson(response);
      let url; try { url = canonicalFcosE2eCandidateUrl(`https://${ack.url}`); } catch { throw Error('ACK_INVALID'); }
      if (!/^dpl_[A-Za-z0-9]+$/.test(ack.id || '') || ack.projectId !== prepared.receipt.projectId
        || ack.ownerId !== prepared.receipt.teamId || ack.teamId !== undefined && ack.teamId !== prepared.receipt.teamId
        || ![undefined, null, 'preview'].includes(ack.target)
        || ack.customEnvironment != null || ack.source !== 'cli' || ack.prebuilt != null && ack.prebuilt !== false
        || !['QUEUED', 'INITIALIZING', 'BUILDING', 'READY', 'ERROR', 'CANCELED'].includes(ack.readyState)
        || Object.entries(JSON.parse(prepared.body).meta).some(([key, value]) => ack.meta?.[key] !== value)) throw Error('ACK_INVALID');
      return freeze({ id: ack.id, url, projectId: ack.projectId, teamId: ack.ownerId, target: 'preview', state: ack.readyState,
        sha: manifest.candidate.sha, sourceSha256: manifest.candidate.sourceSha256,
        sourceApi: { ...prepared.receipt, deploymentId: ack.id, acknowledgement: 'provider_create_response', sourceBuildReadyProven: false } });
    })();
    return await Promise.race([submit, timeout]);
  } catch {
    const sourceApiFailure = freeze({ schemaVersion: 1, kind: 'fcos_source_api_submission_failure_v1', outcome: 'unknown',
      operationId: prepared.receipt.operationId, phase: prepared.receipt.phase, requestHash: binding.requestHash,
      manifestHash: binding.manifestHash, bodySha256: binding.bodySha256, status, reason });
    throw new ReleaseError('VERCEL_SOURCE_API_OUTCOME_UNKNOWN', 'vercel.source_api.write',
      'Preserve the consumed intent and use separately admitted owner readback; never resubmit this request.',
      { providerSubmissionStarted: true, sourceApiFailure });
  } finally { clearTimeout(timer); }
}

/** Strict projection at RPC/log boundaries. An extra key rejects the report;
 * provider strings, headers, raw bodies and exception messages never survive. */
export function safeVercelSourceApiFailure(value) {
  const keys = ['schemaVersion', 'kind', 'outcome', 'operationId', 'phase', 'requestHash', 'manifestHash', 'bodySha256', 'status', 'reason'];
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(value, key)) || value.schemaVersion !== 1 || value.kind !== 'fcos_source_api_submission_failure_v1'
    || value.outcome !== 'unknown' || value.phase !== 'preview.create' || !/^[a-z0-9][a-z0-9-]{7,110}-preview-create$/.test(value.operationId || '')
    || ['requestHash', 'manifestHash', 'bodySha256'].some(key => !/^[a-f0-9]{64}$/.test(value[key] || ''))
    || value.status !== null && (!Number.isSafeInteger(value.status) || value.status < 100 || value.status > 599)
    || !['TRANSPORT_ERROR', 'TIMEOUT', 'REDIRECT', 'HTTP_ERROR', 'ACK_INVALID'].includes(value.reason)) return undefined;
  return freeze(Object.fromEntries(keys.map(key => [key, value[key]])));
}
