// GitHub REST emits UTC seconds; local material contracts use UTC millis.
// Validate either explicit provider representation without changing its bytes.
export function githubProviderTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === (value.includes('.') ? value : value.replace(/Z$/, '.000Z'));
}
export function githubProviderFresh(value, ageMs, now) {
  return githubProviderTimestamp(value) && Date.parse(value) <= now && now - Date.parse(value) <= ageMs;
}
