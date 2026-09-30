# Missing Nom B: operator runbook

The desktop page at `/missing-nom-b` shows the signed-in trader's actual missing Buyer Nom B files across **all dates**, including uninvoiced STEMs. Cancelled STEMs are excluded. The page and reminders use actual filing evidence; Dashboard delivery cutoffs, receivable waivers and management waiver policies do not filter this workflow.

## Activate prospectively

1. Deploy the reviewed release and apply `20260930044110_missing_nom_b_workflow.sql`. Verify its three workflow tables and claim RPCs are service-only, with RLS enabled and no client-role access.
2. Verify the exact Production Salesforce identity against `config/fcosConnections.js`, required schema/read permissions, file creation and confirmation-update permissions, and the authenticated desktop flow. Verify the dedicated `missing_nom_b_reminders` sender purpose, its enabled route, active verified mailbox, and Production Microsoft Graph/OIDC authorization. The migration copies the outstanding-invoice mailbox only when that mailbox is already active and verified; otherwise assign and verify the dedicated route.
3. Complete and record readiness before setting `FCOS_ENABLE_MISSING_NOM_B_REMINDERS=true` in Production. Keep it unset or false during migration and verification. Confirm `CRON_SECRET` and the production cron schedule are configured.
4. Observe the first enabled, ready run. Its persisted `activated_at` is the prospective boundary. Only invoices **created at or after this instant** can trigger mail. A pre-activation invoice remains excluded even if its PDF is generated later. Record activation, first successful scan and sender verification evidence.

The migration alone does not activate reminders. Disabling and re-enabling preserves the original activation, cursor and once-per-STEM ledger; pending work may resume. Do not delete state or reset activation to manufacture a new run.

| Control | Effect |
| --- | --- |
| `FCOS_ENABLE_MISSING_NOM_B_REMINDERS=true` | Opts into scheduled reminders; default is disabled. |
| `VERCEL_ENV=production` | Required for reminders. Preview cannot send reminders or upload to Salesforce. |
| `FCOS_DISABLE_EMAIL_DELIVERY=true` | Emergency stop for external email, including these reminders. |
| `FCOS_DISABLE_SALESFORCE_WRITE=true` | Emergency stop for uploads/writeback. |
| `CRON_SECRET` | Required bearer authorization for `/api/functions/missingNomBReminderCron`, scheduled every five minutes. |
| `FCOS_MICROSOFT_TENANT_ID`, `FCOS_MICROSOFT_CLIENT_ID` | Existing Graph application configuration; sender selection remains in the email registry. |

`missingNomBList` and `missingNomBUpload` require an active FCOS session and Dashboard access. Ownership is enforced server-side; viewer and interoffice profiles cannot upload. Reminder enablement controls automatic email, independently of the authenticated filing page. Keep credential values out of tickets, logs and this runbook.

## Eligibility and ownership

A reminder requires a non-deprecated, non-proforma final invoice created after activation, a real non-deleted, published, nonempty PDF linked to that invoice and matching `File__c`, and a non-cancelled STEM. Credit-note names, available boolean credit flags and negative amounts are excluded. Unknown credit evidence blocks eligibility. When Salesforce provides the amount field, sending requires a valid nonnegative amount.

Potential final invoices are recorded durably before the PDF or amount is ready. `Blocked / PDF_PENDING` is retried without requiring another invoice modification, so delayed completion beyond the scan overlap is covered. The incremental `SystemModstamp` scan uses pagination and overlap; discoveries and cursor advancement commit together.

Checkpoints retain PostgreSQL timestamp precision. Salesforce query lower bounds round up and upper bounds round down to its millisecond precision, while invoice eligibility compares the exact activation instant. Restarting a scan preserves its original boundary and page cursor.

The STEM must have exactly one active Buyer Confirmation: `RecordType.DeveloperName = Buyer` and `Deprecated__c = false`. `Replaced__c` marks regenerated outgoing content and does not retire a confirmation. A received green indicator alone is insufficient. A valid Nom B is an actual linked, non-deleted, published, nonempty file with the STEM reference and canonical Nom B marker; outgoing `File__c`/`PDF__c` documents are excluded.

