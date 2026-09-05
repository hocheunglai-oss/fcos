# Trading-first Dashboard verification

## Scope

Presentation-only changes to Dashboard Overview, STEMs and Accounts. Salesforce queries, financial calculations, API contracts, permissions, document formats and Account Insight internals are unchanged. Optional shared-header and data-status props preserve the default behavior on other pages.

## Verified locally

- Full Node suite: 1,146 passing tests; no failures or skips.
- Lint, both TypeScript configurations, production build, Graph-only source check, performance budgets and FCUNO contract compatibility pass.
- Otto Chrome inspection of the real Dashboard components using explicitly synthetic fixture data at 390, 768, 1280, 1600 and 2560 pixels.
- Header, controls and KPI section edges align at every target width; chart/table scrolling stays inside its container.
- Primary cards respond as one, two or four columns. Narrow Account cards stack monetary fields without clipped exposure notes.
- Prior-year chart toggle, exact margin legend labels, separate currency/MT/% axes and methodology disclosure verified.
- Saved-view disclosure, mobile filter expansion, keyboard location selection, STEM toolbar and Accounts-only directional controls verified.
- Missing-number, incomplete-scope and period-summary regression tests added. Financial/API suites continue to pass unchanged.

## Browser test fixtures

`e2e/fixtures/dashboard-preview.html` is a local Vite-only harness importing the real components. It contains synthetic data, stubs its own API calls, has no production route and is not included in the production build. The accompanying automated layout spec requires `FCOS_E2E_DASHBOARD_FIXTURE=1`; it must never run against a deployed FCOS origin.

Manual inspection used the approved Otto profile. The automated Playwright suite was updated but is not claimed as executed. Authenticated deployment checks must use an existing approved user session; no test identity or authentication bypass is created by this change.

## Release gates

Publish an isolated draft PR and wait for required quality checks. Deploy the exact commit as a staged Production candidate with `vercel deploy --prod --skip-domain`, so the build and runtime use the existing FCUNO configuration without moving the live domain. Verify with authenticated Otto desktop/mobile access before promoting that same deployment. Production authentication verified on the current release is a baseline, not proof of the candidate release. Keep production unchanged if candidate authentication or required checks are unavailable.

Standard Preview settings do not currently contain FCUNO configuration. The first candidate incorrectly used those settings and rendered legacy password login. Do not use that candidate or ask users for FCOS passwords. Hosted builds now fail when the FCUNO client flag, server federation flag, issuer or exact FCOS Supabase URL is absent or mismatched. Never copy Production secrets into Preview to bypass this check.

For staged verification, retain the Production Auth Site URL and permit only the exact immutable candidate callback `/login?federated=1` in the existing FCOS Auth redirect allowlist. Verify the candidate's Vercel project and commit before adding it, preserve every other approved callback, and remove the temporary callback after verification/promotion. Do not use wildcard preview redirects, create test users, enable password login or transfer browser tokens.

Account Insight must preserve its directory request count, rows, filters, pagination, actual workspace scroll container and originating button focus. Updated authenticated E2E assertions cover that release gate.
