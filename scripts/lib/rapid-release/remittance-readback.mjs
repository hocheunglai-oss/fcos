import { digest, isSha, requireCondition, targets } from './contract.mjs';
import { githubClient } from './providers.mjs';
import { SCHEMA_FINGERPRINT_SQL, withPinnedReadOnlyDatabase } from './compatibility.mjs';

const migrationPath = 'supabase/migrations/20261001011301_xero_group_payment_confirmed_cents.sql';
const migrationDigest = 'd044fe0ba1dd8110b73cf326b8fc7d8d9c373a8f2cc79f523608dc9d4da2881c';
const expectedBodies = {
  'xero_guard_group_payment_v1()': '88741f4baa2d639fdc60cbe2073e5d2cfd2aaaa60b4bc920d2cdfda875905911',
  'link_xero_group_payments_v1(uuid, jsonb, uuid, text)': 'f88894c8804bce73d542063c211940d7c5b7a31d9861ba908dd475fce05a5494',
  'finish_xero_group_payment_v1(uuid, uuid, text, text, jsonb, jsonb, uuid, text)': '0af6d9c4f6d867a8b592755dca6af7020b38fa05e53b9cfef0b14f13c191b201',
};
const expectedTriggers = [
  'public.xero_financial_payment_mappings:xero_group_payment_mapping_guard',
  'public.xero_financial_sync_runs:xero_group_payment_claim_guard',
];
const readCatalog = `select p.proname || '(' || oidvectortypes(p.proargtypes) || ')' as signature,
  encode(sha256(convert_to(btrim(p.prosrc, E' \\n\\r\\t'), 'UTF8')), 'hex') as body_digest,
  p.prosecdef, p.proconfig,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_execute,
  array(select tn.nspname || '.' || c.relname || ':' || t.tgname
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace tn on tn.oid=c.relnamespace
    where t.tgfoid=p.oid and not t.tgisinternal and t.tgenabled='O'
      and t.tgtype=31 and t.tgqual is null order by 1) as triggers
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname=any($1::text[]) order by signature`;

export function verifyRemittanceCatalog(rows) {
  requireCondition(rows.length === Object.keys(expectedBodies).length
    && new Set(rows.map(row => row.signature)).size === rows.length
    && rows.every(row => Object.hasOwn(expectedBodies, row.signature)
      && row.body_digest === expectedBodies[row.signature]
      && row.prosecdef === false && digest(row.proconfig) === digest(['search_path=public, pg_temp'])
      && row.anon_execute === false && row.authenticated_execute === false && row.service_execute === true
      && digest(row.triggers) === digest(row.signature === 'xero_guard_group_payment_v1()' ? expectedTriggers : [])),
  'REMITTANCE_SCHEMA_READBACK_MISMATCH');
  return digest(rows);
}

// This adapter only attests the migration already deployed in FCOS. It has no SQL write path.
export async function applyReviewedPrerequisites({ manifest, journal, env, plan }) {
  requireCondition(digest(plan) === digest({ migrationPath, migrationDigest })
    && manifest.selection.database === true && manifest.selection.salesforce === false
    && digest(manifest.paths.filter(path => path.startsWith('supabase/migrations/'))) === digest([migrationPath])
    && isSha(manifest.candidate.sha), 'REMITTANCE_READBACK_PLAN_MISMATCH');
  const operationId = `${manifest.releaseId}-prerequisites`;
  const request = { planDigest: digest(manifest.prerequisites), candidateSha: manifest.candidate.sha };
  const intent = (await journal.read()).find(record => record.payload.event === 'prerequisites.intent')?.payload.data;
  requireCondition(intent?.operationId === operationId && intent.requestHash === digest(request),
    'REMITTANCE_READBACK_INTENT_REQUIRED');
  const github = githubClient({ token: env.GITHUB_TOKEN, candidateSha: manifest.candidate.sha });
  const file = await github.read(`/repos/${targets().repository}/contents/${migrationPath}?ref=${manifest.candidate.sha}`);
  requireCondition(file.path === migrationPath && file.encoding === 'base64'
    && digest(Buffer.from(file.content, 'base64')) === migrationDigest, 'REMITTANCE_MIGRATION_BYTES_CHANGED');
  const evidenceDigest = await withPinnedReadOnlyDatabase({ env }, async db => {
    const schema = (await db.query(SCHEMA_FINGERPRINT_SQL)).rows[0]?.digest;
    requireCondition(schema === manifest.previous.schemaDigest, 'REMITTANCE_BASELINE_SCHEMA_CHANGED');
    const names = Object.keys(expectedBodies).map(signature => signature.split('(')[0]);
    return digest({ schema, catalog: verifyRemittanceCatalog((await db.query(readCatalog, [names])).rows), migrationDigest });
  });
  return { passed: true, manifestHash: digest(manifest), backwardCompatible: true,
    completedOperations: [{ operationId, evidenceDigest, verified: true, intentRecorded: true }],
    database: { destructiveRollback: false, readbackVerified: true } };
}
