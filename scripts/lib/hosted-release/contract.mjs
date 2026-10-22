import { validateLegacyReleaseContainment } from '../../../config/legacyReleaseContainment.js';
import { canonical, digest, fail } from './json-contract.mjs';
export { canonical, digest, fail, ReleaseError } from './json-contract.mjs';
import { isFirstRuntimeCandidateSha, firstRuntimeCandidateProfile } from '../../../config/hostedCompatibilityCorrection.js';
import { qualificationSourceBinding } from '../../../config/hostedReleaseQualification.js';
import { FCOS_CONNECTION_POLICY, fcosConnectionIdentifier } from '../../../config/fcosConnections.js';
import { validateSalesforceReadBinding } from './salesforce-read-auth.mjs';
import { validateVercelReadBinding } from './vercel-read-auth.mjs';
import { validateVercelPreviewWriterBinding, validateVercelProductionWriterBinding } from './vercel-writer-auth.mjs';
import { assertFirstRuntimeManifest } from './first-runtime.mjs';

export const CONTRACT_VERSION = 'fcos-hosted-release/v2';
export const CONTROLLER_WORKFLOW = '.github/workflows/hosted-release-controller.yml';
export const PRODUCTION_ENVIRONMENT = 'fcos-production-release';
export const PREVIEW_ENVIRONMENT = 'fcos-hosted-preview';
export const FROZEN_COMPATIBILITY_SHA = '04ee3425aac7a49089eda781eb3c976aea1f6785';
export const WRITE_PHASES = Object.freeze(['preview.create', 'production.stage', 'production.promote', 'production.rollback']);
export const REQUIRED_LIVE_CHECKS = Object.freeze(['preview_binding', 'server_bundles', 'server_performance', 'restricted_browser', 'normal_role', 'fcuno_contract', 'runtime_parity', 'live_schema', 'nom_b', 'preservation']);
export const NORMAL_MODULES = Object.freeze(['dashboard', 'markets', 'review', 'disputes', 'buyer_invoices', 'unofficial_compensation', 'incoming_payments', 'cashflow_forecast', 'brokers', 'master_contracts', 'special_terms', 'hedge_desk', 'xero_portal', 'email_router', 'settings']);
export const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
export const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function releaseTargets() {
  return {
    repository: fcosConnectionIdentifier('github', 'Repository'),
    vercelTeam: fcosConnectionIdentifier('vercel', 'Team ID'),
    vercelProject: fcosConnectionIdentifier('vercel', 'Project ID'),
    supabaseProject: fcosConnectionIdentifier('supabase', 'Project ref'),
    productionOrigin: new URL(FCOS_CONNECTION_POLICY.attestation.endpoint).origin,
  };
}
export function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 2 || manifest.contract !== CONTRACT_VERSION
    || !/^[a-z0-9][a-z0-9-]{7,95}$/.test(manifest.releaseId || '')
    || !['compatibility', 'application', 'qualification'].includes(manifest.stage)
    || !['release', 'qualification'].includes(manifest.executionMode)
    || (manifest.stage === 'qualification') !== (manifest.executionMode === 'qualification')) fail('MANIFEST_SCHEMA');
  if (canonical(manifest.targets) !== canonical(releaseTargets())) fail('TARGET_MISMATCH');
  const candidate = manifest.candidate, controller = manifest.controller;
  if (!sha(candidate?.sha) || !['sourceSha256', 'lockSha256', 'configurationSha256', 'salesforceSourceSha256'].every(key => hash(candidate[key]))
    || !/^[A-Za-z0-9][A-Za-z0-9_./-]{0,200}$/.test(candidate.branch || '') || candidate.branch.includes('..')) fail('CANDIDATE_BINDING');
  if (!sha(controller?.sha) || controller.workflow !== CONTROLLER_WORKFLOW || !hash(controller.checkManifestSha256)
    || !hash(controller.configurationSha256) || !Number.isSafeInteger(manifest.epoch) || manifest.epoch < 1) fail('CONTROLLER_BINDING');
  if (manifest.stage === 'compatibility' && (!isFirstRuntimeCandidateSha(candidate.sha)
    || (candidate.sha !== FROZEN_COMPATIBILITY_SHA || candidate.sourceProfile !== undefined) && candidate.sourceProfile !== firstRuntimeCandidateProfile(candidate.sha)
    || canonical(manifest.scope?.handoffs) !== '[]' || manifest.scope?.existingUi !== false)) fail('FROZEN_SCOPE_CHANGED');
  if (!hash(manifest.scope?.sha256) || !Array.isArray(manifest.scope.handoffs)
    || manifest.scope.financialAuthority !== false) fail('SCOPE_BINDING');
  if (manifest.stage === 'application' && (!hash(manifest.scope.compatibilityProductionObservationSha256)
    || canonical(manifest.scope.handoffs.map(item => item.kind).sort()) !== canonical(['status19', 'supplier16'])
    || manifest.scope.handoffs.some(item => !hash(item.sha256))
    || !manifest.requiredChecks?.includes('compatibility_production_observation'))) fail('APPLICATION_SUCCESSOR_ORDER');
  qualificationSourceBinding(manifest);
  if(manifest.legacyReleaseContainment !== undefined) validateLegacyReleaseContainment(manifest.legacyReleaseContainment);
  const prior = manifest.previousProduction;
  if (!/^dpl_[A-Za-z0-9]+$/.test(prior?.deploymentId || '') || !sha(prior.sha)
    || !['sourceSha256', 'schemaSha256', 'runtimeSha256'].every(key => hash(prior[key]))) fail('PREVIOUS_PRODUCTION_BINDING');
  assertFirstRuntimeManifest(manifest);
  if (!Array.isArray(manifest.requiredChecks) || !manifest.requiredChecks.length
    || new Set(manifest.requiredChecks).size !== manifest.requiredChecks.length
    || manifest.requiredChecks.some(id => !/^[a-z][a-z0-9_]+$/.test(id))
    || REQUIRED_LIVE_CHECKS.some(id => !manifest.requiredChecks.includes(id))) fail('CHECK_COVERAGE');
  if (manifest.authorization?.validitySeconds !== 86400
    || canonical(manifest.authorization.actions) !== canonical(WRITE_PHASES)
    || manifest.authorization.rollback?.mode !== 'compatible_previous_only'
    || manifest.authorization.rollback.schemaRollback !== false) fail('AUTHORIZATION_SCOPE');
  if (!['none', 'separately_authorized'].includes(manifest.migration?.mode)
    || !hash(manifest.migration.expectedSchemaSha256)
    || manifest.migration.mode !== 'none' && !hash(manifest.migration.acceptedMigrationProofSha256)) fail('MIGRATION_SCOPE');
  if (!hash(manifest.runtime?.expectedSha256) || !manifest.runtime.expectedProduction || !manifest.runtime.expectedPreview
    || digest(manifest.runtime.expectedProduction) !== manifest.runtime.expectedSha256) fail('RUNTIME_EXPECTATIONS');
  if (!Array.isArray(manifest.changes) || manifest.changes.length > 200 || manifest.changes.some(text => typeof text !== 'string' || text.length > 500)) fail('RELEASE_SUMMARY');
  if (manifest.stage==='qualification' || manifest.verification?.vercelReadCredential)
    validateVercelReadBinding(manifest.verification?.vercelReadCredential,{targets:manifest.targets});
  if (manifest.verification?.salesforceReadCredential) validateSalesforceReadBinding(manifest.verification.salesforceReadCredential);
  if (manifest.verification?.vercelPreviewWriterCredential)
    validateVercelPreviewWriterBinding(manifest.verification.vercelPreviewWriterCredential, { targets: manifest.targets });
  if (manifest.verification?.vercelProductionWriterCredential)
    validateVercelProductionWriterBinding(manifest.verification.vercelProductionWriterCredential,
      { targets: manifest.targets, previewBinding: manifest.verification.vercelPreviewWriterCredential });
  if (manifest.verification) {
    if (Object.hasOwn(manifest.verification,'vercelSourceTransport')
      && (manifest.verification.vercelSourceTransport!=='fcos_source_api_archive_v1'
        || !manifest.legacyReleaseContainment || !manifest.verification.vercelPreviewWriterCredential
        || manifest.executionMode==='release' && !manifest.verification.vercelProductionWriterCredential)) fail('VERCEL_SOURCE_TRANSPORT_SCOPE');
    if (!/^ghcr\.io\/hocheunglai-oss\/fcos-release-checks@sha256:[a-f0-9]{64}$/.test(manifest.verification.runtime?.image || '')
      || manifest.verification.runtime.node !== 'v24.18.0' || manifest.verification.runtime.platform !== 'linux'
      || manifest.verification.runtime.arch !== 'x64' || !/^Python 3\.[0-9]+\.[0-9]+$/.test(manifest.verification.runtime.python || '')
      || !manifest.verification.publicBuildEnvironment || !manifest.verification.projectSettings) fail('VERIFICATION_ENVIRONMENT');
    const publicKeys = ['VITE_FCOS_ENABLE_FCUNO_OIDC','FCOS_ENABLE_FCUNO_FEDERATION','FCUNO_IDENTITY_ISSUER','VITE_SUPABASE_URL','VITE_SUPABASE_ANON_KEY','VITE_SUPABASE_PUBLISHABLE_KEY'];
    if (Object.entries(manifest.verification.publicBuildEnvironment).some(([key,value]) => !publicKeys.includes(key)
      || typeof value !== 'string' || value.length > 4096 || /[\r\n]/.test(value))) fail('PUBLIC_BUILD_INPUT');
    const settings = manifest.verification.projectSettings;
    if (Object.getPrototypeOf(settings) !== Object.prototype || Object.keys(settings).some(key => !['framework','buildCommand','devCommand','installCommand','outputDirectory','rootDirectory','nodeVersion','createdAt'].includes(key))
      || Object.values(settings).some(value => value !== null && typeof value !== 'string' && typeof value !== 'number')) fail('PUBLIC_PROJECT_SETTINGS');
  }
  return Object.freeze({ manifest, manifestHash: digest(manifest), releaseId: manifest.releaseId });
}

