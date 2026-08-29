import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { loadPendingMarketIntelligenceDates, marketDriveRunKey, prioritizeMarketDriveCandidates, runMarketReportArchiveReplayBatch, runMarketReportDriveSync } from '../api/_marketDriveSync.js';

const config = {
  accountEmail: 'vince.less@gmail.com',
  rootFolderId: 'rootfolder12345',
  folders: [
    { documentType: 'bunkerwire', folderId: 'bunkerfolder12345', label: 'Bunkerwire' },
    { documentType: 'european_marketscan', folderId: 'europefolder12345', label: 'European Marketscan' },
  ],
};

function response(data, { ok = true, binary = false } = {}) {
  return {
    ok,
    json: async () => binary ? {} : data,
    arrayBuffer: async () => Buffer.from(data),
  };
}

function clientMock({ knownMd5 = [], storedReports = [], publicationStatus = null, pairedImports = [], briefs = [] } = {}) {
  const rpcCalls = [];
  return {
    rpcCalls,
    rpc: async (name, payload) => {
      rpcCalls.push({ name, payload });
      if (name === 'reserve_market_report_sync_run') return { data: { reserved: true, status: 'running' }, error: null };
      if (name === 'finish_market_report_sync_run') return { data: { status: payload.p_status }, error: null };
      if (name === 'save_market_drive_report_import') return { data: { status: 'completed', mopsPublication: publicationStatus ? { status: publicationStatus, conflictCode: publicationStatus === 'conflict' ? 'MOPS_LEDGER_VALUE_MISMATCH' : null } : null }, error: null };
      if (name === 'record_market_report_product_library') return { data: { libraryObservationCount: payload.p_observations.length, libraryInsertedCount: payload.p_observations.length }, error: null };
      return { data: null, error: new Error('Unexpected RPC') };
    },
    from: (table) => ({
      select: (columns) => {
        if (table === 'market_report_imports' && columns === 'id,source_md5,source_hash,source_document_type,report_date,library_observation_count') return {
          not: () => ({ range: async () => ({ data: [
            ...knownMd5.map((source_md5) => ({ id: `import-${source_md5}`, source_md5, library_observation_count: 1 })),
            ...storedReports,
          ], error: null }) }),
        };
        if (table === 'market_report_imports' && columns === 'report_date,source_document_type') return {
          gte: () => ({ order: () => ({ limit: async () => ({ data: pairedImports, error: null }) }) }),
        };
        if (table === 'market_report_imports' && columns.includes('drive_file_id')) return {
          eq: () => ({ in: () => ({ not: async () => ({ data: [], error: null }) }) }),
        };
        if (table === 'market_intelligence_briefs') return {
          in: () => ({ order: async () => ({ data: briefs, error: null }) }),
        };
        throw new Error(`Unexpected query ${table}:${columns}`);
      },
    }),
  };
}

function driveFetch({ files = [], accountEmail = config.accountEmail, pdf = Buffer.from('%PDF-test'), shortcutHierarchy = false } = {}) {
  const calls = [];
  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    calls.push(url.toString());
    if (url.pathname.endsWith('/about')) return response({ user: { emailAddress: accountEmail } });
    if (url.searchParams.get('alt') === 'media') return response(pdf, { binary: true });
    const fileId = url.pathname.split('/').at(-1);
    if (fileId === config.rootFolderId) {
      return response({ id: fileId, name: 'Market reports', mimeType: 'application/vnd.google-apps.folder', trashed: false });
    }
    if (config.folders.some((folder) => folder.folderId === fileId)) {
      return response({
        id: fileId, name: fileId, mimeType: 'application/vnd.google-apps.folder', trashed: false,
        ...(shortcutHierarchy ? {} : { parents: [config.rootFolderId] }),
      });
    }
    if (url.pathname.endsWith('/files')) {
      if (String(url.searchParams.get('q')).includes('application/vnd.google-apps.shortcut')) {
        return response({
          files: shortcutHierarchy ? config.folders.map((folder, index) => ({
            id: `shortcutfolder${index}12345`,
            mimeType: 'application/vnd.google-apps.shortcut',
            parents: [config.rootFolderId],
            shortcutDetails: { targetId: folder.folderId, targetMimeType: 'application/vnd.google-apps.folder' },
          })) : [],
        });
      }
      const folder = config.folders.find((entry) => String(url.searchParams.get('q')).includes(entry.folderId));
      return response({ files: files.filter((file) => file.documentType === folder?.documentType), nextPageToken: null });
    }
    return response({}, { ok: false });
  };
  return { calls, fetchImpl };
}

