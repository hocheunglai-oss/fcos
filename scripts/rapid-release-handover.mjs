import { readFileSync, realpathSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { auditHandover, preflightHandoverProviders, applyHandover, performHandover, assertHandoverConnection } from './lib/rapid-release/handover.mjs';
import { createDatabaseCredentialIntentStore } from './lib/rapid-release/database-intent.mjs';
import { openPinnedDatabase } from './lib/rapid-release/database-connection.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** A lease belongs only to one awaited phase; it never spans a provider/build/
 * browser wait, overlaps another phase, or retries an uncertain issuance. The
 * caller supplies source-owned native factories, not serialized authority.
 */
export function createHandoverCoordinator({ openDatabase, createAdapter, plan }) {
  if (typeof openDatabase !== 'function' || typeof createAdapter !== 'function') throw Error('HANDOVER_NATIVE_CONTEXT_FACTORY_REQUIRED');
  let active = false;
  return async (phase, work) => {
    if (!['audit','prepare','abort','stage','finalize','activate'].includes(phase) || typeof work !== 'function' || active) throw Error('HANDOVER_NATIVE_CONTEXT_PHASE_REQUIRED');
    active = true; let native;
    try {
      native = await openDatabase();
      assertHandoverConnection(native?.connection);
      const adapter = await createAdapter({ plan, ...native });
      return await work({ ...native, adapter, github: adapter.github, vercel: adapter.vercel });
    } finally {
      try { if (native?.db) await native.db.end(); }
      catch { throw Error('HANDOVER_DATABASE_CLOSE_UNCERTAIN'); }
      finally { active = false; }
    }
  };
}
export async function handoverMain(argv, env = process.env) {
  const [command, ...args] = argv, options = {};
  if (!['audit','prepare','abort','finalize','perform','activate'].includes(command)) throw Error('HANDOVER_COMMAND_REQUIRED');
  for (let index = 0; index < args.length; index += 2) {
    if (!['--adapter','--plan'].includes(args[index]) || options[args[index]] || !args[index + 1] || args[index + 1].startsWith('-')) throw Error('HANDOVER_ARGUMENT_INVALID');
    options[args[index]] = args[index + 1];
  }
  if (!options['--adapter'] || command !== 'audit' && !options['--plan']) throw Error('HANDOVER_ADAPTER_AND_EXACT_PLAN_REQUIRED');
  const adapterPath = realpathSync(resolve(ROOT, options['--adapter']));
  if (relative(ROOT, adapterPath).startsWith('..')) throw Error('HANDOVER_CONTROLLER_ADAPTER_REQUIRED');
  const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
  // Adapter source must belong to the exact clean controller; credentials never enter candidate code.
  if (!git(['ls-files','--',relative(ROOT, adapterPath)]) || git(['status','--porcelain','--untracked-files=no'])) throw Error('HANDOVER_CLEAN_TRACKED_CONTROLLER_REQUIRED');
  const plan = options['--plan'] ? JSON.parse(readFileSync(resolve(options['--plan']), 'utf8')) : null;
  if (plan && git(['rev-parse','HEAD']) !== plan.controllerSha) throw Error('HANDOVER_CONTROLLER_SHA_MISMATCH');
  if (!env.FCOS_HANDOVER_DATABASE_CA || Boolean(env.FCOS_HANDOVER_DATABASE_URL) === Boolean(env.FCOS_RAPID_SUPABASE_ACCESS_TOKEN)) throw Error('HANDOVER_PRIVATE_TLS_CONNECTION_REQUIRED');
  const openDatabase = async () => {
  if (env.FCOS_RAPID_SUPABASE_ACCESS_TOKEN) {
    const credential={kind:'supabase_management',token:env.FCOS_RAPID_SUPABASE_ACCESS_TOKEN};
    const source={sha:git(['rev-parse','HEAD'])};
    const intentStore=await createDatabaseCredentialIntentStore({credential,directory:ROOT,source,purpose:'rapid_controller_handover'});
    return openPinnedDatabase({credential,caFile:env.FCOS_HANDOVER_DATABASE_CA,intentStore});
  } else {
    const url = new URL(env.FCOS_HANDOVER_DATABASE_URL);
    if (url.protocol !== 'postgresql:' || url.search || url.hash) throw Error('HANDOVER_PRIVATE_TLS_CONNECTION_REQUIRED');
    const connection = { host:url.hostname,port:Number(url.port || 5432),database:url.pathname.slice(1),user:decodeURIComponent(url.username),
      password:decodeURIComponent(url.password),ssl:{rejectUnauthorized:true,ca:readFileSync(env.FCOS_HANDOVER_DATABASE_CA,'utf8')} };
    assertHandoverConnection(connection);
    const {Client}=await import('pg'), db=new Client(connection);
    try { await db.connect(); return { db, connection }; }
    catch (error) { await db.end(); throw error; }
  }
  };
    const module = await import(pathToFileURL(adapterPath).href);
    const createAdapter = values => module.createHandoverAdapter({ ...values, env });
    const withCoordinator = createHandoverCoordinator({ openDatabase, createAdapter, plan });
    const adapter = await createAdapter({ plan }); // Native provider reads, no PG lease.
    if (['perform','prepare','activate'].includes(command)) {
      await preflightHandoverProviders({ plan, github: adapter.github, vercel: adapter.vercel });
    }
    if (command === 'perform') {
      const result = await performHandover({ plan, github: adapter.github, vercel: adapter.vercel, coordinator: { withCoordinator }, qualifyStage: adapter.qualifyStage, retireOldWriters: adapter.retireOldWriters });
      await withCoordinator('activate', context => context.adapter.activate(result)); return result;
    }
    return withCoordinator(command, context => {
      const input = { plan, ...context };
      if (command === 'audit') return auditHandover(input);
      if (command === 'activate') return context.adapter.activate();
      return applyHandover({ ...input, phase: command });
    });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) handoverMain(process.argv.slice(2)).then(result => {
  console.log(JSON.stringify(result, null, 2));
}).catch(error => { console.error(/^[A-Z][A-Z0-9_]+$/.test(error.code || error.message) ? error.code || error.message : 'HANDOVER_FAILED_CHECKPOINT_PRESERVED'); process.exitCode = 1; });
