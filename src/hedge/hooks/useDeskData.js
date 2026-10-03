import { useCallback, useEffect, useRef, useState } from "react";
import { loadDeskSnapshot } from "@/hedge/api/entities";
import { navigationCacheOptions } from "@/lib/navigationCachePolicy";

const EMPTY_DATA = {
  physicals: [],
  swaps: [],
  mops: [],
  mopsMonthVerifications: [],
  clearing: [],
  counterparties: [],
  invoices: [],
  brokerSettlements: [],
  marketValuation: { available: false, mode: "legacy_active_curve_shadow", reason: "curve_cutover_not_approved", settlements: [], valuationPoints: [] },
  auditLogs: [],
  capabilities: {},
};

export function useDeskData() {
  const [data, setData] = useState(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const requestSequence = useRef(0);
  const controller = useRef(null);
  const mounted = useRef(true);

  const reload = useCallback(async ({ silent = false, force = silent } = {}) => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const sequence = ++requestSequence.current;
    const isCurrent = () => mounted.current && sequence === requestSequence.current && !abort.signal.aborted;
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const applySnapshot = (snapshot) => {
        if (!isCurrent() || snapshot == null) return;
        const nextData = { ...EMPTY_DATA, ...(snapshot || {}) };
        setData(nextData);
        setLastUpdated(new Date());
        return nextData;
      };
      const snapshot = await loadDeskSnapshot({
        ...navigationCacheOptions("collaboration", applySnapshot),
        force,
        signal: abort.signal,
      });
      const nextData = applySnapshot(snapshot);
      return nextData;
    } catch (nextError) {
      if (!isCurrent() || nextError?.name === 'AbortError') return;
      setError(nextError);
      throw nextError;
    } finally {
      if (isCurrent()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    reload().catch(() => {});
    return () => { mounted.current = false; ++requestSequence.current; controller.current?.abort(); };
  }, [reload]);

  useEffect(() => {
    const handler = () => reload({ silent: true }).catch(() => {});
    window.addEventListener("bunkerdesk:reload", handler);
    return () => window.removeEventListener("bunkerdesk:reload", handler);
  }, [reload]);

  return { ...data, loading, refreshing, error, lastUpdated, reload };
}
