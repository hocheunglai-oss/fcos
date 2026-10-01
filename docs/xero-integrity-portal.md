# Salesforce–Xero integrity portal

The Xero Portal reports saved comparison and correction evidence. All operational reviews, exact approvals, uploads, corrections, contact maintenance, and sync execution are handled through the Codex FCOS project using the existing protected services. Reporting does not authorize a financial action, refresh provider credentials, or start a provider scan.

The initial reporting date range starts on 1 January 2026. Date filters affect reported evidence only. Document comparisons follow the saved buyer-invoice delivery-date evidence, payments follow their payment dates, and contact identity snapshots are explicitly not delivery-date bound. Missing dates and unknown coverage remain visible.

The page shows integrity counts, currency-separated comparisons, paginated searchable record differences, correction history, and saved scan/sync freshness, errors, recent run metadata and quota. Field-correction history reports exact correction journals; recent run completion alone does not prove a verified global sync. Coverage refers to saved evidence, not a newly counted Salesforce or Xero universe. Unavailable, capped, stale and unsupported evidence must not become a zero count or a complete reconciliation claim. An uncertain outcome remains uncertain until verified readback establishes its result.

The reporting endpoint retains the existing Xero Portal module and Finance management authorization. It projects only allowlisted business fields; credentials, raw journal payloads and bank secrets are excluded. Existing financial gates, fingerprints, durable locks, audit records and correction preservation rules remain authoritative in the Codex workflow.

No Salesforce metadata changes, live database migrations or financial writes are needed for this UI change. Production promotion remains subject to the existing exact-candidate release checks.
