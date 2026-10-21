import { readFileSync } from 'node:fs';
import { issuedSupplierHash as hash } from '../api/_xeroIssuedSupplierPreservation.js';

export const draftFixtureAvailable = Boolean(process.env.FCOS_DRAFT_AUTHORISATION_TEST_FIXTURE);
export const draftIds = Object.freeze({ run: '10000000-0000-4000-8000-000000000001', item: '10000000-0000-4000-8000-000000000002',
  mapping: '10000000-0000-4000-8000-000000000003', actor: '10000000-0000-4000-8000-000000000004', claim: '10000000-0000-4000-8000-000000000005',
  request: '10000000-0000-4000-8000-000000000006', budget: '10000000-0000-4000-8000-000000000007',
  verification: '10000000-0000-4000-8000-000000000008', event: '10000000-0000-4000-8000-000000000009' });

// Positive scope is cryptographically pinned to private reviewed records. Tests
// use an explicit service-private fixture path; public source contains no data.
export function draftFixture() {
  if (!draftFixtureAvailable) throw Error('PRIVATE_DRAFT_AUTHORISATION_FIXTURE_REQUIRED');
  const fixture = JSON.parse(readFileSync(process.env.FCOS_DRAFT_AUTHORISATION_TEST_FIXTURE, 'utf8'));
  const { current } = fixture.input;
  function reseal() { current.sourceSnapshotHash = hash(current.sourceEvidence); current.controlSnapshotHash = hash(current.controls); current.identitySnapshotHash = hash(current.identity); }
  return { ...fixture, reseal };
}
