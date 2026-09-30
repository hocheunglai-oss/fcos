import { createPublicKey, verify } from 'node:crypto';
import { fcosConnectionIdentifier } from '../../config/fcosConnections.js';
import { PREVIEW_PARITY_POLICY } from './preview-parity.mjs';

const SHA = /^[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;

export function assertProductionRuntimeReadback(runtime, expected) {
  const exactKeys = (record, keys) => record !== null && typeof record === 'object' && !Array.isArray(record)
    && Object.keys(record).length === keys.length && keys.every(key => Object.hasOwn(record, key));
  const flags = PREVIEW_PARITY_POLICY.runtimeFlags, actions = PREVIEW_PARITY_POLICY.externalActions;
  if (!runtime || runtime.safety?.readOnly !== false || expected?.expectedRuntimeSafety?.readOnly !== false
    || !exactKeys(runtime.flags, flags) || !exactKeys(expected.expectedRuntimeFlags, flags)
    || flags.some(key => runtime.flags[key]?.state !== 'known' || expected.expectedRuntimeFlags[key]?.state !== 'known'
      || typeof runtime.flags[key].value !== 'boolean' || runtime.flags[key].value !== expected.expectedRuntimeFlags[key].value)
    || !exactKeys(runtime.safety.externalActions, actions) || !exactKeys(expected.expectedRuntimeSafety.externalActions, actions)
    || actions.some(key => typeof runtime.safety.externalActions[key] !== 'boolean'
      || typeof expected.expectedRuntimeSafety.externalActions[key] !== 'boolean'
      || runtime.safety.externalActions[key] !== expected.expectedRuntimeSafety.externalActions[key])
    || PREVIEW_PARITY_POLICY.requiredAuth.some(provider => runtime.auth?.[provider]?.state !== 'authenticated'
      || expected.expectedRuntimeAuth?.[provider]?.state !== 'authenticated'
      || runtime.auth[provider].target !== expected.expectedRuntimeAuth[provider].target
      || runtime.auth[provider].mode !== expected.expectedRuntimeAuth[provider].mode)) throw new Error('Production runtime readback differs from reviewed flag, external-action safety, or provider authentication observations.');
  return true;
}

export async function githubReleaseOidc({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  try {
    const request = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
    if (request.protocol !== 'https:' || !request.hostname.endsWith('.actions.githubusercontent.com')
      || request.username || request.password || request.port || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) throw new Error('request');
    request.searchParams.set('audience', 'fcos-production-release');
    const response = await fetchImpl(request.href, { headers: { authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok || response.redirected) throw new Error('token');
    const token = (await response.json()).value;
    if (typeof token !== 'string' || token.length > 32768) throw new Error('token');
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('token');
    const header = JSON.parse(Buffer.from(parts[0], 'base64url')), claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || claims.iss !== 'https://token.actions.githubusercontent.com'
      || claims.aud !== 'fcos-production-release' || !Number.isFinite(claims.exp) || !Number.isFinite(claims.iat)
      || claims.iat * 1000 > now + 30000 || now - claims.iat * 1000 > 300000 || claims.exp * 1000 <= now
      || claims.exp - claims.iat > 600 || Number.isFinite(claims.nbf) && claims.nbf * 1000 > now + 30000) throw new Error('claims');
    const keysResponse = await fetchImpl('https://token.actions.githubusercontent.com/.well-known/jwks', { redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!keysResponse.ok || keysResponse.redirected) throw new Error('keys');
    const keys = (await keysResponse.json()).keys;
    const key = keys?.find(value => value.kid === header.kid && value.kty === 'RSA' && value.use === 'sig' && value.alg === 'RS256');
    if (!key || !verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))) throw new Error('signature');
    return claims;
  } catch { throw new Error('Production requires a current cryptographically verified GitHub Actions identity; local flags or JSON do not authorize execution.'); }
}

export function assertVercelProductionAuthority({ user, team, project, token, reviewedTokenId, deploymentConfiguration, hooks, now = Date.now() } = {}) {
  const teamId = fcosConnectionIdentifier('vercel', 'Team ID'), projectId = fcosConnectionIdentifier('vercel', 'Project ID');
  const [owner, repository] = fcosConnectionIdentifier('github', 'Repository').split('/');
  if (user?.username !== fcosConnectionIdentifier('vercel', 'Account') || team?.id !== teamId
    || team.slug !== fcosConnectionIdentifier('vercel', 'Team') || team.membership?.role !== 'OWNER'
    || project?.id !== projectId || project.accountId !== teamId || project.link?.org !== owner || project.link?.repo !== repository) throw new Error('Production Vercel account, owner capability, team, project, or repository identity mismatch.');
  if (!reviewedTokenId || token?.id !== reviewedTokenId || token.revokedAt || token.leakedAt
    || token.expiresAt && Number(token.expiresAt) <= now || !token.scopes?.some(scope => scope.type === 'team' && scope.teamId === teamId
      && (!scope.expiresAt || Number(scope.expiresAt) > now)) || token.scopes.some(scope => !['team'].includes(scope.type))) throw new Error('Dedicated Production token scope and metadata do not establish the required deployment capability.');
  const branch = project.link.productionBranch;
  const enabled = deploymentConfiguration?.git?.deploymentEnabled;
  const disabled = enabled === false || branch && enabled && typeof enabled === 'object' && (enabled[branch] === false || enabled[branch] === undefined && enabled['*'] === false);
  if (!disabled || project.autoAssignCustomDomains !== false || !Array.isArray(hooks) || hooks.length !== 0) throw new Error('Automatic Production Git deployment, domain assignment, or deployment hooks could bypass the human gate.');
  return { identityVerified: true, targetPin: 'verified', permissionStatus: 'verified', versionStatus: 'verified',
    permissions: ['project.read', 'deployment.read', 'deployment.create'], deploymentCreate: 'verified', projectId, teamId };
}

export function productionDeployArguments({ sha, sourceDigest, operationId } = {}) {
  if (!SHA.test(sha || '') || !HASH.test(sourceDigest || '') || !/^fcos-release-[1-9][0-9]*$/.test(operationId || '')) throw new Error('Invalid exact Production deployment identity.');
  return ['deploy', '--prod', '--skip-domain', '--yes', '--no-wait', '--meta', `githubCommitSha=${sha}`,
    '--meta', `fcosReleaseOperation=${operationId}`, '--build-env', `FCOS_BUILD_COMMIT_SHA=${sha}`,
    '--build-env', `FCOS_EXPECTED_SOURCE_SHA256=${sourceDigest}`];
}

/** Small durable state machine. Adapters enforce live protection/target checks.
 * A durable intent is written before each external operation. Uncertain outcomes
 * may only be read back; neither deployment nor promotion is blindly retried.
 */
export async function executeProductionRelease({ readiness, authority, journal, deploy, discover, waitReady, probe, promote, currentProduction, now = () => Date.now() } = {}) {
  if (readiness?.ready !== true || readiness.productionAuthorized !== false || readiness.blockers?.length
    || !SHA.test(readiness.candidate?.sha || '') || !HASH.test(readiness.candidate?.sourceDigest || '')) throw new Error('A fresh independently collected unblocked readiness report is required.');
  const approved = await authority();
  const operationId = `fcos-release-${approved.runId}`;
  const previous = await currentProduction();
  if (previous.id !== readiness.previousProduction.deploymentId || previous.sha !== readiness.previousProduction.sha) throw new Error('Production changed after readiness collection.');
  const context = { schemaVersion: 1, operationId, candidate: readiness.candidate, previousProduction: previous,
    authorization: { runId: approved.runId, reviewerId: approved.reviewerId, environmentId: approved.environmentId },
    rollback: { command: ['vercel', 'rollback', previous.id], requiresHumanAuthorization: true } };
  await journal({ ...context, phase: 'deploy_requested', capturedAt: new Date(now()).toISOString() }, { first: true });
  let staged;
  try { staged = await deploy(productionDeployArguments({ sha: readiness.candidate.sha, sourceDigest: readiness.candidate.sourceDigest, operationId })); }
  catch {
    staged = await discover(operationId);
    if (!staged) {
      await journal({ ...context, phase: 'deploy_outcome_uncertain', capturedAt: new Date(now()).toISOString() });
      throw new Error('Production deployment outcome is uncertain. Read back this operation before any retry.');
    }
  }
  await journal({ ...context, stagedProduction: staged, phase: 'staged_build', capturedAt: new Date(now()).toISOString() });
  staged = await waitReady(staged);
  if (staged?.target !== 'production' || staged?.state !== 'READY' || staged?.sha !== readiness.candidate.sha || staged?.operationId !== operationId
    || staged.id === readiness.candidate.deploymentId || staged.id === previous.id) throw new Error('Staged Production deployment identity or READY state failed.');
  await journal({ ...context, stagedProduction: staged, phase: 'staged_ready', capturedAt: new Date(now()).toISOString() });
  try { await probe(staged, readiness); }
  catch {
    await journal({ ...context, stagedProduction: staged, phase: 'staged_readback_failed', capturedAt: new Date(now()).toISOString() });
    throw new Error('Staged Production readback failed. No domain assignment was performed.');
  }
  await authority(); // Recheck human approval, protections, exact config and token.
  const beforePromotion = await currentProduction();
  if (beforePromotion.id !== previous.id) throw new Error('Production changed before domain assignment.');
  await journal({ ...context, stagedProduction: staged, phase: 'promotion_requested', capturedAt: new Date(now()).toISOString() });
  let uncertain = false;
  try { await promote(staged); } catch { uncertain = true; }
  const live = await currentProduction();
  if (live.id !== staged.id || live.sha !== readiness.candidate.sha) {
    await journal({ ...context, stagedProduction: staged, phase: uncertain ? 'promotion_outcome_uncertain' : 'promotion_readback_failed', capturedAt: new Date(now()).toISOString() });
    throw new Error('Production domain assignment was not confirmed. Read back before retry; the previous deployment is recorded for explicit rollback.');
  }
  try { await probe(live, readiness, { publicDomain: true }); }
  catch {
    await journal({ ...context, stagedProduction: staged, liveProduction: live, phase: 'public_readback_failed', capturedAt: new Date(now()).toISOString() });
    throw new Error('Production public readback failed. The exact previous deployment is recorded for a human-authorized rollback.');
  }
  const complete = { ...context, stagedProduction: staged, liveProduction: live, phase: 'complete', capturedAt: new Date(now()).toISOString() };
  await journal(complete);
  return complete;
}

// The CLI may not expose account-level token metadata under team scope. The
// fallback repeats identity verification using the same approved credential.
export async function readVercelTokenMetadata({ cliRead, token, fetchImpl = globalThis.fetch } = {}) {
  try { const value = cliRead('/v5/user/tokens/current')?.token; if (value) return value; }
  catch { /* Only fixed GETs below; never refresh or change credentials. */ }
  if (!token) throw new Error('Vercel token metadata is unavailable.');
  const read = async path => {
    const response = await fetchImpl(`https://api.vercel.com${path}`, { method: 'GET',
      headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok || response.redirected) throw new Error('Vercel metadata fallback is unavailable.');
    return response.json();
  };
  if ((await read('/v2/user'))?.user?.username !== fcosConnectionIdentifier('vercel', 'Account')) throw new Error('Vercel API credential account mismatch.');
  const value = (await read('/v5/user/tokens/current'))?.token;
  if (!value || typeof value.id !== 'string' || !Array.isArray(value.scopes)) throw new Error('Vercel token metadata is unavailable.');
  return value;
}
