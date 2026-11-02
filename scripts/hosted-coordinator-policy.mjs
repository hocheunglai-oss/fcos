#!/usr/bin/env node
// Local compiler/check only. Native owner readback and guarded provider writes
// remain separate; this entrypoint never dispatches or repairs a provider.
import fs from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest } from './lib/hosted-release/json-contract.mjs';
import { compileCoordinatorPolicyBinding, assertCoordinatorPolicyPreflight } from './lib/hosted-release/coordinator-policy-binding.mjs';
const need = (x, code) => { if (!x) throw Object.assign(new Error(code), { code }); };
function readRef(ref) {
  need(ref && isAbsolute(ref.path) && fs.realpathSync(ref.path) === ref.path && fs.lstatSync(ref.path).isFile(), 'COORDINATOR_POLICY_PHYSICAL_REF_REQUIRED');
  const bytes = fs.readFileSync(ref.path); need(digest(bytes) === ref.sha256, 'COORDINATOR_POLICY_INPUT_CHANGED');
  return JSON.parse(bytes);
}
export function coordinatorPolicyCommand(command, inputRef) {
  need(['compile','check'].includes(command), 'COORDINATOR_POLICY_COMMAND');
  const input = readRef(inputRef);
  need(input.kind === 'fcos_coordinator_policy_command_v1', 'COORDINATOR_POLICY_INPUT');
  const args = { manifest: readRef(input.manifest), setup: readRef(input.setup), previousPolicy: readRef(input.previousPolicy), coordinatorProjectId: input.coordinatorProjectId, coordinatorSourceSha256: input.coordinatorSourceSha256, preservedConfigurationSha256: input.preservedConfigurationSha256 };
  if (command === 'compile') return compileCoordinatorPolicyBinding({ ...args, coordinatorSourceSha256: input.coordinatorSourceSha256, preservedConfigurationSha256: input.preservedConfigurationSha256 });
  return assertCoordinatorPolicyPreflight({ ...args, binding: readRef(input.binding), observation: readRef(input.observation), dispatchRequest: readRef(input.dispatchRequest), dispatchRequestSha256: input.dispatchRequestSha256 });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    need(process.argv.length === 6, 'COORDINATOR_POLICY_USAGE');
    const result = coordinatorPolicyCommand(process.argv[2], { path: resolve(process.argv[3]), sha256: process.argv[4] });
    fs.writeFileSync(resolve(process.argv[5]), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    process.stdout.write(JSON.stringify({ kind: result.kind, sha256: digest(result), providerAuthorityGranted: false }) + '\n');
  } catch (error) {
    const code = typeof error.code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(error.code) ? error.code : 'COORDINATOR_POLICY_INPUT_INVALID';
    process.stderr.write(JSON.stringify({ code, providerAuthorityGranted: false }) + '\n'); process.exitCode = 1;
  }
}
