import { createPrivateKey } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FCOS_CONNECTION_POLICY, fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { cliSalesforceProvider, loadReviewedSalesforcePlan } from './deploy-salesforce-reviewed-manifest.mjs';
import { assertReviewedJobReport, reviewedJobExpectations, verifyReviewedOrgInventory } from './lib/salesforce-reviewed-release.mjs';
import { assertNativeHandoverState, nativeCompatibilityReader } from './lib/rapid-release/compatibility.mjs';
import { digest, git, requireCondition as check, targets } from './lib/rapid-release/contract.mjs';
import { DeploymentJournal } from './lib/rapid-release/journal.mjs';
import { assertFrozenWorkflow, assertPermanentHandover, githubClient, nativeWorkflowPath, vercelProvider } from './lib/rapid-release/providers.mjs';
import { invoiceClosureResult, originalInvoiceRun as original, verifyStoppedInvoiceClosure } from './lib/rapid-release/invoice-launcher-devee-closure.mjs';

const workflow = '.github/workflows/fcos-rapid-invoice-launcher-devee-closure.yml';
const title = 'Close FCOS Invoice Launcher after DEVEE 44541403747';
const repoPath = '/repos/' + targets().repository;
const policy = FCOS_CONNECTION_POLICY.providers.find(provider=>provider.id==='salesforce');
const approvalEnvironment = 'fcos-production-release';
const owner = person => person?.id === original.actorId && person.login === targets().account;

async function verifyExecution(env) {
  check(env.GITHUB_ACTIONS === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted'
    && env.GITHUB_REPOSITORY === targets().repository && /^[1-9][0-9]*$/u.test(env.GITHUB_RUN_ID || '')
    && env.GITHUB_RUN_ATTEMPT === '1', 'INVOICE_CLOSURE_TRUSTED_RUNNER_REQUIRED');
  const github = githubClient({ token:env.FCOS_RAPID_CLOSURE_GITHUB_TOKEN, candidateSha:original.candidate, actions:false });
  const { user, repo } = await github.identity();
  check(owner(user) && repo.id === original.repositoryId && repo.permissions?.admin === true && repo.default_branch === 'main',
    'INVOICE_CLOSURE_OWNER_REQUIRED');
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
  'INVOICE_CLOSURE_EXECUTION_IDENTITY_MISMATCH');
  const rule = protection.protection_rules?.find(item=>item.type==='required_reviewers');
  check(protection.id === 23178773471 && protection.name === approvalEnvironment && protection.can_admins_bypass === false
    && rule?.reviewers?.some(item=>owner(item.reviewer))
    && approvals.some(item=>item.state==='approved' && owner(item.user)
      && item.environments?.some(environment=>environment.id===protection.id && environment.name===protection.name)),
  'INVOICE_CLOSURE_NATIVE_APPROVAL_REQUIRED');
  const statuses = await Promise.all(['queued','in_progress','waiting','requested','pending'].map(status =>
    github.read(repoPath+'/actions/runs?status='+status+'&per_page=100')));
  check(statuses.every(page=>page.total_count===page.workflow_runs.length && page.total_count<100
    && page.workflow_runs.every(prior=>prior.id===run.id)), 'INVOICE_CLOSURE_COMPETING_RUN');
  return { github, run };
}

async function readClosure(github) {
  const runPath = repoPath+'/actions/runs/'+original.runId;
  const [run,jobs,approvals,records,requests] = await Promise.all([
    github.read(runPath), github.read(runPath+'/jobs?filter=all&per_page=100'), github.read(runPath+'/approvals'),
    github.pages(repoPath+'/deployments?environment=fcos-release-journal-v1&sha='+original.candidate+'&per_page=100'),
    github.pages(repoPath+'/deployments?environment=fcos-release-mirror-handoff-v1&sha='+original.candidate+'&per_page=100'),
  ]);
  return verifyStoppedInvoiceClosure({run,jobs,approvals,records,requests});
}

