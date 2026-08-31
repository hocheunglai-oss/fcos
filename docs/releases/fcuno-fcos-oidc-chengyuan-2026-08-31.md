# FCUNO-FCOS OIDC Controlled Rollout Batch 2

Rollout date: 31 August 2026  
Status: Entitlement synchronized; user sign-in pending  
Identity: `chengyuan@cosulich.com.hk`

## Scope

Chengyuan Li is the only identity in this batch. The existing paired Production
deployments and federation contract are unchanged:

| Component | Verified source | Production deployment |
|---|---|---|
| FCUNO identity provider | `16ee412293fa32c35a94165fe467027decd21f94` | `dpl_BDa1XF4BTjN7kvAEaNPzJx4vKkiT` |
| FCOS identity consumer | `9ef0f8223216d558c895d3cf5129a46310871c0a` | `dpl_EfuFFNEZdS2PUcYtDGUvyK94ywxW` |

No application code, migration, secret or deployment changed for this batch.

## Entitlement and synchronization evidence

- FCUNO changed only `Use FCOS` from false to true and incremented the identity
  revision from `1` to `2`.
- FCUNO retained Chengyuan's active, verified identity, role, `Use SPC=false`,
  credential revision `1` and existing credential state. The password hash was
  unchanged by the entitlement write.
- FCUNO outbox event `56538dac-a70a-4415-8720-7fd558d775a7` was delivered on its
  first attempt with no error.
- FCOS transaction `a62ddc57-e81a-4f39-9440-c74962cfbfd8` applied that exact
  event and revision with no error.
- FCOS preserved the existing active `Chengyuan Li` authorization profile and
  its Trader role (`user_type=manager`). FCUNO continues to own identity and
  entitlement; FCOS continues to own application authorization.
- The FCOS Auth link remains unclaimed. Chengyuan must complete his own first
  `Continue with FCUNO` sign-in; no administrator or automation may impersonate
  that verification.

## Post-batch reconciliation

- Active, verified FCUNO identities with `Use FCOS`: 3.
- Eligible FCOS external identity links: 3.
- FCOS Auth-linked eligible identities: 2.
- Eligible identities awaiting first user sign-in: 1, Chengyuan only.
- FCUNO outbox: 17 delivered, 0 pending and 0 failed.
- FCOS synchronization transactions: 17 applied and 0 failed.
- Identities newly enabled outside this batch: 0.

## Remaining verification

After Chengyuan signs in, verify that FCOS claims the synchronized subject,
retains his existing Trader permissions and records the Auth link. Then test
FCUNO sign-out/revocation for Chengyuan before approving any later rollout
batch. The completed Vincent/Otto pilot remains the rollback reference.
