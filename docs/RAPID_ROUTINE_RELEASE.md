# Coordinated routine release

This change groups the existing read-only and separate normal-role verification into one manual run and starts both jobs together. The required quality consumer accepts their exact successful completed run, avoiding a duplicate protected authentication dispatch. The release collector can also reuse exact successful code/database evidence when only the authenticated-artifact consumption job failed. All three required merge checks still have to pass.

## Available behavior

After reviewed installation on protected `main` and legitimate activation of the repository variable `FCOS_ROUTINE_RELEASE_ENABLED=true`, dispatch `routine-release.yml` from the default branch with a full lowercase `expected_commit`, its immutable `candidate_url`. Both verification jobs wait at their existing separate environments:

- `fcos-ci-readonly`: the existing renewable CI identity and restricted browser harness.
- `fcos-normal-role-verification`: the existing approved non-CI identity, real module data and read workflows.

The operator can select both pending environments in one GitHub review window. The jobs run in parallel and keep their credentials separate. They execute protected-main harness code, not candidate repository code. The existing protected Production workflow can consume these completed artifacts. The standalone verification workflows remain supported.

The new workflow does not install credentials, update environment settings, dispatch another workflow, alter migrations, or widen financial authority. It has no push trigger. Its action implementations are pinned to immutable commits. Per-candidate concurrency prevents duplicate routine verification. The standalone Production workflow and its existing serialization remain unchanged.

## Trust and evidence reuse

Coordinated verification requires the exact repository, current protected-main SHA, workflow path, manual event, pinned operator and triggering operator, first attempt, complete three-job list, successful dispatch guard and both successful verification jobs. Artifact creation must fall within its producer job, and each original completion time remains bounded by 1,800 seconds. Both real personal environment approvals are read from GitHub; a local success flag or a run name cannot substitute. Default-branch and enable state are rechecked after collection.

Running, failed or cancelled workflows, reruns and partial or ambiguous job/artifact lists are rejected. There is no new Production job, OIDC subject or Production workflow admission route.

For quality reuse, only a completed first-attempt PR run whose **only failed job is `authenticated-browser`** qualifies. `code-and-database` and `dependency-review` must both be successful in that exact run, SHA and attempt. The archive digest, original artifact time, candidate SHA, lock hash and byte equality with protected-main `quality.yml` are still required. No test command is omitted and no original timestamp is refreshed. Readiness separately continues to require protected authenticated and normal-role evidence. All three strict required merge statuses remain mandatory; this reuse is not a merge-check override.

The current `quality.yml` authenticated consumer retains the standalone route and adds the coordinated route. It reads the exact successful first-attempt run, all three jobs, both personal approvals, the protected environment policies, and both bounded artifact archives with matching API digests and payload identity. Both artifacts must refer to the same immutable candidate and protected-main harness. It rechecks the protected-main SHA before accepting. It has read-only permissions, no checkout, no credentials and no provider-write authority. If the PR check ran before verification completed, rerun only its failed consumer job after evidence is ready; another protected authentication run is unnecessary. The immutable 72d quality file remains as a hashed historical fixture, and reconstruction tests prove the source change is limited to the reviewed consumer block.

New workflow and helper bytes participate in release, compatibility and Preview control fingerprints. Existing exact contracts and accepted receipts must be recollected against the final installed source where those fingerprints change. Frozen first-rollout evidence is not silently rebound to this branch.

## Production coordination boundary

This workflow only verifies. The existing Production executor, OIDC allowlist, durable journal, staged-build/readback and promotion implementation are unchanged. A combined automatic Production path is outside this patch because its required generic shared lease admission is not yet installed.

The available shared lease bridge is intentionally scoped to the exact first Preview operation:

- `preview-email-coordination.mjs` pins `preview-email-proof-build.yml`, the exact `SUCCESSOR_LIVE_CONTRACT` source tuple and `fcos-preview-email-{run}-UUID` operation identity.
- `preview-email-coordination-ledger.py` accepts only that operation family and permanently consumes it while holding the canonical local `WriteLease`.
- The hosted collector requires job `proof`, the exact Preview candidate, an original trusted intent, current signed issuance authority and a scoped signed grant. Its protected-action admission remains disabled.

There is no reviewed generic Production grant, issuer, immutable hosted consumption receipt, or uncertain-outcome recovery interface. Reusing the Preview grant for routine Production would break its operation scope. A complete Production bridge must bind the repository/environment/run/job, candidate/source/lock/configuration, original durable intent and previous Production; claim the same canonical lease and permanently consume the operation before signing; verify the real pinned signature and original deadlines on the hosted runner; retain the lease through staged build, promotion and public readback; and leave uncertain outcomes locked for readback. The existing Preview bridge and first-rollout guards are unchanged.

This implementation is an executable **coordinated verification improvement**. It does not claim unattended Production admission or first compatibility rollout completion.

## Operator steps and timing

For routine releases using the existing Production path after its own legitimate activation:

