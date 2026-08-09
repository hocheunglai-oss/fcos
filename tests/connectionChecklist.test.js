import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APPROVED_CONNECTION_BROWSER_PROFILE,
  CONNECTION_CHECKLIST_SEQUENCE,
  CONNECTION_TARGETS,
  connectionCheckState,
  sanitizeConnectionCheck,
  sanitizeConnectionChecks,
  updateConnectionCheck,
} from '../src/lib/connectionChecklist.js';

const WHEN = new Date('2026-08-09T08:00:00.000Z');

test('connection checklist records the approved non-secret FCOS targets and fixed order', () => {
  assert.deepEqual(CONNECTION_CHECKLIST_SEQUENCE.map(({ id }) => id), [
    'cli_availability',
    'target_identity',
    'cli_use',
    'browser_fallback',
  ]);
  assert.equal(APPROVED_CONNECTION_BROWSER_PROFILE, 'Otto');

  const targets = Object.fromEntries(CONNECTION_TARGETS.map((target) => [
    target.id,
    Object.fromEntries(target.identifiers.map(({ label, value }) => [label, value])),
  ]));
  assert.deepEqual(targets.github, {
    'Required account': 'hocheunglai-oss',
    Repository: 'hocheunglai-oss/fcos',
  });
  assert.deepEqual(targets.vercel, {
    Team: 'hocheunglai-6535s-projects',
    Project: 'fcos',
    Target: 'hocheunglai-6535s-projects/fcos',
  });
  assert.deepEqual(targets.supabase, {
    'Project name': 'FCOS',
    'Project ref': 'pjforfvchygdyqfcgpmw',
  });
  assert.deepEqual(targets.salesforce, {
    Environment: 'Production',
    'Org ID': '00D2x000000Ei4oEAC',
  });
});

test('connection checklist state machine blocks out-of-order CLI and browser actions', () => {
  assert.throws(
    () => updateConnectionCheck({}, 'identity_verified', WHEN),
    /Verify CLI availability/,
  );
  assert.throws(
    () => updateConnectionCheck({}, 'cli_completed', WHEN),
    /Verify the approved account/,
  );
  assert.throws(
    () => updateConnectionCheck({}, 'browser_authentication_completed', WHEN),
    /only after the CLI cannot complete authentication/,
  );

  const unavailable = updateConnectionCheck({}, 'cli_unavailable', WHEN);
  assert.deepEqual(connectionCheckState(unavailable), {
    step: 'cli_availability',
    status: 'stopped',
    browserAllowed: false,
  });

  const available = updateConnectionCheck({}, 'cli_available', WHEN);
  const mismatch = updateConnectionCheck(available, 'identity_mismatch', WHEN);
  assert.deepEqual(connectionCheckState(mismatch), {
    step: 'target_identity',
    status: 'stopped',
    browserAllowed: false,
  });
});

test('Otto fallback unlocks only for CLI authentication and returns to identity verification', () => {
  let record = updateConnectionCheck({}, 'cli_available', WHEN);
  record = updateConnectionCheck(record, 'identity_verified', WHEN);
  record = updateConnectionCheck(record, 'cli_authentication_blocked', WHEN);
  assert.deepEqual(connectionCheckState(record), {
    step: 'browser_fallback',
    status: 'authentication_blocked',
    browserAllowed: true,
  });

  record = updateConnectionCheck(record, 'browser_authentication_completed', WHEN);
  assert.equal(record.browserProfile, 'Otto');
  assert.equal(record.browserAuthenticationRecorded, true);
  assert.deepEqual(connectionCheckState(record), {
    step: 'target_identity',
    status: 'return_to_cli',
    browserAllowed: true,
  });

  record = updateConnectionCheck(record, 'return_to_cli', WHEN);
  assert.equal(record.cliAvailability, 'available');
  assert.equal(record.identityStatus, null);
  assert.equal(record.browserProfile, null);
  assert.deepEqual(connectionCheckState(record), {
    step: 'target_identity',
    status: 'pending',
    browserAllowed: false,
  });
});

test('completed CLI path never unlocks Chrome', () => {
  let record = updateConnectionCheck({}, 'cli_available', WHEN);
  record = updateConnectionCheck(record, 'identity_verified', WHEN);
  record = updateConnectionCheck(record, 'cli_completed', WHEN);
  assert.deepEqual(connectionCheckState(record), {
    step: 'complete',
    status: 'complete',
    browserAllowed: false,
  });
  assert.throws(
    () => updateConnectionCheck(record, 'browser_authentication_completed', WHEN),
    /only after the CLI cannot complete authentication/,
  );
});

test('checklist persistence strips arbitrary text, credential fields, and unapproved profiles', () => {
  const sanitized = sanitizeConnectionCheck({
    cliAvailability: 'available',
    identityStatus: 'authentication_blocked',
    cliOutcome: 'completed',
    browserProfile: 'Personal',
    browserAuthenticationRecorded: true,
    updatedAt: '2026-08-09T08:00:00.000Z',
    accessToken: 'do-not-store',
    cliOutput: 'do-not-store',
    notes: 'do-not-store',
  });

  assert.deepEqual(sanitized, {
    cliAvailability: 'available',
    identityStatus: 'authentication_blocked',
    cliOutcome: null,
    browserProfile: null,
    browserAuthenticationRecorded: false,
    updatedAt: '2026-08-09T08:00:00.000Z',
  });

  const records = sanitizeConnectionChecks({
    github: sanitized,
    unknownProvider: { accessToken: 'do-not-store' },
  });
  assert.deepEqual(Object.keys(records), ['github', 'vercel', 'supabase', 'salesforce']);
  assert.doesNotMatch(JSON.stringify(records), /do-not-store|accessToken|cliOutput|notes/);
});
