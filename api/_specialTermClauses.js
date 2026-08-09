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
} from './_specialTerms.js';
import {
  CLAUSE_CATEGORIES,
  canonicalClauseKey,
  clauseSimilarity,
  clauseHash,
  compileNumberedClauses,
  hasMaterialDifference,
  hasTopLevelNumber,
  normalizeClauseText,
  parseLegacyClauses,
  shortNameKey,
  suggestClauseCategory,
  suggestClauseShortName,
} from './_specialTermClauseModel.js';

const OBJECTS = Object.freeze({
  term: 'Special_Term__c',
  clause: 'Special_Term_Clause__c',
  version: 'Special_Term_Clause_Version__c',
  assignment: 'Special_Term_Clause_Assignment__c',
});
const SALESFORCE_ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;

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
  if (hasTopLevelNumber(clauseText)) throw specialTermsError('Clause text must not contain its own top-level number.', 400, 'SPECIAL_TERMS_CLAUSE_NUMBERED');
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
        sfQuery('SELECT Id,Name,Short_Name_Key__c,Canonical_Text_Key__c,Category__c,Status__c,Latest_Approved_Version_Number__c,Last_Approved_At__c,Replacement_Clause__c,Retirement_Reason__c,LastModifiedDate FROM Special_Term_Clause__c ORDER BY Name LIMIT 5000', { clean: true, limit: 5000 }),
        sfQuery('SELECT Id,Clause__c,Revision_Number__c,Clause_Text__c,Content_Hash__c,Status__c,Revision_Reason__c,Proposed_By_Email__c,Approved_By_Email__c,Approved_At__c,Approval_Reason__c,LastModifiedDate FROM Special_Term_Clause_Version__c ORDER BY Clause__c,Revision_Number__c DESC LIMIT 10000', { clean: true, limit: 10000 }),
        sfQuery("SELECT Clause__c clauseId,COUNT(Id) usageCount FROM Special_Term_Clause_Assignment__c WHERE State__c = 'Active' GROUP BY Clause__c LIMIT 2000", { clean: true, limit: 2000 }),
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
  const validStatus = ['Draft', 'Active', 'Retired'].includes(status) ? status : '';
  const clauses = [];
  for (const clause of bank.clauses) {
    if (validStatus && clause.status !== validStatus) continue;
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
  const terms = [];
  const occurrencesByKey = new Map();
  for (const term of workspace.terms || []) {
    const parsed = parseLegacyClauses(term.termsText, { termName: term.name });
    const populated = normalizeClauseText(term.termsText).length > 0;
    const entry = {
      termId: term.id,
      termName: term.name,
      structureStatus: term.clauseStructureStatus,
      populated,
      clauseCount: parsed.clauses.length,
      markerCount: parsed.markerCount || 0,
      plainlyNumbered: populated && !parsed.manualReviewRequired && parsed.markerCount === parsed.clauses.length,
      manualReviewRequired: parsed.manualReviewRequired,
      reviewReason: parsed.reason,
      lastModifiedAt: term.lastModifiedAt,
    };
    terms.push(entry);
    parsed.clauses.forEach((clauseText, index) => {
      const key = canonicalClauseKey(clauseText);
      if (!occurrencesByKey.has(key)) occurrencesByKey.set(key, []);
      occurrencesByKey.get(key).push({ termId: term.id, termName: term.name, sequence: index + 1, clauseText });
    });
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
  return {
    summary: {
      termCount: terms.length,
      populatedTermCount: terms.filter((term) => term.populated).length,
      emptyTermCount: terms.filter((term) => !term.populated).length,
      plainlyNumberedTermCount: terms.filter((term) => term.plainlyNumbered).length,
      manualReviewTermCount: terms.filter((term) => term.manualReviewRequired).length,
      structuredTermCount: terms.filter((term) => term.structureStatus === 'Active').length,
      duplicateGroupCount: duplicateGroups.length,
      duplicateCandidateOccurrenceCount: duplicateGroups.reduce((total, group) => total + group.occurrenceCount, 0),
    },
    terms,
    duplicateGroups,
    fetchedAt: workspace.fetchedAt,
  };
}

function assignmentFields() {
  return 'Id,Special_Term__c,Clause__c,Clause__r.Name,Clause__r.Category__c,Clause__r.Status__c,Clause__r.Latest_Approved_Version_Number__c,Clause_Version__c,Clause_Version__r.Revision_Number__c,Clause_Version__r.Clause_Text__c,Clause_Version__r.Status__c,Sequence__c,State__c,Migration_Batch_Id__c,LastModifiedDate';
}

export async function getSpecialTermDetail(termId, { force = false } = {}) {
  await resolveSpecialTermsSchema({ force });
  const id = salesforceId(termId, 'Special Term');
  const [termResult, assignmentResult] = await Promise.all([
    sfQuery(`SELECT Id,Name,Terms_Text__c,Add_to_Confirmation__c,Add_to_Nomination__c,Special_Remark_in_Confirmation__c,Special_Remark_in_Nomination__c,Clause_Structure_Status__c,Clause_Compiled_Hash__c,Original_Terms_Text__c,Clause_Migration_Batch_Id__c,LastModifiedDate FROM Special_Term__c WHERE Id = '${soql(id)}' LIMIT 1`, { clean: true, limit: 1 }),
    sfQuery(`SELECT ${assignmentFields()} FROM Special_Term_Clause_Assignment__c WHERE Special_Term__c = '${soql(id)}' ORDER BY State__c,Sequence__c,Id LIMIT 500`, { clean: true, limit: 500 }),
  ]);
  const term = termResult.records[0];
  if (!term) throw specialTermsError('The selected Special Term is no longer available.', 409, 'SPECIAL_TERMS_STALE');
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
      migrationBatchId: row.Migration_Batch_Id__c || null,
      upgradeAvailable: row.State__c === 'Active' && row.Clause__r?.Status__c === 'Active' && latest && latest.Id !== row.Clause_Version__c,
      latestApprovedVersion: mapVersion(latest),
      lastModifiedAt: row.LastModifiedDate || null,
    };
  });
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
      lastModifiedAt: term.LastModifiedDate || null,
    },
    activeAssignments: assignments.filter((assignment) => assignment.state === 'Active').sort((left, right) => left.sequence - right.sequence),
    proposedAssignments: assignments.filter((assignment) => assignment.state === 'Proposed').sort((left, right) => left.sequence - right.sequence),
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
      const requests = [{ method: 'PATCH', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.version}/${versionId}`, referenceId: 'version', body: { Clause_Text__c: clauseText, Content_Hash__c: clauseHash(clauseText), Revision_Reason__c: reason, Proposed_By_Email__c: profile.email } }];
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
      const created = await sfRequest(`/sobjects/${OBJECTS.version}`, { method: 'POST', body: { Clause__c: clauseId, Revision_Number__c: revisionNumber, Clause_Text__c: clauseText, Content_Hash__c: clauseHash(clauseText), Status__c: 'Draft', Revision_Reason__c: reason, Proposed_By_Email__c: profile.email } });
      const createdVersionId = salesforceId(created?.id, 'Created clause version');
      return finishOperation(client, reservation.operation, { success: true, clauseId, versionId: createdVersionId, revisionNumber, operation: 'revision_proposed' });
    }

    const result = await sfRequest('/composite', {
      method: 'POST',
      body: {
        allOrNone: true,
        compositeRequest: [
          { method: 'POST', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.clause}`, referenceId: 'clause', body: { Name: shortName, Short_Name_Key__c: shortNameKey(shortName), Canonical_Text_Key__c: canonicalKey, Category__c: category, Status__c: 'Draft', Latest_Approved_Version_Number__c: 0 } },
          { method: 'POST', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.version}`, referenceId: 'version', body: { Clause__c: '@{clause.id}', Revision_Number__c: 1, Clause_Text__c: clauseText, Content_Hash__c: clauseHash(clauseText), Status__c: 'Draft', Revision_Reason__c: reason, Proposed_By_Email__c: profile.email } },
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
  const versionIds = (body.versionIds || []).map((id) => salesforceId(id, 'Clause version'));
  if (versionIds.length > 200) throw specialTermsError('A Special Term cannot exceed 200 top-level clauses.');
  if (new Set(versionIds).size !== versionIds.length) throw specialTermsError('The same clause version cannot be added twice.');
  const metadata = termMetadataPayload(body);
  const reservation = await reserveOperation(client, profile, body, 'composition_save', { id: termId, versionIds, metadata, expectedLastModifiedAt: body.expectedLastModifiedAt });
  if (reservation.replay) return { ...reservation.replay, idempotencyReplayed: true };
  try {
    const term = await currentRecord(OBJECTS.term, termId, ['Id', 'Clause_Structure_Status__c', 'LastModifiedDate']);
    assertCurrent(term, body.expectedLastModifiedAt);
    if (term.Clause_Structure_Status__c !== 'Active') throw specialTermsError('Only an active structured Special Term can use the clause composer.', 409, 'SPECIAL_TERMS_NOT_STRUCTURED');
    const existing = await sfQuery(`SELECT Id,Clause__c,Clause_Version__c,Sequence__c,State__c FROM Special_Term_Clause_Assignment__c WHERE Special_Term__c = '${soql(termId)}' AND State__c = 'Active' ORDER BY Sequence__c,Id LIMIT 500`, { clean: true, limit: 500 });
    if (existing.totalSize > existing.records.length) throw specialTermsError('This Special Term exceeds the safe assignment limit.', 409, 'SPECIAL_TERMS_RESULT_LIMIT');
    const existingByClause = new Map(existing.records.map((row) => [row.Clause__c, row]));
    const versions = await liveApprovedVersions(versionIds);
    const clauseIds = versions.map((version) => version.Clause__c);
    if (new Set(clauseIds).size !== clauseIds.length) throw specialTermsError('The same bank clause cannot appear twice in one Special Term.');
    for (const version of versions) {
      const existingRow = existingByClause.get(version.Clause__c);
      const currentlySelectable = version.Status__c === 'Approved' && version.Clause__r?.Status__c === 'Active';
      const retainedExistingUse = existingRow?.Clause_Version__c === version.Id
        && ['Approved', 'Superseded'].includes(version.Status__c)
        && ['Active', 'Retired'].includes(version.Clause__r?.Status__c);
      if (!currentlySelectable && !retainedExistingUse) throw specialTermsError('New rows must use the current approved version of an active clause. Existing retired or superseded wording may only remain unchanged.', 409, 'SPECIAL_TERMS_CLAUSE_NOT_APPROVED');
    }
    const compiledText = compileNumberedClauses(versions.map((version) => version.Clause_Text__c));
    const compiledHash = clauseHash(compiledText);
    const requests = [];
    const retainedClauseIds = new Set(clauseIds);
    const removed = existing.records.filter((row) => !retainedClauseIds.has(row.Clause__c));
    const updated = [];
    const inserted = [];
    versions.forEach((version, index) => {
      const existingRow = existingByClause.get(version.Clause__c);
      const record = { attributes: { type: OBJECTS.assignment }, Clause__c: version.Clause__c, Clause_Version__c: version.Id, Sequence__c: index + 1, State__c: 'Active' };
      if (existingRow) updated.push({ ...record, Id: existingRow.Id });
      else inserted.push({ ...record, Special_Term__c: termId });
    });
    if (removed.length) requests.push({ method: 'DELETE', url: `/services/data/${getApiVersion()}/composite/sobjects?ids=${removed.map((row) => row.Id).join(',')}&allOrNone=true`, referenceId: 'deleteAssignments' });
    if (updated.length) requests.push({ method: 'PATCH', url: `/services/data/${getApiVersion()}/composite/sobjects`, referenceId: 'updateAssignments', body: { allOrNone: true, records: updated } });
    if (inserted.length) requests.push({ method: 'POST', url: `/services/data/${getApiVersion()}/composite/sobjects`, referenceId: 'insertAssignments', body: { allOrNone: true, records: inserted } });
    requests.push({ method: 'PATCH', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.term}/${termId}`, referenceId: 'term', body: { ...metadata, Terms_Text__c: compiledText || null, Clause_Compiled_Hash__c: compiledHash, Clause_Structure_Status__c: 'Active' } });
    const result = await sfRequest('/composite', { method: 'POST', body: { allOrNone: true, compositeRequest: requests } });
    assertComposite(result, 'Salesforce rejected the numbered clause composition.');
    return finishOperation(client, reservation.operation, { success: true, id: termId, clauseCount: versions.length, compiledHash });
  } catch (error) {
    return failOperation(client, reservation.operation, error);
  }
}

