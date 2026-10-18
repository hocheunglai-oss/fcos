import { createSalesforceRecipeReader, salesforceRecipePath, validateSalesforceReadBinding } from './salesforce-read-auth.mjs';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fcosSalesforceEnvironment } from '../../../config/fcosConnections.js';
import { dependencyHash, importAcceptedNomB, loadNomBLegacyAssumptions, measureDependencyFiles, salesforceDependencySourceVerified } from './dependencies.mjs';
import {openPreservationMembership} from './preservation-preflight.mjs';

const keys = ['sourceSha256','harnessSha256','salesforceSourceSha256','fixtureSha256','environmentSha256'];
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object'
  ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}` : JSON.stringify(value);
const need = (value, code = 'DEPENDENCY_SETUP_INVALID') => { if (!value) { const error = new Error(code); error.code = code; throw error; } };
const hash = value => /^[a-f0-9]{64}$/.test(value || '');
const exact = (value, names) => value && typeof value === 'object' && canonical(Object.keys(value).sort()) === canonical([...names].sort());
const fields = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(value);
const within = (time, start, end) => Number.isFinite(Date.parse(time)) && Date.parse(time) >= Date.parse(start) && Date.parse(time) <= Date.parse(end) + 30000;
// Independently accepted retained history; a new setup file cannot authorize its own proof.
export const NOM_B_LEGACY_HISTORY = Object.freeze({
  acceptance: '17cdc815469f1c3a759f0d03bc1630b3e79b3484d0e9c9c534bcdd1aa45c5583',
  reuseDecision: '23df799f79ac849bbeeefd9b6becb3c0cca9de610eea99fc88310445131dc70d',
  cleanup: 'd34a30eaf169295d83f4b4441fa2015511d1c49b2ffe6b98285b8a62a617bb9b',
  liveEvidence: '384b0b6f8a756e7b5c99385f4e9476a333798afe827adf2aea7fa7359120c42a',
  desktopEvidence: 'df3ed460e0aa134c46f42b04d6496104dcaa43c07d80477b0bd86e6e11f29aa8',
  scope: 'f498d06ae769d8f6eef52d4610e02cc710556c53fda67f1dff21c20ae436cbb2',
  admission: '0a70da816e032ae81d5ab9ebebf80ab16122f160556e45e5c7b8150690e73139',
  dependencies: '62f01830c7c9ce1e7ba4d0b9842499bf8901a8b383bc7bcbe13549c335ff7b0c',
});

function pinnedJson(file, pin, readFile, onBytes) {
  need(file && hash(pin)); let bytes; try { bytes = Buffer.from(readFile(file)); } catch (error) { need(error.code !== 'ENOENT', 'DEPENDENCY_SETUP_PENDING'); throw error; }
  need(bytes.length > 0 && bytes.length <= 32 * 1024 * 1024 && dependencyHash(bytes) === pin);
  onBytes?.(bytes);
  return JSON.parse(bytes.toString('utf8'));
}
/** Setup files omit manifestHash to avoid a circular file/hash/manifest binding.
 * The admitted manifest pins their exact bytes; binding is attached in memory.
 */
export function loadDependencySetup({ manifest, env = process.env, readFile = readFileSync,privateMembership=true }) {
  env = { ...env };
  if (env.FCOS_HOSTED_DEPENDENCY_SETUP_DIRECTORY) {
    const directory = resolve(env.FCOS_HOSTED_DEPENDENCY_SETUP_DIRECTORY);
    for (const [key, name] of Object.entries({ FCOS_HOSTED_NOM_B_HANDOFF_FILE: 'handoff.json', FCOS_HOSTED_NOM_B_ARTIFACTS_FILE: 'artifacts.json', FCOS_HOSTED_NOM_B_RECIPE_FILE: 'recipe.json', FCOS_HOSTED_PRESERVATION_MEMBERSHIP_FILE: 'membership.encrypted.json' })) env[key] ||= join(directory, name);
  }
  const definition = manifest.dependencies;
  if (!definition) return { nomBMissing: ['manifest_dependencies_nom_b_setup'], preservationMissing: ['manifest_dependencies_preservation_setup'] };
  need(definition.schemaVersion === 1);
  const setup = {}, manifestHash = dependencyHash(manifest), nom = definition.nom_b, preservation = definition.preservation;
  if (!nom || !env.FCOS_HOSTED_NOM_B_HANDOFF_FILE || !env.FCOS_HOSTED_NOM_B_ARTIFACTS_FILE || !env.FCOS_HOSTED_NOM_B_RECIPE_FILE)
    setup.nomBMissing = ['manifest_pinned_nom_b_handoff_artifacts_and_measurement_recipe'];
  else {
    const original = pinnedJson(env.FCOS_HOSTED_NOM_B_HANDOFF_FILE, nom.handoffSha256, readFile);
    const bundle = pinnedJson(env.FCOS_HOSTED_NOM_B_ARTIFACTS_FILE, nom.artifactsSha256, readFile);
    let recipeBytes;
    const recipe = pinnedJson(env.FCOS_HOSTED_NOM_B_RECIPE_FILE, nom.recipeSha256, readFile, bytes => { recipeBytes = bytes; });
    need(!Object.hasOwn(original, 'manifestHash') && original.measurementRecipeSha256 === nom.recipeSha256
      && Object.entries(NOM_B_LEGACY_HISTORY).every(([key, sha]) => original.artifacts?.[key] === sha)
      && recipe.originalAcceptanceSha256 === NOM_B_LEGACY_HISTORY.acceptance
      && bundle.schemaVersion === 1 && bundle.kind === 'fcos_immutable_dependency_artifacts'
      && bundle.artifacts && typeof bundle.artifacts === 'object' && Object.keys(bundle.artifacts).length <= 128);
    const handoff = { ...original, manifestHash };
    setup.nomB = { handoff, recipe, recipeBytes, recipeSha256: nom.recipeSha256, setupPins: { ...nom },
      verifyHandoff: async ({ handoff: actual, handoffSha256 }) => {
        need(canonical(actual) === canonical(handoff) && handoffSha256 === dependencyHash(handoff));
        return { verified: true, handoffSha256, manifestHash, financialAuthority: false };
      },
      readArtifact: async ({ sha256 }) => {
        need(hash(sha256) && typeof bundle.artifacts[sha256] === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(bundle.artifacts[sha256]));
        const bytes = Buffer.from(bundle.artifacts[sha256], 'base64'); need(bytes.toString('base64') === bundle.artifacts[sha256] && dependencyHash(bytes) === sha256); return bytes;
      } };
  }
  if (!preservation || !env.FCOS_HOSTED_PRESERVATION_MEMBERSHIP_FILE) setup.preservationMissing = ['manifest_pinned_preservation_membership_and_baseline'];
  else {
    need(hash(preservation.membershipSha256)&&hash(preservation.envelopeSha256)&&hash(preservation.snapshotSha256)
      &&Number.isSafeInteger(preservation.tableCount)&&preservation.tableCount>0&&preservation.tableCount<=64&&Number.isSafeInteger(preservation.rowCount)&&preservation.rowCount>0);
    const publicBinding=dependencyHash({kind:'fcos_preservation_membership_file_binding_v1',manifestHash,membershipFileSha256:preservation.membershipSha256});
    if(!privateMembership){setup.preservation={publicBinding,setupPins:{...preservation}};return setup;}
    let sealed;try{sealed=readFile(env.FCOS_HOSTED_PRESERVATION_MEMBERSHIP_FILE);}catch(error){need(error.code!=='ENOENT','DEPENDENCY_SETUP_PENDING');throw error;}
    const plain=openPreservationMembership(sealed,{candidateSha:manifest.candidate.sha,project:manifest.targets.supabaseProject,membershipSha256:preservation.membershipSha256,
      envelopeSha256:preservation.envelopeSha256,connection:env.FCOS_HOSTED_PRESERVATION_DATABASE_URL});
    let original;try{original=JSON.parse(plain.toString('utf8'));}finally{plain.fill(0);}
    need(!Object.hasOwn(original, 'manifestHash'));
    need(original.tables.length===preservation.tableCount&&original.tables.reduce((n,t)=>n+t.keys.length,0)===preservation.rowCount
      &&dependencyHash(original.tables.map(t=>({table:t.table,count:t.keys.length,rowsSha256:t.expectedRowsSha256})))===preservation.snapshotSha256);
    const membership = { ...original, manifestHash };
    setup.preservation = { membership, setupPins: { ...preservation }, verifyMembership: async ({ membership: actual, membershipSha256 }) => {
      need(canonical(actual) === canonical(membership) && membershipSha256 === dependencyHash(membership));
      return { verified: true, membershipSha256, manifestHash, financialAuthority: false,membershipFileSha256:preservation.membershipSha256 };
    } };
  }
  return setup;
}

function validateRecipe(recipe, handoff) {
  const devee = fcosSalesforceEnvironment('devee');
  need(exact(recipe, ['schemaVersion','kind','originalAcceptanceSha256','origin','orgId','username','isSandbox','apiVersion','userId','profileId','observations']) && recipe?.schemaVersion === 1 && recipe.kind === 'fcos_nom_b_readonly_measurement_recipe'
    && recipe.originalAcceptanceSha256 === NOM_B_LEGACY_HISTORY.acceptance && recipe.origin === devee.instanceUrl
    && recipe.orgId === devee.orgId && recipe.username === devee.username && recipe.isSandbox === true
    && /^v[0-9]{2}\.0$/.test(recipe.apiVersion) && /^[A-Za-z0-9]{18}$/.test(recipe.userId || '') && /^[A-Za-z0-9]{18}$/.test(recipe.profileId || '')
    && Array.isArray(recipe.observations) && recipe.observations.length === keys.length
    && canonical(recipe.observations.map(row => row.input).sort()) === canonical([...keys].sort()));
  let filesCount = 0, readCount = 0;
  for (const observation of recipe.observations) {
    need(exact(observation, ['input','expectedSha256','originalInputSha256','files','reads']) && hash(observation.expectedSha256) && observation.originalInputSha256 === handoff.relevantInputs?.[observation.input]
      && Array.isArray(observation.files) && Array.isArray(observation.reads) && observation.files.length + observation.reads.length > 0);
    filesCount += observation.files.length; readCount += observation.reads.length;
    if (['sourceSha256','harnessSha256'].includes(observation.input)) need(observation.files.length > 0);
    if (['salesforceSourceSha256','environmentSha256'].includes(observation.input)) need(observation.reads.length > 0);
    for (const file of observation.files) need(exact(file, ['root','path','sha256']) && ['candidate','controller','setup'].includes(file.root) && typeof file.path === 'string' && hash(file.sha256));
    for (const read of observation.reads) {
      need(['query','describe'].includes(read.kind) && fields(read.object) && typeof read.tooling === 'boolean');
      if (read.kind === 'query') need(exact(read, read.where ? ['kind','object','tooling','fields','limit','where'] : ['kind','object','tooling','fields','limit']) && Array.isArray(read.fields) && read.fields.length > 0 && read.fields.length <= 40
        && new Set(read.fields).size === read.fields.length && read.fields.every(fields) && read.fields.includes('Id')
        && Number.isSafeInteger(read.limit) && read.limit >= 1 && read.limit <= 2000
        && (!read.where || exact(read.where, ['field','values']) && fields(read.where.field) && Array.isArray(read.where.values) && read.where.values.length > 0 && read.where.values.length <= 100
          && read.where.values.every(value => typeof value === 'string' && /^[A-Za-z0-9 _./:@-]{1,200}$/.test(value))));
      else need(exact(read, ['kind','object','tooling']) && read.tooling === false && read.fields === undefined && read.where === undefined);
    }
  }
  need(filesCount <= 512 && readCount <= 16);
  return devee;
}
// The complete original coverage is mandatory even when a reviewed recipe/hash is supplied.
function legacyReadExpectations(legacy, recipe) {
  const query = (object, tooling, fields, field, values, check) => ({ object, kind: 'query', tooling, fields,
    ...(field ? { where: { field, values } } : {}), check });
  const select = (rows, fields) => rows.map(row => Object.fromEntries(fields.map(key => [key, row[key]]))).sort((a, b) => String(a.Id).localeCompare(String(b.Id)));
  const equalRows = (value, expected, fields) => need(canonical(select(value.records, fields)) === canonical(select(expected, fields)));
  const sf = [];
  for (const object of ['ApexClass','ApexTrigger']) {
    const trigger = object === 'ApexTrigger', fields = ['Id','Name',...(trigger ? ['TableEnumOrId','Status'] : []),'Body','LastModifiedDate'];
    sf.push(query(object, true, fields, trigger ? 'TableEnumOrId' : 'Name', legacy.indexes[object].scope, value => {
      if (trigger) need(value.records.every(row => ['Active','Inactive'].includes(row.Status) && legacy.indexes.ApexTrigger.scope.includes(row.TableEnumOrId)));
      const rows = trigger ? value.records.filter(row => row.Status === 'Active') : value.records;
      need(rows.every(row => typeof row.Body === 'string'));
      equalRows({ records: rows.map(({ Body, ...row }) => ({ ...row, bodySha256: dependencyHash(Body) })) }, legacy.apex[object],
        ['Id','Name',...(trigger ? ['TableEnumOrId','Status'] : []),'bodySha256','LastModifiedDate']);
    }));
  }
  for (const [object, fields, field, active] of [
    ['ValidationRule',['Id','ValidationName','Active','EntityDefinitionId','LastModifiedDate'],'EntityDefinitionId','Active'],
    ['WorkflowRule',['Id','Name','TableEnumOrId','LastModifiedDate'],'TableEnumOrId',null],
    ['FlowDefinitionView',['Id','ApiName','IsActive','ActiveVersionId','TriggerType','TriggerObjectOrEventId','RecordTriggerType'],'TriggerObjectOrEventId','IsActive'],
  ]) sf.push(query(object, object !== 'FlowDefinitionView', fields, field, legacy.indexes[object].scope, value => {
    if (active) need(value.records.every(row => typeof row[active] === 'boolean'));
    const records = active ? value.records.filter(row => row[active] === true) : value.records;
    equalRows({ records }, legacy.indexes[object].rows, fields.filter(key => key !== 'IsActive'));
  }));
  for (const object of Object.keys(legacy.schema)) sf.push({ object, kind: 'describe', tooling: false,
    check: value => need(canonical(value) === canonical(legacy.schema[object])) });
  const absent = value => need(value.records.length === 0);
  return { salesforceSourceSha256: sf,
    fixtureSha256: [...Object.entries(legacy.fixtureIds).map(([object, id]) => query(object, false, ['Id'], 'Id', [id], absent)),
      query('ContentDocumentLink', false, ['Id','ContentDocumentId','LinkedEntityId'], 'ContentDocumentId', [legacy.fixtureIds.ContentDocument], absent)],
    environmentSha256: [query('User', false, ['Id','Username','IsActive','ProfileId'], 'Id', [legacy.environment.userId], value =>
      equalRows(value, [{ Id: legacy.environment.userId, Username: legacy.environment.username, IsActive: true, ProfileId: recipe.profileId }], ['Id','Username','IsActive','ProfileId'])),
      query('Xero_Contact_Sync_Setting__c', false, ['Id','SetupOwnerId','Enabled__c'], null, null, absent)] };
}
function validateLegacyRecipe(recipe, handoff, legacy) {
  need(canonical(legacy.inputs) === canonical(handoff.relevantInputs)
    && ['origin','orgId','username','userId','isSandbox','apiVersion'].every(key => recipe[key] === legacy.environment[key === 'origin' ? 'instanceUrl' : key]));
  const expected = legacyReadExpectations(legacy, recipe), checks = new Map();
  for (const observation of recipe.observations) {
    const reads = expected[observation.input] || []; need(observation.reads.length === reads.length);
    for (const specification of reads) {
      const matches = observation.reads.filter(read => read.object === specification.object && read.kind === specification.kind
        && read.tooling === specification.tooling && (read.kind === 'describe' || canonical([...read.fields].sort()) === canonical([...specification.fields].sort())
          && canonical(read.where ? { field: read.where.field, values: [...read.where.values].sort() } : null)
            === canonical(specification.where ? { field: specification.where.field, values: [...specification.where.values].sort() } : null)));
      need(matches.length === 1); checks.set(matches[0], specification.check);
    }
  }
  return checks;
}
/** Concrete GET-only collector. The reviewed recipe maps old fingerprint formats
 * to current comparable observations; arbitrary URLs and executable SOQL are absent.
 */
export async function measureHostedNomBInputs({ manifest, handoff, readArtifact, recipe, recipeBytes, recipeSha256, candidateDirectory, controllerDirectory, setupDirectory,
  env = process.env, fetchImpl = globalThis.fetch, now = Date.now }) {
  const renewable = manifest.verification?.salesforceReadCredential;
  const legacyBearer = !renewable && manifest.stage !== 'qualification' && env.GITHUB_ACTIONS !== 'true' && env.FCOS_HOSTED_SALESFORCE_LEGACY_BEARER_ALLOWED === 'true';
  if (renewable && (renewable.schemaVersion !== 3 || renewable.kind !== 'fcos_salesforce_client_credentials_recipe_reader' || renewable.providerPermissionMode !== 'provider_business_data_read_only')) return { status: 'waiting_dependency', missing: ['admitted_business_data_read_only_devee_client_credentials_reader_setup'] };
  if (!renewable && !legacyBearer) return { status: 'waiting_dependency', missing: ['admitted_dedicated_devee_client_credentials_reader_setup'] };
  if (renewable && !env.FCOS_HOSTED_SALESFORCE_CLIENT_SECRET || legacyBearer && !env.FCOS_HOSTED_SALESFORCE_READ_TOKEN)
    return { status: 'waiting_dependency', missing: ['dedicated_devee_client_secret_input'] };
  try {
    const devee = validateRecipe(recipe, handoff);
    const legacy = await loadNomBLegacyAssumptions({ handoff, readArtifact }), checks = validateLegacyRecipe(recipe, handoff, legacy);
    need(hash(recipeSha256) && handoff.measurementRecipeSha256 === recipeSha256 && salesforceDependencySourceVerified(manifest, handoff));
    const reader = renewable ? createSalesforceRecipeReader({ manifest, recipe, recipeBytes, recipeSha256, env, fetchImpl, now }) : null;
    const get = async path => {
      need(path.startsWith('/services/')); const url = `${devee.instanceUrl}${path}`;
      const response = await fetchImpl(url, { method: 'GET', redirect: 'error', headers: { authorization: `Bearer ${env.FCOS_HOSTED_SALESFORCE_READ_TOKEN}`, accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      need(response.ok && !response.redirected && (!response.url || response.url === url), 'NOM_B_READONLY_OBSERVATION_FAILED');
      const length = Number(response.headers?.get?.('content-length') || 0); need(length <= 4 * 1024 * 1024);
      let bytes;
      if (response.body?.getReader) {
        const reader = response.body.getReader(), chunks = []; let size = 0;
        try { while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length;
          if (size > 4 * 1024 * 1024) { await reader.cancel(); need(false); } chunks.push(Buffer.from(chunk.value)); } }
        finally { reader.releaseLock(); }
        bytes = Buffer.concat(chunks);
      } else bytes = Buffer.from(await response.arrayBuffer());
      need(bytes.length <= 4 * 1024 * 1024); return JSON.parse(bytes.toString());
    };
    if (reader) await reader.admit();
    else {
      const info = await get('/services/oauth2/userinfo');
      need([devee.orgId, devee.orgId.slice(0, 15)].includes(info.organization_id) && info.user_id === recipe.userId
        && (info.preferred_username || info.username) === devee.username);
      const org = await get(`/services/data/${recipe.apiVersion}/query?q=${encodeURIComponent('SELECT Id,IsSandbox FROM Organization LIMIT 2')}`);
      need(org.done === true && org.totalSize === 1 && org.records?.length === 1 && org.records[0].Id === devee.orgId && org.records[0].IsSandbox === true);
      const user = await get(`/services/data/${recipe.apiVersion}/sobjects/User/${recipe.userId}?fields=Id,Username,IsActive,ProfileId`);
      need(user.Id === recipe.userId && user.Username === devee.username && user.IsActive === true && user.ProfileId === recipe.profileId);
    }
    let readIndex = 0;
    const roots = { candidate: candidateDirectory, controller: controllerDirectory, setup: setupDirectory }, observed = [];
    for (const observation of recipe.observations) {
      const files = [];
      for (const file of observation.files) {
        need(roots[file.root]); const measured = measureDependencyFiles({ directory: resolve(roots[file.root]), paths: [file.path] }).rows[0];
        need(measured.sha256 === file.sha256); files.push({ root: file.root, ...measured });
      }
      const reads = [];
      for (const read of observation.reads) {
        const value = reader ? await reader.readRecipe(readIndex++) : await get(salesforceRecipePath(read, recipe.apiVersion));
        if (read.kind === 'query') need(value.done === true && !value.nextRecordsUrl && Array.isArray(value.records)
          && value.records.length < read.limit && value.totalSize === value.records.length);
        checks.get(read)(value);
        reads.push({ recipe: read, sha256: dependencyHash(value) });
      }
      const sha256 = dependencyHash({ files, reads }); need(sha256 === observation.expectedSha256); observed.push({ input: observation.input, sha256 });
    }
    const receipt = { schemaVersion: 1, kind: 'fcos_nom_b_readonly_measurements', recipeSha256, capturedAt: new Date(now()).toISOString(),
      candidateSalesforceSourceSha256: handoff.candidateSalesforceSourceSha256, legacyInputsSha256: dependencyHash(legacy.inputs),
      identitySha256: dependencyHash({ orgId: devee.orgId, username: devee.username, userId: recipe.userId, profileId: recipe.profileId, isSandbox: true }), observations: observed };
    if (reader) receipt.authentication = { kind: renewable.kind, credentialBindingSha256: dependencyHash(renewable), permissionObservation: await reader.admit() };
    return { readOnly: true, capturedAt: receipt.capturedAt, inputs: { ...handoff.relevantInputs }, receipt };
  } catch { const error = new Error('NOM_B_READONLY_REVALIDATION_REQUIRED'); error.code = error.message; throw error; }
}

export function validateNomBMeasurementReceipt({ receipt, recipe, recipeSha256, handoff, manifest, legacy, job }) {
  validateRecipe(recipe, handoff); validateLegacyRecipe(recipe, handoff, legacy);
  if (manifest.verification?.salesforceReadCredential || manifest.stage === 'qualification') {
    const binding = manifest.verification?.salesforceReadCredential, permission = receipt?.authentication?.permissionObservation;
    validateSalesforceReadBinding(binding, { now: Date.parse(receipt?.capturedAt) });
    need(binding && receipt?.authentication?.kind === 'fcos_salesforce_client_credentials_recipe_reader' && receipt.authentication.credentialBindingSha256 === dependencyHash(binding)
      && exact(permission, ['schemaVersion','kind','recipeSha256','observedSha256','capturedAt'])
      && permission.schemaVersion === 1 && permission.kind === 'fcos_salesforce_fresh_business_data_read_only_permission_observation'
      && permission.recipeSha256 === binding.permissionRecipeSha256 && hash(permission.observedSha256)
      && within(permission.capturedAt, job.started_at, job.completed_at) && Date.parse(permission.capturedAt) <= Date.parse(receipt.capturedAt) + 30000);
  }
  need(salesforceDependencySourceVerified(manifest, handoff));
  need(receipt?.schemaVersion === 1 && receipt.kind === 'fcos_nom_b_readonly_measurements' && receipt.recipeSha256 === recipeSha256
    && receipt.candidateSalesforceSourceSha256 === handoff.candidateSalesforceSourceSha256 && receipt.legacyInputsSha256 === dependencyHash(legacy.inputs)
    && within(receipt.capturedAt, job.started_at, job.completed_at) && Array.isArray(receipt.observations)
    && canonical(receipt.observations) === canonical(recipe.observations.map(row => ({ input: row.input, sha256: row.expectedSha256 })))
    && receipt.identitySha256 === dependencyHash({ orgId: recipe.orgId, username: recipe.username, userId: recipe.userId, profileId: recipe.profileId, isSandbox: true }));
  return { readOnly: true, capturedAt: receipt.capturedAt, inputs: { ...handoff.relevantInputs } };
}

export async function publishDependencies({ github, coordinator, manifest, runId, phase, env = process.env, readFile = readFileSync,
  collectArtifact, publish, now = Date.now } = {}) {
  need(['before','after'].includes(phase));
  const { collectWorkflowArtifact } = collectArtifact ? {} : await import('./artifacts.mjs');
  const { publishChecks } = publish ? {} : await import('./publisher.mjs');
  const jobName = `release / dependencies / ${phase}`;
  const collected = await (collectArtifact || collectWorkflowArtifact)({ github, repository: manifest.targets.repository, runId,
    artifactName: `fcos-${manifest.releaseId}-dependencies-${phase}`, jobName, fileName: 'dependencies.json' });
  if (collected.status === 'waiting_dependency') return collected;
  let setup;
  try { setup = loadDependencySetup({ manifest, env, readFile,privateMembership:false }); }
  catch (error) { if (error.code !== 'DEPENDENCY_SETUP_PENDING') throw error; return { status: 'waiting_dependency', missing: ['manifest_pinned_dependency_setup_files_pending'] }; }
  let historical;
  const validateReport = async report => {
    need(report?.schemaVersion === 2 && report.kind === 'fcos_hosted_dependencies_raw' && report.manifestHash === dependencyHash(manifest)
      && report.candidateSha === manifest.candidate.sha && report.controllerSha === manifest.controller.sha && report.phase === phase
      && ['passed','waiting_dependency','failed'].includes(report.status) && within(report.completedAt, collected.job.started_at, collected.job.completed_at)
      && Array.isArray(report.checks) && report.checks.length === 2 && canonical(report.checks.map(row => row.checkId).sort()) === canonical(['nom_b','preservation']));
    need(report.status === (report.checks.some(row => row.status === 'failed') ? 'failed' : report.checks.some(row => row.status === 'waiting_dependency') ? 'waiting_dependency' : 'passed'));
    const accepted = [];
    for (const row of report.checks) {
      need(['passed','waiting_dependency','failed'].includes(row.status)); if (row.status !== 'passed') continue;
      need(row.kind === 'fcos_hosted_dependency_raw' && row.manifestHash === report.manifestHash && row.candidateSha === report.candidateSha
        && row.controllerSha === report.controllerSha && hash(row.inputsSha256));
      if (row.checkId === 'nom_b') {
        need(setup.nomB && row.evidenceKind === 'deterministic');
        const legacy = await loadNomBLegacyAssumptions(setup.nomB);
        const current = validateNomBMeasurementReceipt({ receipt: report.nomBMeasurement, ...setup.nomB, manifest, legacy, job: collected.job });
        historical = await importAcceptedNomB({ manifest, ...setup.nomB, measureInputs: async () => current, now });
        need(canonical(row) === canonical(historical));
      } else {
        need(setup.preservation && row.evidenceKind === 'volatile' && row.maxAgeSeconds === 1800 && within(row.capturedAt, collected.job.started_at, collected.job.completed_at)
          && row.result?.actualExecution === true && row.result.readOnly === true && row.result.fullKeyedRowsUnchanged === true && row.result.financialAuthority === false
          && row.result.membershipSha256 === setup.preservation.publicBinding&&row.result.membershipFileSha256===setup.preservation.setupPins.membershipSha256
          && row.inputsSha256 === dependencyHash({ membershipSha256: setup.preservation.publicBinding, project: manifest.targets.supabaseProject })
          && row.result.tableCount === setup.preservation.setupPins.tableCount&&row.result.rowCount === setup.preservation.setupPins.rowCount
          && row.result.snapshotSha256 === setup.preservation.setupPins.snapshotSha256 && canonical(row.result.targets) === canonical(manifest.targets));
      }
      accepted.push({ id: row.checkId, kind: row.evidenceKind, status: 'passed', inputsSha256: row.inputsSha256, completedAt: row.capturedAt,
        ...(row.evidenceKind === 'volatile' ? { maxAgeSeconds: row.maxAgeSeconds } : {}), result: row.result });
    }
    return accepted;
  };
  const proofs = await (publish || publishChecks)({ manifest, ...collected, coordinator, expectedJobName: jobName, allowEmpty: true, validateReport,
    validateHistoricalCheck: async ({ check }) => !!historical && check.id === 'nom_b' && check.kind === 'deterministic'
      && check.completedAt === historical.capturedAt && check.inputsSha256 === historical.inputsSha256 && canonical(check.result) === canonical(historical.result) });
  return { status: collected.report.status, checks: proofs.map(row => row.checkId), missing: collected.report.checks.filter(row => row.status !== 'passed').flatMap(row => row.missing || [row.checkId]) };
}
