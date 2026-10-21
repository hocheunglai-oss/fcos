// Candidate additive loader. Material acceptance and execution are separate.
// Exact successor bytes only: no old loader, private fixture or generation fallback.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { evaluateSupplierFinancialBucketPreservation as evaluate, supplierFinancialBucketReview as makeReview,
  supplierFinancialBucketApprovalMaterial } from '../api/_xeroSupplierFinancialBucketPreservation.js';
import { supplierFinancialSourcePayload } from '../api/_xeroFinancialSync.js';
import { ids, hash } from './xeroSupplierFinancialBucketPreservation.fixture.js';
import { issuedSupplierCanonical as canonical } from '../api/_xeroIssuedSupplierPreservation.js';
export const SUCCESSOR_FAMILY = 'xero-supplier-financial-bucket-successor-v1-20261006';
export const SUCCESSOR_MANIFEST_SHA256 = 'd8a99d562481840cd96bc67950be7074ec1d518be4648436ff35e2c076d22227';
export const SUCCESSOR_CASES = Object.freeze(['authorised-positive','paid-positive','source-half-up','explicit-null-lump','signed-discount','retained-tracking','largest-current-guang-hua6-positive']);
const sourceRoot = resolve(fileURLToPath(new URL('..',import.meta.url)));
const defaultDirectory = fileURLToPath(new URL('./fixtures/'+SUCCESSOR_FAMILY+'/',import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const SOURCE_COMPOSITION_SHA256 = '8be331ccd6a65e081de327fe41c337872503e9db28811e22a0cce15f07f9c26f';
const manifests = new Map();
function manifest(directory=defaultDirectory) {
  const raw=readFileSync(resolve(directory,'successor-v1-manifest.json'));
  assert.equal(sha(raw),SUCCESSOR_MANIFEST_SHA256,'Exact proposed successor manifest pin required; no fallback');
  if(manifests.has(directory)) return manifests.get(directory);
  const m=JSON.parse(raw);
  assert.equal(m.kind,'supplier_financial_bucket_successor_manifest_v1'); assert.equal(m.family,SUCCESSOR_FAMILY); assert.equal(m.version,1);
  for(const k of ['synthetic','nonExecutablePreparation'])assert.equal(m[k],true);
  for(const k of ['recoveredOriginal','originalCaseEquivalence','currentBusinessCase','verificationExecuted','liveAcceptance'])assert.equal(m[k],false);
  assert.deepEqual(m.records.map(r=>r.caseName),SUCCESSOR_CASES);
  const compositionRaw=readFileSync(resolve(sourceRoot,'tests/fixtures/final-application-supplier-source-bindings-v1.json'));
  assert.equal(sha(compositionRaw),SOURCE_COMPOSITION_SHA256,'Exact final application source-composition binding required');
  const composition=JSON.parse(compositionRaw);
  assert.equal(composition.kind,'final_application_supplier_source_bindings_v1');
  assert.equal(composition.historicalManifestSha256,SUCCESSOR_MANIFEST_SHA256);
  assert.deepEqual(Object.keys(composition.sourceOverrides).sort(),['api/_runtimeCache.js','api/_supabaseConfig.js','config/fcosConnections.js','package-lock.json','package.json']);
  assert.equal(composition.sevenRawFixtureRecordsUnchanged,true);assert.equal(composition.algorithmBodiesUnchanged,true);
  for(const key of ['generatorExecuted','privateFixtureRead','currentBusinessCase','financialAuthorityGranted'])assert.equal(composition[key],false);
  for(const [file,expected]of Object.entries(composition.originalBindings))assert.equal(expected,({...m.sourceBindings,...m.publicImportClosure})[file]);
  for(const [file,expected]of Object.entries({...m.sourceBindings,...m.publicImportClosure,...composition.sourceOverrides})) {
    const path=resolve(sourceRoot,file); assert.ok(path.startsWith(sourceRoot+'/'));
    assert.equal(sha(readFileSync(path)),expected,'Changed source binding: '+file);
  }
  assert.equal(sha(readFileSync(resolve(sourceRoot,'tests/xeroSupplierFinancialBucketSuccessor.generate.mjs'))),m.generatorSourceSha256,'Changed explicit generator source');
  manifests.set(directory,m);return m;
}
export function successorMetrics(value) {
  let nodes=0,depth=0;const visit=(v,d)=>{nodes++;depth=Math.max(depth,d);if(v&&typeof v==='object')Object.values(v).forEach(x=>visit(x,d+1));};visit(value,0);
  return {ordinaryBytes:Buffer.byteLength(JSON.stringify(value)),canonicalBytes:Buffer.byteLength(canonical(value)),nodes,depth};
}
export function successorCaseRecord(name,{directory=defaultDirectory}={}) {
  assert.ok(SUCCESSOR_CASES.includes(name),'Unknown successor case');return structuredClone(manifest(directory).records.find(r=>r.caseName===name));
}
export function loadSuccessorFixture(name,{directory=defaultDirectory}={}) {
  const record=successorCaseRecord(name,{directory});assert.equal(record.file,'successor-v1-'+name+'.json');
  const raw=readFileSync(resolve(directory,record.file));assert.equal(sha(raw),record.sha256,'Exact successor fixture raw bytes required');assert.equal(raw.length,record.bytes);
  const f=JSON.parse(raw);assert.equal(f.kind,'supplier_financial_bucket_successor_fixture_v1');assert.equal(f.family,SUCCESSOR_FAMILY);assert.equal(f.caseName,name);
  for(const k of ['synthetic','nonExecutablePreparation'])assert.equal(f[k],true);
  for(const k of ['recoveredOriginal','originalCaseEquivalence','currentBusinessCase'])assert.equal(f[k],false);
  assert.deepEqual(f.labels,record.labels);assert.equal(hash(f.input),record.inputHash);
  const proof=evaluate(f.input);assert.deepEqual(proof,f.proof);assert.equal(proof.proofValid,true);assert.equal(proof.financiallyEquivalent,true);
  assert.equal(hash(proof),record.proofHash);assert.equal(hash(proof.evidence),record.evidenceFingerprint);assert.equal(proof.fingerprint,record.accountingFingerprint);
  assert.equal(hash(proof.localClaimScope),record.localClaimScopeHash);
  const review=makeReview(proof,{reviewFingerprint:hash(record.labels.reviewFingerprintLabel),legacyReviewFingerprint:hash(record.labels.legacyReviewFingerprintLabel)});
  assert.deepEqual(review,f.review);assert.equal(hash(review),record.reviewHash);
  assert.equal(hash(supplierFinancialBucketApprovalMaterial(proof.evidence,proof.localClaimScope)),record.approvalMaterialHash);
  for(const [key,value]of Object.entries({input:f.input,proof:f.proof,evidence:proof.evidence,localClaimScope:proof.localClaimScope,review}))assert.deepEqual(successorMetrics(value),record.metrics[key]);
  assert.equal(proof.proposedPayload,null);assert.equal(proof.financialWrites,0);assert.equal(proof.documentVerification,'UNVERIFIED');
  for(const k of ['workflowEligible','approvalGranted','accepted'])assert.equal(proof[k],false);
  return structuredClone(f);
}
// Mutable in-memory copies only, for retained negative assertions. No fixture is
// regenerated, written, or accepted from these variants.
export function successorFinancialFixture({paid=false}={}) {
  const {input}=loadSuccessorFixture(paid?'paid-positive':'authorised-positive');
  const {source,target,identity}=input;
  function reseal() {
    const payload=supplierFinancialSourcePayload({parent:source.parent,children:source.children,charges:source.charges,buyers:source.buyers,
      safetyContext:source.safetyContext,contacts:identity.contacts,productMappings:input.productMappings});
    source.sourcePayload=JSON.parse(JSON.stringify(payload));source.sourceFingerprint=payload.sourceFingerprint;source.financialFingerprint=payload.financialFingerprint;
    Object.assign(identity.selection,{sourceFingerprint:source.sourceFingerprint,financialFingerprint:source.financialFingerprint});
    identity.sourceClaims=[structuredClone(source.parent)];identity.targetClaims=[structuredClone(target)];
    identity.coverage.sourceCount=identity.sourceClaims.length;identity.coverage.targetCount=identity.targetClaims.length;identity.coverage.creditCount=identity.creditClaims.length;
    identity.coverageFingerprint=hash(Object.fromEntries(Object.entries(identity).filter(([k])=>k!=='coverageFingerprint')));
  }
  assert.equal(input.tenantId,ids.tenant);return {input,source,target,identity,reseal};
}
