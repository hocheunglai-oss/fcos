import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { ActionsProvider } from '@/hedge/data/ActionsContext';
import { MarketsView } from '@/hedge/views/MarketsView';
import { EmptyState, InlineError, Button } from '@/hedge/components/ui';
import { DEFAULT_GENERAL } from '@/hedge/lib/domain';
import { loadMarketSnapshot, MarketPrice, saveForwardSpreads } from '@/hedge/api/marketData';
import PageMethodology from '@/components/common/PageMethodology';
import { MARKETS_METHODOLOGY } from '@/lib/pageMethodologies';
import '@/hedge/styles.css';

const EMPTY = { mops: [], settings: {}, capabilities: {} };

export default function Markets() {
  const [snapshot, setSnapshot] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const reload = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const next = { ...EMPTY, ...(await loadMarketSnapshot()) };
      setSnapshot(next);
      return next;
    } catch (nextError) {
      setError(nextError);
      throw nextError;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { reload().catch(() => {}); }, [reload]);

  const settings = useMemo(() => ({
    general: { ...DEFAULT_GENERAL, ...(snapshot.settings?.general || {}) },
    forwardSpreads: snapshot.settings?.forwardSpreads || {},
    forwardSpreadsUpdatedAt: snapshot.settings?.forwardSpreadsUpdatedAt || null,
    update: async (key, value) => {
      if (key !== 'fwd_spreads') throw new Error('This page may update only forward adjustments.');
      await saveForwardSpreads(value, snapshot.settings?.forwardSpreadsRevision || 0);
      await reload({ silent: true });
      return value;
    },
  }), [reload, snapshot.settings]);

  if (loading && !snapshot.mops.length) {
    return <div className="hedge-desk-root"><EmptyState title="Loading Markets" description="Preparing MOPS prices and forward adjustments." icon={RefreshCw} /></div>;
  }

  return (
    <ActionsProvider reload={reload}>
      <div className="hedge-desk-root">
        {error && <InlineError error={error} action={<Button onClick={() => reload()}>Retry</Button>} />}
        {refreshing && <div className="px-6 pt-4 text-xs text-muted-foreground">Refreshing market data...</div>}
        <MarketsView
          data={{ mops: snapshot.mops || [] }}
          settings={settings}
          priceEntity={MarketPrice}
          readOnly={snapshot.capabilities?.hedge_book_manage !== true}
          methodologyAction={<PageMethodology {...MARKETS_METHODOLOGY} />}
        />
      </div>
    </ActionsProvider>
  );
}
