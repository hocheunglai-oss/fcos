import { createHash } from 'node:crypto';
import { CONNECTION_INTEGRATIONS } from '../src/lib/connectionChecklist.js';
import { marketReportLimits, parseMarketReportPdf } from './_marketIntelligence.js';

const DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const DRIVE_PDF_MIME_TYPE = 'application/pdf';
const DEFAULT_IMPORT_LIMIT = 25;

function syncError(message, code = 'MARKET_DRIVE_SYNC_FAILED', statusCode = 502) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function normalizedErrorCode(error) {
  const value = String(error?.code || 'MARKET_DRIVE_SYNC_FAILED').toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 80);
  return value || 'MARKET_DRIVE_SYNC_FAILED';
}

function safeDriveId(value) {
  return /^[A-Za-z0-9_-]{10,200}$/.test(String(value || ''));
}

function safeMd5(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{32}$/.test(normalized) ? normalized : null;
}

function validIsoDateTime(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
}

async function driveJson(fetchImpl, accessToken, path, query = {}) {
  const url = new URL(`https://www.googleapis.com/drive/v3/${path.replace(/^\//, '')}`);
  for (const [key, value] of Object.entries(query)) if (value != null) url.searchParams.set(key, String(value));
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw syncError('Google Drive market-report metadata could not be read.', 'MARKET_DRIVE_METADATA_FAILED');
  return data;
}

async function driveBuffer(fetchImpl, accessToken, fileId) {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw syncError('A Google Drive market report could not be downloaded.', 'MARKET_DRIVE_DOWNLOAD_FAILED');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw syncError('A Google Drive market report was empty.', 'MARKET_DRIVE_EMPTY_FILE');
  return buffer;
}

async function verifyDriveAuthority(fetchImpl, accessToken, config) {
  const about = await driveJson(fetchImpl, accessToken, 'about', { fields: 'user(emailAddress)' });
  if (String(about.user?.emailAddress || '').trim().toLowerCase() !== config.accountEmail.toLowerCase()) {
    throw syncError('Google Drive market-report authorization does not match the approved account.', 'MARKET_DRIVE_IDENTITY_MISMATCH', 503);
  }

  const root = await driveJson(fetchImpl, accessToken, `files/${encodeURIComponent(config.rootFolderId)}`, {
    fields: 'id,name,mimeType,trashed',
    supportsAllDrives: 'true',
  });
  if (root.id !== config.rootFolderId || root.mimeType !== DRIVE_FOLDER_MIME_TYPE || root.trashed === true) {
    throw syncError('Google Drive market-report root does not match the approved folder.', 'MARKET_DRIVE_ROOT_MISMATCH', 503);
  }

  for (const folder of config.folders) {
    const metadata = await driveJson(fetchImpl, accessToken, `files/${encodeURIComponent(folder.folderId)}`, {
      fields: 'id,name,mimeType,trashed,parents',
      supportsAllDrives: 'true',
    });
    if (metadata.id !== folder.folderId
        || metadata.mimeType !== DRIVE_FOLDER_MIME_TYPE
        || metadata.trashed === true
        || !Array.isArray(metadata.parents)
        || !metadata.parents.includes(config.rootFolderId)) {
      throw syncError('Google Drive market-report folders do not match the approved hierarchy.', 'MARKET_DRIVE_FOLDER_MISMATCH', 503);
    }
  }
}

async function listDriveReports(fetchImpl, accessToken, folder) {
  const files = [];
  let pageToken = null;
  do {
    const data = await driveJson(fetchImpl, accessToken, 'files', {
      q: `'${folder.folderId}' in parents and trashed = false and mimeType = '${DRIVE_PDF_MIME_TYPE}'`,
      fields: 'nextPageToken,files(id,name,mimeType,size,md5Checksum,modifiedTime)',
      pageSize: 1000,
      orderBy: 'modifiedTime asc,name asc',
      spaces: 'drive',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      pageToken,
    });
    for (const file of data.files || []) {
      if (!safeDriveId(file.id) || file.mimeType !== DRIVE_PDF_MIME_TYPE) continue;
      files.push({
        id: file.id,
        name: String(file.name || '').slice(0, 255),
        size: Number(file.size || 0),
        md5: safeMd5(file.md5Checksum),
        modifiedAt: validIsoDateTime(file.modifiedTime),
        documentType: folder.documentType,
      });
    }
    pageToken = data.nextPageToken || null;
  } while (pageToken);
  return files;
}

async function loadKnownMd5(client) {
  const known = new Set();
  for (let offset = 0; ; offset += 1000) {
    const result = await client
      .from('market_report_imports')
      .select('source_md5')
      .not('source_md5', 'is', null)
      .range(offset, offset + 999);
    if (result.error) throw syncError('Stored market-report checksums could not be loaded.', 'MARKET_DRIVE_CHECKSUMS_FAILED');
    for (const row of result.data || []) {
      const md5 = safeMd5(row.source_md5);
      if (md5) known.add(md5);
    }
    if ((result.data || []).length < 1000) break;
  }
  return known;
}

