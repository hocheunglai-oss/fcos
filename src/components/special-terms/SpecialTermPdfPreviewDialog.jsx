import { lazy, Suspense, useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { appClient } from '@/api/appClient';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const SpecialTermPdfPages = lazy(() => import('@/components/special-terms/SpecialTermPdfPages'));

function PdfPreviewContent({ request }) {
  const [state, setState] = useState({ status: 'loading', url: '', filename: '', error: '' });

  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setState({ status: 'loading', url: '', filename: '', error: '' });
    const { termName: _termName, ...payload } = request;
    appClient.functions.download('specialTermsDocumentExport', { ...payload, format: 'pdf' })
      .then(async ({ blob, filename }) => {
        if (!active) return;
        if (blob.type.split(';')[0].toLowerCase() !== 'application/pdf' || await blob.slice(0, 5).text() !== '%PDF-') {
          throw new Error('The response was not a PDF. Close the preview and try again.');
        }
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ status: 'ready', url: objectUrl, filename, blob, error: '' });
      })
      .catch((error) => {
        if (active) setState({ status: 'error', url: '', filename: '', error: error.message || 'The PDF could not be prepared. Close the preview and try again.' });
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [request]);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <div className="min-w-0 flex-1">
          <Badge variant={request.source === 'draft' ? 'secondary' : 'default'}>{request.source === 'draft' ? 'Draft · review copy' : 'Live PDF'}</Badge>
          {state.filename ? <p className="mt-1 break-all text-xs text-muted-foreground">{state.filename}</p> : null}
        </div>
        {state.status === 'ready' ? <Button asChild size="sm"><a href={state.url} download={state.filename}><Download className="mr-1.5 h-4 w-4" />Download PDF</a></Button> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-muted/20" aria-busy={state.status === 'loading'}>
        {state.status === 'loading' ? <div role="status" className="flex h-full items-center justify-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Preparing PDF preview…</div> : null}
        {state.status === 'error' ? <Alert variant="destructive" className="m-4 w-auto"><AlertDescription>{state.error}</AlertDescription></Alert> : null}
        {state.status === 'ready' ? <Suspense fallback={<p role="status" className="p-4 text-sm text-muted-foreground">Loading PDF viewer…</p>}><SpecialTermPdfPages blob={state.blob} /></Suspense> : null}
      </div>
    </>
  );
}

export default function SpecialTermPdfPreviewDialog({ request, onClose }) {
  return (
    <Dialog open={Boolean(request)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex h-[90dvh] max-h-[90dvh] w-[96vw] max-w-6xl flex-col gap-3 overflow-hidden p-4 sm:p-6">
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>{request?.termName || 'Special Terms'} — PDF preview</DialogTitle>
          <DialogDescription>{request?.source === 'draft' ? 'Watermarked review copy. This PDF is not an issued document.' : 'Review the generated PDF, then download this copy when ready.'}</DialogDescription>
        </DialogHeader>
        {request ? <PdfPreviewContent request={request} /> : null}
      </DialogContent>
    </Dialog>
  );
}
