import { requireDeploymentMutationAllowed } from './_deploymentReadOnly.js';
import { isExternalActionEnabled, requireExternalActionGate } from './_externalActionGates.js';
import { getFreshXeroConnection, readStoredXeroConnection, splitScopes, xeroContactSyncServiceClient } from './_xeroContactSync.js';
import { loadPrepaymentContactChoices, loadPrepaymentQueueContext, loadXeroPrepaymentReviewContext, resolvePrepaymentStemKey } from './_xeroPrepaymentContext.js';
import { requireSupportedXeroPrepaymentCurrency } from './_xeroPrepaymentCurrency.js';
import { executeXeroPrepayment } from './_xeroPrepaymentExecution.js';
import { prepaymentLedgerFor } from './_xeroPrepaymentLedger.js';
import { buildPrepaymentReview } from './_xeroPrepaymentReview.js';
import { createXeroPrepaymentTransport } from './_xeroPrepaymentTransport.js';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const SALESFORCE_ID = /^[a-z0-9]{15}(?:[a-z0-9]{3})?$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const ACTIONS = ['create', 'allocate', 'reverse', 'refund'];

function fail(message, code, status = 409) {
  throw Object.assign(new Error(message), { code, status, expose: status < 500 });
}

function isId(value, pattern) {
  return typeof value === 'string' && pattern.test(value);
}

function writeEnabled(env) {
  return env.FCOS_ENABLE_XERO_PREPAYMENTS === 'true' && isExternalActionEnabled('xero_financial_sync', env);
}

function selection(body) {
  if (!isId(body.stemId, SALESFORCE_ID) || !isId(body.sourceId, SALESFORCE_ID) || !ACTIONS.includes(body.action)
    || (body.action === 'create' && !isId(body.contactId, UUID))) {
    fail('Select an exact STEM, cash source and Xero contact where required.', 'XERO_PREPAYMENT_SCOPE_INVALID', 400);
  }
  return { stemId: body.stemId, sourceId: body.sourceId, action: body.action,
    ...(body.action === 'create' ? { contactId: body.contactId } : {}) };
}

function requireScopes(connection, action = null, recovery = false) {
  const scopes = new Set(splitScopes(connection.scope || ''));
  const broadRead = scopes.has('accounting.transactions') || scopes.has('accounting.transactions.read');
  const broadWrite = scopes.has('accounting.transactions');
  const read = (resource) => scopes.has(`accounting.${resource}`) || scopes.has(`accounting.${resource}.read`);
  if ((!broadRead && (!read('banktransactions') || !read('invoices') || !read('payments')))
    || (!recovery && (!read('settings') || !read('contacts')))) {
    fail('The Xero connection lacks the required prepayment read scopes.', 'XERO_PREPAYMENT_SCOPE_MISSING');
  }
  const writeScope = action === 'create' ? 'accounting.banktransactions' : 'accounting.payments';
  if (action && !broadWrite && !scopes.has(writeScope)) {
    fail('The Xero connection lacks write access for the selected prepayment action.', 'XERO_PREPAYMENT_SCOPE_MISSING');
  }
}

async function setup(body, {
  accessContext, env = process.env, fetchImpl, client, getConnection = getFreshXeroConnection,
}, { writeAction = null, recovery = false } = {}) {
  requireDeploymentMutationAllowed(true, env);
  const actorId = accessContext?.profile?.id;
  if (!isId(actorId, UUID)) fail('An active Finance profile is required.', 'XERO_PREPAYMENT_ACTOR_REQUIRED', 403);
  if (!isId(body.tenantId, UUID) || (env.XERO_TENANT_ID && body.tenantId !== env.XERO_TENANT_ID)) {
    fail('The selected Xero tenant could not be verified.', 'XERO_PREPAYMENT_TENANT_CHANGED');
  }
  client ||= xeroContactSyncServiceClient(env);
  const connection = await getConnection(client, { env, fetchImpl });
  if (connection?.tenantId !== body.tenantId) fail('The selected Xero tenant changed.', 'XERO_PREPAYMENT_TENANT_CHANGED');
  requireScopes(connection, writeAction, recovery);
  return { actorId, client, connection, env, fetchImpl };
}

function reviewLoader(dependencies, loadContext = loadXeroPrepaymentReviewContext) {
  return async (selected, execution) => {
    const review = buildPrepaymentReview(await loadContext(selected.stemId, selected, dependencies), selected, execution);
    requireSupportedXeroPrepaymentCurrency(review.currency);
    return review;
  };
}

