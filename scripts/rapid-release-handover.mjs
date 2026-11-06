import { readFileSync, realpathSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { auditHandover, applyHandover, performHandover, assertHandoverConnection } from './lib/rapid-release/handover.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function handoverMain(argv, env = process.env) {
  const [command, ...args] = argv, options = {};
  if (!['audit','prepare','abort','finalize','perform'].includes(command)) throw Error('HANDOVER_COMMAND_REQUIRED');
  for (let index = 0; index < args.length; index += 2) {
    if (!['--adapter','--plan'].includes(args[index]) || options[args[index]] || !args[index + 1] || args[index + 1].startsWith('-')) throw Error('HANDOVER_ARGUMENT_INVALID');
    options[args[index]] = args[index + 1];
  }
  if (!options['--adapter'] || command !== 'audit' && !options['--plan']) throw Error('HANDOVER_ADAPTER_AND_EXACT_PLAN_REQUIRED');
  const url = new URL(env.FCOS_HANDOVER_DATABASE_URL || 'missing:');
  if (url.protocol !== 'postgresql:' || [...url.searchParams].length || !env.FCOS_HANDOVER_DATABASE_CA) throw Error('HANDOVER_PRIVATE_TLS_CONNECTION_REQUIRED');
  const connection = { host: url.hostname, port: Number(url.port || 5432), database: url.pathname.slice(1), user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password), ssl: { rejectUnauthorized: true, ca: readFileSync(env.FCOS_HANDOVER_DATABASE_CA, 'utf8') } };
  assertHandoverConnection(connection);
  const adapterPath = realpathSync(resolve(ROOT, options['--adapter']));
  if (relative(ROOT, adapterPath).startsWith('..')) throw Error('HANDOVER_CONTROLLER_ADAPTER_REQUIRED');
  const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
  // Adapter source must belong to the exact clean controller; credentials never enter candidate code.
  if (!git(['ls-files','--',relative(ROOT, adapterPath)]) || git(['status','--porcelain','--untracked-files=no'])) throw Error('HANDOVER_CLEAN_TRACKED_CONTROLLER_REQUIRED');
  const plan = options['--plan'] ? JSON.parse(readFileSync(resolve(options['--plan']), 'utf8')) : null;
  if (plan && git(['rev-parse','HEAD']) !== plan.controllerSha) throw Error('HANDOVER_CONTROLLER_SHA_MISMATCH');
  const { Client } = await import('pg'), db = new Client(connection);
  await db.connect();
  try {
    const module = await import(pathToFileURL(adapterPath).href);
    const adapter = await module.createHandoverAdapter({ plan, db, connection });
    const input = { plan, db, connection, github: adapter.github, vercel: adapter.vercel };
    if (command === 'audit') return auditHandover(input);
    if (command === 'perform') {
      const result = await performHandover({ ...input, coordinator: { db, connection }, qualifyStage: adapter.qualifyStage, retireOldWriters: adapter.retireOldWriters });
      if (typeof adapter.activate !== 'function') throw Error('HANDOVER_ACTIVATION_ADAPTER_REQUIRED');
      await adapter.activate(result); return result;
    }
    return applyHandover({ ...input, phase: command });
  } finally { await db.end(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) handoverMain(process.argv.slice(2)).then(result => {
  console.log(JSON.stringify(result, null, 2));
}).catch(error => { console.error(/^[A-Z][A-Z0-9_]+$/.test(error.code || error.message) ? error.code || error.message : 'HANDOVER_FAILED_CHECKPOINT_PRESERVED'); process.exitCode = 1; });
