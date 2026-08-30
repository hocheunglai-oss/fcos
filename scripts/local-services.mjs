import { spawnSync } from 'node:child_process';

const action = String(process.argv[2] || 'status').trim().toLowerCase();
const projectId = 'FCOS';

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    timeout: options.timeout ?? 30_000,
    ...options,
  });
}

function dockerIsRunning() {
  const result = run('docker', ['info', '--format', '{{.ServerVersion}}'], { capture: true, timeout: 5_000 });
  return result.status === 0 && Boolean(String(result.stdout || '').trim());
}

function waitForDocker(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (dockerIsRunning()) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
  }
  return false;
}

function fcosContainers() {
  if (!dockerIsRunning()) return [];
  const result = run('docker', ['ps', '--filter', `name=_${projectId}$`, '--format', '{{.Names}}\t{{.Status}}'], { capture: true });
  if (result.status !== 0) return [];
  return String(result.stdout || '').trim().split('\n').filter(Boolean);
}

function allContainers() {
  if (!dockerIsRunning()) return [];
  const result = run('docker', ['ps', '--format', '{{.Names}}'], { capture: true });
  if (result.status !== 0) return [];
  return String(result.stdout || '').trim().split('\n').filter(Boolean);
}

function printStatus() {
  const dockerRunning = dockerIsRunning();
  const containers = dockerRunning ? fcosContainers() : [];
  process.stdout.write(`Docker Desktop: ${dockerRunning ? 'running' : 'stopped'}\n`);
  process.stdout.write(`FCOS Supabase: ${containers.length ? `${containers.length} containers running` : 'stopped'}\n`);
  for (const container of containers) process.stdout.write(`  ${container}\n`);
}

function start() {
  if (!dockerIsRunning()) {
    const started = run('docker', ['desktop', 'start']);
    if (started.status !== 0 || !waitForDocker()) {
      throw new Error('Docker Desktop did not become ready within 60 seconds.');
    }
  }
  if (!fcosContainers().length) {
    const result = run('npx', ['--no-install', 'supabase', 'start']);
    if (result.status !== 0) throw new Error('FCOS Supabase could not be started.');
  }
  printStatus();
}

function stop() {
  if (!dockerIsRunning()) {
    printStatus();
    return;
  }
  if (fcosContainers().length) {
    const result = run('npx', ['--no-install', 'supabase', 'stop', '--project-id', projectId, '--yes']);
    if (result.status !== 0) throw new Error('FCOS Supabase could not be stopped safely.');
  }
  const remaining = allContainers();
  if (remaining.length) {
    process.stdout.write(`Docker Desktop remains running because other containers are active: ${remaining.join(', ')}\n`);
    return;
  }
  const result = run('docker', ['desktop', 'stop'], { timeout: 60_000 });
  if (result.status !== 0) throw new Error('Docker Desktop could not be stopped.');
  printStatus();
}

try {
  if (action === 'start') start();
  else if (action === 'stop') stop();
  else if (action === 'status') printStatus();
  else throw new Error('Use start, status, or stop.');
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
