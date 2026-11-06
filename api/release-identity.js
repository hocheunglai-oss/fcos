import { createRequire } from 'node:module';
import { withDeploymentRequestSafety } from './_deploymentReadOnly.js';

const require = createRequire(import.meta.url);
const receipt = require('./_runtime-build-receipt.json');

/** Public, embedded build evidence. Never resolve identity from runtime env. */
export function publicReleaseIdentity(value = receipt) {
  return Object.freeze({ schemaVersion: 1,
    buildId: typeof value?.buildId === 'string' && /^[a-zA-Z0-9._:-]{1,160}$/.test(value.buildId) ? value.buildId : null,
    commit: typeof value?.commit === 'string' && /^[a-f0-9]{40}$/.test(value.commit) ? value.commit : null,
    sourceDigest: typeof value?.sourceDigest === 'string' && /^[a-f0-9]{64}$/.test(value.sourceDigest) ? value.sourceDigest : null });
}

export default withDeploymentRequestSafety(function releaseIdentity(req, res) {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('X-FCOS-Handler-Mutation', '0');
  res.setHeader('X-FCOS-External-Action', '0');
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('allow', 'GET');
    return res.end(JSON.stringify({ error: 'Method not allowed.' }));
  }
  res.statusCode = 200;
  return res.end(JSON.stringify(publicReleaseIdentity()));
});
