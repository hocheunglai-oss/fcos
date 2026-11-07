import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import childProcess from 'node:child_process';
import { basename, dirname, relative, resolve } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';

// Offline historical tests have no provider transport capability. A caught
// attempt still fails the process, so a negative assertion cannot hide it.
let attempts = 0, gitCalls = 0;
const deny = () => { attempts++; throw Object.assign(new Error('HISTORICAL_PROVIDER_TRANSPORT_REFUSED'), { code: 'HISTORICAL_PROVIDER_TRANSPORT_REFUSED' }); };
globalThis.fetch = deny;
for (const [module,names] of [[http,['request','get']],[https,['request','get']],[net,['connect','createConnection']],[tls,['connect']]])
  for (const name of names) module[name] = deny;
const check = (file,args = [],options = {}) => {
  if (basename(String(file)) === 'git' && Array.isArray(args) && !args.some(value => ['fetch','push','pull','clone','ls-remote','submodule'].includes(value))) { gitCalls++; return; }
  if (file === '/usr/bin/zip' && JSON.stringify(args) === JSON.stringify(['-q','archive.zip','fcos-preview-email-intent.json'])
    && typeof options.cwd === 'string' && process.env.TMPDIR && !relative(resolve(process.env.TMPDIR),resolve(options.cwd)).startsWith('..')
    && basename(options.cwd).startsWith('fcos-original-intent-')) return;
  if (file === 'unzip' && Array.isArray(args) && process.env.TMPDIR) {
    const path = args[1], privateArchive = typeof path === 'string' && basename(path) === 'evidence.zip'
      && basename(dirname(path)).startsWith('fcos-release-evidence-') && !relative(resolve(process.env.TMPDIR),resolve(path)).startsWith('..');
    if (privateArchive && (args.length === 2 && args[0] === '-Z1'
      || args.length === 3 && args[0] === '-p' && args[2] === 'fcos-preview-email-intent.json')) return;
  }
  // The test runner may fork this same protected local Node process.
  if (file === process.execPath && args.some(value => String(value).includes('runtimeCompatibilityHistoricalNoProviders.mjs'))) return;
  deny();
};
for (const name of ['execFileSync','spawnSync','execFile','spawn','fork']) {
  const original = childProcess[name];
  childProcess[name] = function historicalLocalCommand(file,args,...rest) { check(file,args,rest[0]); return original.call(this,file,args,...rest); };
}
childProcess.exec = deny; childProcess.execSync = deny;
syncBuiltinESMExports();
process.once('exit', () => {
  console.log(`# historical_provider_transport_attempts ${attempts}`);
  console.log(`# historical_local_git_calls ${gitCalls}`);
  if (attempts) process.exitCode = 1;
});
