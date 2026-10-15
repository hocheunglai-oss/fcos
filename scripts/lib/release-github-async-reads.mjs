import { execFile, execFileSync } from 'node:child_process';
import { fcosConnectionIdentifier } from '../../config/fcosConnections.js';

const RELEASE_REPOSITORY = fcosConnectionIdentifier('github', 'Repository');
const READ_FAILURE = 'Pinned GitHub release read failed; private diagnostics suppressed.';
const OUTSIDE_REPOSITORY = 'Release GitHub endpoint is outside the pinned repository.';
const MAX_CONCURRENT_READS = 2;
const READ_OPTIONS = Object.freeze({ timeout: 30000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

function endpointAllowed(endpoint) {
  return typeof endpoint === 'string' && (endpoint === 'user' || endpoint === `repos/${RELEASE_REPOSITORY}`
    || endpoint.startsWith(`repos/${RELEASE_REPOSITORY}/`));
}

function asyncExecFile(command, args, options, callback) {
  return execFile(command, args, options, callback);
}

// This transport deliberately leaves identity synchronous so existing callers
// retain their account assertion before beginning concurrent evidence reads.
// Every other request is a fresh GET and shares this instance's FIFO limit.
export function githubReleaseAsyncReads(runtime, {
  cwd = process.cwd(), executeSync = execFileSync, executeAsync = asyncExecFile,
} = {}) {
  let active = 0;
  const pending = [];
  const argsFor = endpoint => ['api', endpoint, '--method', 'GET', ...(runtime.injectedArgs || [])];
  const optionsFor = binary => ({ cwd, env: runtime.env, ...READ_OPTIONS, encoding: binary ? 'buffer' : 'utf8' });
  const checkEndpoint = endpoint => {
    if (!endpointAllowed(endpoint)) throw new Error(OUTSIDE_REPOSITORY);
  };
  const fail = () => { throw new Error(READ_FAILURE); };
  const runSync = (endpoint, binary) => {
    checkEndpoint(endpoint);
    try { return executeSync(runtime.command, argsFor(endpoint), optionsFor(binary)); }
    catch { return fail(); }
  };
  const drain = () => {
    while (active < MAX_CONCURRENT_READS && pending.length) {
      const item = pending.shift();
      active += 1;
      let completed = false;
      const complete = (error, stdout) => {
        if (completed) return;
        completed = true;
        active -= 1;
        if (error) item.reject(new Error(READ_FAILURE));
        else item.resolve(stdout);
        drain();
      };
      try {
        executeAsync(runtime.command, argsFor(item.endpoint), optionsFor(item.binary), complete);
      } catch {
        complete(new Error(READ_FAILURE));
      }
    }
  };
  const runAsync = (endpoint, binary) => {
    try { checkEndpoint(endpoint); }
    catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      pending.push({ endpoint, binary, resolve, reject });
      drain();
    });
  };
  const parse = value => {
    try { return JSON.parse(value); }
    catch { return fail(); }
  };

  return {
    json(endpoint) {
      if (endpoint === 'user') {
        if (active || pending.length) return fail();
        return parse(runSync(endpoint, false));
      }
      return runAsync(endpoint, false).then(parse);
    },
    archive(endpoint) {
      return runAsync(endpoint, true).then(value => {
        if (!Buffer.isBuffer(value)) return fail();
        return value;
      });
    },
  };
}