test('market Drive run keys are stable UTC-hour idempotency boundaries', () => {
  assert.equal(marketDriveRunKey(new Date('2026-08-20T09:59:59.999Z')), 'market-drive:2026-08-20T09');
});

test('hourly sync prioritizes unseen reports, then current library repairs, before legacy cleanup', () => {
  const storedByMd5 = new Map([
    ['a'.repeat(32), { report_date: '2024-01-02' }],
    ['b'.repeat(32), { report_date: '2026-08-20' }],
    ['c'.repeat(32), { report_date: '2025-01-02' }],
  ]);
  const ordered = prioritizeMarketDriveCandidates([
    { id: 'legacy', md5: 'a'.repeat(32), modifiedAt: '2024-01-02T00:00:00Z' },
    { id: 'current', md5: 'b'.repeat(32), modifiedAt: '2026-08-20T00:00:00Z' },
    { id: 'new', md5: 'd'.repeat(32), modifiedAt: '2026-08-21T00:00:00Z' },
    { id: 'first-current', md5: 'c'.repeat(32), modifiedAt: '2025-01-02T00:00:00Z' },
  ], storedByMd5);
  assert.deepEqual(ordered.map((row) => row.id), ['new', 'current', 'first-current', 'legacy']);
});

test('hourly sync accepts exact approved folders linked through root shortcuts', async () => {
  const client = clientMock();
  const drive = driveFetch({ shortcutHierarchy: true });
  const result = await runMarketReportDriveSync(client, {
    accessToken: 'token', fetchImpl: drive.fetchImpl, config, now: new Date('2026-08-20T09:10:00Z'),
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.discoveredCount, 0);
  assert.equal(drive.calls.some((url) => url.includes('application%2Fvnd.google-apps.shortcut')), true);
});

test('hourly sync skips known checksums without downloading report bytes', async () => {
  const known = '0123456789abcdef0123456789abcdef';
  const client = clientMock({ knownMd5: [known] });
  const drive = driveFetch({ files: [{ id: 'reportfile12345', name: 'BW_20260820.pdf', mimeType: 'application/pdf', size: '1000', md5Checksum: known, modifiedTime: '2026-08-20T09:01:00Z', documentType: 'bunkerwire' }] });
  const result = await runMarketReportDriveSync(client, { accessToken: 'token', fetchImpl: drive.fetchImpl, config, now: new Date('2026-08-20T09:15:00Z') });
  assert.equal(result.discoveredCount, 1);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.importedCount, 0);
  assert.equal(drive.calls.some((url) => url.includes('alt=media')), false);
});

test('hourly sync excludes pre-2025 stored library backlog from the operational queue', async () => {
  const legacy = 'abcdef0123456789abcdef0123456789';
  const client = clientMock({ storedReports: [{
    id: 'legacy-import', source_md5: legacy, source_hash: 'a'.repeat(64),
    source_document_type: 'bunkerwire', report_date: '2024-12-31', library_observation_count: 0,
  }] });
  const drive = driveFetch({ files: [{ id: 'legacyreport12345', name: 'BW_20241231.pdf', mimeType: 'application/pdf', size: '1000', md5Checksum: legacy, modifiedTime: '2024-12-31T09:01:00Z', documentType: 'bunkerwire' }] });
  const result = await runMarketReportDriveSync(client, { accessToken: 'token', fetchImpl: drive.fetchImpl, config, now: new Date('2026-08-22T07:00:00Z') });
  assert.equal(result.status, 'completed');
  assert.equal(result.skippedCount, 1);
  assert.equal(result.importedCount, 0);
  assert.equal(drive.calls.some((url) => url.includes('alt=media')), false);
});

test('hourly reconciliation retries recent paired derived work without reimporting or repeating AI', async () => {
  const pairedImports = [
    { report_date: '2026-08-20', source_document_type: 'bunkerwire' },
    { report_date: '2026-08-20', source_document_type: 'european_marketscan' },
  ];
  const client = clientMock({ pairedImports });
  assert.deepEqual(await loadPendingMarketIntelligenceDates(client, { now: new Date('2026-08-21T00:00:00Z') }), ['2026-08-20']);
  const drive = driveFetch();
  const failed = await runMarketReportDriveSync(client, {
    accessToken: 'token', fetchImpl: drive.fetchImpl, config, now: new Date('2026-08-21T01:00:00Z'),
    processDerived: async () => { throw new Error('Transient derived failure'); },
  });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.importedCount, 0);

  const repaired = await runMarketReportDriveSync(client, {
    accessToken: 'token', fetchImpl: drive.fetchImpl, config, now: new Date('2026-08-21T02:00:00Z'),
    processDerived: async (_client, options) => {
      assert.equal(options.reconcileDerived, true);
      assert.deepEqual(options.commentaryContexts, []);
      return { status: 'completed', alertsPublished: 0, shadowRecorded: 1, reconciled: true };
    },
  });
  assert.equal(repaired.status, 'completed');
  assert.equal(repaired.importedCount, 0);
  assert.equal(repaired.briefReconciledCount, 1);
  assert.equal(drive.calls.some((url) => url.includes('alt=media')), false);
});

