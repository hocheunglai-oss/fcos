import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {TLSSocket} from 'node:tls';
import {PGlite} from '@electric-sql/pglite';
import {fcosConnectionIdentifier as id} from '../config/fcosConnections.js';
import {openPinnedReadonlyDatabase,isNativeReadonlyConnection,assertReadonlyDatabaseIdentity,readonlyRoleProvisioningSql,installReadonlyHandoverPolicy} from '../scripts/lib/rapid-release/readonly-database.mjs';
import {PUBLIC_CA} from './helpers/rapidDatabaseDelegationFixture.mjs';
const verifier='SCRAM-SHA-256$4096:c2FsdA==$c3RvcmVk:a2V5';
const url=`postgresql://${id('supabase','Database release read-only user')}:${'x'.repeat(48)}@${id('supabase','Database session host')}:5432/postgres`;
async function setup(t) {
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create schema fcos_release_coordination;
 create table fcos_release_coordination.control(singleton boolean,mode text,epoch int,operation_id text,bootstrap_id text,recovery_id text,source_upgrade_id text,plan_completion_id text);
 insert into fcos_release_coordination.control values(true,'frozen',1,null,null,null,null,null);
 create table fcos_release_coordination.operations(operation_id text,phase text,financial_evidence jsonb);
 create table fcos_release_coordination.operation_events(operation_id text,event_id int,state text,financial_evidence jsonb);
 create table fcos_release_coordination.rapid_bootstrap_receipts(receipt_id int,evidence jsonb);
 alter table fcos_release_coordination.control enable row level security;
 alter table fcos_release_coordination.operations enable row level security;
 alter table fcos_release_coordination.operation_events enable row level security;
 alter table fcos_release_coordination.rapid_bootstrap_receipts enable row level security;
 create table public.business_finance(id int,amount numeric);
 insert into fcos_release_coordination.operations values('old-operation','production.stage','{"private":true}');`);
 await db.exec(readonlyRoleProvisioningSql(verifier));
 return db;
}
test('dedicated role grants only coordinator metadata reads and keeps financial columns and writes denied',async t=>{
 const db=await setup(t);
 await db.exec('create table fcos_release_coordination.rapid_handover_receipts(receipt_id int,evidence jsonb);alter table fcos_release_coordination.rapid_handover_receipts enable row level security;');
 await installReadonlyHandoverPolicy(db);
 await db.exec(`set session authorization ${id('supabase','Database release read-only role')}`);
 assert.equal((await db.query('select operation_id,phase from fcos_release_coordination.operations')).rows.length,1);
 assert.equal((await db.query('select * from fcos_release_coordination.rapid_handover_receipts')).rows.length,0);
 for(const sql of ['select financial_evidence from fcos_release_coordination.operations','update fcos_release_coordination.control set mode=\'qualification\'','insert into public.business_finance values(1,100)','select * from public.business_finance'])await assert.rejects(db.query(sql),/permission denied/);
});
test('actual native role and TLS socket qualify; JSON and writable-role drift never do',async t=>{
 const native=await setup(t),host=id('supabase','Database session host');
 await native.exec(`set session authorization ${id('supabase','Database release read-only role')}`);
 class Client extends EventEmitter {
  constructor(config){super();this.config=config;const stream=new TLSSocket();stream.authorized=true;stream.servername=host;this.connection={stream};}
  async connect(){} async query(sql,params){return native.query(sql,params);} async end(){this._ending=true;this.connection.stream.destroy();this.emit('end');}
 }
 const opened=await openPinnedReadonlyDatabase({url,caFile:'/dummy/public-ca',deps:{Client,readFile:()=>Buffer.from(PUBLIC_CA)}});
 assert.equal(isNativeReadonlyConnection(opened.connection),true);
 await opened.db.query('BEGIN READ ONLY');
 const row=(await native.query("select session_user,current_user,current_database() as database,current_setting('transaction_read_only') as read_only")).rows[0];
 assert.equal(assertReadonlyDatabaseIdentity(row,opened.connection),row);
 assert.throws(()=>assertReadonlyDatabaseIdentity(row,{...opened.connection}),/IDENTITY_REQUIRED/);
 assert.throws(()=>assertReadonlyDatabaseIdentity(row,opened.connection,{readOnly:false}),/IDENTITY_REQUIRED/);
 await opened.db.query('ROLLBACK');await opened.db.end();assert.equal(isNativeReadonlyConnection(opened.connection),false);
});
test('wrong project, pooling mode and arbitrary SCRAM input refuse before any provider or credential use',async()=>{
 for(const changed of [url.replace(':5432',':6543'),url.replace('pjforfvchygdyqfcgpmw','differentproject'),`${url}?sslmode=require`])await assert.rejects(openPinnedReadonlyDatabase({url:changed,caFile:'/missing'}),/URL_REQUIRED/);
 assert.throws(()=>readonlyRoleProvisioningSql("secret';grant postgres to public;--"),/SCRAM_REQUIRED/);
});
