import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeCompatibilityScope } from './lib/runtime-compatibility.mjs';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';

export function verifyRuntimeCompatibility({ cwd, baseCommit, candidateCommit }) {
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const repository = fcosConnectionIdentifier('github', 'Repository');
  if (![ `https://github.com/${repository}.git`, `https://github.com/${repository}`, `git@github.com:${repository}.git` ].includes(git(['remote', 'get-url', 'origin']).trim())) throw new Error('Compatibility repository identity mismatch.');
  if (![baseCommit, candidateCommit].every(value => /^[0-9a-f]{40}$/.test(value || ''))) throw new Error('Full immutable Git SHAs are required.');
  const tree = ref => git(['ls-tree', '-rz', ref]).split('\0').filter(Boolean).map(line => {
    const separator = line.indexOf('\t'), header = line.slice(0, separator), path = line.slice(separator + 1);
    const [mode, type, sha] = header.split(' '); return { path, mode, type, sha };
  });
  return runtimeCompatibilityScope({ baseCommit, candidateCommit, baseTree: tree(baseCommit), candidateTree: tree(candidateCommit), readBlob: blob => git(['cat-file', 'blob', blob]) });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 5) throw new Error('Usage: verify-runtime-compatibility.mjs <checkout> <production-sha> <compatibility-sha>.');
    console.log(JSON.stringify(verifyRuntimeCompatibility({ cwd: resolve(process.argv[2]), baseCommit: process.argv[3], candidateCommit: process.argv[4] }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
