import { canonicalFcosE2eCandidateUrl } from '../verify-e2e-candidate.mjs';

export const COMPATIBILITY_BACKGROUND_SYNC_LOCK = 'fcos:email-router-background-sync';
const guardianPath = '/app-version.json';
const telemetryPath = '/_vercel/speed-insights/script.js';
const stateKey = '__fcosCompatibilityBrowserIsolation';
const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export function compatibilityTelemetryScriptExcluded({ url, method, resourceType, functionName, body }, origin) {
  let target;
  try { target = new URL(url); } catch { return false; }
  return target.origin === origin && !target.username && !target.password && !target.search && !target.hash
    && target.pathname === telemetryPath && method === 'GET' && resourceType === 'script'
    && functionName === undefined && (body === undefined || body === null);
}

export function assertCompatibilityWorkspacePreferences(data) {
  if (data?.error || data?.preferences?.initialized !== true) {
    throw new Error('Existing workspace preferences must already be initialized; read-only verification cannot migrate them.');
  }
  return { handler: 'workspacePreferencesGet', initialized: true, responseVerified: true };
}

export function compatibilityBrowserIsolationVerified(proof, binding, modules) {
  return exactKeys(proof, ['schemaVersion', 'kind', 'candidateUrl', 'candidateSha', 'harnessSha', 'deploymentId', 'sourceDigest',
    'guardian', 'backgroundSync', 'workspacePreferences', 'telemetry', 'blockedRequests', 'contextClosed'])
    && proof.schemaVersion === 1 && proof.kind === 'fcos_compatibility_browser_isolation'
    && proof.candidateUrl === binding?.candidateUrl && proof.candidateSha === binding?.sha
    && /^[0-9a-f]{40}$/.test(proof.harnessSha || '') && proof.harnessSha === binding?.harnessSha
    && proof.deploymentId === binding?.deploymentId && proof.sourceDigest === binding?.sourceDigest
    && exactKeys(proof.guardian, ['path', 'contentType', 'provenanceVerified', 'closed'])
    && proof.guardian.path === guardianPath && proof.guardian.contentType === 'application/json'
    && proof.guardian.provenanceVerified === true && proof.guardian.closed === true
    && exactKeys(proof.backgroundSync, ['excludedFeature', 'lockName', 'mode', 'sameContext', 'webLocks', 'broadcastChannel',
      'acquiredBeforeNavigation', 'modules', 'finalHeld', 'released'])
    && proof.backgroundSync.excludedFeature === 'automatic_mailbox_sync'
    && proof.backgroundSync.lockName === COMPATIBILITY_BACKGROUND_SYNC_LOCK && proof.backgroundSync.mode === 'exclusive'
    && ['sameContext', 'webLocks', 'broadcastChannel', 'acquiredBeforeNavigation', 'finalHeld', 'released'].every(key => proof.backgroundSync[key] === true)
    && Array.isArray(modules) && modules.length === 15 && new Set(modules).size === 15
    && Array.isArray(proof.backgroundSync.modules) && proof.backgroundSync.modules.length === modules.length
    && modules.every((module, index) => exactKeys(proof.backgroundSync.modules[index], ['module', 'before', 'after'])
      && proof.backgroundSync.modules[index].module === module
      && proof.backgroundSync.modules[index].before === true && proof.backgroundSync.modules[index].after === true)
    && exactKeys(proof.workspacePreferences, ['handler', 'initialized', 'responseVerified'])
    && proof.workspacePreferences.handler === 'workspacePreferencesGet' && proof.workspacePreferences.initialized === true
    && proof.workspacePreferences.responseVerified === true
    && exactKeys(proof.telemetry, ['excludedFeature', 'path', 'method', 'resourceType', 'noQuery', 'policy', 'abortedRequests'])
    && proof.telemetry.excludedFeature === 'speed_insights' && proof.telemetry.path === telemetryPath
    && proof.telemetry.method === 'GET' && proof.telemetry.resourceType === 'script' && proof.telemetry.noQuery === true
    && proof.telemetry.policy === 'abort_before_execution'
    && Number.isSafeInteger(proof.telemetry.abortedRequests) && proof.telemetry.abortedRequests >= 0 && proof.telemetry.abortedRequests <= 1000
    && proof.blockedRequests === 0 && proof.contextClosed === true;
}

/** A real same-context guardian holds the app's existing exclusive Web Lock.
 * No app code, request response, status event, or business state is fabricated.
 * Closing the context is a fallback cleanup, never proof of explicit release.
 */
