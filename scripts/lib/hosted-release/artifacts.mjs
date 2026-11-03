import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertBoundEvidence, canonical, digest, fail, hash } from './contract.mjs';
import { publishChecks } from './publisher.mjs';
import { checkBinding, evaluateCheckEvidence } from './checks.mjs';

export function readSingleJsonArchive(bytes, expectedName, execute = execFileSync) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 32 * 1024 * 1024 || !/^[a-z0-9-]+\.json$/.test(expectedName)) fail('ARTIFACT_INPUT');
  const directory = mkdtempSync(join(tmpdir(), 'fcos-hosted-artifact-'));
  try {
    const file = join(directory, 'artifact.zip'); writeFileSync(file, bytes, { mode: 0o600, flag: 'wx' });
    const entries = execute('unzip', ['-Z1', file], { encoding: 'utf8', maxBuffer: 4096, timeout: 10000 }).trim().split('\n');
    if (entries.length !== 1 || entries[0] !== expectedName) fail('ARTIFACT_CONTENTS');
    return JSON.parse(execute('unzip', ['-p', file, expectedName], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 10000 }));
  } catch (error) { if (error.code?.startsWith?.('ARTIFACT')) throw error; fail('ARTIFACT_INVALID'); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

export async function collectWorkflowArtifact({ github, repository, runId, artifactName, jobName, fileName }) {
  if (!/^[1-9][0-9]*$/.test(String(runId))) fail('ARTIFACT_RUN_ID');
  const prefix = `/repos/${repository}/actions`, run = await github.read(`${prefix}/runs/${runId}`);
  const [jobs, artifacts] = await Promise.all([
    github.pages(`${prefix}/runs/${runId}/attempts/${run.run_attempt}/jobs`, 'jobs'),
    github.pages(`${prefix}/runs/${runId}/artifacts`, 'artifacts'),
  ]);
  const job = jobs.filter(row => row.name === jobName), matches = artifacts.filter(row => row.name === artifactName && !row.expired);
  if (job.length !== 1 || matches.length !== 1) return { status: 'waiting_dependency', missing: artifactName };
  if (job[0].status !== 'completed') return { status: 'waiting_dependency', missing: jobName };
  const bytes = await github.read(`${prefix}/artifacts/${matches[0].id}/zip`, { bytes: true });
  return { run, job: job[0], artifact: { ...matches[0], archiveSha256: digest(bytes) }, report: readSingleJsonArchive(bytes, fileName) };
}

export function validateDeterministicReport({ report, admission, manifest, group, existing = {} }) {
  if (report?.schemaVersion !== 2 || report.kind !== 'fcos_hosted_release_checks' || !['passed','failed','waiting_dependency'].includes(report.status)
    || !Array.isArray(report.checks) || new Set(report.checks.map(row => row.checkId)).size !== report.checks.length) fail('RAW_REPORT_SCHEMA');
  const common = { ...admission.binding, runtime: report.runtime, installedLockSha256: report.installedLockSha256,
    buildConfigurationSha256: digest(manifest.verification) };
  if (canonical(report.runtime) !== canonical(manifest.verification.runtime) || !hash(report.installedLockSha256)) fail('CHECK_RUNTIME_BINDING');
  for (const key of Object.keys(common)) if (canonical(report[key]) !== canonical(common[key])) fail('CHECK_SOURCE_BINDING');
  const expected = admission.checks.filter(row => row.group === group && row.phase === 'deterministic');
  if (canonical(report.checks.map(row => row.checkId).sort()) !== canonical(expected.map(row => row.id).sort())) fail('CHECK_SET_MISMATCH');
  return expected.flatMap(check => {
    const evidence = report.checks.find(row => row.checkId === check.id), binding = checkBinding(check, common, admission.source);
    if (['failed','waiting_dependency'].includes(evidence.status)) return [];
    // The isolated host observer measures generated artifacts; candidate code
    // cannot write its report or the immutable observer mount.
    if (check.artifactInputs?.length) {
      if (!hash(evidence.binding?.artifactsSha256)) fail('GENERATED_ARTIFACT_BINDING');
      binding.artifactsSha256 = evidence.binding.artifactsSha256;
    }
    if (!evaluateCheckEvidence({ check, binding, evidence })) fail('DETERMINISTIC_EVIDENCE_INVALID', check.id);
    const prior = existing[check.id]?.evidence || existing[check.id];
    if (prior) {
      try {
        assertBoundEvidence(prior, manifest, check.id);
        if (canonical(prior.result?.rawCheck) === canonical(evidence)) return []; // Keep the actual original publisher and timestamps.
      } catch { /* A changed binding needs genuine new execution evidence. */ }
    }
    return [{ id: check.id, kind: 'deterministic', status: 'passed', inputsSha256: digest(binding), completedAt: evidence.completedAt,
      result: { binding, commands: evidence.commands, rawCheck: evidence, ...(check.id === 'server_performance' ? { serverBundlesRequired: true } : {}) } }];
  });
}

export async function publishDeterministicGroup({ github, coordinator, manifest, admission, runId, group }) {
  const expected = admission.checks.filter(row => row.group === group && row.phase === 'deterministic');
  if (!expected.length) return { status: 'not_applicable' };
  const artifactName = `fcos-${manifest.releaseId}-${group}`, jobName = `release / checks / ${group}`;
  const collected = await collectWorkflowArtifact({ github, repository: manifest.targets.repository, runId, artifactName, jobName, fileName: `${group}.json` });
  if (collected.status === 'waiting_dependency') return collected;
  const existing = (await coordinator.snapshot({ releaseId: manifest.releaseId, manifestHash: digest(manifest) })).checks || {};
  const proofs = await publishChecks({ manifest, ...collected, expectedJobName: jobName, coordinator,
    allowEmpty: true, validateReport: report => validateDeterministicReport({ report, admission, manifest, group, existing }) });
  return { status: collected.report.status, checks: proofs.map(row => row.checkId),
    missing: collected.report.checks.filter(row => row.status !== 'passed').map(row => row.checkId) };
}
