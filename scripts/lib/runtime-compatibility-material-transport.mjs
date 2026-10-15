import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { FCOS_RELEASE_APPROVAL_POLICY, fcosConnectionIdentifier } from '../../config/fcosConnections.js';
import { assertProtectedDefault, assertReleaseGitHubAccount } from './release-evidence.mjs';
import { DURABLE_SETUP_MODE, DURABLE_SETUP_CONTRACT_SHA256, durableSuccessorSetupDeadline } from './runtime-compatibility-setup.mjs';
import { githubProviderFresh, githubProviderTimestamp } from './github-provider-timestamp.mjs';

export const RUNTIME_MATERIAL_MODE = 'FCOS_RUNTIME_COMPATIBILITY_MATERIAL_TRANSPORT';
export const RUNTIME_MATERIAL_INPUT = 'FCOS_RUNTIME_COMPATIBILITY_MATERIALS';
export const RUNTIME_MATERIAL_MODE_VALUE = 'run-artifact-v1';
export const RUNTIME_MATERIAL_FILENAME = 'fcos-runtime-compatibility-materials.json';
export const RUNTIME_MATERIAL_STEP = 'Persist immutable exact04ee runtime materials';
const routes = Object.freeze({
  '.github/workflows/preview-email-proof-build.yml': { job: 'proof', environment: 'fcos-runtime-compatibility-release', name: 'FCOS protected Preview email proof build' },
  '.github/workflows/runtime-compatibility-release.yml': { job: 'preflight', environment: 'fcos-runtime-compatibility-release', name: 'FCOS protected exact first runtime rollout' },
  '.github/workflows/runtime-compatibility-normal-role.yml': { job: 'compatibility-normal-role', environment: 'fcos-normal-role-verification', name: 'FCOS exact first-rollout normal-role verification' },
});
const positive = value => Number.isSafeInteger(value) && value > 0;
const hash = value => /^[0-9a-f]{64}$/.test(value || '');
const sha = value => /^[0-9a-f]{40}$/.test(value || '');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const runtimeMaterialHash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = () => { throw new Error('Authenticated immutable runtime material is unavailable; no static fallback or action authority.'); };
const need = value => { if (!value) fail(); };
const base = () => `repos/${fcosConnectionIdentifier('github', 'Repository')}`;
export function runtimeSetupBinding(binding) {
  const { environmentId, runId, runAttempt, workflow, ...setup } = binding;
  return { ...setup, setupContractSha256: DURABLE_SETUP_CONTRACT_SHA256 };
}
export function runtimeMaterialMode(text) {
  let pack; try { pack = JSON.parse(text); } catch { fail(); }
  if (pack?.schemaVersion === 2 && pack.kind === 'fcos_exact04ee_setup_material_pack') return DURABLE_SETUP_MODE;
  need(pack?.schemaVersion === 1 && pack.kind === 'fcos_exact04ee_runtime_material_pack');
  return RUNTIME_MATERIAL_MODE_VALUE;
}
export const runtimeMaterialArtifactName = runId => { need(positive(runId)); return `fcos-exact04ee-runtime-materials-${runId}`; };

async function collection(reads, path, field) {
  const rows = [], ids = new Set(); let total;
  for (let page = 1; page <= 100; page++) {
    const response = await reads.json(`${path}?per_page=100&page=${page}`);
    need(Array.isArray(response?.[field]) && Number.isSafeInteger(response.total_count) && response.total_count >= 0 && response.total_count <= 10000
      && (total === undefined || total === response.total_count)); total = response.total_count;
    for (const row of response[field]) {
      const id = field === 'variables' ? row.name : row.id;
      need(id && !ids.has(id)); ids.add(id); rows.push(row);
    }
    if (rows.length === total) return rows;
    need(response[field].length && rows.length < total);
  }
  fail();
}
export function runtimeMaterialRoute(workflow) { need(Object.hasOwn(routes, workflow)); return routes[workflow]; }