async function readSalesforcePostimages(env, manifest) {
  const cwd = join(process.cwd(),'original-application');
  check(git(cwd,['rev-parse','HEAD']) === original.candidate && !git(cwd,['status','--porcelain']),
    'INVOICE_CLOSURE_APPLICATION_SOURCE_MISMATCH');
  const locator = manifest.prerequisites.plan;
  const plan = loadReviewedSalesforcePlan({ cwd,policy,manifestPath:locator.salesforceManifestPath,reviewPath:locator.salesforceReviewPath });
  check(plan.fingerprint === original.fingerprint && plan.binding.sourceTreeHash === locator.salesforceSourceTreeHash,
    'INVOICE_CLOSURE_SALESFORCE_SCOPE_MISMATCH');

  const directory = mkdtempSync(join(env.RUNNER_TEMP,'invoice-closure-salesforce-'));
  const commandEnvironment = { HOME:directory, PATH:env.PATH, SF_DISABLE_AUTOUPDATE:'true',
    SF_DISABLE_TELEMETRY:'true', SF_USE_GENERIC_UNIX_KEYCHAIN:'true' };
  try {
    const provider = cliSalesforceProvider({cwd,policy,commandEnvironment});
    const evidence = {};
    for (const name of ['devee','qat','production']) {
      const environment = fcosSalesforceEnvironment(name);
      const prefix = 'FCOS_RAPID_SALESFORCE_' + name.toUpperCase();
      const clientId = env[prefix + '_CLIENT_ID'];
      const privateKey = env[prefix + '_PRIVATE_KEY'];
      check(typeof clientId === 'string' && /^[a-zA-Z0-9._-]+$/u.test(clientId) && privateKey,
        'INVOICE_CLOSURE_SALESFORCE_CREDENTIAL_REQUIRED');
      const key = createPrivateKey(privateKey);
      check(key.asymmetricKeyType === 'rsa' && key.asymmetricKeyDetails.modulusLength >= 2048,
        'INVOICE_CLOSURE_SALESFORCE_KEY_INVALID');
      const keyPath = join(directory, name + '.pem');
      writeFileSync(keyPath,privateKey,{flag:'wx',mode:0o600});
      const login = spawnSync('sf',['org','login','jwt','--username',environment.username,'--client-id',clientId,
        '--jwt-key-file',keyPath,'--instance-url',environment.instanceUrl,'--alias',environment.alias,'--json'],
        {cwd,env:commandEnvironment,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000});
      const result = JSON.parse(login.stdout);
      check(login.status === 0 && result.status === 0 && result.result?.orgId === environment.orgId
        && result.result.username === environment.username && result.result.instanceUrl === environment.instanceUrl,
      'INVOICE_CLOSURE_SALESFORCE_LOGIN_MISMATCH');
      check(provider.verifyIdentity(environment).instanceUrl === environment.instanceUrl, 'INVOICE_CLOSURE_SALESFORCE_ORG_MISMATCH');
      const phase = name === 'devee' ? 'after' : 'before';
      const expected = name === 'devee' ? plan.nativeInventories[name].final : plan.nativeInventories[name].baseline;
      const inventory = await verifyReviewedOrgInventory({provider,environment,plan,expected});
      const placement = await provider.verifyInvoiceAppPlacement(environment,plan,phase);
      check(placement.orgId === environment.orgId && placement.phase === phase
        && /^[0-9a-f]{64}$/u.test(placement.evidenceSha256), 'INVOICE_CLOSURE_PLACEMENT_MISMATCH');
      evidence[name] = { inventory:inventory.evidenceSha256, placement:placement.evidenceSha256 };
      if (name === 'devee') {
        const validation = provider.report(environment,original.validationId);
        const deployment = provider.report(environment,original.deployId);
        const prepared = provider.prepareValidation(environment,plan);
        try {
          check(prepared.packageSha256 === 'e866b6b5164df3233c02ce0fdfb5830de4c926953bf524f702a702236c3a8f14',
            'INVOICE_CLOSURE_PACKAGE_MISMATCH');
        } finally { prepared.cleanup(); }
        evidence[name].reports = [
          assertReviewedJobReport(validation,{ environment,jobId:original.validationId,...reviewedJobExpectations(plan,environment,'validation') }),
          assertReviewedJobReport(deployment,{ environment,jobId:original.deployId,...reviewedJobExpectations(plan,environment,'deployment'),
            quickValidation:{ id:original.validationId,report:validation } }),
        ].map(report=>report.reportSha256);
      }
    }
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
  check(digest(actual) === digest(closure.manifest.previous),'INVOICE_CLOSURE_PRODUCTION_PREIMAGE_CHANGED');
  const salesforce = await readSalesforcePostimages(env,closure.manifest);
  return { baseline:actual,salesforce,observedAt:new Date().toISOString() };
}

async function main(env) {
  const { github,run } = await verifyExecution(env);
  const phase = env.FCOS_CLOSURE_PHASE;
  check(['preflight','append'].includes(phase),'INVOICE_CLOSURE_PHASE_REQUIRED');
  const closure = await readClosure(github);
  if (closure.receipt) return { originalRunId:original.runId,receiptId:closure.receipt.id,providerMetadataWrites:0 };
  const stampPath = join(env.RUNNER_TEMP,`invoice-launcher-devee-closure-${run.id}-1.json`);
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
      /^[0-9a-f]{64}$/u.test(saved.evidence.salesforce?.[name]?.inventory)
      && /^[0-9a-f]{64}$/u.test(saved.evidence.salesforce?.[name]?.placement))
    && saved.evidence.salesforce.devee.reports?.length===2
    && saved.evidence.salesforce.devee.reports.every(hash=>/^[0-9a-f]{64}$/u.test(hash)),
  'INVOICE_CLOSURE_PREFLIGHT_REQUIRED');
  const result = invoiceClosureResult(digest(saved.evidence));
  const journal = new DeploymentJournal({ github,releaseId:original.releaseId,manifestHash:original.manifestHash,
    actorIds:[original.actorId,original.workflowActorId] });
  try { await journal.append('prerequisites.result',result,{expectedPreviousHash:original.oldHead}); }
  catch { /* Resolve the original append by readback only. */ }
  const { receipt } = await readClosure(github);
  check(receipt && digest(receipt.payload.data)===digest(result),'INVOICE_CLOSURE_APPEND_OUTCOME_UNCERTAIN');
  return { originalRunId:original.runId,receiptId:receipt.id,providerMetadataWrites:0 };
}

main(process.env).then(result=>console.log(JSON.stringify(result))).catch(error=>{
  const code = error?.code || error?.message;
  console.error(/^(?:INVOICE_CLOSURE|JOURNAL|GITHUB|SALESFORCE)_[A-Z_]+$/u.test(code) ? code : 'INVOICE_CLOSURE_READBACK_FAILED');
  process.exitCode=1;
});
