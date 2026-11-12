import { validateTradeCashLedger } from './_tradeCashLedger.js';
import { xeroPaymentDate } from './_xeroPaymentAssociation.js';
import { paymentSourceFingerprint } from './_xeroFinancialSync.js';
import {
  xeroPrepaymentEvidenceFingerprint as hash, validateXeroPrepaymentCreateResult,
  reconcileXeroPrepaymentInvoice,
} from './_xeroPrepaymentCurrency.js';

const EVENT_FIELDS = 'Id,STEM__c,Party__c,Direction__c,Currency__c,Kind__c,Cash_HKD_Amount__c,Cash_USD_Amount__c,FX_Rate__c,FX_Revision__c,FX_Effective_At__c,Payment_Date__c,Bank__c,Bank_Currency__c,Bank_Native_Amount__c,Bank_Evidence__c,Reference__c,Trade_FX_Side__c,Buyer_Proforma__c,Supplier_Proforma__c,Original_Cash_Event__c,Original_Carrying_USD__c,Original_Bank_Allocation__c,Settlement_FX_USD__c,Operation_Id__c,Request_Fingerprint__c'.split(',');
const ALLOCATION_FIELDS = 'Id,Cash_Event__c,Buyer_Invoice__c,Supplier_Invoice__c,Payment__c,Currency__c,Kind__c,Reverses_Allocation__c,Allocation_Date__c,Allocated_HKD__c,Allocated_Cash_USD__c,Invoice_Carrying_USD__c,Bank_Native_Allocation__c,Settlement_FX_USD__c,Operation_Id__c,Request_Fingerprint__c'.split(',');
const NUMERIC = /(?:Amount|USD|Rate|Allocation|Allocated_HKD)__c$/;
function fail(message) { throw Object.assign(new Error(message), { code:'XERO_PREPAYMENT_RECONCILIATION_DRIFT',status:409 }); }
function cents(value) {
  if (value == null || !/^-?\d+(?:\.\d{1,2})?$/.test(String(value)) || !Number.isSafeInteger(Math.round(Number(value)*100))) fail('Explicit exact native and USD amounts are required.');
  return Math.round(Number(value)*100);
}
function equal(left,right,label) { if(cents(left)!==cents(right)) fail(`${label} differs from immutable evidence.`); }
function date(value) {
  const day = xeroPaymentDate(value);
  if (!day) fail('A provider date is invalid.');
  return day;
}
function unique(rows,field,label) {
  const result=new Map(rows.map(row=>[row[field],row]));
  if(result.size!==rows.length || result.has(undefined) || result.has(null)) fail(`${label} identities are incomplete or duplicated.`);
  return result;
}
export function prepaymentSourceFingerprint(record) {
  const fields=record?.Cash_Event__c ? ALLOCATION_FIELDS : EVENT_FIELDS;
  return hash(Object.fromEntries(fields.map(field=>[field, record?.[field] == null ? null : NUMERIC.test(field) ? Number(record[field]) : record[field]])));
}

/** Only financial evidence belongs in approvals; loader connections and tokens must never be serialized. */
export function prepaymentReconciliationEvidence(context) {
  return Object.fromEntries(['tenantId','events','allocations','payments','invoices','operations','xeroPrepayments','xeroBankTransactions','xeroInvoices','xeroPayments','documentMappings','paymentMappings','creditAllocationLedger']
    .map(key=>[key,context[key] ?? (key==='tenantId'?null:[])]));
}

/** Bind prior proofs by immutable hashes without recursively copying every earlier review. */
export function prepaymentApprovalEvidence(context) {
  const evidence=prepaymentReconciliationEvidence(context);
  evidence.operations=evidence.operations.map(operation=>Object.fromEntries([
    'operation_id','tenant_id','cash_event_id','source_kind','source_id','action','source_hash','review_hash','request_hash',
    'currency','native_amount','accounting_usd','invoice_mapping_id','status','send_started_at',
    'xero_bank_transaction_id','xero_prepayment_id','xero_allocation_id','xero_payment_id',
  ].map(key=>[key,operation[key] ?? null])));
  evidence.creditAllocationLedger=evidence.creditAllocationLedger.map(operation=>Object.fromEntries([
    'operation_id','tenant_id','credit_mapping_id','invoice_mapping_id','request_hash','currency','native_amount','accounting_usd','status','xero_allocation_id',
  ].map(key=>[key,operation[key] ?? null])));
  return evidence;
}

