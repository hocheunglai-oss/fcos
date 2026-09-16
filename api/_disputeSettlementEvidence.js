import { createHash } from 'node:crypto';
import { sfQuery } from './_salesforce.js';
import { getFreshXeroConnection, xeroAccountingFetch, xeroContactSyncServiceClient } from './_xeroContactSync.js';

const idKey = (value) => String(value || '').slice(0, 15);
const moneyMatches = (left, right) => Number.isFinite(Number(left)) && Number.isFinite(Number(right)) && Math.abs(Number(left) - Number(right)) < 0.005;
const fingerprint = (row) => createHash('sha256').update(JSON.stringify(row)).digest('hex');

export function refundSettlementCandidates(stem, instruction, party) {
  if (instruction?.instruction_type !== 'get_back_paid') return [];
  const invoice = (stem._Supplier_Invoice_Exposure_Rows || []).find((row) => idKey(row.supplierInvoiceId) === idKey(instruction.source_supplier_invoice_id)
    && idKey(row.supplierAccountId) === idKey(party.account_id));
  return (invoice?.payments || []).filter((row) => Number(row.amount) < 0 && moneyMatches(Math.abs(Number(row.amount)), instruction.planned_amount)
    && (row.currencyIsoCode || 'USD') === instruction.currency_iso_code && (row.paymentDate || row.date))
    .map((row) => {
      const evidence = { id: `salesforce-payment:${row.id}`, type: 'refund', salesforceId: row.id,
        reference: row.reference || row.name || row.id, date: (row.paymentDate || row.date).slice(0, 10),
        amount: Math.abs(Number(row.amount)), currency: instruction.currency_iso_code,
        invoiceId: invoice.supplierInvoiceId, partyAccountId: party.account_id, recoveryMethod: 'cash_refund',
        source: 'Salesforce refund', updatedAt: row.lastModifiedDate || null };
      return { ...evidence, fingerprint: fingerprint(evidence) };
    });
}

export function exactCreditEvidence(record, xero, { partyAccountId, side, stemId, amount, mapping } = {}) {
  const accountId = side === 'buyer' ? record.STEM__r?.Account__c : record.Supplier__c;
  const signedAmount = side === 'buyer' ? record.Amount__c : record.Invoice_Amount__c;
  if (idKey(accountId) !== idKey(partyAccountId) || idKey(record.STEM__c) !== idKey(stemId)
    || !(Number(signedAmount) < 0) || !moneyMatches(Math.abs(Number(signedAmount)), amount)
    || !['AUTHORISED', 'PAID'].includes(xero?.Status) || xero.CurrencyCode !== 'USD'
    || xero.Type !== (side === 'buyer' ? 'ACCRECCREDIT' : 'ACCPAYCREDIT')
    || xero.Contact?.ContactID !== mapping?.xero_contact_id
    || xero.CreditNoteID !== mapping?.xero_document_id || !moneyMatches(xero.Total, amount)) return null;
  const evidence = { id: `xero-credit:${xero.CreditNoteID}`, type: 'credit', salesforceId: record.Id,
    reference: xero.CreditNoteNumber || record.Name, date: record.Invoice_Date__c,
    amount: Math.abs(Number(signedAmount)), currency: 'USD', source: 'Salesforce credit verified in Xero',
    partyAccountId, stemId, xeroId: xero.CreditNoteID, updatedAt: xero.UpdatedDateUTC || record.LastModifiedDate,
    url: `https://go.xero.com/AccountsReceivable/ViewCreditNote.aspx?creditNoteID=${encodeURIComponent(xero.CreditNoteID)}` };
  return evidence.date ? { ...evidence, fingerprint: fingerprint(evidence) } : null;
}

export function exactAllocatedCreditEvidence(record, xero, { party, stem, instruction, mapping, invoiceMapping }) {
  const exposure = (stem._Supplier_Invoice_Exposure_Rows || []).find((row) => idKey(row.supplierInvoiceId) === idKey(instruction.source_supplier_invoice_id)
    && idKey(row.supplierAccountId) === idKey(party.account_id));
  if (!exposure || instruction.currency_iso_code !== 'USD' || !invoiceMapping?.xero_document_id
    || invoiceMapping.xero_contact_id !== mapping?.xero_contact_id) return null;
  const credit = exactCreditEvidence(record, xero, { partyAccountId: party.account_id, side: 'supplier', stemId: stem.Id,
    amount: Math.abs(Number(record.Invoice_Amount__c)), mapping });
  if (!credit) return null;
  const allocations = (xero.Allocations || []).filter((allocation) => allocation.Invoice?.InvoiceID === invoiceMapping.xero_document_id);
  // One exact allocation has an unambiguous identity; partial or combined evidence stays for Finance review.
  if (allocations.length !== 1 || !allocations[0].AllocationID || !moneyMatches(allocations[0].AppliedAmount ?? allocations[0].Amount, instruction.planned_amount)) return null;
  const allocation = allocations[0];
  const evidence = { ...credit, id: `xero-allocation:${allocation.AllocationID}`, amount: Number(instruction.planned_amount),
    invoiceId: instruction.source_supplier_invoice_id, allocationId: allocation.AllocationID,
    source: 'Xero credit allocated to this supplier invoice' };
  delete evidence.fingerprint;
  return { ...evidence, fingerprint: fingerprint(evidence) };
}

