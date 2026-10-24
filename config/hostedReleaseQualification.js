import { fcosConnectionIdentifier } from './fcosConnections.js';

const keys = ['bootstrapSha', 'callerWorkflowRef', 'candidateSha', 'controllerSha', 'ref'];
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
function invalid() { const error = new Error('QUALIFICATION_SOURCE_INVALID'); error.code = 'QUALIFICATION_SOURCE_INVALID'; throw error; }
export const isQualificationManifest = manifest => manifest?.stage === 'qualification' && manifest?.executionMode === 'qualification';

/** A binding only. Authority comes from independently admitted setup and live GitHub metadata. */
export function validateQualificationSource(source, { repository = fcosConnectionIdentifier('github', 'Repository'), controllerSha, candidateSha } = {}) {
  if (!source || Object.getPrototypeOf(source) !== Object.prototype || Object.keys(source).sort().join(',') !== keys.join(',')
    || !/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9_./-]{0,180}$/.test(source.ref || '') || source.ref === 'refs/heads/main'
    || source.ref.includes('..') || source.ref.includes('//') || /[/.]$/.test(source.ref) || source.ref.endsWith('.lock')
    || !sha(source.bootstrapSha) || !sha(source.controllerSha) || !sha(source.candidateSha)
    || source.callerWorkflowRef !== `${repository}/.github/workflows/authenticated-release.yml@${source.ref}`
    || controllerSha !== undefined && source.controllerSha !== controllerSha
    || candidateSha !== undefined && source.candidateSha !== candidateSha) invalid();
  return source;
}

export function qualificationSourceBinding(manifest) {
  if (manifest?.qualificationSource === undefined) return null;
  if (!isQualificationManifest(manifest)) invalid();
  return validateQualificationSource(manifest.qualificationSource, { repository: manifest.targets?.repository,
    controllerSha: manifest.controller?.sha, candidateSha: manifest.candidate?.sha });
}
