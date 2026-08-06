import { Parser } from 'htmlparser2';
import { jsPDF } from 'jspdf';

const PAGE = Object.freeze({ left: 14, right: 196, bottom: 281, width: 182 });

function text(value) {
  return String(value ?? '').trim();
}

function plainRichText(value) {
  let output = '';
  const parser = new Parser({
    onopentag(name) {
      if (['br', 'p', 'li', 'h3', 'h4', 'blockquote'].includes(name) && output && !output.endsWith('\n')) output += '\n';
      if (name === 'li') output += '- ';
    },
    ontext(valueText) {
      output += valueText;
    },
    onclosetag(name) {
      if (['p', 'li', 'h3', 'h4', 'blockquote'].includes(name) && !output.endsWith('\n')) output += '\n';
    },
  }, { decodeEntities: true, lowerCaseTags: true });
  parser.write(text(value));
  parser.end();
  return output
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function searchTerm(term, query) {
  if (!query) return true;
  return [term.name, term.termsText, plainRichText(term.confirmationRemark), plainRichText(term.nominationRemark)]
    .some((value) => text(value).toLowerCase().includes(query));
}

function ruleConditions(rule) {
  return [
    rule.accountName ? `${rule.accountName}${rule.accountClKey ? ` - ${rule.accountClKey}` : ''}` : null,
    rule.portName ? `${rule.portName}${rule.portCountry ? ` - ${rule.portCountry}` : ''}` : null,
    rule.productName || null,
    rule.country || null,
  ].filter(Boolean);
}

function searchRule(rule, query) {
  if (!query) return true;
  return [rule.name, rule.specialTermName, rule.audience, ...ruleConditions(rule)]
    .some((value) => text(value).toLowerCase().includes(query));
}

export function filterSpecialTermsExport(workspace, { view = 'terms', search = '' } = {}) {
  const normalizedView = view === 'rules' ? 'rules' : 'terms';
  const query = text(search).slice(0, 200).toLowerCase();
  const terms = Array.isArray(workspace?.terms) ? workspace.terms : [];
  const rules = Array.isArray(workspace?.rules) ? workspace.rules : [];

  if (normalizedView === 'rules') {
    const selectedRules = rules.filter((rule) => searchRule(rule, query));
    const termIds = new Set(selectedRules.map((rule) => rule.specialTermId));
    return {
      view: normalizedView,
      search: text(search).slice(0, 200),
      terms: terms.filter((term) => termIds.has(term.id)),
      rules: selectedRules,
    };
  }

  const selectedTerms = terms.filter((term) => searchTerm(term, query));
  const termIds = new Set(selectedTerms.map((term) => term.id));
  return {
    view: normalizedView,
    search: text(search).slice(0, 200),
    terms: selectedTerms,
    rules: rules.filter((rule) => termIds.has(rule.specialTermId)),
  };
}

function hongKongDateToken(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date).replaceAll('-', '');
}

function hongKongDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return text(value) || 'Not recorded';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function addPage(doc) {
  doc.addPage();
  return 18;
}

function ensurePage(doc, y, required = 16) {
  return y + required <= PAGE.bottom ? y : addPage(doc);
}

function wrappedLines(doc, value, width, fallback = 'Not set') {
  return doc.splitTextToSize(text(value) || fallback, width);
}

function drawWrapped(doc, value, x, y, width, options = {}) {
  const lines = wrappedLines(doc, value, width, options.fallback);
  const lineHeight = options.lineHeight || 4.2;
  let cursor = y;
  for (const line of lines) {
    cursor = ensurePage(doc, cursor, lineHeight + 2);
    doc.text(line, x, cursor);
    cursor += lineHeight;
  }
  return cursor;
}

