import { timingSafeEqual } from 'node:crypto';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';
import { currentDeploymentRequestSafety } from './_deploymentReadOnly.js';

const canonicalOrigin = new URL(FCOS_CONNECTION_POLICY.attestation.endpoint).origin;
const cronPath = '/api/functions/marketReportDriveSyncCron';
export const deploymentHeader = 'x-fcos-market-cron-deployment';

export function marketCronDeploymentId(env = process.env) {
  return /^dpl_[A-Za-z0-9]+$/.test(env.VERCEL_DEPLOYMENT_ID || '') ? env.VERCEL_DEPLOYMENT_ID : null;
}

export async function relayLiveMarketCron(req, {
  env = process.env, safety = currentDeploymentRequestSafety(), fetchImpl = fetch,
} = {}) {
  const id = marketCronDeploymentId(env);
  if (!id || env.VERCEL_ENV !== 'production' || safety?.reason !== 'noncanonical_or_unknown_host'
      || !safety.hostname || safety.hostname !== env.VERCEL_URL
      || req.method !== 'GET' || req.url !== cronPath || req.headers[deploymentHeader]) return null;

  const authorization = req.headers.authorization;
  if (!env.CRON_SECRET || typeof authorization !== 'string') return null;
  const received = Buffer.from(authorization);
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;

  // A Production-configured staged build also has CRON_SECRET. It must prove
  // that the canonical domain already serves this exact deployment before relay.
  const live = await fetchImpl(new URL('/api/release-identity', canonicalOrigin), {
    redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(4500),
  });
  const isLive = live.ok && live.headers.get(deploymentHeader) === id;
  await live.body?.cancel();
  if (!isLive) return null;

  return fetchImpl(new URL(cronPath, canonicalOrigin), {
    headers: { authorization, [deploymentHeader]: id },
    redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(240000),
  });
}