export async function previewSpecialTermMigration(termId) {
  await resolveSpecialTermsSchema();
  const id = salesforceId(termId, 'Special Term');
  const term = await currentRecord(OBJECTS.term, id, ['Id', 'Name', 'Terms_Text__c', 'Clause_Structure_Status__c', 'LastModifiedDate']);
  if (term.Clause_Structure_Status__c === 'Active') throw specialTermsError('This Special Term is already structured.', 409, 'SPECIAL_TERMS_ALREADY_STRUCTURED');
  const parsed = parseLegacyClauses(term.Terms_Text__c, { termName: term.Name });
  const bank = await loadClauseRows({ force: true });
  const byKey = new Map();
  for (const clause of bank.clauses) {
    for (const version of clause._versions || []) {
      const key = canonicalClauseKey(version.clauseText);
      if (!byKey.has(key) && ['Approved', 'Draft', 'Superseded'].includes(version.status)) byKey.set(key, { clause, version });
    }
  }
  return {
    termId: id,
    termName: term.Name,
    termsText: term.Terms_Text__c || '',
    expectedLastModifiedAt: term.LastModifiedDate,
    manualReviewRequired: parsed.manualReviewRequired,
    reason: parsed.reason,
    segments: parsed.clauses.map((clauseText, index) => {
      const exact = byKey.get(canonicalClauseKey(clauseText));
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
      return { index: index + 1, clauseText, suggestedShortName: match?.shortName || suggestClauseShortName(clauseText), suggestedCategory: match?.category || suggestClauseCategory(clauseText), exactMatchClauseId: match?.id || null, exactMatchVersionId: exact?.version?.id || null, exactMatchStatus: match?.status || null, selectedClauseId: match?.id || null, selectedClauseVersionId: exact?.version?.id || null, nearMatches };
    }),
  };
}

