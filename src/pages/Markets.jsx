import { useAuth } from '@/lib/AuthContext';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { ActionsProvider } from '@/hedge/data/ActionsContext';
import { MarketIntelligenceWorkspace } from '@/hedge/views/MarketIntelligenceWorkspace';
import { EmptyState, InlineError, Button } from '@/hedge/components/ui';
import { DEFAULT_GENERAL } from '@/hedge/lib/domain';
import { loadMarketBookContext, loadMarketPulseSnapshot, loadMarketSnapshot, MarketPrice, verifyMopsMonth } from '@/hedge/api/marketData';
import { navigationCacheOptions } from '@/lib/navigationCachePolicy';
import '@/hedge/styles.css';

const EMPTY = { mops: [], mopsMonthVerifications: [], marketIntelligence: {}, settings: {}, capabilities: {} };
const MARKET_DRIVE_REFRESH_OFFSET_MS = 2 * 60 * 1000;
const MARKET_DRIVE_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

export default function Markets() {
  const { hasModuleAccess } = useAuth();
  const canReadBook = hasModuleAccess('markets') && hasModuleAccess('hedge_desk');
  const [bookContext, setBookContext] = useState(null);
  const [bookLoading, setBookLoading] = useState(false);
  const [bookError, setBookError] = useState(null);
  const [bookHistorical, setBookHistorical] = useState(true);
  const [bookRetry, setBookRetry] = useState(0);
  const retryBook = useCallback(() => setBookRetry((value) => value + 1), []);
  const [pulse, setPulse] = useState(null);
  const [dateScopedPulse, setDateScopedPulse] = useState(null);
  const [datePulseLoading, setDatePulseLoading] = useState(false);
  const [datePulseError, setDatePulseError] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [error, setError] = useState(null);
  const snapshotRef = useRef(null);
  const snapshotRequestRef = useRef(null);
  const pulseRequestRef = useRef(null);
  const latestPulseRequestRef = useRef(0);

  useEffect(() => {
    setBookContext(null);
    setBookError(null);
    if (!canReadBook || bookHistorical) {
      setBookLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    setBookLoading(true);
    loadMarketBookContext({ signal: controller.signal }).then((context) => {
      if (!controller.signal.aborted) setBookContext(context);
    }).catch((nextError) => {
      if (!controller.signal.aborted) setBookError(nextError);
    }).finally(() => {
      if (!controller.signal.aborted) setBookLoading(false);
    });
    return () => controller.abort();
  }, [canReadBook, bookHistorical, bookRetry]);

  const reload = useCallback(async ({ silent = false, force = silent } = {}) => {
    const requestId = ++latestPulseRequestRef.current;
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const applyPulse = (value) => {
        const next = value || null;
        if (requestId === latestPulseRequestRef.current) {
          setPulse(next);
          setRefreshVersion((value) => value + 1);
        }
        return next;
      };
      return applyPulse(await loadMarketPulseSnapshot({
        ...navigationCacheOptions('operational', applyPulse),
        force,
      }));
    } catch (nextError) {
      if (requestId === latestPulseRequestRef.current) setError(nextError);
      throw nextError;
    } finally {
      if (requestId === latestPulseRequestRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  const ensureSnapshot = useCallback(async ({ force = false } = {}) => {
    const key = 'latest';
    if (!force && snapshotRef.current?.key === key) return snapshotRef.current.value;
    if (!force && snapshotRequestRef.current?.key === key) return snapshotRequestRef.current.promise;
    setSnapshotLoading(true);
    const request = loadMarketSnapshot({
      cache: !force,
      force,
    }).then((value) => {
      const next = { ...EMPTY, ...(value || {}) };
      if (snapshotRequestRef.current?.key === key) {
        snapshotRef.current = { key, value: next };
        setSnapshot(next);
      }
      return next;
    }).finally(() => {
      if (snapshotRequestRef.current?.key === key) {
        snapshotRequestRef.current = null;
        setSnapshotLoading(false);
      }
    });
    snapshotRequestRef.current = { key, promise: request };
    return request;
  }, []);

  const loadPulseForDate = useCallback(async ({ asOfDate, mode, force = false } = {}) => {
    setBookHistorical(mode !== 'latest');
    if (mode === 'latest' && force) setBookRetry((value) => value + 1);
    if (pulseRequestRef.current) pulseRequestRef.current.abort();
    setDateScopedPulse(null);
    setDatePulseError(null);
    if (!asOfDate) {
      setDatePulseLoading(false);
      return null;
    }
    const controller = new AbortController();
    pulseRequestRef.current = controller;
    setDatePulseLoading(true);
    try {
      const next = await loadMarketPulseSnapshot({ asOfDate }, { cache: !force, force, signal: controller.signal });
      if (!controller.signal.aborted) setDateScopedPulse(next || null);
      return next;
    } catch (nextError) {
      if (!controller.signal.aborted) setDatePulseError(nextError);
      throw nextError;
    } finally {
      if (pulseRequestRef.current === controller) pulseRequestRef.current = null;
      if (!controller.signal.aborted) setDatePulseLoading(false);
    }
  }, []);

  useEffect(() => () => pulseRequestRef.current?.abort(), []);

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
  const displayPulse = dateScopedPulse;
  const settings = useMemo(() => ({
    general: { ...DEFAULT_GENERAL, ...(effectiveSnapshot.settings?.general || {}) },
    forwardSpreads: effectiveSnapshot.settings?.forwardSpreads || {},
    forwardSpreadsUpdatedAt: effectiveSnapshot.settings?.forwardSpreadsUpdatedAt || null,
    update: async () => {
      throw new Error('Legacy forward adjustments are no longer available. Use an exact contract-month fallback in Forward Curves.');
    },
  }), [effectiveSnapshot.settings]);

  if (loading && !pulse) {
    return <div className="hedge-desk-root workspace-trading"><EmptyState title="Loading Markets" description="Preparing the daily brief, delivered prices and exact contract-month curves." icon={RefreshCw} /></div>;
  }

  return (
    <ActionsProvider reload={reloadAfterMarketMutation}>
      <div className="hedge-desk-root workspace-trading">
        {error && <div className="workspace-floating-utility-safe"><InlineError error={error} action={<Button onClick={() => reload()}>Retry</Button>} /></div>}
        {refreshing && <div className="px-6 pt-4 text-xs text-muted-foreground">Refreshing market data...</div>}
        <MarketIntelligenceWorkspace
          data={{ mops: effectiveSnapshot.mops || [], mopsMonthVerifications: effectiveSnapshot.mopsMonthVerifications || [], marketIntelligence: effectiveSnapshot.marketIntelligence || {} }}
          pulse={displayPulse}
          canReadBook={canReadBook}
          bookContext={bookContext}
          bookLoading={bookLoading || bookHistorical}
          bookError={bookError}
          onRetryBook={retryBook}
          refreshVersion={refreshVersion}
          marketPulseLoading={datePulseLoading}
          marketPulseError={datePulseError}
          marketDataLoaded={Boolean(snapshot)}
          marketDataLoading={snapshotLoading}
          ensureMarketData={ensureSnapshot}
          onDateResolved={loadPulseForDate}
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
