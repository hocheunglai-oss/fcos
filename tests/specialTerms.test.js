import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Special Terms is a default-visible Trading page with controlled management', () => {
  const layout = read('src/components/Layout.jsx');
  const workspaces = read('src/lib/workspaceStandards.js');
  const app = read('src/App.jsx');
  const auth = read('src/lib/authModules.js');
  const functions = read('api/functions/[name].js');

  assert.match(layout, /workspaceNavigation\('buyers_administrator'[\s\S]*workspaceNavigation\('markets'[\s\S]*workspaceNavigation\('special_terms'[\s\S]*workspaceNavigation\('hedge_desk'/);
  assert.match(workspaces, /buyers_administrator:[\s\S]*title: 'Account Managers'[\s\S]*markets:[\s\S]*title: 'Markets'[\s\S]*special_terms:[\s\S]*title: 'Special Terms'[\s\S]*hedge_desk:/);
  assert.match(app, /path="\/special-terms"[\s\S]*moduleId="special_terms"/);
  assert.match(auth, /id: 'special_terms_manage'/);
  assert.match(auth, /id: 'special_terms_clause_approve'/);
  assert.match(functions, /specialTermsSave:[\s\S]*\['special_terms'\]/);
  assert.match(functions, /specialTermsPdfExport: \['special_terms'\]/);
  assert.match(functions, /requireCapability\(context\.client, context\.profile, 'special_terms_manage'/);
  assert.match(functions, /activeGeneralManager\?\.id !== context\.profile\.id/);
});

test('Special Terms validates the authoritative Salesforce schema and rule lookups', () => {
  const service = read('api/_specialTerms.js');
  const salesforce = read('api/_salesforce.js');

  assert.match(service, /term: 'Special_Term__c'/);
  assert.match(service, /rule: 'Special_Term_Rule__c'/);
  assert.match(service, /clause: 'Special_Term_Clause__c'/);
  assert.match(service, /clauseVersion: 'Special_Term_Clause_Version__c'/);
  assert.match(service, /clauseAssignment: 'Special_Term_Clause_Assignment__c'/);
  assert.match(service, /'Special_Term__c', \{ referenceTo: OBJECTS\.term/);
  assert.match(service, /name === 'Clause__c' \? \{\} : \{ updateable: true \}/);
  assert.match(service, /clauseAssignment, OBJECTS\.clauseAssignment, 'Special_Term__c'.*createable: true/s);
  assert.match(service, /'Account__c', \{ referenceTo: OBJECTS\.account/);
  assert.match(service, /'Port__c', \{ referenceTo: OBJECTS\.port/);
  assert.match(service, /'Product__c', \{ referenceTo: OBJECTS\.product/);
  assert.match(service, /Inactive_Suspended__c = false/);
  assert.match(service, /IsActive = true/);
  assert.match(service, /Account WHERE Inactive_Suspended__c = false AND \(Name LIKE/);
  assert.match(service, /secondary: row\.Company_Code__c \|\| 'No CL Key'/);
  assert.match(service, /getSpecialTermForExport/);
  assert.match(service, /WHERE Id = '\$\{soql\(id\)\}' LIMIT 1/);
  assert.match(service, /Clause_Structure_Status__c/);
  assert.match(service, /Original_Terms_Text__c/);
  assert.match(service, /Confirmation_Clause_Status__c/);
  assert.match(service, /Nomination_Clause_Status__c/);
  assert.match(service, /Projection__c/);
  assert.match(service, /if \(error\?\.code !== 'SPECIAL_TERMS_SCHEMA_INVALID'\) throw error;/);
  assert.match(service, /return loadSpecialTermsSchema\(\{ force: true, write \}\);/);
  assert.match(salesforce, /DEFAULT_API_VERSION = 'v67\.0'/);
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
  assert.match(service, /SPECIAL_TERMS_RETIRE_REQUIRED/);
  assert.doesNotMatch(service, /sanitizeRichText/);
  assert.match(service, /special_terms_operations/);
  assert.match(service, /operation_status === 'succeeded'/);
});

test('Special Terms data is service-only and included in the Universal Audit Trail', () => {
  const migration = read('supabase/migrations/20260802110000_salesforce_special_terms.sql');
  const clauseMigration = read('supabase/migrations/20260809173753_special_term_clause_bank.sql');
  const functions = read('api/functions/[name].js');
  const page = read('src/pages/SpecialTerms.jsx');
  const clauseService = read('api/_specialTermClauses.js');

  assert.match(migration, /alter table public\.special_terms_operations enable row level security/);
  assert.match(migration, /revoke all on table public\.special_terms_operations from anon, authenticated/);
  assert.match(migration, /grant all on table public\.special_terms_operations to service_role/);
  assert.match(clauseMigration, /special_terms_clause_approve/);
  assert.match(clauseMigration, /Special_Term_Clause_Assignment__c/);
  assert.match(clauseMigration, /revoke all on table public\.special_terms_operations from anon, authenticated/);
  assert.match(functions, /source: 'Special Terms'/);
  assert.match(page, /Salesforce calculates priority after saving/);
  assert.match(page, /Search Account name or CL Key/);
  assert.match(page, /<PageMethodology \{\.\.\.SPECIAL_TERMS_METHODOLOGY\}/);
  assert.match(page, /specialTermsDocumentExport/);
  assert.match(page, /source: 'live'/);
  assert.match(page, /downloadTerms\(selectedTerms, 'pdf'\)/);
  assert.match(page, /downloadTerms\(selectedTerms, 'docx'\)/);
  assert.match(functions, /specialTermsDocumentExport/);
  assert.match(functions, /Saved drafts may be downloaded as watermarked PDF only/);
  assert.match(functions, /special_terms_document_exported/);
  assert.match(functions, /outcome: 'success'/);
  assert.match(page, /Copy Confirmation special remark/);
  assert.match(page, /Copy Nomination special remark/);
  assert.match(page, /richTextToCopyText/);
  assert.match(page, /<WholeTermRevisionPanel/);
  assert.match(page, /<MigrationBatchPanel/);
  assert.match(page, /canDraft \?\? workspace\.canManage/);
  assert.match(page, /Migration Queue/);
  assert.match(page, /<ClauseBankPanel/);
  const projectionSection = read('src/components/special-terms/ClauseProjectionSection.jsx');
  assert.match(projectionSection, /<ClauseComposer/);
  assert.match(projectionSection, /<MigrationReviewPanel/);
  assert.match(projectionSection, /wholeTermRevision/);
  const revisionPanel = read('src/components/special-terms/WholeTermRevisionPanel.jsx');
  assert.match(revisionPanel, /specialTermRevisionSave/);
  assert.match(revisionPanel, /specialTermRevisionApprove/);
  assert.match(revisionPanel, /specialTermRevisionRollback/);
  assert.match(revisionPanel, /specialTermsDocumentExport/);
  assert.match(revisionPanel, /source: mode/);
  assert.match(revisionPanel, /expectedRevisionLastModifiedAt/);
  assert.match(revisionPanel, /Start whole-term draft/);
  assert.match(revisionPanel, /Preserved live Salesforce legacy projections/);
  assert.match(revisionPanel, /richTextToCopyText\(source\.text\)/);
  assert.match(revisionPanel, /all three projections and the reviewed rules/);
  const previewModel = read('src/lib/specialTermDocumentPreview.js');
  const preview = read('src/components/special-terms/SpecialTermDocumentPreview.jsx');
  assert.match(previewModel, /revision\.projections\.termsText/);
  assert.doesNotMatch(previewModel, /confirmationRemark: text/);
  assert.doesNotMatch(previewModel, /nominationRemark: text/);
  assert.match(preview, /SPECIAL TERMS/i);
  assert.match(preview, /Page \{pageIndex \+ 1\} of \{pageCount\}/);
  assert.match(preview, /Fit width/);
  assert.match(preview, /SPECIAL_TERMS_DOCUMENT_TOKENS\.list\.hangingIndentMm/);
  assert.match(preview, /SPECIAL_TERMS_DOCUMENT_TOKENS\.list\.nestedIndentMm/);
  assert.match(preview, /Word is editable; Salesforce remains authoritative\. Attachments are PDF-only\./);
  const batchPanel = read('src/components/special-terms/MigrationBatchPanel.jsx');
  assert.match(batchPanel, /specialTermMigrationBatchList/);
  assert.match(batchPanel, /At most 20 related terms per batch/);
  assert.match(batchPanel, /Manual segmentation/);
  const clauseBank = read('src/components/special-terms/ClauseBankPanel.jsx');
  assert.match(clauseBank, /value: 'Legacy', label: 'Legacy'/);
  assert.match(clauseBank, /clause\.provenance/);
  assert.match(page, /<MigrationInventoryPanel/);
  assert.doesNotMatch(page, /specialTermEditorValue\(termForm\.termsText\)/);
  assert.match(clauseService, /compileClauseList/);
  assert.match(clauseService, /Confirmation Remark/);
  assert.match(clauseService, /Nomination Remark/);
  assert.match(clauseService, /allOrNone: true/);
  assert.match(clauseService, /composite\/graph/);
  assert.match(clauseService, /upgradeAvailable/);
  assert.match(clauseService, /selectedClauseVersionId/);
  assert.match(clauseService, /hasMaterialDifference/);
  assert.doesNotMatch(clauseMigration, /Clause_Text__c|Terms_Text__c/);
  assert.doesNotMatch(page, /view: activeTab,[\s\S]*search: search\.trim\(\)/);
  assert.match(page, /Type \{deleteTarget\.row\.name\} to confirm/);
  assert.doesNotMatch(page, /termForm\?\.termsText\.trim\(\)\.length < 3/);
});

test('Special Terms owns the Salesforce response metadata used by its status bar', () => {
  const page = read('src/pages/SpecialTerms.jsx');
  const component = page.split('export default function SpecialTerms()')[1] || '';
  const stateDeclaration = component.indexOf('const [responseMeta, setResponseMeta] = useState(null);');
  const loadCallback = component.indexOf('const load = useCallback');

  assert.ok(stateDeclaration >= 0, 'Special Terms must declare response metadata in the page component');
  assert.ok(stateDeclaration < loadCallback, 'response metadata state must be in scope for the load callback');
});

test('System Health exposes redacted Special-Term migration readiness', () => {
  const handler = read('api/functions/[name].js');
  assert.match(handler, /async function specialTermsMigrationHealthRow/);
  assert.match(handler, /Special-Term Clause Migration/);
  assert.match(handler, /aiDraftingConfigured: Boolean\(process\.env\.OPENAI_API_KEY\)/);
  assert.match(handler, /cachedHealthCheck\('special-terms-migration'/);
  assert.doesNotMatch(handler, /specialTermsMigrationHealthRow[\s\S]{0,2500}Clause_Text__c/);
});
