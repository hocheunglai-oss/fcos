#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FCOS_CONNECTION_POLICY, validateFcosConnectionPolicy } from '../config/fcosConnections.js';
import { verifyCodexControls } from '../.codex/control-validation.mjs';

const EXPECTED_ORIGIN = 'https://github.com/hocheunglai-oss/fcos.git';
const MODES = new Set(['--controls', '--release-readiness']);

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Git read failed: ${args.join(' ')}.`);
  return result.stdout.trimEnd();
}

function commandAvailability(command) {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
  return { command, available: result.status === 0 };
}

function workingTreeState(root) {
  const status = git(root, ['status', '--porcelain=v1']);
  const entries = status ? status.split('\n') : [];
  return {
    dirty: entries.length > 0,
    staged: entries.filter((entry) => entry[0] !== ' ' && entry[0] !== '?').length,
    unstaged: entries.filter((entry) => entry[1] && entry[1] !== ' ').length,
    untracked: entries.filter((entry) => entry.startsWith('??')).length,
  };
}

function sourceState(root) {
  const worktrees = git(root, ['worktree', 'list', '--porcelain'])
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length));
  const currentRoot = realpathSync(root);
  const canonicalRoot = worktrees[0] ? realpathSync(worktrees[0]) : null;
  const branchResult = spawnSync('git', ['-C', root, 'symbolic-ref', '--quiet', '--short', 'HEAD'], { encoding: 'utf8' });
  const origin = git(root, ['remote', 'get-url', 'origin']);
  return {
    head: git(root, ['rev-parse', 'HEAD']),
    branch: branchResult.status === 0 ? branchResult.stdout.trim() : null,
    detached: branchResult.status !== 0,
    isCanonicalCheckout: canonicalRoot === currentRoot,
    originMatchesExpected: origin === EXPECTED_ORIGIN || origin === EXPECTED_ORIGIN.slice(0, -4) || origin === 'git@github.com:hocheunglai-oss/fcos.git',
    worktree: workingTreeState(root),
  };
}

function canonicalIdentities() {
  const byId = Object.fromEntries(FCOS_CONNECTION_POLICY.providers.map((provider) => [provider.id, provider]));
  const identifier = (providerId, label) => byId[providerId].identifiers.find((entry) => entry.label === label)?.value;
  return {
    github: { account: identifier('github', 'Required account'), repository: identifier('github', 'Repository') },
    vercel: { target: identifier('vercel', 'Target'), projectId: identifier('vercel', 'Project ID') },
    supabase: { projectRef: identifier('supabase', 'Project ref') },
    salesforce: {
      sourceEnvironment: byId.salesforce.environments[0].key,
      environments: byId.salesforce.environments.map(({ key, orgId, isSandbox }) => ({ key, orgId, isSandbox })),
    },
  };
}

function commandInventory(root) {
  const paths = [
    '.codex/control-validation.mjs',
    'scripts/fcos-project-doctor.mjs',
    'scripts/fcos-connections.mjs',
  ];
  return {
    projectEntrypoints: paths.map((path) => ({ path, available: existsSync(resolve(root, path)) && lstatSync(resolve(root, path)).isFile() })),
    cli: [...new Set(FCOS_CONNECTION_POLICY.providers.map(({ cli }) => cli))].map(commandAvailability),
  };
}

export function collectProjectDoctor({ root = process.cwd(), mode = '--controls' } = {}) {
  if (!MODES.has(mode)) throw new Error('Supported options: --controls, --release-readiness');
  const controls = verifyCodexControls(root);
  validateFcosConnectionPolicy(FCOS_CONNECTION_POLICY);
  const source = sourceState(root);
  const report = {
    schemaVersion: 1,
    mode: mode.slice(2),
    controls,
    source,
    identities: canonicalIdentities(),
    commands: commandInventory(root),
  };
  if (mode === '--release-readiness') {
    report.releaseReadiness = {
      status: 'evidence_required',
      candidate: source.head,
      blockers: [
        'immutable exact-commit Preview READY evidence',
        'provider and runtime parity evidence',
        'protected authenticated workflow evidence',
      ],
    };
  }
  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const [mode = '--controls', ...extra] = process.argv.slice(2);
    if (extra.length) throw new Error('Supported options: --controls, --release-readiness');
    console.log(JSON.stringify(collectProjectDoctor({ mode })));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
