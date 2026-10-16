import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import pg from 'pg';
import { fcosConnectionIdentifier, fcosSalesforceEnvironment } from '../../../config/fcosConnections.js';

const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object'
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
export const dependencyHash = value => createHash('sha256').update(Buffer.isBuffer(value) || typeof value === 'string' ? value : canonical(value)).digest('hex');
const hash = value => /^[a-f0-9]{64}$/.test(value || '');
const required = (value, code = 'DEPENDENCY_REVALIDATION_REQUIRED') => { if (!value) { const error = new Error(code); error.code = code; throw error; } };
const waiting = (checkId, inputs) => ({ status: 'waiting_dependency', checkId, missing: inputs });
const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const fresh = (value, now) => instant(value) && Date.parse(value) <= now + 30000 && now - Date.parse(value) <= 1800000;
const legacyCandidateSha = JSON.parse(readFileSync(new URL('../../../config/runtime-compatibility-successor-live.json', import.meta.url))).candidateSha;
const fingerprintKeys = ['sourceSha256', 'harnessSha256', 'salesforceSourceSha256', 'fixtureSha256', 'environmentSha256'];

/** An independently admitted recipe may bridge fingerprint formats. It does not
 * waive the actual observation equality enforced by the recipe and importer. */
export function salesforceDependencySourceVerified(manifest, handoff) {
  const current = manifest?.candidate?.salesforceSourceSha256, original = handoff?.relevantInputs?.salesforceSourceSha256;
  if (!hash(current) || !hash(original)) return false;
  const mapping = handoff.sourceMapping;
  if (!mapping) return current === original;
  return Object.keys(mapping).length === 3 && mapping.candidateSalesforceSourceSha256 === current
    && mapping.originalSalesforceSourceSha256 === original && hash(handoff.measurementRecipeSha256)
    && mapping.measurementRecipeSha256 === handoff.measurementRecipeSha256;
}

/** Hash reviewed relevant paths without importing or executing candidate files. */
export function measureDependencyFiles({ directory, paths }) {
  required(Array.isArray(paths) && paths.length > 0 && paths.length <= 4096 && new Set(paths).size === paths.length);
  const root = resolve(directory), rows = [];
  for (const path of [...paths].sort()) {
    required(typeof path === 'string' && !path.startsWith('/') && !path.includes('\\') && !path.split('/').some(p => !p || p === '.' || p === '..'));
    let cursor = root;
    for (const part of path.split('/')) { cursor = resolve(cursor, part); required(cursor.startsWith(`${root}${sep}`) && !lstatSync(cursor).isSymbolicLink()); }
    required(lstatSync(cursor).isFile());
    rows.push({ path, sha256: dependencyHash(readFileSync(cursor)) });
  }
  return { sha256: dependencyHash(rows), rows };
}

/** Legacy evidence is data, never authorization. The trusted caller verifies the
 * migration review/coordinator artifact independently; paths inside JSON are ignored.
 */
