import { parseDocument } from 'htmlparser2';
import { salesforcePromotionHash } from './salesforce-promotion-journal.mjs';

const NAME = /^[A-Za-z][A-Za-z0-9_]*$/u;
const FIELD = /^[A-Za-z][A-Za-z0-9_]*\.[A-Za-z][A-Za-z0-9_]*$/u;
const PERMISSION_SET_ID = /^0PS[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/u;
const METADATA_NS = 'http://soap.sforce.com/2006/04/metadata';
const fieldGrants = {
  tag: 'fieldPermissions', key: 'field', nativeKey: 'Field', name: FIELD, table: 'FieldPermissions',
  fields: { editable: 'PermissionsEdit', readable: 'PermissionsRead' },
};
const objectGrants = {
  tag: 'objectPermissions', key: 'object', nativeKey: 'SobjectType', name: NAME, table: 'ObjectPermissions',
  fields: { allowCreate: 'PermissionsCreate', allowDelete: 'PermissionsDelete', allowEdit: 'PermissionsEdit',
    allowRead: 'PermissionsRead', modifyAllRecords: 'PermissionsModifyAllRecords',
    viewAllFields: 'PermissionsViewAllFields', viewAllRecords: 'PermissionsViewAllRecords' },
};
const grantTypes = [fieldGrants, objectGrants];
const tags = node => node.children.filter(child => child.type === 'tag');
const sortedEntries = map => [...map].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const invalid = message => { throw new Error('Salesforce PermissionSet projection ' + message); };

function grantValue(node) {
  if (Object.keys(node.attribs).length || node.children.length !== 1 || node.children[0].type !== 'text') {
    invalid('contains an unsupported grant value.');
  }
  return node.children[0].data;
}

function parseGrants(xml) {
  if (/xml:space|<!DOCTYPE|<!ENTITY/iu.test(xml)) invalid('contains unsupported XML.');
  const document = parseDocument(xml, { xmlMode: true, decodeEntities: true });
  const [root, ...extra] = tags(document);
  if (root?.name !== 'PermissionSet' || root.attribs.xmlns !== METADATA_NS || extra.length) {
    invalid('requires one native Metadata API PermissionSet root.');
  }
  const grants = new Map();
  for (const { tag, key, name, fields } of grantTypes) {
    const entries = new Map();
    for (const entry of tags(root).filter(child => child.name === tag)) {
      const children = tags(entry);
      const values = new Map(children.map(child => [child.name, grantValue(child)]));
      const target = values.get(key);
      if (!name.test(target || '') || entries.has(target) || values.size !== children.length
        || Object.keys(entry.attribs).length || entry.children.some(node => node.type !== 'tag' && (node.type !== 'text' || node.data.trim()))
        || [...values.keys()].some(label => label !== key && !Object.hasOwn(fields, label))) {
        invalid('contains an invalid, unknown or duplicate grant.');
      }
      entries.set(target, Object.fromEntries(Object.entries(fields).map(([label, field]) => {
        const value = values.get(label);
        if (!['true', 'false'].includes(value) && !(label === 'viewAllFields' && value === undefined)) {
          invalid('contains a missing or non-boolean grant value.');
        }
        return [field, value === 'true'];
      })));
    }
    grants.set(tag, entries);
  }
  root.children = root.children.filter(child => child.type !== 'tag' || !grants.has(child.name));
  return { document, grants };
}

const unorderedGrants = {
  classAccesses: 'apexClass',
  customPermissions: 'name',
};

function normalizePermissionSetDefinition(xml, document, normalize) {
  const [root] = tags(document);
  root.children = root.children.filter(node => node.type !== 'comment');
  const activation = tags(root).filter(node => node.name === 'hasActivationRequired');
  if (activation.length > 1) invalid('contains duplicate activation settings.');
  if (activation.length && grantValue(activation[0]) === 'false') {
    root.children = root.children.filter(node => node !== activation[0]);
  }
  for (const [name, key] of Object.entries(unorderedGrants)) {
    const group = tags(root).filter(node => node.name === name);
    const byName = new Map();
    for (const entry of group) {
      const names = tags(entry).filter(node => node.name === key);
      const target = names.length === 1 ? grantValue(names[0]) : null;
      if (!target || byName.has(target)) invalid('contains an invalid or duplicate ' + name + ' grant.');
      byName.set(target, entry);
    }
    const sorted = sortedEntries(byName).map(([, entry]) => entry);
    let index = 0;
    root.children = root.children.map(node => node.type === 'tag' && node.name === name ? sorted[index++] : node);
  }
  return normalize(xml, document);
}

export function comparePermissionSetDefinition({ name, source, native, normalize }) {
  if (!NAME.test(name)) invalid('has an invalid reviewed name.');
  const expected = parseGrants(source);
  const observed = parseGrants(native);
  if (!same(normalizePermissionSetDefinition(source, expected.document, normalize),
    normalizePermissionSetDefinition(native, observed.document, normalize))) {
    invalid(`differs from the reviewed non-grant definition for ${name}.`);
  }
  for (const [tag, entries] of observed.grants) {
    for (const [key, value] of entries) {
      if (!same(value, expected.grants.get(tag).get(key))) invalid(`has an unexpected exported ${tag} entry for ${name}.`);
    }
  }
  return { name, grants: expected.grants };
}

export function verifyPermissionSetCatalog(projections, query) {
  const names = projections.map(({ name }) => name).sort();
  if (!names.length || names.some(name => !NAME.test(name)) || new Set(names).size !== names.length) {
    invalid('requires unique reviewed permission-set names.');
  }
  const values = items => items.map(item => `'${item}'`).join(', ');
  const read = soql => {
    const result = query(soql);
    if (!Array.isArray(result?.records) || result.totalSize !== result.records.length || result.done !== true || result.nextRecordsUrl) {
      invalid('catalog response is incomplete.');
    }
    return result.records;
  };
  const parents = read(`SELECT Id, Name, IsOwnedByProfile, NamespacePrefix FROM PermissionSet WHERE Name IN (${values(names)}) AND IsOwnedByProfile = false AND NamespacePrefix = null`);
  const byId = new Map(parents.map(row => [row.Id, row.Name]));
  if (!same(parents.map(row => row.Name).sort(), names) || byId.size !== names.length
    || parents.some(row => !PERMISSION_SET_ID.test(row.Id || '') || row.IsOwnedByProfile !== false || row.NamespacePrefix !== null)) {
    invalid('catalog did not return the exact reviewed permission sets.');
  }
  const evidence = [];
  for (const { tag, nativeKey, table, name, fields } of grantTypes) {
    const attributes = Object.values(fields);
    const columns = [...new Set(['ParentId', 'SobjectType', nativeKey, ...attributes])];
    const rows = read(`SELECT ${columns.join(', ')} FROM ${table} WHERE ParentId IN (${values([...byId.keys()].sort())})`);
    const observed = new Map(names.map(name => [name, new Map()]));
    for (const row of rows) {
      const grants = observed.get(byId.get(row.ParentId));
      const target = row[nativeKey];
      if (!grants || !name.test(target || '') || grants.has(target)
        || (nativeKey === 'Field' && target.split('.')[0] !== row.SobjectType)
        || attributes.some(field => typeof row[field] !== 'boolean')) {
        invalid(`catalog contains an invalid or duplicate ${table} row.`);
      }
      grants.set(target, Object.fromEntries(attributes.map(field => [field, row[field]])));
    }
    for (const projection of projections) {
      const expected = projection.grants.get(tag);
      const actual = observed.get(projection.name);
      const differences = [...new Set([...expected.keys(), ...actual.keys()])]
        .filter(key => !same(expected.get(key), actual.get(key))).sort();
      if (differences.length) invalid(`catalog differs for ${projection.name} ${table}: ${differences.join(', ')}.`);
      evidence.push({ permissionSet: projection.name, table, grants: sortedEntries(actual) });
    }
  }
  return { permissionSets: names, permissionGrantEvidenceSha256: salesforcePromotionHash(evidence) };
}
