import { readFileSync } from 'node:fs';
import { fcosConnectionIdentifier } from '../../config/fcosConnections.js';
import { SUCCESSOR_LIVE_CONTRACT, successorLiveSelection, rejectSuccessorUncoordinatedMutation } from './runtime-compatibility-successor-live.mjs';
import { compatibilityBrowserIsolationVerified } from './compatibility-browser-isolation.mjs';

const parity = JSON.parse(readFileSync(new URL('../../config/preview-parity-policy.json', import.meta.url)));
if (parity.requiredModules.length !== 15) throw new Error('All fifteen compatibility modules remain mandatory.');

/** Operation-local data adapter. Provider writes remain unavailable until the
 * canonical shared-coordinator bridge is independently installed and reviewed. */
export function successorLiveCollectionContract({ admission, now = Date.now() } = {}) {
  const selected = successorLiveSelection(admission, SUCCESSOR_LIVE_CONTRACT.candidateSha, now);
  return {
    schemaVersion: 1, kind: 'fcos_exact_04ee_uninstalled_collection_contract',
    candidate: selected.candidate, harnessSha: selected.harnessSha, contractSha256: selected.contractSha256,
    previewControlRevision: selected.context.previewControlRevision, configurationRevision: selected.context.configurationRevision,
    materialHashes: selected.materialHashes, requiredModules: [...parity.requiredModules],
    workflowModules: [...parity.workflowModules], normalRoles: [...parity.normalRoles],
    requiredAuthorityMode: 'issuance-bound-v1', maxAgeSeconds: { ...SUCCESSOR_LIVE_CONTRACT.maxAgeSeconds },
    sourceVerified: true, materialAdmissionVerified: true, installed: false, liveProof: false, ready: false,
    previewAuthorized: false, productionAuthorized: false, credentialAuthority: false, mutations: 0,
    blockers: ['EXACT_SUCCESSOR_SIGNER_PARITY_INTEGRATION_REQUIRES_INDEPENDENT_REVIEW', 'EXACT_SUCCESSOR_SHARED_COORDINATOR_REQUIRED'],
  };
}

export function successorLiveNormalCoverageVerified({ admission, normal, candidate, now = Date.now() } = {}) {
  const selected = successorLiveSelection(admission, SUCCESSOR_LIVE_CONTRACT.candidateSha, now);
  const capturedAt = Date.parse(normal?.capturedAt), createdAt = typeof candidate?.createdAt === 'number' ? candidate.createdAt : Date.parse(candidate?.createdAt);
  return normal?.kind === 'normal_role' && normal.sha === selected.candidate.sha && normal.harnessSha === selected.harnessSha
    && normal.sourceDigest === selected.candidate.sourceDigest && normal.lockHash === selected.candidate.lockHash
    && normal.configurationRevision === selected.context.configurationRevision
    && normal.deploymentId === candidate?.id && normal.candidateUrl === candidate?.url
    && Number.isFinite(capturedAt) && Number.isFinite(createdAt) && capturedAt >= createdAt && capturedAt <= now && now - capturedAt <= 1800000
    && Array.isArray(normal.checks) && normal.checks.length === parity.requiredModules.length
    && normal.checks.every(row => row && typeof row === 'object' && !Array.isArray(row) && Object.keys(row).length === 5
      && ['module', 'role', 'result', 'kind', 'evidenceId'].every(key => Object.hasOwn(row, key)))
    && parity.requiredModules.every(module => normal.checks.filter(row => row.module === module && row.result === 'pass'
      && parity.normalRoles.includes(row.role) && (parity.workflowModules.includes(module) ? row.kind === 'workflow_read' : ['read', 'workflow_read'].includes(row.kind))
      && typeof row.evidenceId === 'string' && row.evidenceId.trim()).length === 1)
    && compatibilityBrowserIsolationVerified(normal.browserIsolation, normal, parity.requiredModules);
}

export function successorLivePreviewRequest({ admission, operationId, now = Date.now() } = {}) {
  const selected = successorLiveSelection(admission, SUCCESSOR_LIVE_CONTRACT.candidateSha, now);
  if (selected.workflow !== '.github/workflows/preview-email-proof-build.yml'
    || !new RegExp(`^fcos-preview-email-${selected.runId}-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`).test(operationId || '')) {
    throw new Error('Exact successor request requires the actual first dispatch identity.');
  }
  const [org, repo] = fcosConnectionIdentifier('github', 'Repository').split('/');
  return { name: fcosConnectionIdentifier('vercel', 'Project'), project: fcosConnectionIdentifier('vercel', 'Project ID'),
    gitSource: { type: 'github', org, repo, ref: selected.candidate.branch, sha: selected.candidate.sha },
    meta: { fcosPreviewEmailBuildOperation: operationId } };
}

export function executeSuccessorLiveAdapter() {
  // Neither a selection, pass file, supplied lease boolean nor callback can
  // authorize a write. A separately reviewed coordinator integration is absent.
  rejectSuccessorUncoordinatedMutation();
}
