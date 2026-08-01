import { randomUUID } from 'node:crypto';
import { getVercelOidcToken } from '@vercel/oidc';
import { requireExternalActionGate } from './_externalActionGates.js';

const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
const CLIENT_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function graphMailError(message, { code, global = false, uncertain = false, status = 502 } = {}) {
  const error = new Error(message);
  error.code = code || 'MICROSOFT_GRAPH_MAIL_ERROR';
  error.status = status;
  error.fcosUpdateGlobal = global;
  error.fcosUpdateUncertain = uncertain;
  error.mailDeliveryGlobal = global;
  error.mailDeliveryUncertain = uncertain;
  return error;
}

function requiredConfigValue(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw graphMailError(`Missing ${label} for Microsoft 365 OAuth email delivery.`, {
      code: 'MICROSOFT_GRAPH_MAIL_CONFIG_MISSING',
      global: true,
      status: 503,
    });
  }
  return normalized;
}

function graphRecipients(value) {
  const inputs = Array.isArray(value) ? value : value == null ? [] : [value];
  const addresses = inputs.flatMap((entry) => String(entry || '').match(EMAIL_PATTERN) || []);
  return [...new Set(addresses.map((address) => address.toLowerCase()))];
}

function graphRecipientRows(addresses) {
  return addresses.map((address) => ({ emailAddress: { address } }));
}

async function acquireMicrosoftGraphMailToken(config, dependencies = {}) {
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
    throw graphMailError('Vercel did not provide the production OIDC identity required for Microsoft 365 email delivery.', {
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
      'Microsoft 365 OAuth authentication failed. Verify the Vercel OIDC trust and Microsoft application configuration.',
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
    throw graphMailError('Microsoft 365 OAuth returned no access token for email delivery.', {
      code: 'MICROSOFT_GRAPH_TOKEN_MISSING',
      global: true,
      status: 503,
    });
  }

  const expiresIn = Number(tokenPayload?.expires_in);
  return {
    accessToken,
    mailbox,
    accessTokenExpiresAt: Number.isFinite(expiresIn) && expiresIn > 0
      ? new Date(Date.now() + (expiresIn * 1000)).toISOString()
      : null,
  };
}

export async function verifyMicrosoftGraphMailAuthentication(config, dependencies = {}) {
  const authentication = await acquireMicrosoftGraphMailToken(config, dependencies);
  return {
    method: 'microsoft_graph_oidc',
    authenticatedAddress: authentication.mailbox,
    accessTokenExpiresAt: authentication.accessTokenExpiresAt,
  };
}

export async function createMicrosoftGraphMailTransport(config, dependencies = {}) {
  requireExternalActionGate('email_delivery', dependencies.env || process.env);
  const authentication = await acquireMicrosoftGraphMailToken(config, dependencies);
  const { accessToken, mailbox } = authentication;
  const fetchImpl = dependencies.fetchImpl || fetch;

  return {
    method: 'microsoft_graph_oidc',
    authenticatedAddress: mailbox,
    accessTokenExpiresAt: authentication.accessTokenExpiresAt,
    async sendMail({ to, cc, bcc, subject, html, text }) {
      const toRecipients = graphRecipients(to);
      const ccRecipients = graphRecipients(cc);
      const bccRecipients = graphRecipients(bcc);
      if (!toRecipients.length) throw graphMailError('The email recipient is missing.', { status: 400 });
      const accepted = [...new Set([...toRecipients, ...ccRecipients, ...bccRecipients])];
      const hasHtml = String(html || '').trim().length > 0;
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
                body: {
                  contentType: hasHtml ? 'HTML' : 'Text',
                  content: hasHtml ? String(html || '') : String(text || ''),
                },
                toRecipients: graphRecipientRows(toRecipients),
                ccRecipients: graphRecipientRows(ccRecipients),
                bccRecipients: graphRecipientRows(bccRecipients),
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
        return { id: requestId, accepted, rejected: [] };
      }
      if ([401, 403, 404].includes(response.status)) {
        throw graphMailError(
          'Microsoft 365 has not authorized FCOS to send from the configured mailbox. Verify the scoped Application Mail.Send assignment and wait for Exchange permission propagation before retrying.',
          { code: 'MICROSOFT_GRAPH_MAIL_UNAUTHORIZED', global: true, status: 503 },
        );
      }
      if (response.status === 429) {
        throw graphMailError(
          'Microsoft Graph temporarily throttled FCOS email delivery. Wait before retrying.',
          { code: 'MICROSOFT_GRAPH_MAIL_THROTTLED', global: true, status: 503 },
        );
      }
      if (response.status >= 500) {
        throw graphMailError(
          'Microsoft Graph returned an uncertain delivery response. Review this delivery before retrying.',
          { code: 'MICROSOFT_GRAPH_SEND_UNCERTAIN', uncertain: true },
        );
      }
      throw graphMailError('Microsoft Graph rejected this email recipient.', {
        code: 'MICROSOFT_GRAPH_RECIPIENT_REJECTED',
        status: 400,
      });
    },
    close() {},
  };
}
