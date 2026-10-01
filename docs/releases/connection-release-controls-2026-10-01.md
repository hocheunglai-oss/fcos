# FCOS connection and human-approved release controls

Implemented controls are prepared for review. They do not activate Production,
change provider protections, replace credentials, provision identities, migrate
live databases, or grant financial authority.

## Development and release sequence

1. Preserve current Production fixes and unrelated work. Use an isolated worktree
   with the canonical reviewed controls and locked dependencies.
2. Run focused checks; publish the draft PR and exact source-attested Preview.
   Wait for the independently verified immutable deployment to be READY.
3. Run quality against the actual candidate checkout. Its protected-default
   workflow must match the candidate workflow bytes. The source artifact binds
   candidate SHA and dependency lock; archive bytes must match GitHub's digest.
4. Independently collect deployment environment, compiled flags, authenticated
   runtime/provider observations, and protected-default browser artifacts.
   Dashboard/Markets CI evidence retains its existing restricted identity.
   Separate approved normal-role coverage must demonstrate real loaded data and
   read workflows. Missing evidence remains a blocker.
5. Produce one sanitized readiness report binding candidate SHA, portable source
   digest, dependency lock, configuration revision, immutable deployment, quality
   artifact and protected harness archive identities. A local `pass: true` file
   is never an input or an execution authorization.
6. After separately reviewed activation, dispatch `production-release.yml` from
   the protected default branch with exact candidate SHA and immutable Preview.
   After human environment approval, preflight verifies the dedicated token account, protection and credential *names*. The dedicated
   Production environment requires its configured human reviewer. In single-operator mode the pinned operator may approve the run they started.
7. The approved job rechecks signed GitHub Actions OIDC identity, current review
   history, reviewed environment variables, exact account/project/token scope,
   source and all readiness evidence. Build the source using Production settings
   with `vercel deploy --prod --skip-domain`; never promote the Preview artifact.
8. Verify the staged Production deployment is READY, its actual build digest and
   authenticated provider targets match, and Production has not moved. Recheck
   authority before assigning domains to that exact staged deployment. Verify
   both the immutable artifact/runtime and public domain afterward.

Salesforce metadata retains DEVEE → byte-equivalent shared mirror → QAT →
Production. Live migrations and financial/customer actions keep separate gates.
Mobile development remains suspended.

## Commands and interfaces

- `node scripts/release-readiness.mjs --read-only --json --candidate <immutable-origin> --commit <full-sha>`
  gathers fresh read observations and emits names-only blockers/public bindings.
  Existing explicit `FCOS_RELEASE_RUNTIME_TOKEN` and
  `FCOS_RELEASE_PREVIEW_RUNTIME_TOKEN` can authenticate the deployed read-only
  `POST /api/connection-runtime` probe. No login, refresh or token creation occurs.
- `node scripts/production-release.mjs` is an inert dry run with zero provider
  operations. `--preflight` and `--execute` require the current protected
  default-branch workflow's cryptographically verified Actions identity. Local
  environment flags and JSON cannot establish that identity or human approval.
- `scripts/verify-release.mjs` rejects incomplete/mixed readiness before tests or
  browser state creation. Runtime/admin/normal-role and Actions OIDC credentials
  are removed from every test, build and restricted browser child environment.
- `fcos_release_readiness` schema version 1 includes `candidate`,
  `previousProduction`, `quality`, `trustedEvidence`, `blockers`, and `ready`.
  `productionAuthorized` is always false. Downstream execution recollects proof.
- Trusted normal-role evidence is `fcos-normal-role-evidence-<sha>` with one
  `fcos-normal-role-evidence.json` entry containing candidate URL/SHA, deployment,
  source digest, protected harness SHA, capture time and per-module read checks.
  Only independently verified GitHub archive bytes are consumed.

## Activation requirements and current limits

Both new workflows are disabled until their repository activation variable is
explicitly true and installed on the reviewed protected default branch. Merely
creating an environment with the right name is insufficient.

Production environment `fcos-production-release` must expose independently
observable required human reviewers and `prevent_self_review` matching the reviewed approval mode,
`can_admins_bypass: false`, and protected-branch restrictions. Missing metadata or
an insufficient read token blocks preflight rather than inferring protection.
Environment variables must independently pin `FCOS_REVIEWED_RELEASE_SHA`,
`FCOS_REVIEWED_SOURCE_SHA256`, `FCOS_REVIEWED_CONFIGURATION_SHA256`,
`FCOS_PRODUCTION_RELEASE_ENABLED`, and the dedicated
`FCOS_RELEASE_VERCEL_TOKEN_ID`. The executor reads current Vercel token metadata
and requires the exact reviewed team token scope plus OWNER membership; readable
project/deployment metadata alone never grants deployment capability.

