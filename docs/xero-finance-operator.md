# FCOS Xero Finance operator

This CLI calls the same authenticated FCOS handlers as the Finance page. It does not sign in, use a service role, bypass an external-action gate, or post anything on a schedule. A real, active FCOS user needs `xero_portal` module access and the `xero_portal_manage` capability. The server checks the human session and permissions again for every request.

## Session and target

The operator requires `--session-file` containing either a raw Supabase human access JWT or JSON with `access_token`. The file must be a regular file owned by the current user, mode `0600`, with one link; symlinks and shared files are rejected. Keep it outside the repository, do not put the token on the command line or in an environment variable, and remove the file when finished. The operator never prints the token or raw API responses.

FCOS currently has **no supported command-line login or session export**. Obtain a session only through an approved, already signed-in human-session handoff. Do not copy browser credentials, use a password or service-role key, or fabricate an actor. If no approved handoff exists, use the signed-in FCOS Finance page until one is provided.

The default origin comes from `config/fcosConnections.js` and is pinned to `https://fcos.fcuno.com`. `--origin` accepts only that origin. For local fixture tests, `--origin http://127.0.0.1:<port> --allow-localhost` explicitly opts into loopback. Tokens are never sent to another host; redirects fail.

## Commands

Use `node scripts/xero-finance-operator.mjs --session-file /private/path/session <command>`.

| Command | Action |
| --- | --- |
| `status` | Show connection/gate state and the latest saved run summary. |
| `preview [--mode draft\|authorised]` | Build a saved document/payment preview. Draft is the default. This does not select rows or write to Xero. |
| `mappings` | Read Product and bank mapping counts. |
| `apply <runId> <documentRowId>...` | Record Finance review for only the listed eligible document rows. This authorises the saved run; it does not execute the document batch. |
| `run <runId>` | Execute an already authorised saved run, or resume a saved partial/failed run. This can write Xero documents. |
| `payments <runId> <salesforcePaymentId>...` | Apply only the listed exact eligible payments from that saved preview. This can write Xero payments. |
| `contacts status` | Show the latest saved contact lifecycle summary. |
| `contacts preview` | Build and save a fresh contact lifecycle preview. |
| `contacts verify --input-file <path>` | Record an audited, reviewed Xero-only identity decision for one current unmatched contact. |
| `contacts revoke --input-file <path>` | Revoke an existing audited Xero-only decision after review. |
| `contact-repair <runId> <lifecycleRowId>...` | Create at most 25 explicitly selected missing Xero contacts after server revalidation. |

`--show-rows` adds a narrowed row listing to `status`, `preview`, `mappings`, `contacts status`, and `contacts preview`. Contact rows include the current fingerprint and audited revision needed for identity review. Financial document rows include source and Xero IDs, account identity, review fingerprint, blockers, warnings, match evidence, and bounded scalar/accounting-line differences. Each listing is capped at 100 rows per category; add one or more `--row-id <id>` options with `--show-rows` to inspect exact current rows (at most 25). The listing identifies truncation. `apply`, `payments`, and `contact-repair` return the exact reviewed rows. JSON output omits provider credentials, arbitrary source payloads, URLs, raw request bodies, and full API responses. A run ID and explicit row IDs are mandatory for row mutations; there is no select-all option. Review the complete row and provider evidence before authorising a financial change.

For `contacts verify` or `contacts revoke`, first review `contacts preview --show-rows` and the current Xero/Salesforce identity evidence. Put one reviewed decision in an owner-only (`0600`) JSON file outside the repository:

```json
{
  "tenantId": "<tenant UUID from contact run>",
  "contactId": "<Xero contact UUID>",
  "expectedRevision": 0,
  "expectedFingerprint": "<64-character fingerprint from current row>",
  "evidenceNote": "Evidence explaining why this contact needs no Salesforce Account.",
  "evidenceReference": "Source or review case reference",
  "reviewed": true
}
```

For revocation, use the current nonzero revision and explain the revocation in the evidence fields. The CLI derives the decision from the command and never accepts an actor field. A stale contact, ambiguous Salesforce match, missing capability, or altered revision stops before the decision handler. The server independently rechecks the live contact and evidence and records the human actor and audit.

`contact-repair` accepts only rows whose current saved reason is `missing-xero-contact`, with a unique Salesforce Account and no Xero contact. It calls the reviewed repair handler once. The returned summary distinguishes created, already existing, blocked, and uncertain outcomes. **Do not retry an uncertain creation.** Refresh the contact preview, inspect Xero, and resolve the saved intent first.

Preview records a local reconciliation snapshot and may create the server's narrowly approved default Product mappings. It sets `recordExactMatches: false`, so it does not automatically record exact document/payment links. The posting mode is saved with the preview. Rebuild the preview when changing between draft and authorised modes, then review and select again. `run` uses only the saved, authorised selection.

`run <runId>` **writes the authorised saved document batch to Xero**; it is not a status lookup. Use `status` to retrieve the current saved financial run.

If a mutation's network response is missing or unreadable, the result is **uncertain**. The CLI makes one attempt and stops. Retrieve the saved financial or contact run and inspect FCOS/Xero before resuming. Do not simply repeat the command after an uncertain result. The server's revision checks, audit trail, source revalidation, and financial gates remain authoritative.
