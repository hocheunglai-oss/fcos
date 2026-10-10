import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as pause } from 'node:timers/promises';
import { proofPhase, superviseCoordinationProofWorker } from '../scripts/lib/release-coordination-proof-worker.mjs';

const helper = fileURLToPath(new URL('../scripts/lib/release-coordination-proof-worker.mjs', import.meta.url));
const uncertain = error => error.code === 'FCOS_PROOF_WORKER_UNCERTAIN' && error.uncertainOutcomeRequiresReadback === true
  && !/private|https:/.test(error.message);
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'fcos-proof-worker-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const workerPath = join(directory, 'worker.mjs');
  writeFileSync(workerPath, `
    import { writeFileSync, appendFileSync } from 'node:fs';
    import { spawn, execFileSync } from 'node:child_process';
    import { guardProofWorkerParent } from ${JSON.stringify(helper)};
    process.once('message', ({ admission }) => {
      const connected = guardProofWorkerParent(true);
      const { scenario, directory, deadline } = admission;
      const phase = phase => process.send({ type: 'phase', phase });
      const clock = deadline => process.send({ type: 'clock', deadline });
      const lateMs = 1100;
      const descendantCode = "require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setTimeout(() => require('node:fs').writeFileSync(process.argv[2], 'late descendant effect'), Number(process.argv[3])); setInterval(() => {}, 100);";
      const descendant = (sync, delay = lateMs) => {
        const args = ['-e', descendantCode, directory + '/descendant-pid', directory + '/descendant-late', String(delay)];
        if (sync) execFileSync(process.execPath, args, { stdio: 'ignore' });
        else spawn(process.execPath, args, { stdio: 'ignore' });
      };
      appendFileSync(directory + '/attempts', '1');
      writeFileSync(directory + '/worker-pid', String(process.pid));
      writeFileSync(directory + '/controller-pid', String(process.ppid));
      process.stdout.write('private token https://private.invalid/body');
      process.stderr.write('private error response body');
      if (scenario === 'protocol') { phase('private token https://private.invalid/body'); setInterval(() => {}, 100); return; }
      if (scenario === 'error') process.exit(1);
      if (scenario === 'result-before-admission') { process.send({ type: 'result', result: { fixture: true } }); return; }
      if (['sync-discovery', 'async-discovery'].includes(scenario)) {
        phase('worker-admission-started');
        writeFileSync(directory + '/admission-started', '1');
        if (scenario === 'sync-discovery') descendant(true, 3500);
        else { setTimeout(() => { connected(); writeFileSync(directory + '/late', 'OIDC would finish'); }, 3500); setInterval(() => {}, 100); }
        return;
      }
      const original = scenario.startsWith('near-expiry') || scenario === 'clock-extension' ? Date.now() + 300 : deadline;
      clock(original);
      if (['sync-original', 'async-original', 'near-expiry-revalidation', 'clock-extension', 'admission-delay', 'blocked-admission'].includes(scenario)) {
        phase('worker-admission-started');
        writeFileSync(directory + '/admission-started', '1');
        if (scenario === 'sync-original') { clock(Date.now() + 300); descendant(true); }
        else if (scenario === 'async-original') { clock(Date.now() + 300); setTimeout(() => writeFileSync(directory + '/late', 'late OIDC'), lateMs); setInterval(() => {}, 100); }
        else if (scenario === 'clock-extension') { setTimeout(() => clock(Date.now() + 5000), 150); setTimeout(() => writeFileSync(directory + '/late', 'extended deadline'), lateMs); setInterval(() => {}, 100); }
        else if (scenario === 'near-expiry-revalidation') {
          setTimeout(() => { writeFileSync(directory + '/action-observed', 'original action only'); descendant(true); }, 100);
        } else if (scenario === 'blocked-admission') descendant(true);
        else { descendant(false); setTimeout(() => { connected(); writeFileSync(directory + '/accepted', 'provider would start'); }, lateMs); }
        return;
      }
      const admitted = { deadline: original, binding: { fixture: true }, action: { fixture: true } };
      process.send({ type: 'admitted', admission: admitted, startedAt: Date.now() });
      if (scenario === 'duplicate-admission') process.send({ type: 'admitted', admission: admitted, startedAt: Date.now() });
      if (scenario === 'uncertain') writeFileSync(directory + '/accepted', 'remote request already accepted');
      if (['descendant', 'success-descendant', 'error-descendant', 'cancellation'].includes(scenario)) descendant(false);
      phase('upload-started');
      if (scenario === 'error-descendant') setTimeout(() => process.exit(1), 100);
      if (['success', 'success-descendant', 'result-hang', 'result-error'].includes(scenario)) {
        setTimeout(() => process.send({ type: 'result', result: { fixture: true } }, () => {
          if (scenario !== 'result-hang') process.exit(scenario === 'result-error' ? 1 : 0);
        }), scenario === 'success-descendant' ? 100 : 0);
      }
      process.on('SIGTERM', () => {});
      setTimeout(() => writeFileSync(directory + '/late', 'late worker effect'), lateMs);
      setInterval(() => {}, 100);
    });
  `);
  const run = (scenario, options = {}) => {
    const deadline = options.deadline ?? Date.now() + 15000;
    return superviseCoordinationProofWorker({ workerPath, cwd: directory, deadline,
      admission: { deadline, scenario, directory }, maxWallClockMs: 10000, clockDiscoveryMaxMs: 8000,
      backendMaxWallClockMs: 300, onPhase: phase => options.phases?.push(phase), ...options });
  };
  return { directory, workerPath, run };
}
const absentLateEffects = async directory => {
  const pids = ['worker-pid', 'controller-pid', 'descendant-pid'].filter(name => existsSync(join(directory, name)))
    .map(name => Number(readFileSync(join(directory, name), 'utf8')));
  const alive = pid => {
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
    // A killed Linux orphan may await init reaping; it cannot execute any late work.
    if (process.platform === 'linux') {
      try { if (/^State:\s+Z/m.test(readFileSync(`/proc/${pid}/status`, 'utf8'))) return false; }
      catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    }
    return true;
  };
  const until = Date.now() + 3000;
  while (pids.some(alive) && Date.now() < until) await pause(20);
  assert.equal(pids.some(alive), false, 'owned controller, worker and descendant cannot survive completion');
  await pause(1200);
  assert.equal(existsSync(join(directory, 'late')), false);
  assert.equal(existsSync(join(directory, 'descendant-late')), false);
  assert.equal(readFileSync(join(directory, 'attempts'), 'utf8'), '1');
};

