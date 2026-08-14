import { createHash } from 'node:crypto';
import { getApiVersion, getInstanceUrl, sfCompositeQueries, sfQuery, sfRequest } from './_salesforce.js';
import { expireRuntimeCacheTags, getOrLoadRuntimeCache } from './_runtimeCache.js';
import { clauseHash, compileNumberedClauses } from './_specialTermClauseModel.js';

const OBJECTS = Object.freeze({
  term: 'Special_Term__c',
  rule: 'Special_Term_Rule__c',
  account: 'Account',
  port: 'Port__c',
  product: 'Product2',
  clause: 'Special_Term_Clause__c',
  clauseVersion: 'Special_Term_Clause_Version__c',
  clauseAssignment: 'Special_Term_Clause_Assignment__c',
  clauseConsolidation: 'Special_Term_Clause_Consolidation__c',
  revisionClause: 'Special_Term_Revision_Clause__c',
});
const SALESFORCE_ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const OPERATION_OBJECTS = Object.freeze({
  term_create: OBJECTS.term,
  term_update: OBJECTS.term,
  term_delete: OBJECTS.term,
  rule_create: OBJECTS.rule,
  rule_update: OBJECTS.rule,
  rule_delete: OBJECTS.rule,
  composition_save: OBJECTS.clauseAssignment,
  clause_draft_create: OBJECTS.clause,
  clause_draft_revise: OBJECTS.clauseVersion,
  clause_approve: OBJECTS.clauseVersion,
  clause_retire: OBJECTS.clause,
  clause_consolidation_start: OBJECTS.clauseConsolidation,
  clause_consolidation_relink: OBJECTS.clauseConsolidation,
  clause_consolidation_cancel: OBJECTS.clauseConsolidation,
  clause_consolidation_complete: OBJECTS.clauseConsolidation,
  migration_review_save: OBJECTS.clauseAssignment,
  migration_activate: OBJECTS.term,
  migration_rollback: OBJECTS.term,
  revision_save: OBJECTS.clauseAssignment,
  revision_approve: OBJECTS.term,
  revision_rollback: OBJECTS.term,
  migration_batch_review: OBJECTS.clauseAssignment,
  clause_ai_draft: OBJECTS.clause,
});
const OPERATION_TYPES = new Set(Object.keys(OPERATION_OBJECTS));

export function specialTermsError(message, status = 400, code = null, details = undefined) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

export function text(value, max = 10000) {
  return String(value ?? '').trim().slice(0, max);
}

function isSalesforceRecordId(value) {
  return SALESFORCE_ID.test(text(value, 18));
}

