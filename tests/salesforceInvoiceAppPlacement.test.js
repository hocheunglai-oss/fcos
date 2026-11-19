import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertInvoiceAppPlacementXml, invoiceAppPlacementDescriptors } from '../scripts/lib/salesforce-invoice-app-placement.mjs';

const namespace = 'http://soap.sforce.com/2006/04/metadata';

function override({ object, page, profile = 'Admin', formFactor = 'Large', type = 'Flexipage', recordType } = {}) {
  return `<profileActionOverrides>
    <actionName>View</actionName>
    <content>${page}</content>
    <formFactor>${formFactor}</formFactor>
    <pageOrSobjectType>${object}</pageOrSobjectType>
    <profile>${profile}</profile>${recordType ? `\n    <recordType>${recordType}</recordType>` : ''}
    <type>${type}</type>
  </profileActionOverrides>`;
}

const buyer = override({ object: 'Invoice__c', page: 'FCOS_DEVEE_Invoice_Launcher_Buyer' });
const supplier = override({ object: 'Supplier_Invoice__c', page: 'FCOS_DEVEE_Invoice_Launcher_Supplier' });
const historic = override({ object: 'STEM__c', page: 'STEM_Historical_RecordType', profile: 'FCB Trader', recordType: 'STEM__c.Historical' });
const sales = override({ object: 'STEM__c', page: 'STEM_Historical_RecordType', profile: 'Sales Support', recordType: 'STEM__c.Historical' });

function application(rows, extra = '') {
  return `<?xml version="1.0" encoding="UTF-8"?>
<CustomApplication xmlns="${namespace}">
  <label>FCB</label>
  ${rows.join('\n  ')}
  <tabs>STEM__c</tabs>
  <uiType>Lightning</uiType>
  ${extra}
</CustomApplication>`;
}

const baseline = application([historic, sales]);
const placement = application([historic, sales, buyer, supplier]);
const validate = (before, after, environmentKey = 'qat') =>
  assertInvoiceAppPlacementXml(before, after, { environmentKey });

test('accepts only the two additive desktop Admin assignments in QAT and Production', () => {
  assert.doesNotThrow(() => validate(baseline, placement, 'qat'));
  assert.doesNotThrow(() => validate(baseline, placement, 'production'));
});

test('DEVEE accepts its already verified placement when the app definition is unchanged', () => {
  assert.doesNotThrow(() => validate(placement, placement, 'devee'));
  assert.throws(() => validate(baseline, placement, 'devee'));
  assert.throws(() => validate(baseline, baseline, 'devee'));
  assert.throws(() => validate(placement, application([historic, sales, buyer]), 'devee'));
});

test('rejects missing, duplicate, or extra assignments and absent additions', () => {
  const variants = [
    baseline,
    application([historic, sales, buyer]),
    application([historic, sales, buyer, supplier, supplier]),
    application([historic, sales, buyer, supplier, override({ object: 'Account', page: 'Other' })]),
    application([historic, buyer, supplier]),
  ];
  for (const after of variants) assert.throws(() => validate(baseline, after));
});

test('rejects changes to existing overrides and unrelated app settings', () => {
  assert.throws(() => validate(baseline, application([sales, historic, buyer, supplier])));
  assert.throws(() => validate(baseline, application([historic, sales, buyer, supplier]).replace('<tabs>STEM__c</tabs>', '<tabs>Account</tabs>')));
  assert.throws(() => validate(baseline, application([historic, sales, buyer, supplier], '<description>changed</description>')));
});

test('rejects wrong object, page, role, form factor, record type, or assignment type', () => {
  const invalidRows = [
    override({ object: 'Account', page: 'FCOS_DEVEE_Invoice_Launcher_Buyer' }),
    override({ object: 'Invoice__c', page: 'Wrong_Page' }),
    override({ object: 'Invoice__c', page: 'FCOS_DEVEE_Invoice_Launcher_Buyer', profile: 'FCB Trader' }),
    override({ object: 'Invoice__c', page: 'FCOS_DEVEE_Invoice_Launcher_Buyer', formFactor: 'Small' }),
    override({ object: 'Invoice__c', page: 'FCOS_DEVEE_Invoice_Launcher_Buyer', recordType: 'Invoice__c.Other' }),
    override({ object: 'Invoice__c', page: 'FCOS_DEVEE_Invoice_Launcher_Buyer', type: 'Default' }),
  ];
  for (const row of invalidRows) assert.throws(() => validate(baseline, application([historic, sales, row, supplier])));
});

