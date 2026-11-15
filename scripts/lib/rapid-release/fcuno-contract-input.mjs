import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '@babel/parser';
import { FCOS_CONNECTION_POLICY } from '../../../config/fcosConnections.js';
import { requireCondition } from './contract.mjs';

const trustedPin = FCOS_CONNECTION_POLICY.integrations.fcunoIdentityFederation;
const pinFields = ['providerRepository', 'providerCommit', 'contractPath', 'protocolVersion', 'contractSha256'];
const snapshotFiles = ['contract-manifest.json', 'identity-sync-event.schema.json', 'oidc-claims.schema.json', 'release-manifest.schema.json'];
const changedPin = 'QUALITY_FCUNO_CONTRACT_PIN_CHANGED';

function literalProperties(node) {
  requireCondition(node?.type === 'ObjectExpression', changedPin);
  const properties = new Map();
  for (const property of node.properties) {
    requireCondition(property.type === 'ObjectProperty' && !property.computed
      && ['Identifier', 'StringLiteral'].includes(property.key.type), changedPin);
    const key = property.key.name ?? property.key.value;
    requireCondition(!properties.has(key), changedPin);
    properties.set(key, property.value);
  }
  return properties;
}

export function fcunoContractDirectory({ controllerDirectory, candidateDirectory }) {
  let program;
  try {
    const source = readFileSync(join(candidateDirectory, 'config', 'fcosConnections.js'), 'utf8');
    requireCondition(Buffer.byteLength(source) <= 256 * 1024, changedPin);
    program = parse(source, { sourceType: 'module' }).program;
  } catch {
    requireCondition(false, changedPin);
  }
  // Read the candidate's reviewed source declaration without running application
  // code in the controller. Unrelated connection policy changes may differ.
  const declarations = program.body.filter(node => node.type === 'VariableDeclaration')
    .flatMap(node => node.declarations)
    .filter(node => node.id.type === 'Identifier' && node.id.name === 'connectionPolicy');
  requireCondition(declarations.length === 1, changedPin);
  const policy = literalProperties(declarations[0].init);
  const federation = literalProperties(literalProperties(policy.get('integrations')).get('fcunoIdentityFederation'));
  requireCondition(pinFields.every(field => federation.get(field)?.type === 'StringLiteral'
    && federation.get(field).value === trustedPin[field]), changedPin);

  // These four public files are copied byte-for-byte from the pinned provider
  // Git tree. The unchanged candidate verifier still checks each schema and
  // the aggregate digest. Missing local evidence must never trigger a fetch.
  const directory = join(controllerDirectory, 'scripts', 'lib', 'rapid-release', 'fcuno-contract', trustedPin.providerCommit);
  const failure = 'QUALITY_FCUNO_CONTRACT_SNAPSHOT_REQUIRED';
  requireCondition(lstatSync(directory, { throwIfNoEntry: false })?.isDirectory(), failure);
  const entries = readdirSync(directory, { withFileTypes: true });
  requireCondition(entries.length === snapshotFiles.length && entries.every(entry => entry.isFile()
    && snapshotFiles.includes(entry.name)), failure);
  return directory;
}
