import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('company financing rate is service-only, permission checked, revisioned and atomically audited', async (t) => {
  const db = new PGlite(); t.after(() => db.close());
  const admin = randomUUID(); const finance = randomUUID(); const viewer = randomUUID();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.user_profiles(id uuid primary key, active boolean not null, user_type text, email text);
    create table public.user_module_permissions(user_id uuid, module_id text, can_view boolean);
    create table public.user_type_module_permissions(user_type_id text, module_id text, can_view boolean);
    grant usage on schema public to service_role;
    grant select on public.user_profiles,public.user_module_permissions,public.user_type_module_permissions to service_role;`);
  await db.query("insert into user_profiles values ($1,true,'administrator','admin@example.test'),($2,true,'finance','finance@example.test'),($3,true,'viewer','viewer@example.test')", [admin, finance, viewer]);
  const directory = new URL('../supabase/migrations/', import.meta.url);
  const filename = (await readdir(directory)).find((name) => name.endsWith('_dashboard_finance_settings.sql'));
  await db.exec(await readFile(new URL(filename, directory), 'utf8'));
  const save = (rate, revision, actor = finance) => db.query('select * from save_company_finance_settings($1,$2,$3)', [rate, revision, actor]);
  await db.exec('set role service_role');
  assert.equal(Number((await db.query('select annual_interest_rate_pct from company_finance_settings')).rows[0].annual_interest_rate_pct), 5);
  await assert.rejects(save(6, 1, viewer), /permission/);
  for (const rate of [null, -1, 101, 5.001, 'NaN']) await assert.rejects(save(rate, 1), /financing rate/);
  const first = (await save(6.25, 1)).rows[0]; assert.equal(Number(first.revision), 2); assert.equal(first.updated_by_email, 'finance@example.test');
  await assert.rejects(save(7, 1, admin), /changed after/);
  assert.equal((await db.query('select count(*)::int n from company_finance_setting_events')).rows[0].n, 1);
  assert.equal(Number((await save(6.25, 2)).rows[0].revision), 2);
  await db.exec('reset role');
  await db.query("insert into user_module_permissions values ($1,'financial_report_settings_manage',false)", [finance]);
  await db.exec('set role service_role'); await assert.rejects(save(7, 2), /permission/);
  await save(0, 2, admin);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`reset role; set role ${role}`);
    for (const table of ['company_finance_settings', 'company_finance_setting_events']) await assert.rejects(db.exec(`select * from ${table}`), /permission denied/);
    await assert.rejects(save(7, 3, admin), /permission denied/);
  }
  await db.exec('reset role'); await db.query('update user_profiles set active=false where id=$1', [admin]);
  await db.exec('set role service_role'); await assert.rejects(save(7, 3, admin), /permission/);
  await db.exec('reset role'); await db.query('delete from user_profiles where id=$1', [finance]);
  const event = (await db.query('select actor_user_id,actor_email from company_finance_setting_events where revision=2')).rows[0];
  assert.equal(event.actor_user_id, null); assert.equal(event.actor_email, 'finance@example.test');
});

test('bank-charge migration and v2 save keep one strict, revisioned and private finance policy', async (t) => {
  const db = new PGlite(); t.after(() => db.close());
  const admin = randomUUID(); const generalManager = randomUUID(); const finance = randomUUID();
  const viewer = randomUUID(); const capabilityUser = randomUUID(); const inactiveAdmin = randomUUID();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.user_profiles(id uuid primary key, active boolean not null, user_type text, email text);
    create table public.user_module_permissions(user_id uuid, module_id text, can_view boolean);
    create table public.user_type_module_permissions(user_type_id text, module_id text, can_view boolean);
    grant usage on schema public to service_role;
    grant select on public.user_profiles,public.user_module_permissions,public.user_type_module_permissions to service_role;`);
  await db.query(`insert into user_profiles values
    ($1,true,'administrator','admin@example.test'),
    ($2,true,'general_manager','gm@example.test'),
    ($3,true,'finance','finance@example.test'),
    ($4,true,'viewer','viewer@example.test'),
    ($5,true,'viewer','capability@example.test'),
    ($6,false,'administrator','inactive@example.test')`, [admin, generalManager, finance, viewer, capabilityUser, inactiveAdmin]);
  await db.query("insert into user_module_permissions values ($1,'financial_report_settings_manage',true)", [capabilityUser]);

  const migrations = new URL('../supabase/migrations/', import.meta.url);
  const files = await readdir(migrations);
  const legacyMigration = files.find((name) => name.endsWith('_dashboard_finance_settings.sql'));
  const bankChargeMigration = files.find((name) => name.endsWith('_dashboard_bank_charges.sql'));
  assert.ok(legacyMigration); assert.ok(bankChargeMigration);
  await db.exec(await readFile(new URL(legacyMigration, migrations), 'utf8'));
  assert.equal(Number((await db.query('select revision from company_finance_settings')).rows[0].revision), 1);
  await db.exec(await readFile(new URL(bankChargeMigration, migrations), 'utf8'));

  const saveV2 = (rate, revision, actor, charges) => db.query(
    'select * from save_company_finance_settings_v2($1,$2,$3,$4::jsonb)',
    [rate, revision, actor, charges == null ? null : JSON.stringify(charges)],
  );
  const saveLegacy = (rate, revision, actor) => db.query(
    'select * from save_company_finance_settings($1,$2,$3)', [rate, revision, actor],
  );

  await db.exec('set role service_role');
  const migrated = (await db.query('select * from company_finance_settings')).rows[0];
  assert.equal(Number(migrated.annual_interest_rate_pct), 5);
  assert.equal(Number(migrated.revision), 2);
  assert.deepEqual(migrated.bank_charges_usd, { UBS: 10, DBS: 15 });
  assert.equal(migrated.updated_by, null);
  assert.equal(migrated.updated_by_email, 'system:migration:dashboard_bank_charges');
  const migrationEvent = (await db.query('select * from company_finance_setting_events where revision=2')).rows[0];
  assert.equal(Number(migrationEvent.previous_rate_pct), 5);
  assert.equal(Number(migrationEvent.annual_interest_rate_pct), 5);
  assert.equal(migrationEvent.previous_bank_charges_usd, null);
  assert.deepEqual(migrationEvent.bank_charges_usd, { UBS: 10, DBS: 15 });
  assert.equal(migrationEvent.actor_user_id, null);
  assert.equal(migrationEvent.actor_email, 'system:migration:dashboard_bank_charges');

  await assert.rejects(saveV2(5, 2, viewer, { UBS: 10, DBS: 15 }), /permission/i);
  await assert.rejects(saveV2(5, 2, inactiveAdmin, { UBS: 10, DBS: 15 }), /permission/i);
  for (const charges of [
    {}, { UBS: 10 }, { UBS: 10, DBS: 15, HSBC: 20 }, [], 'invalid',
    { UBS: '10', DBS: 15 }, { UBS: null, DBS: 15 }, { ubs: 10, DBS: 15 },
    { UBS: -0.01, DBS: 15 }, { UBS: 1_000_000.01, DBS: 15 }, { UBS: 10.001, DBS: 15 },
  ]) await assert.rejects(saveV2(5, 2, finance, charges), /valid UBS and DBS charges/i);
  for (const rate of [null, -1, 101, 5.001, 'NaN']) {
    await assert.rejects(saveV2(rate, 2, finance, { UBS: 10, DBS: 15 }), /financing rate/i);
  }

  const noOp = (await saveV2(5, 2, finance, { UBS: 10, DBS: 15 })).rows[0];
  assert.equal(Number(noOp.revision), 2);
  assert.equal((await db.query('select count(*)::int n from company_finance_setting_events')).rows[0].n, 1);

  const feeOnly = (await saveV2(5, 2, generalManager, { UBS: 12.5, DBS: 15 })).rows[0];
  assert.equal(Number(feeOnly.revision), 3);
  assert.deepEqual(feeOnly.bank_charges_usd, { UBS: 12.5, DBS: 15 });
  const feeEvent = (await db.query('select * from company_finance_setting_events where revision=3')).rows[0];
  assert.equal(Number(feeEvent.previous_rate_pct), 5); assert.equal(Number(feeEvent.annual_interest_rate_pct), 5);
  assert.deepEqual(feeEvent.previous_bank_charges_usd, { UBS: 10, DBS: 15 });
  assert.deepEqual(feeEvent.bank_charges_usd, { UBS: 12.5, DBS: 15 });
  assert.equal(feeEvent.actor_user_id, generalManager); assert.equal(feeEvent.actor_email, 'gm@example.test');
  await assert.rejects(saveV2(6, 2, admin, { UBS: 12.5, DBS: 15 }), /changed after/i);

  const legacySaved = (await saveLegacy(6.25, 3, admin)).rows[0];
  assert.equal(Number(legacySaved.revision), 4);
  assert.equal(Number(legacySaved.annual_interest_rate_pct), 6.25);
  assert.deepEqual(legacySaved.bank_charges_usd, { UBS: 12.5, DBS: 15 });
  const legacyEvent = (await db.query('select * from company_finance_setting_events where revision=4')).rows[0];
  assert.deepEqual(legacyEvent.previous_bank_charges_usd, { UBS: 12.5, DBS: 15 });
  assert.deepEqual(legacyEvent.bank_charges_usd, { UBS: 12.5, DBS: 15 });

  const capabilitySaved = (await saveV2(6.25, 4, capabilityUser, { UBS: 12.5, DBS: 20 })).rows[0];
  assert.equal(Number(capabilitySaved.revision), 5);
  assert.deepEqual(capabilitySaved.bank_charges_usd, { UBS: 12.5, DBS: 20 });
  const boundarySaved = (await saveV2(6.25, 5, admin, { UBS: 0, DBS: 1_000_000 })).rows[0];
  assert.equal(Number(boundarySaved.revision), 6);
  assert.deepEqual(boundarySaved.bank_charges_usd, { UBS: 0, DBS: 1_000_000 });
  await assert.rejects(saveV2(6.25, 5, generalManager, { UBS: 1, DBS: 1 }), /changed after/i);
  await db.exec('reset role');
  await db.query("insert into user_module_permissions values ($1,'financial_report_settings_manage',false)", [finance]);
  await db.exec('set role service_role');
  await assert.rejects(saveV2(7, 6, finance, { UBS: 12.5, DBS: 20 }), /permission/i);

  for (const role of ['anon', 'authenticated']) {
    await db.exec(`reset role; set role ${role}`);
    for (const table of ['company_finance_settings', 'company_finance_setting_events']) {
      await assert.rejects(db.exec(`select * from ${table}`), /permission denied/i);
    }
    await assert.rejects(saveLegacy(7, 6, admin), /permission denied/i);
    await assert.rejects(saveV2(7, 6, admin, { UBS: 12.5, DBS: 20 }), /permission denied/i);
  }

  await db.exec('reset role');
  await db.query('delete from user_profiles where id=$1', [generalManager]);
  const preservedEvent = (await db.query('select actor_user_id,actor_email from company_finance_setting_events where revision=3')).rows[0];
  assert.equal(preservedEvent.actor_user_id, null);
  assert.equal(preservedEvent.actor_email, 'gm@example.test');
});
