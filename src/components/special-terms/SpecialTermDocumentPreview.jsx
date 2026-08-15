import { FileClock, FileText, Monitor } from 'lucide-react';
import { useMemo, useState } from 'react';
import letterheadLogo from '../../../api/assets/hedge-letterhead-logo.jpg';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { paginateDocumentText, specialTermDocumentModel } from '@/lib/specialTermDocumentPreview';
import { SPECIAL_TERMS_DOCUMENT_TOKENS } from '@/lib/specialTermsDocumentTokens';
import { exportReadiness } from '@/lib/specialTermsWorkflow';

const LETTERHEAD_CONTACT = 'UNITS 02-03, 23/F, PLAZA 228, 228 WAN CHAI ROAD, HONG KONG    T +852-25299138    GENERAL@COSULICH.COM.HK';
const PAGE = SPECIAL_TERMS_DOCUMENT_TOKENS.page;
const LOGO = SPECIAL_TERMS_DOCUMENT_TOKENS.logo;
const TYPE = SPECIAL_TERMS_DOCUMENT_TOKENS.typography;
const pagePercent = (millimetres, dimension) => `${(millimetres / dimension) * 100}%`;
const previewPointSize = (points) => `clamp(${Math.max(3, points * 0.4)}px, ${((points * 1.333) / 794) * 100}cqw, ${points * 1.333}px)`;

function PreviewPageBody({ pageText, nextPageText, numbered }) {
  const lines = String(pageText || '').split('\n');
  const paragraphs = [];
  let continuationIndentMm = numbered ? SPECIAL_TERMS_DOCUMENT_TOKENS.list.textIndentMm : 0;
  let current = null;
  let pendingSpace = false;
  const finishParagraph = () => {
    if (current) paragraphs.push({ ...current, text: current.lines.join(' ') });
    current = null;
  };
  lines.forEach((line) => {
    const numberedLine = line.match(/^\s*(\d+\.)\s+(.+)$/);
    const bulletLine = line.match(/^\s*[-\u2022\u2013\u2014]\s+(.+)$/);
    if (!line.trim()) {
      finishParagraph();
      pendingSpace = true;
      continuationIndentMm = numbered ? SPECIAL_TERMS_DOCUMENT_TOKENS.list.textIndentMm : 0;
      return;
    }
    if (numberedLine) {
      finishParagraph();
      continuationIndentMm = SPECIAL_TERMS_DOCUMENT_TOKENS.list.textIndentMm;
      current = { marker: numberedLine[1], markerRightMm: SPECIAL_TERMS_DOCUMENT_TOKENS.list.markerRightMm, markerGapMm: SPECIAL_TERMS_DOCUMENT_TOKENS.list.markerGapMm, indentMm: 0, lines: [numberedLine[2]], spaceBefore: pendingSpace };
      pendingSpace = false;
    } else if (bulletLine && numbered) {
      finishParagraph();
      continuationIndentMm = SPECIAL_TERMS_DOCUMENT_TOKENS.list.nestedTextIndentMm;
      current = { marker: '-', markerRightMm: SPECIAL_TERMS_DOCUMENT_TOKENS.list.nestedMarkerRightMm, markerGapMm: SPECIAL_TERMS_DOCUMENT_TOKENS.list.nestedTextIndentMm - SPECIAL_TERMS_DOCUMENT_TOKENS.list.nestedMarkerRightMm, indentMm: 0, lines: [bulletLine[1]], spaceBefore: pendingSpace };
      pendingSpace = false;
    } else if (current) {
      current.lines.push(line.trim());
    } else {
      current = { marker: null, markerRightMm: 0, markerGapMm: 0, indentMm: continuationIndentMm, lines: [line.trim()], spaceBefore: pendingSpace };
      pendingSpace = false;
    }
  });
  finishParagraph();
  const nextPageFirstLine = String(nextPageText || '').split('\n').find((line) => line.trim());
  const continuesOnNextPage = Boolean(nextPageFirstLine)
    && !/^\s*\d+\.\s+/.test(nextPageFirstLine)
    && !/^\s*[-\u2022\u2013\u2014]\s+/.test(nextPageFirstLine);
  return paragraphs.map((paragraph, index) => {
    const textAlignLast = index === paragraphs.length - 1 && continuesOnNextPage ? TYPE.bodyAlignment : TYPE.lastLineAlignment;
    const textStyle = { textAlign: TYPE.bodyAlignment, textAlignLast };
    if (paragraph.marker) {
      return <div key={`${paragraph.marker}-${index}`} className={`flex w-full ${paragraph.spaceBefore ? 'mt-[0.7em]' : ''}`}><span className="shrink-0 text-right tabular-nums" style={{ width: pagePercent(paragraph.markerRightMm, PAGE.widthMm) }}>{paragraph.marker}</span><span className="min-w-0 flex-1" style={{ marginLeft: pagePercent(paragraph.markerGapMm, PAGE.widthMm), ...textStyle }}>{paragraph.text}</span></div>;
    }
    return <div key={`paragraph-${index}`} className={`w-full ${paragraph.spaceBefore ? 'mt-[0.7em]' : ''}`} style={{ paddingLeft: pagePercent(paragraph.indentMm, PAGE.widthMm), ...textStyle }}>{paragraph.text}</div>;
  });
}

