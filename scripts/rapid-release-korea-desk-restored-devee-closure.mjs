import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';
import { cliSalesforceProvider, loadReviewedSalesforcePlan } from './deploy-salesforce-reviewed-manifest.mjs';
import { assertReviewedJobReport, reviewedJobExpectations, verifyReviewedOrgInventory } from './lib/salesforce-reviewed-release.mjs';
import { assertNativeHandoverState, nativeCompatibilityReader } from './lib/rapid-release/compatibility.mjs';
import { authenticateHostedSalesforce } from './lib/rapid-release/salesforce-hosted-auth.mjs';
import { digest, git, requireCondition as check, targets } from './lib/rapid-release/contract.mjs';
import { DeploymentJournal } from './lib/rapid-release/journal.mjs';
import { assertFrozenWorkflow, assertPermanentHandover, githubClient, nativeWorkflowPath, vercelProvider } from './lib/rapid-release/providers.mjs';
import { koreaDeskClosureResult, originalKoreaDeskRun as original, verifyStoppedKoreaDeskClosure } from './lib/rapid-release/korea-desk-restored-devee-closure.mjs';

const workflow = '.github/workflows/fcos-rapid-korea-desk-restored-devee-closure.yml';
const title = 'Close FCOS Korea Desk maintenance after DEVEE restoration 45565625886';
const repoPath = '/repos/' + targets().repository;
const policy = FCOS_CONNECTION_POLICY.providers.find(provider=>provider.id==='salesforce');
const approvalEnvironment = 'fcos-production-release';
const owner = person => person?.id === original.actorId && person.login === targets().account;

async function verifyExecution(env) {
  check(env.GITHUB_ACTIONS === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted'
    && env.GITHUB_REPOSITORY === targets().repository && /^[1-9][0-9]*$/u.test(env.GITHUB_RUN_ID || '')
    && env.GITHUB_RUN_ATTEMPT === '1', 'KOREA_MAINTENANCE_CLOSURE_TRUSTED_RUNNER_REQUIRED');
  const github = githubClient({ token:env.FCOS_RAPID_CLOSURE_GITHUB_TOKEN, candidateSha:original.candidate, actions:false });
  const { user, repo } = await github.identity();
  check(owner(user) && repo.id === original.repositoryId && repo.permissions?.admin === true && repo.default_branch === 'main',
    'KOREA_MAINTENANCE_CLOSURE_OWNER_REQUIRED');
  const runPath = repoPath + '/actions/runs/' + env.GITHUB_RUN_ID;
  const [run, main, pointer, enabled, history, protection, approvals] = await Promise.all([
    github.read(runPath), github.read(repoPath+'/branches/main'),
    github.read(repoPath+'/actions/variables/FCOS_RAPID_RELEASE_HANDOVER_ID'),
    github.read(repoPath+'/actions/variables/FCOS_RAPID_RELEASE_ENABLED'),
    github.read(repoPath+'/actions/workflows/'+workflow.split('/').at(-1)+'/runs?event=workflow_dispatch&per_page=100'),
    github.read(repoPath+'/environments/'+approvalEnvironment), github.read(runPath+'/approvals'),
  ]);
  check(run.status === 'in_progress' && run.run_attempt === 1 && run.event === 'workflow_dispatch'
    && run.head_branch === 'main' && run.head_sha === env.GITHUB_SHA && git(process.cwd(), ['rev-parse','HEAD']) === env.GITHUB_SHA
    && main.protected === true && main.commit.sha === env.GITHUB_SHA && run.repository?.id === original.repositoryId
    && owner(run.actor) && owner(run.triggering_actor) && nativeWorkflowPath(run) === workflow && run.display_title === title
    && pointer.value === String(original.handoverId) && enabled.value === 'true'
    && history.total_count === 1 && history.workflow_runs?.[0]?.id === run.id,
  'KOREA_MAINTENANCE_CLOSURE_EXECUTION_IDENTITY_MISMATCH');
  const rule = protection.protection_rules?.find(item=>item.type==='required_reviewers');
  check(protection.id === 23178773471 && protection.name === approvalEnvironment && protection.can_admins_bypass === false
    && rule?.reviewers?.some(item=>owner(item.reviewer))
    && approvals.some(item=>item.state==='approved' && owner(item.user)
      && item.environments?.some(environment=>environment.id===protection.id && environment.name===protection.name)),
  'KOREA_MAINTENANCE_CLOSURE_NATIVE_APPROVAL_REQUIRED');
  const statuses = await Promise.all(['queued','in_progress','waiting','requested','pending'].map(status =>
    github.read(repoPath+'/actions/runs?status='+status+'&per_page=100')));
  check(statuses.every(page=>page.total_count===page.workflow_runs.length && page.total_count<100
    && page.workflow_runs.every(prior=>prior.id===run.id)), 'KOREA_MAINTENANCE_CLOSURE_COMPETING_RUN');
  return { github, run };
}

