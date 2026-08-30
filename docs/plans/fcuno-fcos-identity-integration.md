# FCUNO-Centred Identity Integration with Conflict-Safe Releases

Status: In implementation
Decision date: 24 August 2026
Last architecture review: 31 August 2026
Implementation state: Additive provider and consumer foundations are deployed; production flags remain disabled

## Implemented foundation

- FCUNO now exposes the additive OIDC discovery, authorization, token, JWKS,
  user-info and revocation surfaces, using short-lived PKCE-bound codes and
  current/next ES256 signing keys.
- FCUNO User Management owns verified identity email, global active state and
  `Use FCOS` / `Use SPC` entitlements. Its signed, revisioned outbox projects
  identity metadata to FCOS without sharing passwords or service-role keys.
- FCOS consumes `custom:fcuno`, links the synchronized immutable subject to its
  existing authorization record and rejects stale, inactive, unverified or
  non-entitled identities at every authenticated API boundary.
- The exact federation contract is pinned to FCUNO commit
  `9d8e05cd338e6105b6a495d68512f63692d3a48c` and aggregate SHA-256
  `7fc54e7c3bd79fb014ad81dc6d9190d021549d9428486ef85ed78fdff95d7cc2`.
- Otto's existing SPC profile is linked by exact unique email. FCUNO owns its
  sign-in and revocation; SPC continues to own role, office, route, Supplier
  Trader status, page permissions and operational history. Other SPC users
  retain their external sign-in.
- Repository CI verifies the immutable contract and cancels superseded checks
  on the same branch. Provider and consumer release flags default to off.
- Identity synchronization has an independently gated verification-key route.
  It can be enabled and reconciled before FCUNO OIDC discovery or FCOS login
  is exposed. Enabling synchronization never enables the FCOS login UI or
  server-side federation enforcement.

## Activation gates

Production activation remains fail-closed until both migrations are reviewed
and applied to their separately pinned Supabase projects, the exact identity
reconciliation report has no duplicates or unresolved active users, OIDC and
signing secrets are configured only in their owning systems, both immutable
previews pass compatibility and authenticated browser checks, and an approved
paired release record identifies both Git commits and Vercel deployments.

Activation order is fixed: configure current/next signing keys while every
flag is off, enable identity synchronization and reconcile its outbox, then
enable the OIDC provider and FCOS login only after the pilot identity and
rollback evidence are approved.

## Summary

FCUNO remains the company identity and credential authority. FCOS and SPC consume that identity while retaining their own application permissions and databases.

| Layer | Shared between FCUNO and FCOS | Remains separate |
|---|---|---|
| Identity | FCUNO user UUID, verified email, username, display name, active state, identity revision, credential revision and application entitlement | Passwords, password hashes, cookies, refresh tokens and recovery credentials |
| Permissions | Whether the identity may enter FCOS or SPC | FCOS groups/modules/capabilities remain in FCOS; SPC roles/page permissions remain in SPC |
| Supabase | Identity metadata is projected through signed, revisioned APIs | FCUNO project `gglyugbrnyvyfktgwert` and FCOS project `pjforfvchygdyqfcgpmw` retain separate tables, Auth, service keys, sessions, backups and migrations |
| Vercel | Allowlisted origins, callback URLs, protocol version, client IDs and public verification keys | `bunker-map-c2ks` and `fcos` remain separate projects, deployments, environment variables, domains and private keys |
| GitHub | A versioned federation contract, compatibility fixtures and approved release-pair metadata | `hocheunglai-oss/bunker-map` and `hocheunglai-oss/fcos` retain independent source trees, branches, PRs and CI |
| SPC | FCUNO UUID and `Use SPC` entitlement for linked company users | External SPC users, SPC roles, offices, routes, permissions and external-user credentials |
| Markets | Navigation links and clear source labels only | No price, chart, MOPS, report or formula data is exchanged in this release |
| Public site | Workspace navigation may link to the public map | `fcuno.com` map and public reports remain anonymous and independently deployed |

If FCOS and FCUNO are updated simultaneously from different Codex tasks, they cannot directly overwrite each other because they are separate repositories and Vercel projects. Contract versioning, compatibility CI, immutable previews, deployment locks and expand-then-contract releases prevent one project from deploying an incompatible federation change before the other is ready.

## Identity and User Administration