export async function loadDisputeSettlementEvidence({ stem, action, instruction, party }, { env = process.env, fetchImpl = fetch, client = xeroContactSyncServiceClient(env) } = {}) {
  const refunds = refundSettlementCandidates(stem, instruction, party);
  // Refund and credit evidence are different settlement methods; never substitute one for the other.
  if (instruction?.instruction_type === 'get_back_paid') return { candidates: refunds };
  const amount = instruction?.planned_amount ?? action?.amount;
  if (instruction && instruction.instruction_type !== 'withhold_unpaid') return { candidates: [] };
  if (!instruction && (action?.action_type !== 'issue_buyer_credit_note' || action.currency_iso_code !== 'USD')) return { candidates: [] };
  if (!(Number(amount) > 0)) return { candidates: [] };
  const side = action.party_side;
  if (!/^[a-zA-Z0-9]{15,18}$/.test(stem.Id) || !/^[a-zA-Z0-9]{15,18}$/.test(party.account_id)) throw new Error('Valid dispute source identities are required.');
  const soql = side === 'buyer'
    ? `SELECT Id, Name, STEM__c, STEM__r.Account__c, Amount__c, Invoice_Date__c, LastModifiedDate FROM Invoice__c WHERE STEM__c = '${stem.Id}' AND Amount__c < 0 AND Proforma__c = false AND Deprecated__c = false`
    : `SELECT Id, Name, STEM__c, Supplier__c, Invoice_Amount__c, Invoice_Date__c, LastModifiedDate FROM Supplier_Invoice__c WHERE STEM__c = '${stem.Id}' AND Supplier__c = '${party.account_id}' AND Invoice_Amount__c < 0`;
  let invoiceMapping;
  if (instruction) {
    const result = await client.from('xero_financial_document_mappings').select('*').eq('salesforce_object', 'Supplier_Invoice__c').eq('salesforce_id', instruction.source_supplier_invoice_id).maybeSingle();
    if (result.error) throw result.error;
    invoiceMapping = result.data;
    if (!invoiceMapping) return { candidates: [] };
  }
  const records = await sfQuery(soql, { clean: true, limit: 2000 });
  if (records.totalSize > (records.records || []).length) throw new Error('The settlement evidence check was incomplete. Refresh before using a match.');
  const candidates = [];
  let connection;
  for (const record of records.records || []) {
    const { data: mapping, error } = await client.from('xero_financial_document_mappings').select('*')
      .eq('salesforce_object', side === 'buyer' ? 'Invoice__c' : 'Supplier_Invoice__c').eq('salesforce_id', record.Id).maybeSingle();
    if (error) throw error;
    if (!mapping) continue;
    connection ||= await getFreshXeroConnection(client, { env, fetchImpl });
    const result = await xeroAccountingFetch(connection, `/CreditNotes/${encodeURIComponent(mapping.xero_document_id)}`, { method: 'GET', env, fetchImpl });
    const evidence = instruction ? exactAllocatedCreditEvidence(record, result.CreditNotes?.[0], { party, stem, instruction, mapping, invoiceMapping })
      : exactCreditEvidence(record, result.CreditNotes?.[0], { partyAccountId: party.account_id, side, stemId: stem.Id, amount, mapping });
    if (evidence) candidates.push(evidence);
  }
  return { candidates };
}

// Access checks stay at the same service boundary for suggestions and final settlement saves.
export function createDisputeSettlementEvidenceHandlers({ requireActiveUser, requireCapability, getDisputeBetaCase,
  requireInterofficeStemAccess, loadCurrentDisputeStem, loadDisputeWorkflowActions, assertValidDisputeParties, appError,
  loadEvidence = loadDisputeSettlementEvidence }) {
  async function disputeWorkflowSettlementEvidence(body = {}, req, accessContext = null) {
    const context = accessContext || (await requireActiveUser(req));
    await requireCapability(context.client, context.profile, 'disputes_account', 'Finance permission is required to review settlement evidence.');
    if (Boolean(body.instructionId) === Boolean(body.actionId)) throw appError('Provide exactly one settlement action or supplier instruction.', 400);
    const table = body.instructionId ? 'dispute_workflow_supplier_instructions' : 'dispute_beta_actions';
    const { data: target, error } = await context.client.from(table).select('*').eq('id', body.instructionId || body.actionId).maybeSingle();
    if (error) throw error;
    if (!target) throw appError('Settlement action not found.', 404);
    const caseRow = await getDisputeBetaCase(context.client, target.case_id);
    await requireInterofficeStemAccess(caseRow.stem_id, context);
    const stem = await loadCurrentDisputeStem(caseRow.stem_id, context);
    const workflow = await loadDisputeWorkflowActions(context.client, caseRow.id);
    assertValidDisputeParties(stem, workflow.partyRows);
    const instruction = body.instructionId ? workflow.instructionRows.find((row) => row.id === target.id && row.status !== 'Superseded') : null;
    const action = workflow.actionRows.find((row) => row.id === (instruction?.action_id || body.actionId));
    const party = workflow.partyRows.find((row) => row.id === action?.party_id);
    if (!action || !party || (body.instructionId && !instruction)) throw appError('The settlement instruction changed. Refresh it.', 409);
    return loadEvidence({ stem, action, instruction, party });
  }

  async function verifiedSettlementInput(body, req, context) {
    const { verifiedEvidence: _untrustedEvidence, ...input } = body;
    body = input;
    if (!body.evidenceId) return body;
    const { candidates } = await disputeWorkflowSettlementEvidence(body, req, context);
    const evidence = candidates.find((row) => row.id === body.evidenceId && row.fingerprint === body.evidenceFingerprint);
    if (!evidence) throw appError('The selected settlement evidence changed. Review the refreshed evidence before saving.', 409);
    return { ...body, settlementReference: evidence.reference, settlementDate: evidence.date, settlementAmount: evidence.amount,
      ...(evidence.type === 'refund' ? { recoveryMethod: 'cash_refund', matchedSalesforcePaymentId: evidence.salesforceId } : {}),
      verifiedEvidence: evidence };
  }

  return { disputeWorkflowSettlementEvidence, verifiedSettlementInput };
}
