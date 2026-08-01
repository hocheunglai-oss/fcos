import { createMicrosoftGraphMailTransport } from './_microsoftGraphMail.js';
import { isExternalActionEnabled } from './_externalActionGates.js';
import { sendWithSmtp, smtpAddressParts, smtpAuthenticatedFromAddress } from './_smtp.js';

const SAFE_GRAPH_FALLBACK_CODES = new Set([
  'VERCEL_OIDC_TOKEN_MISSING',
  'MICROSOFT_GRAPH_MAIL_CONFIG_MISSING',
  'MICROSOFT_GRAPH_TOKEN_FAILED',
  'MICROSOFT_GRAPH_TOKEN_MISSING',
  'MICROSOFT_GRAPH_MAIL_UNAUTHORIZED',
]);

let cachedGraphTransport = null;
let cachedGraphTransportKey = '';

function bool(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function graphConfigFromEnv(env) {
  return {
    tenantId: env.FCOS_OPERATIONAL_MICROSOFT_TENANT_ID || env.FCOS_UPDATE_MICROSOFT_TENANT_ID || '',
    clientId: env.FCOS_OPERATIONAL_MICROSOFT_CLIENT_ID || env.FCOS_UPDATE_MICROSOFT_CLIENT_ID || '',
    mailbox: env.FCOS_OPERATIONAL_MICROSOFT_MAILBOX || '',
  };
}

function smtpConfigFromEnv(env) {
  const port = Number(env.SMTP_PORT || 587);
  return {
    host: env.SMTP_HOST || '',
    port,
    user: env.SMTP_USER || '',
    password: env.SMTP_PASSWORD || '',
    secure: env.SMTP_SECURE != null ? bool(env.SMTP_SECURE) : port === 465,
  };
}

function completeGraphConfig(graph) {
  return Boolean(graph.tenantId && graph.clientId && graph.mailbox);
}

function completeSmtpConfig(smtp) {
  return Boolean(smtp.host && smtp.user && smtp.password);
}

export function operationalMailConfig(env = process.env) {
  const graph = graphConfigFromEnv(env);
  const smtp = smtpConfigFromEnv(env);
  const requestedTransport = String(env.FCOS_OPERATIONAL_TRANSPORT || '').trim().toLowerCase();
  const deliveryMethod = (requestedTransport === 'microsoft_graph' ? 'microsoft_graph_oidc' : requestedTransport)
    || (completeGraphConfig(graph) ? 'microsoft_graph_oidc' : 'smtp');
  const senderName = String(env.FCOS_OPERATIONAL_SENDER_NAME || 'FCOS').trim() || 'FCOS';
  const graphMailbox = smtpAddressParts(graph.mailbox).email.toLowerCase();
  const smtpMailbox = smtpAddressParts(smtp.user).email.toLowerCase();
  const supportedTransport = ['microsoft_graph_oidc', 'smtp'].includes(deliveryMethod);
  const senderAddress = deliveryMethod === 'microsoft_graph_oidc' ? graphMailbox : smtpMailbox;
  let configurationIssue = null;
  if (!supportedTransport) {
    configurationIssue = 'FCOS_OPERATIONAL_TRANSPORT must be microsoft_graph_oidc or smtp.';
  } else if (deliveryMethod === 'microsoft_graph_oidc' && !completeGraphConfig(graph)) {
    configurationIssue = 'The operational Microsoft Graph sender is not fully configured.';
  } else if (deliveryMethod === 'smtp' && !completeSmtpConfig(smtp)) {
    configurationIssue = 'The operational SMTP sender is not fully configured.';
  } else if (!senderAddress) {
    configurationIssue = 'The operational sender mailbox address is invalid.';
  }

  return {
    deliveryMethod,
    senderName,
    senderAddress,
    authenticatedAddress: senderAddress,
    graph: { ...graph, mailbox: graphMailbox || graph.mailbox },
    smtp,
    configured: !configurationIssue,
    configurationIssue,
    fallback: {
      enabled: deliveryMethod === 'microsoft_graph_oidc' && bool(env.FCOS_OPERATIONAL_SMTP_FALLBACK),
      configured: completeSmtpConfig(smtp),
      deliveryMethod: 'smtp',
      authenticatedAddress: smtpMailbox || null,
    },
  };
}

export function operationalMailStatus(env = process.env) {
  const config = operationalMailConfig(env);
  return {
    id: 'operational-email',
    senderName: config.deliveryMethod === 'microsoft_graph_oidc' ? null : config.senderName,
    senderAddress: config.senderAddress || null,
    authenticatedAddress: config.authenticatedAddress || null,
    displayNameMode: config.deliveryMethod === 'microsoft_graph_oidc' ? 'mailbox_managed' : 'workflow_specific',
    deliveryMethod: config.deliveryMethod,
    transportLabel: config.deliveryMethod === 'microsoft_graph_oidc'
      ? 'Microsoft Graph with Vercel OIDC'
      : 'Authenticated SMTP',
    configured: config.configured,
    configurationIssue: config.configurationIssue,
    fallbackEnabled: config.fallback.enabled,
    fallbackConfigured: config.fallback.configured,
    fallbackTransportLabel: config.fallback.enabled ? 'Authenticated SMTP' : null,
    fallbackAddress: config.fallback.enabled ? config.fallback.authenticatedAddress : null,
  };
}

function graphTransportCacheKey(config) {
  return [config.graph.tenantId, config.graph.clientId, config.graph.mailbox].join('|');
}

function cachedTransportUsable(transport) {
  const expiresAt = Date.parse(String(transport?.accessTokenExpiresAt || ''));
  return Number.isFinite(expiresAt) && expiresAt > Date.now() + (5 * 60 * 1000);
}

async function operationalGraphTransport(config, dependencies) {
  if (dependencies.graphTransport) return dependencies.graphTransport;
  if (dependencies.createGraphTransport) {
    return dependencies.createGraphTransport(config.graph, { env: dependencies.env || process.env });
  }
  const key = graphTransportCacheKey(config);
  if (cachedGraphTransportKey === key && cachedTransportUsable(cachedGraphTransport)) {
    return cachedGraphTransport;
  }
  const transport = await createMicrosoftGraphMailTransport(config.graph, { env: dependencies.env || process.env });
  cachedGraphTransport = transport;
  cachedGraphTransportKey = key;
  return transport;
}

function shouldUseSmtpFallback(error, config) {
  return config.fallback.enabled
    && config.fallback.configured
    && SAFE_GRAPH_FALLBACK_CODES.has(String(error?.code || ''));
}

function operationalSmtpFrom(config, requestedFrom) {
  const requested = smtpAddressParts(requestedFrom);
  const name = requested.name || (!requested.email ? String(requestedFrom || '').trim() : '') || config.senderName;
  const candidate = name ? `${name} <${config.fallback.authenticatedAddress || config.senderAddress}>` : config.senderAddress;
  return smtpAuthenticatedFromAddress(config.smtp, candidate) || config.fallback.authenticatedAddress || config.senderAddress;
}

export async function sendOperationalMail(message, dependencies = {}) {
  const env = dependencies.env || process.env;
  const config = operationalMailConfig(env);
  if (!config.configured) {
    const error = new Error(config.configurationIssue || 'The operational email sender is not configured.');
    error.status = 503;
    error.code = 'OPERATIONAL_MAIL_CONFIG_MISSING';
    throw error;
  }

  if (config.deliveryMethod === 'smtp') {
    const from = operationalSmtpFrom(config, message.from);
    const sendSmtp = dependencies.sendSmtp || sendWithSmtp;
    const result = await sendSmtp({ ...message, smtp: config.smtp, from });
    return {
      ...result,
      deliveryMethod: 'smtp',
      from,
      transportFallback: false,
    };
  }

  try {
    const transport = await operationalGraphTransport(config, dependencies);
    const result = await transport.sendMail(message);
    return {
      ...result,
      deliveryMethod: 'microsoft_graph_oidc',
      from: config.senderAddress,
      transportFallback: false,
    };
  } catch (error) {
    if (!shouldUseSmtpFallback(error, config)) throw error;
    const sendSmtp = dependencies.sendSmtp || sendWithSmtp;
    const from = operationalSmtpFrom(config, message.from);
    const result = await sendSmtp({ ...message, smtp: config.smtp, from });
    return {
      ...result,
      deliveryMethod: 'smtp_fallback',
      primaryDeliveryMethod: 'microsoft_graph_oidc',
      from,
      transportFallback: true,
      fallbackReason: String(error.code || 'MICROSOFT_GRAPH_MAIL_UNAVAILABLE'),
    };
  }
}

export function operationalMailDeliveryAvailable(env = process.env) {
  const config = operationalMailConfig(env);
  return config.configured && isExternalActionEnabled('email_delivery', env);
}
