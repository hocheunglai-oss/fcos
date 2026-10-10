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

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'fcos-proof-worker-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const workerPath = join(directory, 'worker.mjs');
  const helper = fileURLToPath(new URL('../scripts/lib/release-coordination-proof-worker.mjs', import.meta.url));
  writeFileSync(workerPath, `
    import { writeFileSync, appendFileSync } from 'node:fs';
    import { spawn } from 'node:child_process';
    import { guardProofWorkerParent } from ${JSON.stringify(helper)};
    process.once('message', ({ admission }) => {
      const connected = guardProofWorkerParent(true);
      const { scenario, directory } = admission;
      appendFileSync(directory + '/attempts', '1');
      process.stdout.write('private token https://private.invalid/body');
      process.stderr.write('private error response body');
      if (scenario === 'admission-delay') {
        process.send({ type: 'phase', phase: 'worker-admission-started' });
        setTimeout(() => { connected(); writeFileSync(directory + '/accepted', 'provider would start'); }, 1500);
        return;
      }
      if (scenario === 'protocol') { process.send({ type: 'phase', phase: 'private token https://private.invalid/body' }); setInterval(() => {}, 100); return; }
      if (scenario === 'error') { process.exit(1); }
      if (scenario === 'uncertain') writeFileSync(directory + '/accepted', 'remote request already accepted');
      if (['descendant', 'success-descendant', 'error-descendant', 'cancellation'].includes(scenario)) {
        const code = "setTimeout(() => require('node:fs').writeFileSync(process.argv[1], 'late descendant effect'), 1500); setInterval(() => {}, 100);";
        const child = spawn(process.execPath, ['-e', code, directory + '/descendant-late'], { stdio: 'ignore' });
        writeFileSync(directory + '/descendant-pid', String(child.pid));
      }
      process.send({ type: 'phase', phase: 'upload-started' });
      if (scenario === 'error-descendant') process.exit(1);
      if (['success', 'success-descendant', 'result-hang'].includes(scenario)) {
        process.send({ type: 'result', result: { fixture: true } }, () => {
          if (scenario !== 'result-hang') process.exit(0);
        });
      }
      process.on('SIGTERM', () => {});
      setTimeout(() => writeFileSync(directory + '/late', 'late worker effect'), 1500);
      setInterval(() => {}, 100);
    });
  `);
  const run = (scenario, options = {}) => {
    const deadline = options.deadline ?? Date.now() + 5000;
    return superviseCoordinationProofWorker({ workerPath, cwd: directory, deadline,
      admission: { deadline, scenario, directory }, maxWallClockMs: 1000,
      onPhase: phase => options.phases?.push(phase), ...options });
  };
  return { directory, workerPath, run };
}
const uncertain = error => error.code === 'FCOS_PROOF_WORKER_UNCERTAIN' && error.uncertainOutcomeRequiresReadback === true
  && !/private|https:/.test(error.message);

test('worker success requires terminal exit and logs only fixed phases', async t => {
  const { directory, run } = fixture(t), phases = [];
  assert.deepEqual(await run('success', { phases }), { fixture: true });
  assert.deepEqual(phases, ['upload-started', 'worker-complete']);
  assert.equal(readFileSync(join(directory, 'attempts'), 'utf8'), '1');
  const lines = []; proofPhase('upload-started', value => lines.push(value));
  assert.deepEqual(lines, ['FCOS artifact proof phase: upload-started\n']);
  assert.throws(() => proofPhase('private token https://private.invalid/body', value => lines.push(value)));
  assert.equal(lines.length, 1);
});

test('hung upload is killed, stays uncertain and cannot perform late local effects or retry', async t => {
  const { directory, run } = fixture(t), phases = [], started = Date.now();
  await assert.rejects(run('uncertain', { phases }), uncertain);
  assert.ok(Date.now() - started < 4000);
  assert.equal(phases.at(-1), 'worker-deadline-uncertain');
  assert.equal(existsSync(join(directory, 'accepted')), true, 'a killed worker does not establish remote absence');
  await pause(1600);
  assert.equal(existsSync(join(directory, 'late')), false);
  assert.equal(readFileSync(join(directory, 'attempts'), 'utf8'), '1');
});

test('success message without process termination remains bounded and uncertain', async t => {
  const { run, directory } = fixture(t);
  await assert.rejects(run('result-hang'), uncertain);
  await pause(1600);
  assert.equal(existsSync(join(directory, 'late')), false);
});

