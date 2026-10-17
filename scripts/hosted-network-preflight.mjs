import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { probeObserverTransport } from './lib/hosted-release/network-preflight.mjs';

const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY !== fcosConnectionIdentifier('github', 'Repository')
  || process.env.FCOS_EXPECTED_SOURCE !== sourceSha || !/^\d+$/.test(process.env.GITHUB_RUN_ID || '')
  || !/^\d+$/.test(process.env.GITHUB_RUN_ATTEMPT || '')) throw new Error('OBSERVER_TRANSPORT_RUN_IDENTITY');
// Direct IPv6 failed in actual run39043534661. The human explicitly approved
// this pinned session route; it still sends no authentication or SQL.
const result = { ...await probeObserverTransport({ transport: 'session' }), sourceSha, runtime: process.version,
  runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
  runnerOS: process.env.RUNNER_OS, runnerArch: process.env.RUNNER_ARCH };
await writeFile('hosted-network-preflight.json', `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify(result));
if (result.status !== 'passed') process.exitCode = 1;
