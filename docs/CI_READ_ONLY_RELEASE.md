# Read-only CI and authenticated release evidence

`quality.yml` is intentionally a read-only pull-request workflow. It can
checkout and test a pull-request candidate, but it never receives the FCUNO
test identity, Vercel protection bypass secret, protected environment, or a
persisted GitHub checkout credential. It cannot log into FCUNO or run the
authenticated browser suite.

The `authenticated-browser` check is therefore expected to fail
until an authorized reviewer creates evidence for the exact PR SHA. A skipped
or green check is not evidence. It reads successful `workflow_dispatch` runs
for `authenticated-release.yml`, requires their workflow path and head branch
to be the protected default branch, then looks for a non-expired
`fcos-ci-evidence-<PR SHA>` artifact. It never downloads or executes artifact
contents. This avoids treating a same-repository workflow's forgeable check-run
name as proof. The required branch-protection policy must protect
`.github/workflows/**` with required code-owner review.

## Creating evidence

An approved reviewer starts **FCOS authenticated release evidence** using
`workflow_dispatch` from the protected default branch. The reviewer supplies:

- the exact full lowercase PR head SHA;
- the exact immutable FCOS Vercel deployment origin for that SHA.

The workflow rejects a non-default-branch or unprotected-ref dispatch, checks out the immutable
default-branch dispatch commit (`github.sha`) with checkout credentials disabled,
and only then pauses at
the protected `fcos-ci-readonly` environment. That environment must require
human approval and contain `FCOS_E2E_EMAIL`, `FCOS_E2E_PASSWORD`, and
`FCOS_E2E_VERCEL_BYPASS`; `FCOS_AUTH_E2E_ENABLED=true` is also required.

After approval, the trusted harness verifies the candidate URL is canonical,
immutable and HTTPS. The pinned GitHub repository's newest exact-SHA Preview
deployment and its latest status must both be created by `vercel[bot]`, and that
status must be successful and identify the exact supplied URL. Only then is
`/app-version.json` checked for artifact consistency with the supplied SHA.
Candidate-controlled JSON alone can never prove deployment identity. Both the
pre-authentication check and protection bootstrap repeat the independent lookup
using the job's short-lived read-only `deployments` token, never a Vercel admin
token. No provider token is sent to the candidate or FCUNO.
It installs only the reviewed default-branch lockfile, then runs the read-only
browser tests. Only after browser success, it uploads a seven-day non-secret
artifact named `fcos-ci-evidence-<PR SHA>` containing the candidate SHA, URL,
and trusted harness SHA. Re-run the PR quality workflow after the artifact is
published.

The protected bypass is exchanged out of browser tracing and becomes one
short-lived, Secure, HttpOnly, host-only candidate cookie. Authentication and
protection storage JSON use separate absolute paths under a runner-created
`0700` directory. Files are exclusively created with no symlink following and
restricted to `0600`; cleanup removes only those two files and their dedicated
directory. Screenshots and traces are disabled for the authenticated harness,
and neither the password nor protection secret is printed.
Screenshot and video suppression is enforced in `playwright.config.js` for all
authenticated projects, including stored-session runs. The command uses only
supported CLI options; a local `--list` regression check exercises the exact
workflow arguments without signing in or starting a server.

## Human-review boundary

Checking independently reported SHA and Vercel URL proves candidate identity; it does not
make candidate JavaScript trusted. The candidate runs in a browser after an
FCUNO login and can observe data available to the governed read-only account.
Approve `fcos-ci-readonly` only after reviewing that candidate's code and its
external requests. Never use this workflow to approve an unreviewed PR, a
production alias, a branch alias, or a candidate whose SHA was not reviewed.

## Dedicated identity activation

The non-secret policy in `config/fcosCiIdentity.js` pins `it@cosulich.com.hk`
to its exact FCUNO issuer and immutable subject. Its mailbox is an alias; that
does not give it Vincent's application identity or permissions.

1. Keep FCUNO role **NONE**, every workspace permission **none**, attendance
   unassigned and **Use SPC** off. Complete email verification and first-login
   password reset through FCUNO. Do not put a password in chat, Git, logs or a
   checkpoint file.
2. After reviewing this patch and its tests, enable **Use FCOS** through the
   governed FCUNO user-management workflow. FCOS must receive the signed live
   entitlement and verified email. Never activate or assign ordinary Viewer
   defaults through a direct database update.
3. Enable `FCOS_ENABLE_READ_ONLY_CI=true` only on the reviewed candidate. Its
   FCOS database profile deliberately stays inactive with zero permissions.
   This release admits it in memory only after exact identity/live entitlement
   checks. Rolling back to an earlier application therefore cannot admit it.
4. Set the protected `fcos-ci-readonly` environment's `FCOS_E2E_EMAIL` to the
   pinned email. The account owner enters its password directly as
   `FCOS_E2E_PASSWORD` in GitHub's secret UI. Put the dedicated candidate-only
   Vercel bypass in `FCOS_E2E_VERCEL_BYPASS`, then set the environment variable
   `FCOS_AUTH_E2E_ENABLED=true`. Do not reuse legacy Viewer repository credentials.
5. Have a human review and install this trusted harness on the protected default
   branch before its first dispatch. This bootstrap requires an explicit
   reviewed merge; do not bypass required checks or approve the environment as
   the agent. Thereafter dispatch against the independently verified candidate.

The profile can read only Dashboard and Markets; every capability is false.
All other routes show Access Denied before mounting their workspace. The server
also denies unknown, financial, email, upload, AI, administrative and preference
mutations regardless of route or a mistakenly assigned database role. Markets
snapshot reads cannot trigger hedge-expiry reconciliation; CI notifications are
empty and cannot trigger operational reconciliation. Normal user workflows are
unchanged. Signed identity sync, initial zero-permission identity provisioning
and security telemetry remain system lifecycle operations, not CI business
write permissions.

### Preview configuration

The CI branch requires the public OIDC enable flag, federation enable flag and
pinned issuer in addition to the already-configured Preview backend. Scope
these non-secret flags, and `FCOS_ENABLE_READ_ONLY_CI`, to the reviewed CI branch
only. Keep `FCOS_DISABLE_SALESFORCE_WRITE` in place. Do not clone Production
secrets into Preview, weaken deployment protection, or alter the live domain.
An older staged Production candidate is not a substitute for the independently
verified Git-linked Preview required by this harness. A candidate build is not
an authorization to run credentials against it: the protected human review and
verified CI entitlement are still required.

## Acceptance and retirement

Do not call CI ready until the exact candidate passes the renewable FCUNO login,
identity/module/capability assertions, desktop/mobile Dashboard and Markets
checks, restricted-workspace matrix and server mutation-denial tests. A skipped
run, old artifact or an ordinary employee session is not acceptance. No
production financial mutation is part of verification.
The direct API checks reuse one app-owned authenticated request against the
same independently verified Preview origin. Fixed empty/incomplete payloads
contain no real record IDs or financial values. Every generic, mixed-action,
document-export and notification-wrapper probe must return HTTP 403 with
`FCOS_CI_READ_ONLY`, not a generic authentication or validation failure. Tokens
are never extracted into logs or separately persisted; redirects/retries are
disabled and failures contain only the probe's fixed path.

Keep the application disabled for this identity until the guarded candidate is
ready. After acceptance, remove obsolete repository-level CI credentials and
retain only the protected environment secrets. Changing or revoking the live
FCUNO entitlement disables subsequent requests; disabling the deployment flag
also fails closed. Never promote an earlier candidate just because it is READY.
