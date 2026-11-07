import { digest, isDigest, requireCondition } from './contract.mjs';

export const OBSTACLE_KINDS = Object.freeze(['source_mismatch', 'stale_evidence', 'test_failure', 'build_failure',
  'provider_unavailable', 'write_uncertain', 'known_job_failed', 'authorization_required', 'credential_entry_required',
  'slow_phase', 'unknown']);
export const REPAIR_ACTIONS = Object.freeze(['refresh_read_evidence', 'reconcile_original_operation', 'resume_saved_stage',
  'repair_source', 'repair_fixture', 'reduce_duplicate_reads', 'replace_known_failed_validation']);
export function obstacle({ kind, phase, code, inputs, completedSteps = [], elapsedMs = 0, providerCalls = 0 }) {
  requireCondition(OBSTACLE_KINDS.includes(kind) && /^[a-z][a-z0-9_.-]{0,80}$/.test(phase)
    && /^[A-Z][A-Z0-9_]{0,100}$/.test(code), 'OBSTACLE_CLASSIFICATION_INVALID');
  requireCondition(inputs && ['source', 'controller', 'environment', 'tools'].every(key => isDigest(inputs[key])), 'OBSTACLE_INPUT_BINDING_REQUIRED');
  requireCondition(completedSteps.every(step => /^[a-z][a-z0-9_.-]{0,80}$/.test(step))
    && Number.isFinite(elapsedMs) && elapsedMs >= 0 && Number.isInteger(providerCalls) && providerCalls >= 0, 'OBSTACLE_METRICS_INVALID');
  return { schemaVersion: 1, signature: digest({ kind, phase, code, inputs }), kind, phase, code, inputs,
    completedSteps, elapsedMs, providerCalls };
}
export function validateRecipe(recipe) {
  requireCondition(recipe?.schemaVersion === 1 && /^[a-z][a-z0-9-]{3,80}$/.test(recipe.id)
    && ['verified', 'disabled'].includes(recipe.status) && REPAIR_ACTIONS.includes(recipe.action)
    && OBSTACLE_KINDS.includes(recipe.kind), 'REPAIR_RECIPE_INVALID');
  requireCondition(recipe.preconditions && ['source', 'controller', 'environment', 'tools'].every(key => isDigest(recipe.preconditions[key]))
    && recipe.proof?.reproduced === true && recipe.proof.regressionPassed === true
    && isDigest(recipe.proof.sourceDigest) && isDigest(recipe.proof.checkDigest), 'REPAIR_RECIPE_UNVERIFIED');
  return recipe;
}
export function applicableRecipe(registry, incident) {
  requireCondition(registry?.schemaVersion === 1 && Array.isArray(registry.recipes), 'REPAIR_REGISTRY_INVALID');
  const matching = registry.recipes.map(validateRecipe).filter(recipe => recipe.status === 'verified' && recipe.kind === incident.kind
    && Object.entries(recipe.preconditions).every(([key, value]) => incident.inputs[key] === value));
  requireCondition(matching.length <= 1, 'REPAIR_RECIPE_AMBIGUOUS'); return matching[0] || null;
}
export class ImprovementLoop {
  constructor({ journal, registry, actions = {}, now = Date.now }) { Object.assign(this, { journal, registry, actions, now }); }
  async handle(incident, { approach = 'focused-diagnosis', authority } = {}) {
    requireCondition(/^[a-z][a-z0-9-]{2,80}$/.test(approach), 'REPAIR_APPROACH_INVALID');
    const records = await this.journal.read(), events = records.map(record => record.payload);
    if (!events.some(event => event.event === 'obstacle.detected' && event.data.signature === incident.signature))
      await this.journal.append('obstacle.detected', incident);
    const attempts = events.filter(event => event.event === 'repair.attempted' && event.data.signature === incident.signature && event.data.approach === approach);
    const recovered = events.find(event => event.event === 'repair.verified' && event.data.signature === incident.signature);
    if (recovered) return { state: 'already_verified', proof: recovered.data };
    if (['authorization_required', 'credential_entry_required'].includes(incident.kind)) return { state: 'waiting_authority', checkpointPreserved: true };
    if (attempts.length >= 2) return { state: 'escalate_analysis', reason: 'same_approach_twice', checkpointPreserved: true };
    const recipe = applicableRecipe(this.registry, incident);
    const disabled = recipe && events.some(event => event.event === 'repair.disabled' && event.data.recipeId === recipe.id && event.data.signature === incident.signature);
    if (!recipe || disabled) return { state: 'supervisor_diagnosis', incident, checkpointPreserved: true };
    const action = this.actions[recipe.action];
    requireCondition(typeof action === 'function', 'TRUSTED_REPAIR_ACTION_UNAVAILABLE');
    // Authority is checked by the owner before every repair; a recipe is never a grant.
    requireCondition(typeof authority === 'function', 'REPAIR_AUTHORITY_REQUIRED'); await authority({ incident, recipe });
    await this.journal.append('repair.attempted', { signature: incident.signature, recipeId: recipe.id, approach, action: recipe.action, attempt: attempts.length + 1 });
    const started = this.now();
    try {
      const proof = await action({ incident, recipe });
      if (proof?.unresolved === true) return { state: 'awaiting_original_outcome', checkpointPreserved: true, measurement: proof.measurement };
      requireCondition(proof?.regressionPassed === true && proof?.reproduced === true && isDigest(proof.sourceDigest)
        && isDigest(proof.checkDigest) && proof.originalOperationsPreserved === true && proof.authorityExpanded === false, 'REPAIR_VERIFICATION_REQUIRED');
      const result = { signature: incident.signature, recipeId: recipe.id, approach, proof,
        repairMs: this.now() - started, before: { elapsedMs: incident.elapsedMs, providerCalls: incident.providerCalls },
        after: proof.measurement || null };
      await this.journal.append('repair.verified', result); return { state: 'resume_checkpoint', ...result };
    } catch {
      await this.journal.append('repair.disabled', { signature: incident.signature, recipeId: recipe.id, reason: 'verification_failed', repairMs: this.now() - started });
      return { state: 'supervisor_diagnosis', recipeDisabled: true, checkpointPreserved: true };
    }
  }
}
export function improvementSummary(records) {
  return records.map(record => record.payload).filter(event => event.event === 'repair.verified').map(({ data }) => ({
    obstacle: data.signature, correction: data.recipeId, verified: true, repairMs: data.repairMs,
    measuredCallsSaved: Number.isInteger(data.after?.providerCalls) ? data.before.providerCalls - data.after.providerCalls : null,
    measuredMsSaved: Number.isFinite(data.after?.elapsedMs) ? data.before.elapsedMs - data.after.elapsedMs : null,
    recurrencePrevention: 'version-bound verified recipe',
  }));
}
