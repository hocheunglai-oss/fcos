const TABLE = 'xero_financial_prepayment_operations';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SALESFORCE_ID = /^[a-z0-9]{15}(?:[a-z0-9]{3})?$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const MONEY = /^\d+(?:\.\d{1,2})?$/;

function fail(message, code = 'XERO_PREPAYMENT_LEDGER_INVALID') {
  throw Object.assign(new Error(`Xero prepayment ledger: ${message}`), { code, status: 409 });
}
function required(value, label, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail(`${label} is invalid.`);
  return value;
}
function evidence(value, label, optional = false) {
  if (optional && value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length === 0) fail(`${label} must be a nonempty evidence object.`);
  return value;
}
function amount(value, label, positive) {
  if (!MONEY.test(String(value ?? '')) || !Number.isFinite(Number(value)) || (positive ? Number(value) <= 0 : Number(value) < 0)) {
    fail(`${label} must be an exact ${positive ? 'positive' : 'nonnegative'} amount with at most two decimal places.`);
  }
  return String(value);
}
function requireClient(client) {
  if (!client || typeof client.rpc !== 'function' || typeof client.from !== 'function') fail('A Supabase service client is required.');
  return client;
}
function unwrap(result, operation) {
  if (result?.error || !result || !Object.hasOwn(result, 'data')) throw Object.assign(new Error(`Xero prepayment ledger ${operation} failed.`), { code: 'XERO_PREPAYMENT_LEDGER_DATABASE', status: 503, cause: result?.error });
  return result?.data;
}
function providerId(value, label) {
  if (value == null) return null;
  return required(value, label, UUID);
}

export async function claimXeroPrepaymentOperation(client, input = {}) {
  requireClient(client);
  const action = String(input.action || '');
  const sourceKind = String(input.sourceKind || '');
  if (!['create', 'allocate', 'reverse', 'refund'].includes(action)) fail('Action is invalid.');
  if (!['cash_event', 'cash_allocation'].includes(sourceKind)) fail('Source kind is invalid.');
  const cashEventId = required(input.cashEventId, 'Original cash event ID', SALESFORCE_ID);
  const sourceId = required(input.sourceId, 'Source ID', SALESFORCE_ID);
  if ((action === 'create' && (sourceKind !== 'cash_event' || sourceId !== cashEventId))
    || (action === 'refund' && sourceKind !== 'cash_event')
    || (['allocate', 'reverse'].includes(action) && sourceKind !== 'cash_allocation')) fail('Action and source identity do not match.');
  if (['allocate', 'reverse'].includes(action) !== Boolean(input.invoiceMappingId)) fail('Final invoice mapping is required only for allocation actions.');
  const args = {
    p_operation_id: required(input.operationId, 'Operation ID', UUID),
    p_tenant_id: required(input.tenantId, 'Tenant ID', UUID),
    p_cash_event_id: cashEventId,
    p_source_kind: sourceKind,
    p_source_id: sourceId,
    p_action: action,
    p_source_hash: required(input.sourceHash, 'Source hash', SHA256),
    p_review_hash: required(input.reviewHash, 'Review hash', SHA256),
    p_request_hash: required(input.requestHash, 'Request hash', SHA256),
    p_request_evidence: evidence(input.requestEvidence, 'Request evidence'),
    p_currency: ['USD', 'HKD'].includes(input.currency) ? input.currency : fail('Currency must be USD or HKD.'),
    p_native_amount: amount(input.nativeAmount, 'Native amount', true),
    p_accounting_usd: amount(input.accountingUsd, 'Accounting USD', false),
    p_invoice_mapping_id: input.invoiceMappingId == null ? null : required(input.invoiceMappingId, 'Invoice mapping ID', UUID),
    p_actor_id: required(input.actorId, 'Actor ID', UUID),
  };
  return unwrap(await client.rpc('claim_xero_prepayment_operation_v1', args), 'claim');
}

export async function getXeroPrepaymentOperation(client, { operationId, tenantId } = {}) {
  requireClient(client);
  const query = client.from(TABLE).select('*').eq('operation_id', required(operationId, 'Operation ID', UUID))
    .eq('tenant_id', required(tenantId, 'Tenant ID', UUID));
  const row = unwrap(await query.maybeSingle(), 'get');
  if (row != null && (row.tenant_id !== tenantId || row.operation_id !== operationId)) {
    fail('Stored operation identity differs from the requested operation.');
  }
  return row ?? null;
}

export async function markXeroPrepaymentSent(client, { operationId, tenantId, requestHash } = {}) {
  requireClient(client);
  return unwrap(await client.rpc('mark_xero_prepayment_sent_v1', {
    p_operation_id: required(operationId, 'Operation ID', UUID),
    p_tenant_id: required(tenantId, 'Tenant ID', UUID),
    p_request_hash: required(requestHash, 'Request hash', SHA256),
  }), 'mark sent');
}

export async function finishXeroPrepaymentOperation(client, input = {}) {
  requireClient(client);
  if (!['applied', 'unknown', 'exception'].includes(input.status)) fail('Finish status is invalid.');
  return unwrap(await client.rpc('finish_xero_prepayment_operation_v1', {
    p_operation_id: required(input.operationId, 'Operation ID', UUID),
    p_tenant_id: required(input.tenantId, 'Tenant ID', UUID),
    p_request_hash: required(input.requestHash, 'Request hash', SHA256),
    p_status: input.status,
    p_xero_bank_transaction_id: providerId(input.xeroBankTransactionId, 'Xero bank transaction ID'),
    p_xero_prepayment_id: providerId(input.xeroPrepaymentId, 'Xero prepayment ID'),
    p_xero_allocation_id: providerId(input.xeroAllocationId, 'Xero allocation ID'),
    p_xero_payment_id: providerId(input.xeroPaymentId, 'Xero payment ID'),
    p_response_evidence: evidence(input.responseEvidence, 'Response evidence'),
  }), 'finish');
}

export async function cancelXeroPrepaymentOperation(client, { operationId, tenantId, requestHash, responseEvidence = null } = {}) {
  requireClient(client);
  return unwrap(await client.rpc('cancel_xero_prepayment_operation_v1', {
    p_operation_id: required(operationId, 'Operation ID', UUID),
    p_tenant_id: required(tenantId, 'Tenant ID', UUID),
    p_request_hash: required(requestHash, 'Request hash', SHA256),
    p_response_evidence: evidence(responseEvidence, 'Cancellation evidence', true),
  }), 'cancel');
}

export function prepaymentLedgerFor(client) {
  requireClient(client);
  return {
    claim: (input) => claimXeroPrepaymentOperation(client, input),
    get: (input) => getXeroPrepaymentOperation(client, input),
    markSent: (input) => markXeroPrepaymentSent(client, input),
    finish: (input) => finishXeroPrepaymentOperation(client, input),
    cancel: (input) => cancelXeroPrepaymentOperation(client, input),
  };
}
