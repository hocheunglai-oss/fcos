import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Special Terms is a default-visible Trading page with controlled management', () => {
  const layout = read('src/components/Layout.jsx');
  const app = read('src/App.jsx');
  const auth = read('src/lib/authModules.js');
  const functions = read('api/functions/[name].js');

  assert.match(layout, /Account Managers[\s\S]*Markets[\s\S]*Special Terms[\s\S]*Hedge Desk/);
  assert.match(app, /path="\/special-terms"[\s\S]*moduleId="special_terms"/);
  assert.match(auth, /id: 'special_terms_manage'/);
  assert.match(functions, /specialTermsSave:[\s\S]*\['special_terms'\]/);
  assert.match(functions, /requireCapability\(context\.client, context\.profile, 'special_terms_manage'/);
});

test('Special Terms validates the authoritative Salesforce schema and rule lookups', () => {
  const service = read('api/_specialTerms.js');

  assert.match(service, /term: 'Special_Term__c'/);
  assert.match(service, /rule: 'Special_Term_Rule__c'/);
  assert.match(service, /'Special_Term__c', \{ referenceTo: OBJECTS\.term/);
  assert.match(service, /'Account__c', \{ referenceTo: OBJECTS\.account/);
  assert.match(service, /'Port__c', \{ referenceTo: OBJECTS\.port/);
  assert.match(service, /'Product__c', \{ referenceTo: OBJECTS\.product/);
  assert.match(service, /Inactive_Suspended__c = false/);
  assert.match(service, /IsActive = true/);
  assert.match(service, /Account WHERE Inactive_Suspended__c = false AND \(Name LIKE/);
  assert.match(service, /secondary: row\.Company_Code__c \|\| 'No CL Key'/);
});

test('Salesforce owns priority while FCOS protects mutations and deletion', () => {
  const service = read('api/_specialTerms.js');
  const rulePayload = service.match(/function rulePayload[\s\S]*?\n\}/)?.[0] || '';

  assert.doesNotMatch(rulePayload, /Priority__c/);
  assert.match(service, /assertCurrent\(/);
  assert.match(service, /allOrNone: true/);
  assert.match(service, /Salesforce computes Priority__c only on insert/);
  assert.match(service, /referenceId: 'newRule'/);
  assert.match(service, /composite\/sobjects\?ids=/);
  assert.match(service, /confirmationName/);
  assert.match(service, /sanitizeRichText/);
  assert.match(service, /special_terms_operations/);
  assert.match(service, /operation_status === 'succeeded'/);
});

test('Special Terms data is service-only and included in the Universal Audit Trail', () => {
  const migration = read('supabase/migrations/20260802110000_salesforce_special_terms.sql');
  const functions = read('api/functions/[name].js');
  const page = read('src/pages/SpecialTerms.jsx');

  assert.match(migration, /alter table public\.special_terms_operations enable row level security/);
  assert.match(migration, /revoke all on table public\.special_terms_operations from anon, authenticated/);
  assert.match(migration, /grant all on table public\.special_terms_operations to service_role/);
  assert.match(functions, /source: 'Special Terms'/);
  assert.match(page, /Salesforce calculates priority after saving/);
  assert.match(page, /Search Account name or CL Key/);
  assert.match(page, /<PageMethodology \{\.\.\.SPECIAL_TERMS_METHODOLOGY\}/);
  assert.match(page, /Type \{deleteTarget\.row\.name\} to confirm/);
  assert.doesNotMatch(page, /termForm\?\.termsText\.trim\(\)\.length < 3/);
});
