import { readFileSync } from 'node:fs';
import { fcosConnectionIdentifier } from '../../config/fcosConnections.js';
import { SUCCESSOR_LIVE_CONTRACT, successorLiveSelection, rejectSuccessorUncoordinatedMutation } from './runtime-compatibility-successor-live.mjs';

const parity = JSON.parse(readFileSync(new URL('../../config/preview-parity-policy.json', import.meta.url)));
if (parity.requiredModules.length !== 15) throw new Error('All fifteen compatibility modules remain mandatory.');

/** Uninstalled, data-only adapter. Existing executable builders, signer,
 * parity, normal-role and release routes do not import this module. */
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
