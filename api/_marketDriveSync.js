import { createHash } from 'node:crypto';
import { CONNECTION_INTEGRATIONS } from '../src/lib/connectionChecklist.js';
import { marketReportLimits, parseMarketReportPdf } from './_marketIntelligence.js';
import { processMarketIntelligenceDate, publishMarketDataQualityAlert, scanExpectedMarketSessions } from './_marketIntelligenceTrading.js';
import { reconcileMarketIntradayDate } from './_marketIntraday.js';

const DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const DRIVE_SHORTCUT_MIME_TYPE = 'application/vnd.google-apps.shortcut';
const DRIVE_PDF_MIME_TYPE = 'application/pdf';
const DRIVE_CSV_MIME_TYPE = 'text/csv';
const MAX_SECONDARY_MOPS_CSV_BYTES = 2 * 1024 * 1024;
const DEFAULT_IMPORT_LIMIT = 25;
// The licensed local audit inspected 855 downloaded files, including 23 extra
// local copies. The governed Drive replay is pinned to the files that actually
// exist in the two approved Drive folders: 832 PDFs, with one byte duplicate.
const REVIEWED_ARCHIVE = Object.freeze({
  startDate: '2025-01-01',
  endDate: '2026-08-19',
  sourceFileCount: 832,
  uniqueReportCount: 831,
  duplicateFileCount: 1,
  driveFingerprint: 'c8a92a76efc0f9ccadf4a2aed0389e1650100e8dc2c2e328fca928ca8e396ed2',
});
// Two Bunkerwire PDFs use a DD/MM-derived filename even though the licensed
// document itself prints the authoritative report date. Bind each exception to
// the exact parsed PDF hash; no filename-wide or date-only relaxation is used.
const REVIEWED_REPORT_DATE_OVERRIDES = Object.freeze({
  dd1256645b3ddeb9802a6641f03eb9cf597f618d6e157569f8aee6d6f7847a98: '2025-09-03',
  '6125cef18b20e75df9ca893bd3f900eba8c8bdbf7118c2ab64a02edb00df3913': '2025-09-05',
});

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

