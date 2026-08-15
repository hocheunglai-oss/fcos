import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { specialTermClauseServiceInternals } from '../api/_specialTermClauses.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('global publication preview tokens bind the proposal and expire', () => {
  const secret = 'test-only-special-terms-preview-secret-with-32-bytes';
  const proposal = {
    shortName: 'Invoice Due Without BDR',
    category: 'Pricing and Payment',
    clauseText: 'Buyer shall pay the invoice without awaiting the BDR.',
    reason: 'Clarify the approved payment obligation.',
  };
  const payload = {
    version: 1,
    clauseId: 'a01000000000001AAA',
    baseVersionId: 'a02000000000001AAA',
    draftVersionId: null,
    impactHash: 'a'.repeat(64),
    proposedHash: specialTermClauseServiceInternals.publicationProposalHash(proposal),
    expiresAt: 10_000,
  };
  const token = specialTermClauseServiceInternals.signPublicationPreview(payload, secret);
  assert.deepEqual(specialTermClauseServiceInternals.verifyPublicationPreview(token, secret, 9_000), payload);
  assert.throws(() => specialTermClauseServiceInternals.verifyPublicationPreview(`${token}x`, secret, 9_000), /invalid/i);
  assert.throws(() => specialTermClauseServiceInternals.verifyPublicationPreview(token, secret, 10_000), /expired/i);
  assert.notEqual(
    payload.proposedHash,
    specialTermClauseServiceInternals.publicationProposalHash({ ...proposal, clauseText: `${proposal.clauseText} Changed.` }),
  );
});

test('inline editing is role-aware across all clause projections, local, and no-refresh', () => {
  const composer = read('src/components/special-terms/ClauseComposer.jsx');
  const dialog = read('src/components/special-terms/ClauseInlineEditDialog.jsx');
  const projection = read('src/components/special-terms/ClauseProjectionSection.jsx');
  const revision = read('src/components/special-terms/WholeTermRevisionPanel.jsx');
  const page = read('src/pages/SpecialTerms.jsx');
  assert.match(composer, /Edit shared Clause Bank wording/);
  assert.match(composer, /projectionLabel=\{projectionLabel\}/);
  assert.match(projection, /canEditClause=\{canEditClause\}/);
  assert.match(projection, /canPublishClause=\{canPublishClause\}/);
  assert.match(projection, /projectionLabel=\{projectionDetail\.label\}/);
  assert.doesNotMatch(projection, /canEditClause=\{isTermsText/);
  assert.match(dialog, /This \{projectionLabel\} row references one shared clause identity/);
  assert.doesNotMatch(dialog, /This Terms Text row references/);
  assert.match(dialog, /Saving creates a proposed Draft|proposed Draft/);
  assert.match(dialog, /As an authorized approver, you may approve the edited base from this window/);
  assert.match(dialog, /Ready for approval review/);
  assert.match(dialog, /Review approval of editing base/);
  assert.match(dialog, /Approve editing base/);
  assert.match(dialog, /Approve edited v1 Draft directly/);
  assert.match(dialog, /specialTermClauseApprove/);
  assert.match(dialog, /applyDraftEdits: true/);
  assert.match(dialog, /No live Special Term is changed by this initial approval/);
  assert.match(dialog, /specialTermClauseEditPreview/);
  assert.match(dialog, /specialTermClauseGlobalPublish/);
  assert.match(dialog, /Type \{review\.confirmationLabel\} exactly to publish/);
  assert.match(dialog, /No live terms change/);
  assert.match(revision, /localPublicationBlocked=\{unsaved \|\| hasUnsavedParentChanges\}/);
  assert.match(revision, /'Unavailable account'/);
  assert.match(revision, /'Unavailable port'/);
  assert.doesNotMatch(revision, /label \|\| id/);
  assert.match(page, /applyInlineClausePublication/);
  const inlineApply = page.match(/const applyInlineClausePublication = [\s\S]*?\n  };/)?.[0] || '';
  assert.doesNotMatch(inlineApply, /load\(|refreshOpenTerm/);
});

test('whole-term rule details expose relationship names while retaining lookup ids', () => {
  const mapped = specialTermClauseServiceInternals.mapDetailRule({
    Id: 'a10000000000001AAA',
    Name: 'Buyer Singapore rule',
    Account__c: '001000000000001AAA',
    Account__r: { Name: 'Example Shipping Limited', Company_Code__c: 'EXAMPLE' },
    Port__c: 'a20000000000001AAA',
    Port__r: { Name: 'Singapore', Country__c: 'SINGAPORE' },
    Product__c: '01t000000000001AAA',
    Product__r: { Name: 'VLSFO' },
    Supplier_Buyer__c: 'Buyer',
    Priority__c: 10,
  });
  assert.equal(mapped.accountId, '001000000000001AAA');
  assert.equal(mapped.accountName, 'Example Shipping Limited');
  assert.equal(mapped.accountClKey, 'EXAMPLE');
  assert.equal(mapped.portId, 'a20000000000001AAA');
  assert.equal(mapped.portName, 'Singapore');
  assert.equal(mapped.portCountry, 'SINGAPORE');
  assert.equal(mapped.productName, 'VLSFO');

  const unavailable = specialTermClauseServiceInternals.mapDetailRule({ Account__c: '001000000000002AAA', Port__c: 'a20000000000002AAA' });
  assert.equal(unavailable.accountName, 'Unavailable account');
  assert.equal(unavailable.portName, 'Unavailable port');
  assert.doesNotMatch(`${unavailable.accountName} ${unavailable.portName}`, /001000|a20000/);
});

test('global publication is fail-closed across API, Salesforce, and Supabase', () => {
  const service = read('api/_specialTermClauses.js');
  const policies = read('api/_handlerPolicyRegistry.js');
  const migration = read('supabase/migrations/20260815150819_special_term_global_publication.sql');
  const apex = read('force-app/main/default/classes/SpecialTermClausePublicationService.cls');
  assert.match(service, /FCOS_SPECIAL_TERMS_PREVIEW_SECRET/);
  assert.match(service, /clause_global_publish/);
  assert.match(service, /Direct editing-base approval is limited to a Draft-only v1 clause/);
  assert.match(service, /initialDraftEdit: applyDraftEdits/);
  assert.match(service, /Content_Hash__c: clauseHash\(approvedText\)/);
  assert.match(service, /expectedImpactHash/);
  assert.match(policies, /specialTermClauseGlobalPublish:[^\n]+special_terms_clause_approve/);
  assert.match(migration, /'clause_global_publish'/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.special_terms_operations from anon, authenticated/);
  assert.doesNotMatch(migration, /Clause_Text__c|clauseText|audit_reason\s*=/);
  assert.match(apex, /Database\.setSavepoint\(\)/);
  assert.match(apex, /Database\.rollback\(checkpoint\)/);
  assert.match(apex, /PENDING_WHOLE_TERM_REVISION/);
  assert.match(apex, /State__c = 'Historical'/);
  assert.match(apex, /SpecialTermClauseCompiler\.compileAll/);
});
