# FCBS own-account settlement — verification and release hold

## Scope

Only hedges whose original counterparty is FCBHK and venue is FCBS receive the new `fcbs_own_account_venue` document basis. The external recipient is the exact configured FCBS legal entity. Internal allocation remains visible and is not added to exposure, fees or P&L a second time. Existing external-customer documents retain `counterparty` basis and their calculation behavior.

Reviewed monthly settlement uses final verified MOPS, FCBHK-perspective gross result and the original hedge's FCBS venue fee. Positive net produces a Debit Note to FCBS; negative net produces a Credit Note/payable. Zero, unavailable, incomplete and stale evidence cannot produce a new settlement. No FCBHK self-invoice is permitted.

## Verification completed

- Read-only Production acceptance: the exact 4 August 2026 S0.5 BUY, 170 MT, FCBS/FCBHK hedge has price 733 and August verified actual average 736.001. Gross 510.17 less the 85 venue fee gives 425.17 receivable from FCBS. It has no existing invoice link. No record was changed.
- 1,242 Node tests passed, including executable PostgreSQL migration tests, calculation fixtures, API guards, canonical PDF generation and UI contracts.
- Lint, type checking, build, local migration integrity, compatibility and performance checks passed.
- PostgreSQL tests cover all-or-none invoice/line/link saves, idempotency, revisions, source fingerprints, duplicate month/hedge rejection, self/mixed-venue guards, child reassignment, issued immutability, in-flight/uncertain email freeze, status-only transitions and revoked browser access.
- Synthetic PDFs inspected: positive and negative one-page documents and 30 hedges across three A4 pages. Direction, amounts, item counts, page headers and footers agree. These are QA artifacts, not issued documents.
- Otto Chrome inspected the real Settlement component with disconnected synthetic data at desktop and 390px mobile. Both allocation and external settlement panels show the correct signs, recipient and payment direction. The review drawer is usable; Escape restores focus. Settlement tabs now scroll within the viewport (390px document width), not across the page.
- Browser fixture is NOT authenticated candidate verification. All fixture API actions are disconnected. Task tab, viewport override and local server were closed/reset.

## Not released

The additive migration `20260908074607_fcbs_own_account_settlement.sql` has NOT been applied to Production. No settlement invoice, PDF storage record, email or Salesforce mutation was created by implementation or verification.

Production's retained CLI artifact is deployment `dpl_7mqpjQG3he2duKsAx7ViQ7wVoGkg`, version 2.0.192, claiming commit `6fb6ab6aa10824e22adc15d2c3301afd34d2def7` with `gitDirty=1`. Its source is not equivalent to this isolated branch (`ec254e59896a0040baf09e62d1ba518aa48349e3` base), nor to the current dirty main checkout. Server sources can partly be recovered from the retained `.vercel/output`; original frontend source maps were not retained. Promoting this branch directly would risk replacing unrelated live changes.

Retained rollback artifact tree SHA-256: `27beef473b7bcfeb651ae96ac9b9a04c90a47c53867dcb402e750bb741e1f4f0`. Preserve this artifact; do not overwrite it with a new local build.

The branch's dependency audit also reports four pre-existing transitive advisories (`@humanfs/node`, `browserslist`, `fflate`, `postcss-selector-parser`). The new test-only PGlite dependency is not one of them. The separate reviewed hardening branch addresses those dependencies; integrate deliberately rather than overwriting its lockfile.

## Remaining release sequence

1. Reconcile the retained live artifact, outstanding release branches and dirty main-checkout changes into a reviewed source baseline. Preserve unrelated Account Credit, Variable Charges, Xero, Markets and Salesforce work. Do not include unrelated employment documents.
2. Integrate this feature and the reviewed dependency/security fixes. Repeat full checks against the integrated source and disposable full migration replay; resolve any conflicts explicitly.
3. Deploy the exact integrated Git SHA to the pinned FCOS Vercel Preview. Apply the additive migration through the pinned Supabase migration workflow only when ready for the controlled release; verify live grants/RLS and advisors. Never apply speculative financial data writes.
4. Perform authenticated Otto desktop/mobile verification of the exact candidate using read-only operations. Preview the acceptance settlement without saving it, verify self/mixed links remain blocked, and compare legacy customer results.
5. Promote that exact verified preview through the pinned release process. Creation, PDF saving and sending remain explicit user actions after release. No automatic invoice generation, Salesforce write or email is part of deployment.

GitHub CLI was found authenticated as `vincelessxai`; do not use it for FCOS writes or switch machine-wide credentials. The approved connector is authenticated as `hocheunglai-oss` and can publish the scoped change through Git Data APIs.
