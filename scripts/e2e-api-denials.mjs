import { canonicalFcosE2eCandidateUrl } from './verify-e2e-candidate.mjs';

// Deliberately incomplete requests: no record IDs, commercial values, recipient,
// source file, revision or idempotency key. Even if authorization regresses,
// validation must reject them rather than performing a real business action.
export const CI_DENIAL_PROBES = Object.freeze([
  ['/api/functions/adminUserSave', {}],
  ['/api/functions/variableChargesBuyerConfirm', {}],
  ['/api/functions/hedgePhysicalSalesforceApply', {}],
  ['/api/functions/workspacePreferencesSave', {}],
  ['/api/functions/hedgeMarkets', { action: 'save_spreads' }],
  ['/api/functions/dashboardAccountInsightExport', {}],
  ['/api/functions/salesforceDocumentDownload', {}],
  ['/api/work-notifications', {}],
].map(([path, body]) => Object.freeze({ path, body: Object.freeze(body) })));

export async function assertCiApiDenials({ candidateUrl, fetchProbe }) {
  const origin = canonicalFcosE2eCandidateUrl(candidateUrl);
  if (typeof fetchProbe !== 'function') throw new Error('A candidate-scoped request adapter is required.');
  const results = [];
  for (const probe of CI_DENIAL_PROBES) {
    // Only safe, fixed labels leave this function. Request exceptions can echo
    // credentials and response bodies may contain business data if a guard fails.
    try {
      const response = await fetchProbe({
        url: `${origin}${probe.path}`, method: 'POST',
        postData: JSON.stringify(probe.body), maxRedirects: 0, maxRetries: 0, timeout: 10_000,
      });
      try {
        if (response.status() !== 403 || response.url() !== `${origin}${probe.path}`) throw new Error();
        const body = await response.json();
        if (body?.code !== 'FCOS_CI_READ_ONLY') throw new Error();
      } finally {
        await response.dispose();
      }
    } catch {
      throw new Error(`Read-only CI API denial was not proven for ${probe.path}.`);
    }
    results.push({ path: probe.path, status: 403, code: 'FCOS_CI_READ_ONLY' });
  }
  return results;
}
