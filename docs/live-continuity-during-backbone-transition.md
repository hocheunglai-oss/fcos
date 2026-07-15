# FCOS live continuity during the Backbone transition

FCOS is an in-use operational extension to Salesforce. Building FCOS Backbone does not retire, redirect, or disable the current FCOS application.

## Functions that remain live

- FCOS keeps its dedicated Supabase database, authentication, permissions, workflow state, and server API.
- FCOS keeps reading from and writing to Salesforce through its current server-side connector.
- FCOS keeps archiving reports to Google Drive through its current server-side connector.
- FCOS keeps manual SMTP delivery and the two scheduled Outstanding Buyer Invoices email runs in `vercel.json`.
- Existing FCOS URLs and user workflows remain available throughout parallel operation.

These paths must remain compatible until the replacement checklist records an approved successor, migration evidence, functional-owner acceptance, and a rehearsed rollback path. FCOS Backbone may consume shared or projected data, but it must not silently take ownership of an established FCOS action.

## Operational controls

The established connectors are enabled by default. The following variables are emergency kill switches only:

| Connector | Emergency control | Normal value |
|---|---|---|
| Salesforce writeback | `FCOS_DISABLE_SALESFORCE_WRITE` | absent or `false` |
| Google Drive archive | `FCOS_DISABLE_GOOGLE_DRIVE` | absent or `false` |
| Manual and scheduled email | `FCOS_DISABLE_EMAIL_DELIVERY` | absent or `false` |

Setting one of these controls to the exact value `true` pauses that connector at the server boundary. It does not delete the integration or migrate its ownership. Reverting it to `false` restores the established code path.

New bank execution and payment-promotion side effects are different: they remain disabled by default and require the explicit `FCOS_ENABLE_BANK_EXECUTION=true` or `FCOS_ENABLE_PAYMENT_PROMOTION=true` control only after their business UAT approval.

## Change rule

Any replacement of a live FCOS function requires all of the following before production traffic is switched:

1. The current behavior and data ownership are mapped in the cutover checklist.
2. The replacement is tested against representative production-shaped cases.
3. Existing FCOS users accept the replacement behavior.
4. Data reconciliation and audit evidence pass.
5. A rollback procedure is tested.
6. The change is deployed without removing the legacy path until the rollback window closes.

