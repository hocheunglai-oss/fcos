import { qualificationSourceBinding } from '../../../config/hostedReleaseQualification.js';
import { fcosConnectionIdentifier } from '../../../config/fcosConnections.js';
import { canonical, digest, fail, hash, releaseTargets, validateManifest } from './contract.mjs';

const fields = ['bootstrapSha','callerWorkflowSha','jobWorkflowRef','jobWorkflowSha','setupSha256'];
const admissionFields = ['repository','repositoryId','ref','bootstrapSha','callerWorkflowRef','callerWorkflowSha','jobWorkflowRef','jobWorkflowSha','candidateSha','setupSha256'];
const same = (a,b) => canonical(a) === canonical(b);
const need = (condition, code) => { if (!condition) fail(code, 'coordinator.policy', 'Preserve the consumed intent; reconcile exact owned configuration before a new authorized dispatch.'); };
const object = value => value && Object.getPrototypeOf(value) === Object.prototype;
const clone = value => JSON.parse(canonical(value));
function coordinatorUrl(value) {
  let url; try { url = new URL(value); } catch { need(false, 'COORDINATOR_BINDING_URL'); }
  need(url.protocol === 'https:' && /^[a-z0-9-]+\.vercel\.app$/.test(url.hostname) && !url.username && !url.password && !url.port
    && ['/','/coordinate'].includes(url.pathname) && !url.search && !url.hash, 'COORDINATOR_BINDING_URL');
  return url;
}

/** Pure same-source repair. This derives bindings, never authorization. */
export function compileCoordinatorPolicyBinding({ manifest, setup, previousPolicy, coordinatorProjectId, coordinatorSourceSha256, preservedConfigurationSha256 }) {
  validateManifest(manifest);
  const source = qualificationSourceBinding(manifest), targets = releaseTargets(), prior = previousPolicy?.qualificationAdmission;
  need(source && manifest.stage === 'qualification' && manifest.executionMode === 'qualification' && manifest.migration.mode === 'none', 'COORDINATOR_BINDING_QUALIFICATION_ONLY');
  need(object(setup) && digest(setup) === manifest.setupSha256 && setup.controllerSha === manifest.controller.sha
    && setup.epoch === manifest.epoch && same(setup.qualificationSource, source), 'COORDINATOR_BINDING_SETUP');
  need(object(previousPolicy) && previousPolicy.repository === targets.repository && /^[1-9][0-9]*$/.test(previousPolicy.repositoryId)
    && object(prior) && Object.keys(prior).length === admissionFields.length && admissionFields.every(k => typeof prior[k] === 'string')
    && prior.repository === previousPolicy.repository && prior.repositoryId === previousPolicy.repositoryId
    && prior.ref === source.ref && prior.callerWorkflowRef === source.callerWorkflowRef && prior.candidateSha === source.candidateSha, 'COORDINATOR_BINDING_SAME_SOURCE_REQUIRED');
  need(/^prj_[A-Za-z0-9]{6,80}$/.test(coordinatorProjectId || '') && hash(coordinatorSourceSha256) && hash(preservedConfigurationSha256), 'COORDINATOR_BINDING_SOURCE_EVIDENCE');
  const qualificationAdmission = { ...prior, bootstrapSha: source.bootstrapSha, callerWorkflowSha: source.bootstrapSha,
    jobWorkflowRef: `${targets.repository}/.github/workflows/hosted-release-controller.yml@${source.controllerSha}`,
    jobWorkflowSha: source.controllerSha, setupSha256: manifest.setupSha256 };
  const policy = { ...previousPolicy, qualificationAdmission };
  const changes = fields.filter(field => prior[field] !== qualificationAdmission[field])
    .map(field => ({ field: `qualificationAdmission.${field}`, before: prior[field], after: qualificationAdmission[field] }));
  return clone({ schemaVersion: 1, kind: 'fcos_coordinator_policy_binding_v1', repository: targets.repository, repositoryId: previousPolicy.repositoryId,
    manifestSha256: digest(manifest), setupSha256: manifest.setupSha256, qualificationSource: source,
    previousPolicySha256: digest(previousPolicy), policySha256: digest(policy), coordinatorProjectId, coordinatorSourceSha256, preservedConfigurationSha256,
    policy, changes, providerAuthorityGranted: false });
}

/** Fresh native observations are supplied by the verified owner-readback adapter.
 * Hashes bind those observations; labels alone do not attest provider identity. */
