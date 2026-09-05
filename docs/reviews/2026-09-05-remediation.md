# FCOS review remediation — 5 September 2026

## Scope

Prepared from production commit `7ee049c963aec4e30955db14a8f0188de264672b` in an isolated worktree. Unfinished primary-checkout changes and unrelated documents are excluded. No Salesforce metadata, financial records, invoice documents or emails are changed by this release.

## Implemented

- Restricted Salesforce downloads now require an authorized STEM and live Attachment/ContentDocument linkage. Historical versions are supported. Older unscoped Interoffice bookmarks must be reopened from the STEM; unrestricted-role legacy behavior is retained. The security fix received a fresh independent candidate review.
- Credit contractual dates use the shared override-aware invoice helper: numeric terms count delivery as day one, CIA uses expected delivery minus one, and extra-cost-only dates remain manual. Live issued-invoice/Cashflow evidence and explicit scheduled payments retain precedence. Missing bases remain undated; the targeted statement cache is versioned.
- Bank statement previews preserve same-day source sequence and use running-balance evidence to recognize ascending/reversed layouts. Ambiguous or missing final balances are unavailable, not inferred.
- Bank liquidity reads include all imported actual entries since the reviewed balance, independently of the visible period. Paginated reads fail closed at their safety ceiling. Matches are scoped to visible entries; latest balances are scoped per account. This does not certify that users imported every bank statement; it proves completeness of the returned stored rows, not external bank coverage. Planned/forecast cash semantics are otherwise unchanged.
- One live payment eligibility predicate protects both suggested and confirmed bank matching: date cutover, linked-STEM reliability, exact identity, and deposit/commission/volume-discount exclusions. Source currency behavior remains the existing single-currency Salesforce model.
- Latest-request guards protect Variable Charges, Master Contracts and Markets. Current Variable Charges refresh temporarily disables the edit surface; obsolete responses cannot reset drafts. Contract save responses cannot replace another selected contract.
- Dashboard percentages no longer display USD; monetary cards avoid duplicated currency. Pulse monthly USD/bbl precision matches the board.
- Git credentials use the common Git directory across worktrees, ignore inherited token overrides, and preserve the Salesforce mirror guard without unnecessarily treating a new app-only branch as a metadata change.
- CI checks compatibility and expanded lint/typecheck scope. Explicit browser verification requires a safe pinned preview URL, matching deployed commit and renewable credentials. Performance output distinguishes source checks from runtime measurements and requires server artifacts for strict release verification.
- Protected previews support an optional governed `FCOS_VERCEL_AUTOMATION_BYPASS_SECRET`. It is sent only to the validated preview artifact without redirects; browser access uses context-scoped cookies, not global headers that could leak to other providers. Vercel protection remains enabled. Strict browser traces are disabled to avoid retaining authentication headers or cookies.
- `node scripts/fcos-database-audit.mjs` verifies the exact FCOS project before fixed read-only catalog queries. It exposes no credential, financial, or auth-configuration contents.

## Verified operational evidence

The pinned read-only Management API verified RLS and revoked browser-role grants on 22 bank, Variable Charges and physical-hedge mapping tables. This avoids the failing CLI temporary-database-role path without rotating database credentials. The broader app schema is not certified by that targeted inventory.

Leaked-password protection remains subject to the current Supabase plan: enabling it returned HTTP 402. No paid plan or billing change is authorized by this remediation. Existing authentication configuration remains intact.

## Verification checkpoint

- Local full suite: 1,184 tests passed, zero failed/skipped; lint, typecheck, compatibility and Graph-only checks passed.
- Frontend production build and strict Vercel server-bundle budgets passed.
- The first remediation commit passed GitHub code/database verification, including disposable Supabase migration replay, and dependency review.
- The exact Git-connected preview artifact was verified against its full commit. Otto reached its FCOS login screen; this is not authenticated workspace acceptance.
- No renewable read-only FCOS test identity is currently enabled. The deleted permanent CI viewer was not recreated. Production promotion is held for the authenticated desktop/mobile release gate.

## Release requirements

Run focused/full tests, lint, typecheck, compatibility, Graph-only checks, production build and server-artifact budgets. Verify migration replay in a disposable local/CI database, never the production database. Verify the exact candidate on authenticated desktop/mobile before production promotion. A skipped or disabled browser job is not release acceptance.

This is a bounded remediation of confirmed findings, not a claim that every FCOS workflow has been exhaustively audited. Credential renewal, unavailable licensed security features and future module extraction must not be disguised as completed work.