1. Obtain current exact-SHA quality and immutable Preview evidence. Preserve the required PR merge checks.
2. Dispatch the coordinated verification run once and personally approve both pending environments together.
3. If the strict PR consumer previously failed awaiting evidence, rerun only that failed job; it can now consume the coordinated result. Complete the required source merge checks.
4. After both verifications and all required source checks succeed, use the existing Production workflow with the reviewed SHA/source/configuration pins and personally approve its protected environment. Existing staged `--prod --skip-domain`, READY/source/runtime verification, same-build promotion, public readback, durable journal and rollback reference remain mandatory.

This reduces three separate protected workflow dispatches to two and allows the two verification approvals in one review window. A failed PR consumer may still need its lightweight rerun; it no longer requires duplicate protected authentication. A genuinely one-dispatch Production release remains dependent on the reviewed shared lease interface above; do not present it as activated.

The verification critical path changes from `restricted + normal-role` (when done sequentially) to `max(restricted, normal-role)`. The saving is the shorter verification duration plus one dispatch/handoff. When the two older workflows were already started in parallel, the compute saving is zero; the review/dispatch reduction still applies. Successful quality jobs are reused instead of rerunning their code/database work. If strict merge statuses are still pending, their existing authenticated-artifact consumption check still has to pass.

The recent exact-72d hosted measurements were Preview 146 seconds, code/database 202 seconds, and protected authentication 122 seconds, excluding human waiting. Independent Preview and quality work can overlap; authentication starts after Preview. That part of the critical path is `max(202, 146 + 122) = 268 seconds` (4m28s), compared with 470 seconds (7m50s) if all three are serial. This is a planning calculation from the observed component durations, not an observed complete release. The normal-role, 15-module, disposable DEVEE Nom B, stronger compatibility, schema and staged Production durations have not been established here. Future routine releases can reasonably target a 15–30 minute ready-candidate window, but only a real activated run can establish that performance.

The 1,800-second run/evidence limits, 600-second Preview contracts, 30-minute action and 45-minute private/personal contracts are unchanged. Human/runner queues count against applicable original deadlines. Missed deadlines require fresh evidence, never an extended timeout. The previously reported 425 checks for the current Production source were check-only validation, not an actual deployment or current live acceptance.

### Remaining source boundaries after PR 101

The source contract explicitly defers final commit `2f4bca02e94105681dedf674985e052169602492`, and the canonical coordinator requires an actually observed Production successor before the combined final signer/admission/baseline update. It also preserves separate 19-status-path and 16-supplier-path integration scope. These are scope boundaries, not 35 separate PRs, and unrelated open PRs are not the release backlog count.

The absolute lower bound is **two subsequent coherent source PRs** if the optimization and executable shared-coordinator/first-compatibility controls are bundled, followed after the live observation by a reviewed combined final signer and full-release integration. With this optimization delivered separately and the bridge still requiring material implementation/review, a realistic planning range is **three to four PRs after PR 101**:

1. This workflow/evidence optimization and exact canonical project control carryover.
2. Executable shared-coordinator admission and first compatibility rollout controls, tested against the actual hosted duplicate/crash/readback boundary.
3. After the actual compatible Production observation, the combined final signer/admission/baseline and full-release integration; split into two PRs if keeping those review scopes separate is necessary.

The 19-status and 16-supplier source deltas can share the eventual full-release integration PR only while retaining their separate ownership, exact source manifests, financial fingerprints, affected tests and release gates. They cannot be folded silently into the frozen first compatibility candidate, and publishing source is not authority for live financial application. Do not merge the old reconciliation branch wholesale.

At least **two genuine Production stages** remain: the stronger compatibility successor and then the final full application. Code/Preview/check-only success does not collapse those stages. There is no evidence-based fixed date for “all changes in Production” yet: the executable bridge, new source-bound private readiness, all 15 modules, disposable DEVEE Nom B, schema/ACL checks and actual protected approvals still control the critical path. Complete source work can proceed before that human window; collect ephemeral evidence together once its prerequisites are ready.

A low-confidence engineering forecast for the remaining three to four PRs is **8–16 active engineering hours**, roughly one to two focused working days, plus hosted execution and human/provider waiting. This is not a wall-clock deadline. The main unknowns are the actual hosted shared-lease duplicate/crash recovery behavior, first compatibility cutover and readback, observed-Production-dependent signer integration, and fresh private/15-module/DEVEE Nom B acceptance. Failures or changes there can extend the forecast. The 15–30 minute routine-cycle target applies only after this source work, credentials, gates and fresh evidence are ready.

### Canonical project controls

The PR includes the exact two canonical setup copies, `.codex/config.toml` and `.codex/control-policy.json`, under the standing FCOS worktree control policy. They carry the reviewed task/provider approval configuration into this worktree; no machine-wide setting was changed. `vercel.json` additionally disables automatic Git deployment for this exact optimization branch; all existing branch mappings and Production behavior are preserved. The v4 offline current-source fixture binding includes these published bytes and the new trust closure. Its v2/v3 history, frozen objects, public manifests and first-rollout assertions remain unchanged.

GitHub supports selecting multiple pending environments in [one deployment review](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments). Vercel documents [staging and promotion](https://vercel.com/docs/deployments/promoting-a-deployment); a staged Production build is promoted without rebuilding.
