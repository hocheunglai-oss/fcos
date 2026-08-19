import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { getApiVersion, getInstanceUrl, sfQuery, sfRequest } from './_salesforce.js';
import { expireRuntimeCacheTags, getOrLoadRuntimeCache } from './_runtimeCache.js';
import {
  assertCurrent,
  currentRecord,
  deletionAuthorization,
  failOperation,
  finishOperation,
  isSpecialTermsRecordCreator,
  listSpecialTerms,
  normalizedEmail,
  reserveOperation,
  resolveSpecialTermsSchema,
  salesforceId,
  soql,
  specialTermsError,
  termMetadataPayload,
  text,
  validateRuleLookups,
} from './_specialTerms.js';
import {
  CLAUSE_CATEGORIES,
  CLAUSE_LIST_STYLES,
  CLAUSE_PROJECTIONS,
  canonicalClauseKey,
  clauseSimilarity,
  clauseHash,
  compileClauseList,
  hasMaterialDifference,
  hasTopLevelListMarker,
  normalizeClauseText,
  parseLegacyClauses,
  shortNameKey,
  suggestClauseCategory,
  suggestClauseShortName,
} from './_specialTermClauseModel.js';
import { DEFAULT_DASHBOARD_AI_MODEL } from './_dashboardAi.js';

const OBJECTS = Object.freeze({
  term: 'Special_Term__c',
  clause: 'Special_Term_Clause__c',
  version: 'Special_Term_Clause_Version__c',
  assignment: 'Special_Term_Clause_Assignment__c',
  consolidation: 'Special_Term_Clause_Consolidation__c',
  consolidationMap: 'Special_Term_Clause_Consolidation_Map__c',
  revision: 'Special_Term_Revision__c',
  revisionClause: 'Special_Term_Revision_Clause__c',
});
const SALESFORCE_ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const PROJECTION_FIELDS = Object.freeze({
  termsText: Object.freeze({ key: 'termsText', value: CLAUSE_PROJECTIONS.termsText.value, label: CLAUSE_PROJECTIONS.termsText.label, textField: 'Terms_Text__c', statusField: 'Clause_Structure_Status__c', hashField: 'Clause_Compiled_Hash__c', originalField: 'Original_Terms_Text__c', batchField: 'Clause_Migration_Batch_Id__c', styleField: null, defaultStyle: 'Numbered' }),
  confirmationRemark: Object.freeze({ key: 'confirmationRemark', value: CLAUSE_PROJECTIONS.confirmationRemark.value, label: CLAUSE_PROJECTIONS.confirmationRemark.label, textField: 'Special_Remark_in_Confirmation__c', statusField: 'Confirmation_Clause_Status__c', hashField: 'Confirmation_Compiled_Hash__c', originalField: 'Original_Confirmation_Remark__c', batchField: 'Confirmation_Migration_Batch_Id__c', styleField: 'Confirmation_Clause_Style__c', defaultStyle: 'Hyphen' }),
  nominationRemark: Object.freeze({ key: 'nominationRemark', value: CLAUSE_PROJECTIONS.nominationRemark.value, label: CLAUSE_PROJECTIONS.nominationRemark.label, textField: 'Special_Remark_in_Nomination__c', statusField: 'Nomination_Clause_Status__c', hashField: 'Nomination_Compiled_Hash__c', originalField: 'Original_Nomination_Remark__c', batchField: 'Nomination_Migration_Batch_Id__c', styleField: 'Nomination_Clause_Style__c', defaultStyle: 'Hyphen' }),
});
const PROJECTION_LIST = Object.freeze(Object.values(PROJECTION_FIELDS));

function projectionConfig(value = 'termsText') {
  const normalized = text(value, 40);
  const config = PROJECTION_LIST.find((candidate) => candidate.key === normalized || candidate.value === normalized);
  if (!config) throw specialTermsError('Clause projection must be Terms Text, Confirmation Remark, or Nomination Remark.', 400, 'SPECIAL_TERMS_PROJECTION_INVALID');
  return config;
}

function projectionStyle(config, value) {
  if (!config.styleField) return 'Numbered';
  const style = text(value, 20) || config.defaultStyle;
  if (!CLAUSE_LIST_STYLES.includes(style)) throw specialTermsError('Remark style must be Numbered or Hyphen.', 400, 'SPECIAL_TERMS_STYLE_INVALID');
  return style;
}

function projectionWhere(config) {
  return `Projection__c = '${soql(config.value)}'`;
}

function isId(value) {
  return SALESFORCE_ID.test(String(value || ''));
}

function failureFromComposite(result) {
  for (const response of result?.compositeResponse || []) {
    if (response.httpStatusCode < 200 || response.httpStatusCode >= 300) return response;
    const bodyRows = Array.isArray(response.body) ? response.body : [response.body];
    const failedRow = bodyRows.find((row) => row && (row.success === false || row.hasErrors === true || (Array.isArray(row.errors) && row.errors.length > 0)));
    if (failedRow) return {
      ...response,
      body: Array.isArray(failedRow.errors) && failedRow.errors.length ? failedRow.errors : [failedRow],
    };
  }
  return null;
}

function assertComposite(result, fallback) {
  const failure = failureFromComposite(result);
  if (!failure) return;
  const message = failure.body?.[0]?.message || failure.body?.message || fallback;
  throw specialTermsError(message, failure.httpStatusCode || 502, 'SPECIAL_TERMS_SALESFORCE_WRITE_FAILED');
}

function assertCompositeGraph(result, fallback) {
  const graph = result?.graphs?.[0];
  const responses = graph?.graphResponse?.compositeResponse || graph?.compositeResponse || [];
  const failure = failureFromComposite({ compositeResponse: responses });
  if (graph?.isSuccessful === false || failure) {
    const message = failure?.body?.[0]?.message || failure?.body?.message || fallback;
    throw specialTermsError(message, failure?.httpStatusCode || 502, 'SPECIAL_TERMS_SALESFORCE_WRITE_FAILED');
  }
}

function cleanClauseText(value) {
  const clauseText = normalizeClauseText(value);
  if (clauseText.length < 3) throw specialTermsError('Clause text must contain at least three characters.', 400, 'SPECIAL_TERMS_CLAUSE_TEXT_REQUIRED');
  if (clauseText.length > 32768) throw specialTermsError('Clause text exceeds the Salesforce field limit.', 400, 'SPECIAL_TERMS_CLAUSE_TEXT_TOO_LONG');
  if (hasTopLevelListMarker(clauseText)) throw specialTermsError('Clause text must not contain its own top-level number or hyphen marker.', 400, 'SPECIAL_TERMS_CLAUSE_NUMBERED');
  return clauseText;
}

function cleanShortName(value) {
  const shortName = text(value, 80).replace(/\s+/g, ' ');
  const words = shortName.split(/\s+/).filter(Boolean);
  if (shortName.length < 3 || words.length < 3 || words.length > 7) throw specialTermsError('Clause short name must contain 3 to 7 concise, action-oriented words.', 400, 'SPECIAL_TERMS_CLAUSE_SHORT_NAME_INVALID');
  if (/^\d+[.):]/.test(shortName)) throw specialTermsError('Clause short name must not begin with a number.', 400, 'SPECIAL_TERMS_CLAUSE_SHORT_NAME_INVALID');
  return shortName;
}

function cleanCategory(value, schema) {
  const category = text(value, 80) || 'Other';
  const valid = new Set((schema.clauseCategoryOptions || []).map((option) => option.value));
  if (!valid.has(category)) throw specialTermsError('Select an active clause category.', 400, 'SPECIAL_TERMS_CLAUSE_CATEGORY_INVALID');
  return category;
}

function requiredReason(value, label = 'Change reason') {
  const reason = text(value, 1000);
  if (reason.length < 3) throw specialTermsError(`${label} is required.`, 400, 'SPECIAL_TERMS_REASON_REQUIRED');
  return reason;
}

function draftProvenance(body = {}) {
  const draftSource = ['Legacy Migration', 'Manual', 'AI Assisted'].includes(body.draftSource) ? body.draftSource : 'Manual';
  const aiModel = draftSource === 'AI Assisted' ? text(body.aiModel, 80) : '';
  const aiResponseId = draftSource === 'AI Assisted' ? text(body.aiResponseId, 100) : '';
  const legacySourceKey = text(body.legacySourceKey, 255);
  if (draftSource === 'AI Assisted' && (!aiModel || !aiResponseId)) throw specialTermsError('AI-assisted drafts require model and response lineage.', 400, 'SPECIAL_TERMS_AI_LINEAGE_REQUIRED');
  return {
    Draft_Source__c: draftSource,
    AI_Model__c: aiModel || null,
    AI_Response_Id__c: aiResponseId || null,
    Legacy_Source_Key__c: legacySourceKey || null,
  };
}

function mapVersion(row) {
  if (!row) return null;
  return {
    id: row.Id,
    clauseId: row.Clause__c,
    revisionNumber: Number(row.Revision_Number__c || 0),
    clauseText: row.Clause_Text__c || '',
    contentHash: row.Content_Hash__c || '',
    status: row.Status__c || '',
    revisionReason: row.Revision_Reason__c || '',
    proposedByEmail: row.Proposed_By_Email__c || '',
    proposedShortName: row.Proposed_Short_Name__c || '',
    proposedCategory: row.Proposed_Category__c || '',
    approvedByEmail: row.Approved_By_Email__c || '',
    approvedAt: row.Approved_At__c || null,
    approvalReason: row.Approval_Reason__c || '',
    draftSource: row.Draft_Source__c || '',
    aiModel: row.AI_Model__c || '',
    aiResponseId: row.AI_Response_Id__c || '',
    legacySourceKey: row.Legacy_Source_Key__c || '',
    lastModifiedAt: row.LastModifiedDate || null,
  };
}

function mapClause(row, { versions = [], usageCount = 0 } = {}) {
  const ordered = [...versions].sort((left, right) => Number(right.Revision_Number__c || 0) - Number(left.Revision_Number__c || 0));
  const latestApproved = ordered.find((version) => version.Status__c === 'Approved') || null;
  const draft = ordered.find((version) => version.Status__c === 'Draft') || null;
  return {
    id: row.Id,
    shortName: row.Name || '',
    canonicalKey: row.Canonical_Text_Key__c || '',
    category: row.Category__c || 'Other',
    status: row.Status__c || 'Draft',
    origin: row.Origin__c || 'Manual',
    legacyOriginalText: row.Legacy_Original_Text__c || '',
    latestApprovedVersionNumber: Number(row.Latest_Approved_Version_Number__c || 0),
    latestApprovedVersion: mapVersion(latestApproved),
    draftVersion: mapVersion(draft),
    replacementClauseId: row.Replacement_Clause__c || null,
    consolidation: row.consolidation || null,
    retirementReason: row.Retirement_Reason__c || '',
    usageCount: Number(usageCount || 0),
    lastApprovedAt: row.Last_Approved_At__c || null,
    lastModifiedAt: row.LastModifiedDate || null,
    history: ordered.map((version) => ({
      id: version.Id,
      revisionNumber: Number(version.Revision_Number__c || 0),
      status: version.Status__c || '',
      draftSource: version.Draft_Source__c || '',
      proposedByEmail: version.Proposed_By_Email__c || '',
      approvedByEmail: version.Approved_By_Email__c || '',
      approvedAt: version.Approved_At__c || null,
      revisionReason: version.Revision_Reason__c || '',
      lastModifiedAt: version.LastModifiedDate || null,
    })),
    _versions: ordered.map(mapVersion),
  };
}

const CLAUSE_SELECT = 'Id,Name,Short_Name_Key__c,Canonical_Text_Key__c,Category__c,Status__c,Origin__c,Legacy_Original_Text__c,Latest_Approved_Version_Number__c,Last_Approved_At__c,Replacement_Clause__c,Retirement_Reason__c,LastModifiedDate';
const CLAUSE_INDEX_SELECT = 'Id,Name,Short_Name_Key__c,Canonical_Text_Key__c,Category__c,Status__c,Origin__c,Latest_Approved_Version_Number__c,LastModifiedDate';
const VERSION_SELECT = 'Id,Clause__c,Revision_Number__c,Clause_Text__c,Content_Hash__c,Status__c,Revision_Reason__c,Proposed_By_Email__c,Proposed_Short_Name__c,Proposed_Category__c,Approved_By_Email__c,Approved_At__c,Approval_Reason__c,Draft_Source__c,AI_Model__c,AI_Response_Id__c,Legacy_Source_Key__c,LastModifiedDate';

async function expireSpecialTermClauseCaches(termIds = []) {
  await expireRuntimeCacheTags([
    'salesforce:special-terms',
    'salesforce:special-terms:clauses',
    ...termIds.filter(isId).map((termId) => `salesforce:special-term:${termId}`),
  ]);
}

async function loadOneClause(clauseId) {
  const [clauseResult, versionResult, usageResult, consolidationResult] = await Promise.all([
    sfQuery(`SELECT ${CLAUSE_SELECT} FROM ${OBJECTS.clause} WHERE Id = '${soql(clauseId)}' LIMIT 1`, { clean: true, limit: 1 }),
    sfQuery(`SELECT ${VERSION_SELECT} FROM ${OBJECTS.version} WHERE Clause__c = '${soql(clauseId)}' ORDER BY Revision_Number__c DESC LIMIT 100`, { clean: true, limit: 100 }),
    sfQuery(`SELECT COUNT(Id) usageCount FROM ${OBJECTS.assignment} WHERE Clause__c = '${soql(clauseId)}'`, { clean: true, limit: 1 }),
    sfQuery(`SELECT Id,Status__c,Replacement_Clause__c,Replacement_Clause__r.Name,Replacement_Version__c,Replacement_Version__r.Revision_Number__c,LastModifiedDate FROM ${OBJECTS.consolidation} WHERE Source_Clause__c = '${soql(clauseId)}' AND Status__c IN ('Relinking','Paused','Ready to Retire') ORDER BY CreatedDate DESC LIMIT 1`, { clean: true, limit: 1 }),
  ]);
  const row = clauseResult.records[0];
  if (!row) throw specialTermsError('Clause no longer exists.', 409, 'SPECIAL_TERMS_CLAUSE_MISSING');
  const activeConsolidation = consolidationResult.records[0] || null;
  row.consolidation = activeConsolidation ? {
    id: activeConsolidation.Id,
    status: activeConsolidation.Status__c,
    replacementClauseId: activeConsolidation.Replacement_Clause__c,
    replacementShortName: activeConsolidation.Replacement_Clause__r?.Name || '',
    replacementVersionId: activeConsolidation.Replacement_Version__c,
    replacementRevisionNumber: Number(activeConsolidation.Replacement_Version__r?.Revision_Number__c || 0),
    lastModifiedAt: activeConsolidation.LastModifiedDate || null,
  } : null;
  return mapClause(row, { versions: versionResult.records, usageCount: Number(usageResult.records[0]?.usageCount || 0) });
}

function clauseDeletionPreview(clause, { entityType, action, version = null, blockers = [], authorized = false, isCreator = false, isApprover = false, counts = {} }) {
  return {
    entityType,
    id: entityType === 'clauseVersion' ? version.Id : clause.Id,
    clauseId: clause.Id,
    versionId: version?.Id || null,
    name: clause.Name || '',
    origin: clause.Origin__c || 'Manual',
    action,
    eligible: blockers.length === 0 && authorized,
    authorized,
    isCreator,
    isApprover,
    blockers,
    counts,
    confirmationLabel: clause.Name || '',
    expectedLastModifiedAt: clause.LastModifiedDate || null,
    expectedVersionLastModifiedAt: version?.LastModifiedDate || null,
  };
}

async function clauseIdentityDeletionPreview(client, profile, clauseId, { isApprover = false } = {}) {
  const [clause, versions, assignmentUse, revisionUse, consolidationUse, replacementUse] = await Promise.all([
    currentRecord(OBJECTS.clause, clauseId, ['Id', 'Name', 'Status__c', 'Origin__c', 'LastModifiedDate']),
    sfQuery(`SELECT Id,Status__c,Proposed_By_Email__c,LastModifiedDate FROM ${OBJECTS.version} WHERE Clause__c = '${soql(clauseId)}' ORDER BY Revision_Number__c,Id LIMIT 101`, { clean: true, limit: 101 }),
    sfQuery(`SELECT Id FROM ${OBJECTS.assignment} WHERE Clause__c = '${soql(clauseId)}' LIMIT 1`, { clean: true, limit: 1 }),
    sfQuery(`SELECT Id FROM ${OBJECTS.revisionClause} WHERE Clause__c = '${soql(clauseId)}' LIMIT 1`, { clean: true, limit: 1 }),
    sfQuery(`SELECT Id FROM ${OBJECTS.consolidation} WHERE Source_Clause__c = '${soql(clauseId)}' OR Replacement_Clause__c = '${soql(clauseId)}' LIMIT 1`, { clean: true, limit: 1 }),
    sfQuery(`SELECT Id FROM ${OBJECTS.clause} WHERE Replacement_Clause__c = '${soql(clauseId)}' LIMIT 1`, { clean: true, limit: 1 }),
  ]);
  const versionIds = versions.records.map((row) => row.Id);
  const mappingUse = versionIds.length ? await sfQuery(`SELECT Id FROM ${OBJECTS.consolidationMap} WHERE Source_Version__c IN (${versionIds.map((id) => `'${soql(id)}'`).join(',')}) OR Replacement_Version__c IN (${versionIds.map((id) => `'${soql(id)}'`).join(',')}) LIMIT 1`, { clean: true, limit: 1 }) : { records: [] };
  const actorEmail = normalizedEmail(profile?.email);
  const isCreator = Boolean(versions.records.length && versions.records.every((row) => actorEmail && actorEmail === normalizedEmail(row.Proposed_By_Email__c)));
  const authorized = deletionAuthorization({ isApprover, isCreator });
  const blockers = [];
  if (clause.Status__c !== 'Draft') blockers.push('Approved and retired clause identities must be retained.');
  if (!versions.records.length) blockers.push('A Draft clause must retain a verifiable Draft version before deletion.');
  if (versions.totalSize > versions.records.length || versions.records.length > 100) blockers.push('This clause has too many versions for one verified deletion.');
  if (versions.records.some((row) => row.Status__c !== 'Draft')) blockers.push('Approved and superseded clause versions must be retained.');
  if (assignmentUse.records.length) blockers.push('Clause assignment lineage must be retained.');
  if (revisionUse.records.length) blockers.push('This clause is referenced by Special Term revision history.');
  if (consolidationUse.records.length || mappingUse.records.length) blockers.push('Clause consolidation lineage must be retained.');
  if (replacementUse.records.length) blockers.push('Another clause identifies this clause as its governed replacement.');
  if (!authorized) blockers.push('Only the original creator or an active General Manager/Administrator may delete this Draft clause.');
  return clauseDeletionPreview(clause, {
    entityType: 'clause',
    action: clause.Origin__c === 'Legacy' ? 'delete_legacy_draft' : 'delete_draft_clause',
    blockers,
    authorized,
    isCreator,
    isApprover,
    counts: { versionCount: versions.records.length, assignmentCount: assignmentUse.records.length, revisionReferenceCount: revisionUse.records.length, consolidationReferenceCount: consolidationUse.records.length + mappingUse.records.length },
  });
}

async function clauseVersionDeletionPreview(client, profile, versionId, { isApprover = false } = {}) {
  const version = await currentRecord(OBJECTS.version, versionId, ['Id', 'Clause__c', 'Status__c', 'Proposed_By_Email__c', 'LastModifiedDate']);
  const clause = await currentRecord(OBJECTS.clause, version.Clause__c, ['Id', 'Name', 'Status__c', 'Origin__c', 'LastModifiedDate']);
  const [assignmentUse, revisionUse, consolidationUse, mappingUse] = await Promise.all([
    sfQuery(`SELECT Id FROM ${OBJECTS.assignment} WHERE Clause_Version__c = '${soql(versionId)}' LIMIT 1`, { clean: true, limit: 1 }),
    sfQuery(`SELECT Id FROM ${OBJECTS.revisionClause} WHERE Clause_Version__c = '${soql(versionId)}' LIMIT 1`, { clean: true, limit: 1 }),
    sfQuery(`SELECT Id FROM ${OBJECTS.consolidation} WHERE Replacement_Version__c = '${soql(versionId)}' LIMIT 1`, { clean: true, limit: 1 }),
    sfQuery(`SELECT Id FROM ${OBJECTS.consolidationMap} WHERE Source_Version__c = '${soql(versionId)}' OR Replacement_Version__c = '${soql(versionId)}' LIMIT 1`, { clean: true, limit: 1 }),
  ]);
  const isCreator = await isSpecialTermsRecordCreator(client, profile, versionId, ['clause_draft_revise'], version.Proposed_By_Email__c);
  const authorized = deletionAuthorization({ isApprover, isCreator });
  const blockers = [];
  if (clause.Status__c !== 'Active') blockers.push('Delete a never-approved Draft clause as a complete identity instead.');
  if (version.Status__c !== 'Draft') blockers.push('Approved and superseded clause versions must be retained.');
  if (assignmentUse.records.length) blockers.push('Clause assignment lineage must be retained.');
  if (revisionUse.records.length) blockers.push('This Draft version is referenced by a Special Term revision.');
  if (consolidationUse.records.length || mappingUse.records.length) blockers.push('Clause consolidation lineage must be retained.');
  if (!authorized) blockers.push('Only the Draft proposer or an active General Manager/Administrator may discard this version.');
  return clauseDeletionPreview(clause, {
    entityType: 'clauseVersion',
    action: 'discard_draft_version',
    version,
    blockers,
    authorized,
    isCreator,
    isApprover,
    counts: { assignmentCount: assignmentUse.records.length, revisionReferenceCount: revisionUse.records.length, consolidationReferenceCount: consolidationUse.records.length + mappingUse.records.length },
  });
}

export async function previewSpecialTermClauseDeletion(client, profile, body = {}, options = {}) {
  await resolveSpecialTermsSchema({ force: true, write: false });
  const entityType = text(body.entityType, 30);
  if (entityType === 'clause') return clauseIdentityDeletionPreview(client, profile, salesforceId(body.id, 'Clause'), options);
  if (entityType === 'clauseVersion') return clauseVersionDeletionPreview(client, profile, salesforceId(body.id, 'Clause version'), options);
  throw specialTermsError('Deletion preview supports a Draft clause or Draft clause version.', 400, 'SPECIAL_TERMS_DELETE_ENTITY_INVALID');
}

function requireClauseDeletion(preview) {
  if (!preview.eligible) throw specialTermsError(preview.blockers[0] || 'This clause cannot be deleted.', 409, 'SPECIAL_TERMS_DELETE_BLOCKED', { blockers: preview.blockers });
}

function confirmedClauseName(body, preview) {
  if (text(body.confirmationName, 80) !== preview.name) throw specialTermsError(`Type ${preview.name} to confirm deletion.`);
}

