import { requireExternalActionGate } from './_externalActionGates.js';
import { xeroFinancialAccountingFetch } from './_xeroFinancialSync.js';
import { xeroPrepaymentEvidenceFingerprint as hash } from './_xeroPrepaymentCurrency.js';
import { confirmedNativeDocumentMapping } from './_xeroNativeDocumentMapping.js';
import { reconcileCreditAllocation } from './_xeroCreditAllocations.js';
import { verifyXeroPrepaymentOutcome } from './_xeroPrepaymentReadback.js';
import { releaseXeroBudget, reserveXeroBudget, xeroSharedContext } from './_xeroSharedControl.js';

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const ACTIONS = {
  create: { resource: 'BankTransactions', method: 'PUT', target: 'xeroBankTransactionId', calls: 3, path: /^\/BankTransactions$/ },
  allocate: { resource: 'Prepayments', method: 'PUT', target: 'xeroPrepaymentId', calls: 3, path: /^\/Prepayments\/[a-f0-9-]{36}\/Allocations$/i },
  reverse: { resource: 'Prepayments', method: 'DELETE', target: 'xeroPrepaymentId', calls: 3, path: /^\/Prepayments\/[a-f0-9-]{36}\/Allocations\/[a-f0-9-]{36}$/i },
  refund: { resource: 'Payments', method: 'PUT', target: 'xeroPaymentId', calls: 2, path: /^\/Payments$/ },
};

const CREDIT_ACTION = { resource: 'CreditNotes', method: 'PUT', calls: 2, path: /^\/CreditNotes\/[a-f0-9-]{36}\/Allocations$/i };

function fail(message, kind) {
  const prefix = { credit: 'XERO_CREDIT_ALLOCATION', native: 'XERO_NATIVE_DOCUMENT', prepayment: 'XERO_PREPAYMENT' }[kind];
  throw Object.assign(new Error(message), { code: `${prefix}_TRANSPORT_UNVERIFIED`, status: 409 });
}