// Data validation only. This function cannot mint live selection, a private
// approval, a signed receipt, a lease, a grant or a provider-write capability.
export function assertRuntimeMaterialProducer({ repository, branch, protection, environment, workflowDefinition, run, jobs, approvals,
  expected, oidcClaims, requireCompletedStep = true, now = Date.now() } = {}) {
  const trusted = assertProtectedDefault(repository, branch, protection), workflow = run?.path?.split('@')[0], route = runtimeMaterialRoute(workflow);
  const operator = fcosConnectionIdentifier('github', 'Required account');
  const rules = environment?.protection_rules?.filter(row => row.type === 'required_reviewers');
  const rule = rules?.length === 1 ? rules[0] : null, reviewer = rule?.reviewers?.length === 1 ? rule.reviewers[0] : null;
  const reviews = Array.isArray(approvals) ? approvals.filter(row => row.environments?.some(e => e.id === environment?.id && e.name === route.environment)) : [];
  const job = jobs?.length === 1 ? jobs[0] : null;
  need(FCOS_RELEASE_APPROVAL_POLICY.mode === 'single_operator' && positive(repository.id) && positive(environment?.id)
    && environment.name === route.environment && environment.can_admins_bypass === false && rule?.prevent_self_review === false
    && reviewer?.type === 'User' && reviewer.reviewer?.login === operator && positive(reviewer.reviewer?.id)
    && environment.deployment_branch_policy?.protected_branches === true && environment.deployment_branch_policy?.custom_branch_policies === false
    && reviews.length === 1 && reviews[0].state === 'approved' && reviews[0].user?.login === operator && reviews[0].user?.id === reviewer.reviewer.id
    && positive(workflowDefinition?.id) && workflowDefinition.path === workflow && workflowDefinition.name === route.name && workflowDefinition.state === 'active'
    && positive(run?.id) && run.id === expected.runId && run.workflow_id === workflowDefinition.id && run.run_attempt === 1
    && run.repository?.full_name === repository.full_name && run.head_repository?.full_name === repository.full_name
    && run.repository?.id === repository.id && run.head_repository?.id === repository.id
    && run.head_sha === trusted.sha && run.head_sha === expected.harnessSha && run.head_branch === trusted.branch && run.event === 'workflow_dispatch'
    && [workflow, `${workflow}@${trusted.branch}`].includes(run.path) && ['in_progress', 'completed'].includes(run.status)
    && run.actor?.login === operator && run.actor?.id === reviewer.reviewer.id && run.triggering_actor?.login === operator && run.triggering_actor?.id === reviewer.reviewer.id
    && (expected.materialMode === DURABLE_SETUP_MODE
      ? githubProviderTimestamp(run.run_started_at) && Date.parse(run.run_started_at) <= now
      : githubProviderFresh(run.run_started_at, 1800000, now))
    && positive(job?.id) && job.run_id === run.id && job.run_attempt === 1 && job.name === route.job && job.workflow_name === run.name
    && job.head_sha === trusted.sha && job.head_branch === trusted.branch && ['in_progress', 'completed'].includes(job.status)
    && githubProviderFresh(job.started_at, 1800000, now) && Date.parse(job.started_at) >= Date.parse(run.run_started_at));
  const steps = job.steps?.filter(step => step.name === RUNTIME_MATERIAL_STEP), step = steps?.length === 1 ? steps[0] : null;
  need(step && positive(step.number) && githubProviderFresh(step.started_at, 1800000, now) && Date.parse(step.started_at) >= Date.parse(job.started_at));
  if (requireCompletedStep) need(step.status === 'completed' && step.conclusion === 'success' && githubProviderFresh(step.completed_at, 1800000, now)
    && Date.parse(step.completed_at) >= Date.parse(step.started_at));
  else need(oidcClaims !== undefined && step.status === 'in_progress' && step.conclusion === null && step.completed_at === null && job.status === 'in_progress');
  const binding = { repositoryId: repository.id, environmentId: environment.id, harnessSha: trusted.sha, candidateSha: expected.sha,
    sourceDigest: expected.sourceDigest, lockHash: expected.lockHash, candidateTreeHash: expected.candidateTreeHash,
    previewControlRevision: expected.previewControlRevision, configurationRevision: expected.configurationRevision,
    runId: run.id, runAttempt: 1, workflow };
  need(sha(binding.harnessSha) && sha(binding.candidateSha) && ['sourceDigest', 'lockHash', 'candidateTreeHash', 'previewControlRevision', 'configurationRevision'].every(k => hash(binding[k])));
  if (oidcClaims !== undefined) need(oidcClaims.iss === 'https://token.actions.githubusercontent.com' && oidcClaims.aud === 'fcos-production-release'
    && oidcClaims.repository === repository.full_name && oidcClaims.repository_id === String(repository.id)
    && oidcClaims.run_id === String(run.id) && oidcClaims.run_attempt === '1' && oidcClaims.workflow_sha === trusted.sha && oidcClaims.sha === trusted.sha
    && oidcClaims.ref === `refs/heads/${trusted.branch}` && oidcClaims.event_name === 'workflow_dispatch'
    && oidcClaims.sub === `repo:${repository.full_name}:environment:${route.environment}`
    && oidcClaims.workflow_ref === `${repository.full_name}/${workflow}@refs/heads/${trusted.branch}`
    && oidcClaims.actor === operator && oidcClaims.actor_id === String(reviewer.reviewer.id)
    && Number.isFinite(oidcClaims.exp) && oidcClaims.exp * 1000 > now);
  return { binding, job, step, environment: route.environment, dispatchedAt: run.run_started_at,
    materialMode: expected.materialMode || RUNTIME_MATERIAL_MODE_VALUE,
    ...(oidcClaims ? { oidcExpiresAt: oidcClaims.exp * 1000 } : {}) };
}
export async function collectRuntimeMaterialProducer({ reads, expected, oidcClaims, requireCompletedStep = true, detectMaterialMode = false, now = Date.now() }) {
  assertReleaseGitHubAccount(reads);
  const repository = await reads.json(base()), branch = await reads.json(`${base()}/branches/${encodeURIComponent(repository.default_branch)}`);
  const protection = await reads.json(`${base()}/branches/${encodeURIComponent(repository.default_branch)}/protection`);
  const run = await reads.json(`${base()}/actions/runs/${expected.runId}`), route = runtimeMaterialRoute(run.path?.split('@')[0]);
  const [workflowDefinition, environment, jobs, approvals] = await Promise.all([
    reads.json(`${base()}/actions/workflows/${run.path.split('@')[0].split('/').at(-1)}`),
    reads.json(`${base()}/environments/${route.environment}`),
    collection(reads, `${base()}/actions/runs/${expected.runId}/attempts/1/jobs`, 'jobs'),
    reads.json(`${base()}/actions/runs/${expected.runId}/approvals`),
  ]);
  const data = { repository, branch, protection, environment, workflowDefinition, run, jobs, approvals, expected, oidcClaims, requireCompletedStep, now };
  if (!detectMaterialMode) return assertRuntimeMaterialProducer(data);
  // Authenticate the current approved job, source and OIDC before reading even
  // public setup input. This preliminary data check mints no capability. Final
  // format-specific admission below keeps v1's original dispatch clock intact.
  need(oidcClaims !== undefined && requireCompletedStep === false);
  assertRuntimeMaterialProducer({ ...data, expected: { ...expected, materialMode: DURABLE_SETUP_MODE } });
  const materialText = await runtimeMaterialInput(reads, route.environment); need(materialText !== null);
  return { ...assertRuntimeMaterialProducer({ ...data, expected: { ...expected, materialMode: runtimeMaterialMode(materialText) } }), materialText };
}
export async function runtimeMaterialArtifacts(reads, runId) {
  need(positive(runId)); return collection(reads, `${base()}/actions/runs/${runId}/artifacts`, 'artifacts');
}
export async function runtimeMaterialInput(reads, environment) {
  const variables = await collection(reads, `${base()}/environments/${environment}/variables`, 'variables');
  // Runtime input belongs to this protected environment only. Repository-level
  // overrides are ambiguous with Actions' merged vars context and fail closed.
  const repositoryVariables = await collection(reads, `${base()}/actions/variables`, 'variables');
  need(!repositoryVariables.some(row => [RUNTIME_MATERIAL_MODE, RUNTIME_MATERIAL_INPUT].includes(row.name)));
  const mode = variables.find(row => row.name === RUNTIME_MATERIAL_MODE), input = variables.find(row => row.name === RUNTIME_MATERIAL_INPUT);
  if (!mode && !input) return null;
  need([RUNTIME_MATERIAL_MODE_VALUE, DURABLE_SETUP_MODE].includes(mode?.value) && typeof input?.value === 'string' && input.value.length > 0 && Buffer.byteLength(input.value) <= 49152
    && runtimeMaterialMode(input.value) === mode.value);
  return input.value;
}
export function parseRuntimeMaterialPack(text, binding) {
  need(typeof text === 'string' && Buffer.byteLength(text) <= 49152);
  let pack; try { pack = JSON.parse(text); } catch { fail(); }
  const durable = runtimeMaterialMode(text) === DURABLE_SETUP_MODE;
  need(exact(pack, ['schemaVersion', 'kind', 'binding', 'materials'])
    && equal(pack.binding, durable ? runtimeSetupBinding(binding) : binding) && exact(pack.materials, ['context', 'root', 'independent']));
  const rows = {};
  for (const role of ['context', 'root', 'independent']) {
    const raw = pack.materials[role]; need(typeof raw === 'string' && Buffer.byteLength(raw) > 0 && Buffer.byteLength(raw) <= 32768);
    const body = Buffer.from(raw); let value; try { value = JSON.parse(raw); } catch { fail(); }
    rows[role] = { body, value, sha256: runtimeMaterialHash(body) };
  }
  return rows;
}
export function runtimeMaterialPayload(text, producer, now = Date.now()) {
  parseRuntimeMaterialPack(text, producer.binding);
  const payload = { schemaVersion: runtimeMaterialMode(text) === DURABLE_SETUP_MODE ? 2 : 1, kind: 'fcos_exact04ee_runtime_material_artifact', binding: producer.binding,
    producerJobId: producer.job.id, capturedAt: new Date(now).toISOString(), materialPackSha256: runtimeMaterialHash(text),
    materialPackText: text, grantsAuthority: false };
  // Bound the actual encoded wrapper before any attempt marker/publication;
  // JSON escaping can expand an otherwise valid bounded input pack.
  need(Buffer.byteLength(`${JSON.stringify(payload)}\n`) <= 65536); return payload;
}

