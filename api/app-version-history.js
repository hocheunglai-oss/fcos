import { withDeploymentRequestSafety } from './_deploymentReadOnly.js';
import { APP_VERSION_HISTORY } from '../src/lib/appVersion.js';

function appVersionHistory(_req, res) {
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
  res.status(200).json({ history: APP_VERSION_HISTORY });
}

export default withDeploymentRequestSafety(appVersionHistory);
