import { useCallback, useEffect, useMemo, useState } from "react";
import { AppConfig } from "@/hedge/api/entities";
import {
  DEFAULT_EMAIL_SETTINGS,
  DEFAULT_GENERAL,
  DEFAULT_LISTS,
  DEFAULT_RATES,
  ICE_IM_FALLBACK,
} from "../lib/domain";

export function useAppSettings() {
  const [values, setValues] = useState(null);
  const [ids, setIds] = useState({});
  const [updatedAt, setUpdatedAt] = useState({});
  const [revisions, setRevisions] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const records = await AppConfig.list();
      const nextValues = {};
      const nextIds = {};
      const nextUpdatedAt = {};
      const nextRevisions = {};
      records.forEach((record) => {
        nextValues[record.key] = record.value;
        nextIds[record.key] = record.id;
        nextUpdatedAt[record.key] = record.updated_date || record.created_date || null;
        nextRevisions[record.key] = Number(record.revision || 1);
      });
      setValues(nextValues);
      setIds(nextIds);
      setUpdatedAt(nextUpdatedAt);
      setRevisions(nextRevisions);
    } catch (nextError) {
      setValues({});
      setUpdatedAt({});
      setError(nextError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const update = useCallback(async (key, value) => {
    setSavingKey(key);
    setError(null);
    try {
      let saved;
      if (ids[key]) {
        saved = await AppConfig.update(ids[key], { value }, revisions[key]);
      } else {
        saved = await AppConfig.create({ key, value, label: key });
        setIds((current) => ({ ...current, [key]: saved.id }));
      }
      setValues((current) => ({ ...(current || {}), [key]: value }));
      setUpdatedAt((current) => ({
        ...current,
        [key]: saved?.updated_date || saved?.created_date || new Date().toISOString(),
      }));
      setRevisions((current) => ({ ...current, [key]: Number(saved?.revision || 1) }));
      return value;
    } catch (nextError) {
      setError(nextError);
      throw nextError;
    } finally {
      setSavingKey(null);
    }
  }, [ids, revisions]);

  return useMemo(() => ({
    loading,
    error,
    savingKey,
    reload: load,
    update,
    rates: { ...DEFAULT_RATES, ...(values?.rates || {}) },
    general: { ...DEFAULT_GENERAL, ...(values?.general || {}) },
    lists: { ...DEFAULT_LISTS, ...(values?.lists || {}) },
    email: { ...DEFAULT_EMAIL_SETTINGS, ...(values?.email_settings || {}) },
    iceMargins: values?.ice_margins || ICE_IM_FALLBACK,
    iceMarginStatus: values?.ice_margin_status || null,
    closedMonths: values?.closed_months || [],
    forwardSpreads: values?.fwd_spreads || {},
    forwardSpreadsUpdatedAt: updatedAt.fwd_spreads || null,
    salesforceMapping: values?.salesforce_mapping || {},
    assistantModel: typeof values?.assistant_model === 'string' ? values.assistant_model : values?.assistant_model?.modelId || null,
  }), [error, load, loading, savingKey, update, updatedAt, values]);
}
