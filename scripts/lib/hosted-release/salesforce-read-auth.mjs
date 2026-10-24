import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { fcosSalesforceEnvironment, fcosConnectionIdentifier } from '../../../config/fcosConnections.js';

export const SALESFORCE_READ_ENVIRONMENT = 'fcos-hosted-dependency-verification';
const SALESFORCE_IDENTITY_ORIGIN = 'https://login.salesforce.com';
const SALESFORCE_SANDBOX_IDENTITY_ORIGIN = 'https://test.salesforce.com';
const digest = value => createHash('sha256').update(value).digest('hex');
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object'
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function refuse(code = 'SALESFORCE_READ_AUTHENTICATION_REQUIRED') { const error = new Error(code); error.code = code; error.phase = 'salesforce.read'; throw error; }
const need = (value, code = 'SALESFORCE_READ_CREDENTIAL_BINDING') => { if (!value) refuse(code); };
const credentialFields = ['clientId','externalClientApplicationId','orgId','username','userId','profileId','profileName','userLicenseId','userLicenseName','instanceUrl','isSandbox','apiVersion','authenticationProtocol','scopes','clientConfigurationReadbackSha256','runAsAcceptanceSha256','issuedAt','notAfter','sessionUseSeconds','providerPermissionMode','readOnlyScope','providerWideReadOnly','residualCapabilities','originalFixtureIdentitySha256','effectivePermissionsSha256','permissionRecipeSha256'];
export const SALESFORCE_BUSINESS_READ_ONLY_SCOPE = Object.freeze(['business_records','metadata','administration','executable_grants']);
export const SALESFORCE_READER_RESIDUAL_CAPABILITIES = Object.freeze(['chatter_collaboration','user_profile_self_service']);
const scopesValid = scopes => Array.isArray(scopes) && new Set(scopes).size === scopes.length && scopes.includes('api') && scopes.includes('id') && scopes.every(scope => ['api','id','openid'].includes(scope));
const nonAdministrativeProfile = name => typeof name === 'string' && name.trim() === name && name.length > 0 && name.length <= 200 && !/system\s*admin(?:istrator)?/i.test(name);
export const salesforceFixtureIdentityHash = recipe => digest(canonical({ orgId: recipe.orgId, username: recipe.username, userId: recipe.userId, profileId: recipe.profileId, instanceUrl: recipe.origin, isSandbox: recipe.isSandbox, apiVersion: recipe.apiVersion }));
const sameId = (actual, expected) => actual === expected || actual === expected.slice(0, 15);

/** Public pins only. notAfter/sessionUseSeconds are local use limits, never a
 * claim of provider token expiry. Business-data read-only authority requires the
 * separately accepted effective-permission evidence below; a GET guard is insufficient. */
export function validateSalesforceReadBinding(binding, { now = Date.now() } = {}) {
  const devee = fcosSalesforceEnvironment('devee');
  need(exact(binding, ['schemaVersion','kind',...credentialFields,'originalSetupReceiptSha256','rootAcceptanceSha256'])
    && binding.schemaVersion === 3 && binding.kind === 'fcos_salesforce_client_credentials_recipe_reader'
    && typeof binding.clientId === 'string' && /^[A-Za-z0-9_.-]{20,256}$/.test(binding.clientId)
    && /^0xI[A-Za-z0-9]{15}$/.test(binding.externalClientApplicationId || '')
    && binding.orgId === devee.orgId && binding.username === fcosConnectionIdentifier('salesforce', 'Hosted DEVEE read-only username') && binding.username.toLowerCase() !== devee.username.toLowerCase() && binding.instanceUrl === devee.instanceUrl
    && binding.isSandbox === true && binding.authenticationProtocol === 'client_credentials' && binding.apiVersion === 'v67.0'
    && /^005[A-Za-z0-9]{15}$/.test(binding.userId || '') && /^00e[A-Za-z0-9]{15}$/.test(binding.profileId || '')
    && /^100[A-Za-z0-9]{15}$/.test(binding.userLicenseId || '') && nonAdministrativeProfile(binding.profileName) && scopesValid(binding.scopes) && binding.providerPermissionMode === 'provider_business_data_read_only'
    && binding.userLicenseName === fcosConnectionIdentifier('salesforce', 'Hosted DEVEE read-only licence name')
    && canonical(binding.readOnlyScope) === canonical(SALESFORCE_BUSINESS_READ_ONLY_SCOPE) && binding.providerWideReadOnly === false
    && canonical(binding.residualCapabilities) === canonical(SALESFORCE_READER_RESIDUAL_CAPABILITIES)
    && hash(binding.originalFixtureIdentitySha256) && hash(binding.effectivePermissionsSha256) && hash(binding.permissionRecipeSha256)
    && hash(binding.clientConfigurationReadbackSha256) && hash(binding.runAsAcceptanceSha256) && hash(binding.originalSetupReceiptSha256) && hash(binding.rootAcceptanceSha256)
    && Number.isSafeInteger(binding.issuedAt) && binding.issuedAt > 0 && binding.issuedAt <= now + 30000
    && Number.isSafeInteger(binding.notAfter) && binding.notAfter > binding.issuedAt && binding.notAfter > now
    && Number.isSafeInteger(binding.sessionUseSeconds) && binding.sessionUseSeconds >= 60 && binding.sessionUseSeconds <= 300);
  return binding;
}

