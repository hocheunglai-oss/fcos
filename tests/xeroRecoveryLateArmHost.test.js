import test from 'node:test';
import assert from 'node:assert/strict';
import { createJoinedHostFixture } from './helpers/xero-recovery-joined-host.mjs';

// Actual TLS/signed actor/host/SQL entrypoints, external Auth/provider transport
// synthetic. A local pass is not hosted identity, current quota or financial approval.
for (const lost of ['xero_recovery_step_claim', 'xero_recovery_step_complete']) {
  test(`v3 ${lost} lost response preserves the original SQL outcome and GET cannot rearm`, async t => {
    const f = await createJoinedHostFixture(t, { planVersion: 3, lose: lost });
    const failed = await f.send();
    assert.ok(failed.status >= 400);
    const rows = (await f.db.query('select floor(extract(epoch from claimed_at)*1000)::bigint started from public.xero_recovery_step_attempts')).rows;
    assert.equal(rows.length, 1);
    const readsBefore = f.calls.filter(c => c.path.endsWith('/xero_contact_sync_connections')).length;
    assert.equal(readsBefore, lost === 'xero_recovery_step_claim' ? 0 : 1);
    const readback = await f.send({ method: 'GET' });
    assert.equal(readback.status, 200);
    assert.equal(readback.body.kind, 'fcos_xero_recovery_step_readback_v3');
    assert.equal(readback.body.state, lost === 'xero_recovery_step_claim' ? 'submitted_unknown' : 'ready');
    const started = readback.body.execution.firstStartedAt;
    assert.equal(started, Number(rows[0].started));
    const repeat = await f.send();
    assert.ok(repeat.status >= 400);
    assert.equal((await f.db.query('select count(*)::int n from public.xero_recovery_step_attempts')).rows[0].n, 1);
    assert.equal(f.calls.filter(c => c.path.endsWith('/xero_recovery_step_claim')).length, 1);
    assert.equal(f.calls.filter(c => c.path.endsWith('/xero_contact_sync_connections')).length, readsBefore);
    assert.equal(readback.body.executionAuthorityGranted, false);
  });
}
