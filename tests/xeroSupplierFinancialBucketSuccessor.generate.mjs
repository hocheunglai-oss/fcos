// Explicit offline generator. Tests never import or invoke this file.
// Produces NEW SYNTHETIC successor bytes only; no originals or live acceptance.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
const FAMILY = 'xero-supplier-financial-bucket-successor-v1-20261006';
const PROPOSAL_SHA256 = 'b6f151ba89afccfeab04e036de26811b10ca2fa630913aae95fd2c9205d3a900';
const HUMAN_DECISION_SHA256 = '3035f973767af9f1019b8ddc4e7e799c799419c38bfafc9c9ea4090fdcfa7868';
const SOURCE_BINDINGS = {
  "api/_xeroAccountingLineCents.js": "b4bf24acaf852b0780b6d84e872ac6e744719e8ea81b687ed2cf18a3d564d68a",
  "api/_xeroAggregateSupplierDates.js": "76679c4f37d91c87381d2a28d49ef7d30353531cc744906f5d1c9a4abb5d1c0d",
  "api/_xeroDocumentSafety.js": "4e89ad62c785a986d4771ee8becf4975c48caedea6685c6ee25283e2e9bde7ca",
  "api/_xeroFinancialSync.js": "41b88b649de755c9514022a3d1d4cb7a47e11030f8a43e88e1618934439b9d14",
  "api/_xeroIssuedPetroleumOwnership.js": "95bfbdac32be05b249e0df5e922c855193d901fc9ad77e000222241bedd1fc9e",
  "api/_xeroIssuedSupplierPreservation.js": "6445d50194b3ce9c26b5c11f435ea30309aa00f13242e2f1ddca515b81ee8499",
  "api/_xeroPaidSupplierProofJson.js": "f88a6991f1eed8ba785d83af74106fa0c5e449e971e73bfaaf15c558099d040f",
  "api/_xeroPreviewPersistence.js": "952150e08fb933f300ce26330db00631ee57be73c39b167a481f72b3b6ede68e",
  "api/_xeroSettledSupplierPaymentProof.js": "3f97941cb47c64ffe679664908fee11ea898f4e78494bd4965cf387b232a41de",
  "api/_xeroSupplierFinancialBucketPreservation.js": "846dff0df27eee2772b7c2b57cf98e6fd2de8c1387feccc97649664c88750487",
  "config/fcosConnections.js": "e826d82510a8aeabfa285a66e8d1c546265347536c6f17a7b861cff8c5da0c15",
  "package-lock.json": "0f35c1e123ab566f5d065d187bc0b8a7d1e05f7968ec31a03cd67ac0070aa0ef",
  "package.json": "ec6f54ad36bdfdbf4e895d6572782d87fcd21fb7325f36b82b673789d401f17f",
  "supabase/migrations/20260707163000_dispute_beta_workflow.sql": "c249086db161bbed9ebc5a5078edb3c655f26051885865bf8547007a7057f53b",
  "supabase/migrations/20260827145608_xero_contact_sync.sql": "e80224fcf23902cf49fc691fd9509c6b7eedba911c34170012557caa18bdccfc",
  "supabase/migrations/20260829080726_xero_financial_sync.sql": "a87bdf6fdc4b23a3d612d37d26580414f4bfcf97412413f1500791a92bfabe30",
  "supabase/migrations/20260923210832_xero_financial_selection_scope.sql": "7073ac71a9b83d3acc583c57d14618a13e7c13266d8184608ef8fb4528d33aeb",
  "supabase/migrations/20260923213339_xero_payment_reference_link.sql": "b8272d733760e146e9321e4f7766a631c98359124a861cedd2765bdf5adcb6fd",
  "supabase/migrations/20260923222821_xero_grouped_preservation_link.sql": "f2affe8e8a300fb8eaa98f32d4361315e2266fcae031c3a1441e8ed33e248d33",
  "supabase/migrations/20260927175805_xero_issued_supplier_preservation_link.sql": "c0389fd7f8dbccb29ddd5803633e447b7249998f1e0ad319b4d11c9f3b26c99b",
  "supabase/migrations/20260927185526_xero_issued_petroleum_preservation_link.sql": "fea7e1413af870e1201cd3f874ffd82521c418c8d83ec7743af4458b91d27461",
  "supabase/migrations/20260927213024_xero_petroleum_inactive_source_ownership.sql": "0ce7ad19cd82c030033104ce5972348d3a60aca26c4271607d4c82b8beb64537",
  "supabase/migrations/20260928033217_xero_issued_petroleum_attachment_preservation_v2.sql": "9de9e3efcce40172b9745c4c56b4fa51884eddecf4b7fb278993868a0f1aa206",
  "supabase/migrations/20260928053229_xero_document_field_correction_journal.sql": "b70a67341dc60c4fba8b74db61dd6dc1dd2321cd5b161774ce6f47cb19a19385",
  "supabase/migrations/20261004105022_xero_aggregate_supplier_preservation_v3.sql": "f0c212ca317c78016495b359e4438d157221f402ca4cc2b28e22459cdea51859",
  "supabase/migrations/20261004123026_xero_aggregate_supplier_component_literals_v3.sql": "bd445e3e72afa72586c7be0cf3412b08b0b8235d04d0586371105b0111ebd9a9",
  "supabase/migrations/20261004135507_xero_settled_supplier_ledger_assert_v1.sql": "c8e8ca9140cc063df176ae25fc12b923bf4907814208fb5f3b9334e2ff7779d4",
  "supabase/migrations/20261004162251_xero_supplier_financial_bucket_link_v1.sql": "520eea32ed0da3577f57af2f2fb98557eb7547457fcc69931ee4e5801672d4eb",
  "tests/xeroSupplierFinancialBucketDatabase.fixture.js": "4660dea5d9656779c674f4c4983a17131b9745729e9d3424377bd89ae4ad16d9",
  "tests/xeroSupplierFinancialBucketDatabase.historical-test.js": "84076347dbe37981561c55c9015bf5e9f74f57b8d562d42f4e42b4119f9da49e",
  "tests/xeroSupplierFinancialBucketPreservation.fixture.js": "edb272bc9f8dd4e997976f12bf1b2ebe6dfd25a91bda9ba7818257c6ac102252",
  "tests/xeroSupplierFinancialBucketPreservation.test.js": "048a8ea327b74d34e9721f8367e02f54d21eb87a861eed818a8f333edf27c6cb",
  "tests/xeroSupplierFinancialSource.fixture.js": "90d4171563b85952f3147f17148d4e3ba8ff9adada4820546e46e1b55538e4e5"
};
const cases = ['authorised-positive','paid-positive','source-half-up','explicit-null-lump','signed-discount','retained-tracking','largest-current-guang-hua6-positive'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const serialize = value => JSON.stringify(value, null, 2) + '\n';
const args = process.argv.slice(2), arg = name => args.find(x => x.startsWith(name+'='))?.slice(name.length+1);
if (!arg('--output')) throw Error('Explicit task-owned --output path required; never generate during tests');
const sourceRoot = resolve(arg('--public-source') || new URL('..', import.meta.url).pathname);
const outputRoot = resolve(arg('--output'));
if (outputRoot === sourceRoot || outputRoot.startsWith(sourceRoot+'/tests')) throw Error('Generation into active source forbidden in preparation mode');
for (const [file, expected] of Object.entries(SOURCE_BINDINGS)) {
  if (sha(await readFile(resolve(sourceRoot,file))) !== expected) throw Error('Changed public source binding: '+file);
}
const { financialFixture } = await import(pathToFileURL(resolve(sourceRoot,'tests/xeroSupplierFinancialBucketPreservation.fixture.js')));
const pure = await import(pathToFileURL(resolve(sourceRoot,'api/_xeroSupplierFinancialBucketPreservation.js')));
const { issuedSupplierCanonical: canonical, issuedSupplierHash: hash } = await import(pathToFileURL(resolve(sourceRoot,'api/_xeroIssuedSupplierPreservation.js')));
const sourceClosure = {};
async function capture(file) {
  if (sourceClosure[file]) return;
  const bytes = await readFile(resolve(sourceRoot,file)); sourceClosure[file] = sha(bytes);
  const text=bytes.toString('utf8');
  for (const match of text.matchAll(/(?:from\s*|import\s*\()['"]([^'"]+)['"]/g)) {
    const spec=match[1]; if (!spec.startsWith('.')) continue;
    const absolute=resolve(sourceRoot,dirname(file),spec),relative=absolute.slice(sourceRoot.length+1);
    if (!absolute.startsWith(sourceRoot+'/') || !/\.(?:js|mjs|json)$/.test(relative)) throw Error('Unbounded source import '+spec);
    await capture(relative);
  }
}
await capture('tests/xeroSupplierFinancialBucketPreservation.fixture.js');
await capture('api/_xeroSupplierFinancialBucketPreservation.js');
function metrics(value) {
  let nodes=0,depth=0; const walk=(v,d)=>{nodes++;depth=Math.max(depth,d);if(v && typeof v==='object')Object.values(v).forEach(x=>walk(x,d+1));};walk(value,0);
  return { ordinaryBytes:Buffer.byteLength(JSON.stringify(value)),canonicalBytes:Buffer.byteLength(canonical(value)),nodes,depth };
}
function setTotal(f,total) {
  f.source.parent.Invoice_Amount__c=total; Object.assign(f.target,{Total:total,SubTotal:total,AmountDue:total});
  Object.assign(f.target.LineItems[0],{UnitAmount:total,LineAmount:total});
}
function derive(name) {
  const paid=['paid-positive','largest-current-guang-hua6-positive'].includes(name), f=financialFixture({paid});
  f.source.parent.Name='SYNTHETIC-SUCCESSOR-V1-'+name.toUpperCase();
  f.source.parent.STEM__r.Vessel__r.Name='SYNTHETIC SUCCESSOR VESSEL';
  f.target.InvoiceNumber='SYNTHETIC-SUCCESSOR-V1-'+name.toUpperCase();
  f.target.Reference='SYNTHETIC ONLY; NOT CURRENT BUSINESS DATA';
  f.identity.coverage.queryFingerprint=hash(FAMILY+':'+name+':synthetic-owner-coverage');
  f.input.sourceDependencies.coverage.queryFingerprint=hash(FAMILY+':'+name+':synthetic-dependencies');
  if(name==='source-half-up') {
    Object.assign(f.source.children[0],{Quantity_Delivered_Per_BDN__c:1,Unit_Buy_At__c:'0.005',Total_Cost__c:'0.01'});setTotal(f,'20050.01');
  }
  if(name==='explicit-null-lump') f.source.charges[0].Unit_Cost__c=null;
  if(name==='signed-discount') {
    Object.assign(f.source.charges[0],{Lumpsum_Cost__c:'-50',Line_Total_Buy__c:'-50'});setTotal(f,'29950');
  }
  if(name==='retained-tracking') f.target.LineItems[0].Tracking=[{TrackingCategoryID:'00000000-0000-4000-8000-000000000088',Name:'SYNTHETIC Job',Option:'SYNTHETIC FCBV',Options:[]}];
  if(name==='largest-current-guang-hua6-positive') {
    // Legacy coverage label only. Deterministic inert text, not real Guang Hua6.
    f.source.parent.STEM__r.Vessel__r.Name='SYNTHETIC LARGE SUCCESSOR VESSEL';
    f.target.LegacyExtension.SyntheticTransportPadding='SYNTHETIC-"\\-'.repeat(18000);
    f.target.LegacyExtension.SyntheticShapeDisclosure='Single nonfinancial extension string; fixed public three-source-line paid shape; no original-case equivalence';
  }
  f.reseal(); const input=structuredClone(f.input),proof=pure.evaluateSupplierFinancialBucketPreservation(input);
  const labels={reviewFingerprintLabel:FAMILY+':'+name+':review',legacyReviewFingerprintLabel:FAMILY+':'+name+':synthetic-legacy-review'};
  const review=pure.supplierFinancialBucketReview(proof,{reviewFingerprint:hash(labels.reviewFingerprintLabel),legacyReviewFingerprint:hash(labels.legacyReviewFingerprintLabel)});
  if(!proof.proofValid || !review) throw Error('Candidate derivation held: '+name+' '+JSON.stringify(proof.blockers));
  const compact=structuredClone(review);for(const key of ['accountingCanonical','evidenceCanonical','localClaimScopeCanonical'])delete compact[key];
  const receipt={contract:'supplier_financial_bucket_link_receipt_v1',originalReview:compact,previewReviewHash:hash(review),executionReviewHash:hash(review),ledgerPaymentProofFingerprint:proof.evidence.accounting.settlement.ledgerPaymentProof?.fingerprint||null};
  const packet={kind:'supplier_financial_bucket_successor_fixture_v1',family:FAMILY,caseName:name,synthetic:true,nonExecutablePreparation:true,recoveredOriginal:false,originalCaseEquivalence:false,currentBusinessCase:false,labels,input,proof,review};
  return {packet,record:{caseName:name,file:'successor-v1-'+name+'.json',logicalRole:paid?'PAID synthetic local preservation':'AUTHORISED synthetic local preservation',labels,inputHash:hash(input),proofHash:hash(proof),evidenceFingerprint:hash(proof.evidence),accountingFingerprint:proof.fingerprint,localClaimScopeHash:hash(proof.localClaimScope),reviewHash:hash(review),approvalMaterialHash:hash(pure.supplierFinancialBucketApprovalMaterial(proof.evidence,proof.localClaimScope)),metrics:{input:metrics(input),proof:metrics(proof),evidence:metrics(proof.evidence),localClaimScope:metrics(proof.localClaimScope),review:metrics(review),compactReceiptProjection:metrics(receipt),targetOriginal:metrics(proof.evidence.accounting.target),sourceOriginal:metrics(proof.evidence.accounting.source),ledgerOriginal:paid?metrics(proof.evidence.accounting.settlement.ledgerPaymentProof.evidence.originals):null},sourceLineCount:proof.evidence.accounting.sourceLines.length,targetLineCount:proof.evidence.accounting.targetLines.length,documentVerification:'UNVERIFIED',financialWrites:0,workflowEligible:false,approvalGranted:false,accepted:false}};
}
const familyDir=resolve(outputRoot,'tests/fixtures/'+FAMILY);await mkdir(familyDir,{recursive:true});
const derived=cases.map(name=>derive(name)),records=[];
for(const {packet,record} of derived) {
 const bytes=Buffer.from(serialize(packet));record.sha256=sha(bytes);record.bytes=bytes.length;
 await writeFile(resolve(familyDir,record.file),bytes,{flag:'wx'});records.push(record);
}
const manifest={kind:'supplier_financial_bucket_successor_manifest_v1',family:FAMILY,version:1,synthetic:true,nonExecutablePreparation:true,recoveredOriginal:false,originalCaseEquivalence:false,currentBusinessCase:false,proposalSha256:PROPOSAL_SHA256,humanDecisionSha256:HUMAN_DECISION_SHA256,serialization:'UTF-8 JSON.stringify(value,null,2) plus LF',generatorSourceSha256:sha(await readFile(new URL(import.meta.url))),sourceBindings:SOURCE_BINDINGS,publicImportClosure:sourceClosure,records,coverage:['authorised-positive','paid-positive','source-half-up','explicit-null-lump','signed-discount','retained-tracking','large synthetic transport envelope'],historicalGap:'Missing original PURE2/EXTRA bytes and historical test closure remain unresolved. New synthetic successor only.',largeShape:'PAID public financialFixture with three source lines, one target line and one ledger payment; deterministic inert extension padding. Size stress only; no current Guang Hua6 identity/data or original-case equivalence.',verificationExecuted:false,liveAcceptance:false};
const bytes=Buffer.from(serialize(manifest));await writeFile(resolve(familyDir,'successor-v1-manifest.json'),bytes,{flag:'wx'});
process.stdout.write(JSON.stringify({manifestSha256:sha(bytes),records:records.map(r=>({caseName:r.caseName,sha256:r.sha256,bytes:r.bytes,metrics:r.metrics}))},null,2)+'\n');
