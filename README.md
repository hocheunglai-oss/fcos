# FCOS

FCOS is a Vite/React analytics app backed by Vercel serverless API routes. It connects directly to Salesforce from the server side.

FCOS is the live Supabase extension to Salesforce. Its existing Salesforce writeback, Google Drive report archive, and scheduled/manual email functions remain intact and enabled by default because users rely on them today. Emergency server controls can pause each connector without removing or replacing its legacy implementation. New bank execution and payment-promotion paths remain disabled until their respective business UAT approval.

## Local Development

```bash
pnpm install
pnpm dev
```

## Vercel Environment Variables

The three established live connectors use emergency kill switches. Leave these absent or `false` during normal operation:

```bash
FCOS_DISABLE_SALESFORCE_WRITE=false
FCOS_DISABLE_GOOGLE_DRIVE=false
FCOS_DISABLE_EMAIL_DELIVERY=false
```

New external actions remain explicitly gated during parallel UAT:

```bash
FCOS_ENABLE_BANK_EXECUTION=false
FCOS_ENABLE_PAYMENT_PROMOTION=false
FCOS_ENABLE_XERO_CONTACT_SYNC=false
```

Changing any control is an operationally controlled action. The kill switches preserve the current FCOS implementation and provide a reversible emergency pause; they are not migration switches.

### Salesforce-triggered Xero contact creation

FCOS exposes a signed webhook for Salesforce STEM/enquiry Account lookup changes:

```text
POST https://fcos.fcuno.com/api/salesforce/contact-sync
```

This is the FCOS replacement for the local Xero Portal auto-create webhook. It uses FCOS server-side Salesforce REST authentication instead of the Mac `sf` CLI, and it stores Xero OAuth state, Xero contact-name cache, webhook event idempotency, and row-level audit output in Supabase.

Configure these server-only values in Vercel before enabling the gate:

```bash
SALESFORCE_EXPECTED_ORG_ID=00D2x000000Ei4oEAC
SALESFORCE_CONTACT_SYNC_SECRET=long_random_shared_secret
SALESFORCE_CONTACT_SYNC_MAX_SKEW_SECONDS=300
XERO_CLIENT_ID=your_xero_app_client_id
XERO_CLIENT_SECRET=your_xero_app_client_secret
XERO_REDIRECT_URI=https://fcos.fcuno.com/api/xero/callback
XERO_SCOPES="openid profile email offline_access accounting.invoices accounting.payments accounting.banktransactions.read accounting.settings.read accounting.attachments accounting.contacts"
XERO_REFRESH_TOKEN=initial_xero_refresh_token
XERO_TENANT_ID=aa8c08e2-17fd-4874-b7bc-10ffd82db9d0
XERO_TENANT_NAME="Fratelli Cosulich Bunkers (HK) Ltd"
XERO_CONTACT_AUTO_CREATE_CACHE_FRESH_MINUTES=1440
XERO_CONTACT_SYNC_DELAY_MS=1100
XERO_MAX_RETRY_AFTER_MS=60000
FCOS_ENABLE_XERO_CONTACT_SYNC=true
```

The initial `XERO_REFRESH_TOKEN` is used only to seed the service. Xero refresh tokens rotate, so FCOS persists the latest refresh token in the service-only `xero_contact_sync_connections` table after the first successful refresh.

Apply the Supabase migration `20260827145608_xero_contact_sync.sql` before enabling the webhook. The migration creates service-role-only tables for:

- Xero OAuth connection state
- Xero contact-name cache
- Salesforce webhook event idempotency
- Contact sync run headers
- Contact sync row audit details

The webhook accepts only signed Salesforce requests from the expected org. It re-reads the affected Salesforce Account records, accepts only active HK Buyer/Supplier/Buyer_Supplier/Broker accounts, checks Xero by current contact name or HK-stripped CL Key name, and creates only missing contacts using the Salesforce Account name. It does not rename or archive Xero contacts.

