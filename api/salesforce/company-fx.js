import { handleSalesforceCompanyFx } from '../_salesforceCompanyFx.js';
import { withDeploymentRequestSafety } from '../_deploymentReadOnly.js';

// Signature verification requires the exact incoming bytes.
export const config = { api: { bodyParser: false } };
export default withDeploymentRequestSafety(handleSalesforceCompanyFx);
