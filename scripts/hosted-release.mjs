import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertBoundEvidence, digest, fail, renderReleaseSummary } from './lib/hosted-release/contract.mjs';
import { assertHostedController, assertHostedSetup, assertSourceAdmission } from './lib/hosted-release/admission.mjs';
import { hostedSession, readManifest, writeJson, workflowOutput } from './lib/hosted-release/session.mjs';
import { prepareCandidateChecks, assertPublicBuildInputs } from './lib/hosted-release/candidate-bootstrap.mjs';
import { runReleaseChecks } from './lib/hosted-release/checks.mjs';
import { collectAcceptance, executeHostedProduction, preparePreview, reconcilePending, safeFailure, terminalReleaseStatus } from './lib/hosted-release/controller.mjs';
import { publishDeterministicGroup } from './lib/hosted-release/artifacts.mjs';
import { publishDependencies } from './lib/hosted-release/dependency-publisher.mjs';
import { publishBrowser } from './lib/hosted-release/browser-publisher.mjs';
import { createLiveCollector } from './lib/hosted-release/live-collector.mjs';
import { runHostedBrowser } from './lib/hosted-release/browser.mjs';
import { collectCompatibilitySuccessor } from './lib/hosted-release/successor.mjs';

const commands = new Set(['prepare','checks','reconcile','preview','observe','browser','publish','ready','approve','execute','qualify','qualify-publish']);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function previewFrom(snapshot) {
  const item = snapshot.checks?.['preview.ready']; const value = item?.evidence?.result || item?.result;
  if (!value) fail('PREVIEW_EVIDENCE_PENDING', 'preview.ready', 'Resume the original Preview operation.'); return value;
}
function checkPassed(snapshot, manifest, id) { try { const proof = snapshot.checks?.[id]; assertBoundEvidence(proof?.evidence || proof, manifest, id); return true; } catch { return false; } }

export function verificationPlan(snapshot, manifest) {
  const modes = ['restricted','normal_role'].filter(mode => !checkPassed(snapshot,manifest,mode === 'restricted' ? 'restricted_browser' : mode));
  return { browser_matrix: JSON.stringify({mode:modes}), has_browsers:String(modes.length > 0), dependencies_required:String(!['nom_b','preservation'].every(id => checkPassed(snapshot,manifest,id))) };
}

/** One CLI owns every hosted entrypoint. It never reads the Mac keychain or executes
 * candidate JavaScript in a credential-bearing job. No command retries a write. */