test('hourly sync parses and atomically stores an unseen report', async () => {
  const pdf = Buffer.from('%PDF-new-report');
  const md5 = (await import('node:crypto')).createHash('md5').update(pdf).digest('hex');
  const client = clientMock();
  const drive = driveFetch({ files: [{ id: 'reportfile67890', name: 'EUM_20260820.pdf', mimeType: 'application/pdf', size: String(pdf.length), md5Checksum: md5, modifiedTime: '2026-08-20T09:02:00Z', documentType: 'european_marketscan' }], pdf });
  const result = await runMarketReportDriveSync(client, {
    accessToken: 'token', fetchImpl: drive.fetchImpl, config, now: new Date('2026-08-20T09:20:00Z'),
    parseReport: async () => ({ sourceHash: 'a'.repeat(64), reportDate: '2026-08-20', observations: [{ sourceSymbol: 'AMFSA00', price: 700 }], libraryObservations: [{ rowHash: 'd'.repeat(64), sourcePage: 1, sourceOrder: 1, sourceSymbol: 'AMFSA00', productName: '0.5% FOB Singapore cargo', unit: 'USD/MT', quoteState: 'numeric', price: 700 }] }),
  });
  assert.equal(result.importedCount, 1);
  const saved = client.rpcCalls.find(({ name }) => name === 'save_market_drive_report_import');
  assert.equal(saved.payload.p_source_md5, md5);
  assert.equal(saved.payload.p_source_document_type, 'european_marketscan');
  assert.deepEqual(saved.payload.p_observations, [{ sourceSymbol: 'AMFSA00', price: 700 }]);
  assert.equal(saved.payload.p_library_observations[0].productName, '0.5% FOB Singapore cargo');
});

