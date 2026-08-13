import { getApiVersion, getInstanceUrl, sfQuery, sfRequest } from './_salesforce.js';
import { getOrLoadRuntimeCache } from './_runtimeCache.js';
import {
  assertCurrent,
  currentRecord,
  failOperation,
  finishOperation,
  listSpecialTerms,
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
    category: row.Category__c || 'Other',
    status: row.Status__c || 'Draft',
    origin: row.Origin__c || 'Manual',
    legacyOriginalText: row.Legacy_Original_Text__c || '',
    latestApprovedVersionNumber: Number(row.Latest_Approved_Version_Number__c || 0),
    latestApprovedVersion: mapVersion(latestApproved),
    draftVersion: mapVersion(draft),
    replacementClauseId: row.Replacement_Clause__c || null,
    retirementReason: row.Retirement_Reason__c || '',
    usageCount: Number(usageCount || 0),
    lastApprovedAt: row.Last_Approved_At__c || null,
    lastModifiedAt: row.LastModifiedDate || null,
    _versions: ordered.map(mapVersion),
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
      const [clauseResult, versionResult, usageResult] = await Promise.all([
        sfQuery('SELECT Id,Name,Short_Name_Key__c,Canonical_Text_Key__c,Category__c,Status__c,Origin__c,Legacy_Original_Text__c,Latest_Approved_Version_Number__c,Last_Approved_At__c,Replacement_Clause__c,Retirement_Reason__c,LastModifiedDate FROM Special_Term_Clause__c ORDER BY Name LIMIT 5000', { clean: true, limit: 5000 }),
        sfQuery('SELECT Id,Clause__c,Revision_Number__c,Clause_Text__c,Content_Hash__c,Status__c,Revision_Reason__c,Proposed_By_Email__c,Approved_By_Email__c,Approved_At__c,Approval_Reason__c,Draft_Source__c,AI_Model__c,AI_Response_Id__c,Legacy_Source_Key__c,LastModifiedDate FROM Special_Term_Clause_Version__c ORDER BY Clause__c,Revision_Number__c DESC LIMIT 10000', { clean: true, limit: 10000 }),
        sfQuery('SELECT Clause__c clauseId,COUNT(Id) usageCount FROM Special_Term_Clause_Assignment__c GROUP BY Clause__c LIMIT 2000', { clean: true, limit: 2000 }),
      ]);
      if (clauseResult.totalSize > clauseResult.records.length || versionResult.totalSize > versionResult.records.length) throw specialTermsError('The clause bank exceeds the current safe result limit.', 503, 'SPECIAL_TERMS_RESULT_LIMIT');
      const versionsByClause = new Map();
      for (const version of versionResult.records) {
        if (!versionsByClause.has(version.Clause__c)) versionsByClause.set(version.Clause__c, []);
        versionsByClause.get(version.Clause__c).push(version);
      }
      const usageByClause = new Map(usageResult.records.map((row) => [row.clauseId, Number(row.usageCount || 0)]));
      return { clauses: clauseResult.records.map((row) => mapClause(row, { versions: versionsByClause.get(row.Id) || [], usageCount: usageByClause.get(row.Id) || 0 })), fetchedAt: new Date().toISOString() };
    },
  });
  return { ...cached.value, cacheStatus: cached.cacheStatus || cached.status || null };
}

