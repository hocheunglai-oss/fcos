import { readFileSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { digest, git, requireCondition as check, sourceSnapshot } from './lib/rapid-release/contract.mjs';
import { auditBootstrap, createBootstrapPlan, runBootstrap, BootstrapJournal } from './lib/rapid-release/bootstrap.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** Fixed stdin is private transport, never a plan/approval receipt or a provider log.
 * Root's tracked bootstrap-native.mjs supplies pg plus authenticated target-locked CLIs.
 */
async function privateStdin(stream) {
  const chunks = []; let length = 0;
  for await (const chunk of stream) { length += Buffer.byteLength(chunk); check(length <= 65536, 'BOOTSTRAP_PRIVATE_INPUT_TOO_LARGE'); chunks.push(Buffer.from(chunk)); }
  check(length > 0, 'BOOTSTRAP_PRIVATE_STDIN_REQUIRED'); return Buffer.concat(chunks);
}
export async function bootstrapMain(argv, { cwd = ROOT, createNative, privateInput, stdin = process.stdin } = {}) {
  const [command, ...args] = argv, options = {};
  check(['audit','plan','apply','readback'].includes(command), 'BOOTSTRAP_COMMAND_REQUIRED');
  for (let index = 0; index < args.length; index += 2) {
    check(['--plan','--journal','--authorization-hash'].includes(args[index]) && !options[args[index]]
      && args[index + 1] && !args[index + 1].startsWith('-'), 'BOOTSTRAP_ARGUMENT_INVALID'); options[args[index]] = args[index + 1];
  }
  const plan = options['--plan'] ? JSON.parse(readFileSync(resolve(options['--plan']), 'utf8')) : null;
  if (['apply','readback'].includes(command)) check(plan, 'BOOTSTRAP_EXACT_PLAN_REQUIRED');
  if (command === 'apply') check(options['--authorization-hash'] === digest(plan) && options['--journal'], 'BOOTSTRAP_EXACT_SETUP_AUTHORIZATION_REQUIRED');
  const source = sourceSnapshot(cwd);
  if (plan) check(source.sha === plan.controllerSha && source.sourceDigest === plan.sourceDigest && source.lockDigest === plan.lockDigest, 'BOOTSTRAP_CONTROLLER_SOURCE_MISMATCH');
  if (!createNative) {
    const path = 'scripts/lib/rapid-release/bootstrap-native.mjs';
    check(git(cwd, ['ls-files','--',path]) === path && realpathSync(resolve(cwd,path)) === resolve(cwd,path), 'BOOTSTRAP_TRACKED_NATIVE_ADAPTER_REQUIRED');
    createNative = (await import(pathToFileURL(resolve(cwd,path)).href)).createBootstrapNative;
  }
  check(typeof createNative === 'function', 'BOOTSTRAP_NATIVE_ADAPTER_REQUIRED');
  const secret = privateInput || await privateStdin(stdin);
  check(Buffer.isBuffer(secret) && secret.length > 0 && secret.length <= 65536, 'BOOTSTRAP_PRIVATE_STDIN_REQUIRED');
  let native;
  try {
    native = await createNative({ plan, cwd, privateInput: secret });
    const input = { github: native.github, vercel: native.vercel, db: native.db, connection: native.connection,
      sourceReader: sourceSnapshot, plan, cwd };
    if (['audit','plan'].includes(command)) {
      const audit = await auditBootstrap(input);
      if (command === 'audit') return { source: audit.source, inventoryDigest: audit.inventoryDigest, previousProductionId: audit.previousProductionId,
        quality: audit.quality, database: audit.database };
      return createBootstrapPlan({ source: audit.source, audit: audit.database, inventoryDigest: audit.inventoryDigest,
        previousProductionId: audit.previousProductionId, quality: audit.quality });
    }
    const actor = await native.github.read('/user');
    const journal = command === 'apply' ? new BootstrapJournal({ path: resolve(options['--journal']), github: native.github, plan, actorId: actor.id }) : null;
    return await runBootstrap({ ...input, journal, readbackOnly: command === 'readback' });
  } finally { secret.fill(0); await native?.db?.end?.(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) bootstrapMain(process.argv.slice(2)).then(result => {
  console.log(JSON.stringify(result, null, 2));
}).catch(error => {
  console.error(/^(?:BOOTSTRAP|HANDOVER|SOURCE)_[A-Z0-9_]+$/.test(error.code || error.message) ? error.code || error.message : 'BOOTSTRAP_FAILED_ORIGINAL_CHECKPOINT_PRESERVED');
  process.exitCode = 1;
});
