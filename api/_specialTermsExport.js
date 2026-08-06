import { readFileSync } from 'node:fs';
import { jsPDF } from 'jspdf';

const PAGE = Object.freeze({
  width: 210,
  height: 297,
  left: 16,
  right: 194,
  bodyBottom: 278,
  footerRule: 281,
  footerText: 286,
});
const BRAND_BLUE = Object.freeze([0, 65, 123]);
const BODY_INK = Object.freeze([28, 35, 42]);
const LOGO_DATA_URL = (() => {
  try {
    return `data:image/jpeg;base64,${readFileSync(new URL('./assets/hedge-letterhead-logo.jpg', import.meta.url)).toString('base64')}`;
  } catch {
    return null;
  }
})();

function text(value) {
  return String(value ?? '').trim();
}

function hongKongDateToken(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date).replaceAll('-', '');
}

function safeFilenamePart(value) {
  return text(value)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .slice(0, 120) || 'Special Term';
}

function duplicateSuffix(value) {
  const index = Number(value);
  return Number.isInteger(index) && index > 0 && index <= 999 ? `-${index}` : '';
}

function normalizeTermsText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

function drawLetterhead(doc) {
  if (LOGO_DATA_URL) doc.addImage(LOGO_DATA_URL, 'JPEG', 74, 12, 62, 24);
  doc.setTextColor(...BRAND_BLUE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('FRATELLI COSULICH BUNKERS (HK) LTD', PAGE.width / 2, 41, { align: 'center' });
  doc.setDrawColor(...BRAND_BLUE);
  doc.setLineWidth(0.25);
  doc.line(PAGE.left, 45, PAGE.right, 45);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.2);
  doc.text(
    'UNITS 02-03, 23/F, PLAZA 228, 228 WAN CHAI ROAD, HONG KONG    T +852-25299138    GENERAL@COSULICH.COM.HK',
    PAGE.width / 2,
    47.4,
    { align: 'center' },
  );
  doc.line(PAGE.left, 48, PAGE.right, 48);
}

function drawTermHeading(doc, termName) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  const heading = doc.splitTextToSize(text(termName) || 'Special Term', PAGE.right - PAGE.left);
  doc.setTextColor(...BRAND_BLUE);
  let y = 59;
  for (const line of heading) {
    doc.text(line, PAGE.left, y);
    y += 5.7;
  }
  doc.setDrawColor(...BRAND_BLUE);
  doc.setLineWidth(0.25);
  doc.line(PAGE.left, y - 1.5, PAGE.right, y - 1.5);
  return y + 4;
}

function startPage(doc, termName, add = false) {
  if (add) doc.addPage();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  const heading = doc.splitTextToSize(text(termName) || 'Special Term', PAGE.right - PAGE.left);
  return 59 + heading.length * 5.7 + 4;
}

function drawTermsText(doc, termName, value) {
  const termsText = normalizeTermsText(value);
  let y = startPage(doc, termName);
  doc.setTextColor(...BODY_INK);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  const lineHeight = 5;
  const blankLineHeight = 4;
  const paragraphs = termsText ? termsText.split('\n') : [''];

  for (const paragraph of paragraphs) {
    if (!paragraph) {
      if (y + blankLineHeight > PAGE.bodyBottom) y = startPage(doc, termName, true);
      else y += blankLineHeight;
      doc.setTextColor(...BODY_INK);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10.5);
      continue;
    }
    const lines = doc.splitTextToSize(paragraph, PAGE.right - PAGE.left);
    for (const line of lines) {
      if (y + lineHeight > PAGE.bodyBottom) y = startPage(doc, termName, true);
      doc.setTextColor(...BODY_INK);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10.5);
      doc.text(line, PAGE.left, y);
      y += lineHeight;
    }
  }
}

function decoratePages(doc, termName) {
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    drawLetterhead(doc);
    drawTermHeading(doc, termName);
    doc.setDrawColor(...BRAND_BLUE);
    doc.setLineWidth(0.2);
    doc.line(PAGE.left, PAGE.footerRule, PAGE.right, PAGE.footerRule);
    doc.setTextColor(...BRAND_BLUE);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(`Page ${page} of ${pageCount}`, PAGE.right, PAGE.footerText, { align: 'right' });
  }
}

export function generateSpecialTermPdf(term, options = {}) {
  const generatedAt = options.generatedAt instanceof Date ? options.generatedAt : new Date(options.generatedAt || Date.now());
  const name = text(term?.name) || 'Special Term';
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  drawTermsText(doc, name, term?.termsText);
  decoratePages(doc, name);
  const suffix = duplicateSuffix(options.duplicateIndex);
  return {
    buffer: Buffer.from(doc.output('arraybuffer')),
    contentType: 'application/pdf',
    filename: `${hongKongDateToken(generatedAt)} ${safeFilenamePart(name)}${suffix}.pdf`,
    termName: name,
    pageCount: doc.getNumberOfPages(),
  };
}

export const specialTermsExportInternals = {
  duplicateSuffix,
  normalizeTermsText,
  safeFilenamePart,
};
