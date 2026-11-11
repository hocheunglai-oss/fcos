import { salesforcePromotionHash } from './salesforce-promotion-journal.mjs';

const NAME = /^[A-Za-z][A-Za-z0-9_]*$/u;
const OBJECT_ID = /^01I[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/u;
const custom = value => /^[A-Za-z][A-Za-z0-9]*?(?:_[A-Za-z0-9]+)*__c$/u.test(value);
const namedTypes = {
  ApexClass: 'Name', ApexTrigger: 'Name', ApexPage: 'Name', PermissionSet: 'Name',
  LightningComponentBundle: 'DeveloperName', AuraDefinitionBundle: 'DeveloperName', CustomPermission: 'DeveloperName',
};
const childTypes = ['CustomField', 'ValidationRule'];
const unique = values => [...new Set(values)].sort();
const inList = values => values.map(value => `'${value}'`).join(',');
const normalizedLocator = value => OBJECT_ID.test(value) ? value.slice(0, 15) : value;

function memberGroups(ids) {
  const groups = new Map();
  for (const id of ids) {
    const [type, member, extra] = id.split(':');
    if (!type || !member || extra !== undefined) throw new Error('Invalid Salesforce inventory catalog member.');
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push(member);
  }
  return groups;
}

export function proveSalesforceInventoryAbsence({ expectedAbsentComponents, presentComponents, query, listMetadata }) {
  const absent = memberGroups(expectedAbsentComponents), present = memberGroups(presentComponents);
  const requested = [], listed = new Set(), queries = [];
  const control = (type, valid) => {
    const name = present.get(type)?.find(valid);
    if (!name || absent.get(type)?.includes(name)) throw new Error(`Salesforce inventory needs a present ${type} catalog control.`);
    return name;
  };
  function read(soql, tooling = true) {
    const result = query(soql, tooling);
    if (!Array.isArray(result?.records) || result.totalSize !== result.records.length
      || (result.done !== undefined && result.done !== true) || result.nextRecordsUrl) {
      throw new Error('Salesforce inventory catalog response is incomplete.');
    }
    queries.push(salesforcePromotionHash({ soql, tooling, records: result.records }));
    return result.records;
  }
  function batches(values, callback) {
    const items = unique(values);
    for (let offset = 0; offset < items.length; offset += 75) callback(items.slice(offset, offset + 75));
  }
  function assertControl(type, name) {
    if (!listed.has(`${type}:${name}`)) throw new Error(`Salesforce inventory catalog failed its ${type} control.`);
  }
  function readMetadata(type) {
    if (typeof listMetadata !== 'function') throw new Error(`Exact ${type} catalog read is required.`);
    const rows = listMetadata(type);
    if (!Array.isArray(rows) || rows.some(row => row?.type !== type || typeof row.fullName !== 'string' || !row.fullName)) {
      throw new Error(`Salesforce ${type} catalog response is invalid.`);
    }
    return rows;
  }
  for (const [type, names] of absent) {
    if (type === 'QuickAction' || type === 'Layout') {
      const pattern = type === 'QuickAction' ? /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)?$/u
        : /^[A-Za-z][A-Za-z0-9_]*-[A-Za-z0-9_.$-]+(?: +[A-Za-z0-9_.$-]+)*$/u;
      const valid = name => pattern.test(name);
      if (!names.every(valid)) throw new Error('Invalid Salesforce inventory catalog member.');
      const positive = control(type, valid);
      const rows = readMetadata(type);
      const candidates = new Set([...names, positive].map(name => name.toLowerCase()));
      const exact = rows.filter(row => !row.namespacePrefix && candidates.has(row.fullName.toLowerCase())).map(row => row.fullName);
      if (exact.some(name => name !== positive && !names.includes(name)) || new Set(exact).size !== exact.length) {
        throw new Error(`Salesforce ${type} catalog contains ambiguous exact names.`);
      }
      queries.push(salesforcePromotionHash({ type, expected: [...names, positive], resultCount: rows.length, matches: exact.sort() }));
      for (const name of exact) listed.add(`${type}:${name}`);
      assertControl(type, positive);
      continue;
    }
    const field = Object.hasOwn(namedTypes, type) ? namedTypes[type] : null;
    if (!field && !['CustomObject', ...childTypes].includes(type)) throw new Error('Unsupported Salesforce inventory absence scope.');
    const valid = field ? name => NAME.test(name) : type === 'CustomObject' ? custom : name => {
      const parts = name.split('.');
      return parts.length === 2 && NAME.test(parts[0]) && (type === 'CustomField' ? custom(parts[1]) : NAME.test(parts[1]));
    };
    if (!names.every(valid)) throw new Error('Invalid Salesforce inventory catalog member.');
    if (type === 'CustomPermission' && !present.has(type)) {
      const rows = read('SELECT DeveloperName FROM CustomPermission WHERE NamespacePrefix = null', false);
      const metadata = readMetadata(type);
      if (rows.length || metadata.some(row => !row.namespacePrefix)) {
        throw new Error('A nonempty CustomPermission catalog requires a reviewed positive control.');
      }
      queries.push(salesforcePromotionHash({ type, resultCount: metadata.length, unmanagedCount: 0 }));
      continue;
    }
    const positive = control(type, valid);
    if (!field) {
      requested.push({ type, names, positive });
      continue;
    }
    const permission = type === 'PermissionSet';
    batches([...names, positive], batch => {
      const rows = read(`SELECT ${field} FROM ${type} WHERE NamespacePrefix = null${permission ? ' AND IsOwnedByProfile = false' : ''} AND ${field} IN (${inList(batch)})`,
        !permission && type !== 'CustomPermission');
      for (const row of rows) {
        if (!batch.includes(row[field])) throw new Error('Unexpected Salesforce inventory catalog member.');
        listed.add(`${type}:${row[field]}`);
      }
    });
    assertControl(type, positive);
  }
  const objects = unique(requested.flatMap(({ type, names, positive }) =>
    [positive, ...names].map(name => type === 'CustomObject' ? name : name.split('.')[0])));
  const parentByName = new Map(objects.filter(name => !custom(name)).map(name => [name, name]));
  batches(objects.filter(custom).map(name => name.slice(0, -3)), batch => {
    const rows = read(`SELECT Id, DeveloperName FROM CustomObject WHERE NamespacePrefix = null AND DeveloperName IN (${inList(batch)})`);
    for (const row of rows) {
      const name = `${row.DeveloperName}__c`;
      if (!batch.includes(row.DeveloperName) || !OBJECT_ID.test(row.Id) || parentByName.has(name)) throw new Error('Unexpected Salesforce catalog parent.');
      parentByName.set(name, row.Id);
      listed.add(`CustomObject:${name}`);
    }
  });
  for (const { type, names, positive } of requested) {
    if (type === 'CustomObject') {
      assertControl(type, positive);
      continue;
    }
    const members = [...names, positive].map(name => name.split('.'));
    if (members.some(([parent]) => !parentByName.has(parent) && !absent.get('CustomObject')?.includes(parent))) {
      throw new Error('Salesforce inventory catalog could not verify a reviewed parent.');
    }
    const parents = unique(members.map(([parent]) => parentByName.get(parent)).filter(Boolean));
    const isField = type === 'CustomField';
    const nativeNames = members.map(([, name]) => isField ? name.slice(0, -3) : name);
    const parentsByLocator = new Map([...parentByName].map(([name, id]) => [normalizedLocator(id), name]));
    if (parentsByLocator.size !== parentByName.size) throw new Error('Duplicate Salesforce inventory catalog parent locators.');
    if (parents.length > 75) throw new Error('Salesforce inventory catalog parent scope exceeds the verified batch bound.');
    batches(nativeNames, batch => {
      const rows = read(isField
        ? `SELECT DeveloperName, TableEnumOrId FROM CustomField WHERE NamespacePrefix = null AND TableEnumOrId IN (${inList(parents)}) AND DeveloperName IN (${inList(batch)})`
        : `SELECT ValidationName, EntityDefinitionId FROM ValidationRule WHERE ValidationName IN (${inList(batch)})`);
      for (const row of rows) {
        const nativeName = isField ? row.DeveloperName : row.ValidationName;
        const locator = isField ? row.TableEnumOrId : row.EntityDefinitionId;
        if (!batch.includes(nativeName) || typeof locator !== 'string' || (!NAME.test(locator) && !OBJECT_ID.test(locator))) {
          throw new Error('Unexpected Salesforce inventory catalog child.');
        }
        const parent = parentsByLocator.get(normalizedLocator(locator));
        if (!parent && isField) throw new Error('Unexpected Salesforce inventory catalog field parent.');
        if (parent) listed.add(`${type}:${parent}.${nativeName}${isField ? '__c' : ''}`);
      }
    });
    assertControl(type, positive);
  }
  const unexpected = expectedAbsentComponents.filter(id => listed.has(id));
  if (unexpected.length) throw new Error(`Salesforce inventory expected absent metadata is present: ${unexpected.join(', ')}.`);
  return { absentComponents: [...expectedAbsentComponents], absenceVerificationMethod: 'native-metadata-catalog',
    absenceEvidenceSha256: salesforcePromotionHash(queries) };
}