export async function deleteSpecialTermClause(client, profile, body = {}, options = {}) {
  await resolveSpecialTermsSchema({ force: true, write: true });
  const clauseId = salesforceId(body.clauseId || body.id, 'Clause');
  const reason = requiredReason(body.auditReason, 'Deletion reason');
  const initial = await clauseIdentityDeletionPreview(client, profile, clauseId, options);
  requireClauseDeletion(initial);
  assertCurrent({ LastModifiedDate: initial.expectedLastModifiedAt }, body.expectedLastModifiedAt);
  confirmedClauseName(body, initial);
  const reservation = await reserveOperation(client, profile, body, 'clause_draft_delete', { id: clauseId, expectedLastModifiedAt: body.expectedLastModifiedAt, deletionReasonHash: clauseHash(reason) });
  if (reservation.replay) return { ...reservation.replay, idempotencyReplayed: true };
  try {
    const live = await clauseIdentityDeletionPreview(client, profile, clauseId, options);
    requireClauseDeletion(live);
    assertCurrent({ LastModifiedDate: live.expectedLastModifiedAt }, body.expectedLastModifiedAt);
    confirmedClauseName(body, live);
    const result = await sfRequest('/composite', { method: 'POST', body: { allOrNone: true, compositeRequest: [{ method: 'DELETE', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.clause}/${clauseId}`, referenceId: 'clause' }] } });
    assertComposite(result, 'Salesforce rejected Draft clause deletion.');
    await expireSpecialTermClauseCaches();
    return finishOperation(client, reservation.operation, { success: true, id: clauseId, clauseId, operation: 'draft_clause_deleted' });
  } catch (error) {
    return failOperation(client, reservation.operation, error);
  }
}

export async function discardSpecialTermClauseDraft(client, profile, body = {}, options = {}) {
  await resolveSpecialTermsSchema({ force: true, write: true });
  const versionId = salesforceId(body.versionId || body.id, 'Clause version');
  const reason = requiredReason(body.auditReason, 'Deletion reason');
  const initial = await clauseVersionDeletionPreview(client, profile, versionId, options);
  requireClauseDeletion(initial);
  assertCurrent({ LastModifiedDate: initial.expectedLastModifiedAt }, body.expectedClauseLastModifiedAt);
  assertCurrent({ LastModifiedDate: initial.expectedVersionLastModifiedAt }, body.expectedVersionLastModifiedAt);
  confirmedClauseName(body, initial);
  const reservation = await reserveOperation(client, profile, body, 'clause_version_discard', { id: versionId, clauseId: initial.clauseId, expectedClauseLastModifiedAt: body.expectedClauseLastModifiedAt, expectedVersionLastModifiedAt: body.expectedVersionLastModifiedAt, deletionReasonHash: clauseHash(reason) });
  if (reservation.replay) return { ...reservation.replay, idempotencyReplayed: true };
  try {
    const live = await clauseVersionDeletionPreview(client, profile, versionId, options);
    requireClauseDeletion(live);
    assertCurrent({ LastModifiedDate: live.expectedLastModifiedAt }, body.expectedClauseLastModifiedAt);
    assertCurrent({ LastModifiedDate: live.expectedVersionLastModifiedAt }, body.expectedVersionLastModifiedAt);
    confirmedClauseName(body, live);
    const result = await sfRequest('/composite', { method: 'POST', body: { allOrNone: true, compositeRequest: [{ method: 'DELETE', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.version}/${versionId}`, referenceId: 'version' }] } });
    assertComposite(result, 'Salesforce rejected Draft clause version deletion.');
    await expireSpecialTermClauseCaches();
    const clause = await loadOneClause(live.clauseId);
    return finishOperation(client, reservation.operation, { success: true, id: versionId, clauseId: live.clauseId, versionId, clause, operation: 'draft_version_discarded' }, { success: true, id: versionId, clauseId: live.clauseId, versionId, operation: 'draft_version_discarded' });
  } catch (error) {
    return failOperation(client, reservation.operation, error);
  }
}

async function resolveConsolidationSchema() {
  const required = {
    [OBJECTS.consolidation]: ['Consolidation_Key__c', 'Source_Clause__c', 'Replacement_Clause__c', 'Replacement_Version__c', 'Status__c', 'Reason__c', 'Confirmed_By_Email__c', 'Confirmed_At__c', 'Completed_By_Email__c', 'Completed_At__c', 'Cancelled_By_Email__c', 'Cancelled_At__c'],
    [OBJECTS.consolidationMap]: ['Consolidation__c', 'Source_Version__c', 'Replacement_Version__c', 'Equivalence_Status__c', 'Mapping_Key__c', 'Source_Content_Hash__c', 'Replacement_Content_Hash__c', 'Confirmed_By_Email__c', 'Confirmed_At__c'],
  };
  const describes = await Promise.all(Object.keys(required).map((name) => sfRequest(`/sobjects/${encodeURIComponent(name)}/describe/`, { readOnly: true })));
  Object.entries(required).forEach(([name, fields], index) => {
    const describe = describes[index];
    const available = new Map((describe.fields || []).map((field) => [field.name, field]));
    if (describe.createable !== true || describe.updateable !== true) throw specialTermsError(`Special Terms requires write access to ${name}.`, 503, 'SPECIAL_TERMS_CONSOLIDATION_SCHEMA_INVALID');
    for (const fieldName of fields) {
      const field = available.get(fieldName);
      if (!field || (fieldName !== 'Status__c' && field.createable !== true)) throw specialTermsError(`Special Terms consolidation requires ${name}.${fieldName}.`, 503, 'SPECIAL_TERMS_CONSOLIDATION_SCHEMA_INVALID');
    }
  });
}

function consolidationSelect() {
  return 'Id,Consolidation_Key__c,Source_Clause__c,Source_Clause__r.Name,Source_Clause__r.Status__c,Replacement_Clause__c,Replacement_Clause__r.Name,Replacement_Clause__r.Status__c,Replacement_Clause__r.Latest_Approved_Version_Number__c,Replacement_Version__c,Replacement_Version__r.Revision_Number__c,Replacement_Version__r.Status__c,Replacement_Version__r.Content_Hash__c,Status__c,Reason__c,Confirmed_By_Email__c,Confirmed_At__c,Completed_By_Email__c,Completed_At__c,Cancelled_By_Email__c,Cancelled_At__c,LastModifiedDate';
}

function mapConsolidation(row, mappings = [], affectedTerms = []) {
  const targetChanged = row.Replacement_Clause__r?.Status__c !== 'Active'
    || row.Replacement_Version__r?.Status__c !== 'Approved'
    || Number(row.Replacement_Clause__r?.Latest_Approved_Version_Number__c || row.Replacement_Version__r?.Revision_Number__c || 0) !== Number(row.Replacement_Version__r?.Revision_Number__c || 0);
  const unresolvedDrafts = affectedTerms.some((term) => term.revisionState === 'Conflict');
  const effectiveStatus = row.Status__c === 'Relinking' && !affectedTerms.length && !unresolvedDrafts ? 'Ready to Retire'
    : targetChanged && !['Completed', 'Cancelled'].includes(row.Status__c) ? 'Paused'
      : row.Status__c;
  return {
    id: row.Id,
    key: row.Consolidation_Key__c,
    sourceClauseId: row.Source_Clause__c,
    sourceShortName: row.Source_Clause__r?.Name || '',
    sourceStatus: row.Source_Clause__r?.Status__c || '',
    replacementClauseId: row.Replacement_Clause__c,
    replacementShortName: row.Replacement_Clause__r?.Name || '',
    replacementVersionId: row.Replacement_Version__c,
    replacementRevisionNumber: Number(row.Replacement_Version__r?.Revision_Number__c || 0),
    status: effectiveStatus,
    storedStatus: row.Status__c,
    targetChanged,
    reason: row.Reason__c || '',
    confirmedByEmail: row.Confirmed_By_Email__c || '',
    confirmedAt: row.Confirmed_At__c || null,
    completedAt: row.Completed_At__c || null,
    lastModifiedAt: row.LastModifiedDate || null,
    mappings,
    affectedTerms,
    remainingTermCount: affectedTerms.length,
  };
}

async function loadClauseRows({ force = false } = {}) {
  await resolveSpecialTermsSchema({ force });
  const cached = await getOrLoadRuntimeCache({
    namespace: 'salesforce-special-term-clause-bank',
    version: '1',
    accessScope: 'global',
    apiVersion: `${getApiVersion()}@${getInstanceUrl()}`,
    payload: { view: 'bank' },
    ttlSeconds: 60,
    tags: ['salesforce:special-terms', 'salesforce:special-terms:clauses'],
    force,
    loader: async () => {
      const [clauseResult, versionResult, usageResult, consolidationResult] = await Promise.all([
        sfQuery(`SELECT ${CLAUSE_SELECT} FROM Special_Term_Clause__c ORDER BY Name LIMIT 5000`, { clean: true, limit: 5000 }),
        sfQuery(`SELECT ${VERSION_SELECT} FROM Special_Term_Clause_Version__c ORDER BY Clause__c,Revision_Number__c DESC LIMIT 10000`, { clean: true, limit: 10000 }),
        sfQuery('SELECT Clause__c clauseId,COUNT(Id) usageCount FROM Special_Term_Clause_Assignment__c GROUP BY Clause__c LIMIT 2000', { clean: true, limit: 2000 }),
        sfQuery(`SELECT Id,Source_Clause__c,Status__c,Replacement_Clause__c,Replacement_Clause__r.Name,Replacement_Version__c,Replacement_Version__r.Revision_Number__c,LastModifiedDate FROM ${OBJECTS.consolidation} WHERE Status__c IN ('Relinking','Paused','Ready to Retire') ORDER BY CreatedDate DESC LIMIT 5000`, { clean: true, limit: 5000 }),
      ]);
      if (clauseResult.totalSize > clauseResult.records.length || versionResult.totalSize > versionResult.records.length) throw specialTermsError('The clause bank exceeds the current safe result limit.', 503, 'SPECIAL_TERMS_RESULT_LIMIT');
      const versionsByClause = new Map();
      for (const version of versionResult.records) {
        if (!versionsByClause.has(version.Clause__c)) versionsByClause.set(version.Clause__c, []);
        versionsByClause.get(version.Clause__c).push(version);
      }
      const usageByClause = new Map(usageResult.records.map((row) => [row.clauseId, Number(row.usageCount || 0)]));
      const consolidationByClause = new Map();
      for (const row of consolidationResult.records) if (!consolidationByClause.has(row.Source_Clause__c)) consolidationByClause.set(row.Source_Clause__c, {
        id: row.Id,
        status: row.Status__c,
        replacementClauseId: row.Replacement_Clause__c,
        replacementShortName: row.Replacement_Clause__r?.Name || '',
        replacementVersionId: row.Replacement_Version__c,
        replacementRevisionNumber: Number(row.Replacement_Version__r?.Revision_Number__c || 0),
        lastModifiedAt: row.LastModifiedDate || null,
      });
      for (const row of clauseResult.records) row.consolidation = consolidationByClause.get(row.Id) || null;
      return { clauses: clauseResult.records.map((row) => mapClause(row, { versions: versionsByClause.get(row.Id) || [], usageCount: usageByClause.get(row.Id) || 0 })), fetchedAt: new Date().toISOString() };
    },
  });
  return { ...cached.value, cacheStatus: cached.cacheStatus || cached.status || null };
}

async function loadClauseListIndex({ force = false } = {}) {
  await resolveSpecialTermsSchema({ force });
  const cached = await getOrLoadRuntimeCache({
    namespace: 'salesforce-special-term-clause-index',
    version: '1',
    accessScope: 'global',
    apiVersion: `${getApiVersion()}@${getInstanceUrl()}`,
    payload: { view: 'clause-library-index' },
    ttlSeconds: 60,
    tags: ['salesforce:special-terms', 'salesforce:special-terms:clauses'],
    force,
    loader: async () => {
      const [clauseResult, draftResult, usageResult, consolidationResult] = await Promise.all([
        sfQuery(`SELECT ${CLAUSE_INDEX_SELECT} FROM ${OBJECTS.clause} ORDER BY Name,Id LIMIT 5000`, { clean: true, limit: 5000 }),
        sfQuery(`SELECT ${VERSION_SELECT} FROM ${OBJECTS.version} WHERE Status__c = 'Draft' ORDER BY Clause__c,Revision_Number__c DESC LIMIT 5000`, { clean: true, limit: 5000 }),
        sfQuery(`SELECT Clause__c clauseId,COUNT(Id) usageCount FROM ${OBJECTS.assignment} GROUP BY Clause__c LIMIT 5000`, { clean: true, limit: 5000 }),
        sfQuery(`SELECT Id,Source_Clause__c,Status__c,Replacement_Clause__c,Replacement_Clause__r.Name,Replacement_Version__c,Replacement_Version__r.Revision_Number__c,LastModifiedDate FROM ${OBJECTS.consolidation} WHERE Status__c IN ('Relinking','Paused','Ready to Retire') ORDER BY CreatedDate DESC LIMIT 5000`, { clean: true, limit: 5000 }),
      ]);
      if (clauseResult.totalSize > clauseResult.records.length || draftResult.totalSize > draftResult.records.length) throw specialTermsError('The Clause Library index exceeds the current safe result limit.', 503, 'SPECIAL_TERMS_RESULT_LIMIT');
      const draftByClause = new Map();
      for (const version of draftResult.records) if (!draftByClause.has(version.Clause__c)) draftByClause.set(version.Clause__c, version);
      const usageByClause = new Map(usageResult.records.map((row) => [row.clauseId, Number(row.usageCount || 0)]));
      const consolidationByClause = new Map();
      for (const row of consolidationResult.records) if (!consolidationByClause.has(row.Source_Clause__c)) consolidationByClause.set(row.Source_Clause__c, {
        id: row.Id,
        status: row.Status__c,
        replacementClauseId: row.Replacement_Clause__c,
        replacementShortName: row.Replacement_Clause__r?.Name || '',
        replacementVersionId: row.Replacement_Version__c,
        replacementRevisionNumber: Number(row.Replacement_Version__r?.Revision_Number__c || 0),
        lastModifiedAt: row.LastModifiedDate || null,
      });
      const clauses = clauseResult.records.map((row) => {
        const draft = draftByClause.get(row.Id);
        return mapClause({ ...row, consolidation: consolidationByClause.get(row.Id) || null }, {
          versions: draft ? [draft] : [],
          usageCount: usageByClause.get(row.Id) || 0,
        });
      });
      return { clauses, fetchedAt: new Date().toISOString() };
    },
  });
  return { ...cached.value, cacheStatus: cached.cacheStatus || cached.status || null };
}