function publicReview(review, tenantId, env) {
  const { sourceId, action, cashEventId, currency, nativeAmount, accountingUsd, reviewFingerprint, immutableContext } = review;
  return {
    tenantId, sourceId, action, cashEventId, currency, nativeAmount, accountingUsd, reviewFingerprint,
    writeEnabled: writeEnabled(env), postingDate: immutableContext.postingDate,
    bankName: immutableContext.bank.name ?? null, contactName: immutableContext.contact.name ?? null,
    depositAccountCode: immutableContext.policy.accountCode, taxType: immutableContext.policy.taxType,
    policyRevision: immutableContext.policy.revision, cashRemainingNative: immutableContext.balance.native / 100,
    cashRemainingUsd: immutableContext.balance.usd / 100, prepaymentRemainingNative: immutableContext.prepaymentRemainingNative,
    invoiceName: immutableContext.invoice?.name ?? null, invoiceAmountDue: immutableContext.invoice?.amountDue ?? null,
  };
}

function publicResult(result) {
  const { operationId, status } = result;
  return { operationId, status };
}

export async function xeroPrepaymentPreview(body = {}, options = {}) {
  const selected = selection(body);
  const dependencies = await setup(body, options);
  const review = await reviewLoader(dependencies, options.loadContext)(selected);
  return publicReview(review, dependencies.connection.tenantId, dependencies.env);
}

export async function xeroPrepaymentApply(body = {}, options = {}) {
  const selected = selection(body);
  if (body.reviewed !== true || !isId(body.operationId, UUID) || !isId(body.reviewFingerprint, SHA256)) {
    fail('Explicitly approve the exact prepayment review.', 'XERO_PREPAYMENT_REVIEW_REQUIRED', 400);
  }
  const env = options.env || process.env;
  requireDeploymentMutationAllowed(true, env);
  if (env.FCOS_ENABLE_XERO_PREPAYMENTS !== 'true') fail('New Xero prepayment actions are disabled.', 'XERO_PREPAYMENT_DISABLED', 403);
  requireExternalActionGate('xero_financial_sync', env);
  const dependencies = await setup(body, options, { writeAction: selected.action });
  const ledger = (options.ledgerFor || prepaymentLedgerFor)(dependencies.client);
  const transport = (options.transportFor || createXeroPrepaymentTransport)(dependencies);
  const result = await executeXeroPrepayment({
    ...selected, reviewed: true, operationId: body.operationId, reviewFingerprint: body.reviewFingerprint,
  }, {
    ...transport, tenantId: dependencies.connection.tenantId, actorId: dependencies.actorId, ledger,
    loadReview: reviewLoader(dependencies, options.loadContext),
  });
  return publicResult(result);
}

export async function xeroPrepaymentReconcile(body = {}, options = {}) {
  if (body.reviewed !== true || !isId(body.operationId, UUID) || !isId(body.reviewFingerprint, SHA256)) {
    fail('Select the exact original operation and review fingerprint.', 'XERO_PREPAYMENT_REVIEW_REQUIRED', 400);
  }
  const dependencies = await setup(body, options, { recovery: true });
  const tenantId = dependencies.connection.tenantId;
  const ledger = (options.ledgerFor || prepaymentLedgerFor)(dependencies.client);
  const key = { tenantId, operationId: body.operationId };
  const saved = await ledger.get(key);
  if (!saved || saved.tenant_id !== tenantId || saved.operation_id !== body.operationId
    || saved.actor_id !== dependencies.actorId || saved.review_hash !== body.reviewFingerprint) {
    fail('The original prepayment review could not be verified for this Finance user.', 'XERO_PREPAYMENT_OPERATION_MISMATCH');
  }
  if (saved.status === 'cancelled_before_send') return publicResult({ operationId: saved.operation_id, status: saved.status });
  if (saved.status === 'processing' && !saved.send_started_at) {
    let current;
    try {
      current = (await ledger.cancel({ ...key, requestHash: saved.request_hash,
        responseEvidence: { code: 'XERO_PREPAYMENT_CANCELLED_BEFORE_SEND' } }))?.operation;
    } catch { /* Read the original state before making any claim about the cancellation. */ }
    if (current?.status !== 'cancelled_before_send') current = await ledger.get(key);
    if (current?.status !== 'cancelled_before_send' || current.tenant_id !== tenantId || current.operation_id !== saved.operation_id
      || current.request_hash !== saved.request_hash || current.actor_id !== dependencies.actorId || current.send_started_at) {
      fail('The original prepayment state changed during cancellation. Reload the operation.', 'XERO_PREPAYMENT_RECOVERY_RACE');
    }
    return publicResult({ operationId: current.operation_id, status: current.status });
  }
  const transport = (options.transportFor || createXeroPrepaymentTransport)(dependencies);
  const result = await executeXeroPrepayment({
    reviewed: true, operationId: saved.operation_id, sourceId: saved.source_id, action: saved.action, reviewFingerprint: saved.review_hash,
  }, { ...transport, tenantId, actorId: dependencies.actorId, ledger, recoveryOnly: true });
  return publicResult(result);
}

const UNRESOLVED = new Set(['processing', 'unknown', 'exception']);
const sourceKey = (id) => isId(id, SALESFORCE_ID) ? id.slice(0, 15) : null;