test('rejects existing invoice placement collisions and app-wide default assignments', () => {
  assert.throws(() => validate(application([historic, sales, buyer]), application([historic, sales, buyer, supplier])));
  const appDefault = '<actionOverrides><actionName>View</actionName><content>FCOS_DEVEE_Invoice_Launcher_Buyer</content><formFactor>Large</formFactor><pageOrSobjectType>Invoice__c</pageOrSobjectType><type>Flexipage</type></actionOverrides>';
  assert.throws(() => validate(baseline, application([historic, sales, buyer, supplier], appDefault)));
});

test('fails closed on malformed or externally defined XML and unknown environments', () => {
  const doctype = `<!DOCTYPE CustomApplication [<!ENTITY x SYSTEM "file:///etc/passwd">]>\n${placement}`;
  assert.throws(() => validate(baseline, doctype));
  assert.throws(() => validate(doctype, placement));
  assert.throws(() => validate(baseline, '<CustomApplication>'));
  assert.throws(() => validate(baseline, placement.replace('</CustomApplication>', '')));
  assert.throws(() => validate(baseline, placement, 'other'));
});

const reviewedComponents = [
  'ApexClass:FcosTradeProformaService',
  'ApexClass:FcosTradeProformaServiceTest',
  'FlexiPage:FCOS_DEVEE_Invoice_Launcher_Buyer',
  'FlexiPage:FCOS_DEVEE_Invoice_Launcher_Supplier',
  'LightningComponentBundle:fcosTradeInvoiceActions',
];

function descriptorReview() {
  const phases = environment => Object.fromEntries(['before', 'after'].map(phase => [phase, {
    path: `manifest/invoice-launcher-placement/${environment}-${phase}.app-meta.xml`,
    sha256: 'a'.repeat(64),
  }]));
  return {
    baselineMode: 'read-only-owned-tree-inventory',
    invoiceAppPlacement: Object.fromEntries(['devee', 'qat', 'production'].map(environment => [environment, phases(environment)])),
    permissionSets: [],
  };
}

test('binds each reviewed descriptor to its fixed Salesforce app and exact invoice package', () => {
  const result = invoiceAppPlacementDescriptors(descriptorReview(), reviewedComponents);
  assert.equal(result.devee.app, 'FCB');
  assert.equal(result.qat.app, 'FCB');
  assert.equal(result.production.app, 'FCB_BT');
  assert.equal(invoiceAppPlacementDescriptors({}, reviewedComponents), undefined);
});

test('rejects descriptor extensions, alternate paths, wrong components, and unrelated mutations', () => {
  const invalid = [];
  let review = descriptorReview();
  review.invoiceAppPlacement.other = review.invoiceAppPlacement.qat;
  invalid.push([review, reviewedComponents]);
  review = descriptorReview();
  review.invoiceAppPlacement.qat.app = 'FCB_BT';
  invalid.push([review, reviewedComponents]);
  review = descriptorReview();
  review.invoiceAppPlacement.production.after.path = 'manifest/invoice-launcher-placement/qat-after.app-meta.xml';
  invalid.push([review, reviewedComponents]);
  review = descriptorReview();
  review.invoiceAppPlacement.qat.before.sha256 = 'a'.repeat(63);
  invalid.push([review, reviewedComponents]);
  review = descriptorReview();
  review.permissionSets = ['ExtraPermission'];
  invalid.push([review, reviewedComponents]);
  review = descriptorReview();
  review.bootstrap = {};
  invalid.push([review, reviewedComponents]);
  invalid.push([descriptorReview(), [...reviewedComponents, 'ApexClass:Unreviewed']]);
  invalid.push([descriptorReview(), reviewedComponents.slice(1)]);
  for (const [value, components] of invalid) assert.throws(() => invoiceAppPlacementDescriptors(value, components));
});