function DocumentSheet({ model, pageText, nextPageText, pageIndex, pageCount, zoom }) {
  return (
    <article
      className={`relative mx-auto aspect-[210/297] bg-white text-slate-950 shadow-sm ring-1 ring-slate-200 ${zoom === '100' ? 'w-[794px] max-w-none' : 'w-full max-w-[794px]'}`}
      style={{ containerType: 'inline-size', fontFamily: 'Arial, Helvetica, sans-serif', padding: `${pagePercent(PAGE.headerTopMm, PAGE.heightMm)} ${pagePercent(PAGE.leftMm, PAGE.widthMm)} ${pagePercent(PAGE.heightMm - PAGE.footerRuleMm, PAGE.heightMm)}` }}
      aria-label={`${model.isDraft ? 'Draft' : 'Live'} A4 document preview, page ${pageIndex + 1} of ${pageCount}`}
    >
      {model.isDraft ? <div className="pointer-events-none absolute left-1/2 top-1/2 z-0 -translate-x-1/2 -translate-y-1/2 -rotate-45 select-none text-7xl font-bold tracking-[0.25em] text-slate-200/70 sm:text-9xl">DRAFT</div> : null}
      <header className="relative text-center">
        <img src={letterheadLogo} alt="Fratelli Cosulich Bunkers (HK) Ltd" className="mx-auto object-contain" style={{ width: pagePercent(LOGO.widthMm, PAGE.widthMm), height: pagePercent(LOGO.heightMm, PAGE.heightMm) }} />
        <p className="mt-1 font-bold tracking-[0.04em]" style={{ fontSize: previewPointSize(TYPE.companyPt) }}>FRATELLI COSULICH BUNKERS (HK) LTD</p>
        <div className="mt-1.5 h-px bg-[#00417b]" />
        <p className="mt-1 whitespace-nowrap tracking-[-0.01em] text-slate-700" style={{ fontSize: previewPointSize(TYPE.detailsPt) }}>{LETTERHEAD_CONTACT}</p>
        <div className="mt-1 h-px bg-[#00417b]" />
      </header>
      <section className="relative" style={{ paddingTop: pagePercent(PAGE.contentStartMm - PAGE.headerBottomMm, PAGE.heightMm) }}>
        <h2 className="text-left font-bold uppercase tracking-[0.08em] text-[#00417b]" style={{ fontSize: previewPointSize(TYPE.sectionLabelPt) }}>Special Terms</h2>
        <h3 className="mt-2 text-left font-bold leading-[1.15] text-[#00417b]" style={{ fontSize: previewPointSize(TYPE.titlePt) }}>{model.title}</h3>
        <div className="mt-2 h-px bg-[#00417b]" />
        <div className="mt-4 whitespace-pre-wrap text-left" style={{ fontSize: previewPointSize(TYPE.bodyPt), lineHeight: TYPE.lineMultiplier }}>{pageText ? <PreviewPageBody pageText={pageText} nextPageText={nextPageText} numbered={/^\s*1\.\s+/m.test(model.termsText)} /> : 'No Terms Text clauses.'}</div>
      </section>
      <footer className="absolute border-t border-[#00417b] pt-1 text-right text-[#00417b]" style={{ bottom: pagePercent(PAGE.heightMm - PAGE.footerTextMm, PAGE.heightMm), left: pagePercent(PAGE.leftMm, PAGE.widthMm), right: pagePercent(PAGE.rightMm, PAGE.widthMm), fontSize: previewPointSize(7) }}>Page {pageIndex + 1} of {pageCount}</footer>
    </article>
  );
}

