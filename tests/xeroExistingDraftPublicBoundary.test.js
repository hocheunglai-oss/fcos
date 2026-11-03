// Public CI tests refusal against unchanged SQL. Approved private54 lifecycle
// cases run separately with their exact private seed before Production.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { financialDatabase, canonical, hash } from './xeroSupplierFinancialBucketDatabase.fixture.js';
import { migration, claimSql } from './xeroExistingDraftAuthorisationDatabase.fixture.js';
import { migration as quotaMigration } from './xeroExistingDraftQuotaDatabase.fixture.js';

async function boundary(t, native) {
  const { db } = await financialDatabase(t, native);
  await db.exec(`create function public.fcos_has_access(p_actor uuid,p_permission text) returns boolean language sql security definer set search_path='' as $$select exists(select 1 from public.user_profiles where id=p_actor) and p_permission in('xero_portal','xero_portal_manage')$$;grant execute on function public.fcos_has_access(uuid,text) to service_role;`);
  for (const name of ['20260929170347_xero_shared_control.sql', '20260929170953_xero_reconciliation_campaign.sql', migration]) {
    await db.exec((await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')).replace(/^create extension if not exists pgcrypto;$/m, ''));
  }
  await db.exec('alter table public.user_profiles add column email text,add column active boolean not null default true');
  await db.exec(await readFile(new URL('../supabase/migrations/' + quotaMigration, import.meta.url), 'utf8'));
  const tables = ['xero_existing_draft_authorisation_approved_records', 'xero_existing_draft_authorisation_claims', 'xero_existing_draft_authorisation_events', 'xero_existing_draft_quota_grants_v1', 'xero_existing_draft_quota_scopes_v1'];
  await t.test('restricted roles cannot read approvals or create claims/grants', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec('set role ' + role);
      for (const table of tables) {
        await assert.rejects(db.query('select * from public.' + table), e => e.code === '42501');
        await assert.rejects(db.query('delete from public.' + table), e => e.code === '42501');
      }
      await db.exec('reset role');
    }
  });
  await t.test('invented record fails the actual immutable approval leaf allowlist', async () => {
    const targetId = randomUUID(), tenantId = randomUUID();
    const reviewed = { InvoiceID: targetId, Status: 'DRAFT' }, text = canonical(reviewed);
    const record = { targetId, sourceObject: 'Invoice__c', sourceId: 'PUBLIC-NEGATIVE-ONLY', rawTargetSha256: hash(reviewed) };
    const selection = { selectionFileSha256: '6230b2578549e33b67555931391e9cdd943d5134377eebc357e2b0e46b1e7a24', selectionSha256: 'b3414d1d6f3bfe9e8c17e515d04ecbbe9cb216dac2bb2ec1ee4da30a53dd8506', humanApprovalSha256: 'f6ec43c03822df879641eabbfd98d1340841ef5f102bc2e720a0576ea273d004', record };
    await assert.rejects(db.query('insert into public.xero_existing_draft_authorisation_approved_records values($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)', [targetId, tenantId, record.sourceObject, record.sourceId, JSON.stringify(selection), JSON.stringify(reviewed), text, hash(reviewed)]), e => e.code === '23514');
  });
  await t.test('unapproved claim and quota scope refuse without durable writes', async () => {
    await db.exec('set role service_role');
    const tenant = randomUUID(), actor = randomUUID();
    await assert.rejects(db.query(claimSql, [randomUUID(), 1, randomUUID(), new Date().toISOString(), tenant, 'unapproved-public-negative', '{}', '{}', hash({}), actor, 'public-negative@example.invalid']));
    await assert.rejects(db.query('select public.xero_existing_draft_quota_targets_v1($1,$2::uuid[])', [tenant, [randomUUID()]]), e => e.code === '42501');
    await assert.rejects(db.query('select public.xero_existing_draft_quota_reserve_v1($1,$2,$3,$4,$5::uuid[],$6)', [tenant, randomUUID(), actor, 'public-negative@example.invalid', [randomUUID()], 'apply']), e => e.code === '42501');
    await db.exec('reset role');
    for (const table of tables) assert.equal(Number((await db.query('select count(*) n from public.' + table)).rows[0].n), 0);
  });
}
test('public PGlite original54 refusal boundaries without private records', t => boundary(t, false));
test('public native PostgreSQL original54 refusal boundaries without private records', t => boundary(t, true));
