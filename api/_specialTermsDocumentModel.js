import { readFileSync } from 'node:fs';
import { Document, Footer, Header, ImageRun, LevelFormat, LevelSuffix, Packer, PageNumber, Paragraph, TextRun, AlignmentType } from 'docx';
import { Parser } from 'htmlparser2';
import { jsPDF } from 'jspdf';
import { SPECIAL_TERMS_DOCUMENT_TOKENS } from '../src/lib/specialTermsDocumentTokens.js';

/**
 * The document token map is deliberately shared by the web preview, PDF, and
 * DOCX renderers.  Do not put customer wording in this module: it is only the
 * deterministic presentation layer for Salesforce-authoritative text.
 */
export { SPECIAL_TERMS_DOCUMENT_TOKENS };

const BRAND_BLUE = [0, 65, 123];
const BODY_INK = [28, 35, 42];
const PAGE = Object.freeze({
  width: SPECIAL_TERMS_DOCUMENT_TOKENS.page.widthMm,
  height: SPECIAL_TERMS_DOCUMENT_TOKENS.page.heightMm,
  left: SPECIAL_TERMS_DOCUMENT_TOKENS.page.leftMm,
  right: SPECIAL_TERMS_DOCUMENT_TOKENS.page.widthMm - SPECIAL_TERMS_DOCUMENT_TOKENS.page.rightMm,
  contentStart: SPECIAL_TERMS_DOCUMENT_TOKENS.page.contentStartMm,
  bodyBottom: 276,
  footerRule: SPECIAL_TERMS_DOCUMENT_TOKENS.page.footerRuleMm,
  footerText: SPECIAL_TERMS_DOCUMENT_TOKENS.page.footerTextMm,
});
const MM_TO_TWIP = 56.6929133858;
const mmToTwip = (value) => Math.round(value * MM_TO_TWIP);
const DOCX_BODY_LINE_TWIP = Math.round(SPECIAL_TERMS_DOCUMENT_TOKENS.typography.bodyPt * SPECIAL_TERMS_DOCUMENT_TOKENS.typography.lineMultiplier * 20);
const DOCX_BODY_HALF_POINTS = Math.round(SPECIAL_TERMS_DOCUMENT_TOKENS.typography.bodyPt * 2);
const LOGO = (() => {
  try { return readFileSync(new URL('./assets/hedge-letterhead-logo.jpg', import.meta.url)); } catch { return null; }
})();

function clean(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();
}

function richTextToPlainText(value) {
  const source = String(value ?? '');
  if (!/<\/?[a-z][\s\S]*>/i.test(source)) return source;
  let output = '';
  const parser = new Parser({
    onopentag(name) {
      if (name === 'br') output += '\n';
      if (name === 'li' && output && !output.endsWith('\n')) output += '\n';
      if (name === 'li') output += '- ';
    },
    ontext(text) { output += text; },
    onclosetag(name) {
      if (name === 'li') output += '\n';
      else if (['p', 'div', 'h1', 'h2', 'h3', 'h4', 'blockquote'].includes(name)) output += '\n\n';
    },
  }, { decodeEntities: true, lowerCaseTags: true });
  parser.write(source);
  parser.end();
  return output;
}

export function normalizeTermsText(value) {
  return clean(richTextToPlainText(value))
    .replace(/\u00a0/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
}

export function hongKongDateToken(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date).replaceAll('-', '');
}

export function safeFilenamePart(value) {
  return clean(value).replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').replace(/[. ]+$/g, '').slice(0, 120) || 'Special Term';
}

export function duplicateSuffix(value) {
  const index = Number(value);
  return Number.isInteger(index) && index > 0 && index <= 999 ? `-${index}` : '';
}

/** Parse only plainly sequential outer numbering. Everything else is left as
 * exact legacy text, so exports can never invent contractual clause boundaries. */
export function safelyParseLegacyNumbering(value) {
  const source = normalizeTermsText(value);
  if (!source) return { kind: 'empty', clauses: [], text: '' };
  const lines = source.split('\n');
  const clauses = [];
  let current = null;
  let expected = 1;
  let sawMarker = false;
  for (const line of lines) {
    const match = line.match(/^\s*(\d+)\.\s+(.+)$/);
    if (match) {
      const number = Number(match[1]);
      if (number !== expected) return { kind: 'raw', clauses: [], text: source };
      if (current) clauses.push(current.trim());
      current = match[2];
      expected += 1;
      sawMarker = true;
    } else if (current !== null) {
      current += `\n${line}`;
    } else if (line.trim()) {
      return { kind: 'raw', clauses: [], text: source };
    }
  }
  if (current) clauses.push(current.trim());
  return sawMarker && clauses.length ? { kind: 'numbered', clauses, text: source } : { kind: 'raw', clauses: [], text: source };
}

