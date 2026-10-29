import { xeroAccountingFetch } from './_xeroContactSync.js';
import { runWithXeroBudget } from './_xeroSharedControl.js';
import { creditSettlementProof } from './_xeroCreditSettlementProof.js';

const MAX_TARGETS = 25;
const MAX_CONCURRENT_READS = 2;
const collections = {
  Invoices: { field: 'InvoiceID', key: 'invoices' },
  CreditNotes: { field: 'CreditNoteID', key: 'creditNotes' },
};

function incomplete(message) {
  return Object.assign(new Error(message), {
    status: 502, code: 'XERO_CAMPAIGN_LINK_READBACK_INCOMPLETE', expose: true,
  });
}

function exactId(value) {
  if (typeof value !== 'string' || !value || /[\s,]/.test(value)) {
    throw incomplete('Document link readback requires exact target IDs.');
  }
  return value.toLowerCase();
}

function validateResponse(response, collection, ids) {
  const rows = response?.[collection];
  if (!response || typeof response !== 'object' || Array.isArray(response)
    || !Array.isArray(rows) || response.HasErrors === true || response.HasValidationErrors === true
    || response.ValidationErrors !== undefined && (!Array.isArray(response.ValidationErrors) || response.ValidationErrors.length)) {
    throw incomplete(`${collection} exact link readback response is incomplete.`);
  }
  if (response.Pagination !== undefined) {
    const pagination = response.Pagination;
    if (!pagination || pagination.page !== 1 || !Number.isSafeInteger(pagination.pageSize)
      || pagination.pageSize < ids.length || !Number.isSafeInteger(pagination.pageCount)
      || pagination.pageCount < (rows.length ? 1 : 0) || pagination.pageCount > 1
      || pagination.itemCount !== undefined && pagination.itemCount !== rows.length) {
      throw incomplete(`${collection} exact link readback pagination is incomplete.`);
    }
  }
  const found = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw incomplete(`${collection} exact link readback record is malformed.`);
    }
    const id = exactId(row[collections[collection].field]);
    if (!ids.includes(id) || found.has(id)) {
      throw incomplete(`${collection} exact link readback returned unrelated or duplicate IDs.`);
    }
    const required = collection === 'Invoices'
      ? ['Total', 'AmountPaid', 'AmountDue', 'AmountCredited'] : ['Total', 'RemainingCredit'];
    if (required.some((field) => !Object.hasOwn(row, field)
        || typeof row[field] !== 'number' && (typeof row[field] !== 'string' || !row[field].trim())
        || typeof row[field] === 'number' && !Number.isFinite(row[field])) || !Array.isArray(row.LineItems)
      || row.LineItems.some((line) => !line || typeof line !== 'object' || Array.isArray(line))
      || row.HasErrors === true || row.HasValidationErrors === true
      || row.ValidationErrors !== undefined && (!Array.isArray(row.ValidationErrors) || row.ValidationErrors.length)
      || row.Payments !== undefined && !Array.isArray(row.Payments)
      || row.Allocations !== undefined && !Array.isArray(row.Allocations)
      || collection === 'Invoices' && row.CreditNotes !== undefined && !Array.isArray(row.CreditNotes)
      || collection === 'CreditNotes' && !creditSettlementProof(row)) {
      throw incomplete(`${collection} exact link readback settlement or line evidence is incomplete.`);
    }
    // Keep the provider row intact. Allocation validation and comparison belong
    // to the executor, including number representation and nested evidence.
    found.set(id, row);
  }
  return { rows: ids.filter((id) => found.has(id)).map((id) => found.get(id)),
    missingIds: ids.filter((id) => !found.has(id)) };
}

/** Read a bounded second snapshot for document-only link outcomes. */
export async function readCampaignDocumentLinkReadback({ connection, targets = [], budgetId,
  env = process.env, fetchImpl, accountingFetch = xeroAccountingFetch, withBudget = runWithXeroBudget } = {}) {
  if (!connection?.tenantId || typeof budgetId !== 'string' || !budgetId.trim()
    || !Array.isArray(targets) || targets.length > MAX_TARGETS
    || typeof accountingFetch !== 'function' || typeof withBudget !== 'function') {
    throw incomplete('A bounded same-tenant document link readback budget is required.');
  }
  const idsByCollection = { Invoices: [], CreditNotes: [] };
  const seen = new Set();
  for (const target of targets) {
    if (!target || !Object.hasOwn(collections, target.collection)) {
      throw incomplete('Document link readback collection is invalid.');
    }
    const id = exactId(target.targetId);
    if (seen.has(id)) throw incomplete('Document link readback target IDs repeat or overlap.');
    seen.add(id);
    idsByCollection[target.collection].push(id);
  }
  const tasks = [];
  if (idsByCollection.Invoices.length) tasks.push({ collection: 'Invoices', ids: idsByCollection.Invoices,
    path: `/Invoices?IDs=${encodeURIComponent(idsByCollection.Invoices.join(','))}&summaryOnly=false&unitdp=4` });
  for (const id of idsByCollection.CreditNotes) tasks.push({ collection: 'CreditNotes', ids: [id],
    path: `/CreditNotes/${encodeURIComponent(id)}?unitdp=4` });

  let callCount = 0;
  let nextTask = 0;
  let failed = false;
  let firstError;
  const readEnv = { ...env, XERO_TRANSIENT_RETRY_LIMIT: '0' };
  const results = new Array(tasks.length);
  const worker = async () => {
    while (!failed && nextTask < tasks.length) {
      const index = nextTask++;
      const task = tasks[index];
      try {
        const response = await withBudget(connection, { budgetId, budgetPhase: 'verification' }, () => {
          callCount += 1;
          return accountingFetch(connection, task.path, { method: 'GET', env: readEnv, fetchImpl,
            budgetId, budgetPhase: 'verification', retryOnRateLimit: false });
        });
        results[index] = validateResponse(response, task.collection, task.ids);
      } catch (error) {
        if (error?.status === 404) results[index] = { rows: [], missingIds: task.ids };
        else { if (!failed) firstError = error; failed = true; }
      }
    }
  };
  // Drain the two admitted local workers before returning or rejecting. A
  // failed read cannot leave another read running after its budget is released.
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_READS, tasks.length) }, worker));
  if (failed) throw firstError;
  const rawTargets = { invoices: [], creditNotes: [] };
  const missingTargetIds = { invoices: [], creditNotes: [] };
  for (let index = 0; index < tasks.length; index += 1) {
    const key = collections[tasks[index].collection].key;
    rawTargets[key].push(...results[index].rows);
    missingTargetIds[key].push(...results[index].missingIds);
  }
  return { rawTargets, missingTargetIds, callCount };
}