test('process group is cleaned on timeout, successful exit and error exit', async t => {
  for (const scenario of ['descendant', 'success-descendant', 'error-descendant']) {
    await t.test(scenario, async t => {
      const { run, directory } = fixture(t);
      if (scenario === 'success-descendant') assert.deepEqual(await run(scenario), { fixture: true });
      else await assert.rejects(run(scenario), uncertain);
      assert.equal(existsSync(join(directory, 'descendant-pid')), true);
      await pause(1600);
      assert.equal(existsSync(join(directory, 'descendant-late')), false);
    });
  }
});

test('expired or extended admission never starts a worker; original deadline clamps wall clock', async t => {
  const { directory, workerPath, run } = fixture(t), phases = [];
  await assert.rejects(run('success', { deadline: Date.now() - 1 }), uncertain);
  await assert.rejects(superviseCoordinationProofWorker({ workerPath, cwd: directory, deadline: Date.now() + 1000,
    admission: { deadline: Date.now() + 2000 } }), uncertain);
  assert.equal(existsSync(join(directory, 'attempts')), false);
  const started = Date.now();
  await assert.rejects(run('hang', { deadline: started + 250, maxWallClockMs: 4000, phases }), uncertain);
  assert.ok(Date.now() - started < 2000);
  assert.equal(phases.at(-1), 'worker-deadline-uncertain');
  // This check makes no assumption about startup finishing inside the short original deadline.
});

test('unknown IPC phases and worker failures refuse without raw diagnostics', async t => {
  for (const scenario of ['protocol', 'error']) {
    await t.test(scenario, async t => {
      const { run } = fixture(t), phases = [];
      await assert.rejects(run(scenario, { phases }), uncertain);
      assert.deepEqual(phases, [scenario === 'protocol' ? 'worker-protocol-uncertain' : 'worker-exit-uncertain']);
    });
  }
});

test('parent cancellation kills its worker group before preserving the termination signal', async t => {
  const { directory, workerPath } = fixture(t);
  const helper = fileURLToPath(new URL('../scripts/lib/release-coordination-proof-worker.mjs', import.meta.url));
  const parentPath = join(directory, 'parent.mjs');
  writeFileSync(parentPath, `import { superviseCoordinationProofWorker } from ${JSON.stringify(helper)};
    const deadline = Date.now() + 5000;
    await superviseCoordinationProofWorker({ workerPath: ${JSON.stringify(workerPath)}, cwd: ${JSON.stringify(directory)}, deadline,
      admission: { deadline, scenario: 'cancellation', directory: ${JSON.stringify(directory)} },
      onPhase: phase => { if (phase === 'upload-started') process.send('ready'); } }).catch(() => {});`);
  const parent = spawn(process.execPath, [parentPath], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  t.after(() => { if (parent.exitCode === null && parent.signalCode === null) parent.kill('SIGKILL'); });
  const closed = once(parent, 'close');
  await once(parent, 'message'); parent.kill('SIGTERM');
  const [code, signal] = await closed;
  assert.equal(code, null); assert.equal(signal, 'SIGTERM');
  await pause(1600);
  assert.equal(existsSync(join(directory, 'late')), false);
  assert.equal(existsSync(join(directory, 'descendant-late')), false);
});

test('lost supervisor during asynchronous admission prevents later provider activity', async t => {
  const { directory, workerPath } = fixture(t);
  const helper = fileURLToPath(new URL('../scripts/lib/release-coordination-proof-worker.mjs', import.meta.url));
  const parentPath = join(directory, 'parent-lost.mjs');
  writeFileSync(parentPath, `import { superviseCoordinationProofWorker } from ${JSON.stringify(helper)};
    const deadline = Date.now() + 5000;
    await superviseCoordinationProofWorker({ workerPath: ${JSON.stringify(workerPath)}, cwd: ${JSON.stringify(directory)}, deadline,
      admission: { deadline, scenario: 'admission-delay', directory: ${JSON.stringify(directory)} },
      onPhase: phase => { if (phase === 'worker-admission-started') process.send('ready'); } }).catch(() => {});`);
  const parent = spawn(process.execPath, [parentPath], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  t.after(() => { if (parent.exitCode === null && parent.signalCode === null) parent.kill('SIGKILL'); });
  const closed = once(parent, 'close');
  await once(parent, 'message'); parent.kill('SIGKILL');
  const [code, signal] = await closed;
  assert.equal(code, null); assert.equal(signal, 'SIGKILL');
  await pause(1600);
  assert.equal(existsSync(join(directory, 'accepted')), false);
});