Required dedicated environment credential names are
`FCOS_RELEASE_GH_TOKEN`, `FCOS_RELEASE_VERCEL_TOKEN`,
`FCOS_RELEASE_RUNTIME_TOKEN`, and `FCOS_RELEASE_PREVIEW_RUNTIME_TOKEN`. The GH
credential must resolve to the pinned mutation account. An existing dedicated
Preview protection credential is also needed when protection is enabled. The
approved preflight step uses the dedicated environment GH credential to read protection/variable/credential-name metadata;
an inaccessible API remains a blocker. No credential values are persisted.

Automatic Production Git builds must be disabled in the reviewed `vercel.json`
for the live project's Production branch, live auto-assignment must be false,
and deployment hooks must be absent. These provider-setting changes need their
own explicit human approval; this implementation does not apply them.

The normal-role workflow uses a separately reviewed protected environment
`fcos-normal-role-verification`, explicit approved existing identity email and
ephemeral existing browser storage state. It never widens the restricted CI
identity. It verifies the active role through FCOS, denies refresh/foreign writes
and unknown or mutating requests, disables service workers, records no screenshots
or traces, and closes every task page/context/browser. Unsupported module UI/data
assertions remain missing coverage rather than shell-only passes. No existing
approved normal-role state or admin probe token has been provisioned by this task.

The Production baseline may not yet expose the new runtime endpoint; this is
reported as unknown. A missing baseline probe is not silently waived. Readiness
therefore remains blocked until an explicitly reviewed compatible rollout and
fresh authenticated evidence establish the required baseline.

## Uncertain outcomes and rollback

Before each mutation the executor flushes a runner journal identifying the exact
candidate, reviewer/run/environment, previous Production and stable operation ID.
A deployment timeout performs one independent readback; it never repeats the
write. Ambiguous or missing results stop. First-run-only authority and exclusive
journal creation also reject blind reruns. Staged IDs are saved before readiness
and probe checks. A promotion timeout reads back the active Production identity.

The sanitized journal records `vercel rollback <previous-deployment-id>` as a
reviewable recovery command. Rollback requires human authorization and fresh
target checks; failures never trigger an automatic rollback or migration. Resume
requires inspecting the recorded operation and existing deployment, preserving
successful evidence, and preparing a new explicitly reviewed dispatch after any
uncertain result is resolved.

## Validation

Focused release/parity tests cover mixed and stale candidate identities, source/
lock/config mismatch, nested untrusted pass assertions, archive digest/content
tampering, wrong protected harness, missing or bypassable review, wrong-account approval,
wrong/expired OIDC identity and forged signatures, unknown runtime safety,
credential scoping, read-versus-write permission, automatic deployment bypass,
durable intent, uncertain outcomes, staged failure, and normal-role/CI boundaries.
No live protected workflow or normal-role credentials are created by those tests.

References: [GitHub environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments),
[review history](https://docs.github.com/en/rest/actions/workflow-runs#get-the-review-history-for-a-workflow-run),
[Actions OIDC claims](https://docs.github.com/en/actions/reference/security/oidc),
[Vercel staged deployment](https://vercel.com/docs/cli/deploy#skip-domain),
[current token metadata](https://vercel.com/docs/rest-api/authentication/get-auth-token-metadata).

## Single-operator FCOS policy

The reviewed canonical `FCOS_RELEASE_APPROVAL_POLICY` is `single_operator` because FCOS is managed by one person. It is source-controlled in `config/fcosConnections.js` and covered by the configuration digest; no environment or CLI argument can override it. GitHub required environment reviewer is the pinned mutation account `hocheunglai-oss`, `prevent_self_review: false`, `can_admins_bypass: false`, with protected-branch restrictions. The operator must explicitly approve the exact run; simply starting a workflow or setting a variable cannot approve it.

Main must retain administrator enforcement and strict GitHub Actions checks `code-and-database`, `dependency-review` and `authenticated-browser`, pinned to the observed GitHub Actions app. No second-person PR approval is added by this mode. Existing provider restrictions are preserved. The supported `two_person` source policy still requires PR review, stale-review dismissal, prevent-self-review and an approver distinct from the initiator.

The existing operator's active FCOS Administrator or General Manager session may provide normal-role evidence with sufficient actual module access. It must remain separate from the restricted CI identity; no second person is required. Credentials, provider protection changes, first-rollout baseline verification and activation remain explicit prerequisites. No missing runtime observation is waived by single-operator mode.

The Production workflow uses one protected environment job. Human approval releases its dedicated credentials; a read-only preflight then verifies the pinned token account before any repository/private metadata read, exact environment-bound signed Actions identity, settings and credential names. The execution step independently rechecks approval and fresh readiness before any deployment. No unapproved job relies on the default GitHub Actions token to read secret metadata.
