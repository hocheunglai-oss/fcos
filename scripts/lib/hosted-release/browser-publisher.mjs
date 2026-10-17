import { collectWorkflowArtifact } from './artifacts.mjs';
import { assertBoundEvidence, digest, fail, hash, NORMAL_MODULES, canonical } from './contract.mjs';
import { assertHostedJob, publishChecks } from './publisher.mjs';
import { compatibilityBrowserIsolationVerified } from '../compatibility-browser-isolation.mjs';

export async function publishBrowser({ manifest, github, coordinator, runId, phase, mode, preview }) {
  if (!['before', 'after'].includes(phase) || !['restricted', 'normal_role'].includes(mode)) fail('BROWSER_PHASE');
  const checkId = mode === 'restricted' ? 'restricted_browser' : 'normal_role';
  const existing = (await coordinator.snapshot({ releaseId: manifest.releaseId, manifestHash: digest(manifest) })).checks?.[checkId];
  try { assertBoundEvidence(existing?.evidence || existing, manifest, checkId); return { status: 'passed', reused: true }; } catch { /* Only this live observation expires. */ }
  const jobName = `release / browser / ${phase} / ${mode}`;
  const collected = await collectWorkflowArtifact({ github, repository: manifest.targets.repository, runId,
    artifactName: `fcos-${manifest.releaseId}-${phase}-${mode}`, jobName, fileName: `${mode.replaceAll('_', '-')}.json` });
  if (collected.status === 'waiting_dependency') return collected;
  if (collected.report?.status === 'waiting_dependency') {
    assertHostedJob({ manifest, ...collected, expectedJobName: jobName, controllerSha: manifest.controller.sha });
    return { status: 'waiting_dependency', missing: checkId };
  }
  const proofs = await publishChecks({ manifest, ...collected, expectedJobName: jobName, coordinator,
    validateReport: report => {
      if (report?.schemaVersion !== 2 || report.kind !== 'fcos_hosted_browser_raw' || report.status !== 'passed'
        || report.manifestHash !== digest(manifest) || report.candidateSha !== manifest.candidate.sha || report.controllerSha !== manifest.controller.sha
        || report.checkId !== checkId || report.deploymentId !== preview.id || report.candidateUrl !== preview.url
        || report.sourceSha256 !== manifest.candidate.sourceSha256 || !hash(report.inputsSha256)
        || report.completedAt !== report.capturedAt || report.result?.actualData !== true || report.result.unexpectedWrites !== 0) fail('BROWSER_RAW_BINDING');
      const expected = mode === 'restricted' ? ['dashboard', 'markets', 'api_denials'] : NORMAL_MODULES;
      if (canonical([...report.result.modules].sort()) !== canonical([...expected].sort()) || report.result.identity !== mode) fail('BROWSER_COVERAGE');
      if (mode === 'normal_role' && manifest.candidate.sourceProfile === 'frozen_04ee'
        && (!report.result.emailSigner || !compatibilityBrowserIsolationVerified(report.result.browserIsolation,
          { candidateUrl: preview.url, sha: manifest.candidate.sha, harnessSha: manifest.controller.sha, deploymentId: preview.id,
            sourceDigest: manifest.candidate.sourceSha256 }, NORMAL_MODULES))) fail('FROZEN_BROWSER_ISOLATION');
      return [{ id: checkId, kind: 'volatile', status: 'passed', inputsSha256: report.inputsSha256,
        completedAt: report.completedAt, maxAgeSeconds: 1800, result: report.result }];
    } });
  return { status: 'passed', checks: proofs.map(row => row.checkId) };
}