async function planMigrationCandidates(profile, segments) {
  const bank = await loadClauseRows({ force: true });
  const byId = new Map(bank.clauses.map((clause) => [clause.id, clause]));
  const byCanonicalKey = new Map();
  const usedShortNames = new Map(bank.clauses.map((clause) => [shortNameKey(clause.shortName), clause.id]));
  for (const clause of bank.clauses) {
    for (const version of clause._versions || []) {
      if (!['Approved', 'Draft', 'Superseded'].includes(version.status)) continue;
      const key = canonicalClauseKey(version.clauseText);
      if (!byCanonicalKey.has(key)) byCanonicalKey.set(key, { clause, version });
    }
  }

  return segments.map((segment, index) => {
    const canonicalKey = canonicalClauseKey(segment.clauseText);
    const exact = byCanonicalKey.get(canonicalKey);
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
      canonicalKey,
      proposedByEmail: profile.email,
    };
  });
}

export async function saveSpecialTermMigrationReview(client, profile, body = {}) {
  const schema = await resolveSpecialTermsSchema({ force: true, write: true });
  const termId = salesforceId(body.termId, 'Special Term');
  const reason = requiredReason(body.auditReason, 'Review reason');
  const segments = Array.isArray(body.segments) ? body.segments : [];
  if (segments.length > 200) throw specialTermsError('A Special Term cannot exceed 200 top-level clauses.');
  const normalizedSegments = segments.map((segment) => ({
    clauseText: cleanClauseText(segment.clauseText),
    shortName: cleanShortName(segment.shortName),
    category: cleanCategory(segment.category, schema),
    selectedClauseId: segment.selectedClauseId ? salesforceId(segment.selectedClauseId, 'Selected clause') : null,
    selectedClauseVersionId: segment.selectedClauseVersionId ? salesforceId(segment.selectedClauseVersionId, 'Selected clause version') : null,
  }));
  const reservation = await reserveOperation(client, profile, body, 'migration_review_save', { id: termId, segmentKeys: normalizedSegments.map((segment) => canonicalClauseKey(segment.clauseText)), selectedClauseIds: normalizedSegments.map((segment) => segment.selectedClauseId), auditReasonHash: clauseHash(reason), expectedLastModifiedAt: body.expectedLastModifiedAt });
  if (reservation.replay) return { ...reservation.replay, idempotencyReplayed: true };
  try {
    const term = await currentRecord(OBJECTS.term, termId, ['Id', 'Terms_Text__c', 'Original_Terms_Text__c', 'Clause_Structure_Status__c', 'LastModifiedDate']);
    assertCurrent(term, body.expectedLastModifiedAt);
    if (term.Clause_Structure_Status__c === 'Active') throw specialTermsError('Active structured terms do not use migration review.', 409, 'SPECIAL_TERMS_ALREADY_STRUCTURED');
    if (!normalizedSegments.length && !String(term.Terms_Text__c || '').trim()) {
      await sfRequest(`/sobjects/${OBJECTS.term}/${termId}`, { method: 'PATCH', body: { Clause_Structure_Status__c: 'Active', Clause_Compiled_Hash__c: clauseHash(''), Original_Terms_Text__c: term.Original_Terms_Text__c || null, Clause_Migration_Batch_Id__c: body.operationId } });
      return finishOperation(client, reservation.operation, { success: true, id: termId, clauseCount: 0, operation: 'empty_activated' });
    }
    if (!normalizedSegments.length) throw specialTermsError('At least one reviewed clause is required for populated Terms Text.');
    const candidates = await planMigrationCandidates(profile, normalizedSegments);
    const candidateKeys = candidates.map((candidate) => candidate.isNew ? candidate.canonicalKey : candidate.clauseId);
    if (new Set(candidateKeys).size !== candidateKeys.length) throw specialTermsError('The same equivalent clause appears more than once in this Special Term. Review the clause boundaries.', 409, 'SPECIAL_TERMS_DUPLICATE_CLAUSE');
    const existing = await sfQuery(`SELECT Id FROM Special_Term_Clause_Assignment__c WHERE Special_Term__c = '${soql(termId)}' AND State__c = 'Proposed' LIMIT 500`, { clean: true, limit: 500 });
    if (existing.totalSize > existing.records.length) throw specialTermsError('This migration review exceeds the safe assignment limit.', 409, 'SPECIAL_TERMS_RESULT_LIMIT');
    const requests = existing.records.map((row, index) => ({ method: 'DELETE', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.assignment}/${row.Id}`, referenceId: `deleteProposed${index}` }));
    for (const candidate of candidates.filter((row) => row.isNew)) {
      requests.push(
        { method: 'POST', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.clause}`, referenceId: candidate.clauseRef, body: { Name: candidate.shortName, Short_Name_Key__c: shortNameKey(candidate.shortName), Canonical_Text_Key__c: candidate.canonicalKey, Category__c: candidate.category, Status__c: 'Draft', Latest_Approved_Version_Number__c: 0 } },
        { method: 'POST', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.version}`, referenceId: candidate.versionRef, body: { Clause__c: `@{${candidate.clauseRef}.id}`, Revision_Number__c: 1, Clause_Text__c: candidate.clauseText, Content_Hash__c: clauseHash(candidate.clauseText), Status__c: 'Draft', Revision_Reason__c: 'Prepared from legacy Special Terms for legal-equivalence review.', Proposed_By_Email__c: candidate.proposedByEmail } },
      );
    }
    candidates.forEach((candidate, index) => requests.push({
      method: 'POST',
      url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.assignment}`,
      referenceId: `migrationAssignment${index}`,
      body: {
        Special_Term__c: termId,
        Clause__c: candidate.isNew ? `@{${candidate.clauseRef}.id}` : candidate.clauseId,
        Clause_Version__c: candidate.isNew ? `@{${candidate.versionRef}.id}` : candidate.versionId,
        Sequence__c: index + 1,
        State__c: 'Proposed',
        Migration_Batch_Id__c: body.operationId,
      },
    }));
    requests.push({ method: 'PATCH', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.term}/${termId}`, referenceId: 'migrationTerm', body: { Clause_Structure_Status__c: 'In Review', Original_Terms_Text__c: term.Original_Terms_Text__c || term.Terms_Text__c || null, Clause_Migration_Batch_Id__c: body.operationId } });
    if (requests.length > 500) throw specialTermsError('This migration review exceeds Salesforce Composite Graph’s 500-operation atomic limit. Split the legal structure before saving.', 409, 'SPECIAL_TERMS_COMPOSITE_LIMIT');
    const result = await sfRequest('/composite/graph', { method: 'POST', body: { graphs: [{ graphId: 'specialTermMigrationReview', compositeRequest: requests }] } });
    assertCompositeGraph(result, 'Salesforce rejected the atomic migration review.');
    void reason;
    return finishOperation(client, reservation.operation, { success: true, id: termId, clauseCount: candidates.length, draftClauseCount: candidates.length, operation: 'review_saved' });
  } catch (error) {
    return failOperation(client, reservation.operation, error);
  }
}

export async function activateSpecialTermMigration(client, profile, body = {}) {
  await resolveSpecialTermsSchema({ force: true, write: true });
  const termId = salesforceId(body.termId, 'Special Term');
  const reason = requiredReason(body.auditReason, 'Activation reason');
  const reservation = await reserveOperation(client, profile, body, 'migration_activate', { id: termId, auditReasonHash: clauseHash(reason), expectedLastModifiedAt: body.expectedLastModifiedAt });
  if (reservation.replay) return { ...reservation.replay, idempotencyReplayed: true };
  try {
    const term = await currentRecord(OBJECTS.term, termId, ['Id', 'Clause_Structure_Status__c', 'LastModifiedDate']);
    assertCurrent(term, body.expectedLastModifiedAt);
    if (term.Clause_Structure_Status__c !== 'In Review') throw specialTermsError('Special Term must be In Review before activation.', 409, 'SPECIAL_TERMS_MIGRATION_NOT_READY');
    const proposed = await sfQuery(`SELECT ${assignmentFields()} FROM Special_Term_Clause_Assignment__c WHERE Special_Term__c = '${soql(termId)}' AND State__c = 'Proposed' ORDER BY Sequence__c,Id LIMIT 500`, { clean: true, limit: 500 });
    const rows = proposed.records;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (Number(row.Sequence__c) !== index + 1 || !['Approved', 'Superseded'].includes(row.Clause_Version__r?.Status__c) || row.Clause__r?.Status__c !== 'Active') throw specialTermsError('Every proposed row must be sequential and use approved retained wording before activation.', 409, 'SPECIAL_TERMS_MIGRATION_NOT_READY');
    }
    const compiledText = compileNumberedClauses(rows.map((row) => row.Clause_Version__r.Clause_Text__c));
    const compiledHash = clauseHash(compiledText);
    const active = await sfQuery(`SELECT Id FROM Special_Term_Clause_Assignment__c WHERE Special_Term__c = '${soql(termId)}' AND State__c = 'Active' LIMIT 500`, { clean: true, limit: 500 });
    const requests = [];
    if (active.records.length) requests.push({ method: 'DELETE', url: `/services/data/${getApiVersion()}/composite/sobjects?ids=${active.records.map((row) => row.Id).join(',')}&allOrNone=true`, referenceId: 'deleteActive' });
    if (rows.length) requests.push({ method: 'PATCH', url: `/services/data/${getApiVersion()}/composite/sobjects`, referenceId: 'activateAssignments', body: { allOrNone: true, records: rows.map((row) => ({ attributes: { type: OBJECTS.assignment }, Id: row.Id, State__c: 'Active' })) } });
    requests.push({ method: 'PATCH', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.term}/${termId}`, referenceId: 'term', body: { Terms_Text__c: compiledText || null, Clause_Compiled_Hash__c: compiledHash, Clause_Structure_Status__c: 'Active' } });
    const result = await sfRequest('/composite', { method: 'POST', body: { allOrNone: true, compositeRequest: requests } });
    assertComposite(result, 'Salesforce rejected the Special Term activation.');
    return finishOperation(client, reservation.operation, { success: true, id: termId, clauseCount: rows.length, compiledHash, operation: 'activated' });
  } catch (error) {
    return failOperation(client, reservation.operation, error);
  }
}