function soslSearchExpression(value) {
  return text(value, 100)
    .normalize('NFKC')
    .replace(/[?&|!{}[\]()^~*:\\"'+\-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 2)
    .slice(0, 6)
    .map((word) => `${word}*`)
    .join(' AND ');
}

async function clauseSearchIds(value) {
  const expression = soslSearchExpression(value);
  if (!expression) return null;
  const sosl = `FIND {${expression}} IN ALL FIELDS RETURNING ${OBJECTS.clause}(Id LIMIT 2000),${OBJECTS.version}(Clause__c LIMIT 2000)`;
  const result = await sfRequest(`/search/?q=${encodeURIComponent(sosl)}`, { readOnly: true });
  return new Set((result?.searchRecords || []).map((row) => row.attributes?.type === OBJECTS.version ? row.Clause__c : row.Id).filter(isId));
}

async function loadClausePage(index, clauseIds) {
  if (!clauseIds.length) return [];
  const idList = clauseIds.map((id) => `'${soql(id)}'`).join(',');
  const [clauseResult, versionResult] = await Promise.all([
    sfQuery(`SELECT ${CLAUSE_SELECT} FROM ${OBJECTS.clause} WHERE Id IN (${idList}) LIMIT 100`, { clean: true, limit: 100 }),
    sfQuery(`SELECT ${VERSION_SELECT} FROM ${OBJECTS.version} WHERE Clause__c IN (${idList}) ORDER BY Clause__c,Revision_Number__c DESC LIMIT 5000`, { clean: true, limit: 5000 }),
  ]);
  if (versionResult.totalSize > versionResult.records.length) throw specialTermsError('The visible Clause Library page exceeds the safe version-history limit.', 503, 'SPECIAL_TERMS_RESULT_LIMIT');
  const versionsByClause = new Map();
  for (const version of versionResult.records) {
    if (!versionsByClause.has(version.Clause__c)) versionsByClause.set(version.Clause__c, []);
    versionsByClause.get(version.Clause__c).push(version);
  }
  const indexedById = new Map(index.clauses.map((clause) => [clause.id, clause]));
  const rowsById = new Map(clauseResult.records.map((row) => {
    const indexed = indexedById.get(row.Id) || {};
    return [row.Id, mapClause({ ...row, consolidation: indexed.consolidation || null }, {
      versions: versionsByClause.get(row.Id) || [],
      usageCount: indexed.usageCount || 0,
    })];
  }));
  return clauseIds.map((id) => rowsById.get(id)).filter(Boolean);
}

function preferredClauseText(clause) {
  return clause.draftVersion?.clauseText || clause.latestApprovedVersion?.clauseText || clause.legacyOriginalText || '';
}

function clauseWorkAction(clause) {
  if (clause.consolidation?.status === 'Ready to Retire') return 'ready_retire';
  if (clause.consolidation) return 'relink_required';
  if (clause.status === 'Draft' && clause.usageCount > 0) return 'blocked_assignment';
  if (clause.draftVersion && (clause.draftVersion.draftSource === 'Legacy Migration' || String(clause.origin).toLowerCase() === 'legacy')) return 'needs_review';
  if (clause.draftVersion) return 'ready_approval';
  return '';
}

function clauseBankSummary(clauses) {
  const summary = { work: 0, Active: 0, Retired: 0, actionCounts: {} };
  for (const clause of clauses) {
    const action = clauseWorkAction(clause);
    if (action) {
      summary.work += 1;
      summary.actionCounts[action] = Number(summary.actionCounts[action] || 0) + 1;
    }
    if (clause.status === 'Active') summary.Active += 1;
    if (clause.status === 'Retired') summary.Retired += 1;
  }
  return summary;
}

function clauseBankCursorOffset(cursor) {
  if (!cursor) return 0;
  try {
    const decoded = Buffer.from(String(cursor), 'base64url').toString('utf8');
    const match = /^special-term-clauses:v1:(\d+)$/.exec(decoded);
    return match ? Number(match[1]) : 0;
  } catch {
    return 0;
  }
}

function clauseBankCursor(offset) {
  return Buffer.from(`special-term-clauses:v1:${offset}`, 'utf8').toString('base64url');
}

export async function listSpecialTermClauseBank({ query = '', status = '', view = '', action = '', category = '', origin = '', usage = '', ownerEmail = '', duplicatesOnly = false, cursor = '', offset = null, force = false, limit = 50 } = {}) {
  const bank = await loadClauseListIndex({ force });
  const search = text(query, 100).toLocaleLowerCase('en');
  const searchIds = search ? await clauseSearchIds(search) : null;
  const validStatus = ['Draft', 'Active', 'Retired', 'Legacy'].includes(status) ? status : '';
  const validView = ['work', 'Active', 'Retired'].includes(view) ? view : '';
  const validAction = ['needs_review', 'ready_approval', 'blocked_assignment', 'relink_required', 'ready_retire'].includes(action) ? action : '';
  const validUsage = ['used', 'unused'].includes(usage) ? usage : '';
  const normalizedOwner = normalizedEmail(ownerEmail);
  const duplicateGroups = new Map();
  for (const clause of bank.clauses) {
    const key = clause.canonicalKey;
    if (!key) continue;
    if (!duplicateGroups.has(key)) duplicateGroups.set(key, []);
    duplicateGroups.get(key).push(clause);
  }
  const matched = [];
  for (const clause of bank.clauses) {
    if (validStatus === 'Legacy' ? clause.origin !== 'Legacy' : validStatus && clause.status !== validStatus) continue;
    const workAction = clauseWorkAction(clause);
    if (validView === 'work' ? !workAction : validView && clause.status !== validView) continue;
    if (validAction && workAction !== validAction) continue;
    if (category && category !== 'all' && clause.category !== category) continue;
    if (origin && origin !== 'all' && clause.origin !== origin) continue;
    if (validUsage === 'used' && clause.usageCount < 1) continue;
    if (validUsage === 'unused' && clause.usageCount > 0) continue;
    if (normalizedOwner && normalizedEmail(clause.draftVersion?.proposedByEmail) !== normalizedOwner) continue;
    const haystack = [clause.shortName, clause.category, clause.origin, clause.draftVersion?.clauseText].filter(Boolean).join(' ').toLocaleLowerCase('en');
    if (search && !haystack.includes(search) && !searchIds?.has(clause.id)) continue;
    const exactGroup = duplicateGroups.get(clause.canonicalKey) || [];
    if (duplicatesOnly === true && exactGroup.length < 2) continue;
    matched.push({
      ...clause,
      workAction: workAction || null,
      exactDuplicateCount: Math.max(0, exactGroup.length - 1),
      exactDuplicates: exactGroup.filter((candidate) => candidate.id !== clause.id).slice(0, 10).map((candidate) => ({ id: candidate.id, shortName: candidate.shortName, status: candidate.status })),
    });
  }
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const legacyOffset = offset == null ? 0 : Math.max(Number(offset) || 0, 0);
  const safeOffset = Math.min(cursor ? clauseBankCursorOffset(cursor) : legacyOffset, matched.length);
  const pageIndexRows = matched.slice(safeOffset, safeOffset + safeLimit);
  const pageRows = await loadClausePage(bank, pageIndexRows.map((clause) => clause.id));
  const indexById = new Map(pageIndexRows.map((clause) => [clause.id, clause]));
  const clauses = pageRows.map((clause) => {
    const { _versions, canonicalKey, ...publicClause } = clause;
    void _versions;
    void canonicalKey;
    return { ...publicClause, workAction: indexById.get(clause.id)?.workAction || null, exactDuplicateCount: indexById.get(clause.id)?.exactDuplicateCount || 0, exactDuplicates: indexById.get(clause.id)?.exactDuplicates || [], similarClauses: [] };
  });
  return {
    clauses,
    total: matched.length,
    offset: safeOffset,
    limit: safeLimit,
    hasMore: safeOffset + safeLimit < matched.length,
    previousCursor: safeOffset > 0 ? clauseBankCursor(Math.max(0, safeOffset - safeLimit)) : null,
    nextCursor: safeOffset + safeLimit < matched.length ? clauseBankCursor(safeOffset + safeLimit) : null,
    summary: clauseBankSummary(bank.clauses),
    fetchedAt: bank.fetchedAt,
    cacheStatus: bank.cacheStatus,
  };
}

/** Near matches are deliberately computed only after a user selects a clause.
 * The candidate search is delegated to Salesforce SOSL and only the bounded
 * candidate page is hydrated with wording. */
export async function listSpecialTermClauseSimilar(clauseId, { limit = 3 } = {}) {
  const selected = await loadOneClause(salesforceId(clauseId, 'Clause'));
  const sourceText = preferredClauseText(selected);
  if (!sourceText) return { clauseId: selected.id, similarClauses: [], fetchedAt: new Date().toISOString() };
  const candidateIds = [...((await clauseSearchIds(sourceText)) || [])].filter((id) => id !== selected.id).slice(0, 100);
  const index = await loadClauseListIndex();
  const candidates = await loadClausePage(index, candidateIds);
  const safeLimit = Math.min(Math.max(Number(limit) || 3, 1), 10);
  const similarClauses = candidates
    .map((candidate) => ({ candidate, similarity: clauseSimilarity(sourceText, preferredClauseText(candidate)) }))
    .filter(({ candidate, similarity }) => preferredClauseText(candidate) && similarity >= 0.45)
    .sort((left, right) => right.similarity - left.similarity || left.candidate.shortName.localeCompare(right.candidate.shortName))
    .slice(0, safeLimit)
    .map(({ candidate, similarity }) => ({
      id: candidate.id,
      shortName: candidate.shortName,
      status: candidate.status,
      revisionNumber: candidate.draftVersion?.revisionNumber || candidate.latestApprovedVersion?.revisionNumber || 0,
      clauseText: preferredClauseText(candidate),
      similarity: Number(similarity.toFixed(3)),
      materialDifference: hasMaterialDifference(sourceText, preferredClauseText(candidate)),
    }));
  return { clauseId: selected.id, similarClauses, fetchedAt: new Date().toISOString() };
}

export async function listSpecialTermClauseConsolidations({ includeClosed = false } = {}) {
  await resolveConsolidationSchema();
  const where = includeClosed ? '' : " WHERE Status__c IN ('Relinking','Paused','Ready to Retire')";
  const consolidationResult = await sfQuery(`SELECT ${consolidationSelect()} FROM ${OBJECTS.consolidation}${where} ORDER BY CreatedDate DESC LIMIT 500`, { clean: true, limit: 500 });
  if (consolidationResult.totalSize > consolidationResult.records.length) throw specialTermsError('The clause consolidation queue exceeds the safe result limit.', 503, 'SPECIAL_TERMS_RESULT_LIMIT');
  const rows = consolidationResult.records;
  if (!rows.length) return { consolidations: [], fetchedAt: new Date().toISOString() };
  const consolidationIds = rows.map((row) => row.Id);
  const sourceIds = [...new Set(rows.map((row) => row.Source_Clause__c))];
  const [mappingResult, assignmentResult, pendingReferenceResult] = await Promise.all([
    sfQuery(`SELECT Id,Consolidation__c,Source_Version__c,Source_Version__r.Revision_Number__c,Source_Content_Hash__c,Replacement_Version__c,Replacement_Version__r.Revision_Number__c,Replacement_Content_Hash__c,Equivalence_Status__c,Confirmed_By_Email__c,Confirmed_At__c,LastModifiedDate FROM ${OBJECTS.consolidationMap} WHERE Consolidation__c IN (${consolidationIds.map((id) => `'${soql(id)}'`).join(',')}) ORDER BY Consolidation__c,Source_Version__r.Revision_Number__c LIMIT 5000`, { clean: true, limit: 5000 }),
    sfQuery(`SELECT Id,Special_Term__c,Special_Term__r.Name,Special_Term__r.OwnerId,Special_Term__r.Owner.Email,Special_Term__r.LastModifiedDate,Projection__c,Sequence__c,Clause__c,Clause_Version__c,Clause_Version__r.Revision_Number__c FROM ${OBJECTS.assignment} WHERE Clause__c IN (${sourceIds.map((id) => `'${soql(id)}'`).join(',')}) AND State__c = 'Active' ORDER BY Special_Term__c,Projection__c,Sequence__c LIMIT 10000`, { clean: true, limit: 10000 }),
    sfQuery(`SELECT Id,Special_Term_Revision__c,Special_Term_Revision__r.Special_Term__c,Special_Term_Revision__r.Special_Term__r.Name,Special_Term_Revision__r.Special_Term__r.OwnerId,Special_Term_Revision__r.Special_Term__r.Owner.Email,Special_Term_Revision__r.Special_Term__r.LastModifiedDate,Special_Term_Revision__r.Status__c,Special_Term_Revision__r.LastModifiedDate,Projection__c,Sequence__c,Clause__c,Clause_Version__c,Clause_Version__r.Revision_Number__c FROM ${OBJECTS.revisionClause} WHERE Clause__c IN (${sourceIds.map((id) => `'${soql(id)}'`).join(',')}) AND Special_Term_Revision__r.Status__c IN ('Draft','In Review') ORDER BY Special_Term_Revision__r.Special_Term__c,Projection__c,Sequence__c LIMIT 10000`, { clean: true, limit: 10000 }),
  ]);
  if (mappingResult.totalSize > mappingResult.records.length || assignmentResult.totalSize > assignmentResult.records.length || pendingReferenceResult.totalSize > pendingReferenceResult.records.length) throw specialTermsError('The clause consolidation queue exceeds the safe mapping or assignment limit.', 503, 'SPECIAL_TERMS_RESULT_LIMIT');
  const affectedTermIds = [...new Set([
    ...assignmentResult.records.map((row) => row.Special_Term__c),
    ...pendingReferenceResult.records.map((row) => row.Special_Term_Revision__r?.Special_Term__c),
  ].filter(isId))];
  let revisions = [];
  let revisionClauses = [];
  if (affectedTermIds.length) {
    const revisionResult = await sfQuery(`SELECT Id,Special_Term__c,Status__c,Revision_Number__c,LastModifiedDate FROM ${OBJECTS.revision} WHERE Special_Term__c IN (${affectedTermIds.map((id) => `'${soql(id)}'`).join(',')}) AND Status__c IN ('Draft','In Review') ORDER BY Revision_Number__c DESC LIMIT 1000`, { clean: true, limit: 1000 });
    revisions = revisionResult.records;
    if (revisions.length) revisionClauses = (await sfQuery(`SELECT Id,Special_Term_Revision__c,Clause__c,Clause_Version__c,Projection__c,Sequence__c,LastModifiedDate FROM ${OBJECTS.revisionClause} WHERE Special_Term_Revision__c IN (${revisions.map((row) => `'${soql(row.Id)}'`).join(',')}) ORDER BY Projection__c,Sequence__c LIMIT 10000`, { clean: true, limit: 10000 })).records;
  }
  const mappingsByConsolidation = new Map();
  for (const mapping of mappingResult.records) {
    if (!mappingsByConsolidation.has(mapping.Consolidation__c)) mappingsByConsolidation.set(mapping.Consolidation__c, []);
    mappingsByConsolidation.get(mapping.Consolidation__c).push({
      id: mapping.Id,
      sourceVersionId: mapping.Source_Version__c,
      sourceRevisionNumber: Number(mapping.Source_Version__r?.Revision_Number__c || 0),
      replacementVersionId: mapping.Replacement_Version__c,
      replacementRevisionNumber: Number(mapping.Replacement_Version__r?.Revision_Number__c || 0),
      equivalenceStatus: mapping.Equivalence_Status__c,
      lastModifiedAt: mapping.LastModifiedDate || null,
    });
  }
  const revisionsByTerm = new Map();
  for (const revision of revisions) if (!revisionsByTerm.has(revision.Special_Term__c)) revisionsByTerm.set(revision.Special_Term__c, revision);
  const revisionClausesByRevision = new Map();
  for (const row of revisionClauses) {
    if (!revisionClausesByRevision.has(row.Special_Term_Revision__c)) revisionClausesByRevision.set(row.Special_Term_Revision__c, []);
    revisionClausesByRevision.get(row.Special_Term_Revision__c).push(row);
  }
  const consolidations = rows.map((row) => {
    const terms = new Map();
    for (const assignment of assignmentResult.records.filter((item) => item.Clause__c === row.Source_Clause__c)) {
      if (!terms.has(assignment.Special_Term__c)) terms.set(assignment.Special_Term__c, {
        termId: assignment.Special_Term__c,
        termName: assignment.Special_Term__r?.Name || assignment.Special_Term__c,
        ownerId: assignment.Special_Term__r?.OwnerId || null,
        ownerEmail: assignment.Special_Term__r?.Owner?.Email || null,
        termLastModifiedAt: assignment.Special_Term__r?.LastModifiedDate || null,
        occurrences: [],
      });
      terms.get(assignment.Special_Term__c).occurrences.push({ id: assignment.Id, projection: assignment.Projection__c, sequence: Number(assignment.Sequence__c || 0), sourceVersionId: assignment.Clause_Version__c, sourceRevisionNumber: Number(assignment.Clause_Version__r?.Revision_Number__c || 0) });
    }
    for (const reference of pendingReferenceResult.records.filter((item) => item.Clause__c === row.Source_Clause__c)) {
      const termId = reference.Special_Term_Revision__r?.Special_Term__c;
      if (!isId(termId)) continue;
      if (!terms.has(termId)) terms.set(termId, {
        termId,
        termName: reference.Special_Term_Revision__r?.Special_Term__r?.Name || termId,
        ownerId: reference.Special_Term_Revision__r?.Special_Term__r?.OwnerId || null,
        ownerEmail: reference.Special_Term_Revision__r?.Special_Term__r?.Owner?.Email || null,
        termLastModifiedAt: reference.Special_Term_Revision__r?.Special_Term__r?.LastModifiedDate || null,
        occurrences: [],
      });
      terms.get(termId).occurrences.push({ id: reference.Id, projection: reference.Projection__c, sequence: Number(reference.Sequence__c || 0), sourceVersionId: reference.Clause_Version__c, sourceRevisionNumber: Number(reference.Clause_Version__r?.Revision_Number__c || 0), pending: true });
    }
    for (const term of terms.values()) {
      const revision = revisionsByTerm.get(term.termId) || null;
      const children = revisionClausesByRevision.get(revision?.Id) || [];
      const usesSource = children.some((item) => item.Clause__c === row.Source_Clause__c);
      const usesReplacement = children.some((item) => item.Clause__c === row.Replacement_Clause__c);
      term.revisionId = revision?.Id || null;
      term.revisionLastModifiedAt = revision?.LastModifiedDate || null;
      term.revisionState = !revision ? 'Needs Relink' : usesSource ? 'Conflict' : usesReplacement ? 'Awaiting Approval' : 'Conflict';
    }
    return mapConsolidation(row, mappingsByConsolidation.get(row.Id) || [], [...terms.values()]);
  });
  return { consolidations, fetchedAt: new Date().toISOString() };
}

export async function getSpecialTermMigrationInventory({ force = false } = {}) {
  const workspace = await listSpecialTerms({ force });
  const entries = [];
  const occurrencesByKey = new Map();
  for (const term of workspace.terms || []) {
    for (const config of PROJECTION_LIST) {
      const sourceText = term[config.key] || '';
      const structureStatus = config.key === 'termsText' ? term.clauseStructureStatus : config.key === 'confirmationRemark' ? term.confirmationClauseStatus : term.nominationClauseStatus;
      const markerStyle = config.key === 'termsText' ? 'Numbered' : 'Auto';
      const parsed = parseLegacyClauses(sourceText, { termName: config.key === 'termsText' ? term.name : '', markerStyle });
      const populated = parsed.clauses.length > 0;
      const entry = {
        termId: term.id,
        termName: term.name,
        projection: config.key,
        projectionValue: config.value,
        projectionLabel: config.label,
        structureStatus,
        style: config.key === 'termsText' ? 'Numbered' : config.key === 'confirmationRemark' ? term.confirmationClauseStyle : term.nominationClauseStyle,
        populated,
        clauseCount: parsed.clauses.length,
        markerCount: parsed.markerCount || 0,
        plainlyListed: populated && !parsed.manualReviewRequired && parsed.markerCount === parsed.clauses.length,
        plainlyNumbered: config.key === 'termsText' && populated && !parsed.manualReviewRequired && parsed.markerCount === parsed.clauses.length,
        inferredStyle: parsed.inferredStyle,
        manualReviewRequired: parsed.manualReviewRequired,
        reviewReason: parsed.reason,
        lastModifiedAt: term.lastModifiedAt,
        migrationBatchId: config.key === 'termsText' ? term.clauseMigrationBatchId : config.key === 'confirmationRemark' ? term.confirmationMigrationBatchId : term.nominationMigrationBatchId,
      };
      entries.push(entry);
      parsed.clauses.forEach((clauseText, index) => {
        const key = canonicalClauseKey(clauseText);
        if (!occurrencesByKey.has(key)) occurrencesByKey.set(key, []);
        occurrencesByKey.get(key).push({ termId: term.id, termName: term.name, projection: config.key, projectionLabel: config.label, sequence: index + 1, clauseText });
      });
    }
  }
  const duplicateGroups = [...occurrencesByKey.entries()]
    .filter(([, occurrences]) => occurrences.length > 1)
    .map(([canonicalKey, occurrences]) => ({
      canonicalKey,
      occurrenceCount: occurrences.length,
      clauseText: occurrences[0].clauseText,
      occurrences: occurrences.map(({ clauseText, ...occurrence }) => occurrence),
      suggestedShortName: suggestClauseShortName(occurrences[0].clauseText),
      suggestedCategory: suggestClauseCategory(occurrences[0].clauseText),
    }))
    .sort((left, right) => right.occurrenceCount - left.occurrenceCount || left.suggestedShortName.localeCompare(right.suggestedShortName));
  const summaryFor = (projection) => {
    const selected = entries.filter((entry) => entry.projection === projection);
    return {
      recordCount: selected.length,
      populatedCount: selected.filter((entry) => entry.populated).length,
      emptyCount: selected.filter((entry) => !entry.populated).length,
      plainlyListedCount: selected.filter((entry) => entry.plainlyListed).length,
      manualReviewCount: selected.filter((entry) => entry.manualReviewRequired).length,
      structuredCount: selected.filter((entry) => entry.structureStatus === 'Active').length,
    };
  };
  const terms = entries.filter((entry) => entry.projection === 'termsText');
  return {
    summary: {
      termCount: terms.length,
      populatedTermCount: terms.filter((term) => term.populated).length,
      emptyTermCount: terms.filter((term) => !term.populated).length,
      plainlyNumberedTermCount: terms.filter((term) => term.plainlyNumbered).length,
      manualReviewTermCount: terms.filter((term) => term.manualReviewRequired).length,
      structuredTermCount: terms.filter((term) => term.structureStatus === 'Active').length,
      projectionSummaries: Object.fromEntries(PROJECTION_LIST.map((config) => [config.key, summaryFor(config.key)])),
      duplicateGroupCount: duplicateGroups.length,
      duplicateCandidateOccurrenceCount: duplicateGroups.reduce((total, group) => total + group.occurrenceCount, 0),
    },
    terms,
    entries,
    duplicateGroups,
    fetchedAt: workspace.fetchedAt,
  };
}

function assignmentFields() {
  return 'Id,Special_Term__c,Projection__c,Clause__c,Clause__r.Name,Clause__r.Category__c,Clause__r.Status__c,Clause__r.Latest_Approved_Version_Number__c,Clause_Version__c,Clause_Version__r.Revision_Number__c,Clause_Version__r.Clause_Text__c,Clause_Version__r.Status__c,Clause_Version__r.LastModifiedDate,Sequence__c,State__c,Migration_Batch_Id__c,LastModifiedDate';
}

function mapDetailRule(row) {
  return {
    id: row.Id,
    name: row.Name || '',
    accountId: row.Account__c || null,
    accountName: row.Account__r?.Name || (row.Account__c ? 'Unavailable account' : ''),
    accountClKey: row.Account__r?.Company_Code__c || '',
    portId: row.Port__c || null,
    portName: row.Port__r?.Name || (row.Port__c ? 'Unavailable port' : ''),
    portCountry: row.Port__r?.Country__c || '',
    productId: row.Product__c || null,
    productName: row.Product__r?.Name || (row.Product__c ? 'Unavailable product' : ''),
    country: row.Country__c || '',
    audience: row.Supplier_Buyer__c || '',
    priority: row.Priority__c == null ? null : Number(row.Priority__c),
    lastModifiedAt: row.LastModifiedDate || null,
  };
}

export async function getSpecialTermDetail(termId, { force = false } = {}) {
  await resolveSpecialTermsSchema({ force });
  const id = salesforceId(termId, 'Special Term');
  const [termResult, assignmentResult, liveRuleResult, revisionHistoryResult] = await Promise.all([
    sfQuery(`SELECT Id,Name,Terms_Text__c,Add_to_Confirmation__c,Add_to_Nomination__c,Special_Remark_in_Confirmation__c,Special_Remark_in_Nomination__c,Clause_Structure_Status__c,Clause_Compiled_Hash__c,Original_Terms_Text__c,Clause_Migration_Batch_Id__c,Confirmation_Clause_Status__c,Confirmation_Clause_Style__c,Confirmation_Compiled_Hash__c,Original_Confirmation_Remark__c,Confirmation_Migration_Batch_Id__c,Nomination_Clause_Status__c,Nomination_Clause_Style__c,Nomination_Compiled_Hash__c,Original_Nomination_Remark__c,Nomination_Migration_Batch_Id__c,Approval_Status__c,Current_Revision__c,LastModifiedDate FROM Special_Term__c WHERE Id = '${soql(id)}' LIMIT 1`, { clean: true, limit: 1 }),
    sfQuery(`SELECT ${assignmentFields()} FROM Special_Term_Clause_Assignment__c WHERE Special_Term__c = '${soql(id)}' ORDER BY Projection__c,State__c,Sequence__c,Id LIMIT 500`, { clean: true, limit: 500 }),
    sfQuery(`SELECT Id,Name,Account__c,Account__r.Name,Account__r.Company_Code__c,Port__c,Port__r.Name,Port__r.Country__c,Product__c,Product__r.Name,Country__c,Supplier_Buyer__c,Priority__c,LastModifiedDate FROM Special_Term_Rule__c WHERE Special_Term__c = '${soql(id)}' ORDER BY Priority__c,Name LIMIT 250`, { clean: true, limit: 250 }),
    sfQuery(`SELECT Id,Status__c,Revision_Number__c,Revision_Reason__c,Proposed_By_Email__c,Approved_By_Email__c,Approved_At__c,Approval_Reason__c,LastModifiedDate FROM Special_Term_Revision__c WHERE Special_Term__c = '${soql(id)}' ORDER BY Revision_Number__c DESC LIMIT 50`, { clean: true, limit: 50 }),
  ]);
  const term = termResult.records[0];
  if (!term) throw specialTermsError('The selected Special Term is no longer available.', 409, 'SPECIAL_TERMS_STALE');
  const pendingRevision = (await sfQuery(`SELECT Id,Status__c,Proposed_By_Email__c,Revision_Reason__c,Revision_Number__c,LastModifiedDate FROM Special_Term_Revision__c WHERE Special_Term__c = '${soql(id)}' AND Status__c = 'In Review' ORDER BY Revision_Number__c DESC LIMIT 1`, { clean: true, limit: 1 })).records[0];
  const revisionRow = pendingRevision || (term.Current_Revision__c
    ? (await sfQuery(`SELECT Id,Status__c,Proposed_By_Email__c,Revision_Reason__c,Revision_Number__c,LastModifiedDate FROM Special_Term_Revision__c WHERE Id = '${soql(term.Current_Revision__c)}' LIMIT 1`, { clean: true, limit: 1 })).records[0]
    : null);
  const revisionClauseRows = revisionRow
    ? (await sfQuery(`SELECT Id,Projection__c,Clause__c,Clause__r.Name,Clause__r.Category__c,Clause__r.Status__c,Clause__r.Latest_Approved_Version_Number__c,Clause_Version__c,Clause_Version__r.Revision_Number__c,Clause_Version__r.Clause_Text__c,Clause_Version__r.Status__c,Clause_Version__r.LastModifiedDate,Sequence__c,State__c,LastModifiedDate FROM Special_Term_Revision_Clause__c WHERE Special_Term_Revision__c = '${soql(revisionRow.Id)}' ORDER BY Projection__c,Sequence__c,Id LIMIT 600`, { clean: true, limit: 600 })).records
    : [];
  const revisionRuleRows = revisionRow
    ? (await sfQuery(`SELECT Id,Special_Term_Rule__c,Snapshot_Type__c,Sequence__c,Audience__c,Account__c,Account__r.Name,Account__r.Company_Code__c,Port__c,Port__r.Name,Port__r.Country__c,Product__c,Product__r.Name,Country__c,Priority__c,Source_Last_Modified__c,State__c,LastModifiedDate FROM Special_Term_Revision_Rule__c WHERE Special_Term_Revision__c = '${soql(revisionRow.Id)}' ORDER BY Snapshot_Type__c,Sequence__c,Id LIMIT 400`, { clean: true, limit: 400 })).records
    : [];
  const clauseIds = [...new Set(assignmentResult.records.map((row) => row.Clause__c).filter(isId))];
  const latestVersions = clauseIds.length ? await sfQuery(`SELECT Id,Clause__c,Revision_Number__c,Clause_Text__c,Content_Hash__c,Status__c,Revision_Reason__c,Approved_By_Email__c,Approved_At__c,Approval_Reason__c,LastModifiedDate FROM Special_Term_Clause_Version__c WHERE Clause__c IN (${clauseIds.map((clauseId) => `'${soql(clauseId)}'`).join(',')}) AND Status__c = 'Approved' ORDER BY Clause__c,Revision_Number__c DESC LIMIT 500`, { clean: true, limit: 500 }) : { records: [] };
  const latestByClause = new Map();
  for (const version of latestVersions.records) if (!latestByClause.has(version.Clause__c)) latestByClause.set(version.Clause__c, version);
  const assignments = assignmentResult.records.map((row) => {
    const latest = latestByClause.get(row.Clause__c) || null;
    return {
      id: row.Id,
      clauseId: row.Clause__c,
      shortName: row.Clause__r?.Name || '',
      category: row.Clause__r?.Category__c || 'Other',
      clauseStatus: row.Clause__r?.Status__c || '',
      clauseVersionId: row.Clause_Version__c,
      revisionNumber: Number(row.Clause_Version__r?.Revision_Number__c || 0),
      clauseText: row.Clause_Version__r?.Clause_Text__c || '',
      versionStatus: row.Clause_Version__r?.Status__c || '',
      versionLastModifiedAt: row.Clause_Version__r?.LastModifiedDate || null,
      sequence: Number(row.Sequence__c || 0),
      state: row.State__c || '',
      projection: projectionConfig(row.Projection__c || 'Terms Text').key,
      projectionValue: row.Projection__c || 'Terms Text',
      migrationBatchId: row.Migration_Batch_Id__c || null,
      upgradeAvailable: row.State__c === 'Active' && row.Clause__r?.Status__c === 'Active' && latest && latest.Id !== row.Clause_Version__c,
      latestApprovedVersion: mapVersion(latest),
      lastModifiedAt: row.LastModifiedDate || null,
    };
  });
  const activeClauseIds = [...new Set(assignments.filter((row) => row.state === 'Active').map((row) => row.clauseId))];
  const consolidationRows = activeClauseIds.length ? (await sfQuery(`SELECT ${consolidationSelect()},Replacement_Version__r.Clause_Text__c FROM ${OBJECTS.consolidation} WHERE Source_Clause__c IN (${activeClauseIds.map((clauseId) => `'${soql(clauseId)}'`).join(',')}) AND Status__c IN ('Relinking','Paused','Ready to Retire') ORDER BY CreatedDate DESC LIMIT 100`, { clean: true, limit: 100 })).records : [];
  const consolidationPrompts = consolidationRows.map((row) => ({
    id: row.Id,
    status: row.Status__c,
    sourceClauseId: row.Source_Clause__c,
    sourceShortName: row.Source_Clause__r?.Name || '',
    replacementClauseId: row.Replacement_Clause__c,
    replacementShortName: row.Replacement_Clause__r?.Name || '',
    replacementVersionId: row.Replacement_Version__c,
    replacementRevisionNumber: Number(row.Replacement_Version__r?.Revision_Number__c || 0),
    replacementText: row.Replacement_Version__r?.Clause_Text__c || '',
    lastModifiedAt: row.LastModifiedDate || null,
    occurrences: assignments.filter((assignment) => assignment.state === 'Active' && assignment.clauseId === row.Source_Clause__c).map((assignment) => ({ projection: assignment.projection, projectionValue: assignment.projectionValue, sequence: assignment.sequence, sourceVersionId: assignment.clauseVersionId, sourceRevisionNumber: assignment.revisionNumber, sourceText: assignment.clauseText })),
  }));
  const projectionDetails = {};
  for (const config of PROJECTION_LIST) {
    const projected = assignments.filter((assignment) => assignment.projection === config.key);
    const status = term[config.statusField] || 'Legacy';
    const style = config.styleField ? term[config.styleField] || config.defaultStyle : config.defaultStyle;
    projectionDetails[config.key] = {
      key: config.key,
      value: config.value,
      label: config.label,
      text: term[config.textField] || '',
      status,
      style,
      compiledHash: term[config.hashField] || null,
      originalText: term[config.originalField] || '',
      migrationBatchId: term[config.batchField] || null,
      activeAssignments: projected.filter((assignment) => assignment.state === 'Active').sort((left, right) => left.sequence - right.sequence),
      proposedAssignments: projected.filter((assignment) => assignment.state === 'Proposed').sort((left, right) => left.sequence - right.sequence),
    };
  }
  return {
    term: {
      id: term.Id,
      name: term.Name || '',
      termsText: term.Terms_Text__c || '',
      addToConfirmation: term.Add_to_Confirmation__c === true,
      addToNomination: term.Add_to_Nomination__c === true,
      confirmationRemark: term.Special_Remark_in_Confirmation__c || '',
      nominationRemark: term.Special_Remark_in_Nomination__c || '',
      clauseStructureStatus: term.Clause_Structure_Status__c || 'Legacy',
      clauseCompiledHash: term.Clause_Compiled_Hash__c || null,
      originalTermsText: term.Original_Terms_Text__c || '',
      clauseMigrationBatchId: term.Clause_Migration_Batch_Id__c || null,
      confirmationClauseStatus: term.Confirmation_Clause_Status__c || 'Legacy',
      confirmationClauseStyle: term.Confirmation_Clause_Style__c || 'Hyphen',
      confirmationCompiledHash: term.Confirmation_Compiled_Hash__c || null,
      originalConfirmationRemark: term.Original_Confirmation_Remark__c || '',
      confirmationMigrationBatchId: term.Confirmation_Migration_Batch_Id__c || null,
      nominationClauseStatus: term.Nomination_Clause_Status__c || 'Legacy',
      nominationClauseStyle: term.Nomination_Clause_Style__c || 'Hyphen',
      nominationCompiledHash: term.Nomination_Compiled_Hash__c || null,
      originalNominationRemark: term.Original_Nomination_Remark__c || '',
      nominationMigrationBatchId: term.Nomination_Migration_Batch_Id__c || null,
      revisionStatus: term.Approval_Status__c || (PROJECTION_LIST.every((config) => (term[config.statusField] || 'Legacy') === 'Active') ? 'Approved' : 'Legacy'),
      currentRevision: term.Current_Revision__c || null,
      lastModifiedAt: term.LastModifiedDate || null,
    },
    activeAssignments: projectionDetails.termsText.activeAssignments,
    proposedAssignments: projectionDetails.termsText.proposedAssignments,
    projections: projectionDetails,
    // Whole-revision contract backed by the Salesforce revision and child records.
    revision: {
      id: revisionRow?.Id || null,
      status: revisionRow?.Status__c || (PROJECTION_LIST.every((config) => projectionDetails[config.key].status === 'Active') ? 'Approved' : 'Legacy'),
      proposedByEmail: revisionRow?.Proposed_By_Email__c || null,
      revisionReason: revisionRow?.Revision_Reason__c || '',
      revisionNumber: Number(revisionRow?.Revision_Number__c || 0) || null,
      expectedLastModifiedAt: revisionRow?.LastModifiedDate || null,
      lastModifiedAt: revisionRow?.LastModifiedDate || null,
      termLastModifiedAt: term.LastModifiedDate || null,
      projections: Object.fromEntries(PROJECTION_LIST.map((config) => [config.key, {
        ...projectionDetails[config.key],
        rows: revisionClauseRows.filter((row) => projectionConfig(row.Projection__c).key === config.key).map((row) => ({ id: row.Id, clauseId: row.Clause__c, clauseVersionId: row.Clause_Version__c, shortName: row.Clause__r?.Name || '', category: row.Clause__r?.Category__c || 'Other', clauseStatus: row.Clause__r?.Status__c || '', revisionNumber: Number(row.Clause_Version__r?.Revision_Number__c || 0), clauseText: row.Clause_Version__r?.Clause_Text__c || '', versionStatus: row.Clause_Version__r?.Status__c || '', versionLastModifiedAt: row.Clause_Version__r?.LastModifiedDate || null, sequence: Number(row.Sequence__c || 0), state: row.State__c || '', lastModifiedAt: row.LastModifiedDate || null })),
      }])),
      rules: revisionRuleRows.filter((row) => row.Snapshot_Type__c === 'Proposed').map((row) => ({ id: row.Id, sourceRuleId: row.Special_Term_Rule__c || null, audience: row.Audience__c || '', accountId: row.Account__c || null, accountName: row.Account__r?.Name || '', accountClKey: row.Account__r?.Company_Code__c || '', portId: row.Port__c || null, portName: row.Port__r?.Name || '', portCountry: row.Port__r?.Country__c || '', productId: row.Product__c || null, productName: row.Product__r?.Name || '', country: row.Country__c || '', priority: row.Priority__c == null ? null : Number(row.Priority__c), sequence: Number(row.Sequence__c || 0), state: row.State__c || '', lastModifiedAt: row.LastModifiedDate || null })),
    },
    rules: liveRuleResult.records.map(mapDetailRule),
    revisionHistory: revisionHistoryResult.records.map((row) => ({
      id: row.Id,
      revisionNumber: Number(row.Revision_Number__c || 0),
      status: row.Status__c || '',
      revisionReason: row.Revision_Reason__c || '',
      proposedByEmail: row.Proposed_By_Email__c || '',
      approvedByEmail: row.Approved_By_Email__c || '',
      approvedAt: row.Approved_At__c || null,
      approvalReason: row.Approval_Reason__c || '',
      lastModifiedAt: row.LastModifiedDate || null,
    })),
    consolidationPrompts,
    instanceUrl: getInstanceUrl(),
  };
}

async function ensureUniqueClause(shortName, canonicalKey, ignoreClauseId = null) {
  const shortNameResult = await sfQuery(`SELECT Id,Name FROM Special_Term_Clause__c WHERE Short_Name_Key__c = '${soql(shortNameKey(shortName))}' LIMIT 2`, { clean: true, limit: 2 });
  const shortNameCollision = shortNameResult.records.find((row) => row.Id !== ignoreClauseId);
  if (shortNameCollision) throw specialTermsError(`Clause short name ${shortName} is already in use.`, 409, 'SPECIAL_TERMS_CLAUSE_SHORT_NAME_EXISTS', { clauseId: shortNameCollision.Id });
  const versions = await sfQuery('SELECT Id,Clause__c,Clause__r.Name,Clause_Text__c FROM Special_Term_Clause_Version__c LIMIT 10000', { clean: true, limit: 10000 });
  if (versions.totalSize > versions.records.length) throw specialTermsError('The clause bank exceeds the safe equivalence-check limit.', 503, 'SPECIAL_TERMS_RESULT_LIMIT');
  const equivalent = versions.records.find((row) => row.Clause__c !== ignoreClauseId && canonicalClauseKey(row.Clause_Text__c) === canonicalKey);
  if (equivalent) throw specialTermsError(`Equivalent wording already exists as ${equivalent.Clause__r?.Name || equivalent.Clause__c}.`, 409, 'SPECIAL_TERMS_CLAUSE_EQUIVALENT_EXISTS', { clauseId: equivalent.Clause__c });
}

async function finishClauseDraftOperation(client, operation, result) {
  const clause = await loadOneClause(result.clauseId);
  return finishOperation(client, operation, { ...result, clause }, result);
}

const GLOBAL_PUBLICATION_PREVIEW_TTL_MS = 5 * 60 * 1000;

function globalPublicationSecret(explicitSecret = null) {
  const secret = String(explicitSecret || process.env.FCOS_SPECIAL_TERMS_PREVIEW_SECRET || '').trim();
  if (secret.length < 32) throw specialTermsError('Global clause publication is unavailable because its preview-signing key is not configured.', 503, 'SPECIAL_TERMS_PUBLICATION_SECRET_MISSING');
  return secret;
}

function publicationProposalHash({ shortName, category, clauseText, reason }) {
  return createHash('sha256').update(JSON.stringify([
    shortNameKey(shortName),
    category,
    clauseHash(clauseText),
    clauseHash(reason),
  ])).digest('hex');
}

function signPublicationPreview(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret).update(`special-term-clause-publication-v1:${encoded}`).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyPublicationPreview(token, secret, now = Date.now()) {
  const [encoded, suppliedSignature, ...rest] = String(token || '').split('.');
  if (!encoded || !suppliedSignature || rest.length) throw specialTermsError('The global publication preview is invalid. Review the impact again.', 409, 'SPECIAL_TERMS_PUBLICATION_PREVIEW_INVALID');
  const expectedSignature = createHmac('sha256', secret).update(`special-term-clause-publication-v1:${encoded}`).digest('base64url');
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw specialTermsError('The global publication preview is invalid. Review the impact again.', 409, 'SPECIAL_TERMS_PUBLICATION_PREVIEW_INVALID');
  let payload;
  try { payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); } catch { throw specialTermsError('The global publication preview is invalid. Review the impact again.', 409, 'SPECIAL_TERMS_PUBLICATION_PREVIEW_INVALID'); }
  if (!Number.isFinite(payload?.expiresAt) || payload.expiresAt <= now) throw specialTermsError('The global publication preview expired. Review the impact again.', 409, 'SPECIAL_TERMS_PUBLICATION_PREVIEW_EXPIRED');
  return payload;
}

async function callClausePublicationApex(clauseId, action, body = {}) {
  const result = await sfRequest(`/apexrest/fcos/special-term-clauses/${encodeURIComponent(clauseId)}/${action}`, { method: 'POST', body });
  if (result?.success !== true) throw specialTermsError(result?.message || 'Salesforce rejected the global clause publication action.', 409, result?.code || 'SPECIAL_TERMS_GLOBAL_PUBLICATION_REJECTED');
  return result;
}

export async function getSpecialTermClauseEditPreview(body = {}, { canPublish = false, previewSecret = null, now = Date.now() } = {}) {
  const clauseId = salesforceId(body.clauseId, 'Clause');
  const preview = await callClausePublicationApex(clauseId, 'publication-preview');
  const draft = preview.draftVersion || null;
  const latest = preview.latestApprovedVersion || null;
  const defaults = {
    shortName: draft?.proposedShortName || preview.shortName || '',
    category: draft?.proposedCategory || preview.category || 'Other',
    clauseText: draft?.clauseText || latest?.clauseText || '',
    revisionReason: draft ? '' : '',
  };
  const response = {
    ...preview,
    canPublishGlobally: canPublish === true,
    mode: canPublish ? 'global_publish' : 'draft_proposal',
    defaults,
    confirmationLabel: null,
    previewToken: null,
    expiresAt: null,
    warning: canPublish
      ? `Publishing creates an approved clause version and immediately updates ${preview.termCount || 0} live structured Special Term${Number(preview.termCount) === 1 ? '' : 's'} across every linked projection. The transaction is all-or-none.`
      : 'Saving creates a proposed Draft in the Clause Bank. No live Special Term changes until an authorized approver publishes reviewed wording.',
  };
  if (canPublish && body.review === true) {
    const schema = await resolveSpecialTermsSchema({ force: true, write: true });
    const shortName = cleanShortName(body.shortName);
    const category = cleanCategory(body.category, schema);
    const clauseText = cleanClauseText(body.clauseText);
    const reason = requiredReason(body.revisionReason, 'Revision reason');
    await ensureUniqueClause(shortName, canonicalClauseKey(clauseText), clauseId);
    const expiresAt = now + GLOBAL_PUBLICATION_PREVIEW_TTL_MS;
    const proposedHash = publicationProposalHash({ shortName, category, clauseText, reason });
    const tokenPayload = {
      version: 1,
      clauseId,
      baseVersionId: latest?.id || null,
      draftVersionId: draft?.id || null,
      impactHash: preview.impactHash,
      proposedHash,
      clauseLastModifiedAt: preview.clauseLastModifiedAt,
      baseVersionLastModifiedAt: latest?.lastModifiedAt || null,
      draftVersionLastModifiedAt: draft?.lastModifiedAt || null,
      expiresAt,
    };
    response.confirmationLabel = shortName;
    response.previewToken = signPublicationPreview(tokenPayload, globalPublicationSecret(previewSecret));
    response.expiresAt = new Date(expiresAt).toISOString();
  }
  return response;
}

export async function publishSpecialTermClauseGlobally(client, profile, body = {}, { previewSecret = null, now = Date.now() } = {}) {
  const schema = await resolveSpecialTermsSchema({ force: true, write: true });
  const clauseId = salesforceId(body.clauseId, 'Clause');
  const shortName = cleanShortName(body.shortName);
  const category = cleanCategory(body.category, schema);
  const clauseText = cleanClauseText(body.clauseText);
  const reason = requiredReason(body.revisionReason, 'Revision reason');
  if (text(body.confirmationLabel, 80) !== shortName) throw specialTermsError(`Type ${shortName} exactly to confirm global publication.`, 400, 'SPECIAL_TERMS_PUBLICATION_CONFIRMATION_MISMATCH');
  const tokenPayload = verifyPublicationPreview(body.previewToken, globalPublicationSecret(previewSecret), now);
  if (tokenPayload.clauseId !== clauseId || tokenPayload.proposedHash !== publicationProposalHash({ shortName, category, clauseText, reason })) {
    throw specialTermsError('The proposed clause changed after impact review. Review the global publication again.', 409, 'SPECIAL_TERMS_PUBLICATION_PREVIEW_STALE');
  }
  const reservation = await reserveOperation(client, profile, body, 'clause_global_publish', {
    id: clauseId,
    baseVersionId: tokenPayload.baseVersionId,
    draftVersionId: tokenPayload.draftVersionId,
    shortNameKey: shortNameKey(shortName),
    category,
    contentHash: clauseHash(clauseText),
    reasonHash: clauseHash(reason),
    impactHash: tokenPayload.impactHash,
  });
  if (reservation.replay) return { ...reservation.replay, clause: await loadOneClause(clauseId), idempotencyReplayed: true };
  try {
    const action = await callClausePublicationApex(clauseId, 'publish-everywhere', {
      baseVersionId: tokenPayload.baseVersionId,
      draftVersionId: tokenPayload.draftVersionId,
      shortName,
      category,
      clauseText,
      reason,
      approverEmail: profile.email,
      expectedImpactHash: tokenPayload.impactHash,
      expectedClauseLastModifiedAt: tokenPayload.clauseLastModifiedAt,
      expectedBaseVersionLastModifiedAt: tokenPayload.baseVersionLastModifiedAt,
      expectedDraftVersionLastModifiedAt: tokenPayload.draftVersionLastModifiedAt,
    });
    const termIds = (action.termIds || []).filter(isId);
    await expireSpecialTermClauseCaches(termIds);
    const clause = await loadOneClause(clauseId);
    const currentTermId = body.currentTermId && termIds.includes(body.currentTermId) ? body.currentTermId : null;
    const currentTermDetail = currentTermId ? await getSpecialTermDetail(currentTermId, { force: true }) : null;
    const result = {
      success: true,
      operation: 'globally_published',
      clauseId,
      versionId: action.versionId,
      revisionNumber: Number(action.revisionNumber || 0),
      status: action.status || 'Approved',
      termCount: Number(action.termCount || 0),
      occurrenceCount: Number(action.occurrenceCount || 0),
      termIds,
      clause,
      currentTermDetail,
    };
    return finishOperation(client, reservation.operation, result, {
      success: true,
      operation: 'globally_published',
      clauseId,
      versionId: action.versionId,
      revisionNumber: Number(action.revisionNumber || 0),
      termCount: Number(action.termCount || 0),
      occurrenceCount: Number(action.occurrenceCount || 0),
      termIds,
    });
  } catch (error) {
    return failOperation(client, reservation.operation, error);
  }
}

export async function saveSpecialTermClauseDraft(client, profile, body = {}) {
  const schema = await resolveSpecialTermsSchema({ force: true, write: true });
  const clauseText = cleanClauseText(body.clauseText);
  const reason = requiredReason(body.revisionReason, 'Revision reason');
  const shortName = cleanShortName(body.shortName);
  const category = cleanCategory(body.category, schema);
  const clauseId = body.clauseId ? salesforceId(body.clauseId, 'Clause') : null;
  const versionId = body.versionId ? salesforceId(body.versionId, 'Clause version') : null;
  if (versionId && !clauseId) throw specialTermsError('Clause is required when editing a Draft version.');
  const canonicalKey = canonicalClauseKey(clauseText);
  const provenance = draftProvenance(body);
  await ensureUniqueClause(shortName, canonicalKey, clauseId);
  const operationType = clauseId || versionId ? 'clause_draft_revise' : 'clause_draft_create';
  const reservation = await reserveOperation(client, profile, body, operationType, { id: versionId || clauseId, clauseId, versionId, shortNameKey: shortNameKey(shortName), canonicalKey, category, contentHash: clauseHash(clauseText), revisionReasonHash: clauseHash(reason), expectedLastModifiedAt: body.expectedLastModifiedAt || null, expectedClauseLastModifiedAt: body.expectedClauseLastModifiedAt || null });
  if (reservation.replay) {
    const replayClauseId = reservation.replay.clauseId || clauseId;
    return { ...reservation.replay, clause: replayClauseId ? await loadOneClause(replayClauseId) : null, idempotencyReplayed: true };
  }
  try {
    if (versionId) {
      const [clauseRow, versionRow] = await Promise.all([
        currentRecord(OBJECTS.clause, clauseId, ['Id', 'Status__c', 'LastModifiedDate']),
        currentRecord(OBJECTS.version, versionId, ['Id', 'Clause__c', 'Status__c', 'LastModifiedDate']),
      ]);
      assertCurrent(versionRow, body.expectedLastModifiedAt);
      if (clauseRow.Status__c === 'Draft') assertCurrent(clauseRow, body.expectedClauseLastModifiedAt);
      if (versionRow.Clause__c !== clauseId || versionRow.Status__c !== 'Draft') throw specialTermsError('Only the selected Draft version can be edited.', 409, 'SPECIAL_TERMS_CLAUSE_VERSION_IMMUTABLE');
      const requests = [{ method: 'PATCH', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.version}/${versionId}`, referenceId: 'version', body: { Clause_Text__c: clauseText, Content_Hash__c: clauseHash(clauseText), Revision_Reason__c: reason, Proposed_By_Email__c: profile.email, Proposed_Short_Name__c: shortName, Proposed_Category__c: category, ...provenance } }];
      if (clauseRow.Status__c === 'Draft') requests.push({ method: 'PATCH', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.clause}/${clauseId}`, referenceId: 'clause', body: { Name: shortName, Short_Name_Key__c: shortNameKey(shortName), Canonical_Text_Key__c: canonicalKey, Category__c: category } });
      const result = await sfRequest('/composite', { method: 'POST', body: { allOrNone: true, compositeRequest: requests } });
      assertComposite(result, 'Salesforce rejected the Draft clause edit.');
      return finishClauseDraftOperation(client, reservation.operation, { success: true, clauseId, versionId, operation: 'draft_updated' });
    }

    if (clauseId) {
      const clauseRow = await currentRecord(OBJECTS.clause, clauseId, ['Id', 'Status__c', 'LastModifiedDate']);
      assertCurrent(clauseRow, body.expectedLastModifiedAt);
      if (clauseRow.Status__c === 'Retired') throw specialTermsError('Retired clauses cannot receive new revisions.', 409, 'SPECIAL_TERMS_CLAUSE_RETIRED');
      const versions = await sfQuery(`SELECT Id,Revision_Number__c,Status__c FROM Special_Term_Clause_Version__c WHERE Clause__c = '${soql(clauseId)}' ORDER BY Revision_Number__c DESC LIMIT 100`, { clean: true, limit: 100 });
      if (versions.records.some((row) => row.Status__c === 'Draft')) throw specialTermsError('This clause already has a Draft revision.', 409, 'SPECIAL_TERMS_CLAUSE_DRAFT_EXISTS');
      const revisionNumber = Number(versions.records[0]?.Revision_Number__c || 0) + 1;
      const created = await sfRequest(`/sobjects/${OBJECTS.version}`, { method: 'POST', body: { Clause__c: clauseId, Revision_Number__c: revisionNumber, Clause_Text__c: clauseText, Content_Hash__c: clauseHash(clauseText), Status__c: 'Draft', Revision_Reason__c: reason, Proposed_By_Email__c: profile.email, Proposed_Short_Name__c: shortName, Proposed_Category__c: category, ...provenance } });
      const createdVersionId = salesforceId(created?.id, 'Created clause version');
      return finishClauseDraftOperation(client, reservation.operation, { success: true, clauseId, versionId: createdVersionId, revisionNumber, operation: 'revision_proposed' });
    }

    const result = await sfRequest('/composite', {
      method: 'POST',
      body: {
        allOrNone: true,
        compositeRequest: [
          { method: 'POST', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.clause}`, referenceId: 'clause', body: { Name: shortName, Short_Name_Key__c: shortNameKey(shortName), Canonical_Text_Key__c: canonicalKey, Category__c: category, Status__c: 'Draft', Origin__c: provenance.Draft_Source__c === 'Legacy Migration' ? 'Legacy' : provenance.Draft_Source__c, Legacy_Original_Text__c: provenance.Draft_Source__c === 'Legacy Migration' ? clauseText : null, Latest_Approved_Version_Number__c: 0 } },
          { method: 'POST', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.version}`, referenceId: 'version', body: { Clause__c: '@{clause.id}', Revision_Number__c: 1, Clause_Text__c: clauseText, Content_Hash__c: clauseHash(clauseText), Status__c: 'Draft', Revision_Reason__c: reason, Proposed_By_Email__c: profile.email, Proposed_Short_Name__c: shortName, Proposed_Category__c: category, ...provenance } },
        ],
      },
    });
    assertComposite(result, 'Salesforce rejected the Draft clause.');
    const clauseCreatedId = salesforceId(result.compositeResponse.find((response) => response.referenceId === 'clause')?.body?.id, 'Created clause');
    const versionCreatedId = salesforceId(result.compositeResponse.find((response) => response.referenceId === 'version')?.body?.id, 'Created clause version');
    return finishClauseDraftOperation(client, reservation.operation, { success: true, clauseId: clauseCreatedId, versionId: versionCreatedId, revisionNumber: 1, operation: 'draft_created' });
  } catch (error) {
    return failOperation(client, reservation.operation, error);
  }
}