export async function hostedRelease(command, { env = process.env, wait = sleep, now = Date.now, sessionFactory = hostedSession } = {}) {
  if (!commands.has(command)) fail('UNKNOWN_RELEASE_COMMAND');
  const manifest = readManifest(env.FCOS_RELEASE_MANIFEST), candidateDirectory = resolve(env.FCOS_CANDIDATE_DIRECTORY || 'candidate');
  const controllerDirectory = resolve(env.FCOS_CONTROLLER_DIRECTORY || 'controller'), phase = env.FCOS_VERIFICATION_PHASE || 'before';
  const binding = { releaseId: manifest.releaseId, manifestHash: digest(manifest) };
  const output = value => { writeJson(env.FCOS_RELEASE_OUTPUT || 'release-result.json', value); return value; };
  if (command === 'checks') {
    assertHostedController({ controllerDirectory, controllerSha: manifest.controller.sha, manifest, env });
    assertHostedSetup({ manifest, env });
    assertSourceAdmission({ manifest, candidateDirectory, controllerDirectory });
    prepareCandidateChecks({ manifest, candidateDirectory, controllerDirectory });
    const group = env.FCOS_CHECK_GROUP;
    if (!['code','database','fixtures'].includes(group)) fail('CHECK_GROUP');
    const report = await runReleaseChecks({ candidateDirectory, controllerDirectory, controllerSha: manifest.controller.sha,
      expectedCandidateSha: manifest.candidate.sha, sourceProfile: manifest.candidate.sourceProfile, group, phase: 'deterministic',
      cache: env.FCOS_CHECK_CACHE_FILE ? JSON.parse(readFileSync(env.FCOS_CHECK_CACHE_FILE, 'utf8')).checks : [],
      environment: { ...env, FCOS_HOSTED_CHECK_EXECUTION: '1', FCOS_HOSTED_CHECK_IMAGE: manifest.verification.runtime.image,
        FCOS_HOSTED_PUBLIC_BUILD_INPUTS: JSON.stringify(manifest.verification.publicBuildEnvironment), FCOS_HOSTED_BUILD_INPUTS_SHA256: digest(manifest.verification) },
      onRecord: () => assertPublicBuildInputs({ manifest, candidateDirectory }) });
    return output(report);
  }
  const jobName = command === 'prepare' ? 'release / prepare' : command === 'approve' ? `release / production / ${binding.manifestHash}`
    : command === 'execute' ? `release / execute / ${binding.manifestHash}`
    : command === 'browser' ? `release / browser / ${phase} / ${env.FCOS_BROWSER_MODE}` : `release / ${command}${['observe','publish','ready'].includes(command) ? ` / ${phase}` : ''}`;
  const session = await sessionFactory({ manifest, candidateDirectory, controllerDirectory, env, jobName, requireOidc: command !== 'browser' });
  const { coordinator, github, admission } = session;
  if (command === 'reconcile') {
    const { provider } = createLiveCollector({ session, candidateDirectory });
    const snapshot = await reconcilePending({ manifest, coordinator, provider });
    return output({ status: 'readback_complete', releaseStatus: snapshot.status });
  }
  if (command === 'prepare') {
    await coordinator.register({ ...binding, manifest });
    const snapshot = await coordinator.snapshot(binding);
    const terminal = terminalReleaseStatus(snapshot, manifest);
    if (terminal) {
      writeJson('check-cache.json', { manifestHash: binding.manifestHash, checks: [] });
      workflowOutput({ manifest_hash: binding.manifestHash, candidate_sha: manifest.candidate.sha, controller_sha: manifest.controller.sha,
        release_id: manifest.releaseId, source_profile: manifest.candidate.sourceProfile, execution_mode: manifest.executionMode,
        terminal: 'true', terminal_status: terminal, groups: JSON.stringify({ group: [] }), has_checks: 'false',
        browser_matrix: JSON.stringify({ mode: [] }), has_browsers: 'false', dependencies_required: 'false', approved: 'false' }, env);
      if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `\nSaved release outcome: ${terminal}. Recovery requires no repeated release work.\n`);
      return output({ status: terminal, resumed: true, manifestHash: binding.manifestHash, groups: [], originalApproval: snapshot.approval || null });
    }
    writeJson('check-cache.json', { manifestHash: binding.manifestHash, checks: Object.entries(snapshot.checks || {}).flatMap(([id,value]) => {
      const proof = value.evidence || value;
      try { assertBoundEvidence(proof, manifest, id); return proof.kind === 'deterministic' && proof.result?.rawCheck ? [proof.result.rawCheck] : []; } catch { return []; }
    }) });
    const groups = [...new Set(admission.checks.filter(check => check.phase === 'deterministic').map(check => check.group))]
      .filter(group => admission.checks.some(check => check.group === group && check.phase === 'deterministic' && !checkPassed(snapshot, manifest, check.id)));
    const approved = snapshot.approval?.manifest_hash === binding.manifestHash && Date.parse(snapshot.approval.expires_at) > now();
    workflowOutput({ manifest_hash: binding.manifestHash, candidate_sha: manifest.candidate.sha, controller_sha: manifest.controller.sha,
      release_id: manifest.releaseId, source_profile: manifest.candidate.sourceProfile, groups: JSON.stringify({ group: groups }),
      ...verificationPlan(snapshot,manifest), terminal: 'false', terminal_status: '', has_checks: String(groups.length > 0), approved: String(approved), execution_mode: manifest.executionMode }, env);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, renderReleaseSummary(manifest, snapshot.checks));
    return output({ status: 'prepared', manifestHash: binding.manifestHash, groups, originalApproval: snapshot.approval || null });
  }
  if (command === 'browser') {
    const context = JSON.parse(readFileSync(env.FCOS_OBSERVATIONS_FILE, 'utf8'));
    if (context.manifestHash !== binding.manifestHash) fail('BROWSER_CONTEXT_BINDING');
    const preview = context.preview, runtimeProof = context.checks?.runtime_parity;
    assertBoundEvidence(runtimeProof, manifest, 'runtime_parity');
    const browserEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !['GITHUB_TOKEN','GH_TOKEN','FCOS_HOSTED_GITHUB_READ_TOKEN','ACTIONS_ID_TOKEN_REQUEST_TOKEN','ACTIONS_ID_TOKEN_REQUEST_URL'].includes(key)));
    const { createHostedSignerAdapter } = await import('./lib/hosted-release/signer.mjs');
    const signerAdapter = createHostedSignerAdapter({ controllerDirectory, env: browserEnv });
    const report = await runHostedBrowser({ manifest, preview, mode: env.FCOS_BROWSER_MODE, env: browserEnv, controllerDirectory,
      observeRuntime: async () => runtimeProof.result.runtime,
      admitHostedSource: async () => ({ sourceVerified: true, observationSourcesVerified: true,
        candidateSha: manifest.candidate.sha, controllerSha: manifest.controller.sha, manifestHash: binding.manifestHash,
        sourceDigest: admission.candidate.sourceSha256, lockSha256: admission.candidate.lockSha256,
        configurationSha256: admission.candidate.configurationSha256 }), signerAdapter });
    return output(report);
  }
  if (command === 'preview' || command === 'execute') {
    const { provider } = createLiveCollector({ session, candidateDirectory, production: command === 'execute' });
    const start = now(); let result;
    do {
      result = await (command === 'preview' ? preparePreview({ manifest, coordinator, provider })
        : executeHostedProduction({ manifest, coordinator, provider, resumeAuthorization: true }));
      output(result);
      if (result.status !== 'waiting_dependency' || !['preview.ready','production.ready'].includes(result.phase)) break;
      // Only an already journaled deployment is polled. A runner timeout preserves its ID.
      if (now() - start >= 20 * 60 * 1000) break;
      await wait(15000);
    } while (true);
    return result;
  }
  if (command === 'observe') {
    const snapshot = await coordinator.snapshot(binding), preview = previewFrom(snapshot);
    const { collect } = createLiveCollector({ session, candidateDirectory });
    if (manifest.stage === 'application' && !checkPassed(snapshot,manifest,'compatibility_production_observation')) {
      const proof = await collectCompatibilitySuccessor({ manifest, coordinator, env:session.env, now });
      await coordinator.appendEvidence({ ...binding, key:'compatibility_production_observation', evidence:proof });
    }
    for (const id of ['preview_binding','runtime_parity','live_schema','fcuno_contract']) {
      if (checkPassed(snapshot, manifest, id)) continue;
      const proof = await collect(id, snapshot); assertBoundEvidence(proof, manifest, id);
      await coordinator.appendEvidence({ ...binding, key: id, evidence: proof });
    }
    const current = await coordinator.snapshot(binding), checks = Object.fromEntries(Object.entries(current.checks || {}).map(([key,value]) => [key,value.evidence || value]));
    workflowOutput(verificationPlan(current,manifest),env);
    return output({ status: 'passed', manifestHash: binding.manifestHash, preview, checks });
  }
  if (command === 'publish') {
    const snapshot = await coordinator.snapshot(binding), preview = previewFrom(snapshot), results = [];
    for (const group of [...new Set(admission.checks.filter(check => check.phase === 'deterministic').map(check => check.group))]) {
      if (admission.checks.filter(check => check.group === group && check.phase === 'deterministic').every(check => checkPassed(snapshot, manifest, check.id))) continue;
      results.push(await publishDeterministicGroup({ github, coordinator, manifest, admission, runId: env.GITHUB_RUN_ID, group }));
    }
    if (!['nom_b','preservation'].every(id => checkPassed(snapshot,manifest,id))) results.push(await publishDependencies({ github, coordinator, manifest, runId: env.GITHUB_RUN_ID, phase, env }));
    for (const mode of ['restricted','normal_role']) if (!checkPassed(snapshot,manifest,mode === 'restricted' ? 'restricted_browser' : mode)) results.push(await publishBrowser({ github, coordinator, manifest, runId: env.GITHUB_RUN_ID, phase, mode, preview }));
    return output({ status: results.some(row => row.status === 'failed') ? 'failed' : results.some(row => row.status === 'waiting_dependency') ? 'waiting_dependency' : 'passed', results });
  }
  if (command === 'ready') {
    const accepted = await collectAcceptance({ manifest, coordinator, provider: {}, now });
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, renderReleaseSummary(manifest, accepted.checks));
    workflowOutput({ ready: String(accepted.status === 'ready') }, env);
    return output(accepted);
  }
  if (command === 'approve') return output({ status: 'approved', ...await coordinator.approve(binding) });
  if (command === 'qualify') {
    const { runQualification } = await import('./hosted-release-qualification.mjs');
    const qualificationEnv = Object.fromEntries(Object.entries(session.env).filter(([key]) => !['GITHUB_TOKEN','GH_TOKEN','FCOS_HOSTED_GITHUB_READ_TOKEN'].includes(key)));
    return output(await runQualification({ manifest, coordinator, simulateProduction: true, context: 'hosted', repositoryId: env.GITHUB_REPOSITORY_ID, env: qualificationEnv }));
  }
  if (command === 'qualify-publish') {
    const { publishQualificationArtifact } = await import('./hosted-release-qualification.mjs');
    return output(await publishQualificationArtifact({ manifest, coordinator, github, runId: env.GITHUB_RUN_ID }));
  }
  fail('UNIMPLEMENTED_RELEASE_COMMAND');
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  hostedRelease(process.argv[2]).then(result => {
    console.log(JSON.stringify({ status: result.status, phase: result.phase, missing: result.missing }));
    // The isolated observer can complete successfully with failed candidate checks.
    // Publish preserves successful records; final readiness still fails closed.
    if (process.argv[2] !== 'checks' && ['failed','intervention_required'].includes(result.status)) process.exitCode = 1;
  }).catch(error => {
    const failure = safeFailure(error); console.error(JSON.stringify(failure));
    if (process.env.FCOS_RELEASE_OUTPUT) writeJson(process.env.FCOS_RELEASE_OUTPUT, failure);
    process.exitCode = 1;
  });
}
