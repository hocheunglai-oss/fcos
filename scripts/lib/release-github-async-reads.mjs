import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fcosConnectionIdentifier } from '../../config/fcosConnections.js';

const RELEASE_REPOSITORY = fcosConnectionIdentifier('github', 'Repository');
const READ_FAILURE = 'Pinned GitHub release read failed; private diagnostics suppressed.';
const OUTSIDE_REPOSITORY = 'Release GitHub endpoint is outside the pinned repository.';
const MAX_CONCURRENT_READS = 2;
const MAX_IMMUTABLE_ENTRIES = 128;
const MAX_IMMUTABLE_BYTES = 8 * 1024 * 1024;
const MAX_IMMUTABLE_ENTRY_BYTES = 1024 * 1024;

// Full-commit source bytes can be reused within this exact transport. Branches,
// runs, jobs, approvals, settings, secrets and identity always remain fresh.
function immutableContentsPath(endpoint) {
  const prefix = `repos/${RELEASE_REPOSITORY}/contents/`;
  if (typeof endpoint !== 'string' || !endpoint.startsWith(prefix)) return null;
  const match = /^([^?#]+)\?ref=[a-f0-9]{40}$/.exec(endpoint.slice(prefix.length));
  if (!match || !/^[\x21-\x7e]+$/.test(match[1]) || /[%\\]/.test(match[1])
    || match[1].split('/').some(part => !part || part === '.' || part === '..')) return null;
  return match[1];
}

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
// Mutable requests remain fresh; verified immutable source GETs share this
// instance's bounded cache. All real requests share the two-process FIFO.
export function githubReleaseAsyncReads(runtime, {
  cwd = process.cwd(), executeSync = execFileSync, executeAsync = asyncExecFile,
} = {}) {
  let active = 0;
  const pending = [];
  const immutable = new Map(), inFlight = new Map();
  let immutableBytes = 0;
  const identityBinding = JSON.stringify([runtime.command, runtime.env, runtime.injectedArgs || []]);
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

  const immutableJson = endpoint => {
    const path = immutableContentsPath(endpoint);
    if (!path) return runAsync(endpoint, false).then(parse);
    const unchangedIdentity = () => {
      if (JSON.stringify([runtime.command, runtime.env, runtime.injectedArgs || []]) !== identityBinding) return fail();
    };
    try { unchangedIdentity(); } catch (error) { return Promise.reject(error); }
    const cached = immutable.get(endpoint);
    if (cached !== undefined) return Promise.resolve(parse(cached));
    let request = inFlight.get(endpoint);
    if (!request) {
      request = runAsync(endpoint, false).then(text => {
        unchangedIdentity();
        const value = parse(text), content = typeof value?.content === 'string' ? value.content.replace(/\n/g, '') : null;
        if (typeof text !== 'string' || value?.type !== 'file' || value.path !== path || value.encoding !== 'base64'
          || !/^[a-f0-9]{40}$/.test(value.sha || '') || content === null) return fail();
        const body = Buffer.from(content, 'base64');
        if (body.toString('base64') !== content || !Number.isSafeInteger(value.size) || value.size !== body.length
          || createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex') !== value.sha) return fail();
        const size = Buffer.byteLength(text);
        if (size <= MAX_IMMUTABLE_ENTRY_BYTES) {
          // At in-flight capacity, duplicate requests may finish independently.
          // Replace an existing entry without counting its bytes twice.
          if (immutable.has(endpoint)) {
            immutableBytes -= Buffer.byteLength(immutable.get(endpoint)); immutable.delete(endpoint);
          }
          while (immutable.size >= MAX_IMMUTABLE_ENTRIES || immutableBytes + size > MAX_IMMUTABLE_BYTES) {
            const oldest = immutable.keys().next().value;
            immutableBytes -= Buffer.byteLength(immutable.get(oldest)); immutable.delete(oldest);
          }
          immutable.set(endpoint, text); immutableBytes += size;
        }
        return text;
      });
      if (inFlight.size < MAX_IMMUTABLE_ENTRIES) {
        inFlight.set(endpoint, request);
        const clear = () => { if (inFlight.get(endpoint) === request) inFlight.delete(endpoint); };
        request.then(clear, clear);
      }
    }
    // Parse for each consumer: caller mutation cannot corrupt a later proof.
    // Callers still compare their independently pinned expected SHA256 on every
    // returned body; blob SHA1 alone does not establish commit membership.
    return request.then(text => { unchangedIdentity(); return parse(text); });
  };

  return {
    json(endpoint) {
      if (endpoint === 'user') {
        if (active || pending.length) return fail();
        return parse(runSync(endpoint, false));
      }
      return immutableJson(endpoint);
    },
    archive(endpoint) {
      return runAsync(endpoint, true).then(value => {
        if (!Buffer.isBuffer(value)) return fail();
        return value;
      });
    },
  };
}
