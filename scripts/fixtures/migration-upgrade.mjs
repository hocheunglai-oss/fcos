import assert from 'node:assert/strict';

const mailbox = 'd0000000-0000-4000-8000-000000000001';
const action = 'd0000000-0000-4000-8000-000000000003';
const outcome = 'd0000000-0000-4000-8000-000000000004';
const job = 'd0000000-0000-4000-8000-000000000005';
const tables = [
  'public.user_profiles', 'public.user_permission_groups', 'public.permission_groups',
  'public.xero_financial_sync_runs', 'public.xero_financial_sync_items', 'public.hedge_invoices',
  'emailrouter.mailbox_connections', 'emailrouter.messages', 'emailrouter.mail_actions',
  'emailrouter.mail_action_destinations', 'emailrouter.advisor_learning_jobs',
  'emailrouter.advisor_learning_outcomes', 'emailrouter.advisor_learning_outcome_destinations',
];
async function snapshot(client) {
  const rows = {};
  for (const table of tables) rows[table] = (await client.query(`select to_jsonb(t) as value from ${table} t order by to_jsonb(t)::text`)).rows;
  return rows;
}

export async function seedUpgradeFixture(client) {
  await client.query(`
    insert into auth.users(id,email) values ('d0000000-0000-4000-8000-000000000010','upgrade-user@example.invalid');
    insert into public.user_profiles(id,email,full_name,user_type,active) values
      ('d0000000-0000-4000-8000-000000000010','upgrade-user@example.invalid','Upgrade fixture','viewer',true);
    insert into public.user_permission_groups(user_id,group_id) values ('d0000000-0000-4000-8000-000000000010','viewer');
    insert into public.hedge_invoices(legacy_source_id,invoice_number,counterparty,status,subtotal)
      values('release-upgrade-fixture','fixture-legacy-invoice','FCBS','Sent',123.45);
    insert into public.xero_financial_sync_runs(id,idempotency_key,mode,status,control_totals)
      values('d0000000-0000-4000-8000-000000000020','upgrade-preserved-run','preview','completed','{"verifiedTotal":123.45}');
    insert into public.xero_financial_sync_items(run_id,row_index,row_key,source_object,source_id,source_type,currency,source_total,proposed_action,status,idempotency_key,source_payload)
      values('d0000000-0000-4000-8000-000000000020',0,'upgrade-preserved-item','Invoice__c','fixture-invoice','buyer_invoice','USD',123.45,'link','linked','upgrade-preserved-item','{"sourceEvidence":"synthetic verified invoice"}');
    insert into public.email_sender_mailboxes(id,email_address,label) values('${mailbox}','upgrade-mailbox@example.invalid','Upgrade fixture');
    insert into emailrouter.mailbox_connections(id,sender_mailbox_id,provider_mailbox_id) values('${mailbox}','${mailbox}','fixture-mailbox');
    insert into emailrouter.messages(id,mailbox_id,provider_message_id,folder_key,state)
      values('d0000000-0000-4000-8000-000000000002','${mailbox}','fixture-message','inbox','routed');
    insert into emailrouter.destinations(id,destination_kind,user_profile_id,nickname) values
      ('d0000000-0000-4000-8000-000000000011','fcos_profile','d0000000-0000-4000-8000-000000000010','UpgradeTest');
    insert into emailrouter.mail_actions(id,message_id,action_type,state,confirmed_at,idempotency_key,request_fingerprint,post_action_mode,learning_state,learning_recipients_complete)
      values('${action}','d0000000-0000-4000-8000-000000000002','forward','confirmed',now(),'upgrade-learning-fixture',repeat('a',64),'keep_current','pending',true);
    insert into emailrouter.mail_action_destinations(mail_action_id,destination_id,recipient_kind,position)
      values('${action}','d0000000-0000-4000-8000-000000000011','to',1);
    insert into emailrouter.advisor_learning_outcomes(id,mail_action_id,mailbox_id,routing_category,action_type,post_action_mode,active,revision,disabled_reason,disabled_at)
      values('${outcome}','${action}','${mailbox}','invoice','forward','keep_current',false,2,'Previously forgotten fixture',now()-interval '1 day');
    -- Deliberately no outcome destination yet: legacy interruption after outcome insertion.
    insert into emailrouter.advisor_learning_jobs(id,mail_action_id,state,attempt_count,next_attempt_at,updated_at)
      values('${job}','${action}','processing',1,now()-interval '1 day',now()-interval '7 minutes');
  `);
  return snapshot(client);
}

export async function verifyUpgradeFixture(client, evidence) {
  assert.deepEqual(await snapshot(client), evidence, 'Pending migrations must preserve the populated Production baseline evidence.');
  assert.equal((await client.query(`select count(*)::int as count from public.hedge_invoices where legacy_source_id='release-upgrade-fixture'
    and settlement_basis='counterparty' and source_fingerprint is null and status='Sent' and subtotal=123.45`)).rows[0].count,
  1, 'Upgrade fixture preserves legacy FCBS invoice basis and amount');
  const rpcNames = ['claim_emailrouter_learning_job', 'finalize_emailrouter_learning_job'];
  assert.equal((await client.query(`select count(*)::int as count from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any($1::text[]) and not p.prosecdef
    and has_function_privilege('service_role',p.oid,'EXECUTE')
    and not has_function_privilege('anon',p.oid,'EXECUTE') and not has_function_privilege('authenticated',p.oid,'EXECUTE')`, [rpcNames])).rows[0].count, 2);
  assert.equal((await client.query(`select count(*)::int as count from pg_index i join pg_class c on c.oid=i.indexrelid
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='emailrouter'
    and c.relname='emailrouter_advisor_learning_jobs_processing_idx' and i.indisvalid`)).rows[0].count, 1);
  await assert.rejects(client.query(`update emailrouter.advisor_learning_jobs set attempt_count=-1 where id=$1`, [job]), error => error.code === '23514');
  await client.query('set role service_role');
  try {
    const claim = (await client.query('select public.claim_emailrouter_learning_job($1) as result', [mailbox])).rows[0].result;
    assert.equal(claim.id, job); assert.equal(claim.attempt_count, 2); assert.equal(claim.has_outcome, true);
    const finalized = (await client.query('select public.finalize_emailrouter_learning_job($1,$2,$3,null,null) as result', [job, claim.attempt_count, claim.updated_at])).rows[0].result;
    assert.equal(finalized, true, 'An interrupted baseline learning job can be recovered after upgrade.');
  } finally { await client.query('reset role'); }
  const saved = (await client.query('select state,attempt_count from emailrouter.advisor_learning_jobs where id=$1', [job])).rows[0];
  assert.deepEqual(saved, { state: 'completed', attempt_count: 2 });
  assert.deepEqual((await client.query('select to_jsonb(t) as value from emailrouter.advisor_learning_outcomes t order by to_jsonb(t)::text')).rows,
    evidence['emailrouter.advisor_learning_outcomes'], 'Recovery preserves the exact classification and forgotten status.');
  assert.equal((await client.query('select count(*)::int as count from emailrouter.advisor_learning_outcome_destinations where outcome_id=$1', [outcome])).rows[0].count, 1);
  assert.equal((await client.query('select learning_state from emailrouter.mail_actions where id=$1', [action])).rows[0].learning_state, 'completed');
}