export default function SpecialTermDocumentPreview({ term, detail, revision, unsaved = false, onExport }) {
  const [mode, setMode] = useState(revision?.id || revision?.status === 'Draft' ? 'draft' : 'live');
  const [zoom, setZoom] = useState('fit');
  const model = useMemo(() => specialTermDocumentModel({ term, detail, revision, mode }), [detail, mode, revision, term]);
  const pages = useMemo(() => paginateDocumentText(model.termsText, { title: model.title }), [model.termsText, model.title]);
  const liveReadiness = useMemo(() => exportReadiness(term), [term]);
  const draftExportAllowed = Boolean(revision?.id) && !unsaved;
  return (
    <section className="min-w-0 space-y-3 rounded-lg border border-border bg-muted/20 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><div className="flex items-center gap-2"><FileText className="h-4 w-4 text-primary" /><strong className="text-sm">A4 document preview</strong><Badge variant={model.isDraft ? 'secondary' : 'default'}>{model.isDraft ? 'Draft preview' : 'Live document'}</Badge></div><p className="mt-1 text-xs text-muted-foreground">Rendered locally from Terms Text clause state. Clause edits never call an export service.</p></div>
        <div className="flex flex-wrap gap-1"><Button type="button" size="sm" variant={mode === 'live' ? 'default' : 'outline'} onClick={() => setMode('live')}><Monitor className="mr-1 h-3.5 w-3.5" />Live document</Button><Button type="button" size="sm" variant={mode === 'draft' ? 'default' : 'outline'} onClick={() => setMode('draft')} disabled={!revision}><FileClock className="mr-1 h-3.5 w-3.5" />Draft preview</Button></div>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background p-2">
        <Button type="button" size="sm" variant="outline" onClick={() => onExport?.('pdf', mode)} disabled={model.isDraft && !draftExportAllowed}>PDF</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => onExport?.('docx', mode)} disabled={model.isDraft}>Word</Button>
        {model.isDraft && unsaved ? <span className="text-xs text-amber-800">Save this revision before exporting its PDF.</span> : null}
        {mode === 'live' ? <span className="text-xs text-muted-foreground">Word is editable; Salesforce remains authoritative. Attachments are PDF-only.</span> : <span className="text-xs text-amber-800">A saved draft may be exported as PDF only; it is not an attachment or issued document.</span>}
      </div>
      {mode === 'live' ? <div className={`rounded-md border p-2 text-xs ${liveReadiness.state === 'verified' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : liveReadiness.state === 'legacy' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-blue-200 bg-blue-50 text-blue-900'}`}><strong>{liveReadiness.label}.</strong> {liveReadiness.reason}</div> : null}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{pages.length} {pages.length === 1 ? 'page' : 'pages'} · local preview</span>
        <div className="flex gap-1"><Button type="button" size="sm" variant={zoom === 'fit' ? 'secondary' : 'ghost'} onClick={() => setZoom('fit')}>Fit width</Button><Button type="button" size="sm" variant={zoom === '100' ? 'secondary' : 'ghost'} onClick={() => setZoom('100')}>100%</Button></div>
      </div>
      <div className="max-h-[70vh] space-y-4 overflow-auto rounded-md bg-slate-100 p-3 sm:p-5">{pages.map((pageText, index) => <DocumentSheet key={`${index}-${pageText.slice(0, 32)}`} model={model} pageText={pageText} nextPageText={pages[index + 1]} pageIndex={index} pageCount={pages.length} zoom={zoom} />)}</div>
    </section>
  );
}
