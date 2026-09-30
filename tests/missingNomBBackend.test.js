import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createMissingNomBGateway, resolveMissingNomBOwner, isNomBDocument, qualifiesMissingNomBInvoice, isMissingNomBInvoiceCandidate, isCancelledStem,
  missingNomBList, validateNomBUpload, missingNomBUpload, missingNomBEmail, runMissingNomBReminders, missingNomBStatus } from '../api/_missingNomB.js';
import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { resolveNomBTrader } from '../api/_dashboardNomBPolicy.js';
import { NOM_B_MAX_BYTES } from '../shared/missingNomB.js';
const org = fcosSalesforceEnvironment('production').orgId;
const stemId = 'a00000000000001AAA';
const nominationId = 'a01000000000001AAA';
const invoiceId = 'a02000000000001AAA';
const docId = '069000000000001AAA';
const profile = { id: randomUUID(),active: true,email: 'trader@cosulich.com.hk',full_name: 'Trader One',user_type: 'trader' };
const sfUser = { Id:'005000000000001AAA',Name:'Trader One',Email:profile.email,IsActive:true };
const activation = '2026-09-30T01:00:00.000Z';
const invoice = { Invoice_Date__c:'2026-09-30',Amount__c:'100.00',IsDeleted:false,Id:invoiceId,STEM__c:stemId,Name:'HK-I-1',CreatedDate:'2026-09-30T01:01:00.000Z',SystemModstamp:'2026-09-30T01:03:00.000Z',File__c:'https://example.invalid/file.pdf',Proforma__c:false,Deprecated__c:false,pdfSaved:true };
const nomination = { IsDeleted:false,File__c:null,PDF__c:null,Id:nominationId,STEM__c:stemId,Name:'Confirmation 1',RefCode__c:'CONF-1',Buyer_Supplier_Trader__c:sfUser.Name,BT_ST_Email_Address__c:sfUser.Email,Received__c:'🔴',Deprecated__c:false,Replaced__c:true,RecordType:{ DeveloperName:'Buyer' },LastModifiedDate:'2026-09-30T01:00:00.000Z' };
const fact = () => ({ stem:{ Id:stemId,Name:'HK123',RefCode__c:'HK123',IsDeleted:false,Account__r:{Name:'Buyer'},Vessel__r:{Name:'Vessel',IMO__c:'1234567'},Port__r:{Name:'Hong Kong'},Invoice_Status__c:'Invoiced',Status__c:'Active' },nomination:{...nomination},assignment:{status:'resolved',profile},documents:[],fingerprint:'fingerprint-1' });
const upload = () => ({ nominationId,operationId:randomUUID(),filename:'document.pdf',contentBase64:Buffer.from('%PDF-1.7\nNOM B').toString('base64') });
const verified = { stemId,nominationId,contentDocumentId:docId,contentVersionId:'068000000000001AAA',receivedStatus:'🟢',verified:true };
const invoiceDescription = { fields: ['Id','Name','Invoice_Date__c','STEM__c','CreatedDate','SystemModstamp','Proforma__c','Deprecated__c','File__c','IsDeleted','Amount__c'].map((name) => ({name,type: ['Proforma__c','Deprecated__c','IsDeleted'].includes(name) ? 'boolean' : 'string'})) };
const describedInvoice = async (path) => { assert.equal(path,'/sobjects/Invoice__c/describe/');return invoiceDescription; };
const linkedFile = (title = 'HK123 - NOM B') => ({LinkedEntityId:nominationId,ContentDocumentId:docId,ContentDocument:{Id:docId,IsDeleted:false,ContentSize:13,Title:title,FileExtension:'pdf',LatestPublishedVersionId:'068000000000001AAA'}});
function clientStub({ rpc: rpcImpl = async () => null, user = profile, tableResult } = {}) {
  return { rpc: async (key,args) => ({ data:await rpcImpl(key,args),error:null }),from(table) {
    let single = false; let count = false;
    const builder = { select(_s,opts) {count=opts?.head;return this;},eq(){return this;},in(){return this;},lt(){return this;},limit(){return this;},order(){return this;},range(){return this;},maybeSingle(){single=true;return this;},single(){single=true;return this;},then(resolve,reject) {
      return Promise.resolve(tableResult ? tableResult(table,{single,count}) : { data:single ? user : [user],error:null,count:0 }).then(resolve,reject);
    } }; return builder;
  } };
}
const context = (client) => ({ client,profile });
function uploadHarness({ mutation, facts, readback, reserve } = {}) {
  let posts = 0; let currentStatus = 'Reserved'; let result; let sourceHash; let savedToken; let written = false;
  const client = clientStub({rpc:async(key,args)=>{
    if(key==='missing_nom_b_reserve_upload') {
      if(sourceHash && sourceHash!==args.p_hash) throw Object.assign(new Error('MISSING_NOM_B_OPERATION_MISMATCH'),{code:'P0001'});
      sourceHash=args.p_hash;
      if(!savedToken) savedToken=args.p_token;
      return reserve ? reserve(args) : {status:currentStatus,acquired:currentStatus==='Reserved',claim_token:savedToken,result};
    }
    if(key==='missing_nom_b_upload_transition'){currentStatus=args.p_status;result=args.p_result||result;return true;}
    throw new Error(key);
  }});
  const gateway = { verify:async()=>org,byIds:async()=>[nomination],facts:async()=>facts ? facts({posts,written}) : [{...fact(),documents:written ? [{ContentDocumentId:docId}] : []}],
    readback:async()=>readback ? readback({posts,written}) : written ? verified : null,
    request:async(path,opts)=>{posts++; if(mutation) return mutation(opts,()=>{written=true;});written=true; assert.equal(path,'/composite');assert.equal(opts.retryOnExpiredSession,false); assert.equal(opts.body.allOrNone,true);assert.equal(opts.body.compositeRequest[0].body.FirstPublishLocationId,nominationId);assert.equal(opts.body.compositeRequest[1].body.Received__c,'🟢');return {compositeResponse:[{httpStatusCode:201},{httpStatusCode:204}]};}
  };
  return {client,gateway,get posts(){return posts;},get status(){return currentStatus;}};
}