export async function approveSpecialTermClause(client, profile, body = {}) {
  const schema = await resolveSpecialTermsSchema({ force: true, write: true });
  const clauseId = salesforceId(body.clauseId, 'Clause');
  const versionId = salesforceId(body.versionId, 'Clause version');
  const reason = requiredReason(body.approvalReason, 'Approval reason');
  const applyDraftEdits = body.applyDraftEdits === true;
  const requestedShortName = applyDraftEdits ? cleanShortName(body.shortName) : null;
  const requestedCategory = applyDraftEdits ? cleanCategory(body.category, schema) : null;
  const requestedText = applyDraftEdits ? cleanClauseText(body.clauseText) : null;
  const requestedRevisionReason = applyDraftEdits ? requiredReason(body.revisionReason, 'Revision reason') : null;
  const reservation = await reserveOperation(client, profile, body, 'clause_approve', {
    id: versionId,
    clauseId,
    versionId,
    initialDraftEdit: applyDraftEdits,
    shortNameKey: requestedShortName ? shortNameKey(requestedShortName) : null,
    category: requestedCategory,
    contentHash: requestedText ? clauseHash(requestedText) : null,
    revisionReasonHash: requestedRevisionReason ? clauseHash(requestedRevisionReason) : null,
    approvalReasonHash: clauseHash(reason),
    expectedClauseLastModifiedAt: body.expectedClauseLastModifiedAt,
    expectedVersionLastModifiedAt: body.expectedVersionLastModifiedAt,
  });
  if (reservation.replay) return { ...reservation.replay, clause: await loadOneClause(clauseId), idempotencyReplayed: true };
  try {
    const [clauseRow, versionRow] = await Promise.all([
      currentRecord(OBJECTS.clause, clauseId, ['Id', 'Name', 'Category__c', 'Status__c', 'LastModifiedDate']),
      currentRecord(OBJECTS.version, versionId, ['Id', 'Clause__c', 'Revision_Number__c', 'Clause_Text__c', 'Revision_Reason__c', 'Proposed_Short_Name__c', 'Proposed_Category__c', 'Status__c', 'LastModifiedDate']),
    ]);
    assertCurrent(clauseRow, body.expectedClauseLastModifiedAt);
    assertCurrent(versionRow, body.expectedVersionLastModifiedAt);
    if (versionRow.Clause__c !== clauseId || versionRow.Status__c !== 'Draft') throw specialTermsError('Only the selected Draft version can be approved.', 409, 'SPECIAL_TERMS_CLAUSE_VERSION_IMMUTABLE');
    const approvedShortName = requestedShortName || cleanShortName(versionRow.Proposed_Short_Name__c || clauseRow.Name);
    const approvedCategory = requestedCategory || cleanCategory(versionRow.Proposed_Category__c || clauseRow.Category__c, schema);
    const approvedText = requestedText || cleanClauseText(versionRow.Clause_Text__c);
    const approvedRevisionReason = requestedRevisionReason || versionRow.Revision_Reason__c;
    await ensureUniqueClause(approvedShortName, canonicalClauseKey(approvedText), clauseId);
    const currentApproved = await sfQuery(`SELECT Id FROM Special_Term_Clause_Version__c WHERE Clause__c = '${soql(clauseId)}' AND Status__c = 'Approved' LIMIT 2`, { clean: true, limit: 2 });
    if (currentApproved.records.length > 1) throw specialTermsError('Clause has multiple approved versions and requires repair.', 409, 'SPECIAL_TERMS_CLAUSE_VERSION_CONFLICT');
    if (applyDraftEdits && (currentApproved.records.length || clauseRow.Status__c !== 'Draft' || Number(versionRow.Revision_Number__c) !== 1)) {
      throw specialTermsError('Direct editing-base approval is limited to a Draft-only v1 clause. Review the global publication impact for an established shared clause.', 409, 'SPECIAL_TERMS_INITIAL_APPROVAL_REQUIRED');
    }
    const dependentConsolidations = await sfQuery(`SELECT Id,Status__c FROM ${OBJECTS.consolidation} WHERE Replacement_Clause__c = '${soql(clauseId)}' AND Status__c IN ('Relinking','Ready to Retire') LIMIT 201`, { clean: true, limit: 201 });
    if (dependentConsolidations.records.length > 200) throw specialTermsError('More than 200 active consolidations depend on this clause. Resolve them before approving another version.', 409, 'SPECIAL_TERMS_CONSOLIDATION_LIMIT');
    const now = new Date().toISOString();
    const requests = [];
    if (currentApproved.records[0]) requests.push({ method: 'PATCH', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.version}/${currentApproved.records[0].Id}`, referenceId: 'superseded', body: { Status__c: 'Superseded' } });
    const approvedVersionBody = {
      Status__c: 'Approved',
      Approved_By_Email__c: profile.email,
      Approved_At__c: now,
      Approval_Reason__c: reason,
      ...(applyDraftEdits ? {
        Clause_Text__c: approvedText,
        Content_Hash__c: clauseHash(approvedText),
        Revision_Reason__c: approvedRevisionReason,
        Proposed_Short_Name__c: approvedShortName,
        Proposed_Category__c: approvedCategory,
      } : {}),
    };
    requests.push(
      { method: 'PATCH', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.version}/${versionId}`, referenceId: 'approved', body: approvedVersionBody },
      { method: 'PATCH', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.clause}/${clauseId}`, referenceId: 'clause', body: { Name: approvedShortName, Short_Name_Key__c: shortNameKey(approvedShortName), Canonical_Text_Key__c: canonicalClauseKey(approvedText), Category__c: approvedCategory, Status__c: 'Active', Latest_Approved_Version_Number__c: versionRow.Revision_Number__c, Last_Approved_At__c: now, Retirement_Reason__c: null, Replacement_Clause__c: null } },
    );
    if (dependentConsolidations.records.length) requests.push({ method: 'PATCH', url: `/services/data/${getApiVersion()}/composite/sobjects`, referenceId: 'pauseConsolidations', body: { allOrNone: true, records: dependentConsolidations.records.map((row) => ({ attributes: { type: OBJECTS.consolidation }, Id: row.Id, Status__c: 'Paused' })) } });
    const result = await sfRequest('/composite', { method: 'POST', body: { allOrNone: true, compositeRequest: requests } });
    assertComposite(result, 'Salesforce rejected the clause approval.');
    await expireSpecialTermClauseCaches();
    const clause = await loadOneClause(clauseId);
    return finishOperation(
      client,
      reservation.operation,
      { success: true, clauseId, versionId, revisionNumber: Number(versionRow.Revision_Number__c), operation: 'approved', initialApproval: applyDraftEdits, termCount: 0, occurrenceCount: 0, clause },
      { success: true, clauseId, versionId, revisionNumber: Number(versionRow.Revision_Number__c), operation: 'approved', initialApproval: applyDraftEdits, termCount: 0, occurrenceCount: 0 },
    );
  } catch (error) {
    return failOperation(client, reservation.operation, error);
  }
}

export async function retireSpecialTermClause(client, profile, body = {}) {
  await resolveSpecialTermsSchema({ force: true, write: true });
  const clauseId = salesforceId(body.clauseId, 'Clause');
  const replacementClauseId = body.replacementClauseId ? salesforceId(body.replacementClauseId, 'Replacement clause') : null;
  const reason = requiredReason(body.retirementReason, 'Retirement reason');
  if (replacementClauseId === clauseId) throw specialTermsError('Replacement clause must be different.');
  const reservation = await reserveOperation(client, profile, body, 'clause_retire', { id: clauseId, replacementClauseId, retirementReasonHash: clauseHash(reason), expectedLastModifiedAt: body.expectedLastModifiedAt });
  if (reservation.replay) return { ...reservation.replay, idempotencyReplayed: true };
  try {
    const clauseRow = await currentRecord(OBJECTS.clause, clauseId, ['Id', 'Status__c', 'LastModifiedDate']);
    assertCurrent(clauseRow, body.expectedLastModifiedAt);
    if (clauseRow.Status__c !== 'Active') throw specialTermsError('Only an active clause can be retired.', 409, 'SPECIAL_TERMS_CLAUSE_NOT_ACTIVE');
    const [openConsolidation, liveUse, pendingUse] = await Promise.all([
      sfQuery(`SELECT Id FROM ${OBJECTS.consolidation} WHERE Source_Clause__c = '${soql(clauseId)}' AND Status__c IN ('Relinking','Paused','Ready to Retire') LIMIT 1`, { clean: true, limit: 1 }),
      sfQuery(`SELECT Id FROM ${OBJECTS.assignment} WHERE Clause__c = '${soql(clauseId)}' AND State__c = 'Active' LIMIT 1`, { clean: true, limit: 1 }),
      sfQuery(`SELECT Id FROM ${OBJECTS.revisionClause} WHERE Clause__c = '${soql(clauseId)}' AND Special_Term_Revision__r.Status__c IN ('Draft','In Review') LIMIT 1`, { clean: true, limit: 1 }),
    ]);
    if (openConsolidation.records.length) throw specialTermsError('Complete or cancel the governed consolidation before retiring this clause.', 409, 'SPECIAL_TERMS_CONSOLIDATION_OPEN');
    if (liveUse.records.length || pendingUse.records.length) throw specialTermsError('A clause with live or pending Special Term references must use the governed Consolidate workflow.', 409, 'SPECIAL_TERMS_CLAUSE_IN_USE');
    if (replacementClauseId) {
      const replacement = await currentRecord(OBJECTS.clause, replacementClauseId, ['Id', 'Status__c']);
      if (replacement.Status__c !== 'Active') throw specialTermsError('Replacement clause must be active.');
    }
    await sfRequest(`/sobjects/${OBJECTS.clause}/${clauseId}`, { method: 'PATCH', body: { Status__c: 'Retired', Retirement_Reason__c: reason, Replacement_Clause__c: replacementClauseId } });
    await expireSpecialTermClauseCaches();
    const clause = await loadOneClause(clauseId);
    return finishOperation(client, reservation.operation, { success: true, clauseId, replacementClauseId, clause, operation: 'retired' }, { success: true, clauseId, replacementClauseId, operation: 'retired' });
  } catch (error) {
    return failOperation(client, reservation.operation, error);
  }
}

async function consolidationRecord(consolidationId) {
  const result = await sfQuery(`SELECT ${consolidationSelect()} FROM ${OBJECTS.consolidation} WHERE Id = '${soql(consolidationId)}' LIMIT 1`, { clean: true, limit: 1 });
  const row = result.records[0];
  if (!row) throw specialTermsError('Clause consolidation no longer exists.', 409, 'SPECIAL_TERMS_CONSOLIDATION_MISSING');
  return row;
}

export async function startSpecialTermClauseConsolidation(client, profile, body = {}) {
  await Promise.all([resolveSpecialTermsSchema({ force: true, write: true }), resolveConsolidationSchema()]);
  const sourceClauseId = salesforceId(body.sourceClauseId, 'Source clause');
  const replacementClauseId = salesforceId(body.replacementClauseId, 'Replacement clause');
  if (sourceClauseId === replacementClauseId) throw specialTermsError('A clause cannot replace itself.');
  if (body.equivalenceConfirmed !== true) throw specialTermsError('Confirm that contractual meaning and every material qualifier are equivalent.', 400, 'SPECIAL_TERMS_EQUIVALENCE_CONFIRMATION_REQUIRED');
  const reason = requiredReason(body.reason, 'Consolidation reason');
  const reservation = await reserveOperation(client, profile, body, 'clause_consolidation_start', {
    id: sourceClauseId,
    sourceClauseId,
    replacementClauseId,
    reasonHash: clauseHash(reason),
    expectedSourceLastModifiedAt: body.expectedSourceLastModifiedAt,
    expectedReplacementLastModifiedAt: body.expectedReplacementLastModifiedAt,
  });
  if (reservation.replay) return { ...reservation.replay, idempotencyReplayed: true };
  try {
    const [source, replacement, existing] = await Promise.all([
      currentRecord(OBJECTS.clause, sourceClauseId, ['Id', 'Name', 'Status__c', 'Latest_Approved_Version_Number__c', 'LastModifiedDate']),
      currentRecord(OBJECTS.clause, replacementClauseId, ['Id', 'Name', 'Status__c', 'Latest_Approved_Version_Number__c', 'LastModifiedDate']),
      sfQuery(`SELECT Id FROM ${OBJECTS.consolidation} WHERE Status__c IN ('Relinking','Paused','Ready to Retire') AND (Source_Clause__c IN ('${soql(sourceClauseId)}','${soql(replacementClauseId)}') OR Replacement_Clause__c IN ('${soql(sourceClauseId)}','${soql(replacementClauseId)}')) LIMIT 3`, { clean: true, limit: 3 }),
    ]);
    assertCurrent(source, body.expectedSourceLastModifiedAt);
    assertCurrent(replacement, body.expectedReplacementLastModifiedAt);
    if (source.Status__c !== 'Active' || replacement.Status__c !== 'Active') throw specialTermsError('Both source and replacement clauses must be approved and active.', 409, 'SPECIAL_TERMS_CLAUSE_NOT_ACTIVE');
    if (existing.records.length) throw specialTermsError('The source or replacement clause already has an active elimination workflow.', 409, 'SPECIAL_TERMS_CONSOLIDATION_EXISTS');
    const replacementVersions = await sfQuery(`SELECT ${VERSION_SELECT} FROM ${OBJECTS.version} WHERE Clause__c = '${soql(replacementClauseId)}' AND Status__c = 'Approved' ORDER BY Revision_Number__c DESC LIMIT 2`, { clean: true, limit: 2 });
    if (replacementVersions.records.length !== 1) throw specialTermsError('Replacement clause must have exactly one current approved version.', 409, 'SPECIAL_TERMS_CLAUSE_VERSION_CONFLICT');
    const replacementVersion = replacementVersions.records[0];
    if (Number(replacement.Latest_Approved_Version_Number__c || 0) !== Number(replacementVersion.Revision_Number__c || 0)) throw specialTermsError('Replacement clause version is out of sync. Refresh before consolidating.', 409, 'SPECIAL_TERMS_STALE');
    const [usedVersions, pendingUsedVersions] = await Promise.all([
      sfQuery(`SELECT Clause_Version__c FROM ${OBJECTS.assignment} WHERE Clause__c = '${soql(sourceClauseId)}' AND State__c = 'Active' GROUP BY Clause_Version__c LIMIT 200`, { clean: true, limit: 200 }),
      sfQuery(`SELECT Clause_Version__c FROM ${OBJECTS.revisionClause} WHERE Clause__c = '${soql(sourceClauseId)}' AND Special_Term_Revision__r.Status__c IN ('Draft','In Review') GROUP BY Clause_Version__c LIMIT 200`, { clean: true, limit: 200 }),
    ]);
    const usedVersionIds = [...new Set([...usedVersions.records, ...pendingUsedVersions.records].map((row) => row.Clause_Version__c).filter(isId))];
    const approvedSource = await sfQuery(`SELECT ${VERSION_SELECT} FROM ${OBJECTS.version} WHERE Clause__c = '${soql(sourceClauseId)}' AND Status__c = 'Approved' LIMIT 2`, { clean: true, limit: 2 });
    for (const row of approvedSource.records) if (!usedVersionIds.includes(row.Id)) usedVersionIds.push(row.Id);
    if (!usedVersionIds.length) throw specialTermsError('Source clause has no retained approved version to map.', 409, 'SPECIAL_TERMS_CLAUSE_VERSION_MISSING');
    const sourceVersions = await sfQuery(`SELECT ${VERSION_SELECT} FROM ${OBJECTS.version} WHERE Id IN (${usedVersionIds.map((id) => `'${soql(id)}'`).join(',')}) LIMIT 200`, { clean: true, limit: 200 });
    if (sourceVersions.records.length !== usedVersionIds.length) throw specialTermsError('A source version changed or is unavailable.', 409, 'SPECIAL_TERMS_STALE');
    for (const version of sourceVersions.records) {
      if (!['Approved', 'Superseded'].includes(version.Status__c)) throw specialTermsError('Every used source version must be approved or retained as superseded.', 409, 'SPECIAL_TERMS_CLAUSE_VERSION_IMMUTABLE');
      if (hasMaterialDifference(version.Clause_Text__c, replacementVersion.Clause_Text__c)) throw specialTermsError(`Source v${version.Revision_Number__c} differs in an amount, deadline, entity, port, product, standard, or jurisdiction. Keep it as a distinct clause.`, 409, 'SPECIAL_TERMS_MATERIAL_DIFFERENCE');
    }
    const now = new Date().toISOString();
    const consolidationKey = `${sourceClauseId}:${text(body.operationId, 100)}`.slice(0, 120);
    const requests = [{ method: 'POST', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.consolidation}`, referenceId: 'consolidation', body: {
      Consolidation_Key__c: consolidationKey,
      Source_Clause__c: sourceClauseId,
      Replacement_Clause__c: replacementClauseId,
      Replacement_Version__c: replacementVersion.Id,
      Status__c: 'Relinking',
      Reason__c: reason,
      Confirmed_By_Email__c: profile.email,
      Confirmed_At__c: now,
    } }];
    sourceVersions.records.forEach((version, index) => requests.push({ method: 'POST', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.consolidationMap}`, referenceId: `mapping${index}`, body: {
      Consolidation__c: '@{consolidation.id}',
      Source_Version__c: version.Id,
      Replacement_Version__c: replacementVersion.Id,
      Equivalence_Status__c: canonicalClauseKey(version.Clause_Text__c) === canonicalClauseKey(replacementVersion.Clause_Text__c) ? 'Exact Normalized' : 'Approved Equivalent',
      Mapping_Key__c: `${version.Id}:${replacementVersion.Id}:${text(body.operationId, 100)}`.slice(0, 150),
      Source_Content_Hash__c: version.Content_Hash__c,
      Replacement_Content_Hash__c: replacementVersion.Content_Hash__c,
      Confirmed_By_Email__c: profile.email,
      Confirmed_At__c: now,
    } }));
    requests.push({ method: 'PATCH', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.clause}/${sourceClauseId}`, referenceId: 'sourceClause', body: { Replacement_Clause__c: replacementClauseId } });
    const write = await sfRequest('/composite/graph', { method: 'POST', body: { graphs: [{ graphId: 'specialTermClauseConsolidation', compositeRequest: requests }] } });
    assertCompositeGraph(write, 'Salesforce rejected the clause consolidation.');
    const consolidationId = write.graphs?.[0]?.graphResponse?.compositeResponse?.find((row) => row.referenceId === 'consolidation')?.body?.id || null;
    await expireSpecialTermClauseCaches();
    return finishOperation(client, reservation.operation, { success: true, consolidationId, sourceClauseId, replacementClauseId, replacementVersionId: replacementVersion.Id, mappedVersionCount: sourceVersions.records.length, operation: 'consolidation_started' }, { success: true, consolidationId, sourceClauseId, replacementClauseId, replacementVersionId: replacementVersion.Id, mappedVersionCount: sourceVersions.records.length, operation: 'consolidation_started' });
  } catch (error) {
    return failOperation(client, reservation.operation, error);
  }
}

