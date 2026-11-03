import {randomBytes,hkdfSync,createCipheriv,createDecipheriv} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {assertObserverConnection} from './observer-target.mjs';
import {dependencyHash} from './dependencies.mjs';
import {releaseTargets,FROZEN_COMPATIBILITY_SHA} from './contract.mjs';
import {validateQualificationSource} from '../../../config/hostedReleaseQualification.js';

const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const need=(v,code='PRESERVATION_PREFLIGHT_INVALID')=>{if(!v)throw Object.assign(new Error(code),{code});};
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const domain='fcos-preservation-membership-aes256gcm-v1';
function context({candidateSha,project,membershipSha256}) {
  need(typeof candidateSha==='string'&&/^[a-f0-9]{40}$/.test(candidateSha)&&project===releaseTargets().supabaseProject&&hash(membershipSha256));
  return Buffer.from(JSON.stringify({domain,candidateSha,project,membershipSha256}));
}
function key(connection,project) {
  assertObserverConnection(connection,project);
  return Buffer.from(hkdfSync('sha256',Buffer.from(connection),Buffer.from(domain),Buffer.from(project),32));
}
/** Original owner only: input URL and derived key stay in memory; only the
 * encrypted envelope is returned. Raw FILE hash is authenticated before use. */
export function sealPreservationMembership(bytes,{candidateSha,project,membershipSha256,connection}={}) {
  const plain=Buffer.from(bytes),aad=context({candidateSha,project,membershipSha256});
  need(plain.length>0&&plain.length<=1024*1024&&dependencyHash(plain)===membershipSha256);
  const derived=key(connection,project),nonce=randomBytes(12);
  try {
    const cipher=createCipheriv('aes-256-gcm',derived,nonce);cipher.setAAD(aad);
    const ciphertext=Buffer.concat([cipher.update(gzipSync(plain)),cipher.final()]);
    return Buffer.from(JSON.stringify({schemaVersion:1,kind:domain,candidateSha,project,membershipSha256,
      nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')})+'\n');
  } finally {derived.fill(0);plain.fill(0);}
}
export function openPreservationMembership(bytes,{candidateSha,project,membershipSha256,envelopeSha256,connection}={}) {
  let derived;
  try {
    const raw=Buffer.from(bytes);need(raw.length>0&&raw.length<=1500000&&dependencyHash(raw)===envelopeSha256);
    const e=JSON.parse(raw.toString('utf8')),aad=context({candidateSha,project,membershipSha256});
    need(exact(e,['schemaVersion','kind','candidateSha','project','membershipSha256','nonce','tag','ciphertext'])&&e.schemaVersion===1&&e.kind===domain
      &&e.candidateSha===candidateSha&&e.project===project&&e.membershipSha256===membershipSha256);
    const decode=v=>{need(typeof v==='string'&&/^[A-Za-z0-9+/]+={0,2}$/.test(v));const b=Buffer.from(v,'base64');need(b.toString('base64')===v);return b;};
    const nonce=decode(e.nonce),tag=decode(e.tag);need(nonce.length===12&&tag.length===16);
    derived=key(connection,project);const decipher=createDecipheriv('aes-256-gcm',derived,nonce);decipher.setAAD(aad);decipher.setAuthTag(tag);
    const compressed=Buffer.concat([decipher.update(decode(e.ciphertext)),decipher.final()]);
    const plain=gunzipSync(compressed,{maxOutputLength:1024*1024});need(dependencyHash(plain)===membershipSha256);
    return plain;
  } catch {throw Object.assign(new Error('PRESERVATION_PRIVATE_HANDOFF_INVALID'),{code:'PRESERVATION_PRIVATE_HANDOFF_INVALID'});}
  finally {derived?.fill(0);}
}
export function validatePreservationPreflightSetup(setup,{controllerSha,candidateSha,now=Date.now()}={}) {
  need(exact(setup,['schemaVersion','kind','discoveryOnly','controllerSha','candidateSha','targets','qualificationSource','environment','issuedAt','notAfter','membership'])
    &&setup.schemaVersion===1&&setup.kind==='fcos_preservation_preflight_setup_v1'&&setup.discoveryOnly===true&&setup.controllerSha===controllerSha
    &&setup.candidateSha===candidateSha&&candidateSha===FROZEN_COMPATIBILITY_SHA&&dependencyHash(setup.targets)===dependencyHash(releaseTargets())
    &&setup.environment==='fcos-hosted-dependency-verification'&&Number.isSafeInteger(setup.issuedAt)&&setup.issuedAt>0&&setup.issuedAt<=now+30000
    &&Number.isSafeInteger(setup.notAfter)&&setup.notAfter>now&&setup.notAfter>setup.issuedAt
    &&exact(setup.membership,['fileSha256','envelopeSha256','path'])&&hash(setup.membership.fileSha256)&&hash(setup.membership.envelopeSha256)
    &&setup.membership.path===`.github/qualification/preservation/${setup.membership.envelopeSha256}.json`);
  validateQualificationSource(setup.qualificationSource,{controllerSha,candidateSha});return setup;
}
