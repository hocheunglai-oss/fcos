---
name: fcos-hosted-release
description: Prepare, qualify, resume or verify an FCOS hosted release using its immutable manifest and coordination journal. Use for FCOS release work, not generic deployments or permission to post financial records.
---

# FCOS hosted release

Read the selected checkout's AGENTS.md and `docs/hosted-production-release.md`. Use `config/fcosConnections.js` for targets and `config/release-checks-v2.json` for checks. Read the current canonical release checkpoint and its referenced manifest, journal, setup and human queue; historical chat prompts are not current execution state.

Locate the canonical checkout with `git worktree list --porcelain`, then read its `.fcos-cli/release-state.json` navigation pointer. Follow `workboardPath` and that board's `checkpointPaths`, plus `implementationCheckpointPath`. The pointer locates state; it grants no authority and is not release evidence. If absent, recover the exact existing owner's checkpoint through read-only owner lookup or request its location. Never guess the newest historical output, create replacement state or redispatch to discover an uncertain operation.

## Determine the active path

Source installation is not activation. Verify the admitted immutable controller, setup hash, epoch and actual activation receipt before using the hosted path. Before activation, follow `docs/hosted-release-bootstrap.md` and `docs/hosted-release-cutover.md`; keep one writer coordinator and preserve every unresolved old submission. Never activate a second coordinator or infer permission from an absent lock.

The coordinator must run on the user's selected isolated host, separate from application rollback and without application/Vercel/Xero credentials. If its exact provider/service identity is missing, keep that setup item pending and continue disjoint implementation. Do not create a new host or choose the ordinary application/Edge Function runtime as a substitute.

## Continue from actual evidence

- Resume the same manifest at its first incomplete phase. Use the maintained `scripts/hosted-release*.mjs` entrypoints and their documented inputs; inspect the journal before dispatch. Completed operations are reused. Uncertain submissions permit owner readback only, never automatic retry, adoption, expiry or takeover.
- Reuse passing deterministic evidence only with matching relevant inputs and original timestamps. Refresh volatile observations at their required boundaries. Pending producer evidence is a dependency, not proof of failure; do not regenerate successful suites merely because a run resumes.
- Keep candidate builds credential-free and trusted controller execution separate. Preserve restricted-browser coverage, separate 15-module normal-role verification, server-bundle budgets, Salesforce promotion order and financial preservation evidence.
- Complete preparation before requesting the final Production approval. That approval binds the immutable manifest and rollback policy. Wait outside execution deadlines; execute staging, staged verification, same-build promotion and live verification through the journaled controller. Rollback requires the current release still serving and the recorded previous build still compatible.
- The compatibility successor and final application integration remain distinct releases, separated by required Production observation. Preserve frozen histories and separate status/supplier scope approvals. A security correction must be explicitly included in new reviewed source, never silently substituted under an old hash.

## Human handoff and completion

Honor existing valid authorization. Do not add routine chat readiness or Mac signing handoffs to the qualified hosted path. Stop only at an actual credential-entry/platform approval, missing setup input, evidence failure or exhausted authority. Keep related repairs on the existing consolidation PR.

Notify when approval is actionable, intervention is required, rollback occurs or deployment completes. Verify actual iPhone receipt during setup; a generated event does not prove delivery. Report queue, compute, approval and recovery time separately using `scripts/hosted-release-report.mjs`. Production completion requires actual deployed target/domain/runtime, mandatory checks, preservation and cleanup; local tests and elapsed time are not deployment proof. This skill grants no new action authority.
