import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { parseMarketReportPdf } from '../api/_marketIntelligence.js';
import { processMarketIntelligenceDate } from '../api/_marketIntelligenceTrading.js';

const MOPS_SYMBOLS = Object.freeze({ AMFSA00: 's05', PPXDK00: 's380', POABC00: 'sgo' });
const DEFAULT_START_DATE = '2025-01-01';
const EXPECTED_SUPABASE_PROJECT_REF = 'pjforfvchygdyqfcgpmw';
const DEFAULT_SUPABASE_URL = 'https://pjforfvchygdyqfcgpmw.supabase.co';

function usage() {
  return [
    'Usage: node scripts/replay-market-report-archive.mjs --archive <directory> [--start YYYY-MM-DD]',
    '       [--local-only] [--brief-start YYYY-MM-DD] [--enrich-commentary]',
    '       [--apply --expected-manifest-hash <sha256> --expected-impact-hash <sha256>]',
    '',
    'Impact mode is read-only and is the default. Apply mode replays immutable report evidence and',
    'publishes only complete, non-conflicting European Marketscan MOPS triples. Historical brief',
    'backfill is deterministic by default; --enrich-commentary is an explicit, resumable AI phase.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = { archive: '', start: DEFAULT_START_DATE, briefStart: '', apply: false, localOnly: false, enrichCommentary: false, expectedManifestHash: '', expectedImpactHash: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--archive') options.archive = argv[++index] || '';
    else if (argument === '--start') options.start = argv[++index] || '';
    else if (argument === '--apply') options.apply = true;
    else if (argument === '--local-only') options.localOnly = true;
    else if (argument === '--brief-start') options.briefStart = argv[++index] || '';
    else if (argument === '--enrich-commentary') options.enrichCommentary = true;
    else if (argument === '--expected-manifest-hash') options.expectedManifestHash = argv[++index] || '';
    else if (argument === '--expected-impact-hash') options.expectedImpactHash = argv[++index] || '';
    else if (argument === '--help' || argument === '-h') {
      console.log(usage());
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.archive) throw new Error('The licensed report archive directory is required.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.start)) throw new Error('The replay start date must use YYYY-MM-DD.');
  if (options.briefStart && !/^\d{4}-\d{2}-\d{2}$/.test(options.briefStart)) throw new Error('The brief replay start date must use YYYY-MM-DD.');
  if (options.apply && (!/^[a-f0-9]{64}$/.test(options.expectedManifestHash) || !/^[a-f0-9]{64}$/.test(options.expectedImpactHash))) {
    throw new Error('Apply mode requires the exact reviewed --expected-manifest-hash and --expected-impact-hash.');
  }
  if (options.apply && options.localOnly) throw new Error('Apply mode cannot be combined with --local-only.');
  if (options.enrichCommentary && !options.apply) throw new Error('--enrich-commentary is available only in reviewed apply mode.');
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
        contractMonth: row.contractMonth || null,
        printedContractMonth: row.printedContractMonth || null,
        tenor: row.tenor || null,
        unit: row.unit || null,
        assessmentSession: row.assessmentSession || null,
        basisMetadata: row.basisMetadata || null,
      }))
      .sort((left, right) => left.sourceSymbol.localeCompare(right.sourceSymbol)),
    availabilityEvidence: (report.availabilityEvidence || [])
      .map((row) => ({
        sourceSymbol: row.sourceSymbol,
        status: row.status,
        sourcePage: row.sourcePage == null ? null : Number(row.sourcePage),
        contractMonth: row.contractMonth || null,
        printedContractMonth: row.printedContractMonth || null,
        tenor: row.tenor || null,
        unit: row.unit || null,
        assessmentSession: row.assessmentSession || null,
        basisMetadata: row.basisMetadata || null,
      }))
      .sort((left, right) => left.sourceSymbol.localeCompare(right.sourceSymbol)),
  };
}

