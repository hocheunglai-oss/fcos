import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FCOS_CONNECTION_POLICY, fcosConnectionIdentifier } from '../config/fcosConnections.js';

// Vite freezes these public flags into the client bundle. A release built with
// Preview defaults cannot be repaired by changing server flags after promotion.
export function assertFcunoBuildEnvironment(env = process.env) {
  const hosted = env.VERCEL === '1' || ['production', 'preview'].includes(env.VERCEL_ENV);
  if (!hosted) return { checked: false };
  const required = {
    VITE_FCOS_ENABLE_FCUNO_OIDC: 'true',
    FCOS_ENABLE_FCUNO_FEDERATION: 'true',
    FCUNO_IDENTITY_ISSUER: FCOS_CONNECTION_POLICY.integrations.fcunoIdentityFederation.issuer,
    VITE_SUPABASE_URL: `https://${fcosConnectionIdentifier('supabase', 'Project ref')}.supabase.co`,
  };
  const invalid = Object.entries(required).filter(([key, value]) => env[key] !== value).map(([key]) => key);
  if (invalid.length) throw new Error(`FCUNO release configuration missing or mismatched: ${invalid.join(', ')}. Build a staged Production candidate with the pinned FCOS settings; do not enable legacy password login or copy Production secrets into Preview.`);
  return { checked: true, authentication: 'fcuno' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = assertFcunoBuildEnvironment();
  console.log(result.checked ? 'FCUNO hosted-build configuration verified.' : 'Local build: hosted FCUNO configuration check not applicable.');
}
