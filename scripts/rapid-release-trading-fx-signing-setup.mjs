import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { digest, git, requireCondition as check, sourceSnapshot, targets } from './lib/rapid-release/contract.mjs';
import { assertFrozenWorkflow, assertPermanentHandover, githubClient, nativeWorkflowPath, vercelProvider } from './lib/rapid-release/providers.mjs';
import { assertNativeHandoverState, nativeCompatibilityReader } from './lib/rapid-release/compatibility.mjs';
import { DeploymentJournal, pendingOperations } from './lib/rapid-release/journal.mjs';
import { authenticateHostedSalesforce } from './lib/rapid-release/salesforce-hosted-auth.mjs';
import { verifyTradingFxManualPredecessor } from './lib/rapid-release/trading-fx-failed-bootstrap-closure.mjs';
import { executeSigningSetup, validateSigningSetupPlan } from './lib/rapid-release/trading-fx-signing-setup.mjs';
import { createSigningVercelDriver } from './lib/rapid-release/trading-fx-signing-setup-vercel.mjs';
import { createSigningSalesforceDriver } from './lib/rapid-release/trading-fx-signing-setup-salesforce.mjs';
import { createSigningReceiptDriver } from './lib/rapid-release/trading-fx-signing-setup-receipt.mjs';
import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';

const workflow = '.github/workflows/fcos-rapid-trading-fx-signing-setup.yml';
const ownerId = 265701760, botId = 41898282, repoId = 1278654816;
const manualSha = 'd2e5f1f94898ae99c6188831d071a77c337f31ae';
const manualReleaseId = 'manual-on-demand-nomination-qualification';
const baseApplication = '91a5298b44c7cadb968a614ff79d3934a8f41c9c';
const originalDeployment = 'dpl_ExTGURNUM9UcEGriSK1RzjzZ1ggA';
const manualDeployment = 'dpl_EybnQs2MEgz3z2M2kJH74i9yGw38';
const tradingApplications = Object.freeze({
  promoted_observed:'b495d1bde6d06834c32212982c4597e20e6c7fe0',
  closed_without_promotion:'90cbbf0f1786f539037851760b40421ce0fc85d9',
});
const manualHash = '98fa7ae01015ef8d4386b0baedee42acb2e016940ee4729138ba06e3e95ac947';

function verifyPlanSource(plan, {env, controller, candidate}) {
  check(plan.candidateSha === tradingApplications[plan.terminalManualOutcome]
    && plan.previous.sha === (plan.terminalManualOutcome === 'promoted_observed' ? manualSha : baseApplication)
    && plan.previous.deploymentId === (plan.terminalManualOutcome === 'promoted_observed' ? manualDeployment : originalDeployment),
  'SIGNING_SETUP_EXACT_SOURCE_SCOPE_REQUIRED');
  check(git(controller,['rev-parse','HEAD']) === plan.controllerSha && !git(controller,['status','--porcelain']),
    'SIGNING_SETUP_CONTROLLER_CHECKOUT_CHANGED');
  const snapshot = sourceSnapshot(candidate), planHash = validateSigningSetupPlan(plan);
  check(snapshot.sha === plan.candidateSha && snapshot.sourceDigest === plan.sourceDigest
    && planHash === env.FCOS_SIGNING_PLAN_HASH,'SIGNING_SETUP_CANDIDATE_CHECKOUT_CHANGED');
  return {snapshot, planHash};
}

