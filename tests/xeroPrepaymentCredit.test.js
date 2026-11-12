import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewCreditAllocation } from '../api/_xeroCreditAllocations.js';
import { fixture,allocation,id } from './fixtures/xeroPrepayment.js';

function creditFixture({postReversal=true,postAllocation=true}={}) {
  const cashLedger=fixture();allocation(cashLedger,{posted:postAllocation});allocation(cashLedger,{reverse:true,posted:postReversal});
  const original={...cashLedger.invoices[0],Name:'INV',Document_FX_Side__c:'side',Document_FX_Fingerprint__c:'original-review'};
  const credit={...original,Id:'credit',Name:'CN',Original_Invoice__c:original.Id,Amount__c:-200,Document_HKD_Amount__c:-1560,Document_FX_Fingerprint__c:'credit-review'};
  const invoiceMapping={...cashLedger.documentMappings[0],source_fingerprint:'if'};
  cashLedger.documentMappings=[invoiceMapping];
  const originalLine={Id:'line',Buyer_Invoice__c:original.Id,Source_Record_Id__c:'fuel',Quantity__c:10,Native_Unit_Price__c:156,Native_Amount__c:1560,Accounting_USD__c:200,
    Unit__c:'MT',Description__c:'Fuel',Pricing_Mode__c:'Unit',Currency__c:'HKD',FX_Rate__c:7.8,FX_Revision__c:'trade-rate'};
  return {original,credit,invoiceMapping,creditMapping:{id:id(77),salesforce_id:'credit',salesforce_object:'Invoice__c',xero_document_id:id(78),source_fingerprint:'cf'},
    sourceCredit:{sourceFingerprint:'cf',blockers:[]},sourceOriginal:{sourceFingerprint:'if',blockers:[]},cashLedger,payments:cashLedger.payments,
    xeroInvoice:cashLedger.xeroInvoices[0],xeroCredit:{CreditNoteID:id(78),Contact:{ContactID:id(3)},Type:'ACCRECCREDIT',CurrencyCode:'HKD',CurrencyRate:7.8,
      Total:1560,RemainingCredit:1560,Status:'AUTHORISED',Date:'2026-09-12',Allocations:[]},
    documentLines:[originalLine,{...originalLine,Id:'credit-line',Buyer_Invoice__c:'credit',Original_Line__c:'line',Native_Unit_Price__c:-156,Native_Amount__c:-1560,Accounting_USD__c:-200}]};
}
test('a full credit becomes allocatable after cash applications reverse in Salesforce and Xero',()=>{
  const review=reviewCreditAllocation(creditFixture());assert.deepEqual(review.blockers,[]);
  assert.equal(review.status,'eligible');assert.equal(review.amount,1560);assert.equal(review.accountingUsd,200);
  assert.equal(review.evidence.cashLedger.xeroInvoices[0].AmountPaid,0);
});
test('a Salesforce reversal alone cannot allocate the credit while Xero still holds the prepayment',()=>{
  const review=reviewCreditAllocation(creditFixture({postReversal:false}));assert.equal(review.status,'blocked');
  assert.match(review.blockers.join(' '),/Reverse the invoice cash applications/);
});
test('locally reversed applications that were never posted do not invent Xero transactions',()=>{
  const f=creditFixture({postReversal:false,postAllocation:false});
  const review=reviewCreditAllocation(f);assert.equal(review.status,'eligible');assert.equal(f.cashLedger.operations.length,1);
});
test('missing cash history or mismatched simultaneous invoice reads cannot approve a credit',()=>{
  const missing=creditFixture();missing.cashLedger=null;assert.equal(reviewCreditAllocation(missing).status,'blocked');
  const drift=creditFixture();drift.xeroInvoice={...drift.xeroInvoice,UpdatedDateUTC:'changed'};
  assert.match(reviewCreditAllocation(drift).blockers.join(' '),/changed between cash and credit review/);
});
