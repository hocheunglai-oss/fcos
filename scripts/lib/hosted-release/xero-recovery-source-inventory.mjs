import {createHash} from 'node:crypto';
import {fcosConnectionIdentifier} from '../../../config/fcosConnections.js';

const need=value=>{if(!value)throw Object.assign(new Error('XERO_RECOVERY_SOURCE_INVENTORY_REFUSED'),{code:'XERO_RECOVERY_SOURCE_INVENTORY_REFUSED'});};
const exact=(value,keys)=>value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const hash=(algorithm,bytes)=>createHash(algorithm).update(bytes).digest('hex');
const compare=(a,b)=>a<b?-1:a>b?1:0;

// Pure validation of the provider's observed src/out tree. The caller must
// already authenticate the deployment/team/project and the expected package.
// A source UID equal to SHA1 is an inventory binding, not downloaded bytes.
// The caller MUST GET every source UID and compare exact byte length, SHA256
// and base64 against sourceFiles before accepting actual source evidence.
export function validateXeroRecoverySourceInventory({tree,expectedFiles,mode}={}) {
  need(mode==='probe'||mode==='host');
  const route=mode==='probe'?'.well-known/fcos-ingress-probe':'xero-recovery';
  const paths=['.vercel/output/config.json',`.vercel/output/functions/${route}.func/.vc-config.json`,`.vercel/output/functions/${route}.func/index.mjs`].sort(compare);
  need(Array.isArray(expectedFiles)&&expectedFiles.length===3);
  const expected=new Map(),sourceUids=new Set();
  for(const file of expectedFiles){
    need(exact(file,['path','sha256','bytes','contentBase64'])&&paths.includes(file.path)&&!expected.has(file.path)
      &&/^[a-f0-9]{64}$/.test(file.sha256)&&Number.isSafeInteger(file.bytes)&&file.bytes>0&&file.bytes<2*1024*1024
      &&typeof file.contentBase64==='string'&&file.contentBase64.length===4*Math.ceil(file.bytes/3));
    const bytes=Buffer.from(file.contentBase64,'base64');
    need(bytes.length===file.bytes&&bytes.toString('base64')===file.contentBase64&&hash('sha256',bytes)===file.sha256);
    const uid=hash('sha1',bytes);need(!sourceUids.has(uid));sourceUids.add(uid);
    expected.set(file.path,Object.freeze({...file,uid,inventoryPath:'src/'+file.path}));
  }
  const expectedLeaves=new Map(paths.map(path=>['src/'+path,'file']));
  const outputPath='out/'+route;expectedLeaves.set(outputPath,'lambda');
  const expectedDirectories=new Set();
  for(const leaf of expectedLeaves.keys()){const parts=leaf.split('/');for(let i=1;i<parts.length;i++)expectedDirectories.add(parts.slice(0,i).join('/'));}
  const seen=new Set(),actualLeaves=new Map();let count=0;
  function visit(rows,prefix='',depth=0){
    need(Array.isArray(rows)&&rows.length>0&&rows.length<=16&&depth<=8);
    for(const row of rows){
      need(++count<=32&&row&&typeof row.name==='string'&&/^[A-Za-z0-9_.-]{1,160}$/.test(row.name)&&row.name!=='.'&&row.name!=='..');
      const path=prefix+row.name;need(!seen.has(path));seen.add(path);
      if(row.type==='directory'){
        need(exact(row,['name','type','mode','children'])&&row.mode===16749&&expectedDirectories.has(path));visit(row.children,path+'/',depth+1);
      }else{
        need(exact(row,['name','type','mode','uid'])&&expectedLeaves.get(path)===row.type&&typeof row.uid==='string');
        if(row.type==='file')need(row.mode===33152&&row.uid===expected.get(path.slice(4))?.uid);
        else need(row.type==='lambda'&&row.mode===49590&&new RegExp('^'+fcosConnectionIdentifier('vercel','Team ID')+'-[a-f0-9]{34}$').test(row.uid));
        actualLeaves.set(path,row);
      }
    }
  }
  visit(tree);
  need(seen.size===expectedDirectories.size+expectedLeaves.size&&actualLeaves.size===expectedLeaves.size
    &&[...expectedDirectories].every(path=>seen.has(path))&&[...expectedLeaves].every(([path,type])=>actualLeaves.get(path)?.type===type));
  return Object.freeze({kind:'fcos_vercel_src_out_inventory_v1',mode,
    sourceFiles:Object.freeze(paths.map(path=>expected.get(path))),
    compiledOutput:Object.freeze({path:outputPath,type:'lambda',uid:actualLeaves.get(outputPath).uid}),
    sourceBytesProven:false,compiledOutputBytesProven:false,executionAuthorityGranted:false});
}

// Shared source-content contract for hosted admission and native reviews.
// This is a byte comparison, never an authority or compiled-output receipt.
export function validateXeroRecoverySourceContent({file,responseBytes}={}) {
  need(exact(file,['path','sha256','bytes','contentBase64','uid','inventoryPath'])
    &&typeof file.path==='string'&&file.inventoryPath==='src/'+file.path
    &&/^[a-f0-9]{40}$/.test(file.uid)&&/^[a-f0-9]{64}$/.test(file.sha256)
    &&Number.isSafeInteger(file.bytes)&&file.bytes>0&&file.bytes<2*1024*1024
    &&typeof file.contentBase64==='string'&&Buffer.isBuffer(responseBytes)
    &&responseBytes.length>0&&responseBytes.length<=4194304);
  // Vercel may return raw bytes or documented JSON/base64 envelopes.
  const candidates=[responseBytes];
  try{const value=JSON.parse(responseBytes.toString('utf8'));
    if(typeof value==='string')candidates.push(Buffer.from(value,'base64'));
    if(exact(value,['data'])&&typeof value.data==='string')candidates.push(Buffer.from(value.data,'base64'));
  }catch{/* Raw source need not be JSON. */}
  need(candidates.some(bytes=>bytes.length===file.bytes&&hash('sha1',bytes)===file.uid
    &&hash('sha256',bytes)===file.sha256&&bytes.toString('base64')===file.contentBase64));
  return Object.freeze({path:file.path,uid:file.uid,bytes:file.bytes,sha256:file.sha256});
}
export function validateXeroRecoverySourceContents({tree,expectedFiles,mode,contents}={}) {
  // Revalidate the full exact inventory; do not accept a forged inventory result.
  const inventory=validateXeroRecoverySourceInventory({tree,expectedFiles,mode});
  need(Array.isArray(contents)&&contents.length===inventory.sourceFiles.length);
  const downloaded=new Map();
  for(const row of contents){
    need(exact(row,['uid','responseBytes'])&&typeof row.uid==='string'&&!downloaded.has(row.uid));
    downloaded.set(row.uid,row.responseBytes);
  }
  const sourceFiles=inventory.sourceFiles.map(file=>validateXeroRecoverySourceContent({file,responseBytes:downloaded.get(file.uid)}));
  return Object.freeze({schemaVersion:1,kind:'fcos_vercel_source_contents_v1',mode,
    sourceFiles:Object.freeze(sourceFiles),sourceBytesProven:true,
    compiledOutputBytesProven:false,executionAuthorityGranted:false});
}
