// Hermetic fixture only. This does not represent an actual OAuth exchange,
// privileged setup review, hosted credential or provider permission proof.
import { digest, releaseTargets } from '../../scripts/lib/hosted-release/contract.mjs';
import { VERCEL_READ_SCOPES } from '../../scripts/lib/hosted-release/vercel-read-auth.mjs';
export function vercelReadFixture({now=Date.now(),token='vci_PRIVATE_HERMETIC_FIXTURE_'+ 'x'.repeat(43),targets=releaseTargets()}={}) {
  const credential={bearerSha256:digest(token),clientId:'oac_fixtureClient',integrationId:'oac_fixtureClient',configurationId:'icfg_fixtureConfig',
    teamId:targets.vercelTeam,projectId:targets.vercelProject,scopes:[...VERCEL_READ_SCOPES],issuedAt:now-60000,notAfter:now+86400000};
  const oauthExchangeReceiptSha256='f'.repeat(64);
  const review={schemaVersion:1,kind:'fcos_root_accepted_vercel_oauth_exchange',accepted:true,reviewerId:'/root',operator:'hocheunglai-oss',
    reviewedAt:new Date(now-30000).toISOString(),originalExchangeReceiptSha256:oauthExchangeReceiptSha256,configurationReadbackSha256:'e'.repeat(64),credential};
  const json=JSON.stringify(review),acceptance={json,sha256:digest(json)};
  const binding={schemaVersion:1,kind:'fcos_vercel_read_integration',...credential,oauthExchangeReceiptSha256,rootAcceptanceSha256:acceptance.sha256};
  const configuration={type:'integration-configuration',id:credential.configurationId,integrationId:credential.integrationId,
    ownerId:credential.teamId,teamId:credential.teamId,projectSelection:'selected',projects:[credential.projectId],scopes:[...credential.scopes],status:'ready'};
  return {token,binding,acceptance,configuration,review};
}
export function admitVercelReadFixture(manifest, options={}) {
  manifest.epoch??=2;
  const fixture=vercelReadFixture({...options,targets:manifest.targets});
  manifest.verification={runtime:{image:`ghcr.io/hocheunglai-oss/fcos-release-checks@sha256:${'a'.repeat(64)}`,node:'v24.18.0',python:'Python 3.11.2',platform:'linux',arch:'x64'},
    publicBuildEnvironment:{},projectSettings:{},...manifest.verification,vercelReadCredential:fixture.binding};
  const setup={schemaVersion:2,controllerSha:manifest.controller.sha,epoch:manifest.epoch,targetsSha256:digest(manifest.targets),verification:manifest.verification,
    ...(manifest.qualificationSource?{qualificationSource:manifest.qualificationSource}:{}),vercelReadCredentialAcceptance:fixture.acceptance};
  manifest.setupSha256=digest(setup);
  return {...fixture,setup,env:{FCOS_HOSTED_VERCEL_READ_TOKEN:fixture.token,FCOS_ADMITTED_RELEASE_SETUP:JSON.stringify(setup),FCOS_ADMITTED_RELEASE_SETUP_SHA256:digest(setup),
    GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:manifest.targets.repository,GITHUB_REPOSITORY_ID:'1278654816',GITHUB_REF:'refs/heads/main',GITHUB_REF_PROTECTED:'true',
    GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ID:'1',FCOS_CONTROLLER_SHA:manifest.controller.sha}};
}
