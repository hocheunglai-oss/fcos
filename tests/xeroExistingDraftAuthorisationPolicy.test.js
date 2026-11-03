import test from 'node:test';
import assert from 'node:assert/strict';
import { draftFixture, draftFixtureAvailable } from './xeroExistingDraftAuthorisation.fixture.js';
import { issuedSupplierHash as hash } from '../api/_xeroIssuedSupplierPreservation.js';
import { buildXeroAccountingPayload } from '../api/_xeroFinancialSync.js';
import { buildExistingDraftAuthorisationEvidence as build, evaluateExistingDraftAuthorisationEvidence as evaluate,
  classifyExistingDraftAuthorisationReadback as readback, existingDraftApprovedTargetHash,
  createExistingDraftAuthorisationPolicy } from '../api/_xeroExistingDraftAuthorisationPolicy.js';

const privateTest = (name, fn) => test(name, { skip: !draftFixtureAvailable }, fn);
const proof = f => build(f.input);
const authorised = f => ({ ...structuredClone(f.input.before), Status: 'AUTHORISED', UpdatedDateUTC: '/Date(1790761466999+0000)/', UpdatedDateUTCString: '2026-09-30T09:44:26Z' });

privateTest('exact pinned original produces frozen non-executable status-only proof, preserving historical mapping hashes', () => {
  const f = draftFixture(), original = JSON.stringify(f.input), p = proof(f);
  assert.equal(p.proofValid, true); assert.equal(p.evidence.before.LineAmountTypes, 'NoTax');
  assert.equal(existingDraftApprovedTargetHash(f.input.reviewedTarget), f.input.selection.record.rawTargetSha256);
  assert.deepEqual(p.payload, { Invoices: [{ InvoiceID: f.targetId, Status: 'AUTHORISED' }] });
  assert.equal(p.financialWrites, 0); assert.equal(p.workflowEligible, false); assert.equal(p.approvalGranted, false); assert.equal(p.documentVerification, 'UNVERIFIED');
  assert.notEqual(f.input.current.controls.documentMappings[0].source_fingerprint, f.input.source.sourceFingerprint);
  assert.equal(JSON.stringify(f.input), original); assert.ok(Object.isFrozen(p.evidence.current.organisation));
  assert.throws(() => { p.payload.Invoices[0].Status = 'PAID'; }, TypeError);
});

privateTest('fixed selection and whole approved original cannot be replaced by caller authority', () => {
  const p = proof(draftFixture());
  for (const alter of [e => { e.selection.record.total = '1.00'; }, e => { e.selection.humanApprovalSha256 = '0'.repeat(64); },
    e => { e.reviewedTarget.Contact.Name = 'Different approved party'; }, e => { e.approvalGranted = true; }]) {
    const e = structuredClone(p.evidence); alter(e); assert.equal(evaluate(e).proofValid, false);
  }
  let calls = 0; assert.throws(() => createExistingDraftAuthorisationPolicy({ getCurrent: () => { calls++; }, selectionFileText: '{}', approvalFileText: '{}' })); assert.equal(calls, 0);
});

privateTest('ordinary current source blockers, signed buckets and existing builder fingerprint remain mandatory', () => {
  for (const alter of [f => f.input.source.blockers.push('Unresolved source amount'), f => { f.input.source.total = null; },
    f => { f.input.source.lines[0].unitAmount += 0.01; f.input.source.financialFingerprint = hash(buildXeroAccountingPayload(f.input.source)); },
    f => { f.input.source.financialFingerprint = '1'.repeat(64); }, f => { f.input.source.lines[0].accountCode = '41100'; }]) {
    const f = draftFixture(); alter(f); assert.equal(proof(f).proofValid, false);
  }
});

privateTest('fresh detail may expand approved Contact but its full unknown fields are thereafter protected', () => {
  const f = draftFixture(); f.input.before.Contact.DetailOnly = { City: 'Singapore' };
  f.input.before.UnrecognisedProviderField = { retained: ['original', 2] };
  assert.equal(proof(f).proofValid, true);
  const good = authorised(f); assert.equal(readback({ evidence: proof(f).evidence, observed: good }).status, 'confirmed');
  good.Contact.DetailOnly.City = 'Changed'; assert.equal(readback({ evidence: proof(f).evidence, observed: good }).status, 'uncertain');
  const different = draftFixture(); different.input.before.Contact.Name = 'Different'; assert.equal(proof(different).proofValid, false);
});

privateTest('settlement, currency, organisation locks, exact mapping and capsule hashes hold contradictions', () => {
  for (const alter of [f => { f.input.before.Payments = [{ PaymentID: f.targetId }]; }, f => { f.input.before.AmountPaid = 1; },
    f => { f.input.before.LineItems[0].TaxAmount = null; }, f => { f.input.before.CurrencyRate = 1.01; },
    f => { f.input.before.AmountRefunded = 0; }, f => { f.input.current.organisation.PeriodLockDate = f.input.before.Date; },
    f => { f.input.current.controls.documentMappings.push(structuredClone(f.input.current.controls.documentMappings[0])); f.reseal(); },
    f => { f.input.current.identity.sourceId = 'foreign'; }, f => { f.input.current.observedAt = '2026-02-30T00:00:00.000Z'; }]) {
    const f = draftFixture(); alter(f); assert.equal(proof(f).proofValid, false);
  }
});

