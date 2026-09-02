# FCUNO-FCOS OIDC Authorized-User Rollout

Rollout date: 31 August 2026  
Status: Entitlements synchronized; first user sign-ins pending  
Scope: Every existing active FCOS authorization profile

## Paired production release

The existing provider, consumer and federation contract are unchanged:

| Component | Verified source | Production deployment |
|---|---|---|
| FCUNO identity provider | `16ee412293fa32c35a94165fe467027decd21f94` | `dpl_BDa1XF4BTjN7kvAEaNPzJx4vKkiT` |
| FCOS identity consumer | `9ef0f8223216d558c895d3cf5129a46310871c0a` | `dpl_EfuFFNEZdS2PUcYtDGUvyK94ywxW` |

No application code, migration, secret or deployment changed for this batch.

## Batch scope

The following eight identities had unique, active, verified FCUNO identities
and exact existing active FCOS authorization profiles:

| Identity | Preserved FCOS user type |
|---|---|
| `diana@cosulich.com.hk` | `sales_support` |
| `kelvin@cosulich.com.hk` | `manager` |
| `laureen@cosulich.com.hk` | `finance` |
| `long@cosulich.com.hk` | `manager` |
| `louisa@cosulich.com.hk` | `finance` |
| `mayshen@cosulich.com.hk` | `manager` |
| `nam@cosulich.com.hk` | `operations` |
| `stanley@cosulich.com.hk` | `manager` |

FCUNO enabled only `Use FCOS`. All eight identity revisions advanced from `1`
to `2`; password hashes, password-reset state, credential revision `1`, FCUNO
roles and `Use SPC=false` were unchanged. The existing FCOS user types and
module permissions remain authoritative and unchanged.

## Synchronization evidence

- Exactly eight guarded target rows were updated atomically.
- Exactly eight signed outbox events were created, delivered on their first
  attempts and applied by FCOS without an error.
- All eight FCOS external links show active, verified, entitled revision `2`.
- All eight audit rows are attributed to the approved rollout and list only
  `identity_revision` and `use_fcos` as changed fields.
- FCUNO outbox after completion: 25 delivered, 0 pending and 0 failed.
- FCOS synchronization after completion: 25 applied and 0 non-applied.
- Duplicate active verified emails: 0 in FCUNO and 0 in FCOS.

## Resulting access boundary

- Existing active FCOS authorization profiles entitled through FCUNO: 11.
- Eligible profiles already linked through a user-completed FCOS Auth flow: 2,
  Vincent and Otto.
- Eligible profiles awaiting their own first FCUNO sign-in: 9, Chengyuan plus
  the eight identities in this batch.
- `joe@cosulich.com.hk` and `thuy@cosulich.com.hk` remain `Use FCOS=false`
  because neither has an FCOS authorization profile. No permission record was
  invented for them.

Each unclaimed user must select `Continue with FCUNO` and complete their own
FCUNO authentication. After first use, verify the claimed subject, preserved
local role and revocation behavior. New users remain fail-closed until both an
explicit FCOS authorization profile and FCUNO entitlement are approved.