async function readClosure(github) {
  const runPath = repoPath+'/actions/runs/'+original.runId;
  const [run,jobs,approvals,records,requests] = await Promise.all([
    github.read(runPath), github.read(runPath+'/jobs?filter=all&per_page=100'), github.read(runPath+'/approvals'),
    github.pages(repoPath+'/deployments?environment=fcos-release-journal-v1&sha='+original.candidate+'&per_page=100'),
    github.pages(repoPath+'/deployments?environment=fcos-release-mirror-handoff-v1&sha='+original.candidate+'&per_page=100'),
  ]);
  return verifyStoppedKoreaDeskClosure({run,jobs,approvals,records,requests});
}

async function readSalesforcePostimages(env, manifest) {
  const cwd = join(process.cwd(),'original-application');
  check(git(cwd,['rev-parse','HEAD']) === original.candidate && !git(cwd,['status','--porcelain']),
    'KOREA_MAINTENANCE_CLOSURE_APPLICATION_SOURCE_MISMATCH');
  const locator = manifest.prerequisites.plan;
  const plan = loadReviewedSalesforcePlan({ cwd,policy,manifestPath:locator.salesforceManifestPath,reviewPath:locator.salesforceReviewPath });
  check(plan.fingerprint === original.fingerprint && plan.binding.sourceTreeHash === locator.salesforceSourceTreeHash,
    'KOREA_MAINTENANCE_CLOSURE_SALESFORCE_SCOPE_MISMATCH');

  const directory = mkdtempSync(join(env.RUNNER_TEMP,'korea-maintenance-closure-salesforce-'));
  try {
    const commandEnvironment = authenticateHostedSalesforce({
      directory,cwd,env:{...env,HOME:directory},requireMirrorCredential:false,
    });
    const provider = cliSalesforceProvider({cwd,policy,commandEnvironment});
    const inventory = await Promise.all(policy.environments.map(async environment => {
      const expected = plan.nativeInventories[environment.key].baseline;
      const observed = await verifyReviewedOrgInventory({provider,environment,plan,expected});
      return [environment.key, {inventory:observed.evidenceSha256}];
    }));
    const evidence = Object.fromEntries(inventory);
    const devee = policy.environments.find(item=>item.key==='devee');
    const validation = provider.report(devee,original.validationId);
    const deployment = provider.report(devee,original.deployId);
    const restored = provider.report(devee,original.restorationId);
    evidence.devee.reports = [
      assertReviewedJobReport(validation,{environment:devee,jobId:original.validationId,
        ...reviewedJobExpectations(plan,devee,'validation')}),
      assertReviewedJobReport(deployment,{environment:devee,jobId:original.deployId,
        ...reviewedJobExpectations(plan,devee,'deployment'),
        quickValidation:{id:original.validationId,report:validation}}),
      assertReviewedJobReport(restored,{environment:devee,jobId:original.restorationId,
        ...reviewedJobExpectations(plan,devee,'deployment')}),
    ].map(report=>report.reportSha256);
    return evidence;
  } finally { rmSync(directory,{recursive:true,force:true}); }
}

