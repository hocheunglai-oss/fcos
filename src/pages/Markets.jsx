import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { ActionsProvider } from '@/hedge/data/ActionsContext';
import { MarketIntelligenceWorkspace } from '@/hedge/views/MarketIntelligenceWorkspace';
import { EmptyState, InlineError, Button } from '@/hedge/components/ui';
import { DEFAULT_GENERAL } from '@/hedge/lib/domain';
import { loadMarketPulseSnapshot, loadMarketSnapshot, MarketPrice, verifyMopsMonth } from '@/hedge/api/marketData';
import { navigationCacheOptions } from '@/lib/navigationCachePolicy';
import '@/hedge/styles.css';

const EMPTY = { mops: [], mopsMonthVerifications: [], marketIntelligence: {}, settings: {}, capabilities: {} };
const MARKET_DRIVE_REFRESH_OFFSET_MS = 2 * 60 * 1000;
const MARKET_DRIVE_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

export default function Markets() {
  const [pulse, setPulse] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [error, setError] = useState(null);
  const snapshotRef = useRef(null);
  const snapshotRequestRef = useRef(null);

  const reload = useCallback(async ({ silent = false, force = silent } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const applyPulse = (value) => {
        const next = value || null;
        setPulse(next);
        return next;
      };
      return applyPulse(await loadMarketPulseSnapshot({
        ...navigationCacheOptions('operational', applyPulse),
        force,
      }));
    } catch (nextError) {
      setError(nextError);
      throw nextError;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const ensureSnapshot = useCallback(async ({ force = false } = {}) => {
    if (!force && snapshotRef.current) return snapshotRef.current;
    if (!force && snapshotRequestRef.current) return snapshotRequestRef.current;
    setSnapshotLoading(true);
    const request = loadMarketSnapshot({
      cache: !force,
      force,
    }).then((value) => {
      const next = { ...EMPTY, ...(value || {}) };
      snapshotRef.current = next;
      setSnapshot(next);
      return next;
    }).finally(() => {
      snapshotRequestRef.current = null;
      setSnapshotLoading(false);
    });
    snapshotRequestRef.current = request;
    return request;
  }, []);

  const reloadAfterMarketMutation = useCallback(async () => {
    await Promise.all([
      reload({ silent: true, force: true }),
      ensureSnapshot({ force: true }),
    ]);
  }, [ensureSnapshot, reload]);

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

  const effectiveSnapshot = snapshot || EMPTY;
  const settings = useMemo(() => ({
    general: { ...DEFAULT_GENERAL, ...(effectiveSnapshot.settings?.general || {}) },
    forwardSpreads: effectiveSnapshot.settings?.forwardSpreads || {},
    forwardSpreadsUpdatedAt: effectiveSnapshot.settings?.forwardSpreadsUpdatedAt || null,
    update: async () => {
      throw new Error('Legacy forward adjustments are no longer available. Use an exact contract-month fallback in Forward Curves.');
    },
  }), [effectiveSnapshot.settings]);

  if (loading && !pulse) {
    return <div className="hedge-desk-root"><EmptyState title="Loading Markets" description="Preparing the daily brief, delivered prices and exact contract-month curves." icon={RefreshCw} /></div>;
  }

  return (
    <ActionsProvider reload={reloadAfterMarketMutation}>
      <div className="hedge-desk-root">
        {error && <InlineError error={error} action={<Button onClick={() => reload()}>Retry</Button>} />}
        {refreshing && <div className="px-6 pt-4 text-xs text-muted-foreground">Refreshing market data...</div>}
        <MarketIntelligenceWorkspace
          data={{ mops: effectiveSnapshot.mops || [], mopsMonthVerifications: effectiveSnapshot.mopsMonthVerifications || [], marketIntelligence: effectiveSnapshot.marketIntelligence || {} }}
          pulse={pulse}
          marketDataLoaded={Boolean(snapshot)}
          marketDataLoading={snapshotLoading}
          ensureMarketData={ensureSnapshot}
          settings={settings}
          priceEntity={MarketPrice}
          canManageMarketData={pulse?.capabilities?.hedge_book_manage === true}
          canManageAlertRules={pulse?.capabilities?.hedge_admin === true}
          canManageCurveCutover={pulse?.capabilities?.hedge_admin === true}
          reload={reload}
          verifyMonth={async (month, sourceMessage, expectedRevision) => {
            const result = await verifyMopsMonth(month, sourceMessage, expectedRevision);
            await Promise.all([reload({ silent: true }), ensureSnapshot({ force: true })]);
            return result;
          }}
        />
      </div>
    </ActionsProvider>
  );
}
