import { createHash } from 'node:crypto';
import { fcosConnectionIdentifier, fcosSalesforceEnvironment } from '../../../config/fcosConnections.js';

export const NOM_B_PRINCIPAL_SCHEMA_KIND = 'fcos_nom_b_fixed_reader_principal_schema_v1';
const OBJECTS = new Set(['Nomination__c', 'STEM__c', 'ContentVersion']);
const OBJECT_FLAGS = ['createable', 'updateable', 'deletable', 'undeletable'];
const FIELD_FLAGS = ['createable', 'updateable'];
const IDENTITY_KEYS = ['orgId', 'username', 'userId', 'profileId', 'instanceUrl', 'isSandbox', 'apiVersion'];
const CONTRACT_KEYS = ['schemaVersion', 'kind', 'readerIdentity', 'originalRecipeSha256', 'permissionRecipeSha256'];
const MAX_DESCRIPTOR_BYTES = 4 * 1024 * 1024;
const hash = value => createHash('sha256').update(value).digest('hex');
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const own = (value, key) => Object.hasOwn(value, key);
function need(value, code) { if (!value) { const error = new Error(code); error.code = code; throw error; } }
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => plain(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => own(value, key));

// JSON data only. In particular, accessors, prototypes, cycles and array holes
// cannot execute code or disappear silently during canonical hashing.
function canonical(value) {
  let nodes = 0; const ancestors = new Set();
  const visit = (item, depth) => {
    need(++nodes <= 200000 && depth <= 64, 'NOM_B_SCHEMA_DATA_LIMIT');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number') { need(Number.isFinite(item), 'NOM_B_SCHEMA_JSON_REQUIRED'); return JSON.stringify(item); }
    need(Array.isArray(item) || plain(item), 'NOM_B_SCHEMA_JSON_REQUIRED');
    need(!ancestors.has(item), 'NOM_B_SCHEMA_JSON_REQUIRED'); ancestors.add(item);
    const keys = Reflect.ownKeys(item);
    need(keys.every(key => typeof key === 'string' && Object.hasOwn(Object.getOwnPropertyDescriptor(item, key), 'value')
      && (Array.isArray(item) && key === 'length' || Object.getOwnPropertyDescriptor(item, key).enumerable)), 'NOM_B_SCHEMA_JSON_REQUIRED');
    let result;
    if (Array.isArray(item)) {
      need(keys.length === item.length + 1 && keys.includes('length') && item.every((_v, index) => own(item, index)), 'NOM_B_SCHEMA_JSON_REQUIRED');
      result = '[' + Array.from({ length: item.length }, (_v, index) => {
        need(own(item, index), 'NOM_B_SCHEMA_JSON_REQUIRED'); return visit(item[index], depth + 1);
      }).join(',') + ']';
    } else result = '{' + keys.sort().map(key => JSON.stringify(key) + ':' + visit(item[key], depth + 1)).join(',') + '}';
    ancestors.delete(item); return result;
  };
  return visit(value, 0);
}
const copy = value => Array.isArray(value) ? value.map(copy) : plain(value)
  ? Object.fromEntries(Object.keys(value).map(key => [key, copy(value[key])])) : value;
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
const identity = binding => Object.fromEntries(IDENTITY_KEYS.map(key => [key, binding?.[key]]));

/** Validates comparison pins only, never authentication, freshness or authority.
 * Integration MUST independently verify the admitted fixed reader and complete
 * fresh permission observation before use. A caller boolean is not such proof.
 */
export function validateNomBPrincipalSchemaContract(contract, { readerBinding, originalRecipeSha256 } = {}) {
  canonical(contract);
  canonical(readerBinding);
  const devee = fcosSalesforceEnvironment('devee'), readerIdentity = identity(readerBinding);
  need(exact(contract, CONTRACT_KEYS) && contract.schemaVersion === 1 && contract.kind === NOM_B_PRINCIPAL_SCHEMA_KIND,
    'NOM_B_PRINCIPAL_CONTRACT_REQUIRED');
  need(exact(contract.readerIdentity, IDENTITY_KEYS) && readerIdentity.orgId === devee.orgId
    && readerIdentity.instanceUrl === devee.instanceUrl && readerIdentity.isSandbox === true && readerIdentity.apiVersion === 'v67.0'
    && readerIdentity.username === fcosConnectionIdentifier('salesforce', 'Hosted DEVEE read-only username')
    && readerIdentity.username !== devee.username && /^005[A-Za-z0-9]{15}$/.test(readerIdentity.userId || '')
    && /^00e[A-Za-z0-9]{15}$/.test(readerIdentity.profileId || '')
    && readerBinding?.providerPermissionMode === 'provider_business_data_read_only'
    && readerBinding.authenticationProtocol === 'client_credentials'
    && canonical(contract.readerIdentity) === canonical(readerIdentity), 'NOM_B_PRINCIPAL_IDENTITY_REQUIRED');
  need(validHash(originalRecipeSha256) && contract.originalRecipeSha256 === originalRecipeSha256
    && validHash(readerBinding.permissionRecipeSha256) && contract.permissionRecipeSha256 === readerBinding.permissionRecipeSha256,
    'NOM_B_PRINCIPAL_RECIPE_BINDING_REQUIRED');
  return freeze(copy(contract));
}

