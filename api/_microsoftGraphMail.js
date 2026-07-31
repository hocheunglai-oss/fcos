import { randomUUID } from 'node:crypto';
import { getVercelOidcToken } from '@vercel/oidc';
import { requireExternalActionGate } from './_externalActionGates.js';

const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
const CLIENT_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

function graphMailError(message, { code, global = false, uncertain = false, status = 502 } = {}) {
  const error = new Error(message);
  error.code = code || 'MICROSOFT_GRAPH_MAIL_ERROR';
  error.status = status;
  error.fcosUpdateGlobal = global;
  error.fcosUpdateUncertain = uncertain;
  return error;
}

function requiredConfigValue(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw graphMailError(`Missing ${label} for FCOS Updates Microsoft 365 OAuth.`, {
      code: 'MICROSOFT_GRAPH_MAIL_CONFIG_MISSING',
      global: true,
      status: 503,
    });
  }
  return normalized;
}

export async function createMicrosoftGraphMailTransport(config, dependencies = {}) {
  requireExternalActionGate('email_delivery', dependencies.env || process.env);
  const tenantId = requiredConfigValue(config?.tenantId, 'Microsoft tenant ID');
  const clientId = requiredConfigValue(config?.clientId, 'Microsoft application client ID');
  const mailbox = requiredConfigValue(config?.mailbox, 'Microsoft sender mailbox').toLowerCase();
  const fetchImpl = dependencies.fetchImpl || fetch;
  const oidcTokenProvider = dependencies.oidcTokenProvider || getVercelOidcToken;

  let assertion;
  try {
    assertion = String(await oidcTokenProvider() || '').trim();
  } catch {
    assertion = '';
  }
  if (!assertion) {
    throw graphMailError('Vercel did not provide the production OIDC identity required for FCOS Updates.', {
      code: 'VERCEL_OIDC_TOKEN_MISSING',
      global: true,
      status: 503,
    });
  }

  const tokenResponse = await fetchImpl(
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        scope: GRAPH_SCOPE,
        grant_type: 'client_credentials',
        client_assertion_type: CLIENT_ASSERTION_TYPE,
        client_assertion: assertion,
      }),
      signal: AbortSignal.timeout(20_000),
    },
  ).catch(() => null);

  if (!tokenResponse?.ok) {
    throw graphMailError(
      'Microsoft 365 OAuth authentication failed for FCOS Updates. Verify the Vercel OIDC trust and Microsoft application configuration.',
      {
        code: 'MICROSOFT_GRAPH_TOKEN_FAILED',
        global: true,
        status: 503,
      },
    );
  }

  const tokenPayload = await tokenResponse.json().catch(() => ({}));
  const accessToken = String(tokenPayload?.access_token || '').trim();
  if (!accessToken) {
    throw graphMailError('Microsoft 365 OAuth returned no access token for FCOS Updates.', {
      code: 'MICROSOFT_GRAPH_TOKEN_MISSING',
      global: true,
      status: 503,
    });
  }

  return {
    method: 'microsoft_graph_oidc',
    authenticatedAddress: mailbox,
    async sendMail({ to, subject, html }) {
      const recipient = String(Array.isArray(to) ? to[0] : to || '').trim().toLowerCase();
      if (!recipient) throw graphMailError('The FCOS Updates recipient is missing.', { status: 400 });
      const requestId = randomUUID();
      let response;
      try {
        response = await fetchImpl(
          `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/sendMail`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'client-request-id': requestId,
            },
            body: JSON.stringify({
              message: {
                subject: String(subject || ''),
                body: { contentType: 'HTML', content: String(html || '') },
                toRecipients: [{ emailAddress: { address: recipient } }],
              },
              saveToSentItems: true,
            }),
            signal: AbortSignal.timeout(30_000),
          },
        );
      } catch {
        throw graphMailError(
          'Microsoft Graph delivery response was unavailable. The message may have been accepted; review this delivery before retrying.',
          { code: 'MICROSOFT_GRAPH_SEND_UNCERTAIN', uncertain: true },
        );
      }

      if (response.status === 202) {
        return { id: requestId, accepted: [recipient], rejected: [] };
      }
      if ([401, 403, 404].includes(response.status)) {
        throw graphMailError(
          'Microsoft 365 has not authorized FCOS Updates to send from the configured mailbox. Verify the scoped Application Mail.Send assignment and wait for Exchange permission propagation before retrying.',
          { code: 'MICROSOFT_GRAPH_MAIL_UNAUTHORIZED', global: true, status: 503 },
        );
      }
      if (response.status === 429) {
        throw graphMailError(
          'Microsoft Graph temporarily throttled FCOS Updates. Wait before retrying the batch.',
          { code: 'MICROSOFT_GRAPH_MAIL_THROTTLED', global: true, status: 503 },
        );
      }
      if (response.status >= 500) {
        throw graphMailError(
          'Microsoft Graph returned an uncertain delivery response. Review this delivery before retrying.',
          { code: 'MICROSOFT_GRAPH_SEND_UNCERTAIN', uncertain: true },
        );
      }
      throw graphMailError('Microsoft Graph rejected this FCOS Updates recipient.', {
        code: 'MICROSOFT_GRAPH_RECIPIENT_REJECTED',
        status: 400,
      });
    },
    close() {},
  };
}
