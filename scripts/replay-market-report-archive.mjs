import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { parseMarketReportPdf } from '../api/_marketIntelligence.js';

const MOPS_SYMBOLS = Object.freeze({ AMFSA00: 's05', PPXDK00: 's380', POABC00: 'sgo' });
const DEFAULT_START_DATE = '2025-01-01';
const DEFAULT_SUPABASE_URL = 'https://pjforfvchygdyqfcgpmw.supabase.co';

function usage() {
  return [
    'Usage: node scripts/replay-market-report-archive.mjs --archive <directory> [--start YYYY-MM-DD]',
    '       [--apply --expected-impact-hash <sha256>]',
    '',
    'Impact mode is read-only and is the default. Apply mode replays immutable report evidence and',
    'publishes only complete, non-conflicting European Marketscan MOPS triples.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = { archive: '', start: DEFAULT_START_DATE, apply: false, expectedImpactHash: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--archive') options.archive = argv[++index] || '';
    else if (argument === '--start') options.start = argv[++index] || '';
    else if (argument === '--apply') options.apply = true;
    else if (argument === '--expected-impact-hash') options.expectedImpactHash = argv[++index] || '';
    else if (argument === '--help' || argument === '-h') {
      console.log(usage());
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.archive) throw new Error('The licensed report archive directory is required.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.start)) throw new Error('The replay start date must use YYYY-MM-DD.');
  if (options.apply && !/^[a-f0-9]{64}$/.test(options.expectedImpactHash)) {
    throw new Error('Apply mode requires the exact reviewed --expected-impact-hash.');
  }
  return options;
}

function documentTypeFor(filename) {
  const base = path.basename(filename);
  if (/^EUM[_ -]/i.test(base)) return 'european_marketscan';
  if (/^BW[_ -]/i.test(base)) return 'bunkerwire';
  return null;
}

async function reportPaths(root) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.pdf$/i.test(entry.name) && documentTypeFor(entry.name))
    .map((entry) => path.join(entry.parentPath || entry.path || root, entry.name))
    .sort();
}

async function concurrentMap(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function stableReport(report) {
  return {
    documentType: report.documentType,
    reportDate: report.reportDate,
    sourceHash: report.sourceHash,
    observations: report.observations
      .map((row) => ({
        sourceSymbol: row.sourceSymbol,
        price: Number(row.price),
        dayChange: row.dayChange == null ? null : Number(row.dayChange),
        sourcePage: row.sourcePage == null ? null : Number(row.sourcePage),
      }))
      .sort((left, right) => left.sourceSymbol.localeCompare(right.sourceSymbol)),
  };
}

async function parseArchive(root, startDate) {
  const paths = await reportPaths(root);
  const parsed = await concurrentMap(paths, 4, async (filePath) => {
    const buffer = await readFile(filePath);
    const documentType = documentTypeFor(filePath);
    try {
      return { ok: true, filePath, report: stableReport(await parseMarketReportPdf(buffer, { documentType, filename: path.basename(filePath) })) };
    } catch (error) {
      return { ok: false, filePath, errorCode: error?.code || 'MARKET_REPORT_PARSE_FAILED' };
    }
  });
  const parseFailures = parsed.filter((row) => !row.ok).map((row) => ({
    file: path.basename(row.filePath),
    errorCode: row.errorCode,
  }));
  const byHash = new Map();
  for (const row of parsed.filter((entry) => entry.ok && entry.report.reportDate >= startDate)) {
    if (!byHash.has(row.report.sourceHash)) byHash.set(row.report.sourceHash, row.report);
  }
  return {
    discoveredFiles: paths.length,
    duplicateFiles: parsed.filter((row) => row.ok && row.report.reportDate >= startDate).length - byHash.size,
    parseFailures,
    reports: [...byHash.values()].sort((left, right) => left.reportDate.localeCompare(right.reportDate)
      || left.documentType.localeCompare(right.documentType)
      || left.sourceHash.localeCompare(right.sourceHash)),
  };
}

async function loadLedger(client, startDate) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await client
      .from('hedge_market_prices')
      .select('id,price_date,s380,s05,sgo,is_estimate')
      .gte('price_date', startDate)
      .order('price_date')
      .range(offset, offset + 999);
    if (result.error) throw new Error(`MOPS ledger could not be loaded: ${result.error.message}`);
    rows.push(...(result.data || []));
    if ((result.data || []).length < 1000) break;
  }
  return new Map(rows.map((row) => [row.price_date, row]));
}

