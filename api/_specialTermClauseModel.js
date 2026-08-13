import { createHash } from 'node:crypto';
import { Parser } from 'htmlparser2';

const OUTER_NUMBER = /^\s*(?:clause\s+)?(?:\(?\d+(?:\.\d+)*\)?[.):]?)[\s\t-]+/i;
const TOP_LEVEL_NUMBER = /^\s*(?:clause\s+)?(?:\(?\d+(?:\.\d+)*\)?[.):]?)[\s\t-]+(.+)$/i;
const TOP_LEVEL_HYPHEN = /^\s*[-\u2013\u2014\u2022]\s+(.+)$/;
const MANUAL_REVIEW_TERMS = new Set([
  'China Special Terms',
  'Russia Special Terms (Customs Declaration Form)',
  'Yudean Special Terms',
]);
const STOP_WORDS = new Set('a an and are as at be been being by for from has have if in into is it its of on or that the this to upon was were will with without shall buyer seller supplier delivery'.split(' '));

export const CLAUSE_CATEGORIES = Object.freeze([
  'Delivery',
  'Quantity and Measurement',
  'Quality and Claims',
  'Pricing and Payment',
  'Cancellation and Penalties',
  'Product and Specification',
  'Operations and Logistics',
  'Compliance and Warranty',
  'Contract Priority',
  'Other',
]);

export const CLAUSE_PROJECTIONS = Object.freeze({
  termsText: Object.freeze({ value: 'Terms Text', label: 'Terms Text', style: 'Numbered' }),
  confirmationRemark: Object.freeze({ value: 'Confirmation Remark', label: 'Confirmation special remark', style: 'Hyphen' }),
  nominationRemark: Object.freeze({ value: 'Nomination Remark', label: 'Nomination special remark', style: 'Hyphen' }),
});

export const CLAUSE_LIST_STYLES = Object.freeze(['Numbered', 'Hyphen']);

export function normalizeClauseText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
}

export function stripOuterClauseNumber(value) {
  return normalizeClauseText(value).replace(OUTER_NUMBER, '').trim();
}

export function normalizeClauseEquivalence(value) {
  return stripOuterClauseNumber(value)
    .toLocaleLowerCase('en')
    .replace(/\s+/g, ' ')
    .trim();
}

export function clauseHash(value) {
  return createHash('sha256').update(normalizeClauseText(value)).digest('hex');
}

export function canonicalClauseKey(value) {
  return createHash('sha256').update(normalizeClauseEquivalence(value)).digest('hex');
}

export function shortNameKey(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g, ' ').trim();
}

export function hasTopLevelNumber(value) {
  return OUTER_NUMBER.test(normalizeClauseText(value));
}

export function hasTopLevelListMarker(value) {
  const normalized = normalizeClauseText(value);
  return OUTER_NUMBER.test(normalized) || TOP_LEVEL_HYPHEN.test(normalized);
}

export function compileNumberedClauses(clauses) {
  return compileClauseList(clauses, 'Numbered');
}

export function compileClauseList(clauses, style = 'Numbered') {
  if (!CLAUSE_LIST_STYLES.includes(style)) throw new Error('Clause list style must be Numbered or Hyphen.');
  const separator = style === 'Numbered' ? '\n\n' : '\n';
  return (clauses || []).map((clause, index) => {
    const text = normalizeClauseText(clause?.text ?? clause?.clauseText ?? clause);
    if (!text) throw new Error(`Clause ${index + 1} is blank.`);
    if (hasTopLevelListMarker(text)) throw new Error(`Clause ${index + 1} already contains a top-level list marker.`);
    return style === 'Numbered' ? `${index + 1}. ${text}` : `- ${text}`;
  }).join(separator);
}

function htmlToText(value) {
  const source = String(value ?? '');
  if (!/<\/?[a-z][\s\S]*>/i.test(source)) return source;
  let output = '';
  const lists = [];
  const parser = new Parser({
    onopentag(name) {
      if (name === 'br') output += '\n';
      if (name === 'ol') lists.push({ ordered: true, index: 0 });
      if (name === 'ul') lists.push({ ordered: false, index: 0 });
      if (name === 'li') {
        if (output && !output.endsWith('\n')) output += '\n';
        const list = lists.at(-1);
        if (list?.ordered) list.index += 1;
        output += list?.ordered ? `${list.index}. ` : '- ';
      }
    },
    ontext(text) { output += text; },
    onclosetag(name) {
      if (name === 'li') output += '\n';
      else if (name === 'ol' || name === 'ul') lists.pop();
      else if (['p', 'div', 'h1', 'h2', 'h3', 'h4', 'blockquote'].includes(name)) output += '\n\n';
    },
  }, { decodeEntities: true, lowerCaseTags: true });
  parser.write(source);
  parser.end();
  return output;
}

