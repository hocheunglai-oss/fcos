# FCOS market reports: Google Drive data-use policy

Effective September 9, 2026.

This policy covers the FCOS Market Reports Google Drive integration only. It does not describe other applications or Google integrations.

## Access and purpose

The connection requests Google Drive read-only access. FCOS verifies the approved Google account and limits its market-sync operations to the configured report folders and approved secondary CSV source. It reads account identity, file metadata and checksums, report PDFs, and market CSV content to maintain FCOS market history and related market intelligence. It does not modify, upload, or delete Google Drive files.

## Processing, storage and access

FCOS processes the retrieved reports and stores extracted market observations, source identifiers, checksums, import results, and audit/conflict evidence. The application runs on Vercel and stores application data in Supabase. Imported information is available through FCOS's existing authenticated access controls. Optional market-assistant features may send selected retrieved market context to the AI provider configured by an FCOS administrator; the Drive synchronization itself does not require an AI provider.

Google OAuth credentials are stored as server-side deployment secrets, not in the browser application. The OAuth authorization code is exchanged through a state-checked local callback during administrator setup.

## Retention and disconnection

Imported market and audit records remain in FCOS under its operational retention arrangements. Disconnecting Google access stops future retrieval; it does not automatically delete previously imported FCOS records. Contact the administrator to request review of access, retained records, or deletion. Records needed for an existing audit or reconciliation may require separate handling.

## Control and contact

The approved account holder can review or revoke the application's access in Google Account's third-party connection settings. FCOS administrators control the configured account, report sources, and optional model settings.

Contact: vince.less@gmail.com.
