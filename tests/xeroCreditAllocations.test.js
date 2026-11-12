import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewCreditAllocation, reconcileCreditAllocation } from '../api/_xeroCreditAllocations.js';
import { loadCreditAllocationReview } from '../api/_xeroCreditAllocationContext.js';
import { paymentSourceFingerprint } from '../api/_xeroFinancialSync.js';
const ids = { operation:'10000000-0000-4000-8000-000000000001', tenant:'10000000-0000-4000-8000-000000000002', allocation:'10000000-0000-4000-8000-000000000003' };
function fixture() {
  const original = { Id:'invoice',Name:'INV',STEM__c:'stem',Document_FX_Side__c:'side',Document_FX_Fingerprint__c:'document-review',Amount__c:1000,File__c:'issued',Document_Currency__c:'HKD',Document_HKD_Amount__c:7800,Document_FX_Rate__c:7.8,Document_FX_Revision__c:'rate',Document_FX_Confirmed_At__c:'2026-09-01T00:00:00Z' };
  const result = { original, credit:{...original,Id:'credit',Name:'CN',Original_Invoice__c:'invoice',Amount__c:-1000,Document_HKD_Amount__c:-7800},
    creditMapping:{id:'cm',salesforce_id:'credit',salesforce_object:'Invoice__c',xero_document_id:'xc',source_fingerprint:'cf'},
    invoiceMapping:{id:'im',salesforce_id:'invoice',salesforce_object:'Invoice__c',xero_document_id:'xi',source_fingerprint:'if'},
    sourceCredit:{sourceFingerprint:'cf',blockers:[]},sourceOriginal:{sourceFingerprint:'if',blockers:[]},
    xeroCredit:{CreditNoteID:'xc',Contact:{ContactID:'contact'},Type:'ACCRECCREDIT',CurrencyCode:'HKD',CurrencyRate:7.8,Total:7800,RemainingCredit:7800,Status:'AUTHORISED',Date:'2026-09-10',Allocations:[]},
    xeroInvoice:{InvoiceID:'xi',Contact:{ContactID:'contact'},Type:'ACCREC',CurrencyCode:'HKD',CurrencyRate:7.8,Total:7800,AmountDue:3900,Status:'AUTHORISED',Date:'2026-09-01'},
    documentLines:[{Id:'original-line',Buyer_Invoice__c:'invoice',Source_Record_Id__c:'fuel',Native_Amount__c:7800,Accounting_USD__c:1000},
      {Id:'credit-line',Buyer_Invoice__c:'credit',Original_Line__c:'original-line',Source_Record_Id__c:'fuel',Native_Amount__c:-7800,Accounting_USD__c:-1000}] };
  for (const line of result.documentLines) Object.assign(line, { Quantity__c:10,Native_Unit_Price__c:line.Native_Amount__c / 10,Unit__c:'MT',Description__c:'Fuel',Pricing_Mode__c:'Unit',Currency__c:'HKD',FX_Rate__c:7.8,FX_Revision__c:'rate' });
  result.payments=[{Id:'payment',Buyer_Invoice__c:'invoice',Amount__c:500,Invoice_Carrying_USD__c:500,Payment_Currency__c:'HKD',Payment_HKD_Amount__c:3900,Payment_FX_Rate__c:7.8,Date__c:'2026-09-02'}];
  result.paymentMappings=[{salesforce_payment_id:'payment',xero_payment_id:'xp',xero_bank_account_id:'bank',document_mapping_id:'im',xero_currency_rate:7.8,xero_bank_amount:3900,source_fingerprint:paymentSourceFingerprint(result.payments[0])}];
  result.xeroPayments=[{PaymentID:'xp',Status:'AUTHORISED',CurrencyRate:7.8,BankAmount:3900,Invoice:{InvoiceID:'xi',CurrencyCode:'HKD'},Amount:3900,Date:'2026-09-02',Account:{AccountID:'bank'}}];
  return result;
}
function completed(request) { return {credit:{...request.evidence.xeroCredit,RemainingCredit:request.creditRemaining-request.amount,Allocations:[{AllocationID:ids.allocation,Date:request.allocationDate,Amount:request.amount,Invoice:{InvoiceID:request.xeroInvoiceId}}]},invoice:{...request.evidence.xeroInvoice,AmountDue:0}}; }
test('review allocates only unpaid original native amount and preserves residual cash-refund credit', () => {
  const row=reviewCreditAllocation(fixture());assert.equal(row.status,'eligible');assert.equal(row.amount,3900);assert.equal(row.accountingUsd,500);assert.equal(row.residualCredit,3900);
  assert.equal(row.allocationDate,'2026-09-10');assert.deepEqual(row.proposedPayload,{Allocations:[{Amount:3900,Invoice:{InvoiceID:'xi'}}]});
});
test('identity, currency, issued source, cent-level full reversal and immutable line drift block', () => {
  for(const change of [f=>{f.credit.Original_Invoice__c='usd-reissue';},f=>{f.xeroInvoice.CurrencyCode='USD';},f=>{f.credit.File__c=null;},f=>{f.credit.Amount__c=-999.99;},f=>{f.documentLines[1].Original_Line__c='other';},f=>{f.creditMapping.source_fingerprint='old';},f=>{f.sourceOriginal.differences=['changed'];},f=>{f.xeroCredit.RemainingCredit=3899.99;},f=>{f.xeroCredit.Allocations=[{Invoice:{InvoiceID:'other'}}];}]) {const f=fixture();change(f);assert.equal(reviewCreditAllocation(f).status,'blocked');}
});
test('review fingerprint changes when external balances or source evidence changes', () => {
  const f=fixture();const first=reviewCreditAllocation(f).reviewFingerprint;f.xeroInvoice.UpdatedDateUTC='2026-09-11T00:00:00Z';assert.notEqual(reviewCreditAllocation(f).reviewFingerprint,first);
});
test('readback matches one new exact allocation plus expected balance changes and rejects ambiguity', () => {
  const request=reviewCreditAllocation(fixture());const after=completed(request);const operation={request_evidence:request};
  assert.equal(reconcileCreditAllocation(operation,after.credit,after.invoice).allocationId,ids.allocation);
  after.credit.Allocations.push({...after.credit.Allocations[0],AllocationID:'10000000-0000-4000-8000-000000000004'});assert.throws(()=>reconcileCreditAllocation(operation,after.credit,after.invoice),/ambiguous|More than one/);
  after.credit.Allocations.pop();after.invoice.AmountDue=0.01;assert.throws(()=>reconcileCreditAllocation(operation,after.credit,after.invoice),/balances/);
});
test('unreconciled cash and refunds cannot allocate unpaid credit face',()=> {
  for(const change of [f=>{f.xeroInvoice.AmountDue=7800;},f=>{f.payments=[];f.paymentMappings=[];},f=>{f.xeroPayments=[];},f=>{f.paymentMappings[0].source_fingerprint='stale';},f=>{f.xeroPayments[0].Amount=3899.99;}]) {const f=fixture();change(f);assert.equal(reviewCreditAllocation(f).status,'blocked');}
});

