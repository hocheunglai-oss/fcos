/** The STEM detail interface is deliberately read-only, including legacy callers. */
export function stemReadRequestIssues(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return ['payload must be an object'];
  const issues = [];
  if (typeof body.stemId !== 'string' || !body.stemId.trim() || body.stemId.length > 80 || /[\u0000-\u001f\u007f]/.test(body.stemId)) {
    issues.push('a valid STEM identifier is required');
  }
  if (Object.keys(body).some((key) => key !== 'stemId')) {
    issues.push('STEM details are read-only; use the authorized Salesforce or FCOS workflow to make changes');
  }
  return issues;
}

export function assertStemReadRequest(body) {
  const issues = stemReadRequestIssues(body);
  if (issues.length) throw Object.assign(new Error(issues.join('; ')), {
    status: 400, code: 'STEM_DETAIL_READ_ONLY',
  });
}
