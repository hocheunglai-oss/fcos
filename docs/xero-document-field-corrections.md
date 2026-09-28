# Invoice and bill field corrections

The `document_field_correction_v1` policy applies to normal sales invoices and supplier bills whose linked buyer invoice Delivery Date is on or after 1 January 2026. Both directions use that buyer date as the Xero accounting date. Earlier deliveries are preserved.

| Field | Sales invoice | Supplier bill |
| --- | --- | --- |
| Date | Buyer invoice Delivery Date | Buyer invoice Delivery Date |
| Due date | Buyer payment due date | Supplier payment due date |
| InvoiceNumber | Buyer invoice Name | STEM RefCode after the first four characters + `- ` + vessel |
| Reference | Vessel | Existing API Reference preserved |
| Every existing line description | `INVOICE ` + buyer invoice date | Buyer invoice date |

Descriptions use `d/M/yyyy`. For example, `HK2624879T` and `VOYAGER` produce bill number `24879T- VOYAGER`. Xero displays this bill number as its Reference. Original supplier invoice names remain separate source evidence.

Bills use directly linked product/charge buyer invoices. Without direct links, there must be exactly one active, non-proforma buyer invoice on the same STEM. All selected buyers must agree on delivery and invoice dates. Missing or conflicting evidence is held, with the actual buyer records visible in the preview.

## Review and apply

Open **Date and reference corrections** in Xero Portal. Preview reads complete Salesforce evidence first, then retrieves the relevant Xero date scope plus exact historical identities and invoice numbers. This retains cross-year identity and duplicate-number checks without scanning unrelated Xero history. Confirmed pre-2026 deliveries are counted as preserved outside the correction table; missing or conflicting delivery evidence remains visible for review.

The immutable saved preview is paged without repeating provider scans. It shows eligibility, source evidence, and each before/after value. Only a fully retrieved preview allows selection. Apply up to 25 explicitly selected eligible records; begin a rollout with a smaller sample and inspect the confirmed outcomes.

To reopen an interrupted review, use `/xero-portal?correctionPreview=PREVIEW_UUID`, open the correction panel and choose **Load saved correction preview**. This reads the complete stored preview without a new Xero scan. It never applies automatically; all current source, target and authority checks still run when selected corrections are submitted.

Apply refreshes complete Salesforce and Contact evidence, all current-period Xero documents and all mapped cross-period identities. Ordinary corrections restrict additional document-number lookups to the selected sources, including global sales-number collision checks. Grouped and issued-supplier preservation receipts retain the complete historical lookup scope; a newly changed special receipt stops a narrowed operation before provider reads.

The normal financial-action permission and enablement gate remain required. The correction records its durable intent before sending, then verifies the exact Xero readback. Inventory, updates and readback request four-decimal unit amounts to preserve existing price precision. Corrections preserve line IDs/order and financial values, Contact, currency/rate, accounts, taxes, payments, allocations, original mapping IDs and preservation receipts. An unmapped verified transaction receives a protected link only after successful readback.

Exact transaction reads use the same complete paginated collection representation as the preview, filtered to one InvoiceID. Xero's single-resource endpoint expands Contact data and omits some settlement fields, which must not be mistaken for a transaction change. Every read still requires exactly the requested identity and unchanged accounting evidence; no missing fields are silently filled or discarded.

Paid/partially paid documents can receive supported metadata changes. Required accounting-date changes on settled records and corrections inside locked periods are held as a whole. Payments are never removed to make a correction eligible.

An uncertain result retains the operation barrier. Use **Verify uncertain results**, which reads back the original transaction and cannot resend the update. Do not retry an uncertain update or approve a replacement batch to bypass the barrier. An unchanged readback alone does not prove that an interrupted provider request can safely be resent.

## Authorised command-line operation

The existing operator requires an approved, unexpired human Finance session in an owner-only file. It never discovers, exports or refreshes browser credentials.

```sh
node scripts/xero-finance-operator.mjs corrections-preview --session-file "$FCOS_HUMAN_SESSION_FILE" --show-rows
node scripts/xero-finance-operator.mjs corrections-apply PREVIEW_UUID ITEM_UUID --session-file "$FCOS_HUMAN_SESSION_FILE"
node scripts/xero-finance-operator.mjs corrections-verify PREVIEW_UUID ITEM_UUID --session-file "$FCOS_HUMAN_SESSION_FILE"
```

Keep output and evidence private. Preview collects every saved page and rejects missing/duplicate rows. Apply and Verify require explicit IDs from that same preview. Inspect current saved quota state before starting a provider stage; honour actual retry deadlines and the 200-call reserve. Source changes require a fresh preview. Salesforce remains read-only.

## Temporary allowance exception

An explicit user instruction can authorise one complete preview and a small verified batch below the ordinary reserve. Configure `FCOS_XERO_DOCUMENT_CORRECTION_RESERVE_OVERRIDE` only on that deployment, as a JSON object with `authorityId`, the authenticated human `actorId`, the verified Xero `tenantId`, `policy: "document_field_correction_v1"`, UTC `issuedAt` and `expiresAt`, and `maxBatchSize: 2`. The grant must expire within four hours. Malformed, mismatched or expired configuration does not waive the normal reserve. Caller request parameters cannot grant an exception.

Before applying, review the complete saved preview and append exactly one server-only `document_correction_allowance_canary` audit event for that authority and actor. Its fingerprints contain exactly `authorityId`, the canonical `grantHash`, `tenantId`, `previewId`, sorted `itemIds`, and sorted `xeroInvoiceIds`. Pin one or two eligible records; Apply must select that exact set. A duplicate pin, changed preview, different actor or different targets blocks the operation. The checked grant and pin are retained in each correction journal without modifying original preservation receipts or payment links.

The exception never bypasses real provider rate limits, financial eligibility or normal action permissions. It requires enough observed allowance for the protected read, update and readback. Expiry stops new exception requests; Verify can still recover the original pinned records after expiry under the ordinary reserve, without resending an update.
