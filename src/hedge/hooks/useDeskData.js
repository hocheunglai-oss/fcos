import { useCallback, useEffect, useState } from "react";
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
  auditLogs: [],
  capabilities: {},
};

export function useDeskData() {
  const [data, setData] = useState(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const reload = useCallback(async ({ silent = false, force = silent } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const applySnapshot = (snapshot) => {
        const nextData = { ...EMPTY_DATA, ...(snapshot || {}) };
        setData(nextData);
        setLastUpdated(new Date());
        return nextData;
      };
      const snapshot = await loadDeskSnapshot({
        ...navigationCacheOptions("collaboration", applySnapshot),
        force,
      });
      const nextData = applySnapshot(snapshot);
      return nextData;
    } catch (nextError) {
      setError(nextError);
      throw nextError;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    reload().catch(() => {});
  }, [reload]);

  useEffect(() => {
    const handler = () => reload({ silent: true }).catch(() => {});
    window.addEventListener("bunkerdesk:reload", handler);
    return () => window.removeEventListener("bunkerdesk:reload", handler);
  }, [reload]);

  return { ...data, loading, refreshing, error, lastUpdated, reload };
}