export async function listSpecialTermClauseBank({ query = '', status = '', force = false, limit = 200 } = {}) {
  const bank = await loadClauseRows({ force });
  const search = text(query, 100).toLocaleLowerCase('en');
  const validStatus = ['Draft', 'Active', 'Retired', 'Legacy'].includes(status) ? status : '';
  const clauses = [];
  for (const clause of bank.clauses) {
    if (validStatus === 'Legacy' ? clause.origin !== 'Legacy' : validStatus && clause.status !== validStatus) continue;
    const haystack = [clause.shortName, clause.category, clause.latestApprovedVersion?.clauseText, clause.draftVersion?.clauseText].filter(Boolean).join(' ').toLocaleLowerCase('en');
    if (search && !haystack.includes(search)) continue;
    const { _versions, ...publicClause } = clause;
    void _versions;
    clauses.push(publicClause);
    if (clauses.length >= Math.min(Math.max(Number(limit) || 200, 1), 500)) break;
  }
  return { clauses, fetchedAt: bank.fetchedAt, cacheStatus: bank.cacheStatus };
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
  return 'Id,Special_Term__c,Projection__c,Clause__c,Clause__r.Name,Clause__r.Category__c,Clause__r.Status__c,Clause__r.Latest_Approved_Version_Number__c,Clause_Version__c,Clause_Version__r.Revision_Number__c,Clause_Version__r.Clause_Text__c,Clause_Version__r.Status__c,Sequence__c,State__c,Migration_Batch_Id__c,LastModifiedDate';
}