export async function cancelSpecialTermClauseConsolidation(client, profile, body = {}) {
  await Promise.all([resolveSpecialTermsSchema({ force: true, write: true }), resolveConsolidationSchema()]);
  const consolidationId = salesforceId(body.consolidationId, 'Clause consolidation');
  const reason = requiredReason(body.reason, 'Cancellation reason');
  const reservation = await reserveOperation(client, profile, body, 'clause_consolidation_cancel', { id: consolidationId, reasonHash: clauseHash(reason), expectedLastModifiedAt: body.expectedLastModifiedAt });
  if (reservation.replay) return { ...reservation.replay, idempotencyReplayed: true };
  try {
    const row = await consolidationRecord(consolidationId);
    assertCurrent(row, body.expectedLastModifiedAt);
    if (!['Relinking', 'Paused', 'Ready to Retire'].includes(row.Status__c)) throw specialTermsError('Only an open consolidation can be cancelled.', 409, 'SPECIAL_TERMS_CONSOLIDATION_CLOSED');
    const now = new Date().toISOString();
    const write = await sfRequest('/composite', { method: 'POST', body: { allOrNone: true, compositeRequest: [
      { method: 'PATCH', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.consolidation}/${consolidationId}`, referenceId: 'consolidation', body: { Status__c: 'Cancelled', Cancelled_By_Email__c: profile.email, Cancelled_At__c: now, Reason__c: reason } },
      { method: 'PATCH', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.clause}/${row.Source_Clause__c}`, referenceId: 'sourceClause', body: { Replacement_Clause__c: null } },
    ] } });
    assertComposite(write, 'Salesforce rejected consolidation cancellation.');
    await expireSpecialTermClauseCaches();
    return finishOperation(client, reservation.operation, { success: true, consolidationId, operation: 'consolidation_cancelled' });
  } catch (error) {
    return failOperation(client, reservation.operation, error);
  }
}

export async function completeSpecialTermClauseConsolidation(client, profile, body = {}) {
  await Promise.all([resolveSpecialTermsSchema({ force: true, write: true }), resolveConsolidationSchema()]);
  const consolidationId = salesforceId(body.consolidationId, 'Clause consolidation');
  const reason = requiredReason(body.reason, 'Retirement reason');
  const reservation = await reserveOperation(client, profile, body, 'clause_consolidation_complete', { id: consolidationId, reasonHash: clauseHash(reason), expectedLastModifiedAt: body.expectedLastModifiedAt });
  if (reservation.replay) return { ...reservation.replay, idempotencyReplayed: true };
  try {
    const row = await consolidationRecord(consolidationId);
    assertCurrent(row, body.expectedLastModifiedAt);
    if (!['Relinking', 'Ready to Retire'].includes(row.Status__c)) throw specialTermsError('This consolidation is not ready for retirement.', 409, 'SPECIAL_TERMS_CONSOLIDATION_NOT_READY');
    if (row.Source_Clause__r?.Status__c !== 'Active' || row.Replacement_Clause__r?.Status__c !== 'Active' || row.Replacement_Version__r?.Status__c !== 'Approved' || Number(row.Replacement_Clause__r?.Latest_Approved_Version_Number__c || 0) !== Number(row.Replacement_Version__r?.Revision_Number__c || 0)) throw specialTermsError('The pinned replacement changed. Cancel this mapping and start a newly reviewed consolidation before retirement.', 409, 'SPECIAL_TERMS_CONSOLIDATION_TARGET_CHANGED');
    const [liveUses, pendingUses] = await Promise.all([
      sfQuery(`SELECT Id FROM ${OBJECTS.assignment} WHERE Clause__c = '${soql(row.Source_Clause__c)}' AND State__c = 'Active' LIMIT 1`, { clean: true, limit: 1 }),
      sfQuery(`SELECT Id FROM ${OBJECTS.revisionClause} WHERE Clause__c = '${soql(row.Source_Clause__c)}' AND Special_Term_Revision__r.Status__c IN ('Draft','In Review') LIMIT 1`, { clean: true, limit: 1 }),
    ]);
    if (liveUses.records.length || pendingUses.records.length) throw specialTermsError('Every live and pending source-clause reference must be relinked before retirement.', 409, 'SPECIAL_TERMS_CONSOLIDATION_REFERENCES_REMAIN');
    const now = new Date().toISOString();
    const requests = [];
    if (row.Status__c !== 'Ready to Retire') requests.push({ method: 'PATCH', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.consolidation}/${consolidationId}`, referenceId: 'ready', body: { Status__c: 'Ready to Retire' } });
    requests.push(
      { method: 'PATCH', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.consolidation}/${consolidationId}`, referenceId: 'completed', body: { Status__c: 'Completed', Completed_By_Email__c: profile.email, Completed_At__c: now } },
      { method: 'PATCH', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.clause}/${row.Source_Clause__c}`, referenceId: 'retiredClause', body: { Status__c: 'Retired', Replacement_Clause__c: row.Replacement_Clause__c, Retirement_Reason__c: reason } },
    );
    const write = await sfRequest('/composite', { method: 'POST', body: { allOrNone: true, compositeRequest: requests } });
    assertComposite(write, 'Salesforce rejected final clause retirement.');
    await expireSpecialTermClauseCaches();
    const clause = await loadOneClause(row.Source_Clause__c);
    return finishOperation(client, reservation.operation, { success: true, consolidationId, clause, operation: 'consolidation_completed' }, { success: true, consolidationId, clauseId: row.Source_Clause__c, operation: 'consolidation_completed' });
  } catch (error) {
    return failOperation(client, reservation.operation, error);
  }
}

function relinkProjectionPayload(detail, sourceClauseId, replacementClauseId, replacementVersionId) {
  return PROJECTION_LIST.map((config) => {
    const projection = detail.projections?.[config.key] || {};
    const rows = projection.activeAssignments || [];
    const replaced = rows.map((row) => row.clauseId === sourceClauseId ? { ...row, clauseId: replacementClauseId, clauseVersionId: replacementVersionId } : row);
    const clauseIds = replaced.map((row) => row.clauseId);
    if (new Set(clauseIds).size !== clauseIds.length) throw specialTermsError(`${config.label} already contains the replacement clause and requires individual conflict review.`, 409, 'SPECIAL_TERMS_CONSOLIDATION_DRAFT_CONFLICT');
    return { projection: config.key, style: projection.style || config.defaultStyle, versionIds: replaced.map((row) => row.clauseVersionId) };
  });
}

function relinkRulePayload(detail) {
  return (detail.rules || []).map((rule) => ({
    sourceRuleId: rule.id,
    audience: rule.audience || null,
    accountId: rule.accountId || null,
    portId: rule.portId || null,
    productId: rule.productId || null,
    country: rule.country || null,
    lastModifiedAt: rule.lastModifiedAt || null,
  }));
}

export async function relinkSpecialTermClauseConsolidation(client, profile, body = {}) {
  await Promise.all([resolveSpecialTermsSchema({ force: true, write: true }), resolveConsolidationSchema()]);
  const consolidationId = salesforceId(body.consolidationId, 'Clause consolidation');
  const requestedTerms = (Array.isArray(body.terms) ? body.terms : []).map((row) => ({
    termId: salesforceId(row.termId || row.id, 'Special Term'),
    expectedLastModifiedAt: text(row.expectedLastModifiedAt, 100),
    expectedRevisionLastModifiedAt: text(row.expectedRevisionLastModifiedAt, 100),
  }));
  if (!requestedTerms.length || requestedTerms.length > 20 || new Set(requestedTerms.map((row) => row.termId)).size !== requestedTerms.length) throw specialTermsError('Select between 1 and 20 distinct affected Special Terms.', 400, 'SPECIAL_TERMS_CONSOLIDATION_BATCH_INVALID');
  const reason = requiredReason(body.reason, 'Relink reason');
  const reservation = await reserveOperation(client, profile, body, 'clause_consolidation_relink', {
    id: consolidationId,
    consolidationId,
    termIds: requestedTerms.map((row) => row.termId).sort(),
    reasonHash: clauseHash(reason),
    expectedLastModifiedAt: body.expectedLastModifiedAt,
    termTimestamps: requestedTerms.map((row) => [row.termId, row.expectedLastModifiedAt, row.expectedRevisionLastModifiedAt]),
  });
  if (reservation.replay) return { ...reservation.replay, idempotencyReplayed: true };
  try {
    const consolidation = await consolidationRecord(consolidationId);
    assertCurrent(consolidation, body.expectedLastModifiedAt);
    if (consolidation.Status__c !== 'Relinking') throw specialTermsError('Only a current Relinking consolidation can create replacement drafts.', 409, 'SPECIAL_TERMS_CONSOLIDATION_PAUSED');
    if (consolidation.Source_Clause__r?.Status__c !== 'Active' || consolidation.Replacement_Clause__r?.Status__c !== 'Active' || consolidation.Replacement_Version__r?.Status__c !== 'Approved' || Number(consolidation.Replacement_Clause__r?.Latest_Approved_Version_Number__c || 0) !== Number(consolidation.Replacement_Version__r?.Revision_Number__c || 0)) throw specialTermsError('The pinned replacement is no longer the current approved version. A GM or Administrator must revalidate the mapping.', 409, 'SPECIAL_TERMS_CONSOLIDATION_TARGET_CHANGED');
    const mappingResult = await sfQuery(`SELECT Source_Version__c FROM ${OBJECTS.consolidationMap} WHERE Consolidation__c = '${soql(consolidationId)}' LIMIT 200`, { clean: true, limit: 200 });
    const mappedSourceVersionIds = new Set(mappingResult.records.map((row) => row.Source_Version__c));
    const results = [];
    for (let index = 0; index < requestedTerms.length; index += 1) {
      const requested = requestedTerms[index];
      try {
        const detail = await getSpecialTermDetail(requested.termId, { force: true });
        if (!requested.expectedLastModifiedAt || detail.term.lastModifiedAt !== requested.expectedLastModifiedAt) throw specialTermsError('This Special Term changed after the consolidation queue was opened. Refresh before relinking.', 409, 'SPECIAL_TERMS_STALE');
        const liveSourceRows = PROJECTION_LIST.flatMap((config) => detail.projections?.[config.key]?.activeAssignments || []).filter((row) => row.clauseId === consolidation.Source_Clause__c);
        if (liveSourceRows.some((row) => !mappedSourceVersionIds.has(row.clauseVersionId))) throw specialTermsError('This term uses an unreviewed source version. A GM or Administrator must update the equivalence mapping.', 409, 'SPECIAL_TERMS_CONSOLIDATION_MAPPING_MISSING');
        const pendingRevision = detail.revision && ['Draft', 'In Review'].includes(detail.revision.status) ? detail.revision : null;
        if (pendingRevision) {
          if (!requested.expectedRevisionLastModifiedAt || pendingRevision.lastModifiedAt !== requested.expectedRevisionLastModifiedAt) throw specialTermsError('The existing whole-term draft changed after the queue was opened. Refresh before relinking.', 409, 'SPECIAL_TERMS_STALE');
          const proposedRows = PROJECTION_LIST.flatMap((config) => (pendingRevision.projections?.[config.key]?.rows || []).map((row) => ({ ...row, projection: config.key })));
          const sourceRows = proposedRows.filter((row) => row.clauseId === consolidation.Source_Clause__c);
          const replacementRows = proposedRows.filter((row) => row.clauseId === consolidation.Replacement_Clause__c);
          if (sourceRows.some((row) => !mappedSourceVersionIds.has(row.clauseVersionId))) throw specialTermsError('This draft uses an unreviewed source version. A GM or Administrator must update the equivalence mapping.', 409, 'SPECIAL_TERMS_CONSOLIDATION_MAPPING_MISSING');
          if (!sourceRows.length) {
            if (replacementRows.length) results.push({ termId: requested.termId, status: 'awaiting_approval', revisionId: pendingRevision.id });
            else if (!liveSourceRows.length) results.push({ termId: requested.termId, status: 'already_relinked', revisionId: pendingRevision.id });
            else throw specialTermsError('The existing draft already substitutes another clause and requires individual review.', 409, 'SPECIAL_TERMS_CONSOLIDATION_DRAFT_CONFLICT');
            continue;
          }
          for (const sourceRow of sourceRows) if (replacementRows.some((row) => row.projection === sourceRow.projection)) throw specialTermsError('The existing draft already contains both source and replacement clauses in one projection.', 409, 'SPECIAL_TERMS_CONSOLIDATION_DRAFT_CONFLICT');
          const write = await sfRequest('/composite', { method: 'POST', body: { allOrNone: true, compositeRequest: [{
            method: 'PATCH',
            url: `/services/data/${getApiVersion()}/composite/sobjects`,
            referenceId: 'relinkRevisionClauses',
            body: { allOrNone: true, records: sourceRows.map((row) => ({ attributes: { type: OBJECTS.revisionClause }, Id: row.id, Clause__c: consolidation.Replacement_Clause__c, Clause_Version__c: consolidation.Replacement_Version__c })) },
          }, {
            method: 'PATCH',
            url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.revision}/${pendingRevision.id}`,
            referenceId: 'touchRevision',
            body: { Revision_Reason__c: pendingRevision.revisionReason },
          }] } });
          assertComposite(write, 'Salesforce rejected the existing-draft relink.');
          const refreshed = await currentRecord(OBJECTS.revision, pendingRevision.id, ['Id', 'LastModifiedDate']);
          results.push({ termId: requested.termId, status: 'awaiting_approval', revisionId: pendingRevision.id, revisionLastModifiedAt: refreshed.LastModifiedDate || null });
          continue;
        }
        if (!liveSourceRows.length) {
          results.push({ termId: requested.termId, status: 'already_relinked', revisionId: null });
          continue;
        }
        const revisionResult = await saveSpecialTermRevision(client, profile, {
          operationId: `${text(body.operationId, 90)}:${index}`.slice(0, 100),
          termId: requested.termId,
          revisionId: `${text(body.operationId, 90)}:${index}`.slice(0, 100),
          expectedLastModifiedAt: requested.expectedLastModifiedAt,
          revisionReason: reason,
          projections: relinkProjectionPayload(detail, consolidation.Source_Clause__c, consolidation.Replacement_Clause__c, consolidation.Replacement_Version__c),
          rules: relinkRulePayload(detail),
        });
        results.push({ termId: requested.termId, status: 'awaiting_approval', revisionId: revisionResult.revisionId || null });
      } catch (error) {
        results.push({ termId: requested.termId, status: 'failed', error: error.message || 'Relink draft could not be prepared.', errorCode: error.code || 'SPECIAL_TERMS_CONSOLIDATION_RELINK_FAILED' });
      }
    }
    await expireSpecialTermClauseCaches(requestedTerms.map((row) => row.termId));
    const failedCount = results.filter((row) => row.status === 'failed').length;
    if (failedCount === results.length) throw specialTermsError('No selected Special Term could be relinked. Review the individual conflicts.', 409, 'SPECIAL_TERMS_CONSOLIDATION_RELINK_FAILED', { results });
    const detail = requestedTerms.length === 1 && failedCount === 0 ? await getSpecialTermDetail(requestedTerms[0].termId, { force: true }) : null;
    return finishOperation(client, reservation.operation, { success: failedCount === 0, partial: failedCount > 0, consolidationId, results, detail, operation: 'consolidation_relinked' }, { success: failedCount === 0, partial: failedCount > 0, consolidationId, termIds: results.filter((row) => row.status !== 'failed').map((row) => row.termId), failedTermIds: results.filter((row) => row.status === 'failed').map((row) => row.termId), operation: 'consolidation_relinked' });
  } catch (error) {
    return failOperation(client, reservation.operation, error);
  }
}

