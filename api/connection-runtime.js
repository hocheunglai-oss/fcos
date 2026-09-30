import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { serverSupabaseConfig } from './_supabaseConfig.js';
import { enforceFcunoFederatedAccess } from './_fcunoIdentityFederation.js';
import { isReadOnlyCiProfile } from './_readOnlyCiAccess.js';
import { probeRuntimeConnections } from './_connectionRuntime.js';

const reject = (status, code) => { throw Object.assign(new Error(code), { status, code }); };
export async function authorizeRuntimeProbe(req, { env = process.env, createClientImpl = createClient } = {}) {
  const token = String(req.headers?.authorization || '').match(/^Bearer\s+([^\s]+)$/i)?.[1];
  if (!token) reject(401, 'RUNTIME_SIGN_IN_REQUIRED');
  const config = serverSupabaseConfig(env);
  if (!config.configured || config.url !== `https://${fcosConnectionIdentifier('supabase', 'Project ref')}.supabase.co`) reject(503, 'RUNTIME_STORAGE_TARGET_UNVERIFIED');
  const client = createClientImpl(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth?.user) reject(401, 'RUNTIME_SESSION_INVALID');
  const { data: profile, error } = await client.from('user_profiles').select('id,email,full_name,user_type,active,use_type_defaults').eq('id', auth.user.id).maybeSingle();
  if (error || profile?.active !== true || !['administrator', 'general_manager'].includes(profile.user_type) || isReadOnlyCiProfile(profile)) reject(403, 'RUNTIME_ADMIN_REQUIRED');
  // Existing federation verifier retains revocation checks. This forced guard
  // refuses first-time binding/provisioning even on a Production diagnostic.
  const resolved = await enforceFcunoFederatedAccess({ client, authUser: auth.user, profile, accessToken: token, env: { ...env, FCOS_ENABLE_READ_ONLY_CI: 'true' } });
  if (!resolved?.active || !['administrator', 'general_manager'].includes(resolved.user_type) || isReadOnlyCiProfile(resolved)) reject(403, 'RUNTIME_ADMIN_REQUIRED');
  return { client, userId: auth.user.id };
}

export function createRuntimeProbeHandler({ env = process.env, authorize = authorizeRuntimeProbe, probe = probeRuntimeConnections,
  readReceipt = () => JSON.parse(readFileSync(join(process.cwd(), 'public', 'app-version.json'), 'utf8')), now = Date.now } = {}) {
  const lastProbe = new Map();
  return async (req, res) => {
    res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store');
    res.setHeader('X-FCOS-Handler-Mutation', '0'); res.setHeader('X-FCOS-External-Action', '0');
    try {
      if (req.method !== 'POST') reject(405, 'RUNTIME_METHOD_NOT_ALLOWED');
      // No streaming or oversized arbitrary body is accepted by this probe.
      if (Number(req.headers?.['content-length'] || 0) > 128 || (typeof req.body === 'string' && Buffer.byteLength(req.body, 'utf8') > 128)) reject(413, 'RUNTIME_REQUEST_TOO_LARGE');
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) || body.action !== 'probe' || Object.keys(body).length !== 1) reject(400, 'RUNTIME_REQUEST_INVALID');
      const context = await authorize(req, { env });
      const time = now();
      if (lastProbe.has(context.userId) && time - lastProbe.get(context.userId) < 5000) reject(429, 'RUNTIME_PROBE_RATE_LIMIT');
      if (lastProbe.size >= 128) lastProbe.delete(lastProbe.keys().next().value);
      lastProbe.set(context.userId, time);
      const result = await probe({ env, client: context.client, receipt: readReceipt(), now: time });
      res.statusCode = 200; res.end(JSON.stringify(result));
    } catch (error) {
      const status = Number(error?.status || 503);
      res.statusCode = status >= 400 && status < 600 ? status : 503;
      const code = /^RUNTIME_[A-Z_]+$/.test(error?.code || '') ? error.code : 'RUNTIME_PROBE_UNAVAILABLE';
      res.end(JSON.stringify({ error: 'Connection runtime probe could not be completed.', code }));
    }
  };
}
export default createRuntimeProbeHandler();