- Continue using FCUNO's current scrypt-protected credential store as the company identity authority. Password material never leaves the FCUNO application or database.
- Add an immutable FCUNO identity UUID and a required unique normalized email. Backfill from username only when it is a valid email; ambiguous records block migration.
- Add a revisioned FCUNO identity outbox that sends signed, idempotent changes to FCOS for creation, rename, activation, deactivation and credential-revision changes.
- Project every FCUNO company user into FCOS User Settings:
  - Exact existing matches preserve all FCOS permissions.
  - Newly projected identities receive no FCOS access, modules or capabilities.
  - Identity fields are read-only.
  - FCOS cannot create, rename or delete company identities.
  - FCOS continues to manage its user type, groups, module permissions and capabilities.
- Create every unmatched existing FCOS user through FCUNO User Settings before cutover, require a first-login password reset, then preserve the existing FCOS authorization after exact UUID/email reconciliation.
- Only FCUNO User Settings may create company users. External SPC-only users remain the explicit exception and continue to be created in SPC User Settings.
- A global FCUNO deactivation revokes FCUNO, FCOS and linked-SPC access. Removing FCOS permissions affects only FCOS.

## Authentication and SPC Integration

### FCOS sign-in

- FCUNO exposes a standards-based OIDC provider backed by its current admin
  session and credential store. FCOS registers it as the FCOS Supabase
  project's custom OAuth provider `custom:fcuno`; FCUNO is not connected to the
  FCOS database and never receives a service-role key.
- FCOS redirects users to FCUNO and uses the authorization-code flow with PKCE:
  1. FCOS creates state, nonce, PKCE challenge and a validated return path.
  2. FCUNO authenticates using its existing credential.
  3. FCUNO issues a hashed, single-use code valid for 60 seconds.
  4. Supabase Auth exchanges it server-to-server at FCUNO's token endpoint and
     verifies the ES256-signed ID token through FCUNO's current/next JWKS.
  5. FCOS verifies the resulting Supabase identity against the separately
     synchronized FCUNO subject, verified email, entitlement and revision
     before returning application permissions.
- Add versioned interfaces for OIDC discovery, authorization, token exchange,
  user info, identity synchronization/acknowledgement, session revocation and
  federation health.
- FCUNO holds the signing private key. FCOS stores only the allowlisted current and next public keys.
- Credential changes and deactivation increment the FCUNO identity revision. FCOS rejects sessions issued before the synchronized revision timestamp.
- Ordinary FCOS password login remains available only behind a migration flag
  during the rollback window, then is rejected. Existing password credentials
  are not mutated until reconciliation and rollback evidence are complete.
- Retain one disabled-by-default, time-limited and audited FCOS break-glass administrator flow.

### SPC hybrid users

- Add one `Use SPC` permission to FCUNO User Settings.
- Linked FCUNO users authenticate to SPC with their FCUNO session only; no SPC password or WhatsApp challenge is required.
- SPC User Settings shows:
  - `FCUNO users`: identity fields are read-only and the account cannot be edited or removed there. SPC role, office, Supplier Trader status, delivery route and page permissions remain editable.
  - `External users`: retain the existing SPC username/password, optional WhatsApp MFA, account editing and removal behaviour.
- Convert `otto@cosulich.com.hk` to an FCUNO-linked SPC profile while preserving its role, office, permissions, route, audit attribution and operational history. Remove it from the editable external-user section and enable its FCUNO `Use SPC` permission.
- Leave every other current SPC user as an external user.
- Removing `Use SPC` revokes access and sessions but retains the linked profile and history.
- Present separate workspace links for Public Market Map, FCUNO Admin, SPC and FCOS. Use validated deep links or new tabs, never cross-origin iframes.

## Supabase, Vercel and GitHub Boundaries

### Supabase

- Do not connect either application directly to the other application's Supabase project.
- Add service-only federation tables in the owning database:
  - FCUNO: identity revisions, application entitlements, authorization codes, signing events and delivery outbox.
  - FCOS: external identity links, received revisions, authentication transactions and synchronization evidence.
- Enable RLS, revoke browser-role access and expose only narrow security-invoker RPCs or authenticated server endpoints.
- Store only authorization-code hashes, token revocation hashes, redacted audit
  metadata and protocol evidence. No raw OAuth code or private key enters a
  database table.
- Each migration modifies only its own project and is append-only, idempotent and protected by a migration/advisory lock.

### Vercel

