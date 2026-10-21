# Existing approved drafts: status-only authorisation

`authorise_existing_xero_drafts_v1` covers only the fixed, human-reviewed 54 existing drafts. It does not create documents, rebuild lines, send messages, post payments, allocate credits or verify PDFs. All source and target evidence remains private. The public policy contains only opaque approval hashes.

## Authenticated Finance execution

Mount `XeroExistingDraftAuthorisation` inside the Finance workspace, passing the existing disabled financial-gate state through its `disabled` prop. `Read progress` reads private approval records, mapping metadata, intents and shared allowance only; it makes no Xero request and does not renew credentials. The displayed status is FCOS's recorded verified outcome, not a new live provider check.

`Run approved drafts` prepares and applies unchanged eligible records in cohorts of up to five. Each cohort has a new complete server-acquired preview and retains the centrally recorded human approval. Held rows are reported; independent eligible rows continue. A quota, source, permission or uncertain-outcome error stops progression. The same approved pending scope can resume after the hold is resolved; completed rows are excluded. No arbitrary IDs, evidence, actor or approval flags are accepted through this progress endpoint.

`Read back interrupted record` invokes GET-only recovery. A missing planned request can be bound for evidence association, but recovery never sends a POST. The run barrier remains while any sibling intent is unresolved. Definitive never-sent rejections close without claiming an authorisation; completed durable outcomes require no additional provider read.

All handlers require fresh `xero_portal_manage` access through the shared authenticated handler adapter. Apply and recovery additionally preserve the existing financial external-action gate. Do not export a browser session or fabricate a Finance actor to use the CLI. If no approved CLI human-session handoff exists, use the signed-in Finance control.

## Server and database boundaries

The collector verifies the pinned Production Salesforce organisation, complete source/Account discovery, exact Contact/ownership, signed account/tax buckets, duplicate documents, current mappings, payment/remittance dependencies, disputes, locks and the full target record. Scope evidence is held on the trusted server; caller-provided proof is never accepted.

The status request is exactly `POST /Invoices/<approved-id>?unitdp=4` with `{ Invoices: [{ InvoiceID: <approved-id>, Status: 'AUTHORISED' }] }`. No automatic retry is permitted. Identical full detail GETs surround execution. Every successful read requires an exact shared receipt. The only permitted target differences are Status and validated top-level update timestamps; unknown fields and existing line identity/order/financial values are preserved.

Persist claim and planned request before provider admission. A per-tenant admission guard permits only the exact bound POST while an intent is unresolved. Status transactions take the existing global lock and try the tenant lock without waiting, avoiding an inversion with existing admission. A `55P03` contention rejection creates no intent or provider write. Uncertain outcomes are reconciled by readback, never blind resubmission. Confirmation commits the append-only outcome, mapping status, item, audit and any shared unknown-resolution together.

The progress endpoint fits both preview and apply forecasts before starting another cohort. It can shrink subsequent cohorts as headroom falls, avoiding wasted preview calls. The first cohort requires five where five pending records remain.

The whole cohort forecast includes complete discovery, writes, verification and recovery. Five records forecast 30 preview calls and 55 apply calls; shared available capacity must accommodate both phases independently above the 200-call reserve. Use actual shared controller values, 45 calls/minute and at most two concurrent requests. Raw response headers never raise conservative capacity.

## Release and private import

The additive migration depends on the existing correction, campaign, shared-control and supplier-financial transport migrations. Validate against the release owner's exact successor tree. Do not deploy an old reconciliation branch over current Production.

Approved records are owner-imported from the sealed private seed only after the exact reviewed migration is applied to the pinned FCOS database. The runtime has SELECT access only; there is no general import or approval RPC. Verify all 54 opaque leaves, whole original ASCII-canonical hashes, selection provenance and restricted ACLs after import. The private review, seed, human approval, raw invoices and fixture files must remain excluded from Git, especially because the repository is public.

Local mathematical and lifecycle tests do not establish live execution eligibility. Required exact-commit, migration, permission, authenticated browser and deployment checks remain prerequisites. Begin with five representative eligible records and verify every readback before further bounded cohorts. PDF status remains UNVERIFIED throughout this milestone.
