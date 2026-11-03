import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fcosConnectionIdentifier } from '../../../config/fcosConnections.js';
import { collectBuildProvenance } from '../build-provenance.mjs';
import { collectCheckBinding, collectReleaseCheckSource, loadReleaseCheckManifest } from './checks.mjs';
import { collectPreviewEmailSignerEvidence } from '../preview-email-signer.mjs';
import { assertHostedBrowserBinding, recheckHostedPreviewProvider } from './browser.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const frozen = JSON.parse(readFileSync(new URL('../../../config/runtime-compatibility-successor-live.json', import.meta.url)));
const SOURCE_PATHS = Object.freeze(['api/_emailRouterHandlers.js', 'api/_emailRouterCore.js', 'api/functions/[name].js']);
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object'
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
const requireSource = value => { if (!value) throw new Error('Hosted Preview signer source or artifact verification failed.'); };
const gitEnvironment = { PATH: '/usr/bin:/bin', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_NO_REPLACE_OBJECTS: '1' };
function git(directory, args, encoding = 'utf8') {
  return execFileSync('/usr/bin/git', ['--no-replace-objects', '-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: directory, env: gitEnvironment, encoding, timeout: 30000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
}
function assertController(controllerDirectory, manifest) {
  const repository = fcosConnectionIdentifier('github', 'Repository');
  requireSource(git(controllerDirectory, ['rev-parse', 'HEAD']).trim() === manifest.controller.sha
    && !git(controllerDirectory, ['status', '--porcelain', '--untracked-files=no']).trim()
    && !git(controllerDirectory, ['for-each-ref', '--format=%(refname)', 'refs/replace/']).trim()
    && [`https://github.com/${repository}`, `https://github.com/${repository}.git`, `git@github.com:${repository}.git`].includes(git(controllerDirectory, ['remote', 'get-url', 'origin']).trim())
    && digest(readFileSync(join(controllerDirectory, 'config/release-checks-v2.json'))) === manifest.controller.checkManifestSha256
    && digest(readFileSync(join(controllerDirectory, 'config/hosted-release-policy.json'))) === manifest.controller.configurationSha256);
}

/** Computes fresh source proof from immutable Git objects and trusted readers only.
 * Candidate files are never imported or executed. No Mac grants or signing keys are used.
 */
export function createHostedSignerAdapter({ controllerDirectory = ROOT, candidateDirectory, env = process.env,
  verifyPreview = recheckHostedPreviewProvider, fetchImpl = globalThis.fetch, now = Date.now,
  verifyArtifact = async ({ preview, env, fetchImpl }) => {
    const response = await fetchImpl(`${preview.url}/app-version.json`, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: env.FCOS_E2E_VERCEL_BYPASS ? { 'x-vercel-protection-bypass': env.FCOS_E2E_VERCEL_BYPASS } : {} });
    requireSource(response.ok && !response.redirected && (!response.url || response.url === `${preview.url}/app-version.json`));
    return response.json();
  },
} = {}) {
  controllerDirectory = resolve(controllerDirectory);
  const verified = new Map();
  const key = (manifest, deploymentId) => `${digest(manifest)}:${deploymentId}`;
  return {
    async verifySource({ manifest, preview, sourceReceipt }) {
      let temporary;
      try {
        const deployment = assertHostedBrowserBinding(manifest, preview);
        requireSource(manifest.stage === 'compatibility' && manifest.candidate.sourceProfile === 'frozen_04ee'
          && manifest.candidate.sha === frozen.candidateSha && manifest.candidate.sourceSha256 === frozen.sourceDigest
          && manifest.candidate.lockSha256 === frozen.lockHash
          && sourceReceipt?.sourceVerified === true && sourceReceipt.observationSourcesVerified === true
          && sourceReceipt.candidateSha === manifest.candidate.sha && sourceReceipt.controllerSha === manifest.controller.sha
          && sourceReceipt.sourceDigest === manifest.candidate.sourceSha256 && sourceReceipt.lockSha256 === manifest.candidate.lockSha256
          && sourceReceipt.configurationSha256 === manifest.candidate.configurationSha256 && sourceReceipt.manifestHash === digest(manifest));
        assertController(controllerDirectory, manifest);
        const provider = await verifyPreview({ manifest, preview: deployment, env, fetchImpl });
        assertHostedBrowserBinding(manifest, provider);
        requireSource(provider.id === deployment.id && provider.url === deployment.url);
        const version = await verifyArtifact({ manifest, preview: deployment, env, fetchImpl });
        requireSource(version?.commit === manifest.candidate.sha && version.deploymentId === deployment.id
          && version.provenance?.sourceDigest === manifest.candidate.sourceSha256 && version.provenance.releaseEligible === true);
        let directory = candidateDirectory ? resolve(candidateDirectory) : null;
        if (!directory) {
          temporary = mkdtempSync(join(tmpdir(), 'fcos-hosted-signer-source-'));
          directory = join(temporary, 'candidate');
          git(controllerDirectory, ['clone', '--shared', '--no-hardlinks', '--no-checkout', controllerDirectory, directory]);
          git(directory, ['remote', 'set-url', 'origin', `https://github.com/${fcosConnectionIdentifier('github', 'Repository')}.git`]);
          git(directory, ['checkout', '--detach', manifest.candidate.sha]);
        }
        requireSource(existsSync(directory) && git(directory, ['rev-parse', 'HEAD']).trim() === manifest.candidate.sha
          && git(directory, ['rev-parse', 'HEAD^{tree}']).trim() === frozen.candidateGitTree
          && !git(directory, ['for-each-ref', '--format=%(refname)', 'refs/replace/']).trim());
        const source = collectReleaseCheckSource(directory), loaded = loadReleaseCheckManifest(controllerDirectory);
        const binding = collectCheckBinding({ candidateDirectory: directory, controllerDirectory, controllerSha: manifest.controller.sha,
          expectedCandidateSha: manifest.candidate.sha, sourceProfile: 'frozen_04ee', ...loaded, source });
        const provenance = collectBuildProvenance({ cwd: directory, env: {}, requireClean: true });
        requireSource(provenance.commit === manifest.candidate.sha && provenance.sourceDigest === manifest.candidate.sourceSha256
          && provenance.releaseEligible === true && binding.lockSha256 === manifest.candidate.lockSha256
          && binding.configurationSha256 === manifest.candidate.configurationSha256);
        const sourceHashes = {}, blobIds = {};
        for (const path of SOURCE_PATHS) {
          const oid = git(directory, ['rev-parse', '--verify', `${manifest.candidate.sha}:${path}`]).trim();
          requireSource(/^[a-f0-9]{40}$/.test(oid));
          const bytes = git(directory, ['cat-file', 'blob', oid], 'buffer');
          requireSource(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') === oid);
          sourceHashes[path] = digest(bytes); blobIds[path] = oid;
        }
        const proof = Object.freeze({ schemaVersion: 2, kind: 'fcos_hosted_preview_email_signer_source', sourceVerified: true,
          candidateSha: manifest.candidate.sha, controllerSha: manifest.controller.sha, manifestHash: digest(manifest),
          sourceDigest: provenance.sourceDigest, lockSha256: binding.lockSha256, configurationSha256: binding.configurationSha256,
          deploymentId: deployment.id, origin: deployment.url, gitTree: frozen.candidateGitTree,
          sourceHashes: Object.freeze(sourceHashes), blobIds: Object.freeze(blobIds),
          deploymentProvenanceSha256: digest({ commit: version.commit, deploymentId: version.deploymentId, sourceDigest: version.provenance.sourceDigest, releaseEligible: true }), capturedAt: new Date(now()).toISOString() });
        verified.set(key(manifest, deployment.id), proof);
        return proof;
      } catch { throw new Error('Hosted Preview signer source or artifact verification failed.'); }
      finally { if (temporary) rmSync(temporary, { recursive: true, force: true }); }
    },
    async collect({ manifest, sourceProof, origin, deploymentId, sha, sourceDigest, bearerToken, protectionBypass, fetchImpl: collectorFetch = fetchImpl }) {
      try {
        requireSource(sourceProof && verified.get(key(manifest, deploymentId)) === sourceProof && sourceProof.origin === origin
          && sourceProof.candidateSha === sha && sourceProof.sourceDigest === sourceDigest && sourceProof.manifestHash === digest(manifest)
          && now() - Date.parse(sourceProof.capturedAt) <= 1800000 && Date.parse(sourceProof.capturedAt) <= now() + 30000);
        assertController(controllerDirectory, manifest);
        return await collectPreviewEmailSignerEvidence({ origin, deploymentId, sha, sourceDigest, bearerToken, protectionBypass,
          fetchImpl: collectorFetch, now, verifyHostedSource: async binding => {
            requireSource(binding.origin === sourceProof.origin && binding.deploymentId === sourceProof.deploymentId
              && binding.sha === sourceProof.candidateSha && binding.sourceDigest === sourceProof.sourceDigest);
            return sourceProof;
          } });
      } catch { throw new Error('Hosted Preview signer probe failed.'); }
    },
  };
}