export async function rollbackSpecialTermMigration(client, profile, body = {}) {
  await resolveSpecialTermsSchema({ force: true, write: true });
  const termId = salesforceId(body.termId, 'Special Term');
  const reason = requiredReason(body.auditReason, 'Rollback reason');
  const reservation = await reserveOperation(client, profile, body, 'migration_rollback', { id: termId, auditReasonHash: clauseHash(reason), expectedLastModifiedAt: body.expectedLastModifiedAt });
  if (reservation.replay) return { ...reservation.replay, idempotencyReplayed: true };
  try {
    const term = await currentRecord(OBJECTS.term, termId, ['Id', 'Clause_Structure_Status__c', 'Original_Terms_Text__c', 'LastModifiedDate']);
    assertCurrent(term, body.expectedLastModifiedAt);
    if (term.Clause_Structure_Status__c !== 'Active' || term.Original_Terms_Text__c == null) throw specialTermsError('Only a migrated term with preserved original text can be rolled back.', 409, 'SPECIAL_TERMS_ROLLBACK_UNAVAILABLE');
    const assignments = await sfQuery(`SELECT Id FROM Special_Term_Clause_Assignment__c WHERE Special_Term__c = '${soql(termId)}' LIMIT 500`, { clean: true, limit: 500 });
    const requests = [];
    if (assignments.records.length) requests.push({ method: 'DELETE', url: `/services/data/${getApiVersion()}/composite/sobjects?ids=${assignments.records.map((row) => row.Id).join(',')}&allOrNone=true`, referenceId: 'deleteAssignments' });
    requests.push({ method: 'PATCH', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.term}/${termId}`, referenceId: 'term', body: { Terms_Text__c: term.Original_Terms_Text__c || null, Clause_Compiled_Hash__c: null, Clause_Structure_Status__c: 'Legacy', Clause_Migration_Batch_Id__c: null } });
    const result = await sfRequest('/composite', { method: 'POST', body: { allOrNone: true, compositeRequest: requests } });
    assertComposite(result, 'Salesforce rejected the migration rollback.');
    return finishOperation(client, reservation.operation, { success: true, id: termId, removedAssignmentCount: assignments.records.length, operation: 'rolled_back' });
  } catch (error) {
    return failOperation(client, reservation.operation, error);
  }
}

export const specialTermClauseServiceInternals = Object.freeze({ CLAUSE_CATEGORIES, assertCompositeGraph, cleanClauseText, cleanShortName, failureFromComposite });