export async function xeroPrepaymentQueue(body = {}, options = {}) {
  if ((body.stemId != null && !isId(body.stemId, SALESFORCE_ID))
    || (body.stemId == null && (typeof body.stemKey !== 'string' || !/^[a-z0-9][a-z0-9-]{1,39}$/i.test(body.stemKey)))) {
    fail('Select an exact STEM to load prepayment work.', 'XERO_PREPAYMENT_SCOPE_INVALID', 400);
  }
  const dependencies = await setup(body, { ...options, getConnection: options.getStoredConnection || readStoredXeroConnection }, { recovery: true });
  const { actorId, client, connection, env } = dependencies;
  const stemId = body.stemId ?? await (options.resolveStem || resolvePrepaymentStemKey)(body.stemKey);
  const queue = await (options.loadQueue || loadPrepaymentQueueContext)(stemId, { client, tenantId: connection.tenantId });
  const events = new Map(queue.events.map((event) => [sourceKey(event.Id), event]));
  const originalBySource = new Map();
  const unresolvedCash = new Set();
  for (const operation of queue.operations) {
    if (operation.status === 'cancelled_before_send') continue;
    const key = `${operation.action}:${sourceKey(operation.source_id)}`;
    if (originalBySource.has(key)) fail('The durable prepayment operation is ambiguous.', 'XERO_PREPAYMENT_OPERATION_MISMATCH');
    originalBySource.set(key, operation);
    if (UNRESOLVED.has(operation.status)) unresolvedCash.add(sourceKey(operation.cash_event_id));
  }
  const reversed = new Set(queue.allocations.filter((row) => row.Kind__c === 'Reversal'
    && !originalBySource.has(`reverse:${sourceKey(row.Id)}`)).map((row) => sourceKey(row.Reverses_Allocation__c)));
  const rows = [...queue.events, ...queue.allocations].map((row) => {
    const action = { Payment: 'create', Refund: 'refund', Applied: 'allocate', Reversal: 'reverse' }[row.Kind__c];
    const event = events.get(sourceKey(row.Cash_Event__c || row.Original_Cash_Event__c || row.Id));
    if (!ACTIONS.includes(action) || !sourceKey(row.Id) || !event || event.Kind__c !== 'Payment'
      || !['USD', 'HKD'].includes(row.Currency__c) || (action === 'reverse' && !sourceKey(row.Reverses_Allocation__c))) {
      fail('The selected STEM contains incomplete cash history.', 'XERO_PREPAYMENT_QUEUE_INCOMPLETE');
    }
    const operation = originalBySource.get(`${action}:${sourceKey(row.Id)}`);
    const deposit = originalBySource.get(`create:${sourceKey(event.Id)}`);
    const reversedBeforePosting = action === 'allocate' && reversed.has(sourceKey(row.Id))
      || action === 'reverse' && !originalBySource.has(`allocate:${sourceKey(row.Reverses_Allocation__c)}`);
    const hkdUnsupported = row.Currency__c === 'HKD' || event.Currency__c === 'HKD';
    const available = !unresolvedCash.has(sourceKey(event.Id)) && !reversedBeforePosting
      && (action === 'create' || deposit?.status === 'applied');
    const usd = row.Cash_Event__c ? row.Allocated_Cash_USD__c : row.Cash_USD_Amount__c;
    const hkd = row.Cash_Event__c ? row.Allocated_HKD__c : row.Cash_HKD_Amount__c;
    const amount = row.Currency__c === 'HKD' ? hkd : usd;
    if (amount == null || !Number.isFinite(Number(amount))) fail('The cash amount is incomplete.', 'XERO_PREPAYMENT_QUEUE_INCOMPLETE');
    const canRecover = operation?.actor_id === actorId && (UNRESOLVED.has(operation.status) || operation.status === 'applied');
    return {
      sourceId: row.Id, name: row.Name || row.Id, partyName: event.Party__r?.Name || null,
      action, date: row.Allocation_Date__c || row.Payment_Date__c, currency: row.Currency__c,
      nativeAmount: Math.abs(Number(amount)),
      status: operation?.status || (reversedBeforePosting ? 'reversed_in_salesforce'
        : hkdUnsupported ? 'hkd_unsupported' : available ? 'ready_for_review' : 'held'),
      recovery: canRecover ? { operationId: operation.operation_id, reviewFingerprint: operation.review_hash } : null,
    };
  });
  return { tenantId: connection.tenantId, stemId, writeEnabled: writeEnabled(env), rows };
}

export async function xeroPrepaymentContacts(body = {}, options = {}) {
  if (!isId(body.stemId, SALESFORCE_ID) || !isId(body.sourceId, SALESFORCE_ID)) {
    fail('Select the exact deposit cash event.', 'XERO_PREPAYMENT_SCOPE_INVALID', 400);
  }
  const dependencies = await setup(body, options);
  const contacts = await (options.loadContacts || loadPrepaymentContactChoices)(body.stemId, body.sourceId, dependencies);
  return { tenantId: dependencies.connection.tenantId, sourceId: body.sourceId, contacts };
}
