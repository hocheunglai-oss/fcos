# FCOS Project Connections

These connection identities are specific to this repository. Do not infer or reuse an account from another Codex project.

- GitHub repository: `hocheunglai-oss/fcos`
- Required GitHub account for mutations: `hocheunglai-oss`
- Vercel project: `hocheunglai-6535s-projects/fcos`
- Supabase project: `pjforfvchygdyqfcgpmw` (`FCOS`)
- Salesforce Production: `00D2x000000Ei4oEAC` (alias `source-salesforce`)
- Salesforce Devee sandbox: `00D1m0000008kioEAA` (alias `fcos-devee`, username `vincent@cosulich.com.hk.devee`)
- Salesforce QAT sandbox: `00D1s0000008lFEEAY` (alias `fcos-qat`, username `vincent@cosulich.com.hk.qat`)
- Browser profile: `Otto`

Before any GitHub mutation, verify the authenticated GitHub identity. If the GitHub CLI identity is not exactly `hocheunglai-oss`, do not attempt a command-line push and do not change machine-wide credentials. Use the authorized GitHub connector for this repository or stop with a clear account-mismatch message.

Before any Supabase, Vercel, or browser mutation, verify the target project or profile against the identifiers above. Fail closed on a mismatch.

Before any Salesforce metadata mutation, verify the exact org ID and sandbox flag. Save Salesforce source in this project and deploy identical changes to Production, Devee, and QAT, with tests appropriate to each target. Production remains the runtime default; never silently substitute one environment for another.