function paragraphsForClause(text) {
  const groups = normalizeTermsText(text).split(/\n{2,}/).filter(Boolean);
  const paragraphs = [];
  for (const group of groups) {
    let prose = [];
    const flushProse = () => {
      if (prose.length) paragraphs.push({ text: prose.join('\n'), nested: false });
      prose = [];
    };
    for (const line of group.split('\n')) {
      if (/^\s*[-\u2022\u2013\u2014]\s+/.test(line)) {
        flushProse();
        paragraphs.push({ text: line.replace(/^\s*[-\u2022\u2013\u2014]\s+/, ''), nested: true });
      } else prose.push(line);
    }
    flushProse();
  }
  return paragraphs;
}

export function buildSpecialTermsDocumentModel(term, { source = 'live', generatedAt = new Date(), duplicateIndex = 0 } = {}) {
  const name = clean(term?.name) || 'Special Term';
  const sourceText = normalizeTermsText(term?.termsText);
  const structuredClauses = Array.isArray(term?.clauses) ? term.clauses.map((item) => normalizeTermsText(item?.text ?? item?.clauseText ?? item)).filter(Boolean) : [];
  const parsed = structuredClauses.length ? { kind: 'numbered', clauses: structuredClauses, text: sourceText } : safelyParseLegacyNumbering(sourceText);
  const mode = source === 'draft' ? 'draft' : 'live';
  const pageBody = parsed.kind === 'numbered'
    ? parsed.clauses.map((clause) => ({ type: 'clause', paragraphs: paragraphsForClause(clause) }))
    : sourceText ? [{ type: 'raw', paragraphs: sourceText.split(/\n{2,}/).filter(Boolean).map((text) => ({ text, nested: false })) }] : [];
  return Object.freeze({
    name,
    source: mode,
    isDraft: mode === 'draft',
    isStructured: structuredClauses.length > 0,
    legacyNumberingDetected: !structuredClauses.length && parsed.kind === 'numbered',
    termsText: sourceText,
    clauses: parsed.clauses,
    body: pageBody,
    generatedAt: generatedAt instanceof Date ? generatedAt : new Date(generatedAt || Date.now()),
    filenameStem: `${hongKongDateToken(generatedAt instanceof Date ? generatedAt : new Date(generatedAt || Date.now()))} ${safeFilenamePart(name)}${duplicateSuffix(duplicateIndex)}`,
  });
}

function pdfLetterhead(doc) {
  if (LOGO) doc.addImage(LOGO, 'JPEG', (PAGE.width - SPECIAL_TERMS_DOCUMENT_TOKENS.logo.widthMm) / 2, 10, SPECIAL_TERMS_DOCUMENT_TOKENS.logo.widthMm, SPECIAL_TERMS_DOCUMENT_TOKENS.logo.heightMm);
  doc.setTextColor(...BRAND_BLUE); doc.setDrawColor(...BRAND_BLUE); doc.setLineWidth(0.25);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(SPECIAL_TERMS_DOCUMENT_TOKENS.typography.companyPt);
  doc.text('FRATELLI COSULICH BUNKERS (HK) LTD', PAGE.width / 2, 40.2, { align: 'center' });
  doc.line(PAGE.left, 44.3, PAGE.right, 44.3);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(SPECIAL_TERMS_DOCUMENT_TOKENS.typography.detailsPt);
  doc.text('UNITS 02-03, 23/F, PLAZA 228, 228 WAN CHAI ROAD, HONG KONG    T +852-25299138    GENERAL@COSULICH.COM.HK', PAGE.width / 2, 47.2, { align: 'center' });
  doc.line(PAGE.left, 49, PAGE.right, 49);
}

