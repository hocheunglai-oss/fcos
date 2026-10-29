import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {digest} from '../../scripts/lib/hosted-release/json-contract.mjs';
import {planCompletionSubject} from '../../scripts/lib/hosted-release/qualification-plan-completion.mjs';
export const INPUTS={
 installation:[new URL('../fixtures/qualification-plan-completion/installation.json',import.meta.url),'df87d1c79c39baf3a26c0fd315896bedd4994eeeecf3c3bb39dcd215e2690f0b'],
 bootstrap:[new URL('../fixtures/qualification-plan-completion/bootstrap.json',import.meta.url),'1d52afad0d56fd8eb656899361d53c91e873a80fa87ddcaa8e61f442b99baba8'],
 quarantine:[new URL('../fixtures/qualification-plan-completion/quarantine.json',import.meta.url),'84e1a473d3cb3e18b6dafc6a66cefca7fb69d86904b7d0719716700f3876e632'],
 recovery:[new URL('../fixtures/qualification-plan-completion/recovery.json',import.meta.url),'e9769dc0872c4b9c8663da7754e5ad1c4cff605eccad6dbd556e66cc6636c1d9'],
 subject:[new URL('../fixtures/qualification-plan-completion/subject.json',import.meta.url),'4e81adccadf0279aa632f6948ee71d94d0ad2267efefe2e657d93f18396cca35'],
 manifest:[new URL('../fixtures/qualification-plan-completion/manifest.json',import.meta.url),'c777bc3a7e6b014f50e39209b53308663a25d8ed72148db6a331038e576a52c9'],
};
export const rawHash=v=>createHash('sha256').update(v).digest('hex');
export function pinnedInput(name){const [p,h]=INPUTS[name],bytes=readFileSync(p);if(rawHash(bytes)!==h)throw Error('PLAN_COMPLETION_TEST_INPUT_DRIFT:'+name);return JSON.parse(bytes);}
/** These are explicitly SYNTHETIC local-test reviews, never actual authority. */
export function testReviews(p){p=structuredClone(planCompletionSubject(p));const common={kind:'fcos_qualification_plan_completion_review_v1',accepted:true,subjectSha256:digest(p),sourceEvidenceSha256:digest('SYNTHETIC local PostgreSQL17 review only'),reviewedAt:'2026-10-21T21:00:00Z'};return {...p,rootReview:{...common,role:'root',reviewerId:'/root'},independentReview:{...common,role:'independent',reviewerId:'/root/canonical_publication_review'}};}
export function actualPlanFixture(){const activation=pinnedInput('installation').parameters[1],original=pinnedInput('bootstrap'),quarantine=pinnedInput('quarantine'),recovery=pinnedInput('recovery'),proof=testReviews(pinnedInput('subject')),manifest=pinnedInput('manifest');
 const source=recovery.setup.qualificationSource,scope={epoch:1,owner:{kind:'release',id:'features'},releaseId:manifest.releaseId,manifestHash:digest(manifest)};
 const principal={kind:'github',qualificationOnly:true,repositoryId:original.repositoryId,actorId:original.operatorId,actor:original.operatorLogin,ref:source.ref,sha:source.bootstrapSha,workflowSha:source.bootstrapSha,workflowRef:source.callerWorkflowRef,jobWorkflowSha:source.controllerSha,jobWorkflowRef:`hocheunglai-oss/fcos/.github/workflows/hosted-release-controller.yml@${source.controllerSha}`,runId:'103',runAttempt:'1',qualificationAdmission:{repository:original.repository,repositoryId:original.repositoryId,ref:source.ref,bootstrapSha:source.bootstrapSha,callerWorkflowRef:source.callerWorkflowRef,callerWorkflowSha:source.bootstrapSha,jobWorkflowRef:`hocheunglai-oss/fcos/.github/workflows/hosted-release-controller.yml@${source.controllerSha}`,jobWorkflowSha:source.controllerSha,candidateSha:source.candidateSha,setupSha256:recovery.setupSha256}};
 return {activation,original,quarantine,recovery,proof,manifest,scope,principal,H:digest('SYNTHETIC local native ACK only')};}
export function repinPlanProof(p){p=structuredClone(p);p.planSha256=digest(p.plan);p.manifestPreflight.planSha256=p.planSha256;return testReviews(p);}
