import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isExplicitZero,
  zeroBalanceNotRequiredEligibility,
} from '../src/lib/disputeWorkflowDefaults.js';
import {
  disputeNotRequiredEligibility,
  verifiedDisputeSupplierPayableBalance,
} from '../api/_disputeAccounting.js';

const apiSource = readFileSync(new URL('../api/functions/[name].js', import.meta.url), 'utf8');
const supplierAccountingMigrationSource = readFileSync(
  new URL('../supabase/migrations/20260724121500_harden_supplier_dispute_accounting.sql', import.meta.url),
  'utf8',
);

test('uses the two-decimal zero threshold and excludes its exact boundary', () => {
  for (const balance of [0, 0.0049, -0.0049, '0.00']) {
    assert.equal(isExplicitZero(balance), true, `expected ${balance} to qualify as zero`);
  }
  for (const balance of [0.005, -0.005, 0.01, -0.01, null, '', Number.NaN]) {
    assert.equal(isExplicitZero(balance), false, `expected ${balance} not to qualify as zero`);
  }
});

test('limits the waiver to buyer and supplier no-recovery closure actions', () => {
  const balances = {
    buyerReceivableBalance: 0,
    supplierPayableBalance: 0,
  };
  assert.equal(zeroBalanceNotRequiredEligibility({
    ...balances,
    actionType: 'close_buyer_dispute',
  }).eligible, true);
  assert.equal(zeroBalanceNotRequiredEligibility({
    ...balances,
    actionType: 'close_supplier_dispute',
  }).eligible, true);
  for (const actionType of [
    'issue_buyer_credit_note',
    'resolve_supplier_dispute',
    'hold_supplier_payment',
    'deduct_specific_amount',
  ]) {
    assert.equal(zeroBalanceNotRequiredEligibility({ ...balances, actionType }).eligible, false);
  }
});

test('uses only the relevant dispute-leg balance', () => {
  assert.equal(zeroBalanceNotRequiredEligibility({
    actionType: 'close_buyer_dispute',
    buyerReceivableBalance: 0,
    supplierPayableBalance: 120,
  }).eligible, true);
  assert.equal(zeroBalanceNotRequiredEligibility({
    actionType: 'close_buyer_dispute',
    buyerReceivableBalance: 120,
    supplierPayableBalance: 0,
  }).eligible, false);
  assert.equal(zeroBalanceNotRequiredEligibility({
    actionType: 'close_supplier_dispute',
    buyerReceivableBalance: 0,
    supplierPayableBalance: 120,
  }).eligible, false);
});

test('aggregates payable balances by exact Salesforce Account ID', () => {
  const firstSupplierId = '001000000000001AAA';
  const secondSupplierId = '001000000000002AAA';
  const currentStem = {
    _Supplier_Invoice_Exposure_Rows: [
      {
        supplierAccountId: firstSupplierId,
        supplierName: 'Harbour Supply',
        payableBalance: 0,
        rawPayableBalance: 0,
        payableBalanceAvailable: true,
      },
      {
        supplierAccountId: firstSupplierId,
        supplierName: 'Harbour Supply',
        payableBalance: '0.00',
        rawPayableBalance: '0.00',
        payableBalanceAvailable: true,
      },
      {
        supplierAccountId: secondSupplierId,
        supplierName: 'Harbour Supply',
        payableBalance: 84.5,
        rawPayableBalance: 84.5,
        payableBalanceAvailable: true,
      },
    ],
  };

  assert.equal(verifiedDisputeSupplierPayableBalance(currentStem, firstSupplierId), 0);
  assert.equal(verifiedDisputeSupplierPayableBalance(currentStem, firstSupplierId.slice(0, 15)), 0);
  assert.equal(verifiedDisputeSupplierPayableBalance(currentStem, secondSupplierId), 84.5);
  assert.equal(verifiedDisputeSupplierPayableBalance(currentStem, '001000000000003AAA'), null);
});