test('worker and controller success require terminal exits and fixed phase logs', async t => {
  const { directory, run } = fixture(t), phases = [];
  const result = await run('success', { phases });
  assert.deepEqual(result.report, { fixture: true });
  assert.equal(result.originalDeadline, result.admission.deadline);
  assert.deepEqual(phases, ['original-deadline-bound', 'upload-started', 'worker-complete']);
  assert.equal(readFileSync(join(directory, 'attempts'), 'utf8'), '1');
  const lines = []; proofPhase('upload-started', value => lines.push(value));
  assert.deepEqual(lines, ['FCOS artifact proof phase: upload-started\n']);
  assert.throws(() => proofPhase('private token https://private.invalid/body', value => lines.push(value)));
  assert.equal(lines.length, 1);
});

test('hung accepted upload stays uncertain, is killed and cannot retry or cause late effects', async t => {
  const { directory, run } = fixture(t), phases = [], started = Date.now();
  await assert.rejects(run('uncertain', { phases }), uncertain);
  assert.ok(Date.now() - started < 8000);
  assert.equal(phases.at(-1), 'worker-deadline-uncertain');
  assert.equal(existsSync(join(directory, 'accepted')), true, 'a killed worker does not establish remote absence');
  await absentLateEffects(directory);
});

test('result messages cannot replace successful worker termination', async t => {
  for (const scenario of ['result-hang', 'result-error', 'result-before-admission']) {
    await t.test(scenario, async t => {
      const { run, directory } = fixture(t);
      await assert.rejects(run(scenario), uncertain);
      await absentLateEffects(directory);
    });
  }
});

