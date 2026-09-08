# Trusted CI bootstrap — approval required

Prepared 8 September 2026. This is a proposal, not approval to merge, change
branch protection, expose credentials, or deploy Production.

## Verified starting point

- Repository: `hocheunglai-oss/fcos`.
- Default branch: `main`, currently
  `7ee049c963aec4e30955db14a8f0188de264672b`; not protected when checked.
- Application candidate: draft PR #37, `codex/security-correctness-sep06`.
  Its base is `codex/markets-date-workspace-20260905`, not `main`. Do not merge
  its entire application/Salesforce/dependency diff as a CI bootstrap.
- The trusted authenticated workflow is not yet installed on `main`.
- The protected `fcos-ci-readonly` environment is configured, but its existence
  alone does not make the candidate CI-ready.

Recheck these identities and SHAs immediately before any approved action.

## Scope of the separate governance-only bootstrap

Copy only the reviewed harness dependency closure from the candidate:

- `.github/workflows/authenticated-release.yml`
- `.github/CODEOWNERS`
- `playwright.config.js`
- `config/fcosCiIdentity.js`
- `scripts/e2e-private-state.mjs`
- `scripts/verify-e2e-candidate.mjs`
- `scripts/e2e-protection-state.mjs`
- `scripts/e2e-api-denials.mjs`
- `e2e/auth.setup.js`
- `e2e/workspace-smoke.spec.js`
- `e2e/dashboard.spec.js`
- `e2e/api-denials.spec.js`
- Their standalone trust/private-state/candidate/protection/API/runner tests.
- `docs/CI_READ_ONLY_RELEASE.md` and this review proposal.

Keep the existing reviewed package/lockfile unless an exact harness dependency
is demonstrably missing. Do not copy application CI authorization, Salesforce,
Supabase migrations, generated assets, or unrelated dependency upgrades into
this bootstrap. The harness runs against the separately reviewed candidate,
not the older default-branch application.

The UI-source parity test `tests/e2eDashboardContract.test.js` belongs to the
application candidate: older `main` has a different Account Insight tab label.
Do not change its UI merely to make a governance-only bootstrap test pass.

## Two-stage control installation

1. Prepare a narrow default-branch bootstrap PR containing the trusted harness,
   owner rules and a **secret-free** PR quality workflow. Retire the old workflow's
   credential-bearing PR execution; never leave two active credential routes.
   Preserve normal test, lint, type, build and database checks. The new
   authenticated artifact consumer is installed in stage two, since no trusted
   run can exist before the harness is on the default branch. Do not mark absent
   authenticated evidence as successful or bypass an existing required check.
2. The repository owner reviews the exact bootstrap, approves its installation
   and configures default-branch protection with required workflow-owner review.
   `CODEOWNERS` by itself is not branch protection. The agent does not approve
   its own PR or environment request.
3. Review the exact candidate and its provider-recorded immutable Preview.
   Dispatch the now-trusted default-branch workflow. The human environment
   reviewer approves credential use only for that reviewed SHA and URL.
4. Require successful renewable login, exact CI identity/capability assertions,
   both responsive projects, forbidden-page checks and all eight deployed API
   denials. Payment/Special Terms functional suites are not run with the
   restricted identity; their access-denial checks remain mandatory.
5. Install/require the artifact-consuming `authenticated-browser` quality check,
   referencing the exact successful candidate evidence. Re-run PR checks and
   review the application release separately. A skipped run, generic 403,
   expired artifact, different SHA or older Preview is not acceptance.

No security-setting mutation, workflow dispatch, merge, self-approval or
Production release is performed by this proposal. If existing required checks
prevent stage one, stop for the repository owner's governance decision instead
of disabling or bypassing them.

## Prepared stage-one installation boundary

The `codex/ci-bootstrap-20260908` bootstrap is based on main commit
`7ee049c963aec4e30955db14a8f0188de264672b`. It includes only the harness
closure listed above, owner rules, standalone harness tests, and the secret-free
quality workflow. The old credential-bearing PR browser job is removed. The
stage-two authenticated evidence consumer is deliberately absent; this does
not claim authenticated application acceptance. Normal contract, unit test,
lint, type, source, build, performance, live local migration, and dependency
review checks remain. Package and lockfile are unchanged.

The quality workflow uses only its ephemeral read-only GitHub token for the
pinned contract fetch and disables checkout credential persistence. Renewable
credentials exist only in the manually dispatched protected harness. Installation,
protection changes, environment approval, candidate dispatch and application
release remain separate owner-controlled actions.

The bootstrap disables automatic Vercel Git deployments from main in vercel.json. This prevents its older application baseline from replacing the retained live Production fixes during CI installation. Preview branches remain enabled; Production uses explicit verified deployment.
