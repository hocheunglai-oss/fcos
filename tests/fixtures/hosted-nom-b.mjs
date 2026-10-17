import { fcosSalesforceEnvironment } from '../../config/fcosConnections.js';
import { dependencyHash, loadNomBLegacyAssumptions } from '../../scripts/lib/hosted-release/dependencies.mjs';

// Synthetic retained originals. The production setup separately pins actual legacy history.
export async function nomBFixture({ manifest: m, now }) {
  const H = 'a'.repeat(64), devee = fcosSalesforceEnvironment('devee'), artifacts = new Map();
  const put = value => { const bytes = Buffer.from(JSON.stringify(value)), sha256 = dependencyHash(bytes); artifacts.set(sha256, bytes); return sha256; };
  const ref = value => ({ path: '/untrusted/path/original.json', sha256: put(value) });
  const id = prefix => prefix + '1'.repeat(15), fixtureIds = { STEM__c: id('a0H'), Nomination__c: id('a03'), Stem_Status__c: id('a0K'), ContentDocument: id('069'), ContentVersion: id('068') };
  const objects = ['Nomination__c','STEM__c','Stem_Status__c','ContentVersion','ContentDocument','ContentDocumentLink'];
  const entities = ['01I111111111111','01I222222222222','01I333333333333','ContentVersion','ContentDocument','ContentDocumentLink'];
  const names = ['ContentDocumentLinkTriggerHandler','ContextManager','FcosXeroContactSyncService','NominationTriggerHandler','StemTriggerHandler','VariableChargeInvoiceReadinessService'];
  const classes = names.map((Name, i) => ({ Id: '01p' + String(i).repeat(15), Name, Body: 'reviewed body ' + Name, LastModifiedDate: '2026-10-09T06:06:48.000+0000' }));
  const triggers = ['StemTrigger','FcosXeroContactSyncStemTrigger','NominationTrigger','ContentDocumentTrigger','ContentDocumentLinkTrigger'].map((Name, i) => ({ Id: '01q' + String(i).repeat(15), Name,
    TableEnumOrId: ['STEM__c','STEM__c','Nomination__c','ContentDocument','ContentDocumentLink'][i], Status: 'Active', Body: 'reviewed body ' + Name, LastModifiedDate: classes[0].LastModifiedDate }));
  const responses = { ApexClass: classes, ApexTrigger: triggers,
    ValidationRule: [{ Id: id('03d'), ValidationName: 'ReviewedRule', Active: true, EntityDefinitionId: entities[0], LastModifiedDate: classes[0].LastModifiedDate }],
    WorkflowRule: [{ Id: id('01Q'), Name: 'ReviewedWorkflow', TableEnumOrId: 'STEM__c', LastModifiedDate: classes[0].LastModifiedDate }], FlowDefinitionView: [], Xero_Contact_Sync_Setting__c: [] };
  const result = records => ({ done: true, totalSize: records.length, records });
  const evidence = {}, comparisons = {}, schemas = {};
  for (const object of ['Nomination__c','STEM__c','ContentVersion']) { schemas[object] = { name: object, fields: [{ name: 'Id', type: 'id' }] }; evidence[`describe-${object}.json`] = ref({ result: schemas[object] }); }
  for (const [object, name, field, values] of [['ApexClass','relevant-class-index.json','Name',names],['ApexTrigger','relevant-active-trigger-index.json','TableEnumOrId',objects],
    ['ValidationRule','relevant-active-validation-index.json','EntityDefinitionId',entities],['WorkflowRule','relevant-workflow-index.json','TableEnumOrId',objects],['FlowDefinitionView','relevant-active-flows.json','TriggerObjectOrEventId',entities]]) {
    const records = responses[object].map(({ Body, ...row }) => row);
    evidence[name] = ref({ path: `/services/data/v67.0/query?q=SELECT Id FROM ${object} WHERE ${field} IN (${values.map(v => "'" + v + "'").join(',')})`, result: result(records) });
    comparisons[name] = { freshIndex: evidence[name] };
    if (object.startsWith('Apex')) { const bodies = responses[object].map(({ Body, ...row }) => ({ ...row, bodySha256: dependencyHash(Body) }));
      comparisons[name].acceptedPriorBodiesOrIndex = ref({ result: result(bodies) }); comparisons[name].acceptedBodyHashesReused = Object.fromEntries(bodies.map(row => [row.Name, row.bodySha256])); }
  }
  const automation = { orgId: devee.orgId, username: devee.username, completeRelevantIndexesAndLastModifiedUnchanged: true, noRelevantActiveRecordFlows: true, freshIndexComparisons: comparisons };
  evidence['automation-current-pins.json'] = ref(automation); evidence['xero-sync-enabled-only.json'] = ref({ result: result([]) });
  const environment = { orgId: devee.orgId, username: devee.username, userId: id('005'), isSandbox: true, instanceUrl: devee.instanceUrl, apiVersion: 'v67.0' };
  evidence['identity.json'] = ref({ ...environment, userinfo: { organization_id: devee.orgId, preferred_username: devee.username, user_id: environment.userId } });
  const scope = { syntheticFixture: true, candidateSha: m.candidate.sha, orgId: devee.orgId, username: devee.username, stemId: fixtureIds.STEM__c, nominationId: fixtureIds.Nomination__c, fileSha256: H, fileSize: 3 };
  const live = { candidateSha: m.candidate.sha, sourceSha256: H, harnessSha256: H, target: { orgId: devee.orgId, username: devee.username, isSandbox: true }, operationId: 'original-operation',
    coreVerified: true, exactReplayVerified: true, freshListAbsent: true, postsTotal: 1, fileSha256: H, fileSize: 3, scopeFingerprint: H,
    startedAt: '2026-10-10T18:35:48.358Z', completedAt: '2026-10-10T18:40:17.837Z', result: { stemId: fixtureIds.STEM__c, nominationId: fixtureIds.Nomination__c, contentDocumentId: fixtureIds.ContentDocument, contentVersionId: fixtureIds.ContentVersion, receivedStatus: '🟢', verified: true } };
  const dependencies = { kind: 'actual_devee_nom_b_schema_automation_admission', orgId: devee.orgId, username: devee.username, apiVersion: 'v67.0', sourceSha256: H,
    fieldsAndPermissionsVerified: true, automationReviewed: true, evidence, nominationSchemaSha256: evidence['describe-Nomination__c.json'].sha256,
    stemSchemaSha256: evidence['describe-STEM__c.json'].sha256, contentSchemaSha256: evidence['describe-ContentVersion.json'].sha256, automationSha256: evidence['automation-current-pins.json'].sha256 };
  const a = { scope: put(scope), dependencies: put(dependencies), liveEvidence: put(live), desktopEvidence: put({ ...live, desktopVerified: true, forbiddenRequests: [], pageErrors: [] }) };
  a.admission = put({ kind: 'root_admitted_exact04ee_nom_b_devee_filing', candidateSha: m.candidate.sha, sourceSha256: H, harnessSha256: H, scopeSha256: H,
    dependenciesEvidence: { sha256: a.dependencies }, fixtureEvidence: ref({ orgId: devee.orgId, username: devee.username, stemId: fixtureIds.STEM__c, nominationId: fixtureIds.Nomination__c, statusId: fixtureIds.Stem_Status__c, ownedSynthetic: true }) });
  a.cleanup = put({ kind: 'root_actual_owned_devee_document_and_fixture_cleanup_acceptance', accepted: true, ownedDocumentAndVersionDeleted: true, allThreeOwnedFixtureRecordsDeleted: true,
    activeDocumentLinksZero: true, retainedAccountAndPortExactlyPreserved: true, singleAllOrNoneCompositeOnly: true, financialActions: false, productionChanged: false, actualReadbacks: Array.from({ length: 5 }, (_, i) => ref({ cleanup: i })) });
  a.acceptance = put({ kind: 'root_actual_exact04ee_disposable_nom_b_acceptance', accepted: true, candidateSha: m.candidate.sha, candidateSourceSha256: H, harnessSha256: H,
    operationId: live.operationId, ownedContentDocumentId: fixtureIds.ContentDocument, ownedContentVersionId: fixtureIds.ContentVersion, singleProviderPost: true, durableLedgerCompleted: true,
    exactReplayNoExtraPost: true, freshMissingListAbsent: true, buyerReceivedGreen: true, buyerSentAndPdfRemainRed: true, allOtherReadFixtureFieldsUnchanged: true,
    documentLinksOnlyOwnedBuyerAndAuthenticatedCreator: true, retainedAccountPortActive: true, localSyntheticDeveeSeamOnly: true, financialChildCategoriesVerifiedZero: 9,
    productionChanged: false, normalRoleSessionProved: false, deployedFifteenModulePreviewAttestation: false, scope: { sha256: a.scope }, admission: { sha256: a.admission },
    actualTest: [{ sha256: a.liveEvidence }, { sha256: a.desktopEvidence }], actualReadbacks: Array.from({ length: 9 }, (_, i) => ref({ read: i })) });
  a.reuseDecision = put({ kind: 'root_accepted_nom_b_relevant_change_reuse_decision', accepted: true, passingProof: { sha256: a.acceptance }, cleanupClosure: { sha256: a.cleanup }, candidateSha: m.candidate.sha,
    candidateSourceSha256: H, reuseForUnrelatedWorkflowOrDocumentationChanges: true, rerunAffectedBehaviorForRelevantSourceDependencyRuntimeConfigEnvironmentChangeOrFailure: true, freshBoundaryReadsRemainRequiredForNewWrites: true, productionAuthorizedByThisDecision: false });
  const relevantInputs = { sourceSha256: H, harnessSha256: H,
    salesforceSourceSha256: dependencyHash(Object.fromEntries(['nominationSchemaSha256','stemSchemaSha256','contentSchemaSha256','automationSha256'].map(key => [key, dependencies[key]]))),
    fixtureSha256: dependencyHash({ scopeArtifactSha256: a.scope, scopeFingerprint: H, cleanupArtifactSha256: a.cleanup }), environmentSha256: dependencyHash(environment) };
  const handoff = { kind: 'fcos_reviewed_nom_b_legacy_import', manifestHash: dependencyHash(m), candidateSha: m.candidate.sha, originalCandidateSha: m.candidate.sha,
    candidateSalesforceSourceSha256: m.candidate.salesforceSourceSha256, artifacts: a, relevantInputs };
  const f = { manifest: m, handoff, artifacts, put, live, responses, schemas, environment, fixtureIds,
    verifyHandoff: async ({ handoffSha256 }) => ({ verified: true, handoffSha256, manifestHash: dependencyHash(m), financialAuthority: false }),
    readArtifact: async ({ sha256 }) => artifacts.get(sha256), measureInputs: async () => ({ readOnly: true, capturedAt: new Date(now).toISOString(), inputs: handoff.relevantInputs }), now: () => now };
  f.legacy = await loadNomBLegacyAssumptions(f); return f;
}
