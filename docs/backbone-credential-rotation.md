# FCOS Backbone bridge credential rotation

## Purpose

The FCOS–Backbone shadow bridge uses a server-only HMAC secret. This procedure rotates it without pausing FCOS, Salesforce writeback, Google Drive report archive, or scheduled/manual email.

## Controlled sequence

1. Generate a new high-entropy secret outside source control.
2. In Backbone Vercel production settings, set `FCOS_BRIDGE_SHARED_SECRET` to the new value and `FCOS_BRIDGE_SHARED_SECRET_PREVIOUS` to the current live value. Deploy Backbone first.
3. In FCOS Vercel production settings, set `FCOS_BACKBONE_BRIDGE_SECRET` to the new value. Deploy FCOS.
4. From an authenticated FCOS System Health session, run the existing read-only `identity.resolve` probe and verify `credentialVersion` is `primary`.
5. Wait at least five minutes for the signature/replay horizon plus a deployment rollback margin. Remove `FCOS_BRIDGE_SHARED_SECRET_PREVIOUS` from Backbone and deploy Backbone once more.

## Safety limits

- Backbone accepts only the primary and one immediately previous secret; it does not retain a secret history.
- The response label is only `primary` or `previous`; neither secret nor a key identifier is returned.
- Invalid signatures receive no credential label. The bridge stays read-only and does not invoke Salesforce, bank, email, Google Drive, or FCOS business mutations.
- If the probe fails, restore the FCOS secret to the prior value while Backbone's fallback remains configured, investigate from server logs/settings, and keep FCOS's live legacy functions running.
