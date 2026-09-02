import { createClient } from '@supabase/supabase-js';
import { serverSupabaseConfig } from './_supabaseConfig.js';
import { enforceFcunoFederatedAccess } from './_fcunoIdentityFederation.js';
import { reportSystemError, shouldNotifySystemError } from './_systemErrorNotifications.js';
import {
  logRequestTelemetry,
  recordRequestFailure,
  recordSupabaseRequest,
  requestIdFrom,
  runWithRequestTelemetry,
  telemetryResponseHeaders,
} from './_requestTelemetry.js';

const MAX_JSON_BODY_BYTES = 256 * 1024;
let cachedClient = null;

function endpointError(message, status = 500, code = 'FCOS_ENDPOINT_ERROR', expose = status < 500) {
  return Object.assign(new Error(message), { status, code, expose });
}

function serviceClient() {
  if (cachedClient) return cachedClient;
  const config = serverSupabaseConfig();
  if (!config.configured) {
    throw endpointError('FCOS server storage is unavailable.', 503, 'FCOS_STORAGE_UNAVAILABLE');
  }
  /** @type {typeof fetch} */
  const trackedFetch = async (input, init) => {
    const startedAt = Date.now();
    try {
      const response = await fetch(input, init);
      recordSupabaseRequest({ durationMs: Date.now() - startedAt, ok: response.ok });
      return response;
    } catch (error) {
      recordSupabaseRequest({ durationMs: Date.now() - startedAt, ok: false });
      throw error;
    }
  };
  cachedClient = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: trackedFetch },
  });
  return cachedClient;
}

function bearerToken(req) {
  const header = req?.headers?.authorization || req?.headers?.Authorization || '';
  return String(header).match(/^Bearer\s+(.+)$/i)?.[1] || null;
}

async function requireActiveUser(req) {
  const token = bearerToken(req);
  if (!token) throw endpointError('Sign-in required.', 401, 'FCOS_SIGN_IN_REQUIRED');
  const client = serviceClient();
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth?.user) {
    throw endpointError('Invalid or expired session. Sign in again.', 401, 'FCOS_SESSION_INVALID');
  }
  const { data: storedProfile, error } = await client
    .from('user_profiles')
    .select('id,email,full_name,user_type,active,use_type_defaults')
    .eq('id', auth.user.id)
    .maybeSingle();
  if (error) throw error;
  const profile = await enforceFcunoFederatedAccess({
    client,
    authUser: auth.user,
    profile: storedProfile,
    accessToken: token,
  });
  if (!profile) throw endpointError('User is not registered.', 403, 'FCOS_USER_UNREGISTERED');
  if (!profile.active) throw endpointError('User is inactive.', 403, 'FCOS_USER_INACTIVE');
  return { client, authUser: auth.user, profile };
}

async function requireModuleAccess(context, moduleId) {
  if (!moduleId || ['administrator', 'general_manager'].includes(context.profile.user_type)) return;
  const table = context.profile.use_type_defaults === false
    ? 'user_module_permissions'
    : 'user_type_module_permissions';
  let query = context.client.from(table).select('can_view').eq('module_id', moduleId);
  query = context.profile.use_type_defaults === false
    ? query.eq('user_id', context.profile.id)
    : query.eq('user_type_id', context.profile.user_type);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (data?.can_view !== true) {
    throw endpointError('You do not have access to this FCOS module.', 403, 'FCOS_MODULE_FORBIDDEN');
  }
}

async function readBody(req) {
  if (req.method === 'GET') return {};
  if (req.body && typeof req.body === 'object') return req.body;
  const rawBody = typeof req.body === 'string'
    ? req.body
    : Buffer.concat(await (async () => {
        const chunks = [];
        let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > MAX_JSON_BODY_BYTES) {
            throw endpointError('Request body is too large.', 413, 'FCOS_REQUEST_TOO_LARGE');
          }
          chunks.push(chunk);
        }
        return chunks;
      })()).toString('utf8');
  if (Buffer.byteLength(rawBody || '', 'utf8') > MAX_JSON_BODY_BYTES) {
    throw endpointError('Request body is too large.', 413, 'FCOS_REQUEST_TOO_LARGE');
  }
  try {
    return rawBody ? JSON.parse(rawBody) : {};
  } catch {
    throw endpointError('Request body must be valid JSON.', 400, 'FCOS_INVALID_JSON');
  }
}

function publicError(error, status, requestId) {
  const expose = status < 500 || error?.expose === true;
  const message = expose
    ? String(error?.message || 'The FCOS request could not be completed.')
    : 'FCOS could not complete this operation. Use the request reference when reporting the problem.';
  return {
    error: message,
    message,
    code: String(error?.code || (status >= 500 ? 'FCOS_INTERNAL_ERROR' : 'FCOS_REQUEST_REJECTED'))
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '_')
      .slice(0, 100),
    requestId,
  };
}

function sendJson(res, payload, status = 200) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  for (const [name, value] of Object.entries(telemetryResponseHeaders())) res.setHeader(name, value);
  res.end(JSON.stringify(payload));
}

/**
 * @param {{
 *   handlerName: string | ((req: import('node:http').IncomingMessage) => string),
 *   moduleId?: string | null,
 *   mutation?: boolean | ((req: import('node:http').IncomingMessage) => boolean),
 *   execute: (body: Record<string, unknown>, req: import('node:http').IncomingMessage, context: {client: ReturnType<typeof serviceClient>, authUser: unknown, profile: Record<string, any>}) => Promise<unknown> | unknown,
 * }} options
 */
export function authenticatedFunction({ handlerName, moduleId = null, mutation = false, execute }) {
  return async function handler(req, res) {
    const requestId = requestIdFrom(req);
    const resolvedHandlerName = typeof handlerName === 'function' ? handlerName(req) : handlerName;
    return runWithRequestTelemetry({ handler: resolvedHandlerName, requestId }, async () => {
      try {
        if (!['GET', 'POST'].includes(req.method)) return sendJson(res, { error: 'Method not allowed.' }, 405);
        const requestMutation = typeof mutation === 'function' ? mutation(req) : mutation;
        res.setHeader('X-FCOS-Handler-Mutation', requestMutation ? '1' : '0');
        res.setHeader('X-FCOS-External-Action', '0');
        const context = await requireActiveUser(req);
        await requireModuleAccess(context, moduleId);
        const result = await execute(await readBody(req), req, context);
        return sendJson(res, result);
      } catch (error) {
        const status = Number(error?.status || error?.statusCode || 500);
        recordRequestFailure(error, status);
        if (shouldNotifySystemError(status)) {
          try {
            await reportSystemError(serviceClient(), {
              handler: resolvedHandlerName,
              error,
              status,
              requestId,
            });
          } catch (notificationError) {
            console.error('[system-error-notification] recording failed', {
              handler: resolvedHandlerName,
              code: notificationError?.code || 'SYSTEM_ERROR_RECORDING_FAILED',
            });
          }
        }
        return sendJson(res, publicError(error, status, requestId), status);
      } finally {
        logRequestTelemetry(res.statusCode || 500);
      }
    });
  };
}