export function assertCoordinatorPolicyPreflight({ binding, manifest, setup, previousPolicy, coordinatorProjectId, coordinatorSourceSha256, preservedConfigurationSha256, observation, dispatchRequest, dispatchRequestSha256 }, { now = Date.now } = {}) {
  need(typeof now === 'function' && Number.isFinite(now()), 'COORDINATOR_BINDING_LIVE_CLOCK_REQUIRED');
  const compiled = compileCoordinatorPolicyBinding({ manifest, setup, previousPolicy,
    coordinatorProjectId, coordinatorSourceSha256, preservedConfigurationSha256 });
  need(same(binding, compiled), 'COORDINATOR_BINDING_ARTIFACT_CHANGED');
  const fresh = value => { const time = typeof value === 'string' ? Date.parse(value) : NaN, current = now(); return Number.isFinite(time) && time <= current && current - time <= 90000; };
  const o = observation, s = o?.coordinator, g = o?.github, v = o?.variables, h = o?.health, q = binding.qualificationSource, targets = releaseTargets();
  need(o?.kind === 'fcos_coordinator_dispatch_observation_v1' && [s,g,v,h].every(x => object(x) && fresh(x.observedAt) && hash(x.rawResponseSha256))
    && o.unknown === false, 'COORDINATOR_BINDING_FRESH_OBSERVATIONS_REQUIRED');
  need(g.repository === targets.repository && String(g.repositoryId) === binding.repositoryId && g.operatorLogin === fcosConnectionIdentifier('github','Required account')
    && /^[1-9][0-9]*$/.test(String(g.operatorId)) && String(g.operatorId) === String(g.repositoryOwnerId)
    && g.ref === q.ref && g.callerSha === q.bootstrapSha && g.callerWorkflowRef === q.callerWorkflowRef && g.controllerSha === q.controllerSha
    && g.jobWorkflowRef === binding.policy.qualificationAdmission.jobWorkflowRef && g.branchProtected === true && g.lockBranch === true
    && g.enforceAdmins === true && g.allowForcePushes === false && g.allowDeletions === false, 'COORDINATOR_BINDING_GITHUB_IDENTITY');
  need(s.projectId === binding.coordinatorProjectId && s.teamId === targets.vercelTeam && s.target === 'preview' && s.readyState === 'READY'
    && /^dpl_[A-Za-z0-9]{6,80}$/.test(s.deploymentId || '') && s.sourceBundleSha256 === binding.coordinatorSourceSha256
    && s.preservedConfigurationSha256 === binding.preservedConfigurationSha256 && same(s.policy, binding.policy), 'COORDINATOR_BINDING_DEPLOYED_CONFIGURATION');
  const url = coordinatorUrl(s.url);
  need(object(v.values) && Object.keys(v.values).length === 4
    && v.values.FCOS_ADMITTED_RELEASE_SETUP === canonical(setup) && v.values.FCOS_ADMITTED_RELEASE_SETUP_SHA256 === binding.setupSha256
    && v.values.FCOS_HOSTED_QUALIFICATION_ADMITTED === 'true' && coordinatorUrl(v.values.FCOS_HOSTED_COORDINATOR_URL).href === url.href, 'COORDINATOR_BINDING_GITHUB_VARIABLES');
  need(h.method === 'GET' && h.url === new URL('/health', url).href && h.status === 200 && h.redirected === false && h.cacheControl === 'no-store'
    && object(h.body) && Object.keys(h.body).length === 2 && h.body.kind === 'fcos_coordinator_health_v1' && h.body.policySha256 === binding.policySha256,
    'COORDINATOR_BINDING_EFFECTIVE_POLICY');
  const request = dispatchRequest, inputs = request?.body?.inputs;
  need(hash(dispatchRequestSha256) && digest(request) === dispatchRequestSha256 && request?.method === 'POST'
    && request.route === `/repos/${targets.repository}/actions/workflows/authenticated-release.yml/dispatches`
    && request.body.ref === q.ref.slice('refs/heads/'.length) && object(inputs)
    && Object.keys(inputs).every(k => ['bootstrap_phase','plan','resume_manifest','candidate_sha','xero_recovery_mode'].includes(k))
    && inputs.bootstrap_phase === 'qualification' && inputs.xero_recovery_mode === 'disabled'
    && (inputs.candidate_sha === undefined || inputs.candidate_sha === manifest.candidate.sha), 'COORDINATOR_BINDING_NEW_DISPATCH_REQUIRED');
  const hasPlan = typeof inputs.plan === 'string' && inputs.plan.length > 0;
  const hasResume = typeof inputs.resume_manifest === 'string' && inputs.resume_manifest.length > 0;
  need(hasPlan !== hasResume, 'COORDINATOR_BINDING_NEW_DISPATCH_REQUIRED');
  if (hasResume) {
    let resumed; try { resumed = JSON.parse(inputs.resume_manifest); } catch { need(false, 'COORDINATOR_BINDING_NEW_DISPATCH_REQUIRED'); }
    need(same(resumed, manifest), 'COORDINATOR_BINDING_NEW_DISPATCH_REQUIRED');
  }
  else {
    let plan; try { plan = JSON.parse(inputs.plan); } catch { need(false, 'COORDINATOR_BINDING_NEW_DISPATCH_REQUIRED'); }
    const expectedPlan = { schemaVersion: manifest.schemaVersion, stage: manifest.stage, executionMode: manifest.executionMode,
      releaseId: manifest.releaseId, branch: manifest.candidate.branch,
      ...(manifest.candidate.sourceProfile === undefined ? {} : { sourceProfile: manifest.candidate.sourceProfile }),
      changes: manifest.changes, scope: manifest.scope, runtime: manifest.runtime, migration: manifest.migration };
    need(inputs.candidate_sha === manifest.candidate.sha && same(plan, expectedPlan), 'COORDINATOR_BINDING_NEW_DISPATCH_REQUIRED');
  }
  // Recheck the earliest observation at the last local boundary, without renewing it.
  const observedAt = [s,g,v,h].map(x => x.observedAt).sort((a,b) => Date.parse(a) - Date.parse(b))[0];
  need(fresh(observedAt), 'COORDINATOR_BINDING_PREFLIGHT_EXPIRED');
  return clone({ kind: 'fcos_coordinator_policy_preflight_v1', bindingSha256: digest(binding), manifestSha256: binding.manifestSha256,
    policySha256: binding.policySha256, observationSha256: digest(o), dispatchRequestSha256: digest(request), observedAt, checkedAt: new Date(now()).toISOString(),
    coordinator: { deploymentId: s.deploymentId, url: url.href, sourceBundleSha256: s.sourceBundleSha256 }, dispatchPerformed: false, providerAuthorityGranted: false });
}
