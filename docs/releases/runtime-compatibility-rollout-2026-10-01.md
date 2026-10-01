# First-rollout runtime compatibility review

The full v2.0.293 release remains held. Current Production v2.0.288 is commit
`f3472492ff4d0b0c70248a3c8e5c0012981a94b3`, deployment
`dpl_KmyVbNkg7okjW4PPjR8ZJXRz19AL`. Its runtime verification endpoint returned
404 on 1 October 2026. The normal release gate must not manufacture that missing
observation or promote an existing Preview build with Preview configuration.

## Prepared compatibility candidate

Commit `33d97ea74439e27128fd148df78a1e6be6a2f844` starts from the exact live commit.
It adds the authenticated read-only endpoint, source-bound server build receipt,
pure diagnostic catalogue exports and the parser support needed to validate the
new JSON import. The existing canonical connection policy remains verbatim.
Canonical Codex controls are carried into the isolated worktree.

`scripts/verify-runtime-compatibility.mjs <checkout> <production-sha> <candidate-sha>`
compares immutable Git trees and rejects any UI, mobile, cron, dependency,
database-schema, financial-code, Salesforce-metadata or external-action-gate
change. It rejects deletion, executable changes, symlinks and incomplete endpoint
dependencies. Its scope receipt always has `productionAuthorized: false`.

The compatibility branch retains product version 2.0.288: it is a diagnostic
prerequisite, not the v2.0.293 user-facing release. Its generated build identity
distinguishes it from the prior artifact. The later full release must publish
v2.0.293 and its existing complete update history.

## Approved setup and remaining prerequisites

Target repository is `hocheunglai-oss/fcos`; operator is `hocheunglai-oss`.
Target Vercel project is `hocheunglai-6535s-projects/fcos`. Current live
`autoAssignCustomDomains` was changed from true to false with exact human
authorization and verified readback. Existing deployment hooks are empty.
Production remains the exact deployment identified above.

Install reviewed workflows/scripts on protected `main` without weakening strict
required checks, administrator enforcement or the restricted CI identity.
The dedicated release/normal-role environments have been created with pinned reviewer,
`prevent_self_review: false`, `can_admins_bypass: false` and protected-branch
restriction, following the canonical single-operator policy. Their activation
variables remain false. The separate compatibility environment is not created
or authorized. Automatic approval review rejected its inclusion because it was
outside the two environments explicitly approved. Each exact
Production environment run still requires the operator's explicit approval.

The dedicated credential names are `FCOS_RELEASE_GH_TOKEN`,
`FCOS_RELEASE_VERCEL_TOKEN`, `FCOS_RELEASE_RUNTIME_TOKEN` and
`FCOS_RELEASE_PREVIEW_RUNTIME_TOKEN`. Normal verification also requires the
approved existing non-CI identity email and exact-Preview ephemeral state under
`FCOS_NORMAL_ROLE_STORAGE_STATE_BASE64`. None is currently provisioned locally or
in the new protected environments. Provision only through supported secure
provider interfaces; never paste values into chat, evidence or logs, extract
browser credentials, change the machine-wide GitHub login or create an OpenAI key.

## First-rollout evidence and deployment boundary

The separately reviewed bootstrap may address only the missing previous runtime
endpoint for this exact additive patch. This scope proof is not an implementation
of an execution exception. Missing independent bootstrap runtime/compiled/env
and protected UI evidence keeps execution blocked. The normal full-release
collector and executor retain every existing requirement.

Before any permitted domain change, require exact SHA/source/lock/configuration
and archive proof, current provider identity and permissions, baseline scope,
existing UI compatibility, fresh read-only Preview runtime safety and a staged
Production build using Production settings. Confirm its real runtime flags and
provider targets, no new background-action activation, unchanged active
Production, a durable journal and exact human approval. Re-read uncertain
outcomes before retrying. Rollback retains separate human authorization.

After baseline activation, collect fresh authenticated baseline evidence and
complete all ordinary full-release gates within their freshness window. No
Salesforce promotion, live migration, financial transaction, synchronization,
customer sending or AI credential creation belongs to this rollout.

## Publication evidence

The exact compatibility commit was published after the human approved the
specific new-branch ancestry exception supported by immutable scope evidence.
The branch was created from the verified Production commit and pushed with
normal hooks enabled. Draft PR75 contains the candidate. This publication
authorization does not authorize deployment or a general hook exception.

The five approved non-secret Preview settings were applied only to
`codex/runtime-compatibility-20261001`. Its rebuilt immutable Preview is
`https://fcos-hprf6zkyh-hocheunglai-6535s-projects.vercel.app`; READY, receipt and
authenticated UI evidence must still be checked before using it as release proof.

Deployment references: [Vercel staged deploy](https://vercel.com/docs/cli/deploy#skip-domain)
and [Supabase server-side user verification](https://supabase.com/docs/reference/javascript/auth-getuser).