test('invoice qualification is prospective, saved-PDF-only, and excludes all specified invoice kinds',()=>{
 assert.equal(qualifiesMissingNomBInvoice(invoice,activation),true);
 for(const change of [{CreatedDate:'2026-09-29T23:59:00Z'},{File__c:null},{Proforma__c:true},{Deprecated__c:true},{Name:'HK-CN-1'},{STEM__c:null},{CreatedDate:'bad'}]) assert.equal(qualifiesMissingNomBInvoice({...invoice,...change},activation),false);
 for(const s of [{Invoice_Status__c:'Cancelled'},{Status__c:'Canceled'},{Cancelled__c:true}]) assert.equal(isCancelledStem(s),true);
});
test('Production file rule requires live content, correct STEM marker and excludes generated outgoing documents',()=>{
 const stem=fact().stem;
 assert.equal(isNomBDocument({Received__c:'🟢',File__c:'file.pdf'},nomination,stem),false);
 assert.equal(isNomBDocument(linkedFile(),nomination,stem),true);
 for (const title of ['HK123 - CONF B','HK123 - NOM BAK','HK999 - NOM B','arbitrary NOM B']) assert.equal(isNomBDocument(linkedFile(title),nomination,stem),false);
 for (const change of [{IsDeleted:true},{ContentSize:0},{LatestPublishedVersionId:null},{Id:null}]) {
  const file=linkedFile();file.ContentDocument={...file.ContentDocument,...change};assert.equal(isNomBDocument(file,nomination,stem),false);
 }
 assert.equal(isNomBDocument(linkedFile(),{...nomination,File__c:`https://salesforce.invalid/${docId}`},stem),false);
 assert.equal(isNomBDocument(linkedFile(),{...nomination,PDF__c:`https://salesforce.invalid/068000000000001AAA`},stem),false);
 assert.equal(isNomBDocument(linkedFile('HK123 - old vessel - NOM B.pdf'),nomination,{...stem,Name:'HK123 - renamed vessel'}),true);
});
test('owner resolution shares Production policy and excludes wrong-email, ambiguous and inactive profiles',()=>{
 assert.equal(resolveMissingNomBOwner(nomination,[profile],[sfUser]).profile.id,profile.id);
 const scenarios=[
  [nomination,[profile],[sfUser,{...sfUser,Id:'005000000000002AAA',Email:'different@cosulich.com.hk'}]],
  [{...nomination,BT_ST_Email_Address__c:null},[profile],[{...sfUser,IsActive:false}]],
  [nomination,[{...profile,active:false}],[sfUser]],
  [nomination,[],[sfUser]],
  [nomination,[{...profile,email:'different@cosulich.com.hk'}],[sfUser]],
  [{...nomination,BT_ST_Email_Address__c:'buyer@external.example'},[profile],[sfUser]],
  [nomination,[profile,{...profile,id:randomUUID()}],[sfUser]],
 ];
 for (const [n,profiles,users] of scenarios) {
  assert.equal(resolveNomBTrader(n,profiles,users).resolved,false);
  assert.equal(resolveMissingNomBOwner(n,profiles,users).status,'UNRESOLVED_TRADER');
 }
});
test('confirmed Vu Huu Long and Pham Kim Thuy follow-ups use Long login, never shared correspondence mailbox',()=>{
 const long={...profile,id:randomUUID(),full_name:'Vu Huu Long',email:'long@cosulich.com.hk'};
 const shared={...profile,id:randomUUID(),full_name:'Vu Huu Long',email:'bunker@cosulich.com.hk'};
 for(const trader of ['Vu Huu Long','Pham Kim Thuy']) {
  const n={...nomination,Buyer_Supplier_Trader__c:trader,BT_ST_Email_Address__c:'bunker@cosulich.com.hk'};
  assert.equal(resolveMissingNomBOwner(n,[long,shared],[]).profile.id,long.id);
  assert.equal(resolveMissingNomBOwner(n,[shared],[]).status,'UNRESOLVED_TRADER');
  assert.equal(resolveMissingNomBOwner(n,[{...long,active:false},shared],[]).status,'UNRESOLVED_TRADER');
 }
 const n={...nomination,BT_ST_Email_Address__c:'bunker@cosulich.com.hk'};
 assert.equal(resolveMissingNomBOwner(n,[{...shared,full_name:profile.full_name}],[]).status,'UNRESOLVED_TRADER');
});
test('source verification uses canonical actual org and sandbox before business reads',async()=>{
 const gateway = createMissingNomBGateway({query:async()=>[{Id:org,IsSandbox:false}]});assert.equal(await gateway.verify(),org);
 for(const row of [{Id:'00D000000000001AAA',IsSandbox:false},{Id:org,IsSandbox:true}]) await assert.rejects(createMissingNomBGateway({query:async()=>[row]}).verify(),{code:'MISSING_NOM_B_ORG_MISMATCH'});
});
test('Salesforce query pagination consumes every page and refuses incomplete responses',async()=>{
 let n=0;const gateway=createMissingNomBGateway({sfRequest:async()=>++n===1 ? {records:[{Id:'a'}],done:false,nextRecordsUrl:'/services/data/v65.0/query/abc-2000'} : {records:[{Id:'b'}],done:true}});
 assert.equal((await gateway.query('SELECT Id FROM Account')).length,2);
 await assert.rejects(createMissingNomBGateway({sfRequest:async()=>({records:[],done:false})}).query('SELECT Id FROM Account'),{code:'MISSING_NOM_B_QUERY_INCOMPLETE'});
});
test('strict upload validation catches decoded sizes, base64 ambiguity, paths, unsupported types and magic mismatch',()=>{
 assert.equal(validateNomBUpload(upload()).ext,'pdf');
 const cases=[{filename:'../x.pdf'},{filename:'x.exe'},{contentBase64:'Y==='},{contentBase64:'YWJj '},{contentBase64:Buffer.from('not pdf').toString('base64')},{operationId:'bad'}, {contentBase64:Buffer.alloc(NOM_B_MAX_BYTES+1).toString('base64')}];
 for(const item of cases) assert.throws(()=>validateNomBUpload({...upload(),...item}));
 const max=Buffer.alloc(NOM_B_MAX_BYTES);max.write('%PDF-');assert.equal(validateNomBUpload({...upload(),contentBase64:max.toString('base64')}).size,NOM_B_MAX_BYTES);
});
test('list returns only own missing rows across all dates, permits green-without-file, and paginates',async()=>{
 const own=fact();own.nomination.Received__c='🟢';own.stem.Delivery_Date__c='2001-01-01';
 const other={...fact(),nomination:{...nomination,Id:'a01000000000002AAA'},assignment:{status:'resolved',profile:{...profile,id:randomUUID()}}};
 const client=clientStub();let calls=0;
 const gateway={verify:async()=>org,query:async(q)=>{assert.equal(q.includes('CreatedDate'),false);calls++;return calls===1 ? [{Id:nominationId,STEM__c:stemId},{Id:other.nomination.Id,STEM__c:stemId}] : [];},facts:async()=>[own,other]};
 const page=await missingNomBList({pageSize:1},context(client),{gateway});assert.equal(page.rows.length,1);assert.equal(page.rows[0].deliveryDate,'2001-01-01');assert.equal(page.rows[0].canUpload,true);assert.ok(page.nextCursor);
 const next=await missingNomBList({cursor:page.nextCursor},context(client),{gateway});assert.equal(next.nextCursor,null);
 const wrong=Buffer.from(JSON.stringify({last:nominationId,user:randomUUID(),search:'x'})).toString('base64url');
 await assert.rejects(missingNomBList({cursor:wrong},context(client),{gateway}),{code:'MISSING_NOM_B_CURSOR_INVALID'});
});
test('successful atomic upload has verified readback and exact successful replay does not POST again',async()=>{
 const h=uploadHarness();const body=upload();const result=await missingNomBUpload(body,context(h.client),{gateway:h.gateway});assert.deepEqual(result,verified);assert.equal(h.status,'Completed');
 assert.deepEqual(await missingNomBUpload(body,context(h.client),{gateway:h.gateway}),verified);assert.equal(h.posts,1);
 await assert.rejects(missingNomBUpload({...body,filename:'other.pdf'},context(h.client),{gateway:h.gateway}),/MISSING_NOM_B_OPERATION_MISMATCH/);
});
test('network-loss upload reconciles same marker without a second POST',async()=>{
 const h=uploadHarness({mutation:(_opts,mark)=>{mark();throw new Error('lost response');}});const body=upload();
 await assert.rejects(missingNomBUpload(body,context(h.client),{gateway:h.gateway}),{code:'MISSING_NOM_B_UPLOAD_UNCERTAIN'});assert.equal(h.status,'Uncertain');
 assert.deepEqual(await missingNomBUpload(body,context(h.client),{gateway:h.gateway}),verified);assert.equal(h.posts,1);
});
test('unknown upload outcome remains held, and confirmed composite rollback allows retry',async()=>{
 const unknown=uploadHarness({mutation:()=>{throw new Error('timeout');}});const body=upload();
 await assert.rejects(missingNomBUpload(body,context(unknown.client),{gateway:unknown.gateway}),{code:'MISSING_NOM_B_UPLOAD_UNCERTAIN'});
 await assert.rejects(missingNomBUpload(body,context(unknown.client),{gateway:unknown.gateway}),{code:'MISSING_NOM_B_UPLOAD_UNCERTAIN'});assert.equal(unknown.posts,1);
 const rejected=uploadHarness({mutation:async()=>({compositeResponse:[{httpStatusCode:400},{httpStatusCode:400}]})});
 await assert.rejects(missingNomBUpload(upload(),context(rejected.client),{gateway:rejected.gateway}),{code:'MISSING_NOM_B_COMPOSITE_ROLLED_BACK'});assert.equal(rejected.status,'Rejected');
});
test('uploads reject ownership drift, stale fingerprints, already-filed data and viewer/interoffice writes',async()=>{
 for(const reason of ['owner','fingerprint','file']) {
  let reads=0;const h=uploadHarness({facts:()=>{const f=fact();if(++reads>1){if(reason==='owner')f.assignment={status:'unresolved'};if(reason==='fingerprint')f.fingerprint='changed';if(reason==='file')f.documents=[{ContentDocumentId:docId}];}return [f];}});
  await assert.rejects(missingNomBUpload(upload(),context(h.client),{gateway:h.gateway}));assert.equal(h.posts,0);
 }
 for(const user_type of ['viewer','interoffice']) await assert.rejects(missingNomBUpload(upload(),context(clientStub({user:{...profile,user_type}})),{}),{code:'MISSING_NOM_B_UPLOAD_FORBIDDEN'});
});
test('concurrent Salesforce filing after POST is held instead of reporting success',async()=>{
 const h=uploadHarness({facts:({posts})=>[{...fact(),documents:posts ? [{ContentDocumentId:docId},{ContentDocumentId:'069000000000002AAA'}] : []}]});
 await assert.rejects(missingNomBUpload(upload(),context(h.client),{gateway:h.gateway}),{code:'MISSING_NOM_B_UPLOAD_UNCERTAIN'});assert.equal(h.status,'Uncertain');
});
function reminderHarness({send,checkpointFail=false,freshFact,initialInvoice=invoice}={}) {
 const ledger=new Map();let scan={activated_at:activation,cursor_at:activation,cursor_id:'',scan_until:'2026-09-30T02:00:00.000Z'};let current=initialInvoice;let sent=0;let reads=0;let discoveryVisible=true;
 const client=clientStub({rpc:async(key,args)=>{
  if(key==='missing_nom_b_claim_scan')return {...scan};
  if(key==='missing_nom_b_checkpoint') {if(checkpointFail)throw new Error('db outage');for(const d of args.p_discoveries)if(!ledger.has(d.stemId))ledger.set(d.stemId,{id:randomUUID(),stem_id:d.stemId,invoice_id:d.invoiceId,status:'Pending',attempts:0});scan={...scan,cursor_at:args.p_cursor_at,cursor_id:args.p_cursor_id};return scan;}
  if(key==='missing_nom_b_claim_reminders')return [...ledger.values()].filter(r=>['Pending','Blocked'].includes(r.status)).map(r=>Object.assign(r,{status:'Processing',claim_token:args.p_token,attempts:r.attempts+1}));
  const row=[...ledger.values()].find(r=>r.id===args.p_id);
  if(key==='missing_nom_b_begin_send'){row.status='Sending';return true;}
  if(key==='missing_nom_b_finish_reminder'){row.status=args.p_status;row.last_error_code=args.p_code;return true;}
  throw new Error(key);
 }});
 const gateway={verify:async()=>org,invoiceSelect:async()=>invoiceDescription.fields.map(f=>f.name).join(','),query:async()=>current && discoveryVisible ? [current] : [],verifyInvoicePdfs:async(rows)=>rows,invoicesForStems:async()=>current ? [current] : [],facts:async()=>{reads++;return freshFact ? freshFact(reads) : [fact()];}};
 const run=()=>runMissingNomBReminders({client,env:{VERCEL_ENV:'production',FCOS_ENABLE_MISSING_NOM_B_REMINDERS:'true'},gateway,resolveSender:async()=>({mailboxId:randomUUID(),emailAddress:'sender@cosulich.com.hk'}),sendMail:async(...args)=>{sent++;if(send)return send(...args);}});
 return {run,ledger,setInvoice:(v)=>{current=v;},hideFromScan:()=>{discoveryVisible=false;},restoreCheckpoint:()=>{checkpointFail=false;},get sent(){return sent;},get cursor(){return scan.cursor_at;}};
}
test('delayed saved PDF is picked up by modstamp and multiple invoices send only once per STEM',async()=>{
 const h=reminderHarness({initialInvoice:{...invoice,File__c:null}});assert.equal((await h.run()).sent,0);
 h.setInvoice({...invoice,SystemModstamp:'2026-09-30T02:10:00.000Z'});assert.equal((await h.run()).sent,1);
 h.setInvoice({...invoice,Id:'a02000000000002AAA'});assert.equal((await h.run()).sent,0);assert.equal(h.sent,1);
});
test('discovery outage never advances cursor or starts delivery',async()=>{
 const h=reminderHarness({checkpointFail:true});await assert.rejects(h.run(),/db outage/);assert.equal(h.cursor,activation);assert.equal(h.sent,0);
});
test('final file/ownership/eligibility recheck suppresses or blocks mail before send',async()=>{
 for(const mode of ['file','owner','cancel','race']) {
  const h=reminderHarness({freshFact:(reads)=>{const f=fact();if(reads>1){if(mode==='race' && reads>2) f.documents=[{ContentDocumentId:docId}];if(mode==='file')f.documents=[{ContentDocumentId:docId}];if(mode==='owner')f.assignment={status:'AMBIGUOUS_CONFIRMATION'};if(mode==='cancel')f.stem.Status__c='Cancelled';}return[f];}});
  const result=await h.run();assert.equal(h.sent,0);assert.equal(result.blocked+result.suppressed,1);
 }
});
test('unknown mail failure holds Uncertain; proven rejection is retryable Failed',async()=>{
 for(const uncertain of [true,false]) {
  const h=reminderHarness({send:()=>{throw Object.assign(new Error('failure'),uncertain ? {} : {mailDeliveryUncertain:false});}});
  const result=await h.run();assert.equal(result[uncertain?'uncertain':'failed'],1);assert.equal([...h.ledger.values()][0].status,uncertain?'Uncertain':'Failed');
 }
});
test('cron defaults disabled, preview cannot activate, and missing readiness cannot create state',async()=>{
 const client=clientStub({rpc:()=>{throw new Error('must not write');}});
 for(const env of [{},{VERCEL_ENV:'preview',FCOS_ENABLE_MISSING_NOM_B_REMINDERS:'true'},{VERCEL_ENV:'production',FCOS_ENABLE_MISSING_NOM_B_REMINDERS:'false'},{VERCEL_ENV:'production',FCOS_ENABLE_MISSING_NOM_B_REMINDERS:'true',FCOS_DISABLE_EMAIL_DELIVERY:'true'}]) assert.equal((await runMissingNomBReminders({client,env})).enabled,false);
 await assert.rejects(runMissingNomBReminders({client,env:{VERCEL_ENV:'production',FCOS_ENABLE_MISSING_NOM_B_REMINDERS:'true'},resolveSender:()=>{throw new Error('not ready');}}),/not ready/);
});
test('email contains approved detail and fixed login-safe link, no external cc or buyer address',()=>{
 const message=missingNomBEmail(fact(),invoice);assert.equal(message.to,profile.email);assert.equal(message.cc,undefined);assert.equal(message.subject,'Action required: missing Nom B — HK123');
 for(const text of ['as soon as possible','View and file all my missing Nom B','Invoice date: 2026-09-30','Buyer','Vessel','1234567','Hong Kong','CONF-1','HK-I-1','https://fcos.fcuno.com/missing-nom-b']) assert.ok(message.text.includes(text));
});
test('health exposes aggregates only',async()=>{
 const client=clientStub({tableResult:(table,{count})=>count ? {count:2,error:null} : {data:table==='missing_nom_b_scan_state'?{activated_at:activation,completed_through:activation,last_success_at:activation}:[{status:'Blocked',last_error_code:'UNRESOLVED_TRADER',updated_at:activation}],error:null}});
 const status=await missingNomBStatus({client,env:{},now:new Date(activation)});assert.equal(status.blocked,2);assert.equal(status.healthStatus,'warning');assert.equal(JSON.stringify(status).includes(profile.email),false);assert.equal(status.rows,undefined);
});