export async function importAcceptedNomB({ manifest, handoff, verifyHandoff, readArtifact, measureInputs, now = Date.now } = {}) {
  if (!handoff || typeof verifyHandoff !== 'function' || typeof readArtifact !== 'function' || typeof measureInputs !== 'function')
    return waiting('nom_b', ['reviewed_legacy_nom_b_import', 'immutable_original_artifacts', 'current_readonly_dependency_fingerprints']);
  try {
    required(manifest?.candidate?.sha && hash(manifest.candidate.salesforceSourceSha256));
    const admitted = await verifyHandoff({ handoff, manifest, handoffSha256: dependencyHash(handoff) });
    required(admitted?.verified === true && admitted.manifestHash === dependencyHash(manifest)
      && admitted.handoffSha256 === dependencyHash(handoff) && admitted.financialAuthority === false);
    required(handoff.kind === 'fcos_reviewed_nom_b_legacy_import' && handoff.manifestHash === dependencyHash(manifest)
      && handoff.candidateSha === manifest.candidate.sha && handoff.originalCandidateSha === legacyCandidateSha && fingerprintKeys.every(k => hash(handoff.relevantInputs?.[k]))
      && Object.keys(handoff.relevantInputs).length === fingerprintKeys.length
      && salesforceDependencySourceVerified(manifest, handoff));
    const cache = new Map(); let total = 0;
    const load = async (reference, json = true) => {
      const sha256 = typeof reference === 'string' ? reference : reference?.sha256;
      required(hash(sha256));
      if (!cache.has(sha256)) {
        required(cache.size < 128);
        const bytes = Buffer.from(await readArtifact({ sha256 })); total += bytes.length;
        required(bytes.length > 0 && bytes.length <= 8 * 1024 * 1024 && total <= 32 * 1024 * 1024 && dependencyHash(bytes) === sha256);
        cache.set(sha256, bytes);
      }
      return json ? JSON.parse(cache.get(sha256).toString('utf8')) : cache.get(sha256);
    };
    const a = handoff.artifacts;
    const [acceptance, reuse, live, desktop, scope, admission, dependencies, cleanup] = await Promise.all(
      ['acceptance','reuseDecision','liveEvidence','desktopEvidence','scope','admission','dependencies','cleanup'].map(k => load(a?.[k])));
    required(acceptance.kind === 'root_actual_exact04ee_disposable_nom_b_acceptance' && acceptance.accepted === true
      && acceptance.candidateSha === handoff.originalCandidateSha && acceptance.candidateSourceSha256 === handoff.relevantInputs.sourceSha256
      && acceptance.harnessSha256 === handoff.relevantInputs.harnessSha256
      && ['singleProviderPost','durableLedgerCompleted','exactReplayNoExtraPost','freshMissingListAbsent','buyerReceivedGreen','buyerSentAndPdfRemainRed',
        'allOtherReadFixtureFieldsUnchanged','documentLinksOnlyOwnedBuyerAndAuthenticatedCreator','retainedAccountPortActive','localSyntheticDeveeSeamOnly'].every(k => acceptance[k] === true)
      && acceptance.financialChildCategoriesVerifiedZero === 9 && acceptance.productionChanged === false
      && acceptance.normalRoleSessionProved === false && acceptance.deployedFifteenModulePreviewAttestation === false);
    required(reuse.kind === 'root_accepted_nom_b_relevant_change_reuse_decision' && reuse.accepted === true
      && reuse.passingProof?.sha256 === a.acceptance && reuse.cleanupClosure?.sha256 === a.cleanup
      && reuse.candidateSha === handoff.originalCandidateSha && reuse.candidateSourceSha256 === live.sourceSha256
      && reuse.reuseForUnrelatedWorkflowOrDocumentationChanges === true
      && reuse.rerunAffectedBehaviorForRelevantSourceDependencyRuntimeConfigEnvironmentChangeOrFailure === true
      && reuse.freshBoundaryReadsRemainRequiredForNewWrites === true && reuse.productionAuthorizedByThisDecision === false);
    const devee = fcosSalesforceEnvironment('devee');
    required(live.target?.orgId === devee.orgId && live.target.username === devee.username && live.target.isSandbox === true
      && live.candidateSha === handoff.originalCandidateSha && live.sourceSha256 === handoff.relevantInputs.sourceSha256
      && live.harnessSha256 === handoff.relevantInputs.harnessSha256 && live.operationId === acceptance.operationId
      && live.coreVerified === true && live.exactReplayVerified === true && live.freshListAbsent === true && live.postsTotal === 1
      && live.result?.verified === true && live.result.receivedStatus === '🟢' && live.result.stemId === scope.stemId
      && live.result.nominationId === scope.nominationId && live.fileSha256 === scope.fileSha256 && live.fileSize === scope.fileSize
      && live.result.contentDocumentId === acceptance.ownedContentDocumentId && live.result.contentVersionId === acceptance.ownedContentVersionId
      && instant(live.startedAt) && instant(live.completedAt) && Date.parse(live.startedAt) <= Date.parse(live.completedAt) && Date.parse(live.completedAt) <= now());
    required(desktop.desktopVerified === true && desktop.coreVerified === true && desktop.exactReplayVerified === true
      && desktop.candidateSha === live.candidateSha && desktop.sourceSha256 === live.sourceSha256 && desktop.harnessSha256 === live.harnessSha256
      && desktop.operationId === live.operationId && desktop.completedAt === live.completedAt && desktop.postsTotal === 1
      && desktop.scopeFingerprint === live.scopeFingerprint && canonical(desktop.result) === canonical(live.result)
      && Array.isArray(desktop.forbiddenRequests) && desktop.forbiddenRequests.length === 0 && Array.isArray(desktop.pageErrors) && desktop.pageErrors.length === 0);
    required(scope.syntheticFixture === true && scope.candidateSha === handoff.originalCandidateSha && scope.orgId === devee.orgId && scope.username === devee.username
      && acceptance.scope?.sha256 === a.scope && acceptance.admission?.sha256 === a.admission
      && admission.kind === 'root_admitted_exact04ee_nom_b_devee_filing' && admission.candidateSha === live.candidateSha
      && admission.sourceSha256 === live.sourceSha256 && admission.harnessSha256 === live.harnessSha256
      && admission.scopeSha256 === live.scopeFingerprint && admission.dependenciesEvidence?.sha256 === a.dependencies
      && dependencies.kind === 'actual_devee_nom_b_schema_automation_admission' && dependencies.orgId === devee.orgId
      && dependencies.username === devee.username && dependencies.sourceSha256 === live.sourceSha256
      && dependencies.fieldsAndPermissionsVerified === true && dependencies.automationReviewed === true);
    required(cleanup.kind === 'root_actual_owned_devee_document_and_fixture_cleanup_acceptance' && cleanup.accepted === true
      && ['ownedDocumentAndVersionDeleted','allThreeOwnedFixtureRecordsDeleted','activeDocumentLinksZero','retainedAccountAndPortExactlyPreserved','singleAllOrNoneCompositeOnly'].every(k => cleanup[k] === true)
      && cleanup.financialActions === false && cleanup.productionChanged === false);
    required(Array.isArray(acceptance.actualReadbacks) && acceptance.actualReadbacks.length >= 9 && Array.isArray(acceptance.actualTest)
      && acceptance.actualTest.some(r => r.sha256 === a.liveEvidence) && acceptance.actualTest.some(r => r.sha256 === a.desktopEvidence)
      && Array.isArray(cleanup.actualReadbacks) && cleanup.actualReadbacks.length >= 5);
    await Promise.all([...acceptance.actualReadbacks, ...acceptance.actualTest, ...cleanup.actualReadbacks].map(r => load(r, false)));
    const current = await measureInputs({ manifest, handoff });
    required(current?.readOnly === true && fresh(current.capturedAt, now()) && canonical(current.inputs) === canonical(handoff.relevantInputs));
    return { schemaVersion: 2, kind: 'fcos_hosted_dependency_raw', checkId: 'nom_b', status: 'passed', evidenceKind: 'deterministic',
      manifestHash: dependencyHash(manifest), candidateSha: manifest.candidate.sha, controllerSha: manifest.controller.sha,
      inputsSha256: dependencyHash(current.inputs), capturedAt: live.completedAt,
      result: { actualExecution: true, coverage: 'disposable_devee_nom_b_synthetic', targets: manifest.targets,
        salesforceSourceSha256: manifest.candidate.salesforceSourceSha256, originalSalesforceSourceSha256: current.inputs.salesforceSourceSha256,
        ...(handoff.sourceMapping ? { sourceMappingSha256: dependencyHash(handoff.sourceMapping) } : {}), originalArtifactSha256: a.liveEvidence,
        originalAcceptanceSha256: a.acceptance, migrationHandoffSha256: dependencyHash(handoff),
        originalCapturedAt: live.completedAt, dependenciesObservedAt: current.capturedAt, exactReplayNoExtraPost: true,
        financialChildCategoriesVerifiedZero: 9, fixtureCleaned: true, deployedPreviewProved: false, financialAuthority: false } };
  } catch { const error = new Error('NOM_B_DEPENDENCY_REVALIDATION_REQUIRED'); error.code = error.message; throw error; }
}