test('requires a reason when any matching supplier payable balance is unavailable', () => {
  const supplierId = '001000000000001AAA';
  const currentStem = {
    _Supplier_Invoice_Exposure_Rows: [
      { supplierAccountId: supplierId, payableBalance: 0, rawPayableBalance: 0, payableBalanceAvailable: true },
      { supplierAccountId: supplierId, payableBalance: 0, rawPayableBalance: 0, payableBalanceAvailable: false },
    ],
  };
  assert.equal(verifiedDisputeSupplierPayableBalance(currentStem, supplierId), null);
  assert.equal(disputeNotRequiredEligibility(
    { action_type: 'close_supplier_dispute', party_id: 'supplier-party' },
    [{ id: 'supplier-party', account_id: supplierId }],
    currentStem,
  ).eligible, false);
});

test('does not treat a clamped negative supplier invoice balance as zero', () => {
  const supplierId = '001000000000001AAA';
  const currentStem = {
    _Supplier_Invoice_Exposure_Rows: [{
      supplierAccountId: supplierId,
      payableBalance: 0,
      rawPayableBalance: -25,
      payableBalanceAvailable: true,
    }],
  };
  assert.equal(verifiedDisputeSupplierPayableBalance(currentStem, supplierId), null);
  assert.equal(disputeNotRequiredEligibility(
    { action_type: 'close_supplier_dispute', party_id: 'supplier-party' },
    [{ id: 'supplier-party', account_id: supplierId }],
    currentStem,
  ).eligible, false);
});

test('resolves buyer and supplier eligibility from the saved action party', () => {
  const zeroSupplierId = '001000000000001AAA';
  const positiveSupplierId = '001000000000002AAA';
  const partyRows = [
    { id: 'buyer-party', account_id: '001000000000003AAA' },
    { id: 'zero-supplier-party', account_id: zeroSupplierId },
    { id: 'positive-supplier-party', account_id: positiveSupplierId },
  ];
  const currentStem = {
    Receivable_Balance__c: 0,
    _Supplier_Invoice_Exposure_Rows: [
      { supplierAccountId: zeroSupplierId, payableBalance: 0, rawPayableBalance: 0, payableBalanceAvailable: true },
      { supplierAccountId: positiveSupplierId, payableBalance: 25, rawPayableBalance: 25, payableBalanceAvailable: true },
    ],
  };

  const buyer = disputeNotRequiredEligibility(
    { action_type: 'close_buyer_dispute', party_id: 'buyer-party' },
    partyRows,
    currentStem,
  );
  assert.equal(buyer.eligible, true);
  assert.equal(buyer.balanceType, 'buyer_receivable');

  const zeroSupplier = disputeNotRequiredEligibility(
    { action_type: 'close_supplier_dispute', party_id: 'zero-supplier-party' },
    partyRows,
    currentStem,
  );
  assert.equal(zeroSupplier.eligible, true);
  assert.equal(zeroSupplier.partyAccountId, zeroSupplierId);

  assert.equal(disputeNotRequiredEligibility(
    { action_type: 'close_supplier_dispute', party_id: 'positive-supplier-party' },
    partyRows,
    currentStem,
  ).eligible, false);
  assert.equal(disputeNotRequiredEligibility(
    { action_type: 'resolve_supplier_dispute', party_id: 'zero-supplier-party' },
    partyRows,
    currentStem,
  ).eligible, false);
});

test('server revalidation and supplier-instruction explanation controls remain enforced', () => {
  assert.match(apiSource, /const currentStem = await loadCurrentDisputeStem/);
  assert.match(apiSource, /const notRequiredEligibility = disputeNotRequiredEligibility\(action, partyRows, currentStem\)/);
  assert.match(apiSource, /notRequiredReasonWaived/);
  assert.match(apiSource, /verifiedBalanceType/);
  assert.match(apiSource, /Explain why this supplier instruction is not required/);
  assert.match(
    supplierAccountingMigrationSource,
    /Not Required requires an accounting explanation/,
  );
});
