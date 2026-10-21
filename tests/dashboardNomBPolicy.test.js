import test from 'node:test';
import assert from 'node:assert/strict';
import { activeNomBConfirmation, evaluateNomB, isNomBFile, nomBDelivery, nomBReceivable, resolveNomBTrader, validateNomBPolicy } from '../api/_dashboardNomBPolicy.js';

const stem = { Id: 'a0H000000000001AAA', Name: 'HK2627389T - VOYAGER - HONG KONG', Delivery_Date__c: '2026-09-01', Expected_Delivery_Date__c: '2026-08-31', Receivable_Balance__c: '99.99' };
const buyer = { Id: 'a03000000000001AAA', Name: 'Confirmation', STEM__c: stem.Id, RecordType: { DeveloperName: 'Buyer' }, Deprecated__c: false, Replaced__c: false, Buyer_Supplier_Trader__c: 'Anne Chan', BT_ST_Email_Address__c: 'anne@example.test' };
const profile = { id: '00000000-0000-4000-8000-000000000001', active: true, full_name: 'Anne Chan', email: 'anne@example.test' };
const invoice = { Id: 'a0K000000000001AAA', STEM__c: stem.Id, Name: '27389T-INV-1', Amount__c: '100', File__c: '/069000000000001AAA', Deprecated__c: false, Proforma__c: false };
const currency = { singleCurrency: true, corporateCurrency: 'USD' };
const date = '2026-09-29';
const file = { LinkedEntityId: buyer.Id, ContentDocument: { Id: '069000000000002AAA', Title: `${stem.Name} - NOM B.pdf`, IsDeleted: false, LatestPublishedVersionId: '068000000000002AAA', ContentSize: 1234 } };
const sharedSender = 'bunker@cosulich.com.hk';
const longProfile = { id: '00000000-0000-4000-8000-000000000010', active: true, full_name: 'Vu Huu Long', email: 'long@cosulich.com.hk' };
const hypotheticalThuyProfile = { id: '00000000-0000-4000-8000-000000000011', active: true, full_name: 'Pham Kim Thuy', email: 'thuy@cosulich.com.hk' };
function evaluate(overrides = {}) { return evaluateNomB({ stem, confirmations: [buyer], links: [], profiles: [profile], salesforceUsers: [], invoices: [invoice], currencyEvidence: currency, rates: [], asOfDate: date, ...overrides }); }