/** The admitted setup/source hash authenticates this independently reviewed
 * ORIGINAL fixed Run As client, permission and environment-only storage proof. */
export function validateSalesforceReadAcceptance(binding, setup, options) {
  validateSalesforceReadBinding(binding, options);
  const reference = setup?.salesforceReadCredentialAcceptance;
  need(exact(reference, ['json','sha256']) && typeof reference.json === 'string' && Buffer.byteLength(reference.json) <= 32768
    && reference.sha256 === binding.rootAcceptanceSha256 && digest(reference.json) === reference.sha256, 'SALESFORCE_READ_SETUP_PROOF_REQUIRED');
  let review; try { review = JSON.parse(reference.json); } catch { refuse('SALESFORCE_READ_SETUP_PROOF_REQUIRED'); }
  need(exact(review, ['schemaVersion','kind','accepted','reviewerId','operator','reviewedAt','originalSetupReceiptSha256','clientConfigurationReadbackSha256','userPermissionsReadbackSha256','secretStorageReadbackSha256','environment','environmentOnly','credential','runAsAcceptance','providerReadOnlyAcceptance','permissionIntrospection'])
    && review.schemaVersion === 3 && review.kind === 'fcos_root_accepted_salesforce_client_credentials_setup' && review.accepted === true
    && review.reviewerId === '/root' && review.operator === fcosConnectionIdentifier('github', 'Required account')
    && Number.isFinite(Date.parse(review.reviewedAt)) && Date.parse(review.reviewedAt) >= binding.issuedAt - 30000 && Date.parse(review.reviewedAt) <= (options?.now ?? Date.now()) + 30000
    && review.originalSetupReceiptSha256 === binding.originalSetupReceiptSha256
    && ['clientConfigurationReadbackSha256','userPermissionsReadbackSha256','secretStorageReadbackSha256'].every(key => hash(review[key]))
    && review.clientConfigurationReadbackSha256 === binding.clientConfigurationReadbackSha256
    && review.environment === SALESFORCE_READ_ENVIRONMENT && review.environmentOnly === true
    && exact(review.credential, credentialFields) && canonical(review.credential) === canonical(Object.fromEntries(credentialFields.map(key => [key, binding[key]]))), 'SALESFORCE_READ_SETUP_PROOF_REQUIRED');
  const runAs = review.runAsAcceptance;
  need(exact(runAs, ['schemaVersion','kind','orgId','clientId','externalClientApplicationId','runAsUsername','runAsUserId','capturedAt','clientConfigurationReadbackSha256','serverEnforcedRunAs','clientCredentialsEnabled','jwtBearerEnabled','credentialAloneUserSelectionEnabled','interactiveAuthorizationRequiresUserAuthentication'])
    && runAs.schemaVersion === 2 && runAs.kind === 'fcos_salesforce_eca_client_credentials_run_as_acceptance'
    && runAs.orgId === binding.orgId && runAs.clientId === binding.clientId && runAs.externalClientApplicationId === binding.externalClientApplicationId
    && runAs.runAsUsername === binding.username && runAs.runAsUserId === binding.userId
    && runAs.serverEnforcedRunAs === true && runAs.clientCredentialsEnabled === true
    && runAs.jwtBearerEnabled === false && runAs.credentialAloneUserSelectionEnabled === false && runAs.interactiveAuthorizationRequiresUserAuthentication === true
    && runAs.clientConfigurationReadbackSha256 === binding.clientConfigurationReadbackSha256
    && Number.isFinite(Date.parse(runAs.capturedAt)) && Date.parse(runAs.capturedAt) >= binding.issuedAt - 30000
    && Date.parse(runAs.capturedAt) <= Date.parse(review.reviewedAt)
    && digest(canonical(runAs)) === binding.runAsAcceptanceSha256, 'SALESFORCE_READ_FIXED_RUN_AS_PROOF_REQUIRED');
  const permission = review.providerReadOnlyAcceptance;
  need(exact(permission, ['schemaVersion','kind','orgId','username','userId','profileId','profileName','userLicenseId','userLicenseName','capturedAt','allPermissionSourcesReviewed','businessRecordWrites','readOnlyScope','providerWideReadOnly','residualCapabilities','metadataWrites','administrativePermissions','executableWritePaths','providerFixedRunAs','profileReadbackSha256','permissionAssignmentsReadbackSha256','permissionSetGroupsReadbackSha256','effectiveSystemPermissionsReadbackSha256','effectiveObjectPermissionsReadbackSha256','effectiveFieldPermissionsReadbackSha256','executableAccessReadbackSha256','licenceReadbackSha256','clientRunAsReadbackSha256'])
    && permission.schemaVersion === 2 && permission.kind === 'fcos_salesforce_provider_business_data_read_only_acceptance'
    && ['orgId','username','userId','profileId','profileName','userLicenseId','userLicenseName'].every(key => permission[key] === binding[key])
    && Number.isFinite(Date.parse(permission.capturedAt)) && Date.parse(permission.capturedAt) >= binding.issuedAt - 30000
    && Date.parse(permission.capturedAt) <= Date.parse(review.reviewedAt)
    && permission.allPermissionSourcesReviewed === true && permission.providerFixedRunAs === true
    && permission.clientRunAsReadbackSha256 === binding.clientConfigurationReadbackSha256
    && same(permission.readOnlyScope, SALESFORCE_BUSINESS_READ_ONLY_SCOPE) && permission.providerWideReadOnly === false
    && same(permission.residualCapabilities, SALESFORCE_READER_RESIDUAL_CAPABILITIES)
    && ['businessRecordWrites','metadataWrites','administrativePermissions','executableWritePaths'].every(key => permission[key] === false)
    && ['profileReadbackSha256','permissionAssignmentsReadbackSha256','permissionSetGroupsReadbackSha256','effectiveSystemPermissionsReadbackSha256','effectiveObjectPermissionsReadbackSha256','effectiveFieldPermissionsReadbackSha256','executableAccessReadbackSha256','licenceReadbackSha256','clientRunAsReadbackSha256'].every(key => hash(permission[key]))
    && digest(canonical(permission)) === binding.effectivePermissionsSha256, 'SALESFORCE_READ_PROVIDER_READ_ONLY_PROOF_REQUIRED');
  validateSalesforcePermissionRecipe(review.permissionIntrospection, binding, review.userPermissionsReadbackSha256, permission);
  return review;
}