test('full credit proof rejects sub-cent and eight-decimal inverse tampering',()=> {
  for(const [field,value] of [['Native_Amount__c',-7799.999999],['Accounting_USD__c',-999.999999],['Native_Unit_Price__c',-779.99999999],['Quantity__c',10.000001],['Native_Minimum__c',0],['Description__c','changed'],['Pricing_Mode__c','Lumpsum']]) {
    const f=fixture();f.documentLines[1][field]=value;assert.equal(reviewCreditAllocation(f).status,'blocked',field);
  }
  for(const field of ['STEM__c','Document_FX_Side__c']) {const f=fixture();f.credit[field]='other';assert.equal(reviewCreditAllocation(f).status,'blocked');}
});

test('managed USD and supplier full credits keep direction and same-currency allocation amounts',()=> {
  for(const supplier of [false,true]) {
    const f=fixture();
    for(const doc of [f.original,f.credit]) Object.assign(doc,{Document_Currency__c:'USD',Document_HKD_Amount__c:null,Document_FX_Rate__c:null,Document_FX_Revision__c:null});
    f.original.Reissue_Of_Invoice__c='old-hkd';
    for(const line of f.documentLines) Object.assign(line,{Currency__c:'USD',Native_Amount__c:line.Accounting_USD__c,Native_Unit_Price__c:line.Accounting_USD__c/10,FX_Rate__c:null,FX_Revision__c:null});
    Object.assign(f.xeroInvoice,{CurrencyCode:'USD',Total:1000,AmountDue:500});Object.assign(f.xeroCredit,{CurrencyCode:'USD',Total:1000,RemainingCredit:1000});
    Object.assign(f.payments[0],{Payment_Currency__c:'USD',Payment_HKD_Amount__c:null,Payment_FX_Rate__c:null});
    Object.assign(f.xeroPayments[0],{Amount:500,Invoice:{InvoiceID:'xi',CurrencyCode:'USD'}});
    if(supplier) {
      for(const doc of [f.original,f.credit]) Object.assign(doc,{Invoice_Amount__c:doc.Amount__c,Invoice_File__c:doc.File__c,Supplier__c:'supplier'});
      f.original.Reissue_Of_Supplier_Invoice__c='old-hkd';delete f.original.Reissue_Of_Invoice__c;
      f.credit.Original_Supplier_Invoice__c='invoice';delete f.credit.Original_Invoice__c;
      f.creditMapping.salesforce_object='Supplier_Invoice__c';f.invoiceMapping.salesforce_object='Supplier_Invoice__c';
      f.xeroCredit.Type='ACCPAYCREDIT';f.xeroInvoice.Type='ACCPAY';
      for(const line of f.documentLines) {line.Supplier_Invoice__c=line.Buyer_Invoice__c;delete line.Buyer_Invoice__c;}
      f.payments[0].Supplier_Invoice__c='invoice';delete f.payments[0].Buyer_Invoice__c;
    }
    f.paymentMappings[0].source_fingerprint=paymentSourceFingerprint(f.payments[0]);
    const row=reviewCreditAllocation(f);assert.equal(row.status,'eligible',row.blockers.join('; '));assert.equal(row.amount,500);assert.equal(row.accountingUsd,500);
  }
});

