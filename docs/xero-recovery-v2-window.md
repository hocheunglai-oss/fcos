# Xero recovery v2 preparation envelope

Future independently admitted plans may use `schemaVersion: 2` with kind
`fcos_xero_recovery_step_plan_v2`; their carrier templates must also use version 2
and kind `fcos_xero_recovery_carrier_template_v2`. Both intervals are at most
1,800,000 ms. V1 plans/templates keep their original900,000 ms ceiling. Kind/version
mixing is rejected in JavaScript and SQL. Requests remain version1 and retain the
exact existing fields. `parseXeroRecoveryStepPlan` and `parseCourierTemplate`
return `maximumWindowMs` for the admitted version.

This is a fixed preparation plus execution envelope. Deployment, source proof and
review still consume it. It does not guarantee 15 minutes remain for execution;
root must check the actual remaining time before the first financial claim. A
30-minute envelope leaves 15 minutes only if all preparation finishes by minute 15.
No timestamp is refreshed, no old plan is converted, no expired host is revived,
and no unknown/consumed outcome becomes replayable. A new source, actual run,
compiled plan/host, original authority review and root/peer admission are required.

The additive migration replaces only `xero_recovery_step_input`. Its existing
invoker identity, owner and ACL are preserved; no tables, grants, stored evidence,
claim/complete locks or deadline rechecks change. It must be independently
reviewed and applied to the pinned project before an actual v2 request.

A new root-owned preparation helper must explicitly emit both v2 descriptors,
validate its arm against 1,800,000 ms, and retain the earlier immutable metadata,
reader credential and cleanup deadlines. The original accepted helper/evidence
must remain unchanged. No new API argument is required: the parsed plan exposes
`maximumWindowMs` for the derivative helper to use. The private deployment
material window may remain 15 minutes: it covers only the four separately guarded
setup POSTs, not the whole warm-carrier review envelope.

Unchanged controls include one Organisations GET/no retry, 45 per minute/2 inflight,
actual retry/reset and token version, five-minute SQL probe grant, fresh actor and
GitHub OIDC session expiry, 30-second token response, 15-second custody capture,
no automatic follow-on after unknown, and all original cleanup deadlines. Hosted
metadata/artifact freshness remains independently at most 1,800 seconds from its
actual capture; the v2 envelope cannot extend that evidence. The reusable job has
an outer30-minute timeout, while v1 templates and owner-readback scopes still stop
at their own immutable shorter deadlines.

## Qualify the transport before opening the envelope

Complete source review and the joined local transport check before arming a new
plan. The native relay publishes the locator through its fixed `publish-locator`
entrypoint. It constructs the Git ref and GitHub status body internally; do not
POST the `courierPublicationStatus` descriptor as a GitHub request. The status
requires the authenticated platform creator and exact run, source, payload and
commit binding. A GitHub status is publication evidence, not financial authority.

The locator uses the separately reviewed Production orchestration lease. It
cannot claim, resolve or adopt the financial lease. Each publication phase has a
consumed durable intent. An unknown push stops before status publication, and an
unknown status stops before requests; neither may be retried. Actual host and
financial admission still require their own original exact scopes and evidence.

Hosted verification and native material review share
`validateXeroRecoverySourceContent` / `validateXeroRecoverySourceContents`.
Inventory UIDs or boolean fields in historical receipts do not establish source
contents. Compare every downloaded file against the exact rebuilt inventory,
length, SHA1, SHA256 and bytes. The sanitized versioned source-content receipt
explicitly proves no compiled lambda bytes and grants no execution authority.
Failing the first file stops before reading another file. Preserve historical
receipt fields and original timestamps rather than rewriting old evidence to
match the current contract.

One local success fixture must connect the real request publication, carrier, host,
artifact and native acknowledgement entrypoints. It must use the same returned
HTTP acknowledgement for artifact upload and native decoding, then stop before
any next financial request. The fixed native locator command is checked separately;
the joined fixture seeds its locator as synthetic provider input. Inert
browser/provider fixtures and local SQL checks
are regression evidence only: actual hosted source, identity, credentials,
quota, outcome, preservation and cleanup checks remain required.
