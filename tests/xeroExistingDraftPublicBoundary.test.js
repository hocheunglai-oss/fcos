import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { financialDatabase } from './xeroSupplierFinancialBucketDatabase.fixture.js';
import { canonical, claimSql, hash, migration } from './xeroExistingDraftAuthorisationDatabase.fixture.js';
import { migration as quotaMigration } from './xeroExistingDraftQuotaDatabase.fixture.js';

const restrictedTables = [
  'xero_existing_draft_authorisation_approved_records',
  'xero_existing_draft_authorisation_claims',
  'xero_existing_draft_authorisation_events',
  'xero_existing_draft_quota_grants_v1',
  'xero_existing_draft_quota_scopes_v1',
];

test('existing-draft database refuses unapproved actions without access to private fixtures', async (t) => {
  const { db } = await financialDatabase(t, false);
  await db.exec(`
    create function public.fcos_has_access(p_actor uuid, p_permission text)
    returns boolean language sql security definer set search_path = ''
    as $$
      select exists(select 1 from public.user_profiles where id = p_actor)
        and p_permission in ('xero_portal', 'xero_portal_manage')
    $$;
    grant execute on function public.fcos_has_access(uuid, text) to service_role;
  `);
  for (const name of ['20260929170347_xero_shared_control.sql', '20260929170953_xero_reconciliation_campaign.sql', migration]) {
    const sql = await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
    await db.exec(sql.replace(/^create extension if not exists pgcrypto;$/m, ''));
  }
  await db.exec('alter table public.user_profiles add column email text, add column active boolean not null default true');
  await db.exec(await readFile(new URL(`../supabase/migrations/${quotaMigration}`, import.meta.url), 'utf8'));

  await t.test('ordinary API roles cannot read or delete approval and quota data', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      for (const table of restrictedTables) {
        await assert.rejects(db.query(`select * from public.${table}`), { code: '42501' });
        await assert.rejects(db.query(`delete from public.${table}`), { code: '42501' });
      }
      await db.exec('reset role');
    }
  });

  await t.test('an invented record fails the immutable approval allowlist', async () => {
    const targetId = randomUUID();
    const reviewed = { InvoiceID: targetId, Status: 'DRAFT' };
    const reviewedHash = hash(reviewed);
    const record = { targetId, sourceObject: 'Invoice__c', sourceId: 'PUBLIC-NEGATIVE-ONLY', rawTargetSha256: reviewedHash };
    const selection = {
      selectionFileSha256: '6230b2578549e33b67555931391e9cdd943d5134377eebc357e2b0e46b1e7a24',
      selectionSha256: 'b3414d1d6f3bfe9e8c17e515d04ecbbe9cb216dac2bb2ec1ee4da30a53dd8506',
      humanApprovalSha256: 'f6ec43c03822df879641eabbfd98d1340841ef5f102bc2e720a0576ea273d004',
      record,
    };
    await assert.rejects(db.query(`
      insert into public.xero_existing_draft_authorisation_approved_records
      values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)
    `, [
      targetId, randomUUID(), record.sourceObject, record.sourceId, JSON.stringify(selection),
      JSON.stringify(reviewed), canonical(reviewed), reviewedHash,
    ]), { code: '23514' });
  });

  await t.test('unapproved claims and quota requests leave the ledger empty', async () => {
    const tenant = randomUUID();
    const actor = randomUUID();
    const actorEmail = 'public-negative@example.invalid';
    await db.exec('set role service_role');
    await assert.rejects(db.query(claimSql, [
      randomUUID(), 1, randomUUID(), new Date().toISOString(), tenant,
      'unapproved-public-negative', '{}', '{}', hash({}), actor, actorEmail,
    ]));
    await assert.rejects(db.query('select public.xero_existing_draft_quota_targets_v1($1,$2::uuid[])',
      [tenant, [randomUUID()]]), { code: '42501' });
    await assert.rejects(db.query('select public.xero_existing_draft_quota_reserve_v1($1,$2,$3,$4,$5::uuid[],$6)',
      [tenant, randomUUID(), actor, actorEmail, [randomUUID()], 'apply']), { code: '42501' });
    await db.exec('reset role');
    for (const table of restrictedTables) {
      const result = await db.query(`select count(*) as count from public.${table}`);
      assert.equal(Number(result.rows[0].count), 0);
    }
  });
});
