# Retained Production email evidence exception

This verifier proposal accepts an explicitly documented historical limitation
for the retained Production deployment `dpl_KmyVbNkg7okjW4PPjR8ZJXRz19AL`
(commit `f3472492ff4d0b0c70248a3c8e5c0012981a94b3`). Its three sensitive
email settings cannot be read back from the provider. The verifier continues
to report their values and historical setting selection as unknown; current
record continuity does not establish equality or which record the old build
selected.

The exception is pinned in `config/legacy-email-baseline-proof.json` to that
one deployment, three historical setting IDs and unchanged timestamps, and
two reviewed Preview commits. It cannot apply to another Production deployment,
other settings, another branch or another candidate. Unknown values outside
these exact keys remain release blockers.

Acceptance requires all of the following independently collected evidence:

- Complete fresh provider metadata, with the historical sensitive records
  unchanged and Preview settings confined to their reviewed branches.
- The exact tenant and separate Preview Microsoft application ID. The dedicated
  Preview signing record retains its reviewed provisioning operation marker.
- A protected, owner-reviewed Preview-build workflow archive containing the
  complete allowlisted Git creation request and durable pre-write intent.
  Environment overrides, cloned deployments and unreviewed request fields fail.
- Fresh READY deployment readback and exact source/lock/build provenance.
- A protected normal-user archive with a synthetic attachment-signing check
  against the exact reviewed handler/core/dispatcher source. The signed URL is
  discarded; no attachment is fetched and no email is sent.
- Every existing normal-user module/read workflow, read-only safety guard,
  credential target, authenticated restricted check and quality requirement.

Both release collectors obtain this evidence themselves. A local saved pass
report does not authorize execution. Original workflow/archive timestamps are
retained, and compatibility promotion recollects proof at its existing approval
boundaries. Protected harness controls and candidate application configuration
are hashed separately into the reviewed release configuration revision.

The new Preview-build workflow is disabled by default. Installing this verifier
requires owner review of its exact commit under `CI_BOOTSTRAP_REVIEW.md`.
Installation does not enable the workflow, grant Microsoft access, replace
credentials, change Production configuration or authorize Production promotion.
Microsoft trust/mailbox scope, the new Preview client setting, workflow activation
and each credential-using run still require their applicable existing gates.
The application candidates and mobile implementation are unchanged.

The disabled job condition reads the repository enable variable before entering
the protected environment. Eventual approved activation must pin that repository
variable and the independently checked protected-environment variables; setting
only one does not authorize a build. No activation setting is changed by this PR.