export function marketDriveRunKey(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) throw syncError('Market sync time is invalid.', 'MARKET_DRIVE_TIME_INVALID', 500);
  return `market-drive:${date.toISOString().slice(0, 13)}`;
}

async function finishRun(client, runKey, summary, status, errorCode = null) {
  const result = await client.rpc('finish_market_report_sync_run', {
    p_run_key: runKey,
    p_status: status,
    p_discovered_count: summary.discoveredCount,
    p_skipped_count: summary.skippedCount,
    p_imported_count: summary.importedCount,
    p_failed_count: summary.failedCount,
    p_deferred_count: summary.deferredCount,
    p_error_code: errorCode,
  });
  if (result.error) throw syncError('Market sync outcome could not be recorded.', 'MARKET_DRIVE_RUN_FINISH_FAILED');
  return result.data;
}

export async function runMarketReportDriveSync(client, {
  accessToken,
  fetchImpl = fetch,
  parseReport = parseMarketReportPdf,
  config = CONNECTION_INTEGRATIONS.googleDriveMarketReports,
  now = new Date(),
  importLimit = DEFAULT_IMPORT_LIMIT,
} = {}) {
  if (!client || !accessToken) throw syncError('Market sync authorization is unavailable.', 'MARKET_DRIVE_AUTH_UNAVAILABLE', 503);
  if (!config?.accountEmail || !config?.rootFolderId || !Array.isArray(config?.folders) || config.folders.length !== 2) {
    throw syncError('Market sync target configuration is incomplete.', 'MARKET_DRIVE_CONFIG_INVALID', 500);
  }
  const runKey = marketDriveRunKey(now);
  const reserve = await client.rpc('reserve_market_report_sync_run', { p_run_key: runKey });
  if (reserve.error) throw syncError('Market sync could not reserve its hourly operation.', 'MARKET_DRIVE_RUN_RESERVE_FAILED');
  if (reserve.data?.reserved !== true) return { duplicate: true, runKey, status: reserve.data?.status || null };

  const summary = { discoveredCount: 0, skippedCount: 0, importedCount: 0, failedCount: 0, deferredCount: 0 };
  try {
    await verifyDriveAuthority(fetchImpl, accessToken, config);
    const [knownMd5, ...folderFiles] = await Promise.all([
      loadKnownMd5(client),
      ...config.folders.map((folder) => listDriveReports(fetchImpl, accessToken, folder)),
    ]);
    const files = folderFiles.flat().sort((left, right) => String(left.modifiedAt || '').localeCompare(String(right.modifiedAt || '')) || left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
    summary.discoveredCount = files.length;

    const candidates = [];
    const queuedMd5 = new Set();
    for (const file of files) {
      if (file.md5 && (knownMd5.has(file.md5) || queuedMd5.has(file.md5))) {
        summary.skippedCount += 1;
        continue;
      }
      if (file.md5) queuedMd5.add(file.md5);
      candidates.push(file);
    }
    const limit = Math.max(1, Math.min(Number(importLimit) || DEFAULT_IMPORT_LIMIT, 50));
    summary.deferredCount = Math.max(0, candidates.length - limit);

    for (const file of candidates.slice(0, limit)) {
      try {
        if (file.size > marketReportLimits.maxBytes) throw syncError('A market report exceeds the configured PDF limit.', 'MARKET_REPORT_TOO_LARGE');
        const buffer = await driveBuffer(fetchImpl, accessToken, file.id);
        const md5 = createHash('md5').update(buffer).digest('hex');
        if (file.md5 && md5 !== file.md5) throw syncError('Google Drive market-report checksum validation failed.', 'MARKET_DRIVE_CHECKSUM_MISMATCH');
        if (knownMd5.has(md5)) {
          summary.skippedCount += 1;
          continue;
        }
        const parsed = await parseReport(buffer, { documentType: file.documentType, filename: file.name });
        const saved = await client.rpc('save_market_drive_report_import', {
          p_idempotency_key: `market-drive-${parsed.sourceHash}`,
          p_source_document_type: file.documentType,
          p_source_hash: parsed.sourceHash,
          p_source_md5: md5,
          p_drive_file_id: file.id,
          p_drive_modified_at: file.modifiedAt,
          p_report_date: parsed.reportDate,
          p_observations: parsed.observations,
        });
        if (saved.error) throw syncError('A parsed market report could not be saved.', 'MARKET_DRIVE_IMPORT_FAILED');
        knownMd5.add(md5);
        summary.importedCount += 1;
      } catch (error) {
        summary.failedCount += 1;
        if (!summary.errorCode) summary.errorCode = normalizedErrorCode(error);
      }
    }

    const status = summary.failedCount ? 'failed' : 'completed';
    await finishRun(client, runKey, summary, status, summary.errorCode || null);
    return { ...summary, runKey, status, accountEmail: config.accountEmail };
  } catch (error) {
    summary.failedCount = Math.max(1, summary.failedCount);
    const errorCode = normalizedErrorCode(error);
    await finishRun(client, runKey, summary, 'failed', errorCode).catch(() => {});
    throw error;
  }
}