export async function getSpecialTermDetail(termId, { force = false } = {}) {
  await resolveSpecialTermsSchema({ force });
  const id = salesforceId(termId, 'Special Term');
  const [termResult, assignmentResult, liveRuleResult] = await Promise.all([
    sfQuery(`SELECT Id,Name,Terms_Text__c,Add_to_Confirmation__c,Add_to_Nomination__c,Special_Remark_in_Confirmation__c,Special_Remark_in_Nomination__c,Clause_Structure_Status__c,Clause_Compiled_Hash__c,Original_Terms_Text__c,Clause_Migration_Batch_Id__c,Confirmation_Clause_Status__c,Confirmation_Clause_Style__c,Confirmation_Compiled_Hash__c,Original_Confirmation_Remark__c,Confirmation_Migration_Batch_Id__c,Nomination_Clause_Status__c,Nomination_Clause_Style__c,Nomination_Compiled_Hash__c,Original_Nomination_Remark__c,Nomination_Migration_Batch_Id__c,Approval_Status__c,Current_Revision__c,LastModifiedDate FROM Special_Term__c WHERE Id = '${soql(id)}' LIMIT 1`, { clean: true, limit: 1 }),
    sfQuery(`SELECT ${assignmentFields()} FROM Special_Term_Clause_Assignment__c WHERE Special_Term__c = '${soql(id)}' ORDER BY Projection__c,State__c,Sequence__c,Id LIMIT 500`, { clean: true, limit: 500 }),
    sfQuery(`SELECT Id,Name,Account__c,Port__c,Product__c,Country__c,Supplier_Buyer__c,Priority__c,LastModifiedDate FROM Special_Term_Rule__c WHERE Special_Term__c = '${soql(id)}' ORDER BY Priority__c,Name LIMIT 250`, { clean: true, limit: 250 }),
  ]);
  const term = termResult.records[0];
  if (!term) throw specialTermsError('The selected Special Term is no longer available.', 409, 'SPECIAL_TERMS_STALE');
  const pendingRevision = (await sfQuery(`SELECT Id,Status__c,Proposed_By_Email__c,Revision_Reason__c,Revision_Number__c,LastModifiedDate FROM Special_Term_Revision__c WHERE Special_Term__c = '${soql(id)}' AND Status__c = 'In Review' ORDER BY Revision_Number__c DESC LIMIT 1`, { clean: true, limit: 1 })).records[0];
  const revisionRow = pendingRevision || (term.Current_Revision__c
    ? (await sfQuery(`SELECT Id,Status__c,Proposed_By_Email__c,Revision_Reason__c,Revision_Number__c,LastModifiedDate FROM Special_Term_Revision__c WHERE Id = '${soql(term.Current_Revision__c)}' LIMIT 1`, { clean: true, limit: 1 })).records[0]
    : null);
  const revisionClauseRows = revisionRow
    ? (await sfQuery(`SELECT Id,Projection__c,Clause__c,Clause__r.Name,Clause__r.Category__c,Clause__r.Status__c,Clause__r.Latest_Approved_Version_Number__c,Clause_Version__c,Clause_Version__r.Revision_Number__c,Clause_Version__r.Clause_Text__c,Clause_Version__r.Status__c,Sequence__c,State__c,LastModifiedDate FROM Special_Term_Revision_Clause__c WHERE Special_Term_Revision__c = '${soql(revisionRow.Id)}' ORDER BY Projection__c,Sequence__c,Id LIMIT 600`, { clean: true, limit: 600 })).records
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
      revisionNumber: Number(revisionRow?.Revision_Number__c || 0) || null,
      expectedLastModifiedAt: revisionRow?.LastModifiedDate || null,
      lastModifiedAt: revisionRow?.LastModifiedDate || null,
      termLastModifiedAt: term.LastModifiedDate || null,
      projections: Object.fromEntries(PROJECTION_LIST.map((config) => [config.key, {
        ...projectionDetails[config.key],
        rows: revisionClauseRows.filter((row) => projectionConfig(row.Projection__c).key === config.key).map((row) => ({ id: row.Id, clauseId: row.Clause__c, clauseVersionId: row.Clause_Version__c, shortName: row.Clause__r?.Name || '', category: row.Clause__r?.Category__c || 'Other', clauseStatus: row.Clause__r?.Status__c || '', revisionNumber: Number(row.Clause_Version__r?.Revision_Number__c || 0), clauseText: row.Clause_Version__r?.Clause_Text__c || '', versionStatus: row.Clause_Version__r?.Status__c || '', sequence: Number(row.Sequence__c || 0), state: row.State__c || '', lastModifiedAt: row.LastModifiedDate || null })),
      }])),
      rules: revisionRuleRows.filter((row) => row.Snapshot_Type__c === 'Proposed').map((row) => ({ id: row.Id, sourceRuleId: row.Special_Term_Rule__c || null, audience: row.Audience__c || '', accountId: row.Account__c || null, accountName: row.Account__r?.Name || '', accountClKey: row.Account__r?.Company_Code__c || '', portId: row.Port__c || null, portName: row.Port__r?.Name || '', portCountry: row.Port__r?.Country__c || '', productId: row.Product__c || null, productName: row.Product__r?.Name || '', country: row.Country__c || '', priority: row.Priority__c == null ? null : Number(row.Priority__c), sequence: Number(row.Sequence__c || 0), state: row.State__c || '', lastModifiedAt: row.LastModifiedDate || null })),
    },
    rules: liveRuleResult.records.map((row) => ({ id: row.Id, name: row.Name || '', accountId: row.Account__c || null, portId: row.Port__c || null, productId: row.Product__c || null, country: row.Country__c || '', audience: row.Supplier_Buyer__c || '', priority: row.Priority__c == null ? null : Number(row.Priority__c), lastModifiedAt: row.LastModifiedDate || null })),
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
  if (reservation.replay) return { ...reservation.replay, idempotencyReplayed: true };
  try {
    if (versionId) {
      const [clauseRow, versionRow] = await Promise.all([
        currentRecord(OBJECTS.clause, clauseId, ['Id', 'Status__c', 'LastModifiedDate']),
        currentRecord(OBJECTS.version, versionId, ['Id', 'Clause__c', 'Status__c', 'LastModifiedDate']),
      ]);
      assertCurrent(versionRow, body.expectedLastModifiedAt);
      if (clauseRow.Status__c === 'Draft') assertCurrent(clauseRow, body.expectedClauseLastModifiedAt);
      if (versionRow.Clause__c !== clauseId || versionRow.Status__c !== 'Draft') throw specialTermsError('Only the selected Draft version can be edited.', 409, 'SPECIAL_TERMS_CLAUSE_VERSION_IMMUTABLE');
      const requests = [{ method: 'PATCH', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.version}/${versionId}`, referenceId: 'version', body: { Clause_Text__c: clauseText, Content_Hash__c: clauseHash(clauseText), Revision_Reason__c: reason, Proposed_By_Email__c: profile.email, ...provenance } }];
      if (clauseRow.Status__c === 'Draft') requests.push({ method: 'PATCH', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.clause}/${clauseId}`, referenceId: 'clause', body: { Name: shortName, Short_Name_Key__c: shortNameKey(shortName), Canonical_Text_Key__c: canonicalKey, Category__c: category } });
      const result = await sfRequest('/composite', { method: 'POST', body: { allOrNone: true, compositeRequest: requests } });
      assertComposite(result, 'Salesforce rejected the Draft clause edit.');
      return finishOperation(client, reservation.operation, { success: true, clauseId, versionId, operation: 'draft_updated' });
    }

    if (clauseId) {
      const clauseRow = await currentRecord(OBJECTS.clause, clauseId, ['Id', 'Status__c', 'LastModifiedDate']);
      assertCurrent(clauseRow, body.expectedLastModifiedAt);
      if (clauseRow.Status__c === 'Retired') throw specialTermsError('Retired clauses cannot receive new revisions.', 409, 'SPECIAL_TERMS_CLAUSE_RETIRED');
      const versions = await sfQuery(`SELECT Id,Revision_Number__c,Status__c FROM Special_Term_Clause_Version__c WHERE Clause__c = '${soql(clauseId)}' ORDER BY Revision_Number__c DESC LIMIT 100`, { clean: true, limit: 100 });
      if (versions.records.some((row) => row.Status__c === 'Draft')) throw specialTermsError('This clause already has a Draft revision.', 409, 'SPECIAL_TERMS_CLAUSE_DRAFT_EXISTS');
      const revisionNumber = Number(versions.records[0]?.Revision_Number__c || 0) + 1;
      const created = await sfRequest(`/sobjects/${OBJECTS.version}`, { method: 'POST', body: { Clause__c: clauseId, Revision_Number__c: revisionNumber, Clause_Text__c: clauseText, Content_Hash__c: clauseHash(clauseText), Status__c: 'Draft', Revision_Reason__c: reason, Proposed_By_Email__c: profile.email, ...provenance } });
      const createdVersionId = salesforceId(created?.id, 'Created clause version');
      return finishOperation(client, reservation.operation, { success: true, clauseId, versionId: createdVersionId, revisionNumber, operation: 'revision_proposed' });
    }

    const result = await sfRequest('/composite', {
      method: 'POST',
      body: {
        allOrNone: true,
        compositeRequest: [
          { method: 'POST', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.clause}`, referenceId: 'clause', body: { Name: shortName, Short_Name_Key__c: shortNameKey(shortName), Canonical_Text_Key__c: canonicalKey, Category__c: category, Status__c: 'Draft', Origin__c: provenance.Draft_Source__c === 'Legacy Migration' ? 'Legacy' : provenance.Draft_Source__c, Legacy_Original_Text__c: provenance.Draft_Source__c === 'Legacy Migration' ? clauseText : null, Latest_Approved_Version_Number__c: 0 } },
          { method: 'POST', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.version}`, referenceId: 'version', body: { Clause__c: '@{clause.id}', Revision_Number__c: 1, Clause_Text__c: clauseText, Content_Hash__c: clauseHash(clauseText), Status__c: 'Draft', Revision_Reason__c: reason, Proposed_By_Email__c: profile.email, ...provenance } },
        ],
      },
    });
    assertComposite(result, 'Salesforce rejected the Draft clause.');
    const clauseCreatedId = salesforceId(result.compositeResponse.find((response) => response.referenceId === 'clause')?.body?.id, 'Created clause');
    const versionCreatedId = salesforceId(result.compositeResponse.find((response) => response.referenceId === 'version')?.body?.id, 'Created clause version');
    return finishOperation(client, reservation.operation, { success: true, clauseId: clauseCreatedId, versionId: versionCreatedId, revisionNumber: 1, operation: 'draft_created' });
  } catch (error) {
    return failOperation(client, reservation.operation, error);
  }
}

