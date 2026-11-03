import { createHash } from 'node:crypto';

export class ReleaseError extends Error {
  constructor(code, phase, recovery, detail = {}) {
    super(code); this.name = 'ReleaseError'; this.code = code; this.phase = phase; this.recovery = recovery; this.detail = detail;
  }
}
export function fail(code, phase = 'admission', recovery = 'Correct the bound inputs before starting a new operation.') { throw new ReleaseError(code, phase, recovery); }
export function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  fail('NON_JSON_CONTRACT');
}
export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
