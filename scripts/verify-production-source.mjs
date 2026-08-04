import { readFile, readdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const roots = ['api', 'src'];
const files = [];

async function collect(relativePath) {
  const directory = new URL(`${relativePath}/`, root);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = `${relativePath}/${entry.name}`;
    if (entry.isDirectory()) await collect(child);
    else if (/\.(?:js|jsx|mjs|ts|tsx|json)$/.test(entry.name)) files.push(child);
  }
}

for (const directory of roots) await collect(directory);
files.push('package.json', 'vercel.json');

const forbidden = [
  { label: 'SMTP environment variable', pattern: /\bSMTP_[A-Z0-9_]+\b/ },
  { label: 'nodemailer dependency', pattern: /\bnodemailer\b/i },
  { label: 'SMTP transport', pattern: /\bcreateTransport\s*\(|smtp:\/\//i },
];
const findings = [];

for (const path of files) {
  const source = await readFile(new URL(path, root), 'utf8');
  for (const rule of forbidden) {
    if (rule.pattern.test(source)) findings.push(`${path}: ${rule.label}`);
  }
}

if (findings.length) throw new Error(`Graph-only email regression detected:\n${findings.join('\n')}`);
process.stdout.write(`Verified Graph-only production source across ${files.length} files.\n`);