- Keep deployments independent:
  - FCUNO: `bunker-map-c2ks`.
  - FCOS: pinned `fcos` project.
- Share only non-secret protocol configuration: issuer, client identifier,
  exact callback URIs, protocol versions and public verification keys. FCUNO's
  signing key and OIDC client secret stay only in the FCUNO Vercel project;
  FCOS's matching provider secret stays only in the FCOS Supabase Auth vault.
- Never copy service-role keys or private signing keys between projects.
- Expose build SHA, contract version and database revision through authenticated health endpoints.
- Promote immutable preview deployments by exact Git commit rather than rebuilding production from a moving branch.

### GitHub contract

- Keep the canonical versioned federation JSON Schemas and fixtures in `hocheunglai-oss/bunker-map`, because FCUNO is the identity issuer.
- FCOS pins the exact contract version, FCUNO commit and schema SHA-256 in repository configuration.
- FCOS CI downloads that exact public commit and runs provider/consumer
  contract tests. It never downloads executable provider code.
- FCUNO CI prevents deletion or incompatible modification of a protocol version still pinned by FCOS production.
- Each repository retains its own implementation; no Git submodule and no shared generated source tree are introduced.
- Record each approved integration release with the FCUNO/FCOS commit SHAs and preview URLs, federation contract version and schema hash, both migration revisions, verification result and production promotion timestamps.

## Concurrent-Change and Conflict Protection

- Every Codex task uses its own branch and draft PR. No task pushes directly to a shared working branch or production.
- Changes in different repositories proceed independently unless they modify the federation contract.
- Two tasks changing the same repository must rebase on the latest remote head, rerun CI against the merged result and push only with a fresh remote-head lease.
- Add per-project deployment concurrency groups so only one production promotion can run for each Vercel project.
- Add a federation-release mutex for changes involving both applications. A second cross-project release waits or fails before production promotion.
- Use an expand-then-contract rollout:
  1. FCUNO deploys an additive protocol version while continuing to support the current version.
  2. FCOS deploys support and switches only after the new FCUNO health check passes.
  3. Traffic and audit evidence confirm the new version.
  4. The old version is removed only after neither production deployment advertises or uses it.
- Every federation request includes a protocol version. Unsupported versions fail clearly without partially processing data.
- Feature flags independently control identity sync, FCOS federated login, linked-SPC login and legacy-login rejection.
- Before production promotion, release tooling verifies the expected Git heads and Vercel production deployments, preview compatibility, required migrations and absence of unresolved identity synchronization.
- Ordinary chart or UI changes remain isolated to their repository and preview. They cannot alter federation behaviour unless the versioned identity contract also changes.
- A failed deployment leaves the other application on the previous compatible version. Rollback promotes the previous immutable deployment; migrations remain backward compatible until the transition is complete.

## Verification and Release

- Generate a pre-cutover report covering all FCUNO users, all FCOS users, unmatched identities, duplicate emails, Otto's conversion and external SPC users.
- Block cutover until every active company identity is uniquely reconciled and both systems retain a verified administrator.
- Test identity creation, rename, deactivation, stale revisions, duplicate delivery, retry ordering and zero-permission FCOS projections.
- Test authorization-code replay, PKCE/state/nonce mismatch, incorrect issuer/audience, key rotation, expiry, unsafe return paths and session invalidation.
- Test FCOS permission preservation and the prohibition of FCOS-side company-user creation.
- Test linked SPC access, external SPC authentication, Otto's preserved history and `Use SPC` revocation.
- Test old-provider/new-consumer and new-provider/old-consumer contract combinations.
- Simulate simultaneous FCOS/FCUNO deployments, stale Git heads, overlapping promotions, migration delays and rollback.
- Confirm public FCUNO map/report availability and the absence of market-data exchange.
- Run focused/full tests, lint, type checking, production builds, RLS/grant checks and authenticated desktop/mobile verification.
- Deploy FCUNO's backward-compatible provider changes first, then FCOS, activate synchronization, complete identity reconciliation and finally enable FCUNO-backed FCOS login.

## Assumptions

- Simultaneous work from different Codex tasks uses isolated branches and previews.
- Every company identity will have a unique valid email address.
- FCUNO remains the sole ordinary company credential authority.
- FCUNO-linked SPC users use the FCUNO session without WhatsApp MFA; external SPC users retain current SPC authentication.
- Market-data synchronization remains outside this release.
