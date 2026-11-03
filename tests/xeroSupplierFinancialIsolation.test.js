import assert from 'node:assert/strict';
import test from 'node:test';
import { registeredHandlerBehavior } from '../api/_handlerPolicyRegistry.js';
import { classifyXeroFinancialDocument } from '../api/_xeroFinancialSync.js';

const source = { salesforceObject: 'Supplier_Invoice__c', salesforceId: 'a06000000000001AAA', documentNumber: 'SOURCE-1',
  xeroType: 'ACCPAY', contactId: 'contact-1', currency: 'USD', total: 1000, invoiceDate: '2026-01-02',
  dueDate: '2026-02-02', blockers: [], lines: [{ quantity: 1, unitAmount: 1000, accountCode: '51100', taxType: 'NONE' }] };
const target = { id: 'target-1', type: 'ACCPAY', status: 'AUTHORISED', invoiceNumber: 'OLD-ERP-1', contactId: 'contact-1',
  currency: 'USD', total: 1000, lineItems: [{ Quantity: 1, UnitAmount: 1000, AccountCode: '51100', TaxType: 'NONE' }] };

test('accepted financial receipts never re-enter ordinary accounting mutation after source changes', () => {
  for (const receipt of [null, {}, { policyVersion: 'supplier_financial_bucket_preserve_v1', originalReview: { privateEvidence: 'secret-original' } }]) {
    for (const linkFirst of [false, true]) {
      const result = classifyXeroFinancialDocument({ ...source, total: 900 }, [target], {
        linkFirst, storedMapping: { xero_document_id: target.id, retained_differences: { financialBucketPreservation: receipt } },
      });
      assert.equal(result.action, 'blocked');
      assert.equal(result.proposedPayload, null);
      assert.equal(result.reviewRequired, false);
      assert.equal(result.supplierFinancialPreservation.accepted, true);
      assert.equal(result.supplierFinancialPreservation.documentVerification, 'UNVERIFIED');
      assert.ok(!JSON.stringify(result).includes('secret-original'));
    }
  }
});

test('a missing accepted target retains its identity and never proposes a duplicate draft', () => {
  const result = classifyXeroFinancialDocument(source, [], { storedMapping: {
    xero_document_id: target.id, retained_differences: { financialBucketPreservation: {} },
  } });
  assert.equal(result.action, 'blocked');
  assert.equal(result.proposedPayload, null);
  assert.equal(result.xero, null);
  assert.equal(result.supplierFinancialPreservation.savedTargetId, target.id);
});

test('ordinary sources without a financial receipt retain existing missing-readiness controls', () => {
  const result = classifyXeroFinancialDocument(source, []);
  assert.equal(result.action, 'create_draft');
  assert.equal(result.status, 'blocked');
  assert.ok(result.blockers.length > 0);
});


test('financial-only preview, read and apply retain explicit uncached Finance permissions', () => {
  for (const name of ['xeroSupplierFinancialBucketPreview', 'xeroSupplierFinancialBucketRead', 'xeroSupplierFinancialBucketApply']) {
    const policy = registeredHandlerBehavior(name);
    assert.equal(policy.capability, 'xero_portal_manage');
    assert.equal(policy.cache, 'none');
    assert.equal(policy.mutation, !name.endsWith('Read'));
    assert.equal(policy.externalAction, !name.endsWith('Read'));
  }
});
