/** Native JSON-only bridge for actual Supabase connector coordination receipts.
 * It parses a saved tool response; it never queries a provider or creates a
 * lease. The caller must authenticate the real tool call and current target. */
import { readFileSync, lstatSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';

const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v,keys)=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const leaseKeys=['epoch','objective','ownerThreadId','operationId','bindingSha256','leaseId','coordinationOnly','providerAuthorityGranted','uncertainOutcomeRequiresReadback'];
function safeLease(v) {return exact(v,leaseKeys)&&v.epoch==='fcos-hosted-admin-epoch1'&&v.objective==='production'
  &&v.ownerThreadId==='01a0f08b-7fcb-7870-9edc-343e16052b62'&&/^pr122-admin-[a-z0-9-]{8,100}$/.test(v.operationId)
  &&hash(v.bindingSha256)&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v.leaseId)
  &&v.coordinationOnly===true&&v.providerAuthorityGranted===false&&v.uncertainOutcomeRequiresReadback===true;}

export function parseAdministratorToolReceipt(input,{querySha256,mode}={}) {
  if(!hash(querySha256)||!exact(input,['toolName','projectId','querySha256','result'])
    ||input.toolName!=='mcp__codex_apps__supabase_execute_sql'
    ||input.projectId!==fcosConnectionIdentifier('supabase','Project ref')||input.querySha256!==querySha256
    ||!object(input.result)||input.result.isError!==false||input.result.error||input.result.signal
    ||Object.hasOwn(input.result,'session_id')||Object.hasOwn(input.result,'sessionId')
    ||!Array.isArray(input.result.content)||input.result.content.length!==1
    ||input.result.content[0].type!=='text'||typeof input.result.content[0].text!=='string'
    ||Buffer.byteLength(input.result.content[0].text)>131072) throw Error('ADMINISTRATOR_RESULT_UNCONFIRMED');
  const outer=JSON.parse(input.result.content[0].text);
  if(!exact(outer,['result'])||typeof outer.result!=='string')throw Error('ADMINISTRATOR_RESULT_UNCONFIRMED');
  // The connector's warning also mentions the opening tag in prose. Match
  // only a tag immediately followed by the JSON array, never that mention.
  const match=outer.result.match(/<untrusted-data-([a-f0-9-]+)>\s*(\[[\s\S]*?\])\s*<\/untrusted-data-\1>/);
  if(!match)throw Error('ADMINISTRATOR_RESULT_UNCONFIRMED');
  const rows=JSON.parse(match[2]);
  if(!Array.isArray(rows)||rows.length!==1||!exact(rows[0],['result']))throw Error('ADMINISTRATOR_RESULT_UNCONFIRMED');
  const v=rows[0].result;
  if(mode==='lease'&&safeLease(v))return v;
  if(mode==='receipt'&&exact(v,['lease','state','durable'])&&safeLease(v.lease)
    &&['prepared','submitting','submitted','uncertain'].includes(v.state)&&v.durable===true)return v;
  if(mode==='isolation_ack'&&exact(v,['disposition','proofSha256','originalOutcome','replayAllowed','productionAuthorityGranted','financialAuthorityGranted'])
    &&v.disposition==='quarantined'&&hash(v.proofSha256)&&v.originalOutcome==='unknown'&&v.replayAllowed===false
    &&v.productionAuthorityGranted===false&&v.financialAuthorityGranted===false)return v;
  throw Error('ADMINISTRATOR_RESULT_UNCONFIRMED');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const [file,querySha256,mode,...extra]=process.argv.slice(2);
    if(extra.length||!isAbsolute(file)||!lstatSync(file).isFile()||lstatSync(file).isSymbolicLink()
      ||lstatSync(file).size>262144)throw Error('ADMINISTRATOR_RESULT_UNCONFIRMED');
    const result=parseAdministratorToolReceipt(JSON.parse(readFileSync(file,'utf8')),{querySha256,mode});
    process.stdout.write(JSON.stringify(result)+'\n');
  } catch {process.stderr.write('ADMINISTRATOR_RESULT_UNCONFIRMED\n');process.exitCode=1;}
}