export function parseLegacyClauses(value, { termName = '', markerStyle = 'Numbered' } = {}) {
  if (![...CLAUSE_LIST_STYLES, 'Auto'].includes(markerStyle)) throw new Error('Legacy marker style must be Numbered, Hyphen, or Auto.');
  const source = normalizeClauseText(htmlToText(value)).replace(/\u00a0/g, ' ');
  if (!source) return { clauses: [], markerCount: 0, inferredStyle: markerStyle === 'Auto' ? 'Hyphen' : markerStyle, manualReviewRequired: false, reason: null };
  const lines = source.split('\n').map((line) => line.trim()).filter(Boolean);
  const clauses = [];
  let current = '';
  let markers = 0;
  let numberedMarkers = 0;
  let hyphenMarkers = 0;
  for (const line of lines) {
    const numbered = line.match(TOP_LEVEL_NUMBER);
    const hyphen = line.match(TOP_LEVEL_HYPHEN);
    const marker = (markerStyle === 'Numbered' && numbered)
      || (markerStyle === 'Hyphen' && hyphen)
      || (markerStyle === 'Auto' && (numbered || hyphen));
    if (marker) {
      markers += 1;
      if (numbered) numberedMarkers += 1;
      else hyphenMarkers += 1;
      const body = (numbered || hyphen)[1];
      if (markers === 1 && current) current = `${current}\n${body}`;
      else {
        if (current) clauses.push(normalizeClauseText(current));
        current = body;
      }
    } else if (current) {
      current += `\n${line}`;
    } else {
      current = line;
    }
  }
  if (current) clauses.push(normalizeClauseText(current));
  const mixedMarkers = numberedMarkers > 0 && hyphenMarkers > 0;
  const manualReviewRequired = MANUAL_REVIEW_TERMS.has(termName) || markers === 0 || mixedMarkers;
  const inferredStyle = numberedMarkers > hyphenMarkers ? 'Numbered' : 'Hyphen';
  return {
    clauses: clauses.filter(Boolean),
    markerCount: markers,
    inferredStyle,
    manualReviewRequired,
    reason: MANUAL_REVIEW_TERMS.has(termName)
      ? 'The live corpus contains headings or non-standard numbering that requires a reviewer to confirm clause boundaries.'
      : markers === 0 ? 'No reliable top-level bullet marker was detected.'
        : mixedMarkers ? 'Numbered and hyphen markers are mixed; a reviewer must confirm clause boundaries and the output style.' : null,
  };
}

export function suggestClauseCategory(value) {
  const text = normalizeClauseEquivalence(value);
  if (/cancel|penalt|administrative charge|price loss/.test(text)) return 'Cancellation and Penalties';
  if (/claim|quality dispute|time bar|supporting document/.test(text)) return 'Quality and Claims';
  if (/quantity|measurement|meter|barge figure|observed temperature|density/.test(text)) return 'Quantity and Measurement';
  if (/invoice|payment|due date|price|mops|currency/.test(text)) return 'Pricing and Payment';
  if (/warrant|marpol|sanction|compliance|liab/.test(text)) return 'Compliance and Warranty';
  if (/specification|product|refinery|availability/.test(text)) return 'Product and Specification';
  if (/prevail|inconsisten|priority|physical supplier terms/.test(text)) return 'Contract Priority';
  if (/delivery|demurrage|first come|weather|barge|truck/.test(text)) return 'Delivery';
  if (/agent|coordination|notice|nomination|schedule|transport/.test(text)) return 'Operations and Logistics';
  return 'Other';
}

