import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonical, digest, fail, validateManifest } from './contract.mjs';
import { candidateContainerArguments, inspectCandidateRuntime } from './isolation.mjs';
import { collectReleaseCheckSource } from './checks.mjs';

export function prepareCandidateChecks({ manifest, candidateDirectory, controllerDirectory, execute = execFileSync }) {
  validateManifest(manifest);
  if (!manifest.verification) fail('VERIFICATION_SETUP_REQUIRED');
  const image = manifest.verification.runtime.image, source = collectReleaseCheckSource(candidateDirectory);
  if (canonical(inspectCandidateRuntime({ image, execute })) !== canonical(manifest.verification.runtime)) fail('CHECK_IMAGE_RUNTIME_CHANGED');
  const project = { projectId: manifest.targets.vercelProject, orgId: manifest.targets.vercelTeam,
    projectName: 'fcos', settings: manifest.verification.projectSettings };
  const directory = join(candidateDirectory, '.vercel'); mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'project.json'), `${JSON.stringify(project)}\n`);
  writeFileSync(join(directory, '.env.preview.local'), Object.entries(manifest.verification.publicBuildEnvironment)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n');
  // Candidate processes receive public build inputs only. Install scripts are never
  // executed on the trusted observer's host, even when dependencies are cached.
  chmodSync(candidateDirectory, 0o777);
  execute('docker', candidateContainerArguments({ image, candidateDirectory, controllerDirectory, program: 'npm',
    args: ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], env: {} }), {
    env: { PATH: process.env.PATH, HOME: process.env.HOME }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000, maxBuffer: 2 * 1024 * 1024,
  });
  if (collectReleaseCheckSource(candidateDirectory).sourceInputsSha256 !== source.sourceInputsSha256) fail('INSTALL_CHANGED_SOURCE');
  return { status: 'ready', image, publicBuildInputsSha256: digest(manifest.verification),
    installedLockSha256: digest(readFileSync(join(candidateDirectory, 'node_modules/.package-lock.json'))) };
}

export function assertPublicBuildInputs({ manifest, candidateDirectory }) {
  const directory = join(candidateDirectory, '.vercel');
  const project = JSON.parse(readFileSync(join(directory, 'project.json'), 'utf8'));
  const expected = { projectId: manifest.targets.vercelProject, orgId: manifest.targets.vercelTeam, projectName: 'fcos', settings: manifest.verification.projectSettings };
  const env = Object.entries(manifest.verification.publicBuildEnvironment).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n';
  if (canonical(project) !== canonical(expected) || readFileSync(join(directory, '.env.preview.local'), 'utf8') !== env) fail('PUBLIC_BUILD_INPUTS_CHANGED');
}
