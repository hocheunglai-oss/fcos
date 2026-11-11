# FCOS authentication and protected routes

FCOS uses the Supabase project pinned in [the connection policy](../config/fcosConnections.js).
FCUNO owns federated identity and entitlement. FCOS owns local application
activation, organizational roles and permission groups. Activating a federated
profile preserves its current role and group memberships. The application still
requires a valid FCUNO session and entitlement.

## Configuration

Use the ignored `.env.local` for local development and the pinned FCOS Vercel
project for hosted configuration. The browser reads `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`. The latter accepts a public publishable key or the
legacy anonymous key. The protected build accepts `VITE_SUPABASE_PUBLISHABLE_KEY`
as a fallback when `VITE_SUPABASE_ANON_KEY` is absent and validates the project
and public key before building.

Keep `SUPABASE_SECRET_KEY` or the supported `SUPABASE_SERVICE_ROLE_KEY` server
only. The server prefers `SUPABASE_URL` and withholds the credential when the
resolved project differs from the pin. Local administrator mode is available
only for loopback Vite development with both browser Supabase settings absent.
Hosted configuration errors keep the workspace locked.

Keep the approved FCUNO sign-in and legacy password settings for each
environment. The browser's FCUNO redirect returns to `/login?federated=1` on the
same origin. A requested return path must stay on that origin. The server
independently enforces the approved legacy, pilot and break-glass policy.

## Authorization and verification

The browser presents the Supabase access token to FCOS. The server verifies the
token with `auth.getUser`, checks current profile activation and applicable FCUNO
session evidence, and resolves effective permissions and capabilities from
FCOS. Workspace routes and module gates use that verified state. Endpoints
enforce their own access rules. Sign-out and account changes invalidate
pending results and clear the previous user's client state.

Run the focused consumer checks from the release checkout.

```sh
npm run verify:fcuno-contract
node --test tests/authRuntimePolicy.test.js tests/authSessionLifecycle.test.js tests/fcunoIdentityFederation.test.js tests/fcunoSessionProof.test.js tests/fcunoLocalActivation.test.js tests/supabaseConfig.test.js
```

These fixtures exercise authorization and request handling with simulated
identities. The [protected rapid release](rapid-release.md) verifies hosted
sign-in, restricted access and required normal-role desktop coverage against
the exact staged artifact before Production approval.
