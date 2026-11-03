import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

export const newMigration = '20261016230316_fcuno_session_proof_and_atomic_projection.sql';
export const revocationMigration = '20261016231319_fcuno_monotonic_revocation_floor.sql';
export const userId = '11111111-1111-4111-8111-111111111111';
export const subject = '22222222-2222-4222-8222-222222222222';
export const sessionId = '33333333-3333-4333-8333-333333333333';
const postgresConfig = spawnSync('pg_config', ['--bindir'], { encoding: 'utf8' });
export const nativePostgresAvailable = postgresConfig.status === 0 && existsSync(path.join(postgresConfig.stdout.trim(), 'initdb'));
const quote = (identifier) => {
  if (!/^[a-z_][a-z_0-9]*$/.test(identifier)) throw new Error('Unsafe fixture SQL identifier');
  return `"${identifier}"`;
};

// This adapter executes real PostgreSQL statements, including the actual RPC.
// Its SELECT projection deliberately returns only the requested columns.
export function databaseClient(query, beforeQuery = async () => {}) {
  return {
    rpc: async (name, parameters) => {
      try {
        const entries = Object.entries(parameters);
        const sql = `select public.${quote(name)}(${entries.map(([key], i) => `${quote(key)} => $${i + 1}`).join(',')}) as result`;
        await beforeQuery({ operation: 'rpc', name, parameters });
        return { data: (await query(sql, entries.map(([, value]) => value))).rows[0].result, error: null };
      } catch (error) { return { data: null, error }; }
    },
    from(table) {
      let operation = 'select', row = null, fields = '*', returning = false, conflict = null, ignore = false;
      const filters = [];
      const builder = {
        select(value = '*') { fields = value; returning = operation !== 'select'; return builder; },
        insert(value) { operation = 'insert'; row = value; return builder; },
        upsert(value, options = {}) { operation = 'insert'; row = value; conflict = options.onConflict; ignore = options.ignoreDuplicates; return builder; },
        update(value) { operation = 'update'; row = value; return builder; },
        eq(key, value) { filters.push([key, '=', value]); return builder; },
        is(key, value) { assertNull(value); filters.push([key, 'is null']); return builder; },
        in(key, values) { filters.push([key, 'any', values]); return builder; },
        maybeSingle: async () => execute(true),
        then: (resolve, reject) => execute(false).then(resolve, reject),
      };
      async function execute(single) {
        try {
          await beforeQuery({ operation, table, row, fields });
          const values = [], param = (value) => { values.push(value); return `$${values.length}`; };
          const selected = fields === '*' ? '*' : fields.split(',').map(quote).join(',');
          let sql;
          if (operation === 'select') sql = `select ${selected} from public.${quote(table)}`;
          if (operation === 'update') sql = `update public.${quote(table)} set ${Object.entries(row).map(([key, value]) => `${quote(key)}=${param(value)}`).join(',')}`;
          if (operation === 'insert') {
            const keys = Object.keys(row);
            sql = `insert into public.${quote(table)} (${keys.map(quote).join(',')}) values (${keys.map((key) => param(row[key])).join(',')})`;
            if (conflict) sql += ` on conflict (${conflict.split(',').map(quote).join(',')}) ${ignore ? 'do nothing' : `do update set ${keys.map((key) => `${quote(key)}=excluded.${quote(key)}`).join(',')}`}`;
          }
          if (filters.length) sql += ` where ${filters.map(([key, op, value]) => op === 'is null' ? `${quote(key)} is null` : op === 'any' ? `${quote(key)}=any(${param(value)})` : `${quote(key)}=${param(value)}`).join(' and ')}`;
          if (returning) sql += ` returning ${selected}`;
          const result = await query(sql, values);
          return { data: single ? result.rows[0] || null : result.rows, error: null };
        } catch (error) { return { data: null, error }; }
      }
      return builder;
    },
  };
}
function assertNull(value) { if (value !== null) throw new Error('Only null IS is required by this fixture'); }

export async function federationDatabase(t, { native = false } = {}) {
  let db, query, exec;
  if (native) {
    const bindir = execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim();
    const directory = await mkdtemp(path.join(tmpdir(), 'fcos-fcuno-pg-'));
    const data = path.join(directory, 'data'), port = 54591;
    let started = false;
    t.after(async () => {
      await db?.end();
      if (started) execFileSync(path.join(bindir, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
      await rm(directory, { recursive: true, force: true });
    });
    execFileSync(path.join(bindir, 'initdb'), ['-D', data, '--username=postgres', '--auth=trust', '--no-locale', '--encoding=UTF8'], { stdio: 'pipe' });
    execFileSync(path.join(bindir, 'pg_ctl'), ['-D', data, '-l', path.join(directory, 'server.log'), '-o', `-k ${directory} -h '' -p ${port}`, '-w', 'start'], { stdio: 'pipe' });
    started = true;
    db = new pg.Pool({ host: directory, port, user: 'postgres', database: 'postgres', max: 8 });
    query = (sql, values = []) => db.query(sql, values);
    exec = (sql) => db.query(sql);
  } else {
    db = new PGlite(); query = (sql, values = []) => db.query(sql, values); exec = (sql) => db.exec(sql);
    t.after(() => db.close());
  }
  await exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create table public.user_profiles(id uuid primary key references auth.users(id), email text, full_name text,
      user_type text default 'viewer', active boolean default false, use_type_defaults boolean default false,
      updated_at timestamptz default now());
    grant usage on schema public to anon,authenticated,service_role;
    grant select,insert,update on public.user_profiles to service_role;`);
  await exec(await readFile(new URL('../supabase/migrations/20260830172911_fcos_fcuno_identity_federation.sql', import.meta.url), 'utf8'));
  await exec(await readFile(new URL(`../supabase/migrations/${newMigration}`, import.meta.url), 'utf8'));
  await exec(await readFile(new URL(`../supabase/migrations/${revocationMigration}`, import.meta.url), 'utf8'));
  await query('insert into auth.users(id) values($1)', [userId]);
  await query("insert into public.user_profiles(id,email,full_name,active,user_type,use_type_defaults) values($1,'user@fcuno.example','Existing User',true,'trader',true)", [userId]);
  const client = databaseClient(query);
  return { db, query, exec, client };
}
