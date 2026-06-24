# Salesforce Extension

Salesforce Extension is a Vite/React analytics app backed by Vercel serverless API routes. It connects directly to Salesforce from the server side.

## Local Development

```bash
pnpm install
pnpm dev
```

## Vercel Environment Variables

Set these in Vercel for Production and Preview:

```bash
SALESFORCE_CLIENT_ID=your_connected_app_client_id
SALESFORCE_CLIENT_SECRET=your_connected_app_client_secret
SALESFORCE_REFRESH_TOKEN=your_salesforce_refresh_token
SALESFORCE_INSTANCE_URL=https://fratellicosulich.my.salesforce.com
SALESFORCE_LOGIN_URL=https://login.salesforce.com
SALESFORCE_API_VERSION=v59.0
```

For a temporary test only, `SALESFORCE_ACCESS_TOKEN` can be used instead of the OAuth refresh-token variables, but it will expire.

## Deployment

Production deploys are handled by Vercel:

```bash
pnpm dlx vercel@latest --prod
```
