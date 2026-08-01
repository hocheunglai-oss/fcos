import { isExternalActionEnabled } from './_externalActionGates.js';
import { graphEmailApplicationConfig, sendGraphPurposeMail } from './_graphEmail.js';

export function operationalMailConfig(env = process.env) {
  const graph = graphEmailApplicationConfig(env);
  return {
    deliveryMethod: 'microsoft_graph_oidc',
    configured: graph.configured,
    configurationIssue: graph.configured
      ? null
      : 'The Microsoft Graph email application is not fully configured.',
    graph,
    senderAddress: null,
    authenticatedAddress: null,
  };
}

export function operationalMailStatus(env = process.env) {
  const config = operationalMailConfig(env);
  return {
    id: 'graph-email-routing',
    senderName: null,
    senderAddress: null,
    authenticatedAddress: null,
    displayNameMode: 'mailbox_managed',
    deliveryMethod: 'microsoft_graph_oidc',
    transportLabel: 'Microsoft Graph with Vercel OIDC',
    configured: config.configured,
    configurationIssue: config.configurationIssue,
  };
}

export async function sendOperationalMail(message, dependencies = {}) {
  const purposeKey = dependencies.purposeKey;
  if (!purposeKey) {
    const error = new Error('An email purpose is required before Microsoft Graph delivery.');
    error.status = 500;
    error.code = 'EMAIL_PURPOSE_REQUIRED';
    throw error;
  }
  return sendGraphPurposeMail({
    client: dependencies.client,
    purposeKey,
    message,
    mailboxSnapshot: dependencies.mailboxSnapshot || null,
  }, dependencies);
}

export function operationalMailDeliveryAvailable(env = process.env) {
  const config = graphEmailApplicationConfig(env);
  return config.configured && isExternalActionEnabled('email_delivery', env);
}
