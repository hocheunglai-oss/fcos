import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const repositoryFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Account Record Type keeps broker flags inside a responsive card grid', async () => {
  const [template, styles] = await Promise.all([
    repositoryFile('force-app/main/default/lwc/fcbAccountRecordType/fcbAccountRecordType.html'),
    repositoryFile('force-app/main/default/lwc/fcbAccountRecordType/fcbAccountRecordType.css'),
  ]);

  assert.match(template, /class="record-type-panel"/);
  assert.match(template, /class="record-type-grid"/);
  assert.ok(template.indexOf('label="Is Agent"') < template.indexOf('label="Is Broker"'));
  assert.match(template, /label="Hidden Broker Company"[^>]*variant="label-stacked"/s);
  assert.doesNotMatch(template, /slds-size_1-of-4/);
  assert.match(styles, /grid-template-columns:\s*repeat\(auto-fit, minmax\(10\.5rem, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 48rem\)/);
});

test('Reconfirm workspace groups supplier work by STEM and avoids the flat datatable', async () => {
  const [template, controller, styles] = await Promise.all([
    repositoryFile('force-app/main/default/lwc/fcbReconfirmProcessing/fcbReconfirmProcessing.html'),
    repositoryFile('force-app/main/default/lwc/fcbReconfirmProcessing/fcbReconfirmProcessing.js'),
    repositoryFile('force-app/main/default/lwc/fcbReconfirmProcessing/fcbReconfirmProcessing.css'),
  ]);

  assert.match(template, /Reconfirm suppliers and final charges/);
  assert.match(template, /STEM reconfirmation messages/);
  assert.match(template, /CIA supplier reconfirmation/);
  assert.match(template, /Who must confirm final supplier charges\?/);
  assert.match(controller, /Review required before supplier invoice/);
  assert.match(template, /Save review requirements/);
  assert.match(controller, /Automatically required/);
  assert.match(controller, /Needs assignment/);
  assert.match(template, /for:each=\{supplierCiaGroups\}/);
  assert.match(template, /for:each=\{variableChargeGroups\}/);
  assert.doesNotMatch(template, /lightning-datatable/);
  assert.match(controller, /groupRowsByStem\(rows, type\)/);
  assert.match(controller, /ReconfirmProcessing\.saveCiaChanges/);
  assert.match(controller, /expectedLastModifiedAt:\s*record\.lastModifiedAt/);
  assert.doesNotMatch(controller, /lightning\/uiRecordApi/);
  assert.doesNotMatch(controller, /Promise\.all\(updatePromises\)/);
  assert.match(controller, /this\.stems = this\.stems\.map/);
  assert.doesNotMatch(controller, /getPayablePayments/);
  assert.doesNotMatch(controller, /Hello World/);
  assert.match(styles, /\.variable-row\s*\{/);
  assert.match(styles, /@media \(max-width: 48rem\)/);
});
