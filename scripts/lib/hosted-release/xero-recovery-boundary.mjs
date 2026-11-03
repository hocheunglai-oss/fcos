import { constants, openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { runGuardedProviderWrite } from '../guarded-provider-write.mjs';

const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const EXPECTED = ['epoch', 'objective', 'ownerThreadId', 'operationId', 'bindingSha256'];
const PROOF = ['ownerThreadId', 'actorId', 'tenantId', 'sessionVersion', 'approvalSha256', 'runtimeSha256', 'actorSha256', 'schemaSha256', 'capturedAt', 'notAfter'];
const CALLBACKS = ['claim', 'assertLease', 'recordIntent', 'submit', 'recordOutcome', 'validateProviderResult'];
const BASE_STEPS = ['sessionRead', 'probeGrant', 'probeAdmission', 'organisationsGet', 'probeObservation', 'finalRead'];
const RENEW_STEPS = ['refreshClaim', 'tokenRenew', 'refreshFinish', 'renewedSessionRead'];

function refusal(reason, step = null) {
  return Object.assign(new Error('Xero recovery boundary stopped; owner readback is required.'), {
    code: 'XERO_RECOVERY_TERMINAL', reason, step, requiresReadback: true, retryable: false,
  });
}

/** An offline-prepared owner boundary, not an endpoint, credential reader or
 * authority grant. The original owner must authenticate every referenced proof
 * and qualify the real guard callbacks/ack validators before constructing it.
 * Hash syntax alone does not authenticate runtime, actor or financial scope.
 *
 * Each callback must perform ONE supported action only. This wrapper cannot
 * intercept tools/network calls hidden inside a callback or made outside it.
 * In particular do not pass the whole catch-and-cleanup renewal helper as submit.
 * It has no failRefresh/release/retry path. After a terminal event, only local
 * journal/state/descriptor cleanup is permitted; a new owner readback is separate.
 */
export function createXeroRecoveryBoundary({ expected, proof, journalPath, renewalRequired, now = Date.now, callbackTimeoutMs = 60_000 } = {}) {
  if (typeof now !== 'function') throw refusal('binding');
  const at = now();
  if (!Number.isSafeInteger(at) || !exact(expected, EXPECTED) || !EXPECTED.every(key => typeof expected[key] === 'string' && expected[key].length > 0 && expected[key].length <= 200)
    || !HASH.test(expected.bindingSha256) || !exact(proof, PROOF) || proof.ownerThreadId !== expected.ownerThreadId
    || !['ownerThreadId', 'actorId', 'tenantId'].every(key => UUID.test(proof[key]))
    || !Number.isSafeInteger(proof.sessionVersion) || proof.sessionVersion < 1
    || !['approvalSha256', 'runtimeSha256', 'actorSha256', 'schemaSha256'].every(key => HASH.test(proof[key]))
    || !Number.isSafeInteger(proof.capturedAt) || !Number.isSafeInteger(proof.notAfter) || proof.capturedAt > at
    || at - proof.capturedAt > 60_000 || proof.notAfter <= at || proof.notAfter - proof.capturedAt > 180_000
    || typeof renewalRequired !== 'boolean' || typeof journalPath !== 'string' || !isAbsolute(journalPath)
    || !Number.isSafeInteger(callbackTimeoutMs) || callbackTimeoutMs < 1 || callbackTimeoutMs > 60_000) throw refusal('binding');

  const binding = Object.freeze({ ...expected });
  const evidence = Object.freeze({ ...proof });
  const steps = [...BASE_STEPS];
  if (renewalRequired) steps.splice(1, 0, ...RENEW_STEPS);
  let fd;
  let terminal;
  let busy = false;
  let index = 0;
  let lastTime = at;
  let sequence = 0;
  const append = event => {
    const line = JSON.stringify({ sequence: sequence++, ...event }) + '\n';
    const bytes = Buffer.from(line);
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
    fsyncSync(fd);
  };
  const stop = (reason, step) => {
    if (!terminal) {
      terminal = refusal(reason, step);
      try { append({ kind: 'terminal', reason, step, at: now() }); } catch { /* No remote cleanup on local journal failure. */ }
    }
    return terminal;
  };
  const active = step => {
    if (terminal) throw terminal;
    const current = now();
    if (!Number.isSafeInteger(current) || current < lastTime || current >= evidence.notAfter || fd === undefined) throw stop('expired_or_closed', step);
    lastTime = current;
  };
  try {
    // The owner supplies a private original-operation directory. Exclusive
    // creation forbids automatic resume/replay of a pre-existing journal.
    fd = openSync(journalPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    append({ kind: 'owner_boundary', expected: binding, proof: evidence, steps, at });
    const parent = openSync(dirname(journalPath), constants.O_RDONLY);
    try { fsyncSync(parent); } finally { closeSync(parent); }
  } catch {
    if (fd !== undefined) closeSync(fd);
    fd = undefined;
    throw refusal('journal_unavailable');
  }

  return Object.freeze({
    async runStep(step, callbacks) {
      active(step);
      if (busy || steps[index] !== step || !exact(callbacks, CALLBACKS) || !CALLBACKS.every(key => typeof callbacks[key] === 'function')) throw stop('sequence_or_callbacks', step);
      const actions = Object.freeze({ ...callbacks });
      busy = true;
      try {
        append({ kind: 'step_prepared', step, index, at: now() });
        const wrapped = {};
        for (const key of CALLBACKS.filter(key => key !== 'validateProviderResult')) {
          wrapped[key] = async input => {
            active(step);
            // The generic guard normally attempts an uncertain outcome callback.
            // Here a failed/pending provider result must stop ALL further RPCs.
            if (key === 'recordOutcome' && input.outcome?.state !== 'submitted') throw stop('provider_unconfirmed', step);
            let timer;
            try {
              const value = await Promise.race([
                Promise.resolve().then(() => { active(step); return actions[key](input); }),
                new Promise((_, reject) => { timer = setTimeout(() => reject(stop('callback_timeout', step)), Math.min(callbackTimeoutMs, evidence.notAfter - now())); }),
              ]);
              active(step);
              return value;
            } catch {
              throw stop('callback_refused_or_unknown', step);
            } finally { clearTimeout(timer); }
          };
        }
        wrapped.validateProviderResult = result => {
          active(step);
          try {
            if (actions.validateProviderResult(result) !== true) throw stop('provider_unconfirmed', step);
            return true;
          } catch { throw stop('provider_unconfirmed', step); }
        };
        const result = await runGuardedProviderWrite({ expected: binding, ...wrapped });
        active(step);
        if (result.status !== 'submitted_acknowledged') throw stop('guard_unconfirmed', step);
        append({ kind: 'step_acknowledged', step, index, at: now() });
        index++;
        return result; // Trusted caller only; never journal/export providerResult.
      } catch {
        throw stop('guard_refused_or_unknown', step);
      } finally { busy = false; }
    },
    state() {
      return Object.freeze({ terminal: Boolean(terminal), completedSteps: index, nextStep: terminal ? null : steps[index] || null,
        sequenceComplete: !terminal && index === steps.length, executionAuthorityGranted: false });
    },
    close() {
      if (busy) stop('closed_while_running', steps[index]);
      if (fd !== undefined) {
        const closing = fd;
        fd = undefined;
        closeSync(closing);
      }
    },
  });
}
