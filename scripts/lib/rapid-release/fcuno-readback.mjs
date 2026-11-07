import { digest, isSha, requireCondition, targets } from './contract.mjs';
import { githubClient } from './providers.mjs';
import { SCHEMA_FINGERPRINT_SQL, withPinnedReadOnlyDatabase } from './compatibility.mjs';

const migrations = {
  'supabase/migrations/20261019144041_fcuno_session_proof_and_atomic_projection.sql': 'a5dcc1bcaecc02972325b44e6c91e9014e2bdf1f869fd236c80040233d927e33',
  'supabase/migrations/20261019144123_fcuno_monotonic_revocation_floor.sql': '7960964977732bf9a22eeee38230ff11e9a73af082f7c7797fc4c14a89aa6e4b',
};
const expectedBodies = {
  'fcos_finalize_identity_sync(uuid, uuid, bigint)': '2da49057dadc7e059944bd6e0a716b3edcf5a599681d0dba85963773d9f8d2d3',
  'fcos_protect_external_identity_revision()': '0aa446687aa6e39c6db666e416ad3fcab60e6aa6b93ed688f09ddd64c0057d6b',
  'fcos_reject_identity_session_update()': '2084de0a54cb00f1d04adc07c9737f4d60d8d7dd7d87c03a4e4ea8f59e0ce065',
};
const expectedTriggers = {
  'fcos_finalize_identity_sync(uuid, uuid, bigint)': [],
  'fcos_protect_external_identity_revision()': ['public.fcos_external_identity_links'],
  'fcos_reject_identity_session_update()': ['public.fcos_external_identity_sessions'],
};
const readCatalog = `select p.proname || '(' || oidvectortypes(p.proargtypes) || ')' as signature,
  encode(sha256(convert_to(btrim(p.prosrc, E' \\n\\r\\t'), 'UTF8')), 'hex') as body_digest,
  p.prosecdef, p.proconfig,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_execute,
  array(select tn.nspname || '.' || c.relname
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace tn on tn.oid=c.relnamespace
    where t.tgfoid=p.oid and not t.tgisinternal and t.tgenabled='O'
      and t.tgtype=19 and t.tgqual is null order by 1) as triggers
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname=any($1::text[]) order by signature`;

const readSessionTable = `select c.relrowsecurity as rls,
  (select count(*)::int from pg_policy where polrelid=c.oid) as policies,
  array(select grantee::regrole::text || ':' || privilege_type
    from aclexplode(c.relacl) where grantee <> c.relowner order by 1) as grants
  from pg_class c where c.oid='public.fcos_external_identity_sessions'::regclass`;

export function verifyFcunoCatalog(rows, table) {
  requireCondition(rows.length === Object.keys(expectedBodies).length
    && new Set(rows.map(row => row.signature)).size === rows.length
    && rows.every(row => Object.hasOwn(expectedBodies, row.signature)
      && row.body_digest === expectedBodies[row.signature]
      && row.prosecdef === false && digest(row.proconfig) === digest(['search_path=pg_catalog, pg_temp'])
      && row.anon_execute === false && row.authenticated_execute === false && row.service_execute === true
      && digest(row.triggers) === digest(expectedTriggers[row.signature]))
    && table?.rls === true && table.policies === 0
    && digest(table.grants) === digest(['service_role:INSERT', 'service_role:SELECT']),
  'FCUNO_SCHEMA_READBACK_MISMATCH');
  return digest({ rows, table });
}

// Both migrations are already installed. This adapter only reads the pinned schema.
export async function applyReviewedPrerequisites({ manifest, journal, env, plan }) {
  const paths = Object.keys(migrations);
  requireCondition(digest(plan) === digest({ migrations })
    && manifest.selection.database === true && manifest.selection.salesforce === false
    && digest(manifest.paths.filter(path => path.startsWith('supabase/migrations/')).sort()) === digest(paths)
    && isSha(manifest.candidate.sha), 'FCUNO_READBACK_PLAN_MISMATCH');
  const operationId = `${manifest.releaseId}-prerequisites`;
  const request = { planDigest: digest(manifest.prerequisites), candidateSha: manifest.candidate.sha };
  const intent = (await journal.read()).find(record => record.payload.event === 'prerequisites.intent')?.payload.data;
  requireCondition(intent?.operationId === operationId && intent.requestHash === digest(request),
    'FCUNO_READBACK_INTENT_REQUIRED');
  const github = githubClient({ token: env.GITHUB_TOKEN, candidateSha: manifest.candidate.sha });
  await Promise.all(paths.map(async path => {
    const file = await github.read(`/repos/${targets().repository}/contents/${path}?ref=${manifest.candidate.sha}`);
    requireCondition(file.path === path && file.encoding === 'base64'
      && digest(Buffer.from(file.content, 'base64')) === migrations[path], 'FCUNO_MIGRATION_BYTES_CHANGED');
  }));
  const evidenceDigest = await withPinnedReadOnlyDatabase({ env }, async db => {
    const schema = (await db.query(SCHEMA_FINGERPRINT_SQL)).rows[0]?.digest;
    requireCondition(schema === manifest.previous.schemaDigest, 'FCUNO_BASELINE_SCHEMA_CHANGED');
    const names = Object.keys(expectedBodies).map(signature => signature.split('(')[0]);
    const rows = (await db.query(readCatalog, [names])).rows;
    const table = (await db.query(readSessionTable)).rows[0];
    return digest({ schema, catalog: verifyFcunoCatalog(rows, table), migrations });
  });
  return { passed: true, manifestHash: digest(manifest), backwardCompatible: true,
    completedOperations: [{ operationId, evidenceDigest, verified: true, intentRecorded: true }],
    database: { destructiveRollback: false, readbackVerified: true } };
}
