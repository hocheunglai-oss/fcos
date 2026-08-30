import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const stateDirectory = path.join(projectRoot, '.fcos-cli');
const statePath = path.join(stateDirectory, 'dev-server.json');
const action = String(process.argv[2] || '').trim().toLowerCase();
const separator = process.argv.indexOf('--');
const command = separator >= 0 ? process.argv.slice(separator + 1) : [];

async function savedState() {
  try {
    return JSON.parse(await readFile(statePath, 'utf8'));
  } catch {
    return null;
  }
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function clearState() {
  await rm(statePath, { force: true });
}

async function status() {
  const state = await savedState();
  const running = state?.projectRoot === projectRoot && processExists(Number(state.pid));
  if (!running && state) await clearState();
  process.stdout.write(running
    ? `FCOS dev server is running (PID ${state.pid}, started ${state.startedAt}).\n`
    : 'FCOS dev server is stopped.\n');
  return running ? state : null;
}

async function stop() {
  const state = await status();
  if (!state) return;
  try {
    process.kill(-Number(state.pid), 'SIGTERM');
  } catch {
    try { process.kill(Number(state.pid), 'SIGTERM'); } catch { /* already stopped */ }
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && processExists(Number(state.pid))) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (processExists(Number(state.pid))) {
    try { process.kill(-Number(state.pid), 'SIGKILL'); } catch { process.kill(Number(state.pid), 'SIGKILL'); }
  }
  await clearState();
  process.stdout.write('FCOS dev server stopped.\n');
}

async function start() {
  await stop();
  const executable = command[0] || path.join(projectRoot, 'node_modules', '.bin', 'vite');
  const args = command.slice(1);
  const child = spawn(executable, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
    detached: true,
  });
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  await writeFile(statePath, `${JSON.stringify({ pid: child.pid, projectRoot, command: [executable, ...args], startedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });

  const maximumMinutes = Number(process.env.FCOS_DEV_MAX_MINUTES ?? 120);
  const timeout = Number.isFinite(maximumMinutes) && maximumMinutes > 0
    ? setTimeout(() => {
      process.stderr.write(`FCOS dev server reached its ${maximumMinutes}-minute safety limit and will stop.\n`);
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* child already stopped */ }
    }, maximumMinutes * 60_000)
    : null;
  timeout?.unref?.();

  const shutdown = (signal) => {
    try { process.kill(-child.pid, signal); } catch { /* child already stopped */ }
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  child.once('exit', async (code, signal) => {
    if (timeout) clearTimeout(timeout);
    await clearState();
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

if (action === 'status') await status();
else if (action === 'stop') await stop();
else await start();
