# FCOS development controls

Saved project defaults use workspace-write, on-request approval and automatic review. Sensitive SQL/migration actions retain human review. Existing chats keep their selected model and permission mode; saved files do not prove active composer settings.

Start each independently edited task in a separate worktree from an explicitly verified base. Preserve the unfinished canonical checkout and unrelated work. Run the canonical setup command from the worktree:

```sh
node /Users/vincex/Documents/FCOS/.codex/setup.mjs
```

Setup verifies the repository and versioned control hashes, refuses conflicting local edits or symlinked control files, and installs locked dependencies for Node 24 when needed. It copies only approved controls and saved environment definitions. It never copies credentials or application changes and never authenticates, tests, migrates or deploys. `--check-only` makes no changes; `--controls-only` skips dependency installation. Reload a chat started before setup to load its project defaults.

```sh
npm run verify:controls
npm run connections:doctor -- --read-only --json
```

Read-only diagnostics describe cached/local tooling evidence, explicitly labelled as unverified live state. Normal verification probes current tooling access without publishing a live attestation. Application runtime connectivity is a separate authenticated, non-refreshing probe. Secret values stay in protected provider storage.

Connection order is verified CLI, independently verified API/connector, then pinned Chrome when both routes cannot perform the operation. The browser adapter requires inventory and exact extension-profile metadata before selecting a browser or opening a task-owned tab. FCOS uses Otto; Salesforce Production and Drive authentication use Vincent; the shared Salesforce mirror uses vincexai. Missing metadata blocks browser access. The adapter is locally tested; live binding to a documented metadata-capable browser API remains unverified. Always close owned tabs and release the runtime; report incomplete cleanup.

Development proceeds through focused tests, draft PR/quality CI, immutable exact-commit Preview READY, provider/runtime parity and protected authenticated workflow evidence. `npm run release:readiness` produces an exact-bound report; unknown observations remain blockers. A successful Preview or green CI does not authorize Production.

The Production workflow is prepared disabled. Activating it requires reviewed default-branch installation, a protected human-reviewed environment, approved scoped credentials and verified prevention of automatic domain assignment or Git deployment bypass. After approval it builds the same reviewed commit with Production configuration, stages without assigning the live domain, verifies the deployment, then assigns the domain. Production migrations, financial actions and credential changes retain separate approvals. Salesforce source promotion remains DEVEE, verified shared mirror, QAT, then Production.

The control-policy revision binds the complete configuration, setup and validation files. When an authorized control edit changes one of them, update the revision and hashes together and run `verify:controls`. Do not update hashes merely to conceal unexpected drift. Mobile development remains suspended.
