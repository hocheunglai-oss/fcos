# FCOS Project Connections

These connection identities are specific to this repository. Do not infer or reuse an account from another Codex project.

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

Before any GitHub mutation, verify the authenticated GitHub identity. If the GitHub CLI identity is not exactly `hocheunglai-oss`, do not attempt a command-line push and do not change machine-wide credentials. Use the authorized GitHub connector for this repository or stop with a clear account-mismatch message.

Before any Supabase, Vercel, or browser mutation, verify the target project or profile against the identifiers above. Fail closed on a mismatch.

Before any Salesforce metadata mutation, verify the exact org ID, username where pinned, and sandbox flag. DEVEE is the only development/source environment. Make and verify every Salesforce code or configuration change in DEVEE first; do not develop independently in QAT or Production.

Salesforce browser authentication is an environment-specific, authentication-only fallback after the CLI is blocked. Use `Otto` for DEVEE or QAT, `Vincent` for Production, and return immediately to CLI verification. Never store, inspect, export, or attest browser credentials or passkey material. The `vincexai` profile remains exclusive to the shared Salesforce GitHub repository and must not be used for Salesforce org login.

The mandatory Salesforce promotion order is:

1. Deploy and verify the complete owned metadata tree in DEVEE.
2. Synchronize the byte-equivalent DEVEE source to the shared Salesforce GitHub repository.
3. Promote the same verified source from DEVEE to QAT and verify it there.
4. Promote the same verified source from QAT to Production and verify it there.

Never skip or reorder these stages. The shared Salesforce repository represents DEVEE only and must never be synchronized independently from QAT or Production. Production remains the FCOS runtime environment, but it is not a development source.

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
