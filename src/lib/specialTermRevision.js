export const SPECIAL_TERM_REVISION_PROJECTIONS = Object.freeze(['termsText', 'confirmationRemark', 'nominationRemark']);

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
    projections: SPECIAL_TERM_REVISION_PROJECTIONS.map((key) => {
      const projection = revision.projections?.[key] || {};
      return {
        projection: key,
        style: projection.style,
        versionIds: (projection.assignments || projection.draftAssignments || projection.rows || projection.activeAssignments || []).map((row) => row.clauseVersionId),
      };
    }),
    rules: (revision.rules || []).map((rule) => ({
      sourceRuleId: rule.sourceRuleId || rule.ruleId || (String(rule.id || '').startsWith('draft:') ? null : rule.id) || null,
      audience: rule.audience || null,
      accountId: rule.accountId || rule.account?.id || null,
      portId: rule.portId || rule.port?.id || null,
      productId: rule.productId || rule.product?.id || null,
      country: rule.country && rule.country !== '__any__' ? rule.country : null,
      lastModifiedAt: rule.sourceLastModifiedAt || rule.lastModifiedAt || null,
    })),
  };
}