function pdfHeading(doc, model) {
  doc.setTextColor(...BRAND_BLUE); doc.setFont('helvetica', 'bold'); doc.setFontSize(SPECIAL_TERMS_DOCUMENT_TOKENS.typography.sectionLabelPt);
  doc.text('SPECIAL TERMS', PAGE.left, 54);
  doc.setFontSize(SPECIAL_TERMS_DOCUMENT_TOKENS.typography.titlePt);
  const titleLines = doc.splitTextToSize(model.name, PAGE.right - PAGE.left);
  let y = 60;
  for (const line of titleLines) { doc.text(line, PAGE.left, y); y += 6.2; }
  doc.setDrawColor(...BRAND_BLUE); doc.setLineWidth(0.25); doc.line(PAGE.left, y - 2.6, PAGE.right, y - 2.6);
  return Math.max(PAGE.contentStart, y + 2);
}

function pdfContentStart(doc, model) {
  doc.setFont('helvetica', 'bold'); doc.setFontSize(SPECIAL_TERMS_DOCUMENT_TOKENS.typography.titlePt);
  const titleLines = doc.splitTextToSize(model.name, PAGE.right - PAGE.left);
  return Math.max(PAGE.contentStart, 60 + titleLines.length * 6.2 + 2);
}

function pdfDrawDraftWatermark(doc) {
  doc.setTextColor(183, 189, 197); doc.setFont('helvetica', 'bold'); doc.setFontSize(40);
  doc.text('DRAFT', PAGE.width / 2, PAGE.height / 2, { align: 'center', angle: 45 });
}

function pdfDecorate(doc, model) {
  const count = doc.getNumberOfPages();
  for (let index = 1; index <= count; index += 1) {
    doc.setPage(index);
    if (model.isDraft) pdfDrawDraftWatermark(doc);
    pdfLetterhead(doc); pdfHeading(doc, model);
    doc.setDrawColor(...BRAND_BLUE); doc.setLineWidth(0.2); doc.line(PAGE.left, PAGE.footerRule, PAGE.right, PAGE.footerRule);
    doc.setTextColor(...BRAND_BLUE); doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
    doc.text(`Page ${index} of ${count}`, PAGE.right, PAGE.footerText, { align: 'right' });
  }
}

function pdfTextLines(doc, text, width) {
  return doc.splitTextToSize(text, width);
}

function pdfRenderBody(doc, model) {
  let y = pdfContentStart(doc, model);
  const applyBodyStyle = () => {
    doc.setTextColor(...BODY_INK);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(SPECIAL_TERMS_DOCUMENT_TOKENS.typography.bodyPt);
  };
  const newPage = () => {
    doc.addPage();
    y = pdfContentStart(doc, model);
    applyBodyStyle();
  };
  // Typographic points converted to millimetres; the shared token is also
  // used by the DOCX and browser preview.
  const lineHeight = SPECIAL_TERMS_DOCUMENT_TOKENS.typography.bodyPt * SPECIAL_TERMS_DOCUMENT_TOKENS.typography.lineMultiplier * 0.352778;
  const clauseGap = SPECIAL_TERMS_DOCUMENT_TOKENS.typography.clauseAfterPt * 0.352778;
  applyBodyStyle();
  for (let i = 0; i < model.body.length; i += 1) {
    const item = model.body[i];
    const marker = item.type === 'clause' ? `${i + 1}.` : '';
    for (let paragraphIndex = 0; paragraphIndex < item.paragraphs.length; paragraphIndex += 1) {
      const paragraph = item.paragraphs[paragraphIndex];
      const nested = paragraph.nested;
      const raw = nested ? paragraph.text.replace(/^\s*[-\u2022\u2013\u2014]\s+/, '') : paragraph.text;
      const indent = nested ? SPECIAL_TERMS_DOCUMENT_TOKENS.list.nestedTextIndentMm : marker ? SPECIAL_TERMS_DOCUMENT_TOKENS.list.textIndentMm : 0;
      const lines = raw.split('\n').flatMap((hardLine) => pdfTextLines(doc, hardLine || ' ', PAGE.right - PAGE.left - indent));
      const shortClauseHeight = lines.length <= 8 ? lines.length * lineHeight : Math.min(lines.length, 2) * lineHeight;
      const minimumBlock = shortClauseHeight + (item.type === 'clause' ? clauseGap : 0);
      if (y + minimumBlock > PAGE.bodyBottom) newPage();
      if (marker && paragraphIndex === 0) doc.text(marker, PAGE.left + SPECIAL_TERMS_DOCUMENT_TOKENS.list.markerRightMm, y, { align: 'right' });
      if (nested) doc.text('-', PAGE.left + SPECIAL_TERMS_DOCUMENT_TOKENS.list.nestedMarkerRightMm, y, { align: 'right' });
      lines.forEach((line) => {
        if (y + lineHeight > PAGE.bodyBottom) newPage();
        doc.text(line, PAGE.left + indent, y); y += lineHeight;
      });
      if (paragraphIndex < item.paragraphs.length - 1) y += 2.2;
    }
    if (item.type === 'clause') y += clauseGap;
    else y += 2.2;
  }
}

