export const EXCEPTION_REVIEW_WORKFLOW_BATCH_SIZE = 500;

const salesforceId = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// The primary scan can contain 3,000 STEMs, while the workflow endpoint accepts
// at most 500 per read. Publish one complete result, never a partial batch map.
export async function readExceptionReviewWorkflow(stemIds, { invoke, isCurrent = () => true }) {
  const ids = [...new Set(stemIds.filter(id => typeof id === 'string')
    .map(id => id.trim()).filter(id => salesforceId.test(id)))];
  const batches = ids.length
    ? Array.from({ length: Math.ceil(ids.length / EXCEPTION_REVIEW_WORKFLOW_BATCH_SIZE) }, (_, index) =>
      ids.slice(index * EXCEPTION_REVIEW_WORKFLOW_BATCH_SIZE, (index + 1) * EXCEPTION_REVIEW_WORKFLOW_BATCH_SIZE))
    : [[]]; // An empty scan still needs the active owner directory.
  const byStemId = {};
  const owners = new Map();

  for (const batch of batches) {
    if (!isCurrent()) return null;
    const response = await invoke('exceptionReviewWorkflowList', { stemIds: batch }, { cache: false });
    if (!isCurrent()) return null;
    const data = response?.data;
    if (data?.error) throw new Error(data.error);
    if (!record(data?.byStemId) || !Array.isArray(data?.ownerOptions)) {
      throw new Error('Exception workflow data could not be loaded.');
    }
    const requested = new Set(batch);
    for (const [id, workflow] of Object.entries(data.byStemId)) {
      if (!requested.has(id) || !record(workflow)) throw new Error('Exception workflow data could not be loaded.');
      byStemId[id] = workflow;
    }
    for (const owner of data.ownerOptions) {
      if (!record(owner) || typeof owner.id !== 'string' || !owner.id.trim()) {
        throw new Error('Exception workflow owners could not be loaded.');
      }
      owners.set(owner.id, owner);
    }
  }
  return { byStemId, ownerOptions: [...owners.values()] };
}