test('invoice PDF proof requires matching live linked document and a PDF latest version',async()=>{
 const doc='069000000000001AAA';const latest='068000000000001AAA';
 for(const [label,link,expected] of [
  ['valid',{LinkedEntityId:invoiceId,ContentDocumentId:doc,ContentDocument:{FileExtension:'pdf',LatestPublishedVersionId:latest}},true],
  ['wrong-document',{LinkedEntityId:invoiceId,ContentDocumentId:'069000000000002AAA',ContentDocument:{FileExtension:'pdf',LatestPublishedVersionId:latest}},false],
  ['not-pdf',{LinkedEntityId:invoiceId,ContentDocumentId:doc,ContentDocument:{FileExtension:'docx',LatestPublishedVersionId:latest}},false],
  ['no-version',{LinkedEntityId:invoiceId,ContentDocumentId:doc,ContentDocument:{FileExtension:'pdf'}},false],
  ['wrong-parent',{LinkedEntityId:nominationId,ContentDocumentId:doc,ContentDocument:{FileExtension:'pdf',LatestPublishedVersionId:latest}},false],
 ]) {
  const gateway=createMissingNomBGateway({sfRequest:describedInvoice,query:async()=>[{...link,ContentDocument:{Id:link.ContentDocumentId,IsDeleted:false,ContentSize:13,...link.ContentDocument}}]});const [verified]=await gateway.verifyInvoicePdfs([{...invoice,File__c:`https://example.invalid/${doc}`}]);
  assert.equal(verified.pdfSaved,expected,label);
 }
 const missing=createMissingNomBGateway({sfRequest:describedInvoice,query:async()=>[]});assert.equal((await missing.verifyInvoicePdfs([invoice]))[0].pdfSaved,false);
});

