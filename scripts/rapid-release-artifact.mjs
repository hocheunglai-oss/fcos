import { readFileSync, mkdirSync, writeFileSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertBuildArtifact } from './lib/rapid-release/build.mjs';
import { assertBuildReceipt } from './lib/rapid-release/engine.mjs';
import { validateManifest, targets, requireCondition } from './lib/rapid-release/contract.mjs';

export function qualifyDownloadedArtifact(directory) {
  const root = resolve(directory), manifest = JSON.parse(readFileSync(join(root, 'manifest.json'))), receipt = JSON.parse(readFileSync(join(root, 'build.json')));
  validateManifest(manifest); assertBuildReceipt(receipt, manifest);
  const candidate = join(root, 'candidate'), vercel = join(candidate, '.vercel');
  requireCondition(!lstatSync(vercel).isSymbolicLink(), 'ARTIFACT_PROJECT_LINK_INVALID');
  assertBuildArtifact(candidate, receipt, manifest);
  mkdirSync(vercel, { recursive: true });
  // Generate linkage from trusted pins, never from candidate-provided project metadata.
  writeFileSync(join(vercel, 'project.json'), JSON.stringify({ projectId: targets().projectId, orgId: targets().teamId }));
  return { buildId: receipt.buildId, artifactDigest: receipt.artifactDigest, candidateSha: manifest.candidate.sha };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(qualifyDownloadedArtifact(process.argv[2]))); }
  catch { console.error('DOWNLOADED_ARTIFACT_QUALIFICATION_FAILED'); process.exitCode = 1; }
}
