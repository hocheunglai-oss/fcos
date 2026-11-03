import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Historical deployed schema for isolated databases only. This is deliberately
// outside supabase/migrations: it must never become a newly replayable migration.
// Byte-equivalent source: f3472492ff4d0b0c70248a3c8e5c0012981a94b3,
// supabase/migrations/20260929170347_xero_shared_control.sql.
export async function readXeroSharedControlFixture() {
  const bytes = await readFile(new URL('../fixtures/xero-recovery/shared-control-f347.sql', import.meta.url));
  if (createHash('sha256').update(bytes).digest('hex') !== 'e01a76c618231d4818d76cc173692001642e843e049cda7788610c1a7535878d') {
    throw Error('XERO_SHARED_CONTROL_FIXTURE_CHANGED');
  }
  return bytes.toString('utf8');
}
