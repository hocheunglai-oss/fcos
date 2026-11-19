import { readFileSync } from 'node:fs';
import { XMLValidator } from 'fast-xml-parser';
import { parseDocument } from 'htmlparser2';
import { salesforcePromotionHash as hash } from './salesforce-promotion-journal.mjs';

const apps = Object.freeze({ devee: 'FCB', qat: 'FCB', production: 'FCB_BT' });
const pages = Object.freeze({
  Invoice__c: 'FCOS_DEVEE_Invoice_Launcher_Buyer',
  Supplier_Invoice__c: 'FCOS_DEVEE_Invoice_Launcher_Supplier',
});
const components = [
  'ApexClass:FcosTradeProformaService', 'ApexClass:FcosTradeProformaServiceTest',
  ...Object.values(pages).map(page => `FlexiPage:${page}`),
  'LightningComponentBundle:fcosTradeInvoiceActions',
].sort();
const xmlNamespace = 'http://soap.sforce.com/2006/04/metadata';
const isDigest = value => /^[a-f0-9]{64}$/u.test(value || '');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = message => { throw new Error(`Invoice app placement: ${message}`); };
const tags = node => node.children.filter(child => child.type === 'tag');
const text = (node, name) => tags(node).find(child => child.name === name)?.children
  .map(child => child.data || '').join('');

function appDocument(xml) {
  if (/<!DOCTYPE|<!ENTITY|xml:space/iu.test(xml) || XMLValidator.validate(xml) !== true) fail('Unsupported or invalid XML.');
  const document = parseDocument(xml, { xmlMode: true, decodeEntities: true });
  const [root, ...others] = tags(document);
  if (!root || others.length || root.name !== 'CustomApplication'
    || root.attribs.xmlns !== xmlNamespace || Object.keys(root.attribs).length !== 1) fail('Expected one CustomApplication.');
  return root;
}

function definition(node, excluded = new Set()) {
  if (!node.children) return [node.type, node.data];
  const hasElements = tags(node).length > 0;
  return [node.type, node.name, Object.entries(node.attribs || {}).sort(),
    node.children.filter(child => !excluded.has(child)
      && !(hasElements && child.type === 'text' && !child.data.trim()))
      .map(child => definition(child))];
}

function placement(root) {
  const overrides = tags(root).filter(row => ['actionOverrides', 'profileActionOverrides'].includes(row.name))
    .filter(row => Object.hasOwn(pages, text(row, 'pageOrSobjectType') || ''));
  const objects = new Set();
  for (const row of overrides) {
    const object = text(row, 'pageOrSobjectType');
    const expected = { actionName: 'View', content: pages[object], formFactor: 'Large',
      pageOrSobjectType: object, profile: 'Admin' };
    const children = tags(row);
    const values = Object.fromEntries(children.map(child => [child.name, text(row, child.name)]));
    const fields = [...Object.keys(expected), 'type'].sort();
    if (row.name !== 'profileActionOverrides' || Object.keys(row.attribs).length
      || children.length !== fields.length || !equal(Object.keys(values).sort(), fields)
      || children.some(child => Object.keys(child.attribs).length || child.children.length !== 1
        || child.children[0].type !== 'text')
      || Object.entries(expected).some(([name, value]) => values[name] !== value)
      || !/^flexipage$/iu.test(values.type) || objects.has(object)) fail('Unexpected or conflicting invoice override.');
    objects.add(object);
  }
  return new Set(overrides);
}

export function assertInvoiceAppPlacementXml(beforeXml, afterXml, { environmentKey }) {
  if (!Object.hasOwn(apps, environmentKey)) fail('Unknown environment.');
  const before = appDocument(beforeXml), after = appDocument(afterXml);
  const oldOverrides = placement(before), newOverrides = placement(after);
  if (newOverrides.size !== 2) fail('Expected both desktop invoice overrides.');
  if (environmentKey === 'devee') {
    if (oldOverrides.size !== 2 || !equal(definition(before), definition(after))) fail('DEVEE placement differs from its verified baseline.');
  } else if (oldOverrides.size !== 0 || !equal(definition(before), definition(after, newOverrides))) {
    fail('Placement must preserve all existing application metadata.');
  }
}

export function invoiceAppPlacementDescriptors(review, manifest) {
  const declared = review.invoiceAppPlacement;
  if (declared === undefined) return undefined;
  if (!declared || !equal(Object.keys(declared).sort(), Object.keys(apps).sort())
    || !equal([...manifest].sort(), components) || review.bootstrap || review.permissionSets?.length
    || review.baselineMode !== 'read-only-owned-tree-inventory') fail('Expected the exact invoice package and all three orgs.');
  return Object.fromEntries(Object.entries(apps).map(([key, app]) => {
    const descriptor = declared[key];
    if (!descriptor || !equal(Object.keys(descriptor).sort(), ['after', 'before'])) fail('Invalid application descriptor.');
    for (const phase of ['before', 'after']) {
      const file = descriptor[phase];
      if (!file || !equal(Object.keys(file).sort(), ['path', 'sha256']) || !isDigest(file.sha256)
        || file.path !== `manifest/invoice-launcher-placement/${key}-${phase}.app-meta.xml`) fail('Invalid application artifact.');
    }
    return [key, { app, ...descriptor }];
  }));
}

export function readInvoiceAppPlacement(descriptor, environmentKey, resolveSource) {
  const files = {};
  for (const phase of ['before', 'after']) {
    const artifact = descriptor[phase];
    const bytes = readFileSync(resolveSource(artifact.path));
    if (hash(bytes) !== artifact.sha256) fail('Reviewed application artifact changed.');
    files[phase] = bytes;
  }
  assertInvoiceAppPlacementXml(files.before.toString('utf8'), files.after.toString('utf8'), { environmentKey });
  return files;
}

export function assertInvoiceAppPlacementReadback(expected, actual) {
  const recorded = appDocument(expected.toString('utf8'));
  const observed = appDocument(actual.toString('utf8'));
  const recordedRows = placement(recorded);
  const observedRows = placement(observed);
  if (recordedRows.size !== observedRows.size
    || !equal(definition(recorded, recordedRows), definition(observed, observedRows))) fail('Native application readback differs from the reviewed checkpoint.');
}