// Deliberately closed: root setup cannot admit write/admin/execute flags.
// The mandatory Integration-licence Chatter baseline is permitted only on the
// exact profile-owned set, under the explicit business-data scope and residuals.
const readOnlySystemPermissions = new Set(['PermissionsApiEnabled','PermissionsApiUserOnly','PermissionsViewSetup','PermissionsViewAllData','PermissionsViewAllUsers','PermissionsViewAllFields','PermissionsViewAllCustomSettings','PermissionsQueryAllFiles','PermissionsViewAllForecasts','PermissionsViewEventLogFiles','PermissionsViewPublicDashboards','PermissionsViewPublicReports','PermissionsViewRoles']);
// This owned source metadata set alone can authorize the accepted fixed client.
const clientAuthorizationPermissionSetName = 'FCOS_Hosted_NomB_Read';
const permissionId = value => typeof value === 'string' && /^0PS[A-Za-z0-9]{15}$/.test(value);
const sorted = values => [...values].sort();
const same = (a, b) => canonical(a) === canonical(b);
const unique = rows => new Set(rows).size === rows.length;
const capabilityNeed = value => need(value, 'SALESFORCE_READ_EFFECTIVE_PERMISSIONS_CHANGED');
// These semantic columns and the complete FieldPermissions schema are source-owned.
// Object audit timestamps are not permission semantics; FLS exposes exactly seven fields.
const objectPermissionColumns = ['Id','ParentId','SobjectType','PermissionsCreate','PermissionsRead','PermissionsEdit','PermissionsDelete','PermissionsViewAllRecords','PermissionsModifyAllRecords','PermissionsViewAllFields'];
const fieldPermissionSchema = { Id:'id', ParentId:'reference', SobjectType:'picklist', Field:'picklist', PermissionsEdit:'boolean', PermissionsRead:'boolean', SystemModstamp:'datetime' };
const fieldPermissionColumns = Object.keys(fieldPermissionSchema);
const semanticPermissionHash = (rows, columns) => digest(canonical([...rows].sort((a,b) => a.Id < b.Id ? -1 : a.Id > b.Id ? 1 : 0)
  .map(row => Object.fromEntries(columns.map(name => [name, row[name]])))));