test('hourly sync repairs a stored report library without replaying governed evidence', async () => {
  const pdf = Buffer.from('%PDF-library-repair');
  const md5 = (await import('node:crypto')).createHash('md5').update(pdf).digest('hex');
  const sourceHash = 'e'.repeat(64);
  const client = clientMock({ storedReports: [{
    id: 'stored-import-id', source_md5: md5, source_hash: sourceHash,
    source_document_type: 'bunkerwire', report_date: '2026-08-20', library_observation_count: 0,
  }] });
  const drive = driveFetch({ files: [{ id: 'reportfile98765', name: 'BW_20260820.pdf', mimeType: 'application/pdf', size: String(pdf.length), md5Checksum: md5, modifiedTime: '2026-08-20T09:02:00Z', documentType: 'bunkerwire' }], pdf });
  const result = await runMarketReportDriveSync(client, {
    accessToken: 'token', fetchImpl: drive.fetchImpl, config, now: new Date('2026-08-20T10:20:00Z'),
    parseReport: async () => ({ sourceHash, reportDate: '2026-08-20', observations: [{ sourceSymbol: 'AMFSA00', price: 700 }], libraryObservations: [{ rowHash: 'f'.repeat(64), sourcePage: 1, sourceOrder: 1, sourceSymbol: 'MFSPD00', productName: 'Singapore', unit: 'USD/MT', quoteState: 'numeric', price: 700 }] }),
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.libraryRepairedCount, 1);
  assert.equal(client.rpcCalls.some(({ name }) => name === 'save_market_drive_report_import'), false);
  const repaired = client.rpcCalls.find(({ name }) => name === 'record_market_report_product_library');
  assert.equal(repaired.payload.p_import_id, 'stored-import-id');
  assert.equal(repaired.payload.p_observations[0].sourceSymbol, 'MFSPD00');
});

test('reviewed archive replay binds the Drive manifest and derives deterministic briefs without commentary', async () => {
  const pdf = Buffer.from('%PDF-reviewed-archive');
  const { createHash } = await import('node:crypto');
  const md5 = createHash('md5').update(pdf).digest('hex');
  const fingerprintRows = [{ md5, documentType: 'bunkerwire', reportDate: '2026-08-19' }];
  const driveFingerprint = createHash('sha256').update(JSON.stringify(fingerprintRows)).digest('hex');
  const file = { id: 'reviewedreport12345', name: 'BW_20260819.pdf', mimeType: 'application/pdf', size: String(pdf.length), md5Checksum: md5, modifiedTime: '2026-08-19T09:00:00Z', documentType: 'bunkerwire' };
  const client = clientMock();
  const drive = driveFetch({ files: [file], pdf });
  const derivedCalls = [];
  const result = await runMarketReportArchiveReplayBatch(client, {
    accessToken: 'token',
    fetchImpl: drive.fetchImpl,
    config,
    reviewedArchive: {
      startDate: '2026-08-19', endDate: '2026-08-19', sourceFileCount: 1,
      uniqueReportCount: 1, duplicateFileCount: 0, driveFingerprint,
    },
    parseReport: async () => ({ sourceHash: 'c'.repeat(64), reportDate: '2026-08-19', observations: [{ sourceSymbol: 'AMFSA00', price: 700 }] }),
    processDerived: async (_client, options) => { derivedCalls.push(options); return { status: 'completed' }; },
  });
  assert.equal(result.complete, true);
  assert.equal(result.nextCursor, 1);
  assert.equal(result.archiveFingerprint, driveFingerprint);
  assert.equal(result.replayedCount, 1);
  assert.equal(client.rpcCalls.find(({ name }) => name === 'save_market_drive_report_import').payload.p_idempotency_key, `market-archive-replay-${'c'.repeat(64)}`);
  assert.deepEqual(derivedCalls, [{ reportDate: '2026-08-19', commentaryContexts: [], publishAlerts: false, recordShadow: false, reconcileDerived: true, forceDeterministicRevision: true }]);
});

test('reviewed archive permits only exact source-hash-bound printed date overrides', async () => {
  const pdf = Buffer.from('%PDF-reviewed-date-override');
  const { createHash } = await import('node:crypto');
  const md5 = createHash('md5').update(pdf).digest('hex');
  const sourceHash = 'd'.repeat(64);
  const fingerprintRows = [{ md5, documentType: 'bunkerwire', reportDate: '2025-03-09' }];
  const driveFingerprint = createHash('sha256').update(JSON.stringify(fingerprintRows)).digest('hex');
  const file = { id: 'revieweddate12345', name: 'BW_20250309.pdf', mimeType: 'application/pdf', size: String(pdf.length), md5Checksum: md5, modifiedTime: '2025-09-03T09:00:00Z', documentType: 'bunkerwire' };
  const drive = driveFetch({ files: [file], pdf });
  const options = {
    accessToken: 'token', fetchImpl: drive.fetchImpl, config,
    reviewedArchive: {
      startDate: '2025-01-01', endDate: '2025-12-31', sourceFileCount: 1,
      uniqueReportCount: 1, duplicateFileCount: 0, driveFingerprint,
    },
    parseReport: async () => ({ sourceHash, reportDate: '2025-09-03', observations: [{ sourceSymbol: 'MFSPD00', price: 554 }] }),
    processDerived: async () => ({ status: 'completed' }),
  };
  await assert.rejects(
    runMarketReportArchiveReplayBatch(clientMock(), { ...options, reviewedReportDateOverrides: {} }),
    (error) => error.code === 'MARKET_ARCHIVE_REPORT_DATE_MISMATCH',
  );
  const result = await runMarketReportArchiveReplayBatch(clientMock(), {
    ...options,
    reviewedReportDateOverrides: { [sourceHash]: '2025-09-03' },
  });
  assert.equal(result.complete, true);
  assert.equal(result.briefCompletedCount, 1);
});

test('reviewed archive drift reports only safe aggregate evidence', async () => {
  const pdf = Buffer.from('%PDF-reviewed-archive-drift');
  const { createHash } = await import('node:crypto');
  const md5 = createHash('md5').update(pdf).digest('hex');
  const actualFingerprint = createHash('sha256').update(JSON.stringify([{ md5, documentType: 'bunkerwire', reportDate: '2026-08-19' }])).digest('hex');
  const drive = driveFetch({
    files: [{ id: 'revieweddrift12345', name: 'BW_20260819.pdf', mimeType: 'application/pdf', size: String(pdf.length), md5Checksum: md5, modifiedTime: '2026-08-19T09:00:00Z', documentType: 'bunkerwire' }],
    pdf,
  });
  await assert.rejects(
    runMarketReportArchiveReplayBatch(clientMock(), {
      accessToken: 'token', fetchImpl: drive.fetchImpl, config,
      reviewedArchive: {
        startDate: '2026-08-19', endDate: '2026-08-19', sourceFileCount: 2,
        uniqueReportCount: 2, duplicateFileCount: 0, driveFingerprint: '0'.repeat(64),
      },
    }),
    (error) => error.code === 'MARKET_ARCHIVE_MANIFEST_CHANGED'
      && error.message.includes(`Observed 1 files, 1 unique PDFs, 0 byte duplicates, fingerprint ${actualFingerprint}.`)
      && !error.message.includes('revieweddrift12345'),
  );
});

test('hourly sync fails closed on the wrong Google account and records a redacted failure', async () => {
  const client = clientMock();
  const drive = driveFetch({ accountEmail: 'wrong@example.com' });
  await assert.rejects(
    runMarketReportDriveSync(client, { accessToken: 'token', fetchImpl: drive.fetchImpl, config, now: new Date('2026-08-20T10:00:00Z') }),
    (error) => error.code === 'MARKET_DRIVE_IDENTITY_MISMATCH',
  );
  const finished = client.rpcCalls.find(({ name }) => name === 'finish_market_report_sync_run');
  assert.equal(finished.payload.p_status, 'failed');
  assert.equal(finished.payload.p_error_code, 'MARKET_DRIVE_IDENTITY_MISMATCH');
});

test('hourly sync surfaces a quarantined MOPS conflict without retrying delivery actions', async () => {
  const pdf = Buffer.from('%PDF-conflicting-report');
  const md5 = (await import('node:crypto')).createHash('md5').update(pdf).digest('hex');
  const client = clientMock({ publicationStatus: 'conflict' });
  const drive = driveFetch({ files: [{ id: 'conflictreport12345', name: 'EUM_20260820.pdf', mimeType: 'application/pdf', size: String(pdf.length), md5Checksum: md5, modifiedTime: '2026-08-20T11:00:00Z', documentType: 'european_marketscan' }], pdf });
  const result = await runMarketReportDriveSync(client, {
    accessToken: 'token', fetchImpl: drive.fetchImpl, config, now: new Date('2026-08-20T11:15:00Z'),
    parseReport: async () => ({ sourceHash: 'b'.repeat(64), reportDate: '2026-08-20', observations: [{ sourceSymbol: 'AMFSA00', price: 700 }] }),
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.mopsConflictCount, 1);
  assert.equal(result.failedCount, 1);
  assert.equal(result.errorCode, 'MOPS_LEDGER_VALUE_MISMATCH');
});

test('hourly market sync migration is service-only and stores no PDF or report text', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/20260820094201_market_report_drive_hourly_sync.sql', import.meta.url), 'utf8');
  assert.match(sql, /alter table public\.market_report_sync_runs enable row level security/i);
  assert.match(sql, /revoke all on table public\.market_report_sync_runs from public, anon, authenticated/i);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /save_market_drive_report_import/i);
  assert.doesNotMatch(sql, /security definer|pdf_bytes|report_text/i);
});

