import { fork } from 'node:child_process';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

export const PROOF_WORKER_MAX_MS = 300000;
export const PROOF_STARTUP_MAX_MS = 1800000;
export const PROOF_CLOCK_DISCOVERY_MAX_MS = 60000;
const ownPath = fileURLToPath(import.meta.url);
const phases = new Set(['admission-started', 'admission-complete', 'worker-admission-started', 'worker-admission-complete',
  'concurrency-started', 'concurrency-settled', 'upload-started', 'upload-complete', 'readback-started', 'readback-complete',
  'duplicate-refusal-started', 'crash-started', 'crash-settled', 'crash-recovery-started', 'terminal-context-started',
  'terminal-context-complete', 'worker-complete', 'worker-deadline-uncertain', 'worker-exit-uncertain',
  'worker-protocol-uncertain', 'worker-cancelled-uncertain', 'original-deadline-bound', 'report-written']);

/** No worker strings, exception details, URLs, credentials or response bodies reach logs. */
export function proofPhase(phase, write = value => process.stdout.write(value)) {
  if (!phases.has(phase)) throw new Error('Unrecognized artifact proof phase.');
  write(`FCOS artifact proof phase: ${phase}\n`);
}
export function proofWorkerUncertain() {
  return Object.assign(new Error('Artifact proof worker outcome uncertain. Preserve the original operation and lease for GET-only readback.'),
    { code: 'FCOS_PROOF_WORKER_UNCERTAIN', uncertainOutcomeRequiresReadback: true });
}
/** Install before asynchronous admission; the responsive controller also covers synchronous stalls. */
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
const positive = value => Number.isSafeInteger(value) && value > 0;
function killGroup(pid) {
  if (positive(pid)) { try { process.kill(-pid, 'SIGKILL'); } catch {} }
}
/** Every timer is armed before admission starts. Wall-clock changes cannot extend monotonic bounds. */
function proofClock({ deadline, startupDeadline, discoveryDeadline, maxWallClockMs, clockDiscoveryMaxMs }, expire) {
  let wallStop = Math.min(deadline ?? Number.MAX_SAFE_INTEGER, startupDeadline ?? Number.MAX_SAFE_INTEGER,
    Date.now() + Math.min(maxWallClockMs, PROOF_STARTUP_MAX_MS));
  const discoverBy = Math.min(discoveryDeadline ?? Number.MAX_SAFE_INTEGER,
    Date.now() + Math.min(clockDiscoveryMaxMs, PROOF_CLOCK_DISCOVERY_MAX_MS));
  const discoveryMono = performance.now() + Math.max(0, discoverBy - Date.now());
  let monoStop = performance.now() + Math.max(0, wallStop - Date.now()), timer, discovered = false;
  const expired = () => Date.now() >= wallStop || performance.now() >= monoStop
    || !discovered && (Date.now() >= discoverBy || performance.now() >= discoveryMono);
  const tighten = value => {
    wallStop = Math.min(wallStop, value);
    monoStop = Math.min(monoStop, performance.now() + Math.max(0, value - Date.now()));
    clearTimeout(timer);
    if (expired()) expire();
    else timer = setTimeout(expire, Math.max(1, monoStop - performance.now()));
  };
  tighten(wallStop);
  const discovery = setTimeout(expire, Math.max(1, discoveryMono - performance.now()));
  return { expired, tighten, observe: value => {
    if (expired()) { expire(); return; }
    discovered = true; clearTimeout(discovery); tighten(value);
  },
    close: () => { clearTimeout(timer); clearTimeout(discovery); }, deadline: wallStop, discoveryDeadline: discoverBy };
}
function validOptions({ deadline, maxWallClockMs, backendMaxWallClockMs, clockDiscoveryMaxMs, admission }) {
  return process.platform !== 'win32' && (deadline === undefined || positive(deadline) && deadline > Date.now())
    && positive(maxWallClockMs) && positive(backendMaxWallClockMs) && positive(clockDiscoveryMaxMs)
    && (!admission || admission.deadline === deadline);
}

/** The controller stays responsive outside one detached admission/backend/crash process group.
 * Outer loss kills that group through controller disconnect; controller loss kills it through
 * the outer parent. Remote requests already accepted remain uncertain and are never retried. */
