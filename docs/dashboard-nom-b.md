# Dashboard Nom B requirements

The **My Missing Nom B** panel is independent of the Dashboard's financial reporting filters. It groups the signed-in buyer trader's current Buyer Confirmations by STEM. Actual delivery date takes precedence over expected delivery date; dated requirements start on 1 September 2026. Completed STEMs remain included, cancelled STEMs are excluded, and undated requirements have a separate follow-up list.

A filed requirement needs a valid, non-deleted Nom B file linked to its Buyer Confirmation. Generated confirmations and received indicators do not count. A trader who has filed their confirmation is not responsible for another trader's missing confirmation on the same STEM. Unresolved trader identities are available to authorised managers in the team view.

## Automatic waiver

The default policy waives filing when Salesforce's verified receivable balance, converted to USD and rounded to cents, is strictly below USD 100. An active, issued, non-proforma final buyer invoice is also required. USD 99.99 qualifies; USD 100.00 does not. Verified zero and negative balances qualify. Missing balances, currencies, rates or incomplete reads cannot create an automatic waiver.

Currency conversion uses the Salesforce company accounting rate effective on the calculation date, through the corporate currency where required. There is no market-rate fallback. Expand the evidence to see the original receivable, USD equivalent, accounting rate, date and invoice evidence.

Automatic waivers are labelled **Receivable below USD 100**. They do not mark a STEM paid or alter accounting records. Refresh recalculates eligibility; an increased balance or withdrawn invoice ends the automatic waiver. Unavailable evidence is shown as **Unable to verify**.

## Management policy

General Managers and Administrators can select a policy for the whole STEM:

- **Automatic** follows the receivable rule.
- **Waive** remains in force until revoked. The default reason is **Payment Received**; **Management Exception** and **Other** are also available. Other requires an explanation.
- **Require Nom B** overrides automatic eligibility and requires an explanation.

Notes are limited to 1,000 characters. The policy applies to current and later Buyer Confirmations and survives trader reassignment. Returning to Automatic clears the manual override and recalculates eligibility. If another manager changes the policy while a form is open, refresh and review the current revision before saving again.

Policy decisions and automatic status transitions are recorded centrally with actor, time and evidence. Unchanged refreshes do not create duplicate transition events. Filing a document does not erase previous history.

## Verification and release

Run the policy, service, database and handler tests with `npm test`. The isolated desktop/mobile fixture runs with `npx playwright test --config playwright.nom-b.config.js`; it blocks provider requests and does not use a real user session. The release also requires the ordinary exact-commit checks, live migration verification and protected authenticated Dashboard smoke tests. The restricted read-only CI account does not invoke Nom B observations because those observations append audit events.

Salesforce is read-only for this feature. It adds no upload workflow, accounting changes, email reminders or changes to Dashboard STEM XLS exports.

The Nom B panel is a separate lazy-loaded client chunk (20,862 bytes in the initial verified local build). The aggregate client JavaScript budget increases from 3,860,000 to 3,890,000 bytes to accommodate this feature; individual chunk, gzip, PDF/XLS and server budgets stay unchanged.