privateTest('status readback allows only AUTHORISED and valid monotonic top update aliases', () => {
  const f = draftFixture(), evidence = proof(f).evidence;
  assert.equal(readback({ evidence, observed: authorised(f) }).status, 'confirmed');
  assert.equal(readback({ evidence, observed: f.input.before }).status, 'unchanged');
  for (const alter of [v => { v.Status = 'PAID'; }, v => { v.UpdatedDateUTCString = '2026-09-30T09:44:27Z'; },
    v => { delete v.UpdatedDateUTC; delete v.UpdatedDateUTCString; }, v => { v.UpdatedDateUTC = '/Date(1)/'; v.UpdatedDateUTCString = '1970-01-01T00:00:00Z'; },
    v => { v.UpdatedDateUTCString = '2026-02-30T09:44:26Z'; }]) {
    const v = authorised(f); alter(v); const r = readback({ evidence, observed: v }); assert.equal(r.status, 'uncertain'); assert.equal(r.resendAllowed, false);
  }
});

privateTest('readback preserves every other raw field, original line order, tracking and date aliases', () => {
  const f = draftFixture(); const evidence = proof(f).evidence; assert.ok(evidence);
  for (const alter of [v => { v.LineItems[0].Tracking = [{ Name: 'Job', Option: 'Other' }]; }, v => { v.LineItems.push(structuredClone(v.LineItems[0])); },
    v => { v.DateString = '2026-08-19T00:00:00'; }, v => { v.Contact.ContactID = f.targetId; }, v => { v.SentToContact = false; },
    v => { v.NewUnknownKey = null; }, v => { v.LineItems[0].Description += ' changed'; }]) {
    const v = authorised(f); alter(v); assert.equal(readback({ evidence, observed: v }).status, 'uncertain');
  }
});

privateTest('strict bounded originals reject accessors, hidden properties, sparse arrays, negative zero and cycles', () => {
  let getters = 0;
  for (const alter of [f => Object.defineProperty(f.input.source, 'hidden', { value: true }),
    f => Object.defineProperty(f.input.source, 'getter', { enumerable: true, get() { getters++; return true; } }),
    f => { f.input.current.receipts.provider = Array(1); }, f => { f.input.source.negativeZero = -0; },
    f => { f.input.source.undefined = undefined; }, f => { f.input.source.symbol = Symbol('bad'); },
    f => { f.input.current.identity.self = f.input.current.identity; }, f => { f.input.source.large = 'x'.repeat(1_000_001); }]) {
    const f = draftFixture(); alter(f); assert.equal(proof(f).proofValid, false);
  }
  assert.equal(getters, 0);
});

test('public proof boundary cannot admit arbitrary source or caller approval flags', () => {
  for (const value of [null, {}, { proofValid: true, approvalGranted: true }, { policyVersion: 'authorise_existing_xero_drafts_v1', selection: {} }]) {
    const p = evaluate(value); assert.equal(p.proofValid, false); assert.equal(p.workflowEligible, false); assert.equal(p.financialWrites, 0); assert.equal(p.payload, null);
  }
});

privateTest('current source projection remains bound separately from the pre-projection financial formula', () => {
  const f = draftFixture(), originalFingerprint = f.input.source.financialFingerprint;
  f.input.source.documentFieldProjection = { policy: 'document_field_correction_v1', scope: 'current', blockers: [], blockerCodes: [], evidence: { direction: 'supplier' }, fields: { Date: '2026-08-19', DueDate: '2026-08-20',
    Reference: 'Current source projection', InvoiceNumber: 'Current source number', Description: 'Current formatting' } };
  assert.notEqual(hash(buildXeroAccountingPayload(f.input.source)), originalFingerprint);
  const p = proof(f); assert.equal(p.proofValid, true); assert.deepEqual(p.evidence.source.documentFieldProjection, f.input.source.documentFieldProjection);
  assert.deepEqual(p.payload, { Invoices: [{ InvoiceID: f.targetId, Status: 'AUTHORISED' }] });
});

privateTest('mandatory ACTIVE organisation status preserves valid originals and holds missing or invalid status', () => {
  const f = draftFixture(); assert.equal(f.input.current.organisation.OrganisationStatus, 'ACTIVE');
  const active = proof(f); assert.equal(active.proofValid, true); assert.equal(active.evidence.current.organisation.OrganisationStatus, 'ACTIVE');
  delete f.input.current.organisation.OrganisationStatus;
  assert.equal(proof(f).proofValid, false); assert.ok(proof(f).blockers.includes('DRAFT_ORGANISATION_HELD'));
  for (const status of ['INACTIVE', 'DELETED', 'active', '', null]) {
    f.input.current.organisation.OrganisationStatus = status; const held = proof(f);
    assert.equal(held.proofValid, false); assert.ok(held.blockers.includes('DRAFT_ORGANISATION_HELD')); assert.equal(held.payload, null);
  }
});
