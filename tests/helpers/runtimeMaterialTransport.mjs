import { DURABLE_SETUP_MODE } from '../../scripts/lib/runtime-compatibility-setup.mjs';
import { FCOS_RELEASE_APPROVAL_POLICY, fcosConnectionIdentifier } from '../../config/fcosConnections.js';
import { deflateRawSync } from 'node:zlib';
import { RUNTIME_MATERIAL_MODE, RUNTIME_MATERIAL_INPUT, RUNTIME_MATERIAL_MODE_VALUE, RUNTIME_MATERIAL_STEP,
  RUNTIME_MATERIAL_FILENAME, assertRuntimeMaterialProducer, runtimeMaterialPayload, runtimeMaterialArtifactName,
  runtimeMaterialHash, runtimeSetupBinding } from '../../scripts/lib/runtime-compatibility-material-transport.mjs';

// Synthetic public data only. No hosted identity, action CLI or producer is run.
export function materialZip(payload, { filename = RUNTIME_MATERIAL_FILENAME, mode = 0o100600, compressed = false, descriptor = false, bytes: raw } = {}) {
  const bytes = raw || Buffer.from(`${JSON.stringify(payload)}\n`), name = Buffer.from(filename), packed = compressed ? deflateRawSync(bytes) : bytes;
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let n = 0; n < 8; n++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1; }
  crc = (crc ^ 0xffffffff) >>> 0;
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x800 | (descriptor ? 8 : 0), 6); local.writeUInt16LE(compressed ? 8 : 0, 8);
  if (!descriptor) { local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(bytes.length, 22); }
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x314, 4); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x800 | (descriptor ? 8 : 0), 8); central.writeUInt16LE(compressed ? 8 : 0, 10);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(bytes.length, 24);
  central.writeUInt16LE(name.length, 28); central.writeUInt32LE((mode * 65536) >>> 0, 38);
  const trailer = Buffer.alloc(descriptor ? 16 : 0);
  if (descriptor) { trailer.writeUInt32LE(0x08074b50); trailer.writeUInt32LE(crc, 4); trailer.writeUInt32LE(packed.length, 8); trailer.writeUInt32LE(bytes.length, 12); }
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(30 + name.length + packed.length + trailer.length, 16);
  return Buffer.concat([local, name, packed, trailer, central, name, end]);
}

