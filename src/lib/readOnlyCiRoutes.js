// Presentation gate only: the server's positive handler allowlist remains the
// authorization boundary. Leave every ordinary user's existing route unchanged.
export function canRenderCiWorkspace(user, pathname) {
  if (user?.read_only_ci !== true) return true;
  const path = String(pathname || '').replace(/\/+$/, '') || '/';
  return path === '/' || path === '/markets' || /^\/accounts\/[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(path);
}
