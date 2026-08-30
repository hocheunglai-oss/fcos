import { createHash } from 'node:crypto';

const SYMBOL_RE = /\b[A-Z]{4,6}\d{2,3}\b/g;
const NUMBER_SOURCE = '[+-]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?';
const NUMBER_RE = new RegExp(NUMBER_SOURCE, 'g');
const RANGE_RE = new RegExp(`^\\s*(${NUMBER_SOURCE})\\s*[–—]\\s*(${NUMBER_SOURCE})|^\\s*(${NUMBER_SOURCE})-((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?)`);
const LEADING_NUMBER_RE = new RegExp(`^\\s*(${NUMBER_SOURCE})`);
const MAX_LIBRARY_ROWS = 2_500;

function compact(value) {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function numberValue(value) {
  const parsed = Number(String(value || '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function roundedY(item) {
  const value = Number(item?.transform?.[5]);
  return Number.isFinite(value) ? Math.round(value * 2) / 2 : null;
}

function compactLine(value) {
  return String(value || '').split('\t').map(compact).filter(Boolean).join('\t');
}

/**
 * Rebuild PDF rows from positioned text items. The normal pdf-parse join loses
 * table row boundaries, which makes a product name liable to be paired with a
 * neighbouring code. Values on the same printed row remain together.
 */
export function marketReportPageText(items = []) {
  const rows = [];
  for (const item of items) {
    const text = compact(item?.str);
    if (!text) continue;
    const y = roundedY(item);
    const x = Number(item?.transform?.[4]);
    let row = y == null ? null : rows.find((candidate) => candidate.y === y);
    if (!row) {
      row = { y: y ?? -rows.length, items: [] };
      rows.push(row);
    }
    const width = Number(item?.width);
    row.items.push({ x: Number.isFinite(x) ? x : row.items.length, width: Number.isFinite(width) ? width : 0, text });
  }
  return rows
    .sort((left, right) => right.y - left.y)
    .map((row) => row.items.sort((left, right) => left.x - right.x).reduce((line, item, index, sorted) => {
      if (index === 0) return item.text;
      const previous = sorted[index - 1];
      const previousEnd = previous.x + previous.width;
      const columnBreak = item.x - previousEnd >= 12;
      return `${line}${columnBreak ? '\t' : ' '}${item.text}`;
    }, ''))
    .filter(Boolean)
    .join('\n');
}

function normalizedUnit(value) {
  const input = compact(value).replace(/US\$/gi, '$').replace(/USD/gi, '$').toLowerCase();
  if (!input) return null;
  if (/€\s*\/\s*(?:mt|metric\s*ton)/.test(input)) return 'EUR/MT';
  if (/(?:\$|dollar)\s*\/\s*(?:mt|metric\s*ton)/.test(input)) return 'USD/MT';
  if (/(?:\$|dollar)\s*\/\s*(?:barrel|bbl)/.test(input)) return 'USD/BBL';
  if (/(?:\$|dollar)\s*\/\s*mmbtu/.test(input)) return 'USD/MMBTU';
  if (/(?:\$|dollar)\s*\/\s*feu/.test(input)) return 'USD/FEU';
  if (/cents?\s*\/\s*(?:gal|gallon)/.test(input)) return 'USC/GAL';
  if (/pence\s*\/\s*therm/.test(input)) return 'GBP_PENCE/THERM';
  if (/naira\s*\/\s*(?:l|liter|litre)/.test(input)) return 'NGN/L';
  return null;
}

function cleanProductName(value) {
  const cells = String(value || '').split('\t').map(compact).filter(Boolean);
  let label = compact(cells.at(-1) || '')
    .replace(/^0(?:\.0+)?\s+(?=[A-Za-z])/, '')
    .replace(/^[|:;,]+|[|:;,]+$/g, '')
    .replace(/^(?:mid|change|code|assessment|index)\s+/i, '')
    .trim();
  const lastHeader = Math.max(
    label.toLowerCase().lastIndexOf(' mid change '),
    label.toLowerCase().lastIndexOf(' code mid '),
    label.toLowerCase().lastIndexOf(' code change '),
  );
  if (lastHeader >= 0) label = label.slice(lastHeader).replace(/^(?:\s*(?:mid|change|code))+\s*/i, '').trim();
  if (!label || /^(?:mid|change|code|na|n\/a)$/i.test(label)) return null;
  if (SYMBOL_RE.test(label) || !/[A-Za-z]/.test(label) || /^(?:[+\-\d.,/]+\s*)+$/.test(label)) {
    SYMBOL_RE.lastIndex = 0;
    return null;
  }
  SYMBOL_RE.lastIndex = 0;
  if (/©|all rights reserved|support\.energy@|market commentary/i.test(label)) return null;
  return label.slice(-220).trim() || null;
}

function sectionDescriptors(value) {
  const descriptors = [];
  for (const cell of String(value || '').split('\t')) {
    const line = compact(cell);
    if (!line || line.length > 240 || /[“”"<>]|©|all rights reserved|support\.energy@|www\.|volume\s+\d+|issue\s+\d+/i.test(line)) continue;
    const match = line.match(/^(.{2,180}?)\s*\(([^)]{3,80})\)\s*(?:(?:code|mid|change|low|high|assessment|index)\s*)*$/i);
    if (!match) continue;
    if (!normalizedUnit(match[2]) && !/^(?:PGA\s+(?:page|pages)|PPE\s+page)/i.test(match[2])) continue;
    const label = compact(match[1]);
    if (label.length < 2 || normalizedUnit(label) || /^(?:code|mid|change|index)$/i.test(label)) continue;
    descriptors.push({ name: label.slice(0, 180), unit: normalizedUnit(match[2]) });
  }
  return descriptors;
}

function sectionName(value) {
  return sectionDescriptors(value)[0]?.name || null;
}

function parseValuePrefix(value, { hasChangeColumn = false } = {}) {
  const text = String(value || '').replace(/\u00a0/g, ' ');
  const na = /^\s*(?:NA(?:\s+(?:NA|NANA))?|NANA|N\/A)(?=\s|$)/i.exec(text);
  if (na) return { quoteState: 'published_na', consumedLength: na[0].length };

  const range = RANGE_RE.exec(text);
  if (range) {
    let cursor = range[0].length;
    const tail = text.slice(cursor);
    const midpoint = LEADING_NUMBER_RE.exec(tail);
    if (!midpoint) return null;
    cursor += midpoint[0].length;
    const afterMidpoint = text.slice(cursor);
    const change = LEADING_NUMBER_RE.exec(afterMidpoint);
    if (change && (hasChangeColumn || /^[\s]*[+-]/.test(afterMidpoint))) cursor += change[0].length;
    return {
      quoteState: 'numeric',
      bid: numberValue(range[1] ?? range[3]),
      ask: numberValue(range[2] ?? range[4]),
      price: numberValue(midpoint[1]),
      dayChange: change && (hasChangeColumn || /^[\s]*[+-]/.test(afterMidpoint)) ? numberValue(change[1]) : null,
      consumedLength: cursor,
    };
  }

  const first = LEADING_NUMBER_RE.exec(text);
  if (!first) return null;
  let cursor = first[0].length;
  const afterPrice = text.slice(cursor);
  const second = LEADING_NUMBER_RE.exec(afterPrice);
  const signedSecond = /^[\s]*[+-]/.test(afterPrice);
  if (second && (hasChangeColumn || signedSecond)) cursor += second[0].length;
  return {
    quoteState: 'numeric',
    bid: null,
    ask: null,
    price: numberValue(first[1]),
    dayChange: second && (hasChangeColumn || signedSecond) ? numberValue(second[1]) : null,
    consumedLength: cursor,
  };
}

function rowHash(row) {
  return createHash('sha256').update(JSON.stringify([
    row.sourcePage,
    row.sourceOrder,
    row.sourceSymbol,
    row.productName,
    row.sectionName,
    row.unit,
    row.quoteState,
    row.price,
    row.bid,
    row.ask,
    row.dayChange,
  ])).digest('hex');
}

function plausiblePriceRow(row) {
  if (!row.productName || row.productName.length < 2) return false;
  if (!row.sectionName) return false;
  if (row.quoteState === 'published_na') return true;
  return Number.isFinite(row.price);
}

/** Extract every structured table row with a source product code and a price. */
export function extractMarketReportLibrary(pageTexts = [], { documentType, knownBasis = {} } = {}) {
  const observations = [];
  let sourceOrder = 0;
  for (let pageIndex = 0; pageIndex < pageTexts.length; pageIndex += 1) {
    const lines = String(pageTexts[pageIndex] || '').split(/\r?\n/).map(compactLine).filter(Boolean);
    const pageUnits = new Set(lines.flatMap((line) => sectionDescriptors(line).map((section) => section.unit).filter(Boolean)));
    const unambiguousPageUnit = pageUnits.size === 1 ? [...pageUnits][0] : null;
    let currentSection = null;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      const matches = [...line.matchAll(SYMBOL_RE)];
      if (!matches.length) {
        currentSection = sectionName(line) || currentSection;
        continue;
      }
      const nearby = lines.slice(Math.max(0, lineIndex - 5), lineIndex + 1).join(' ');
      const hasChangeColumn = /\bchange\b/i.test(nearby);
      let inheritedLabel = null;
      let previousParsed = null;
      let previousEnd = 0;
      for (let index = 0; index < matches.length; index += 1) {
        const match = matches[index];
        const nextIndex = matches[index + 1]?.index ?? line.length;
        const labelRegion = line.slice(previousEnd, match.index);
        const rawLabel = previousParsed ? labelRegion.slice(Math.min(previousParsed.consumedLength, labelRegion.length)) : labelRegion;
        const productName = cleanProductName(rawLabel) || inheritedLabel;
        const valueRegion = line.slice(match.index + match[0].length, nextIndex);
        const parsed = parseValuePrefix(valueRegion, { hasChangeColumn });
        previousParsed = parsed;
        previousEnd = match.index + match[0].length;
        if (!parsed) continue;
        inheritedLabel = productName || inheritedLabel;
        const basis = knownBasis[match[0]] || null;
        const row = {
          sourceDocumentType: documentType,
          sourcePage: pageIndex + 1,
          sourceOrder: sourceOrder += 1,
          sourceSymbol: match[0],
          productName,
          sectionName: currentSection,
          unit: basis?.unit ? String(basis.unit).toUpperCase() : unambiguousPageUnit,
          quoteState: parsed.quoteState,
          price: parsed.price ?? null,
          bid: parsed.bid ?? null,
          ask: parsed.ask ?? null,
          dayChange: parsed.dayChange ?? null,
        };
        if (!plausiblePriceRow(row)) continue;
        observations.push({ ...row, rowHash: rowHash(row) });
        if (observations.length > MAX_LIBRARY_ROWS) throw new Error('MARKET_REPORT_LIBRARY_ROW_LIMIT');
      }
    }
  }
  const deduplicated = [...new Map(observations.map((row) => [row.rowHash, row])).values()];
  return {
    observations: deduplicated,
    observationCount: deduplicated.length,
    numericCount: deduplicated.filter((row) => row.quoteState === 'numeric').length,
    publishedNaCount: deduplicated.filter((row) => row.quoteState === 'published_na').length,
    productCodeCount: new Set(deduplicated.map((row) => row.sourceSymbol)).size,
  };
}

export const marketReportLibraryLimits = Object.freeze({ maxRowsPerReport: MAX_LIBRARY_ROWS });