function drawTermHeader(doc, name, y) {
  const lines = wrappedLines(doc, name, PAGE.width - 8, 'Unnamed Special Term').slice(0, 2);
  const height = 6 + lines.length * 4.5;
  y = ensurePage(doc, y, height + 5);
  doc.setFillColor(234, 242, 248);
  doc.rect(PAGE.left, y, PAGE.width, height, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(15, 55, 88);
  doc.text(lines, PAGE.left + 4, y + 6.5);
  return y + height + 5;
}

function drawLabelValue(doc, label, value, y, options = {}) {
  y = ensurePage(doc, y, 12);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text(label.toUpperCase(), PAGE.left + 2, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(31, 41, 55);
  return drawWrapped(doc, value, PAGE.left + 2, y + 5, PAGE.width - 4, options) + 2;
}

function drawRuleContinuation(doc, termName, y) {
  const lines = wrappedLines(doc, `${termName || 'Special Term'} - Rules continued`, PAGE.width - 8).slice(0, 2);
  const height = 5 + lines.length * 4;
  doc.setFillColor(234, 242, 248);
  doc.rect(PAGE.left, y, PAGE.width, height, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 55, 88);
  doc.text(lines, PAGE.left + 4, y + 5.5);
  return y + height + 5;
}

function drawRules(doc, rules, y, termName) {
  y = ensurePage(doc, y, 15);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 55, 88);
  doc.text(`LINKED RULES (${rules.length})`, PAGE.left + 2, y);
  y += 5;
  if (!rules.length) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text('No rules in this report scope.', PAGE.left + 2, y);
    return y + 8;
  }

  for (const rule of rules) {
    const conditions = ruleConditions(rule).join(' + ') || 'No condition';
    const detail = `${rule.audience || 'Audience not set'} | ${conditions} | Priority ${rule.priority ?? 'pending'}`;
    const detailLines = wrappedLines(doc, detail, PAGE.width - 12);
    const height = Math.max(10, 5 + detailLines.length * 3.8);
    if (y + height + 2 > PAGE.bottom) {
      y = addPage(doc);
      y = drawRuleContinuation(doc, termName, y);
    }
    doc.setFillColor(249, 250, 251);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(PAGE.left + 2, y, PAGE.width - 4, height, 1.5, 1.5, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(31, 41, 55);
    doc.text(text(rule.name) || 'Unnamed rule', PAGE.left + 6, y + 4.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(71, 85, 105);
    doc.text(detailLines, PAGE.left + 6, y + 8.5);
    y += height + 2;
  }
  return y + 2;
}

function decoratePages(doc, report, workspace, actorName, generatedAt) {
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    if (page > 1) {
      doc.setDrawColor(15, 55, 88);
      doc.setLineWidth(0.4);
      doc.line(PAGE.left, 10, PAGE.right, 10);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(15, 55, 88);
      doc.text('FCOS SPECIAL TERMS REGISTER', PAGE.left, 8);
    }
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.2);
    doc.line(PAGE.left, 285, PAGE.right, 285);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.7);
    doc.setTextColor(100, 116, 139);
    doc.text(`Salesforce source ${hongKongDateTime(workspace?.fetchedAt)} | Generated by ${text(actorName) || 'FCOS user'}`, PAGE.left, 290);
    doc.text(`${page} / ${pageCount}`, PAGE.right, 290, { align: 'right' });
  }
  void report;
  void generatedAt;
}

export function generateSpecialTermsPdf(workspace, options = {}) {
  const generatedAt = options.generatedAt instanceof Date ? options.generatedAt : new Date(options.generatedAt || Date.now());
  const report = filterSpecialTermsExport(workspace, options);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });

  doc.setFillColor(15, 55, 88);
  doc.rect(0, 0, 210, 39, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19);
  doc.text('Special Terms Register', PAGE.left, 15);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`${report.view === 'rules' ? 'Rules' : 'Terms'} view | ${report.terms.length} terms | ${report.rules.length} rules`, PAGE.left, 24);
  doc.setFontSize(7.5);
  doc.text(`Generated ${hongKongDateTime(generatedAt)}${report.search ? ` | Filter: ${report.search}` : ' | Complete current view'}`, PAGE.left, 32);

  let y = 48;
  if (!report.terms.length) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(71, 85, 105);
    doc.text('No Special Terms match the current report filter.', PAGE.left, y);
  }

  for (const term of report.terms) {
    y = drawTermHeader(doc, term.name, y);
    y = drawLabelValue(doc, 'Terms text', term.termsText, y);
    const confirmation = `${term.addToConfirmation ? 'Attach PDF' : 'Not attached'}${plainRichText(term.confirmationRemark) ? `\n${plainRichText(term.confirmationRemark)}` : ''}`;
    const nomination = `${term.addToNomination ? 'Attach PDF' : 'Not attached'}${plainRichText(term.nominationRemark) ? `\n${plainRichText(term.nominationRemark)}` : ''}`;
    y = drawLabelValue(doc, 'Confirmation', confirmation, y);
    y = drawLabelValue(doc, 'Nomination', nomination, y);
    const linkedRules = report.rules.filter((rule) => rule.specialTermId === term.id);
    y = drawRules(doc, linkedRules, y, term.name);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.7);
    doc.setTextColor(100, 116, 139);
    y = ensurePage(doc, y, 7);
    doc.text(`Last modified ${hongKongDateTime(term.lastModifiedAt)}`, PAGE.left + 2, y);
    y += 10;
  }

  decoratePages(doc, report, workspace, options.actorName, generatedAt);
  return {
    buffer: Buffer.from(doc.output('arraybuffer')),
    contentType: 'application/pdf',
    filename: `${hongKongDateToken(generatedAt)} Special Terms.pdf`,
    termCount: report.terms.length,
    ruleCount: report.rules.length,
    view: report.view,
  };
}

export const specialTermsExportInternals = { plainRichText, ruleConditions };
