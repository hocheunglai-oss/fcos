import {readFileSync,mkdirSync,writeFileSync,existsSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,join,relative,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {fcosConnectionIdentifier,fcosSalesforceEnvironment} from '../config/fcosConnections.js';
import {OBSERVATION_BASE_SHA,OBSERVATION_CANDIDATE_SHA,OBSERVATION_DECLARATIONS,LEGACY_XERO_MAPPING_READ_BINDING,verifyCompatibilityObservationSources} from './lib/runtime-compatibility-observation.mjs';
import {diagnosticDigest,validateDiagnosticBinding} from './lib/hosted-release/legacy-runtime-diagnostic-handler.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const need=v=>{if(!v)throw Error('DIAGNOSTIC_BUILD_INVALID');};
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const sha=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const bytes=(root,path)=>{const p=join(root,path);for(let q=p;q!==root;q=dirname(q))need(!lstatSync(q).isSymbolicLink());need(lstatSync(p).isFile());return readFileSync(p);};
const json=v=>Buffer.from(JSON.stringify(v)+'\n');

/** No provider/credential access or candidate build. Output contains only the
 * reviewed standalone runtime, public source/metadata binding and capability
 * digest. The returned privateAuthorization must remain in owner memory. */
export function buildLegacyRuntimeDiagnostic({controllerDirectory=ROOT,outputDirectory,binding,capability=randomBytes(32).toString('base64url')}={}) {
  const root=realpathSync(resolve(controllerDirectory)),output=resolve(outputDirectory||'');
  need(!Object.keys(process.env).some(k=>k.startsWith('GIT_')&&!['GIT_PAGER','GIT_EDITOR','GIT_SEQUENCE_EDITOR','GIT_TERMINAL_PROMPT'].includes(k)));
  need(outputDirectory&&!existsSync(output)&&relative(root,output).startsWith('..')&&root===realpathSync(ROOT));
  need(typeof capability==='string'&&/^[A-Za-z0-9_-]{43}$/.test(capability)&&Buffer.from(capability,'base64url').length===32&&Buffer.from(capability,'base64url').toString('base64url')===capability);
  need(exact(binding,['schemaVersion','kind','operationId','controllerSha','candidateSha','previous','issuedAt','notAfter','projectRecords','legacyEnvironmentKeys','allowQuotaMetadata','customEnvironment'])
    &&binding.schemaVersion===1&&binding.kind==='fcos_legacy_runtime_diagnostic_request_v1'&&binding.allowQuotaMetadata===false&&sha(binding.controllerSha));
  const git=args=>execFileSync('git',['--no-replace-objects',...args],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000,maxBuffer:32*1024*1024,
    env:{PATH:process.env.PATH,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_NO_REPLACE_OBJECTS:'1',GIT_TERMINAL_PROMPT:'0'}});
  need(git(['rev-parse','HEAD']).trim()===binding.controllerSha);
  const contractBytes=bytes(root,'config/runtime-compatibility-successor-live.json');need(diagnosticDigest(contractBytes)==='aecc93e6152c23b0bee23834f045cc2a6ae8a9fd9057c205080c6ade7614a5c0');
  const contract=JSON.parse(contractBytes),legacyControl=bytes(root,'scripts/lib/runtime-compatibility-release.mjs').toString('utf8');
  const rollout=legacyControl.match(/export const FIRST_RUNTIME_ROLLOUT = Object\.freeze\(\{\n([\s\S]*?)\n\}\);/);need(rollout);
  const pinned=Object.fromEntries([...rollout[1].matchAll(/(\w+): '([^']+)'/g)].map(m=>[m[1],m[2]]));
  need(binding.candidateSha===contract.candidateSha&&pinned.previousSha===OBSERVATION_BASE_SHA&&pinned.candidateSha===OBSERVATION_CANDIDATE_SHA
    &&exact(binding.previous,['deploymentId','sha','url','sourceSha256','createdAt'])&&binding.previous.sha===pinned.previousSha
    &&binding.previous.deploymentId===pinned.previousDeploymentId&&binding.previous.url===pinned.previousUrl
    &&binding.previous.sourceSha256==='9ce0445de15bff7992867e689328c1189b9c586a850149f5ad26384482f1b7f6'&&Number.isSafeInteger(binding.previous.createdAt)&&binding.previous.createdAt>0);
  const helper=bytes(root,'scripts/lib/runtime-compatibility-observation.mjs'),collectorFile=bytes(root,'scripts/runtime-compatibility-release.mjs');
  for(const p of ['scripts/lib/runtime-compatibility-release.mjs','scripts/lib/runtime-compatibility-observation.mjs','scripts/runtime-compatibility-release.mjs','config/fcosConnections.js'])need(bytes(root,p).toString('utf8')===git(['show',`${binding.controllerSha}:${p}`]));
  const source=verifyCompatibilityObservationSources({cwd:root,baseSha:pinned.previousSha,candidateSha:pinned.candidateSha});
  need(source.sourceVerified);
  const sections=OBSERVATION_DECLARATIONS.map((_,i)=>helper.toString('utf8').split(`// BEGIN IMMUTABLE PURE ${i}\n`)[1]?.split(`// END IMMUTABLE PURE ${i}\n`)[0]);need(sections.every(Boolean));
  const full=collectorFile.toString('utf8'),start='export async function collectCompatibilityBaselineRuntime(',end='\nfunction sourceInventory(';
  need(full.split(start).length===2&&full.split(end).length===2);const collector=full.slice(full.indexOf(start),full.indexOf(end)).trimEnd(),collectorSha256=diagnosticDigest(collector.replace(/^export /,''));
  const keys=new Set();for(const text of [...sections,collector])for(const m of text.matchAll(/\b(?:env|privateEnvironment)\s*(\.[A-Za-z_$][\w$]*|\[[^\]]*\])/g)){
    if(m[1]==='[definition.envName]')continue;need(/^\.[A-Z][A-Z0-9_]*$/.test(m[1]));keys.add(m[1].slice(1));
  }
  for(const m of sections.join('\n').matchAll(/envName:\s*'([A-Z][A-Z0-9_]*)'/g))keys.add(m[1]);
  const dependencies=[...keys].sort(),inventory=binding.legacyEnvironmentKeys,records=binding.projectRecords;
  need(Array.isArray(records)&&records.length===58&&new Set(records.map(r=>r.id)).size===58&&new Set(records.map(r=>r.key)).size===58
    &&records.every(r=>exact(r,['id','key','target','gitBranch','createdAt','updatedAt'])&&typeof r.id==='string'&&r.id.length>0&&r.id.length<=200
      &&/^[A-Z][A-Z0-9_]{0,127}$/.test(r.key)&&Array.isArray(r.target)&&r.target.includes('production')&&r.target.every(t=>['production','preview','development'].includes(t))
      &&r.gitBranch===null&&Number.isSafeInteger(r.createdAt)&&r.createdAt>0&&Number.isSafeInteger(r.updatedAt)&&r.updatedAt>=r.createdAt&&r.updatedAt<=binding.previous.createdAt));
  const sf=fcosSalesforceEnvironment('production'),targets={repository:fcosConnectionIdentifier('github','Repository'),vercelTeam:fcosConnectionIdentifier('vercel','Team ID'),
    vercelProject:fcosConnectionIdentifier('vercel','Project ID'),supabaseProject:fcosConnectionIdentifier('supabase','Project ref'),salesforceOrigin:sf.instanceUrl,salesforceOrg:sf.orgId};
  const publicBinding={schemaVersion:1,kind:'fcos_legacy_runtime_diagnostic_binding_v1',operationId:binding.operationId,controllerSha:binding.controllerSha,candidateSha:binding.candidateSha,
    previous:binding.previous,targets,issuedAt:binding.issuedAt,notAfter:binding.notAfter,customEnvironment:binding.customEnvironment,allowQuotaMetadata:false,projectRecordsSha256:diagnosticDigest(records),projectRecordKeys:records.map(r=>r.key).sort(),
    legacyEnvironmentKeys:inventory,dependencyKeys:dependencies,absentDependencies:dependencies.filter(k=>!inventory.includes(k)),
    source:{helperRevision:source.helperRevision,declarationsSha256:source.declarationsSha256,collectorSha256,dependencySha256:diagnosticDigest({
      source:{helperRevision:source.helperRevision,declarationsSha256:diagnosticDigest(JSON.stringify({pure:OBSERVATION_DECLARATIONS,legacyRead:LEGACY_XERO_MAPPING_READ_BINDING})),observationKind:source.observationKind},collectorSha256,keys:dependencies})}};
  const configuration={version:3,routes:[{src:'^/api/legacy-runtime-observation$',dest:'/api/legacy-runtime-observation'}]};
  const runtime=new Map([
    ['handler.mjs',bytes(root,'scripts/lib/hosted-release/legacy-runtime-diagnostic-handler.mjs')],
    ['connections.mjs',bytes(root,'config/fcosConnections.js')],
    ['collector.mjs',Buffer.from(`import {fcosConnectionIdentifier,fcosSalesforceEnvironment} from './connections.mjs';\nconst FIRST_RUNTIME_ROLLOUT=${JSON.stringify(pinned)};\nconst createClient=()=>{throw Error('DIAGNOSTIC_XERO_SHARED_ADMISSION_REQUIRED');};\n${sections.join('\n')}\n${collector}\n`)],
    ['.vc-config.json',json({runtime:'nodejs24.x',handler:'index.mjs',launcherType:'Nodejs',maxDuration:30})],
  ]);
  const capabilitySha256=diagnosticDigest(capability);
  publicBinding.buildSha256=diagnosticDigest({binding:publicBinding,capabilitySha256,configuration,sources:[...runtime].map(([path,b])=>({path,sha256:diagnosticDigest(b)}))});
  validateDiagnosticBinding(publicBinding);
  runtime.set('index.mjs',Buffer.from(`import {createLegacyRuntimeDiagnosticHandler} from './handler.mjs';\nimport {collectCompatibilityBaselineRuntime} from './collector.mjs';\nexport default createLegacyRuntimeDiagnosticHandler({binding:${JSON.stringify(publicBinding)},capabilitySha256:${JSON.stringify(capabilitySha256)},collectRuntime:collectCompatibilityBaselineRuntime});\n`));
  const files=new Map([['.vercel/output/config.json',json(configuration)],['.vercel/project.json',json({orgId:targets.vercelTeam,projectId:targets.vercelProject})],['vercel.json',json({version:2,crons:[]})]]);
  for(const [p,b]of runtime)files.set(`.vercel/output/functions/api/legacy-runtime-observation.func/${p}`,b);
  need([...files.values()].every(b=>!b.includes(Buffer.from(capability))));
  mkdirSync(output,{mode:0o700});for(const [p,b]of files){mkdirSync(dirname(join(output,p)),{recursive:true,mode:0o700});writeFileSync(join(output,p),b,{flag:'wx',mode:0o600});}
  const rows=[...files].map(([path,b])=>({path,byteLength:b.length,sha256:diagnosticDigest(b)})).sort((a,b)=>a.path.localeCompare(b.path));
  return {manifest:{schemaVersion:1,kind:'fcos_legacy_runtime_diagnostic_build_v1',diagnosticOnly:true,baselineAccepted:false,binding:publicBinding,bindingSha256:diagnosticDigest(publicBinding),
    buildSha256:publicBinding.buildSha256,configurationSha256:diagnosticDigest(json(configuration)),outputSha256:diagnosticDigest(rows),files:rows,
    limitation:'Copied current Production settings evaluated in an isolated custom/preview runtime with explicit Production interpretation; unchanged legacy configuration is metadata inference, not provider deploymentId lineage. Xero auth remains unknown without actual shared quota admission.'},
    privateAuthorization:{capability}};
}