test('readback needs exact operation marker, bytes checksum, size, canonical link title and green status',async()=>{
 const file=validateNomBUpload(upload());const marker='FCOS:marker';
 const version={Id:'068000000000001AAA',ContentDocumentId:docId,Description:marker,Title:'HK123 - NOM B',Checksum:file.md5,ContentSize:file.size};
 const link={LinkedEntityId:nominationId,ContentDocumentId:docId,ContentDocument:{Id:docId,IsDeleted:false,ContentSize:file.size,Title:'HK123 - NOM B',LatestPublishedVersionId:version.Id}};
 for(const mode of ['valid','marker','checksum','size','title','status','duplicate','superseded']) {
  const gateway=createMissingNomBGateway({query:async(q)=>q.includes('FROM ContentDocumentLink') ? [{...link,ContentDocument:{Id:docId,IsDeleted:false,ContentSize:file.size,Title:mode==='title'?'other':version.Title,LatestPublishedVersionId:mode==='superseded'?'068000000000002AAA':version.Id}}]
   :q.includes('FROM ContentVersion') ? mode==='duplicate' ? [version,version] : [{...version,Description:mode==='marker'?'wrong':marker,Checksum:mode==='checksum'?'bad':file.md5,ContentSize:mode==='size'?1:file.size}]
    :q.includes('FROM STEM__c') ? [fact().stem] : [{...nomination,Received__c:mode==='status'?'🔴':'🟢'}]});
  const result=await gateway.readback(nominationId,marker,{title:version.Title,md5:file.md5,size:file.size});assert.equal(Boolean(result),mode==='valid',mode);
 }
});

