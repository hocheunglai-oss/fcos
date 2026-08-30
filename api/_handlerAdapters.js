/**
 * Adapts a domain service to the universal FCOS handler signature while keeping
 * authentication at the HTTP boundary. Domain modules receive the resolved
 * access context and remain independent of request parsing.
 */
export function withActiveUser(service, requireActiveUser) {
  if (typeof service !== 'function' || typeof requireActiveUser !== 'function') {
    throw new TypeError('withActiveUser requires a service and access resolver.');
  }
  return async function activeUserHandler(body = {}, req = null, accessContext = null) {
    return service(body, accessContext || (await requireActiveUser(req)));
  };
}
