# FCOS Project Connections

These connection identities are specific to this repository. Do not infer or reuse an account from another Codex project.

For every external connection, check whether a capable, correctly authenticated, target-locked CLI can complete the operation safely and use it first. If the CLI is unavailable, lacks capability, or is authenticated to the wrong target, use a verified purpose-built API or connector next. Use the pinned Chrome profile only when both non-browser routes are blocked or the user explicitly requests browser interaction. Verify the exact account, organization, project, repository, environment, scope, and permissions before any read or mutation at every layer. Fail closed on a mismatch.

- GitHub repository: `hocheunglai-oss/fcos`
- Required GitHub account for mutations: `hocheunglai-oss`
- Vercel project: `hocheunglai-6535s-projects/fcos`
- Supabase project: `pjforfvchygdyqfcgpmw` (`FCOS`)
- Salesforce Production: `00D2x000000Ei4oEAC` (alias `source-salesforce`)
- Salesforce Devee sandbox: `00D1m0000008kioEAA` (alias `fcos-devee`, username `vincent@cosulich.com.hk.devee`)
- Salesforce QAT sandbox: `00D1s0000008lFEEAY` (alias `fcos-qat`, username `vincent@cosulich.com.hk.qat`)
- Shared Salesforce GitHub repository: `ivanyk20/fcbhk` (`src/` mirror)
- Required shared-repository GitHub account: `vincelessxai` (isolated config `.fcos-cli/github-vincelessxai`)
- Primary GitHub/FCOS browser profile: `Otto`
- Salesforce DEVEE/QAT browser authentication profile: `Otto`
- Salesforce Production browser authentication profile: `Vincent`
- Shared Salesforce GitHub/browser profile: `vincexai`
- Google Drive market-report account: `vince.less@gmail.com`
- Google Drive market-report browser authentication profile: `Vincent`
- Google Drive market-report root: `1wzRycxzPAb42EvfhjPV22mkFwliXZv8d` (`Bunkerwire`: `19ACtDV2U9_JrV_AmRJuHL7A29-Yxini7`; `European Marketscan`: `14uXNTTleIO2K78gTEVDEAl8IfJZH4Aj1`)

Use a capable, target-locked GitHub CLI for this repository first, after verifying its exact account and repository. If the GitHub CLI identity is not exactly `hocheunglai-oss`, do not attempt a command-line push and do not change machine-wide credentials. Use an independently verified authorized GitHub connector/API instead, or stop with a clear account-mismatch message when neither route matches.

Before any Supabase, Vercel, or browser mutation, verify the target project or profile against the identifiers above. Use a capable, correctly authenticated target-locked CLI before the approved API/connector, and use Chrome only as the final fallback. Fail closed on a mismatch.

`config/fcosConnections.js` is the canonical machine-readable source for external provider identifiers and Salesforce environment identity. API modules and operational scripts must import its helpers instead of repeating org IDs, project refs, aliases, usernames, or instance URLs. A provider-specific connection check must merge into the existing safe local status; only a complete four-provider check may replace the full snapshot.

Google Drive market reports use the dedicated `GOOGLE_DRIVE_MARKET_REFRESH_TOKEN` with the approved server OAuth client. The separate legacy XLS Report Archive is retired; local XLS downloads remain available and must not be uploaded by FCOS. For Codex operational access, use a capable, correctly authenticated target-locked CLI first, the Drive API or connector when the CLI cannot safely complete the operation or has the wrong target, and Chrome profile `Vincent` only when both non-browser routes are blocked. The FCOS server continues using its dedicated Drive API integration. Verify `vince.less@gmail.com` before authorizing and return immediately to server/API verification. Never store or expose Drive credential material.
Treat Google OAuth `invalid_grant` as revoked authorization, not as a report-parser or market-data failure. Hourly retries may continue recording the deduplicated incident, but recovery requires an explicitly authorized reauthentication and replacement of only the pinned Drive OAuth credentials.

Before any Salesforce metadata mutation, verify the exact org ID, username where pinned, and sandbox flag. DEVEE is the only development/source environment. Make and verify every Salesforce code or configuration change in DEVEE first; do not develop independently in QAT or Production.

Salesforce browser authentication is an environment-specific, authentication-only fallback after both the API and CLI are blocked. Use `Otto` for DEVEE or QAT, `Vincent` for Production, and return immediately to API or CLI verification. Never store, inspect, export, or attest browser credentials or passkey material. The `vincexai` profile remains exclusive to the shared Salesforce GitHub repository and must not be used for Salesforce org login.

The mandatory Salesforce promotion order is:

1. Deploy and verify the complete owned metadata tree in DEVEE.
2. Synchronize the byte-equivalent DEVEE source to the shared Salesforce GitHub repository.
3. Promote the same verified source from DEVEE to QAT and verify it there.
4. Promote the same verified source from QAT to Production and verify it there.

Never skip or reorder these stages. The shared Salesforce repository represents DEVEE only and must never be synchronized independently from QAT or Production. Production remains the FCOS runtime environment, but it is not a development source.

