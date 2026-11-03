#!/usr/bin/env node
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync,readdirSync,realpathSync } from 'node:fs';
import { dirname,join,relative,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateVercelIngressTarget,validateVercelRecoveryCompiled,XERO_RECOVERY_PRIVATE_KEYS,vercelIngressProbeEntrypoint } from './lib/hosted-release/xero-recovery-vercel-ingress.mjs';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=v=>{if(!v)throw Object.assign(new Error('XERO_HOST_PACKAGE_REFUSED'),{code:'XERO_HOST_PACKAGE_REFUSED'});};
const SOURCE=['scripts/package-xero-recovery-host.mjs','scripts/lib/hosted-release/xero-recovery-vercel-ingress.mjs','scripts/lib/hosted-release/xero-recovery-host.mjs',
  'scripts/lib/hosted-release/xero-recovery-actor-auth.mjs','scripts/lib/hosted-release/xero-recovery-step-protocol.mjs','scripts/lib/hosted-release/xero-recovery-step-actions.mjs',
  'api/_xeroRateLimit.js','api/_supabaseConfig.js','api/_readOnlyCiAccess.js','config/fcosConnections.js','config/fcosCiIdentity.js','package-lock.json'];
const exact=(value,keys)=>value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
export const xeroHostPackageSourcePins=()=>Object.fromEntries(SOURCE.map(p=>[p,hash(regular(join(ROOT,p)))]));
function regular(path){need(lstatSync(path).isFile()&&!lstatSync(path).isSymbolicLink());return readFileSync(path);}
function createOutput(path){need(!existsSync(path));let parent=dirname(path);need(realpathSync(parent)===parent);mkdirSync(path,{mode:0o700});}
export async function packageXeroRecoveryHost({mode,configuration,sourcePins,outputDirectory}={}) {
  need(['probe','host'].includes(mode)&&typeof outputDirectory==='string'&&resolve(outputDirectory)===outputDirectory);
  const actual=xeroHostPackageSourcePins();need(exact(sourcePins,SOURCE)&&SOURCE.every(p=>sourcePins[p]===actual[p]));
  const target=mode==='probe'?validateVercelIngressTarget(configuration?.target):validateVercelRecoveryCompiled(configuration).target;
  if(mode==='probe')need(exact(configuration,['target']));
  need(target.hostSourceSha256===hash(JSON.stringify(actual)));
  const publicConfig=JSON.stringify(configuration,(_k,v)=>v&&Object.getPrototypeOf(v)===Object.prototype?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);need(Buffer.byteLength(publicConfig)<=32768);
  const entry=mode==='probe'?'createVercelIngressProbe':'createVercelRecoveryIngress';
  const generated=mode==='probe'?vercelIngressProbeEntrypoint(target):`import {${entry}} from ${JSON.stringify(join(ROOT,'scripts/lib/hosted-release/xero-recovery-vercel-ingress.mjs'))};\nexport default ${entry}(${mode==='probe'?publicConfig:`{compiled:${publicConfig}}`});\n`;
  // All environment values are read only inside the deployed trusted adapter.
  // Builder reads fixed source/lock files only; no manager/keychain/.env access.
  const bundled=await build({absWorkingDir:ROOT,stdin:{contents:generated,resolveDir:ROOT,sourcefile:'fcos-private-host-entry.mjs',loader:'js'},bundle:true,platform:'node',format:'esm',target:'node24',
    treeShaking:true,write:false,metafile:true,minify:false,legalComments:'none',logLevel:'silent'});
  need(bundled.outputFiles.length===1&&bundled.outputFiles[0].contents.length<2*1024*1024);
  const output=bundled.outputFiles[0].contents;
  const used=Object.entries(bundled.metafile.outputs).flatMap(([,v])=>Object.entries(v.inputs).filter(([,r])=>r.bytesInOutput>0).map(([p])=>p));
  need(used.every(p=>p==='fcos-private-host-entry.mjs'||SOURCE.includes(p)||p.startsWith('node_modules/jose/')));
  createOutput(outputDirectory);mkdirSync(join(outputDirectory,'.vercel/output/functions'),{recursive:true,mode:0o700});
  const route=mode==='probe'?'.well-known/fcos-ingress-probe':'xero-recovery',functionDir=join(outputDirectory,'.vercel/output/functions',route+'.func');mkdirSync(functionDir,{recursive:true,mode:0o700});
  const put=(name,value)=>writeFileSync(name,typeof value==='string'||value instanceof Uint8Array?value:JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
  put(join(functionDir,'index.mjs'),output);put(join(functionDir,'.vc-config.json'),{runtime:'nodejs24.x',handler:'index.mjs',launcherType:'Nodejs',maxDuration:mode==='probe'?10:120,shouldAddHelpers:false});
  put(join(outputDirectory,'.vercel/output/config.json'),{version:3});
  put(join(outputDirectory,'.vercel/project.json'),{projectId:target.projectId,orgId:target.teamId});
  const files=[];const inventory=dir=>{for(const e of readdirSync(dir,{withFileTypes:true})){const p=join(dir,e.name);need(!e.isSymbolicLink());if(e.isDirectory())inventory(p);else files.push({path:relative(outputDirectory,p),sha256:hash(regular(p)),bytes:lstatSync(p).size});}};inventory(outputDirectory);
  const uploadFiles=files.filter(f=>f.path!=='.vercel/project.json').sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  const manifest={expectedUploadFiles:uploadFiles,expectedUploadFilesSha256:hash(JSON.stringify(uploadFiles)),providerFileInventoryMapping:'unproven_prebuilt_function_visibility_requires_actual_provider_response',kind:'fcos_minimal_xero_host_package_v1',mode,target,sourcePins:actual,files,dependencyInputs:used.filter(p=>p.startsWith('node_modules/')),
    bundleSha256:hash(output),configurationSha256:hash(publicConfig),privateEnvironmentNames:mode==='probe'?[]:XERO_RECOVERY_PRIVATE_KEYS,
    requiredEmptyCustomEnvironment:target.customEnvironment,providerActions:0,crons:[],aliases:[],domains:[],frontendIncluded:false,
    executionAuthorityGranted:false,actualDeploymentId:null,actualImmutableUrl:null,actualNativeProviderAcceptanceRequired:true,
    limitation:'Trusted Vercel hosting/process inputs plus HTTPS client are infrastructure assumptions. Headers are consistency checks only. Root must admit actual native deployment/source receipt after deployment; no environment value is a provider receipt.'};
  put(join(outputDirectory,'package-manifest.json'),manifest);return manifest;
}
export function readExpectedXeroHostUploadFiles({outputDirectory,mode}={}) {
  need(['probe','host'].includes(mode)&&typeof outputDirectory==='string'&&resolve(outputDirectory)===outputDirectory);
  const name=mode==='probe'?'.well-known/fcos-ingress-probe':'xero-recovery';
  const upload=['.vercel/output/config.json',`.vercel/output/functions/${name}.func/.vc-config.json`,`.vercel/output/functions/${name}.func/index.mjs`].sort();
  const expected=[...upload,'.vercel/project.json','package-manifest.json'].sort(),found=[];
  const walk=dir=>{for(const e of readdirSync(dir,{withFileTypes:true})){const path=join(dir,e.name);need(!e.isSymbolicLink());if(e.isDirectory())walk(path);else found.push(relative(outputDirectory,path));}};
  walk(outputDirectory);need(JSON.stringify(found.sort())===JSON.stringify(expected));
  return upload.map(path=>{const bytes=regular(join(outputDirectory,path));return {path,sha256:hash(bytes),bytes:bytes.length,contentBase64:bytes.toString('base64')};});
}
export async function packageMain(args=process.argv.slice(2)) {
  need(args.length===4);const [mode,configPath,pinsPath,outputDirectory]=args;
  const config=JSON.parse(regular(configPath)),sourcePins=JSON.parse(regular(pinsPath));
  return packageXeroRecoveryHost({mode,configuration:config,sourcePins,outputDirectory});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))packageMain().then(v=>process.stdout.write(JSON.stringify(v)+'\n')).catch(()=>{process.stderr.write('XERO_HOST_PACKAGE_REFUSED\n');process.exitCode=1;});
