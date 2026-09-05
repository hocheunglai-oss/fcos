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

Publish an isolated draft PR, wait for required quality checks, build an exact-commit Vercel preview, and verify that preview with authenticated Otto desktop/mobile access before promotion. Production authentication verified on the current release is a baseline, not proof of the candidate release. Keep production unchanged if candidate authentication or required checks are unavailable.

Account Insight must preserve its directory request count, rows, filters, pagination, actual workspace scroll container and originating button focus. Updated authenticated E2E assertions cover that release gate.