test('facts blocks duplicate active confirmations even with the same trader and ignores replaced outgoing flag',async()=>{
 let duplicate=false;const gateway=createMissingNomBGateway({query:async(q)=>q.includes('FROM STEM__c')?[fact().stem]:q.includes('FROM Nomination__c') ? duplicate?[nomination,{...nomination,Id:'a01000000000002AAA'}]:[nomination]:q.includes('FROM User')?[sfUser]:[]});
 assert.equal((await gateway.facts([stemId],clientStub()))[0].nomination.Id,nominationId);
 duplicate=true;assert.equal((await gateway.facts([stemId],clientStub()))[0].assignment.status,'AMBIGUOUS_CONFIRMATION');
});

test('accepted mail followed by database acknowledgement failure is held, never retried as failed',async()=>{
 let status='Pending';let sendCount=0;const id=randomUUID(),token=randomUUID();
 const client=clientStub({rpc:async(key,args)=>{
  if(key==='missing_nom_b_claim_scan')return {activated_at:activation,cursor_at:activation,cursor_id:'',scan_until:'2026-09-30T02:00:00.000Z'};
  if(key==='missing_nom_b_checkpoint')return {activated_at:activation};
  if(key==='missing_nom_b_claim_reminders')return [{id,stem_id:stemId,invoice_id:invoiceId,claim_token:token}];
  if(key==='missing_nom_b_begin_send'){status='Sending';return true;}
  if(args.p_status==='Sent')throw new Error('acknowledgement database failure');status=args.p_status;return true;
 }});
 const gateway={verify:async()=>org,invoiceSelect:async()=>invoiceDescription.fields.map(f=>f.name).join(','),query:async()=>[],verifyInvoicePdfs:async()=>[],invoicesForStems:async()=>[invoice],facts:async()=>[fact()]};
 const result=await runMissingNomBReminders({client,env:{VERCEL_ENV:'production',FCOS_ENABLE_MISSING_NOM_B_REMINDERS:'true'},gateway,resolveSender:async()=>({mailboxId:randomUUID(),emailAddress:'sender@example.invalid'}),sendMail:async()=>{sendCount++;}});
 assert.equal(sendCount,1);assert.equal(status,'Uncertain');assert.equal(result.uncertain,1);
});

