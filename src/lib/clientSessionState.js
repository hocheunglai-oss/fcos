// Sensitive browser state belongs to one verified FCOS identity and session.
// A generation also rejects work that started before logout/account switching.
let session = Object.freeze({ ownerId: null, generation: 0 });
const resetters = new Set();

export function clientSessionState() { return session; }
export function isCurrentClientSession(expected) { return expected === session; }
export function onClientSessionReset(reset) {
  resetters.add(reset);
  return () => resetters.delete(reset);
}

function removePrefixed(storage, prefixes, retainPrefix = null) {
  try {
    const keys = [];
    for (let index = 0; index < storage.length; index += 1) keys.push(storage.key(index));
    for (const key of keys) {
      if (key && prefixes.some((prefix) => key.startsWith(prefix)) && !key.startsWith(retainPrefix || '\0')) storage.removeItem(key);
    }
  } catch { /* Storage may be disabled; in-memory isolation still applies. */ }
}

export function setClientSessionOwner(ownerId) {
  const nextOwner = typeof ownerId === 'string' && ownerId ? ownerId : null;
  if (session.ownerId === nextOwner) return session;
  session = Object.freeze({ ownerId: nextOwner, generation: session.generation + 1 });
  if (typeof window !== 'undefined') {
    // Old, unscoped entries cannot be safely attributed to any user.
    try {
      removePrefixed(window.sessionStorage, ['fcos:page_state:'], nextOwner ? `fcos:page_state:${encodeURIComponent(nextOwner)}:` : null);
      removePrefixed(window.localStorage, ['fcos:draft:'], nextOwner ? `fcos:draft:${encodeURIComponent(nextOwner)}:` : null);
    } catch { /* Some browsers deny access to storage itself. */ }
  }
  for (const reset of resetters) reset();
  return session;
}

export function clientSessionKey(prefix, key, expected = session) {
  if (!key || !expected.ownerId || !isCurrentClientSession(expected)) return null;
  return `${prefix}${encodeURIComponent(expected.ownerId)}:${key}`;
}
