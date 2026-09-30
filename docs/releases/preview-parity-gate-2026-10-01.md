# Preview configuration release hold

The Variable Charges regression came from an absent Preview runtime flag even though the deployed source was current. Source tests and the protected CI viewer did not prove that normal financial users saw the current workflow.

`verify:release` now independently collects Vercel project, deployment, environment and compiled-login observations before any release tests or browser-state creation. The versioned policy requires an immutable READY Preview at the checkout commit, deployment-bound fresh observations, complete source-switch classification, matching effective business flags, documented safe Preview differences, authenticated provider targets and normal-role workflow coverage. An unknown sensitive setting remains unknown. Presence and denial-only CI checks never establish full parity.

Run `npm run verify:preview-parity` with `FCOS_E2E_CANDIDATE_URL` and `FCOS_E2E_EXPECTED_COMMIT` from a clean checkout and verified repository-pinned Vercel CLI. Only names and blocker codes are emitted. Temporary environment pulls are private and removed. No credential values are copied or saved.

The collector currently cannot attest executed server flags, provider authentication modes or normal-user workflow coverage from CLI deployment metadata. It reports these as unresolved and the release stays blocked. Manual browser observations and local `pass:true` files cannot bypass this hold. Completing the gate requires independently verified runtime/provider probes and a protected normal-role read-only harness; the existing Dashboard/Markets CI identity must retain its restricted access.

Normal-user inspection of the existing v2.0.289 Preview confirmed the paired supplier/buyer layout and loaded Xero reconciliation UI with financial sync locked. This evidence belongs to commit 05e87742137476bf5a92f9e8c0c68ebc53decef8 and must not be claimed for a later gate commit. Historical cases explicitly closed before paired approvals retain their closure; pending review counts must not silently reopen financial cases.

Production promotion, credentials, live records and financial actions remain outside this development change. PR #72 retains its parity review hold until unresolved evidence is completed.
