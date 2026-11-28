import { createHash } from 'node:crypto';

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

export async function loadDisputeSettlementEvidence({ stem, instruction, party }) {
  return { candidates: refundSettlementCandidates(stem, instruction, party) };
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
