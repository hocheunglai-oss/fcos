# Guarded provider write orchestration

`runGuardedProviderWrite` is a small, serialized orchestration boundary for an
already-approved provider callback. It does not acquire financial, release, or
provider authority. It neither resolves nor releases a lease, and it controls
only callers that deliberately use it; it cannot intercept arbitrary direct
tool calls.

The expected binding must contain exactly `epoch`, `objective`,
`ownerThreadId`, `operationId`, and `bindingSha256`. The epoch is a bounded,
non-empty identifier. Every claim and assertion command must have a completed
zero exit code, JSON-only stdout, no session id, no tool-error marker, and no
error or signal. The returned lease must contain exactly the binding fields,
its UUID `leaseId`, and the three coordination flags: `coordinationOnly:true`,
`providerAuthorityGranted:false`, and `uncertainOutcomeRequiresReadback:true`.

The callback order is fixed: claim; assert; durable `prepared` intent; assert;
durable `submitting` intent; final assert; exactly one provider callback. Each
intent receipt must be a durable JSON receipt for the exact held lease. The
helper freezes internal clones before passing them to callbacks, so callbacks
cannot alter the caller's expected binding or the validated lease.

`submit` must return either a completed command envelope or a non-error MCP
envelope. Neither a text response nor `isError:false` proves provider
acceptance. `validateProviderResult` is required and must return strictly
`true` only after the caller's supported provider-specific acknowledgement or
readback rule has passed. A provider exception, missing/pending/failed result,
or false validator produces one required durable `uncertain` outcome record.
There is no retry, automatic reconciliation, or release path. If outcome
recording fails, the return status is `uncertain_outcome_recording_failed` and
the lease remains held.

An accepted provider callback is also recorded durably as `submitted` before
the helper returns `submitted_acknowledged`. This means only that the provider
acknowledged the submitted request; it is not business completion or a
replacement for provider-specific readback. Failure to record that
acknowledgement is likewise unresolved and returns
`uncertain_outcome_recording_failed`.

For supported execution, load the reviewed local function source and verify it
before compilation. The source command itself emits only the function text;
the loader must check its command result before using it.

```js
const sourceResult = await exec_command({ cmd: 'node scripts/guarded-provider-write-source.mjs' });
if (sourceResult.exit_code !== 0 || sourceResult.session_id || sourceResult.error || sourceResult.signal
  || typeof sourceResult.output !== 'string') throw new Error('guard source unavailable');
const source = sourceResult.output;
if (sha256(source) !== approvedGuardSourceSha256) throw new Error('guard source hash mismatch');
const runGuardedProviderWrite = Function(`"use strict"; return (${source});`)();
```

The caller supplies only reviewed callbacks for its supported orchestration
path. The loader does not grant authority, execute a provider command by
itself, or make arbitrary provider tooling safe.

```js
const result = await runGuardedProviderWrite({
  expected, claim, assertLease, recordIntent,
  submit: async ({ lease }) => supportedProviderSubmit({ lease }),
  validateProviderResult: result => result?.isError === false && supportedProviderAcknowledgement(result),
  recordOutcome
});
if (result.status !== 'submitted_acknowledged') throw new Error('provider outcome remains unresolved');
```

If the helper refuses or returns either uncertain status, stop the enclosing
operation. Do not chain another provider action, retry submission, resolve the
lease, or interpret a provider acknowledgement as business completion.