/** Reconcile applied operations against current provider money, independent of pending Salesforce work. */
export function reconcilePrepaymentLedger({
  tenantId, events=[],allocations=[],payments=[],invoices=[],operations=[],
  xeroPrepayments=[],xeroBankTransactions=[],xeroInvoices=[],xeroPayments=[],
  documentMappings=[],paymentMappings=[],creditAllocationLedger=[],ignoreOperationId=null,
}) {
  const local=validateTradeCashLedger({events,allocations,payments,invoices});
  const eventById=unique(events,'Id','Cash event');
  const allocationById=unique(allocations,'Id','Cash allocation');
  const prepaymentById=unique(xeroPrepayments,'PrepaymentID','Xero prepayment');
  const bankById=unique(xeroBankTransactions,'BankTransactionID','Xero bank transaction');
  const invoiceById=unique(xeroInvoices,'InvoiceID','Xero invoice');
  const paymentById=unique(xeroPayments,'PaymentID','Xero payment');
  unique(operations,'operation_id','Prepayment operation');
  const applied=operations.filter(row=>row.status==='applied');
  const creates=new Map(); const activeAllocations=[]; const refunds=[]; const reversals=new Set();
  for(const operation of operations) {
    if(operation.tenant_id!==tenantId) fail('Prepayment evidence belongs to a different Xero tenant.');
    if(operation.operation_id!==ignoreOperationId && ['processing','unknown','exception'].includes(operation.status))
      fail('Reconcile the unresolved prepayment operation before another action.');
    if(operation.status!=='applied') continue;
    const record=['create','refund'].includes(operation.action)?eventById.get(operation.source_id):allocationById.get(operation.source_id);
    const request=operation.request_evidence;
    if(!record || !request?.proposal || operation.source_hash!==prepaymentSourceFingerprint(record)
        || request.sourceFingerprint!==operation.source_hash || operation.review_hash!==request.reviewFingerprint
        || operation.request_hash!==hash(request) || request.sourceId!==operation.source_id || request.action!==operation.action
        || request.cashEventId!==operation.cash_event_id || operation.currency!==record.Currency__c)
      fail('Applied operation no longer matches its exact immutable Salesforce source.');
    equal(operation.native_amount, Math.abs(record.Currency__c==='HKD'
      ? (record.Cash_HKD_Amount__c ?? record.Allocated_HKD__c) : (record.Cash_USD_Amount__c ?? record.Allocated_Cash_USD__c)), 'Operation native amount');
    equal(operation.accounting_usd, Math.abs(record.Cash_USD_Amount__c ?? record.Allocated_Cash_USD__c), 'Operation accounting USD');
    if(operation.action==='create') {
      if(record.Kind__c!=='Payment' || operation.cash_event_id!==record.Id || creates.has(record.Id)) fail('Original cash has duplicate or invalid prepayment identities.');
      const bank=bankById.get(operation.xero_bank_transaction_id), prepayment=prepaymentById.get(operation.xero_prepayment_id);
      if(!bank || !prepayment || bank.PrepaymentID!==prepayment.PrepaymentID || typeof bank.IsReconciled!=='boolean') fail('Original bank transaction or prepayment is missing.');
      // Bank reconciliation and later applications do not change the original financial snapshot.
      validateXeroPrepaymentCreateResult(request.proposal, {
        bankTransactionsResponse:{BankTransactions:[{...bank,IsReconciled:false}]},
        prepayment:{...prepayment,Status:'AUTHORISED',RemainingCredit:prepayment.Total,Allocations:[],Payments:[]},
      });
      creates.set(record.Id,operation);
    }
  }
  for(const operation of applied.filter(row=>row.action!=='create')) {
    const original=creates.get(operation.cash_event_id);
    if(!original || original.xero_prepayment_id!==operation.xero_prepayment_id) fail('A child operation lacks its exact original prepayment mapping.');
    if(operation.action==='refund') {
      const source=eventById.get(operation.source_id), live=paymentById.get(operation.xero_payment_id);
      const evidence=operation.request_evidence.proposal.evidence;
      if(source.Kind__c!=='Refund' || source.Original_Cash_Event__c!==operation.cash_event_id || !live
          || live.Status!=='AUTHORISED' || live.Prepayment?.PrepaymentID!==operation.xero_prepayment_id
          || live.Account?.AccountID!==evidence.bank.id || date(live.Date)!==source.Payment_Date__c
          || live.PaymentType!==evidence.expectedPaymentType
          || (source.Currency__c==='HKD' ? Number(live.CurrencyRate)!==Number(source.FX_Rate__c) : live.CurrencyRate!=null && Number(live.CurrencyRate)!==1))
        fail('Refund identity, date, bank or rate differs from immutable cash evidence.');
      equal(live.Amount,operation.native_amount,'Refund native amount');equal(live.BankAmount,source.Bank_Native_Amount__c,'Refund bank amount');
      refunds.push({operation,paymentId:live.PaymentID,amount:Number(operation.native_amount)});
      continue;
    }
    const source=allocationById.get(operation.source_id);
    const sourceInvoice=source.Buyer_Invoice__c || source.Supplier_Invoice__c;
    const mapping=documentMappings.find(row=>row.id===operation.invoice_mapping_id);
    if(!mapping || mapping.salesforce_id?.slice(0,15)!==sourceInvoice?.slice(0,15) || mapping.salesforce_object!==(source.Buyer_Invoice__c?'Invoice__c':'Supplier_Invoice__c')
        || operation.request_evidence.invoiceMappingId!==mapping.id) fail('Application invoice mapping changed.');
    if(operation.action==='reverse') {
      const prior=applied.find(row=>row.action==='allocate' && row.source_id===source.Reverses_Allocation__c);
      if(source.Kind__c!=='Reversal' || !prior || prior.xero_allocation_id!==operation.xero_allocation_id
          || prior.invoice_mapping_id!==operation.invoice_mapping_id || reversals.has(prior.operation_id)) fail('Reversal does not identify its original applied allocation.');
      reversals.add(prior.operation_id);
    } else if(operation.action==='allocate' && source.Kind__c==='Applied') {
      activeAllocations.push({operation,allocationId:operation.xero_allocation_id,invoiceId:mapping.xero_document_id,amount:Number(operation.native_amount)});
    } else fail('Applied operation kind is invalid.');
  }
  const active=activeAllocations.filter(row=>!reversals.has(row.operation.operation_id));
  for(const original of creates.values()) {
    const live=prepaymentById.get(original.xero_prepayment_id);
    const expectedAllocations=active.filter(row=>row.operation.cash_event_id===original.cash_event_id);
    const expectedRefunds=refunds.filter(row=>row.operation.cash_event_id===original.cash_event_id);
    const expectedRemaining=cents(original.native_amount)-expectedAllocations.reduce((sum,row)=>sum+cents(row.amount),0)-expectedRefunds.reduce((sum,row)=>sum+cents(row.amount),0);
    if(expectedRemaining<0 || cents(live.RemainingCredit)!==expectedRemaining || live.Status!==(expectedRemaining===0?'PAID':'AUTHORISED')) fail('Prepayment remaining credit does not reconcile to applied operations.');
    const liveAllocations=unique(live.Allocations || [],'AllocationID','Live prepayment allocation');
    const liveRefunds=unique(live.Payments || [],'PaymentID','Live prepayment refund');
    if(liveAllocations.size!==expectedAllocations.length || liveRefunds.size!==expectedRefunds.length) fail('Prepayment contains an unknown or missing application or refund.');
    for(const row of expectedAllocations) {
      const allocation=liveAllocations.get(row.allocationId);
      if(!allocation || allocation.Invoice?.InvoiceID!==row.invoiceId || date(allocation.Date)!==row.operation.request_evidence.proposal.evidence.allocationDate) fail('Applied Xero allocation identity or date changed.');
      equal(allocation.Amount,row.amount,'Live allocation');
    }
    for(const row of expectedRefunds) equal(liveRefunds.get(row.paymentId)?.Amount,row.amount,'Live refund');
  }
  for(const mapping of documentMappings.filter(row=>invoices.some(invoice=>invoice.Id.slice(0,15)===row.salesforce_id?.slice(0,15)))) {
    const invoice=invoiceById.get(mapping.xero_document_id);
    if(!invoice) fail('A mapped final invoice is unavailable in Xero.');
    const prepayments=new Map();
    for(const row of active.filter(row=>row.invoiceId===invoice.InvoiceID)) {
      const id=row.operation.xero_prepayment_id;prepayments.set(id,(prepayments.get(id)||0)+cents(row.amount));
    }
    const direct=payments.filter(row=>!row.Cash_Event__c && (row.Buyer_Invoice__c || row.Supplier_Invoice__c)?.slice(0,15)===mapping.salesforce_id.slice(0,15));
    const expectedPayments=direct.map(source=> {
      const paymentMapping=paymentMappings.find(row=>row.salesforce_payment_id?.slice(0,15)===source.Id.slice(0,15));
      const live=paymentById.get(paymentMapping?.xero_payment_id);
      if(!paymentMapping || paymentMapping.source_fingerprint!==paymentSourceFingerprint(source) || paymentMapping.document_mapping_id!==mapping.id
          || !live || live.Status!=='AUTHORISED' || live.Invoice?.InvoiceID!==invoice.InvoiceID || live.Account?.AccountID!==paymentMapping.xero_bank_account_id
          || date(live.Date)!==source.Date__c || (source.Payment_Currency__c || 'USD')!==invoice.CurrencyCode) fail('Direct invoice payments need exact reconciled mappings before prepayment operations.');
      if(source.Payment_Currency__c==='HKD' && (!(Number(paymentMapping.xero_currency_rate)>0)
          || Number(live.CurrencyRate)!==Number(paymentMapping.xero_currency_rate)
          || paymentMapping.xero_bank_amount==null || cents(live.BankAmount)!==cents(paymentMapping.xero_bank_amount)))
        fail('Direct payment bank or exchange-rate evidence changed in Xero.');
      const amount=source.Payment_Currency__c==='HKD'?source.Payment_HKD_Amount__c:source.Amount__c;
      if(cents(amount)<=0) fail('Unexpected direct negative invoice payment.');
      equal(live.Amount,amount,'Direct invoice payment');
      return {paymentId:live.PaymentID,amount:Number(amount)};
    });
    const credits=creditAllocationLedger.filter(row=>row.tenant_id===tenantId && row.status==='applied' && row.invoice_mapping_id===mapping.id)
      .map(row=>({creditNoteId:row.request_evidence?.xeroCreditId,amount:Number(row.native_amount)}));
    // Use any mapped original prepayment to validate invoice-wide payment collections.
    const original=creates.values().next().value;
    if(original) reconcileXeroPrepaymentInvoice({prepayment:prepaymentById.get(original.xero_prepayment_id),invoice,
      expectedAllocations:active.filter(row=>row.operation.cash_event_id===original.cash_event_id),
      expectedRefunds:refunds.filter(row=>row.operation.cash_event_id===original.cash_event_id),
      expectedInvoicePrepayments:[...prepayments].map(([prepaymentId,amount])=>({prepaymentId,amount:amount/100})),
      expectedInvoicePayments:expectedPayments,expectedInvoiceCredits:credits});
    else if((invoice.Prepayments || []).length || (invoice.Overpayments || []).length) fail('The invoice contains untracked prepayments or overpayments.');
  }
  return {...local,appliedOperations:applied};
}