function reportDateFromFilename(value) {
  const match = String(value || '').match(/(?:^|\D)(20\d{2})(0[1-9]|1[0-2])([0-2]\d|3[01])(?:\D|$)/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function parseCsvRecords(value) {
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;
  const text = String(value || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') {
      record.push(field);
      field = '';
    } else if (character === '\n') {
      record.push(field);
      if (record.some((cell) => cell.length)) records.push(record);
      record = [];
      field = '';
    } else field += character;
  }
  if (quoted) throw syncError('The secondary MOPS CSV contains an unterminated quoted field.', 'MARKET_SECONDARY_CSV_INVALID', 409);
  record.push(field);
  if (record.some((cell) => cell.length)) records.push(record);
  return records;
}

function secondaryMopsNumber(value) {
  const normalized = String(value ?? '').trim().replace(/,/g, '');
  if (!normalized || /^(?:N\/?A|NA|null|-)$/i.test(normalized)) return null;
  if (!/^[+]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function parseMarketMopsCsv(buffer, { filename = '', startDate = '2025-01-01' } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_SECONDARY_MOPS_CSV_BYTES) {
    throw syncError('The secondary MOPS CSV is empty or exceeds its configured size limit.', 'MARKET_SECONDARY_CSV_SIZE_INVALID', 409);
  }
  const records = parseCsvRecords(buffer.toString('utf8'));
  if (/^sep=$/i.test(String(records[0]?.[0] || '').trim())
      && records[0].slice(1).every((cell) => !String(cell || '').trim())) records.shift();
  if (records.length < 2) throw syncError('The secondary MOPS CSV has no data rows.', 'MARKET_SECONDARY_CSV_INVALID', 409);
  const headers = records.shift().map((value) => String(value || '').trim().replace(/\s+/g, ' '));
  const normalizedHeaders = headers.map((value) => value.toUpperCase());
  const symbolCloseIndex = (symbol) => {
    const matches = normalizedHeaders.map((value, index) => (
      new RegExp(`(?:^|[^A-Z0-9])${symbol}(?:[^A-Z0-9]|$)`).test(value) && /(?:^|[^A-Z])CLOSE\s*$/.test(value)
    ) ? index : -1).filter((index) => index >= 0);
    if (matches.length !== 1) throw syncError(`The secondary MOPS CSV requires exactly one ${symbol} CLOSE column.`, 'MARKET_SECONDARY_CSV_COLUMNS_INVALID', 409);
    return matches[0];
  };
  const dateColumns = ['DATE', 'TIMESTAMP'].flatMap((label) => normalizedHeaders
    .map((value, index) => value === label ? index : -1).filter((index) => index >= 0));
  if (dateColumns.length !== 1) throw syncError('The secondary MOPS CSV requires exactly one DATE or TIMESTAMP column.', 'MARKET_SECONDARY_CSV_COLUMNS_INVALID', 409);
  const dateIndex = dateColumns[0];
  const s05Index = symbolCloseIndex('AMFSA00');
  const s380Index = symbolCloseIndex('PPXDK00');
  const sgoIndex = symbolCloseIndex('POABC00');
  const rows = [];
  const dates = new Set();
  let incompleteRowCount = 0;
  let ignoredBeforeStartCount = 0;
  for (const record of records) {
    const reportDate = String(record[dateIndex] || '').trim();
    if (!reportDate) continue;
    if (!/^20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(reportDate)
        || new Date(`${reportDate}T00:00:00Z`).toISOString().slice(0, 10) !== reportDate) {
      throw syncError('The secondary MOPS CSV contains an invalid publication date.', 'MARKET_SECONDARY_CSV_DATE_INVALID', 409);
    }
    if (reportDate < startDate) {
      ignoredBeforeStartCount += 1;
      continue;
    }
    const s05 = secondaryMopsNumber(record[s05Index]);
    const s380 = secondaryMopsNumber(record[s380Index]);
    const sgo = secondaryMopsNumber(record[sgoIndex]);
    if (s05 == null || s380 == null || sgo == null) {
      incompleteRowCount += 1;
      continue;
    }
    if (dates.has(reportDate)) throw syncError('The secondary MOPS CSV contains duplicate complete publication dates.', 'MARKET_SECONDARY_CSV_DATE_DUPLICATE', 409);
    dates.add(reportDate);
    rows.push({ reportDate, s05, s380, sgo });
  }
  if (rows.length < 20) throw syncError('The secondary MOPS CSV has insufficient complete history for verification.', 'MARKET_SECONDARY_CSV_HISTORY_INSUFFICIENT', 409);
  rows.sort((left, right) => left.reportDate.localeCompare(right.reportDate));
  return {
    filename: String(filename || '').slice(0, 255),
    sourceHash: createHash('sha256').update(buffer).digest('hex'),
    sourceMd5: createHash('md5').update(buffer).digest('hex'),
    rows,
    completeRowCount: rows.length,
    incompleteRowCount,
    ignoredBeforeStartCount,
  };
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

export async function verifyMarketDriveAuthority(fetchImpl, accessToken, config) {
  if (config?.secondaryMopsCsv?.folderId !== config?.rootFolderId
      || config?.secondaryMopsCsv?.mimeType !== DRIVE_CSV_MIME_TYPE
      || config?.secondaryMopsCsv?.startDate !== REVIEWED_ARCHIVE.startDate) {
    throw syncError('The secondary MOPS CSV source does not match the approved root-folder policy.', 'MARKET_SECONDARY_CSV_CONFIG_INVALID', 500);
  }
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

  const rootShortcuts = await driveJson(fetchImpl, accessToken, 'files', {
    q: `'${config.rootFolderId}' in parents and trashed = false and mimeType = '${DRIVE_SHORTCUT_MIME_TYPE}'`,
    fields: 'files(id,mimeType,parents,shortcutDetails(targetId,targetMimeType))',
    pageSize: 1000,
    spaces: 'drive',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  const approvedShortcutTargets = new Set((rootShortcuts.files || [])
    .filter((shortcut) => shortcut.mimeType === DRIVE_SHORTCUT_MIME_TYPE
      && Array.isArray(shortcut.parents)
      && shortcut.parents.includes(config.rootFolderId)
      && shortcut.shortcutDetails?.targetMimeType === DRIVE_FOLDER_MIME_TYPE)
    .map((shortcut) => shortcut.shortcutDetails.targetId));

  const folders = [];
  for (const folder of config.folders) {
    const metadata = await driveJson(fetchImpl, accessToken, `files/${encodeURIComponent(folder.folderId)}`, {
      fields: 'id,name,mimeType,trashed,parents',
      supportsAllDrives: 'true',
    });
    if (metadata.id !== folder.folderId
        || metadata.mimeType !== DRIVE_FOLDER_MIME_TYPE
        || metadata.trashed === true
        || (!metadata.parents?.includes(config.rootFolderId)
          && !approvedShortcutTargets.has(folder.folderId))) {
      throw syncError('Google Drive market-report folders do not match the approved hierarchy.', 'MARKET_DRIVE_FOLDER_MISMATCH', 503);
    }
    folders.push({
      label: folder.label,
      folderId: metadata.id,
      folderName: metadata.name || null,
    });
  }
  return {
    accountEmail: String(about.user?.emailAddress || '').trim().toLowerCase(),
    rootFolderId: root.id,
    rootFolderName: root.name || null,
    secondaryMopsCsv: {
      folderId: config.secondaryMopsCsv.folderId,
      filenamePrefix: config.secondaryMopsCsv.filenamePrefix,
      mimeType: config.secondaryMopsCsv.mimeType,
      startDate: config.secondaryMopsCsv.startDate,
    },
    folders,
  };
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

async function listSecondaryMopsCsvFiles(fetchImpl, accessToken, config) {
  const secondary = config?.secondaryMopsCsv;
  if (!secondary
      || secondary.folderId !== config.rootFolderId
      || secondary.mimeType !== DRIVE_CSV_MIME_TYPE
      || secondary.startDate !== REVIEWED_ARCHIVE.startDate) {
    throw syncError('The secondary MOPS CSV source is not pinned to the approved market-report root.', 'MARKET_SECONDARY_CSV_CONFIG_INVALID', 500);
  }
  const files = [];
  let pageToken = null;
  do {
    const data = await driveJson(fetchImpl, accessToken, 'files', {
      q: `'${secondary.folderId}' in parents and trashed = false and mimeType = '${DRIVE_CSV_MIME_TYPE}' and name contains '${secondary.filenamePrefix.replace(/'/g, "\\'")}'`,
      fields: 'nextPageToken,files(id,name,mimeType,size,md5Checksum,modifiedTime,parents)',
      pageSize: 1000,
      orderBy: 'modifiedTime desc,name desc',
      spaces: 'drive',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      pageToken,
    });
    for (const file of data.files || []) {
      const name = String(file.name || '').slice(0, 255);
      if (!safeDriveId(file.id)
          || file.mimeType !== DRIVE_CSV_MIME_TYPE
          || !Array.isArray(file.parents)
          || !file.parents.includes(secondary.folderId)
          || !name.startsWith(secondary.filenamePrefix)
          || !name.toLowerCase().endsWith('.csv')) continue;
      files.push({
        id: file.id,
        name,
        size: Number(file.size || 0),
        md5: safeMd5(file.md5Checksum),
        modifiedAt: validIsoDateTime(file.modifiedTime),
      });
    }
    pageToken = data.nextPageToken || null;
  } while (pageToken);
  return files.sort((left, right) => String(right.modifiedAt || '').localeCompare(String(left.modifiedAt || ''))
    || right.name.localeCompare(left.name)
    || right.id.localeCompare(left.id));
}

async function loadStoredSecondaryMopsHashes(client) {
  const sourceHashes = new Set();
  const md5Hashes = new Set();
  for (let offset = 0; ; offset += 1000) {
    const result = await client.from('market_mops_secondary_imports')
      .select('source_hash,source_md5')
      .range(offset, offset + 999);
    if (result.error) throw syncError('Stored secondary MOPS CSV hashes could not be loaded.', 'MARKET_SECONDARY_CSV_INDEX_FAILED');
    for (const row of result.data || []) {
      if (/^[a-f0-9]{64}$/.test(String(row.source_hash || ''))) sourceHashes.add(row.source_hash);
      if (/^[a-f0-9]{32}$/.test(String(row.source_md5 || ''))) md5Hashes.add(row.source_md5);
    }
    if ((result.data || []).length < 1000) break;
  }
  return { sourceHashes, md5Hashes };
}

function reviewedArchiveFiles(files, policy = REVIEWED_ARCHIVE) {
  const eligible = files.filter((file) => {
    const reportDate = reportDateFromFilename(file.name);
    return reportDate && reportDate >= policy.startDate && reportDate <= policy.endDate;
  }).map((file) => ({ ...file, reportDate: reportDateFromFilename(file.name) }));
  const fingerprintRows = eligible.map((file) => ({
    md5: file.md5,
    documentType: file.documentType,
    reportDate: file.reportDate,
  })).sort((left, right) => left.reportDate.localeCompare(right.reportDate)
    || left.documentType.localeCompare(right.documentType)
    || String(left.md5 || '').localeCompare(String(right.md5 || '')));
  const driveFingerprint = createHash('sha256').update(JSON.stringify(fingerprintRows)).digest('hex');
  const unique = [];
  const seenMd5 = new Set();
  for (const file of eligible.sort((left, right) => left.reportDate.localeCompare(right.reportDate)
    || left.documentType.localeCompare(right.documentType)
    || left.id.localeCompare(right.id))) {
    if (!file.md5) throw syncError('A reviewed archive file has no Google Drive checksum.', 'MARKET_ARCHIVE_CHECKSUM_MISSING', 409);
    if (seenMd5.has(file.md5)) continue;
    seenMd5.add(file.md5);
    unique.push(file);
  }
  const duplicateFileCount = eligible.length - unique.length;
  if (eligible.length !== policy.sourceFileCount
      || unique.length !== policy.uniqueReportCount
      || duplicateFileCount !== policy.duplicateFileCount
      || driveFingerprint !== policy.driveFingerprint) {
    throw syncError(`The licensed Google Drive archive no longer matches the reviewed ${policy.startDate} to ${policy.endDate} manifest. Observed ${eligible.length} files, ${unique.length} unique PDFs, ${duplicateFileCount} byte duplicates, fingerprint ${driveFingerprint}.`, 'MARKET_ARCHIVE_MANIFEST_CHANGED', 409);
  }
  return { unique, driveFingerprint, sourceFileCount: eligible.length, duplicateFileCount };
}

async function concurrentMap(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export async function runMarketReportArchiveReplayBatch(client, {
  accessToken,
  cursor = 0,
  expectedArchiveFingerprint = null,
  batchLimit = 25,
  fetchImpl = fetch,
  parseReport = parseMarketReportPdf,
  processDerived = processMarketIntelligenceDate,
  config = CONNECTION_INTEGRATIONS.googleDriveMarketReports,
  reviewedArchive = REVIEWED_ARCHIVE,
  reviewedReportDateOverrides = REVIEWED_REPORT_DATE_OVERRIDES,
} = {}) {
  if (!client || !accessToken) throw syncError('Market archive replay authorization is unavailable.', 'MARKET_ARCHIVE_AUTH_UNAVAILABLE', 503);
  await verifyMarketDriveAuthority(fetchImpl, accessToken, config);
  const folderFiles = await Promise.all(config.folders.map((folder) => listDriveReports(fetchImpl, accessToken, folder)));
  const archive = reviewedArchiveFiles(folderFiles.flat(), reviewedArchive);
  const normalizedCursor = Number(cursor);
  if (!Number.isInteger(normalizedCursor) || normalizedCursor < 0 || normalizedCursor > archive.unique.length) {
    throw syncError('Market archive replay cursor is invalid.', 'MARKET_ARCHIVE_CURSOR_INVALID', 400);
  }
  if (normalizedCursor > 0 && expectedArchiveFingerprint !== archive.driveFingerprint) {
    throw syncError('The licensed archive changed after replay started.', 'MARKET_ARCHIVE_FINGERPRINT_CHANGED', 409);
  }
  const limit = Math.max(1, Math.min(Number(batchLimit) || 25, 25));
  const selected = archive.unique.slice(normalizedCursor, normalizedCursor + limit);
  const parsedReports = await concurrentMap(selected, 2, async (file) => {
    if (file.size > marketReportLimits.maxBytes) throw syncError('A reviewed market report exceeds the configured PDF limit.', 'MARKET_REPORT_TOO_LARGE', 409);
    const buffer = await driveBuffer(fetchImpl, accessToken, file.id);
    const md5 = createHash('md5').update(buffer).digest('hex');
    if (md5 !== file.md5) throw syncError('A reviewed market report checksum changed during replay.', 'MARKET_DRIVE_CHECKSUM_MISMATCH', 409);
    const parsed = await parseReport(buffer, { documentType: file.documentType, filename: file.name });
    const reviewedReportDate = reviewedReportDateOverrides[parsed.sourceHash] || file.reportDate;
    if (parsed.reportDate !== reviewedReportDate) throw syncError('A reviewed report date does not match its archive manifest.', 'MARKET_ARCHIVE_REPORT_DATE_MISMATCH', 409);
    return { file, parsed };
  });

  const reportDates = new Set();
  let replayedCount = 0;
  let quarantinedCount = 0;
  for (const { file, parsed } of parsedReports) {
    const saved = await client.rpc('save_market_drive_report_import', {
      p_idempotency_key: `market-archive-replay-${parsed.sourceHash}`,
      p_source_document_type: file.documentType,
      p_source_hash: parsed.sourceHash,
      p_source_md5: file.md5,
      p_drive_file_id: file.id,
      p_drive_modified_at: file.modifiedAt,
      p_report_date: parsed.reportDate,
      p_observations: parsed.observations,
      p_availability: parsed.availabilityEvidence || [],
      p_library_observations: parsed.libraryObservations || [],
    });
    if (saved.error) throw syncError('A reviewed archive report could not be replayed.', 'MARKET_ARCHIVE_IMPORT_FAILED');
    if (saved.data?.mopsPublication?.status === 'conflict') {
      throw syncError('A reviewed archive report conflicts with the authoritative MOPS ledger.', saved.data?.mopsPublication?.conflictCode || 'MOPS_LEDGER_VALUE_MISMATCH', 409);
    }
    replayedCount += 1;
    quarantinedCount += Number(saved.data?.quarantinedCount || 0);
    reportDates.add(parsed.reportDate);
  }

  let briefCompletedCount = 0;
  let briefWaitingCount = 0;
  for (const reportDate of [...reportDates].sort()) {
    const derived = await processDerived(client, {
      reportDate,
      commentaryContexts: [],
      publishAlerts: false,
      recordShadow: false,
      reconcileDerived: true,
      forceDeterministicRevision: true,
    });
    if (derived.status === 'completed') briefCompletedCount += 1;
    else if (derived.status === 'waiting_for_pair') briefWaitingCount += 1;
    else if (derived.status === 'conflict') throw syncError('A reviewed report pair has quarantined evidence.', 'MARKET_INTELLIGENCE_PAIR_CONFLICT', 409);
  }

  const nextCursor = normalizedCursor + selected.length;
  return {
    status: nextCursor >= archive.unique.length ? 'completed' : 'in_progress',
    archiveFingerprint: archive.driveFingerprint,
    sourceFileCount: archive.sourceFileCount,
    uniqueReportCount: archive.unique.length,
    duplicateFileCount: archive.duplicateFileCount,
    cursor: normalizedCursor,
    nextCursor,
    replayedCount,
    quarantinedCount,
    briefCompletedCount,
    briefWaitingCount,
    complete: nextCursor >= archive.unique.length,
  };
}

async function loadStoredReportIndex(client) {
  const completeMd5 = new Set();
  const storedByMd5 = new Map();
  for (let offset = 0; ; offset += 1000) {
    const result = await client
      .from('market_report_imports')
      .select('id,source_md5,source_hash,source_document_type,report_date,library_observation_count')
      .not('source_md5', 'is', null)
      .range(offset, offset + 999);
    if (result.error) throw syncError('Stored market-report checksums could not be loaded.', 'MARKET_DRIVE_CHECKSUMS_FAILED');
    for (const row of result.data || []) {
      const md5 = safeMd5(row.source_md5);
      if (!md5) continue;
      storedByMd5.set(md5, row);
      if (Number(row.library_observation_count || 0) > 0) completeMd5.add(md5);
    }
    if ((result.data || []).length < 1000) break;
  }
  return { completeMd5, storedByMd5 };
}

export async function loadPendingMarketIntelligenceDates(client, { now = new Date(), limit = 5 } = {}) {
  const cutoff = new Date(now);
  if (Number.isNaN(cutoff.getTime())) throw syncError('Market reconciliation time is invalid.', 'MARKET_DRIVE_TIME_INVALID', 500);
  cutoff.setUTCDate(cutoff.getUTCDate() - 14);
  const importsResult = await client.from('market_report_imports')
    .select('report_date,source_document_type')
    .gte('report_date', cutoff.toISOString().slice(0, 10))
    .order('report_date', { ascending: false })
    .limit(500);
  if (importsResult.error) throw syncError('Paired market reports could not be reconciled.', 'MARKET_INTELLIGENCE_RECONCILIATION_LOAD_FAILED');
  const typesByDate = new Map();
  for (const row of importsResult.data || []) {
    if (!row.report_date || !['bunkerwire', 'european_marketscan'].includes(row.source_document_type)) continue;
    const types = typesByDate.get(row.report_date) || new Set();
    types.add(row.source_document_type);
    typesByDate.set(row.report_date, types);
  }
  const pairedDates = [...typesByDate.entries()]
    .filter(([, types]) => types.size === 2)
    .map(([reportDate]) => reportDate)
    .sort((left, right) => right.localeCompare(left));
  return pairedDates
    .slice(0, Math.max(1, Math.min(Number(limit) || 5, 10)))
    .sort();
}

async function completeCommentaryPair(client, fetchImpl, accessToken, reportDate, contexts, parseReport) {
  const availableTypes = new Set((contexts || []).map((row) => row.documentType));
  if (availableTypes.has('bunkerwire') && availableTypes.has('european_marketscan')) return contexts;
  const result = await client.from('market_report_imports')
    .select('source_document_type,source_hash,drive_file_id')
    .eq('report_date', reportDate)
    .in('source_document_type', ['bunkerwire', 'european_marketscan'])
    .not('drive_file_id', 'is', null);
  if (result.error) return contexts;
  const completed = [...(contexts || [])];
  for (const row of result.data || []) {
    if (availableTypes.has(row.source_document_type) || !safeDriveId(row.drive_file_id)) continue;
    try {
      const buffer = await driveBuffer(fetchImpl, accessToken, row.drive_file_id);
      const parsed = await parseReport(buffer, { documentType: row.source_document_type, includeCommentaryContext: true });
      if (parsed.reportDate !== reportDate || parsed.sourceHash !== row.source_hash) continue;
      completed.push({ sourceHash: parsed.sourceHash, documentType: row.source_document_type, commentaryContext: parsed.commentaryContext || [] });
      availableTypes.add(row.source_document_type);
    } catch {
      // Price import and deterministic brief remain available if commentary cannot be reloaded.
    }
  }
  return completed;
}

export function marketDriveRunKey(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) throw syncError('Market sync time is invalid.', 'MARKET_DRIVE_TIME_INVALID', 500);
  return `market-drive:${date.toISOString().slice(0, 13)}`;
}

export function prioritizeMarketDriveCandidates(files = [], storedByMd5 = new Map()) {
  const priority = (file) => {
    const stored = storedByMd5.get(safeMd5(file?.md5));
    if (!stored) return 0;
    return String(stored.report_date || '') >= '2025-01-01' ? 1 : 2;
  };
  return [...files].sort((left, right) => {
    const rankDifference = priority(left) - priority(right);
    if (rankDifference) return rankDifference;
    const leftStored = storedByMd5.get(safeMd5(left?.md5));
    const rightStored = storedByMd5.get(safeMd5(right?.md5));
    if (leftStored && rightStored) {
      const reportDateDifference = String(rightStored.report_date || '').localeCompare(String(leftStored.report_date || ''));
      if (reportDateDifference) return reportDateDifference;
    }
    return String(left?.modifiedAt || '').localeCompare(String(right?.modifiedAt || ''))
      || String(left?.name || '').localeCompare(String(right?.name || ''))
      || String(left?.id || '').localeCompare(String(right?.id || ''));
  });
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
  processDerived = processMarketIntelligenceDate,
} = {}) {
  if (!client || !accessToken) throw syncError('Market sync authorization is unavailable.', 'MARKET_DRIVE_AUTH_UNAVAILABLE', 503);
  if (!config?.accountEmail || !config?.rootFolderId || !config?.secondaryMopsCsv
      || !Array.isArray(config?.folders) || config.folders.length !== 2) {
    throw syncError('Market sync target configuration is incomplete.', 'MARKET_DRIVE_CONFIG_INVALID', 500);
  }
  const runKey = marketDriveRunKey(now);
  const reserve = await client.rpc('reserve_market_report_sync_run', { p_run_key: runKey });
  if (reserve.error) throw syncError('Market sync could not reserve its hourly operation.', 'MARKET_DRIVE_RUN_RESERVE_FAILED');
  if (reserve.data?.reserved !== true) return { duplicate: true, runKey, status: reserve.data?.status || null };

  const summary = {
    discoveredCount: 0,
    skippedCount: 0,
    importedCount: 0,
    failedCount: 0,
    deferredCount: 0,
    mopsPublishedCount: 0,
    mopsMatchedCount: 0,
    mopsIncompleteCount: 0,
    mopsConflictCount: 0,
    briefCompletedCount: 0,
    briefWaitingCount: 0,
    briefReconciledCount: 0,
    marketAlertsPublishedCount: 0,
    marketShadowRecordedCount: 0,
    libraryObservationCount: 0,
    libraryRepairedCount: 0,
    secondaryMopsDiscoveredCount: 0,
    secondaryMopsImportedCount: 0,
    secondaryMopsPublishedDateCount: 0,
    secondaryMopsMatchedDateCount: 0,
    secondaryMopsConflictDateCount: 0,
    secondaryMopsComparisonValueCount: 0,
    secondaryMopsMatchedValueCount: 0,
  };
  try {
    await verifyMarketDriveAuthority(fetchImpl, accessToken, config);
    const [storedReportIndex, storedSecondaryIndex, secondaryMopsFiles, ...folderFiles] = await Promise.all([
      loadStoredReportIndex(client),
      loadStoredSecondaryMopsHashes(client),
      listSecondaryMopsCsvFiles(fetchImpl, accessToken, config),
      ...config.folders.map((folder) => listDriveReports(fetchImpl, accessToken, folder)),
    ]);
    const { completeMd5, storedByMd5 } = storedReportIndex;
    const files = folderFiles.flat().sort((left, right) => String(left.modifiedAt || '').localeCompare(String(right.modifiedAt || '')) || left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
    summary.secondaryMopsDiscoveredCount = secondaryMopsFiles.length;
    summary.discoveredCount = files.length + secondaryMopsFiles.length;

    for (const file of secondaryMopsFiles) {
      try {
        if (!file.md5) throw syncError('A secondary MOPS CSV has no Google Drive checksum.', 'MARKET_SECONDARY_CSV_CHECKSUM_MISSING', 409);
        if (file.size <= 0 || file.size > MAX_SECONDARY_MOPS_CSV_BYTES) {
          throw syncError('A secondary MOPS CSV exceeds the configured size limit.', 'MARKET_SECONDARY_CSV_SIZE_INVALID', 409);
        }
        if (storedSecondaryIndex.md5Hashes.has(file.md5)) {
          summary.skippedCount += 1;
          continue;
        }
        const buffer = await driveBuffer(fetchImpl, accessToken, file.id);
        const parsed = parseMarketMopsCsv(buffer, {
          filename: file.name,
          startDate: config.secondaryMopsCsv.startDate,
        });
        if (parsed.sourceMd5 !== file.md5) throw syncError('Google Drive secondary MOPS CSV checksum validation failed.', 'MARKET_SECONDARY_CSV_CHECKSUM_MISMATCH', 409);
        if (storedSecondaryIndex.sourceHashes.has(parsed.sourceHash)) {
          summary.skippedCount += 1;
          continue;
        }
        const saveSecondary = () => client.rpc('save_market_mops_secondary_csv', {
          p_idempotency_key: `market-mops-secondary-${parsed.sourceHash}`,
          p_source_hash: parsed.sourceHash,
          p_source_md5: parsed.sourceMd5,
          p_drive_file_id: file.id,
          p_drive_modified_at: file.modifiedAt,
          p_rows: parsed.rows,
        });
        let saved = await saveSecondary();
        if (saved.error) saved = await saveSecondary();
        if (saved.error) throw syncError('The verified secondary MOPS CSV could not be saved.', 'MARKET_SECONDARY_CSV_IMPORT_FAILED', 409);
        storedSecondaryIndex.sourceHashes.add(parsed.sourceHash);
        storedSecondaryIndex.md5Hashes.add(parsed.sourceMd5);
        summary.secondaryMopsImportedCount += 1;
        summary.secondaryMopsPublishedDateCount += Number(saved.data?.publishedDateCount || 0);
        summary.secondaryMopsMatchedDateCount += Number(saved.data?.matchedDateCount || 0);
        summary.secondaryMopsConflictDateCount += Number(saved.data?.conflictDateCount || 0);
        summary.secondaryMopsComparisonValueCount += Number(saved.data?.comparisonValueCount || 0);
        summary.secondaryMopsMatchedValueCount += Number(saved.data?.matchedValueCount || 0);
        summary.importedCount += 1;
      } catch (error) {
        summary.failedCount += 1;
        if (!summary.errorCode) summary.errorCode = normalizedErrorCode(error);
        const alert = await publishMarketDataQualityAlert(client, {
          reportDate: null,
          code: normalizedErrorCode(error),
          title: 'Secondary MOPS CSV processing failed',
          message: 'The root-folder MOPS CSV could not be parsed, historically verified, or imported.',
          severity: 'critical',
          evidence: { sourceType: 'secondary_mops_csv' },
        }).catch(() => ({ created: false }));
        if (alert.created) summary.marketAlertsPublishedCount += 1;
      }
    }

    const candidates = [];
    const queuedMd5 = new Set();
    for (const file of files) {
      const storedReport = storedByMd5.get(safeMd5(file.md5));
      if (storedReport && String(storedReport.report_date || '') < REVIEWED_ARCHIVE.startDate) {
        summary.skippedCount += 1;
        continue;
      }
      if (file.md5 && (completeMd5.has(file.md5) || queuedMd5.has(file.md5))) {
        summary.skippedCount += 1;
        continue;
      }
      if (file.md5) queuedMd5.add(file.md5);
      candidates.push(file);
    }
    const orderedCandidates = prioritizeMarketDriveCandidates(candidates, storedByMd5);
    const limit = Math.max(1, Math.min(Number(importLimit) || DEFAULT_IMPORT_LIMIT, 50));
    summary.deferredCount = Math.max(0, orderedCandidates.length - limit);

    const touchedReportDates = new Set();
    const commentaryByDate = new Map();
    for (const file of orderedCandidates.slice(0, limit)) {
      try {
        if (file.size > marketReportLimits.maxBytes) throw syncError('A market report exceeds the configured PDF limit.', 'MARKET_REPORT_TOO_LARGE');
        const buffer = await driveBuffer(fetchImpl, accessToken, file.id);
        const md5 = createHash('md5').update(buffer).digest('hex');
        if (file.md5 && md5 !== file.md5) throw syncError('Google Drive market-report checksum validation failed.', 'MARKET_DRIVE_CHECKSUM_MISMATCH');
        if (completeMd5.has(md5)) {
          summary.skippedCount += 1;
          continue;
        }
        const parsed = await parseReport(buffer, { documentType: file.documentType, filename: file.name, includeCommentaryContext: true });
        const storedImport = storedByMd5.get(md5);
        if (storedImport && (storedImport.source_hash !== parsed.sourceHash
          || storedImport.source_document_type !== file.documentType
          || storedImport.report_date !== parsed.reportDate)) {
          throw syncError('A stored report checksum no longer matches its immutable identity.', 'MARKET_DRIVE_STORED_IDENTITY_MISMATCH', 409);
        }
        const saveReport = () => storedImport
          ? client.rpc('record_market_report_product_library', {
            p_import_id: storedImport.id,
            p_observations: parsed.libraryObservations || [],
          })
          : client.rpc('save_market_drive_report_import', {
            p_idempotency_key: `market-drive-${parsed.sourceHash}`,
            p_source_document_type: file.documentType,
            p_source_hash: parsed.sourceHash,
            p_source_md5: md5,
            p_drive_file_id: file.id,
            p_drive_modified_at: file.modifiedAt,
            p_report_date: parsed.reportDate,
            p_observations: parsed.observations,
            p_availability: parsed.availabilityEvidence || [],
            p_library_observations: parsed.libraryObservations || [],
          });
        let saved = await saveReport();
        // Both database functions are idempotent. Retry once when the first
        // response is lost or Supabase has a transient gateway/statement error;
        // the immutable source hash prevents duplicate report evidence.
        if (saved.error) saved = await saveReport();
        if (saved.error) throw syncError('A parsed market report could not be saved.', 'MARKET_DRIVE_IMPORT_FAILED');
        const publicationStatus = saved.data?.mopsPublication?.status;
        if (publicationStatus === 'published') summary.mopsPublishedCount += 1;
        if (publicationStatus === 'matched') summary.mopsMatchedCount += 1;
        if (publicationStatus === 'incomplete') summary.mopsIncompleteCount += 1;
        if (publicationStatus === 'conflict') {
          summary.mopsConflictCount += 1;
          throw syncError('A licensed report conflicts with the authoritative MOPS ledger.', saved.data?.mopsPublication?.conflictCode || 'MOPS_LEDGER_VALUE_MISMATCH');
        }
        completeMd5.add(md5);
        summary.importedCount += 1;
        summary.libraryObservationCount += Number(saved.data?.libraryObservationCount || 0);
        if (storedImport) summary.libraryRepairedCount += 1;
        else touchedReportDates.add(parsed.reportDate);
        if (!storedImport && Array.isArray(parsed.commentaryContext) && parsed.commentaryContext.length) {
          const contexts = commentaryByDate.get(parsed.reportDate) || [];
          contexts.push({ sourceHash: parsed.sourceHash, documentType: file.documentType, commentaryContext: parsed.commentaryContext });
          commentaryByDate.set(parsed.reportDate, contexts);
        }
      } catch (error) {
        summary.failedCount += 1;
        if (!summary.errorCode) summary.errorCode = normalizedErrorCode(error);
        const alert = await publishMarketDataQualityAlert(client, {
          reportDate: reportDateFromFilename(file.name),
          code: normalizedErrorCode(error),
          title: 'Market report processing failed',
          message: 'A licensed market report could not be parsed, validated, or imported.',
          severity: 'critical',
          evidence: { documentType: file.documentType },
        }).catch(() => ({ created: false }));
        if (alert.created) summary.marketAlertsPublishedCount += 1;
      }
    }

    const pendingDerivedDates = await loadPendingMarketIntelligenceDates(client, { now });
    const derivedDates = [...new Set([...touchedReportDates, ...pendingDerivedDates])].sort();
    for (const reportDate of derivedDates) {
      try {
        const touched = touchedReportDates.has(reportDate);
        const commentaryContexts = touched
          ? await completeCommentaryPair(client, fetchImpl, accessToken, reportDate, commentaryByDate.get(reportDate) || [], parseReport)
          : [];
        const derived = await processDerived(client, {
          reportDate,
          commentaryContexts,
          reconcileDerived: !touched,
        });
        if (derived.status === 'completed') {
          await reconcileMarketIntradayDate(client, reportDate, { email: 'market-sync@fcos.internal' })
            .catch(() => ({ insertedCount: 0, status: 'deferred' }));
          summary.briefCompletedCount += 1;
          if (!touched) summary.briefReconciledCount += 1;
          summary.marketAlertsPublishedCount += Number(derived.alertsPublished || 0);
          summary.marketShadowRecordedCount += Number(derived.shadowRecorded || 0);
        } else if (derived.status === 'waiting_for_pair') {
          summary.briefWaitingCount += 1;
          summary.marketAlertsPublishedCount += Number(derived.alertsPublished || 0);
        } else if (derived.status === 'conflict') {
          summary.marketAlertsPublishedCount += Number(derived.alertsPublished || 0);
          throw syncError('A paired market report has quarantined evidence and no derived brief was published.', 'MARKET_INTELLIGENCE_PAIR_CONFLICT');
        }
      } catch (error) {
        summary.failedCount += 1;
        if (!summary.errorCode) summary.errorCode = normalizedErrorCode(error);
      }
    }

    const expectedSessions = await scanExpectedMarketSessions(client, { now });
    summary.marketAlertsPublishedCount += Number(expectedSessions.published || 0);
    summary.expectedSessionsEvaluatedCount = Number(expectedSessions.evaluated || 0);

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