export function suggestClauseShortName(value) {
  const text = normalizeClauseEquivalence(value);
  const known = [
    [/marpol annex vi/, 'No MARPOL VI Warranty'],
    [/pay.*invoice.*due date.*bunker receipt/, 'Invoice Due Without BDR'],
    [/measur.*supplier.*apparatus|supplier.*measur.*quantity/, 'Supplier Measurement Final'],
    [/best endeavour.*demurrage/, 'Best Endeavours – No Demurrage'],
    [/claims?.*7 days|7 days.*claims?/, 'Claim Time Bar – 7 Days'],
    [/claims?.*21 days|21 days.*claims?/, 'Claim Time Bar – 21 Days'],
    [/claims?.*30 days|30 days.*claims?/, 'Claim Time Bar – 30 Days'],
    [/physical supplier.*prevail/, 'Physical Supplier Terms Prevail'],
    [/observed temperature/, 'Observed Temperature Quantity Final'],
    [/first come first served/, 'First Come First Served Delivery'],
  ];
  const match = known.find(([pattern]) => pattern.test(text));
  if (match) return match[1];
  const words = text.match(/[a-z0-9%$]+(?:'[a-z]+)?/g) || [];
  const selected = words.filter((word) => !STOP_WORDS.has(word)).slice(0, 6);
  const fallback = selected.length ? selected : words.slice(0, 6);
  const titled = fallback.map((word) => word.length <= 3 && /[a-z]/.test(word) ? word.toUpperCase() : `${word.charAt(0).toUpperCase()}${word.slice(1)}`);
  while (titled.length && titled.length < 3) titled.push(titled.length === 1 ? 'Special' : 'Clause');
  return titled.join(' ').slice(0, 80) || 'Clause Review Required';
}

function materialTokens(value) {
  const text = normalizeClauseEquivalence(value);
  const jurisdictions = /\b(?:china|chinese|russia|russian|hong kong|singapore|england|english|united kingdom|uk|united states|usa|uae|united arab emirates|panama|malaysia|indonesia|philippines|japan|korea|taiwan|india|sri lanka|vietnam|thailand)\b/g;
  const standardsAndProducts = /\b(?:marpol(?:\s+annex\s+[ivx]+)?|bimco|cpc|formosa|petronas|pertamina|ioc|naftal|mops|iso\s*\d+(?::\d+)?|ss\s*\d+|tr\s*\d+|rmg\s*\d+|rmk\s*\d+|vlsfo|hsfo|ulsfo|ifo\s*\d+|mgo|lsmgo)\b/g;
  const moneyAndDeadlines = /(?:usd|eur|hkd|sgd|cny|jpy|gbp|\$|€|£)\s*[0-9][0-9,.]*|[0-9][0-9,.]*\s*(?:calendar\s+days?|business\s+days?|working\s+days?|days?|hours?|months?|years?|mt|pmt|%|percent|cents?|dollars?)/g;
  const allNumbers = /\b\d+(?:[.,]\d+)*\b/g;
  const contextualEntities = /\b(?:supplier|seller|buyer|port|terminal|refinery|product|grade|standard|specification|jurisdiction|governed by|laws? of)\s+(?:of\s+|at\s+|in\s+|the\s+)?([a-z][a-z0-9&.'/-]*(?:\s+[a-z][a-z0-9&.'/-]*){0,3})/g;
  const tokens = new Set([
    ...(text.match(moneyAndDeadlines) || []).map((token) => `quantifier:${token}`),
    ...(text.match(allNumbers) || []).map((token) => `number:${token}`),
    ...(text.match(standardsAndProducts) || []).map((token) => `standard:${token}`),
    ...(text.match(jurisdictions) || []).map((token) => `jurisdiction:${token}`),
  ]);
  for (const match of text.matchAll(contextualEntities)) tokens.add(`entity:${match[0]}`);
  return tokens;
}

export function hasMaterialDifference(left, right) {
  const a = materialTokens(left);
  const b = materialTokens(right);
  if (a.size !== b.size) return true;
  for (const token of a) if (!b.has(token)) return true;
  return false;
}

function similarityTokens(value) {
  return new Set((normalizeClauseEquivalence(value).match(/[a-z0-9]+(?:'[a-z]+)?/g) || []).filter((word) => !STOP_WORDS.has(word)));
}

export function clauseSimilarity(left, right) {
  const a = similarityTokens(left);
  const b = similarityTokens(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

export const specialTermClauseModelInternals = Object.freeze({ MANUAL_REVIEW_TERMS, OUTER_NUMBER, TOP_LEVEL_HYPHEN });
