import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME_ROOTS = ['api', 'src'];
const EXCLUDED_RUNTIME_FILES = new Set([
  path.join(ROOT, 'src/lib/appVersion.js'),
]);
const BLOCKED_RUNTIME_PATTERNS = [
  { label: 'legacy SMTP environment variable', pattern: /SMTP_[A-Z0-9_]+/i },
  { label: 'SMTP package or transport', pattern: /nodemailer|createSmtpTransport|createTransport\s*\(/i },
  { label: 'workflow Send As compatibility field', pattern: /requiresSendAs|FCOS_UPDATE_SEND_AS/i },
];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(resolved));
    else if (/\.(?:js|jsx|mjs|cjs|ts|tsx)$/.test(entry.name)) files.push(resolved);
  }
  return files;
}

test('production code contains only Microsoft Graph email delivery', async () => {
  const files = (await Promise.all(RUNTIME_ROOTS.map((directory) => sourceFiles(path.join(ROOT, directory)))))
    .flat()
    .filter((file) => !EXCLUDED_RUNTIME_FILES.has(file));

  const violations = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const blocked of BLOCKED_RUNTIME_PATTERNS) {
      if (blocked.pattern.test(source)) violations.push(`${path.relative(ROOT, file)}: ${blocked.label}`);
    }
  }

  const packageJson = await readFile(path.join(ROOT, 'package.json'), 'utf8');
  assert.doesNotMatch(packageJson, /nodemailer/i);
  assert.deepEqual(violations, []);
});

test('Graph application configuration uses only generic FCOS variables', async () => {
  const graphEmail = await readFile(path.join(ROOT, 'api/_graphEmail.js'), 'utf8');
  assert.match(graphEmail, /env\.FCOS_MICROSOFT_TENANT_ID/);
  assert.match(graphEmail, /env\.FCOS_MICROSOFT_CLIENT_ID/);
  assert.doesNotMatch(graphEmail, /FCOS_UPDATE_MICROSOFT_(?:TENANT|CLIENT)_ID/);
});
