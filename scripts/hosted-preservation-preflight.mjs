import {realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateHostedDiscoveryDispatch} from './hosted-release-manifest.mjs';
import {collectSourceAdmission} from './lib/hosted-release/admission.mjs';
import {githubClient} from './lib/hosted-release/github.mjs';
import {collectPreservationSnapshot,dependencyHash} from './lib/hosted-release/dependencies.mjs';
import {openPreservationMembership} from './lib/hosted-release/preservation-preflight.mjs';
import {writeJson} from './lib/hosted-release/session.mjs';

/** Separate DISCOVERY ONLY contract. No manifest, release evidence, coordinator,
 * candidate execution, write authority or raw membership leaves this entrypoint. */
export async function preservationPreflight({env=process.env,now=Date.now,validateDispatchOnly=false,createGithub=githubClient,
  collectSource=collectSourceAdmission,Client,wait}={}) {
  const report={schemaVersion:1,kind:'fcos_preservation_preflight_discovery_v1',discoveryOnly:true,status:'incomplete',readOnly:true,
    financialAuthority:false,releaseEvidenceAccepted:false,qualificationAccepted:false,activationAccepted:false,failures:[]};
  try {
    const allowed=new Set(['GITHUB_TOKEN','FCOS_HOSTED_GITHUB_READ_TOKEN']);
    if(Object.entries(env).some(([k,v])=>v&&(/(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|ACCESS_KEY|CREDENTIAL)/.test(k)&&!allowed.has(k)
      ||/DATABASE_URL/.test(k)&&k!=='FCOS_HOSTED_PRESERVATION_DATABASE_URL')))throw Error('PRESERVATION_CREDENTIAL_BOUNDARY');
    const admission=await validateHostedDiscoveryDispatch({env,now,validateDispatchOnly,createGithub,wait,preservationPreflight:true});
    const {setup,controllerDirectory,jobId,jobStartedAt}=admission;
    report.binding={setupSha256:dependencyHash(setup),controllerSha:setup.controllerSha,candidateSha:setup.candidateSha,targets:setup.targets,
      qualificationSource:setup.qualificationSource,membershipFileSha256:setup.membership.fileSha256,envelopeSha256:setup.membership.envelopeSha256,runId:env.GITHUB_RUN_ID,jobId,jobStartedAt};
    if(validateDispatchOnly)report.status='admitted_discovery_only';
    else {
      const source=collectSource({controllerDirectory,candidateDirectory:resolve(env.FCOS_CANDIDATE_DIRECTORY||'candidate'),controllerSha:setup.controllerSha,candidateSha:setup.candidateSha,sourceProfile:'frozen_04ee'});
      if(source.candidate?.sha!==setup.candidateSha||source.candidate.sourceProfile!=='frozen_04ee'||source.controller?.sha!==setup.controllerSha)throw Error('PRESERVATION_SOURCE_CHANGED');
      report.source={candidate:source.candidate,controller:source.controller};
      const github=createGithub({token:env.FCOS_HOSTED_GITHUB_READ_TOKEN||env.GITHUB_TOKEN,repositoryId:env.GITHUB_REPOSITORY_ID});
      const file=await github.read(`/repos/${setup.targets.repository}/contents/${setup.membership.path}?ref=${setup.qualificationSource.bootstrapSha}`);
      if(file.type!=='file'||file.path!==setup.membership.path||file.encoding!=='base64'||typeof file.content!=='string'||file.content.length>2100000)throw Error('PRESERVATION_PRIVATE_HANDOFF_INVALID');
      const encrypted=Buffer.from(file.content,'base64'),plain=openPreservationMembership(encrypted,{candidateSha:setup.candidateSha,project:setup.targets.supabaseProject,
        membershipSha256:setup.membership.fileSha256,envelopeSha256:setup.membership.envelopeSha256,connection:env.FCOS_HOSTED_PRESERVATION_DATABASE_URL});
      let membership;try{membership=JSON.parse(plain.toString('utf8'));}finally{plain.fill(0);}
      if(Object.hasOwn(membership,'manifestHash'))throw Error('PRESERVATION_PRIVATE_HANDOFF_INVALID');
      if(now()>=setup.notAfter||now()>=Date.parse(jobStartedAt)+900000)throw Error('PRESERVATION_PREFLIGHT_EXPIRED');
      const observed=await collectPreservationSnapshot({targets:setup.targets,membership,env,now,...(Client?{Client}:{})});
      if(now()>=setup.notAfter||now()>=Date.parse(jobStartedAt)+900000)throw Error('PRESERVATION_PREFLIGHT_EXPIRED');
      report.status='observed';report.capturedAt=observed.capturedAt;report.observation={...observed.result,membershipFileSha256:setup.membership.fileSha256};
    }
  } catch(error) {
    const code=error.code||error.message;report.failures=[{code:typeof code==='string'&&/^(?:PRESERVATION_|DISCOVERY_|CONTROLLER_|SETUP_|QUALIFICATION_|GITHUB_)[A-Z_]+$/.test(code)?code:'PRESERVATION_PREFLIGHT_FAILED'}];
  }
  writeJson(env.FCOS_PRESERVATION_PREFLIGHT_OUTPUT||'preservation-preflight.json',report);return report;
}
if(process.argv[1]&&realpathSync(resolve(process.argv[1]))===realpathSync(fileURLToPath(import.meta.url))) {
  const args=process.argv.slice(2);
  if(args.some(a=>a!=='--validate-dispatch-only')||args.length>1)process.exitCode=1;
  else preservationPreflight({validateDispatchOnly:args.includes('--validate-dispatch-only')}).then(r=>{console.log(JSON.stringify({status:r.status,discoveryOnly:true}));if(r.failures.length)process.exitCode=1;});
}
