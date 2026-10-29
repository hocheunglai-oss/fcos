/** These two historical submissions remain UNKNOWN and consumed. This contract
 * identifies their effects; it never resolves them or grants provider authority. */
export const LEGACY_RELEASE_EFFECTS = Object.freeze([
  Object.freeze({importId:'exact04ee-pr114-permission-corrected-three-successor-b53f1cbd-80ca-4f28-ac48-698a21e35b29',kind:'legacy_preview_env_row'}),
  Object.freeze({importId:'production-execution-environment-d706f8b8-92c2-4f80-b85b-8724ea35e5c0',kind:'production_resume_environment_policy'}),
]);
const exact = (v,keys) => v && Object.getPrototypeOf(v)===Object.prototype && Object.keys(v).length===keys.length && keys.every(k=>Object.hasOwn(v,k));
export function validateLegacyReleaseContainment(value) {
  if(!exact(value,['schemaVersion','policy','selection','effects']) || value.schemaVersion!==1
    || value.policy!=='legacy_control_plane_effects_v1' || value.selection!=='detached_node24_before_candidate_v1'
    || !Array.isArray(value.effects) || value.effects.length!==2
    || LEGACY_RELEASE_EFFECTS.some(expected=>value.effects.filter(row=>exact(row,['importId','kind','effectSha256'])
      &&row.importId===expected.importId&&row.kind===expected.kind&&/^[a-f0-9]{64}$/.test(row.effectSha256||'')).length!==1)) {
    const e=new Error('LEGACY_RELEASE_CONTAINMENT_INVALID');e.code=e.message;throw e;
  }
  return value;
}