function deterministicId(value) {
  const digest = hash({ identity: value });
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function transportIntent(operation, tenantId, kind) {
  const request = operation.request_evidence;
  const native = kind === 'native';
  const credit = kind === 'credit';
  const draft = native ? request?.draft : null;
  const proposal = native ? draft : request?.proposal;
  const action = native ? {
    resource: draft?.xeroCollection, method: 'POST', calls: 1,
    path: /^\/(?:Invoices|CreditNotes)\?unitdp=4&summarizeErrors=false$/,
  } : credit ? CREDIT_ACTION : ACTIONS[operation.action];
  if (operation.tenant_id !== tenantId || !uuid.test(operation.operation_id || '') || !/^[a-f0-9]{64}$/.test(operation.request_hash || '')
    || !action || !action.path.test(proposal?.path || '') || (!native && proposal.method !== action.method)
    || (native && (!['Invoices', 'CreditNotes'].includes(draft?.xeroCollection)
      || draft.path !== `/${draft.xeroCollection}?unitdp=4&summarizeErrors=false` || draft.payload?.Status !== 'DRAFT'))
    || (credit && (request.action !== 'credit_allocate' || proposal.path !== `/CreditNotes/${request.xeroCreditId}/Allocations`))) {
    fail('The original Xero transport intent is incomplete.', kind);
  }
  const identity = [tenantId, operation.operation_id, operation.request_hash];
  const namespace = { native: 'native-document', credit: 'credit-allocation', prepayment: 'prepayment' }[kind];
  return { ...action, owner: `${namespace}:${operation.operation_id}`, requestId: deterministicId([`${namespace}-send`, ...identity]),
    budgetId: deterministicId([`${namespace}-budget`, ...identity]) };
}

async function verifyCreditOutcome(request, read) {
  if (!uuid.test(request.xeroCreditId || '') || !uuid.test(request.xeroInvoiceId || '')) fail('Exact credit and invoice IDs are required.', 'credit');
  const credit = await read(`/CreditNotes/${request.xeroCreditId}`);
  const invoice = await read(`/Invoices/${request.xeroInvoiceId}`);
  if (credit?.CreditNotes?.length !== 1 || invoice?.Invoices?.length !== 1) fail('Exact credit and invoice readback is incomplete.', 'credit');
  const proof = reconcileCreditAllocation({ request_evidence: request }, credit.CreditNotes[0], invoice.Invoices[0]);
  return { ...proof, identities: { xeroAllocationId: proof.allocationId } };
}

export function createXeroPrepaymentTransport(options) {
  return createJournaledXeroTransport(options, 'prepayment', verifyXeroPrepaymentOutcome);
}

export function createXeroCreditAllocationTransport(options) {
  return createJournaledXeroTransport(options, 'credit', verifyCreditOutcome);
}

export function createXeroNativeDocumentTransport(options) {
  return createJournaledXeroTransport(options, 'native', async (request, read, operation) => {
    const xeroId = operation.observed_xero_id;
    if (!uuid.test(xeroId || '')) fail('The original Xero draft has no acknowledged provider ID.', 'native');
    const collection = request.draft.xeroCollection;
    const response = await read(`/${collection}/${xeroId}?unitdp=4`);
    const rows = response?.[collection];
    if (!Array.isArray(rows) || rows.length !== 1) fail('Exact native document readback is incomplete.', 'native');
    const observed = rows[0];
    const mapping = confirmedNativeDocumentMapping({ sourceObject: request.sourceObject,
      source: request.source, draft: request.draft, expectedXeroId: xeroId, observed });
    return { xeroId, mapping, observed };
  });
}

/** The business verifier receives GET access only. Its exact same-resource receipt releases an uncertain send. */
function createJournaledXeroTransport({
  client, connection, env = process.env, fetchImpl, verifyOutcome,
  accountingFetch = xeroFinancialAccountingFetch, now = Date.now,
}, kind, defaultVerifier) {
  const native = kind === 'native';
  const credit = kind === 'credit';
  const reject = message => fail(message, kind);
  const tenantId = connection?.tenantId;
  if (!uuid.test(tenantId || '') || (env.XERO_TENANT_ID && env.XERO_TENANT_ID !== tenantId)) reject('The Xero tenant could not be verified.');
  async function row(table, id) {
    const result = await client.from(table).select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (result?.error || !result || !Object.hasOwn(result, 'data')
      || (result.data && (result.data.id !== id || result.data.tenant_id !== tenantId))) {
      reject('The original Xero request or budget receipt is unavailable.');
    }
    return result.data;
  }

  async function original(intent) {
    const [request, budget] = await Promise.all([
      row('xero_shared_requests', intent.requestId), row('xero_shared_budgets', intent.budgetId),
    ]);
    if (!request || !budget || request.method !== intent.method || request.resource_key !== intent.resource
      || request.budget_id !== intent.budgetId || request.phase !== 'operation' || budget.owner_key !== intent.owner
      || !['inflight', 'complete', 'unknown'].includes(request.state)) reject('The exact original Xero admission could not be verified.');
    if (request.state === 'inflight' && (!Number.isFinite(Date.parse(request.deadline_at)) || Date.parse(request.deadline_at) > now())) {
      reject('The original Xero request is still in flight.');
    }
    return { request, budget };
  }

  return {
    async prepareSend(operation) {
      requireExternalActionGate('xero_financial_sync', env);
      const intent = transportIntent(operation, tenantId, kind);
      const reserved = await reserveXeroBudget(connection, {
        budgetId: intent.budgetId, ownerKey: intent.owner, operationCalls: 1, verificationCalls: intent.calls,
      });
      if (reserved?.id !== intent.budgetId || reserved.tenant_id !== tenantId || reserved.owner_key !== intent.owner
        || reserved.operation_remaining !== 1 || reserved.verification_remaining !== intent.calls || reserved.state !== 'active') {
        reject('The reserved Xero send and verification capacity could not be verified.');
      }
    },

    async send(proposal, _operationId, operation) {
      requireExternalActionGate('xero_financial_sync', env);
      const intent = transportIntent(operation, tenantId, kind);
      const saved = native ? operation.request_evidence.draft : operation.request_evidence.proposal;
      if (!operation.send_started_at || operation.status !== (native ? 'sent' : 'processing')
        || hash(proposal) !== hash(saved)) reject('The durable Xero send marker or proposal could not be verified.');
      const idempotencyKey = native ? `fcos-native-${intent.requestId}` : proposal.headers?.['Idempotency-Key'];
      const body = native ? { [intent.resource]: [proposal.payload] } : proposal.payload;
      return accountingFetch(connection, proposal.path, {
        env, fetchImpl, method: intent.method, requestId: intent.requestId, budgetId: intent.budgetId,
        budgetPhase: 'operation', body: body || undefined, idempotencyKey, retryOnRateLimit: false,
      });
    },

    async readOutcome(request, operation) {
      const intent = transportIntent(operation, tenantId, kind);
      if (native && !uuid.test(operation.observed_xero_id || '')) reject('The original Xero draft has no acknowledged provider ID.');
      const { budget } = await original(intent);
      let budgetId = budget.id;
      const exhausted = native && budget.state === 'active' && budget.verification_remaining === 0;
      if (exhausted) await releaseXeroBudget(connection, { budgetId, reason: 'Native draft verification capacity used' });
      const applicationNeedsCapacity = kind === 'prepayment' && ['allocate', 'reverse'].includes(operation.action)
        && budget.verification_remaining < intent.calls;
      if (exhausted || applicationNeedsCapacity || budget.state !== 'active' || !(Date.parse(budget.expires_at) > now())) {
        const reserved = await reserveXeroBudget(connection, { ownerKey: `${intent.owner}:recovery`, operationCalls: 0, verificationCalls: intent.calls });
        if (!uuid.test(reserved?.id || '') || reserved.tenant_id !== tenantId || reserved.owner_key !== `${intent.owner}:recovery`
          || reserved.operation_remaining !== 0 || reserved.verification_remaining !== intent.calls || reserved.state !== 'active') {
          reject('The Xero recovery verification capacity could not be verified.');
        }
        budgetId = reserved.id;
      }
      const observed = new Map();
      let calls = 0;
      const read = (path) => {
        if (++calls > intent.calls) reject('Xero verification exceeded its reserved read scope.');
        return accountingFetch(connection, path, {
          env: native ? { ...env, XERO_TRANSIENT_RETRY_LIMIT: '0' } : env,
          fetchImpl, method: 'GET', budgetId, budgetPhase: 'verification', retryOnRateLimit: false,
          onResponse: (event) => {
            if (event.method === 'GET' && event.status >= 200 && event.status < 300 && event.budgetId === budgetId
              && event.pathName === path && uuid.test(event.requestId || '')) observed.set(path, event.requestId);
          },
        });
      };
      const outcome = await (verifyOutcome || defaultVerifier)(request, read, operation);
      const target = native ? operation.observed_xero_id : credit ? request.xeroCreditId : outcome?.identities?.[intent.target];
      const verificationId = uuid.test(target || '') && observed.get(`/${intent.resource}/${target}${native ? '?unitdp=4' : ''}`);
      if (!verificationId) reject('The exact original resource was not verified through Xero.');
      return { ...outcome, transport: { requestId: intent.requestId, verificationId, budgetId } };
    },

    async settle(operation) {
      const intent = transportIntent(operation, tenantId, kind);
      const receipt = operation.response_evidence?.transport;
      if (receipt?.requestId !== intent.requestId || !uuid.test(receipt.verificationId || '') || !uuid.test(receipt.budgetId || '')) {
        reject('The original operation has no exact Xero verification receipt.');
      }
      const [{ request, budget }, verification] = await Promise.all([
        original(intent), row('xero_shared_requests', receipt.verificationId),
      ]);
      if (!verification || verification.method !== 'GET' || verification.resource_key !== intent.resource
        || verification.budget_id !== receipt.budgetId || verification.phase !== 'verification' || verification.state !== 'complete'
        || !Number.isInteger(verification.response_status) || verification.response_status < 200 || verification.response_status >= 300) {
        reject('The durable Xero verification receipt could not be confirmed.');
      }
      const recoveryBudget = receipt.budgetId === budget.id ? null : await row('xero_shared_budgets', receipt.budgetId);
      if (receipt.budgetId !== budget.id && recoveryBudget?.owner_key !== `${intent.owner}:recovery`) {
        reject('The recovery budget does not belong to the original operation.');
      }
      const control = xeroSharedContext(connection).sharedControl;
      if (request.state !== 'complete' || request.outcome_unknown) {
        const released = await control.resolveUnknown({ tenantId, requestId: intent.requestId, verificationRequestId: receipt.verificationId,
          evidenceReference: `${native ? 'xero_native_document_draft_operations' : credit
            ? 'xero_financial_credit_allocations' : 'xero_financial_prepayment_operations'}:${operation.operation_id}` });
        if (released !== true) reject('The original Xero admission hold could not be resolved.');
      }
      for (const current of [budget, recoveryBudget].filter((entry) => entry?.state === 'active')) {
        await releaseXeroBudget(connection, { budgetId: current.id, reason: native ? 'Native draft verified' : credit ? 'Credit allocation verified' : 'Prepayment verified' });
      }
    },
  };
}