test('prospective candidate discovery keeps PDF-pending invoices but excludes credit/negative/historical/deprecated sources',()=>{
 assert.equal(isMissingNomBInvoiceCandidate({...invoice,File__c:null,pdfSaved:false},activation),true);
 for(const change of [{CreatedDate:'2020-01-01T00:00:00Z'},{Proforma__c:true},{Deprecated__c:true},{IsDeleted:true},{Amount__c:'-0.01'},{Amount__c:-150},{Amount__c:'not-an-amount'},{Is_Credit_Note__c:true},{Credit_Note__c:true},{CreditNote__c:true},{Name:'HK CREDIT NOTE 1'},{Name:'CN123'},{Name:'HK-CN-1'},{_nomBCreditFields:['Is_Credit_Note__c']}]) {
  assert.equal(isMissingNomBInvoiceCandidate({...invoice,...change},activation),false,JSON.stringify(change));
  assert.equal(qualifiesMissingNomBInvoice({...invoice,...change},activation),false,JSON.stringify(change));
 }
 assert.equal(qualifiesMissingNomBInvoice({...invoice,Amount__c:'0',Is_Credit_Note__c:false},activation),true);
});

test('invoice schema selects only available boolean credit flags and is cached for the workflow',async()=>{
 let descriptions=0;const seen=[];
 const fields=[...invoiceDescription.fields,{name:'Is_Credit_Note__c',type:'boolean'},{name:'Credit_Note__c',type:'reference'}];
 const gateway=createMissingNomBGateway({sfRequest:async(path)=>{descriptions++;assert.equal(path,'/sobjects/Invoice__c/describe/');return {fields};},query:async(q)=>{
  seen.push(q);return q.includes('FROM Invoice__c') ? [{...invoice,File__c:`https://example.invalid/${docId}`,Is_Credit_Note__c:false}] : [{...linkedFile(),LinkedEntityId:invoiceId}];
 }});
 const selected=(await gateway.invoiceSelect()).split(',');assert.ok(selected.includes('Amount__c'));assert.ok(selected.includes('Invoice_Date__c'));assert.ok(selected.includes('Is_Credit_Note__c'));assert.equal(selected.includes('Credit_Note__c'),false);assert.equal(selected.includes('CreditNote__c'),false);
 assert.equal(qualifiesMissingNomBInvoice((await gateway.invoicesForStems([stemId],activation))[0],activation),true);
 await gateway.invoiceSelect();assert.equal(descriptions,1);assert.ok(seen.some(q=>q.includes('ContentDocument.IsDeleted')&&q.includes('ContentDocument.ContentSize')&&q.includes('ContentDocument.Id')));
 const invalid=createMissingNomBGateway({sfRequest:async()=>({fields:fields.filter(f=>f.name!=='Proforma__c')})});
 await assert.rejects(invalid.invoiceSelect(),{code:'MISSING_NOM_B_INVOICE_SCHEMA_UNAVAILABLE'});
});