function descriptor(value) {
  const bytes = canonical(value);
  need(Buffer.byteLength(bytes) <= MAX_DESCRIPTOR_BYTES, 'NOM_B_SCHEMA_DATA_LIMIT');
  need(plain(value) && OBJECTS.has(value.name) && OBJECT_FLAGS.every(key => own(value, key) && typeof value[key] === 'boolean')
    && Array.isArray(value.fields) && value.fields.length > 0 && value.fields.length <= 4096
    && value.fields.every(field => plain(field) && typeof field.name === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(field.name)
      && FIELD_FLAGS.every(key => own(field, key) && typeof field[key] === 'boolean'))
    && new Set(value.fields.map(field => field.name)).size === value.fields.length, 'NOM_B_SCHEMA_DESCRIPTOR_REQUIRED');
  return bytes;
}
const allowedPath = keys => keys.length === 1 && OBJECT_FLAGS.includes(keys[0])
  || keys.length === 3 && keys[0] === 'fields' && Number.isSafeInteger(keys[1]) && FIELD_FLAGS.includes(keys[2]);
const pointer = keys => '/' + keys.map(key => String(key).replaceAll('~', '~0').replaceAll('/', '~1')).join('/');

/** Comparison data, NOT a provider receipt, permission proof, or approval.
 * The historical comparison view reverses only verified true->false capability
 * differences. Retain the actual current descriptor/hash separately; never pass
 * this labelled view off as the raw Salesforce response.
 */
export function compareNomBPrincipalSchema({ contract, readerBinding, originalRecipeSha256, originalDescriptor, currentDescriptor } = {}) {
  const validated = validateNomBPrincipalSchemaContract(contract, { readerBinding, originalRecipeSha256 });
  const originalBytes = descriptor(originalDescriptor), currentBytes = descriptor(currentDescriptor);
  need(originalDescriptor.name === currentDescriptor.name, 'NOM_B_SCHEMA_STRUCTURE_CHANGED');
  need(OBJECT_FLAGS.every(key => currentDescriptor[key] === false), 'NOM_B_SCHEMA_OBJECT_WRITES_FORBIDDEN');
  const comparable = copy(currentDescriptor), allowedChangedPaths = [];
  const visit = (before, after, keys) => {
    if (before === after) return;
    if (allowedPath(keys)) {
      need(before === true && after === false, 'NOM_B_SCHEMA_CAPABILITY_CHANGE_FORBIDDEN');
      allowedChangedPaths.push(pointer(keys));
      if (keys.length === 1) comparable[keys[0]] = before;
      else comparable.fields[keys[1]][keys[2]] = before;
      return;
    }
    need(before !== null && after !== null && typeof before === 'object' && typeof after === 'object'
      && Array.isArray(before) === Array.isArray(after), 'NOM_B_SCHEMA_STRUCTURE_CHANGED');
    if (Array.isArray(before)) {
      need(before.length === after.length, 'NOM_B_SCHEMA_STRUCTURE_CHANGED');
      before.forEach((value, index) => visit(value, after[index], [...keys, index]));
    } else {
      const names = Object.keys(before).sort();
      need(canonical(names) === canonical(Object.keys(after).sort()), 'NOM_B_SCHEMA_STRUCTURE_CHANGED');
      names.forEach(key => visit(before[key], after[key], [...keys, key]));
    }
  };
  visit(originalDescriptor, currentDescriptor, []);
  const comparableBytes = canonical(comparable);
  need(comparableBytes === originalBytes, 'NOM_B_SCHEMA_STRUCTURE_CHANGED');
  const binding = { schemaVersion: 1, kind: 'fcos_nom_b_principal_schema_comparison_v1', objectName: originalDescriptor.name,
    contractSha256: hash(canonical(validated)), readerIdentitySha256: hash(canonical(validated.readerIdentity)),
    originalRecipeSha256, permissionRecipeSha256: validated.permissionRecipeSha256,
    originalDescriptorSha256: hash(originalBytes), currentDescriptorSha256: hash(currentBytes),
    legacyComparableDescriptorSha256: hash(comparableBytes), allowedChangedPaths };
  return freeze({ ...binding, comparisonMatched: true, comparisonSha256: hash(canonical(binding)),
    authorityGranted: false, qualificationProven: false, freshPrincipalValidationPerformed: false,
    requiresVerifiedFreshReadOnlyPrincipalContext: true,
    originalDescriptor: copy(originalDescriptor), currentDescriptor: copy(currentDescriptor), legacyComparableDescriptor: comparable });
}
