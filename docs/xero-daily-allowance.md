# Xero daily allowance

Xero Portal shows the last observed daily calls remaining and the provider's
confirmed reset time in Hong Kong time. A countdown uses that fixed deadline;
reloading the page or receiving another response does not move it forward.

Xero's Accounting API uses an organisation-specific fixed window. A daily
`X-Rate-Limit-Problem` with a valid `Retry-After` supplies the reset time. A
minute-limit response, an FCOS reserve stop, or missing/invalid timing data
cannot establish it. In those cases the portal reports that Xero has not
supplied the reset time. Once a saved deadline passes, the portal asks for the
next check to confirm availability instead of claiming the allowance is restored.

The display uses existing check results and safe error details. It makes no
extra Xero requests, changes no financial controls, and does not automatically
resume a sync. Existing run JSON snapshots retain the timing fields without a
schema migration. Public 429 responses expose only allowlisted numeric quota
fields, timestamps and known limit categories for the two Xero limit errors.

Source: [Xero OAuth API limits](https://developer.xero.com/documentation/guides/oauth2/limits/).