test('PDF completion beyond scan overlap is retried durably with unchanged invoice modstamp',async()=>{
 const h=reminderHarness({initialInvoice:{...invoice,Amount__c:null,File__c:null,pdfSaved:false}});
 const first=await h.run();assert.equal(first.discovered,1);assert.equal(first.sent,0);assert.equal([...h.ledger.values()][0].last_error_code,'PDF_PENDING');
 // The fixed scan window has advanced 57 minutes beyond this unchanged invoice.
 assert.ok(Date.parse(h.cursor)-Date.parse(invoice.SystemModstamp)>10*60*1000);
 h.hideFromScan();h.setInvoice({...invoice});
 const second=await h.run();assert.equal(second.discovered,0);assert.equal(second.sent,1);assert.equal(h.sent,1);
 await h.run();assert.equal(h.sent,1);
});

test('checkpoint failure recovers candidate without skipping it and old invoices never enter reminder ledger',async()=>{
 const h=reminderHarness({checkpointFail:true,initialInvoice:{...invoice,File__c:null,pdfSaved:false}});
 await assert.rejects(h.run(),/db outage/);assert.equal(h.ledger.size,0);assert.equal(h.cursor,activation);
 h.restoreCheckpoint();assert.equal((await h.run()).discovered,1);assert.equal([...h.ledger.values()][0].last_error_code,'PDF_PENDING');assert.equal(h.sent,0);
 const historical=reminderHarness({initialInvoice:{...invoice,CreatedDate:'2020-01-01T00:00:00Z'}});await historical.run();assert.equal(historical.ledger.size,0);assert.equal(historical.sent,0);
});

