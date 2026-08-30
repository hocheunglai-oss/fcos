import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeCurrencyIsoCode,
  paymentCollectionBalanceIsSettled,
  paymentCollectionThresholdPolicy,
  savePaymentCollectionThresholds,
} from '../api/_paymentCollectionThresholds.js';

test('uses an exact configured threshold for each ISO currency', () => {
  const state = {
    byCurrency: {
      USD: { threshold: 10, revision: 2 },
      HKD: { threshold: 50, revision: 3 },
    },
  };
  const usd = paymentCollectionThresholdPolicy(state, 'usd');
  const hkd = paymentCollectionThresholdPolicy(state, 'HKD');
  assert.equal(paymentCollectionBalanceIsSettled(10, usd), true);
  assert.equal(paymentCollectionBalanceIsSettled(10.01, usd), false);
  assert.equal(paymentCollectionBalanceIsSettled(50, hkd), true);
  assert.equal(paymentCollectionBalanceIsSettled(50.01, hkd), false);
});

test('unconfigured currencies use the strict below 0.005 fail-safe and close overpayments', () => {
  const policy = paymentCollectionThresholdPolicy({ byCurrency: {} }, 'EUR');
  assert.equal(policy.configured, false);
  assert.equal(paymentCollectionBalanceIsSettled(0.0049, policy), true);
  assert.equal(paymentCollectionBalanceIsSettled(0.005, policy), false);
  assert.equal(paymentCollectionBalanceIsSettled(-100, policy), true);
  assert.equal(paymentCollectionBalanceIsSettled(null, policy), false);
});

test('rejects malformed currency identifiers', () => {
  assert.equal(normalizeCurrencyIsoCode('usd'), 'USD');
  assert.equal(normalizeCurrencyIsoCode('US'), null);
  assert.equal(normalizeCurrencyIsoCode('USD OR 1=1'), null);
});

test('saves multiple currency thresholds through one atomic RPC', async () => {
  const calls = [];
  const client = {
    async rpc(name, payload) {
      calls.push({ name, payload });
      return {
        data: payload.p_thresholds.map((item, index) => ({
          currency_iso_code: item.currencyIsoCode,
          threshold: item.threshold,
          revision: item.expectedRevision + 1,
          updated_at: `2026-08-06T00:00:0${index}Z`,
        })),
        error: null,
      };
    },
  };
  const saved = await savePaymentCollectionThresholds(client, [
    { currencyIsoCode: 'usd', threshold: 10, expectedRevision: 2 },
    { currencyIsoCode: 'HKD', threshold: 50, expectedRevision: 3 },
  ], { id: 'actor', email: 'actor@example.invalid' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'save_payment_collection_currency_thresholds');
  assert.deepEqual(saved.map((item) => [item.currencyIsoCode, item.revision]), [['HKD', 4], ['USD', 3]]);
});

test('rejects duplicate currencies before the threshold batch reaches Supabase', async () => {
  await assert.rejects(
    () => savePaymentCollectionThresholds({ rpc: () => assert.fail('RPC should not run') }, [
      { currencyIsoCode: 'USD', threshold: 10, expectedRevision: 0 },
      { currencyIsoCode: 'usd', threshold: 20, expectedRevision: 0 },
    ], {}),
    /only once/i,
  );
});

test('Incoming Payments does not render the removed global threshold variable', async () => {
  const page = await readFile(new URL('../src/pages/IncomingPayments.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /fmtMoney\(threshold\)/);
  assert.match(page, /fallback &lt;0\.005/);
  assert.match(page, /thresholds: changed/);
});
