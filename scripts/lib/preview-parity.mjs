import { readFileSync } from 'node:fs';
import { fcosConnectionIdentifier, fcosSalesforceEnvironment } from '../../config/fcosConnections.js';
import { canonicalFcosE2eCandidateUrl } from '../verify-e2e-candidate.mjs';

const policy = JSON.parse(readFileSync(new URL('../../config/preview-parity-policy.json', import.meta.url), 'utf8'));
const freeze = value => { if (object(value) || Array.isArray(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
freeze(policy);
export const PREVIEW_PARITY_POLICY = policy;
const sha = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const keyName = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(value);
const date = value => typeof value === 'number' ? value : Date.parse(value);
const absent = { state: 'absent' };
const known = value => value?.state === 'known' && (typeof value.value === 'string' || typeof value.value === 'boolean' || hash(value.sha256));
const equivalent = (a, b) => a.state === 'absent' && b.state === 'absent'
  || known(a) && known(b) && (hash(a.sha256) && hash(b.sha256) ? a.sha256 === b.sha256 : a.value !== undefined && a.value === b.value);
const literal = record => record?.state === 'absent' ? 'absent' : known(record) ? record.value : undefined;
const matches = (record, expected) => expected === undefined || (Array.isArray(expected) ? expected : [expected]).includes(literal(record));
const immutableUrl = value => { try { return canonicalFcosE2eCandidateUrl(value) === value; } catch { return false; } };

/**
 * Pure evaluation of independently collected observations. Caller owns transport trust.
 * options.expectedCommit and sourceHashes must come from the reviewed local checkout.
 * Both snapshots contain deployment, env, compiled and runtime. Env keys are typed
 * known(value or sha256), absent, or unknown(present:true for opaque credentials).
 * Compiled/runtime/coverage are bound to deploymentId, sha and capturedAt. Runtime
 * auth records require state authenticated, target and mode from an independent probe.
 * Never persist raw observations; the result and thrown error contain names only.
 */
export function evaluatePreviewParity(observations, { expectedCommit, sourceHashes, policy: rules = policy, now = Date.now() } = {}) {
  const blockers = [], classifiedKeys = [], unknowns = [];
  const fail = (code, scope, key) => blockers.push({ code, scope, ...(keyName(key) ? { key } : {}), message: `${code}: ${scope}${keyName(key) ? ` (${key})` : ''}.` });
  const finish = () => ({ schemaVersion: 1, policyVersion: rules?.policyVersion, pass: blockers.length === 0, blockers, classifiedKeys, unknowns,
    limitations: [...(Array.isArray(rules?.limitations) ? rules.limitations : [])] });
  if (!object(observations) || observations.schemaVersion !== 1) { fail('OBSERVATION_SCHEMA', 'observations'); return finish(); }
  if (!object(rules) || rules.schemaVersion !== 1 || !Number.isInteger(rules.policyVersion) || rules.policyVersion < 1
    || !Number.isInteger(rules.maxAgeSeconds) || rules.maxAgeSeconds < 1 || rules.maxAgeSeconds > 1800
    || !object(rules.applicationKeys) || !object(rules.intentionalDifferences)
    || ['requiredSourceHashes', 'platformPrefixes', 'platformKeys', 'compiledFlags', 'runtimeFlags', 'externalActions', 'requiredAuth', 'requiredModules', 'workflowModules', 'normalRoles'].some(key => !Array.isArray(rules[key]))
    || ['match', 'switchMatch', 'opaqueMatch'].some(key => !Array.isArray(rules.applicationKeys[key])) || !object(rules.applicationKeys.credentials)) {
    fail('POLICY_SCHEMA', 'policy'); return finish();
  }
  if (rules.platformPrefixes.some(prefix => !policy.platformPrefixes.includes(prefix)) || rules.platformKeys.some(key => !policy.platformKeys.includes(key))
    || rules.normalRoles.some(role => !policy.normalRoles.includes(role))) fail('POLICY_SCOPE_WEAKENED', 'policy');
  if (!sha(expectedCommit) || observations.source?.candidateHead !== expectedCommit) fail('CANDIDATE_HEAD', 'source');
  for (const key of new Set(['application', 'policy', 'connections', 'ciIdentity', ...rules.requiredSourceHashes])) {
    if (!hash(sourceHashes?.[key]) || observations.source?.hashes?.[key] !== sourceHashes[key]) fail('SOURCE_HASH', 'source');
  }
  const pins = { provider: 'vercel', account: fcosConnectionIdentifier('vercel', 'Account'), teamId: fcosConnectionIdentifier('vercel', 'Team ID'),
    projectId: fcosConnectionIdentifier('vercel', 'Project ID'), repository: fcosConnectionIdentifier('github', 'Repository') };
  if (Object.entries(pins).some(([key, value]) => observations.provider?.[key] !== value)) fail('PROVIDER_IDENTITY', 'provider');
  const fresh = (block, scope) => {
    const time = date(block?.capturedAt);
    if (!Number.isFinite(time) || !Number.isFinite(now) || time > now + 300000 || now - time > rules.maxAgeSeconds * 1000) fail('EVIDENCE_FRESHNESS', scope);
  };
  const bound = (block, deployment, scope) => {
    fresh(block, scope);
    if (!deployment || block?.deploymentId !== deployment.id || block?.sha !== deployment.sha || date(block?.capturedAt) < date(deployment.createdAt)) fail('EVIDENCE_BINDING', scope);
  };
  const snapshots = ['production', 'candidate'];
  for (const name of snapshots) {
    const snapshot = observations[name], deployment = snapshot?.deployment;
    if (!deployment || !/^dpl_[a-zA-Z0-9]+$/.test(deployment.id) || !immutableUrl(deployment.url) || !sha(deployment.sha)
      || deployment.state !== 'READY' || deployment.target !== (name === 'production' ? 'production' : 'preview')
      || deployment.projectId !== pins.projectId || deployment.teamId !== pins.teamId || !Number.isFinite(date(deployment.createdAt))) fail('DEPLOYMENT_IDENTITY', name);
    if (name === 'candidate' && deployment?.sha !== expectedCommit) fail('DEPLOYMENT_SHA', name);
    bound(snapshot?.env, deployment, `${name}.env`);
    if (!object(snapshot?.env?.keys)) fail('ENV_INVENTORY_MISSING', `${name}.env`);
    const updated = date(snapshot?.env?.updatedAt), created = date(deployment?.createdAt);
    if (!Number.isFinite(updated) || updated > created || date(snapshot?.env?.capturedAt) < created) fail('ENV_REDEPLOY_REQUIRED', `${name}.env`);
    bound(snapshot?.compiled, deployment, `${name}.compiled`);
    bound(snapshot?.runtime, deployment, `${name}.runtime`);
  }
  if (observations.production?.deployment?.id === observations.candidate?.deployment?.id) fail('DEPLOYMENT_DISTINCT', 'deployments');
  const classes = new Map();
  for (const category of ['match', 'switchMatch', 'opaqueMatch']) for (const key of rules.applicationKeys[category]) classes.set(key, category);
  for (const key of Object.keys(rules.applicationKeys.credentials)) classes.set(key, 'credential');
  for (const [key, exception] of Object.entries(rules.intentionalDifferences)) {
    if (!keyName(key) || !object(exception) || typeof exception.reason !== 'string' || !exception.reason.trim()
      || exception.candidate === undefined) fail('POLICY_EXCEPTION_INVALID', 'policy', key);
    classes.set(key, 'intentional');
  }
  for (const key of policy.applicationKeys.switchMatch) if (classes.get(key) !== 'switchMatch') fail('SWITCH_POLICY_WEAKENED', 'policy', key);
  const inventory = observations.switchInventory;
  if (!Array.isArray(inventory?.keys) || !Array.isArray(inventory?.sourceFiles) || !inventory.sourceFiles.length
    || inventory.sourceHash !== sourceHashes?.application) fail('SWITCH_INVENTORY_MISSING', 'source');
  const switches = Array.isArray(inventory?.keys) ? inventory.keys : [];
  for (const key of switches) if (!keyName(key) || !['switchMatch', 'intentional'].includes(classes.get(key))) fail('SWITCH_POLICY_MISSING', 'source', key);
  const requiredSwitches = new Set([...policy.applicationKeys.switchMatch, ...rules.applicationKeys.switchMatch,
    ...Object.keys(policy.intentionalDifferences).filter(key => key !== 'VERCEL_ENV')]);
  for (const key of requiredSwitches) if (!switches.includes(key)) fail('SWITCH_SOURCE_COVERAGE_MISSING', 'source', key);
  const compiledFlags = [...new Set([...policy.compiledFlags, ...rules.compiledFlags])];
  const runtimeFlags = [...new Set([...policy.runtimeFlags, ...rules.runtimeFlags])];
  const required = new Set([...rules.applicationKeys.switchMatch, ...compiledFlags, ...runtimeFlags,
    'VARIABLE_CHARGE_PAIRED_WORKFLOW_ENABLED', 'FCOS_ENABLE_READ_ONLY_CI', 'VERCEL_ENV']);
  const envKeys = name => observations[name]?.env?.keys || {};
  const union = new Set([...Object.keys(envKeys('production')), ...Object.keys(envKeys('candidate')), ...required]);
  const record = (name, key) => Object.hasOwn(envKeys(name), key) ? envKeys(name)[key] : absent;
  for (const key of [...union].sort()) {
    if (!keyName(key)) { fail('ENV_KEY_INVALID', 'environment'); continue; }
    let category = classes.get(key);
    if (!category && (rules.platformKeys.includes(key) || rules.platformPrefixes.some(prefix => key.startsWith(prefix)))) category = 'platform';
    if (!category) { fail('UNCLASSIFIED_ENV_KEY', 'environment', key); continue; }
    classifiedKeys.push({ key, category });
    if (category === 'platform') continue;
    const a = record('production', key), b = record('candidate', key);
    if (![a, b].every(value => object(value) && ['known', 'absent', 'unknown'].includes(value.state)
      && !(value.state === 'absent' && ('value' in value || 'sha256' in value || 'present' in value)))) { fail('ENV_RECORD_INVALID', 'environment', key); continue; }
    if (category === 'credential') {
      for (const name of snapshots) {
        const value = record(name, key);
        const auth = observations[name]?.runtime?.auth?.[rules.applicationKeys.credentials[key]];
        if (value.state === 'unknown' && value.present === true) unknowns.push({ scope: name, key });
        else if (value.state !== 'absent' && !known(value)) fail('CREDENTIAL_PRESENCE_UNKNOWN', name, key);
        if (value.state !== 'absent' && (auth?.state !== 'authenticated' || typeof auth.target !== 'string' || !auth.target
          || typeof auth.mode !== 'string' || !auth.mode)) fail('CREDENTIAL_AUTH_UNKNOWN', name, key);
      }
      continue;
    }
    if (![a, b].every(value => value.state === 'absent' || known(value))) { fail('ENV_VALUE_UNKNOWN', 'environment', key); continue; }
    if (required.has(key) && (a.state === 'absent' || b.state === 'absent') && category !== 'intentional') fail('REQUIRED_ENV_MISSING', 'environment', key);
    if (category === 'intentional') {
      const exception = rules.intentionalDifferences[key];
      if (!matches(a, exception.production) || !matches(b, exception.candidate)) fail('UNREVIEWED_ENV_DIFFERENCE', 'environment', key);
    } else if (!equivalent(a, b)) fail('ENV_MISMATCH', 'environment', key);
  }
  for (const layer of ['compiled', 'runtime']) for (const key of layer === 'compiled' ? compiledFlags : runtimeFlags) {
    const a = observations.production?.[layer]?.flags?.[key], b = observations.candidate?.[layer]?.flags?.[key];
    if (![a, b].every(value => value?.state === 'known' && typeof value.value === 'boolean')) fail('EFFECTIVE_FLAG_UNKNOWN', layer, key);
    else if (a.value !== b.value || snapshots.some(name => typeof record(name, key)?.value !== 'string'
      || observations[name][layer].flags[key].value !== (record(name, key)?.value === 'true'))) fail('EFFECTIVE_FLAG_MISMATCH', layer, key);
  }
  const candidate = observations.candidate;
  if (literal(record('candidate', 'VERCEL_ENV')) !== 'preview' || literal(record('candidate', 'FCOS_ENABLE_READ_ONLY_CI')) !== 'true'
    || candidate?.runtime?.safety?.readOnly !== true) fail('PREVIEW_MUTATION_AUTHORITY', 'candidate');
  for (const key of new Set([...policy.externalActions, ...rules.externalActions])) if (candidate?.runtime?.safety?.externalActions?.[key] !== false) fail('EXTERNAL_ACTION_NOT_DISABLED', `candidate.externalActions.${key}`);
  for (const name of snapshots) for (const provider of new Set([...policy.requiredAuth, ...rules.requiredAuth])) {
    const auth = observations[name]?.runtime?.auth?.[provider];
    const expectedTarget = provider === 'salesforce' ? fcosSalesforceEnvironment('production').orgId
      : provider === 'supabase' ? fcosConnectionIdentifier('supabase', 'Project ref') : literal(record(name, 'XERO_TENANT_ID'));
    const modes = { salesforce: ['jwt', 'oauth'], supabase: ['service_role', 'secret_key'], xero: ['oauth'] };
    if (!expectedTarget || auth?.state !== 'authenticated' || auth.target !== expectedTarget || !modes[provider]?.includes(auth.mode)) fail('PROVIDER_AUTH_UNKNOWN', `${name}.runtime.auth.${provider}`);
    const present = key => known(record(name, key)) || record(name, key)?.state === 'unknown' && record(name, key)?.present === true;
    const complete = provider === 'supabase' ? present(auth?.mode === 'secret_key' ? 'SUPABASE_SECRET_KEY' : 'SUPABASE_SERVICE_ROLE_KEY')
      : provider === 'xero' ? present('XERO_CLIENT_SECRET') && present('XERO_REFRESH_TOKEN') && present('XERO_CLIENT_ID')
        : provider === 'salesforce' && (auth?.mode === 'jwt'
          ? present('SALESFORCE_JWT_PRIVATE_KEY') && present('SALESFORCE_JWT_USERNAME') && (present('SALESFORCE_JWT_CLIENT_ID') || present('SALESFORCE_CLIENT_ID'))
          : present('SALESFORCE_ACCESS_TOKEN') || present('SALESFORCE_CLIENT_SECRET') && present('SALESFORCE_REFRESH_TOKEN') && present('SALESFORCE_CLIENT_ID'));
    if (!complete) fail('PROVIDER_CREDENTIALS_MISSING', `${name}.runtime.auth.${provider}`);
  }
  bound(observations.coverage, candidate?.deployment, 'coverage');
  const coverageChecks = Array.isArray(observations.coverage?.checks) ? observations.coverage.checks : [];
  for (const module of new Set([...policy.requiredModules, ...rules.requiredModules])) {
    const check = coverageChecks.find(entry => entry?.module === module && policy.normalRoles.includes(entry.role) && rules.normalRoles.includes(entry.role)
      && entry.result === 'pass' && ([...policy.workflowModules, ...rules.workflowModules].includes(module) ? entry.kind === 'workflow_read' : ['read', 'workflow_read'].includes(entry.kind))
      && typeof entry.evidenceId === 'string' && entry.evidenceId.trim());
    if (!check) fail('NORMAL_ROLE_COVERAGE_MISSING', `coverage.${module}`);
  }
  return finish();
}

export function assertPreviewParity(observations, options) {
  const result = evaluatePreviewParity(observations, options);
  if (!result.pass) throw Object.assign(new Error(`Preview parity blocked (${result.blockers.length}): ${result.blockers.map(({ message }) => message).join(' ')}`), { code: 'PREVIEW_PARITY_BLOCKED', result });
  return result;
}
