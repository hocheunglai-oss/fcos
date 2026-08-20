import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { ActionsProvider } from '@/hedge/data/ActionsContext';
import { MarketIntelligenceWorkspace } from '@/hedge/views/MarketIntelligenceWorkspace';
import { EmptyState, InlineError, Button } from '@/hedge/components/ui';
import { DEFAULT_GENERAL } from '@/hedge/lib/domain';
import { loadMarketSnapshot, MarketPrice, verifyMopsMonth } from '@/hedge/api/marketData';
import { navigationCacheOptions } from '@/lib/navigationCachePolicy';
import '@/hedge/styles.css';

const EMPTY = { mops: [], mopsMonthVerifications: [], marketIntelligence: {}, settings: {}, capabilities: {} };
const MARKET_DRIVE_REFRESH_OFFSET_MS = 2 * 60 * 1000;
const MARKET_DRIVE_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

export default function Markets() {
  const [snapshot, setSnapshot] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const reload = useCallback(async ({ silent = false, force = silent } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const applySnapshot = (value) => {
        const next = { ...EMPTY, ...(value || {}) };
        setSnapshot(next);
        return next;
      };
      const next = applySnapshot(await loadMarketSnapshot({
        ...navigationCacheOptions('operational', applySnapshot),
        force,
      }));
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

  useEffect(() => {
    let intervalId = null;
    const refreshVisibleMarkets = () => {
      if (document.visibilityState === 'visible') reload({ silent: true, force: true }).catch(() => {});
    };
    const millisecondsIntoHour = Date.now() % MARKET_DRIVE_REFRESH_INTERVAL_MS;
    const timeoutId = window.setTimeout(() => {
      refreshVisibleMarkets();
      intervalId = window.setInterval(refreshVisibleMarkets, MARKET_DRIVE_REFRESH_INTERVAL_MS);
    }, MARKET_DRIVE_REFRESH_INTERVAL_MS - millisecondsIntoHour + MARKET_DRIVE_REFRESH_OFFSET_MS);
    return () => {
      window.clearTimeout(timeoutId);
      if (intervalId != null) window.clearInterval(intervalId);
    };
  }, [reload]);

  const settings = useMemo(() => ({
    general: { ...DEFAULT_GENERAL, ...(snapshot.settings?.general || {}) },
    forwardSpreads: snapshot.settings?.forwardSpreads || {},
    forwardSpreadsUpdatedAt: snapshot.settings?.forwardSpreadsUpdatedAt || null,
    update: async () => {
      throw new Error('Legacy forward adjustments are no longer available. Use an exact contract-month fallback in Forward Curves.');
    },
  }), [snapshot.settings]);

  if (loading && !snapshot.mops.length) {
    return <div className="hedge-desk-root"><EmptyState title="Loading Markets" description="Preparing the daily brief, delivered prices and exact contract-month curves." icon={RefreshCw} /></div>;
  }

  return (
    <ActionsProvider reload={reload}>
      <div className="hedge-desk-root">
        {error && <InlineError error={error} action={<Button onClick={() => reload()}>Retry</Button>} />}
        {refreshing && <div className="px-6 pt-4 text-xs text-muted-foreground">Refreshing market data...</div>}
        <MarketIntelligenceWorkspace
          data={{ mops: snapshot.mops || [], mopsMonthVerifications: snapshot.mopsMonthVerifications || [], marketIntelligence: snapshot.marketIntelligence || {} }}
          settings={settings}
          priceEntity={MarketPrice}
          canManageMarketData={snapshot.capabilities?.hedge_book_manage === true}
          canManageAlertRules={snapshot.capabilities?.hedge_admin === true}
          canManageCurveCutover={snapshot.capabilities?.hedge_admin === true}
          reload={reload}
          verifyMonth={async (month, sourceMessage, expectedRevision) => {
            const result = await verifyMopsMonth(month, sourceMessage, expectedRevision);
            await reload({ silent: true });
            return result;
          }}
        />
      </div>
    </ActionsProvider>
  );
}