Salesforce enqueues the webhook from after-insert/update triggers on the enquiry and STEM account lookup surfaces: Opportunity, Quote, Broker Enquiry, Supplier Bid, STEM, STEM Line Item, STEM Extra Cost, STEM Variable Charge Supplier, and STEM Buyer Broker. The triggers are inert unless the hierarchy custom setting `Xero_Contact_Sync_Setting__c` org default is configured with `Enabled__c = true`, `Endpoint__c = https://fcos.fcuno.com/api/salesforce/contact-sync`, and the same signing secret stored in Vercel as `SALESFORCE_CONTACT_SYNC_SECRET`.

### Native Xero Portal

The Xero Portal now runs inside FCOS at `/xero-portal`; the old localhost-only Next.js portal is no longer required for daily use. The native page supports:

- Xero OAuth connect/disconnect using `https://fcos.fcuno.com/api/xero/callback`
- Receipt upload and browser OCR, stored in the private Supabase `xero-portal-receipts` bucket
- Xero draft ACCPAY bill creation with the receipt attached
- Contact Cleanup & Sync preview/apply, with audit rows and JSON/CSV download
- Salesforce-triggered contact creation run history

Apply both Xero migrations before using the page:

- `20260827145608_xero_contact_sync.sql`
- `20260827191032_native_xero_portal.sql`

### Salesforce-to-Xero accounting cutover

The Xero Portal `Accounting Sync` tab provides a manual, Finance-reviewed accounting cutover for Salesforce financial records dated from `2026-01-01`. Salesforce remains authoritative for invoices, bills, credit notes, payments, PDFs, emails, and operational workflow. FCOS sends only accounting transaction data to Xero; it does not upload Salesforce documents.

Apply `20260829080726_xero_financial_sync.sql` before opening the accounting workflow. The migration creates forced-RLS, service-role-only Product and bank mappings, durable Salesforce↔Xero document/payment identities, resumable run items, and redacted audit events. Browser roles receive no table or RPC access.

The Xero OAuth connection must include the granular scopes `accounting.invoices`, `accounting.payments`, `accounting.banktransactions.read`, `accounting.settings.read`, `accounting.contacts`, and `accounting.attachments`. A user may build a read-only reconciliation preview while financial writes remain disabled. Enabling `FCOS_ENABLE_XERO_FINANCIAL_SYNC=true` only unlocks a batch after Finance has selected and authorised its exact immutable preview revision. There is no scheduled financial posting.

The writer uses at most 25 transactions per request, stays below 45 requests per minute, records the returned Xero allowance headers, honours `Retry-After`, and stops before the configured 20% daily reserve. Re-running a checkpointed batch reuses durable Salesforce/Xero identities and does not create duplicate active transactions.

The lifecycle workflow uses Salesforce as the source of truth for active HK Accounts used in STEM records with delivery from `2025-01-01`. Matching uses Xero current `Name` only: normalized Xero name equals normalized Salesforce `Account.Name`, or normalized Xero name equals `Account.Company_Code__c` after removing a leading `HK`. Xero `ContactNumber` and `AccountNumber` remain visible in the UI and audit output only as reference fields.

### Microsoft Graph email routing

Every FCOS email purpose uses Microsoft Graph and an approved Microsoft 365
mailbox. One protected Entra application and Vercel OIDC trust provide the
application identity:

```bash
FCOS_MICROSOFT_TENANT_ID=your_tenant_id
FCOS_MICROSOFT_CLIENT_ID=your_application_client_id
```

Administrators and the active General Manager register mailbox addresses and
assign one mailbox to each email purpose in Settings. These assignments are
non-secret Supabase configuration. The Entra federated credential must match
the Vercel production issuer, subject, and audience exactly. In Exchange Online,
assign `Application Mail.Send` to the service principal through a recipient scope
covering every approved mailbox. Do not also grant an unscoped Entra `Mail.Send`
application permission because Entra and Exchange grants are additive. This
Microsoft Graph route is the only FCOS email-delivery path.