test('final native allocation preserves the document carrying cent after rounded partial cash',()=> {
  const f=fixture();
  f.original.Amount__c=1; f.original.Document_HKD_Amount__c=7.8;
  f.credit.Amount__c=-1; f.credit.Document_HKD_Amount__c=-7.8;
  for(const line of f.documentLines) {const sign=line.Id==='original-line'?1:-1; line.Native_Amount__c=sign*7.8;line.Accounting_USD__c=sign;line.Native_Unit_Price__c=sign*0.78;}
  f.xeroInvoice.Total=7.8;f.xeroInvoice.AmountDue=7.68;f.xeroCredit.Total=7.8;f.xeroCredit.RemainingCredit=7.8;
  f.payments[0].Payment_HKD_Amount__c=.12;f.payments[0].Amount__c=.02;f.payments[0].Invoice_Carrying_USD__c=.02;
  f.paymentMappings[0].source_fingerprint=paymentSourceFingerprint(f.payments[0]);f.xeroPayments[0].Amount=.12; f.xeroPayments[0].BankAmount=.12; f.paymentMappings[0].xero_bank_amount=.12;
  const row=reviewCreditAllocation(f);assert.equal(row.status,'eligible',row.blockers.join('; '));assert.equal(row.accountingUsd,.98);
  // Three independent rounded partial payments produce a residual unlike re-converting the remaining native amount.
  f.payments=Array.from({length:3},(_,i)=>({...f.payments[0],Id:`p${i}`}));
  f.paymentMappings=f.payments.map((p,i)=>({...f.paymentMappings[0],salesforce_payment_id:p.Id,xero_payment_id:`xp${i}`,source_fingerprint:paymentSourceFingerprint(p)}));
  f.xeroPayments=f.payments.map((_,i)=>({...f.xeroPayments[0],PaymentID:`xp${i}`}));
  f.xeroInvoice.AmountDue=7.44;
  const residual=reviewCreditAllocation(f);assert.equal(residual.status,'eligible');assert.equal(residual.accountingUsd,.94);assert.equal(Math.round(7.44/7.8*100)/100,.95);
  f.xeroInvoice.AmountDue=7.32;f.xeroCredit.RemainingCredit=7.68;f.xeroCredit.Allocations=[{AllocationID:ids.allocation,Amount:.12,Invoice:{InvoiceID:'xi'}}];
  assert.equal(reviewCreditAllocation(f).status,'blocked');
  f.allocationLedger=[{status:'applied',xero_allocation_id:ids.allocation,credit_mapping_id:'cm',invoice_mapping_id:'im',currency:'HKD',native_amount:.12,accounting_usd:.02,request_evidence:{xeroCreditId:'xc',xeroInvoiceId:'xi',accountingUsd:.02,evidence:{original:f.original}}}];
  assert.equal(reviewCreditAllocation(f).accountingUsd,.92);
});

