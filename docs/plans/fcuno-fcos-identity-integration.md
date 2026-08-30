# FCUNO-Centred Identity Integration with Conflict-Safe Releases

Status: Saved for future implementation and discussion
Decision date: 24 August 2026
Implementation state: Not started

## Summary

FCUNO remains the company identity and credential authority. FCOS and SPC consume that identity while retaining their own application permissions and databases.

| Layer | Shared between FCUNO and FCOS | Remains separate |
|---|---|---|
| Identity | FCUNO user UUID, email, username, display name, active state, credential revision and application entitlement | Passwords, password hashes, cookies, refresh tokens and recovery credentials |
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

- FCOS redirects users to FCUNO's current login and uses an authorization-code flow with PKCE:
  1. FCOS creates state, nonce, PKCE challenge and a validated return path.
  2. FCUNO authenticates using its existing credential.
  3. FCUNO issues a hashed, single-use code valid for 60 seconds.
  4. FCOS exchanges it server-to-server for an ES256-signed identity assertion.
  5. FCOS verifies issuer, audience, subject, state, nonce, PKCE, expiry, identity revision and replay status.
  6. FCOS creates the Supabase session for the prelinked auth user through a server-generated magic-link token hash exchanged by same-origin POST. No email is sent and no token appears in a URL.
- Add versioned interfaces for FCOS authentication start/callback, FCUNO authorization/token exchange, identity synchronization/acknowledgement, session revocation and federation health.
- FCUNO holds the signing private key. FCOS stores only the allowlisted current and next public keys.
- Credential changes and deactivation increment the FCUNO identity revision. FCOS rejects sessions issued before the synchronized revision timestamp.
- Ordinary FCOS password login is removed at cutover. After the rollback window, existing Supabase passwords are replaced with unknown random values.
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
- Store only code hashes, redacted audit metadata and protocol evidence.
- Each migration modifies only its own project and is append-only, idempotent and protected by a migration/advisory lock.

### Vercel

- Keep deployments independent:
  - FCUNO: `bunker-map-c2ks`.
  - FCOS: pinned `fcos` project.
- Share only non-secret protocol configuration: issuer, audiences, callback origins, protocol versions and public keys.
- Never copy service-role keys or private signing keys between projects.
- Expose build SHA, contract version and database revision through authenticated health endpoints.
- Promote immutable preview deployments by exact Git commit rather than rebuilding production from a moving branch.

### GitHub contract

- Keep the canonical versioned federation JSON Schemas and fixtures in `hocheunglai-oss/bunker-map`, because FCUNO is the identity issuer.
- FCOS pins the exact contract version, FCUNO commit and schema SHA-256 in repository configuration.
- FCOS CI downloads that exact public commit and runs provider/consumer contract tests.
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