async function verifyPreimage({ github, closure, env }) {
  const handoverRecord = await github.read(repoPath+'/deployments/'+original.handoverId);
  const handover = assertPermanentHandover(handoverRecord,closure.manifest,original.actorId);
  await assertFrozenWorkflow({ github,controllerSha:original.controller,dispatcherSha:original.dispatcher });
  const provider = vercelProvider({ manifest:closure.manifest,env });
  const [alias] = await Promise.all([
    nativeCompatibilityReader({provider,env})({manifest:closure.manifest}),
    assertNativeHandoverState({handover,env}),
  ]);
  const actual = { sha:alias.sha,deploymentId:alias.currentDeploymentId,configurationDigest:alias.configurationDigest,schemaDigest:alias.schemaDigest };
  check(digest(actual) === digest(closure.manifest.previous),'KOREA_MAINTENANCE_CLOSURE_PRODUCTION_PREIMAGE_CHANGED');
  const salesforce = await readSalesforcePostimages(env,closure.manifest);
  return { baseline:actual,salesforce,observedAt:new Date().toISOString() };
}

async function main(env) {
  const { github,run } = await verifyExecution(env);
  const phase = env.FCOS_CLOSURE_PHASE;
  check(['preflight','append'].includes(phase),'KOREA_MAINTENANCE_CLOSURE_PHASE_REQUIRED');
  const closure = await readClosure(github);
  if (closure.receipt) return { originalRunId:original.runId,receiptId:closure.receipt.id,providerMetadataWrites:0 };
  const stampPath = join(env.RUNNER_TEMP,`korea-desk-restored-devee-closure-${run.id}-1.json`);
  const stamp = { runId:run.id,attempt:1,source:env.GITHUB_SHA,originalHead:original.oldHead };
  if (phase==='preflight') {
    const evidence = await verifyPreimage({github,closure,env});
    writeFileSync(stampPath,JSON.stringify({stamp,evidence}),{flag:'wx',mode:0o600});
    return { originalRunId:original.runId,preflightVerified:true,providerMetadataWrites:0 };
  }
  const saved = JSON.parse(readFileSync(stampPath,'utf8'));
  const observedAt = Date.parse(saved.evidence?.observedAt);
  check(digest(saved.stamp)===digest(stamp) && observedAt<=Date.now() && Date.now()-observedAt<180000
    && digest(saved.evidence.baseline)===digest(closure.manifest.previous)
    && ['devee','qat','production'].every(name =>
      /^[0-9a-f]{64}$/u.test(saved.evidence.salesforce?.[name]?.inventory))
    && saved.evidence.salesforce.devee.reports?.length===3
    && saved.evidence.salesforce.devee.reports.every(hash=>/^[0-9a-f]{64}$/u.test(hash)),
  'KOREA_MAINTENANCE_CLOSURE_PREFLIGHT_REQUIRED');
  const result = koreaDeskClosureResult(digest(saved.evidence));
  const journal = new DeploymentJournal({ github,releaseId:original.releaseId,manifestHash:original.manifestHash,
    actorIds:[original.actorId,original.workflowActorId] });
  try { await journal.append('prerequisites.result',result,{expectedPreviousHash:original.oldHead}); }
  catch { /* Resolve the original append by readback only. */ }
  const { receipt } = await readClosure(github);
  check(receipt && digest(receipt.payload.data)===digest(result),'KOREA_MAINTENANCE_CLOSURE_APPEND_OUTCOME_UNCERTAIN');
  return { originalRunId:original.runId,receiptId:receipt.id,providerMetadataWrites:0 };
}

main(process.env).then(result=>console.log(JSON.stringify(result))).catch(error=>{
  const code = error?.code || error?.message;
  console.error(/^(?:KOREA_MAINTENANCE_CLOSURE|JOURNAL|GITHUB|SALESFORCE)_[A-Z_]+$/u.test(code) ? code : 'KOREA_MAINTENANCE_CLOSURE_READBACK_FAILED');
  process.exitCode=1;
});
