# FCOS 2.0.204 reconciled release

## Source and rollback

The release branch `codex/reconciled-release-20260908` combines current `main` (`7ee049c963aec4e30955db14a8f0188de264672b`) with PRs #33 through #38, preserving merge history. The Salesforce metadata tree is byte-identical to main; no Salesforce promotion is part of this web release.

Production was independently verified as `dpl_7mqpjQG3he2duKsAx7ViQ7wVoGkg`, version 2.0.192, commit `6fb6ab6aa10824e22adc15d2c3301afd34d2def7`, `gitDirty=1`. The live app-version build ID and timestamp exactly match the retained primary checkout `.vercel/output`: `6fb6ab6aa10824e22adc15d2c3301afd34d2def7-2026-09-06T16:19:36.823Z`. This artifact remains untouched and is the rollback target.

The retained 130 packaged server/config/source files were compared with the dirty checkout. Only three differ, all because of later Market Assistant additions. The live Account Credit supplier-payables bridge and Xero financial reconciliation fixes were selectively ported with their tests and associated frontend source. Newer main due-date, Variable Charges fixed pricing, GM reopen, invoice approval and post-write recovery behavior is preserved. The post-artifact Market Assistant work and unrelated documents remain in the original checkout. Original frontend source maps were not retained; authenticated candidate acceptance remains required.

## Reconciled behavior

- Dashboard, Account Insight, Markets date/evidence features, reviewed document and session protections, bank evidence and refresh-race fixes, and FCBS settlement are integrated.
- Credit uses issued invoice evidence, override-aware dates and inclusive contractual terms alongside the live supplier bridge. An operational subset is explicitly distinguished from full GROUP reconciliation.
- Legacy FCOS password CI assertions are replaced by the pinned FCUNO read-only harness. Release verification uses its canonical candidate URL, exact SHA, independent vercel[bot] deployment provenance, private state and cleanup.
- All five non-secret Preview flags are scoped to this release branch: client OIDC, server federation, pinned issuer, read-only CI and explicit Salesforce-write disablement. Existing Preview secrets are retained; no Production secrets were copied.
- Terser 5.51.2 provides production minification with two compression passes. The existing client/server budgets are unchanged.

## Verification

- All 1,369 integrated Node tests, lint, type checking, compatibility registry and pinned FCUNO contract checks pass.
- Hosted Preview-configured and Production-configured Vercel builds and strict client/server bundle budgets pass.
- Clean dependency installation reports zero known vulnerabilities.
- All 155 migrations replayed successfully from an empty database and through the upgrade fixture on disposable Supabase Postgres 17.6.1.158. Checks include RLS, browser grants, service-only RPCs, indexes, and preservation of a legacy issued FCBS invoice's basis and amounts. The task-owned local database and volumes were removed afterward.
- Live migration history confirms both September 5 report-preset migrations are already applied. Only `20260906161240_restrict_browser_role_admin_grants.sql` and `20260908074607_fcbs_own_account_settlement.sql` remain pending; confirm exact filenames before execution.

## Remaining governed sequence

1. Owner approval for installation/protection was received in this task. Review/install the separate narrow `codex/ci-bootstrap-20260908` PR on main, then protect main with workflow-owner review. It removes the legacy credential-bearing PR job; it deliberately does not install the candidate-evidence consumer before a trusted run can exist.
2. Use the exact READY Git-linked Preview and SHA for this release. Dispatch the trusted default-branch workflow; its protected `fcos-ci-readonly` environment requires human approval. All three secret names and the enable variable are present; secret contents were not read. main was verified unprotected during this reconciliation.
3. Complete the governed FCUNO identity prerequisites if login rejects it, retain NONE/no workspace permissions and the inactive zero-permission FCOS profile. Do not bypass identity or environment approval.
4. Require exact-candidate authenticated responsive tests and read-only FCBS/Account Insight acceptance. Apply the two pending reviewed migrations only as part of controlled release readiness, then verify live service-only grants/RLS.
5. Merge/promote the verified release with Production configuration, preserving the Preview-only read-only/write-disable flags' environment scope. A Preview artifact with Salesforce writes disabled must not be blindly promoted to Production. Verify Production auth, version, critical read flows and runtime errors; retain the previous immutable deployment for rollback.

No financial record, email, Salesforce metadata, Production migration or Production alias was changed by preparation. Do not describe this candidate as Production-deployed before all remaining gates pass.

Automatic Git deployments from main are disabled in vercel.json to prevent CI-only or unreconciled merges from replacing Production. Preview Git deployments remain active; Production deployment is explicit after verification.