test('production scheduling is exactly hourly and keeps the cron secret protected', () => {
  const vercel = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(
    vercel.crons.filter(({ path }) => path === '/api/functions/marketReportDriveSyncCron'),
    [{ path: '/api/functions/marketReportDriveSyncCron', schedule: '0 * * * *' }],
  );
  const dispatcher = fs.readFileSync(new URL('../api/functions/[name].js', import.meta.url), 'utf8');
  assert.match(dispatcher, /async function marketReportDriveSyncCron[\s\S]*requireCronAuthorization\(req\)/);
  assert.match(dispatcher, /marketReportDriveSyncCron[\s\S]*requireExternalActionGate\('google_drive'\)/);
  assert.match(dispatcher, /marketReportDriveSyncCron[\s\S]*googleDriveMarketAccessToken\(\)/);
  assert.match(dispatcher, /marketIntelligenceArchiveReplay[\s\S]*googleDriveMarketAccessToken\(\)/);
  assert.match(dispatcher, /const configured = missingEnv\(marketRequired\)\.length === 0/);
  assert.match(dispatcher, /const archiveConfigured = missingEnv\(archiveRequired\)\.length === 0/);
  assert.match(dispatcher, /if \(archiveConfigured\)[\s\S]*googleDriveConfig\(\)/);
  assert.match(dispatcher, /missingEnv: missingEnv\(marketRequired\)/);
});
