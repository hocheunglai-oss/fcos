import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';

const pin = FCOS_CONNECTION_POLICY.integrations.fcunoIdentityFederation;
const localDirectory = process.env.FCOS_FCUNO_CONTRACT_DIRECTORY?.trim();
const expectedFiles = [
  'identity-sync-event.schema.json',
  'oidc-claims.schema.json',
  'release-manifest.schema.json',
];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function fetchPinnedFile(file) {
  if (localDirectory) return readFile(resolve(localDirectory, file));
  const repositoryPath = pin.providerRepository
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const contractFilePath = `${pin.contractPath}/${file}`
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const url = new URL(
    `/repos/${repositoryPath}/contents/${contractFilePath}`,
    'https://api.github.com',
  );
  url.searchParams.set('ref', pin.providerCommit);
  const token = process.env.GITHUB_TOKEN?.trim();
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github.raw+json',
      'User-Agent': 'fcos-fcuno-contract-verifier',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Unable to read pinned FCUNO contract ${file} at ${pin.providerCommit}: HTTP ${response.status}.`);
  }
  return Buffer.from(await response.arrayBuffer());
}

const manifestBytes = await fetchPinnedFile('contract-manifest.json');
const manifest = JSON.parse(manifestBytes.toString('utf8'));
if (manifest.contractVersion !== pin.protocolVersion
    || manifest.aggregateSha256 !== pin.contractSha256) {
  throw new Error('Pinned FCUNO contract version or aggregate digest does not match FCOS configuration.');
}
if (manifest.files?.map(({ path }) => path).join(',') !== expectedFiles.join(',')) {
  throw new Error('Pinned FCUNO contract manifest has an unexpected schema set or order.');
}

const aggregate = createHash('sha256');
for (const file of expectedFiles) {
  const bytes = await fetchPinnedFile(file);
  const entry = manifest.files.find(({ path }) => path === file);
  if (!entry || sha256(bytes) !== entry.sha256) {
    throw new Error(`Pinned FCUNO contract schema digest mismatch: ${file}.`);
  }
  JSON.parse(bytes.toString('utf8'));
  aggregate.update(file);
  aggregate.update(Buffer.from([0]));
  aggregate.update(bytes);
  aggregate.update(Buffer.from([0]));
}

if (aggregate.digest('hex') !== pin.contractSha256) {
  throw new Error('Pinned FCUNO contract aggregate digest verification failed.');
}

process.stdout.write(
  `FCOS verified FCUNO contract ${pin.protocolVersion} at ${pin.providerCommit}: ${pin.contractSha256}\n`,
);
