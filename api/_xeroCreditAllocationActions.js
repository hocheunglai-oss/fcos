import { requireDeploymentMutationAllowed } from './_deploymentReadOnly.js';
import { isExternalActionEnabled, requireExternalActionGate } from './_externalActionGates.js';
import { getFreshXeroConnection, readStoredXeroConnection, splitScopes, xeroContactSyncServiceClient } from './_xeroContactSync.js';
import { resolveCreditAllocationSourceId } from './_xeroCreditAllocationSource.js';
import { loadCreditAllocationReview } from './_xeroCreditAllocationContext.js';
import { creditAllocationLedgerFor } from './_xeroCreditAllocationLedger.js';
import { xeroPrepaymentEvidenceFingerprint } from './_xeroPrepaymentCurrency.js';
import { executeXeroCreditAllocation } from './_xeroPrepaymentExecution.js';
import { createXeroCreditAllocationTransport } from './_xeroPrepaymentTransport.js';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const SOURCE_ID = /^[a-z0-9]{15}(?:[a-z0-9]{3})?$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const isId = (value, pattern) => typeof value === 'string' && pattern.test(value);

function fail(message, code, status = 409) {
  throw Object.assign(new Error(message), { code: `XERO_CREDIT_ALLOCATION_${code}`, status, expose: status < 500 });
}

function selection(body) {
  if (!['Invoice__c', 'Supplier_Invoice__c'].includes(body.sourceObject) || !isId(body.creditId, SOURCE_ID)) {
    fail('Select one exact Salesforce credit note.', 'SCOPE_INVALID', 400);
  }
  return { sourceObject: body.sourceObject, creditId: body.creditId };
}

function approved(body) {
  if (body.reviewed !== true || !isId(body.operationId, UUID) || !isId(body.reviewFingerprint, SHA256)) {
    fail('Explicitly approve the exact credit allocation review.', 'REVIEW_REQUIRED', 400);
  }
  return { reviewed: true, operationId: body.operationId, reviewFingerprint: body.reviewFingerprint };
}

async function setup(body, options, { apply = false, recovery = false } = {}) {
  const { accessContext, env = process.env, fetchImpl, getConnection = getFreshXeroConnection } = options;
  requireDeploymentMutationAllowed(true, env);
  const actorId = accessContext?.profile?.id;
  if (!isId(actorId, UUID)) fail('An active Finance profile is required.', 'ACTOR_REQUIRED', 403);
  if (!isId(body.tenantId, UUID) || (env.XERO_TENANT_ID && body.tenantId !== env.XERO_TENANT_ID)) {
    fail('The selected Xero tenant could not be verified.', 'TENANT_CHANGED');
  }
  if (apply) {
    if (env.FCOS_ENABLE_XERO_CREDIT_ALLOCATIONS !== 'true') fail('New Xero credit allocations are disabled.', 'DISABLED', 403);
    requireExternalActionGate('xero_financial_sync', env);
  }
  const client = options.client || xeroContactSyncServiceClient(env);
  const connection = await getConnection(client, { env, fetchImpl });
  if (connection?.tenantId !== body.tenantId) fail('The selected Xero tenant changed.', 'TENANT_CHANGED');
  const scopes = new Set(splitScopes(connection.scope || ''));
  const broadWrite = scopes.has('accounting.transactions');
  const broadRead = broadWrite || scopes.has('accounting.transactions.read');
  const canRead = resource => scopes.has(`accounting.${resource}`) || scopes.has(`accounting.${resource}.read`);
  if ((!recovery && !canRead('settings'))
      || (!broadRead && (!canRead('invoices') || (!recovery && !canRead('payments'))))
      || (apply && !broadWrite && !scopes.has('accounting.invoices'))) {
    fail('The Xero connection lacks the required credit allocation scopes.', 'SCOPE_MISSING');
  }
  return { actorId, client, connection, env, fetchImpl };
}

function reviewLoader(dependencies, loadReview = loadCreditAllocationReview) {
  return ({ sourceObject, creditId, reviewFingerprint }, execution) => loadReview(sourceObject, creditId, dependencies, {
    ignoreOperationId: execution?.ignoreOperationId,
    actorId: dependencies.actorId,
    reviewFingerprint,
  });
}

function receipt({ operationId, status }) {
  return { operationId, status };
}

export async function xeroCreditAllocationPreview(body = {}, options = {}) {
  const deps = await setup(body, options);
  const creditId = body.creditId ?? await (options.resolveCreditId || resolveCreditAllocationSourceId)(body.sourceObject, body.creditNumber);
  const selected = selection({ sourceObject: body.sourceObject, creditId });
  const review = await reviewLoader(deps, options.loadReview)(selected);
  const { creditId: verifiedId, creditNumber, originalNumber, currency, amount, accountingUsd, residualCredit,
    allocationDate, status, reviewFingerprint, blockers } = review;
  return { ...selected, creditId: verifiedId ?? selected.creditId, tenantId: deps.connection.tenantId,
    creditNumber, originalNumber, currency, amount, accountingUsd, residualCredit, allocationDate, status,
    reviewFingerprint, blockers, writeEnabled: deps.env.FCOS_ENABLE_XERO_CREDIT_ALLOCATIONS === 'true'
      && isExternalActionEnabled('xero_financial_sync', deps.env) };
}