test('one process group is cleaned after timeout, successful exit and error exit', async t => {
  for (const scenario of ['descendant', 'success-descendant', 'error-descendant']) {
    await t.test(scenario, async t => {
      const { run, directory } = fixture(t);
      if (scenario === 'success-descendant') assert.deepEqual((await run(scenario)).report, { fixture: true });
      else await assert.rejects(run(scenario), uncertain);
      assert.equal(existsSync(join(directory, 'descendant-pid')), true);
      await absentLateEffects(directory);
    });
  }
});

test('expired or extended supplied deadlines refuse before spawning; startup cap independently applies', async t => {
  const { directory, workerPath, run } = fixture(t), phases = [];
  await assert.rejects(run('success', { deadline: Date.now() - 1 }), uncertain);
  await assert.rejects(superviseCoordinationProofWorker({ workerPath, cwd: directory, deadline: Date.now() + 1000,
    admission: { deadline: Date.now() + 2000 } }), uncertain);
  assert.equal(existsSync(join(directory, 'attempts')), false);
  const started = Date.now();
  await assert.rejects(run('hang', { maxWallClockMs: 250, phases }), uncertain);
  assert.ok(Date.now() - started < 2000);
  assert.equal(phases.at(-1), 'worker-deadline-uncertain');
  // No assumption that Node startup finishes inside this short startup cap.
});

test('clock discovery bounds synchronous GH-equivalent and asynchronous OIDC-equivalent stalls', async t => {
  await Promise.all(['sync-discovery', 'async-discovery'].map(scenario => t.test(scenario, async t => {
    const { directory, run } = fixture(t), phases = [], start = Date.now();
    await assert.rejects(run(scenario, { clockDiscoveryMaxMs: 3000, phases }), uncertain);
    assert.equal(existsSync(join(directory, 'admission-started')), true, 'the admission fixture actually started');
    assert.equal(phases.includes('original-deadline-bound'), false);
    assert.equal(phases.at(-1), 'worker-deadline-uncertain');
    assert.ok(Date.now() - start < 6000);
    await pause(3600);
    assert.equal(existsSync(join(directory, 'late')), false);
    assert.equal(existsSync(join(directory, 'descendant-late')), false);
    assert.equal(existsSync(join(directory, 'accepted')), false);
  })));
});

test('original clock stops sync/async admission and near-expiry action revalidation without renewal', async t => {
  for (const scenario of ['sync-original', 'async-original', 'near-expiry-revalidation', 'clock-extension']) {
    await t.test(scenario, async t => {
      const { directory, run } = fixture(t), phases = [], started = Date.now();
      await assert.rejects(run(scenario, { phases }), uncertain);
      assert.equal(existsSync(join(directory, 'admission-started')), true);
      if (scenario === 'near-expiry-revalidation') assert.equal(existsSync(join(directory, 'action-observed')), true);
      assert.ok(phases.includes('original-deadline-bound'));
      assert.equal(phases.includes('upload-started'), false);
      assert.equal(phases.at(-1), 'worker-deadline-uncertain');
      assert.ok(Date.now() - started < 8000);
      await absentLateEffects(directory);
    });
  }
});

test('unknown IPC, duplicate admission and worker errors refuse without raw diagnostics', async t => {
  for (const scenario of ['protocol', 'error', 'duplicate-admission']) {
    await t.test(scenario, async t => {
      const { run } = fixture(t), phases = [];
      await assert.rejects(run(scenario, { phases }), uncertain);
      assert.equal(phases.at(-1), scenario === 'error' ? 'worker-exit-uncertain' : 'worker-protocol-uncertain');
      assert.equal(phases.some(phase => /private|https:/.test(phase)), false);
    });
  }
});

