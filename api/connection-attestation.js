import { createPublicKey, verify as verifySignature } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { serverSupabaseConfig } from './_supabaseConfig.js';
import {
  CONNECTION_ATTESTATION_POLICY,
  canonicalConnectionAttestation,
  sanitizeConnectionAttestation,
} from '../src/lib/connectionChecklist.js';

const MAX_BODY_BYTES = 96 * 1024;

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.end(JSON.stringify(payload));
}

async function requestBody(req) {
  const contentLength = Number(req.headers?.['content-length'] || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw Object.assign(new Error('Attestation request is too large.'), { status: 413 });
  }
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body) > MAX_BODY_BYTES) throw Object.assign(new Error('Attestation request is too large.'), { status: 413 });
    return JSON.parse(req.body || '{}');
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw Object.assign(new Error('Attestation request is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function validatedEnvelope(value, now = new Date(), publicKeySpkiBase64 = CONNECTION_ATTESTATION_POLICY.publicKeySpkiBase64) {
  const attestation = sanitizeConnectionAttestation(value?.attestation);
  const signature = typeof value?.signature === 'string' && /^[A-Za-z0-9_-]{86}$/.test(value.signature)
    ? value.signature
    : '';
  if (!attestation || !signature) throw Object.assign(new Error('Invalid connection attestation envelope.'), { status: 400 });

  const nowMs = now.getTime();
  const verifiedMs = new Date(attestation.verifiedAt).getTime();
  const expiresMs = new Date(attestation.expiresAt).getTime();
  const skewMs = CONNECTION_ATTESTATION_POLICY.maxClockSkewSeconds * 1000;
  const maximumLifetimeMs = CONNECTION_ATTESTATION_POLICY.staleSeconds * 1000;
  if (Math.abs(nowMs - verifiedMs) > skewMs || expiresMs <= nowMs || expiresMs - verifiedMs > maximumLifetimeMs + skewMs) {
    throw Object.assign(new Error('Connection attestation timestamp is outside the accepted window.'), { status: 400 });
  }

  const publicKey = createPublicKey({
    key: Buffer.from(publicKeySpkiBase64, 'base64'),
    format: 'der',
    type: 'spki',
  });
  const valid = verifySignature(
    null,
    Buffer.from(canonicalConnectionAttestation(attestation)),
    publicKey,
    Buffer.from(signature, 'base64url'),
  );
  if (!valid) throw Object.assign(new Error('Connection attestation signature is invalid.'), { status: 401 });
  return attestation;
}

function serviceClient() {
  const config = serverSupabaseConfig();
  if (!config.configured) throw Object.assign(new Error('Connection attestation storage is unavailable.'), { status: 503 });
  return createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  try {
    const attestation = validatedEnvelope(await requestBody(req));
    const { data, error } = await serviceClient().rpc('save_connection_attestation', { p_attestation: attestation });
    if (error) {
      if (error.code === '23505') return json(res, 409, { error: 'This connection attestation was already recorded.' });
      throw error;
    }
    const record = Array.isArray(data) ? data[0] : data;
    return json(res, 201, {
      ok: true,
      revision: record?.revision ?? null,
      verifiedAt: attestation.verifiedAt,
    });
  } catch (error) {
    const status = Number(error?.status || error?.statusCode || 500);
    return json(res, status >= 400 && status < 600 ? status : 500, {
      error: status < 500 ? error.message : 'Connection attestation could not be recorded.',
    });
  }
}

export { validatedEnvelope };
