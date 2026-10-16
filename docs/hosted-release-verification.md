# Hosted release verification v2

`config/release-checks-v2.json` is the command and prerequisite source for the new hosted workflow, the local runner and its proof validators. The historical `candidate-quality.yml`, f457 admission and v1 receipt contracts remain separate and unchanged.

A source profile is explicit. `frozen_04ee` binds `04ee3425aac7a49089eda781eb3c976aea1f6785` and preserves its complete original quality scope: full Node unit/integration suite, lint, both typecheck projects, compatibility, Graph source, the actual four browser fixture suites, build, migration replay and all twelve database categories. `historical_f457` includes its two additional fixture suites. `controller_v2` verifies the new controller code and Python ledgers; it cannot substitute for the frozen business candidate's fixture/database evidence. Missing required files cause failure. Applicable required checks are derived from `requiredReleaseChecks(manifest, sourceProfile)`; they are never silently skipped.

The fixed build commands preserve the actual candidate scripts. Frozen business candidates run methodology asset generation, hosted FCUNO environment verification, version generation and Vite. The current controller profile runs version generation and Vite. The runner never resolves an executable command from candidate `package.json` scripts or from a candidate copy of the manifest.

## Runner and report interface

Run the trusted controller's script against a separate exact candidate checkout:

```sh
node controller/scripts/hosted-release-checks.mjs \
  --controller-directory /absolute/controller \
  --controller-sha FULL_IMMUTABLE_CONTROLLER_SHA \
  --candidate-directory /absolute/candidate \
  --candidate-sha FULL_IMMUTABLE_CANDIDATE_SHA \
  --source-profile frozen_04ee \
  --group code \
  --evidence /absolute/outputs/code.json
```

`--group code|fixtures|database` selects independent deterministic jobs. `--check id,id` selects admitted checks and `--phase deterministic|final` selects a phase. `--dependencies report.json,other.json` supplies original prerequisite reports. `--cache report.json` supplies deterministic results to consider for exact reuse. CLI exit codes are 0 for passed, 1 for failed, and 2 for `waiting_dependency`. A missing or pending prerequisite is `waiting_dependency`, including absent live browser or server-bundle proof. It cannot become a skipped required check or a false failed live test. Reports are atomically saved after each check and at completion.

Reports use `schemaVersion: 2`, `kind: fcos_hosted_release_checks`, common binding fields and `checks`. Each check has `checkId`, `status`, `binding`, original `startedAt`/`completedAt` and the complete admitted command results. Waiting records also have `missing`. Bindings contain:

- Exact candidate SHA, immutable controller SHA, source profile and manifest SHA256.
- `sourceInputsSha256`: SHA256 of the JSON-serialized sorted `[trackedPath, SHA256(actualBytes)]` pairs, excluding the two generated build receipts. This is a verification input digest. Canonical deployment `sourceDigest` remains the separate `collectBuildProvenance` deployment-source-v1 value and must be independently admitted by the publisher.
- Actual package lock, installed dependency lock, candidate configuration and relevant check input hashes.
- Actual Node and Python versions, OS and architecture, plus the admitted command hash.
- Actual artifact hashes for client performance and strict final server performance.

`collectReleaseCheckSource`, `collectCheckBinding`, `checkBinding`, `requiredReleaseChecks` and `evaluateCheckEvidence` are exported for the trusted publisher. Candidate source and the admitted controller implementation must be clean. Node major must be 24. Both repository remotes must match the pinned FCOS repository. Credential-bearing tracked paths are rejected before hashing.

## Trust and final acceptance

Candidate execution requires a separate runner with no protected environment, no OIDC write permission, no provider or controller credential, no persisted checkout credential, and no credential-bearing controller files. Environment sanitization is additional containment, not a sandbox against reading sibling files or processes. Installation and candidate tests must use the same separate-runner boundary. The runner supplies a temporary HOME and explicit non-secret environment, fixed disposable localhost database targets and no inherited provider variables. Browser fixtures may execute candidate Vite configuration; they must remain inside this boundary.

A raw candidate report is untrusted. A distinct trusted publisher must independently verify source admission, actual workflow/job outcomes, immutable controller identity, artifact digest and complete required check coverage before accepting it. `evaluateCheckEvidence` requires an explicit `validateExternal(check, record)` callback for volatile provider evidence; the CLI cannot grant that authority merely by loading a JSON file.

Deterministic cache reuse requires an exact binding, complete successful admitted command list and valid original timestamps. Builds recreate their output and are explicitly noncacheable. It preserves the original record verbatim. It never refreshes an old timestamp or relabels an old source/controller result. Live Preview binding, FCUNO, server artifacts and browser proofs remain volatile and must satisfy their original 30-minute freshness boundary as well as independent provider validation.

Restricted browser proof and normal-role proof are distinct required records. Normal-role proof requires real loaded data for all fifteen modules: Dashboard, Markets, Review, Disputes, Buyer Invoices, Unofficial Compensation, Incoming Payments, Cashflow Forecast, Brokers, Master Contracts, Special Terms, Hedge Desk, Xero Portal, Email Router and Settings. Duplicate, absent, heading-only or unavailable module observations fail coverage validation. No live browser credentials enter candidate commands.

`server_performance` always sets `FCOS_REQUIRE_SERVER_BUNDLES=1` and binds both `dist` and `.vercel/output`. Missing universal or dedicated Vercel function bundles fail this check. Frontend-only performance is a separate deterministic check and cannot satisfy final acceptance. `final_acceptance` requires every applicable deterministic check plus fresh Preview, FCUNO, server-bundle, strict performance, restricted-browser and normal-role evidence.

## Salesforce durable resume

The existing `salesforce:deploy:all` entrypoint now journals each environment's bootstrap, validation, deployment and permission stages under `.fcos-cli/salesforce-promotions/<binding>.json`. Writes use an exclusive process lock, atomic rename and file/directory fsync. A dead process lock can be reclaimed; an active process blocks concurrent promotion.

The binding includes the complete authoritative Salesforce tree hash, reviewed manifest and bootstrap bytes, Salesforce connection policy, test level/classes and check-only mode. Frontend, orchestration script and documentation changes do not invalidate successful Salesforce jobs for an unchanged binding. Source, manifest, Salesforce configuration or test assumptions changing creates a new journal and starts from DEVEE.

Every mutation rechecks the exact source and pinned org/username/sandbox identity. Submitted jobs use `--async`; the job ID is durably saved before waiting for an all-or-none successful report. A successful saved validation is quick-deployed rather than revalidated. Resuming rechecks upstream successful deployment reports and permissions; invalid or failed upstream reports stop downstream mutation. A submission with an uncertain outcome and no recorded job ID stops safely for job-ID reconciliation and never silently submits a duplicate.

The sequence remains DEVEE, exact byte-equivalent shared source in an open draft PR, QAT, Production. DEVEE's fresh deployment proof gates shared publication. Shared mirror verification is required before each downstream environment and again at completion. The shared PR is never merged by this command. Schema cutover bootstraps each environment first, uses `NoTestRun` in DEVEE/QAT and `RunRelevantTests` in Production, assigns data permissions, then validates the complete package once with `RunLocalTests`.

Financial and release authorization gates remain outside this journal. A local journal is a continuation record, not permission to promote and not a substitute for current provider reports. No provider writes or live authentication are needed to run the new tests: they exercise the actual entrypoints through temporary repositories and local process stubs, including a killed process and durable resume.
