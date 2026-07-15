# FCOS

FCOS is a Vite/React analytics app backed by Vercel serverless API routes. It connects directly to Salesforce from the server side.

FCOS remains the live Supabase extension to Salesforce while FCOS Backbone is built. Its existing Salesforce writeback, Google Drive report archive, and scheduled/manual email functions remain intact and enabled by default because users rely on them today. Emergency server controls can pause each connector without removing or replacing its legacy implementation. New bank execution and payment-promotion paths remain disabled until their respective business UAT approval.

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
```

Changing any control is an operationally controlled action. The kill switches preserve the current FCOS implementation and provide a reversible emergency pause; they are not migration switches.

See [FCOS live continuity during the Backbone transition](docs/live-continuity-during-backbone-transition.md) for the preserved-function and replacement rules.

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

Production deploys are handled by Vercel:

```bash
pnpm dlx vercel@latest --prod
```