export function soql(value) {
  return text(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function salesforceId(value, label = 'Salesforce record') {
  const id = text(value, 18);
  if (!SALESFORCE_ID.test(id)) throw specialTermsError(`${label} is invalid.`, 400, 'SPECIAL_TERMS_INVALID_ID');
  return id;
}

function fieldMap(describe) {
  return new Map((describe?.fields || []).map((field) => [field.name, field]));
}

function requiredField(fields, objectName, fieldName, { type, referenceTo, createable, updateable } = {}) {
  const field = fields.get(fieldName);
  if (!field) throw specialTermsError(`Special Terms requires ${objectName}.${fieldName}.`, 503, 'SPECIAL_TERMS_SCHEMA_INVALID');
  if (type && field.type !== type) throw specialTermsError(`Special Terms requires ${objectName}.${fieldName} to be ${type}.`, 503, 'SPECIAL_TERMS_SCHEMA_INVALID');
  if (referenceTo && !(field.referenceTo || []).includes(referenceTo)) throw specialTermsError(`Special Terms requires ${objectName}.${fieldName} to reference ${referenceTo}.`, 503, 'SPECIAL_TERMS_SCHEMA_INVALID');
  if (createable === true && field.createable !== true) throw specialTermsError(`Special Terms requires create access to ${objectName}.${fieldName}.`, 503, 'SPECIAL_TERMS_SCHEMA_INVALID');
  if (updateable === true && field.updateable !== true) throw specialTermsError(`Special Terms requires update access to ${objectName}.${fieldName}.`, 503, 'SPECIAL_TERMS_SCHEMA_INVALID');
  return field;
}

async function describeObject(objectName, force = false) {
  const cached = await getOrLoadRuntimeCache({
    namespace: 'salesforce-special-terms-describe',
    version: '2',
    accessScope: 'schema',
    apiVersion: `${getApiVersion()}@${getInstanceUrl()}`,
    payload: { objectName: objectName.toLowerCase() },
    ttlSeconds: 6 * 60 * 60,
    tags: ['salesforce:schema', 'salesforce:special-terms:schema', `salesforce:schema:${objectName.toLowerCase()}`],
    force,
    loader: async () => {
      const data = await sfRequest(`/sobjects/${encodeURIComponent(objectName)}/describe/`, { readOnly: true });
      return {
        name: data.name,
        createable: data.createable === true,
        updateable: data.updateable === true,
        deletable: data.deletable === true,
        fields: (data.fields || []).map((field) => ({
          name: field.name,
          label: field.label,
          type: field.type,
          createable: field.createable === true,
          updateable: field.updateable === true,
          referenceTo: field.referenceTo || [],
          picklistValues: (field.picklistValues || []).filter((option) => option.active !== false).map((option) => ({ label: option.label, value: option.value })),
        })),
      };
    },
  });
  return cached.value;
}

async function loadSpecialTermsSchema({ force = false, write = false } = {}) {
  const [termDescribe, ruleDescribe, accountDescribe, portDescribe, productDescribe, clauseDescribe, clauseVersionDescribe, clauseAssignmentDescribe] = await Promise.all([
    describeObject(OBJECTS.term, force),
    describeObject(OBJECTS.rule, force),
    describeObject(OBJECTS.account, force),
    describeObject(OBJECTS.port, force),
    describeObject(OBJECTS.product, force),
    describeObject(OBJECTS.clause, force),
    describeObject(OBJECTS.clauseVersion, force),
    describeObject(OBJECTS.clauseAssignment, force),
  ]);
  const fields = {
    term: fieldMap(termDescribe),
    rule: fieldMap(ruleDescribe),
    account: fieldMap(accountDescribe),
    port: fieldMap(portDescribe),
    product: fieldMap(productDescribe),
    clause: fieldMap(clauseDescribe),
    clauseVersion: fieldMap(clauseVersionDescribe),
    clauseAssignment: fieldMap(clauseAssignmentDescribe),
  };
  requiredField(fields.term, OBJECTS.term, 'Name', { type: 'string', ...(write ? { createable: true, updateable: true } : {}) });
  requiredField(fields.term, OBJECTS.term, 'Terms_Text__c', { type: 'textarea', ...(write ? { createable: true, updateable: true } : {}) });
  for (const name of ['Add_to_Confirmation__c', 'Add_to_Nomination__c']) requiredField(fields.term, OBJECTS.term, name, { type: 'boolean', ...(write ? { createable: true, updateable: true } : {}) });
  for (const name of ['Special_Remark_in_Confirmation__c', 'Special_Remark_in_Nomination__c']) requiredField(fields.term, OBJECTS.term, name, { type: 'textarea', ...(write ? { createable: true, updateable: true } : {}) });
  for (const name of [
    'Approval_Status__c', 'Current_Revision__c',
    'Clause_Structure_Status__c', 'Clause_Compiled_Hash__c', 'Original_Terms_Text__c', 'Clause_Migration_Batch_Id__c',
    'Confirmation_Clause_Status__c', 'Confirmation_Clause_Style__c', 'Confirmation_Compiled_Hash__c', 'Original_Confirmation_Remark__c', 'Confirmation_Migration_Batch_Id__c',
    'Nomination_Clause_Status__c', 'Nomination_Clause_Style__c', 'Nomination_Compiled_Hash__c', 'Original_Nomination_Remark__c', 'Nomination_Migration_Batch_Id__c',
  ]) requiredField(fields.term, OBJECTS.term, name, { ...(write ? { createable: true, updateable: true } : {}) });
  requiredField(fields.rule, OBJECTS.rule, 'Special_Term__c', { referenceTo: OBJECTS.term, ...(write ? { createable: true, updateable: true } : {}) });
  requiredField(fields.rule, OBJECTS.rule, 'Account__c', { referenceTo: OBJECTS.account, ...(write ? { createable: true, updateable: true } : {}) });
  requiredField(fields.rule, OBJECTS.rule, 'Port__c', { referenceTo: OBJECTS.port, ...(write ? { createable: true, updateable: true } : {}) });
  requiredField(fields.rule, OBJECTS.rule, 'Product__c', { referenceTo: OBJECTS.product, ...(write ? { createable: true, updateable: true } : {}) });
  requiredField(fields.rule, OBJECTS.rule, 'Country__c', { type: 'picklist', ...(write ? { createable: true, updateable: true } : {}) });
  requiredField(fields.rule, OBJECTS.rule, 'Supplier_Buyer__c', { type: 'picklist', ...(write ? { createable: true, updateable: true } : {}) });
  requiredField(fields.rule, OBJECTS.rule, 'Priority__c', { type: 'double' });
  for (const [map, objectName, names] of [[fields.account, OBJECTS.account, ['Name', 'Company_Code__c']], [fields.port, OBJECTS.port, ['Name', 'Country__c', 'Offshore__c']], [fields.product, OBJECTS.product, ['Name', 'IsActive']]]) {
    for (const name of names) requiredField(map, objectName, name);
  }
  for (const name of ['Name', 'Short_Name_Key__c', 'Canonical_Text_Key__c', 'Category__c', 'Status__c', 'Origin__c', 'Legacy_Original_Text__c', 'Latest_Approved_Version_Number__c', 'Last_Approved_At__c', 'Replacement_Clause__c', 'Retirement_Reason__c']) requiredField(fields.clause, OBJECTS.clause, name, { ...(write ? { createable: name !== 'LastModifiedDate', updateable: true } : {}) });
  for (const name of ['Clause__c', 'Revision_Number__c', 'Clause_Text__c', 'Content_Hash__c', 'Version_Key__c', 'Status__c', 'Revision_Reason__c', 'Proposed_By_Email__c', 'Approved_By_Email__c', 'Approved_At__c', 'Approval_Reason__c', 'Draft_Source__c', 'AI_Model__c', 'AI_Response_Id__c', 'Legacy_Source_Key__c']) requiredField(fields.clauseVersion, OBJECTS.clauseVersion, name, { ...(write ? { createable: true, ...(name === 'Clause__c' ? {} : { updateable: true }) } : {}) });
  requiredField(fields.clauseVersion, OBJECTS.clauseVersion, 'Clause__c', { referenceTo: OBJECTS.clause, ...(write ? { createable: true } : {}) });
  for (const name of ['Projection__c', 'Sequence__c', 'State__c', 'Assignment_Key__c', 'Clause_Use_Key__c', 'Migration_Batch_Id__c']) requiredField(fields.clauseAssignment, OBJECTS.clauseAssignment, name, { ...(write ? { createable: true, updateable: true } : {}) });
  requiredField(fields.clauseAssignment, OBJECTS.clauseAssignment, 'Special_Term__c', { referenceTo: OBJECTS.term, ...(write ? { createable: true } : {}) });
  requiredField(fields.clauseAssignment, OBJECTS.clauseAssignment, 'Clause__c', { referenceTo: OBJECTS.clause, ...(write ? { createable: true, updateable: true } : {}) });
  requiredField(fields.clauseAssignment, OBJECTS.clauseAssignment, 'Clause_Version__c', { referenceTo: OBJECTS.clauseVersion, ...(write ? { createable: true, updateable: true } : {}) });
  const audiences = fields.rule.get('Supplier_Buyer__c').picklistValues || [];
  if (!['Buyer', 'Supplier'].every((value) => audiences.some((option) => option.value === value))) throw specialTermsError('Special_Term_Rule__c.Supplier_Buyer__c must provide Buyer and Supplier.', 503, 'SPECIAL_TERMS_SCHEMA_INVALID');
  if (write && (!termDescribe.createable || !termDescribe.updateable || !termDescribe.deletable || !ruleDescribe.createable || !ruleDescribe.updateable || !ruleDescribe.deletable || !clauseDescribe.createable || !clauseDescribe.updateable || !clauseVersionDescribe.createable || !clauseVersionDescribe.updateable || !clauseAssignmentDescribe.createable || !clauseAssignmentDescribe.updateable)) {
    throw specialTermsError('The FCOS Salesforce user requires write access to Special Terms, rules, clauses, versions, and assignments.', 503, 'SPECIAL_TERMS_SCHEMA_INVALID');
  }
  return {
    fields,
    describes: { termDescribe, ruleDescribe, clauseDescribe, clauseVersionDescribe, clauseAssignmentDescribe },
    countryOptions: fields.rule.get('Country__c').picklistValues || [],
    audienceOptions: audiences,
    clauseCategoryOptions: fields.clause.get('Category__c').picklistValues || [],
  };
}

export async function resolveSpecialTermsSchema({ force = false, write = false } = {}) {
  if (force) return loadSpecialTermsSchema({ force: true, write });
  try {
    return await loadSpecialTermsSchema({ write });
  } catch (error) {
    if (error?.code !== 'SPECIAL_TERMS_SCHEMA_INVALID') throw error;
    return loadSpecialTermsSchema({ force: true, write });
  }
}

function mapTerm(row) {
  const projectionStatuses = [row.Clause_Structure_Status__c || 'Legacy', row.Confirmation_Clause_Status__c || 'Legacy', row.Nomination_Clause_Status__c || 'Legacy'];
  const revisionIds = [row.Clause_Migration_Batch_Id__c, row.Confirmation_Migration_Batch_Id__c, row.Nomination_Migration_Batch_Id__c].filter(Boolean);
  const revisionStatus = row.Approval_Status__c || (projectionStatuses.every((status) => status === 'Active') ? 'Approved'
    : projectionStatuses.some((status) => status === 'In Review') ? 'Draft' : 'Legacy');
  return {
    id: row.Id,
    name: row.Name || '',
    termsText: row.Terms_Text__c || '',
    addToConfirmation: row.Add_to_Confirmation__c === true,
    addToNomination: row.Add_to_Nomination__c === true,
    confirmationRemark: row.Special_Remark_in_Confirmation__c || '',
    nominationRemark: row.Special_Remark_in_Nomination__c || '',
    clauseStructureStatus: row.Clause_Structure_Status__c || 'Legacy',
    clauseCompiledHash: row.Clause_Compiled_Hash__c || null,
    originalTermsText: row.Original_Terms_Text__c || '',
    clauseMigrationBatchId: row.Clause_Migration_Batch_Id__c || null,
    confirmationClauseStatus: row.Confirmation_Clause_Status__c || 'Legacy',
    confirmationClauseStyle: row.Confirmation_Clause_Style__c || 'Hyphen',
    confirmationCompiledHash: row.Confirmation_Compiled_Hash__c || null,
    originalConfirmationRemark: row.Original_Confirmation_Remark__c || '',
    confirmationMigrationBatchId: row.Confirmation_Migration_Batch_Id__c || null,
    nominationClauseStatus: row.Nomination_Clause_Status__c || 'Legacy',
    nominationClauseStyle: row.Nomination_Clause_Style__c || 'Hyphen',
    nominationCompiledHash: row.Nomination_Compiled_Hash__c || null,
    originalNominationRemark: row.Original_Nomination_Remark__c || '',
    nominationMigrationBatchId: row.Nomination_Migration_Batch_Id__c || null,
    revisionId: row.Current_Revision__c || (revisionIds.length === 3 && new Set(revisionIds).size === 1 ? revisionIds[0] : null),
    currentRevision: row.Current_Revision__c || (revisionStatus === 'Approved' ? revisionIds.find(Boolean) || null : null),
    revisionStatus,
    revisionSummary: { status: revisionStatus, projectionStatuses },
    legacyProvenance: {
      termsText: row.Original_Terms_Text__c != null,
      confirmationRemark: row.Original_Confirmation_Remark__c != null,
      nominationRemark: row.Original_Nomination_Remark__c != null,
    },
    activeClauseCount: Number(row.activeClauseCount || 0),
    proposedClauseCount: Number(row.proposedClauseCount || 0),
    upgradeCount: Number(row.upgradeCount || 0),
    confirmationActiveClauseCount: Number(row.confirmationActiveClauseCount || 0),
    confirmationProposedClauseCount: Number(row.confirmationProposedClauseCount || 0),
    confirmationUpgradeCount: Number(row.confirmationUpgradeCount || 0),
    nominationActiveClauseCount: Number(row.nominationActiveClauseCount || 0),
    nominationProposedClauseCount: Number(row.nominationProposedClauseCount || 0),
    nominationUpgradeCount: Number(row.nominationUpgradeCount || 0),
    relinkRequiredCount: Number(row.relinkRequiredCount || 0),
    lastModifiedAt: row.LastModifiedDate || null,
  };
}

function mapRule(row) {
  return {
    id: row.Id,
    name: row.Name || '',
    specialTermId: row.Special_Term__c,
    specialTermName: row.Special_Term__r?.Name || '',
    audience: row.Supplier_Buyer__c || '',
    accountId: row.Account__c || null,
    accountName: row.Account__r?.Name || '',
    accountClKey: row.Account__r?.Company_Code__c || '',
    portId: row.Port__c || null,
    portName: row.Port__r?.Name || '',
    portCountry: row.Port__r?.Country__c || '',
    productId: row.Product__c || null,
    productName: row.Product__r?.Name || '',
    country: row.Country__c || '',
    priority: row.Priority__c == null ? null : Number(row.Priority__c),
    lastModifiedAt: row.LastModifiedDate || null,
  };
}

export async function listSpecialTerms({ force = false, scope = null } = {}) {
  const schema = await resolveSpecialTermsSchema({ force });
  const scopedAccountIds = [...new Set((scope?.accountIds || []).map((value) => text(value)).filter(isSalesforceRecordId))].sort();
  const scopedPortIds = [...new Set((scope?.portIds || []).map((value) => text(value)).filter(isSalesforceRecordId))].sort();
  const scopedProductIds = [...new Set((scope?.productIds || []).map((value) => text(value)).filter(isSalesforceRecordId))].sort();
  const scopedCountries = [...new Set((scope?.countries || []).map((value) => text(value, 100)).filter(Boolean))].sort();
  const scopedAudience = ['Buyer', 'Supplier'].includes(scope?.audience) ? scope.audience : null;
  const isScoped = Boolean(scope);
  const scopePayload = isScoped ? {
    accountIds: scopedAccountIds,
    portIds: scopedPortIds,
    productIds: scopedProductIds,
    countries: scopedCountries,
    audience: scopedAudience,
  } : null;
  const cached = await getOrLoadRuntimeCache({
    namespace: 'salesforce-special-terms',
    version: '1',
    accessScope: 'global',
    apiVersion: `${getApiVersion()}@${getInstanceUrl()}`,
    payload: { view: isScoped ? 'applicable-scope' : 'workspace', scope: scopePayload },
    ttlSeconds: 60,
    tags: ['salesforce:special-terms'],
    force,
    loader: async () => {
      const ruleConditions = [];
      if (isScoped) {
        ruleConditions.push(scopedAudience ? `Supplier_Buyer__c = '${soql(scopedAudience)}'` : null);
        ruleConditions.push(scopedAccountIds.length ? `(Account__c = null OR Account__c IN (${scopedAccountIds.map((id) => `'${soql(id)}'`).join(',')}))` : 'Account__c = null');
        ruleConditions.push(scopedPortIds.length ? `(Port__c = null OR Port__c IN (${scopedPortIds.map((id) => `'${soql(id)}'`).join(',')}))` : 'Port__c = null');
        ruleConditions.push(scopedProductIds.length ? `(Product__c = null OR Product__c IN (${scopedProductIds.map((id) => `'${soql(id)}'`).join(',')}))` : 'Product__c = null');
        ruleConditions.push(scopedCountries.length ? `(Country__c = null OR Country__c IN (${scopedCountries.map((country) => `'${soql(country)}'`).join(',')}))` : 'Country__c = null');
      }
      const ruleResult = await sfQuery(`SELECT Id,Name,Special_Term__c,Special_Term__r.Name,Account__c,Account__r.Name,Account__r.Company_Code__c,Port__c,Port__r.Name,Port__r.Country__c,Product__c,Product__r.Name,Country__c,Supplier_Buyer__c,Priority__c,LastModifiedDate FROM Special_Term_Rule__c${ruleConditions.filter(Boolean).length ? ` WHERE ${ruleConditions.filter(Boolean).join(' AND ')}` : ''} ORDER BY Priority__c,Name LIMIT 10000`, { clean: true, limit: 10000 });
      const termIds = [...new Set(ruleResult.records.map((rule) => rule.Special_Term__c).filter(isSalesforceRecordId))];
      const termWhere = isScoped
        ? (termIds.length ? ` WHERE Id IN (${termIds.map((id) => `'${soql(id)}'`).join(',')})` : ' WHERE Id = null')
        : '';
      const termResult = await sfQuery(`SELECT Id,Name,Terms_Text__c,Add_to_Confirmation__c,Add_to_Nomination__c,Special_Remark_in_Confirmation__c,Special_Remark_in_Nomination__c,Approval_Status__c,Current_Revision__c,Clause_Structure_Status__c,Clause_Compiled_Hash__c,Original_Terms_Text__c,Clause_Migration_Batch_Id__c,Confirmation_Clause_Status__c,Confirmation_Clause_Style__c,Confirmation_Compiled_Hash__c,Original_Confirmation_Remark__c,Confirmation_Migration_Batch_Id__c,Nomination_Clause_Status__c,Nomination_Clause_Style__c,Nomination_Compiled_Hash__c,Original_Nomination_Remark__c,Nomination_Migration_Batch_Id__c,LastModifiedDate FROM Special_Term__c${termWhere} ORDER BY Name LIMIT 5000`, { clean: true, limit: 5000 });
      const loadedTermIds = termResult.records.map((term) => term.Id).filter(isSalesforceRecordId);
      const assignmentResult = loadedTermIds.length
        ? await sfQuery(`SELECT Special_Term__c,Projection__c,State__c,Clause__c,Clause_Version__r.Revision_Number__c,Clause__r.Latest_Approved_Version_Number__c FROM Special_Term_Clause_Assignment__c WHERE Special_Term__c IN (${loadedTermIds.map((id) => `'${soql(id)}'`).join(',')}) LIMIT 10000`, { clean: true, limit: 10000 })
        : { records: [], totalSize: 0 };
      const consolidationResult = await sfQuery(`SELECT Id,Source_Clause__c FROM ${OBJECTS.clauseConsolidation} WHERE Status__c IN ('Relinking','Paused','Ready to Retire') LIMIT 5000`, { clean: true, limit: 5000 });
      const consolidatingClauseIds = new Set(consolidationResult.records.map((row) => row.Source_Clause__c));
      const revisionRelinkResult = loadedTermIds.length && consolidatingClauseIds.size
        ? await sfQuery(`SELECT Id,Special_Term_Revision__r.Special_Term__c,Clause__c FROM ${OBJECTS.revisionClause} WHERE Special_Term_Revision__r.Special_Term__c IN (${loadedTermIds.map((id) => `'${soql(id)}'`).join(',')}) AND Special_Term_Revision__r.Status__c IN ('Draft','In Review') AND Clause__c IN (${[...consolidatingClauseIds].map((id) => `'${soql(id)}'`).join(',')}) LIMIT 10000`, { clean: true, limit: 10000 })
        : { records: [], totalSize: 0 };
      if (termResult.totalSize > termResult.records.length || ruleResult.totalSize > ruleResult.records.length || assignmentResult.totalSize > assignmentResult.records.length || consolidationResult.totalSize > consolidationResult.records.length || revisionRelinkResult.totalSize > revisionRelinkResult.records.length) throw specialTermsError('Special Terms exceeds the current safe result limit.', 503, 'SPECIAL_TERMS_RESULT_LIMIT');
      const summaries = new Map();
      for (const assignment of assignmentResult.records) {
        const summary = summaries.get(assignment.Special_Term__c) || { activeClauseCount: 0, proposedClauseCount: 0, upgradeCount: 0, confirmationActiveClauseCount: 0, confirmationProposedClauseCount: 0, confirmationUpgradeCount: 0, nominationActiveClauseCount: 0, nominationProposedClauseCount: 0, nominationUpgradeCount: 0, relinkRequiredCount: 0, relinkClauseIds: new Set() };
        const prefix = assignment.Projection__c === 'Confirmation Remark' ? 'confirmation' : assignment.Projection__c === 'Nomination Remark' ? 'nomination' : '';
        const activeKey = prefix ? `${prefix}ActiveClauseCount` : 'activeClauseCount';
        const proposedKey = prefix ? `${prefix}ProposedClauseCount` : 'proposedClauseCount';
        const upgradeKey = prefix ? `${prefix}UpgradeCount` : 'upgradeCount';
        if (assignment.State__c === 'Active') {
          summary[activeKey] += 1;
          if (consolidatingClauseIds.has(assignment.Clause__c)) summary.relinkClauseIds.add(assignment.Clause__c);
          if (Number(assignment.Clause__r?.Latest_Approved_Version_Number__c || 0) > Number(assignment.Clause_Version__r?.Revision_Number__c || 0)) summary[upgradeKey] += 1;
        } else if (assignment.State__c === 'Proposed') summary[proposedKey] += 1;
        summary.relinkRequiredCount = summary.relinkClauseIds.size;
        summaries.set(assignment.Special_Term__c, summary);
      }
      for (const revisionClause of revisionRelinkResult.records) {
        const termId = revisionClause.Special_Term_Revision__r?.Special_Term__c;
        if (!termId) continue;
        const summary = summaries.get(termId) || { activeClauseCount: 0, proposedClauseCount: 0, upgradeCount: 0, confirmationActiveClauseCount: 0, confirmationProposedClauseCount: 0, confirmationUpgradeCount: 0, nominationActiveClauseCount: 0, nominationProposedClauseCount: 0, nominationUpgradeCount: 0, relinkRequiredCount: 0, relinkClauseIds: new Set() };
        summary.relinkClauseIds.add(revisionClause.Clause__c);
        summary.relinkRequiredCount = summary.relinkClauseIds.size;
        summaries.set(termId, summary);
      }
      return { terms: termResult.records.map((term) => mapTerm({ ...term, ...(summaries.get(term.Id) || {}) })), rules: ruleResult.records.map(mapRule), fetchedAt: new Date().toISOString(), instanceUrl: getInstanceUrl() };
    },
  });
  return {
    ...cached.value,
    countryOptions: schema.countryOptions,
    audienceOptions: schema.audienceOptions,
    clauseCategoryOptions: schema.clauseCategoryOptions,
    cacheStatus: cached.cacheStatus || cached.status || null,
  };
}

export async function getSpecialTermForExport(termId, { force = false } = {}) {
  return getSpecialTermDocumentForExport(termId, { force, source: 'live' });
}

function documentSource(value) {
  const source = text(value, 20) || 'live';
  if (!['live', 'draft'].includes(source)) throw specialTermsError('Document source must be live or draft.', 400, 'SPECIAL_TERMS_DOCUMENT_SOURCE_INVALID');
  return source;
}

function assertDocumentCurrent(record, expectedLastModifiedAt, label = 'Special Term') {
  if (expectedLastModifiedAt && record.LastModifiedDate !== expectedLastModifiedAt) {
    throw specialTermsError(`${label} changed after it was opened. Refresh before exporting.`, 409, 'SPECIAL_TERMS_STALE', { currentLastModifiedAt: record.LastModifiedDate });
  }
}

export function compiledTermsText(rows, { historical = false } = {}) {
  const ordered = [...rows].sort((left, right) => Number(left.Sequence__c || 0) - Number(right.Sequence__c || 0) || String(left.Id).localeCompare(String(right.Id)));
  const allowedClauseStatuses = historical ? ['Active', 'Retired'] : ['Active'];
  if (ordered.some((row, index) => Number(row.Sequence__c) !== index + 1
    || !row.Clause__c
    || row.Clause__c !== row.Clause_Version__r?.Clause__c
    || !allowedClauseStatuses.includes(row.Clause__r?.Status__c)
    || !['Approved', 'Superseded'].includes(row.Clause_Version__r?.Status__c)
    || !row.Clause_Version__r?.Clause_Text__c)) {
    throw specialTermsError('The structured Special Term contains a non-approved clause version and cannot be exported.', 409, 'SPECIAL_TERMS_DOCUMENT_CLAUSE_UNAPPROVED');
  }
  try { return compileNumberedClauses(ordered.map((row) => row.Clause_Version__r.Clause_Text__c)); } catch {
    throw specialTermsError('The structured Special Term contains invalid clause wording and cannot be exported.', 409, 'SPECIAL_TERMS_DOCUMENT_COMPILATION_INVALID');
  }
}

/** Re-reads Salesforce immediately before document generation. Structured terms
 * are never exported from a cache or a caller-supplied clause list. */
export async function getSpecialTermDocumentForExport(termId, {
  force = true,
  source = 'live',
  revisionId = null,
  expectedLastModifiedAt = null,
  expectedRevisionLastModifiedAt = null,
} = {}) {
  await resolveSpecialTermsSchema({ force });
  const id = salesforceId(termId, 'Special Term');
  const selectedSource = documentSource(source);
  const termResult = await sfQuery(`SELECT Id,Name,Terms_Text__c,Clause_Structure_Status__c,Clause_Compiled_Hash__c,LastModifiedDate FROM Special_Term__c WHERE Id = '${soql(id)}' LIMIT 1`, { clean: true, limit: 1 });
  const term = termResult.records[0];
  if (!term) throw specialTermsError('The selected Special Term is no longer available.', 409, 'SPECIAL_TERMS_STALE');
  assertDocumentCurrent(term, expectedLastModifiedAt);

  if (selectedSource === 'live') {
    const output = { ...mapTerm(term), source: 'live', clauses: [] };
    if (term.Clause_Structure_Status__c !== 'Active') return output;
    const assignmentResult = await sfQuery(`SELECT Id,Sequence__c,Clause__c,Clause__r.Status__c,Clause_Version__r.Clause__c,Clause_Version__r.Status__c,Clause_Version__r.Clause_Text__c FROM Special_Term_Clause_Assignment__c WHERE Special_Term__c = '${soql(id)}' AND Projection__c = 'Terms Text' AND State__c = 'Active' ORDER BY Sequence__c,Id LIMIT 500`, { clean: true, limit: 500 });
    const compiled = compiledTermsText(assignmentResult.records, { historical: true });
    if (!term.Clause_Compiled_Hash__c || compiled !== (term.Terms_Text__c || '') || term.Clause_Compiled_Hash__c !== clauseHash(compiled)) {
      throw specialTermsError('The live Special Term text no longer matches its approved clause assignments. Refresh and resolve the Salesforce conflict before exporting.', 409, 'SPECIAL_TERMS_DOCUMENT_COMPILATION_MISMATCH');
    }
    return { ...output, termsText: compiled, clauses: assignmentResult.records.map((row) => ({ text: row.Clause_Version__r.Clause_Text__c })) };
  }

  const resolvedRevisionId = salesforceId(revisionId, 'Special Term revision');
  const revisionResult = await sfQuery(`SELECT Id,Special_Term__c,Status__c,LastModifiedDate FROM Special_Term_Revision__c WHERE Id = '${soql(resolvedRevisionId)}' AND Special_Term__c = '${soql(id)}' LIMIT 1`, { clean: true, limit: 1 });
  const revision = revisionResult.records[0];
  if (!revision || !['Draft', 'In Review'].includes(revision.Status__c)) throw specialTermsError('The saved draft revision is no longer available for preview export.', 409, 'SPECIAL_TERMS_DOCUMENT_DRAFT_STALE');
  assertDocumentCurrent(revision, expectedRevisionLastModifiedAt, 'Special Term draft');
  const revisionClauses = await sfQuery(`SELECT Id,Sequence__c,Clause__c,Clause__r.Status__c,Clause_Version__r.Clause__c,Clause_Version__r.Status__c,Clause_Version__r.Clause_Text__c FROM Special_Term_Revision_Clause__c WHERE Special_Term_Revision__c = '${soql(resolvedRevisionId)}' AND Projection__c = 'Terms Text' AND State__c = 'Proposed' ORDER BY Sequence__c,Id LIMIT 500`, { clean: true, limit: 500 });
  const compiled = compiledTermsText(revisionClauses.records);
  return { ...mapTerm(term), source: 'draft', revisionId: revision.Id, revisionLastModifiedAt: revision.LastModifiedDate, termsText: compiled, clauses: revisionClauses.records.map((row) => ({ text: row.Clause_Version__r.Clause_Text__c })) };
}

export async function specialTermOptions({ kind, query = '' } = {}) {
  const schema = await resolveSpecialTermsSchema();
  const search = text(query, 100);
  if (search.length < 2) return [];
  const like = `%${soql(search)}%`;
  if (kind === 'account') {
    const result = await sfQuery(`SELECT Id,Name,Company_Code__c FROM Account WHERE Inactive_Suspended__c = false AND (Name LIKE '${like}' OR Company_Code__c LIKE '${like}') ORDER BY Name LIMIT 30`, { clean: true, limit: 30 });
    return result.records.map((row) => ({ id: row.Id, label: row.Name, secondary: row.Company_Code__c || 'No CL Key' }));
  }
  if (kind === 'port') {
    const result = await sfQuery(`SELECT Id,Name,Country__c,Offshore__c FROM Port__c WHERE Name LIKE '${like}' ORDER BY Name LIMIT 30`, { clean: true, limit: 30 });
    return result.records.map((row) => ({ id: row.Id, label: row.Name, secondary: [row.Country__c, row.Offshore__c ? 'Offshore' : null].filter(Boolean).join(' · ') }));
  }
  if (kind === 'product') {
    const result = await sfQuery(`SELECT Id,Name,Family FROM Product2 WHERE IsActive = true AND Name LIKE '${like}' ORDER BY Name LIMIT 30`, { clean: true, limit: 30 });
    return result.records.map((row) => ({ id: row.Id, label: row.Name, secondary: row.Family || '' }));
  }
  void schema;
  throw specialTermsError('Unknown Special Terms option type.');
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export async function reserveOperation(client, profile, body, operationType, payload) {
  if (!OPERATION_TYPES.has(operationType)) throw specialTermsError('Unknown Special Terms operation.');
  const operationId = text(body.operationId, 100);
  if (!operationId) throw specialTermsError('An operation ID is required.');
  const requestHash = createHash('sha256').update(stableJson({ operationType, payload })).digest('hex');
  // The production migration exposes this as one security-invoker transaction. Keep
  // the narrow table fallback for local/test clients that predate the migration.
  if (typeof client.rpc === 'function') {
    const rpc = await client.rpc('reserve_special_terms_operation', {
      p_operation_id: operationId,
      p_operation_type: operationType,
      p_request_hash: requestHash,
      p_salesforce_object: OPERATION_OBJECTS[operationType],
      p_salesforce_record_id: payload.id || null,
      p_actor_user_id: profile.id,
      p_actor_email: profile.email || null,
    });
    if (!rpc.error) {
      const row = rpc.data;
      if (row?.replay === true) return { replay: row.result_snapshot || {} };
      if (row?.operation) return { operation: row.operation };
      if (row?.id) return { operation: row };
      throw specialTermsError('Special Terms operation could not be reserved.', 502, 'SPECIAL_TERMS_OPERATION_RESERVATION_FAILED');
    }
    if (rpc.error.code !== '42883' && rpc.error.code !== '42P01') throw specialTermsError(`Special Terms operation could not be reserved: ${rpc.error.message}`, 502);
  }
  const existing = await client.from('special_terms_operations').select('*').eq('operation_id', operationId).maybeSingle();
  if (existing.error) throw specialTermsError(`Special Terms operation could not be checked: ${existing.error.message}`, 502);
  const resolveExisting = (row) => {
    if (row.request_hash !== requestHash) throw specialTermsError('This operation ID was already used for different data.', 409);
    if (row.operation_status === 'succeeded') return { replay: row.result_snapshot };
    if (['pending', 'uncertain'].includes(row.operation_status)) throw specialTermsError('This operation is already processing or requires review.', 409);
    return null;
  };
  if (existing.data) {
    const resolved = resolveExisting(existing.data);
    if (resolved) return resolved;
  }
  // Contractual text and reviewer rationale remain in Salesforce. Supabase retains
  // operation identity/status only, never a recoverable contractual narrative.
  const row = { operation_id: operationId, operation_type: operationType, request_hash: requestHash, operation_status: 'pending', salesforce_object: OPERATION_OBJECTS[operationType], salesforce_record_id: payload.id || null, audit_reason: null, actor_user_id: profile.id, actor_email: profile.email, error_code: null, error_message: null, result_snapshot: {}, updated_at: new Date().toISOString(), completed_at: null };
  const result = existing.data ? await client.from('special_terms_operations').update(row).eq('id', existing.data.id).select('*').single() : await client.from('special_terms_operations').insert(row).select('*').single();
  if (result.error?.code === '23505') {
    const raced = await client.from('special_terms_operations').select('*').eq('operation_id', operationId).maybeSingle();
    if (raced.error || !raced.data) throw specialTermsError(`Special Terms operation could not be reserved: ${raced.error?.message || result.error.message}`, 502);
    const resolved = resolveExisting(raced.data);
    if (resolved) return resolved;
  }
  if (result.error) throw specialTermsError(`Special Terms operation could not be reserved: ${result.error.message}`, 502);
  return { operation: result.data };
}

export async function finishOperation(client, operation, result, persistedResult = result) {
  const completedAt = new Date().toISOString();
  if (typeof client.rpc === 'function') {
    const rpc = await client.rpc('complete_special_terms_operation', {
      p_operation_id: operation.operation_id,
      p_operation_status: 'succeeded',
      p_result_snapshot: persistedResult,
      p_error_code: null,
      p_error_message: null,
    });
    if (!rpc.error) {
      await expireRuntimeCacheTags(['salesforce:special-terms', 'salesforce:special-terms:clauses', 'salesforce:schema']);
      return result;
    }
    if (rpc.error.code !== '42883' && rpc.error.code !== '42P01') throw specialTermsError(`Special Terms operation could not be completed: ${rpc.error.message}`, 502);
  }
  await client.from('special_terms_operations').update({ operation_status: 'succeeded', result_snapshot: persistedResult, updated_at: completedAt, completed_at: completedAt }).eq('id', operation.id);
  await expireRuntimeCacheTags(['salesforce:special-terms', 'salesforce:special-terms:clauses', 'salesforce:schema']);
  return result;
}

export async function failOperation(client, operation, error) {
  const uncertain = /timeout|network|fetch failed/i.test(String(error?.message || ''));
  const completedAt = new Date().toISOString();
  const safeCode = text(error?.code || 'SPECIAL_TERMS_WRITE_FAILED', 100);
  // Salesforce may include field values in error messages. The service-only
  // ledger intentionally retains a stable, non-contractual diagnostic only.
  const safeMessage = uncertain ? 'Salesforce completion could not be confirmed.' : 'Salesforce rejected the Special Terms operation.';
  if (typeof client.rpc === 'function') {
    const rpc = await client.rpc('complete_special_terms_operation', {
      p_operation_id: operation.operation_id,
      p_operation_status: uncertain ? 'uncertain' : 'failed',
      p_result_snapshot: {},
      p_error_code: safeCode,
      p_error_message: safeMessage,
    });
    if (!rpc.error) throw error;
    if (rpc.error.code !== '42883' && rpc.error.code !== '42P01') throw specialTermsError(`Special Terms operation could not be completed: ${rpc.error.message}`, 502);
  }
  await client.from('special_terms_operations').update({ operation_status: uncertain ? 'uncertain' : 'failed', error_code: safeCode, error_message: safeMessage, updated_at: completedAt, completed_at: completedAt }).eq('id', operation.id);
  throw error;
}

export async function currentRecord(objectName, id, fields) {
  const result = await sfQuery(`SELECT ${fields.join(',')} FROM ${objectName} WHERE Id = '${soql(id)}' LIMIT 1`, { clean: true, limit: 1 });
  if (!result.records[0]) throw specialTermsError('The Salesforce record no longer exists.', 409, 'SPECIAL_TERMS_STALE');
  return result.records[0];
}

export function assertCurrent(record, expectedLastModifiedAt) {
  if (!expectedLastModifiedAt || record.LastModifiedDate !== expectedLastModifiedAt) throw specialTermsError('This Salesforce record changed after it was opened. Refresh before saving.', 409, 'SPECIAL_TERMS_STALE', { currentLastModifiedAt: record.LastModifiedDate });
}

export function termMetadataPayload(body, { create = false } = {}) {
  const name = text(body.name, 80);
  if (name.length < 2) throw specialTermsError('Special Term name must contain at least two characters.');
  const payload = {
    Name: name,
    Add_to_Confirmation__c: body.addToConfirmation === true,
    Add_to_Nomination__c: body.addToNomination === true,
  };
  if (create) {
    payload.Terms_Text__c = null;
    payload.Approval_Status__c = 'Draft';
    payload.Clause_Structure_Status__c = 'Legacy';
    payload.Clause_Compiled_Hash__c = null;
    payload.Confirmation_Clause_Status__c = 'Legacy';
    payload.Confirmation_Clause_Style__c = 'Hyphen';
    payload.Nomination_Clause_Status__c = 'Legacy';
    payload.Nomination_Clause_Style__c = 'Hyphen';
  }
  return payload;
}

export function rulePayload(body, schema) {
  const audience = text(body.audience, 20);
  if (!schema.audienceOptions.some((option) => option.value === audience)) throw specialTermsError('Select Buyer or Supplier for the rule audience.');
  const payload = {
    Special_Term__c: salesforceId(body.specialTermId, 'Special Term'),
    Supplier_Buyer__c: audience,
    Account__c: body.accountId ? salesforceId(body.accountId, 'Account') : null,
    Port__c: body.portId ? salesforceId(body.portId, 'Port') : null,
    Product__c: body.productId ? salesforceId(body.productId, 'Product') : null,
    Country__c: text(body.country, 100) || null,
  };
  if (payload.Country__c && !schema.countryOptions.some((option) => option.value === payload.Country__c)) throw specialTermsError('The selected country is not an active Salesforce picklist value.');
  if (![payload.Account__c, payload.Port__c, payload.Product__c, payload.Country__c].some(Boolean)) throw specialTermsError('A rule requires at least one Account, Port, Product, or Country condition.');
  return payload;
}

export async function validateRuleLookups(payload) {
  const [, accountResult, , productResult] = await Promise.all([
    currentRecord(OBJECTS.term, payload.Special_Term__c, ['Id']),
    payload.Account__c ? sfQuery(`SELECT Id FROM Account WHERE Id = '${soql(payload.Account__c)}' AND Inactive_Suspended__c = false LIMIT 1`, { clean: true, limit: 1 }) : null,
    payload.Port__c ? currentRecord(OBJECTS.port, payload.Port__c, ['Id']) : null,
    payload.Product__c ? sfQuery(`SELECT Id FROM Product2 WHERE Id = '${soql(payload.Product__c)}' AND IsActive = true LIMIT 1`, { clean: true, limit: 1 }) : null,
  ]);
  if (payload.Account__c && !accountResult?.records?.[0]) throw specialTermsError('The selected Account is inactive or unavailable.');
  if (payload.Product__c && !productResult?.records?.[0]) throw specialTermsError('The selected Product is inactive or unavailable.');
}

export async function saveSpecialTerm(client, profile, body = {}) {
  await resolveSpecialTermsSchema({ force: true, write: true });
  const id = body.id ? salesforceId(body.id, 'Special Term') : null;
  const payload = termMetadataPayload(body, { create: !id });
  const operationType = id ? 'term_update' : 'term_create';
  const reservation = await reserveOperation(client, profile, body, operationType, { id, payload, expectedLastModifiedAt: body.expectedLastModifiedAt || null });
  if (reservation.replay) return { ...reservation.replay, idempotencyReplayed: true };
  try {
    let recordId = id;
    if (id) {
      assertCurrent(await currentRecord(OBJECTS.term, id, ['Id', 'LastModifiedDate']), body.expectedLastModifiedAt);
      await sfRequest(`/sobjects/${OBJECTS.term}/${id}`, { method: 'PATCH', body: payload });
    } else {
      const created = await sfRequest(`/sobjects/${OBJECTS.term}`, { method: 'POST', body: payload });
      recordId = salesforceId(created?.id, 'Created Special Term');
    }
    return finishOperation(client, reservation.operation, { success: true, id: recordId });
  } catch (error) {
    return failOperation(client, reservation.operation, error);
  }
}

export async function deleteSpecialTerm(client, profile, body = {}) {
  await resolveSpecialTermsSchema({ force: true, write: true });
  const id = salesforceId(body.id, 'Special Term');
  if (text(body.auditReason, 500).length < 3) throw specialTermsError('A deletion reason is required.');
  const reservation = await reserveOperation(client, profile, body, 'term_delete', { id, expectedLastModifiedAt: body.expectedLastModifiedAt });
  if (reservation.replay) return { ...reservation.replay, idempotencyReplayed: true };
  try {
    const current = await currentRecord(OBJECTS.term, id, ['Id', 'Name', 'Approval_Status__c', 'Current_Revision__c', 'LastModifiedDate']);
    assertCurrent(current, body.expectedLastModifiedAt);
    if (current.Approval_Status__c === 'Approved' || current.Current_Revision__c) {
      throw specialTermsError('Approved or revision-controlled Special Terms must be retired through the governed lifecycle and cannot be deleted.', 409, 'SPECIAL_TERMS_RETIRE_REQUIRED');
    }
    if (text(body.confirmationName, 80) !== current.Name) throw specialTermsError(`Type ${current.Name} to confirm deletion.`);
    const linked = await sfQuery(`SELECT Id FROM ${OBJECTS.rule} WHERE Special_Term__c = '${soql(id)}' ORDER BY Id LIMIT 4800`, { clean: true, limit: 4800 });
    if (linked.totalSize > linked.records.length) throw specialTermsError('This term has too many linked rules for one atomic deletion.', 409);
    const ruleChunks = [];
    for (let index = 0; index < linked.records.length; index += 200) ruleChunks.push(linked.records.slice(index, index + 200));
    const requests = [
      ...ruleChunks.map((rules, index) => ({
        method: 'DELETE',
        url: `/services/data/${getApiVersion()}/composite/sobjects?ids=${rules.map((rule) => rule.Id).join(',')}&allOrNone=true`,
        referenceId: `ruleBatch${index}`,
      })),
      { method: 'DELETE', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.term}/${id}`, referenceId: 'term' },
    ];
    const result = await sfRequest('/composite', { method: 'POST', body: { allOrNone: true, compositeRequest: requests } });
    const failure = (result.compositeResponse || []).find((response) => response.httpStatusCode < 200 || response.httpStatusCode >= 300);
    if (failure) throw specialTermsError(failure.body?.[0]?.message || 'Salesforce rejected Special Term deletion.', failure.httpStatusCode || 502);
    return finishOperation(client, reservation.operation, { success: true, id, deletedRuleCount: linked.records.length });
  } catch (error) {
    return failOperation(client, reservation.operation, error);
  }
}

export async function saveSpecialTermRule(client, profile, body = {}) {
  const schema = await resolveSpecialTermsSchema({ force: true, write: true });
  const id = body.id ? salesforceId(body.id, 'Special Term Rule') : null;
  const payload = rulePayload(body, schema);
  await validateRuleLookups(payload);
  const operationType = id ? 'rule_update' : 'rule_create';
  const reservation = await reserveOperation(client, profile, body, operationType, { id, payload, expectedLastModifiedAt: body.expectedLastModifiedAt || null });
  if (reservation.replay) return { ...reservation.replay, idempotencyReplayed: true };
  try {
    let recordId = id;
    if (id) {
      const currentRule = await currentRecord(OBJECTS.rule, id, ['Id', 'Special_Term__c', 'Special_Term__r.Approval_Status__c', 'LastModifiedDate']);
      assertCurrent(currentRule, body.expectedLastModifiedAt);
      if (currentRule.Special_Term__r?.Approval_Status__c === 'Approved') throw specialTermsError('Rules for an approved Special Term must be changed through a whole-term revision.', 409, 'SPECIAL_TERMS_REVISION_REQUIRED');
      if (payload.Special_Term__c !== currentRule.Special_Term__c) {
        const selectedTerm = await currentRecord(OBJECTS.term, payload.Special_Term__c, ['Id', 'Approval_Status__c']);
        if (selectedTerm.Approval_Status__c === 'Approved') throw specialTermsError('Rules for an approved Special Term must be changed through a whole-term revision.', 409, 'SPECIAL_TERMS_REVISION_REQUIRED');
      }
      // Salesforce computes Priority__c only on insert. Replace the rule atomically so
      // Salesforce remains the sole owner of that calculation after an FCOS edit.
      const result = await sfRequest('/composite', {
        method: 'POST',
        body: {
          allOrNone: true,
          compositeRequest: [
            { method: 'DELETE', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.rule}/${id}`, referenceId: 'oldRule' },
            { method: 'POST', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.rule}`, referenceId: 'newRule', body: payload },
          ],
        },
      });
      const responses = result.compositeResponse || [];
      const failure = responses.find((response) => response.httpStatusCode < 200 || response.httpStatusCode >= 300);
      if (failure) throw specialTermsError(failure.body?.[0]?.message || 'Salesforce rejected the Special Term rule edit.', failure.httpStatusCode || 502);
      recordId = salesforceId(responses.find((response) => response.referenceId === 'newRule')?.body?.id, 'Updated Special Term Rule');
    } else {
      const selectedTerm = await currentRecord(OBJECTS.term, payload.Special_Term__c, ['Id', 'Approval_Status__c']);
      if (selectedTerm.Approval_Status__c === 'Approved') throw specialTermsError('Rules for an approved Special Term must be changed through a whole-term revision.', 409, 'SPECIAL_TERMS_REVISION_REQUIRED');
      const created = await sfRequest(`/sobjects/${OBJECTS.rule}`, { method: 'POST', body: payload });
      recordId = salesforceId(created?.id, 'Created Special Term Rule');
    }
    return finishOperation(client, reservation.operation, { success: true, id: recordId, replacedId: id && recordId !== id ? id : null });
  } catch (error) {
    return failOperation(client, reservation.operation, error);
  }
}

export async function deleteSpecialTermRule(client, profile, body = {}) {
  await resolveSpecialTermsSchema({ force: true, write: true });
  const id = salesforceId(body.id, 'Special Term Rule');
  if (text(body.auditReason, 500).length < 3) throw specialTermsError('A deletion reason is required.');
  const reservation = await reserveOperation(client, profile, body, 'rule_delete', { id, expectedLastModifiedAt: body.expectedLastModifiedAt });
  if (reservation.replay) return { ...reservation.replay, idempotencyReplayed: true };
  try {
    const currentRule = await currentRecord(OBJECTS.rule, id, ['Id', 'Special_Term__r.Approval_Status__c', 'LastModifiedDate']);
    assertCurrent(currentRule, body.expectedLastModifiedAt);
    if (currentRule.Special_Term__r?.Approval_Status__c === 'Approved') throw specialTermsError('Rules for an approved Special Term must be changed through a whole-term revision.', 409, 'SPECIAL_TERMS_REVISION_REQUIRED');
    await sfRequest(`/sobjects/${OBJECTS.rule}/${id}`, { method: 'DELETE' });
    return finishOperation(client, reservation.operation, { success: true, id });
  } catch (error) {
    return failOperation(client, reservation.operation, error);
  }
}
