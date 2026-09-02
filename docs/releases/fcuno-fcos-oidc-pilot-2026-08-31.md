# FCUNO-FCOS OIDC Production Pilot Release

Release date: 31 August 2026  
Status: Active two-user pilot  
Protocol: `1.0`

## Paired immutable release

| Component | Verified source | Production deployment | Production alias |
|---|---|---|---|
| FCUNO identity provider | `16ee412293fa32c35a94165fe467027decd21f94` | `dpl_BDa1XF4BTjN7kvAEaNPzJx4vKkiT` | `https://fcuno.com` |
| FCOS identity consumer | `9ef0f8223216d558c895d3cf5129a46310871c0a` | `dpl_EfuFFNEZdS2PUcYtDGUvyK94ywxW` | `https://fcos.fcuno.com` |

The provider was promoted first at 12:00 Hong Kong time. The consumer followed
at 12:02. Both immutable deployments reported `Ready` before the browser
verification began.

The versioned federation contract remains pinned to FCUNO commit
`9d8e05cd338e6105b6a495d68512f63692d3a48c`, protocol `1.0`, and aggregate
SHA-256 `7fc54e7c3bd79fb014ad81dc6d9190d021549d9428486ef85ed78fdff95d7cc2`.

## Database revisions

- FCOS: `20260830172911_fcos_fcuno_identity_federation`
- FCUNO: `20260830182946_fcuno_identity_federation`
- FCUNO compatibility repair: `20260831032849_fix_oidc_pkce_digest_schema`

The FCOS and FCUNO Supabase projects remain separate. Every federation table
has RLS enabled and browser roles do not receive direct access.

## Pilot boundary and reconciliation

- Approved pilots: Vincent Lee and Otto Lai.
- Active verified FCUNO identities with `Use FCOS`: 2.
- Entitled identities outside the approved pilot: 0.
- Synchronized FCOS identity records: 13.
- Entitled records without an FCOS Auth link: 0.
- Duplicate verified identity emails: 0 in FCUNO and 0 in FCOS.
- FCUNO outbox: 16 delivered, 0 pending, 0 failed.
- FCOS synchronization transactions: 16 applied, 0 failed.

The nine other active FCOS authorization profiles remain visible as awaiting an
FCUNO link. They are not entitled pilot users and the federated API boundary
rejects their legacy or unlinked sessions.

## Verification

- FCOS: 1,044 tests passed; lint, type checking and Production build passed.
- FCUNO: federation tests 18/18 and security tests 132/132 passed; lint had no
  errors and the Production build passed.
- Required GitHub checks passed for FCOS draft PR 13 and FCUNO draft PR 12.
- Live Otto-profile verification confirmed:
  - FCOS sign-out followed by `Continue with FCUNO` forces the FCUNO login
    screen instead of silently reusing the previous account.
  - A completed Vincent login returns to FCOS as the existing General Manager.
  - People & Access identifies Vincent and Otto as `Identity · FCUNO` while
    preserving their FCOS roles and permissions.
- FCOS Production reported no runtime errors during the post-release window.

## Rollback

Rollback is provider-compatible and consumer-first:

1. Promote the preceding FCOS immutable Production deployment or disable the
   FCOS OIDC login and federation flags.
2. Keep FCUNO identity synchronization available while FCOS is rolled back so
   no identity revision is lost.
3. Promote the preceding FCUNO deployment only if the provider itself must be
   rolled back; protocol `1.0` remains additive and backward compatible.
4. Do not remove either database migration during rollback. The additive tables
   remain service-only and can safely retain synchronization evidence.
5. Use only the configured, time-limited legacy pilot or break-glass access
   during a rollback. Do not enable company-wide FCOS password login.

## Next controlled batch

Do not broaden access automatically. For each later batch, enable `Use FCOS` in
FCUNO, wait for successful signed delivery, confirm the exact existing FCOS
authorization link and role preservation, then test sign-in and revocation
before adding the next users.
