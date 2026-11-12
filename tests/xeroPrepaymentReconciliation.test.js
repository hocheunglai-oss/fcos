import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentSourceFingerprint } from '../api/_xeroFinancialSync.js';
import { reconcilePrepaymentLedger,prepaymentSourceFingerprint,prepaymentApprovalEvidence } from '../api/_xeroPrepaymentReconciliation.js';

import {fixture,allocation,id,register} from './fixtures/xeroPrepayment.js';
import { buildXeroPrepaymentRefund } from '../api/_xeroPrepaymentCurrency.js';
test('deposits remain separate from future Salesforce applications until Xero confirms each operation',()=>{
  const f=fixture();assert.equal(reconcilePrepaymentLedger(f).balances.get('cash').native,78000);
  allocation(f,{posted:false});assert.equal(reconcilePrepaymentLedger(f).balances.get('cash').native,0);
  assert.equal(f.xeroInvoices[0].AmountPaid,0);assert.equal(f.xeroInvoices[0].AmountCredited,0);
});
test('applied cash reconciles as AmountCredited and reverses without creating another bank transaction',()=>{
  const f=fixture();allocation(f);assert.equal(reconcilePrepaymentLedger(f).appliedOperations.length,2);
  allocation(f,{reverse:true});assert.equal(reconcilePrepaymentLedger(f).balances.get('cash').native,78000);
  assert.equal(f.xeroBankTransactions.length,1);assert.equal(f.xeroPayments.length,0);
});
test('bank reconciliation does not rewrite original company cash accounting',()=>{
  const f=fixture();f.xeroBankTransactions[0].IsReconciled=true;reconcilePrepaymentLedger(f);
  f.xeroBankTransactions[0].CurrencyRate=7.8;assert.throws(()=>reconcilePrepaymentLedger(f),/immutable cash/);
});
test('unknown provider money, source mutation and mapping drift fail closed',()=>{
  for(const mutate of [f=>{f.events[0].Cash_USD_Amount__c=100;},f=>{f.operations[0].tenant_id=id(99);},
    f=>{f.xeroPrepayments[0].Allocations=[{AllocationID:id(66),Invoice:{InvoiceID:id(7)},Amount:1,Date:'2026-09-11'}];},
    f=>{f.xeroInvoices[0].Payments=[{PaymentID:id(55),Amount:1}];},f=>{allocation(f);f.operations[1].invoice_mapping_id=id(66);},
    f=>{f.operations[0].request_evidence.proposal.evidence.contactId=id(55);},f=>{f.xeroBankTransactions[0].LineItems[0].Description='manually edited';}]) {
    const f=fixture();mutate(f);assert.throws(()=>reconcilePrepaymentLedger(f));
  }
});
test('an unresolved operation blocks a new action while its own pre-send refresh may proceed',()=>{
  const f=fixture();f.operations.push({operation_id:id(20),tenant_id:f.tenantId,status:'processing'});
  assert.throws(()=>reconcilePrepaymentLedger(f),/unresolved/);
  reconcilePrepaymentLedger({...f,ignoreOperationId:id(20)});
});
test('fingerprints preserve immutable money while ignoring live display labels',()=>{
  const f=fixture(),source=f.events[0],fingerprint=prepaymentSourceFingerprint(source);
  assert.equal(prepaymentSourceFingerprint({...source,Name:'new display',Party__r:{Name:'renamed'}}),fingerprint);
  assert.notEqual(prepaymentSourceFingerprint({...source,Reference__c:'amended evidence'}),fingerprint);
});
test('approval evidence excludes private connections and binds prior reviews without recursive copies',()=>{
  const f=fixture();f.connection={accessToken:'test-secret-that-must-not-be-persisted'};
  const evidence=prepaymentApprovalEvidence(f);
  assert.equal(evidence.connection,undefined);assert.equal(evidence.operations[0].request_evidence,undefined);
  assert.equal(evidence.operations[0].request_hash,f.operations[0].request_hash);
  assert.ok(!JSON.stringify(evidence).includes('test-secret-that-must-not-be-persisted'));
});