export function salesforcePermissionRecipePaths(recipe) {
  need(recipe?.apiVersion === 'v67.0' && /^005[A-Za-z0-9]{15}$/.test(recipe.userId || '')
    && Array.isArray(recipe.permissionSets) && recipe.permissionSets.length > 0 && recipe.permissionSets.length <= 8
    && recipe.permissionSets.every(row => permissionId(row.id)) && recipe.maxRows === 200, 'SALESFORCE_READ_PERMISSION_RECIPE_REQUIRED');
  const ids = sorted(recipe.permissionSets.map(row => row.id)).map(id => `'${id}'`).join(',');
  const query = (object, where) => `/services/data/${recipe.apiVersion}/query?q=${encodeURIComponent(`SELECT FIELDS(ALL) FROM ${object} WHERE ${where} ORDER BY Id LIMIT 200`)}`;
  return [`/services/data/${recipe.apiVersion}/sobjects/PermissionSet/describe`,
    query('PermissionSetAssignment', `AssigneeId = '${recipe.userId}'`), query('PermissionSet', `Id IN (${ids})`),
    query('ObjectPermissions', `ParentId IN (${ids})`),
    `/services/data/${recipe.apiVersion}/query?q=${encodeURIComponent(`SELECT ${fieldPermissionColumns.join(',')} FROM FieldPermissions WHERE ParentId IN (${ids}) ORDER BY Id LIMIT 500`)}`,
    query('SetupEntityAccess', `ParentId IN (${ids})`), `/services/data/${recipe.apiVersion}/sobjects/FieldPermissions/describe`];
}
function validateSalesforcePermissionRecipe(recipe, binding, readbackSha256, permission) {
  need(exact(recipe, ['schemaVersion','kind','orgId','userId','profileId','apiVersion','permissionReadbackSha256','maxRows','permissionSets','systemPermissionFields','readableObjects','objectPermissionsSha256','fieldPermissionsSha256','nonExecutableSetupEntityGrants','clientAuthorizationGrant','paths'])
    && recipe.schemaVersion === 3 && recipe.kind === 'fcos_salesforce_fresh_business_data_read_only_permission_recipe'
    && ['orgId','userId','profileId','apiVersion'].every(key => recipe[key] === binding[key])
    && hash(recipe.permissionReadbackSha256) && recipe.permissionReadbackSha256 === readbackSha256
    && hash(recipe.objectPermissionsSha256) && recipe.objectPermissionsSha256 === permission.effectiveObjectPermissionsReadbackSha256
    && hash(recipe.fieldPermissionsSha256) && recipe.fieldPermissionsSha256 === permission.effectiveFieldPermissionsReadbackSha256
    && digest(canonical(recipe)) === binding.permissionRecipeSha256
    && same(recipe.paths, salesforcePermissionRecipePaths(recipe))
    && unique(recipe.permissionSets.map(row => row.id))
    && recipe.permissionSets.filter(row => row.isOwnedByProfile === true).length === 1
    && recipe.permissionSets.every(row => exact(row, ['id','name','isOwnedByProfile','trueSystemPermissions'])
      && typeof row.name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(row.name) && typeof row.isOwnedByProfile === 'boolean'
      && Array.isArray(row.trueSystemPermissions) && unique(row.trueSystemPermissions)
      && row.trueSystemPermissions.every(name => readOnlySystemPermissions.has(name)
        || name === 'PermissionsChatterInternalUser' && row.isOwnedByProfile === true
          && binding.userLicenseName === fcosConnectionIdentifier('salesforce', 'Hosted DEVEE read-only licence name')))
    && recipe.permissionSets.some(row => row.trueSystemPermissions.includes('PermissionsApiEnabled'))
    && ['PermissionsApiEnabled','PermissionsApiUserOnly','PermissionsChatterInternalUser'].every(name => recipe.permissionSets.find(row => row.isOwnedByProfile).trueSystemPermissions.includes(name))
    && Array.isArray(recipe.systemPermissionFields) && recipe.systemPermissionFields.length >= 2 && recipe.systemPermissionFields.length <= 2048
    && unique(recipe.systemPermissionFields) && recipe.systemPermissionFields.every(name => /^Permissions[A-Za-z0-9]+$/.test(name))
    && recipe.systemPermissionFields.includes('PermissionsApiEnabled')
    && recipe.permissionSets.every(row => row.trueSystemPermissions.every(name => recipe.systemPermissionFields.includes(name)))
    && Array.isArray(recipe.readableObjects) && unique(recipe.readableObjects) && recipe.readableObjects.length <= 199
    && recipe.readableObjects.every(name => /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(name))
    && Array.isArray(recipe.nonExecutableSetupEntityGrants) && recipe.nonExecutableSetupEntityGrants.length <= 32
    && unique(recipe.nonExecutableSetupEntityGrants.map(row => row.id)) && unique(recipe.nonExecutableSetupEntityGrants.map(row => row.setupEntityId))
    && recipe.nonExecutableSetupEntityGrants.every(row => exact(row, ['id','parentId','setupEntityId','setupEntityType'])
      && /^[A-Za-z0-9]{18}$/.test(row.id) && /^02u[A-Za-z0-9]{15}$/.test(row.setupEntityId)
      && row.setupEntityType === 'TabSet' && row.parentId === recipe.permissionSets.find(item => item.isOwnedByProfile).id), 'SALESFORCE_READ_PERMISSION_RECIPE_REQUIRED');
  const grant = recipe.clientAuthorizationGrant;
  const ownedSets = recipe.permissionSets.filter(row => row.isOwnedByProfile === false && row.name === clientAuthorizationPermissionSetName);
  need(exact(grant, ['id','parentId','setupEntityId','setupEntityType'])
    && /^0J0[A-Za-z0-9]{15}$/.test(grant.id || '') && grant.setupEntityType === 'ExternalClientApplication'
    && grant.setupEntityId === binding.externalClientApplicationId
    && ownedSets.length === 1 && grant.parentId === ownedSets[0].id
    && !recipe.nonExecutableSetupEntityGrants.some(row => row.id === grant.id || row.setupEntityId === grant.setupEntityId), 'SALESFORCE_READ_PERMISSION_RECIPE_REQUIRED');
  return recipe;
}
function permissionRows(value, recipe, maxRows = recipe.maxRows) {
  capabilityNeed(value?.done === true && !value.nextRecordsUrl && Array.isArray(value.records)
    && value.totalSize === value.records.length && value.records.length < maxRows
    && value.records.every(row => row && typeof row.Id === 'string') && unique(value.records.map(row => row.Id)));
  return value.records;
}
function validateFreshSalesforcePermissions(recipe, binding, values) {
  const [describe, assignmentValue, permissionValue, objectValue, fieldValue, executableValue, fieldDescribe] = values;
  capabilityNeed(Array.isArray(describe?.fields));
  const liveFields = describe.fields.filter(row => row.name?.startsWith('Permissions'));
  capabilityNeed(liveFields.every(row => row.type === 'boolean') && unique(liveFields.map(row => row.name))
    && same(sorted(liveFields.map(row => row.name)), sorted(recipe.systemPermissionFields)));
  const assignments = permissionRows(assignmentValue, recipe);
  // Salesforce automatically assigns the profile-owned PermissionSet as a row.
  // Require the exact full admitted set, never ignore that row or any extra grant.
  const admittedSetIds = recipe.permissionSets.map(row => row.id);
  capabilityNeed(same(sorted(assignments.map(row => row.PermissionSetId)), sorted(admittedSetIds))
    && assignments.every(row => row.AssigneeId === binding.userId && row.PermissionSetGroupId === null)
    && unique(assignments.map(row => row.PermissionSetId)));
  const permissions = permissionRows(permissionValue, recipe);
  capabilityNeed(permissions.length === recipe.permissionSets.length);
  for (const row of permissions) {
    const expected = recipe.permissionSets.find(item => item.id === row.Id);
    capabilityNeed(expected && row.Name === expected.name && row.IsOwnedByProfile === expected.isOwnedByProfile
      && row.ProfileId === (expected.isOwnedByProfile ? binding.profileId : null)
      && same(sorted(Object.keys(row).filter(name => name.startsWith('Permissions'))), sorted(recipe.systemPermissionFields))
      && recipe.systemPermissionFields.every(name => typeof row[name] === 'boolean')
      && same(sorted(recipe.systemPermissionFields.filter(name => row[name])), sorted(expected.trueSystemPermissions)));
  }
  const objects = permissionRows(objectValue, recipe);
  for (const row of objects) {
    capabilityNeed(recipe.permissionSets.some(item => item.id === row.ParentId)
      && recipe.readableObjects.includes(row.SobjectType) && row.Field === undefined
      && objectPermissionColumns.every(name => Object.hasOwn(row, name))
      && ['PermissionsCreate','PermissionsEdit','PermissionsDelete','PermissionsModifyAllRecords'].every(name => row[name] === false)
      && Object.entries(row).filter(([name]) => name.startsWith('Permissions')).every(([name, enabled]) =>
        typeof enabled === 'boolean' && (enabled === false || ['PermissionsRead','PermissionsViewAllRecords','PermissionsViewAllFields'].includes(name))));
  }
  // Complete object semantics are bound before treating inherited profile FLS
  // Edit as ineffective. A rewritten snapshot can never admit object CRUD.
  capabilityNeed(semanticPermissionHash(objects, objectPermissionColumns) === recipe.objectPermissionsSha256);
  capabilityNeed(Array.isArray(fieldDescribe?.fields) && fieldDescribe.fields.length === fieldPermissionColumns.length
    && unique(fieldDescribe.fields.map(row => row.name))
    && fieldDescribe.fields.every(row => Object.hasOwn(fieldPermissionSchema, row.name) && row.type === fieldPermissionSchema[row.name]));
  const fields = permissionRows(fieldValue, recipe, 500);
  const profileSet = recipe.permissionSets.find(row => row.isOwnedByProfile);
  for (const row of fields) {
    capabilityNeed(exact(Object.fromEntries(Object.entries(row).filter(([name]) => name !== 'attributes')), fieldPermissionColumns)
      && /^[A-Za-z0-9]{18}$/.test(row.Id) && recipe.permissionSets.some(item => item.id === row.ParentId)
      && typeof row.SobjectType === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(row.SobjectType)
      && typeof row.Field === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,79}\.[A-Za-z][A-Za-z0-9_]{0,79}$/.test(row.Field)
      && row.Field.split('.')[0] === row.SobjectType
      && typeof row.PermissionsRead === 'boolean' && typeof row.PermissionsEdit === 'boolean'
      && (row.PermissionsEdit === false || row.ParentId === profileSet.id)
      && typeof row.SystemModstamp === 'string' && Number.isFinite(Date.parse(row.SystemModstamp)));
  }
  // Includes every field, parent, read/edit flag and SystemModstamp; only REST
  // attributes metadata is excluded. No raw 334-row snapshot enters setup JSON.
  capabilityNeed(semanticPermissionHash(fields, fieldPermissionColumns) === recipe.fieldPermissionsSha256);
  // Existing app TabSets are inert under the mandatory API-only baseline. Only
  // the exact root-evidenced profile-owned list is admitted. The one separate
  // client authorization row binds the same accepted fixed Run As app and owned
  // direct read set; no generic executable or connected-app allowance exists.
  const grants = permissionRows(executableValue, recipe).map(row => ({ id: row.Id, parentId: row.ParentId, setupEntityId: row.SetupEntityId, setupEntityType: row.SetupEntityType }));
  const byId = rows => [...rows].sort((a, b) => a.id.localeCompare(b.id));
  capabilityNeed(same(byId(grants), byId([...recipe.nonExecutableSetupEntityGrants, recipe.clientAuthorizationGrant])));
}