### External application foundation and Email Router

FCOS retains a server-side federation foundation for future registered external
applications. No application portal or app switcher is shown while FCOS is the
only active application. The federation service signs short-lived ES256
assertions and never shares FCOS browser tokens or the Supabase service role
with a target application. Email Router is native FCOS functionality and does
not use a portal handoff, a second Supabase Auth session, or target-application
entitlements. Its page visibility is managed through Users & Access.

Configure these server-only values in FCOS:

```bash
FCOS_PORTAL_ISSUER=https://fcos.fcuno.com
FCOS_PORTAL_SIGNING_KEY_ID=fcos-portal-2026-01
FCOS_PORTAL_SIGNING_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

External targets configure the matching public key, issuer, and key ID and may
stage a next public key before private-key rotation. Application entitlements,
synchronization failures, and logout retries are stored only in service-role
tables.

The native Email Router uses the same FCOS Microsoft Entra application and
Vercel OIDC trust as Graph-only email delivery. Its connected mailbox is stored
in the protected Graph mailbox registry and must have mailbox-scoped
`Application Mail.ReadWrite` and `Application Mail.Send` Exchange RBAC roles.
Message bodies, MIME, full recipient lists, and attachment bytes remain in
Microsoft 365; Supabase stores only operational metadata and durable action
state. Redirect, Reply, and Forward create a Graph draft before submission and
are not confirmed until the resulting item is reconciled in Sent Items.

## Account Identity

Every searchable Account result must display the Account name together with the authoritative Salesforce CL Key from `Account.Company_Code__c`. Use `accountClKeyLabel` or `accountSearchDisplayText` from `src/lib/accountDisplay.js`; never expose a Salesforce Account ID or ID suffix as the user-facing identifier. Search must match both Account name and CL Key.

Preferred permanent Salesforce authentication is OAuth JWT bearer. Set these in Vercel for Production and Preview:

```bash
SALESFORCE_JWT_CLIENT_ID=your_connected_app_consumer_key
SALESFORCE_JWT_USERNAME=integration_user@your_domain.com
SALESFORCE_JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
SALESFORCE_INSTANCE_URL=https://fratellicosulich.my.salesforce.com
SALESFORCE_LOGIN_URL=https://login.salesforce.com
SALESFORCE_API_VERSION=v59.0
```

Refresh-token OAuth is still supported as fallback:

```bash
SALESFORCE_CLIENT_ID=your_connected_app_client_id
SALESFORCE_CLIENT_SECRET=your_connected_app_client_secret
SALESFORCE_REFRESH_TOKEN=your_salesforce_refresh_token
```

For a temporary test only, `SALESFORCE_ACCESS_TOKEN` can be used, but it will expire and should not be used for production. If JWT or refresh-token environment variable names exist but any required value is blank, the app intentionally blocks the temporary access-token fallback and reports a System Health configuration error.

## Deployment

Salesforce metadata follows one source-controlled promotion path: deploy and verify an explicit reviewed change manifest in DEVEE, publish the complete current DEVEE-owned `force-app` tree to the `ivanyk20/fcbhk` `src/` mirror, then promote the same manifest to QAT and finally Production. Run `npm run salesforce:deploy:all -- --manifest manifest/<change>.xml`; the command verifies every pinned org identity, derives the scoped Apex tests from the manifest, enforces the order, records a non-secret DEVEE deployment proof bound to the complete source-tree hash, and blocks shared publication unless that hash matches. Never develop or synchronize independently from QAT or Production. Full-tree validation remains available through `npm run salesforce:validate:all`, but it intentionally includes unrelated local org tests and is not the normal promotion route.

Production deploys are handled by Vercel:

```bash
pnpm dlx vercel@latest --prod
```