export async function approveSpecialTermClause(client, profile, body = {}) {
  await resolveSpecialTermsSchema({ force: true, write: true });
  const clauseId = salesforceId(body.clauseId, 'Clause');
  const versionId = salesforceId(body.versionId, 'Clause version');
  const reason = requiredReason(body.approvalReason, 'Approval reason');
  const reservation = await reserveOperation(client, profile, body, 'clause_approve', { id: versionId, clauseId, versionId, approvalReasonHash: clauseHash(reason), expectedClauseLastModifiedAt: body.expectedClauseLastModifiedAt, expectedVersionLastModifiedAt: body.expectedVersionLastModifiedAt });
  if (reservation.replay) return { ...reservation.replay, idempotencyReplayed: true };
  try {
    const [clauseRow, versionRow] = await Promise.all([
      currentRecord(OBJECTS.clause, clauseId, ['Id', 'Status__c', 'LastModifiedDate']),
      currentRecord(OBJECTS.version, versionId, ['Id', 'Clause__c', 'Revision_Number__c', 'Clause_Text__c', 'Status__c', 'LastModifiedDate']),
    ]);
    assertCurrent(clauseRow, body.expectedClauseLastModifiedAt);
    assertCurrent(versionRow, body.expectedVersionLastModifiedAt);
    if (versionRow.Clause__c !== clauseId || versionRow.Status__c !== 'Draft') throw specialTermsError('Only the selected Draft version can be approved.', 409, 'SPECIAL_TERMS_CLAUSE_VERSION_IMMUTABLE');
    cleanShortName((await currentRecord(OBJECTS.clause, clauseId, ['Id', 'Name'])).Name);
    cleanClauseText(versionRow.Clause_Text__c);
    const currentApproved = await sfQuery(`SELECT Id FROM Special_Term_Clause_Version__c WHERE Clause__c = '${soql(clauseId)}' AND Status__c = 'Approved' LIMIT 2`, { clean: true, limit: 2 });
    if (currentApproved.records.length > 1) throw specialTermsError('Clause has multiple approved versions and requires repair.', 409, 'SPECIAL_TERMS_CLAUSE_VERSION_CONFLICT');
    const now = new Date().toISOString();
    const requests = [];
    if (currentApproved.records[0]) requests.push({ method: 'PATCH', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.version}/${currentApproved.records[0].Id}`, referenceId: 'superseded', body: { Status__c: 'Superseded' } });
    requests.push(
      { method: 'PATCH', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.version}/${versionId}`, referenceId: 'approved', body: { Status__c: 'Approved', Approved_By_Email__c: profile.email, Approved_At__c: now, Approval_Reason__c: reason } },
      { method: 'PATCH', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.clause}/${clauseId}`, referenceId: 'clause', body: { Status__c: 'Active', Latest_Approved_Version_Number__c: versionRow.Revision_Number__c, Last_Approved_At__c: now, Retirement_Reason__c: null, Replacement_Clause__c: null } },
    );
    const result = await sfRequest('/composite', { method: 'POST', body: { allOrNone: true, compositeRequest: requests } });
    assertComposite(result, 'Salesforce rejected the clause approval.');
    return finishOperation(client, reservation.operation, { success: true, clauseId, versionId, revisionNumber: Number(versionRow.Revision_Number__c), operation: 'approved' });
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
    if (replacementClauseId) {
      const replacement = await currentRecord(OBJECTS.clause, replacementClauseId, ['Id', 'Status__c']);
      if (replacement.Status__c !== 'Active') throw specialTermsError('Replacement clause must be active.');
    }
    await sfRequest(`/sobjects/${OBJECTS.clause}/${clauseId}`, { method: 'PATCH', body: { Status__c: 'Retired', Retirement_Reason__c: reason, Replacement_Clause__c: replacementClauseId } });
    return finishOperation(client, reservation.operation, { success: true, clauseId, replacementClauseId, operation: 'retired' });
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

export async function previewSpecialTermMigration(termId, { projection = 'termsText' } = {}) {
  await resolveSpecialTermsSchema();
  const id = salesforceId(termId, 'Special Term');
  const config = projectionConfig(projection);
  const term = await currentRecord(OBJECTS.term, id, ['Id', 'Name', config.textField, config.statusField, ...(config.styleField ? [config.styleField] : []), 'LastModifiedDate']);
  if (term[config.statusField] === 'Active') throw specialTermsError(`This ${config.label} is already structured.`, 409, 'SPECIAL_TERMS_ALREADY_STRUCTURED');
  const parsed = parseLegacyClauses(term[config.textField], { termName: config.key === 'termsText' ? term.Name : '', markerStyle: config.key === 'termsText' ? 'Numbered' : 'Auto' });
  const bank = await loadClauseRows({ force: true });
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

async function planMigrationCandidates(profile, segments) {
  const bank = await loadClauseRows({ force: true });
  const byId = new Map(bank.clauses.map((clause) => [clause.id, clause]));
  const byCanonicalKey = new Map();
  const byLegacyKey = new Map();
  const usedShortNames = new Map(bank.clauses.map((clause) => [shortNameKey(clause.shortName), clause.id]));
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

    const key = shortNameKey(segment.shortName);
    if (usedShortNames.has(key)) throw specialTermsError(`Clause short name ${segment.shortName} is already in use. Choose a distinct name with its material qualifier.`, 409, 'SPECIAL_TERMS_CLAUSE_SHORT_NAME_EXISTS', { clauseId: usedShortNames.get(key) });
    usedShortNames.set(key, `new:${index}`);
    return {
      index,
      isNew: true,
      clauseRef: `migrationClause${index}`,
      versionRef: `migrationVersion${index}`,
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
  });
}

export async function saveSpecialTermMigrationReview(client, profile, body = {}) {
  const schema = await resolveSpecialTermsSchema({ force: true, write: true });
  const termId = salesforceId(body.termId, 'Special Term');
  const config = projectionConfig(body.projection || 'termsText');
  const style = projectionStyle(config, body.style);
  const reason = requiredReason(body.auditReason, 'Review reason');
  const segments = Array.isArray(body.segments) ? body.segments : [];
  if (segments.length > 200) throw specialTermsError('A Special Term cannot exceed 200 top-level clauses.');
  const normalizedSegments = segments.map((segment) => ({
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
  for (const segment of normalizedSegments) {
    if (segment.legacySourceKey !== canonicalClauseKey(segment.sourceClauseText)) throw specialTermsError('Legacy clause lineage changed after preview. Refresh before saving.', 409, 'SPECIAL_TERMS_STALE');
    if (segment.draftSource === 'AI Assisted' && (!segment.aiModel || !segment.aiResponseId)) throw specialTermsError('AI-assisted wording is missing model or response lineage.', 400, 'SPECIAL_TERMS_AI_LINEAGE_REQUIRED');
    if (hasMaterialDifference(segment.sourceClauseText, segment.clauseText)) throw specialTermsError('Proposed wording changes a protected amount, deadline, entity, port, product, standard, or jurisdiction. Keep it as a materially distinct clause.', 409, 'SPECIAL_TERMS_MATERIAL_DIFFERENCE');
  }
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
    const candidateKeys = candidates.map((candidate) => candidate.isNew ? candidate.canonicalKey : candidate.clauseId);
    if (new Set(candidateKeys).size !== candidateKeys.length) throw specialTermsError(`The same equivalent clause appears more than once in ${config.label}. Review the clause boundaries.`, 409, 'SPECIAL_TERMS_DUPLICATE_CLAUSE');
    const existing = await sfQuery(`SELECT Id FROM Special_Term_Clause_Assignment__c WHERE Special_Term__c = '${soql(termId)}' AND ${projectionWhere(config)} AND State__c = 'Proposed' LIMIT 500`, { clean: true, limit: 500 });
    if (existing.totalSize > existing.records.length) throw specialTermsError('This migration review exceeds the safe assignment limit.', 409, 'SPECIAL_TERMS_RESULT_LIMIT');
    const requests = existing.records.map((row, index) => ({ method: 'DELETE', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.assignment}/${row.Id}`, referenceId: `deleteProposed${index}` }));
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
        Clause__c: candidate.isNew ? `@{${candidate.clauseRef}.id}` : candidate.clauseId,
        Clause_Version__c: candidate.isNew ? `@{${candidate.versionRef}.id}` : candidate.versionId,
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
    if (active.records.length) requests.push({ method: 'DELETE', url: `/services/data/${getApiVersion()}/composite/sobjects?ids=${active.records.map((row) => row.Id).join(',')}&allOrNone=true`, referenceId: 'deleteActive' });
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
    const assignments = await sfQuery(`SELECT Id FROM Special_Term_Clause_Assignment__c WHERE Special_Term__c = '${soql(termId)}' AND ${projectionWhere(config)} LIMIT 500`, { clean: true, limit: 500 });
    const requests = [];
    if (assignments.records.length) requests.push({ method: 'DELETE', url: `/services/data/${getApiVersion()}/composite/sobjects?ids=${assignments.records.map((row) => row.Id).join(',')}&allOrNone=true`, referenceId: 'deleteAssignments' });
    requests.push({ method: 'PATCH', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.term}/${termId}`, referenceId: 'term', body: { [config.textField]: term[config.originalField] || null, [config.hashField]: null, [config.statusField]: 'Legacy', [config.batchField]: null } });
    const result = await sfRequest('/composite', { method: 'POST', body: { allOrNone: true, compositeRequest: requests } });
    assertComposite(result, 'Salesforce rejected the migration rollback.');
    return finishOperation(client, reservation.operation, { success: true, id: termId, projection: config.key, removedAssignmentCount: assignments.records.length, operation: 'rolled_back' });
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
  const revisionNumber = await latestRevisionNumber(termId);
  const revisionKey = `${termId}:${revisionNumber}`;
  const existing = await sfQuery(`SELECT Id,Status__c FROM Special_Term_Revision__c WHERE Revision_Key__c = '${soql(revisionKey)}' LIMIT 1`, { clean: true, limit: 1 });
  if (existing.records[0]) throw specialTermsError('This revision key is already in use. Refresh before saving.', 409, 'SPECIAL_TERMS_STALE');
  const styles = Object.fromEntries(compositions.map(({ config, style }) => [config.key, style]));
  const requests = [{ method: 'POST', url: `/services/data/${getApiVersion()}/sobjects/Special_Term_Revision__c`, referenceId: 'revision', body: {
    Special_Term__c: termId, Revision_Number__c: revisionNumber, Status__c: 'Draft', Revision_Reason__c: reason, Proposed_By_Email__c: profile.email,
    Confirmation_Style__c: styles.confirmationRemark, Nomination_Style__c: styles.nominationRemark,
    Prior_Confirmation_Style__c: term.Confirmation_Clause_Style__c || 'Hyphen', Prior_Nomination_Style__c: term.Nomination_Clause_Style__c || 'Hyphen',
  } }];
  const previousPending = await sfQuery(`SELECT Id FROM Special_Term_Revision__c WHERE Special_Term__c = '${soql(termId)}' AND Status__c = 'In Review' ORDER BY Revision_Number__c DESC LIMIT 10`, { clean: true, limit: 10 });
  if (previousPending.records.length) throw specialTermsError('This Special Term already has a revision awaiting approval. Open or reject it before creating another.', 409, 'SPECIAL_TERMS_REVISION_PENDING');
  for (const { config, versionIds } of compositions) {
    const versions = await liveApprovedVersions(versionIds);
    const clauseIds = versions.map((version) => version.Clause__c);
    if (new Set(clauseIds).size !== clauseIds.length) throw specialTermsError(`The same clause cannot appear twice in ${config.label}.`, 409, 'SPECIAL_TERMS_REVISION_DUPLICATE_CLAUSE');
    for (const version of versions) if (version.Status__c !== 'Approved' || version.Clause__r?.Status__c !== 'Active') throw specialTermsError('Revision rows must use approved versions of active clauses.', 409, 'SPECIAL_TERMS_CLAUSE_NOT_APPROVED');
    versions.forEach((version, index) => requests.push({ method: 'POST', url: `/services/data/${getApiVersion()}/sobjects/Special_Term_Revision_Clause__c`, referenceId: `revision${config.key}${index}`, body: {
      Special_Term_Revision__c: '@{revision.id}', Clause__c: version.Clause__c, Clause_Version__c: version.Id, Projection__c: config.value, Sequence__c: index + 1, State__c: 'Proposed',
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
    Special_Term_Revision__c: '@{revision.id}', Special_Term_Rule__c: rule.Id, Snapshot_Type__c: 'Baseline', Sequence__c: index + 1,
    Audience__c: rule.Supplier_Buyer__c, Account__c: rule.Account__c, Port__c: rule.Port__c, Product__c: rule.Product__c, Country__c: rule.Country__c,
    Priority__c: rule.Priority__c, Source_Last_Modified__c: rule.LastModifiedDate, State__c: 'Proposed',
  } }));
  proposedRules.forEach(({ source, payload }, index) => requests.push({ method: 'POST', url: `/services/data/${getApiVersion()}/sobjects/Special_Term_Revision_Rule__c`, referenceId: `revisionRuleProposed${index}`, body: {
    Special_Term_Revision__c: '@{revision.id}', Special_Term_Rule__c: source?.Id || null, Snapshot_Type__c: 'Proposed', Sequence__c: index + 1,
    Audience__c: payload.Supplier_Buyer__c, Account__c: payload.Account__c, Port__c: payload.Port__c, Product__c: payload.Product__c,
    Country__c: payload.Country__c, Priority__c: source?.Priority__c || null, Source_Last_Modified__c: source?.LastModifiedDate || null, State__c: 'Proposed',
  } }));
  requests.push({ method: 'PATCH', url: `/services/data/${getApiVersion()}/sobjects/Special_Term_Revision__c/@{revision.id}`, referenceId: 'revisionReady', body: { Status__c: 'In Review' } });
  if (term.Approval_Status__c !== 'Approved') requests.push({ method: 'PATCH', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.term}/${termId}`, referenceId: 'revisionTerm', body: { Approval_Status__c: 'Draft', Current_Revision__c: '@{revision.id}' } });
  if (requests.length > 500) throw specialTermsError('This whole-term revision exceeds Salesforce’s 500-operation atomic limit.', 409, 'SPECIAL_TERMS_COMPOSITE_LIMIT');
  const result = await sfRequest('/composite/graph', { method: 'POST', body: { graphs: [{ graphId: 'specialTermWholeRevision', compositeRequest: requests }] } });
  assertCompositeGraph(result, 'Salesforce rejected the whole-term revision draft.');
  const revisionResponse = result.graphs?.[0]?.graphResponse?.compositeResponse?.find((row) => row.referenceId === 'revision');
  return finishOperation(client, reservation.operation, { success: true, id: termId, revisionId: revisionResponse?.body?.id || null, revisionKey, status: 'In Review', projectionCount: compositions.length });
}

async function callRevisionApex(revisionId, termId, action, reason, expectedLastModifiedAt, approverEmail = null) {
  const result = await sfRequest(`/apexrest/fcos/special-term-revisions/${encodeURIComponent(revisionId)}/${action}`, { method: 'POST', body: { termId, approverEmail, reason, expectedLastModifiedAt } });
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
              id: { type: 'string' },
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
        { role: 'system', content: [{ type: 'input_text', text: 'You draft proposed FCOS Special Term clause-bank entries. Preserve every amount, deadline, party, port, product, standard, and jurisdiction. Do not merge clauses. Return JSON only: {"drafts":[{"id":"...","shortName":"3-7 action-oriented words","category":"one supplied category","proposedText":"professional shall/may wording","rationale":"brief"}]}. Each response is a DRAFT requiring human approval.' }] },
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

export const specialTermClauseServiceInternals = Object.freeze({ CLAUSE_CATEGORIES, assertCompositeGraph, cleanClauseText, cleanShortName, failureFromComposite });
