import { requireDeploymentMutationAllowed } from './_deploymentReadOnly.js';
import { requireExternalActionGate } from './_externalActionGates.js';
import { getFreshXeroConnection, readStoredXeroConnection, splitScopes, xeroContactSyncServiceClient } from './_xeroContactSync.js';
import { readNativeFinancialDocumentReview } from './_xeroFinancialSync.js';
import { executeNativeDocumentDraft } from './_xeroNativeDocumentExecution.js';
import { nativeDocumentLedgerFor } from './_xeroNativeDocumentLedger.js';
import { loadPrepaymentPostingSettings, validatePrepaymentPostingEvidence } from './_xeroPrepaymentPolicy.js';
import { createXeroNativeDocumentTransport } from './_xeroPrepaymentTransport.js';
import { previewEvidenceHash } from './_xeroPreviewPersistence.js';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const SOURCE_ID = /^[a-z0-9]{15}(?:[a-z0-9]{3})?$/i;
const SHA = /^[a-f0-9]{64}$/;
const matches = (value, pattern) => typeof value === 'string' && pattern.test(value);
const validSource = (object, id) => ['Invoice__c', 'Supplier_Invoice__c'].includes(object) && matches(id, SOURCE_ID);

function fail(code, message, status = 409) {
  throw Object.assign(new Error(message), { code: `XERO_NATIVE_DOCUMENT_${code}`, status });
}

function scope(tenantId, { accessContext, env = process.env } = {}) {
  requireDeploymentMutationAllowed(true, env);
  const actorId = accessContext?.profile?.id;
  if (!matches(actorId, UUID)) fail('ACTOR_REQUIRED', 'An active Finance profile is required.', 403);
  if (!matches(tenantId, UUID) || (env.XERO_TENANT_ID && tenantId !== env.XERO_TENANT_ID)) {
    fail('TENANT_CHANGED', 'The selected Xero tenant could not be verified.');
  }
  return { actorId, env };
}

function setup(body, options) {
  const { accessContext, fetchImpl, getConnection = getFreshXeroConnection } = options;
  const { tenantId, sourceObject, sourceId, operationId, reviewFingerprint, reviewed } = body;
  const { actorId, env } = scope(tenantId, options);
  if (reviewed !== true || !validSource(sourceObject, sourceId) || !matches(operationId, UUID) || !matches(reviewFingerprint, SHA)) {
    fail('REVIEW_REQUIRED', 'Select one exact reviewed native document operation.', 400);
  }
  const connect = async (client, write) => {
    const connection = await getConnection(client, { env, fetchImpl });
    if (connection?.tenantId !== tenantId) fail('TENANT_CHANGED', 'The selected Xero tenant changed.');
    const scopes = splitScopes(connection.scope || '');
    const allowed = ['accounting.invoices', 'accounting.transactions', ...(write ? [] : ['accounting.invoices.read', 'accounting.transactions.read'])];
    if (!allowed.some(scope => scopes.includes(scope))) {
      fail('SCOPE_MISSING', 'The Xero connection lacks the required native document scope.');
    }
    return connection;
  };
  return { operation: { sourceObject, sourceId, operationId, reviewFingerprint, reviewed },
    actorId, tenantId, accessContext, env, fetchImpl, connect };
}

async function verifyRoundingAccount(policy, connection, dependencies, readSettings) {
  const { accounts, taxes } = await readSettings(connection, dependencies);
  try {
    validatePrepaymentPostingEvidence(policy, accounts, taxes);
  } catch {
    fail('ROUNDING_POLICY_CHANGED', 'The reviewed Xero rounding account or zero tax rate changed.');
  }
}

export async function xeroNativeDocumentApply(body = {}, options = {}) {
  const { operation, actorId, tenantId, accessContext, env, fetchImpl, connect } = setup(body, options);
  requireExternalActionGate('xero_financial_sync', env);
  requireExternalActionGate('xero_trading_fx_writes', env);
  const client = options.client || xeroContactSyncServiceClient(env);
  const connection = await connect(client, true);
  const dependencies = { accessContext, client, connection, env, fetchImpl };
  const ledger = (options.ledgerFor || nativeDocumentLedgerFor)(client, actorId);
  const transport = (options.transportFor || createXeroNativeDocumentTransport)(dependencies);
  const readReview = options.readReview || readNativeFinancialDocumentReview;
  const readSettings = options.readSettings || loadPrepaymentPostingSettings;
  return executeNativeDocumentDraft(operation, {
    ...transport, actorId, tenantId, ledger,
    loadReview: async ({ sourceObject, sourceId }) => (await readReview({ sourceObject, documentId: sourceId, tenantId }, dependencies)).privateReview,
    prepareSend: async (original) => {
      const policy = original.request_evidence.source.roundingAdjustment?.policy;
      if (policy) await verifyRoundingAccount(policy, connection, { env, fetchImpl }, readSettings);
      await transport.prepareSend(original);
    },
  });
}

export async function xeroNativeDocumentReconcile(body = {}, options = {}) {
  const { operation, actorId, tenantId, env, fetchImpl, connect } = setup(body, options);
  const client = options.client || xeroContactSyncServiceClient(env);
  const ledger = (options.ledgerFor || nativeDocumentLedgerFor)(client, actorId);
  let transport;
  const getTransport = () => transport ||= connect(client, false).then(connection =>
    (options.transportFor || createXeroNativeDocumentTransport)({ client, connection, env, fetchImpl }));
  return executeNativeDocumentDraft(operation, {
    actorId, tenantId, ledger, recoveryOnly: true,
    readOutcome: async (...args) => (await getTransport()).readOutcome(...args),
    settle: async (...args) => (await getTransport()).settle(...args),
  });
}

export async function xeroNativeDocumentRecoveryQueue({ tenantId } = {}, options = {}) {
  const { actorId, env } = scope(tenantId, options);
  const client = options.client || xeroContactSyncServiceClient(env);
  const connection = await (options.getStoredConnection || readStoredXeroConnection)(client);
  if (connection?.tenantId !== tenantId) fail('TENANT_CHANGED', 'The selected Xero tenant changed.');
  const ledger = (options.ledgerFor || nativeDocumentLedgerFor)(client, actorId);
  const { rows, hasMore } = await ledger.listUnresolved(tenantId);
  return { tenantId, hasMore, rows: rows.map(row => {
    const { operation_id: operationId, source_id: sourceId, source_object: sourceObject,
      review_fingerprint: reviewFingerprint, document_number: documentNumber, status, request_evidence: request } = row;
    if (!request || row.tenant_id !== tenantId || row.actor_id !== actorId || !validSource(sourceObject, sourceId)
        || !matches(operationId, UUID) || !matches(reviewFingerprint, SHA) || !matches(row.request_hash, SHA)
        || request.sourceId !== sourceId || request.sourceObject !== sourceObject || request.tenantId !== tenantId
        || request.draft?.reviewFingerprint !== reviewFingerprint || row.request_hash !== previewEvidenceHash(request)
        || typeof documentNumber !== 'string' || !documentNumber.trim()
        || documentNumber !== request.source?.record?.Name || !['intent', 'sent', 'unknown'].includes(status)) {
      fail('OPERATION_MISMATCH', 'The original native document operation could not be verified.');
    }
    return { operationId, sourceId, sourceObject, reviewFingerprint, documentNumber, status };
  }) };
}
