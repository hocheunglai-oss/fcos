---
name: fcos-project-doctor
description: Diagnose FCOS project setup, connection-policy conflicts, control drift and source/configuration mismatches. Use for FCOS environment checks; not a full business-logic or security audit.
---

# FCOS project doctor

Read AGENTS.md in the actual checkout. Run `node scripts/fcos-project-doctor.mjs` for the maintained read-only local checks. Use `npm run verify:controls` for control validation. Do not substitute an expected branch name for the actual Git branch, SHA or dirty state.

Resolve targets from `config/fcosConnections.js`, not copied IDs in this skill. Verify a capable CLI's exact account/repository/project/environment first; use a target-locked connector/API if the CLI cannot safely do the operation. Browser use is the final fallback under the current profile policy. Do not switch machine-wide credentials to force access.

Compare only relevant layers: canonical checkout, selected worktree, immutable release source, remote main and deployed source. A dirty checkout is not remote main. Check effective source configuration overrides before calling a dashboard default a conflict. Inspect environment names/scopes and sanitized validation results; never dump values or credential stores.

For browser authentication configuration, consult `shared/authRuntimePolicy.js`, `src/lib/supabaseClient.js` and `scripts/verify-fcuno-build-environment.mjs`. For federation defects, use `$fcos-fcuno-contract`. For release state, use `$fcos-hosted-release`; a doctor check cannot qualify or activate a deployment.

Report confirmed conflicts with source references, their practical effect, and the smallest coherent correction. Separate live observations, static findings and unverified assumptions. Save fingerprints and compare against the prior report when available; keep unchanged scheduled checks quiet. Do not broaden a missing local command into a full provider inventory or test suite.

Repair source/config/tests together in an isolated worktree. Preserve unrelated dirty work and synchronize control hashes through the maintained control policy. Do not change global permissions, credential values, provider settings or Production merely to make a diagnostic pass. Apply the current usage/model policy rather than copying a historical threshold. This skill is read-only by default and grants no mutation authority.
