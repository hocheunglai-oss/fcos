import { FCOS_READ_ONLY_CI } from '../../config/fcosCiIdentity.js';
import { privateE2eStatePaths } from '../e2e-private-state.mjs';
import { canonicalFcosE2eCandidateUrl, resolveFcosE2eCandidate } from '../verify-e2e-candidate.mjs';

function required(environment, name) {
  const value = environment[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} is required for strict release verification.`);
  }
  return value;
}

export function assertReleaseBrowserEnvironment(environment = process.env) {
  const candidateUrl = canonicalFcosE2eCandidateUrl(required(environment, 'FCOS_E2E_CANDIDATE_URL'));
  const expectedCommit = required(environment, 'FCOS_E2E_EXPECTED_COMMIT');
  if (!/^[0-9a-f]{40}$/.test(expectedCommit)) {
    throw new Error('FCOS_E2E_EXPECTED_COMMIT must be a full lowercase Git SHA.');
  }
  // BASE_URL is derived from independently verified evidence, never a second target.
  if (environment.FCOS_E2E_BASE_URL && environment.FCOS_E2E_BASE_URL !== candidateUrl) {
    throw new Error('FCOS_E2E_BASE_URL must match FCOS_E2E_CANDIDATE_URL when supplied.');
  }
  const paths = privateE2eStatePaths(environment);
  if (environment.FCOS_AUTH_E2E_ENABLED !== 'true') {
    throw new Error('FCOS_AUTH_E2E_ENABLED must enable the governed renewable FCUNO identity.');
  }
  const email = required(environment, 'FCOS_E2E_EMAIL').trim().toLowerCase();
  if (email !== FCOS_READ_ONLY_CI.email) throw new Error('Only the pinned read-only FCUNO identity may be used for CI.');
  const password = required(environment, 'FCOS_E2E_PASSWORD');
  const protectionBypass = required(environment, 'FCOS_E2E_VERCEL_BYPASS');
  if (!/^[a-zA-Z0-9]{32}$/.test(protectionBypass)) throw new Error('The dedicated candidate protection credential is invalid.');
  const githubToken = required(environment, 'GITHUB_TOKEN');
  return { candidateUrl, expectedCommit, ...paths, email, password, protectionBypass, githubToken };
}

export async function verifyReleasePreviewArtifact(environment, options = {}) {
  // Candidate-controlled app-version.json is consistency evidence only. The
  // shared resolver first verifies the newest exact-SHA vercel[bot] Preview.
  return resolveFcosE2eCandidate({
    candidateUrl: environment.candidateUrl,
    expectedCommit: environment.expectedCommit,
    protectionBypass: environment.protectionBypass,
    githubToken: environment.githubToken,
    ...options,
  });
}