## Browser-control cleanup

- Keep browser use as the final fallback described above. When browser verification is required, track every tab and browser-control session opened by the task.
- Before the final response, close every tab opened by the task and release the browser-control session/runtime using the available browser API. Do not leave a browser session alive merely to preserve inspection state.
- After cleanup, verify that no process matching `trusted-worker.js /Users/vincex/Documents/FCOS` is consuming sustained CPU. If the current task's worker remains after its browser session is closed, terminate only that exact worker after verifying both its full command and FCOS working directory. Never terminate another project's or another active task's worker.
- If cleanup cannot be completed safely, report the remaining worker and exact next step instead of presenting the task as fully finished.

If a Salesforce change causes a deployment failure, test failure, or unexpected behavior, stop promotion and identify the problematic DEVEE change. Salesforce deployments must be all-or-none. Restore every affected environment to the last known working source in reverse promotion order where necessary. If the change originated in DEVEE, restore DEVEE and synchronize the reverted DEVEE source to the shared repository before promotion resumes. Never introduce an independent fix directly in QAT or Production.

Every DEVEE-deployed Salesforce metadata change must also be published byte-for-byte from `force-app/main/default/` into the established `src/` layout of `ivanyk20/fcbhk` before QAT promotion. Use only the isolated `vincelessxai` GitHub configuration, preserve unrelated shared-repository files, and update the current open draft PR or create a new draft PR when none is open. The publication command must require a fresh, successful DEVEE deployment proof for the exact source-tree hash. A Salesforce promotion is not complete until `npm run salesforce:mirror:verify` passes. Never merge the shared PR unless the user explicitly requests it.

## Salesforce promotion performance and resume policy

- Run focused DEVEE validation for changed Apex and metadata before the full promotion. Resolve schema, field-access, validation-rule, and baseline-test drift there before starting a complete run.
- Require LF line endings throughout `force-app/main/default/` before deployment. Byte-equivalent mirror verification must pass before QAT; do not discover line-ending normalization after a full test suite.
- A new-schema cutover uses a small reviewed bootstrap manifest before the complete package: `NoTestRun` in DEVEE/QAT and `RunRelevantTests` in Production. Assign the data/FLS permission after bootstrap, then run `RunLocalTests` once for the complete package. Never run the full suite merely for a schema-only bootstrap.
- Preserve every successful validation and deployment job ID with the exact source-tree hash. If the CLI wrapper stops after a successful validation, quick-deploy that same job. Do not repeat validation.
- When a downstream stage fails and `force-app/main/default/` has not changed, resume at that failed environment after rechecking upstream deployment reports, the DEVEE source hash, the shared mirror, org identity, and permissions. Do not rerun completed DEVEE or QAT stages.
- Restart from DEVEE only when the authoritative Salesforce source tree changes. Script, documentation, FCOS frontend, Supabase, or deployment-orchestration changes do not invalidate an already successful Salesforce source hash.
- Prefer a targeted configuration correction and focused tests for confirmed environment drift, then resume the pending environment. A targeted correction must still originate in DEVEE, update the shared draft PR byte-for-byte, and pass through QAT before Production.

## Dashboard STEM XLS export format

- Do not change the existing Dashboard STEM XLS export format unless the user explicitly requests a format change.
- Preserve the `.xls` file format, worksheet structure, column labels and order, date and number formatting, styling, and delivery-period/filter filename convention.
- Keep thousands separators for all monetary amounts and quantities. Keep the standalone Currency column removed from the STEM worksheet, while preserving currency identification in amount headers or cell formats and separate currency totals.
- Data, calculation, filtering, and export-completeness fixes must preserve this presentation format.

## Mobile-view development suspended

- Effective 29 September 2026, suspend all mobile-view development until the user explicitly resumes it.
- Focus new UI work on the desktop view. Do not initiate mobile-specific features, layout changes, redesigns, optimisations, or mobile-only bug fixes during this suspension.
- Preserve the existing mobile implementation. Shared functionality may continue to evolve for authorised desktop or backend work; keep existing regression checks and do not intentionally break mobile behaviour.
- Carry this policy into FCOS worktrees and delegated task instructions. Resume mobile-view development only on an explicit subsequent user instruction.

## Performance reviews during long-running work

