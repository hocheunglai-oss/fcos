import assert from 'node:assert/strict';
import test from 'node:test';
import { applyReviewedPrerequisites, verifyRemittanceCatalog } from '../scripts/lib/rapid-release/remittance-readback.mjs';

function catalogFixture() {
  return [
    ['finish_xero_group_payment_v1(uuid, uuid, text, text, jsonb, jsonb, uuid, text)', '0af6d9c4f6d867a8b592755dca6af7020b38fa05e53b9cfef0b14f13c191b201', []],
    ['link_xero_group_payments_v1(uuid, jsonb, uuid, text)', 'f88894c8804bce73d542063c211940d7c5b7a31d9861ba908dd475fce05a5494', []],
    ['xero_guard_group_payment_v1()', '88741f4baa2d639fdc60cbe2073e5d2cfd2aaaa60b4bc920d2cdfda875905911', [
      'public.xero_financial_payment_mappings:xero_group_payment_mapping_guard',
      'public.xero_financial_sync_runs:xero_group_payment_claim_guard',
    ]],
  ].map(([signature, body_digest, triggers]) => ({
    signature, body_digest, triggers, prosecdef: false, proconfig: ['search_path=public, pg_temp'],
    anon_execute: false, authenticated_execute: false, service_execute: true,
  }));
}

test('accepts the exact already-applied catalog and rejects drift in body, privileges or triggers', () => {
  assert.match(verifyRemittanceCatalog(catalogFixture()), /^[a-f0-9]{64}$/);
  for (const change of [
    rows => { rows[0].body_digest = 'other'; },
    rows => { rows[0].authenticated_execute = true; },
    rows => { rows[1].prosecdef = true; },
    rows => { rows[2].triggers.pop(); },
    rows => { rows[1] = rows[0]; },
    rows => { rows.pop(); },
  ]) {
    const rows = catalogFixture();
    change(rows);
    assert.throws(() => verifyRemittanceCatalog(rows), { code: 'REMITTANCE_SCHEMA_READBACK_MISMATCH' });
  }
});

test('rejects an unbound migration plan before touching the journal or providers', async () => {
  await assert.rejects(applyReviewedPrerequisites({ plan: {} }), { code: 'REMITTANCE_READBACK_PLAN_MISMATCH' });
});
