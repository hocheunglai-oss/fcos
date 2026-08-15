import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { appClient } from '@/api/appClient';
import PageHeader from '@/components/common/PageHeader';
import PageMethodology from '@/components/common/PageMethodology';
import StateBlock from '@/components/common/StateBlock';
import WholeTermRevisionPanel from '@/components/special-terms/WholeTermRevisionPanel';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SPECIAL_TERMS_METHODOLOGY } from '@/lib/pageMethodologies';
import { invalidateSpecialTermDetail, prefetchSpecialTermDetail } from '@/lib/specialTermDetailPrefetch';

export default function SpecialTermEditor() {
  const { termId } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const requestSequence = useRef(0);

  const load = useCallback(async ({ force = false, preserveViewport = false } = {}) => {
    const requestId = ++requestSequence.current;
    const viewport = preserveViewport ? { top: window.scrollY, left: window.scrollX } : null;
    if (preserveViewport) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      if (force) invalidateSpecialTermDetail(termId);
      const next = force
        ? await appClient.functions.invoke('specialTermDetail', { termId, force: true }, { cache: false }).then((response) => {
          if (response.data?.error) throw new Error(response.data.error);
          return response.data;
        })
        : await prefetchSpecialTermDetail(termId);
      if (requestId !== requestSequence.current) return;
      setDetail(next);
      if (viewport) window.requestAnimationFrame(() => window.scrollTo({ ...viewport, behavior: 'auto' }));
    } catch (requestError) {
      if (requestId === requestSequence.current) setError(requestError.message || 'The Special Term could not be loaded.');
    } finally {
      if (requestId === requestSequence.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [termId]);

  useEffect(() => { void load(); }, [load]);

  const mergeCommittedDetail = (nextDetail, successMessage) => {
    const viewport = { top: window.scrollY, left: window.scrollX };
    setDetail(nextDetail);
    setMessage(successMessage || 'Special Term updated.');
    setError('');
    invalidateSpecialTermDetail(termId);
    window.requestAnimationFrame(() => window.scrollTo({ ...viewport, behavior: 'auto' }));
  };

  const applyInlinePublication = (result) => {
    if (result?.currentTermDetail) mergeCommittedDetail(result.currentTermDetail, result.initialApproval ? 'The initial clause version was approved.' : 'The shared wording was published.');
    else setMessage(result?.initialApproval ? 'The initial Clause Library version was approved.' : 'The shared wording was published without changing this draft.');
  };

  if (loading && !detail) return <div className="p-4 md:p-6"><StateBlock title="Opening Special Term" description="Loading authoritative wording, clause versions, and rules only for this term." icon={Loader2} /></div>;

  return (
    <div className="space-y-5 p-4 md:p-6">
      <PageHeader
        eyebrow="Special Terms"
        title={detail?.term?.name || 'Special Term'}
        description="One editor for Terms Text, both remarks, matching rules, and the governed preview."
        meta={<div className="flex flex-wrap gap-2"><Badge variant={detail?.term?.revisionStatus === 'Approved' ? 'default' : 'secondary'}>{detail?.term?.revisionStatus || 'Legacy'}</Badge><Badge variant="outline">{detail?.term?.addToConfirmation ? 'Confirmation PDF' : 'No Confirmation PDF'}</Badge><Badge variant="outline">{detail?.term?.addToNomination ? 'Nomination PDF' : 'No Nomination PDF'}</Badge></div>}
        actions={<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => navigate('/special-terms')}><ArrowLeft className="mr-2 h-4 w-4" />Back to terms</Button><PageMethodology {...SPECIAL_TERMS_METHODOLOGY} /><Button variant="outline" onClick={() => load({ force: true, preserveViewport: true })} disabled={refreshing}><RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />Refresh term</Button>{detail?.instanceUrl ? <Button asChild variant="outline"><a href={`${detail.instanceUrl}/${termId}`} target="_blank" rel="noreferrer">Salesforce<ExternalLink className="ml-2 h-4 w-4" /></a></Button> : null}</div>}
      />

      {message ? <Alert><ShieldCheck className="h-4 w-4" /><AlertDescription>{message}</AlertDescription></Alert> : null}
      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}

      {detail ? <WholeTermRevisionPanel
        detail={detail}
        canDraft={detail.canDraft}
        canApprove={detail.canApproveRevisions}
        categoryOptions={detail.clauseCategoryOptions || []}
        audienceOptions={detail.audienceOptions || []}
        countryOptions={detail.countryOptions || []}
        onError={setError}
        onStatusMessage={setMessage}
        onCommitted={mergeCommittedDetail}
        onChanged={(successMessage) => { if (successMessage) setMessage(successMessage); }}
        onInlinePublished={applyInlinePublication}
      /> : null}
    </div>
  );
}