export function superviseCoordinationProofWorker({ workerPath, admission, cwd, env = process.env, deadline,
  maxWallClockMs = PROOF_STARTUP_MAX_MS, backendMaxWallClockMs = PROOF_WORKER_MAX_MS,
  clockDiscoveryMaxMs = PROOF_CLOCK_DISCOVERY_MAX_MS, onPhase = proofPhase }) {
  const options = { deadline, maxWallClockMs, backendMaxWallClockMs, clockDiscoveryMaxMs, admission };
  if (!validOptions(options)) return Promise.reject(proofWorkerUncertain());
  const startedAt = Date.now();
  return new Promise((resolveResult, reject) => {
    let controller, groupPid, report, received = false, failure, parentSignal, clockBound, admitted;
    const cleanup = () => { killGroup(groupPid); controller?.kill('SIGKILL'); };
    const stop = phase => { if (!failure) { failure = phase; cleanup(); } };
    const emit = phase => { try { onPhase(phase); } catch { stop('worker-protocol-uncertain'); } };
    const clock = proofClock(options, () => stop('worker-deadline-uncertain'));
    if (failure) { clock.close(); reject(proofWorkerUncertain()); return; }
    try {
      controller = fork(ownPath, ['--proof-controller'], { cwd, env, execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    } catch { clock.close(); reject(proofWorkerUncertain()); return; }
    const signals = ['SIGINT', 'SIGTERM'].map(signal => [signal, () => {
      parentSignal = signal; stop('worker-cancelled-uncertain');
    }]);
    for (const [signal, handler] of signals) process.prependOnceListener(signal, handler);
    process.once('exit', cleanup);
    controller.on('error', () => stop('worker-exit-uncertain'));
    controller.on('message', message => {
      if (failure) return;
      if (clock.expired()) { stop('worker-deadline-uncertain'); return; }
      if (message?.type === 'group' && Object.keys(message).length === 2 && !groupPid && positive(message.pid)
        && message.pid !== process.pid && message.pid !== controller.pid) {
        groupPid = message.pid;
        controller.send({ type: 'start' }, error => { if (error) stop('worker-exit-uncertain'); });
      } else if (message?.type === 'phase' && Object.keys(message).length === 2 && phases.has(message.phase)) {
        if (message.phase.endsWith('-uncertain')) stop(message.phase); else emit(message.phase);
      } else if (message?.type === 'clock' && Object.keys(message).length === 2 && positive(message.deadline)) {
        clockBound = Math.min(clockBound ?? Number.MAX_SAFE_INTEGER, message.deadline);
        clock.observe(clockBound);
      } else if (message?.type === 'admitted' && Object.keys(message).length === 3 && !admitted
        && message.admission?.deadline === clockBound && positive(clockBound)
        && message.admission.binding && message.admission.action
        && positive(message.startedAt) && message.startedAt >= startedAt && message.startedAt <= Date.now()) {
        admitted = message.admission;
        clock.tighten(message.startedAt + Math.min(backendMaxWallClockMs, PROOF_WORKER_MAX_MS));
      } else if (message?.type === 'result' && Object.keys(message).length === 2 && !received && admitted
        && message.result && typeof message.result === 'object' && !Array.isArray(message.result)) {
        report = message.result; received = true;
      } else stop('worker-protocol-uncertain');
    });
    controller.once('close', (code, signal) => {
      clock.close(); killGroup(groupPid);
      process.removeListener('exit', cleanup);
      for (const [signal, handler] of signals) process.removeListener(signal, handler);
      if (!failure && clock.expired()) failure = 'worker-deadline-uncertain';
      if (!failure && (code !== 0 || signal !== null || !groupPid || !received || !admitted
        || clockBound <= Date.now() || admitted.deadline !== clockBound)) failure = 'worker-exit-uncertain';
      if (failure) { emit(failure); reject(proofWorkerUncertain()); }
      else { emit('worker-complete'); if (failure) reject(proofWorkerUncertain());
        else resolveResult({ report, admission: admitted, originalDeadline: clockBound }); }
      if (parentSignal) process.kill(process.pid, parentSignal);
    });
    try { controller.send({ ...options, startupDeadline: clock.deadline, discoveryDeadline: clock.discoveryDeadline,
      workerPath, cwd }, error => { if (error) stop('worker-exit-uncertain'); }); }
    catch { stop('worker-exit-uncertain'); }
  });
}

function runController(input) {
  let worker, failure, clockBound, admitted, result, received = false, started = false;
  const cleanup = () => killGroup(worker?.pid);
  const stop = phase => { if (!failure) { failure = phase; cleanup(); } };
  const send = message => {
    if (!process.connected) { cleanup(); process.exit(1); }
    try { process.send(message, error => { if (error) { cleanup(); process.exit(1); } }); }
    catch { cleanup(); process.exit(1); }
  };
  // No synchronous provider work runs here, so disconnect remains responsive during child stalls.
  process.once('disconnect', () => { cleanup(); process.exit(1); });
  process.once('exit', cleanup);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { cleanup(); process.exit(1); });
  if (!process.connected || !validOptions(input) || typeof input.workerPath !== 'string' || typeof input.cwd !== 'string') process.exit(1);
  const startedAt = Date.now(), clock = proofClock(input, () => stop('worker-deadline-uncertain'));
  if (failure) { clock.close(); process.exit(1); }
  try {
    worker = fork(input.workerPath, ['--proof-worker'], { cwd: input.cwd, env: process.env, execArgv: [], detached: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  } catch { clock.close(); process.exit(1); }
  worker.on('error', () => stop('worker-exit-uncertain'));
  worker.on('message', message => {
    if (failure) return;
    if (clock.expired()) { stop('worker-deadline-uncertain'); return; }
    if (message?.type === 'phase' && Object.keys(message).length === 2 && phases.has(message.phase)) send(message);
    else if (message?.type === 'clock' && Object.keys(message).length === 2 && positive(message.deadline)) {
      clockBound = Math.min(clockBound ?? Number.MAX_SAFE_INTEGER, message.deadline);
      clock.observe(clockBound); send({ type: 'clock', deadline: clockBound });
      send({ type: 'phase', phase: 'original-deadline-bound' });
    } else if (message?.type === 'admitted' && Object.keys(message).length === 3 && !admitted
      && message.admission?.deadline === clockBound && positive(clockBound)
      && message.admission.binding && message.admission.action
      && positive(message.startedAt) && message.startedAt >= startedAt && message.startedAt <= Date.now()) {
      admitted = message.admission;
      clock.tighten(message.startedAt + Math.min(input.backendMaxWallClockMs, PROOF_WORKER_MAX_MS)); send(message);
    } else if (message?.type === 'result' && Object.keys(message).length === 2 && !received && admitted
      && message.result && typeof message.result === 'object' && !Array.isArray(message.result)) {
      result = message.result; received = true;
    } else stop('worker-protocol-uncertain');
  });
  worker.once('close', (code, signal) => {
    clock.close(); cleanup();
    if (!failure && clock.expired()) failure = 'worker-deadline-uncertain';
    if (!failure && (code !== 0 || signal !== null || !received || !admitted || clockBound <= Date.now()
      || admitted.deadline !== clockBound)) failure = 'worker-exit-uncertain';
    if (failure && process.connected) process.send({ type: 'phase', phase: failure }, () => process.exit(1));
    else if (process.connected) process.send({ type: 'result', result }, error => process.exit(error ? 1 : 0));
    else process.exit(1);
  });
  // The outer parent must know the exact owned group before any admission instruction.
  process.once('message', message => {
    if (message?.type !== 'start' || Object.keys(message).length !== 1 || started || failure || clock.expired()) {
      stop('worker-protocol-uncertain'); return;
    }
    started = true;
    worker.send({ mode: 'proof', admission: input.admission }, error => { if (error) stop('worker-exit-uncertain'); });
  });
  send({ type: 'group', pid: worker.pid });
}
if (process.argv[1] && resolve(process.argv[1]) === ownPath && process.argv.length === 3
  && process.argv[2] === '--proof-controller' && typeof process.send === 'function') {
  process.once('message', runController);
}