export async function parseArchive(root, startDate) {
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
  })).sort((left, right) => left.file.localeCompare(right.file) || left.errorCode.localeCompare(right.errorCode));
  const byHash = new Map();
  const eligibleSourceFiles = parsed.filter((entry) => entry.ok && entry.report.reportDate >= startDate);
  for (const row of eligibleSourceFiles) {
    if (!byHash.has(row.report.sourceHash)) byHash.set(row.report.sourceHash, row.report);
  }
  return {
    discoveredFiles: paths.length,
    inspectedSourceFiles: eligibleSourceFiles.length,
    completeEuropeanMarketscanSourceFiles: eligibleSourceFiles
      .filter((row) => exactMopsTriple(row.report) != null).length,
    sourceFileReports: eligibleSourceFiles.map((row) => row.report),
    sourceFileManifest: eligibleSourceFiles.map((row) => ({
      file: path.relative(root, row.filePath).split(path.sep).join('/'),
      sourceHash: row.report.sourceHash,
      documentType: row.report.documentType,
      reportDate: row.report.reportDate,
    })).sort((left, right) => left.file.localeCompare(right.file) || left.sourceHash.localeCompare(right.sourceHash)),
    sourceFilesByHash: new Map(eligibleSourceFiles.map((row) => [row.report.sourceHash, row.filePath])),
    duplicateFiles: eligibleSourceFiles.length - byHash.size,
    parseFailures,
    reports: [...byHash.values()].sort((left, right) => left.reportDate.localeCompare(right.reportDate)
      || left.documentType.localeCompare(right.documentType)
      || left.sourceHash.localeCompare(right.sourceHash)),
  };
}