async function liveApprovedVersions(versionIds) {
  if (!versionIds.length) return [];
  const result = await sfQuery(`SELECT Id,Clause__c,Clause__r.Name,Clause__r.Status__c,Clause__r.Latest_Approved_Version_Number__c,Revision_Number__c,Clause_Text__c,Content_Hash__c,Status__c,LastModifiedDate FROM Special_Term_Clause_Version__c WHERE Id IN (${versionIds.map((id) => `'${soql(id)}'`).join(',')}) LIMIT 500`, { clean: true, limit: 500 });
  if (result.records.length !== versionIds.length) throw specialTermsError('One or more selected clause versions are unavailable.', 409, 'SPECIAL_TERMS_STALE');
  const byId = new Map(result.records.map((row) => [row.Id, row]));
  return versionIds.map((id) => byId.get(id));
}

export async function saveSpecialTermComposition(client, profile, body = {}) {
  await resolveSpecialTermsSchema({ force: true, write: true });
  const termId = salesforceId(body.termId, 'Special Term');
  const requested = Array.isArray(body.compositions) && body.compositions.length
    ? body.compositions
    : [{ projection: body.projection || 'termsText', versionIds: body.versionIds || [], style: body.style }];
  const compositions = requested.map((item) => {
    const config = projectionConfig(item.projection);
    const versionIds = (item.versionIds || []).map((id) => salesforceId(id, 'Clause version'));
    if (versionIds.length > 200) throw specialTermsError(`${config.label} cannot exceed 200 top-level clauses.`);
    if (new Set(versionIds).size !== versionIds.length) throw specialTermsError(`The same clause version cannot be added twice in ${config.label}.`);
    return { config, versionIds, requestedStyle: item.style };
  });
  if (new Set(compositions.map(({ config }) => config.key)).size !== compositions.length) throw specialTermsError('Each clause projection can be saved only once per operation.');
  const metadata = termMetadataPayload(body);
  const reservation = await reserveOperation(client, profile, body, 'composition_save', { id: termId, compositions: compositions.map(({ config, versionIds, requestedStyle }) => ({ projection: config.value, versionIds, style: requestedStyle || config.defaultStyle })), metadata, expectedLastModifiedAt: body.expectedLastModifiedAt });
  if (reservation.replay) return { ...reservation.replay, idempotencyReplayed: true };
  try {
    const termFields = ['Id', 'LastModifiedDate', ...PROJECTION_LIST.flatMap((config) => [config.statusField, ...(config.styleField ? [config.styleField] : [])])];
    const term = await currentRecord(OBJECTS.term, termId, termFields);
    assertCurrent(term, body.expectedLastModifiedAt);
    const requests = [];
    const termPatch = { ...metadata };
    const results = [];
    for (const { config, versionIds, requestedStyle } of compositions) {
      if (term[config.statusField] !== 'Active') throw specialTermsError(`Only an active structured ${config.label} can use the clause composer.`, 409, 'SPECIAL_TERMS_NOT_STRUCTURED');
      const style = projectionStyle(config, requestedStyle || term[config.styleField] || config.defaultStyle);
      if (config.styleField && style !== term[config.styleField]) throw specialTermsError('Change a remark list style through reviewed migration rollback and reactivation.', 409, 'SPECIAL_TERMS_STYLE_LOCKED');
      const existing = await sfQuery(`SELECT Id,Clause__c,Clause_Version__c,Sequence__c,State__c FROM Special_Term_Clause_Assignment__c WHERE Special_Term__c = '${soql(termId)}' AND ${projectionWhere(config)} AND State__c = 'Active' ORDER BY Sequence__c,Id LIMIT 500`, { clean: true, limit: 500 });
      if (existing.totalSize > existing.records.length) throw specialTermsError(`${config.label} exceeds the safe assignment limit.`, 409, 'SPECIAL_TERMS_RESULT_LIMIT');
      const existingByClause = new Map(existing.records.map((row) => [row.Clause__c, row]));
      const versions = await liveApprovedVersions(versionIds);
      const clauseIds = versions.map((version) => version.Clause__c);
      if (new Set(clauseIds).size !== clauseIds.length) throw specialTermsError(`The same bank clause cannot appear twice in ${config.label}.`);
      for (const version of versions) {
        const existingRow = existingByClause.get(version.Clause__c);
        const currentlySelectable = version.Status__c === 'Approved' && version.Clause__r?.Status__c === 'Active';
        const retainedExistingUse = existingRow?.Clause_Version__c === version.Id
          && ['Approved', 'Superseded'].includes(version.Status__c)
          && ['Active', 'Retired'].includes(version.Clause__r?.Status__c);
        if (!currentlySelectable && !retainedExistingUse) throw specialTermsError('New rows must use the current approved version of an active clause. Existing retired or superseded wording may only remain unchanged.', 409, 'SPECIAL_TERMS_CLAUSE_NOT_APPROVED');
      }
      const compiledText = compileClauseList(versions.map((version) => version.Clause_Text__c), style);
      const compiledHash = clauseHash(compiledText);
      const retainedClauseIds = new Set(clauseIds);
      const removed = existing.records.filter((row) => !retainedClauseIds.has(row.Clause__c));
      const updated = [];
      const inserted = [];
      versions.forEach((version, index) => {
        const existingRow = existingByClause.get(version.Clause__c);
        const record = { attributes: { type: OBJECTS.assignment }, Projection__c: config.value, Clause__c: version.Clause__c, Clause_Version__c: version.Id, Sequence__c: index + 1, State__c: 'Active' };
        if (existingRow) updated.push({ ...record, Id: existingRow.Id });
        else inserted.push({ ...record, Special_Term__c: termId });
      });
      const suffix = config.key;
      if (removed.length) requests.push({ method: 'DELETE', url: `/services/data/${getApiVersion()}/composite/sobjects?ids=${removed.map((row) => row.Id).join(',')}&allOrNone=true`, referenceId: `delete${suffix}` });
      if (updated.length) requests.push({ method: 'PATCH', url: `/services/data/${getApiVersion()}/composite/sobjects`, referenceId: `update${suffix}`, body: { allOrNone: true, records: updated } });
      if (inserted.length) requests.push({ method: 'POST', url: `/services/data/${getApiVersion()}/composite/sobjects`, referenceId: `insert${suffix}`, body: { allOrNone: true, records: inserted } });
      termPatch[config.textField] = compiledText || null;
      termPatch[config.hashField] = compiledHash;
      termPatch[config.statusField] = 'Active';
      results.push({ projection: config.key, clauseCount: versions.length, compiledHash });
    }
    requests.push({ method: 'PATCH', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.term}/${termId}`, referenceId: 'term', body: termPatch });
    const result = await sfRequest('/composite', { method: 'POST', body: { allOrNone: true, compositeRequest: requests } });
    assertComposite(result, 'Salesforce rejected the clause composition.');
    return finishOperation(client, reservation.operation, { success: true, id: termId, projections: results });
  } catch (error) {
    return failOperation(client, reservation.operation, error);
  }
}

export async function previewSpecialTermMigration(termId, { projection = 'termsText', bank: providedBank = null } = {}) {
  await resolveSpecialTermsSchema();
  const id = salesforceId(termId, 'Special Term');
  const config = projectionConfig(projection);
  const term = await currentRecord(OBJECTS.term, id, ['Id', 'Name', config.textField, config.statusField, ...(config.styleField ? [config.styleField] : []), 'LastModifiedDate']);
  if (term[config.statusField] === 'Active') throw specialTermsError(`This ${config.label} is already structured.`, 409, 'SPECIAL_TERMS_ALREADY_STRUCTURED');
  const parsed = parseLegacyClauses(term[config.textField], { termName: config.key === 'termsText' ? term.Name : '', markerStyle: config.key === 'termsText' ? 'Numbered' : 'Auto' });
  const bank = providedBank || await loadClauseRows({ force: true });
  const byKey = new Map();
  const byLegacyKey = new Map();
  for (const clause of bank.clauses) {
    for (const version of clause._versions || []) {
      const key = canonicalClauseKey(version.clauseText);
      if (!byKey.has(key) && ['Approved', 'Draft', 'Superseded'].includes(version.status)) byKey.set(key, { clause, version });
      if (version.legacySourceKey && !byLegacyKey.has(version.legacySourceKey)) byLegacyKey.set(version.legacySourceKey, { clause, version });
    }
  }
  return {
    termId: id,
    termName: term.Name,
    projection: config.key,
    projectionValue: config.value,
    projectionLabel: config.label,
    sourceText: term[config.textField] || '',
    termsText: term[config.textField] || '',
    style: config.key === 'termsText' ? 'Numbered' : parsed.inferredStyle || term[config.styleField] || config.defaultStyle,
    expectedLastModifiedAt: term.LastModifiedDate,
    manualReviewRequired: parsed.manualReviewRequired,
    reason: parsed.reason,
    segments: parsed.clauses.map((clauseText, index) => {
      const legacySourceKey = canonicalClauseKey(clauseText);
      const exact = byLegacyKey.get(legacySourceKey) || byKey.get(legacySourceKey);
      const match = exact?.clause || null;
      const nearMatches = bank.clauses
        .filter((candidate) => candidate.id !== match?.id)
        .map((candidate) => {
          const version = candidate.latestApprovedVersion || candidate.draftVersion;
          const similarity = version ? clauseSimilarity(clauseText, version.clauseText) : 0;
          return version && similarity >= 0.45 ? {
            clauseId: candidate.id,
            shortName: candidate.shortName,
            category: candidate.category,
            status: candidate.status,
            versionId: version.id,
            revisionNumber: version.revisionNumber,
            clauseText: version.clauseText,
            similarity,
            materialDifference: hasMaterialDifference(clauseText, version.clauseText),
          } : null;
        })
        .filter(Boolean)
        .sort((left, right) => right.similarity - left.similarity)
        .slice(0, 3);
      return { index: index + 1, sourceClauseText: clauseText, legacySourceKey, clauseText: exact?.version?.clauseText || clauseText, suggestedShortName: match?.shortName || suggestClauseShortName(clauseText), suggestedCategory: match?.category || suggestClauseCategory(clauseText), exactMatchClauseId: match?.id || null, exactMatchVersionId: exact?.version?.id || null, exactMatchStatus: match?.status || null, selectedClauseId: match?.id || null, selectedClauseVersionId: exact?.version?.id || null, nearMatches };
    }),
  };
}

export async function previewSpecialTermMigrationAll(termId) {
  const bank = await loadClauseRows({ force: true });
  const entries = await Promise.all(PROJECTION_LIST.map(async ({ key: projection }) => [
    projection,
    await previewSpecialTermMigration(termId, { projection, bank }),
  ]));
  return { termId: salesforceId(termId, 'Special Term'), projections: Object.fromEntries(entries), fetchedAt: new Date().toISOString() };
}

async function planMigrationCandidates(profile, segments, options = {}) {
  const bank = options.bank || await loadClauseRows({ force: true });
  const byId = new Map(bank.clauses.map((clause) => [clause.id, clause]));
  const byCanonicalKey = new Map();
  const byLegacyKey = new Map();
  const usedShortNames = options.usedShortNames || new Map(bank.clauses.map((clause) => [shortNameKey(clause.shortName), clause.id]));
  const plannedByCanonical = options.plannedByCanonical || new Map();
  const referencePrefix = text(options.referencePrefix, 40) || 'migration';
  for (const clause of bank.clauses) {
    for (const version of clause._versions || []) {
      if (!['Approved', 'Draft', 'Superseded'].includes(version.status)) continue;
      const key = canonicalClauseKey(version.clauseText);
      if (!byCanonicalKey.has(key)) byCanonicalKey.set(key, { clause, version });
      if (version.legacySourceKey && !byLegacyKey.has(version.legacySourceKey)) byLegacyKey.set(version.legacySourceKey, { clause, version });
    }
  }

  return segments.map((segment, index) => {
    const canonicalKey = canonicalClauseKey(segment.clauseText);
    const exact = byLegacyKey.get(segment.legacySourceKey) || byCanonicalKey.get(canonicalKey);
    let clause = segment.selectedClauseId ? byId.get(segment.selectedClauseId) : exact?.clause;
    if (segment.selectedClauseId && !clause) throw specialTermsError(`Selected bank clause ${index + 1} is no longer available.`, 409, 'SPECIAL_TERMS_STALE');
    if (clause) {
      if (clause.status === 'Retired') throw specialTermsError(`Clause ${clause.shortName} is retired and cannot be selected for a new migration.`, 409, 'SPECIAL_TERMS_CLAUSE_RETIRED');
      const selectedVersion = segment.selectedClauseVersionId
        ? (clause._versions || []).find((version) => version.id === segment.selectedClauseVersionId)
        : null;
      if (segment.selectedClauseVersionId && !selectedVersion) throw specialTermsError(`The selected version of ${clause.shortName} is no longer available.`, 409, 'SPECIAL_TERMS_STALE');
      const version = selectedVersion || (segment.selectedClauseId ? clause.latestApprovedVersion || clause.draftVersion : exact?.version);
      if (!version) throw specialTermsError(`Clause ${clause.shortName} has no usable version.`, 409, 'SPECIAL_TERMS_CLAUSE_VERSION_MISSING');
      if (!['Approved', 'Draft', 'Superseded'].includes(version.status)) throw specialTermsError(`The selected version of ${clause.shortName} is not usable.`, 409, 'SPECIAL_TERMS_CLAUSE_VERSION_MISSING');
      if (segment.selectedClauseId && hasMaterialDifference(segment.clauseText, version.clauseText)) throw specialTermsError(`Clause ${index + 1} differs materially from ${clause.shortName}; keep it as a separate clause.`, 409, 'SPECIAL_TERMS_MATERIAL_DIFFERENCE');
      return { index, isNew: false, clauseId: clause.id, versionId: version.id, canonicalKey };
    }

    const planned = plannedByCanonical.get(canonicalKey);
    if (planned) return { index, isNew: false, pendingNew: true, clauseRef: planned.clauseRef, versionRef: planned.versionRef, canonicalKey };

    const key = shortNameKey(segment.shortName);
    if (usedShortNames.has(key)) throw specialTermsError(`Clause short name ${segment.shortName} is already in use. Choose a distinct name with its material qualifier.`, 409, 'SPECIAL_TERMS_CLAUSE_SHORT_NAME_EXISTS', { clauseId: usedShortNames.get(key) });
    usedShortNames.set(key, `new:${index}`);
    const candidate = {
      index,
      isNew: true,
      clauseRef: `${referencePrefix}Clause${index}`,
      versionRef: `${referencePrefix}Version${index}`,
      shortName: segment.shortName,
      category: segment.category,
      clauseText: segment.clauseText,
      sourceClauseText: segment.sourceClauseText,
      legacySourceKey: segment.legacySourceKey,
      draftSource: segment.draftSource,
      aiModel: segment.aiModel,
      aiResponseId: segment.aiResponseId,
      canonicalKey,
      proposedByEmail: profile.email,
    };
    plannedByCanonical.set(canonicalKey, candidate);
    return candidate;
  });
}

function normalizeMigrationSegments(segments, schema) {
  if (!Array.isArray(segments) || segments.length > 200) throw specialTermsError('A Special Term projection cannot exceed 200 top-level clauses.');
  const normalized = segments.map((segment) => ({
    clauseText: cleanClauseText(segment.clauseText),
    sourceClauseText: cleanClauseText(segment.sourceClauseText || segment.clauseText),
    legacySourceKey: text(segment.legacySourceKey, 255) || canonicalClauseKey(segment.sourceClauseText || segment.clauseText),
    draftSource: segment.draftSource === 'AI Assisted' ? 'AI Assisted' : 'Legacy Migration',
    aiModel: text(segment.aiModel, 80),
    aiResponseId: text(segment.aiResponseId, 100),
    shortName: cleanShortName(segment.shortName),
    category: cleanCategory(segment.category, schema),
    selectedClauseId: segment.selectedClauseId ? salesforceId(segment.selectedClauseId, 'Selected clause') : null,
    selectedClauseVersionId: segment.selectedClauseVersionId ? salesforceId(segment.selectedClauseVersionId, 'Selected clause version') : null,
  }));
  for (const segment of normalized) {
    if (segment.legacySourceKey !== canonicalClauseKey(segment.sourceClauseText)) throw specialTermsError('Legacy clause lineage changed after preview. Refresh before saving.', 409, 'SPECIAL_TERMS_STALE');
    if (segment.draftSource === 'AI Assisted' && (!segment.aiModel || !segment.aiResponseId)) throw specialTermsError('AI-assisted wording is missing model or response lineage.', 400, 'SPECIAL_TERMS_AI_LINEAGE_REQUIRED');
    if (hasMaterialDifference(segment.sourceClauseText, segment.clauseText)) throw specialTermsError('Proposed wording changes a protected amount, deadline, entity, port, product, standard, or jurisdiction. Keep it as a materially distinct clause.', 409, 'SPECIAL_TERMS_MATERIAL_DIFFERENCE');
  }
  return normalized;
}

export async function saveSpecialTermMigrationReview(client, profile, body = {}) {
  const schema = await resolveSpecialTermsSchema({ force: true, write: true });
  const termId = salesforceId(body.termId, 'Special Term');
  const config = projectionConfig(body.projection || 'termsText');
  const style = projectionStyle(config, body.style);
  const reason = requiredReason(body.auditReason, 'Review reason');
  const normalizedSegments = normalizeMigrationSegments(Array.isArray(body.segments) ? body.segments : [], schema);
  const reservation = await reserveOperation(client, profile, body, 'migration_review_save', { id: termId, projection: config.value, style, segmentKeys: normalizedSegments.map((segment) => canonicalClauseKey(segment.clauseText)), selectedClauseIds: normalizedSegments.map((segment) => segment.selectedClauseId), auditReasonHash: clauseHash(reason), expectedLastModifiedAt: body.expectedLastModifiedAt });
  if (reservation.replay) return { ...reservation.replay, idempotencyReplayed: true };
  try {
    const term = await currentRecord(OBJECTS.term, termId, ['Id', config.textField, config.originalField, config.statusField, ...(config.styleField ? [config.styleField] : []), 'LastModifiedDate']);
    assertCurrent(term, body.expectedLastModifiedAt);
    if (term[config.statusField] === 'Active') throw specialTermsError(`Active structured ${config.label} does not use migration review.`, 409, 'SPECIAL_TERMS_ALREADY_STRUCTURED');
    if (!normalizedSegments.length && !String(term[config.textField] || '').trim()) {
      const patch = { [config.statusField]: 'In Review', [config.hashField]: null, [config.originalField]: term[config.originalField] ?? term[config.textField] ?? null, [config.batchField]: body.operationId };
      if (config.styleField) patch[config.styleField] = style;
      await sfRequest(`/sobjects/${OBJECTS.term}/${termId}`, { method: 'PATCH', body: patch });
      return finishOperation(client, reservation.operation, { success: true, id: termId, projection: config.key, clauseCount: 0, operation: 'empty_reviewed' });
    }
    if (!normalizedSegments.length) throw specialTermsError(`At least one reviewed clause is required for populated ${config.label}.`);
    const candidates = await planMigrationCandidates(profile, normalizedSegments);
    const candidateKeys = candidates.map((candidate) => candidate.clauseRef ? candidate.canonicalKey : candidate.clauseId);
    if (new Set(candidateKeys).size !== candidateKeys.length) throw specialTermsError(`The same equivalent clause appears more than once in ${config.label}. Review the clause boundaries.`, 409, 'SPECIAL_TERMS_DUPLICATE_CLAUSE');
    const existing = await sfQuery(`SELECT Id FROM Special_Term_Clause_Assignment__c WHERE Special_Term__c = '${soql(termId)}' AND ${projectionWhere(config)} AND State__c = 'Proposed' LIMIT 500`, { clean: true, limit: 500 });
    if (existing.totalSize > existing.records.length) throw specialTermsError('This migration review exceeds the safe assignment limit.', 409, 'SPECIAL_TERMS_RESULT_LIMIT');
    const requests = existing.records.length ? [{ method: 'PATCH', url: `/services/data/${getApiVersion()}/composite/sobjects`, referenceId: 'archivePriorProposal', body: { allOrNone: true, records: existing.records.map((row) => ({ attributes: { type: OBJECTS.assignment }, Id: row.Id, State__c: 'Historical' })) } }] : [];
    for (const candidate of candidates.filter((row) => row.isNew)) {
      requests.push(
        { method: 'POST', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.clause}`, referenceId: candidate.clauseRef, body: { Name: candidate.shortName, Short_Name_Key__c: shortNameKey(candidate.shortName), Canonical_Text_Key__c: candidate.canonicalKey, Category__c: candidate.category, Status__c: 'Draft', Origin__c: 'Legacy', Legacy_Original_Text__c: candidate.sourceClauseText, Latest_Approved_Version_Number__c: 0 } },
        { method: 'POST', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.version}`, referenceId: candidate.versionRef, body: { Clause__c: `@{${candidate.clauseRef}.id}`, Revision_Number__c: 1, Clause_Text__c: candidate.clauseText, Content_Hash__c: clauseHash(candidate.clauseText), Status__c: 'Draft', Revision_Reason__c: 'Prepared from preserved legacy Special Terms for legal-equivalence review.', Proposed_By_Email__c: candidate.proposedByEmail, Draft_Source__c: candidate.draftSource, AI_Model__c: candidate.aiModel || null, AI_Response_Id__c: candidate.aiResponseId || null, Legacy_Source_Key__c: candidate.legacySourceKey } },
      );
    }
    candidates.forEach((candidate, index) => requests.push({
      method: 'POST',
      url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.assignment}`,
      referenceId: `migrationAssignment${index}`,
      body: {
        Special_Term__c: termId,
        Projection__c: config.value,
        Clause__c: candidate.clauseRef ? `@{${candidate.clauseRef}.id}` : candidate.clauseId,
        Clause_Version__c: candidate.versionRef ? `@{${candidate.versionRef}.id}` : candidate.versionId,
        Sequence__c: index + 1,
        State__c: 'Proposed',
        Migration_Batch_Id__c: body.operationId,
      },
    }));
    const termPatch = { [config.statusField]: 'In Review', [config.originalField]: term[config.originalField] || term[config.textField] || null, [config.batchField]: body.operationId };
    if (config.styleField) termPatch[config.styleField] = style;
    requests.push({ method: 'PATCH', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.term}/${termId}`, referenceId: 'migrationTerm', body: termPatch });
    if (requests.length > 500) throw specialTermsError('This migration review exceeds Salesforce Composite Graph’s 500-operation atomic limit. Split the legal structure before saving.', 409, 'SPECIAL_TERMS_COMPOSITE_LIMIT');
    const result = await sfRequest('/composite/graph', { method: 'POST', body: { graphs: [{ graphId: 'specialTermMigrationReview', compositeRequest: requests }] } });
    assertCompositeGraph(result, 'Salesforce rejected the atomic migration review.');
    void reason;
    return finishOperation(client, reservation.operation, { success: true, id: termId, projection: config.key, style, clauseCount: candidates.length, draftClauseCount: candidates.filter((candidate) => candidate.isNew).length, operation: 'review_saved' });
  } catch (error) {
    return failOperation(client, reservation.operation, error);
  }
}

/** Prepares all three legacy projections in one Salesforce Composite Graph.
 * Live contractual wording is untouched; this only creates the complete set of
 * proposed clause references that the unified revision commit will snapshot. */
export async function saveAllSpecialTermMigrationReview(client, profile, body = {}) {
  const schema = await resolveSpecialTermsSchema({ force: true, write: true });
  const termId = salesforceId(body.termId, 'Special Term');
  const reason = requiredReason(body.auditReason || body.revisionReason, 'Review reason');
  const requested = Array.isArray(body.projections) ? body.projections : [];
  if (requested.length !== PROJECTION_LIST.length) throw specialTermsError('Legacy preparation requires Terms Text, Confirmation remark, and Nomination remark together.', 400, 'SPECIAL_TERMS_REVISION_INCOMPLETE');
  const seen = new Set();
  const projections = requested.map((item) => {
    const config = projectionConfig(item.projection);
    if (seen.has(config.key)) throw specialTermsError('Each legacy projection may occur only once.', 400, 'SPECIAL_TERMS_REVISION_DUPLICATE_PROJECTION');
    seen.add(config.key);
    return { config, style: projectionStyle(config, item.style), segments: normalizeMigrationSegments(item.segments || [], schema) };
  });
  const reservation = await reserveOperation(client, profile, body, 'migration_review_save', {
    id: termId,
    projection: 'All',
    auditReasonHash: clauseHash(reason),
    expectedLastModifiedAt: body.expectedLastModifiedAt,
    projections: projections.map(({ config, style, segments }) => ({ projection: config.value, style, segmentKeys: segments.map((segment) => canonicalClauseKey(segment.clauseText)) })),
  });
  if (reservation.replay) {
    const detail = await getSpecialTermDetail(termId, { force: true });
    return { ...reservation.replay, detail, idempotencyReplayed: true };
  }
  try {
    const termFields = ['Id', 'Name', 'Approval_Status__c', 'LastModifiedDate', ...PROJECTION_LIST.flatMap((config) => [config.textField, config.originalField, config.statusField, config.batchField, ...(config.styleField ? [config.styleField] : [])])];
    const term = await currentRecord(OBJECTS.term, termId, termFields);
    assertCurrent(term, body.expectedLastModifiedAt);
    for (const { config } of projections) if (term[config.statusField] === 'Active') throw specialTermsError(`Active structured ${config.label} does not use legacy preparation.`, 409, 'SPECIAL_TERMS_ALREADY_STRUCTURED');

    const [bank, existing] = await Promise.all([
      loadClauseRows({ force: true }),
      sfQuery(`SELECT Id FROM ${OBJECTS.assignment} WHERE Special_Term__c = '${soql(termId)}' AND State__c = 'Proposed' LIMIT 500`, { clean: true, limit: 500 }),
    ]);
    if (existing.totalSize > existing.records.length) throw specialTermsError('This legacy preparation exceeds the safe assignment limit.', 409, 'SPECIAL_TERMS_RESULT_LIMIT');
    const usedShortNames = new Map(bank.clauses.map((clause) => [shortNameKey(clause.shortName), clause.id]));
    const plannedByCanonical = new Map();
    const requests = existing.records.length ? [{ method: 'PATCH', url: `/services/data/${getApiVersion()}/composite/sobjects`, referenceId: 'archivePriorProposals', body: { allOrNone: true, records: existing.records.map((row) => ({ attributes: { type: OBJECTS.assignment }, Id: row.Id, State__c: 'Historical' })) } }] : [];
    const termPatch = {};
    const resultProjections = [];

    for (let projectionIndex = 0; projectionIndex < projections.length; projectionIndex += 1) {
      const { config, style, segments } = projections[projectionIndex];
      const sourcePopulated = Boolean(String(term[config.textField] || '').trim());
      if (!segments.length && sourcePopulated) throw specialTermsError(`At least one reviewed clause is required for populated ${config.label}.`);
      const candidates = await planMigrationCandidates(profile, segments, { bank, usedShortNames, plannedByCanonical, referencePrefix: `migration${projectionIndex}` });
      const candidateKeys = candidates.map((candidate) => candidate.clauseRef ? candidate.canonicalKey : candidate.clauseId);
      if (new Set(candidateKeys).size !== candidateKeys.length) throw specialTermsError(`The same equivalent clause appears more than once in ${config.label}. Review the clause boundaries.`, 409, 'SPECIAL_TERMS_DUPLICATE_CLAUSE');
      for (const candidate of candidates.filter((row) => row.isNew)) {
        requests.push(
          { method: 'POST', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.clause}`, referenceId: candidate.clauseRef, body: { Name: candidate.shortName, Short_Name_Key__c: shortNameKey(candidate.shortName), Canonical_Text_Key__c: candidate.canonicalKey, Category__c: candidate.category, Status__c: 'Draft', Origin__c: 'Legacy', Legacy_Original_Text__c: candidate.sourceClauseText, Latest_Approved_Version_Number__c: 0 } },
          { method: 'POST', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.version}`, referenceId: candidate.versionRef, body: { Clause__c: `@{${candidate.clauseRef}.id}`, Revision_Number__c: 1, Clause_Text__c: candidate.clauseText, Content_Hash__c: clauseHash(candidate.clauseText), Status__c: 'Draft', Revision_Reason__c: reason, Proposed_By_Email__c: candidate.proposedByEmail, Draft_Source__c: candidate.draftSource, AI_Model__c: candidate.aiModel || null, AI_Response_Id__c: candidate.aiResponseId || null, Legacy_Source_Key__c: candidate.legacySourceKey } },
        );
      }
      candidates.forEach((candidate, index) => requests.push({
        method: 'POST',
        url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.assignment}`,
        referenceId: `migration${projectionIndex}Assignment${index}`,
        body: {
          Special_Term__c: termId,
          Projection__c: config.value,
          Clause__c: candidate.clauseRef ? `@{${candidate.clauseRef}.id}` : candidate.clauseId,
          Clause_Version__c: candidate.versionRef ? `@{${candidate.versionRef}.id}` : candidate.versionId,
          Sequence__c: index + 1,
          State__c: 'Proposed',
          Migration_Batch_Id__c: body.operationId,
        },
      }));
      termPatch[config.statusField] = 'In Review';
      termPatch[config.originalField] = term[config.originalField] ?? term[config.textField] ?? null;
      termPatch[config.batchField] = body.operationId;
      if (config.styleField) termPatch[config.styleField] = style;
      resultProjections.push({ projection: config.key, style, clauseCount: candidates.length, draftClauseCount: candidates.filter((candidate) => candidate.isNew).length });
    }
    requests.push({ method: 'PATCH', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.term}/${termId}`, referenceId: 'migrationTerm', body: termPatch });
    if (requests.length > 500) throw specialTermsError('This complete legacy preparation exceeds Salesforce Composite Graph’s 500-operation atomic limit. Review the clause structure before saving.', 409, 'SPECIAL_TERMS_COMPOSITE_LIMIT');
    const result = await sfRequest('/composite/graph', { method: 'POST', body: { graphs: [{ graphId: 'specialTermCompleteLegacyPreparation', compositeRequest: requests }] } });
    assertCompositeGraph(result, 'Salesforce rejected the complete legacy preparation.');
    await expireSpecialTermClauseCaches([termId]);
    const detail = await getSpecialTermDetail(termId, { force: true });
    return finishOperation(client, reservation.operation, { success: true, id: termId, projections: resultProjections, detail, operation: 'complete_review_saved' }, { success: true, id: termId, projectionCount: resultProjections.length, clauseCount: resultProjections.reduce((total, projection) => total + projection.clauseCount, 0), draftClauseCount: resultProjections.reduce((total, projection) => total + projection.draftClauseCount, 0), operation: 'complete_review_saved' });
  } catch (error) {
    return failOperation(client, reservation.operation, error);
  }
}

export async function activateSpecialTermMigration(client, profile, body = {}) {
  await resolveSpecialTermsSchema({ force: true, write: true });
  const termId = salesforceId(body.termId, 'Special Term');
  const config = projectionConfig(body.projection || 'termsText');
  const reason = requiredReason(body.auditReason, 'Activation reason');
  const reservation = await reserveOperation(client, profile, body, 'migration_activate', { id: termId, projection: config.value, auditReasonHash: clauseHash(reason), expectedLastModifiedAt: body.expectedLastModifiedAt });
  if (reservation.replay) return { ...reservation.replay, idempotencyReplayed: true };
  try {
    const term = await currentRecord(OBJECTS.term, termId, ['Id', config.statusField, ...(config.styleField ? [config.styleField] : []), 'LastModifiedDate']);
    assertCurrent(term, body.expectedLastModifiedAt);
    if (term[config.statusField] !== 'In Review') throw specialTermsError(`${config.label} must be In Review before activation.`, 409, 'SPECIAL_TERMS_MIGRATION_NOT_READY');
    const proposed = await sfQuery(`SELECT ${assignmentFields()} FROM Special_Term_Clause_Assignment__c WHERE Special_Term__c = '${soql(termId)}' AND ${projectionWhere(config)} AND State__c = 'Proposed' ORDER BY Sequence__c,Id LIMIT 500`, { clean: true, limit: 500 });
    const rows = proposed.records;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (Number(row.Sequence__c) !== index + 1 || !['Approved', 'Superseded'].includes(row.Clause_Version__r?.Status__c) || row.Clause__r?.Status__c !== 'Active') throw specialTermsError('Every proposed row must be sequential and use approved retained wording before activation.', 409, 'SPECIAL_TERMS_MIGRATION_NOT_READY');
    }
    const style = projectionStyle(config, config.styleField ? term[config.styleField] : config.defaultStyle);
    const compiledText = compileClauseList(rows.map((row) => row.Clause_Version__r.Clause_Text__c), style);
    const compiledHash = clauseHash(compiledText);
    const active = await sfQuery(`SELECT Id FROM Special_Term_Clause_Assignment__c WHERE Special_Term__c = '${soql(termId)}' AND ${projectionWhere(config)} AND State__c = 'Active' LIMIT 500`, { clean: true, limit: 500 });
    const requests = [];
    if (active.records.length) requests.push({ method: 'PATCH', url: `/services/data/${getApiVersion()}/composite/sobjects`, referenceId: 'archiveActive', body: { allOrNone: true, records: active.records.map((row) => ({ attributes: { type: OBJECTS.assignment }, Id: row.Id, State__c: 'Historical' })) } });
    if (rows.length) requests.push({ method: 'PATCH', url: `/services/data/${getApiVersion()}/composite/sobjects`, referenceId: 'activateAssignments', body: { allOrNone: true, records: rows.map((row) => ({ attributes: { type: OBJECTS.assignment }, Id: row.Id, State__c: 'Active' })) } });
    requests.push({ method: 'PATCH', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.term}/${termId}`, referenceId: 'term', body: { [config.textField]: compiledText || null, [config.hashField]: compiledHash, [config.statusField]: 'Active' } });
    const result = await sfRequest('/composite', { method: 'POST', body: { allOrNone: true, compositeRequest: requests } });
    assertComposite(result, 'Salesforce rejected the Special Term activation.');
    return finishOperation(client, reservation.operation, { success: true, id: termId, projection: config.key, style, clauseCount: rows.length, compiledHash, operation: 'activated' });
  } catch (error) {
    return failOperation(client, reservation.operation, error);
  }
}