const field = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(value);
/** A recipe is data, never executable SOQL or an arbitrary route. Its complete
 * bytes are separately pinned by the manifest and validated against NomB history. */
export function salesforceRecipePath(read, version) {
  need(version === 'v67.0' && field(read?.object) && typeof read.tooling === 'boolean', 'SALESFORCE_READ_ROUTE_FORBIDDEN');
  if (read.kind === 'describe') {
    need(exact(read, ['kind','object','tooling']) && read.tooling === false, 'SALESFORCE_READ_ROUTE_FORBIDDEN');
    return `/services/data/${version}/sobjects/${read.object}/describe`;
  }
  need(read.kind === 'query' && exact(read, read.where ? ['kind','object','tooling','fields','limit','where'] : ['kind','object','tooling','fields','limit'])
    && Array.isArray(read.fields) && read.fields.length > 0 && read.fields.length <= 40 && new Set(read.fields).size === read.fields.length && read.fields.every(field) && read.fields.includes('Id')
    && Number.isSafeInteger(read.limit) && read.limit >= 1 && read.limit <= 2000
    && (!read.where || exact(read.where, ['field','values']) && field(read.where.field) && Array.isArray(read.where.values) && read.where.values.length > 0 && read.where.values.length <= 100
      && read.where.values.every(value => typeof value === 'string' && /^[A-Za-z0-9 _./:@-]{1,200}$/.test(value))), 'SALESFORCE_READ_ROUTE_FORBIDDEN');
  const where = read.where ? ` WHERE ${read.where.field} IN (${read.where.values.map(value => `'${value}'`).join(',')})` : '';
  return `/services/data/${version}/${read.tooling ? 'tooling/' : ''}query?q=${encodeURIComponent(`SELECT ${read.fields.join(',')} FROM ${read.object}${where} ORDER BY Id LIMIT ${read.limit}`)}`;
}