const identifier = value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,62}$/.test(value);
/** Reads full keyed rows. No financial row values, credentials or membership IDs
 * leave this collector; baseline equality is useful only for reviewed membership.
 */
export async function collectFinancialPreservation({ manifest, membership, verifyMembership, env = process.env, Client = pg.Client, now = Date.now } = {}) {
  if (!membership || typeof verifyMembership !== 'function' || !env.FCOS_HOSTED_PRESERVATION_DATABASE_URL)
    return waiting('preservation', ['reviewed_exact_preservation_membership_and_baseline', 'readonly_fcos_release_observer_database_connection']);
  let client;
  try {
    const project = fcosConnectionIdentifier('supabase', 'Project ref');
    const admitted = await verifyMembership({ membership, manifest, membershipSha256: dependencyHash(membership) });
    required(admitted?.verified === true && admitted.manifestHash === dependencyHash(manifest)
      && admitted.membershipSha256 === dependencyHash(membership) && admitted.financialAuthority === false);
    required(manifest.targets.supabaseProject === project && membership.kind === 'fcos_release_preservation_membership'
      && membership.schemaVersion === 1 && membership.project === project && membership.manifestHash === dependencyHash(manifest)
      && Array.isArray(membership.tables) && membership.tables.length > 0 && membership.tables.length <= 64);
    const seen = new Set();
    for (const table of membership.tables) {
      required(identifier(table.table) && identifier(table.keyColumn) && !seen.has(table.table) && hash(table.expectedRowsSha256)
        && Array.isArray(table.keys) && table.keys.length > 0 && table.keys.length <= 10000
        && new Set(table.keys).size === table.keys.length && table.keys.every(k => typeof k === 'string' && k.length > 0 && k.length <= 200));
      seen.add(table.table);
    }
    const url = new URL(env.FCOS_HOSTED_PRESERVATION_DATABASE_URL);
    required(url.protocol === 'postgresql:' && url.hostname === `db.${project}.supabase.co` && url.pathname === '/postgres'
      && url.username === 'fcos_release_observer' && url.password && url.searchParams.get('sslmode') === 'verify-full' && !url.hash);
    client = new Client({ connectionString: env.FCOS_HOSTED_PRESERVATION_DATABASE_URL, connectionTimeoutMillis: 10000, statement_timeout: 15000, application_name: 'fcos-hosted-preservation-read' });
    await client.connect();
    const { rows: [identity] } = await client.query(`select current_user as role,current_database() as database,r.rolsuper,r.rolcreaterole,r.rolcreatedb,r.rolbypassrls,
      exists(select 1 from pg_auth_members where member=r.oid) as memberships,
      exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema') and c.relkind in ('r','p')
        and (has_table_privilege(c.oid,'INSERT') or has_table_privilege(c.oid,'UPDATE') or has_table_privilege(c.oid,'DELETE') or has_table_privilege(c.oid,'TRUNCATE'))) as table_writes,
      exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname not in ('pg_catalog','information_schema') and p.prosecdef
        and has_schema_privilege(r.oid,n.oid,'USAGE') and has_function_privilege(r.oid,p.oid,'EXECUTE')) as definer_access
      from pg_roles r where r.rolname=current_user`);
    required(identity?.role === 'fcos_release_observer' && identity.database === 'postgres'
      && ['rolsuper','rolcreaterole','rolcreatedb','rolbypassrls','memberships','table_writes','definer_access'].every(k => identity[k] === false));
    await client.query('begin isolation level repeatable read read only');
    const results = [];
    for (const table of membership.tables) {
      const { rows } = await client.query(`select to_jsonb(t) as row from public."${table.table}" t where "${table.keyColumn}"::text = any($1::text[]) order by "${table.keyColumn}"::text`, [[...table.keys].sort()]);
      required(rows.length === table.keys.length && canonical(rows.map(r => String(r.row?.[table.keyColumn])).sort()) === canonical([...table.keys].sort()));
      const rowsSha256 = dependencyHash(rows.map(r => r.row));
      required(rowsSha256 === table.expectedRowsSha256);
      results.push({ table: table.table, count: rows.length, rowsSha256 });
    }
    await client.query('commit');
    return { schemaVersion: 2, kind: 'fcos_hosted_dependency_raw', checkId: 'preservation', status: 'passed', evidenceKind: 'volatile', maxAgeSeconds: 1800,
      manifestHash: dependencyHash(manifest), candidateSha: manifest.candidate.sha, controllerSha: manifest.controller.sha,
      inputsSha256: dependencyHash({ membershipSha256: dependencyHash(membership), project }), capturedAt: new Date(now()).toISOString(),
      result: { actualExecution: true, readOnly: true, fullKeyedRowsUnchanged: true, membershipSha256: dependencyHash(membership),
        snapshotSha256: dependencyHash(results), tableCount: results.length, rowCount: results.reduce((n, r) => n + r.count, 0), financialAuthority: false, targets: manifest.targets } };
  } catch { if (client) await client.query('rollback').catch(() => {}); const error = new Error('PRESERVATION_REVALIDATION_REQUIRED'); error.code = error.message; throw error; }
  finally { if (client) await client.end().catch(() => {}); }
}
