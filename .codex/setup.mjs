#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyCodexControls } from './control-validation.mjs';

const sourceRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const targetRoot = process.cwd();
const args = new Set(process.argv.slice(2));
if ([...args].some((arg) => !['--check-only', '--controls-only'].includes(arg))) {
  throw new Error('Supported options: --check-only, --controls-only');
}
const checkOnly = args.has('--check-only');
const controlsOnly = args.has('--controls-only');
const digest = (data) => createHash('sha256').update(data).digest('hex');
const controlPolicy = verifyCodexControls(sourceRoot);

function git(root, ...argv) {
  const result = spawnSync('git', ['-C', root, ...argv], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('FCOS Git identity check failed.');
  return result.stdout.trim();
}

const sourceCommon = git(sourceRoot, 'rev-parse', '--path-format=absolute', '--git-common-dir');
const targetCommon = git(targetRoot, 'rev-parse', '--path-format=absolute', '--git-common-dir');
if (sourceCommon !== targetCommon || git(targetRoot, 'rev-parse', '--show-toplevel') !== targetRoot) {
  throw new Error('Run setup at the root of the canonical FCOS checkout or one of its worktrees.');
}
const origin = git(targetRoot, 'remote', 'get-url', 'origin');
if (!['https://github.com/hocheunglai-oss/fcos.git', 'https://github.com/hocheunglai-oss/fcos', 'git@github.com:hocheunglai-oss/fcos.git'].includes(origin)) {
  throw new Error('FCOS repository identity mismatch.');
}
const packageData = JSON.parse(readFileSync(path.join(targetRoot, 'package.json'), 'utf8'));
if (packageData.name !== 'fcos') throw new Error('FCOS package identity mismatch.');
if (Number(process.versions.node.split('.')[0]) !== controlPolicy.nodeMajor) throw new Error('Use Node.js 24; FCOS dependency and CI proofs require the pinned major.');

const controls = ['AGENTS.md', '.codex/config.toml', '.codex/setup.mjs', '.codex/control-validation.mjs', '.codex/control-policy.json', '.codex/README.md'];
const environmentDirectory = path.join(sourceRoot, '.codex/environments');
if (existsSync(environmentDirectory)) {
  controls.push(...readdirSync(environmentDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.toml'))
    .map((entry) => `.codex/environments/${entry.name}`));
}
if (existsSync(path.join(targetRoot, '.codex')) && !lstatSync(path.join(targetRoot, '.codex')).isDirectory()) throw new Error('FCOS target control directory must be a regular directory.');
const pending = [];
for (const relative of controls) {
  const from = path.join(sourceRoot, relative);
  const to = path.join(targetRoot, relative);
  if (!lstatSync(from).isFile() || (existsSync(to) && !lstatSync(to).isFile())) throw new Error(`FCOS control is not a regular file: ${relative}.`);
  const data = readFileSync(from);
  if (existsSync(to) && readFileSync(to).equals(data)) continue;
  const status = git(targetRoot, 'status', '--porcelain', '--', relative);
  if (status || (existsSync(to) && relative !== 'AGENTS.md')) {
    throw new Error(`Conflicting local control edits: ${relative}. Review them before setup.`);
  }
  pending.push({ to, data });
}
// Complete every conflict check before writing any control file.
if (!checkOnly) {
  for (const { to, data } of pending) {
    mkdirSync(path.dirname(to), { recursive: true });
    writeFileSync(to, data);
  }
}
console.log(`FCOS controls ${checkOnly ? 'checked' : 'synchronized'} (${pending.length} ${checkOnly ? 'pending' : 'copied'} files).`);
if (controlsOnly) process.exit(0);

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmVersion = spawnSync(npmCommand, ['--version'], { encoding: 'utf8' });
if (npmVersion.status !== 0) throw new Error('npm is unavailable.');
const installSettings = spawnSync(npmCommand, ['config', 'get', 'omit', 'include', 'ignore-scripts', 'legacy-peer-deps', 'install-links', 'bin-links', 'install-strategy'], { encoding: 'utf8' });
if (installSettings.status !== 0) throw new Error('Cannot verify npm installation settings.');
const fingerprint = digest(Buffer.concat([
  readFileSync(path.join(targetRoot, 'package.json')),
  readFileSync(path.join(targetRoot, 'package-lock.json')),
  readFileSync(fileURLToPath(import.meta.url)),
  readFileSync(path.join(sourceRoot, '.codex/control-policy.json')),
  Buffer.from(`${process.version}/${npmVersion.stdout.trim()}/${process.platform}/${process.arch}/${process.env.NODE_ENV || ''}/${installSettings.stdout}/--include=dev`),
]));
const stateDirectory = path.join(targetRoot, '.fcos-cli');
const stamp = path.join(stateDirectory, 'codex-dependencies.json');
const installedLock = path.join(targetRoot, 'node_modules/.package-lock.json');
let state = null;
try { state = JSON.parse(readFileSync(stamp, 'utf8')); } catch { /* missing or invalid cache evidence */ }
const ready = existsSync(installedLock) && state?.fingerprint === fingerprint &&
  state?.installedLockSha256 === digest(readFileSync(installedLock));
if (ready) {
  console.log('Locked dependencies already match; installation skipped.');
} else if (checkOnly) {
  console.log('Locked dependencies need npm ci; check-only made no changes.');
} else {
  const installed = spawnSync(npmCommand, ['ci', '--include=dev', '--no-audit', '--no-fund'], { cwd: targetRoot, stdio: 'inherit' });
  if (installed.status !== 0) process.exit(installed.status || 1);
  if (!existsSync(installedLock)) throw new Error('Dependency install did not produce npm lock evidence.');
  mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  writeFileSync(stamp, `${JSON.stringify({ fingerprint, installedLockSha256: digest(readFileSync(installedLock)) })}\n`, { mode: 0o600 });
  console.log('Locked dependencies installed. Full verification remains a separate action.');
}
