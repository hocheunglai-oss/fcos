// @ts-check
import { sfRequest, getInstanceUrl } from './_salesforce.js';
import { requireExternalActionGate } from './_externalActionGates.js';
import { filingError } from './_nominationFiling.js';

const BRIDGE = '/apexrest/fcos/nomination-filing/v1';
// Calls a new authenticated Apex REST bridge, never the private Aura transport.
/** @param {{request?:(path:string,options?:any)=>Promise<any>,instance?:()=>string,env?:Record<string,string|undefined>}} [options] */
export function createNominationGateway({ request = sfRequest, instance = getInstanceUrl, env = process.env } = {}) {
  function enabled(environment) {
    if (env.FCOS_ENABLE_NOMINATION_FILING !== 'true' || env.FCOS_NOMINATION_FILING_ENVIRONMENT !== environment.key
      || env.FCOS_NOMINATION_FILING_DEPLOYED_SOURCE_HASH !== env.FCOS_NOMINATION_FILING_APPROVED_SOURCE_HASH
      || !/^[a-f0-9]{64}$/.test(env.FCOS_NOMINATION_FILING_APPROVED_SOURCE_HASH || '')) throw filingError('NOMINATION_FILING_NOT_ACTIVATED', 503);
    if (instance().replace(/\/$/, '') !== environment.instanceUrl) throw filingError('SALESFORCE_INSTANCE_MISMATCH', 503);
  }
  return {
    async verifyEnvironment(environment) {
      enabled(environment);
      const result = await request('/query/?q=' + encodeURIComponent('SELECT Id, IsSandbox FROM Organization LIMIT 1'));
      if (result.records?.length !== 1 || result.records[0].Id !== environment.orgId || result.records[0].IsSandbox !== environment.isSandbox) throw filingError('SALESFORCE_ORG_MISMATCH', 503);
    },
    async snapshot(destination, environment) {
      enabled(environment);
      return request(BRIDGE + '/snapshot?recordId=' + encodeURIComponent(destination.recordId) + '&slot=' + encodeURIComponent(destination.slot) + '&userId=' + encodeURIComponent(destination.salesforceUserId));
    },
    async commit(payload, environment) {
      enabled(environment); requireExternalActionGate('salesforce_write', env);
      return request(BRIDGE, { method: 'POST', body: payload, retryOnExpiredSession: false });
    },
    async reconcile(requestKey, environment) {
      enabled(environment);
      return request(BRIDGE + '/receipt?key=' + encodeURIComponent(requestKey));
    },
  };
}