export function assertBoundEvidence(evidence, manifest, checkId, { now = Date.now(), allowStale = false } = {}) {
  const captured = Date.parse(evidence?.capturedAt);
  if (evidence?.schemaVersion !== 2 || evidence.checkId !== checkId || evidence.status !== 'passed'
    || evidence.manifestHash !== digest(manifest) || evidence.candidateSha !== manifest.candidate.sha
    || evidence.controllerSha !== manifest.controller.sha || !hash(evidence.inputsSha256)
    || !Number.isFinite(captured) || captured > now + 30000 || !hash(evidence.artifactSha256)
    || !evidence.publisher || evidence.publisher.trust !== 'hosted_controller'
    || !/^[1-9][0-9]*$/.test(String(evidence.publisher.runId)) || !/^[1-9][0-9]*$/.test(String(evidence.publisher.jobId))) fail('EVIDENCE_INVALID', checkId, 'Collect the actual matching trusted proof; do not rewrite timestamps.');
  if (evidence.kind === 'volatile' && (!Number.isSafeInteger(evidence.maxAgeSeconds) || evidence.maxAgeSeconds < 1
    || evidence.maxAgeSeconds > 1800 || !allowStale && now - captured > evidence.maxAgeSeconds * 1000)) fail('LIVE_EVIDENCE_EXPIRED', checkId, 'Refresh this observation at its current boundary.');
  if (!['volatile', 'deterministic'].includes(evidence.kind)) fail('EVIDENCE_KIND', checkId);
  if (checkId === 'normal_role' && (evidence.result?.unexpectedWrites !== 0
    || canonical([...evidence.result.modules || []].sort()) !== canonical([...NORMAL_MODULES].sort())
    || evidence.result.actualData !== true)) fail('NORMAL_ROLE_COVERAGE', checkId);
  if (checkId === 'restricted_browser' && (evidence.result?.identity !== 'restricted' || evidence.result.unexpectedWrites !== 0)) fail('RESTRICTED_IDENTITY_COVERAGE', checkId);
  if (checkId === 'server_performance' && evidence.result?.serverBundlesRequired !== true) fail('SERVER_BUNDLES_REQUIRED', checkId);
  return evidence;
}