test('email uses actual invoice date and labels created-date fallback explicitly',()=>{
 assert.ok(missingNomBEmail(fact(),invoice).text.includes('Invoice date: 2026-09-30'));
 const fallback=missingNomBEmail(fact(),{...invoice,Invoice_Date__c:null}).text;
 assert.ok(fallback.includes(`Invoice created: ${invoice.CreatedDate}`));assert.equal(fallback.includes('Invoice date:'),false);
 assert.ok(fallback.includes('View and file all my missing Nom B\nhttps://fcos.fcuno.com/missing-nom-b'));
});

test('formula email cannot resolve explicitly inactive or duplicate nonoverride Salesforce identities',()=>{
 const inactive={...sfUser,IsActive:false};
 // The shared dashboard policy permits formula fallback; this send/upload boundary is stricter.
 assert.equal(resolveNomBTrader(nomination,[profile],[inactive]).resolved,true);
 assert.equal(resolveMissingNomBOwner(nomination,[profile],[inactive]).status,'UNRESOLVED_TRADER');
 assert.equal(resolveMissingNomBOwner(nomination,[profile],[sfUser,{...inactive,Id:'005000000000002AAA'}]).status,'UNRESOLVED_TRADER');
 assert.equal(resolveMissingNomBOwner(nomination,[profile],[sfUser,{...sfUser,Id:'005000000000002AAA'}]).status,'UNRESOLVED_TRADER');
 const long={...profile,id:randomUUID(),email:'long@cosulich.com.hk',full_name:'Vu Huu Long'};
 for(const traderName of ['Vu Huu Long','Pham Kim Thuy']) {
  const n={...nomination,Buyer_Supplier_Trader__c:traderName,BT_ST_Email_Address__c:'bunker@cosulich.com.hk'};
  const historicalUser={...inactive,Name:traderName};
  assert.equal(resolveMissingNomBOwner(n,[long],[historicalUser,{...historicalUser,Id:'005000000000002AAA'}]).profile.id,long.id);
 }
});

test('initial null invoice amount remains a candidate but never qualifies for sending until valid amount is saved',()=>{
 for(const amount of [null,'',undefined]) {
  const pending={...invoice,Amount__c:amount};assert.equal(isMissingNomBInvoiceCandidate(pending,activation),true);assert.equal(qualifiesMissingNomBInvoice(pending,activation),false);
 }
 const missing={...invoice,_nomBAmountAvailable:true};delete missing.Amount__c;
 assert.equal(isMissingNomBInvoiceCandidate(missing,activation),true);assert.equal(qualifiesMissingNomBInvoice(missing,activation),false);
 assert.equal(qualifiesMissingNomBInvoice({...missing,Amount__c:'0.00'},activation),true);
 assert.equal(qualifiesMissingNomBInvoice({...missing,Amount__c:'-0.01'},activation),false);
 assert.equal(isMissingNomBInvoiceCandidate({...invoice,Amount__c:null,_nomBCreditFields:['Is_Credit_Note__c']},activation),false);
 assert.equal(isMissingNomBInvoiceCandidate({...invoice,Amount__c:null,Is_Credit_Note__c:null},activation),false);
});


test('pre-PDF candidates remain retryable when Nom B filing or cancellation changes before PDF completion',async()=>{
 for(const mode of ['file','cancel']) {
  let beforePdf=true;
  const h=reminderHarness({initialInvoice:{...invoice,File__c:null,pdfSaved:false},freshFact:()=>{
   const f=fact();if(beforePdf){if(mode==='file')f.documents=[{ContentDocumentId:docId}];else f.stem.Invoice_Status__c='Cancelled';}return[f];
  }});
  await h.run();assert.equal([...h.ledger.values()][0].status,'Blocked');assert.equal([...h.ledger.values()][0].last_error_code,'PDF_PENDING');
  beforePdf=false;h.hideFromScan();h.setInvoice({...invoice});
  assert.equal((await h.run()).sent,1);assert.equal(h.sent,1);
 }
});


test('filing title and reminder reference use the stable STEM code when its display name differs',async()=>{
 const f=fact();f.stem.Name='HK123 - Vessel display label';let body;
 const h=uploadHarness({facts:({written})=>[{...f,documents:written?[{ContentDocumentId:docId}]:[]}],mutation:(opts,mark)=>{body=opts.body;mark();return {compositeResponse:[{httpStatusCode:201},{httpStatusCode:204}]};}});
 await missingNomBUpload(upload(),context(h.client),{gateway:h.gateway});
 assert.equal(body.compositeRequest[0].body.Title,'HK123 - NOM B');assert.equal(body.compositeRequest[0].body.PathOnClient,'HK123 - NOM B.pdf');
 assert.equal(missingNomBEmail(f,invoice).subject,'Action required: missing Nom B — HK123');
 assert.ok(missingNomBEmail(f,invoice).text.includes('STEM: HK123'));
});
