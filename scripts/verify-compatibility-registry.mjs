import { readFile } from 'node:fs/promises';

const registry = JSON.parse(await readFile(new URL('../config/compatibility-registry.json', import.meta.url), 'utf8'));
if (registry?.version !== 1 || !Array.isArray(registry.entries)) throw new Error('Compatibility registry must use version 1 and contain entries.');
const ids = new Set();
for (const entry of registry.entries) {
  for (const field of ['id', 'kind', 'target', 'owner', 'reason', 'introduced', 'reviewAfter', 'retireWhen']) {
    if (!String(entry?.[field] || '').trim()) throw new Error(`Compatibility entry ${entry?.id || '<unknown>'} is missing ${field}.`);
  }
  if (ids.has(entry.id)) throw new Error(`Duplicate compatibility entry: ${entry.id}`);
  ids.add(entry.id);
  for (const field of ['introduced', 'reviewAfter']) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry[field])) throw new Error(`${entry.id}.${field} must be YYYY-MM-DD.`);
  }
  if (entry.reviewAfter < entry.introduced) throw new Error(`${entry.id} review date precedes its introduction.`);
}
process.stdout.write(`Compatibility registry passed (${registry.entries.length} governed entries).\n`);