export async function rollbackSpecialTermMigration(client, profile, body = {}) {
  await resolveSpecialTermsSchema({ force: true, write: true });
  const termId = salesforceId(body.termId, 'Special Term');
  const config = projectionConfig(body.projection || 'termsText');
  const reason = requiredReason(body.auditReason, 'Rollback reason');
  const reservation = await reserveOperation(client, profile, body, 'migration_rollback', { id: termId, projection: config.value, auditReasonHash: clauseHash(reason), expectedLastModifiedAt: body.expectedLastModifiedAt });
  if (reservation.replay) return { ...reservation.replay, idempotencyReplayed: true };
  try {
    const term = await currentRecord(OBJECTS.term, termId, ['Id', config.statusField, config.originalField, 'LastModifiedDate']);
    assertCurrent(term, body.expectedLastModifiedAt);
    if (term[config.statusField] !== 'Active' || term[config.originalField] == null) throw specialTermsError(`Only a migrated ${config.label} with preserved original text can be rolled back.`, 409, 'SPECIAL_TERMS_ROLLBACK_UNAVAILABLE');
    const assignments = await sfQuery(`SELECT Id FROM Special_Term_Clause_Assignment__c WHERE Special_Term__c = '${soql(termId)}' AND ${projectionWhere(config)} AND State__c != 'Historical' LIMIT 500`, { clean: true, limit: 500 });
    const requests = [];
    if (assignments.records.length) requests.push({ method: 'PATCH', url: `/services/data/${getApiVersion()}/composite/sobjects`, referenceId: 'archiveAssignments', body: { allOrNone: true, records: assignments.records.map((row) => ({ attributes: { type: OBJECTS.assignment }, Id: row.Id, State__c: 'Historical' })) } });
    requests.push({ method: 'PATCH', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.term}/${termId}`, referenceId: 'term', body: { [config.textField]: term[config.originalField] || null, [config.hashField]: null, [config.statusField]: 'Legacy', [config.batchField]: null } });
    const result = await sfRequest('/composite', { method: 'POST', body: { allOrNone: true, compositeRequest: requests } });
    assertComposite(result, 'Salesforce rejected the migration rollback.');
    return finishOperation(client, reservation.operation, { success: true, id: termId, projection: config.key, archivedAssignmentCount: assignments.records.length, operation: 'rolled_back' });
  } catch (error) {
    return failOperation(client, reservation.operation, error);
  }
}

function revisionCompositions(body, schema) {
  const requested = Array.isArray(body.projections) ? body.projections : Object.entries(body.projections || {}).map(([projection, value]) => ({ projection, ...(value || {}) }));
  if (requested.length !== PROJECTION_LIST.length) throw specialTermsError('A Special Term revision must include Terms Text, Confirmation remark, and Nomination remark.', 400, 'SPECIAL_TERMS_REVISION_INCOMPLETE');
  const seen = new Set();
  return requested.map((item) => {
    const config = projectionConfig(item.projection);
    if (seen.has(config.key)) throw specialTermsError('Each Special Term projection may occur only once in a revision.', 400, 'SPECIAL_TERMS_REVISION_DUPLICATE_PROJECTION');
    seen.add(config.key);
    const versionIds = (item.versionIds || item.rows?.map((row) => row.clauseVersionId || row.versionId) || []).map((id) => salesforceId(id, 'Clause version'));
    if (versionIds.length > 200 || new Set(versionIds).size !== versionIds.length) throw specialTermsError(`${config.label} contains invalid clause rows.`, 400, 'SPECIAL_TERMS_REVISION_ROWS_INVALID');
    return { config, versionIds, style: projectionStyle(config, item.style || config.defaultStyle), schema };
  });
}

async function revisionSchema() {
  // Describe before each consequential revision write. This makes missing/partly
  // deployed Salesforce metadata a hard failure rather than falling back to the
  // retired assignment-based migration path.
  const names = ['Special_Term_Revision__c', 'Special_Term_Revision_Clause__c', 'Special_Term_Revision_Rule__c'];
  const describes = await Promise.all(names.map((name) => sfRequest(`/sobjects/${encodeURIComponent(name)}/describe/`, { readOnly: true })));
  const required = [
    ['Special_Term_Revision__c', ['Special_Term__c', 'Revision_Key__c', 'Revision_Number__c', 'Status__c', 'Revision_Reason__c', 'Proposed_By_Email__c', 'Confirmation_Style__c', 'Nomination_Style__c', 'Prior_Confirmation_Style__c', 'Prior_Nomination_Style__c']],
    ['Special_Term_Revision_Clause__c', ['Special_Term_Revision__c', 'Clause__c', 'Clause_Version__c', 'Projection__c', 'Sequence__c', 'State__c', 'Revision_Clause_Key__c']],
    ['Special_Term_Revision_Rule__c', ['Special_Term_Revision__c', 'Special_Term_Rule__c', 'Snapshot_Type__c', 'Sequence__c', 'Audience__c', 'Account__c', 'Port__c', 'Product__c', 'Country__c', 'Priority__c', 'Source_Last_Modified__c', 'State__c', 'Rule_Key__c']],
  ];
  for (const [name, fields] of required) {
    const describe = describes[names.indexOf(name)];
    const available = new Set((describe.fields || []).filter((field) => field.createable || field.name === 'Status__c').map((field) => field.name));
    for (const field of fields) if (!available.has(field)) throw specialTermsError(`Special Terms revision schema requires ${name}.${field}.`, 503, 'SPECIAL_TERMS_REVISION_SCHEMA_INVALID');
  }
}

async function latestRevisionNumber(termId) {
  const result = await sfQuery(`SELECT Revision_Number__c FROM Special_Term_Revision__c WHERE Special_Term__c = '${soql(termId)}' ORDER BY Revision_Number__c DESC LIMIT 1`, { clean: true, limit: 1 });
  return Number(result.records[0]?.Revision_Number__c || 0) + 1;
}

async function saveSpecialTermRevisionGraph(client, profile, body, schema, compositions, reason, revisionId, reservation) {
  await revisionSchema();
  const termId = salesforceId(body.termId, 'Special Term');
  const term = await currentRecord(OBJECTS.term, termId, ['Id', 'Approval_Status__c', 'Current_Revision__c', 'Confirmation_Clause_Style__c', 'Nomination_Clause_Style__c', 'LastModifiedDate']);
  assertCurrent(term, body.expectedLastModifiedAt);
  const updatingRevision = isId(revisionId)
    ? await currentRecord(OBJECTS.revision, salesforceId(revisionId, 'Special Term revision'), ['Id', 'Special_Term__c', 'Revision_Number__c', 'Revision_Key__c', 'Status__c', 'LastModifiedDate'])
    : null;
  if (updatingRevision) {
    if (updatingRevision.Special_Term__c !== termId || !['Draft', 'In Review', 'Changes Requested'].includes(updatingRevision.Status__c)) {
      throw specialTermsError('Only this term’s current unapproved revision can be updated.', 409, 'SPECIAL_TERMS_REVISION_IMMUTABLE');
    }
    assertCurrent(updatingRevision, body.expectedRevisionLastModifiedAt);
  }
  const revisionNumber = updatingRevision ? Number(updatingRevision.Revision_Number__c) : await latestRevisionNumber(termId);
  const revisionKey = updatingRevision?.Revision_Key__c || `${termId}:${revisionNumber}`;
  if (!updatingRevision) {
    const existing = await sfQuery(`SELECT Id,Status__c FROM Special_Term_Revision__c WHERE Revision_Key__c = '${soql(revisionKey)}' LIMIT 1`, { clean: true, limit: 1 });
    if (existing.records[0]) throw specialTermsError('This revision key is already in use. Refresh before saving.', 409, 'SPECIAL_TERMS_STALE');
  }
  const styles = Object.fromEntries(compositions.map(({ config, style }) => [config.key, style]));
  const revisionBody = {
    Status__c: 'Draft', Revision_Reason__c: reason, Proposed_By_Email__c: profile.email,
    Confirmation_Style__c: styles.confirmationRemark, Nomination_Style__c: styles.nominationRemark,
    Prior_Confirmation_Style__c: term.Confirmation_Clause_Style__c || 'Hyphen', Prior_Nomination_Style__c: term.Nomination_Clause_Style__c || 'Hyphen',
  };
  const requests = [];
  if (updatingRevision) {
    const [existingClauses, existingRules] = await Promise.all([
      sfQuery(`SELECT Id FROM ${OBJECTS.revisionClause} WHERE Special_Term_Revision__c = '${soql(updatingRevision.Id)}' LIMIT 500`, { clean: true, limit: 500 }),
      sfQuery(`SELECT Id FROM Special_Term_Revision_Rule__c WHERE Special_Term_Revision__c = '${soql(updatingRevision.Id)}' LIMIT 500`, { clean: true, limit: 500 }),
    ]);
    if (existingClauses.totalSize > existingClauses.records.length || existingRules.totalSize > existingRules.records.length) throw specialTermsError('This revision exceeds the safe update limit.', 409, 'SPECIAL_TERMS_RESULT_LIMIT');
    if (existingClauses.records.length) requests.push({ method: 'DELETE', url: `/services/data/${getApiVersion()}/composite/sobjects?ids=${existingClauses.records.map((row) => row.Id).join(',')}&allOrNone=true`, referenceId: 'deleteRevisionClauses' });
    if (existingRules.records.length) requests.push({ method: 'DELETE', url: `/services/data/${getApiVersion()}/composite/sobjects?ids=${existingRules.records.map((row) => row.Id).join(',')}&allOrNone=true`, referenceId: 'deleteRevisionRules' });
    requests.push({ method: 'PATCH', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.revision}/${updatingRevision.Id}`, referenceId: 'revision', body: revisionBody });
  } else {
    requests.push({ method: 'POST', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.revision}`, referenceId: 'revision', body: {
      ...revisionBody, Special_Term__c: termId, Revision_Number__c: revisionNumber,
    } });
  }
  const revisionReference = updatingRevision?.Id || '@{revision.id}';
  const previousPending = await sfQuery(`SELECT Id FROM Special_Term_Revision__c WHERE Special_Term__c = '${soql(termId)}' AND Status__c = 'In Review'${updatingRevision ? ` AND Id != '${soql(updatingRevision.Id)}'` : ''} ORDER BY Revision_Number__c DESC LIMIT 10`, { clean: true, limit: 10 });
  if (previousPending.records.length) throw specialTermsError('This Special Term already has a revision awaiting approval. Open or reject it before creating another.', 409, 'SPECIAL_TERMS_REVISION_PENDING');
  for (const { config, versionIds } of compositions) {
    const versions = await liveApprovedVersions(versionIds);
    const clauseIds = versions.map((version) => version.Clause__c);
    if (new Set(clauseIds).size !== clauseIds.length) throw specialTermsError(`The same clause cannot appear twice in ${config.label}.`, 409, 'SPECIAL_TERMS_REVISION_DUPLICATE_CLAUSE');
    for (const version of versions) {
      const approvedHistory = ['Approved', 'Superseded'].includes(version.Status__c) && version.Clause__r?.Status__c === 'Active';
      const proposedDraft = version.Status__c === 'Draft' && ['Active', 'Draft'].includes(version.Clause__r?.Status__c);
      if (!approvedHistory && !proposedDraft) throw specialTermsError('Revision rows must use approved history or an eligible Draft clause version.', 409, 'SPECIAL_TERMS_CLAUSE_NOT_APPROVED');
    }
    versions.forEach((version, index) => requests.push({ method: 'POST', url: `/services/data/${getApiVersion()}/sobjects/Special_Term_Revision_Clause__c`, referenceId: `revision${config.key}${index}`, body: {
      Special_Term_Revision__c: revisionReference, Clause__c: version.Clause__c, Clause_Version__c: version.Id, Projection__c: config.value, Sequence__c: index + 1, State__c: 'Proposed',
    } }));
  }
  const liveRuleResult = await sfQuery(`SELECT Id,Special_Term__c,Supplier_Buyer__c,Account__c,Port__c,Product__c,Country__c,Priority__c,LastModifiedDate FROM Special_Term_Rule__c WHERE Special_Term__c = '${soql(termId)}' ORDER BY Priority__c,Id LIMIT 101`, { clean: true, limit: 101 });
  if (liveRuleResult.totalSize > 100 || liveRuleResult.records.length > 100) throw specialTermsError('A Special Term revision cannot exceed 100 current rules.', 400, 'SPECIAL_TERMS_REVISION_RULE_LIMIT');
  const liveRules = liveRuleResult.records;
  const liveById = new Map(liveRules.map((rule) => [rule.Id, rule]));
  const requestedRules = Array.isArray(body.rules) ? body.rules : (body.ruleIds || []).map((id) => ({ id }));
  if (requestedRules.length > 100) throw specialTermsError('A Special Term revision cannot exceed 100 proposed rules.', 400, 'SPECIAL_TERMS_REVISION_RULE_LIMIT');
  const proposedRules = [];
  for (const requested of requestedRules) {
    const sourceId = requested.sourceRuleId || requested.ruleId || requested.id || null;
    const source = sourceId ? liveById.get(salesforceId(sourceId, 'Special Term rule')) : null;
    if (sourceId && !source) throw specialTermsError('A source rule changed or no longer belongs to this Special Term. Refresh before saving.', 409, 'SPECIAL_TERMS_REVISION_RULE_STALE');
    if (requested.lastModifiedAt && requested.lastModifiedAt !== source?.LastModifiedDate) throw specialTermsError('A source rule changed after it was opened. Refresh before saving.', 409, 'SPECIAL_TERMS_REVISION_RULE_STALE');
    const audience = text(Object.hasOwn(requested, 'audience') ? requested.audience : source?.Supplier_Buyer__c, 20) || null;
    if (audience && !schema.audienceOptions.some((option) => option.value === audience)) throw specialTermsError('Select Buyer or Supplier for the rule audience.');
    if (!audience && !source) throw specialTermsError('A new revision rule requires Buyer or Supplier.');
    const country = text(Object.hasOwn(requested, 'country') ? requested.country : source?.Country__c, 100) || null;
    if (country && !schema.countryOptions.some((option) => option.value === country)) throw specialTermsError('The selected country is not an active Salesforce picklist value.');
    const payload = {
      Special_Term__c: termId,
      Supplier_Buyer__c: audience,
      Account__c: Object.hasOwn(requested, 'accountId') ? (requested.accountId ? salesforceId(requested.accountId, 'Account') : null) : source?.Account__c || null,
      Port__c: Object.hasOwn(requested, 'portId') ? (requested.portId ? salesforceId(requested.portId, 'Port') : null) : source?.Port__c || null,
      Product__c: Object.hasOwn(requested, 'productId') ? (requested.productId ? salesforceId(requested.productId, 'Product') : null) : source?.Product__c || null,
      Country__c: country,
    };
    if (![payload.Account__c, payload.Port__c, payload.Product__c, payload.Country__c].some(Boolean)) throw specialTermsError('A revision rule requires at least one Account, Port, Product, or Country condition.');
    await validateRuleLookups(payload);
    proposedRules.push({ source, payload });
  }
  liveRules.forEach((rule, index) => requests.push({ method: 'POST', url: `/services/data/${getApiVersion()}/sobjects/Special_Term_Revision_Rule__c`, referenceId: `revisionRuleBaseline${index}`, body: {
    Special_Term_Revision__c: revisionReference, Special_Term_Rule__c: rule.Id, Snapshot_Type__c: 'Baseline', Sequence__c: index + 1,
    Audience__c: rule.Supplier_Buyer__c, Account__c: rule.Account__c, Port__c: rule.Port__c, Product__c: rule.Product__c, Country__c: rule.Country__c,
    Priority__c: rule.Priority__c, Source_Last_Modified__c: rule.LastModifiedDate, State__c: 'Proposed',
  } }));
  proposedRules.forEach(({ source, payload }, index) => requests.push({ method: 'POST', url: `/services/data/${getApiVersion()}/sobjects/Special_Term_Revision_Rule__c`, referenceId: `revisionRuleProposed${index}`, body: {
    Special_Term_Revision__c: revisionReference, Special_Term_Rule__c: source?.Id || null, Snapshot_Type__c: 'Proposed', Sequence__c: index + 1,
    Audience__c: payload.Supplier_Buyer__c, Account__c: payload.Account__c, Port__c: payload.Port__c, Product__c: payload.Product__c,
    Country__c: payload.Country__c, Priority__c: source?.Priority__c || null, Source_Last_Modified__c: source?.LastModifiedDate || null, State__c: 'Proposed',
  } }));
  requests.push({ method: 'PATCH', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.revision}/${revisionReference}`, referenceId: 'revisionReady', body: { Status__c: 'In Review' } });
  if (term.Approval_Status__c !== 'Approved') requests.push({ method: 'PATCH', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.term}/${termId}`, referenceId: 'revisionTerm', body: { Approval_Status__c: 'Draft', Current_Revision__c: revisionReference } });
  if (requests.length > 500) throw specialTermsError('This whole-term revision exceeds Salesforce’s 500-operation atomic limit.', 409, 'SPECIAL_TERMS_COMPOSITE_LIMIT');
  const result = await sfRequest('/composite/graph', { method: 'POST', body: { graphs: [{ graphId: 'specialTermWholeRevision', compositeRequest: requests }] } });
  assertCompositeGraph(result, 'Salesforce rejected the whole-term revision draft.');
  const revisionResponse = result.graphs?.[0]?.graphResponse?.compositeResponse?.find((row) => row.referenceId === 'revision');
  return finishOperation(client, reservation.operation, { success: true, id: termId, revisionId: updatingRevision?.Id || revisionResponse?.body?.id || null, revisionKey, status: 'In Review', projectionCount: compositions.length });
}

async function callRevisionApex(revisionId, termId, action, reason, expectedLastModifiedAt, approverEmail = null, expectedVersionTimestamps = null) {
  const result = await sfRequest(`/apexrest/fcos/special-term-revisions/${encodeURIComponent(revisionId)}/${action}`, { method: 'POST', body: { termId, approverEmail, reason, expectedLastModifiedAt, expectedVersionTimestamps } });
  if (result?.success !== true) throw specialTermsError('Salesforce did not confirm the Special Term revision action.', 502, 'SPECIAL_TERMS_REVISION_ACTION_UNCONFIRMED');
  return result;
}

/** Save all three projections as one correlated Salesforce Composite Graph draft.
 * Existing compiled active wording is untouched until whole-revision approval. */
export async function saveSpecialTermRevision(client, profile, body = {}) {
  const schema = await resolveSpecialTermsSchema({ force: true, write: true });
  const termId = salesforceId(body.termId, 'Special Term');
  const reason = requiredReason(body.revisionReason || body.auditReason, 'Revision reason');
  const compositions = revisionCompositions(body, schema);
  const revisionId = text(body.revisionId || body.operationId, 100);
  if (!revisionId) throw specialTermsError('A revision ID is required.', 400, 'SPECIAL_TERMS_REVISION_ID_REQUIRED');
  const reservation = await reserveOperation(client, profile, body, 'revision_save', {
    id: termId, revisionId, reasonHash: clauseHash(reason), expectedLastModifiedAt: body.expectedLastModifiedAt,
    expectedRevisionLastModifiedAt: body.expectedRevisionLastModifiedAt || null,
    projections: compositions.map(({ config, versionIds, style }) => ({ projection: config.value, versionIds, style })),
  });
  if (reservation.replay) return { ...reservation.replay, idempotencyReplayed: true };
  try {
    return await saveSpecialTermRevisionGraph(client, profile, body, schema, compositions, reason, revisionId, reservation);
  } catch (error) { return failOperation(client, reservation.operation, error); }
}

/** Atomically activates every projection. This is intentionally not callable for a
 * single projection: a Special Term is never partially approved. */
export async function approveSpecialTermRevision(client, profile, body = {}) {
  await resolveSpecialTermsSchema({ force: true, write: true });
  const termId = salesforceId(body.termId, 'Special Term');
  const reason = requiredReason(body.approvalReason || body.auditReason, 'Approval reason');
  const reservation = await reserveOperation(client, profile, body, 'revision_approve', { id: termId, revisionId: text(body.revisionId, 100), reasonHash: clauseHash(reason), expectedLastModifiedAt: body.expectedLastModifiedAt });
  if (reservation.replay) return { ...reservation.replay, idempotencyReplayed: true };
  try {
    const action = await callRevisionApex(salesforceId(body.revisionId, 'Special Term revision'), termId, 'activate', reason, body.expectedLastModifiedAt, profile.email);
    return finishOperation(client, reservation.operation, { success: true, id: termId, revisionId: action.revisionId || body.revisionId, status: action.status || 'Active' });
  } catch (error) { return failOperation(client, reservation.operation, error); }
}

function childOperationId(operationId, suffix) {
  return `${text(operationId, 88)}:${suffix}`.slice(0, 100);
}

/** One user-facing commit for the term-first editor. Draft persistence never
 * changes live wording. Approver mode promotes every referenced Draft clause and
 * activates all projections and rules in one Apex transaction, so contractual
 * publication either completes in full or rolls back in full. */
export async function commitSpecialTermRevision(client, profile, body = {}, { canApprove = false } = {}) {
  const mode = text(body.mode, 30) || 'submit';
  if (!['submit', 'approve_publish'].includes(mode)) throw specialTermsError('Revision commit mode must be submit or approve_publish.', 400, 'SPECIAL_TERMS_REVISION_COMMIT_MODE_INVALID');
  if (mode === 'approve_publish' && !canApprove) throw specialTermsError('Only the active General Manager or an Administrator may approve and publish a Special Term.', 403, 'SPECIAL_TERMS_CLAUSE_APPROVER_REQUIRED');
  const termId = salesforceId(body.termId, 'Special Term');
  const reason = requiredReason(body.revisionReason || body.approvalReason || body.auditReason, 'Change reason');
  const operationType = mode === 'approve_publish' ? 'revision_approve_publish' : 'revision_submit';
  const reservation = await reserveOperation(client, profile, body, operationType, {
    id: termId,
    revisionId: text(body.revisionId, 18) || null,
    mode,
    reasonHash: clauseHash(reason),
    expectedLastModifiedAt: body.expectedLastModifiedAt || null,
    expectedRevisionLastModifiedAt: body.expectedRevisionLastModifiedAt || null,
    projectionVersionIds: (Array.isArray(body.projections) ? body.projections : []).map((projection) => ({
      projection: projection.projection,
      style: projection.style,
      versionIds: projection.versionIds || [],
      versionTimestampHash: clauseHash(JSON.stringify(projection.versionTimestamps || {})),
    })),
    ruleCount: Array.isArray(body.rules) ? body.rules.length : 0,
  });
  if (reservation.replay) {
    const detail = await getSpecialTermDetail(termId, { force: true });
    return { ...reservation.replay, detail, idempotencyReplayed: true };
  }
  try {
    let revisionId = isId(body.revisionId) ? salesforceId(body.revisionId, 'Special Term revision') : null;
    const hasEditorPayload = Array.isArray(body.projections) && body.projections.length > 0;
    const expectedVersionTimestamps = Object.assign({}, ...((body.projections || []).map((projection) => projection.versionTimestamps || {})));
    if (mode === 'approve_publish' && hasEditorPayload) {
      const selectedVersionIds = [...new Set(body.projections.flatMap((projection) => projection.versionIds || []).map((id) => salesforceId(id, 'Clause version')))];
      if (selectedVersionIds.length) {
        const selected = await sfQuery(`SELECT Id,Clause__c,Clause__r.Name,Clause__r.Category__c,Clause__r.Status__c,Clause__r.LastModifiedDate,Revision_Number__c,Clause_Text__c,Revision_Reason__c,Proposed_Short_Name__c,Proposed_Category__c,Status__c,LastModifiedDate FROM ${OBJECTS.version} WHERE Id IN (${selectedVersionIds.map((id) => `'${soql(id)}'`).join(',')}) LIMIT 500`, { clean: true, limit: 500 });
        if (selected.records.length !== selectedVersionIds.length) throw specialTermsError('A selected clause version changed after the editor opened.', 409, 'SPECIAL_TERMS_STALE');
        const drafts = selected.records.filter((version) => version.Status__c === 'Draft');
        for (const version of drafts) {
          if (!expectedVersionTimestamps[version.Id] || expectedVersionTimestamps[version.Id] !== version.LastModifiedDate) {
            throw specialTermsError('A Draft clause changed after the editor opened. Refresh before approving the whole term.', 409, 'SPECIAL_TERMS_STALE');
          }
        }
        const establishedClauseIds = [...new Set(drafts.filter((version) => version.Clause__r?.Status__c === 'Active').map((version) => version.Clause__c))];
        if (establishedClauseIds.length) {
          const approved = await sfQuery(`SELECT Clause__c,Clause_Text__c FROM ${OBJECTS.version} WHERE Clause__c IN (${establishedClauseIds.map((id) => `'${soql(id)}'`).join(',')}) AND Status__c = 'Approved' LIMIT 500`, { clean: true, limit: 500 });
          const approvedByClause = new Map(approved.records.map((version) => [version.Clause__c, version]));
          for (const version of drafts.filter((row) => row.Clause__r?.Status__c === 'Active')) {
            const base = approvedByClause.get(version.Clause__c);
            if (!base) throw specialTermsError('An established clause no longer has one current approved base.', 409, 'SPECIAL_TERMS_CLAUSE_VERSION_CONFLICT');
            if (hasMaterialDifference(base.Clause_Text__c, version.Clause_Text__c)) {
              throw specialTermsError(`The proposed wording for ${version.Clause__r?.Name || version.Clause__c} changes a material qualifier. Create a new Clause Library identity instead.`, 409, 'SPECIAL_TERMS_CLAUSE_MATERIAL_DIFFERENCE');
            }
          }
        }
      }
    }
    if (hasEditorPayload || !revisionId) {
      const saved = await saveSpecialTermRevision(client, profile, {
        ...body,
        revisionId: revisionId || childOperationId(body.operationId, 'revision'),
        revisionReason: reason,
        operationId: childOperationId(body.operationId, 'save'),
      });
      revisionId = salesforceId(saved.revisionId, 'Saved Special Term revision');
    }

    let status = 'In Review';
    if (mode === 'approve_publish') {
      const revision = await currentRecord(OBJECTS.revision, revisionId, ['Id', 'Special_Term__c', 'Status__c', 'LastModifiedDate']);
      if (revision.Special_Term__c !== termId || !['In Review', 'Ready for Approval', 'Approved'].includes(revision.Status__c)) throw specialTermsError('The reviewed Special Term revision is no longer ready for approval.', 409, 'SPECIAL_TERMS_REVISION_STALE');
      const approved = await callRevisionApex(revisionId, termId, 'approve-publish', reason, revision.LastModifiedDate, profile.email, expectedVersionTimestamps);
      status = approved.status || 'Active';
    }

    const detail = await getSpecialTermDetail(termId, { force: true });
    const response = { success: true, id: termId, revisionId, status, mode, detail };
    return finishOperation(client, reservation.operation, response, {
      success: true,
      id: termId,
      revisionId,
      status,
      mode,
      projectionCount: Array.isArray(body.projections) ? body.projections.length : 0,
      ruleCount: Array.isArray(body.rules) ? body.rules.length : 0,
    });
  } catch (error) {
    return failOperation(client, reservation.operation, error);
  }
}

export async function rollbackSpecialTermRevision(client, profile, body = {}) {
  await resolveSpecialTermsSchema({ force: true, write: true });
  const termId = salesforceId(body.termId, 'Special Term');
  const reason = requiredReason(body.rollbackReason || body.auditReason, 'Rollback reason');
  const reservation = await reserveOperation(client, profile, body, 'revision_rollback', { id: termId, reasonHash: clauseHash(reason), expectedLastModifiedAt: body.expectedLastModifiedAt });
  if (reservation.replay) return { ...reservation.replay, idempotencyReplayed: true };
  try {
    const action = await callRevisionApex(salesforceId(body.revisionId, 'Special Term revision'), termId, 'rollback', reason, body.expectedLastModifiedAt);
    return finishOperation(client, reservation.operation, { success: true, id: termId, revisionId: action.revisionId || body.revisionId, status: action.status || 'Rolled Back' });
  } catch (error) { return failOperation(client, reservation.operation, error); }
}

export async function listSpecialTermMigrationBatches({ force = false } = {}) {
  const inventory = await getSpecialTermMigrationInventory({ force });
  const groups = new Map();
  for (const entry of inventory.entries) {
    const key = entry.migrationBatchId || `${entry.termId}:legacy`;
    if (!groups.has(key)) groups.set(key, { id: key, termId: entry.termId, termName: entry.termName, entries: [], status: entry.structureStatus });
    groups.get(key).entries.push(entry);
  }
  return { batches: [...groups.values()], summary: inventory.summary, fetchedAt: inventory.fetchedAt };
}

/** Minimal live approval queue for Notifications/Commitments. Deliberately omits
 * clause text, reviewer rationale, and Salesforce financial/contractual fields. */
export async function listSpecialTermApprovalQueue({ force = false, limit = 200 } = {}) {
  await resolveSpecialTermsSchema({ force });
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const result = await sfQuery(`SELECT Id,Special_Term__c,Special_Term__r.Name,Status__c,Proposed_By_Email__c,LastModifiedDate FROM Special_Term_Revision__c WHERE Status__c = 'In Review' ORDER BY LastModifiedDate ASC LIMIT ${safeLimit}`, { clean: true, limit: safeLimit });
  return {
    items: result.records.map((row) => ({
      termId: row.Special_Term__c,
      termName: row.Special_Term__r?.Name || '',
      revisionId: row.Id,
      revisionStatus: row.Status__c || 'In Review',
      proposedByEmail: row.Proposed_By_Email__c || null,
      updatedAt: row.LastModifiedDate || null,
    })),
    fetchedAt: new Date().toISOString(),
  };
}

function responseOutputText(payload) {
  return (payload?.output || []).flatMap((item) => item?.content || []).filter((part) => part?.type === 'output_text').map((part) => part.text).join('');
}

async function clauseAiUpstreamError(response) {
  const payload = await response.json().catch(() => ({}));
  const upstreamCode = text(payload?.error?.code || payload?.error?.type, 80).toLowerCase();
  if (response.status === 401 || response.status === 403) {
    return specialTermsError('The protected OpenAI credential is not authorized.', 503, 'OPENAI_AUTHENTICATION_FAILED');
  }
  if (response.status === 429) {
    const code = upstreamCode === 'insufficient_quota' ? 'OPENAI_INSUFFICIENT_QUOTA' : 'OPENAI_RATE_LIMITED';
    return specialTermsError(code === 'OPENAI_INSUFFICIENT_QUOTA' ? 'The protected OpenAI project has no available quota.' : 'The clause drafting service is temporarily rate limited.', 503, code);
  }
  if (response.status === 400 && ['model_not_found', 'unsupported_value'].includes(upstreamCode)) {
    return specialTermsError('The configured OpenAI clause-drafting model is unavailable.', 503, 'OPENAI_MODEL_UNAVAILABLE');
  }
  if (response.status === 400) {
    return specialTermsError('The protected OpenAI request contract was rejected.', 502, 'OPENAI_REQUEST_INVALID');
  }
  return specialTermsError('The clause drafting service is temporarily unavailable.', 503, 'SPECIAL_TERMS_AI_UNAVAILABLE');
}

export async function draftSpecialTermClausesWithAi(client, profile, body = {}, dependencies = {}) {
  const groups = Array.isArray(body.groups) ? body.groups : [];
  if (!groups.length || groups.length > 20) throw specialTermsError('AI drafting accepts between 1 and 20 clause groups.', 400, 'SPECIAL_TERMS_AI_BATCH_LIMIT');
  const operation = await reserveOperation(client, profile, body, 'clause_ai_draft', { id: body.termId || null, groupHashes: groups.map((group) => clauseHash(group?.clauseText || group?.text || '')) });
  if (operation.replay) return { ...operation.replay, idempotencyReplayed: true };
  try {
    const apiKey = String(dependencies.apiKey || process.env.OPENAI_API_KEY || '').trim();
    if (!apiKey) throw specialTermsError('The protected OpenAI service is not configured.', 503, 'OPENAI_NOT_CONFIGURED');
    const model = DEFAULT_DASHBOARD_AI_MODEL;
    const inputGroups = groups.map((group, index) => ({ id: String(group.id || index + 1).slice(0, 80), clauseText: cleanClauseText(group.clauseText || group.text) }));
    const outputSchema = {
      type: 'object',
      additionalProperties: false,
      required: ['drafts'],
      properties: {
        drafts: {
          type: 'array',
          minItems: inputGroups.length,
          maxItems: inputGroups.length,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'shortName', 'category', 'proposedText', 'rationale'],
            properties: {
              id: { type: 'string', enum: inputGroups.map((group) => group.id) },
              shortName: { type: 'string' },
              category: { type: 'string', enum: CLAUSE_CATEGORIES },
              proposedText: { type: 'string' },
              rationale: { type: 'string' },
            },
          },
        },
      },
    };
    const response = await (dependencies.fetchImpl || fetch)('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, store: false, max_output_tokens: 12_000, reasoning: { effort: 'medium' }, safety_identifier: clauseHash(profile.id), input: [
        { role: 'system', content: [{ type: 'input_text', text: 'You draft proposed FCOS Special Term clause-bank entries. Copy every input id exactly. Preserve every amount, deadline, party, port, product, standard, jurisdiction, number format, and named entity character-for-character. Do not merge clauses. Do not add a top-level number or hyphen. If a professional rewrite would change a protected qualifier, return the source wording unchanged and improve only the short name, category, and rationale. Return only the required structured output. Each response is a DRAFT requiring human approval.' }] },
        { role: 'user', content: [{ type: 'input_text', text: JSON.stringify({ categories: CLAUSE_CATEGORIES, groups: inputGroups }) }] },
      ], text: { format: { type: 'json_schema', name: 'special_term_clause_drafts', strict: true, schema: outputSchema } } }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw await clauseAiUpstreamError(response);
    const payload = await response.json();
    const parsed = JSON.parse(responseOutputText(payload));
    const aiResponseId = text(payload?.id, 100);
    if (!aiResponseId) throw specialTermsError('The clause drafting service omitted response lineage.', 502, 'SPECIAL_TERMS_AI_RESPONSE_INVALID');
    const drafts = (parsed?.drafts || []).map((draft) => ({ id: text(draft.id, 80), shortName: cleanShortName(draft.shortName), category: CLAUSE_CATEGORIES.includes(draft.category) ? draft.category : 'Other', proposedText: cleanClauseText(draft.proposedText), rationale: text(draft.rationale, 500), draftSource: 'AI Assisted', aiModel: model, aiResponseId }));
    if (drafts.length !== inputGroups.length) throw specialTermsError('The clause drafting service returned an incomplete batch.', 502, 'SPECIAL_TERMS_AI_RESPONSE_INVALID');
    const sourceById = new Map(inputGroups.map((group) => [group.id, group.clauseText]));
    if (new Set(drafts.map((draft) => draft.id)).size !== drafts.length || drafts.some((draft) => !sourceById.has(draft.id))) throw specialTermsError('The clause drafting service returned mismatched group identifiers.', 502, 'SPECIAL_TERMS_AI_RESPONSE_INVALID');
    if (drafts.some((draft) => hasMaterialDifference(sourceById.get(draft.id), draft.proposedText))) throw specialTermsError('The clause drafting service changed protected contractual qualifiers. Review the original wording manually.', 409, 'SPECIAL_TERMS_MATERIAL_DIFFERENCE');
    const result = { success: true, draftCount: drafts.length, model, aiResponseId, drafts };
    return finishOperation(client, operation.operation, result, { success: true, draftCount: drafts.length, model, aiResponseId });
  } catch (error) { return failOperation(client, operation.operation, error); }
}

export const specialTermClauseServiceInternals = Object.freeze({
  CLAUSE_CATEGORIES,
  GLOBAL_PUBLICATION_PREVIEW_TTL_MS,
  assertCompositeGraph,
  cleanClauseText,
  cleanShortName,
  failureFromComposite,
  mapDetailRule,
  publicationProposalHash,
  relinkProjectionPayload,
  signPublicationPreview,
  verifyPublicationPreview,
});