export function generateSpecialTermsPdfFromModel(model) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  pdfRenderBody(doc, model); pdfDecorate(doc, model);
  return { buffer: Buffer.from(doc.output('arraybuffer')), contentType: 'application/pdf', filename: `${model.filenameStem}.pdf`, termName: model.name, pageCount: doc.getNumberOfPages(), source: model.source };
}

function docxHeader(model) {
  const children = [];
  if (LOGO) children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0, line: 200 }, children: [new ImageRun({ data: LOGO, transformation: { width: 242, height: 84 }, type: 'jpg' })] }));
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0, line: 180 }, border: { bottom: { color: SPECIAL_TERMS_DOCUMENT_TOKENS.colour.brandBlue, space: 1, style: 'single', size: 6 } }, children: [new TextRun({ text: 'FRATELLI COSULICH BUNKERS (HK) LTD', font: 'Arial', size: 20, bold: true, color: SPECIAL_TERMS_DOCUMENT_TOKENS.colour.brandBlue })] }));
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0, line: 150 }, border: { bottom: { color: SPECIAL_TERMS_DOCUMENT_TOKENS.colour.brandBlue, space: 1, style: 'single', size: 6 } }, children: [new TextRun({ text: 'UNITS 02-03, 23/F, PLAZA 228, 228 WAN CHAI ROAD, HONG KONG    T +852-25299138    GENERAL@COSULICH.COM.HK', font: 'Arial', size: 13, color: SPECIAL_TERMS_DOCUMENT_TOKENS.colour.brandBlue })] }));
  // Reserve the complete 10–49 mm letterhead band before the repeated term
  // heading. LibreOffice and Word both honour paragraph spacing here, whereas
  // empty header paragraphs collapse differently between the two renderers.
  children.push(new Paragraph({ spacing: { before: 700, after: 0, line: 160 }, children: [new TextRun({ text: 'SPECIAL TERMS', font: 'Arial', size: 17, bold: true, color: SPECIAL_TERMS_DOCUMENT_TOKENS.colour.brandBlue })] }));
  children.push(new Paragraph({ spacing: { before: 0, after: 0, line: 260 }, border: { bottom: { color: SPECIAL_TERMS_DOCUMENT_TOKENS.colour.brandBlue, space: 1, style: 'single', size: 6 } }, children: [new TextRun({ text: model.name, font: 'Arial', size: 28, bold: true, color: SPECIAL_TERMS_DOCUMENT_TOKENS.colour.brandBlue })] }));
  return new Header({ children });
}

function docxBodyTopMm(model) {
  const titleLines = Math.max(1, Math.ceil(clean(model?.name).length / 68));
  return 61 + Math.max(0, titleLines - 1) * 6.2;
}

function docxFooter() {
  return new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, border: { top: { color: SPECIAL_TERMS_DOCUMENT_TOKENS.colour.brandBlue, space: 1, style: 'single', size: 4 } }, children: [new TextRun({ text: 'Page ', font: 'Arial', size: 14, color: SPECIAL_TERMS_DOCUMENT_TOKENS.colour.brandBlue }), new TextRun({ children: [PageNumber.CURRENT], font: 'Arial', size: 14, color: SPECIAL_TERMS_DOCUMENT_TOKENS.colour.brandBlue }), new TextRun({ text: ' of ', font: 'Arial', size: 14, color: SPECIAL_TERMS_DOCUMENT_TOKENS.colour.brandBlue }), new TextRun({ children: [PageNumber.TOTAL_PAGES], font: 'Arial', size: 14, color: SPECIAL_TERMS_DOCUMENT_TOKENS.colour.brandBlue })] })] });
}

function docxTextRuns(value) {
  const lines = String(value ?? '').split('\n');
  return lines.flatMap((line, index) => [
    ...(index ? [new TextRun({ break: 1 })] : []),
    new TextRun({ text: line, font: 'Arial', size: DOCX_BODY_HALF_POINTS, color: SPECIAL_TERMS_DOCUMENT_TOKENS.colour.bodyInk }),
  ]);
}