async function actionParent(t, scenario, readyPhase, options = {}) {
  const { directory, workerPath } = fixture(t), parentPath = join(directory, 'parent.mjs');
  writeFileSync(parentPath, `import { superviseCoordinationProofWorker } from ${JSON.stringify(helper)};
    import { writeFileSync } from 'node:fs';
    const realNow = Date.now;
    const deadline = realNow() + 15000;
    await superviseCoordinationProofWorker({ workerPath: ${JSON.stringify(workerPath)}, cwd: ${JSON.stringify(directory)}, deadline,
      admission: { deadline, scenario: ${JSON.stringify(scenario)}, directory: ${JSON.stringify(directory)} },
      maxWallClockMs: 10000, clockDiscoveryMaxMs: 8000, backendMaxWallClockMs: 8000,
      onPhase: phase => {
        if (phase === ${JSON.stringify(readyPhase)}) {
          ${options.backwardsClock ? "Date.now = () => realNow() - 60000;" : ''}
          process.send('ready');
        }
      } }).then(() => writeFileSync(${JSON.stringify(join(directory, 'parent-success'))}, '1'))
        .catch(() => writeFileSync(${JSON.stringify(join(directory, 'parent-uncertain'))}, '1'));`);
  const parent = spawn(process.execPath, [parentPath], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  t.after(() => { if (parent.exitCode === null && parent.signalCode === null) parent.kill('SIGKILL'); });
  const closed = once(parent, 'close');
  await Promise.race([once(parent, 'message'), closed.then(() => { throw new Error('Fixture parent exited before readiness.'); })]);
  return { parent, closed, directory };
}
async function waitForFile(path) {
  const until = Date.now() + 5000;
  while (!existsSync(path) && Date.now() < until) await pause(20);
  assert.equal(existsSync(path), true, 'fixture descendant reached synchronous blocking work');
}

test('parent cancellation and loss clean backend and blocked admission descendants', async t => {
  for (const [scenario, signal, phase] of [
    ['cancellation', 'SIGTERM', 'upload-started'],
    ['blocked-admission', 'SIGTERM', 'worker-admission-started'],
    ['blocked-admission', 'SIGKILL', 'worker-admission-started'],
    ['admission-delay', 'SIGKILL', 'worker-admission-started'],
  ]) {
    await t.test(`${scenario}-${signal}`, async t => {
      const { parent, closed, directory } = await actionParent(t, scenario, phase);
      await waitForFile(join(directory, 'descendant-pid'));
      parent.kill(signal);
      const [code, actualSignal] = await closed;
      assert.equal(code, null); assert.equal(actualSignal, signal);
      await absentLateEffects(directory);
      assert.equal(existsSync(join(directory, 'accepted')), false);
    });
  }
});

test('controller loss during synchronous admission kills the exact known worker group', async t => {
  const { closed, directory } = await actionParent(t, 'blocked-admission', 'worker-admission-started');
  await waitForFile(join(directory, 'descendant-pid'));
  process.kill(Number(readFileSync(join(directory, 'controller-pid'), 'utf8')), 'SIGKILL');
  const [code, signal] = await closed;
  assert.equal(code, 0); assert.equal(signal, null);
  assert.equal(existsSync(join(directory, 'parent-success')), false);
  assert.equal(existsSync(join(directory, 'parent-uncertain')), true);
  await absentLateEffects(directory);
});

test('backward wall-clock movement cannot extend an observed original deadline', async t => {
  const { closed, directory } = await actionParent(t, 'clock-extension', 'original-deadline-bound', { backwardsClock: true });
  // Freeze the independent controller so only the outer monotonic timer can stop this group.
  process.kill(Number(readFileSync(join(directory, 'controller-pid'), 'utf8')), 'SIGSTOP');
  const started = Date.now();
  const [code, signal] = await closed;
  assert.equal(code, 0); assert.equal(signal, null);
  assert.ok(Date.now() - started < 2000);
  assert.equal(existsSync(join(directory, 'parent-uncertain')), true);
  await absentLateEffects(directory);
});
