import assert from 'node:assert/strict';
import test from 'node:test';
import { FCOS_CONNECTION_POLICY, fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { createPrivateEnrollment, assertEnrollmentMetadata, signEnrollmentReceipt, verifyEnrollmentReceipt,
  collectEnrolledPreviewAuthority, enrolledAuthorityGet, enrolledAuthorityContext, ENROLLED_AUTHORITY_MAX_AGE_MS } from '../scripts/lib/preview-vercel-enrollment.mjs';

// Public RFC8032 test vector. No operational key is generated, retrieved or used.
const testPrivate = `-----BEGIN PRIVATE KEY-----\n${Buffer.from('302e020100300506032b6570042204209d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60','hex').toString('base64')}\n-----END PRIVATE KEY-----`;
const testPublic = Buffer.from('302a300506032b6570032100d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a','hex').toString('base64');
const now = Date.parse('2026-10-03T04:00:00Z');
const token = 'vcp_TEST_ONLY_PRIVATE_MARKER';
const teamId = fcosConnectionIdentifier('vercel','Team ID'), projectId = fcosConnectionIdentifier('vercel','Project ID');
const enrollmentId = '11111111-1111-4111-8111-111111111111';
const metadata = {id:'test-issued-token-id',type:'token',prefix:'vcp_',projectId,createdAt:now-1000,expiresAt:now+3600000,scopes:[{type:'team',teamId}]};
const context = enrolledAuthorityContext({repositoryId:7,environmentId:8,runId:9,harnessSha:'a'.repeat(40),controlRevision:'b'.repeat(64),contractSha256:'c'.repeat(64),candidateSha:'d'.repeat(40),operation:'verify-authority'});
const project = {id:projectId,accountId:teamId,name:'fcos',autoAssignCustomDomains:false,link:{type:'github',org:'hocheunglai-oss',repo:'fcos',productionBranch:'main',deployHooks:[]}};
const list = {projects:[project],pagination:{count:1,next:null,prev:now}};
function fixture() {
 const privateEnrollment = createPrivateEnrollment({issuance:{bearerToken:token,token:{id:metadata.id}},metadata,enrollmentId,requestedExpiresAt:metadata.expiresAt,now});
 const envelope = signEnrollmentReceipt({privateEnrollment,metadata,context,privateKey:testPrivate,now});
 return {privateEnrollment,envelope,token,reviewedTokenId:metadata.id,enrollmentId,context,now,publicKeySpkiBase64:testPublic};
}
function network(replacements={}) {
 const calls=[];
 const fetchImpl=async(url,request)=>{
  calls.push({url,request}); const path=new URL(url).pathname+new URL(url).search;
  let body,status=200;
  if(path==='/v9/projects?limit=100')body=structuredClone(list);
  else if(path==='/v2/user'){status=404;body={error:{code:'not_found',message:token}};}
  else if(path===`/v2/teams/${teamId}`){status=403;body={error:{code:'forbidden',message:token}};}
  else if(path===`/v9/projects/${projectId}?teamId=${teamId}`)body=project;
  else assert.fail('unexpected path');
  if(replacements[path])({body,status}=replacements[path]);
  return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
 };
 return {calls,fetchImpl};
}
test('issuance pair plus exact independent metadata creates private binding; public receipt omits it',()=>{
 const value=fixture();assert.equal(value.privateEnrollment.enrollment.tokenId,metadata.id);
 const result=verifyEnrollmentReceipt(value);assert.equal(result.credentialBindingVerified,true);
 assert.ok(!JSON.stringify(value.envelope).includes(value.privateEnrollment.binding));assert.ok(!JSON.stringify(value.envelope).includes(token));
 assert.ok(!JSON.stringify(result).includes(value.privateEnrollment.binding));
});
for(const [name,mutate] of [
 ['different runtime PAT',x=>x.token='vcp_WRONG_TOKEN'],['different companion',x=>x.privateEnrollment.binding=Buffer.alloc(32).toString('base64url')],
 ['wrong metadata ID',x=>x.reviewedTokenId='other'],['changed enrollment',x=>x.enrollmentId='22222222-2222-4222-8222-222222222222'],
 ['wrong signature',x=>x.envelope.signature=Buffer.alloc(64).toString('base64url')],['unpinned production public key',x=>x.publicKeySpkiBase64=FCOS_CONNECTION_POLICY.attestation.publicKeySpkiBase64],
 ['expired receipt',x=>x.now=now+ENROLLED_AUTHORITY_MAX_AGE_MS+1],['future receipt',x=>x.now=now-31000],
 ['different run',x=>x.context={...context,runId:10}],['rerun attempt',x=>x.context={...context,runAttempt:2}],
 ['different source',x=>x.context={...context,harnessSha:'e'.repeat(40)}],['different controls',x=>x.context={...context,controlRevision:'e'.repeat(64)}],
 ['different candidate',x=>x.context={...context,candidateSha:'e'.repeat(40)}],['different environment',x=>x.context={...context,environmentId:10}],
 ['different operation',x=>x.context={...context,operation:'create'}],['signed claim tamper',x=>x.envelope.receipt.leaked=true],
 ['overlarge private secret',x=>x.privateEnrollment=' '.repeat(4097)],['overlarge public envelope',x=>x.envelope=' '.repeat(16385)],
])test(name+' fails closed without private diagnostics',()=>{const value=fixture();mutate(value);assert.throws(()=>verifyEnrollmentReceipt(value),error=>error.message==='Enrolled Preview authority failed; private evidence suppressed.');});
test('no arbitrary old bearer enrollment through unrelated metadata or expiry',()=>{
 for(const changed of [{id:'different'}, {projectId:'other'}, {expiresAt:now+25*3600000}, {revokedAt:now}, {leakedAt:now}, {scopes:[{type:'user'}]}]){
  assert.throws(()=>createPrivateEnrollment({issuance:{bearerToken:token,token:{id:metadata.id}},metadata:{...metadata,...changed},enrollmentId,requestedExpiresAt:metadata.expiresAt,now}));
 }
 assert.throws(()=>assertEnrollmentMetadata(metadata,{...fixture().privateEnrollment.enrollment,createdAt:now-2000},now));
});
test('four fixed GETs and signed binding accept bounded prev timestamp without granting Preview permission',async()=>{
 const value=fixture(), net=network(); const result=await collectEnrolledPreviewAuthority({...value,now:()=>now,verifyOnly:true,fetchImpl:net.fetchImpl,deploymentConfiguration:{git:{deploymentEnabled:{main:false}}}});
 assert.equal(result.report.authorityVerified,true);assert.equal(result.report.previewAuthorized,false);assert.equal(result.report.productionAuthorized,false);assert.equal(net.calls.length,4);
 assert.ok(net.calls.every(({request})=>request.method==='GET'&&request.redirect==='error'&&request.body===undefined));
 assert.ok(!JSON.stringify(result.report).includes(token));assert.ok(!JSON.stringify(result.report).includes(value.privateEnrollment.binding));
});
for(const [name,body] of [['bare array',[project]],['missing pagination',{projects:[project]}],['missing next',{projects:[project],pagination:{count:1}}],['next cursor',{projects:[project],pagination:{count:1,next:now}}],['count mismatch',{projects:[project],pagination:{count:2,next:null}}],['invalid prev',{projects:[project],pagination:{count:1,next:null,prev:'private-cursor'}}],['has more',{...list,hasMore:true}],['other project',{projects:[{...project,id:'other'}],pagination:{count:1,next:null}}]])test(name+' stays unproven in sanitized verification and blocks creation',async()=>{
 const value=fixture(),net=network({'/v9/projects?limit=100':{body,status:200}});
 const args={...value,now:()=>now,fetchImpl:net.fetchImpl,deploymentConfiguration:{git:{deploymentEnabled:false}}};
 const result=await collectEnrolledPreviewAuthority({...args,verifyOnly:true});assert.equal(result.report.authorityVerified,false);
 await assert.rejects(collectEnrolledPreviewAuthority(args));assert.ok(!JSON.stringify(result.report).includes('private-cursor'));
});
test('user not_found requires signed authority and cannot independently authorize; arbitrary 404 fails',async()=>{
 const value=fixture(),net=network({'/v2/user':{status:404,body:{error:{code:'other'}}}});
 const result=await collectEnrolledPreviewAuthority({...value,now:()=>now,verifyOnly:true,fetchImpl:net.fetchImpl,deploymentConfiguration:{git:{deploymentEnabled:false}}});assert.equal(result.report.checks.userDenied,false);
 const bad=fixture();bad.token='vcp_WRONG';const untouched=network();await assert.rejects(collectEnrolledPreviewAuthority({...bad,now:()=>now,fetchImpl:untouched.fetchImpl}));assert.equal(untouched.calls.length,0);
});
test('filtered paths and expired proof after reads fail closed',async()=>{
 const net=network();await assert.rejects(enrolledAuthorityGet('/v9/projects?limit=100&search=fcos',{token,fetchImpl:net.fetchImpl}));assert.equal(net.calls.length,0);
 let clockCalls=0;await assert.rejects(collectEnrolledPreviewAuthority({...fixture(),now:()=>clockCalls++?now+ENROLLED_AUTHORITY_MAX_AGE_MS+1:now,verifyOnly:true,fetchImpl:net.fetchImpl,deploymentConfiguration:{git:{deploymentEnabled:false}}}));
});
test('hostile transport exception is never inspected or serialized',async()=>{
 let touched=0;const hostile=new Proxy({}, {get(){touched+=1;throw new Error(token);},ownKeys(){touched+=1;throw new Error(token);}});
 await assert.rejects(collectEnrolledPreviewAuthority({...fixture(),now:()=>now,fetchImpl:async()=>{throw hostile;}}),error=>!error.message.includes(token));assert.equal(touched,0);
});
