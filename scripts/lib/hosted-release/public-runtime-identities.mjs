import { fcosRuntimeConnectionCatalogue } from '../../../config/fcosConnections.js';
import { COMPATIBILITY_RUNTIME_ORDINARY_ADMISSION_CORRECTION } from '../../../config/hostedCompatibilityCorrection.js';
import { fail } from './json-contract.mjs';

// Microsoft application/tenant identifiers are public identity selectors, not
// passwords, client secrets or bearer tokens. Derive their names from the
// canonical connection catalogue and admit only the complete UUID pair.
const graphKeys = Object.freeze([...fcosRuntimeConnectionCatalogue().find(row => row.id === 'microsoft').identityPins.configuredIdentityKeys]);
const uuid = value => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export function publicRuntimeIdentityEnvironment(value) {
  if (value === undefined) return {};
  if (!value || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== graphKeys.length
    || Object.keys(value).some(key => !graphKeys.includes(key))
    || graphKeys.some(key => !uuid(value[key]))) fail('PUBLIC_RUNTIME_IDENTITY_INPUT');
  return Object.fromEntries(graphKeys.map(key => [key, value[key]]));
}

// Source-archive deployments use detached HEAD and cannot inherit unrelated
// historical branch-only Preview overrides. Refuse the current complete-browser
// candidate and application profile before an intent unless their identity pair is bound in
// the reviewed manifest. This does not attest Microsoft authentication or
// consent, and adds no provider, mailbox or sending authority.
export function assertPublicRuntimeIdentityPrerequisites(manifest) {
  const values = publicRuntimeIdentityEnvironment(manifest.verification?.publicPreviewRuntimeIdentityEnvironment);
  if ((manifest.candidate?.sha === COMPATIBILITY_RUNTIME_ORDINARY_ADMISSION_CORRECTION.candidateSha
    || manifest.candidate?.sourceProfile === 'application_v2')
    && Object.keys(values).length !== graphKeys.length) fail('SOURCE_API_GRAPH_IDENTITY_REQUIRED');
  return values;
}