async function responseJson(response, url, maxBytes) {
  need(response?.status === 200 && !response.redirected && (!response.url || response.url === url), 'SALESFORCE_READ_UNAVAILABLE');
  need(Number(response.headers?.get?.('content-length') || 0) <= maxBytes, 'SALESFORCE_READ_UNAVAILABLE');
  let bytes;
  if (response.body?.getReader) {
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try { while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length;
      if (size > maxBytes) { await reader.cancel(); refuse('SALESFORCE_READ_UNAVAILABLE'); } chunks.push(Buffer.from(chunk.value)); } }
    finally { reader.releaseLock(); }
    bytes = Buffer.concat(chunks);
  } else bytes = Buffer.from(await response.arrayBuffer());
  need(bytes.length <= maxBytes, 'SALESFORCE_READ_UNAVAILABLE');
  try { return JSON.parse(bytes.toString('utf8')); } catch { refuse('SALESFORCE_READ_UNAVAILABLE'); }
}

/** No token/secret is returned, persisted or passed to candidate code. One exchange
 * per in-memory session; an HTTP/auth failure is never retried or replayed. */
export function createSalesforceRecipeReader({ manifest, recipe, recipeBytes, recipeSha256, env = process.env, fetchImpl = globalThis.fetch, now = Date.now }) {
  const binding = structuredClone(validateSalesforceReadBinding(manifest?.verification?.salesforceReadCredential, { now: now() }));
  need(recipe && ['orgId','isSandbox','apiVersion'].every(key => recipe[key] === binding[key]) && recipe.origin === binding.instanceUrl
    && recipe.username === fcosSalesforceEnvironment('devee').username
    && /^005[A-Za-z0-9]{15}$/.test(recipe.userId || '') && /^00e[A-Za-z0-9]{15}$/.test(recipe.profileId || '')
    && recipe.username !== binding.username && recipe.userId !== binding.userId && recipe.profileId !== binding.profileId
    && salesforceFixtureIdentityHash(recipe) === binding.originalFixtureIdentitySha256
    && hash(recipeSha256) && manifest.dependencies?.nom_b?.recipeSha256 === recipeSha256, 'SALESFORCE_READ_RECIPE_BINDING');
  try {
    need(Buffer.isBuffer(recipeBytes) && recipeBytes.length <= 32 * 1024 * 1024 && digest(recipeBytes) === recipeSha256
      && canonical(JSON.parse(recipeBytes.toString('utf8'))) === canonical(recipe), 'SALESFORCE_READ_RECIPE_BINDING');
  } catch { refuse('SALESFORCE_READ_RECIPE_BINDING'); }
  const originalFixture = Object.freeze({ userId: recipe.userId, username: recipe.username, profileId: recipe.profileId });
  const reads = structuredClone(recipe.observations.flatMap(row => row.reads)), paths = reads.map(read => salesforceRecipePath(read, binding.apiVersion));
  need(reads.length > 0 && reads.length <= 16, 'SALESFORCE_READ_RECIPE_BINDING');
  let permissionRecipe, permissionObservation;
  let token, usableUntil = 0, authentication, used = 0, failed = false;
  const context = async () => {
    const { assertHostedSetup, assertHostedSourceContext } = await import('./admission.mjs');
    const setup = assertHostedSetup({ manifest, env }); assertHostedSourceContext({ manifest, env });
    const accepted = validateSalesforceReadAcceptance(binding, setup, { now: now() });
    permissionRecipe = structuredClone(accepted.permissionIntrospection);
    if (reads.some(row => row.kind === 'query' && ['ContentDocument','ContentVersion','ContentDocumentLink'].includes(row.object))) {
      const enabled = new Set(permissionRecipe.permissionSets.flatMap(row => row.trueSystemPermissions));
      need(['PermissionsViewAllData','PermissionsQueryAllFiles'].every(name => enabled.has(name)), 'SALESFORCE_READ_FILE_VISIBILITY_REQUIRED');
    }
    validateSalesforceReadBinding(binding, { now: now() });
    need(env.FCOS_HOSTED_ENVIRONMENT === SALESFORCE_READ_ENVIRONMENT && ['before','after'].includes(env.FCOS_VERIFICATION_PHASE)
      && env.GITHUB_JOB === `dependencies_${env.FCOS_VERIFICATION_PHASE}` && /^[1-9][0-9]*$/.test(env.FCOS_VERIFIED_JOB_ID || '')
      && !env.FCOS_HOSTED_SALESFORCE_READ_TOKEN && !Object.hasOwn(env, 'FCOS_HOSTED_SALESFORCE_JWT_PRIVATE_KEY'), 'SALESFORCE_READ_HOSTED_CONTEXT');
  };
  const request = async (url, options, maxBytes) => {
    try { return await responseJson(await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000) }), url, maxBytes); }
    catch { token = undefined; failed = true; refuse('SALESFORCE_READ_UNAVAILABLE'); }
  };
  const fixedGet = path => request(`${binding.instanceUrl}${path}`, { method: 'GET', headers: { authorization: `Bearer ${token}`, accept: 'application/json' } }, 4 * 1024 * 1024);
  const authenticate = async () => {
    await context(); need(!failed, 'SALESFORCE_READ_UNAVAILABLE');
    const secret = env.FCOS_HOSTED_SALESFORCE_CLIENT_SECRET;
    need(typeof secret === 'string' && secret.length >= 16 && secret.length <= 4096 && !/[\u0000-\u0020\u007f]/.test(secret), 'SALESFORCE_READ_PRIVATE_INPUT_REQUIRED');
    const exchangedAt = now();
    // Run As is chosen by provider policy, never by a request subject.
    const response = await request(`${binding.instanceUrl}/services/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: binding.clientId, client_secret: secret }).toString() }, 32768);
    try {
      need(response.token_type === 'Bearer' && typeof response.access_token === 'string' && response.access_token.length >= 16 && response.access_token.length <= 4096 && !/\s/.test(response.access_token)
        && response.instance_url === binding.instanceUrl && !Object.hasOwn(response, 'refresh_token') && typeof response.scope === 'string'
        && canonical(response.scope.split(' ').filter(Boolean).sort()) === canonical([...binding.scopes].sort()), 'SALESFORCE_READ_EXCHANGE_BINDING');
      const id = new URL(response.id);
      need(([binding.instanceUrl, SALESFORCE_IDENTITY_ORIGIN].includes(id.origin) || binding.isSandbox === true && id.origin === SALESFORCE_SANDBOX_IDENTITY_ORIGIN) && !id.search && !id.hash && !id.username && !id.password
        && [binding.orgId, binding.orgId.slice(0,15)].some(org => [binding.userId,binding.userId.slice(0,15)].some(user => id.pathname === `/id/${org}/${user}`)), 'SALESFORCE_READ_EXCHANGE_BINDING');
      need(typeof response.issued_at === 'string' && /^[1-9][0-9]{12}$/.test(response.issued_at)
        && Number(response.issued_at) >= exchangedAt - 30000 && Number(response.issued_at) <= now() + 30000
        && typeof response.signature === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(response.signature), 'SALESFORCE_READ_EXCHANGE_BINDING');
      const signature = Buffer.from(response.signature, 'base64');
      const expectedSignature = createHmac('sha256', secret).update(response.id + response.issued_at).digest();
      need(signature.length === 32 && signature.toString('base64') === response.signature
        && timingSafeEqual(signature, expectedSignature), 'SALESFORCE_READ_EXCHANGE_BINDING');
      need(response.expires_in === undefined || Number.isSafeInteger(Number(response.expires_in)) && Number(response.expires_in) > 30, 'SALESFORCE_READ_EXCHANGE_BINDING');
      token = response.access_token;
      usableUntil = Math.min(binding.notAfter, exchangedAt + Math.min(binding.sessionUseSeconds, response.expires_in === undefined ? binding.sessionUseSeconds : Number(response.expires_in) - 30) * 1000);
      const info = await fixedGet('/services/oauth2/userinfo');
      need(sameId(info.organization_id, binding.orgId) && sameId(info.user_id, binding.userId) && (info.preferred_username || info.username) === binding.username, 'SALESFORCE_READ_IDENTITY_CHANGED');
      const org = await fixedGet(`/services/data/${binding.apiVersion}/query?q=${encodeURIComponent('SELECT Id,IsSandbox FROM Organization LIMIT 2')}`);
      need(org.done === true && org.totalSize === 1 && org.records?.length === 1 && org.records[0].Id === binding.orgId && org.records[0].IsSandbox === true, 'SALESFORCE_READ_IDENTITY_CHANGED');
      const user = await fixedGet(`/services/data/${binding.apiVersion}/sobjects/User/${binding.userId}?fields=Id,Username,IsActive,ProfileId`);
      need(user.Id === binding.userId && user.Username === binding.username && user.IsActive === true && user.ProfileId === binding.profileId, 'SALESFORCE_READ_IDENTITY_CHANGED');
      const profile = await fixedGet(`/services/data/${binding.apiVersion}/sobjects/Profile/${binding.profileId}?fields=Id,Name,UserLicenseId`);
      need(profile.Id === binding.profileId && profile.Name === binding.profileName && profile.UserLicenseId === binding.userLicenseId && nonAdministrativeProfile(profile.Name), 'SALESFORCE_READ_IDENTITY_CHANGED');
      // The ORIGINAL fixture identity remains independently observed. Authenticating
      // the reader must never substitute it in the frozen recipe/environment proof.
      const fixture = await fixedGet(`/services/data/${binding.apiVersion}/sobjects/User/${originalFixture.userId}?fields=Id,Username,IsActive,ProfileId`);
      need(fixture.Id === originalFixture.userId && fixture.Username === originalFixture.username && fixture.IsActive === true && fixture.ProfileId === originalFixture.profileId, 'SALESFORCE_READ_FIXTURE_IDENTITY_CHANGED');
      const licence = await fixedGet(`/services/data/${binding.apiVersion}/sobjects/UserLicense/${binding.userLicenseId}?fields=Id,Name`);
      need(licence.Id === binding.userLicenseId && licence.Name === binding.userLicenseName, 'SALESFORCE_READ_IDENTITY_CHANGED');
      const capabilityValues = [];
      for (const path of permissionRecipe.paths) capabilityValues.push(await fixedGet(path));
      validateFreshSalesforcePermissions(permissionRecipe, binding, capabilityValues);
      permissionObservation = { schemaVersion: 1, kind: 'fcos_salesforce_fresh_business_data_read_only_permission_observation',
        recipeSha256: binding.permissionRecipeSha256, observedSha256: digest(canonical(capabilityValues)), capturedAt: new Date(now()).toISOString() };
    } catch (error) { token = undefined; failed = true; refuse(error.code === 'SALESFORCE_READ_EFFECTIVE_PERMISSIONS_CHANGED' ? error.code : 'SALESFORCE_READ_IDENTITY_OR_SCOPE_CHANGED'); }
  };
  const admit = async () => {
    await context(); need(!failed, 'SALESFORCE_READ_UNAVAILABLE');
    if (token && now() < usableUntil) return structuredClone(permissionObservation);
    if (!authentication) authentication = authenticate().finally(() => { authentication = undefined; });
    await authentication; need(now() < usableUntil, 'SALESFORCE_READ_SESSION_EXPIRED');
    return structuredClone(permissionObservation);
  };
  return Object.freeze({ admit, readRecipe: async index => {
    need(Number.isSafeInteger(index) && index >= 0 && index < paths.length && used < 16, 'SALESFORCE_READ_ROUTE_FORBIDDEN');
    await admit(); need(used < 16, 'SALESFORCE_READ_ROUTE_FORBIDDEN'); used++; return fixedGet(paths[index]);
  } });
}
