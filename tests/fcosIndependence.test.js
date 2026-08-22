import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirectories = new Set(['.git', 'dist', 'node_modules']);
const ignoredFiles = new Set([fileURLToPath(import.meta.url)]);
const textExtensions = new Set(['.cjs', '.css', '.html', '.js', '.jsx', '.json', '.md', '.mjs', '.sql', '.ts', '.tsx', '.yaml', '.yml']);

const forbiddenReferences = [
  ['back', 'bone'].join(''),
  ['fcbhk', 'erp'].join('-'),
  ['FCOS', ['back', 'bone'].join('').toUpperCase()].join('_'),
  ['qffk', 'xfskszjrvksajcmh'].join(''),
];

async function repositoryTextFiles(directory = repositoryRoot) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name) ? [] : repositoryTextFiles(absolutePath);
    }
    return textExtensions.has(path.extname(entry.name)) && !ignoredFiles.has(absolutePath) ? [absolutePath] : [];
  }));
  return nested.flat();
}

test('FCOS has no dependency on the retired ERP project', async () => {
  const violations = [];
  for (const file of await repositoryTextFiles()) {
    const content = await readFile(file, 'utf8');
    for (const reference of forbiddenReferences) {
      if (content.toLowerCase().includes(reference.toLowerCase())) {
        violations.push(`${path.relative(repositoryRoot, file)}: ${reference}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});