// Recheck the original clocks at the write boundary, after all authentication
// reads. Capture/publication time cannot extend identity or material validity.
export function assertRuntimeMaterialPublicationFresh({ producer, payload, now = Date.now() } = {}) {
  const rows = parseRuntimeMaterialPack(payload.materialPackText, producer.binding);
  const durable = runtimeMaterialMode(payload.materialPackText) === DURABLE_SETUP_MODE;
  need((producer.materialMode === DURABLE_SETUP_MODE) === durable);
  const clocks = [[producer.job.started_at, 1800000], [producer.step.started_at, 1800000],
    ...(durable ? [] : [[producer.dispatchedAt, 1800000], [rows.context.value.provisionedAt, 2700000],
      ...['root', 'independent'].map(role => [rows[role].value.reviewedAt, 1800000])])];
  need(Number.isFinite(now) && clocks.every(([timestamp, age]) => githubProviderFresh(timestamp, age, now))
    && githubProviderFresh(payload.capturedAt, 1800000, now) && Number.isFinite(producer.oidcExpiresAt));
  const deadline = Math.min(producer.oidcExpiresAt, ...(durable ? [durableSuccessorSetupDeadline(rows.context.value, now)] : []), ...clocks.map(([timestamp, age]) => Date.parse(timestamp) + age));
  need(now < deadline); return deadline;
}

