import assert from 'node:assert/strict';
import test from 'node:test';
import { financialFixture, hash } from './xeroSupplierFinancialBucketPreservation.fixture.js';
import { evaluateSupplierFinancialBucketPreservation, supplierFinancialBucketReview } from '../api/_xeroSupplierFinancialBucketPreservation.js';
import { financialDatabase, seedFinancialWithFixture } from './xeroSupplierFinancialBucketDatabase.fixture.js';

async function verifySyntheticLinks(t, native) {
  const harness = await financialDatabase(t, native);
  const { db } = harness;
  const fixture = paid => {
    const input = financialFixture({ paid });
    const proof = evaluateSupplierFinancialBucketPreservation(input.input);
    assert.equal(proof.proofValid, true);
    const review = supplierFinancialBucketReview(proof, {
      reviewFingerprint: hash('synthetic exact local review'),
      legacyReviewFingerprint: hash('synthetic original local review'),
    });
    assert.ok(review);
    return { proof: structuredClone(proof), review: structuredClone(review) };
  };
  async function transaction(body) {
    await db.exec('reset role; begin');
    harness.setTransaction(true);
    try { await body(); }
    finally {
      harness.setTransaction(false);
      await db.exec('rollback; reset role');
    }
  }
  for (const paid of [false, true]) {
    await t.test(paid ? 'paid supplier bill' : 'authorised supplier bill', () => transaction(async () => {
      const seeded = await seedFinancialWithFixture(db, fixture(paid));
      await db.exec('set role service_role');
      const before = await seeded.snapshot();
      const first = await seeded.link();
      assert.equal(first.alreadyLinked, false);
      assert.equal(first.financialWrites, 0);
      assert.equal(first.documentVerification, 'UNVERIFIED');
      const after = await seeded.snapshot();
      assert.equal(after.mappings.length, 1);
      assert.equal(after.items[0].proposed_payload, null);
      assert.deepEqual(after.payments, before.payments);
      assert.deepEqual(after.items[0].source_payload, before.items[0].source_payload);
      assert.deepEqual(after.items[0].xero_payload, before.items[0].xero_payload);
      assert.equal((await seeded.link()).alreadyLinked, true);
      assert.deepEqual(await seeded.snapshot(), after);
    }));
  }
  await t.test('wrong currency is denied without a local link', () => transaction(async () => {
    const seeded = await seedFinancialWithFixture(db, fixture(false), {
      mutate: evidence => { evidence.accounting.target.CurrencyCode = 'HKD'; },
    });
    await db.exec('set role service_role');
    const before = await seeded.snapshot();
    await assert.rejects(seeded.link());
    assert.deepEqual(await seeded.snapshot(), before);
  }));
}

test('supplier financial bucket links current synthetic evidence without an external write', t => verifySyntheticLinks(t, false));
test('native supplier financial bucket preserves the same local-only contract', {
  skip: process.env.FCOS_FINANCIAL_BUCKET_NATIVE !== '1',
}, t => verifySyntheticLinks(t, true));
