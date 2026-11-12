// @ts-check
import { filingError } from './_nominationFiling.js';
import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';

export function createNominationLedger(client) {
  async function rpc(action, operationId, userId = null, data = {}) {
    const result = await client.rpc('fcos_nomination_operation', { p_action: action, p_operation_id: operationId, p_user_id: userId, p_data: data });
    if (result.error) throw filingError('FILING_LEDGER_UNAVAILABLE', 503);
    return result.data;
  }
  return {
    create: (op) => rpc('create', op.id, op.userId, op),
    read: (id) => rpc('read', id),
    claim: (id, user, cursor, pending) => rpc('claim', id, user, { cursor, pending }),
    advance: (id, claim, result) => rpc('advance', id, null, { claim, ...result }),
    uncertain: (id, claim, pending) => rpc('uncertain', id, null, { claim, pending }),
    failed: (id, claim) => rpc('failed', id, null, { claim }),
    recover: (id, expected, result) => rpc('recover', id, null, { expected, ...result }),
    cancel: (id, user) => rpc('cancel', id, user),
    completed: (user, orgId, destination, files) => rpc('completed', null, user, { orgId, destination, files }),
  };
}

export async function authorizeNominationGrant(context, target) {
  const { data, error } = await context.client.from('fcos_nomination_filing_grants').select('user_id,org_id,record_id,slot,salesforce_user_id,proof_hash,permissions_verified,audience_verified,expires_at')
    .eq('user_id', context.profile.id).eq('org_id', target.orgId).eq('record_id', target.recordId).eq('slot', target.slot).maybeSingle();
  if (error) throw filingError('FILING_AUTHORIZATION_UNAVAILABLE', 503);
  if (!data) return null;
  return { userId: data.user_id, orgId: data.org_id, recordId: data.record_id, slot: data.slot, salesforceUserId: data.salesforce_user_id, proofHash: data.proof_hash, permissionsVerified: data.permissions_verified, audienceVerified: data.audience_verified, expiresAt: Date.parse(data.expires_at) };
}

export async function nominationGrantTargets(context, env = process.env) {
  const environment = fcosSalesforceEnvironment(env.FCOS_NOMINATION_FILING_ENVIRONMENT);
  const { data, error } = await context.client.from('fcos_nomination_filing_grants').select('record_id,slot')
    .eq('user_id', context.profile.id).eq('org_id', environment.orgId).eq('permissions_verified', true).eq('audience_verified', true).gt('expires_at', new Date().toISOString()).limit(20);
  if (error) throw filingError('FILING_AUTHORIZATION_UNAVAILABLE', 503);
  return (data || []).map((row) => ({ environment: environment.key, recordId: row.record_id, slot: row.slot }));
}
