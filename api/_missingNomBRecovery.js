export function missingNomBRecoveryActions({ enabled, scanLagSeconds, scanLagWarningSeconds, blocked, failed, uncertain, uncertainUploads, stalledDeliveries }) {
  const actions = [];
  if (enabled && (scanLagSeconds == null || scanLagSeconds > scanLagWarningSeconds)) {
    actions.push({ issue: 'Invoice scan behind or unverified', responsibleRole: 'System administrator',
      nextAction: 'Check the protected cron and its last successful checkpoint. Restore scanning from saved progress; do not reset activation or generate a historical email backlog.' });
  }
  if (blocked > 0) actions.push({ issue: 'Blocked reminders', count: blocked, responsibleRole: 'System administrator and buyer-trader manager',
    nextAction: 'Review the redacted reason codes. Resolve missing or ambiguous assignments on the active Buyer Confirmation, or correct unverified delivery evidence. Keep ownership checks enabled.' });
  if (failed > 0) actions.push({ issue: 'Failed reminders', count: failed, responsibleRole: 'System administrator',
    nextAction: 'Check sender configuration, permissions and the email delivery gate. Definite transient failures retain scheduled backoff; do not bypass the delivery ledger.' });
  if (uncertain > 0 || stalledDeliveries > 0) actions.push({ issue: 'Delivery requires verification', count: (uncertain || 0) + (stalledDeliveries || 0), responsibleRole: 'System administrator',
    nextAction: 'Verify Microsoft Graph delivery evidence before any further send. An uncertain or expired sending claim is not proof that no email was delivered.' });
  if (uncertainUploads > 0) actions.push({ issue: 'Filing requires verification', count: uncertainUploads, responsibleRole: 'Buyer trader',
    nextAction: 'In My Commitments → Nom B Filing, recover the original upload with the same file. Salesforce readback must verify document linkage and green Received status before success or another write.' });
  return actions;
}
