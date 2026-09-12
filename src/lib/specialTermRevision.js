export const SPECIAL_TERM_REVISION_PROJECTIONS = Object.freeze(['termsText', 'confirmationRemark', 'nominationRemark']);

const SALESFORCE_ID = /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/;

function clean(value) {
  return String(value ?? '').trim();
}

function projectionAssignments(projection = {}) {
  return projection.assignments || projection.draftAssignments || projection.rows || projection.activeAssignments || [];
}

function ruleSource(rule = {}) {
  const hasExplicitSource = Object.hasOwn(rule, 'sourceRuleId');
  const fallbackId = clean(rule.id);
  const sourceRuleId = hasExplicitSource
    ? clean(rule.sourceRuleId) || null
    : clean(rule.ruleId) || (!fallbackId.startsWith('draft:') ? fallbackId : '') || null;
  const lastModifiedAt = hasExplicitSource
    ? clean(rule.sourceLastModifiedAt) || null
    : clean(rule.sourceLastModifiedAt) || clean(rule.lastModifiedAt) || null;
  return { sourceRuleId, lastModifiedAt };
}

function nestedId(value, nested) {
  return clean(value) || clean(nested?.id) || null;
}

function normalizedRule(rule = {}) {
  const source = ruleSource(rule);
  return {
    ...source,
    audience: clean(rule.audience) || null,
    accountId: nestedId(rule.accountId, rule.account),
    portId: nestedId(rule.portId, rule.port),
    productId: nestedId(rule.productId, rule.product),
    country: clean(rule.country) && clean(rule.country) !== '__any__' ? clean(rule.country) : null,
  };
}

function optionValues(options) {
  return new Set((options || []).map((option) => clean(option?.value ?? option)).filter(Boolean));
}

export function revisionFromDetail(detail) {
  const revision = detail?.revision || detail?.currentRevision || null;
  if (!revision) return null;
  return {
    ...revision,
    projections: revision.projections || detail?.projections || {},
    rules: revision.id ? revision.rules || [] : detail?.rules || [],
  };
}

export function revisionPayload(revision) {
  return {
    revisionId: revision.id || null,
    expectedLastModifiedAt: revision.termLastModifiedAt || revision.expectedLastModifiedAt || revision.lastModifiedAt || null,
    expectedRevisionLastModifiedAt: revision.id ? revision.lastModifiedAt || revision.expectedLastModifiedAt || null : null,
    projections: SPECIAL_TERM_REVISION_PROJECTIONS.map((key) => {
      const projection = revision.projections?.[key] || {};
      return {
        projection: key,
        style: projection.style,
        versionIds: projectionAssignments(projection).map((row) => row.clauseVersionId),
        versionTimestamps: Object.fromEntries(projectionAssignments(projection)
          .filter((row) => row.clauseVersionId && row.versionLastModifiedAt)
          .map((row) => [row.clauseVersionId, row.versionLastModifiedAt])),
      };
    }),
    rules: (revision.rules || []).map((rule) => normalizedRule(rule)),
  };
}

export function revisionDraftSignature(revision, reason = '') {
  return JSON.stringify({
    projections: SPECIAL_TERM_REVISION_PROJECTIONS.map((key) => {
      const projection = revision?.projections?.[key] || {};
      return {
        projection: key,
        style: clean(projection.style) || null,
        assignments: projectionAssignments(projection).map((row = {}) => {
          const clauseVersionId = clean(row.clauseVersionId || row.versionId || row.selectedClauseVersionId || row.exactMatchVersionId) || null;
          if (!row.legacyCandidate && clauseVersionId) return { clauseVersionId };
          return {
            clauseVersionId,
            clauseText: clean(row.clauseText || row.sourceClauseText || row.text),
            shortName: clean(row.shortName || row.suggestedShortName || row.name),
            category: clean(row.category || row.suggestedCategory),
          };
        }),
      };
    }),
    rules: (revision?.rules || []).map((rule) => {
      const normalized = normalizedRule(rule);
      return {
        sourceRuleId: normalized.sourceRuleId,
        audience: normalized.audience,
        accountId: normalized.accountId,
        portId: normalized.portId,
        productId: normalized.productId,
        country: normalized.country,
      };
    }),
    reason: clean(reason),
  });
}

export function revisionRuleIssues(rules, { audienceOptions = [], countryOptions = [] } = {}) {
  const requestedRules = Array.isArray(rules) ? rules : [];
  const issues = [];
  const validAudiences = optionValues(audienceOptions);
  const validCountries = optionValues(countryOptions);
  if (requestedRules.length > 100) {
    issues.push({ index: -1, field: 'rules', message: 'A Special Term revision cannot exceed 100 proposed rules.' });
  }
  requestedRules.forEach((rule, index) => {
    const normalized = normalizedRule(rule);
    if (normalized.sourceRuleId && !SALESFORCE_ID.test(normalized.sourceRuleId)) {
      issues.push({ index, field: 'sourceRuleId', message: 'Special Term rule is invalid.' });
    }
    if (!normalized.audience && !normalized.sourceRuleId) {
      issues.push({ index, field: 'audience', message: 'A new revision rule requires Buyer or Supplier.' });
    } else if (normalized.audience && validAudiences.size && !validAudiences.has(normalized.audience)) {
      issues.push({ index, field: 'audience', message: 'Select Buyer or Supplier for the rule audience.' });
    }
    if (![normalized.accountId, normalized.portId, normalized.productId, normalized.country].some(Boolean)) {
      issues.push({ index, field: 'conditions', message: 'A revision rule requires at least one Account, Port, Product, or Country condition.' });
    }
    for (const [field, label] of [['accountId', 'Account'], ['portId', 'Port'], ['productId', 'Product']]) {
      if (normalized[field] && !SALESFORCE_ID.test(normalized[field])) {
        issues.push({ index, field, message: `${label} is invalid.` });
      }
    }
    if (normalized.country && validCountries.size && !validCountries.has(normalized.country)) {
      issues.push({ index, field: 'country', message: 'The selected country is not an active Salesforce picklist value.' });
    }
  });
  return issues;
}
