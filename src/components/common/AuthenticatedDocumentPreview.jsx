import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Download, Loader2, X } from 'lucide-react';
import {
  documentPreviewKind,
  downloadBlob,
  fetchAuthenticatedDocument,
  isSafeDocumentPreviewContentType,
} from '@/lib/authenticatedDownloadUrl';

function useDocumentBlob(document, stemId) {
  const [state, setState] = useState({ status: 'idle', blob: null, contentType: '', objectUrl: '', error: '' });
  const downloadUrl = document?.downloadUrl;
  const documentStemId = document?.stemId || stemId;

  useEffect(() => {
    if (!downloadUrl) {
      setState({ status: 'idle', blob: null, contentType: '', objectUrl: '', error: '' });
      return undefined;
    }

    let active = true;
    let objectUrl = '';
    const controller = new AbortController();
    setState({ status: 'loading', blob: null, contentType: '', objectUrl: '', error: '' });

    fetchAuthenticatedDocument(downloadUrl, { stemId: documentStemId, signal: controller.signal })
      .then(({ blob, contentType }) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ status: 'ready', blob, contentType, objectUrl, error: '' });
      })
      .catch((error) => {
        if (!active || error?.name === 'AbortError') return;
        setState({ status: 'error', blob: null, contentType: '', objectUrl: '', error: error?.message || 'Unable to download this document.' });
      });

    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [downloadUrl, documentStemId]);

  return state;
}

export function AuthenticatedDocumentDownloadButton({ document, stemId, className = '', children }) {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const requestRef = useRef(null);

  useEffect(() => {
    setStatus('idle');
    setError('');
    return () => requestRef.current?.abort();
  }, [document?.downloadUrl, document?.stemId, stemId]);

  const download = async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setStatus('loading');
    setError('');
    try {
      const { blob } = await fetchAuthenticatedDocument(document.downloadUrl, {
        stemId: document.stemId || stemId,
        signal: controller.signal,
      });
      if (requestRef.current !== controller || controller.signal.aborted) return;
      downloadBlob(blob, document.fileName || document.originalFileName || 'salesforce-document');
      setStatus('idle');
    } catch (nextError) {
      if (requestRef.current !== controller || controller.signal.aborted || nextError?.name === 'AbortError') return;
      setStatus('error');
      setError(nextError?.message || 'Unable to download this document.');
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  };

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" onClick={download} disabled={status === 'loading'} className={className}>
        {status === 'loading' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        {children || 'Download'}
      </button>
      {status === 'error' && <span role="alert" className="max-w-64 text-right text-[11px] text-destructive">{error}</span>}
    </span>
  );
}

export function AuthenticatedDocumentPreview({ document, stemId, onClose, title, subtitle, className = '' }) {
  const { status, blob, contentType, objectUrl, error } = useDocumentBlob(document, stemId);
  const kind = documentPreviewKind(document);
  const safePreviewKind = isSafeDocumentPreviewContentType(contentType, kind) ? kind : null;
  const fileName = document?.fileName || document?.originalFileName || title || 'Document preview';

  return (
    <div className={`flex h-[88vh] w-[min(1100px,94vw)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">{fileName}</div>
          {subtitle && <div className="mt-0.5 text-xs text-muted-foreground">{subtitle}</div>}
        </div>
        <div className="flex items-center gap-2">
          {status === 'ready' && blob && (
            <button
              type="button"
              onClick={() => downloadBlob(blob, fileName)}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary"
            >
              <Download className="h-3.5 w-3.5" /> Download
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Close document preview" className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:border-primary/40 hover:text-primary">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 bg-muted/20">
        {status === 'loading' && <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading document…</div>}
        {status === 'error' && <div role="alert" className="flex h-full items-center justify-center gap-2 p-5 text-sm text-destructive"><AlertCircle className="h-4 w-4 shrink-0" /> {error}</div>}
        {status === 'ready' && safePreviewKind === 'image' && <div className="flex h-full items-center justify-center overflow-auto p-4"><img src={objectUrl} alt={fileName} className="max-h-full max-w-full rounded-md object-contain" /></div>}
        {status === 'ready' && safePreviewKind === 'pdf' && <iframe title={fileName} src={objectUrl} className="h-full w-full border-0 bg-background" />}
        {status === 'ready' && !safePreviewKind && <div className="flex h-full flex-col items-center justify-center gap-3 p-5 text-center text-sm text-muted-foreground"><AlertCircle className="h-5 w-5" /> This file cannot be safely previewed in FCOS. Download it to open it locally.</div>}
      </div>
    </div>
  );
}