test('Nom B delivery scope uses actual date before expected, inclusive September boundary and distinct undated scope', () => {
  assert.equal(nomBDelivery(stem).inScope, true);
  assert.equal(nomBDelivery({ ...stem, Delivery_Date__c: '2026-08-31', Expected_Delivery_Date__c: '2026-09-02' }).inScope, false);
  assert.deepEqual(nomBDelivery({ Delivery_Date__c: null, Expected_Delivery_Date__c: '2026-09-01' }), { date: '2026-09-01', source: 'expected', inScope: true, undated: false, invalid: false });
  assert.equal(nomBDelivery({}).undated, true);
  assert.equal(nomBDelivery({ Delivery_Date__c: '2026-02-30' }).invalid, true);
  assert.equal(evaluate({ stem: { ...stem, Invoice_Status__c: 'Cancelled' } }).inScope, false);
  assert.equal(evaluate({ stem: { ...stem, Invoice_Status__c: 'Completed' } }).inScope, true);
});
test('only current Buyer Confirmations qualify', () => {
  assert.equal(activeNomBConfirmation(buyer), true);
  for (const override of [{ Deprecated__c: true }, { Deprecated__c: undefined }, { IsDeleted: true }, { RecordType: { DeveloperName: 'Supplier' } }]) assert.equal(activeNomBConfirmation({ ...buyer, ...override }), false);
});
test('trader assignment requires unique verified email and compatible trader identity', () => {
  assert.equal(resolveNomBTrader(buyer, [profile]).id, profile.id);
  assert.equal(resolveNomBTrader({ ...buyer, BT_ST_Email_Address__c: null }, [profile]).resolved, false);
  assert.equal(resolveNomBTrader({ ...buyer, Buyer_Supplier_Trader__c: 'Unknown Trader' }, [profile]).resolved, false);
  assert.equal(resolveNomBTrader(buyer, [profile, { ...profile, id: 'other' }]).resolved, false);
  assert.equal(resolveNomBTrader(buyer, [{ ...profile, active: false }]).resolved, false);
  assert.equal(resolveNomBTrader(buyer, [profile], [{ Name: buyer.Buyer_Supplier_Trader__c, Email: 'different@example.test', IsActive: true }]).resolved, false);
  assert.equal(resolveNomBTrader({ ...buyer, BT_ST_Email_Address__c: null }, [profile], [{ Name: buyer.Buyer_Supplier_Trader__c, Email: profile.email, IsActive: true }]).id, profile.id);
});
for (const traderName of ['Vu Huu Long', 'Pham Kim Thuy']) {
  test(`${traderName} resolves to Long's FCOS login while preserving the Salesforce trader name`, () => {
    const confirmation = { ...buyer, Buyer_Supplier_Trader__c: traderName, BT_ST_Email_Address__c: sharedSender };
    const sharedMailboxProfile = { ...longProfile, id: '00000000-0000-4000-8000-000000000012', email: sharedSender };
    for (const profiles of [[longProfile], [longProfile, hypotheticalThuyProfile, sharedMailboxProfile]]) {
      for (const users of [[], [{ Name: traderName, Email: sharedSender, IsActive: true }],
        [{ Name: traderName, Email: hypotheticalThuyProfile.email, IsActive: true }]]) {
        const resolved = resolveNomBTrader(confirmation, profiles, users);
        assert.deepEqual(resolved, { id: longProfile.id, name: traderName, email: longProfile.email, resolved: true });
      }
    }
    const normalized = { ...confirmation, Buyer_Supplier_Trader__c: `  ${traderName.toUpperCase().replaceAll(' ', '   ')}  ` };
    assert.equal(resolveNomBTrader(normalized, [longProfile]).id, longProfile.id);
    assert.deepEqual(resolveNomBTrader(confirmation, [{ ...longProfile, full_name: 'Long' }]),
      { id: longProfile.id, name: traderName, email: longProfile.email, resolved: true });
    const result = evaluate({ confirmations: [confirmation], profiles: [longProfile], invoices: [] });
    assert.equal(result.status, 'missing');
    assert.equal(result.confirmations[0].trader.id, longProfile.id);
    assert.equal(result.confirmations[0].traderName, traderName);
  });
  test(`${traderName} requires exactly one active Long login and cannot fall back to a Thuy or shared-mailbox profile`, () => {
    const confirmation = { ...buyer, Buyer_Supplier_Trader__c: traderName, BT_ST_Email_Address__c: sharedSender };
    const invalidDirectories = [
      [],
      [hypotheticalThuyProfile],
      [longProfile, { ...longProfile, id: '00000000-0000-4000-8000-000000000012', full_name: 'Duplicate login' }],
      [{ ...longProfile, active: false }, hypotheticalThuyProfile],
      [{ ...longProfile, email: 'another@example.test' }],
      [{ ...longProfile, email: sharedSender }],
    ];
    for (const profiles of invalidDirectories) {
      const resolved = resolveNomBTrader(confirmation, profiles);
      assert.equal(resolved.resolved, false);
      assert.equal(resolved.id, null);
      assert.equal(evaluate({ confirmations: [confirmation], profiles, invoices: [] }).status, 'unable_to_verify');
    }
  });
}
test('an unknown trader cannot claim the shared Salesforce sender through a mailbox profile', () => {
  const confirmation = { ...buyer, Buyer_Supplier_Trader__c: 'Unknown Trader', BT_ST_Email_Address__c: sharedSender };
  const claimant = { ...profile, full_name: 'Unknown Trader', email: sharedSender };
  for (const users of [[], [{ Name: 'Unknown Trader', Email: sharedSender, IsActive: true }]]) {
    const resolved = resolveNomBTrader(confirmation, [longProfile, claimant], users);
    assert.equal(resolved.resolved, false);
    assert.equal(resolved.id, null);
  }
  const individual = { ...claimant, id: '00000000-0000-4000-8000-000000000013', email: 'unknown@example.test' };
  assert.equal(resolveNomBTrader(confirmation, [longProfile, claimant, individual],
    [{ Name: individual.full_name, Email: individual.email, IsActive: true }]).id, individual.id);
});
test('NOM B filing needs actual linked nondeleted published nonempty file with exact STEM filing name', () => {
  assert.equal(isNomBFile(file, buyer, stem), true);
  assert.equal(isNomBFile(file, buyer, { ...stem, RefCode__c: 'HK2627389T', Name: 'HK2627389T - RENAMED VESSEL - NEW PORT' }), true);
  for (const override of [{ IsDeleted: true }, { IsDeleted: undefined }, { LatestPublishedVersionId: null }, { ContentSize: 0 }, { Title: `${stem.Name} - CON.pdf` }, { Title: `Notes about NOM B.pdf` }, { Title: 'OTHER STEM - NOM B.pdf' }]) assert.equal(isNomBFile({ ...file, ContentDocument: { ...file.ContentDocument, ...override } }, buyer, stem), false);
  assert.equal(isNomBFile({ ...file, LinkedEntityId: 'other' }, buyer, stem), false);
  assert.equal(isNomBFile(file, { ...buyer, File__c: `https://example.test/${file.ContentDocument.Id}` }, stem), false);
  assert.equal(evaluate({ confirmations: [{ ...buyer, Received__c: true, PDF__c: 'Generated' }] }).confirmations[0].status, 'missing');
});
for (const [balance, eligible, usd] of [['99.99', true, '99.99'], ['100.00', false, '100.00'], ['99.994', true, '99.99'], ['99.995', false, '100.00'], ['0', true, '0.00'], ['-40.01', true, '-40.01']]) {
  test(`receivable ${balance} compares rounded decimal cents`, () => {
    const value = nomBReceivable({ ...stem, Receivable_Balance__c: balance }, [invoice], currency, [], date);
    assert.equal(value.eligible, eligible); assert.equal(value.usdEquivalent, usd);
  });
}
test('missing/invalid balance and currency never become zero', () => {
  for (const value of [null, undefined, '', 'NaN', true, 'Infinity']) assert.equal(nomBReceivable({ ...stem, Receivable_Balance__c: value }, [invoice], currency, [], date).evidenceStatus, 'unavailable');
  assert.equal(nomBReceivable(stem, [invoice], null, [], date).evidenceStatus, 'unavailable');
  assert.equal(nomBReceivable({ ...stem, CurrencyIsoCode: '' }, [invoice], currency, [], date).evidenceStatus, 'unavailable');
});
test('waiver requires issued nonproforma active final invoice; known absent invoice leaves filing required', () => {
  for (const item of [{ ...invoice, File__c: null }, { ...invoice, Proforma__c: true }, { ...invoice, Deprecated__c: true }, { ...invoice, IsDeleted: true }, { ...invoice, Name: '27389T-CN-1' }, { ...invoice, STEM__c: 'other' }]) assert.equal(nomBReceivable(stem, [item], currency, [], date).eligible, false);
  assert.equal(evaluate({ invoices: [] }).status, 'missing');
  assert.equal(evaluate({ invoicesComplete: false }).status, 'unable_to_verify');
});
test('credit notes cannot substitute for final buyer invoices, while issued zero finals remain valid', () => {
  for (const override of [{ Name: '26361-CREDIT NOTE', Amount__c: '-100' }, { Name: '26361-CREDIT NOTE', Amount__c: '100' },
    { Name: '26361-CREDIT_NOTE' }, { Name: '26361-CN-1' }, { Name: 'CN12345' }, { Amount__c: '-0.01' },
    { Is_Credit_Note__c: true }, { Credit_Note__c: true }, { CreditNote__c: true }]) {
    const credit = { ...invoice, ...override };
    assert.equal(nomBReceivable(stem, [credit], currency, [], date).eligible, false);
    assert.equal(nomBReceivable(stem, [credit, { ...invoice, Id: 'a0K000000000002AAA' }], currency, [], date).eligible, true);
  }
  assert.equal(nomBReceivable(stem, [{ ...invoice, Amount__c: '0' }], currency, [], date).eligible, true);
  for (const invalid of [null, undefined, '', 'NaN', true, 'Infinity']) {
    const result = nomBReceivable(stem, [{ ...invoice, Amount__c: invalid }], currency, [], date);
    assert.equal(result.eligible, false); assert.equal(result.evidenceStatus, 'unavailable');
  }
  for (const flag of [null, undefined, 'false', 0]) assert.equal(nomBReceivable(stem, [{ ...invoice, Is_Credit_Note__c: flag }], currency, [], date).evidenceStatus, 'unavailable');
  assert.equal(nomBReceivable(stem, [{ ...invoice, _nomBCreditFields: ['Credit_Note__c'] }], currency, [], date).evidenceStatus, 'unavailable');
  assert.equal(nomBReceivable(stem, [{ ...invoice, Credit_Note__c: false }], currency, [], date).eligible, true);
});
test('FX converts through corporate currency with exact ratio and effective rate evidence', () => {
  const rates = [{ IsoCode: 'EUR', ConversionRate: '0.8', StartDate: '2026-09-01' }, { IsoCode: 'USD', ConversionRate: '1.25', StartDate: '2026-09-05' }];
  const result = nomBReceivable({ ...stem, CurrencyIsoCode: 'EUR', Receivable_Balance__c: '63.9968' }, [invoice], { corporateCurrency: 'GBP', singleCurrency: false }, rates, date);
  assert.equal(result.usdEquivalent, '100.00'); assert.equal(result.eligible, false); assert.equal(result.rateDate, '2026-09-05');
  const fromCorp = nomBReceivable({ ...stem, CurrencyIsoCode: 'GBP', Receivable_Balance__c: '79.99' }, [invoice], { corporateCurrency: 'GBP' }, rates, date);
  assert.equal(fromCorp.usdEquivalent, '99.99'); assert.equal(fromCorp.rateDate, '2026-09-05');
  for (const invalid of [[], [...rates, rates[0]], [{ ...rates[0], ConversionRate: '0' }, rates[1]], [{ ...rates[0], StartDate: '2026-10-01' }, rates[1]], [{ ...rates[0], NextStartDate: '2026-09-20' }, rates[1]]]) assert.equal(nomBReceivable({ ...stem, CurrencyIsoCode: 'EUR' }, [invoice], { corporateCurrency: 'GBP' }, invalid, date).evidenceStatus, 'unavailable');
});
test('manual policy precedence, filed completion, multiple confirmations and balance reversal', () => {
  assert.equal(evaluate().waiverType, 'automatic');
  assert.equal(evaluate({ stem: { ...stem, Receivable_Balance__c: '100' } }).status, 'missing');
  assert.equal(evaluate({ policy: { mode: 'require', reason_text: 'Needed by compliance' } }).status, 'missing');
  assert.equal(evaluate({ policy: { mode: 'waive', reason_code: 'payment_received' }, documentsComplete: false }).waiverType, 'manual');
  assert.equal(evaluate({ links: [file], policy: { mode: 'waive', reason_code: 'payment_received' } }).status, 'filed');
  const other = { ...buyer, Id: 'a03000000000002AAA' };
  const result = evaluate({ confirmations: [buyer, other], links: [file], policy: { mode: 'require', reason_text: 'Required' } });
  assert.deepEqual(result.confirmations.map((row) => row.status), ['filed', 'missing']); assert.equal(result.status, 'missing');
  assert.equal(evaluate({ documentsComplete: false }).status, 'unable_to_verify');
  assert.equal(evaluate({ confirmations: [] }).status, 'unable_to_verify');
});
test('management input defaults Payment Received and validates free text and revisions', () => {
  const base = { stemId: stem.Id, expectedRevision: 0 };
  assert.equal(validateNomBPolicy({ ...base, mode: 'waive' }).reasonCode, 'payment_received');
  assert.equal(validateNomBPolicy({ ...base, mode: 'automatic', reasonText: 'old' }).reasonText, '');
  for (const bad of [{ mode: 'require' }, { mode: 'waive', reasonCode: 'other', reasonText: ' ' }, { mode: 'waive', reasonText: 'a'.repeat(1001) }, { mode: 'waive', expectedRevision: -1 }, { mode: 'other' }]) assert.throws(() => validateNomBPolicy({ ...base, ...bad }));
});

test('regenerating an outgoing Buyer Confirmation preserves trader and Nom B requirement', () => {
  const regenerated = { ...buyer, Replaced__c: true };
  assert.equal(activeNomBConfirmation(regenerated), true);
  const result = evaluate({ confirmations: [regenerated], invoices: [] });
  assert.equal(result.status, 'missing');
  assert.equal(result.confirmations[0].trader.id, profile.id);
  assert.equal(evaluate({ confirmations: [regenerated], links: [file] }).status, 'filed');
  assert.equal(activeNomBConfirmation({ ...regenerated, Deprecated__c: true }), false);
});
