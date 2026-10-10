import { fork } from 'node:child_process';

export const PROOF_WORKER_MAX_MS = 300000;
const phases = new Set(['admission-started', 'admission-complete', 'worker-admission-started', 'worker-admission-complete',
  'concurrency-started', 'concurrency-settled', 'upload-started', 'upload-complete', 'readback-started', 'readback-complete',
  'duplicate-refusal-started', 'crash-started', 'crash-settled', 'crash-recovery-started', 'terminal-context-started',
  'terminal-context-complete', 'worker-complete', 'worker-deadline-uncertain', 'worker-exit-uncertain',
  'worker-protocol-uncertain', 'worker-cancelled-uncertain', 'report-written']);

/** No worker strings, exception details, URLs, credentials or response bodies reach logs. */
export function proofPhase(phase, write = value => process.stdout.write(value)) {
  if (!phases.has(phase)) throw new Error('Unrecognized artifact proof phase.');
  write(`FCOS artifact proof phase: ${phase}\n`);
}
export function proofWorkerUncertain() {
  return Object.assign(new Error('Artifact proof worker outcome uncertain. Preserve the original operation and lease for GET-only readback.'),
    { code: 'FCOS_PROOF_WORKER_UNCERTAIN', uncertainOutcomeRequiresReadback: true });
}
/** Install before any asynchronous admission read, including when the supervisor is killed. */
export function guardProofWorkerParent(groupLeader) {
  const connected = () => {
    if (typeof process.send !== 'function' || !process.connected) throw proofWorkerUncertain();
  };
  connected();
  process.once('disconnect', () => {
    if (groupLeader) { try { process.kill(-process.pid, 'SIGKILL'); } catch {} }
    process.exit(1);
  });
  return connected;
}

/** The timer runs outside backend work, including synchronous CLI reads and hung SDK promises.
 * A process-group kill stops the worker and its crash child before rejection. Remote requests
 * already accepted can still complete; this helper never retries or declares them absent. */
export function superviseCoordinationProofWorker({ workerPath, admission, cwd, env = process.env,
  deadline, maxWallClockMs = PROOF_WORKER_MAX_MS, onPhase = proofPhase }) {
  const startedAt = Date.now();
  if (process.platform === 'win32' || !Number.isSafeInteger(deadline) || deadline <= startedAt
    || !Number.isSafeInteger(maxWallClockMs) || maxWallClockMs <= 0 || admission?.deadline !== deadline) {
    return Promise.reject(proofWorkerUncertain());
  }
  const stopAt = Math.min(deadline, startedAt + Math.min(maxWallClockMs, PROOF_WORKER_MAX_MS));
  return new Promise((resolve, reject) => {
    let child, result, received = false, failure, parentSignal;
    const killGroup = () => {
      if (Number.isSafeInteger(child?.pid) && child.pid > 0) {
        try { process.kill(-child.pid, 'SIGKILL'); }
        catch (error) { if (error.code !== 'ESRCH') child.kill('SIGKILL'); }
      }
    };
    const emit = phase => { try { onPhase(phase); } catch { stop('worker-protocol-uncertain'); } };
    const stop = phase => {
      if (failure) return;
      failure = phase;
      // The detached worker owns this process group; never signal the caller's group.
      killGroup();
    };
    try {
      if (Date.now() >= stopAt) { reject(proofWorkerUncertain()); return; }
      child = fork(workerPath, ['--proof-worker'], { cwd, env, execArgv: [], detached: true,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    } catch { reject(proofWorkerUncertain()); return; }
    const timer = setTimeout(() => stop('worker-deadline-uncertain'), Math.max(1, stopAt - Date.now()));
    const signals = ['SIGINT', 'SIGTERM'].map(signal => [signal, () => {
      parentSignal = signal; stop('worker-cancelled-uncertain');
    }]);
    for (const [signal, handler] of signals) process.prependOnceListener(signal, handler);
    process.once('exit', killGroup);
    child.on('error', () => stop('worker-exit-uncertain'));
    child.on('message', message => {
      if (failure) return;
      if (Date.now() >= stopAt) { stop('worker-deadline-uncertain'); return; }
      if (message?.type === 'phase' && Object.keys(message).length === 2 && phases.has(message.phase)) {
        emit(message.phase);
      } else if (message?.type === 'result' && Object.keys(message).length === 2 && !received
        && message.result && typeof message.result === 'object' && !Array.isArray(message.result)) {
        result = message.result; received = true;
      } else stop('worker-protocol-uncertain');
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      killGroup(); // Includes descendants left by a normal or unexpectedly exited worker.
      process.removeListener('exit', killGroup);
      for (const [signal, handler] of signals) process.removeListener(signal, handler);
      if (!failure && Date.now() >= stopAt) failure = 'worker-deadline-uncertain';
      if (!failure && (code !== 0 || signal !== null || !received)) failure = 'worker-exit-uncertain';
      emit(failure || 'worker-complete');
      if (failure) reject(proofWorkerUncertain()); else resolve(result);
      if (parentSignal) process.kill(process.pid, parentSignal);
    });
    try { child.send({ mode: 'proof', admission }, error => { if (error) stop('worker-exit-uncertain'); }); }
    catch { stop('worker-exit-uncertain'); }
  });
}