test('full-credit review rejects unresolved operations and changed native Xero bank or rate evidence', () => {
  for (const change of [
    (input) => { input.allocationLedger = [{ status: 'unknown' }]; },
    (input) => { input.xeroPayments[0].CurrencyRate = 7.81; },
    (input) => { input.xeroPayments[0].BankAmount = 3899.99; },
    (input) => { input.paymentMappings[0].document_mapping_id = 'other'; },
    (input) => { delete input.xeroCredit.Allocations; },
  ]) {
    const input = fixture();
    change(input);
    assert.equal(reviewCreditAllocation(input).status, 'blocked');
  }
});

test('allocation readback holds changed contacts, ambiguous aliases and malformed dates', () => {
  const request = reviewCreditAllocation(fixture());
  const valid = completed(request);
  const row = valid.credit.Allocations[0];
  row.AllocationId = row.AllocationID;
  delete row.AllocationID;
  assert.equal(reconcileCreditAllocation({ request_evidence: request }, valid.credit, valid.invoice).allocationId, ids.allocation);
  for (const change of [
    ({ invoice }) => { invoice.Contact.ContactID = 'other'; },
    ({ credit }) => { credit.Allocations[0].AllocationID = ids.operation; },
    ({ credit }) => { credit.Allocations[0].Date = '2026-02-30'; },
  ]) {
    const after = structuredClone(valid);
    change(after);
    assert.throws(() => reconcileCreditAllocation({ request_evidence: request }, after.credit, after.invoice));
  }
});

test('matching inverse lines still need to reproduce their issued native and carrying amounts', () => {
  for (const [field, original, credit] of [
    ['Native_Unit_Price__c', 779.99, -779.99],
    ['Accounting_USD__c', 999.999999, -999.999999],
    ['Document_HKD_Amount__c', 7800.01, -7800.01],
    ['Amount__c', 1000.01, -1000.01],
  ]) {
    const input = fixture();
    const headers = field.startsWith('Document_') || field === 'Amount__c';
    const [originalRow, creditRow] = headers ? [input.original, input.credit] : input.documentLines;
    originalRow[field] = original;
    creditRow[field] = credit;
    const review = reviewCreditAllocation(input);
    assert.equal(review.status, 'blocked', field);
    assert.match(review.blockers[0], /does not reproduce|do not reproduce/);
  }
});

test('HKD headers round exact source pricing before converting to USD', () => {
  for (const [unitPrice, native, usdLine, hkdTotal, usdTotal] of [
    [2.0049996, 2.005, 1.0025, 2, 1],
    [2.005, 2.005, 1.0025, 2.01, 1.01],
  ]) {
    const input = fixture();
    Object.assign(input.original, { Amount__c: usdTotal, Document_HKD_Amount__c: hkdTotal, Document_FX_Rate__c: 2 });
    Object.assign(input.credit, { Amount__c: -usdTotal, Document_HKD_Amount__c: -hkdTotal, Document_FX_Rate__c: 2 });
    input.documentLines.forEach((line, index) => {
      const sign = index === 0 ? 1 : -1;
      Object.assign(line, { Quantity__c: 1, Native_Unit_Price__c: sign * unitPrice, Native_Amount__c: sign * native,
        Accounting_USD__c: sign * usdLine, FX_Rate__c: 2 });
    });
    Object.assign(input.xeroCredit, { Total: hkdTotal, RemainingCredit: hkdTotal, CurrencyRate: 2 });
    Object.assign(input.xeroInvoice, { Total: hkdTotal, AmountDue: hkdTotal, CurrencyRate: 2 });
    Object.assign(input, { payments: [], paymentMappings: [], xeroPayments: [] });
    const review = reviewCreditAllocation(input);
    assert.equal(review.status, 'eligible', review.blockers.join(', '));
    assert.equal(review.amount, hkdTotal);
    assert.equal(review.accountingUsd, usdTotal);
  }
});

test('HKD minimum and lump-sum use the saved pricing basis', () => {
  for (const [mode, field] of [['Minimum', 'Native_Minimum__c'], ['Lumpsum', 'Native_Lumpsum__c']]) {
    const input = fixture();
    input.documentLines.forEach((line, index) => {
      const sign = index === 0 ? 1 : -1;
      Object.assign(line, { Pricing_Mode__c: mode, Native_Unit_Price__c: sign * 700, [field]: sign * 7800 });
    });
    const review = reviewCreditAllocation(input);
    assert.equal(review.status, 'eligible', review.blockers.join(', '));
  }
});

