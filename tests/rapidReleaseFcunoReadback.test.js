import assert from 'node:assert/strict';
import test from 'node:test';
import { applyReviewedPrerequisites, verifyFcunoCatalog } from '../scripts/lib/rapid-release/fcuno-readback.mjs';

function catalogFixture() {
  const rows = [
    ['fcos_finalize_identity_sync(uuid, uuid, bigint)', '2da49057dadc7e059944bd6e0a716b3edcf5a599681d0dba85963773d9f8d2d3', []],
    ['fcos_protect_external_identity_revision()', '0aa446687aa6e39c6db666e416ad3fcab60e6aa6b93ed688f09ddd64c0057d6b', ['public.fcos_external_identity_links']],
    ['fcos_reject_identity_session_update()', '2084de0a54cb00f1d04adc07c9737f4d60d8d7dd7d87c03a4e4ea8f59e0ce065', ['public.fcos_external_identity_sessions']],
  ].map(([signature, body_digest, triggers]) => ({
    signature, body_digest, triggers, prosecdef: false, proconfig: ['search_path=pg_catalog, pg_temp'],
    anon_execute: false, authenticated_execute: false, service_execute: true,
  }));
  return { rows, table: { rls: true, policies: 0, grants: ['service_role:INSERT', 'service_role:SELECT'] } };
}

test('requires the verified FCUNO catalog, restricted proof grants and active triggers', () => {
  const { rows, table } = catalogFixture();
  assert.equal(verifyFcunoCatalog(rows, table), 'f7a82c16699d3059cfcc5ee01040824517864051ebdfbe715a0d7a59f58ffce5');
  for (const change of [
    ({ rows }) => { rows[0].authenticated_execute = true; },
    ({ rows }) => { rows[1].body_digest = 'other'; },
    ({ rows }) => { rows[2].triggers = []; },
    ({ table }) => { table.rls = false; },
    ({ table }) => { table.policies = 1; },
    ({ table }) => { table.grants.push('service_role:UPDATE'); },
  ]) {
    const fixture = catalogFixture();
    change(fixture);
    assert.throws(() => verifyFcunoCatalog(fixture.rows, fixture.table), { code: 'FCUNO_SCHEMA_READBACK_MISMATCH' });
  }
});

test('rejects an unbound plan before contacting providers', async () => {
  await assert.rejects(applyReviewedPrerequisites({ plan: {} }), { code: 'FCUNO_READBACK_PLAN_MISMATCH' });
});
