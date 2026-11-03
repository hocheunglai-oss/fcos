import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const salesforcePromotionHash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export const SALESFORCE_PROMOTION_STAGES = Object.freeze(['devee', 'shared_mirror', 'qat', 'production']);

export function openSalesforcePromotionJournal({ directory, binding, now = () => new Date() }) {
  const fingerprint = salesforcePromotionHash(binding);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, `${fingerprint}.json`);
  const lock = `${file}.lock`;
  const token = randomUUID();
  let handle;
  try { handle = openSync(lock, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    // Serialize dead-owner recovery so two resumers cannot remove one another's new lock.
    const recovery = `${lock}.recovery`;
    let recoveryFd;
    try { recoveryFd = openSync(recovery, 'wx', 0o600); }
    catch { throw new Error('Salesforce promotion lock recovery is already in progress; inspect the recovery owner before retrying.'); }
    try {
      writeFileSync(recoveryFd, JSON.stringify({ pid: process.pid, token })); fsyncSync(recoveryFd);
      let owner;
      try { owner = JSON.parse(readFileSync(lock, 'utf8')); } catch { throw new Error('Salesforce promotion lock is malformed; inspect it before resuming.'); }
      if (!Number.isSafeInteger(owner.pid) || owner.pid < 1) throw new Error('Salesforce promotion lock owner is invalid.');
      try { process.kill(owner.pid, 0); throw new Error('Salesforce promotion is already running.'); }
      catch (status) { if (status.code !== 'ESRCH') throw status; }
      unlinkSync(lock);
      handle = openSync(lock, 'wx', 0o600);
    } finally { closeSync(recoveryFd); unlinkSync(recovery); }
  }
  writeFileSync(handle, JSON.stringify({ pid: process.pid, token })); fsyncSync(handle); closeSync(handle);
  let state;
  try {
    state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { schemaVersion: 1, kind: 'fcos_salesforce_promotion', fingerprint, binding, createdAt: now().toISOString(), stages: {} };
    if (state.schemaVersion !== 1 || state.kind !== 'fcos_salesforce_promotion' || state.fingerprint !== fingerprint
      || salesforcePromotionHash(state.binding) !== fingerprint || !state.stages || typeof state.stages !== 'object') throw new Error('Salesforce promotion journal binding is invalid.');
  } catch (error) { unlinkSync(lock); throw error; }
  const persist = () => {
    const temporary = `${file}.${token}.tmp`;
    const fd = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(fd, `${JSON.stringify(state, null, 2)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, file);
    const directoryFd = openSync(dirname(file), 'r');
    try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
  };
  persist();
  return {
    file, state,
    update(stage, operation, value) {
      if (!SALESFORCE_PROMOTION_STAGES.includes(stage)) throw new Error('Unknown Salesforce promotion stage.');
      state.stages[stage] ||= {};
      state.stages[stage][operation] = { ...value, recordedAt: now().toISOString() };
      persist();
      return state.stages[stage][operation];
    },
    close() {
      const owner = JSON.parse(readFileSync(lock, 'utf8'));
      if (owner.token !== token) throw new Error('Salesforce promotion lock ownership changed.');
      unlinkSync(lock);
    },
  };
}

export function assertSuccessfulSalesforceReport(report, { validation = false, jobId, environment }) {
  if (report?.status !== 'Succeeded' || report?.success !== true || report?.done !== true || report?.id !== jobId
    || report?.checkOnly !== validation || report?.rollbackOnError !== true
    || Number(report?.numberComponentErrors || 0) !== 0 || Number(report?.numberTestErrors || 0) !== 0) {
    throw new Error(`${environment.label} ${validation ? 'validation' : 'deployment'} report is not a successful all-or-none proof.`);
  }
  return { jobId, status: 'Succeeded', orgId: environment.orgId, checkOnly: validation, rollbackOnError: true,
    components: `${report.numberComponentsDeployed || 0}/${report.numberComponentsTotal || 0}`,
    tests: `${report.numberTestsCompleted || 0}/${report.numberTestsTotal || 0}` };
}