async function verifyTerminalManual({plan, github, snapshot, base, run}) {
  check(run.id === plan.manualRunId && run.actor?.id === ownerId && run.repository?.id === repoId
    && run.run_attempt === 1 && run.status === 'completed' && run.event === 'workflow_dispatch'
    && nativeWorkflowPath(run) === '.github/workflows/fcos-rapid-release.yml'
    && run.display_title === 'FCOS rapid resume '+manualHash+' '+manualSha,'SIGNING_SETUP_ORIGINAL_MANUAL_GATE_OPEN');
  const journal = new DeploymentJournal({github:{...github,candidateSha:manualSha},manifestHash:manualHash,
    releaseId:manualReleaseId,actorIds:[botId]});
  const chain = await journal.read();
  const original = chain.find(row => row.payload.event === 'release.prepared')?.payload.data.manifest;
  check(original && original.previous.sha === baseApplication && original.previous.deploymentId === originalDeployment
    && original.previous.configurationDigest === plan.previous.configurationDigest && original.previous.schemaDigest === plan.previous.schemaDigest,
  'SIGNING_SETUP_MANUAL_BASELINE_CHANGED');
  if (plan.terminalManualOutcome === 'promoted_observed') {
    await verifyTradingFxManualPredecessor({manifest:{candidate:snapshot,previous:plan.previous,build:original.build},
      previous:original,github,ownerId});
  } else {
    const [reviews,jobs] = await Promise.all([github.read(base+'/actions/runs/'+run.id+'/approvals'),
      github.read(base+'/actions/runs/'+run.id+'/attempts/1/jobs?per_page=100')]);
    const apply = jobs.jobs.filter(job => job.name === 'go-live');
    check(['cancelled','failure'].includes(run.conclusion) && !pendingOperations(chain).length
      && chain.every(row => !/^(approval\.|prerequisites\.|promote\.|rollback\.|live\.|release\.complete)/u.test(row.payload.event))
      && !reviews.some(review => review.state === 'approved') && apply.length === 1
      && ['cancelled','skipped','failure'].includes(apply[0].conclusion) && (apply[0].steps ?? []).length === 0,
    'SIGNING_SETUP_MANUAL_TERMINAL_EFFECT_UNCERTAIN');
  }
}

async function readNativeApproval({ plan, planHash, original, github, snapshot, env, assertReady }) {
  const pins = targets(), base = '/repos/'+pins.repository;
  check(env.GITHUB_ACTIONS === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted'
    && env.GITHUB_REPOSITORY === pins.repository && /^[1-9]\d*$/u.test(env.GITHUB_RUN_ID || ''),
  'SIGNING_SETUP_HOSTED_RUNNER_REQUIRED');
  const runId = Number(env.GITHUB_RUN_ID), endpoint = base+'/actions/runs/'+runId;
  const [{user,repo},native,main,enabled,pointer,environment,jobs,reviews,manual] = await Promise.all([
    github.identity(),github.read(endpoint),github.read(base+'/branches/main'),
    github.read(base+'/actions/variables/FCOS_RAPID_RELEASE_ENABLED'),
    github.read(base+'/actions/variables/FCOS_RAPID_RELEASE_HANDOVER_ID'),github.read(base+'/environments/fcos-production-release'),
    github.read(endpoint+'/jobs?per_page=100'),github.read(endpoint+'/approvals'),
    github.read(base+'/actions/runs/'+plan.manualRunId),
  ]);
  const matches = reviews.filter(row => row.state === 'approved' && row.user?.id === ownerId && row.user.login === pins.account
    && row.environments?.some(item => item.id === environment.id && item.name === environment.name));
  const apply = jobs.jobs.filter(job => job.name === 'signing-setup' && job.status === 'in_progress');
  check(user.id === ownerId && user.login === pins.account && repo.id === repoId && repo.permissions?.admin === true
    && native.id === runId && native.actor?.id === ownerId && native.triggering_actor?.id === ownerId
    && native.triggering_actor.login === pins.account && native.repository?.id === repoId
    && native.status === 'in_progress' && native.event === 'workflow_dispatch' && native.head_branch === repo.default_branch
    && native.head_sha === env.GITHUB_SHA && main.protected
    && nativeWorkflowPath(native) === workflow && native.display_title === 'FCOS Trading FX signing '+planHash+' '+plan.candidateSha
    && enabled.value === 'true' && /^[1-9]\d*$/u.test(pointer.value)
    && environment.name === 'fcos-production-release' && environment.can_admins_bypass === false
    && environment.protection_rules?.some(rule => rule.type === 'required_reviewers'
      && rule.reviewers?.some(item => item.reviewer?.id === ownerId && item.reviewer?.login === pins.account))
    && matches.length === 1 && apply.length === 1,'SIGNING_SETUP_PROTECTED_NATIVE_APPROVAL_REQUIRED');
  await assertFrozenWorkflow({github,controllerSha:plan.controllerSha,dispatcherSha:native.head_sha,path:workflow});
  const record = await github.read(base+'/deployments/'+pointer.value);
  check(record.id === Number(pointer.value),'SIGNING_SETUP_HANDOVER_POINTER_CHANGED');
  const handover = assertPermanentHandover(record,{controllerSha:plan.controllerSha},ownerId);
  await assertReady(handover);
  await verifyTerminalManual({plan,github,snapshot,base,run:manual});
  const { id: reviewId, state, user: reviewer, environments } = matches[0];
  const approvalHash = digest({planHash,runId,ownerId,reviewId:reviewId ?? null,state,
    reviewer:reviewer.id,environments:environments.map(({id,name})=>({id,name})).sort((a,b)=>a.id-b.id)});
  const age = Date.now() - Date.parse(native.created_at);
  return {approvalHash,runId,maySubmit:main.commit.sha === env.GITHUB_SHA
    && Number.isFinite(age) && age >= 0 && age < 86400000
    && (native.run_attempt === 1 || original?.runId === runId && original.approvalHash === approvalHash)};
}

