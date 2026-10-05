import assert from 'node:assert/strict';
import test from 'node:test';
import { missingNomBRecoveryActions } from '../api/_missingNomBRecovery.js';
import { missingNomBStatus } from '../api/_missingNomB.js';

test('recovery guidance preserves uncertain-outcome and prospective-scan controls', () => {
  const actions = missingNomBRecoveryActions({ enabled: true, scanLagSeconds: null, scanLagWarningSeconds: 900,
    blocked: 1, failed: 1, uncertain: 1, stalledDeliveries: 1, uncertainUploads: 1 });
  assert.equal(actions.length, 5);
  assert.match(actions[0].nextAction, /do not reset activation/);
  assert.match(actions.find(action => action.issue === 'Delivery requires verification').nextAction, /before any further send/);
  assert.match(actions.find(action => action.issue === 'Filing requires verification').nextAction, /original upload with the same file/);
});

test('healthy or disabled scanning creates no unnecessary recovery actions', () => {
  for (const enabled of [true, false]) assert.deepEqual(missingNomBRecoveryActions({ enabled, scanLagSeconds: enabled ? 900 : null,
    scanLagWarningSeconds: 900, blocked: 0, failed: 0, uncertain: 0, stalledDeliveries: 0, uncertainUploads: 0 }), []);
});

function healthClient(checkpoint) {
  return { from(table) {
    let head = false;
    const builder = { select(_columns, options) { head = options?.head; return this; },
      eq() { return this; }, in() { return this; }, lt() { return this; }, order() { return this; }, limit() { return this; }, maybeSingle() { return this; },
      then(resolve, reject) { return Promise.resolve({ error: null, count: head ? 0 : undefined,
        data: table === 'missing_nom_b_scan_state' ? { activated_at: '2026-10-01T00:00:00Z', completed_through: checkpoint } : [] }).then(resolve, reject); },
    };
    return builder;
  } };
}

test('an active scan with a missing or invalid checkpoint is warning, not online', async () => {
  for (const checkpoint of [null, 'invalid']) {
    const result = await missingNomBStatus({ client: healthClient(checkpoint),
      env: { VERCEL_ENV: 'production', FCOS_ENABLE_MISSING_NOM_B_REMINDERS: 'true' }, now: new Date('2026-10-01T00:10:00Z') });
    assert.equal(result.healthStatus, 'warning');
    assert.equal(result.scanLagSeconds, null);
    assert.equal(result.recoveryActions.length, 1);
  }
});

test('a recent valid checkpoint reports healthy scan lag', async () => {
  const result = await missingNomBStatus({ client: healthClient('2026-10-01T00:09:00Z'),
    env: { VERCEL_ENV: 'production', FCOS_ENABLE_MISSING_NOM_B_REMINDERS: 'true' }, now: new Date('2026-10-01T00:10:00Z') });
  assert.equal(result.healthStatus, 'online'); assert.equal(result.scanLagSeconds, 60); assert.deepEqual(result.recoveryActions, []);
});