export function renderReleaseSummary(manifest, evidence = {}) {
  validateManifest(manifest);
  const lines = ['# FCOS Production approval', '', `Manifest: \`${digest(manifest)}\``, `Release: \`${manifest.releaseId}\` (${manifest.stage})`,
    `Candidate: \`${manifest.candidate.sha}\``, `Controller: \`${manifest.controller.sha}\``, `Current Production: \`${manifest.previousProduction.deploymentId}\` (${manifest.previousProduction.sha})`,
    `Migration: ${manifest.migration.mode}`, manifest.previousProduction.firstRuntime ? 'Rollback: legacy previous build is not automatically eligible; failed live verification requires intervention unless compatibility is independently established.' : `Rollback: previous build only after current schema/runtime compatibility is reverified.`, '', 'Included changes:', ...manifest.changes.map(text => `- ${text.replace(/[\r\n]/g, ' ')}`), '', 'Required checks:', ...manifest.requiredChecks.map(id => `- ${id}: ${evidence[id]?.status || 'pending'}`), '',
    'This approval authorizes staging, same-build promotion and compatible automatic rollback for this immutable manifest for 24 hours after protected execution begins. It does not authorize financial changes or schema rollback.'];
  if(manifest.legacyReleaseContainment) lines.push('', 'Historical submissions remain UNKNOWN and consumed. This manifest uses independently admitted release-only effect containment; it grants no financial or authentication-maintenance exception.', ...manifest.legacyReleaseContainment.effects.map(row=>`- ${row.importId}: ${row.kind} (${row.effectSha256})`));
  return `${lines.join('\n')}\n`;
}
