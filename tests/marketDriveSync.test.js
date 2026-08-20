import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { loadPendingMarketIntelligenceDates, marketDriveRunKey, runMarketReportArchiveReplayBatch, runMarketReportDriveSync } from '../api/_marketDriveSync.js';

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

function clientMock({ knownMd5 = [], publicationStatus = null, pairedImports = [], briefs = [] } = {}) {
  const rpcCalls = [];
  return {
    rpcCalls,
    rpc: async (name, payload) => {
      rpcCalls.push({ name, payload });
      if (name === 'reserve_market_report_sync_run') return { data: { reserved: true, status: 'running' }, error: null };
      if (name === 'finish_market_report_sync_run') return { data: { status: payload.p_status }, error: null };
      if (name === 'save_market_drive_report_import') return { data: { status: 'completed', mopsPublication: publicationStatus ? { status: publicationStatus, conflictCode: publicationStatus === 'conflict' ? 'MOPS_LEDGER_VALUE_MISMATCH' : null } : null }, error: null };
      return { data: null, error: new Error('Unexpected RPC') };
    },
    from: (table) => ({
      select: (columns) => {
        if (table === 'market_report_imports' && columns === 'source_md5') return {
          not: () => ({ range: async () => ({ data: knownMd5.map((source_md5) => ({ source_md5 })), error: null }) }),
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
    parseReport: async () => ({ sourceHash: 'a'.repeat(64), reportDate: '2026-08-20', observations: [{ sourceSymbol: 'AMFSA00', price: 700 }] }),
  });
  assert.equal(result.importedCount, 1);
  const saved = client.rpcCalls.find(({ name }) => name === 'save_market_drive_report_import');
  assert.equal(saved.payload.p_source_md5, md5);
  assert.equal(saved.payload.p_source_document_type, 'european_marketscan');
  assert.deepEqual(saved.payload.p_observations, [{ sourceSymbol: 'AMFSA00', price: 700 }]);
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
  assert.deepEqual(derivedCalls, [{ reportDate: '2026-08-19', commentaryContexts: [], publishAlerts: false, recordShadow: false, reconcileDerived: true }]);
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
});
