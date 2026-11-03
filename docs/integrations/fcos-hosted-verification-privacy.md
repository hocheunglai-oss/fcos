# FCOS Hosted Verification — privacy notice

Version 1.0 — 17 October 2026

## Operator and purpose

This notice covers the private FCOS Hosted Verification integration operated for internal FCOS project administration. Contact the project administrator at **vincent@cosulich.com.hk**. The integration is used to verify release identity, configuration and deployment state, and to retain release audit evidence.

## Information used

The integration requests only read access to Vercel Integration Configuration, Deployments and Projects for the selected FCOS project. Responses can contain project, team, installation and deployment identifiers; source references, URLs, timestamps, settings and status; and account or author information included in that metadata. Metadata can contain personal information, so read access must remain restricted to authorised administrators and the admitted verification controller.

Enrollment also processes an installation code, OAuth client credentials and the issued read token. The integration does not request permission to change deployments, environment variables or domains, and is not intended or authorised to retrieve application customer records or execute financial actions. Other FCOS systems and their separate credentials are outside this notice.

## Use, storage and recipients

The reviewed enrollment helper exchanges the installation code directly with Vercel. Client credentials and retained original exchange material are stored in the administrator's local macOS Keychain. The read token is installed as an encrypted GitHub Actions environment secret only in the three isolated FCOS verification environments. The client secret is not installed in those environments. Candidate build and test jobs do not receive these controller credentials.

Vercel processes API requests, and GitHub hosts the verification jobs, secrets and release evidence. Authorised FCOS administrators may access the resulting records. Sanitised status, identifiers and evidence digests may also enter the separate FCOS coordination journal in Supabase; that coordinator receives no Vercel token. This integration is not designed to sell information, perform advertising profiling or provide data to unrelated third parties. These providers' own privacy and retention terms also apply to their services.

Credentials must not be placed in chat, public files, screenshots, support messages or ordinary logs. The reviewed enrollment and verification paths are designed to emit sanitised records instead of credential values or complete private provider responses.

## Retention, revocation and requests

Credential use is limited by the admitted setup and provider access controls. A local admission deadline is not a claim that Vercel has set the same token expiry. Administrators can stop future reads by disabling the integration, removing its GitHub secret or revoking its provider access.

Release audit records can remain after uninstallation. Retention and deletion requests are handled by the FCOS administrator in light of operational, security and applicable recordkeeping requirements; this notice does not promise immediate deletion of provider backups or historical audit evidence. Contact the administrator for access, correction, deletion or other privacy requests relevant to you. Do not include credentials in the request.

## Changes

Material changes to scope, recipients or data handling require administrator review and an updated notice before the changed setup is used. This notice applies only to this private integration and does not replace the privacy notices of FCOS, FCUNO, Vercel, GitHub or Supabase generally.
