import { isDeploymentReadOnly } from './_deploymentReadOnly.js';

export function createPortalRetryScheduler({ waitUntil, processPortalOutbox, requestId, now = Date.now, environment = () => process.env, onFailure = () => {} }) {
  let lastScheduledAt = null;
  return (client) => {
    // Guard before the clock, scheduler, provider or local throttle changes.
    if (isDeploymentReadOnly(environment())) return false;
    const time = now();
    if (lastScheduledAt !== null && time - lastScheduledAt < 60000) return false;
    lastScheduledAt = time;
    waitUntil(Promise.resolve().then(() => processPortalOutbox({ client, limit: 3, requestId: requestId() })).catch(onFailure));
    return true;
  };
}