function docxBody(model) {
  const children = [];
  for (const item of model.body) {
    for (let p = 0; p < item.paragraphs.length; p += 1) {
      const paragraph = item.paragraphs[p];
      const paragraphAfter = item.type === 'clause' && p === item.paragraphs.length - 1
        ? Math.round(SPECIAL_TERMS_DOCUMENT_TOKENS.typography.clauseAfterPt * 20)
        : 50;
      if (paragraph.nested) {
        children.push(new Paragraph({ numbering: { reference: 'special-terms-bullet', level: 0 }, keepLines: true, spacing: { after: paragraphAfter, line: DOCX_BODY_LINE_TWIP }, children: docxTextRuns(paragraph.text) }));
      } else if (item.type === 'clause' && p === 0) {
        children.push(new Paragraph({ numbering: { reference: 'special-terms-top', level: 0 }, keepLines: true, spacing: { after: paragraphAfter, line: DOCX_BODY_LINE_TWIP }, children: docxTextRuns(paragraph.text) }));
      } else {
        children.push(new Paragraph({ indent: item.type === 'clause' ? { left: mmToTwip(SPECIAL_TERMS_DOCUMENT_TOKENS.list.textIndentMm) } : undefined, spacing: { after: paragraphAfter, line: DOCX_BODY_LINE_TWIP }, children: docxTextRuns(paragraph.text) }));
      }
    }
  }
  return children;
}

export async function generateSpecialTermsDocxFromModel(model) {
  const doc = new Document({
    creator: 'FCOS', title: `Special Terms - ${model.name}`, subject: 'Special Terms',
    numbering: { config: [
      { reference: 'special-terms-top', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.RIGHT, suffix: LevelSuffix.TAB, style: { run: { font: 'Arial', size: DOCX_BODY_HALF_POINTS, color: SPECIAL_TERMS_DOCUMENT_TOKENS.colour.bodyInk }, paragraph: { leftTabStop: mmToTwip(SPECIAL_TERMS_DOCUMENT_TOKENS.list.textIndentMm), indent: { left: mmToTwip(SPECIAL_TERMS_DOCUMENT_TOKENS.list.textIndentMm), hanging: mmToTwip(SPECIAL_TERMS_DOCUMENT_TOKENS.list.textIndentMm - SPECIAL_TERMS_DOCUMENT_TOKENS.list.markerRightMm) }, spacing: { line: DOCX_BODY_LINE_TWIP, after: Math.round(SPECIAL_TERMS_DOCUMENT_TOKENS.typography.clauseAfterPt * 20) }, keepLines: true } } }] },
      { reference: 'special-terms-bullet', levels: [{ level: 0, format: LevelFormat.BULLET, text: '-', alignment: AlignmentType.RIGHT, suffix: LevelSuffix.TAB, style: { run: { font: 'Arial', size: DOCX_BODY_HALF_POINTS, color: SPECIAL_TERMS_DOCUMENT_TOKENS.colour.bodyInk }, paragraph: { leftTabStop: mmToTwip(SPECIAL_TERMS_DOCUMENT_TOKENS.list.nestedTextIndentMm), indent: { left: mmToTwip(SPECIAL_TERMS_DOCUMENT_TOKENS.list.nestedTextIndentMm), hanging: mmToTwip(SPECIAL_TERMS_DOCUMENT_TOKENS.list.nestedTextIndentMm - SPECIAL_TERMS_DOCUMENT_TOKENS.list.nestedMarkerRightMm) }, spacing: { line: DOCX_BODY_LINE_TWIP, after: 50 }, keepLines: true } } }] },
    ] },
    sections: [{
      properties: {
        page: {
          size: { width: mmToTwip(210), height: mmToTwip(297) },
          margin: { top: mmToTwip(docxBodyTopMm(model)), right: mmToTwip(22), bottom: mmToTwip(17), left: mmToTwip(22), header: mmToTwip(10), footer: mmToTwip(8) },
        },
      },
      headers: { default: docxHeader(model) },
      footers: { default: docxFooter() },
      children: docxBody(model),
    }],
  });
  const buffer = Buffer.from(await Packer.toBuffer(doc));
  return { buffer, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filename: `${model.filenameStem}.docx`, termName: model.name, source: model.source };
}

export const specialTermsDocumentInternals = { clean, richTextToPlainText, paragraphsForClause, safelyParseLegacyNumbering, docxBodyTopMm, DOCX_BODY_LINE_TWIP, DOCX_BODY_HALF_POINTS };
