import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BACKEND_IDENTITY_SQL, BACKEND_RSS_ROUTE, validateBackendRssRequest } from '../../scripts/lib/hosted-release/backend-rss.mjs';
import { loadMigrationParentProof } from '../../scripts/lib/migration-verification.mjs';

/** Test-only RSS reader. Hosted checks can only use the verified parent's fixed metric endpoint. */
export async function backendRssSampler(pid, connectionUrl, client, { env = process.env, fetchImpl = fetch,
  loadProof = loadMigrationParentProof, now = Date.now } = {}) {
  if (env.FCOS_HOSTED_CHECK_EXECUTION === '1' || env.FCOS_BACKEND_RSS_ENDPOINT !== undefined) {
    const endpoint = new URL(env.FCOS_BACKEND_RSS_ENDPOINT || 'invalid:');
    assert.equal(endpoint.protocol, 'http:'); assert.equal(endpoint.hostname, '127.0.0.1');
    assert.ok(Number(endpoint.port) >= 1024); assert.equal(endpoint.pathname, BACKEND_RSS_ROUTE);
    assert.ok(!endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash);
    const proof = loadProof({ env });
    assert.equal(proof.source.controllerSha, env.FCOS_CONTROLLER_SHA); assert.equal(proof.source.candidateSha, env.FCOS_CANDIDATE_SHA);
    const identity = (await client.query(BACKEND_IDENTITY_SQL)).rows[0];
    assert.equal(identity.pid, pid); assert.equal(identity.address, proof.identity.address);
    assert.equal(identity.serverStartedAt, proof.identity.serverStartedAt);
    const request = validateBackendRssRequest({ pid, database: identity.database, backendStartedAt: identity.backendStartedAt }, env.FCOS_BACKEND_RSS_CHECK_ID);
    for (const [key, value] of Object.entries(request)) endpoint.searchParams.set(key, value);
    let processStartedAt;
    return async () => {
      const response = await fetchImpl(endpoint, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(2500) });
      assert.equal(response.status, 200, 'The trusted RSS parent must remain available');
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.byteLength; assert.ok(size <= 4096, 'RSS response must remain bounded'); chunks.push(chunk);
      }
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      assert.deepEqual(Object.keys(value).sort(), ['backendStartedAt','checkId','database','kind','observedAt','pid','processStartedAt','proofSha256','rssKiB','source']);
      assert.equal(value.kind, 'fcos_disposable_backend_rss_v1'); assert.equal(value.pid, pid);
      assert.equal(value.database, request.database); assert.equal(value.backendStartedAt, request.backendStartedAt);
      assert.equal(value.checkId, env.FCOS_BACKEND_RSS_CHECK_ID); assert.deepEqual(value.source, proof.source);
      assert.equal(value.proofSha256, env.FCOS_MIGRATION_PARENT_PROOF_SHA256);
      assert.match(value.processStartedAt, /^[1-9][0-9]*$/);
      assert.ok(Number.isSafeInteger(value.rssKiB) && value.rssKiB > 0 && value.rssKiB <= 64 * 1024 * 1024);
      const age = now() - Date.parse(value.observedAt); assert.ok(age >= 0 && age <= 3000, 'RSS observation must be current');
      if (processStartedAt !== undefined) assert.equal(value.processStartedAt, processStartedAt, 'Backend process cannot be replaced');
      processStartedAt = value.processStartedAt;
      return value.rssKiB;
    };
  }
  // Explicit local development mode retains native Docker/host sampling. It is
  // unreachable when the hosted parent transport is required or configured.
  const run = promisify(execFile), port = new URL(connectionUrl).port || '5432';
  const candidates = await run('docker', ['ps', '--filter', `publish=${port}`, '--format', '{{.ID}}'])
    .then(result => result.stdout.trim().split(/\s+/).filter(Boolean), () => []);
  const matches = [];
  for (const id of candidates) {
    const inspected = JSON.parse((await run('docker', ['inspect', id])).stdout)[0];
    if ((inspected.NetworkSettings?.Ports?.['5432/tcp'] || []).some(binding => binding.HostPort === port)) matches.push(id);
  }
  assert.ok(matches.length <= 1, 'The disposable database port must identify one container');
  if (matches.length) {
    const id = matches[0], command = (await run('docker', ['exec', id, 'cat', `/proc/${pid}/comm`])).stdout.trim();
    assert.ok(['postgres', '.postgres-wrapp'].includes(command), 'The measured container process must be PostgreSQL');
    return async () => {
      const status = (await run('docker', ['exec', id, 'cat', `/proc/${pid}/status`])).stdout;
      const value = Number(status.match(/^VmRSS:\s+(\d+)\s+kB$/m)?.[1]);
      assert.ok(value > 0, 'The PostgreSQL backend RSS must be measurable'); return value;
    };
  }
  const command = (await run('/bin/ps', ['-o', 'comm=', '-p', String(pid)])).stdout.trim();
  assert.match(command, /(^|\/)postgres(?:$|\s|:)/, 'The measured host process must be PostgreSQL');
  return async () => {
    const value = Number((await run('/bin/ps', ['-o', 'rss=', '-p', String(pid)])).stdout.trim());
    assert.ok(value > 0, 'The PostgreSQL backend RSS must be measurable'); return value;
  };
}