export function materialTransportFixture({ expected, rows, workflow = '.github/workflows/preview-email-proof-build.yml', now, dispatchedAt } = {}) {
  const operator = fcosConnectionIdentifier('github', 'Required account'), iso = delta => new Date(now + delta).toISOString();
  const normal = workflow.endsWith('normal-role.yml'), environmentName = normal ? 'fcos-normal-role-verification' : 'fcos-runtime-compatibility-release';
  const repository = { id: 7, full_name: fcosConnectionIdentifier('github', 'Repository'), default_branch: 'main' };
  const branch = { name: 'main', protected: true, commit: { sha: expected.harnessSha } };
  const protection = { enforce_admins: { enabled: true }, required_status_checks: { strict: true,
    checks: FCOS_RELEASE_APPROVAL_POLICY.requiredChecks.map(context => ({ context, app_id: FCOS_RELEASE_APPROVAL_POLICY.statusCheckAppId })) } };
  const environment = { id: normal ? 9 : 8, name: environmentName, can_admins_bypass: false,
    protection_rules: [{ type: 'required_reviewers', prevent_self_review: false, reviewers: [{ type: 'User', reviewer: { login: operator, id: 1 } }] }],
    deployment_branch_policy: { protected_branches: true, custom_branch_policies: false } };
  const run = { id: expected.runId, name: 'Protected synthetic fixture', repository, head_repository: repository, head_sha: expected.harnessSha,
    head_branch: 'main', path: workflow, event: 'workflow_dispatch', run_attempt: 1, status: 'in_progress', run_started_at: dispatchedAt || iso(-10000),
    actor: { login: operator, id: 1 }, triggering_actor: { login: operator, id: 1 } };
  const workflowDefinition = { id: 11, path: workflow, state: 'active', name: normal ? 'FCOS exact first-rollout normal-role verification'
    : workflow.endsWith('release.yml') ? 'FCOS protected exact first runtime rollout' : 'FCOS protected Preview email proof build' };
  run.workflow_id = workflowDefinition.id;
  const job = { id: 100, run_id: run.id, run_attempt: 1, name: normal ? 'compatibility-normal-role' : workflow.endsWith('release.yml') ? 'preflight' : 'proof',
    workflow_name: run.name, head_sha: run.head_sha, head_branch: 'main', status: 'in_progress', started_at: iso(-9000),
    steps: [{ name: RUNTIME_MATERIAL_STEP, number: 5, status: 'completed', conclusion: 'success', started_at: iso(-8000), completed_at: iso(-6000) }] };
  const approvals = [{ state: 'approved', user: { login: operator, id: 1 }, environments: [{ id: environment.id, name: environment.name }] }];
  const oidcClaims = { iss: 'https://token.actions.githubusercontent.com', aud: 'fcos-production-release', repository: repository.full_name,
    repository_id: String(repository.id), run_id: String(run.id), run_attempt: '1', workflow_sha: expected.harnessSha, sha: expected.harnessSha,
    ref: 'refs/heads/main', event_name: 'workflow_dispatch', sub: `repo:${repository.full_name}:environment:${environment.name}`,
    workflow_ref: `${repository.full_name}/${workflow}@refs/heads/main`, actor: operator, actor_id: '1', exp: (now + 60000) / 1000 };
  const durable = rows?.context?.value?.schemaVersion === 2, materialMode = durable ? DURABLE_SETUP_MODE : RUNTIME_MATERIAL_MODE_VALUE;
  const producer = assertRuntimeMaterialProducer({ repository, branch, protection, environment, workflowDefinition, run, jobs: [job], approvals, expected: { ...expected, materialMode }, oidcClaims, now });
  const pack = { schemaVersion: durable ? 2 : 1, kind: durable ? 'fcos_exact04ee_setup_material_pack' : 'fcos_exact04ee_runtime_material_pack', binding: durable ? runtimeSetupBinding(producer.binding) : producer.binding,
    materials: Object.fromEntries(['context', 'root', 'independent'].map(role => [role, rows?.[role]?.body.toString() || '{"synthetic":true}\n'])) };
  const text = JSON.stringify(pack), payload = runtimeMaterialPayload(text, producer, now - 7000), archive = materialZip(payload);
  const variables = [{ name: RUNTIME_MATERIAL_MODE, value: materialMode }, { name: RUNTIME_MATERIAL_INPUT, value: text }];
  const artifact = { id: 101, name: runtimeMaterialArtifactName(run.id), expired: false, digest: `sha256:${runtimeMaterialHash(archive)}`,
    size_in_bytes: archive.length, created_at: iso(-7000), workflow_run: { id: run.id, head_sha: run.head_sha, repository_id: repository.id, head_repository_id: repository.id } };
  const state = { repository, branch, protection, environment, workflowDefinition, run, jobs: [job], approvals, expected, oidcClaims, variables,
    repositoryVariables: [], artifacts: [artifact], payload, pack, archive, calls: [], archiveCalls: 0 };
  state.reads = { json(endpoint) {
    state.calls.push(endpoint); const base = `repos/${repository.full_name}`;
    if (endpoint === 'user') return { id: 1, login: operator };
    if (endpoint === base) return state.repository;
    if (endpoint === `${base}/branches/main`) return state.branch;
    if (endpoint === `${base}/branches/main/protection`) return state.protection;
    if (endpoint === `${base}/actions/runs/${run.id}`) return state.run;
    if (endpoint === `${base}/actions/workflows/${workflow.split('/').at(-1)}`) return state.workflowDefinition;
    if (endpoint === `${base}/actions/artifacts/${artifact.id}`) return state.artifacts[0];
    if (endpoint === `${base}/environments/${environment.name}`) return state.environment;
    if (endpoint.endsWith('/variables?per_page=100&page=1')) {
      const values = endpoint.includes('/environments/') ? state.variables : state.repositoryVariables;
      return { total_count: values.length, variables: values };
    }
    if (endpoint.endsWith('/artifacts?per_page=100&page=1')) return { total_count: state.artifacts.length, artifacts: state.artifacts };
    if (endpoint.endsWith('/attempts/1/jobs?per_page=100&page=1')) return { total_count: state.jobs.length, jobs: state.jobs };
    if (endpoint.endsWith('/approvals')) return state.approvals;
    throw new Error('Unrecognized fixture-only public read.');
  }, archive() { state.archiveCalls++; return state.archive; } };
  return state;
}