// Reconcile a single SDK-finalized data upload using bounded fixed-owner GETs.
// This helper has no upload callback or authority capability. Unknown CLI read
// errors fail closed; only an absent artifact is retried without restamping.
export async function reconcileRuntimeMaterialPublication({ reads, producer, created, payload,
  now = () => Date.now(), sleep = ms => new Promise(done => setTimeout(done, ms)) } = {}) {
  need(positive(created?.id) && positive(created.size) && created.size <= 131072 && hash(created.digest)
    && payload.producerJobId === producer.job.id && equal(payload.binding, producer.binding));
  const startedAt = now(), deadline = Math.min(startedAt + 5000,
    assertRuntimeMaterialPublicationFresh({ producer, payload, now: startedAt }));
  const name = runtimeMaterialArtifactName(producer.binding.runId);
  const valid = row => positive(row?.id) && row.id === created.id && row.name === name && row.expired === false
    && row.digest === `sha256:${created.digest}` && row.size_in_bytes === created.size
    && row.workflow_run?.id === producer.binding.runId && row.workflow_run?.head_sha === producer.binding.harnessSha
    && row.workflow_run?.repository_id === producer.binding.repositoryId && row.workflow_run?.head_repository_id === producer.binding.repositoryId
    && githubProviderTimestamp(row.created_at) && Date.parse(row.created_at) >= Date.parse(producer.step.started_at) - 1000
    && Date.parse(row.created_at) <= now();
  for (let attempt = 0; attempt < 10 && now() < deadline; attempt++) {
    assertReleaseGitHubAccount(reads);
    const matches = (await runtimeMaterialArtifacts(reads, producer.binding.runId)).filter(row => row.name === name);
    need(matches.length <= 1 && now() < deadline);
    if (matches.length) {
      need(valid(matches[0]));
      const artifact = await reads.json(`${base()}/actions/artifacts/${created.id}`); need(valid(artifact) && now() < deadline);
      const archive = await reads.archive(`${base()}/actions/artifacts/${created.id}/zip`);
      need(Buffer.isBuffer(archive) && archive.length === created.size && runtimeMaterialHash(archive) === created.digest
        && equal(decodeRuntimeMaterialArchive(archive), payload) && now() < deadline);
      return { artifactId: created.id, archiveSha256: created.digest };
    }
    if (attempt < 9 && now() < deadline) await sleep(Math.min(500, deadline - now()));
  }
  fail();
}

