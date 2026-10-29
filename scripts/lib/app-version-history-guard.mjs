function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function assertCurrentReleaseHistory(version, history) {
  const matches = Array.isArray(history) ? history.filter((entry) => entry?.version === version) : [];
  if (matches.length !== 1) throw new Error(`Current app version ${version} needs exactly one release-history entry.`);
  const [entry] = matches;
  if (!validDate(entry.releasedAt)
    || typeof entry.title !== 'string'
    || !entry.title.trim()
    || !Array.isArray(entry.changes)
    || entry.changes.length === 0
    || entry.changes.some((change) => typeof change !== 'string' || !change.trim())) {
    throw new Error(`Current app version ${version} needs a valid release date, title, and non-empty change text.`);
  }
  return entry;
}
