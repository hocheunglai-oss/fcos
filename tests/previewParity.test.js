import assert from 'node:assert/strict';
import test from 'node:test';
import { fcosConnectionIdentifier, fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { PREVIEW_PARITY_POLICY as policy, assertPreviewParity, evaluatePreviewParity } from '../scripts/lib/preview-parity.mjs';

const expectedCommit = 'a'.repeat(40);
const now = Date.parse('2026-10-01T08:00:00Z');
const sourceHashes = Object.fromEntries(policy.requiredSourceHashes.map((key, index) => [key, String(index + 1).repeat(64)]));
const options = { expectedCommit, sourceHashes, now };
const known = value => ({ state: 'known', value });
const opaque = () => ({ state: 'unknown', present: true });
const time = minutes => new Date(now - minutes * 60000).toISOString();

function fixture() {
  const provider = { provider: 'vercel', account: fcosConnectionIdentifier('vercel', 'Account'),
    teamId: fcosConnectionIdentifier('vercel', 'Team ID'), projectId: fcosConnectionIdentifier('vercel', 'Project ID'),
    repository: fcosConnectionIdentifier('github', 'Repository') };
  const result = { schemaVersion: 1, provider, source: { candidateHead: expectedCommit, hashes: { ...sourceHashes } },
    switchInventory: { keys: [...policy.applicationKeys.switchMatch, ...Object.keys(policy.intentionalDifferences).filter(key => key !== 'VERCEL_ENV')],
      sourceFiles: ['api/_externalActionGates.js', 'api/_variableCharges.js', 'src/lib/AuthContext.jsx'], sourceHash: sourceHashes.application } };
  for (const name of ['production', 'candidate']) {
    const candidate = name === 'candidate';
    const deployment = { id: candidate ? 'dpl_Candidate123' : 'dpl_Production123', url: `https://fcos-${candidate ? 'abc123xyz' : 'prod123xy'}-${fcosConnectionIdentifier('vercel', 'Team')}.vercel.app`,
      sha: candidate ? expectedCommit : 'b'.repeat(40), state: 'READY', target: candidate ? 'preview' : 'production',
      createdAt: time(10), teamId: provider.teamId, projectId: provider.projectId };
    const binding = { capturedAt: time(1), deploymentId: deployment.id, sha: deployment.sha };
    const keys = Object.fromEntries(policy.applicationKeys.switchMatch.map(key => [key, known(key.includes('PASSWORD') ? 'false' : 'true')]));
    for (const [key, exception] of Object.entries(policy.intentionalDifferences)) {
      const value = candidate ? exception.candidate : exception.production ?? 'false';
      const selected = Array.isArray(value) ? value[0] : value;
      keys[key] = selected === 'absent' ? { state: 'absent' } : known(selected);
    }
    Object.assign(keys, { SUPABASE_SERVICE_ROLE_KEY: opaque(), SALESFORCE_JWT_PRIVATE_KEY: opaque(), XERO_CLIENT_SECRET: opaque(),
      XERO_REFRESH_TOKEN: opaque(), SALESFORCE_JWT_USERNAME: known('pinned-user'), SALESFORCE_JWT_CLIENT_ID: known('pinned-client'),
      XERO_CLIENT_ID: known('pinned-client'), XERO_TENANT_ID: known('pinned-tenant'), VERCEL_GIT_COMMIT_SHA: known(deployment.sha) });
    const flags = list => Object.fromEntries(list.map(key => [key, known(keys[key].value === 'true')]));
    result[name] = { deployment, env: { ...binding, updatedAt: time(15), keys },
      compiled: { ...binding, flags: flags(policy.compiledFlags) },
      runtime: { ...binding, flags: flags(policy.runtimeFlags), safety: { readOnly: candidate,
        externalActions: Object.fromEntries(policy.externalActions.map(key => [key, !candidate])) },
      auth: { supabase: { state: 'authenticated', target: fcosConnectionIdentifier('supabase', 'Project ref'), mode: 'service_role' },
        salesforce: { state: 'authenticated', target: fcosSalesforceEnvironment('production').orgId, mode: 'jwt' },
        xero: { state: 'authenticated', target: 'pinned-tenant', mode: 'oauth' } } } };
  }
  result.coverage = { capturedAt: time(1), deploymentId: result.candidate.deployment.id, sha: expectedCommit,
    checks: policy.requiredModules.map(module => ({ module, role: 'administrator', kind: policy.workflowModules.includes(module) ? 'workflow_read' : 'read', result: 'pass', evidenceId: `independent-check-${module}` })) };
  return result;
}

function blocked(change, code, evaluationOptions = options) {
  const evidence = fixture();
  change(evidence);
  const result = evaluatePreviewParity(evidence, evaluationOptions);
  assert.equal(result.pass, false);
  assert.ok(result.blockers.some(blocker => blocker.code === code), JSON.stringify(result.blockers));
  return result;
}

test('exact parity passes with keyed Preview safety exceptions and independently authenticated opaque credentials', () => {
  const result = assertPreviewParity(fixture(), options);
  assert.equal(result.pass, true);
  assert.equal(result.policyVersion, 1);
  assert.equal(result.unknowns.length, 8);
  assert.ok(result.limitations.some(value => value.includes('does not authenticate')));
  assert.ok(result.classifiedKeys.some(({ key, category }) => key === 'FCOS_ENABLE_READ_ONLY_CI' && category === 'intentional'));
});

test('missing paired flag and raw, compiled, or runtime mismatches block', () => {
  blocked(e => { delete e.candidate.env.keys.VARIABLE_CHARGE_PAIRED_WORKFLOW_ENABLED; }, 'REQUIRED_ENV_MISSING');
  blocked(e => { e.candidate.env.keys.VARIABLE_CHARGE_PAIRED_WORKFLOW_ENABLED = known('false'); }, 'ENV_MISMATCH');
  blocked(e => { e.candidate.runtime.flags.VARIABLE_CHARGE_PAIRED_WORKFLOW_ENABLED = known(false); }, 'EFFECTIVE_FLAG_MISMATCH');
  blocked(e => { e.candidate.compiled.flags.VITE_FCOS_ENABLE_FCUNO_OIDC = known(false); }, 'EFFECTIVE_FLAG_MISMATCH');
  blocked(e => { e.candidate.compiled.flags.VITE_FCOS_ENABLE_FCUNO_LEGACY_PASSWORD_LOGIN = opaque(); }, 'EFFECTIVE_FLAG_UNKNOWN');
});

test('unknown sensitive match values and incomplete credential metadata block without treating unknown as equal', () => {
  blocked(e => { e.production.env.keys.CRON_SECRET = opaque(); e.candidate.env.keys.CRON_SECRET = opaque(); }, 'ENV_VALUE_UNKNOWN');
  blocked(e => { e.candidate.env.keys.SUPABASE_SERVICE_ROLE_KEY = { state: 'unknown' }; }, 'CREDENTIAL_PRESENCE_UNKNOWN');
  blocked(e => { e.candidate.runtime.auth.salesforce = { state: 'authenticated' }; }, 'PROVIDER_AUTH_UNKNOWN');
  blocked(e => { delete e.candidate.env.keys.XERO_REFRESH_TOKEN; }, 'PROVIDER_CREDENTIALS_MISSING');
  blocked(e => { e.candidate.runtime.auth.xero.state = 'unknown'; }, 'CREDENTIAL_AUTH_UNKNOWN');
});

test('provider target, immutable deployment target, READY status, and candidate SHA are mandatory', () => {
  blocked(e => { e.provider.projectId = 'wrong-project'; }, 'PROVIDER_IDENTITY');
  blocked(e => { e.provider.account = 'wrong-account'; }, 'PROVIDER_IDENTITY');
  blocked(e => { e.candidate.deployment.teamId = 'wrong-team'; }, 'DEPLOYMENT_IDENTITY');
  blocked(e => { e.candidate.deployment.sha = 'c'.repeat(40); }, 'DEPLOYMENT_SHA');
  blocked(e => { e.production.deployment.state = 'BUILDING'; }, 'DEPLOYMENT_IDENTITY');
  blocked(e => { e.production.deployment.url = 'https://fcos.fcuno.com'; }, 'DEPLOYMENT_IDENTITY');
  blocked(e => { e.production.deployment.url = `https://fcos-production-${fcosConnectionIdentifier('vercel', 'Team')}.vercel.app`; }, 'DEPLOYMENT_IDENTITY');
  blocked(e => { e.candidate.runtime.auth.salesforce.target = 'sandbox'; }, 'PROVIDER_AUTH_UNKNOWN');
});

test('source hashes, exact checkout head and complete discovered switch policy coverage bind observations', () => {
  blocked(e => { e.source.candidateHead = 'c'.repeat(40); }, 'CANDIDATE_HEAD');
  blocked(e => { e.source.hashes = { ...sourceHashes, application: 'f'.repeat(64) }; }, 'SOURCE_HASH');
  blocked(e => { delete e.switchInventory; }, 'SWITCH_INVENTORY_MISSING');
  blocked(e => { e.switchInventory.keys.push('FCOS_ENABLE_NEW_BUSINESS_WORKFLOW'); }, 'SWITCH_POLICY_MISSING');
  blocked(e => { e.switchInventory.keys = e.switchInventory.keys.filter(key => key !== 'VARIABLE_CHARGE_PAIRED_WORKFLOW_ENABLED'); }, 'SWITCH_SOURCE_COVERAGE_MISSING');
  blocked(() => {}, 'SOURCE_HASH', { expectedCommit, now });
});

test('the full key union rejects unreviewed Production-only, Preview-only and equal unknown app keys', () => {
  for (const names of [['production'], ['candidate'], ['production', 'candidate']]) {
    blocked(e => { for (const name of names) e[name].env.keys.FCOS_UNREVIEWED_SETTING = known('same'); }, 'UNCLASSIFIED_ENV_KEY');
  }
  blocked(e => { e.candidate.env.keys.APP_URL = known('https://new.example'); }, 'ENV_MISMATCH');
});

test('stale, future, missing, misbound and post-deployment environment observations fail', () => {
  blocked(e => { e.candidate.env.capturedAt = time(31); }, 'EVIDENCE_FRESHNESS');
  blocked(e => { e.production.runtime.capturedAt = time(-6); }, 'EVIDENCE_FRESHNESS');
  blocked(e => { delete e.candidate.env.updatedAt; }, 'ENV_REDEPLOY_REQUIRED');
  blocked(e => { e.candidate.env.updatedAt = time(5); }, 'ENV_REDEPLOY_REQUIRED');
  blocked(e => { e.candidate.compiled.capturedAt = time(11); }, 'EVIDENCE_BINDING');
  blocked(e => { e.coverage.deploymentId = e.production.deployment.id; }, 'EVIDENCE_BINDING');
  blocked(e => { delete e.production.runtime; }, 'EVIDENCE_FRESHNESS');
});

test('43 CI Dashboard/Markets passes and module denial checks cannot imply normal-role coverage', () => {
  const result = blocked(e => {
    e.coverage.checks = Array.from({ length: 43 }, (_, i) => ({ module: i % 2 ? 'dashboard' : 'markets', role: 'ci', kind: 'read', result: 'pass', evidenceId: `ci-${i}` }));
    e.coverage.checks.push(...policy.requiredModules.map(module => ({ module, role: 'administrator', kind: 'denial', result: 'pass', evidenceId: `deny-${module}` })));
    e.coverage.pass = true; e.coverage.reviewed = true;
  }, 'NORMAL_ROLE_COVERAGE_MISSING');
  assert.equal(result.blockers.filter(({ code }) => code === 'NORMAL_ROLE_COVERAGE_MISSING').length, policy.requiredModules.length);
});

test('Preview mutation authority and enabled or unknown external actions fail even with pass/review assertions', () => {
  blocked(e => { e.candidate.runtime.safety.readOnly = false; e.pass = true; e.reviewed = true; }, 'PREVIEW_MUTATION_AUTHORITY');
  blocked(e => { e.candidate.runtime.safety.externalActions.salesforce_write = true; }, 'EXTERNAL_ACTION_NOT_DISABLED');
  blocked(e => { delete e.candidate.runtime.safety.externalActions.xero_financial_sync; }, 'EXTERNAL_ACTION_NOT_DISABLED');
  blocked(e => { e.candidate.env.keys.FCOS_DISABLE_EMAIL_DELIVERY = known('false'); }, 'UNREVIEWED_ENV_DIFFERENCE');
});

test('failures enumerate blockers and never reproduce supplied secret values, digests or invalid key text', () => {
  const evidence = fixture(), secret = 'secret-value-do-not-echo', digest = 'd'.repeat(64);
  evidence.candidate.env.keys.CRON_SECRET = known(secret);
  evidence.production.env.keys.CRON_SECRET = { state: 'known', sha256: digest };
  evidence.candidate.env.keys[secret] = known(secret);
  evidence.candidate.runtime.auth.salesforce.target = secret;
  const result = evaluatePreviewParity(evidence, options);
  assert.ok(result.blockers.length >= 3);
  for (const value of [JSON.stringify(result), (() => { try { assertPreviewParity(evidence, options); } catch (error) { return error.message; } })()]) {
    assert.ok(!value.includes(secret)); assert.ok(!value.includes(digest));
  }
});

test('malformed observations produce diagnostics instead of uncontrolled exceptions', () => {
  for (const evidence of [null, { pass: true }, { ...fixture(), coverage: { checks: {} }, switchInventory: { keys: {} } }]) {
    assert.equal(evaluatePreviewParity(evidence, options).pass, false);
  }
  assert.equal(evaluatePreviewParity(fixture(), { ...options, policy: { pass: true, reviewed: true } }).pass, false);
});

test('policy overrides cannot weaken canonical module, auth, switch, role or platform coverage', () => {
  const weakened = structuredClone(policy);
  weakened.requiredModules = []; weakened.requiredAuth = []; weakened.runtimeFlags = []; weakened.compiledFlags = [];
  weakened.workflowModules = []; weakened.externalActions = []; weakened.requiredSourceHashes = [];
  blocked(e => { e.coverage.checks = []; }, 'NORMAL_ROLE_COVERAGE_MISSING', { ...options, policy: weakened });
  blocked(e => { delete e.candidate.runtime.auth.xero; }, 'PROVIDER_AUTH_UNKNOWN', { ...options, policy: weakened });
  blocked(e => { delete e.candidate.runtime.flags.VARIABLE_CHARGE_PAIRED_WORKFLOW_ENABLED; }, 'EFFECTIVE_FLAG_UNKNOWN', { ...options, policy: weakened });
  blocked(e => { e.switchInventory.keys = e.switchInventory.keys.filter(key => key !== 'FCOS_DISABLE_EMAIL_DELIVERY'); }, 'SWITCH_SOURCE_COVERAGE_MISSING', { ...options, policy: weakened });
  blocked(e => { delete e.source.hashes.application; }, 'SOURCE_HASH', { ...options, policy: weakened });
  const unsafe = structuredClone(policy); unsafe.normalRoles.push('ci'); unsafe.platformPrefixes.push('FCOS_');
  blocked(() => {}, 'POLICY_SCOPE_WEAKENED', { ...options, policy: unsafe });
});

test('null or false env records and env snapshots for another deployment cannot become absent defaults', () => {
  for (const value of [null, false, '', {}, { state: 'absent', value: 'hidden-setting' }]) {
    blocked(e => { e.candidate.env.keys.APP_URL = value; }, 'ENV_RECORD_INVALID');
    blocked(e => { e.candidate.env.keys.VARIABLE_CHARGE_PAIRED_WORKFLOW_ENABLED = value; }, 'ENV_RECORD_INVALID');
    blocked(e => { e.candidate.env.keys.SUPABASE_SERVICE_ROLE_KEY = value; }, 'ENV_RECORD_INVALID');
  }
  blocked(e => { delete e.candidate.env.deploymentId; }, 'EVIDENCE_BINDING');
  blocked(e => { e.production.env.sha = expectedCommit; }, 'EVIDENCE_BINDING');
});
