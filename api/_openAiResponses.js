import { requireDeploymentMutationAllowed } from './_deploymentReadOnly.js';

export function fetchOpenAiResponses(fetchImpl, options) {
  requireDeploymentMutationAllowed(true);
  return fetchImpl('https://api.openai.com/v1/responses', options);
}
