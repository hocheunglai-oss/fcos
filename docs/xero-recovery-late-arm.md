# Future v3 recovery start boundary

V3 is explicit, future source. It cannot retime an old v1/v2 plan, reissue a
consumed operation, enlarge the original recovery/Organisations authority, or
reuse an expired host/run. V1/v2 descriptors and their literal deadlines retain
their existing meanings. Source installation does not activate v3.

The plan retains the original immutable operation, approval, historical owner,
actor, tenant, token-version CAS, source and fixed lease/probe/request IDs. Its
paired v3 template retains the exact protected caller/controller and actual
original run. The v3 binding replaces `issuedAt`/`notAfter` with:

- `preparedAt`: preparation provenance, never financial authority.
- `armBefore`: an immutable finite first-claim cutoff.
- `absoluteNotAfter`: the earliest applicable original credential-authority or
  cleanup expiry; at most 24 hours after preparation. It must leave at least
  15 minutes after `armBefore`. This is not the recovered Xero token's expiry.
- `executionWindowMs`: 900000–1800000 milliseconds, with no renewal route.

Template `issuedAt`/`notAfter` denote preparation/absolute bounds for v3 and
must equal `preparedAt`/`absoluteNotAfter`. They do not start execution.

The existing `xero_recovery_step_claim` transaction inserts the original
ordinal-0 preflight attempt. Its immutable database `claimed_at` is the sole
start clock. The derived receipt is:

```
execution: {
  firstStartedAt: floor(epoch(claimed_at) * 1000),
  executionDeadlineAt: min(firstStartedAt + executionWindowMs, absoluteNotAfter)
}
```

Every later claim, completion, state and owner readback derives that same pair.
The additive migration uses the existing three append-only tables and invoker
functions. There is no activation RPC, updateable clock row, new table or change to existing table/function grants. The new read-only clock
helper is executable only by the existing service role. The service credential's existing direct-DML trust boundary remains.
The first claim is durable `submitted_unknown` before execution, even if its
HTTP response is lost. It never authorizes replay or takeover. Lock/index waits
are checked before an execute receipt escapes; completion expiry preserves
unknown rather than inventing an ACK.

The reusable workflow uses a bounded public preparation job followed by the
30-minute execution job in the same run. Preparation uses read-only GitHub access without a protected environment
or Vercel/owner credentials. Its bootstrap OIDC uses the protected branch
subject, which cannot authenticate to the private financial host. It verifies
the fixed locator's authenticated publisher status and public metadata, then
releases execution. Root reviews actual source before publishing the locator;
the execution job independently downloads and verifies all three original source
files before login. Preparation never logs in the owner, posts to the host or
calls a financial RPC. The actual execution job must then
be observed. No queued or future job ID is assumed. Legacy templates return
from preparation without changing their fixed deadlines. Owner GET remains a
separately admitted readback invocation.

The original fixed locator commit contains exactly `locator.json` and, for v3,
`execution-preflight.json`. The latter is bounded canonical public JSON:

```
{schemaVersion: 1, kind: 'fcos_xero_execution_preflight_v1',
 operationId, planSha256, preflight: <existing own-profile public preflight>}
```

The v3 locator binds its SHA256. The same existing guarded ref push and status
POST publish both files; no additional readiness write exists. The metadata
can refresh only original read observations and a nondecreasing revocation
floor. It cannot alter source, own identity/access revision, permissions, CAS,
key, authority or destination. The native financial admission must bind that
exact file in `evidence.executionPreflight`, its SHA in the target/binding, and
both existing root/independent reviews must set
`actualExecutionPreflightReviewed: true` after reviewing actual read provenance.
A hash or `accepted:true` alone is not evidence.

V3 native financial binding additionally contains `executionPreflightSha256`
and `executionJobStartedAt` (epoch milliseconds from the genuine observed job).
The original root/peer target and scope hash bind both. Before the first local
claim attempt, intent, credential access or provider command, at least 15
minutes must remain in the actual execution job, absolute scope and 30-minute
public metadata horizon. Live job identity/started time is rechecked inside
the existing guarded callback. Later steps use the same deadlines without
reapplying the first-start floor. The carrier repeats the first-start checks,
uses the fresh public login preflight, and still performs real own login and
fresh host Supabase/FCUNO/GitHub identity checks for each request.

V3 host results/readback have strict `_v3` kinds and the safe `execution` pair.
The actual HTTP artifact additionally binds `executionPreflightSha256`. Native
and carrier consumers require the unchanged pair across ACKs. Ordinary action
requests remain the same fixed bounded step protocol. The SQL clock is an
execution ceiling: metadata, identity, job, quota, probe and absolute scopes can
expire sooner. A full 30 minutes or successful completion is not promised.

The original eleven-step cap, optional refresh path, one Organisations GET,
quota reserve, five-minute probe, 30-second token return and separately approved
15-second private returned-token capture remain unchanged. Cancellation or
unknown stops all ordinary following calls, retries, rearm and cleanup. The
coordinator stays credential-free. Any new actual host, dispatch, financial
admission and migration still requires its applicable original authority and
current root/independent evidence; these local fixtures grant none.

V3 separately admitted owner-readback descriptors additionally carry the bounded
public `executionPreflightJson`. The same original readback scope hash binds its
SHA256 and both existing reviews must attest the actual fresh read proof. This
permits fresh identity observation for GET after an unknown without republishing
the original locator, resetting the SQL clock or granting a POST. The original
4096-byte readback bound and absolute credential/cleanup expiry still apply. A
reader job uses the same protected source but does not impersonate the original
execution job or require a financial preparation job in the new reader run.
