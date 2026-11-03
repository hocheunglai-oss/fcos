import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Button } from '@/components/ui/button';

GlobalWorkerOptions.workerSrc = workerUrl;

export default function SpecialTermPdfPages({ blob }) {
  const containerRef = useRef(null);
  const canvasHost = useRef(null);
  const [pdf, setPdf] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState('fit');
  const [rendering, setRendering] = useState(true);
  const [pageText, setPageText] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let task;
    setPdf(null);
    setPageNumber(1);
    setError('');
    setRendering(true);
    setPageText('');
    canvasHost.current?.replaceChildren();
    blob.arrayBuffer().then(async (data) => {
      if (!active) return;
      task = getDocument({ data, useSystemFonts: true, isEvalSupported: false });
      const document = await task.promise;
      if (active) setPdf(document);
    }).catch(() => {
      if (active) setError('This PDF could not be displayed. You can still download it above.');
    });
    return () => { active = false; void task?.destroy().catch(() => {}); };
  }, [blob]);

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdf || width <= 0) return undefined;
    let active = true;
    let renderTask;
    setRendering(true);
    setPageText('');
    setError('');
    canvasHost.current?.replaceChildren();
    pdf.getPage(pageNumber).then(async (page) => {
      if (!active) return;
      const base = page.getViewport({ scale: 1 });
      const displayWidth = zoom === 'fit' ? Math.max(1, Math.min(width, 1050)) : base.width * 4 / 3;
      const viewport = page.getViewport({ scale: displayWidth / base.width });
      const density = Math.min(window.devicePixelRatio || 1, 2);
      // Render each page on its own canvas so a cancelled resize cannot overlap
      // a later render: https://mozilla.github.io/pdf.js/examples/
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width * density);
      canvas.height = Math.ceil(viewport.height * density);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `PDF page ${pageNumber} of ${pdf.numPages}`);
      renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: [density, 0, 0, density, 0, 0] });
      await renderTask.promise;
      const text = await page.getTextContent();
      if (!active) return;
      canvasHost.current?.replaceChildren(canvas);
      setPageText(text.items.map((item) => 'str' in item ? item.str : '').join(' '));
      setRendering(false);
    }).catch((failure) => {
      if (active && failure?.name !== 'RenderingCancelledException') {
        setError('This page could not be displayed. You can still download the PDF above.');
        setRendering(false);
      }
    });
    return () => { active = false; renderTask?.cancel(); };
  }, [pdf, pageNumber, width, zoom]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border p-2">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" aria-label="Previous PDF page" disabled={!pdf || rendering || pageNumber <= 1} onClick={() => setPageNumber((page) => page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
          <span aria-live="polite" className="text-xs tabular-nums">{pdf ? `Page ${pageNumber} of ${pdf.numPages}` : 'Loading pages…'}</span>
          <Button size="icon" variant="ghost" aria-label="Next PDF page" disabled={!pdf || rendering || pageNumber >= pdf.numPages} onClick={() => setPageNumber((page) => page + 1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <div className="flex gap-1"><Button size="sm" variant={zoom === 'fit' ? 'secondary' : 'ghost'} aria-pressed={zoom === 'fit'} onClick={() => setZoom('fit')}>Fit width</Button><Button size="sm" variant={zoom === '100' ? 'secondary' : 'ghost'} aria-pressed={zoom === '100'} onClick={() => setZoom('100')}>100%</Button></div>
      </div>
      <div ref={containerRef} className="relative min-h-0 flex-1 overflow-auto p-3">
        {error ? <p role="alert" className="p-4 text-sm text-destructive">{error}</p> : rendering ? <div role="status" className="flex items-center justify-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Rendering PDF…</div> : null}
        <div ref={canvasHost} className="mx-auto w-fit bg-white shadow-sm" />
        <p className="sr-only">{pageText}</p>
      </div>
    </div>
  );
}