- Treat the user's elapsed-time priority as an implementation requirement. Before scaling a repetitive workflow, measure one representative batch: elapsed time, provider calls, database requests, rows loaded, and verified outcomes.
- Review the implementation proactively after the first batch, at phase boundaries, and roughly every 15 minutes of sustained repetitive work. Review sooner when throughput is materially below the estimate, the same failure repeats, or repeated scans, reads, manual steps, or retries dominate the work.
- Normally spend 2–5 minutes on a focused review, then make the smallest safe improvement within the authorised scope without waiting for the user to request it. Use more time when a material financial or security risk requires it; avoid repeated planning and duplicate reviews.
- Prefer complete saved evidence, fresh reads of changed records and required dependencies, bulk provider reads, bounded concurrency, efficient audited transactions, and automatic progression through already-approved unchanged batches. Do not re-read a whole backlog for each small batch unless a documented correctness dependency requires it.
- Preserve exact identities, approval fingerprints, ownership, financial and settlement checks, quota reserves, cancellation, durable intent and uncertain-outcome readback. Performance improvements must not expand financial authority or silently mark unresolved records complete.
- After an improvement, run one focused correctness and throughput check, record the before/after result, and resume the saved continuation point. Repeat completed checks only after relevant changes or failures; retain required migration and exact-commit release checks.
- Pipeline independent batch preparation with execution: while an approved batch is applying, use complete saved evidence to classify the next disjoint batch, resolve its dependencies, build a business-readable review, and estimate its call budget. Do not wait for the current batch to finish before starting this preparation.
- Keep at most one prepared batch per independent action category ahead of execution. Reuse its saved work, then recheck changed records, exact evidence fingerprints, required dependencies and shared quota before approval or application. Keep Contact creation, draft creation and link-only approvals separate.
- Preparation may run concurrently through bounded read-only work and local analysis; financial application remains serialized by the existing durable locks. Avoid duplicate provider reads and do not consume another batch's reserved verification capacity. A preparation agent must never grant an approval or start the next batch on its own.


## Xero sales invoice presentation

- Effective 30 September 2026, keep new eligible sales invoices in one summary line: quantity 1, the full invoice total including all verified products and charges, and INVOICE d/M/yyyy using Buyer Invoice Date.
- Retain the approved common account and NONE tax; approved petroleum sales use 41100 Trading Sales / NONE. Mixed accounts or incompatible tax require a specific Finance exception, never silent reclassification.
- Preserve source product, quantity and charge evidence, existing Xero invoice and bill details, accepted link fingerprints and financial controls. Supplier bill presentation is unchanged.
- A presentation instruction is not approval to create drafts, send invoices, post payments or alter allocations. Refresh changed draft proposals and bind creation approval to their exact new evidence.


## Codex development, isolation and verification

- Inherit the global quality-first model routing: Sol High supervises normal work, Sol Extra High owns difficult or material-risk decisions, Terra High implements bounded routine work, and Luna High handles simple checks. Classify delegated work explicitly and keep Standard speed unless the user requests Fast for an urgent task. Preserve the 20% remaining-usage reserve.
- For an authorized development task, complete in-scope code, tests, draft PRs and verified Preview work without unnecessary stops. Production release or promotion, live database changes, financial actions, customer sending and credential replacement require explicit human authorization for the exact action and target. Reuse existing valid authorization; do not request it again merely because a task moves to another phase. Existing financial fingerprints, locks, approvals and release gates remain mandatory.
- Use the FCOS workspace sandbox with on-request approval and automatic review. SQL and migration connector prompts remain human-reviewed. Automatic review is advisory control at an approval boundary; it does not grant financial or Production authority or replace application-side controls.
- Start each independently edited concurrent task in a separate FCOS worktree. Give each chat and delegated worker clear file ownership, inputs and acceptance criteria; do not concurrently edit overlapping files. Keep at most two active delegated agents per FCOS chat, and delegate only when it improves elapsed time or verification quality.
- Preserve the unfinished main checkout and unrelated work. Choose the intended task base explicitly, and transfer only needed uncommitted changes with reviewable evidence. Never reset, stash, clean, commit or publish another task's changes to make a worktree convenient. A settings rollout may update these shared control files in place when explicitly authorized.
- Before editing a new FCOS worktree, carry over the current FCOS AGENTS.md and .codex controls using the canonical project's .codex/setup.mjs. It verifies the shared Git repository, refuses conflicting local control edits, and does not copy credentials, .env files or other application changes. Reload the chat after copying config if it was started before those controls existed. Existing selected model and permission modes can override saved defaults; verify the composer controls.
- During editing, run meaningful focused checks for the affected behavior. Preserve results with the exact source or commit hash, dependency lock hash, runtime/tool version, target environment, command, time and outcome. A failed, missing or mismatched proof cannot be reused. Keep evidence in the task's outputs directory, without credential values.
- Reuse successful checks only while their relevant source, dependencies, runtime, configuration and environment assumptions remain unchanged. New relevant edits, failures, changed provider identity, expired authentication or required fresh live readback invalidate the affected proof. Do not repeat completed checks solely because the chat resumes, a helper stops, or unrelated files change.
- Run all project-required release checks against the final candidate, retaining exact-commit Preview, migration, compatibility, performance and authenticated browser requirements. Local fixtures or focused tests do not replace required live evidence. Preserve successful Salesforce source-tree validation job IDs and resume rules above.
- Measure a representative batch or check before scaling repeated work. Record elapsed time and provider calls, then reduce duplicate reads and unnecessary full-suite runs without dropping required checks. Continue from the saved verification and promotion stage when evidence remains valid.
- Use the configured setup command to install locked dependencies for a new worktree. Do not automatically run the full build, test suite, release gate, provider authentication, live migrations or deployments during setup. The local environment actions are conveniences, not authorization to release or alter live records.