test('a refunded deposit keeps its original cash basis and a separate payment-date FX difference after full credit',()=>{
  const f=fixture();allocation(f);allocation(f,{reverse:true});
  const source={...f.events[0],Id:'refund',Kind__c:'Refund',Original_Cash_Event__c:'cash',Operation_Id__c:id(90),
    Payment_Date__c:'2026-09-12',Cash_USD_Amount__c:100,FX_Rate__c:7.8,FX_Revision__c:'new-rate',FX_Effective_At__c:'2026-09-11T16:00:00Z',
    Original_Carrying_USD__c:97.5,Original_Bank_Allocation__c:780,Settlement_FX_USD__c:-2.5};
  const proposal=buildXeroPrepaymentRefund({refundEvent:source,originalEvent:f.events[0],agreedCurrency:'HKD',
    organisation:{OrganisationID:f.tenantId,BaseCurrency:'USD'},bankAccount:{AccountID:id(2),Type:'BANK',Status:'ACTIVE',CurrencyCode:'HKD'},
    contact:{ContactID:id(3),SalesforceAccountID:'buyer'},prepayment:f.xeroPrepayments[0]});
  f.events.push(source);register(f,source,'refund',proposal,{xero_prepayment_id:id(5),xero_payment_id:id(91)});
  f.xeroPayments.push({...proposal.payload.Payments[0],PaymentID:id(91),PaymentType:'ARPREPAYMENTPAYMENT',Status:'AUTHORISED',BankAmount:780});
  Object.assign(f.xeroPrepayments[0],{RemainingCredit:0,Status:'PAID',Payments:[{PaymentID:id(91),Amount:780}]});
  Object.assign(f.xeroInvoices[0],{AmountDue:0,AmountCredited:1560,Status:'PAID',CreditNotes:[{CreditNoteID:id(92),AppliedAmount:1560}]});
  f.creditAllocationLedger.push({tenant_id:f.tenantId,status:'applied',invoice_mapping_id:id(8),native_amount:1560,request_evidence:{xeroCreditId:id(92)}});
  const result=reconcilePrepaymentLedger(f);
  assert.deepEqual(result.balances.get('cash'),{native:0,usd:0,bank:0});
  assert.equal(f.events[0].Cash_USD_Amount__c,97.5);
  assert.equal(source.Cash_USD_Amount__c,100);assert.equal(source.Settlement_FX_USD__c,-2.5);
  for(const mutate of [input=>{input.xeroPayments[0].CurrencyRate=8;},input=>{input.xeroPayments[0].BankAmount=779.99;},
    input=>{input.xeroPayments[0].Account.AccountID=id(93);},input=>{input.xeroPrepayments[0].Payments=[];},input=>{input.creditAllocationLedger=[];}]) {
    const drift=structuredClone(f);mutate(drift);assert.throws(()=>reconcilePrepaymentLedger(drift));
  }
});

test('prepayment reconciliation accepts exact current native payment mappings and holds changed evidence', () => {
  const f = fixture();
  f.invoices[0].Id = 'a01000000000001AAA';
  f.documentMappings[0].salesforce_id = f.invoices[0].Id.slice(0, 15);
  const source = { Id: 'a02000000000001AAA', Name: 'Synthetic direct payment', STEM__c: 'stem',
    Buyer_Invoice__c: f.invoices[0].Id, Account__c: 'buyer', RecordType: { DeveloperName: 'Receivable' },
    Payment_Currency__c: 'HKD', CurrencyIsoCode: 'USD', Date__c: '2026-09-11',
    Amount__c: 97.50, Payment_HKD_Amount__c: 780 };
  const payment = { PaymentID: id(20), Amount: 780, BankAmount: 97.50, CurrencyRate: 8,
    Status: 'AUTHORISED', Date: source.Date__c, Invoice: { InvoiceID: id(7) }, Account: { AccountID: id(21) } };
  f.payments.push(source);
  f.xeroPayments.push(payment);
  f.paymentMappings.push({ salesforce_payment_id: source.Id.slice(0, 15), source_fingerprint: paymentSourceFingerprint(source),
    document_mapping_id: id(8), xero_payment_id: id(20), xero_bank_account_id: id(21), xero_currency_rate: 8, xero_bank_amount: 97.50 });
  Object.assign(f.xeroInvoices[0], { AmountPaid: 780, AmountDue: 780, Payments: [payment] });
  assert.equal(reconcilePrepaymentLedger(f).appliedOperations.length, 1);
  payment.CurrencyRate = 7.99;
  assert.throws(() => reconcilePrepaymentLedger(f), /bank or exchange-rate evidence changed/);
  payment.CurrencyRate = 8;
  source.Amount__c = 97.51;
  assert.throws(() => reconcilePrepaymentLedger(f), /exact reconciled mappings/);
});