function settlementFixture() {
  const input = fixture();
  const paymentId = '10000000-0000-4000-8000-000000000012';
  const actorId = '10000000-0000-4000-8000-000000000013';
  input.paymentMappings[0].xero_payment_id = paymentId;
  input.xeroPayments[0].PaymentID = paymentId;
  input.xeroCredit.Payments = [];
  Object.assign(input.xeroInvoice, { Payments: [{ PaymentID: paymentId }], Prepayments: [], Overpayments: [] });
  const history = [];
  const calls = [];
  const organisation = { OrganisationID: ids.tenant, BaseCurrency: 'USD' };
  const options = {
    safetyContext: { fields: { Payment__c: ['Cash_Event__c', 'Buyer_Invoice__c', 'Payment_Currency__c', 'Invoice_Carrying_USD__c'] } },
    loadDocuments: async () => ({ ...input, tenantId: ids.tenant, readXero: async (path) => {
      calls.push(path);
      if (path === '/Organisations') return { Organisations: [organisation] };
      assert.equal(path, `/Payments/${paymentId}`);
      return { Payments: input.xeroPayments };
    } }),
    loadPayments: async (_cutoff, _safety, _query, { stemId }) => {
      assert.equal(stemId, input.original.STEM__c);
      return input.payments;
    },
    readScopedRows: async (_client, selection) => {
      if (selection.table === 'xero_financial_credit_allocations') {
        assert.deepEqual(selection.ids, [input.invoiceMapping.id]);
        assert.equal(selection.tenantId, ids.tenant);
        return history;
      }
      assert.equal(selection.table, 'xero_financial_payment_mappings');
      assert.deepEqual(selection.ids, input.payments.map(row => row.Id));
      return input.paymentMappings;
    },
  };
  return { input, history, calls, actorId, organisation, load: execution => loadCreditAllocationReview('Invoice__c', 'credit', options, execution) };
}

test('loads exact settlement evidence and excludes only the original reviewer’s exact unsent claim', async () => {
  const f = settlementFixture();
  const first = await f.load();
  assert.equal(first.status, 'eligible', first.blockers.join(', '));
  assert.equal(f.calls.length, 2);
  const claim = { operation_id: ids.operation, status: 'processing', reviewed_by: f.actorId,
    credit_mapping_id: f.input.creditMapping.id, invoice_mapping_id: f.input.invoiceMapping.id,
    request_evidence: { reviewFingerprint: first.reviewFingerprint } };
  f.history.push(claim);
  await assert.rejects(f.load(), /existing credit allocation/);
  assert.equal(f.calls.length, 2);
  const execution = { ignoreOperationId: ids.operation, actorId: f.actorId, reviewFingerprint: first.reviewFingerprint };
  const second = await f.load(execution);
  assert.deepEqual(second, first);
  await assert.rejects(f.load({ ...execution, actorId: 'other-actor' }), /existing credit allocation/);
  claim.send_started_at = '2026-09-02T00:00:00Z';
  await assert.rejects(f.load(execution), /existing credit allocation/);
  assert.equal(f.calls.length, 4);
});

test('does not infer missing Xero payment history or accept unmatched settlement', async () => {
  for (const mutate of [
    f => { delete f.input.xeroInvoice.Payments; },
    f => { f.input.xeroInvoice.Prepayments.push({}); },
    f => { f.input.xeroInvoice.Overpayments.push({}); },
    f => { f.input.xeroCredit.Payments = f.input.xeroInvoice.Payments; },
  ]) {
    const f = settlementFixture();
    mutate(f);
    await assert.rejects(f.load(), /history|unmatched prepayment/);
    assert.deepEqual(f.calls, []);
  }
  const f = settlementFixture();
  f.input.xeroPayments[0].Invoice.InvoiceID = 'another-invoice';
  await assert.rejects(f.load(), /different document/);
});

test('credit review stops at an organisation lock date before write admission', async () => {
  const f = settlementFixture();
  f.organisation.PeriodLockDate = '2026-09-10';
  await assert.rejects(f.load(), /allocation date is locked/);
  assert.equal(f.calls.at(-1), '/Organisations');
});
