import { isExternalActionEnabled } from './_externalActionGates.js';
import { fcosUpdateMailConfig } from './_fcosUpdates.js';
import { smtpAddressParts } from './_smtp.js';

export function emailSenderStatus(env = process.env) {
  const deliveryGateEnabled = isExternalActionEnabled('email_delivery', env);
  const operationalAddress = smtpAddressParts(env.SMTP_USER).email.toLowerCase();
  const operationalConfigured = Boolean(
    env.SMTP_HOST
    && operationalAddress
    && env.SMTP_PASSWORD
  );
  const updateConfig = fcosUpdateMailConfig(env);
  const updateConfigured = updateConfig.deliveryMethod === 'microsoft_graph_oidc'
    ? Boolean(
        updateConfig.graph.tenantId
        && updateConfig.graph.clientId
        && updateConfig.graph.mailbox
        && updateConfig.senderAddress
        && !updateConfig.configurationIssue
      )
    : Boolean(
        updateConfig.smtp.host
        && updateConfig.smtp.user
        && updateConfig.smtp.password
        && updateConfig.senderAddress
        && !updateConfig.configurationIssue
      );

  return {
    deliveryGateEnabled,
    operational: {
      id: 'operational-email',
      senderName: null,
      senderAddress: operationalAddress || null,
      authenticatedAddress: operationalAddress || null,
      displayNameMode: 'workflow_specific',
      deliveryMethod: 'smtp',
      transportLabel: 'Authenticated SMTP',
      configured: operationalConfigured,
      configurationIssue: operationalConfigured ? null : 'The shared SMTP mailbox is not fully configured.',
    },
    fcosUpdates: {
      id: 'fcos-updates-email',
      senderName: updateConfig.senderName || null,
      senderAddress: updateConfig.senderAddress || null,
      authenticatedAddress: updateConfig.authenticatedAddress || null,
      displayNameMode: 'fixed',
      deliveryMethod: updateConfig.deliveryMethod,
      transportLabel: updateConfig.deliveryMethod === 'microsoft_graph_oidc'
        ? 'Microsoft Graph with Vercel OIDC'
        : 'Authenticated SMTP',
      configured: updateConfigured,
      configurationIssue: updateConfig.configurationIssue || (updateConfigured ? null : 'The FCOS Updates sender is not fully configured.'),
      requiresSendAs: updateConfig.requiresSendAs,
    },
    authorityNote: 'The General Manager controls FCOS Updates sending authority. The sender mailbox is configured separately in Vercel and does not change when the General Manager changes.',
  };
}