Ownership follows the shared Production trader policy and one active FCOS profile. Non-overridden names with inactive or duplicate matching Salesforce User identities are blocked. The authoritative overrides in `config/nomBTraderIdentities.js` assign both Vu Huu Long and Pham Kim Thuy follow-ups to `long@cosulich.com.hk`. The shared `bunker@cosulich.com.hk` correspondence address grants no ownership. Buyer contacts and invoice creators are not recipients.

The ledger is unique by source org and STEM. A confirmed `Sent` reminder is never sent automatically again. Multiple invoices do not create duplicate mail. An unsent `Suppressed` STEM can re-arm on discovery of a different eligible invoice; `Sent` and `Uncertain` remain held. Eligibility, ownership and absence are rechecked after the send claim and immediately before Graph delivery. Email has no CC and uses the fixed login-safe link with **View and file all my missing Nom B**.

## Filing and uncertain outcomes

The owner can upload PDF, JPG/JPEG, PNG, DOC or DOCX, up to **3 MiB decoded**. The service checks content type, current ownership, the active confirmation and existing filing. It reserves the operation and request hash, creates `<stable STEM reference> - NOM B` with the original file type, and sets `Received__c` to green in one Salesforce `allOrNone` composite.

Success requires fresh verification of the unique linked Nom B, latest published version, operation marker, title, checksum, size and green status. A completed replay returns the saved verified IDs. Changing the filename or bytes under the same operation ID is rejected.

For a timeout or uncertain response, preserve the original operation ID and reselect the same file and filename. Retry that operation to reconcile its marker and file evidence; do not create another operation or repeat a raw Salesforce POST. `Posting` and `Uncertain` uploads remain held. A reservation that expired before posting can be released safely; a proved composite rollback is a definite no-write result. Ownership changes, conflicting files or unverifiable evidence require operator review rather than bypassing the current owner check.

## Monitor and recover

System Health → **Missing Nom B** reports enablement, activation, last scan, scan lag, blocked/failed/uncertain counts, upload holds, stale deliveries and recent outcome codes. Enabled scan lag above 15 minutes is a warning. These summaries omit trader identities and file contents; use approved service access for record-level investigation.

| State | Recovery |
| --- | --- |
| `Blocked / PDF_PENDING` | Verify invoice generation and its linked PDF/amount; allow the scheduled recheck after completion. |
| Assignment or confirmation blocked | Correct the authoritative assignment/profile or duplicate confirmation, then allow recheck. Never substitute a buyer contact or shared mailbox. |
| `Failed` | Inspect the code and repair the dependency. Only failures known to precede acceptance retry automatically, with backoff capped at one day. |
| Stale `Processing` | A later worker can reclaim it; preserve its ledger record. |
| `Sending` expired / `Uncertain` | Delivery may have been accepted. Automatic resend is prohibited. Check the original sender's Sent Items/provider evidence against recipient, subject and time, then reconcile through a reviewed service operation. |
| Upload `Posting` / `Uncertain` | Use the original operation's marker and latest Salesforce version/link/status evidence. Hold ambiguous cases; do not clear the record merely to permit another upload. |

For an incident, retain source org, STEM/confirmation/invoice IDs, activation/cursor, operation ID or reminder ID, timestamps, codes and verified provider outcome. Never include credentials or base64 file content. If acceptance cannot be established or ruled out, leave the uncertain hold in place. There is no automatic uncertain-reminder resend or general operator reset endpoint.

Implementation: `api/_missingNomB.js`; shared ownership/file policy: `api/_dashboardNomBPolicy.js`; durable state: `missing_nom_b_scan_state`, `missing_nom_b_reminders`, `missing_nom_b_upload_operations`. Focused checks: `node --test tests/missingNomBBackend.test.js tests/missingNomBIntegration.test.js tests/missingNomBMigration.test.js`; the runtime migration test additionally requires its explicitly configured disposable local PostgreSQL fixture. Release readiness still requires the repository's exact-commit and live migration checks.