export function exactMopsTriple(report) {
  if (report.documentType !== 'european_marketscan') return null;
  const values = Object.fromEntries(report.observations
    .filter((row) => MOPS_SYMBOLS[row.sourceSymbol])
    .map((row) => [MOPS_SYMBOLS[row.sourceSymbol], Number(row.price)]));
  return Object.keys(MOPS_SYMBOLS).every((symbol) => Number.isFinite(values[MOPS_SYMBOLS[symbol]])) ? values : null;
}

function sameNumber(left, right) {
  return Number.isFinite(Number(left)) && Number.isFinite(Number(right)) && Math.abs(Number(left) - Number(right)) < 0.000001;
}

export function buildMarketReplayImpact(archive, ledger) {
  const completeTriples = [];
  const incompleteDates = [];
  for (const report of archive.reports) {
    if (report.documentType !== 'european_marketscan') continue;
    const triple = exactMopsTriple(report);
    if (triple) completeTriples.push({ report, triple });
    else incompleteDates.push(report.reportDate);
  }
  const outcomes = completeTriples.map(({ report, triple }) => {
    const existing = ledger.get(report.reportDate);
    let outcome = 'create';
    if (existing?.is_estimate) outcome = 'replace_estimate';
    else if (existing && sameNumber(existing.s05, triple.s05) && sameNumber(existing.s380, triple.s380) && sameNumber(existing.sgo, triple.sgo)) outcome = 'match_actual';
    else if (existing) outcome = 'conflict_actual';
    return { reportDate: report.reportDate, sourceHash: report.sourceHash, outcome };
  });
  const impactBasis = {
    startDate: archive.reports[0]?.reportDate || null,
    endDate: archive.reports.at(-1)?.reportDate || null,
    reportCount: archive.reports.length,
    completeTriples: completeTriples.length,
    incompleteTriples: incompleteDates.length,
    outcomes,
  };
  const impactHash = createHash('sha256').update(JSON.stringify(impactBasis)).digest('hex');
  const outcomeCounts = Object.fromEntries(['create', 'replace_estimate', 'match_actual', 'conflict_actual']
    .map((key) => [key, outcomes.filter((row) => row.outcome === key).length]));
  return {
    impactHash,
    reportDateRange: { start: impactBasis.startDate, end: impactBasis.endDate },
    discoveredFiles: archive.discoveredFiles,
    uniqueReports: archive.reports.length,
    duplicateFiles: archive.duplicateFiles,
    parseFailures: archive.parseFailures,
    completeEuropeanMarketscanTriples: completeTriples.length,
    incompleteEuropeanMarketscanDates: [...new Set(incompleteDates)].sort(),
    settlementOutcomes: outcomeCounts,
    conflicts: outcomes.filter((row) => row.outcome === 'conflict_actual').map((row) => row.reportDate),
  };
}

async function applyReplay(client, reports) {
  const summary = { reports: reports.length, completed: 0, replayed: 0, quarantined: 0, published: 0, matched: 0, incomplete: 0, conflicts: 0 };
  for (const report of reports) {
    const result = await client.rpc('save_market_report_import', {
      p_idempotency_key: `market-replay:${report.sourceHash}`,
      p_source_document_type: report.documentType,
      p_source_hash: report.sourceHash,
      p_report_date: report.reportDate,
      p_observations: report.observations,
      p_actor_user_id: null,
      p_actor_email: 'system@fcos.local',
    });
    if (result.error) throw new Error(`Replay failed for ${report.reportDate} ${report.documentType}: ${result.error.message}`);
    if (result.data?.status === 'replayed') summary.replayed += 1;
    else summary.completed += 1;
    summary.quarantined += Number(result.data?.quarantinedCount || 0);
    const publication = result.data?.mopsPublication?.status;
    if (publication === 'published') summary.published += 1;
    else if (publication === 'matched') summary.matched += 1;
    else if (publication === 'incomplete') summary.incomplete += 1;
    else if (publication === 'conflict') summary.conflicts += 1;
  }
  return summary;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('A service-only Supabase key is required in the environment.');
  const client = createClient(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const archive = await parseArchive(path.resolve(options.archive), options.start);
  const ledger = await loadLedger(client, options.start);
  const impact = buildMarketReplayImpact(archive, ledger);
  console.log(JSON.stringify({ mode: 'impact', ...impact }, null, 2));
  if (!options.apply) return;
  if (impact.impactHash !== options.expectedImpactHash) throw new Error('The archive or MOPS ledger changed after impact review.');
  if (impact.parseFailures.length || impact.conflicts.length) throw new Error('Replay is blocked by parse failures or actual-value conflicts.');
  const replay = await applyReplay(client, archive.reports);
  console.log(JSON.stringify({ mode: 'apply', impactHash: impact.impactHash, ...replay }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
