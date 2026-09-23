# Routine Salesforce–Xero reconciliation: first release

This release adds tools for resolving verified routine records. It does not enable unattended financial writes or declare the existing exception backlog resolved.

## Included

- Draft or authorised posting selected before preview. Authorised posting requires current issued Salesforce document evidence, verified currency, a permitted accounting date, and reviewed mapping. Changing mode requires a fresh review.
- Petroleum and actual invoice-extra Product2 default mappings: buyer 41100/NONE and supplier 51100/NONE. Existing explicit mappings, including disabled overrides, remain intact.
- Updates preserve Xero line identity, tracking, and unowned metadata. Ambiguous line correspondence, locked periods, and unsupported FX stay blocked.
- Exact payment allocations require the linked authorised document, bank identity, amount, date, and currency evidence. Unconfirmed outcomes require reconciliation before another attempt.
- Reviewed creation of up to 25 missing contacts per request, with a durable intent, live identity rechecks, and outcome audit. An unconfirmed creation cannot be automatically repeated from a new preview.
- Evidence-based verification or revocation of genuine Xero-only contacts. The server checks all Salesforce Accounts, regardless of delivery period, and invalidates verification when identity changes. Revision checks prevent overwriting another Finance user's decision.
- Finance review separates known prerequisites from unresolved accounting differences. Completion depends on confirmed outcomes.
- A human-authenticated operator CLI calls the same permission-checked handlers. Secure CLI session handoff is not yet available; use the signed-in FCOS page until that handoff exists. See [operator instructions](xero-finance-operator.md).

## Release and operational checks

Apply `20260923182327_xero_contact_identity_decisions.sql` before promoting the web release. The additive migration protects both tables with RLS, denies browser access, limits server grants, and atomically records each identity decision and revision in the audit table. Validate both empty-database and upgrade paths, then verify the exact candidate commit through the protected release harness.

After release, retrieve a fresh preview and compare selected source evidence with Xero before a small reviewed pilot. Retain the daily API reserve and stop if the provider's remaining allowance is below it. A successful software deployment is not evidence that accounting records have been repaired.

The first live draft pilot passed on 24 September 2026 and was recognised as an exact match on the following check. The user subsequently confirmed the USD bank mappings for UBS and DBS; both were saved through the authenticated Finance page. Payment records still require their own invoice, allocation and settlement evidence before posting.

## Protected invoice link review

Version 2.0.239 separates explicit approval eligibility from the Needs attention category. An eligible protected invoice with retained differences can be reviewed and linked without changing Xero accounting history. These rows remain in Needs attention until accepted and are never selected automatically. Finance can approve one link or manually select specific links for the review dialog. Accounting blockers, incomplete or changed evidence, posting-mode changes and the financial write gate continue to prevent approval.

Version 2.0.240 narrows the approval transaction to the chosen invoice rows and any previously selected eligible rows. Unselected rows keep their timestamps. Apply `20260923210832_xero_financial_selection_scope.sql` before the web release. The existing eligibility checks, revision comparison, atomic audit and service-only permissions remain in place. This removes unnecessary row rewrites observed during the two-link pilot; it does not establish the cause of the isolated database timeout or increase timeout limits.

## Remaining stages

The broader plan still includes the durable unattended queue and automation controls, secure human CLI session handoff, evidence-based historical contact cleanup, non-routine settlements and bank-entry contact repair, controlled reversals/deletions, and operational monitoring. These need their own implementation and acceptance evidence. Never replace unresolved contact identity with a placeholder or infer payment allocation using FIFO.
