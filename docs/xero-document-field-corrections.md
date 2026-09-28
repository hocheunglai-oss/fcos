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

Open **Date and reference corrections** in Xero Portal. Preview retrieves the complete source and target populations, then pages through the immutable saved preview without repeating provider scans. It shows eligibility, source evidence, and each before/after value. Only a fully retrieved preview allows selection. Apply up to 25 explicitly selected eligible records; begin a rollout with a smaller sample and inspect the confirmed outcomes.

The normal financial-action permission and enablement gate remain required. The correction records its durable intent before sending, then verifies the exact Xero readback. It preserves line IDs/order and financial values, Contact, currency/rate, accounts, taxes, payments, allocations, original mapping IDs and preservation receipts. An unmapped verified transaction receives a protected link only after successful readback.

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
