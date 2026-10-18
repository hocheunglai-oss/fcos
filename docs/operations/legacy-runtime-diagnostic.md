# One-time legacy runtime diagnostic

This is preparation for the frozen compatibility successor only. It is not the
normal hosted release path, a first-runtime baseline, a Production promotion,
or authority to execute a provider action.

The old Production deployment has no runtime-observation endpoint. Its Secret
values cannot be returned by Vercel's supported configuration readers. Do not
interpret omitted/redacted values as empty, rotate credentials to obtain them,
or fabricate a receipt from current environment defaults.

The proposed bridge evaluates the reviewed immutable interpretation helpers in
one standalone Vercel function in an isolated custom environment. Vercel copies
the existing project's current Production variables internally; no Secret
values are returned to the operator. The evaluator explicitly uses the old
Production interpretation context while reporting its physical Preview/custom
environment honestly. Record IDs and timestamps can support an explicitly
stated inference that the project configuration predates the old deployment.
They do not prove original deployment-value equality or provider inheritance.
`deploymentId` inheritance with replacement source and no-domain staging remains
unqualified and must not be used as a shortcut.

## Preparation and authority

Generate the isolated Build Output from reviewed controller bytes, never from a
candidate build with credentials. Bind the exact frozen candidate, old
Production tuple, dependency declarations, project-record key set, operation ID,
expiry and runtime output digest. Keep the random request capability private;
only its hash enters the bundle. The capability does not grant provider write
authority. A protected URL alone is insufficient authorization to expose the
diagnostic response.

Before submission, independently review the actual bundle, exact provider
request, retry behavior, shared lease and durable intents. Require one scoped
human decision for creating one temporary custom environment with `copyEnvVarsFrom:production`,
its diagnostic deployment and read-only observation, and deleting only their
positively returned owned resource IDs. This adds one temporary destination for
existing credentials; it creates or rotates no provider token. The
request must use the positively returned custom environment ID and
`autoAssignCustomDomains:false`, no environment overrides, no normal application
routes and no crons. A Production target is rejected. The existing 11 Production
cron definitions and their deployment binding must remain unchanged. Domain
non-assignment alone is not sufficient protection for those schedules. Do not use `vercel redeploy`: its
pinned implementation does not supply the required no-domain behavior.

Existing Production configuration records, cron schedules and customer aliases
must remain unchanged and continue serving the old deployment before,
during and after the diagnostic. One uncertain submission is consumed and
permits exact-owner GET-only readback; it never permits a second deployment.
Do not infer automatic retry safety from the CLI command name.

## Observation and evidence

The diagnostic accepts only its exact GET path, private capability, fresh
challenge and admitted operation lifetime. It returns sanitized typed states,
source bindings, actual diagnostic identity and one aggregate configuration
fingerprint; never raw environment values, tokens, row contents or per-key
credential hashes. Missing required runtime injection fails closed. Existing
sessions may be observed through bounded exact-target GETs only. No signing,
refresh, reconnect, emails, Salesforce writes or financial writes are allowed.

Xero authentication is unknown unless its existing shared quota admission is
actually preserved. A raw `/connections` GET is not a quota exemption. Any
necessary reservation/admission/observation/release metadata writes must be
explicit in the same action scope, journaled and independently reviewed.
Reserve 200 calls, 45 calls per minute and at most two in flight. No implicit
probe, retry or adoption is permitted.

Save the native diagnostic deployment, unchanged old aliases/configuration,
compiled source manifest, exact runtime response, original timestamps and
cleanup readback. Unknown authentication remains unknown. A diagnostic response
is not accepted by the existing first-runtime baseline parser, and it does not
repair the old deployment's `sourceAttested:false` or null deployment ID receipt.
A separately reviewed transition importer is required before release admission.

Delete only the owned diagnostic deployment and positively new exclusively
owned copied-variable IDs, then the owned custom environment, after capture or
on failure under the same scoped cleanup authority. Reject original/shared
variable IDs. Never enable broad deletion of unassigned variables. Retain uncertainty and cleanup obligations
if the returned ID or deletion outcome is unknown. Keep all successful prior
preservation, NomB and deterministic evidence with its original input binding
and timestamps. This work stays on PR #122.

Partial setup cleanup may remove only the positively new, exclusively assigned
subset of the original 58-key scope. If deployment submission never started,
retain independent root acceptance and the original durable intent digest;
the cleanup planner requires that explicit no-submission proof and never
fabricates a deployment ID. Submitted or uncertain deployments require their
actual owner readback; absence or a local error is not that proof.
