import { prepaymentSourceFingerprint } from '../../api/_xeroPrepaymentReconciliation.js';
import { buildXeroPrepaymentCreate,xeroPrepaymentEvidenceFingerprint as hash } from '../../api/_xeroPrepaymentCurrency.js';
export const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export function fixture() {
  const cash={Id:'cash',STEM__c:'stem',Party__c:'buyer',Direction__c:'Sell',Currency__c:'HKD',Kind__c:'Payment',
    Cash_HKD_Amount__c:780,Cash_USD_Amount__c:97.5,FX_Rate__c:8,FX_Revision__c:'rate',FX_Effective_At__c:'2026-09-09T16:00:00Z',
    Payment_Date__c:'2026-09-10',Bank__c:'DBS',Bank_Currency__c:'HKD',Bank_Native_Amount__c:780,Bank_Evidence__c:'statement',
    Trade_FX_Side__c:'side',Settlement_FX_USD__c:0,Operation_Id__c:id(1),Request_Fingerprint__c:'a'.repeat(64)};
  const invoice={Id:'invoice',STEM__c:'stem',STEM__r:{Account__c:'buyer'},Document_Currency__c:'HKD',Amount__c:200,Document_HKD_Amount__c:1560,
    Document_FX_Rate__c:7.8,Document_FX_Revision__c:'trade-rate',Document_FX_Confirmed_At__c:'2026-09-01T00:00:00Z',File__c:'issued'};
  const proposal=buildXeroPrepaymentCreate({cashEvent:cash,agreedCurrency:'HKD',organisation:{OrganisationID:id(9),BaseCurrency:'USD'},
    bankAccount:{AccountID:id(2),Type:'BANK',Status:'ACTIVE',CurrencyCode:'HKD'},contact:{ContactID:id(3),SalesforceAccountID:'buyer'},
    depositAccount:{AccountID:id(4),Code:'DEPOSIT',Status:'ACTIVE',Type:'CURRENTLIABILITY'},zeroTaxRate:{TaxType:'NONE',Status:'ACTIVE',EffectiveRate:0}});
  const f={tenantId:id(9),events:[cash],allocations:[],payments:[],invoices:[invoice],operations:[],
    xeroPrepayments:[{PrepaymentID:id(5),Type:'RECEIVE-PREPAYMENT',Status:'AUTHORISED',CurrencyCode:'HKD',CurrencyRate:8,Contact:{ContactID:id(3)},Total:780,RemainingCredit:780,Date:'2026-09-10',Allocations:[],Payments:[]}],
    xeroBankTransactions:[{...proposal.payload.BankTransactions[0],BankTransactionID:id(6),PrepaymentID:id(5),Status:'AUTHORISED',Total:780,
      LineItems:[{...proposal.payload.BankTransactions[0].LineItems[0],LineAmount:780}]}],
    xeroInvoices:[{InvoiceID:id(7),Type:'ACCREC',Status:'AUTHORISED',CurrencyCode:'HKD',CurrencyRate:7.8,Contact:{ContactID:id(3)},Date:'2026-09-11',
      Total:1560,AmountDue:1560,AmountPaid:0,AmountCredited:0,Payments:[],Prepayments:[],CreditNotes:[],Overpayments:[]}],
    xeroPayments:[],documentMappings:[{id:id(8),salesforce_id:'invoice',salesforce_object:'Invoice__c',xero_document_id:id(7)}],paymentMappings:[],creditAllocationLedger:[]};
  register(f,cash,'create',proposal,{xero_bank_transaction_id:id(6),xero_prepayment_id:id(5)});
  return f;
}
export function register(f,source,action,proposal,identities={}) {
  const allocation=['allocate','reverse'].includes(action);
  const native=Math.abs(source.Currency__c==='HKD'?(source.Cash_HKD_Amount__c ?? source.Allocated_HKD__c):(source.Cash_USD_Amount__c ?? source.Allocated_Cash_USD__c));
  const request={sourceId:source.Id,action,cashEventId:'cash',sourceFingerprint:prepaymentSourceFingerprint(source),reviewFingerprint:'b'.repeat(64),
    status:'eligible',currency:source.Currency__c,nativeAmount:native,accountingUsd:Math.abs(source.Cash_USD_Amount__c ?? source.Allocated_Cash_USD__c),
    ...(allocation?{invoiceMappingId:id(8)}:{}),proposal};
  const operation={operation_id:id(100+f.operations.length),tenant_id:f.tenantId,cash_event_id:'cash',source_id:source.Id,action,status:'applied',
    source_hash:request.sourceFingerprint,review_hash:request.reviewFingerprint,request_hash:hash(request),request_evidence:request,
    currency:source.Currency__c,native_amount:request.nativeAmount,accounting_usd:request.accountingUsd,invoice_mapping_id:allocation?id(8):null,...identities};
  f.operations.push(operation);return operation;
}
export function allocation(f,{reverse=false,posted=true}={}) {
  const cash=f.events[0],sign=reverse?-1:1;
  const row={Id:reverse?'reversal':'allocation',Cash_Event__c:'cash',Buyer_Invoice__c:'invoice',Supplier_Invoice__c:null,Payment__c:reverse?'payment-r':'payment-a',
    Currency__c:'HKD',Kind__c:reverse?'Reversal':'Applied',Reverses_Allocation__c:reverse?'allocation':null,Allocation_Date__c:'2026-09-11',
    Allocated_HKD__c:780*sign,Allocated_Cash_USD__c:97.5*sign,Invoice_Carrying_USD__c:100*sign,Bank_Native_Allocation__c:780*sign,Settlement_FX_USD__c:-2.5*sign,
    Operation_Id__c:id(reverse?12:11),Request_Fingerprint__c:'c'.repeat(64)};
  const payment={Id:row.Payment__c,Cash_Event__c:'cash',STEM__c:'stem',Account__c:'buyer',RecordType:{DeveloperName:'Receivable'},Buyer_Invoice__c:'invoice',Supplier_Invoice__c:null,
    Amount__c:row.Allocated_Cash_USD__c,Payment_HKD_Amount__c:row.Allocated_HKD__c,Invoice_Carrying_USD__c:row.Invoice_Carrying_USD__c,Settlement_FX_USD__c:row.Settlement_FX_USD__c,
    Payment_Currency__c:'HKD',Payment_FX_Rate__c:8,Payment_FX_Revision__c:'rate',Payment_FX_Effective_At__c:cash.FX_Effective_At__c,Date__c:cash.Payment_Date__c,
    Bank__c:'DBS',Bank_Currency__c:'HKD',Bank_Native_Amount__c:780,Bank_FX_Evidence__c:'statement',Payment_Operation_Id__c:row.Operation_Id__c,Payment_Request_Fingerprint__c:row.Request_Fingerprint__c};
  f.allocations.push(row);f.payments.push(payment);
  if(posted) {
    register(f,row,reverse?'reverse':'allocate',{action:reverse?'reversal':'allocation',evidence:{allocationDate:'2026-09-11'}},
      {xero_prepayment_id:id(5),xero_allocation_id:id(13)});
    f.xeroPrepayments[0].RemainingCredit=reverse?780:0;f.xeroPrepayments[0].Status=reverse?'AUTHORISED':'PAID';
    f.xeroPrepayments[0].Allocations=reverse?[]:[{AllocationID:id(13),Invoice:{InvoiceID:id(7)},Amount:780,Date:'2026-09-11'}];
    Object.assign(f.xeroInvoices[0],{AmountCredited:reverse?0:780,AmountDue:reverse?1560:780,Prepayments:reverse?[]:[{PrepaymentID:id(5),AppliedAmount:780}]});
  }
  return row;
}
