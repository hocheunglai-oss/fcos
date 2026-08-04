import { readdir } from 'node:fs/promises';

const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);
const names = (await readdir(migrationDirectory)).filter((name) => name.endsWith('.sql')).sort();
const invalidNames = names.filter((name) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(name));
const timestamps = names.map((name) => name.slice(0, 14));
const duplicates = timestamps.filter((value, index) => timestamps.indexOf(value) !== index);

if (!names.length) throw new Error('No Supabase migrations were found.');
if (invalidNames.length) throw new Error(`Invalid migration filenames: ${invalidNames.join(', ')}`);
if (duplicates.length) throw new Error(`Duplicate migration timestamps: ${[...new Set(duplicates)].join(', ')}`);

process.stdout.write(`Verified ${names.length} ordered Supabase migration files.\n`);