export async function acquireCompatibilityBrowserIsolation({ context, origin, version, harnessSha }) {
  if (canonicalFcosE2eCandidateUrl(origin) !== origin || !/^[0-9a-f]{40}$/.test(harnessSha || '') || !/^[0-9a-f]{40}$/.test(version?.commit || '') || !version?.deploymentId
    || !/^[0-9a-f]{64}$/.test(version.provenance?.sourceDigest || '') || version.provenance.releaseEligible !== true) {
    throw new Error('Compatibility browser isolation binding is invalid.');
  }
  const guardian = await context.newPage();
  const modules = [];
  let finalHeld = false, released = false, closed = false;
  try {
    const response = await guardian.goto(`${origin}${guardianPath}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    if (!response || response.status() !== 200 || response.url() !== `${origin}${guardianPath}`
      || guardian.url() !== `${origin}${guardianPath}` || response.request().redirectedFrom()
      || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers()['content-type'] || '')) {
      throw new Error('Compatibility guardian document is not the verified JSON surface.');
    }
    const observed = await response.json();
    if (observed.commit !== version.commit || observed.deploymentId !== version.deploymentId
      || observed.provenance?.sourceDigest !== version.provenance.sourceDigest || observed.provenance.releaseEligible !== true) {
      throw new Error('Compatibility guardian provenance differs from the verified candidate.');
    }
    const documentVerified = await guardian.evaluate(expected => {
      if (location.href !== expected.url || document.contentType !== 'application/json') return false;
      let data;
      try { data = JSON.parse(document.body.innerText); } catch { return false; }
      return data.commit === expected.commit && data.deploymentId === expected.deploymentId
        && data.provenance?.sourceDigest === expected.sourceDigest && data.provenance.releaseEligible === true;
    }, { url: `${origin}${guardianPath}`, commit: version.commit, deploymentId: version.deploymentId, sourceDigest: version.provenance.sourceDigest });
    if (!documentVerified) throw new Error('Compatibility guardian document provenance is unavailable.');
    const acquired = await guardian.evaluate(async ({ name, key }) => {
      if (!isSecureContext || !navigator.locks?.request || !navigator.locks?.query || typeof BroadcastChannel !== 'function') return false;
      try { const channel = new BroadcastChannel('fcos:email-router-background-sync-events'); channel.close(); } catch { return false; }
      if (Object.hasOwn(globalThis, key)) return false;
      const state = { held: false, released: false, release: null, completion: null };
      Object.defineProperty(globalThis, key, { value: state });
      let ready;
      const readiness = new Promise(resolve => { ready = resolve; });
      const timeout = setTimeout(() => ready(false), 5000);
      state.completion = navigator.locks.request(name, { mode: 'exclusive', ifAvailable: true }, async lock => {
        if (!lock) { ready(false); return; }
        state.held = true;
        const hold = new Promise(resolve => { state.release = resolve; });
        ready(true);
        await hold;
        state.held = false;
        state.released = true;
      }).catch(() => { state.held = false; ready(false); });
      const result = await readiness;
      clearTimeout(timeout);
      return result === true;
    }, { name: COMPATIBILITY_BACKGROUND_SYNC_LOCK, key: stateKey });
    if (!acquired) throw new Error('Compatibility background synchronization lock could not be acquired.');
  } catch (error) {
    await guardian.close().catch(() => {});
    throw error;
  }

  const checkHeld = async () => {
    if (guardian.isClosed() || guardian.context() !== context || guardian.url() !== `${origin}${guardianPath}`) throw new Error('Compatibility guardian lifetime failed.');
    const held = await guardian.evaluate(async ({ name, key }) => {
      const state = globalThis[key];
      if (!state?.held || state.released || !navigator.locks?.query || typeof BroadcastChannel !== 'function') return false;
      const snapshot = await navigator.locks.query();
      return snapshot.held.filter(lock => lock.name === name && lock.mode === 'exclusive').length === 1;
    }, { name: COMPATIBILITY_BACKGROUND_SYNC_LOCK, key: stateKey });
    if (!held) throw new Error('Compatibility background synchronization lock is no longer held.');
  };
  try { await checkHeld(); } catch (error) { await guardian.close().catch(() => {}); throw error; }
  return {
    async assertHeld(module, phase) {
      await checkHeld();
      if (phase === 'before') {
        if (modules.some(row => row.module === module) || modules.at(-1)?.after === false) throw new Error('Compatibility module lock ordering failed.');
        modules.push({ module, before: true, after: false });
      } else if (phase === 'after' && modules.at(-1)?.module === module && modules.at(-1).after === false) modules.at(-1).after = true;
      else if (phase === 'final') finalHeld = true;
      else throw new Error('Compatibility module lock phase failed.');
    },
    async release() {
      if (released || closed) throw new Error('Compatibility isolation release cannot replay.');
      await checkHeld();
      const complete = await guardian.evaluate(async key => {
        const state = globalThis[key];
        if (!state?.held || typeof state.release !== 'function') return false;
        state.release();
        await state.completion;
        return state.released === true && state.held === false;
      }, stateKey);
      if (!complete) throw new Error('Compatibility lock release was not confirmed.');
      released = true;
      await guardian.close();
      closed = guardian.isClosed();
      if (!closed) throw new Error('Compatibility guardian cleanup failed.');
    },
    evidence({ workspacePreferences, telemetryAbortedRequests, blockedRequests, contextClosed }) {
      return { schemaVersion: 1, kind: 'fcos_compatibility_browser_isolation', candidateUrl: origin, candidateSha: version.commit, harnessSha,
        deploymentId: version.deploymentId, sourceDigest: version.provenance.sourceDigest,
        guardian: { path: guardianPath, contentType: 'application/json', provenanceVerified: true, closed },
        backgroundSync: { excludedFeature: 'automatic_mailbox_sync', lockName: COMPATIBILITY_BACKGROUND_SYNC_LOCK, mode: 'exclusive',
          sameContext: true, webLocks: true, broadcastChannel: true, acquiredBeforeNavigation: true, modules: modules.map(row => ({ ...row })), finalHeld, released },
        workspacePreferences, telemetry: { excludedFeature: 'speed_insights', path: telemetryPath, method: 'GET', resourceType: 'script',
          noQuery: true, policy: 'abort_before_execution', abortedRequests: telemetryAbortedRequests }, blockedRequests, contextClosed };
    },
  };
}