function symbolCounts(reports = []) {
  const counts = new Map();
  for (let index = 0; index < reports.length; index += 1) {
    const report = reports[index];
    for (const row of report.observations || []) counts.set(row.sourceSymbol, (counts.get(row.sourceSymbol) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

const CONTRACT_SYMBOL_SPEC = Object.freeze({
  FOFS000: ['bm', 'USD/MT', 'asia_moc', true],
  FOFS001: ['m1', 'USD/MT', 'asia_moc', true],
  FOFS002: ['m2', 'USD/MT', 'asia_moc', true],
  FPLSM01: ['m1', 'USD/MT', 'london_moc', true],
  FPLSM02: ['m2', 'USD/MT', 'london_moc', true],
  FQLSM01: ['m1', 'USD/MT', 'london_moc', true],
  FQLSM02: ['m2', 'USD/MT', 'london_moc', true],
  BSGSL00: ['bm', 'USD/BBL', 'london_moc', true],
  MSGSL00: ['m1', 'USD/BBL', 'london_moc', true],
  MSHSL00: ['m2', 'USD/BBL', 'london_moc', true],
  AARIN00: ['other', 'USD/MT', 'london_1630', true],
  AARIO00: ['other', 'USD/MT', 'london_1630', true],
  AARIP00: ['other', 'USD/MT', 'london_1630', true],
  AAYES00: ['other', 'USD/BBL', 'london_1630', true],
  AAYET00: ['other', 'USD/BBL', 'london_1630', true],
  AAXZY00: ['other', 'USD/BBL', 'london_1630', true],
  AAYAM00: ['other', 'USD/BBL', 'london_1630', true],
  ICLO001: ['other', 'USD/MT', 'ice_settlement', true],
  ICLO002: ['other', 'USD/MT', 'ice_settlement', true],
  ICLO003: ['other', 'USD/MT', 'ice_settlement', true],
  ICLO004: ['other', 'USD/MT', 'ice_settlement', true],
  ICLO005: ['other', 'USD/MT', 'ice_settlement', true],
  ICLO006: ['other', 'USD/MT', 'ice_settlement', true],
  MSJSL00: ['bm', 'USD/MT', 'london_1630', false],
  MSKSL00: ['m0', 'USD/MT', 'london_1630', true],
  MSLSL00: ['m1', 'USD/MT', 'london_1630', true],
  MSMSL00: ['m2', 'USD/MT', 'london_1630', true],
});

const CONTRACT_FAMILIES = Object.freeze([
  { symbols: ['FOFS000', 'FOFS001', 'FOFS002'], positions: [0, 1, 2] },
  { symbols: ['FPLSM01', 'FPLSM02'], positions: [1, 2] },
  { symbols: ['FQLSM01', 'FQLSM02'], positions: [1, 2] },
  { symbols: ['BSGSL00', 'MSGSL00', 'MSHSL00'], positions: [0, 1, 2] },
  { symbols: ['AARIN00', 'AARIO00', 'AARIP00'], positions: [1, 2, 3] },
  { symbols: ['AAYES00', 'AAYET00', 'AAXZY00', 'AAYAM00'], positions: [1, 2, 3, 4] },
  { symbols: ['ICLO001', 'ICLO002', 'ICLO003', 'ICLO004', 'ICLO005', 'ICLO006'], positions: [1, 2, 3, 4, 5, 6] },
  { symbols: ['MSJSL00', 'MSKSL00', 'MSLSL00', 'MSMSL00'], positions: [0, 0, 1, 2] },
]);

function contractMonthIndex(value) {
  if (!/^\d{4}-\d{2}-01$/.test(String(value || ''))) return null;
  const [year, month] = String(value).slice(0, 7).split('-').map(Number);
  return Number.isInteger(year) && month >= 1 && month <= 12 ? year * 12 + month - 1 : null;
}

function contractIssue(report, row, code, details = {}) {
  return {
    reportDate: report.reportDate,
    sourceHash: report.sourceHash,
    sourceSymbol: row?.sourceSymbol || details.sourceSymbol || null,
    contractMonth: row?.contractMonth || null,
    code,
    ...details,
  };
}

function forwardContractMonthIssues(reports = []) {
  const issues = [];
  for (const report of reports) {
    const rowBySymbol = new Map((report.observations || []).map((row) => [row.sourceSymbol, row]));
    for (const row of report.observations || []) {
      const spec = CONTRACT_SYMBOL_SPEC[row.sourceSymbol];
      if (!spec) continue;
      const [tenor, unit, assessmentSession, printedMonthAuthority] = spec;
      if (row.tenor !== tenor) issues.push(contractIssue(report, row, 'TENOR_MISMATCH', { expected: tenor, actual: row.tenor || null }));
      if (row.unit !== unit) issues.push(contractIssue(report, row, 'UNIT_MISMATCH', { expected: unit, actual: row.unit || null }));
      if (row.assessmentSession !== assessmentSession) issues.push(contractIssue(report, row, 'SESSION_MISMATCH', { expected: assessmentSession, actual: row.assessmentSession || null }));
      const monthIndex = contractMonthIndex(row.contractMonth);
      if (monthIndex == null) issues.push(contractIssue(report, row, 'CONTRACT_MONTH_INVALID'));
      if (printedMonthAuthority) {
        if (contractMonthIndex(row.printedContractMonth) == null) issues.push(contractIssue(report, row, 'PRINTED_CONTRACT_MONTH_MISSING'));
        else if (row.printedContractMonth !== row.contractMonth) issues.push(contractIssue(report, row, 'PRINTED_CONTRACT_MONTH_MISMATCH', { printedContractMonth: row.printedContractMonth }));
      }
    }

    for (const family of CONTRACT_FAMILIES) {
      const present = family.symbols.map((symbol, index) => ({ row: rowBySymbol.get(symbol), position: family.positions[index] })).filter(({ row }) => row);
      for (let index = 1; index < present.length; index += 1) {
        const previous = present[index - 1];
        const current = present[index];
        const previousMonth = contractMonthIndex(previous.row.contractMonth);
        const currentMonth = contractMonthIndex(current.row.contractMonth);
        if (previousMonth == null || currentMonth == null) continue;
        const expectedDelta = current.position - previous.position;
        if (currentMonth - previousMonth !== expectedDelta) {
          issues.push(contractIssue(report, current.row, 'CONTRACT_FAMILY_SEQUENCE_INVALID', {
            previousSymbol: previous.row.sourceSymbol,
            previousContractMonth: previous.row.contractMonth,
            expectedMonthDelta: expectedDelta,
            actualMonthDelta: currentMonth - previousMonth,
          }));
        }
      }
    }

    for (const suffix of ['01', '02']) {
      const outright = rowBySymbol.get(`FPLSM${suffix}`);
      const spread = rowBySymbol.get(`FQLSM${suffix}`);
      if (outright && spread && outright.contractMonth !== spread.contractMonth) {
        issues.push(contractIssue(report, spread, 'HSFO_OUTRIGHT_SPREAD_MONTH_MISMATCH', {
          pairedSymbol: outright.sourceSymbol,
          pairedContractMonth: outright.contractMonth,
        }));
      }
    }

    const reportMonth = contractMonthIndex(`${String(report.reportDate || '').slice(0, 7)}-01`);
    for (const symbol of ['FOFS000', 'BSGSL00', 'MSJSL00', 'MSKSL00']) {
      const row = rowBySymbol.get(symbol);
      if (!row || row.basisMetadata?.publicationEligible === false) continue;
      if (reportMonth == null || contractMonthIndex(row.contractMonth) !== reportMonth) {
        issues.push(contractIssue(report, row, 'CURRENT_OR_BALANCE_MONTH_MISMATCH', { reportMonth: String(report.reportDate || '').slice(0, 7) || null }));
      }
    }

    const sixth = rowBySymbol.get('ICLO006');
    if (sixth?.contractMonth) {
      const [reportYear, reportMonthNumber] = report.reportDate.slice(0, 7).split('-').map(Number);
      const [contractYear, contractMonthNumber] = sixth.contractMonth.slice(0, 7).split('-').map(Number);
      const offset = (contractYear - reportYear) * 12 + contractMonthNumber - reportMonthNumber;
      if (offset < 5 || offset > 6) issues.push(contractIssue(report, sixth, 'ICE_SIXTH_PROMPT_OFFSET_INVALID'));
    }
  }
  return issues.sort((left, right) => left.reportDate.localeCompare(right.reportDate)
    || String(left.sourceSymbol || '').localeCompare(String(right.sourceSymbol || ''))
    || left.code.localeCompare(right.code));
}

export function buildMarketArchiveAudit(archive) {
  const stableReports = [...(archive.reports || [])].sort((left, right) => left.reportDate.localeCompare(right.reportDate)
    || left.documentType.localeCompare(right.documentType)
    || left.sourceHash.localeCompare(right.sourceHash));
  const sourceFileManifest = (archive.sourceFileManifest || (archive.sourceFileReports || stableReports).map((report, index) => ({
    file: `source-${String(index).padStart(6, '0')}.pdf`,
    sourceHash: report.sourceHash,
    documentType: report.documentType,
    reportDate: report.reportDate,
  }))).map((row) => ({
    file: String(row.file || ''),
    sourceHash: row.sourceHash,
    documentType: row.documentType,
    reportDate: row.reportDate,
  })).sort((left, right) => left.file.localeCompare(right.file) || left.sourceHash.localeCompare(right.sourceHash));
  const manifestBasis = {
    counts: {
      discoveredFiles: archive.discoveredFiles,
      inspectedSourceFiles: archive.inspectedSourceFiles ?? archive.discoveredFiles,
      uniqueReports: stableReports.length,
      duplicateFiles: archive.duplicateFiles,
    },
    sourceFiles: sourceFileManifest,
    reports: stableReports.map((report) => stableReport(report)),
  };
  return {
    manifestHash: createHash('sha256').update(JSON.stringify(manifestBasis)).digest('hex'),
    discoveredFiles: archive.discoveredFiles,
    inspectedSourceFiles: archive.inspectedSourceFiles ?? archive.discoveredFiles,
    parsedSourceFiles: (archive.inspectedSourceFiles ?? archive.discoveredFiles) - (archive.parseFailures || []).length,
    uniqueReports: stableReports.length,
    duplicateFiles: archive.duplicateFiles,
    uniqueByType: Object.fromEntries(['bunkerwire', 'european_marketscan'].map((type) => [type, stableReports.filter((report) => report.documentType === type).length])),
    distinctReportDates: new Set(stableReports.map((report) => report.reportDate)).size,
    completeEuropeanMarketscanSourceFiles: archive.completeEuropeanMarketscanSourceFiles || 0,
    completeEuropeanMarketscanTriples: stableReports.filter((report) => exactMopsTriple(report) != null).length,
    sourceFileSymbolCounts: symbolCounts(archive.sourceFileReports || stableReports),
    uniqueReportSymbolCounts: symbolCounts(stableReports),
    contractMonthIssues: forwardContractMonthIssues(stableReports),
    parseFailures: archive.parseFailures || [],
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

export function publishableMopsTriple(report) {
  const triple = exactMopsTriple(report);
  if (!triple) return null;
  const rows = new Map((report.observations || [])
    .filter((row) => MOPS_SYMBOLS[row.sourceSymbol])
    .map((row) => [row.sourceSymbol, row]));
  const allEligible = Object.keys(MOPS_SYMBOLS).every((symbol) => {
    const row = rows.get(symbol);
    return row?.basisMetadata?.publicationEligible !== false;
  });
  return allEligible ? triple : null;
}

function sameNumber(left, right) {
  return Number.isFinite(Number(left)) && Number.isFinite(Number(right)) && Math.abs(Number(left) - Number(right)) < 0.000001;
}

export function buildMarketReplayImpact(archive, ledger) {
  const completeTriples = [];
  const incompleteDates = [];
  const publicationIneligibleDates = [];
  for (const report of archive.reports) {
    if (report.documentType !== 'european_marketscan') continue;
    const rawTriple = exactMopsTriple(report);
    const triple = publishableMopsTriple(report);
    if (triple) completeTriples.push({ report, triple });
    else if (rawTriple) publicationIneligibleDates.push(report.reportDate);
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
    publicationIneligibleTriples: publicationIneligibleDates.length,
    outcomes,
  };
  const impactHash = createHash('sha256').update(JSON.stringify(impactBasis)).digest('hex');
  const outcomeCounts = Object.fromEntries(['create', 'replace_estimate', 'match_actual', 'conflict_actual']
    .map((key) => [key, outcomes.filter((row) => row.outcome === key).length]));
  return {
    manifestHash: buildMarketArchiveAudit(archive).manifestHash,
    impactHash,
    reportDateRange: { start: impactBasis.startDate, end: impactBasis.endDate },
    discoveredFiles: archive.discoveredFiles,
    inspectedSourceFiles: archive.inspectedSourceFiles ?? archive.discoveredFiles,
    uniqueReports: archive.reports.length,
    duplicateFiles: archive.duplicateFiles,
    parseFailures: archive.parseFailures,
    completeEuropeanMarketscanSourceFiles: archive.completeEuropeanMarketscanSourceFiles ?? completeTriples.length,
    completeEuropeanMarketscanTriples: completeTriples.length,
    incompleteEuropeanMarketscanDates: [...new Set(incompleteDates)].sort(),
    publicationIneligibleEuropeanMarketscanDates: [...new Set(publicationIneligibleDates)].sort(),
    settlementOutcomes: outcomeCounts,
    conflicts: outcomes.filter((row) => row.outcome === 'conflict_actual').map((row) => row.reportDate),
  };
}

async function loadCommentaryContext(report, sourceFilesByHash) {
  const filePath = sourceFilesByHash.get(report.sourceHash);
  if (!filePath) return null;
  const parsed = await parseMarketReportPdf(await readFile(filePath), {
    documentType: report.documentType,
    filename: path.basename(filePath),
    includeCommentaryContext: true,
  });
  if (parsed.sourceHash !== report.sourceHash || parsed.reportDate !== report.reportDate) {
    throw new Error(`Licensed report changed during derived-brief replay: ${report.reportDate} ${report.documentType}.`);
  }
  return {
    sourceHash: parsed.sourceHash,
    documentType: report.documentType,
    commentaryContext: parsed.commentaryContext || [],
  };
}

async function backfillDerivedBriefs(client, reports, sourceFilesByHash, { briefStart = '', enrichCommentary = false } = {}) {
  const byDate = new Map();
  for (const report of reports) {
    const entry = byDate.get(report.reportDate) || new Map();
    const existing = entry.get(report.documentType);
    if (!existing || report.sourceHash.localeCompare(existing.sourceHash) < 0) entry.set(report.documentType, report);
    byDate.set(report.reportDate, entry);
  }
  const pairs = [...byDate.entries()]
    .filter(([reportDate, pair]) => (!briefStart || reportDate >= briefStart) && pair.has('bunkerwire') && pair.has('european_marketscan'))
    .sort(([left], [right]) => left.localeCompare(right));
  const summary = { pairedDates: pairs.length, completed: 0, waiting: 0, conflicts: 0, aiCompleted: 0, aiUnavailable: 0 };
  await concurrentMap(pairs, enrichCommentary ? 1 : 2, async ([reportDate, pair], index) => {
    const commentaryContexts = enrichCommentary ? (await Promise.all([
      loadCommentaryContext(pair.get('bunkerwire'), sourceFilesByHash),
      loadCommentaryContext(pair.get('european_marketscan'), sourceFilesByHash),
    ])).filter(Boolean) : [];
    const result = await processMarketIntelligenceDate(client, {
      reportDate,
      commentaryContexts,
      publishAlerts: false,
      recordShadow: false,
      forceDeterministicRevision: !enrichCommentary,
    });
    if (result.status === 'completed') {
      summary.completed += 1;
      if (result.aiStatus === 'completed') summary.aiCompleted += 1;
      else summary.aiUnavailable += 1;
    } else if (result.status === 'waiting_for_pair') summary.waiting += 1;
    else if (result.status === 'conflict') summary.conflicts += 1;
    if ((index + 1) % 25 === 0 || index + 1 === pairs.length) {
      console.error(`Derived market briefs: ${index + 1}/${pairs.length} dates processed.`);
    }
  });
  return summary;
}

export async function applyReplay(client, reports, sourceFilesByHash, options = {}) {
  const summary = { reports: reports.length, completed: 0, replayed: 0, quarantined: 0, published: 0, matched: 0, incomplete: 0, conflicts: 0 };
  for (const [index, report] of reports.entries()) {
    const result = await client.rpc('save_market_report_import', {
      p_idempotency_key: `market-replay:${report.sourceHash}`,
      p_source_document_type: report.documentType,
      p_source_hash: report.sourceHash,
      p_report_date: report.reportDate,
      p_observations: report.observations,
      p_actor_user_id: null,
      p_actor_email: 'system@fcos.local',
      p_availability: report.availabilityEvidence || [],
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
    if ((index + 1) % 50 === 0 || index + 1 === reports.length) {
      console.error(`Structured market replay: ${index + 1}/${reports.length} reports processed.`);
    }
  }
  return { ...summary, derivedBriefs: await backfillDerivedBriefs(client, reports, sourceFilesByHash, options) };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const archive = await parseArchive(path.resolve(options.archive), options.start);
  const audit = buildMarketArchiveAudit(archive);
  console.log(JSON.stringify({ mode: 'local-audit', ...audit }, null, 2));
  if (options.localOnly) return;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('A service-only Supabase key is required in the environment for live impact or apply mode.');
  const supabaseUrl = new URL(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL);
  const projectRef = supabaseUrl.hostname.split('.')[0];
  if (supabaseUrl.protocol !== 'https:' || projectRef !== EXPECTED_SUPABASE_PROJECT_REF) {
    throw new Error(`Supabase identity mismatch: expected project ${EXPECTED_SUPABASE_PROJECT_REF}.`);
  }
  const client = createClient(supabaseUrl.toString(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ledger = await loadLedger(client, options.start);
  const impact = buildMarketReplayImpact(archive, ledger);
  console.log(JSON.stringify({ mode: 'live-impact', ...impact }, null, 2));
  if (!options.apply) return;
  if (audit.manifestHash !== options.expectedManifestHash) throw new Error('The licensed archive changed after manifest review.');
  if (impact.impactHash !== options.expectedImpactHash) throw new Error('The archive or MOPS ledger changed after impact review.');
  if (audit.contractMonthIssues.length || impact.parseFailures.length || impact.conflicts.length) throw new Error('Replay is blocked by contract-month issues, parse failures, or actual-value conflicts.');
  const replay = await applyReplay(client, archive.reports, archive.sourceFilesByHash, options);
  console.log(JSON.stringify({ mode: 'apply', impactHash: impact.impactHash, ...replay }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