export async function runSigningSetup(env = process.env) {
  const plan = JSON.parse(env.FCOS_SIGNING_PLAN_JSON ?? '');
  validateSigningSetupPlan(plan);
  const candidate = resolve('candidate'), controller = resolve('controller');
  const {snapshot} = verifyPlanSource(plan,{env,candidate,controller});
  const github = githubClient({token:env.FCOS_SIGNING_OWNER_TOKEN,candidateSha:plan.candidateSha,actions:false});
  const journal = new DeploymentJournal({github,releaseId:plan.operationId,manifestHash:digest(plan),
    actorIds:[ownerId],otherReleaseActorIds:[ownerId,botId]});
  const vercel = vercelProvider({manifest:{candidate:snapshot},env});
  const compatibility = nativeCompatibilityReader({provider:vercel,env});
  const verifyPredecessor = async scope => {
    const facts = await compatibility({manifest:scope});
    check(facts.currentDeploymentId === scope.previous.deploymentId && facts.sha === scope.previous.sha
      && facts.schemaDigest === scope.previous.schemaDigest,'SIGNING_SETUP_NATIVE_BASELINE_CHANGED');
    const current = await vercel.currentProduction();
    check(current.id === scope.previous.deploymentId && current.buildId === scope.previous.buildId,
      'SIGNING_SETUP_LIVE_BUILD_CHANGED');
  };
  const nativeDb = handover => assertNativeHandoverState({handover,env});
  const protectedAdmission = args => readNativeApproval({...args,github,snapshot,env,assertReady:nativeDb});
  await protectedAdmission({plan,planHash:digest(plan)});
  await verifyPredecessor(plan);
  const privateDirectory = mkdtempSync(resolve(env.RUNNER_TEMP || tmpdir(),'fcos-signing-production-'));
  try {
    const cliEnv = authenticateHostedSalesforce({directory:privateDirectory,cwd:controller,env:{...env,HOME:privateDirectory},
      requireMirrorCredential:false,onlyProductionForSigningRead:true});
    const org = fcosSalesforceEnvironment('production');
    const authenticateIdentity = () => {
      const raw = execFileSync('sf',['org','display','--target-org',org.alias,'--json'],
        {env:{...cliEnv,SF_TEMP_SHOW_SECRETS:'true'},timeout:20000,stdio:['ignore','pipe','pipe'],maxBuffer:2*1024*1024});
      try {const reply = JSON.parse(raw);check(reply.status === 0,'SIGNING_SETUP_SALESFORCE_IDENTITY_UNAVAILABLE');return reply.result;}
      finally {raw.fill(0);}
    };
    const salesforce = createSigningSalesforceDriver({cliEnv,authenticateIdentity,verifyPredecessor});
    const environment = createSigningVercelDriver({env,vercel,readPublicKey:salesforce.publicKey,verifyPredecessor});
    const originalSalesforce = {...salesforce};
    salesforce.preflight = async context => {
      await environment.assertPreimage(plan);
      return originalSalesforce.preflight(context);
    };
    salesforce.submit = async context => {
      await environment.assertPreimage(plan);
      return originalSalesforce.submit(context);
    };
    const receipt = createSigningReceiptDriver({github,ownerId,readEnvironment:environment.exactPostimage,verifyPredecessor});
    return await executeSigningSetup({plan,journal,admission:protectedAdmission,
      providers:{'salesforce-certificate':salesforce,'vercel-config':environment,'owner-receipt':receipt}});
  } finally {rmSync(privateDirectory,{recursive:true,force:true});}
}

if (process.argv[1]?.endsWith('/rapid-release-trading-fx-signing-setup.mjs')
  || process.argv[1] === 'scripts/rapid-release-trading-fx-signing-setup.mjs') {
  runSigningSetup().then(result => {
    console.log(JSON.stringify(result));
    if (result.state !== 'verified') process.exitCode = 1;
  }).catch(error => {
    console.error(/^SIGNING_SETUP_[A-Z_]+$/u.test(error?.code ?? '') ? error.code : 'SIGNING_SETUP_NATIVE_READBACK_REQUIRED');
    process.exitCode = 1;
  });
}