// Fixed bounded one-file ZIP codec. It never extracts paths or loads code.
const table = Array.from({ length: 256 }, (_, i) => { let c = i; for (let n = 0; n < 8; n++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1; return c >>> 0; });
const crc32 = bytes => { let c = 0xffffffff; for (const b of bytes) c = table[(c ^ b) & 255] ^ c >>> 8; return (c ^ 0xffffffff) >>> 0; };
function extra(bytes) { for (let i = 0; i < bytes.length;) { need(i + 4 <= bytes.length && bytes.readUInt16LE(i) !== 1); i += 4 + bytes.readUInt16LE(i + 2); need(i <= bytes.length); } }
export function decodeRuntimeMaterialArchive(archive) {
  try {
    need(Buffer.isBuffer(archive) && archive.length >= 98 && archive.length <= 131072);
    const end = archive.length - 22;
    need(archive.readUInt32LE(end) === 0x06054b50 && !archive.readUInt16LE(end + 4) && !archive.readUInt16LE(end + 6)
      && archive.readUInt16LE(end + 8) === 1 && archive.readUInt16LE(end + 10) === 1 && !archive.readUInt16LE(end + 20));
    const central = archive.readUInt32LE(end + 16), centralSize = archive.readUInt32LE(end + 12);
    need(central >= 30 && central + centralSize === end && centralSize >= 46 && archive.readUInt32LE(central) === 0x02014b50);
    const flags = archive.readUInt16LE(central + 8), method = archive.readUInt16LE(central + 10), crc = archive.readUInt32LE(central + 16);
    const packed = archive.readUInt32LE(central + 20), size = archive.readUInt32LE(central + 24), nameSize = archive.readUInt16LE(central + 28);
    const extraSize = archive.readUInt16LE(central + 30), commentSize = archive.readUInt16LE(central + 32), mode = archive.readUInt32LE(central + 38) >>> 16;
    need(!(flags & ~0x808) && [0, 8].includes(method) && size > 0 && size <= 65536 && packed <= 98304 && !archive.readUInt16LE(central + 34)
      && !archive.readUInt32LE(central + 42) && (!(mode & 0xf000) || (mode & 0xf000) === 0x8000) && !(archive.readUInt32LE(central + 38) & 16)
      && 46 + nameSize + extraSize + commentSize === centralSize);
    const name = archive.subarray(central + 46, central + 46 + nameSize);
    need(name.equals(Buffer.from(RUNTIME_MATERIAL_FILENAME)) && archive.readUInt32LE(0) === 0x04034b50 && archive.readUInt16LE(6) === flags
      && archive.readUInt16LE(8) === method && archive.readUInt16LE(26) === nameSize);
    const start = 30 + nameSize + archive.readUInt16LE(28), stop = start + packed;
    need(archive.subarray(30, 30 + nameSize).equals(name) && stop <= central);
    extra(archive.subarray(30 + nameSize, start)); extra(archive.subarray(central + 46 + nameSize, central + 46 + nameSize + extraSize));
    if (flags & 8) {
      const descriptor = central - stop, offset = descriptor === 16 && archive.readUInt32LE(stop) === 0x08074b50 ? stop + 4 : stop;
      need([12, 16].includes(descriptor) && (descriptor !== 16 || offset === stop + 4)
        && archive.readUInt32LE(offset) === crc && archive.readUInt32LE(offset + 4) === packed && archive.readUInt32LE(offset + 8) === size);
    } else need(stop === central && archive.readUInt32LE(14) === crc && archive.readUInt32LE(18) === packed && archive.readUInt32LE(22) === size);
    const payload = method === 0 ? archive.subarray(start, stop) : inflateRawSync(archive.subarray(start, stop), { maxOutputLength: 65536 });
    need(payload.length === size && crc32(payload) === crc);
    const text = payload.toString('utf8'); need(Buffer.from(text).equals(payload)); return JSON.parse(text);
  } catch { fail(); }
}
const archiveCache = new WeakMap();
export async function collectRuntimeSuccessorMaterials({ reads, expected, run, now = Date.now() }) {
  const route = runtimeMaterialRoute(run.path?.split('@')[0]);
  const text = await runtimeMaterialInput(reads, route.environment);
  const artifacts = await collection(reads, `${base()}/actions/runs/${expected.runId}/artifacts`, 'artifacts');
  const matches = artifacts.filter(row => row.name === runtimeMaterialArtifactName(expected.runId));
  if (text === null) { need(matches.length === 0); return null; }
  need(matches.length === 1);
  const materialMode = runtimeMaterialMode(text);
  const producer = await collectRuntimeMaterialProducer({ reads, expected: { ...expected, materialMode }, now }), artifact = matches[0];
  need(positive(artifact.id) && artifact.expired === false && artifact.workflow_run?.id === expected.runId && artifact.workflow_run?.head_sha === expected.harnessSha
    && artifact.workflow_run?.head_repository_id === producer.binding.repositoryId && artifact.workflow_run?.repository_id === producer.binding.repositoryId
    && /^sha256:[0-9a-f]{64}$/.test(artifact.digest || '') && Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0 && artifact.size_in_bytes <= 131072
    && githubProviderTimestamp(artifact.created_at) && Date.parse(artifact.created_at) >= Date.parse(producer.step.started_at) - 1000
    && Date.parse(artifact.created_at) <= Date.parse(producer.step.completed_at) + 1000 && Date.parse(artifact.created_at) <= now);
  // Only immutable archives are cached, within this exact authenticated reads
  // transport identity. Mutable environment/run/review/step reads stay fresh.
  let cache = archiveCache.get(reads); if (!cache) { cache = new Map(); archiveCache.set(reads, cache); }
  const key = `${artifact.id}:${artifact.digest}:${expected.harnessSha}`; let immutable = cache.get(key);
  if (!immutable) {
    const archive = await reads.archive(`${base()}/actions/artifacts/${artifact.id}/zip`);
    need(archive.length === artifact.size_in_bytes && artifact.digest === `sha256:${runtimeMaterialHash(archive)}`);
    immutable = { payload: decodeRuntimeMaterialArchive(archive), size: archive.length };
    if (cache.size >= 8) cache.delete(cache.keys().next().value); cache.set(key, immutable);
  }
  need(immutable.size === artifact.size_in_bytes); const payload = immutable.payload;
  need(exact(payload, ['schemaVersion', 'kind', 'binding', 'producerJobId', 'capturedAt', 'materialPackSha256', 'materialPackText', 'grantsAuthority'])
    && payload.schemaVersion === (materialMode === DURABLE_SETUP_MODE ? 2 : 1) && payload.kind === 'fcos_exact04ee_runtime_material_artifact' && equal(payload.binding, producer.binding)
    && payload.producerJobId === producer.job.id && payload.grantsAuthority === false && payload.materialPackText === text
    && payload.materialPackSha256 === runtimeMaterialHash(text) && githubProviderFresh(payload.capturedAt, 1800000, now)
    && Date.parse(payload.capturedAt) >= Date.parse(producer.step.started_at) && Date.parse(payload.capturedAt) <= Date.parse(producer.step.completed_at));
  return { rows: parseRuntimeMaterialPack(text, producer.binding), materialMode, transport: { jobStartedAt: producer.job.started_at, kind: 'authenticated_run_artifact',
    artifactId: artifact.id, archiveSha256: artifact.digest.slice(7), materialPackSha256: payload.materialPackSha256,
    producerJobId: producer.job.id, binding: producer.binding, capturedAt: payload.capturedAt } };
}
