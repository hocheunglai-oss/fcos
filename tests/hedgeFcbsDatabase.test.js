import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { fcbsReviewFromEvidence } from '../api/_hedgeFcbsSettlement.js';
import { mopsMonthInputFingerprint } from '../api/_hedgeMops.js';
import { finalMopsMonthlyAverages, mopsMonthFinality } from '../src/hedge/lib/domain.js';

const migration = (name) => readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');
const actor = randomUUID();
const swapId = randomUUID();

test('FCBS migration executes in PostgreSQL with atomic saves, immutable history and service-only access', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.user_profiles(id uuid primary key);
    create schema extensions;
    create function extensions.digest(text,text) returns bytea language sql immutable as $$select sha256(convert_to($1,'UTF8'))$$;
    grant usage on schema public,extensions to service_role;`);
  const base = await migration('20260801191655_native_hedge_desk_graph_mail');
  // Reuse the actual deployed table definitions, not hand-written financial schemas.
  const tables = [...base.matchAll(/create table if not exists public\.(hedge_\w+) \([\s\S]*?\n\);/g)];
  for (const [statement] of tables) await db.exec(statement);
  const touch = base.match(/create or replace function public\.hedge_touch_revision\(\)[\s\S]*?\$\$;/)[0];
  await db.exec(touch);
  for (const [, table] of tables) {
    await db.exec(`alter table public.${table} enable row level security; revoke all on public.${table} from public,anon,authenticated; grant all on public.${table} to service_role;`);
  }
  for (const table of ['hedge_invoices','hedge_swap_hedges','hedge_settings','hedge_market_prices','hedge_counterparties']) {
    await db.exec(`create trigger ${table}_touch_revision before update on public.${table} for each row execute function public.hedge_touch_revision();`);
  }
  await db.exec(await migration('20260802113000_hedge_monthly_mops_verification'));
  await db.exec(await migration('20260902080713_add_internal_fcbhk_counterparty'));
  await db.query('insert into user_profiles values($1)', [actor]);
  const legacyId = randomUUID();
  await db.query("insert into hedge_invoices(id,invoice_number,counterparty,subtotal,status) values($1,'OLD-CUSTOMER','FCBS',-123.45,'Sent')", [legacyId]);
  const legacyBefore = (await db.query('select to_jsonb(i) data from hedge_invoices i where id=$1', [legacyId])).rows[0].data;
  await db.exec(await migration('20260908074607_fcbs_own_account_settlement'));

  await t.test('compatibility keeps historical customer documents unchanged', async () => {
    const row = (await db.query("select to_jsonb(i)-'settlement_basis'-'source_fingerprint' data,settlement_basis from hedge_invoices i where id=$1", [legacyId])).rows[0];
    assert.deepEqual(row.data, legacyBefore);
    assert.equal(row.settlement_basis, 'counterparty');
  });

  await db.exec('set role service_role');
  await db.query("insert into hedge_counterparties(short_name,full_name,settlement_mode) values('FCBS','FRATELLI COSULICH BUNKERS (S) PTE LTD','external')");
  await db.query("insert into hedge_settings(key,value) values('rates',$1),('general',$2)", [
    { fcbs_venue_mt: 0.5, fcbs_venue_bbl: 0.03, fcbs_cp_recv_mt: 100 }, { sgo_bbl_per_mt: 7.45, invoice_prefix: 'TEST' },
  ]);
  await db.query("insert into hedge_swap_hedges(id,trade_date,product,direction,swap_month,quantity,unit,price,venue,counterparty,pricing_basis,trade_type,is_expired) values($1,'2026-08-04','S0.5','BUY','2026-08',170,'MT',733,'FCBS','FCBHK','WMA','STANDARD',true)", [swapId]);
  const mops = mopsMonthFinality('2026-08', [], new Date('2026-09-08')).missingDates.map((date) => ({
    id: randomUUID(), price_date: date, s380: 575, s05: 736.001, sgo: 156, is_estimate: false,
  }));
  for (const row of mops) await db.query('insert into hedge_market_prices(id,price_date,s380,s05,sgo,is_estimate) values($1,$2,$3,$4,$5,false)', [row.id,row.price_date,row.s380,row.s05,row.sgo]);
  const averages = finalMopsMonthlyAverages('2026-08', mops);
  await db.query("insert into hedge_mops_month_verifications(contract_month,calculated_snapshot,source_snapshot,input_fingerprint,source_message_hash,verified_by_email) values('2026-08',$1,'{}',$2,$3,'test@example.invalid')", [
    { ...averages, contract_month: '2026-08', publication_days: averages.publicationDays }, mopsMonthInputFingerprint('2026-08',mops), '0'.repeat(64),
  ]);
  const evidence = async () => (await db.query("select hedge_fcbs_settlement_evidence('2026-08') data")).rows[0].data;
  const first = await evidence();
  const review = fcbsReviewFromEvidence(first, { settlementMonth:'2026-08',swapIds:[swapId],invoiceNumber:'TEST-FCBS-1',invoiceDate:'2026-09-08' }, { now:new Date('2026-09-08') });
  assert.equal(review.netAmount, 425.17);
  const payload = {invoice_number:review.invoiceNumber,issue_date:review.invoiceDate,settlement_month:review.settlementMonth,invoice_type:'Debit Note',subtotal:review.netAmount,status:'Draft',pdf_payload:review};
  const save = async ({id=null,revision=null,key=randomUUID(),fingerprint=first.source_fingerprint,body=payload,requestHash='1'.repeat(64)}={}) => (await db.query(
    'select save_hedge_fcbs_settlement($1,$2,$3,$4,$5,$6,$7,$8) data', [id,revision,key,requestHash,fingerprint,body,actor,'test@example.invalid'],
  )).rows[0].data;
  let saved;
  await t.test('save and retry create exactly one invoice, line and hedge link', async () => {
    const key=randomUUID(); saved=await save({key});
    assert.equal(saved.replayed,false);
    assert.deepEqual(await save({key}),{...saved,replayed:true});
    assert.equal((await db.query('select count(*)::int n from hedge_invoice_lines where invoice_id=$1',[saved.invoice_id])).rows[0].n,1);
    assert.equal((await db.query('select subtotal from hedge_invoices where id=$1',[saved.invoice_id])).rows[0].subtotal,'425.17');
    await assert.rejects(save({key,requestHash:'2'.repeat(64)}),/HEDGE_FCBS_IDEMPOTENCY_CONFLICT/);
    await assert.rejects(save(),/hedge_fcbs_one_active_month|HEDGE_FCBS_NUMBER_CONFLICT/);
  });
  await t.test('stale source or revision fails and failed line save rolls everything back', async () => {
    await assert.rejects(save({id:saved.invoice_id,revision:99}),/REVISION_CONFLICT/);
    await assert.rejects(save({id:saved.invoice_id,revision:1,fingerprint:'f'.repeat(64)}),/HEDGE_FCBS_SOURCE_CHANGED/);
    const bad=structuredClone(payload);bad.pdf_payload.lineItems[0].swapId=randomUUID();
    await assert.rejects(save({id:saved.invoice_id,revision:1,body:bad}),/HEDGE_FCBS_SCOPE_INVALID/);
    assert.equal((await db.query('select revision::int n from hedge_invoices where id=$1',[saved.invoice_id])).rows[0].n,1);
    assert.equal((await db.query('select count(*)::int n from hedge_invoice_lines where invoice_id=$1',[saved.invoice_id])).rows[0].n,1);
  });
  await t.test('database rejects self invoices, mixed venues and basis/recipient reassignment', async () => {
    await assert.rejects(db.query("insert into hedge_invoices(counterparty) values('FCBHK')"),/HEDGE_INTERNAL_SETTLEMENT_DOCUMENT_BLOCKED/);
    await assert.rejects(db.query("update hedge_invoices set counterparty='OTHER' where id=$1",[saved.invoice_id]),/HEDGE_FCBS_DOCUMENT_INVALID/);
    await assert.rejects(db.query("update hedge_invoices set settlement_basis='counterparty' where id=$1",[saved.invoice_id]),/HEDGE_INTERNAL_SETTLEMENT_DOCUMENT_BLOCKED/);
    await assert.rejects(db.query("update hedge_swap_hedges set venue='ICE' where id=$1",[swapId]),/HEDGE_FCBS_LINK_IDENTITY_LOCKED/);
    await assert.rejects(db.query('update hedge_invoice_swaps set invoice_id=$1 where invoice_id=$2',[legacyId,saved.invoice_id]),/HEDGE_INTERNAL_SETTLEMENT_DOCUMENT_BLOCKED/);
    await assert.rejects(db.query('update hedge_invoice_lines set invoice_id=$1 where invoice_id=$2',[legacyId,saved.invoice_id]),/HEDGE_FCBS_LINES_INVALID/);
  });
  await t.test('in-flight or uncertain delivery freezes draft financial values and child rows', async () => {
    const operationId=randomUUID();
    await db.query("insert into hedge_integration_operations(id,idempotency_key,operation,request_hash,status,response,actor_email) values($1,$2,'hedge_invoice_email','test','processing',$3,'test@example.invalid')",
      [operationId,randomUUID(),{invoiceId:saved.invoice_id}]);
    for(const status of ['processing','uncertain']) {
      await db.query('update hedge_integration_operations set status=$1 where id=$2',[status,operationId]);
      await assert.rejects(db.query('update hedge_invoices set subtotal=426 where id=$1',[saved.invoice_id]),/HEDGE_FCBS_ISSUED_IMMUTABLE/);
      await assert.rejects(db.query('delete from hedge_invoice_lines where invoice_id=$1',[saved.invoice_id]),/HEDGE_FCBS_ISSUED_IMMUTABLE/);
    }
    await db.query("update hedge_integration_operations set status='failed' where id=$1",[operationId]);
  });
  await t.test('approved drafts become immutable when issued, including child insert paths', async () => {
    const next=await save({id:saved.invoice_id,revision:1});assert.equal(next.invoice_id,saved.invoice_id);
    const changeStatus = (revision,status) => db.query('select set_hedge_fcbs_settlement_status($1,$2,$3,$4,$5)',[saved.invoice_id,revision,status,actor,'test@example.invalid']);
    await assert.rejects(changeStatus(2,'Settled'),/HEDGE_FCBS_SAVED_PDF_REQUIRED/);
    await assert.rejects(changeStatus(2,'Sent'),/HEDGE_FCBS_SAVED_PDF_REQUIRED/);
    await db.query("update hedge_invoices set pdf_data_url='supabase://hedge-documents/synthetic-test.pdf' where id=$1",[saved.invoice_id]);
    await assert.rejects(changeStatus(1,'Sent'),/REVISION_CONFLICT/);
    await changeStatus(3,'Sent');
    await changeStatus(4,'Settled');
    await assert.rejects(changeStatus(5,'Draft'),/HEDGE_FCBS_STATUS_INVALID/);
    await assert.rejects(save({id:saved.invoice_id,revision:5}),/HEDGE_FCBS_ISSUED_IMMUTABLE/);
    await assert.rejects(db.query('update hedge_invoices set subtotal=0 where id=$1',[saved.invoice_id]),/HEDGE_FCBS_ISSUED_IMMUTABLE/);
    await assert.rejects(db.query('delete from hedge_invoice_lines where invoice_id=$1',[saved.invoice_id]),/HEDGE_FCBS_ISSUED_IMMUTABLE/);
    await assert.rejects(db.query('insert into hedge_invoice_lines(invoice_id,line_order,net_value) values($1,1,0)',[saved.invoice_id]),/HEDGE_FCBS_ISSUED_IMMUTABLE/);
    await assert.rejects(db.query('delete from hedge_invoices where id=$1',[saved.invoice_id]),/HEDGE_FCBS_ISSUED_IMMUTABLE/);
    // Market correction remains possible but does not rewrite an issued document.
    await db.query('update hedge_swap_hedges set price=734 where id=$1',[swapId]);
    assert.notEqual((await evidence()).source_fingerprint,first.source_fingerprint);
    assert.equal((await db.query('select subtotal from hedge_invoices where id=$1',[saved.invoice_id])).rows[0].subtotal,'425.17');
  });
  await t.test('RLS, invoker execution and redacted audit metadata', async () => {
    const audit=(await db.query("select before_data,after_data,metadata from hedge_events where event_type in ('fcbs_settlement_created','fcbs_settlement_reviewed')")).rows;
    assert.equal(audit.length,2);
    for(const row of audit){assert.equal(row.before_data,null);assert.equal(row.after_data,null);assert.deepEqual(Object.keys(row.metadata).sort(),['basis','hedge_count','outcome','source_fingerprint']);}
    for(const role of ['anon','authenticated']) {
      await db.exec(`reset role; set role ${role}`);
      await assert.rejects(db.query("select hedge_fcbs_settlement_evidence('2026-08')"),/permission denied/);
      await assert.rejects(db.query("select set_hedge_fcbs_settlement_status(null,null,'Sent',null,null)"),/permission denied/);
      await assert.rejects(db.query('select * from hedge_fcbs_settlement_operations'),/permission denied/);
    }
    await db.exec('reset role');
    assert.equal((await db.query("select bool_or(prosecdef) unsafe from pg_proc where proname in ('hedge_fcbs_settlement_evidence','save_hedge_fcbs_settlement')")).rows[0].unsafe,false);
  });
});
