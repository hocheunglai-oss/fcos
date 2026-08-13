# FCOS Project Connections

These connection identities are specific to this repository. Do not infer or reuse an account from another Codex project.

- GitHub repository: `hocheunglai-oss/fcos`
- Required GitHub account for mutations: `hocheunglai-oss`
- Vercel project: `hocheunglai-6535s-projects/fcos`
- Supabase project: `pjforfvchygdyqfcgpmw` (`FCOS`)
- Salesforce Production: `00D2x000000Ei4oEAC` (alias `source-salesforce`)
- Salesforce Devee sandbox: `00D1m0000008kioEAA` (alias `fcos-devee`, username `vincent@cosulich.com.hk.devee`)
- Salesforce QAT sandbox: `00D1s0000008lFEEAY` (alias `fcos-qat`, username `vincent@cosulich.com.hk.qat`)
- Shared Salesforce GitHub repository: `ivanyk20/fcbhk` (`src/` mirror)
- Required shared-repository GitHub account: `vincelessxai` (isolated config `.fcos-cli/github-vincelessxai`)
- Browser profile: `Otto`

Before any GitHub mutation, verify the authenticated GitHub identity. If the GitHub CLI identity is not exactly `hocheunglai-oss`, do not attempt a command-line push and do not change machine-wide credentials. Use the authorized GitHub connector for this repository or stop with a clear account-mismatch message.

Before any Supabase, Vercel, or browser mutation, verify the target project or profile against the identifiers above. Fail closed on a mismatch.

Before any Salesforce metadata mutation, verify the exact org ID and sandbox flag. Save Salesforce source in this project and deploy identical changes to Production, Devee, and QAT, with tests appropriate to each target. Production remains the runtime default; never silently substitute one environment for another.

Every deployed Salesforce metadata change must also be published byte-for-byte from `force-app/main/default/` into the established `src/` layout of `ivanyk20/fcbhk`. Use only the isolated `vincelessxai` GitHub configuration, preserve unrelated shared-repository files, and update the current open draft PR or create a new draft PR when none is open. A Salesforce deployment is not complete until `npm run salesforce:mirror:verify` passes. Never merge the shared PR unless the user explicitly requests it.