export async function xeroCreditAllocationApply(body = {}, options = {}) {
  const selected = selection(body);
  const approval = approved(body);
  const deps = await setup(body, options, { apply: true });
  const ledger = (options.ledgerFor || creditAllocationLedgerFor)(deps.client, deps.actorId);
  const transport = (options.transportFor || createXeroCreditAllocationTransport)(deps);
  return receipt(await executeXeroCreditAllocation({ ...selected, ...approval }, {
    ...transport, tenantId: deps.connection.tenantId, actorId: deps.actorId, ledger,
    loadReview: reviewLoader(deps, options.loadReview),
  }));
}

function ownedRequest(row, tenantId, actorId) {
  const request = row?.request_evidence;
  if (!request || row.tenant_id !== tenantId || row.reviewed_by !== actorId
      || !isId(row.operation_id, UUID) || !isId(row.request_hash, SHA256)
      || !isId(request.reviewFingerprint, SHA256) || !isId(request.creditId, SOURCE_ID)
      || request.action !== 'credit_allocate' || row.request_hash !== xeroPrepaymentEvidenceFingerprint(request)
      || row.credit_mapping_id !== request.creditMappingId || row.invoice_mapping_id !== request.invoiceMappingId) {
    fail('The original credit allocation could not be verified for this Finance user.', 'OPERATION_MISMATCH');
  }
  return request;
}

export async function xeroCreditAllocationRecoveryQueue(body = {}, options = {}) {
  const deps = await setup(body, { ...options, getConnection: options.getStoredConnection || readStoredXeroConnection }, { recovery: true });
  const tenantId = deps.connection.tenantId;
  const ledger = (options.ledgerFor || creditAllocationLedgerFor)(deps.client, deps.actorId);
  const { rows, hasMore } = await ledger.listUnresolved(tenantId);
  return { tenantId, hasMore, rows: rows.map(row => {
    const request = ownedRequest(row, tenantId, deps.actorId);
    return { operationId: row.operation_id, reviewFingerprint: request.reviewFingerprint,
      creditNumber: request.creditNumber || request.creditId, status: row.status };
  }) };
}

export async function xeroCreditAllocationReconcile(body = {}, options = {}) {
  const approval = approved(body);
  const deps = await setup(body, options, { recovery: true });
  const tenantId = deps.connection.tenantId;
  const ledger = (options.ledgerFor || creditAllocationLedgerFor)(deps.client, deps.actorId);
  const key = { tenantId, operationId: approval.operationId };
  const saved = await ledger.get(key);
  const request = ownedRequest(saved, tenantId, deps.actorId);
  const matches = row => row && row.tenant_id === tenantId && row.operation_id === approval.operationId
    && row.reviewed_by === deps.actorId && row.request_evidence?.reviewFingerprint === approval.reviewFingerprint
    && row.request_hash === saved?.request_hash && row.request_hash === xeroPrepaymentEvidenceFingerprint(row.request_evidence)
    && row.credit_mapping_id === row.request_evidence.creditMappingId
    && row.invoice_mapping_id === row.request_evidence.invoiceMappingId;
  if (!matches(saved)) fail('The original credit allocation could not be verified for this Finance user.', 'OPERATION_MISMATCH');
  if (saved.status === 'cancelled_before_send') return receipt({ operationId: saved.operation_id, status: saved.status });
  if (saved.status === 'processing' && !saved.send_started_at) {
    let current;
    try {
      current = (await ledger.cancel({ ...key, requestHash: saved.request_hash,
        responseEvidence: { code: 'XERO_CREDIT_ALLOCATION_CANCELLED_BEFORE_SEND' } }))?.operation;
    } catch { /* Verify the original row when the cancellation acknowledgement was lost. */ }
    if (!matches(current) || current.status !== 'cancelled_before_send') current = await ledger.get(key);
    if (!matches(current) || current.status !== 'cancelled_before_send' || current.send_started_at) {
      fail('The original credit allocation state changed during cancellation. Reload the operation.', 'RECOVERY_RACE');
    }
    return receipt({ operationId: current.operation_id, status: current.status });
  }
  const transport = (options.transportFor || createXeroCreditAllocationTransport)(deps);
  return receipt(await executeXeroCreditAllocation({ ...approval, creditId: request.creditId }, {
    ...transport, tenantId, actorId: deps.actorId, ledger, recoveryOnly: true,
  }));
}
