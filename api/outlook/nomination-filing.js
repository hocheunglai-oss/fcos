// @ts-check
import { authenticatedFunction } from '../_authenticatedFunction.js';
import { createNominationFilingService, filingError, filingHash, FILING_LIMITS } from '../_nominationFiling.js';
import { createNominationGateway } from '../_nominationFilingGateway.js';
import { createNominationLedger, authorizeNominationGrant, nominationGrantTargets } from '../_nominationFilingLedger.js';

export const config = { api: { bodyParser: false } };
const actions = new Set(['destinations', 'proposal', 'confirm', 'upload', 'reconcile', 'cancel']);
const authenticated = authenticatedFunction({
  handlerName: 'outlookNominationFiling', moduleId: 'outlook_nomination_filing', mutation: true, externalAction: true, maxJsonBodyBytes: 1024 * 1024,
  execute: async (body, req, context) => {
    if (['administrator', 'general_manager'].includes(context.profile.user_type)) {
      throw filingError('NOMINATION_FILING_PILOT_ROLE_REQUIRED', 403);
    }
    if (req.method !== 'POST' || typeof body.action !== 'string' || !actions.has(body.action)) throw filingError('INVALID_FILING_ACTION', 400);
    // No object names, instance URLs, SOQL or credentials are accepted from the client.
    const service = createNominationFilingService({ ledger: createNominationLedger(context.client), gateway: createNominationGateway(), authorize: authorizeNominationGrant, targets: nominationGrantTargets });
    const result = await service[body.action](context, body);
    return body.action === 'proposal' ? { ...result, proposalHash: filingHash(result), limits: FILING_LIMITS } : result;
  },
});

export default function handler(req, res) {
  // Default-off BEFORE authentication/storage/provider calls. No flag is enabled by this task.
  if (process.env.FCOS_ENABLE_NOMINATION_FILING !== 'true') {
    res.statusCode = 503; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store');
    return res.end(JSON.stringify({ code: 'NOMINATION_FILING_NOT_ACTIVATED', error: 'Nomination filing awaits approved setup and DEVEE verification.' }));
  }
  return authenticated(req, res);
}
