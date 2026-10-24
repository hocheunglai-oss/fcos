import { createHash } from 'node:crypto';

const commands = new Set(['deploy', 'promote', 'rollback', '--version']);
const signals = new Set(['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGABRT']);
const codes = new Set(['ETIMEDOUT', 'ENOBUFS', 'ENOENT', 'EACCES']);
const stream = value => typeof value === 'string' || Buffer.isBuffer(value)
  ? { bytes: Buffer.byteLength(value), sha256: createHash('sha256').update(value).digest('hex') } : null;

// Native errors can include the bearer, argv, paths and provider response text.
// Retain only a closed report, never the error, cause, message or output itself.
export function vercelCommandFailure(error, command) {
  return { kind: 'fcos_vercel_cli_failure_v1', command: commands.has(command) ? command : 'unknown',
    exitStatus: Number.isSafeInteger(error?.status) && error.status >= 0 && error.status <= 255 ? error.status : null,
    signal: signals.has(error?.signal) ? error.signal : null,
    nativeCode: codes.has(error?.code) ? error.code : null,
    stdout: stream(error?.stdout), stderr: stream(error?.stderr), outcome: 'unknown' };
}

export function safeVercelCommandFailure(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).sort().join(',') !== 'command,exitStatus,kind,nativeCode,outcome,signal,stderr,stdout'
    || value.kind !== 'fcos_vercel_cli_failure_v1' || value.outcome !== 'unknown'
    || !commands.has(value.command) && value.command !== 'unknown'
    || value.exitStatus !== null && (!Number.isSafeInteger(value.exitStatus) || value.exitStatus < 0 || value.exitStatus > 255)
    || value.signal !== null && !signals.has(value.signal) || value.nativeCode !== null && !codes.has(value.nativeCode)) return undefined;
  for (const output of [value.stdout, value.stderr]) {
    if (output !== null && (!output || Object.getPrototypeOf(output) !== Object.prototype
      || Object.keys(output).sort().join(',') !== 'bytes,sha256' || !Number.isSafeInteger(output.bytes) || output.bytes < 0
      || typeof output.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(output.sha256))) return undefined;
  }
  return structuredClone(value);
}
